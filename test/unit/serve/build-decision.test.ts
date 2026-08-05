import { describe, expect, test } from 'bun:test'
import { shouldBuildBeforeServing } from '../../../src/commands/serve'

/**
 * `serve` builds before serving in exactly two cases, and the asymmetry is the
 * point: `--api` serves live data, so it can supply its own app shell, while
 * plain `serve` must refuse rather than silently generate the content the user
 * meant to build. The refusal path itself is pinned in integration/serve.test.ts.
 */
describe('shouldBuildBeforeServing', () => {
  test('--build always builds, however built the directory already is', () => {
    expect(shouldBuildBeforeServing({ build: true }, true)).toBe(true)
    expect(shouldBuildBeforeServing({ build: true, api: true }, true)).toBe(true)
  })

  test('--api builds only what is missing', () => {
    expect(shouldBuildBeforeServing({ api: true }, false)).toBe(true)
    expect(shouldBuildBeforeServing({ api: true }, true)).toBe(false)
  })

  test('plain serve never builds', () => {
    expect(shouldBuildBeforeServing({}, false)).toBe(false)
    expect(shouldBuildBeforeServing({}, true)).toBe(false)
  })
})
