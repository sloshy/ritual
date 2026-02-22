/**
 * Syncs package.json version from the current git tag (or commit hash).
 * Run with: bun run version:sync
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

type PackageJson = { version: string; [key: string]: unknown }

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

const ref = execSync('git describe --tags --always', {
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
}).trim()

const version = normalizeVersion(ref)

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson
pkg.version = version
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')

console.log(`Version synced to ${version}`)
