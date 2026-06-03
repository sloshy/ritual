import type { RitualSkill } from './types'
import { overviewSkill } from './content/overview'
import { decksSkill } from './content/decks'
import { collectionsSkill } from './content/collections'
import { wantedSkill } from './content/wanted'
import { editSkill } from './content/edit'
import { cardsSkill } from './content/cards'
import { siteSkill } from './content/site'

/**
 * Every Ritual agent skill, in install order. The overview skill comes first
 * because the others reference it. Keep this in sync with the CLI and the MCP
 * server — see the "MCP Server and Skills" rule in `AGENTS.md`.
 */
export const SKILLS: readonly RitualSkill[] = [
  overviewSkill,
  decksSkill,
  collectionsSkill,
  wantedSkill,
  editSkill,
  cardsSkill,
  siteSkill,
]

/** A skill name is lowercase alphanumerics separated by single hyphens. */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Validate a skill's structural invariants. Returns an error string describing
 * the first violation, or `null` when the skill is well-formed. The `description`
 * must be a single line: it is emitted as a double-quoted YAML scalar, and a
 * multi-line double-quoted scalar whose continuation lines start at column 0 is
 * silently dropped by Claude Code's strict YAML parser.
 */
export function validateSkill(skill: RitualSkill): string | null {
  if (!SKILL_NAME_PATTERN.test(skill.name)) {
    return `invalid skill name "${skill.name}" (must be lowercase, hyphen-separated)`
  }
  const description = skill.description.trim()
  if (description.length === 0) return `skill "${skill.name}" has an empty description`
  if (description.includes('\n')) return `skill "${skill.name}" description must be a single line`
  if (skill.body.trim().length === 0) return `skill "${skill.name}" has an empty body`
  return null
}

/**
 * Render a skill to its full `SKILL.md` contents (frontmatter + body). The
 * description is JSON-stringified, which is a valid single-line double-quoted
 * YAML scalar, so colons (e.g. "Magic: The Gathering") are safe.
 */
export function renderSkillFile(skill: RitualSkill): string {
  const invalid = validateSkill(skill)
  if (invalid) throw new Error(`Cannot render skill: ${invalid}`)
  const frontmatter = `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description.trim())}\n---`
  return `${frontmatter}\n\n${skill.body.trim()}\n`
}

/**
 * Resolve a list of requested skill names to skills. An empty list selects every
 * skill. Matching is case-insensitive. Returns an error string (rather than
 * throwing) when any requested name is unknown — see the project's parser
 * convention in `AGENTS.md`.
 */
export function selectSkills(names: readonly string[]): RitualSkill[] | string {
  if (names.length === 0) return [...SKILLS]
  const byName = new Map(SKILLS.map((skill) => [skill.name.toLowerCase(), skill]))
  const selected: RitualSkill[] = []
  const unknown: string[] = []
  for (const name of names) {
    const skill = byName.get(name.toLowerCase())
    if (skill) selected.push(skill)
    else unknown.push(name)
  }
  if (unknown.length > 0) {
    const available = SKILLS.map((skill) => skill.name).join(', ')
    return `Unknown skill${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Available: ${available}`
  }
  return selected
}
