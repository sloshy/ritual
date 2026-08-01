import { Command } from 'commander'
import path from 'node:path'
import { SKILLS, selectSkills } from '../skills/catalog'
import {
  installSkills,
  refreshInstalledSkills,
  resolveSkillsDir,
  type SkillInstallResult,
  type SkillInstallStatus,
  type SkillWriteOptions,
} from '../skills/install'
import type { RitualSkill } from '../skills/types'
import {
  addOutputOption,
  addScriptingOptions,
  emitError,
  emitOutput,
  normalizeScriptingOptions,
  ExitCode,
  type OutputFormat,
  type ScriptingOptions,
} from './scripting'

/** `skills list` registers only `--output`; see the registration comment. */
type SkillsListOptions = { output?: OutputFormat }

/** Shared flags of the `skills install` and `skills update` subcommands. */
type SkillsWriteCommandOptions = {
  global?: boolean
  dir?: string
  force?: boolean
} & Partial<ScriptingOptions>

/** One row of `skills list --output json|ndjson`. */
type SkillListEntry = {
  name: string
  description: string
}

/** Payload of `skills install|update --output json|ndjson`. Paths are absolute. */
type SkillsInstallReport = {
  skillsDir: string
  results: SkillInstallResult[]
}

/** Add the target-directory and overwrite flags shared by install and update. */
function addSkillsWriteOptions(command: Command): Command {
  return addScriptingOptions(
    command
      .option('--global', 'Target ~/.claude/skills instead of the project directory')
      .option(
        '--dir <path>',
        'Project directory that should contain .claude/skills (defaults to the base dir)',
      )
      .option('-f, --force', 'Overwrite skill files even when they have local edits'),
  )
}

/** Render a path relative to the cwd when it is inside it, absolute otherwise. */
function displayPath(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath)
  return relative.startsWith('..') ? filePath : relative
}

/** Print the shared per-skill result lines for text mode. */
function printSkillResultLines(results: SkillInstallResult[]): void {
  for (const result of results) {
    switch (result.status) {
      case 'written':
        console.log(`✓ ${result.name} → ${displayPath(result.path)}`)
        break
      case 'up-to-date':
        console.log(`• ${result.name} already up to date`)
        break
      case 'skipped':
        console.log(`• ${result.name} has local edits (skipped)`)
        break
      case 'absent':
        console.log(`• ${result.name} not installed (skipped)`)
        break
      default: {
        result.status satisfies never
        throw new Error('Unhandled skill install status (this is a bug)')
      }
    }
  }
}

/** Pluralize a skill noun phrase for a count. */
function skillNoun(count: number, noun = 'skill'): string {
  return `${noun}${count === 1 ? '' : 's'}`
}

/** How {@link printSkillsWriteSummary} words its lines for one consumer. */
export type SkillsWriteSummaryOptions = {
  /** Verb for the written-count line: 'Installed' or 'Updated'. */
  verb: 'Installed' | 'Updated'
  /** Preposition between the verb phrase and the directory: 'to' or 'in'. */
  preposition: 'to' | 'in'
  /** The target directory as it should be rendered in the summary lines. */
  dir: string
  /** Noun for a single skill; defaults to 'skill' (init-site passes 'Ritual agent skill'). */
  noun?: string
  /** The re-run that overwrites locally edited files, e.g. 're-run with --force to overwrite them'. */
  forceHint: string
  /** Print the written-count line even when nothing was written (the skills subcommands always do). */
  alwaysReportWritten?: boolean
  /** Report skills that are not installed (only `skills update` surfaces those). */
  reportAbsent?: boolean
}

/**
 * Print the status-count summary shared by every consumer of the skill write
 * engines: the `skills install` and `skills update` actions here, plus
 * init-site's `maybeInstallSkills` and `refreshSkillsOnUpgrade`. The counts
 * object is keyed by the full {@link SkillInstallStatus} union, so adding a
 * status without accounting for it here is a compile error rather than a
 * silently dropped summary line.
 */
