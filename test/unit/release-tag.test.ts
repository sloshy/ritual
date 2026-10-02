import { describe, expect, test } from 'bun:test'
import {
  changelogSection,
  parsePackageVersion,
  checkReleaseTag,
  releaseNotes,
} from '../../scripts/release-tag'

describe('checkReleaseTag', () => {
  test('a stable tag matching package.json', () => {
    expect(checkReleaseTag('v1.0.0', '1.0.0')).toEqual({ version: '1.0.0', prerelease: false })
  })

  test('a prerelease tag is flagged as one', () => {
    expect(checkReleaseTag('v1.1.0-rc1', '1.1.0-rc1')).toEqual({
      version: '1.1.0-rc1',
      prerelease: true,
    })
  })

  test.each([
    ['v1.0.0', '0.1.0'],
    ['v1.0.0-rc1', '1.0.0'],
    ['v1.0.0', '1.0.0-rc1'],
  ])('refuses %p when package.json says %p', (tag, packageVersion) => {
    expect(checkReleaseTag(tag, packageVersion)).toContain(`package.json says ${packageVersion}`)
  })

  // '1.0.0' is the one row that reaches the missing-`v` check.
  test.each(['1.0.0', 'v1.0', 'v1.0.0-5-gabc1234', 'nightly'])(
    'refuses %p as not a release tag',
    (tag) => {
      expect(checkReleaseTag(tag, '1.0.0')).toContain('is not a release tag')
    },
  )

  test.each(['v1.0.0-dev.abc', 'v0.0.0-rc1'])(
    'refuses %p, which a release binary would not pin',
    (tag) => {
      expect(checkReleaseTag(tag, tag.slice(1))).toContain('is a development version')
    },
  )
})

describe('changelogSection', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [1.1.0] - 2026-11-01',
    '',
    '### Added',
    '',
    '- Deck validation.',
    '',
    '## [1.0.0] - 2026-10-15',
    '',
    'The first stable release.',
    '',
    '[1.1.0]: https://github.com/sloshy/ritual/releases/tag/v1.1.0',
    '[1.0.0]: https://github.com/sloshy/ritual/releases/tag/v1.0.0',
    '',
  ].join('\n')

  test('the body up to the next section, without the heading', () => {
    expect(changelogSection(changelog, '1.1.0')).toBe('### Added\n\n- Deck validation.')
  })

  test('the last section drops the link references that close the file', () => {
    expect(changelogSection(changelog, '1.0.0')).toBe('The first stable release.')
  })

  test('a link reference inside a section stays in it', () => {
    const section =
      '## [1.0.0]\n\n- Fixed X ([#12])\n\n[#12]: https://example.com/12\n\n- Fixed Y\n'
    expect(changelogSection(section, '1.0.0')).toBe(
      '- Fixed X ([#12])\n\n[#12]: https://example.com/12\n\n- Fixed Y',
    )
  })

  test('the last line of a file without a trailing newline is kept', () => {
    expect(changelogSection('## [1.0.0]\n\nOnly line.', '1.0.0')).toBe('Only line.')
  })

  test('CRLF line endings come out as LF', () => {
    expect(changelogSection(changelog.replaceAll('\n', '\r\n'), '1.1.0')).toBe(
      '### Added\n\n- Deck validation.',
    )
  })

  test('null for a missing or empty section', () => {
    expect(changelogSection(changelog, '2.0.0')).toBeNull()
    // `Unreleased` stands in for an empty section; callers pass semver strings.
    expect(changelogSection(changelog, 'Unreleased')).toBeNull()
  })

  test('a prerelease section is found by its own version, and skipped for the stable one', () => {
    const both = '## [1.0.0-rc1] - 2026-10-01\n\nPre.\n\n## [1.0.0] - 2026-10-15\n\nStable.\n'
    expect(changelogSection(both, '1.0.0-rc1')).toBe('Pre.')
    expect(changelogSection(both, '1.0.0')).toBe('Stable.')
  })
})

describe('releaseNotes', () => {
  const changelog = '## [1.0.0]\n\nStable.\n\n## [1.1.0-rc1]\n\nPre.\n'
  const stable = (version: string) => ({ version, prerelease: false })
  const pre = (version: string) => ({ version, prerelease: true })

  test('a section is the notes, stable or not', () => {
    expect(releaseNotes(stable('1.0.0'), changelog)).toEqual({
      source: 'changelog',
      body: 'Stable.',
    })
    expect(releaseNotes(pre('1.1.0-rc1'), changelog)).toEqual({ source: 'changelog', body: 'Pre.' })
  })

  test('a prerelease without a section gets generated notes', () => {
    expect(releaseNotes(pre('1.1.0-rc2'), changelog)).toEqual({ source: 'generated' })
  })

  test('a stable release without a section is refused', () => {
    expect(releaseNotes(stable('1.1.0'), changelog)).toContain('a stable release needs one')
  })
})

describe('parsePackageVersion', () => {
  test('the version string', () => {
    expect(parsePackageVersion('{"name":"ritual","version":"1.0.0"}')).toBe('1.0.0')
  })

  test.each([
    ['{"name":"ritual"}', 'no string "version"'],
    ['{"version":1}', 'no string "version"'],
    ['not json', 'not valid JSON'],
  ])('an error for %p', (text, message) => {
    const result = parsePackageVersion(text)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain(message)
  })
})
