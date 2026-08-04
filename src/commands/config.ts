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

const formatConfigValue = formatSettableValue

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Inspect and modify the ritual configuration file')

  registerSetSubcommand(config)
  registerGetSubcommand(config)
  registerListSubcommand(config)
  registerUnsetSubcommand(config)
}

function registerSetSubcommand(config: Command): void {
  addScriptingOptions(
    config
      .command('set')
      .description('Set or update a value in the ritual configuration file')
      .argument('<property>', 'Config property to set (use dot notation for nested: parent.child)')
      .argument('<value...>', 'Value(s) to set')
      .addOption(
        new Option('--add', 'Add value(s) to an array property instead of replacing it').conflicts(
          'remove',
        ),
      )
      .addOption(new Option('--remove', 'Remove value(s) from an array property')),
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
        emitOutput(`Set ${outcome.property} = ${formatConfigValue(outcome.newValue)}`, scripting)
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
      .description('Print the value of a single configuration property')
      .argument(
        '<property>',
        'Config property to read (use dot notation for nested: parent.child)',
      ),
  ).action(async (property: string, options: Partial<ScriptingOptions>) => {
    const scripting = normalizeScriptingOptions(options)
    const outcome = applyConfigGet(await loadRitualConfig(), property)

    if (outcome.kind === 'unknown-property') {
      emitError('usage_error', outcome.error, scripting)
      process.exitCode = ExitCode.UsageError
      return
    }
    if (outcome.kind === 'unset') {
      emitError('not_found', `"${property}" is not set.`, scripting)
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
  addScriptingOptions(
    config.command('list').description('Print the full effective configuration'),
  ).action(async (options: Partial<ScriptingOptions>) => {
    const scripting = normalizeScriptingOptions(options)
    const current = await loadRitualConfig()

    if (scripting.output === 'text') {
      const lines: string[] = []
      for (const entry of listConfigEntries(current)) {
        if (entry.value === undefined) {
          lines.push(`${entry.property} = (unset)`)
          continue
        }
        const marker = entry.isDefault ? ' (default)' : ''
        lines.push(`${entry.property} = ${formatConfigValue(entry.value)}${marker}`)
      }
      emitOutput(lines.join('\n'), scripting)
      return
    }

    // Mirror the payload of the admin server's GET /api/config (the effective
    // config from loadRitualConfig) so `config list --output json` and the MCP
    // get_config tool report the same values.
    const result: RitualConfig = { ...current }
    emitOutput(result, scripting)
  })
}

function registerUnsetSubcommand(config: Command): void {
  addScriptingOptions(
    config
      .command('unset')
      .description('Remove a configuration property, reverting it to its default')
      .argument(
        '<property>',
        'Config property to unset (use dot notation for nested: parent.child)',
      ),
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
            ? `Reset ${outcome.property} to default (${formatConfigValue(outcome.defaultValue)})`
            : `Unset ${outcome.property}`,
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
