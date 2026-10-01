/**
 * GitHub release metadata for `ritual self-update`: parsing the releases API's
 * JSON (never trusting its shape), choosing the update channel, finding the
 * release a run should install, and the HTTP requests behind all of it. Network
 * access goes through the injected {@link SelfUpdateEnv} so the lookup is
 * testable without GitHub.
 */

import { compareVersions, isPrereleaseVersion } from '../config/semver'
import { isReleaseTag, normalizeVersion } from '../config/version'
import type { MessageKey } from '../i18n/messages/en'
import { CardCommandError, ExitCode, getErrorMessage, localizedCommandError } from '../util/errors'
import { isRecord } from '../util/json'
import { isParseError, type ParseError } from '../util/parse-error'
import type { SelfUpdateEnv } from './env'

/** One downloadable file attached to a release. */
export type ReleaseAsset = {
  name: string
  /** The `browser_download_url`: where the file's bytes are served (always `https:`). */
  url: string
  size: number
}

/** A published (or draft) release, validated. */
export type Release = {
  tag: string
  /** The tag as Ritual reports its own version (`v1.2.3` → `1.2.3`). */
  version: string
  draft: boolean
  prerelease: boolean
  assets: ReleaseAsset[]
}

/** The two update channels: stable releases only, or every release including prereleases. */
export type UpdateChannel = 'stable' | 'prerelease'

/** The channel switches `self-update` accepts; at most one is set (Commander enforces it). */
export type ChannelFlags = {
  prerelease?: boolean
  stable?: boolean
}

/** What a run asks for: the newest release on a channel, or one exact tag. */
export type ReleaseTarget =
  { kind: 'channel'; channel: UpdateChannel } | { kind: 'tag'; tag: string }

/** How long one releases API request may take before it is abandoned. */
const API_TIMEOUT_MS = 30_000

/** How many recent releases the prerelease channel considers. */
const RELEASE_LIST_SIZE = 30

function isHttpsUrl(value: string): boolean {
  return URL.canParse(value) && new URL(value).protocol === 'https:'
}

function parseAsset(value: unknown, index: number): ReleaseAsset | ParseError {
  if (!isRecord(value)) return { error: `assets[${index}] is not an object` }
  const { name, browser_download_url: url, size } = value
  if (typeof name !== 'string' || name === '') {
    return { error: `assets[${index}].name is missing` }
  }
  if (typeof url !== 'string' || !isHttpsUrl(url)) {
    return { error: `assets[${index}].browser_download_url is not an https URL` }
  }
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    return { error: `assets[${index}].size is not a byte count` }
  }
  return { name, url, size }
}

/** Parse one object from the releases API. */
export function parseRelease(json: unknown): Release | ParseError {
  if (!isRecord(json)) return { error: 'the release is not an object' }
  const { tag_name: tag, draft, prerelease, assets } = json
  if (typeof tag !== 'string' || tag === '') return { error: 'tag_name is missing' }
  // Exactly the tags `normalizeVersion` reads as a release: anything looser
  // would become a `0.0.0-dev.…` version and compare as a downgrade.
  if (!isReleaseTag(tag)) return { error: `tag_name '${tag}' is not a release version` }
  if (typeof draft !== 'boolean') return { error: 'draft is not a boolean' }
  if (typeof prerelease !== 'boolean') return { error: 'prerelease is not a boolean' }
  if (!Array.isArray(assets)) return { error: 'assets is not a list' }
  const parsedAssets: ReleaseAsset[] = []
  for (const [index, asset] of assets.entries()) {
    const parsed = parseAsset(asset, index)
    if (isParseError(parsed)) return parsed
    parsedAssets.push(parsed)
  }
  return { tag, version: normalizeVersion(tag), draft, prerelease, assets: parsedAssets }
}

/**
 * Parse the releases API's list. Drafts are dropped before validation (never
 * installable, and a draft's tag may not be a version yet), and so is any other
 * entry that does not parse — one odd release (a `nightly` tag) must not close
 * the whole channel. Only a list where nothing parses is an error.
 */
export function parseReleaseList(json: unknown): Release[] | ParseError {
  if (!Array.isArray(json)) return { error: 'the release list is not a list' }
  const releases: Release[] = []
  let firstError: ParseError | undefined
  for (const [index, item] of json.entries()) {
    if (isRecord(item) && item.draft === true) continue
    const parsed = parseRelease(item)
    if (isParseError(parsed)) firstError ??= { error: `release ${index}: ${parsed.error}` }
    else releases.push(parsed)
  }
  return releases.length === 0 && firstError !== undefined ? firstError : releases
}

/** The highest-versioned non-draft release, prereleases included. */
export function newestRelease(releases: readonly Release[]): Release | undefined {
  let newest: Release | undefined
  for (const release of releases) {
    if (release.draft) continue
    if (newest === undefined || compareVersions(release.version, newest.version) > 0) {
      newest = release
    }
  }
  return newest
}

/**
 * The channel a run tracks: an explicit switch wins, otherwise the running
 * build's own — a prerelease build follows prereleases, a stable build stable
 * releases.
 */
export function resolveChannel(currentVersion: string, flags: ChannelFlags): UpdateChannel {
  if (flags.prerelease === true) return 'prerelease'
  if (flags.stable === true) return 'stable'
  return isPrereleaseVersion(currentVersion) ? 'prerelease' : 'stable'
}

/**
 * The release tag for a `--tag` value, which may be spelled with or without the
 * leading `v` (Ritual's release tags always carry it).
 */
export function parseReleaseTag(input: string): string | ParseError {
  const trimmed = input.trim()
  if (!isReleaseTag(trimmed)) return { error: `'${trimmed}' is not a release version` }
  return `v${trimmed.replace(/^v/, '')}`
}

