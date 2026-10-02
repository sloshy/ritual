#!/usr/bin/env bun
/**
 * The release workflow's gate (`.github/workflows/release.yml`):
 *
 *   bun run scripts/release-tag.ts <tag> <notes-file>
 *
 * Refuses a tag that is not a release tag or that disagrees with
 * `package.json`'s version, and writes the release notes to `<notes-file>`: the
 * tag's section of CHANGELOG.md. A stable release must have one; a prerelease
 * without one gets GitHub's generated notes instead. The outcome goes to
 * `$GITHUB_OUTPUT` as `version`, `prerelease` and `notes` (`changelog` or
 * `generated`).
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { isPrereleaseVersion } from '../src/config/semver'
import { isReleaseTag, isReleaseVersion, normalizeVersion } from '../src/config/version'

/** A tag the release workflow may publish. */
export type ReleaseTag = {
  /** The version without the tag's `v`, as the binary reports it. */
  version: string
  /** A `-` suffix (`1.0.0-rc1`): published as a prerelease, never `latest`. */
  prerelease: boolean
}

/** The release `tag` names, or why it may not be published. */
export function checkReleaseTag(tag: string, packageVersion: string): ReleaseTag | string {
  if (!tag.startsWith('v') || !isReleaseTag(tag)) {
    return `'${tag}' is not a release tag (vX.Y.Z, or vX.Y.Z-<pre> for a prerelease)`
  }
  const version = normalizeVersion(tag)
  // What a release binary would refuse to record as a workspace's pin.
  if (!isReleaseVersion(true, version)) {
    return `'${tag}' is a development version (-dev. or 0.0.0-), which cannot be published as a release`
  }
  if (version !== packageVersion) {
    return `tag ${tag} is version ${version}, but package.json says ${packageVersion}: set package.json's version in the release commit`
  }
  return { version, prerelease: isPrereleaseVersion(version) }
}

/** A Keep a Changelog link reference, such as `[1.0.0]: https://…`. */
const LINK_REFERENCE = /^\[[^\]]+\]:\s/

/**
 * The body of CHANGELOG.md's `## [<version>]` section, without its heading or
 * the link references that close the file, or null when there is no such
 * section or it is empty. A link reference inside the section stays in it;
 * only the run of them at its end (the file's own footer, when the section is
 * the last one) is dropped.
 */
export function changelogSection(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`))
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  const section = end === -1 ? rest : rest.slice(0, end)
  let last = section.length
  while (last > 0) {
    const line = section[last - 1]!
    if (line.trim() !== '' && !LINK_REFERENCE.test(line)) break
    last--
  }
  const body = section.slice(0, last).join('\n').trim()
  return body.length > 0 ? body : null
}

/** Where a release's notes come from: its CHANGELOG.md section, or GitHub's generated notes. */
export type ReleaseNotes = { source: 'changelog'; body: string } | { source: 'generated' }

/**
 * The notes `release` is published with, or why it may not be published: a
 * stable release must have a CHANGELOG.md section, a prerelease without one
 * gets GitHub's generated notes.
 */
export function releaseNotes(release: ReleaseTag, changelog: string): ReleaseNotes | string {
  const body = changelogSection(changelog, release.version)
  if (body !== null) return { source: 'changelog', body }
  if (release.prerelease) return { source: 'generated' }
  return `CHANGELOG.md has no "## [${release.version}]" section; a stable release needs one`
}

/** package.json's `version`, or why it has none. */
export function parsePackageVersion(text: string): string | Error {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return new Error(`package.json is not valid JSON: ${String(error)}`)
  }
  if (typeof value === 'object' && value !== null && 'version' in value) {
    if (typeof value.version === 'string') return value.version
  }
  return new Error('package.json has no string "version"')
}

/** A file's text, or `''` when it does not exist. Any other failure throws. */
function readOptional(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

/** Fail the step with a workflow `::error::` annotation, escaped as the command syntax requires. */
function fail(message: string): never {
  const escaped = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  console.error(`::error::${escaped}`)
  process.exit(1)
}

function main(): void {
  const [tag, notesFile] = process.argv.slice(2)
  if (tag === undefined || notesFile === undefined) {
    fail('usage: bun run scripts/release-tag.ts <tag> <notes-file>')
  }
  const packageVersion = parsePackageVersion(readFileSync('package.json', 'utf8'))
  if (packageVersion instanceof Error) fail(packageVersion.message)
  const release = checkReleaseTag(tag, packageVersion)
  if (typeof release === 'string') fail(release)

  const notes = releaseNotes(release, readOptional('CHANGELOG.md'))
  if (typeof notes === 'string') fail(notes)
  writeFileSync(notesFile, notes.source === 'changelog' ? `${notes.body}\n` : '')

  const outputs = [
    `version=${release.version}`,
    `prerelease=${release.prerelease}`,
    `notes=${notes.source}`,
  ]
  console.log(outputs.join('\n'))
  const githubOutput = process.env.GITHUB_OUTPUT
  if (githubOutput) appendFileSync(githubOutput, `${outputs.join('\n')}\n`)
}

if (import.meta.main) main()
