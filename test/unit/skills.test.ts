import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import path from 'node:path'
import matter from 'gray-matter'
import {
  SKILLS,
  computeSkillContentHash,
  renderSkillFile,
  selectSkills,
  validateSkill,
} from '../../src/skills/catalog'
import { classifyInstalledSkill } from '../../src/skills/install'
import { MCP_TOOL_NAMES, RETIRED_MCP_TOOL_NAMES } from '../../src/mcp/tools/names'
import type { RitualSkill } from '../../src/skills/types'
import { version } from '../../src/config/version'
import { SECTION_ROLES } from '../../src/list/deck-format'

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

  /**
   * Import behavior an agent cannot discover by trial and error: what the text
   * importer silently would or would not read. Each phrase is one behavior the
   * CLI actually has, so a change to the parser that leaves this prose behind
   * fails here rather than misleading an agent. Several skills compose
   * `shared.ts` fragments, so a pin must name text unique to the module it
   * is meant to guard.
   */
  test.each([
    ['ritual-decks', 'MTG Arena/MTGO export dialect'],
    ['ritual-decks', '*F*'],
    ['ritual-decks', 'no collector number'],
    ['ritual-decks', 'advisories'],
    ['ritual-decks', '--moxfield-user-agent'],
    ['ritual-collections', 'expands it to four lines'],
    ['ritual-collections', 'Read 4 copies'],
    ['ritual', 'Every other name is a main-deck section'],
    ['ritual', 'expanded to four lines on save'],
    ['ritual', 'planned, not implemented'],
    ['ritual', 'Fenced code blocks are prose'],
    // The UI-locale surface. An agent that cannot tell `uiLocale` from
    // `defaultLanguage` will reach for the expensive one (a non-`en`
    // `defaultLanguage` switches the cache to the multi-GB all-cards bulk), so
    // each spelling of the interface setting is named where it is used.
    ['ritual', '--locale <tag>'],
    ['ritual', 'RITUAL_LOCALE'],
    ['ritual', 'uiLocale'],
    ['ritual', 'ritual locale'],
    ['ritual-site', '--locale <tag>'],
    ['ritual-site', '--locales <tags...>'],
    ['ritual-site', '--locale-file <path...>'],
    // The other half of the contract: what the locale never moves.
    ['ritual-site', 'English by contract'],
    // Sell mode's admin control, and the one thing about it an agent will
    // otherwise guess wrong: unticking *removes* `site.sellMode` rather than
    // storing `false`, so `config get site.sellMode` exits 3 afterwards.
    ['ritual-site', 'Offer sell mode'],
    ['ritual-site', 'unticking removes it rather than storing'],
    // The other half of that: `--sell-mode` writes nothing, so the *running*
    // server's `get_config` is the only place an agent can see it in force.
    ['ritual-site', 'overrides: {"site.sellMode": true}'],
    // Custom art: an agent cannot discover the sidecar or the directory it
    // resolves against by trial, and guessing wrong means writing a reference
    // to a file nothing serves.
    ['ritual', '.art.json'],
    ['ritual', 'artDir'],
    ['ritual-edit', '--art <path|url|none>'],
    // The proxy label's two non-obvious halves: decks take it and nothing else,
    // and a proxy carries no price rather than an unknown one.
    ['ritual-decks', 'labels: [proxy]'],
    ['ritual-decks', 'prices as **0**'],
    ['ritual-collections', 'prices as **0**'],
  ])('the %s skill documents %p', (skillName, phrase) => {
    const skill = SKILLS.find((s) => s.name === skillName)
    expect(skill).toBeDefined()
    expect(skill!.body).toContain(phrase)
  })

  // The section-alias table is a closed set the overview reproduces by name,
  // so an alias added or renamed in `SECTION_ROLES` must reach the skill too.
  test('the overview skill names every SECTION_ROLES alias', () => {
    const body = SKILLS.find((s) => s.name === 'ritual')!
      .body.toLowerCase()
      .replace(/\s+/g, ' ')
    const aliases = Object.values(SECTION_ROLES).flat()
    expect(aliases.length).toBeGreaterThan(0)
    expect(aliases.filter((alias) => !body.includes(alias))).toEqual([])
  })
})

/**
 * Tokens that look like a tool name but are not one. Adding to this set is a
 * deliberate act — the guard below exists precisely because a stale or
 * misspelled tool name in a skill body is invisible until an agent tries it.
 */
