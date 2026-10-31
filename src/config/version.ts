import { execSync } from 'node:child_process'
import { issuesUrlFor, sourceOfferFor, UPSTREAM_SOURCE_URL, type SourceOffer } from './source-offer'

// GIT_VERSION is injected at compile time via --define in scripts/build.sh.
// In development (bun run), it falls back to running git describe at runtime.
declare const GIT_VERSION: string | undefined
// RITUAL_RELEASE is defined (as `true`) only by the release workflow's build —
// see scripts/build.sh (and the Dockerfile, which passes it through for the
// release image). Local, CI and self-built Docker builds leave it undefined.
declare const RITUAL_RELEASE: boolean | undefined
// A fork's repository, injected by scripts/build.sh from the environment and
// validated there as an http(s) URL. Undefined in an unconfigured build.
declare const RITUAL_SOURCE_URL: string | undefined

/**
 * Whether `ref` is an exact release tag (`v1.2.3`, `1.2.3-beta8`), the form
 * {@link normalizeVersion} maps to a release version by dropping the `v`.
 */
export function isReleaseTag(ref: string): boolean {
  return /^v?\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(ref)
}

export function normalizeVersion(ref: string): string {
  // Exact tag: "v1.2.3" or "v1.2.3-beta8" -> "1.2.3" or "1.2.3-beta8"
  if (isReleaseTag(ref)) {
    return ref.replace(/^v/, '')
  }
  // Tag + commits ahead: "v1.2.3-5-gabcdef" or "v1.2.3-beta8-5-gabcdef" -> "1.2.3-dev.abcdef" or "1.2.3-beta8-dev.abcdef"
  const tagMatch = ref.match(/^v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)-\d+-g([0-9a-f]+)$/)
  if (tagMatch) {
    return `${tagMatch[1]}-dev.${tagMatch[2]}`
  }
  // Bare hash or other fallback
  return `0.0.0-dev.${ref}`
}

function resolveVersion(): string {
  if (typeof GIT_VERSION !== 'undefined') {
    return normalizeVersion(GIT_VERSION)
  }
  // A from-source run may name its `git describe` ref instead of spawning git
  // for it. `test/preload.ts` sets this: every isolated test file re-evaluates
  // this module, and Bun 1.4.2's `spawnSync` can spin forever inside a
  // `bun test --parallel` worker (see the preload for the evidence).
  const devRef = process.env.RITUAL_DEV_VERSION_REF?.trim()
  if (devRef) {
    return normalizeVersion(devRef)
  }
  try {
    const ref = execSync('git describe --tags --always', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return normalizeVersion(ref)
  } catch {
    return '0.0.0-unknown'
  }
}

export const version = resolveVersion()

/**
 * Whether a build is a real release: built by the release workflow (which alone
 * defines `RITUAL_RELEASE`) and versioned exactly at a tag — neither commits
 * past one (`-dev.`) nor an untagged fallback (`0.0.0-…`). Only a release may
 * record itself as a workspace's `managed.version`, since that value is what
 * CI downloads.
 */
export function isReleaseVersion(releaseBuild: boolean, normalized: string): boolean {
  return releaseBuild && !normalized.includes('-dev.') && !normalized.startsWith('0.0.0-')
}

/** {@link isReleaseVersion} for the running build. */
export const isReleaseBuild = isReleaseVersion(
  typeof GIT_VERSION !== 'undefined' &&
    typeof RITUAL_RELEASE !== 'undefined' &&
    RITUAL_RELEASE === true,
  version,
)

/** The running build's source offer (see `config/source-offer.ts`), frozen: every response shares it. */
export const SOURCE_OFFER: Readonly<SourceOffer> = Object.freeze(
  sourceOfferFor(
    version,
    typeof RITUAL_SOURCE_URL !== 'undefined' && RITUAL_SOURCE_URL !== ''
      ? RITUAL_SOURCE_URL
      : UPSTREAM_SOURCE_URL,
  ),
)

/** The running build's issue tracker: where an unexpected error and `ritual doctor` send a reporter. */
export const ISSUES_URL: string = issuesUrlFor(SOURCE_OFFER.sourceUrl)
