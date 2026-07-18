import { describe, expect, test } from 'bun:test'
import matter from 'gray-matter'
import {
  SKILLS,
  computeSkillContentHash,
  renderSkillFile,
  selectSkills,
  validateSkill,
} from '../../src/skills/catalog'
import { classifyInstalledSkill } from '../../src/skills/install'
import type { RitualSkill } from '../../src/skills/types'
import { version } from '../../src/version'

describe('skill catalog invariants', () => {
  test('every skill is structurally valid and renders without throwing', () => {
    for (const skill of SKILLS) {
      expect(validateSkill(skill)).toBeNull()
      expect(() => renderSkillFile(skill)).not.toThrow()
    }
  })

  test('skill names are unique', () => {
    const names = SKILLS.map((skill) => skill.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test('the overview skill is named "ritual" and comes first', () => {
    expect(SKILLS[0]?.name).toBe('ritual')
  })

  test('every skill body starts with a top-level heading', () => {
    for (const skill of SKILLS) {
      expect(skill.body.trim().startsWith('# ')).toBe(true)
    }
  })
})

describe('validateSkill', () => {
  const base: RitualSkill = {
    name: 'ritual-x',
    description: 'A valid one-line description',
    body: '# X',
  }

  test('rejects an uppercase name', () => {
    expect(validateSkill({ ...base, name: 'Ritual-X' })).toContain('invalid skill name')
  })

  test('rejects an empty name', () => {
    expect(validateSkill({ ...base, name: '' })).toContain('invalid skill name')
  })

  test('rejects a whitespace-only description', () => {
    expect(validateSkill({ ...base, description: '   ' })).toContain('empty description')
  })

  test('rejects a multi-line description', () => {
    expect(validateSkill({ ...base, description: 'line one\nline two' })).toContain('single line')
  })

  test('allows a description containing a colon (e.g. "Magic: The Gathering")', () => {
    expect(validateSkill({ ...base, description: 'Manage Magic: The Gathering decks' })).toBeNull()
  })

  test('rejects names YAML 1.1 parses as booleans or null instead of strings', () => {
    // The name is rendered as an unquoted plain scalar, so one of these would
    // parse back as false/null and break machine-managed detection forever.
    for (const name of ['y', 'yes', 'n', 'no', 'true', 'false', 'on', 'off', 'null']) {
      expect(validateSkill({ ...base, name })).toContain('invalid skill name')
    }
  })

  test('allows a name that merely contains a YAML-reserved word', () => {
    expect(validateSkill({ ...base, name: 'no-frills' })).toBeNull()
  })

  test('rejects an empty body', () => {
    expect(validateSkill({ ...base, body: '   ' })).toContain('empty body')
  })
})

describe('renderSkillFile', () => {
  test('produces frontmatter that parses back to the same name and description', () => {
    for (const skill of SKILLS) {
      const parsed = matter(renderSkillFile(skill))
      expect(parsed.data.name).toBe(skill.name)
      expect(parsed.data.description).toBe(skill.description.trim())
      expect(parsed.content.trim()).toBe(skill.body.trim())
    }
  })

  test('ends with a single trailing newline', () => {
    const rendered = renderSkillFile(SKILLS[0]!)
    expect(rendered.endsWith('\n')).toBe(true)
    expect(rendered.endsWith('\n\n')).toBe(false)
  })

  test('throws on an invalid skill', () => {
    expect(() =>
      renderSkillFile({ name: 'bad', description: 'line one\nline two', body: '# B' }),
    ).toThrow(/Cannot render skill/)
  })

  test('round-trips a description that contains a colon', () => {
    const rendered = renderSkillFile({
      name: 'ritual-x',
      description: 'Manage Magic: The Gathering decks',
      body: '# X',
    })
    expect(matter(rendered).data.description).toBe('Manage Magic: The Gathering decks')
  })

  test('emits the ritual-version and ritual-content-hash markers for every skill', () => {
    for (const skill of SKILLS) {
      const parsed = matter(renderSkillFile(skill))
      expect(parsed.data['ritual-version']).toBe(version)
      expect(parsed.data['ritual-content-hash']).toBe(computeSkillContentHash(skill))
      expect(parsed.data['ritual-content-hash']).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('computeSkillContentHash', () => {
  const skill: RitualSkill = {
    name: 'ritual-x',
    description: 'A valid one-line description',
    body: '# X\n\nSome body text.',
  }

  test('recomputes to the stored marker from a rendered file (markers excluded)', () => {
    // Parse the full render back and hash its name/description/body: the result
    // must equal the stored marker, proving the hash never covers the marker
    // lines (it could not equal a hash of content containing itself).
    const parsed = matter(renderSkillFile(skill))
    const recomputed = computeSkillContentHash({
      name: String(parsed.data.name),
      description: String(parsed.data.description),
      body: parsed.content,
    })
    expect(recomputed).toBe(String(parsed.data['ritual-content-hash']))
  })

  test('is stable for equal input and sensitive to each field', () => {
    const base = computeSkillContentHash(skill)
    expect(computeSkillContentHash({ ...skill })).toBe(base)
    expect(computeSkillContentHash({ ...skill, name: 'ritual-y' })).not.toBe(base)
    expect(computeSkillContentHash({ ...skill, description: 'Changed' })).not.toBe(base)
    expect(computeSkillContentHash({ ...skill, body: '# X\n\nEdited.' })).not.toBe(base)
  })
})

describe('classifyInstalledSkill', () => {
  const skill: RitualSkill = {
    name: 'ritual-x',
    description: 'A valid one-line description',
    body: '# X\n\nSome body text.',
  }

  test('a freshly rendered file is machine-managed at the current version', () => {
    expect(classifyInstalledSkill(renderSkillFile(skill))).toEqual({
      kind: 'machine-managed',
      version,
    })
  })

  test('a different ritual-version stays machine-managed (the hash excludes markers)', () => {
    const stale = renderSkillFile(skill).replace(
      `ritual-version: ${version}`,
      'ritual-version: 0.0.1-old',
    )
    expect(stale).not.toBe(renderSkillFile(skill))
    expect(classifyInstalledSkill(stale)).toEqual({
      kind: 'machine-managed',
      version: '0.0.1-old',
    })
  })

  test('an edited body classifies as user-edited', () => {
    const edited = renderSkillFile(skill).replace('Some body text.', 'My local notes.')
    expect(classifyInstalledSkill(edited)).toEqual({ kind: 'user-edited' })
  })

  test('an edited description classifies as user-edited', () => {
    const edited = renderSkillFile(skill).replace(
      'A valid one-line description',
      'A reworded description',
    )
    expect(classifyInstalledSkill(edited)).toEqual({ kind: 'user-edited' })
  })

  test('a file without the marker keys classifies as user-edited', () => {
    const withoutMarkers = `---\nname: ${skill.name}\ndescription: ${JSON.stringify(
      skill.description,
    )}\n---\n\n${skill.body}\n`
    expect(classifyInstalledSkill(withoutMarkers)).toEqual({ kind: 'user-edited' })
  })

  test('plain text without frontmatter classifies as user-edited', () => {
    expect(classifyInstalledSkill('just some notes')).toEqual({ kind: 'user-edited' })
  })

  test('broken frontmatter classifies as user-edited', () => {
    expect(classifyInstalledSkill('---\nname: "unterminated\n---\n\n# X\n')).toEqual({
      kind: 'user-edited',
    })
  })
})

describe('selectSkills', () => {
  test('returns every skill when no names are given', () => {
    const selected = selectSkills([])
    expect((selected as RitualSkill[]).map((s) => s.name)).toEqual(SKILLS.map((s) => s.name))
  })

  test('selects a subset by name, case-insensitively', () => {
    const selected = selectSkills(['RITUAL-DECKS', 'ritual-cards'])
    expect((selected as RitualSkill[]).map((s) => s.name)).toEqual(['ritual-decks', 'ritual-cards'])
  })

  test('preserves the requested order rather than catalog order', () => {
    const selected = selectSkills(['ritual-cards', 'ritual-decks'])
    expect((selected as RitualSkill[]).map((s) => s.name)).toEqual(['ritual-cards', 'ritual-decks'])
  })

  test('returns an error listing unknown names', () => {
    const result = selectSkills(['ritual-decks', 'ritual-bogus'])
    expect(typeof result).toBe('string')
    expect(result as string).toContain('ritual-bogus')
    expect(result as string).toContain('Available:')
  })
})
