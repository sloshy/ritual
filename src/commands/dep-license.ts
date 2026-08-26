import { Command } from 'commander'
import prompts, { type Choice } from 'prompts'
import { depLicenses, type DepLicenseEntry } from '../generated/dep-licenses'
import { displayWithPager, resolvePagerMode } from '../util/pager'
import { promptsUnavailable, promptsUnavailableReason } from '../util/no-input'
import { t } from '../i18n/t'
import {
  addOutputOption,
  emitError,
  emitOutput,
  normalizeScriptingOptions,
  ExitCode,
  type ScriptingOptions,
} from './scripting'

type DepLicenseOptions = {
  plain: boolean
  list?: boolean
} & Partial<ScriptingOptions>

type PromptStateChange = { aborted: boolean; exited: boolean }

/**
 * One row of `dep-license --list --output json|ndjson`. Deliberately excludes
 * the bundled license text (it is huge) — `dep-license <package>` shows it.
 */
export type DepLicenseListEntry = {
  name: string
  version: string
  license: string
  isPrimary: boolean
}

const SEPARATOR = '__SEPARATOR__'

export function formatEntry(entry: DepLicenseEntry): string {
  const header = `${entry.name} v${entry.version} — ${entry.license}\n${'─'.repeat(60)}\n\n`
  return header + (entry.text ?? `${t('cli.depLicense.noText', { license: entry.license })}\n`)
}

/** Project the generated entries onto the list payload (drops the license text). */
export function toDepLicenseListEntries(
  entries: readonly DepLicenseEntry[],
): DepLicenseListEntry[] {
  return entries.map(
    (entry): DepLicenseListEntry => ({
      name: entry.name,
      version: entry.version,
      license: entry.license,
      isPrimary: entry.isPrimary,
    }),
  )
}

/**
 * Render `--list` text output: primary dependencies first under `Primary:`,
 * then `Transitive:`, one grep-friendly `name version license` line each.
 */
export function formatDepLicenseList(entries: readonly DepLicenseEntry[]): string {
  const primary = entries.filter((entry) => entry.isPrimary)
  const transitive = entries.filter((entry) => !entry.isPrimary)
  const lines: string[] = [t('cli.depLicense.primaryHeader')]
  for (const entry of primary) {
    lines.push(`  ${entry.name} ${entry.version} ${entry.license}`)
  }
  lines.push(t('cli.depLicense.transitiveHeader'))
  for (const entry of transitive) {
    lines.push(`  ${entry.name} ${entry.version} ${entry.license}`)
  }
  return lines.join('\n')
}

export function registerDepLicenseCommand(program: Command): void {
  // `--output` only: the license listing (or a package's license text) is the
  // whole output, so `--quiet` would have nothing to suppress.
  addOutputOption(
    program
      .command('dep-license')
      .description(t('help.depLicense.description'))
      .argument('[package]', t('help.depLicense.packageArg'))
      .option('--list', t('help.depLicense.list'), false)
      .option('--plain', t('help.depLicense.plain'), false),
  ).action(async (packageArg: string | undefined, options: DepLicenseOptions) => {
    const scripting = normalizeScriptingOptions(options)
    const mode = resolvePagerMode(options.plain)

    if (options.list) {
      if (packageArg) {
        emitError(
          'usage_error',
          t('cli.depLicense.listWithPackage'),
          scripting,
          undefined,
          'cli.depLicense.listWithPackage',
        )
        process.exitCode = ExitCode.UsageError
        return
      }
      if (scripting.output === 'text') {
        emitOutput(formatDepLicenseList(depLicenses), scripting)
        return
      }
      emitOutput(toDepLicenseListEntries(depLicenses), scripting)
      return
    }

    if (packageArg) {
      const entry = depLicenses.find((e) => e.name === packageArg)
      if (!entry) {
        emitError(
          'not_found',
          t('cli.depLicense.packageNotFound', { name: packageArg }),
          scripting,
          undefined,
          'cli.depLicense.packageNotFound',
        )
        process.exitCode = ExitCode.NotFound
        return
      }
      await displayWithPager(formatEntry(entry), mode)
      return
    }

    // The dependency picker is a prompt: it needs a terminal on both ends —
    // stdin to read the selection, stdout so its UI does not land in a pipe.
    if (promptsUnavailable() || !process.stdout.isTTY) {
      emitError(
        'usage_error',
        t('cli.depLicense.needsPackage', { reason: promptsUnavailableReason() }),
        scripting,
        undefined,
        'cli.depLicense.needsPackage',
      )
      process.exitCode = ExitCode.UsageError
      return
    }

    const primary = depLicenses.filter((e) => e.isPrimary)
    const transitive = depLicenses.filter((e) => !e.isPrimary)

    const choices: Choice[] = [
      { title: t('cli.depLicense.primarySeparator'), value: SEPARATOR, disabled: true },
      ...primary.map((e) => ({
        title: `${e.name} v${e.version}  (${e.license})`,
        value: e.name,
      })),
      { title: t('cli.depLicense.transitiveSeparator'), value: SEPARATOR, disabled: true },
      ...transitive.map((e) => ({
        title: `${e.name} v${e.version}  (${e.license})`,
        value: e.name,
      })),
    ]

    let aborted = false
    const response = await prompts({
      type: 'autocomplete',
      name: 'pkg',
      message: t('cli.depLicense.promptSelect'),
      choices,
      suggest: async (input, choices) => {
        if (!input) return choices
        const terms = input.toLowerCase().split(/\s+/).filter(Boolean)
        return choices.filter(
          (c) =>
            c.value !== SEPARATOR &&
            !c.disabled &&
            terms.every((t: string) => c.title.toLowerCase().includes(t)),
        )
      },
      onState(state: PromptStateChange) {
        aborted = state.aborted || state.exited
      },
    })

    if (aborted || !response.pkg || response.pkg === SEPARATOR) return
    const entry = depLicenses.find((e) => e.name === response.pkg)
    if (entry) await displayWithPager(formatEntry(entry), mode)
  })
}