export function printSkillsWriteSummary(
  results: SkillInstallResult[],
  options: SkillsWriteSummaryOptions,
): void {
  const counts: Record<SkillInstallStatus, number> = {
    written: 0,
    'up-to-date': 0,
    skipped: 0,
    absent: 0,
  }
  for (const result of results) counts[result.status]++
  const noun = options.noun ?? 'skill'

  if (counts.written > 0 || options.alwaysReportWritten) {
    console.log(
      `✓ ${options.verb} ${counts.written} ${skillNoun(counts.written, noun)} ${options.preposition} ${options.dir}`,
    )
  }
  if (counts['up-to-date'] > 0) {
    console.log(
      `• ${counts['up-to-date']} ${skillNoun(counts['up-to-date'], noun)} already up to date`,
    )
  }
  if (counts.skipped > 0) {
    console.log(
      `⊘ ${counts.skipped} ${skillNoun(counts.skipped, noun)} with local edits left untouched (${options.forceHint})`,
    )
  }
  if (options.reportAbsent && counts.absent > 0) {
    console.log(
      `• ${counts.absent} ${skillNoun(counts.absent, noun)} not installed; use \`ritual skills install\` to add ${counts.absent === 1 ? 'it' : 'them'}`,
    )
  }
}

/**
 * The shared prologue of `skills install` and `skills update`: resolve names to
 * skills (usage error on unknown ones), resolve the target directory, run the
 * write engine, and emit the JSON report when structured output was requested.
 * Returns `null` when the command is done (error or structured output); the
 * caller then prints its own text summary.
 */
async function runSkillsWrite(
  names: string[],
  options: SkillsWriteCommandOptions,
  scripting: ScriptingOptions,
  engine: (
    skills: readonly RitualSkill[],
    skillsDir: string,
    writeOptions: SkillWriteOptions,
  ) => Promise<SkillInstallResult[]>,
): Promise<SkillsInstallReport | null> {
  const selected = selectSkills(names)
  if (typeof selected === 'string') {
    emitError('usage_error', selected, scripting)
    process.exitCode = ExitCode.UsageError
    return null
  }

  const skillsDir = resolveSkillsDir({ global: options.global, dir: options.dir })
  const results = await engine(selected, skillsDir, { force: options.force ?? false })
  const report: SkillsInstallReport = { skillsDir, results }

  if (scripting.output !== 'text') {
    emitOutput(report, scripting)
    return null
  }
  return report
}

export function registerSkillsCommand(program: Command): void {
  const skills = program
    .command('skills')
    .description(
      'Install Claude Code agent skills that teach AI agents how to drive Ritual from a local workspace',
    )

  // `list` gets `--output` but no `--quiet`: its whole output is the payload,
  // so there is no non-essential chatter to suppress and an inert flag would
  // only advertise a behavior the command does not have.
  addOutputOption(skills.command('list').description('List the available Ritual skills')).action(
    (options: SkillsListOptions) => {
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
    },
  )

  addSkillsWriteOptions(
    skills
      .command('install [names...]')
      .description(
        'Install Ritual skills into .claude/skills (or ~/.claude/skills with --global). Installs every skill when no names are given.',
      ),
  ).action(async (names: string[], options: SkillsWriteCommandOptions) => {
    const scripting = normalizeScriptingOptions(options)
    const report = await runSkillsWrite(names, options, scripting, installSkills)
    if (report === null || scripting.quiet) return

    printSkillResultLines(report.results)
    console.log('')
    printSkillsWriteSummary(report.results, {
      verb: 'Installed',
      preposition: 'to',
      dir: report.skillsDir,
      forceHint: 're-run with --force to overwrite them with the current version',
      alwaysReportWritten: true,
    })
  })

  addSkillsWriteOptions(
    skills
      .command('update [names...]')
      .description(
        'Refresh already-installed Ritual skills to the current version. Never installs skills that are not present; use install for that.',
      ),
  ).action(async (names: string[], options: SkillsWriteCommandOptions) => {
    const scripting = normalizeScriptingOptions(options)
    const report = await runSkillsWrite(names, options, scripting, refreshInstalledSkills)
    if (report === null || scripting.quiet) return

    printSkillResultLines(report.results)
    console.log('')
    printSkillsWriteSummary(report.results, {
      verb: 'Updated',
      preposition: 'in',
      dir: report.skillsDir,
      forceHint: 're-run with --force to overwrite them with the current version',
      alwaysReportWritten: true,
      reportAbsent: true,
    })
  })
}
