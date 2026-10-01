import { afterEach, describe, expect, test } from 'bun:test'
import {
  newestRelease,
  parseRelease,
  parseReleaseList,
  parseReleaseTag,
  resolveChannel,
  type ChannelFlags,
  type Release,
} from '../../../src/update/release'
import type { UpdateChannel } from '../../../src/config/semver'
import { planUpdate } from '../../../src/update/self-update'
import { ExitCode } from '../../../src/util/errors'
import { FAKE_API, fakeEnv, fakeRelease, serveReleases } from '../../helpers/fake-release'
import { commandFailure, failureIdentity } from '../../helpers/rejection'
import { stubFetch, type StubbedFetch } from '../../helpers/stub-fetch'

describe('resolveChannel', () => {
  test.each<[string, string, ChannelFlags, UpdateChannel]>([
    ['a stable build', '1.2.0', {}, 'stable'],
    ['a prerelease build', '1.2.0-beta3', {}, 'prerelease'],
    ['--prerelease on a stable build', '1.2.0', { prerelease: true }, 'prerelease'],
    ['--stable on a prerelease build', '1.2.0-beta3', { stable: true }, 'stable'],
  ])('%s tracks the right channel', (_label, version, flags, channel) => {
    expect(resolveChannel(version, flags)).toBe(channel)
  })
})

describe('parseReleaseTag', () => {
  test.each([
    ['v1.2.0', 'v1.2.0'],
    ['1.2.0', 'v1.2.0'],
    [' 1.2.0-beta4 ', 'v1.2.0-beta4'],
  ])('%s → %s', (input, tag) => {
    expect(parseReleaseTag(input)).toBe(tag)
  })

  test.each([
    ['latest', "'latest' is not a release version"],
    ['v1.2', "'v1.2' is not a release version"],
    ['1.2.0-rc_1', "'1.2.0-rc_1' is not a release version"],
  ])('%p is not a release tag', (input, error) => {
    expect(parseReleaseTag(input)).toEqual({ error })
  })
})

describe('parseRelease', () => {
  test('reads a well-formed release', () => {
    const asset = { name: 'ritual-linux-x86_64', browser_download_url: 'https://x.test/a', size: 7 }
    expect(
      parseRelease({ tag_name: 'v1.2.0-beta1', draft: false, prerelease: true, assets: [asset] }),
    ).toEqual({
      tag: 'v1.2.0-beta1',
      version: '1.2.0-beta1',
      draft: false,
      prerelease: true,
      assets: [{ name: 'ritual-linux-x86_64', url: 'https://x.test/a', size: 7 }],
    })
  })

  const valid = (): Record<string, unknown> => fakeRelease('v1.0.0').json
  const withAsset = (asset: unknown): Record<string, unknown> => ({ ...valid(), assets: [asset] })

  test.each<[string, unknown, string]>([
    ['not an object', [], 'the release is not an object'],
    ['a missing tag', { ...valid(), tag_name: undefined }, 'tag_name is missing'],
    [
      'a tag that is not a version',
      { ...valid(), tag_name: 'nightly' },
      "tag_name 'nightly' is not a release version",
    ],
    [
      'a tag Ritual would not read as a release',
      { ...valid(), tag_name: 'v1.2.3-rc+b' },
      "tag_name 'v1.2.3-rc+b' is not a release version",
    ],
    ['a non-boolean draft flag', { ...valid(), draft: 'no' }, 'draft is not a boolean'],
    ['a non-boolean prerelease flag', { ...valid(), prerelease: 1 }, 'prerelease is not a boolean'],
    ['missing assets', { ...valid(), assets: null }, 'assets is not a list'],
    ['an asset that is not an object', withAsset('x'), 'assets[0] is not an object'],
    [
      'an asset without a name',
      withAsset({ browser_download_url: 'https://x.test/x', size: 1 }),
      'assets[0].name is missing',
    ],
    [
      'an asset without a URL',
      withAsset({ name: 'x', browser_download_url: 'nope', size: 1 }),
      'assets[0].browser_download_url is not an https URL',
    ],
    [
      'an asset served over plain http',
      withAsset({ name: 'x', browser_download_url: 'http://x.test/x', size: 1 }),
      'assets[0].browser_download_url is not an https URL',
    ],
    [
      'an asset with a negative size',
      withAsset({ name: 'x', browser_download_url: 'https://x.test/x', size: -1 }),
      'assets[0].size is not a byte count',
    ],
  ])('rejects %s', (_label, json, error) => {
    expect(parseRelease(json)).toEqual({ error })
  })
})

