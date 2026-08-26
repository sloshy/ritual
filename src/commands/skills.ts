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
import { addOutputOption, addScriptingOptions } from '../cli/options'
import {
  emitError,
  emitOutput,
  normalizeScriptingOptions,
  type OutputFormat,
  type ScriptingOptions,
} from '../cli/output'
import { ExitCode } from '../util/errors'
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'

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
      .option('--global', t('help.skills.global'))
      .option('--dir <path>', t('help.skills.dir'))
      .option('-f, --force', t('help.skills.force')),
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
        console.log(
          t('cli.skills.resultWritten', { name: result.name, path: displayPath(result.path) }),
        )
        break
      case 'up-to-date':
        console.log(t('cli.skills.resultUpToDate', { name: result.name }))
        break
      case 'skipped':
        console.log(t('cli.skills.resultSkipped', { name: result.name }))
        break
      case 'absent':
        console.log(t('cli.skills.resultAbsent', { name: result.name }))
        break
      default: {
        result.status satisfies never
        throw new Error('Unhandled skill install status (this is a bug)')
      }
    }
  }
}

/**
 * How a summary names what it counted. `skill` is the bare word the `skills`
 * subcommands use, having just said the word themselves; `agentSkill` is the
 * fuller "Ritual agent skill" that `init-site` needs, because its summary
 * arrives with no such context. Message keys rather than nouns spliced into a
 * sentence: only the catalog can make the count and the noun agree.
 */
export type SkillNoun = 'skill' | 'agentSkill'

const SKILL_COUNT = {
  skill: 'domain.count.skills',
  agentSkill: 'domain.count.agentSkills',
} as const satisfies Record<SkillNoun, MessageKey>

/** How {@link printSkillsWriteSummary} words its lines for one consumer. */
export type SkillsWriteSummaryOptions = {
  /**
   * Which verb the written-count line uses. English also varies the
   * preposition ('installed … to' vs 'updated … in'), so both live in the one
   * `cli.skills.written` message rather than being concatenated here.
   */
  verb: 'installedTo' | 'installedIn' | 'updatedIn'
  /** The target directory as it should be rendered in the summary lines. */
  dir: string
  /** Which noun names a skill; defaults to `skill`. */
  noun?: SkillNoun
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
  const countKey = SKILL_COUNT[options.noun ?? 'skill']
  const counted = (count: number): string => t(countKey, { count })

  if (counts.written > 0 || options.alwaysReportWritten) {
    console.log(
      t('cli.skills.written', {
        verb: options.verb,
        counted: counted(counts.written),
        dir: options.dir,
      }),
    )
  }
  if (counts['up-to-date'] > 0) {
    console.log(t('cli.skills.upToDate', { counted: counted(counts['up-to-date']) }))
  }
  if (counts.skipped > 0) {
    console.log(
      t('cli.skills.skipped', {
        counted: counted(counts.skipped),
        forceHint: options.forceHint,
      }),
    )
  }
  if (options.reportAbsent && counts.absent > 0) {
    console.log(t('cli.skills.absent', { count: counts.absent, counted: counted(counts.absent) }))
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
  const skills = program.command('skills').description(t('help.skills.description'))

  // `list` gets `--output` but no `--quiet`: its whole output is the payload,
  // so there is no non-essential chatter to suppress and an inert flag would
  // only advertise a behavior the command does not have.
  addOutputOption(skills.command('list').description(t('help.skills.list'))).action(
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
    skills.command('install [names...]').description(t('help.skills.install')),
  ).action(async (names: string[], options: SkillsWriteCommandOptions) => {
    const scripting = normalizeScriptingOptions(options)
    const report = await runSkillsWrite(names, options, scripting, installSkills)
    if (report === null || scripting.quiet) return

    printSkillResultLines(report.results)
    console.log('')
    printSkillsWriteSummary(report.results, {
      verb: 'installedTo',
      dir: report.skillsDir,
      forceHint: t('cli.skills.forceHintRerun'),
      alwaysReportWritten: true,
    })
  })

  addSkillsWriteOptions(
    skills.command('update [names...]').description(t('help.skills.update')),
  ).action(async (names: string[], options: SkillsWriteCommandOptions) => {
    const scripting = normalizeScriptingOptions(options)
    const report = await runSkillsWrite(names, options, scripting, refreshInstalledSkills)
    if (report === null || scripting.quiet) return

    printSkillResultLines(report.results)
    console.log('')
    printSkillsWriteSummary(report.results, {
      verb: 'updatedIn',
      dir: report.skillsDir,
      forceHint: t('cli.skills.forceHintRerun'),
      alwaysReportWritten: true,
      reportAbsent: true,
    })
  })
}
