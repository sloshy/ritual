/**
 * `ritual doctor` — check the setup and print a report short enough to paste
 * into a bug report: the build, the workspace, its config and pending updates,
 * the card cache and the update check, each `ok`/`warn`/`fail` with a one-line
 * fix. `--output json` prints the same report as `GET /api/doctor` returns.
 *
 * Read-only and offline (`src/doctor/collect.ts`). Exits 1 when a check fails;
 * warnings alone exit 0. The root hook loads the config quietly for this
 * command, so a broken `ritual.config.json` is reported rather than refused.
 */

import type { Command } from 'commander'
import { addOutputOption } from '../cli/options'
import { emitOutput, normalizeScriptingOptions, type ScriptingOptions } from '../cli/output'
import { runCommandAction } from '../cli/action'
import { collectDoctorReport } from '../doctor/collect'
import type { DoctorReport, DoctorStatus } from '../doctor/report'
import { displayWidth, padEndDisplay } from '../i18n/width'
import { t, type ParameterlessKey } from '../i18n/t'
import { renderSyncMessage } from '../sync/message'
import { ExitCode } from '../util/errors'

/** The status word in each report line's first column. */
const STATUS_LABELS = {
  ok: 'cli.doctor.status.ok',
  warn: 'cli.doctor.status.warn',
  fail: 'cli.doctor.status.fail',
} as const satisfies Record<DoctorStatus, ParameterlessKey>

/**
 * The text report: one line per check — its status word padded to the widest
 * one, then its summary — with any further facts and the fix indented under
 * it, then the issue tracker to paste it into.
 */
export function formatDoctorText(report: DoctorReport): string {
  const width = Math.max(...Object.values(STATUS_LABELS).map((key) => displayWidth(t(key))))
  const indent = ' '.repeat(width + 2)
  const lines: string[] = []
  for (const check of report.checks) {
    const label = t(STATUS_LABELS[check.status])
    const [first = '', ...more] = renderSyncMessage(check.summary).split('\n')
    lines.push(
      `${padEndDisplay(label, width)}  ${first}`,
      ...more.map((line) => `${indent}${line}`),
    )
    const under = [
      ...check.details.map((detail) =>
        t('cli.doctor.detail', { detail: renderSyncMessage(detail) }),
      ),
      ...(check.hint === null
        ? []
        : [t('cli.doctor.hint', { hint: renderSyncMessage(check.hint) })]),
    ]
    // Any line may span several (a parser's message): every one keeps the
    // indent, so the status column stays clear.
    for (const text of under) lines.push(...text.split('\n').map((line) => `${indent}${line}`))
  }
  lines.push('', t('cli.doctor.paste', { url: report.ritual.issuesUrl }))
  return lines.join('\n')
}

async function runDoctor(scripting: ScriptingOptions): Promise<void> {
  const report = await collectDoctorReport()
  emitOutput(scripting.output === 'text' ? formatDoctorText(report) : report, scripting)
  if (!report.ok) process.exitCode = ExitCode.RuntimeError
}

export function registerDoctorCommand(program: Command): void {
  // `--output` only: the report *is* the command's output, so there is no
  // chatter for `--quiet` to suppress.
  addOutputOption(program.command('doctor').description(t('help.doctor.description'))).action(
    async (options: Partial<ScriptingOptions>) => {
      const scripting = normalizeScriptingOptions(options, 'text')
      await runCommandAction(scripting, () => runDoctor(scripting))
    },
  )
}