/** A request that got no (complete) answer: a dropped connection, a timeout. */
export function networkError(url: string, error: unknown): CardCommandError {
  return localizedCommandError(
    'runtime_error',
    ExitCode.RuntimeError,
    'cli.selfUpdate.error.network',
    { url, error: getErrorMessage(error) },
  )
}

/** Whether the GitHub token may travel to `url`: only to the API's own origin. */
function carriesToken(env: SelfUpdateEnv, url: string): boolean {
  return env.githubToken !== undefined && new URL(url).origin === new URL(env.apiBase).origin
}

/** Same-origin redirects a token-carrying request follows before giving up. */
const MAX_TOKEN_REDIRECTS = 5

/**
 * Fetch a URL, turning a network failure (or timeout) into the localized
 * runtime error. The token goes only to the API's own origin: asset downloads
 * are public, and a release could point them at any host. A request carrying
 * it follows redirects by hand, and only within that origin — `fetch` would
 * otherwise forward the header wherever a redirect points.
 */
export async function request(
  env: SelfUpdateEnv,
  url: string,
  accept: string,
  signal: AbortSignal,
): Promise<Response> {
  let current = url
  for (let redirects = 0; ; redirects++) {
    const withToken = carriesToken(env, current)
    const headers = new Headers({ Accept: accept })
    if (withToken) headers.set('Authorization', `Bearer ${env.githubToken}`)
    let response: Response
    try {
      response = await env.fetch(current, {
        headers,
        signal,
        redirect: withToken ? 'manual' : 'follow',
      })
    } catch (error) {
      throw networkError(current, error)
    }
    const location = response.headers.get('location')
    const isRedirect = response.status >= 300 && response.status < 400 && location !== null
    if (!withToken || !isRedirect) return response
    const next = new URL(location, current)
    if (next.origin !== new URL(current).origin || redirects >= MAX_TOKEN_REDIRECTS) {
      throw localizedCommandError(
        'runtime_error',
        ExitCode.RuntimeError,
        'cli.selfUpdate.error.redirectRefused',
        { url: current, location: next.href },
      )
    }
    current = next.href
  }
}

/**
 * The error for a non-OK response. GitHub answers an exhausted rate limit with
 * 429, or 403 with `x-ratelimit-remaining: 0`; any other 403 (a bad token, say)
 * is an ordinary failure.
 */
export function httpError(response: Response, url: string): CardCommandError {
  const rateLimited =
    response.status === 429 ||
    (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
  const key: MessageKey = rateLimited
    ? 'cli.selfUpdate.error.rateLimited'
    : 'cli.selfUpdate.error.http'
  return localizedCommandError('runtime_error', ExitCode.RuntimeError, key, {
    url,
    status: response.status,
  })
}

function badResponse(url: string, error: string): CardCommandError {
  return localizedCommandError(
    'runtime_error',
    ExitCode.RuntimeError,
    'cli.selfUpdate.error.badResponse',
    { url, error },
  )
}

/** A releases API lookup: the document, or GitHub's 404. */
type JsonLookup = { kind: 'found'; json: unknown } | { kind: 'missing' }

/** GET a releases API document. */
async function getJson(env: SelfUpdateEnv, url: string): Promise<JsonLookup> {
  const signal = AbortSignal.timeout(API_TIMEOUT_MS)
  const response = await request(env, url, 'application/vnd.github+json', signal)
  if (response.status === 404) return { kind: 'missing' }
  if (!response.ok) throw httpError(response, url)
  try {
    return { kind: 'found', json: (await response.json()) as unknown }
  } catch (error) {
    throw badResponse(url, getErrorMessage(error))
  }
}

function parsedOrThrow<T>(url: string, parsed: T | ParseError): T {
  if (isParseError(parsed)) throw badResponse(url, parsed.error)
  return parsed
}

/**
 * The release a run should install: `releases/latest` for the stable channel,
 * the newest non-draft of the recent release list for prereleases,
 * `releases/tags/<tag>` for an exact tag. A missing release is a not-found
 * error (exit 3).
 */
export async function fetchRelease(env: SelfUpdateEnv, target: ReleaseTarget): Promise<Release> {
  if (target.kind === 'tag') {
    const url = `${env.apiBase}/releases/tags/${encodeURIComponent(target.tag)}`
    const lookup = await getJson(env, url)
    if (lookup.kind === 'missing') {
      throw localizedCommandError(
        'not_found',
        ExitCode.NotFound,
        'cli.selfUpdate.error.tagNotFound',
        { tag: target.tag },
      )
    }
    return parsedOrThrow(url, parseRelease(lookup.json))
  }
  if (target.channel === 'stable') {
    const url = `${env.apiBase}/releases/latest`
    const lookup = await getJson(env, url)
    if (lookup.kind === 'missing') {
      throw localizedCommandError(
        'not_found',
        ExitCode.NotFound,
        'cli.selfUpdate.error.noStableRelease',
      )
    }
    const release = parsedOrThrow(url, parseRelease(lookup.json))
    // GitHub never marks a prerelease "latest" itself, but a release's flags
    // can be edited afterwards; the stable channel must not install one.
    if (release.prerelease || isPrereleaseVersion(release.version)) {
      throw localizedCommandError(
        'not_found',
        ExitCode.NotFound,
        'cli.selfUpdate.error.noStableRelease',
      )
    }
    return release
  }
  const url = `${env.apiBase}/releases?per_page=${RELEASE_LIST_SIZE}`
  const lookup = await getJson(env, url)
  const releases =
    lookup.kind === 'missing' ? [] : parsedOrThrow(url, parseReleaseList(lookup.json))
  const newest = newestRelease(releases)
  if (newest === undefined) {
    throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.selfUpdate.error.noRelease')
  }
  return newest
}
