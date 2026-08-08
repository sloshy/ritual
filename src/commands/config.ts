import { Command, Option } from 'commander'
import {
  applyConfigGet,
  applyConfigSet,
  applyConfigUnset,
  formatSettableValue,
  listConfigEntries,
  type ArrayMode,
  type SettableValue,
} from '../config-fields'
import {
  loadRitualConfig,
  savePartialRitualConfig,
  saveRitualConfig,
  type RitualConfig,
} from '../ritual-config'
import { t } from '../i18n/t'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

type ConfigSetOptions = {
  add?: boolean
  remove?: boolean
} & Partial<ScriptingOptions>

type ConfigSetResult = {
  property: string
  value: SettableValue
}

type ConfigUnsetResult = {
  property: string
  status: 'reset' | 'unset'
  defaultValue?: SettableValue
}

/** The interpolation params shared by the two `config list` row messages. */
type ConfigEntryParams = {
  property: string
  value: string
}

const formatConfigValue = formatSettableValue

export function registerConfigCommand(program: Command): void {
  const config = program.command('config').description(t('help.config.description'))

  registerSetSubcommand(config)
  registerGetSubcommand(config)
  registerListSubcommand(config)
  registerUnsetSubcommand(config)
}

function registerSetSubcommand(config: Command): void {
  addScriptingOptions(
    config
      .command('set')
      .description(t('help.config.set'))
      .argument('<property>', t('help.config.setProperty'))
      .argument('<value...>', t('help.config.setValue'))
      .addOption(new Option('--add', t('help.config.add')).conflicts('remove'))
      .addOption(new Option('--remove', t('help.config.remove'))),
  ).action(async (property: string, values: string[], options: ConfigSetOptions) => {
    const scripting = normalizeScriptingOptions(options)
    const mode: ArrayMode = options.add ? 'add' : options.remove ? 'remove' : 'replace'
    const current = await loadRitualConfig()
    const outcome = applyConfigSet(current, property, values, mode)

    if ('error' in outcome) {
      emitError('usage_error', outcome.error, scripting)
      process.exitCode = ExitCode.UsageError
      return
    }

    await saveRitualConfig(outcome.updatedConfig)

    if (scripting.output === 'text') {
      if (!scripting.quiet) {
        emitOutput(
          t('cli.config.set', {
            property: outcome.property,
            value: formatConfigValue(outcome.newValue),
          }),
          scripting,
        )
      }
      return
    }
    const result: ConfigSetResult = { property: outcome.property, value: outcome.newValue }
    emitOutput(result, scripting)
  })
}

function registerGetSubcommand(config: Command): void {
  addScriptingOptions(
    config
      .command('get')
      .description(t('help.config.get'))
      .argument('<property>', t('help.config.getProperty')),
  ).action(async (property: string, options: Partial<ScriptingOptions>) => {
    const scripting = normalizeScriptingOptions(options)
    const outcome = applyConfigGet(await loadRitualConfig(), property)

    if (outcome.kind === 'unknown-property') {
      emitError('usage_error', outcome.error, scripting)
      process.exitCode = ExitCode.UsageError
      return
    }
    if (outcome.kind === 'unset') {
      emitError(
        'not_found',
        t('cli.config.notSet', { property }),
        scripting,
        undefined,
        'cli.config.notSet',
      )
      process.exitCode = ExitCode.NotFound
      return
    }

    // The value is the command's entire point, so it prints even under --quiet.
    if (scripting.output === 'text') {
      emitOutput(formatConfigValue(outcome.value), scripting)
      return
    }
    emitOutput(outcome.value, scripting)
  })
}

function registerListSubcommand(config: Command): void {
  addScriptingOptions(config.command('list').description(t('help.config.list'))).action(
    async (options: Partial<ScriptingOptions>) => {
      const scripting = normalizeScriptingOptions(options)
      const current = await loadRitualConfig()

      if (scripting.output === 'text') {
        const lines: string[] = []
        for (const entry of listConfigEntries(current)) {
          if (entry.value === undefined) {
            lines.push(t('cli.config.entryUnset', { property: entry.property }))
            continue
          }
          const params: ConfigEntryParams = {
            property: entry.property,
            value: formatConfigValue(entry.value),
          }
          lines.push(
            entry.isDefault ? t('cli.config.entryDefault', params) : t('cli.config.entry', params),
          )
        }
        emitOutput(lines.join('\n'), scripting)
        return
      }

      // Mirror the payload of the admin server's GET /api/config (the effective
      // config from loadRitualConfig) so `config list --output json` and the MCP
      // get_config tool report the same values.
      const result: RitualConfig = { ...current }
      emitOutput(result, scripting)
    },
  )
}

function registerUnsetSubcommand(config: Command): void {
  addScriptingOptions(
    config
      .command('unset')
      .description(t('help.config.unset'))
      .argument('<property>', t('help.config.unsetProperty')),
  ).action(async (property: string, options: Partial<ScriptingOptions>) => {
    const scripting = normalizeScriptingOptions(options)
    const current = await loadRitualConfig()
    const outcome = applyConfigUnset(current, property)

    if ('error' in outcome) {
      emitError('usage_error', outcome.error, scripting)
      process.exitCode = ExitCode.UsageError
      return
    }

    // The unset object may omit defaulted keys; savePartialRitualConfig writes
    // it as-is and re-reads so the in-process cache holds the re-materialized
    // defaults rather than a partial config.
    await savePartialRitualConfig(outcome.updatedConfig)

    if (scripting.output === 'text') {
      if (!scripting.quiet) {
        emitOutput(
          outcome.defaultValue !== undefined
            ? t('cli.config.reset', {
                property: outcome.property,
                value: formatConfigValue(outcome.defaultValue),
              })
            : t('cli.config.unset', { property: outcome.property }),
          scripting,
        )
      }
      return
    }
    const result: ConfigUnsetResult =
      outcome.defaultValue !== undefined
        ? { property: outcome.property, status: 'reset', defaultValue: outcome.defaultValue }
        : { property: outcome.property, status: 'unset' }
    emitOutput(result, scripting)
  })
}