describe('parseReleaseList', () => {
  const tags = (list: Release[] | { error: string }): string[] | { error: string } =>
    Array.isArray(list) ? list.map((release) => release.tag) : list

  test('skips drafts before validating them', () => {
    const list = parseReleaseList([
      { tag_name: 'untagged-123', draft: true },
      fakeRelease('v1.1.0').json,
    ])
    expect(tags(list)).toEqual(['v1.1.0'])
  })

  test('skips an entry that does not parse when others do', () => {
    const list = parseReleaseList([
      { ...fakeRelease('v9.0.0').json, tag_name: 'nightly' },
      fakeRelease('v1.1.0').json,
    ])
    expect(tags(list)).toEqual(['v1.1.0'])
  })

  test('fails, naming the first bad entry, when nothing parses', () => {
    expect(parseReleaseList([{ tag_name: 'v2.0.0' }])).toEqual({
      error: 'release 0: draft is not a boolean',
    })
  })

  test('rejects a document that is not a list', () => {
    expect(parseReleaseList({ message: 'Not Found' })).toEqual({
      error: 'the release list is not a list',
    })
  })
})

describe('newestRelease', () => {
  const release = (tag: string, draft = false): Release => ({
    ...(parseRelease(fakeRelease(tag).json) as Release),
    draft,
  })

  test.each<[string, string[], string]>([
    ['numeric prerelease parts', ['v1.0.0-beta9', 'v1.0.0-beta10'], '1.0.0-beta10'],
    ['rc after beta', ['v1.0.0-rc1', 'v1.0.0-beta2'], '1.0.0-rc1'],
    ['a release over its prereleases', ['v1.0.0-rc1', 'v1.0.0', 'v1.0.0-beta2'], '1.0.0'],
    ['a newer prerelease over an older release', ['v1.0.0', 'v1.1.0-beta1'], '1.1.0-beta1'],
  ])('orders %s by version, not list position', (_label, list, newest) => {
    expect(newestRelease(list.map((tag) => release(tag)))?.version).toBe(newest)
  })

  test('never picks a draft', () => {
    expect(newestRelease([release('v1.0.0'), release('v2.0.0', true)])?.version).toBe('1.0.0')
  })

  test('is undefined for no releases', () => {
    expect(newestRelease([])).toBeUndefined()
  })
})

