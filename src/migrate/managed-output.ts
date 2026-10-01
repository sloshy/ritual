/**
 * Managed output: everything Ritual generates into a workspace set up by
 * `init-site` — the deploy workflow, the `.gitignore` entries, and the
 * installed agent skills. It is a pure function of (build, config), so it is
 * never numbered: {@link computeManagedOutput} renders it in memory and hashes
 * it, and a hash that differs from `managed.output` means a refresh is due.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  getSiteDeployConfig,
  type InitSiteConfig,
  type RitualConfig,
} from '../config/ritual-config'
import { getBaseDir } from '../config/base-dir'
import { computeHash } from '../changes/content-hash'
import { computeSkillContentHash, SKILLS } from '../skills/catalog'
import {
  findInstalledRitualSkills,
  refreshInstalledSkills,
  removeInstalledSkill,
  resolveSkillsDir,
} from '../skills/install'
import type { RitualSkill } from '../skills/types'
import {
  generateGitignoreEntries,
  missingGitignoreLines,
  readWorkspaceGitignore,
  refreshGitignore,
  renderManagedFiles,
  writeWorkspaceFile,
  type GeneratedFile,
  type GitignoreRefreshResult,
} from './managed-files'

/** A catalog skill as it counts toward the output hash. */
type SkillDigest = { name: string; contentHash: string }

/** The managed output the running build generates for one config. */
export type ManagedOutput = {
  deploy: InitSiteConfig
  files: GeneratedFile[]
  /** The `.gitignore` block, one entry per line. */
  gitignoreEntries: string
  /** `sha256:`-prefixed hash of the files, the gitignore block and the skill catalog. */
  hash: string
}

/**
 * Render the managed output for `config`, or `null` when the workspace has no
 * deploy config (`init-site` never ran) and so nothing is managed. Skills
 * contribute their content hash, which leaves out the `ritual-version` stamp,
 * so a release that changes no skill text does not make a refresh due.
 */
export function computeManagedOutput(
  config: RitualConfig,
  skills: readonly RitualSkill[] = SKILLS,
): ManagedOutput | null {
  const deploy = getSiteDeployConfig(config.site)
  if (deploy === null) return null
  const files = renderManagedFiles(deploy)
  const gitignoreEntries = generateGitignoreEntries(deploy)
  const skillDigests = skills.map((skill): SkillDigest => ({
    name: skill.name,
    contentHash: computeSkillContentHash(skill),
  }))
  const hash = `sha256:${computeHash(JSON.stringify({ files, gitignoreEntries, skills: skillDigests }))}`
  return { deploy, files, gitignoreEntries, hash }
}

/** What a refresh will do, computed before anything is written. */
export type ManagedRefreshPlan = {
  output: ManagedOutput
  /** Generated files whose content differs from what is on disk. */
  filesToWrite: GeneratedFile[]
  /** `.gitignore` lines the refresh will append. */
  gitignoreMissing: string[]
  /** Installed catalog skills the refresh overwrites. */
  skillsToWrite: string[]
  /** Installed Ritual skills the catalog no longer ships. */
  skillsToRemove: string[]
}

/** Whether a refresh changes anything on disk (it may only need its hash recorded). */
export function refreshChangesFiles(plan: ManagedRefreshPlan): boolean {
  return (
    plan.filesToWrite.length > 0 ||
    plan.gitignoreMissing.length > 0 ||
    plan.skillsToWrite.length > 0 ||
    plan.skillsToRemove.length > 0
  )
}

async function differsOnDisk(file: GeneratedFile): Promise<boolean> {
  try {
    return (await fs.readFile(path.join(getBaseDir(), file.path), 'utf-8')) !== file.content
  } catch {
    return true
  }
}

/** Inspect the workspace and plan a refresh of `output`. */
export async function planManagedRefresh(
  output: ManagedOutput,
  skills: readonly RitualSkill[] = SKILLS,
): Promise<ManagedRefreshPlan> {
  const filesToWrite: GeneratedFile[] = []
  for (const file of output.files) {
    if (await differsOnDisk(file)) filesToWrite.push(file)
  }
  const gitignoreMissing = missingGitignoreLines(
    await readWorkspaceGitignore(),
    output.gitignoreEntries,
  )
  const installed = await findInstalledRitualSkills(resolveSkillsDir({}))
  const catalog = new Set(skills.map((skill) => skill.name))
  return {
    output,
    filesToWrite,
    gitignoreMissing,
    skillsToWrite: installed.filter((name) => catalog.has(name)),
    skillsToRemove: installed.filter((name) => !catalog.has(name)),
  }
}

/** What a refresh did. */
export type ManagedRefreshResult = {
  filesWritten: string[]
  gitignore: GitignoreRefreshResult
  skillsWritten: string[]
  skillsRemoved: string[]
}

/**
 * Apply a refresh: write the managed files that changed, append missing
 * `.gitignore` entries, force-overwrite every installed catalog skill (skills
 * are never hand-edited, so there is no edit detection) and delete installed
 * Ritual skills the catalog dropped. Skills that are not installed stay
 * uninstalled.
 */
export async function applyManagedRefresh(
  plan: ManagedRefreshPlan,
  skills: readonly RitualSkill[] = SKILLS,
): Promise<ManagedRefreshResult> {
  for (const file of plan.filesToWrite) {
    await writeWorkspaceFile(file.path, file.content)
  }
  const gitignore = await refreshGitignore(plan.output.deploy)

  const skillsDir = resolveSkillsDir({})
  const toWrite = new Set(plan.skillsToWrite)
  const results = await refreshInstalledSkills(
    skills.filter((skill) => toWrite.has(skill.name)),
    skillsDir,
    { force: true },
  )
  for (const name of plan.skillsToRemove) {
    await removeInstalledSkill(skillsDir, name)
  }

  return {
    filesWritten: plan.filesToWrite.map((file) => file.path),
    gitignore,
    skillsWritten: results.filter((r) => r.status === 'written').map((r) => r.name),
    skillsRemoved: plan.skillsToRemove,
  }
}
