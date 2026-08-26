import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'
import { getBaseDir } from '../config/base-dir'
import { fileExists } from '../util/fs'
import { version } from '../config/version'
import { computeSkillContentHash, renderSkillFile } from './catalog'
import type { RitualSkill } from './types'

export type ResolveSkillsDirOptions = {
  /** Install into `~/.claude/skills` instead of a project's `.claude/skills`. */
  global?: boolean
  /** Project directory that should contain `.claude/skills` (defaults to the base dir). */
  dir?: string
}

/** Resolve the directory skill folders are written into. */
export function resolveSkillsDir(options: ResolveSkillsDirOptions): string {
  if (options.global) return path.join(os.homedir(), '.claude', 'skills')
  const base = options.dir ? path.resolve(options.dir) : getBaseDir()
  return path.join(base, '.claude', 'skills')
}

/**
 * Outcome of writing (or deciding not to write) one skill:
 *
 * - `written` — the rendered `SKILL.md` was (re)written.
 * - `up-to-date` — a machine-managed copy at the current Ritual version is
 *   already installed; nothing to do.
 * - `skipped` — a user-edited (or foreign) file occupies the path and `force`
 *   was not given, so it was left untouched.
 * - `absent` — the skill is not installed and the operation never installs new
 *   skills (`refreshInstalledSkills` / `skills update`).
 */
export type SkillInstallStatus = 'written' | 'up-to-date' | 'skipped' | 'absent'

export type SkillInstallResult = {
  name: string
  path: string
  status: SkillInstallStatus
}

export type SkillWriteOptions = {
  /** Overwrite a user-edited `SKILL.md` instead of skipping it. */
  force: boolean
}

/**
 * Classification of the file occupying an installed skill's path:
 *
 * - `missing` — no file at the path.
 * - `machine-managed` — Ritual wrote it and nobody edited it since: its stored
 *   `ritual-content-hash` marker matches a recompute over its own parsed
 *   name/description/body. Carries the `ritual-version` that wrote it.
 * - `user-edited` — anything else (missing or unparseable frontmatter, missing
 *   markers, or a hash mismatch); protected from overwrites without `force`.
 */
export type InstalledSkillState =
  | { kind: 'missing' }
  | { kind: 'user-edited' }
  | { kind: 'machine-managed'; version: string }

/**
 * Classify an installed `SKILL.md`'s content. Every failure mode (unparseable
 * frontmatter, missing/non-string keys, hash mismatch) means the file cannot be
 * proven machine-managed, so it classifies as `user-edited` and is protected.
 */
export function classifyInstalledSkill(content: string): InstalledSkillState {
  try {
    const parsed = matter(content)
    const { name, description } = parsed.data
    const installedVersion = parsed.data['ritual-version']
    const storedHash = parsed.data['ritual-content-hash']
    if (
      typeof name !== 'string' ||
      typeof description !== 'string' ||
      typeof installedVersion !== 'string' ||
      typeof storedHash !== 'string'
    ) {
      return { kind: 'user-edited' }
    }
    const recomputed = computeSkillContentHash({ name, description, body: parsed.content })
    if (recomputed !== storedHash) return { kind: 'user-edited' }
    return { kind: 'machine-managed', version: installedVersion }
  } catch {
    return { kind: 'user-edited' }
  }
}

/** Read and classify the file at an installed skill's path. */
async function inspectInstalledSkill(filePath: string): Promise<InstalledSkillState> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    return { kind: 'missing' }
  }
  return classifyInstalledSkill(content)
}

/**
 * Write one skill to `<skillsDir>/<name>/SKILL.md`.
 *
 * A missing file is written. An existing file is inspected first: a
 * machine-managed copy at the current Ritual version is `up-to-date`, a
 * machine-managed copy from another version is rewritten, and a user-edited
 * file is `skipped` so re-running the install never clobbers user edits
 * without consent. `force` overwrites unconditionally.
 */
export async function installSkill(
  skill: RitualSkill,
  skillsDir: string,
  options: SkillWriteOptions,
): Promise<SkillInstallResult> {
  const filePath = path.join(skillsDir, skill.name, 'SKILL.md')
  if (!options.force) {
    const installed = await inspectInstalledSkill(filePath)
    if (installed.kind === 'user-edited') {
      return { name: skill.name, path: filePath, status: 'skipped' }
    }
    if (installed.kind === 'machine-managed' && installed.version === version) {
      return { name: skill.name, path: filePath, status: 'up-to-date' }
    }
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, renderSkillFile(skill), 'utf-8')
  return { name: skill.name, path: filePath, status: 'written' }
}

/** Install several skills into `skillsDir`, preserving the given order. */
export async function installSkills(
  skills: readonly RitualSkill[],
  skillsDir: string,
  options: SkillWriteOptions,
): Promise<SkillInstallResult[]> {
  const results: SkillInstallResult[] = []
  for (const skill of skills) {
    results.push(await installSkill(skill, skillsDir, options))
  }
  return results
}

/**
 * Refresh only the skills already present in `skillsDir`, never installing new
 * ones (a missing skill reports `absent`). Present files follow the
 * {@link installSkill} rules: stale machine-managed copies are rewritten,
 * current ones are `up-to-date`, and user-edited files are `skipped` unless
 * `force` is set. Backs both `ritual skills update` and the `init-site`
 * upgrade path, so installed skills track the Ritual version without silently
 * introducing skills the user never installed or clobbering their edits.
 */
export async function refreshInstalledSkills(
  skills: readonly RitualSkill[],
  skillsDir: string,
  options: SkillWriteOptions,
): Promise<SkillInstallResult[]> {
  const results: SkillInstallResult[] = []
  for (const skill of skills) {
    const filePath = path.join(skillsDir, skill.name, 'SKILL.md')
    if (await fileExists(filePath)) {
      results.push(await installSkill(skill, skillsDir, options))
    } else {
      results.push({ name: skill.name, path: filePath, status: 'absent' })
    }
  }
  return results
}