describe('planUpdate', () => {
  let server: StubbedFetch | undefined
  afterEach(() => {
    server?.restore()
    server = undefined
  })

  const { env } = fakeEnv('/unused/ritual')
  const urls = (): string[] => server?.sent.map((request) => request.url) ?? []

  test('the stable channel reads releases/latest', async () => {
    server = serveReleases({ latest: fakeRelease('v1.1.0') })
    const plan = await planUpdate(env, {})
    expect({ current: plan.current, tag: plan.release.tag, change: plan.change }).toEqual({
      current: '1.0.0',
      tag: 'v1.1.0',
      change: 'upgrade',
    })
    expect(urls()).toEqual([`${FAKE_API}/releases/latest`])
  })

  test('the stable channel refuses a prerelease GitHub calls latest', async () => {
    server = serveReleases({ latest: fakeRelease('v1.1.0-beta1', { prerelease: true }) })
    expect(await failureIdentity(planUpdate(env, {}))).toEqual({
      key: 'cli.selfUpdate.error.noStableRelease',
      exitCode: ExitCode.NotFound,
    })
  })

  describe('with GITHUB_TOKEN', () => {
    const withToken = fakeEnv('/unused/ritual', { githubToken: 'secret' }).env
    const redirectTo = (location: string): Response =>
      new Response(null, { status: 301, headers: { location } })

    test('follows a same-origin redirect, still authenticated', async () => {
      server = serveReleases({ list: [fakeRelease('v1.1.0')] })
      const layered = stubFetch(
        { [`${FAKE_API}/releases/latest`]: () => redirectTo(`${FAKE_API}/releases/tags/v1.1.0`) },
        { passthrough: true },
      )
      try {
        expect((await planUpdate(withToken, {})).release.tag).toBe('v1.1.0')
      } finally {
        layered.restore()
      }
      const followed = server.sent.map((sent) => [
        sent.url,
        new Headers(sent.init?.headers).get('Authorization'),
      ])
      expect(followed).toEqual([[`${FAKE_API}/releases/tags/v1.1.0`, 'Bearer secret']])
    })

    test('refuses a redirect to another origin rather than send the token there', async () => {
      server = stubFetch({
        [`${FAKE_API}/releases/latest`]: () => redirectTo('https://elsewhere.test/latest'),
      })
      expect(await failureIdentity(planUpdate(withToken, {}))).toEqual({
        key: 'cli.selfUpdate.error.redirectRefused',
        exitCode: ExitCode.RuntimeError,
      })
      expect(server.sent.map((sent) => sent.url)).toEqual([`${FAKE_API}/releases/latest`])
    })
  })

  test('the same release is no change', async () => {
    server = serveReleases({ latest: fakeRelease('v1.0.0') })
    expect((await planUpdate(env, {})).change).toBe('none')
  })

  test('an older release on the channel is no change, not a downgrade', async () => {
    server = serveReleases({ latest: fakeRelease('v0.9.0') })
    expect((await planUpdate(env, {})).change).toBe('none')
  })

  test('a prerelease build reads the release list without being asked', async () => {
    server = serveReleases({ list: [fakeRelease('v1.0.0-beta3', { prerelease: true })] })
    const beta = fakeEnv('/unused/ritual', { build: { version: '1.0.0-beta2', release: true } })
    expect((await planUpdate(beta.env, {})).release.tag).toBe('v1.0.0-beta3')
    expect(urls()).toEqual([`${FAKE_API}/releases?per_page=30`])
  })

  test('the prerelease channel picks the newest non-draft release', async () => {
    server = serveReleases({
      list: [
        fakeRelease('v1.1.0-beta1', { prerelease: true }),
        fakeRelease('v1.2.0-beta1', { prerelease: true, draft: true }),
        fakeRelease('v1.1.0-beta2', { prerelease: true }),
      ],
    })
    expect((await planUpdate(env, { prerelease: true })).release.tag).toBe('v1.1.0-beta2')
  })

  test('an exact older tag is a downgrade', async () => {
    server = serveReleases({ list: [fakeRelease('v0.9.0')] })
    expect((await planUpdate(env, { tag: 'v0.9.0' })).change).toBe('downgrade')
  })

  test('sends GITHUB_TOKEN to the API, and only when one is set', async () => {
    server = serveReleases({ latest: fakeRelease('v1.1.0') })
    await planUpdate(fakeEnv('/unused/ritual', { githubToken: 'secret' }).env, {})
    await planUpdate(env, {})
    const auth = server.sent.map((sent) => new Headers(sent.init?.headers).get('Authorization'))
    expect(auth).toEqual(['Bearer secret', null])
  })

  test.each<[string, () => StubbedFetch, ChannelFlags & { tag?: string }, string, number]>([
    [
      'no stable release yet',
      () => serveReleases({ list: [fakeRelease('v1.1.0-beta1', { prerelease: true })] }),
      {},
      'cli.selfUpdate.error.noStableRelease',
      ExitCode.NotFound,
    ],
    [
      'no release at all on the prerelease channel',
      () => serveReleases({ list: [] }),
      { prerelease: true },
      'cli.selfUpdate.error.noRelease',
      ExitCode.NotFound,
    ],
    [
      'an unknown tag',
      () => serveReleases({}),
      { tag: 'v9.9.9' },
      'cli.selfUpdate.error.tagNotFound',
      ExitCode.NotFound,
    ],
    [
      'a 429',
      () => stubFetch({ [FAKE_API]: () => new Response('', { status: 429 }) }),
      {},
      'cli.selfUpdate.error.rateLimited',
      ExitCode.RuntimeError,
    ],
    [
      'a 403 with the rate limit used up',
      () =>
        stubFetch({
          [FAKE_API]: () =>
            new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
        }),
      {},
      'cli.selfUpdate.error.rateLimited',
      ExitCode.RuntimeError,
    ],
    [
      'any other 403',
      () => stubFetch({ [FAKE_API]: () => new Response('', { status: 403 }) }),
      {},
      'cli.selfUpdate.error.http',
      ExitCode.RuntimeError,
    ],
    [
      'a server error',
      () => stubFetch({ [FAKE_API]: () => new Response('', { status: 500 }) }),
      {},
      'cli.selfUpdate.error.http',
      ExitCode.RuntimeError,
    ],
    [
      'a network failure',
      () =>
        stubFetch({
          [FAKE_API]: () => {
            throw new TypeError('connection refused')
          },
        }),
      {},
      'cli.selfUpdate.error.network',
      ExitCode.RuntimeError,
    ],
  ])('%s fails with the right error', async (_label, serve, request, key, exitCode) => {
    server = serve()
    expect(await failureIdentity(planUpdate(env, request))).toEqual({ key, exitCode })
  })

  test('a malformed release is a bad response, not a crash', async () => {
    server = serveReleases({ latest: { json: { tag_name: 'v1.1.0' }, routes: {} } })
    const error = await commandFailure(planUpdate(env, {}))
    expect(error.messageKey).toBe('cli.selfUpdate.error.badResponse')
    expect(error.message).toContain('draft is not a boolean')
  })
})
