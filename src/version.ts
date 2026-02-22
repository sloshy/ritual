import { execSync } from 'node:child_process'

// GIT_VERSION is injected at compile time via --define in scripts/build.sh.
// In development (bun run), it falls back to running git describe at runtime.
declare const GIT_VERSION: string | undefined

function normalizeVersion(ref: string): string {
  // Exact tag: "v1.2.3" or "1.2.3" -> "1.2.3"
  if (/^v?\d+\.\d+\.\d+$/.test(ref)) {
    return ref.replace(/^v/, '')
  }
  // Tag + commits ahead: "v1.2.3-5-gabcdef" -> "1.2.3-dev.abcdef"
  const tagMatch = ref.match(/^v?(\d+\.\d+\.\d+)-\d+-g([0-9a-f]+)$/)
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