// `runtime_error` is an `ErrorCode` in the CLI's stderr envelope, not a tool.
const ALLOWED_NON_TOOL_TOKENS = new Set<string>(['runtime_error'])

/** `snake_case` identifiers, the shape every MCP tool name has. */
const TOOL_NAME_SHAPED = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g

describe('skill bodies name only tools that exist', () => {
  // Skills teach the CLI, so tool names barely appear in them — which is exactly
  // why a rename would go unnoticed. Bare mentions count: only one of the
  // handful that exist is backticked.
  // The description is what a client shows in its skill picker, so a stale name
  // there is *more* visible than one in the body — both are scanned.
  function skillText(skill: RitualSkill): string {
    return `${skill.description}\n${skill.body}`
  }

  /**
   * CLI commands that no longer exist. The skills teach the CLI, so a
   * resurfaced name here is worse than a stale tool name: an agent would run
   * it. Add a name whenever a command is removed or renamed.
   */
  const RETIRED_CLI_COMMANDS = [
    'git-detect-changes',
    // `hash` alone is an ordinary word in these bodies, so match the invocation.
    'ritual hash',
    'price-deck',
    'price-collection',
    'price-wanted-list',
  ]

  test('no skill mentions a retired CLI command', () => {
    for (const skill of SKILLS) {
      for (const retired of RETIRED_CLI_COMMANDS) {
        const found = new RegExp(`\\b${retired}\\b`).test(skillText(skill))
        expect({ skill: skill.name, retired, found }) //
          .toEqual({ skill: skill.name, retired, found: false })
      }
    }
  })

  test('no skill mentions a retired tool name', () => {
    for (const skill of SKILLS) {
      for (const retired of RETIRED_MCP_TOOL_NAMES) {
        const found = new RegExp(`\\b${retired}\\b`).test(skillText(skill))
        expect({ skill: skill.name, retired, found }) //
          .toEqual({ skill: skill.name, retired, found: false })
      }
    }
  })

  test('every tool-name-shaped token in a skill is a registered tool', () => {
    const registered = new Set<string>(MCP_TOOL_NAMES)
    const seen: string[] = []
    for (const skill of SKILLS) {
      for (const [token] of skillText(skill).matchAll(TOOL_NAME_SHAPED)) {
        seen.push(token)
        const known = registered.has(token) || ALLOWED_NON_TOOL_TOKENS.has(token)
        expect({
          skill: skill.name,
          token,
          known,
          hint: 'Not a registered MCP tool. Fix the mention, or add it to ALLOWED_NON_TOOL_TOKENS on purpose.',
        }).toEqual({
          skill: skill.name,
          token,
          known: true,
          hint: 'Not a registered MCP tool. Fix the mention, or add it to ALLOWED_NON_TOOL_TOKENS on purpose.',
        })
      }
    }
    // Vacuity guard: a regex that stopped matching, or skill bodies that stopped
    // naming tools, would leave the loop above asserting nothing at all.
    expect(seen.length).toBeGreaterThan(0)
  })
})

describe('skill content is English by contract', () => {
  /**
   * Skill bodies are model-facing prose (plan §11), and their content hash is
   * what `classifyInstalledSkill` uses to tell a machine-managed install from a
   * user-edited one at one fixed path — a body that changed with the reader's
   * UI locale would make every installed skill look edited the moment the
   * language changed. The fence is an import boundary, checked textually the
   * way `test/unit/i18n-conventions.test.ts` checks the persistence fence: no
   * content module may reach the message catalog at all.
   *
   * `catalog.ts` is deliberately *not* fenced — its "Unknown skill" refusal is
   * ordinary CLI prose and does come from the catalog. Only the content is
   * frozen.
   */
  test('no skill content module imports src/i18n', async () => {
    const root = path.resolve(import.meta.dir, '../..')
    const files = [...new Glob('src/skills/content/*.ts').scanSync(root)].sort()
    // Vacuity guard: a moved directory would otherwise scan nothing.
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = await Bun.file(path.join(root, file)).text()
      if (/from\s+['"][^'"]*\bi18n\b/.test(source)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  // A companion "no skill body carries pseudo-locale text" case used to sit here.
  // It was unfalsifiable: `SKILLS` is built at import time under the default `en`
  // locale, and the case never activated `en-XA`, so a body that *had* gone
  // through `t()` would still have rendered as plain ASCII. Activating the
  // pseudo-locale before `src/skills/catalog.ts` is first imported is not
  // practical under module caching, and the end-to-end property is covered by
  // `test/integration/skills-install.test.ts`.
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
