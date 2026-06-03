import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getBaseDir } from '../base-dir'
import { fileExists } from '../utils'
import { renderSkillFile } from './catalog'
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

export type SkillInstallStatus = 'written' | 'skipped' | 'absent'

export type SkillInstallResult = {
  name: string
  path: string
  status: SkillInstallStatus
}

export type SkillWriteOptions = {
  /** Overwrite an existing `SKILL.md` instead of skipping it. */
  force: boolean
}

/**
 * Write one skill to `<skillsDir>/<name>/SKILL.md`. Existing files are left
 * untouched (status `skipped`) unless `force` is set, so re-running the install
 * never clobbers user edits without consent.
 */
export async function installSkill(
  skill: RitualSkill,
  skillsDir: string,
  options: SkillWriteOptions,
): Promise<SkillInstallResult> {
  const filePath = path.join(skillsDir, skill.name, 'SKILL.md')
  if (!options.force && (await fileExists(filePath))) {
    return { name: skill.name, path: filePath, status: 'skipped' }
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
 * Overwrite only the skills already present in `skillsDir`, leaving uninstalled
 * skills absent. A present `SKILL.md` is rewritten with the current rendered
 * content (status `written`); a missing one is left alone (status `absent`).
 * Used on upgrade so installed skills track the Ritual version without silently
 * introducing skills the user never installed.
 */
export async function refreshInstalledSkills(
  skills: readonly RitualSkill[],
  skillsDir: string,
): Promise<SkillInstallResult[]> {
  const results: SkillInstallResult[] = []
  for (const skill of skills) {
    const filePath = path.join(skillsDir, skill.name, 'SKILL.md')
    if (await fileExists(filePath)) {
      results.push(await installSkill(skill, skillsDir, { force: true }))
    } else {
      results.push({ name: skill.name, path: filePath, status: 'absent' })
    }
  }
  return results
}
