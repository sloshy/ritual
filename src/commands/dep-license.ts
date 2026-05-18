import { Command } from 'commander'
import prompts, { type Choice } from 'prompts'
import { depLicenses, type DepLicenseEntry } from '../generated/dep-licenses'
import { displayWithPager, resolvePagerMode } from '../pager'
import { ExitCode } from './scripting'

type DepLicenseOptions = {
  plain: boolean
}

type PromptStateChange = { aborted: boolean; exited: boolean }

const SEPARATOR = '__SEPARATOR__'

export function formatEntry(entry: DepLicenseEntry): string {
  const header = `${entry.name} v${entry.version} — ${entry.license}\n${'─'.repeat(60)}\n\n`
  return header + (entry.text ?? `[No license text found. SPDX identifier: ${entry.license}]\n`)
}

export function registerDepLicenseCommand(program: Command): void {
  program
    .command('dep-license')
    .description('Show licenses of dependencies bundled with Ritual')
    .argument('[package]', 'Package name to display directly')
    .option('--plain', 'Output directly to stdout without pager', false)
    .action(async (packageArg: string | undefined, options: DepLicenseOptions) => {
      const mode = resolvePagerMode(options.plain)

      if (packageArg) {
        const entry = depLicenses.find((e) => e.name === packageArg)
        if (!entry) {
          console.error(`Package '${packageArg}' not found. Run 'ritual dep-license' for a list.`)
          process.exitCode = ExitCode.NotFound
          return
        }
        await displayWithPager(formatEntry(entry), mode)
        return
      }

      if (!process.stdout.isTTY) {
        console.error('Provide a package name argument when not in a TTY.')
        process.exitCode = ExitCode.UsageError
        return
      }

      const primary = depLicenses.filter((e) => e.isPrimary)
      const transitive = depLicenses.filter((e) => !e.isPrimary)

      const choices: Choice[] = [
        { title: '── Primary Dependencies ──', value: SEPARATOR, disabled: true },
        ...primary.map((e) => ({
          title: `${e.name} v${e.version}  (${e.license})`,
          value: e.name,
        })),
        { title: '── Transitive Dependencies ──', value: SEPARATOR, disabled: true },
        ...transitive.map((e) => ({
          title: `${e.name} v${e.version}  (${e.license})`,
          value: e.name,
        })),
      ]

      let aborted = false
      const response = await prompts({
        type: 'autocomplete',
        name: 'pkg',
        message: 'Select a dependency to view its license',
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
