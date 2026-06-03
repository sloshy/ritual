import { describe, expect, test } from 'bun:test'
import matter from 'gray-matter'
import { SKILLS, renderSkillFile, selectSkills, validateSkill } from '../../src/skills/catalog'
import type { RitualSkill } from '../../src/skills/types'

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
