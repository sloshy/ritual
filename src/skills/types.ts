/**
 * A Claude Code "agent skill": a `SKILL.md` file (YAML frontmatter + Markdown body)
 * that teaches an AI agent how to drive Ritual's CLI from a local workspace.
 *
 * The frontmatter is generated from {@link RitualSkill.name} and
 * {@link RitualSkill.description}; the body is the Markdown that follows it.
 * See `src/skills/catalog.ts` for rendering and the install command in
 * `src/commands/skills.ts` for writing them to disk.
 */
export type RitualSkill = {
  /**
   * Skill identifier — used both as the frontmatter `name` and the directory
   * name (`.claude/skills/<name>/SKILL.md`). Lowercase, hyphen-separated.
   */
  name: string
  /**
   * Single-line frontmatter `description` agents use to decide when the skill is
   * relevant. Must be one line (no newlines): it is emitted as a double-quoted
   * YAML scalar, and a multi-line double-quoted scalar with column-0
   * continuation lines is silently dropped by Claude Code's strict YAML parser.
   */
  description: string
  /** Markdown body of the `SKILL.md` (everything after the frontmatter). */
  body: string
}
