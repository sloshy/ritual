import { Command } from 'commander'
import path from 'node:path'
import { SKILLS, selectSkills } from '../skills/catalog'
import { installSkills, resolveSkillsDir, type SkillInstallResult } from '../skills/install'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  normalizeScriptingOptions,
  ExitCode,
  type ScriptingOptions,
} from './scripting'

type SkillsListOptions = Partial<ScriptingOptions>

type SkillsInstallOptions = {
  global?: boolean
  dir?: string
  force?: boolean
} & Partial<ScriptingOptions>

/** One row of `skills list --output json|ndjson`. */
type SkillListEntry = {
  name: string
  description: string
}

/** Payload of `skills install --output json|ndjson`. Paths are absolute. */
type SkillsInstallReport = {
  skillsDir: string
  results: SkillInstallResult[]
}

export function registerSkillsCommand(program: Command): void {
  const skills = program
    .command('skills')
    .description(
      'Install Claude Code agent skills that teach AI agents how to drive Ritual from a local workspace',
    )

  addScriptingOptions(
    skills.command('list').description('List the available Ritual skills'),
  ).action((options: SkillsListOptions) => {
    const scripting = normalizeScriptingOptions(options)

    if (scripting.output !== 'text') {
      const entries = SKILLS.map(
        (skill): SkillListEntry => ({ name: skill.name, description: skill.description }),
      )
      emitOutput(entries, scripting)
      return
    }

    for (const skill of SKILLS) {
      console.log(skill.name)
      console.log(`  ${skill.description}`)
      console.log('')
    }
  })

  addScriptingOptions(
    skills
      .command('install [names...]')
      .description(
        'Install Ritual skills into .claude/skills (or ~/.claude/skills with --global). Installs every skill when no names are given.',
      )
      .option('--global', 'Install into ~/.claude/skills instead of the project directory')
      .option(
        '--dir <path>',
        'Project directory that should contain .claude/skills (defaults to the base dir)',
      )
      .option('-f, --force', 'Overwrite skill files that already exist'),
  ).action(async (names: string[], options: SkillsInstallOptions) => {
    const scripting = normalizeScriptingOptions(options)

    const selected = selectSkills(names)
    if (typeof selected === 'string') {
      emitError('usage_error', selected, scripting)
      process.exitCode = ExitCode.UsageError
      return
    }

    const skillsDir = resolveSkillsDir({ global: options.global, dir: options.dir })
    const results = await installSkills(selected, skillsDir, { force: options.force ?? false })

    if (scripting.output !== 'text') {
      const report: SkillsInstallReport = { skillsDir, results }
      emitOutput(report, scripting)
      return
    }

    if (scripting.quiet) return

    const written = results.filter((result) => result.status === 'written')
    const skipped = results.filter((result) => result.status === 'skipped')

    const displayPath = (filePath: string): string => {
      const relative = path.relative(process.cwd(), filePath)
      return relative.startsWith('..') ? filePath : relative
    }

    for (const result of written) {
      console.log(`✓ ${result.name} → ${displayPath(result.path)}`)
    }
    for (const result of skipped) {
      console.log(`• ${result.name} already present (skipped)`)
    }

    console.log('')
    console.log(
      `Installed ${written.length} skill${written.length === 1 ? '' : 's'} to ${skillsDir}`,
    )
    if (skipped.length > 0) {
      console.log(
        `${skipped.length} already present; re-run with --force to overwrite with the current version.`,
      )
    }
  })
}
