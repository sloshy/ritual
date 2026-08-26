import type { RitualSkill } from './types'
import { computeHash } from '../changes/content-hash'
import { t } from '../i18n/t'
import { version } from '../config/version'
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
 * Names YAML 1.1 parses as booleans or null rather than strings. The skill
 * name is rendered as an unquoted plain scalar (`name: ritual-decks`), so one
 * of these would round-trip as `false`/`null` and break the machine-managed
 * marker check in `classifyInstalledSkill`. Only the lowercase forms matter:
 * {@link SKILL_NAME_PATTERN} already rejects every other capitalization.
 */
const YAML_RESERVED_NAMES = new Set(['y', 'yes', 'n', 'no', 'true', 'false', 'on', 'off', 'null'])

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
  if (YAML_RESERVED_NAMES.has(skill.name)) {
    return `invalid skill name "${skill.name}" (YAML parses it as a boolean or null, not a string)`
  }
  const description = skill.description.trim()
  if (description.length === 0) return `skill "${skill.name}" has an empty description`
  if (description.includes('\n')) return `skill "${skill.name}" description must be a single line`
  if (skill.body.trim().length === 0) return `skill "${skill.name}" has an empty body`
  return null
}

/** The core frontmatter entries derived from the skill itself (no markers). */
function skillFrontmatterLines(skill: RitualSkill): string[] {
  return [`name: ${skill.name}`, `description: ${JSON.stringify(skill.description.trim())}`]
}

/** Assemble a `SKILL.md` from frontmatter entry lines and a Markdown body. */
function renderWithFrontmatter(lines: readonly string[], body: string): string {
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`
}

/**
 * SHA-256 hex digest over the marker-independent render of a skill — the
 * name/description frontmatter plus body, WITHOUT the `ritual-version` and
 * `ritual-content-hash` marker lines, so the hash never covers itself or the
 * version. Recomputing this over an installed file's parsed name, description,
 * and body and comparing it to the stored `ritual-content-hash` marker is how
 * user edits are detected (see `classifyInstalledSkill` in `install.ts`).
 */
export function computeSkillContentHash(skill: RitualSkill): string {
  return computeHash(renderWithFrontmatter(skillFrontmatterLines(skill), skill.body))
}

/**
 * Render a skill to its full `SKILL.md` contents (frontmatter + body). The
 * description is JSON-stringified, which is a valid single-line double-quoted
 * YAML scalar, so colons (e.g. "Magic: The Gathering") are safe.
 *
 * Two machine-managed marker keys follow the description, both single-line
 * plain scalars (strict-YAML safe; Claude Code's loader only cares about
 * `name`/`description` and tolerates extra keys):
 *
 * - `ritual-version` — the Ritual version that wrote the file, so installs can
 *   tell stale copies from current ones.
 * - `ritual-content-hash` — {@link computeSkillContentHash} over the rest of
 *   the render, so installs can tell user-edited copies from machine-managed
 *   ones.
 */
export function renderSkillFile(skill: RitualSkill): string {
  const invalid = validateSkill(skill)
  if (invalid) throw new Error(`Cannot render skill: ${invalid}`)
  const markerLines = [
    `ritual-version: ${version}`,
    `ritual-content-hash: ${computeSkillContentHash(skill)}`,
  ]
  return renderWithFrontmatter([...skillFrontmatterLines(skill), ...markerLines], skill.body)
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
    // The skill *content* is English by contract (plan §11), but this refusal is
    // ordinary CLI prose, so it comes from the catalog. The names on both sides
    // are identifiers and stay verbatim.
    return t('errors.skills.unknown', {
      count: unknown.length,
      names: unknown.join(', '),
      available: SKILLS.map((skill) => skill.name).join(', '),
    })
  }
  return selected
}
