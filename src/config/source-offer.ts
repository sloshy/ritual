/**
 * The source offer every network surface makes (AGPL-3.0 §13): which version
 * of Ritual is running, under which license, and where the source for exactly
 * that version lives. The public site's footer reads it from `index.json`, the
 * admin from `GET /api/status`, and an MCP client from the server instructions.
 *
 * Dependency-free, so both SPAs can use the guard and the constants. The
 * running build's offer, `SOURCE_OFFER`, lives beside the version it is made
 * from, in `config/version.ts`.
 */

import { GITHUB_REPO_URL } from '../update/release-source'
import { isRecord } from '../util/json'

/** The license every Ritual build is under (SPDX). */
export const LICENSE_ID = 'AGPL-3.0-only'

/** The upstream repository, where an unconfigured build's source lives. */
export const UPSTREAM_SOURCE_URL = GITHUB_REPO_URL

/** What a running Ritual says about itself and its source. */
export type SourceOffer = {
  /** The running build's version, as `ritual --version` prints it. */
  version: string
  /** SPDX license identifier. */
  license: string
  /** The repository holding this build's source. */
  sourceUrl: string
  /**
   * The source of exactly this version: the release tag's tree, the commit's
   * tree for a development build, or {@link sourceUrl} when the version names
   * neither.
   */
  revisionUrl: string
}

/** A git commit as `git describe` abbreviates it. */
const COMMIT = /^[0-9a-f]{7,40}$/

/**
 * The git ref a version was built from: `v<version>` for a release
 * (`1.2.3`, `1.2.3-rc1`), the commit for a development build
 * (`1.2.3-dev.abc1234`, `0.0.0-dev.abc1234`), or null when the version names
 * neither (`0.0.0-unknown`, a non-hash fallback). Reads what
 * `normalizeVersion` produces, and relies on release tags carrying a `v`
 * (which the release gate, `scripts/release-tag.ts`, requires).
 */
export function revisionRef(buildVersion: string): string | null {
  const dev = buildVersion.lastIndexOf('-dev.')
  if (dev !== -1) {
    const commit = buildVersion.slice(dev + '-dev.'.length)
    return COMMIT.test(commit) ? commit : null
  }
  if (buildVersion.startsWith('0.0.0-')) return null
  return `v${buildVersion}`
}

/** {@link SourceOffer} for `buildVersion`, with its source at `sourceUrl`. */
export function sourceOfferFor(buildVersion: string, sourceUrl: string): SourceOffer {
  const base = sourceUrl.replace(/\/+$/, '')
  const ref = revisionRef(buildVersion)
  return {
    version: buildVersion,
    license: LICENSE_ID,
    sourceUrl: base,
    revisionUrl: ref === null ? base : `${base}/tree/${ref}`,
  }
}

/**
 * Where bugs in a build whose source lives at `sourceUrl` are reported: the
 * repository's issue tracker. A fork built with `RITUAL_SOURCE_URL` points its
 * users at its own tracker, not upstream's.
 */
export function issuesUrlFor(sourceUrl: string): string {
  return `${sourceUrl.replace(/\/+$/, '')}/issues`
}

/** Every field of {@link SourceOffer}; the `satisfies` makes a new field a compile error here. */
const SOURCE_OFFER_FIELDS = Object.keys({
  version: true,
  license: true,
  sourceUrl: true,
  revisionUrl: true,
} as const satisfies Record<keyof SourceOffer, true>)

/** Whether a value off the wire (`index.json`, `GET /api/status`) is a {@link SourceOffer}. */
export function isSourceOffer(value: unknown): value is SourceOffer {
  return isRecord(value) && SOURCE_OFFER_FIELDS.every((field) => typeof value[field] === 'string')
}
