import { Command } from 'commander'
import { t } from '../i18n/t'
import { parseSetCodesInput } from '../card/set-codes'
import { buildInitialSessionConfig, prepareCardSessionCache } from './session/config'
import { runUnifiedEditor } from './session/editor'
import { addRefreshOption, resolveListTypeFlag } from '../cli/options'
import { cliRefreshPolicy } from '../cli/refresh-policy'
import type { RefreshMode } from '../cache/refresh'
import type { UnifiedListRef } from './session/edit-lists'
import {
  isListArgumentConflict,
  isResolveListError,
  resolveList,
  resolveListArgument,
  type ListLocation,
  type ListTypeFlags,
} from '../list/resolve-list'
import { inputRequiredError, promptsUnavailable } from '../util/no-input'
import { readDeckName } from '../importers/text-file'
import { emitError, emitResolveListError, TEXT_ONLY } from '../cli/output'
import { ExitCode } from '../util/errors'

/**
 * The unified `edit` command: option table, flag resolution and the cache
 * warm-up, then one call into the editor itself — see {@link runUnifiedEditor}.
 */

type EditCommandOptions = ListTypeFlags & {
  refresh: RefreshMode
  sets?: string
  finish?: string
  condition?: string
  section?: string
  collector?: boolean
  allowDigitalOnlyCards?: boolean
}

/**
 * The unified-list ref for a directly-opened list. A deck is displayed by its
 * front-matter name (matching the selection menu), even though the argument
 * matched the file's basename.
 */
async function directOpenRef(location: ListLocation): Promise<UnifiedListRef> {
  const name = location.type === 'deck' ? await readDeckName(location.filePath) : location.name
  return { type: location.type, name, file: location.filePath }
}

/** The edit command has no --output flag; resolution errors go to stderr as plain text. */

export function registerEditCommand(program: Command): void {
  const editCommand = program
    .command('edit')
    .description(t('help.edit.description'))
    .argument('[listName]', t('help.edit.listName'))
    .option('--deck', t('help.edit.deck'))
    .option('--collection', t('help.edit.collection'))
    .option('--wanted', t('help.edit.wanted'))
    .option('-s, --sets <codes>', t('help.edit.sets'))
    .option('-f, --finish <finish>', t('help.edit.finish'))
    .option('-c, --condition <condition>', t('help.edit.condition'))
    .option('--section <name>', t('help.edit.section'))
    .option('--collector', t('help.edit.collector'))
    .option('--allow-digital-only-cards', t('help.edit.allowDigitalOnly'))
  addRefreshOption(editCommand)
  editCommand.action(async (listNameArg: string | undefined, options: EditCommandOptions) => {
    // Conflicting type flags are a usage error with or without a [listName] —
    // `ritual edit --deck --collection` must not silently open the menu.
    const flagType = resolveListTypeFlag(options, TEXT_ONLY)
    if (flagType === 'conflict') return

    // Resolve the direct-open argument before any cache work, so a bad list
    // name fails fast instead of after a potential cache download prompt.
    let directRef: UnifiedListRef | undefined
    if (listNameArg !== undefined) {
      // A `deck:`/`collection:`/`wanted:` prefix supplies the type; one that
      // contradicts the type flag is a usage error, not a silent override.
      const query = resolveListArgument(listNameArg, flagType)
      if (isListArgumentConflict(query)) {
        emitError('usage_error', query.message, TEXT_ONLY)
        process.exitCode = ExitCode.UsageError
        return
      }
      const resolved = await resolveList(query.name, query.type)
      if (isResolveListError(resolved)) {
        emitResolveListError(resolved, TEXT_ONLY, 'type-flags')
        return
      }
      directRef = await directOpenRef(resolved)
    }

    // The editor is interactive end to end — refuse before any cache work when
    // prompting is impossible (no terminal, or --no-input). This runs after the
    // [listName] resolution above so a bad list name still fails with its own
    // error headlessly.
    if (promptsUnavailable()) {
      emitError(
        'usage_error',
        inputRequiredError(t('cli.edit.noInteractiveEditor')).message,
        TEXT_ONLY,
      )
      process.exitCode = ExitCode.UsageError
      return
    }

    const parsedSets = options.sets ? parseSetCodesInput(options.sets) : undefined
    const excludeDigitalOnly = !options.allowDigitalOnlyCards

    const cardNames = await prepareCardSessionCache(
      cliRefreshPolicy(options.refresh),
      parsedSets,
      excludeDigitalOnly,
    )
    if (!cardNames) return

    const sessionConfig = buildInitialSessionConfig(options, parsedSets)

    await runUnifiedEditor({ directRef, cardNames, sessionConfig, excludeDigitalOnly })
  })
}
