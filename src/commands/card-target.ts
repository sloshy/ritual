/**
 * The two interactive pickers of the one-shot card commands (`note`,
 * `remove-card`, `set-card`, ...): the target list (with `deck:`/`collection:`/
 * `wanted:` prefix and type-flag support) and the target entry.
 */

import path from 'node:path'
import { ask, suggestByTitleTerms } from '../cli/prompts'
import { cancelledError, listArgumentConflictError, runCommandAction } from '../cli/action'
import { listTypeLabel, resolveListTypeFlag, type ResolvedList } from '../cli/options'
import { ExitCode, CardCommandError, localizedCommandError } from '../util/errors'
import type { ListType } from '../list/list-type'
import { normalizeScriptingOptions, type ScriptingOptions } from '../cli/output'
import {
  formatResolveListError,
  isListArgumentConflict,
  isResolveListError,
  listLocations,
  resolveList,
  resolveListArgument,
  type ListTypeFlags,
  type ResolveListError,
} from '../list/resolve-list'
import {
  describeEntry,
  findTargetEntry,
  loadEntryRefs,
  type EntryRef,
  isTargetPick,
  type EntryQuery,
} from '../list/entry-ref'
import { requireInteractive } from '../util/no-input'
import { t } from '../i18n/t'

/** Options for {@link resolveListSelection}'s interactive fallback. */
export type ResolveListSelectionOptions = {
  /**
   * Which list types the interactive picker offers (a command that would
   * refuse a type after picking should not offer it). Explicit names still
   * resolve across every type in scope, so the refusal path keeps its message.
   */
  pickerTypes?: readonly ListType[]
}

function resolveErrorToCommandError(error: ResolveListError): CardCommandError {
  // Every one-shot card command registers --deck/--collection/--wanted.
  const message = formatResolveListError(error, 'type-flags')
  if (error.kind === 'ambiguous') {
    return new CardCommandError('usage_error', message, ExitCode.UsageError)
  }
  return new CardCommandError('not_found', message, ExitCode.NotFound)
}

/**
 * Resolve the target list for a card command. When `listName` is given it is
 * matched via the shared resolver — an optional `deck:`/`collection:`/`wanted:`
 * prefix supplies `type` when no type flag was passed and is a usage error when
 * it contradicts one, matching is case-insensitive, and ambiguity is a usage
 * error. When `listName` is omitted, the user picks interactively from the lists
 * in scope.
 *
 * **Precondition:** the calling command registers `--deck`/`--collection`/`--wanted`
 * — the ambiguity error advises those flags. Every one-shot card command
 * (`add-card`, `remove-card`, `set-card`, `note`, `rename`, `delete`) does; a
 * flagless command must not use this helper without changing that advice.
 */
export async function resolveListSelection(
  listName: string | undefined,
  type: ListType | undefined,
  options?: ResolveListSelectionOptions,
): Promise<ResolvedList> {
  if (listName !== undefined) {
    const arg = resolveListArgument(listName, type)
    if (isListArgumentConflict(arg)) throw listArgumentConflictError(arg)
    const resolved = await resolveList(arg.name, arg.type)
    if (isResolveListError(resolved)) throw resolveErrorToCommandError(resolved)
    return { type: resolved.type, filePath: resolved.filePath }
  }

  requireInteractive('a list name')
  const allLocations = await listLocations(type)
  const locations = options?.pickerTypes
    ? allLocations.filter((loc) => options.pickerTypes!.includes(loc.type))
    : allLocations
  if (locations.length === 0) {
    // One sentence per list type rather than a spliced noun: the noun is
    // gendered in most target languages, so the sentence around it changes too.
    throw type
      ? localizedCommandError('not_found', ExitCode.NotFound, 'cli.cardOps.noListFilesOfType', {
          type,
        })
      : localizedCommandError('not_found', ExitCode.NotFound, 'cli.cardOps.noListFiles')
  }

  const index = await ask<number>({
    type: 'autocomplete',
    message: t('cli.cardOps.promptSelectList'),
    choices: locations.map((loc, i) => ({
      title: t('cli.cardOps.listChoice', { name: loc.name, type: listTypeLabel(loc.type) }),
      value: i,
    })),
    limit: 15,
  })
  if (typeof index !== 'number') throw cancelledError()
  const chosen = locations[index]
  if (!chosen) {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.cardOps.selectionOutOfRange',
    )
  }
  return { type: chosen.type, filePath: chosen.filePath }
}

/** A resolved list target: the list, its type, and its display slug. */
export type ListTarget = {
  type: ListType
  filePath: string
  list: string
}

/**
 * Resolve the target list for a list-level subcommand. Every list type is
 * offered: a wanted list carries `description` and categories like the others,
 * so the picker lists all three and a `--wanted` flag resolves normally.
 */
export async function resolveListTarget(
  listName: string | undefined,
  flags: ListTypeFlags,
  scripting: ScriptingOptions,
): Promise<ListTarget | 'conflict'> {
  const type = resolveListTypeFlag(flags, scripting)
  if (type === 'conflict') return 'conflict'
  const resolved: ResolvedList = await resolveListSelection(listName, type)
  return {
    type: resolved.type,
    filePath: resolved.filePath,
    list: path.basename(resolved.filePath, '.md'),
  }
}

/**
 * The list-level command prologue, written once: normalize the scripting
 * options, run the action through {@link runCommandAction}, resolve the list
 * target, and return early when the type flags conflict.
 *
 * The `'conflict'` sentinel is a rule every list-level command has to honour —
 * `resolveListTypeFlag` has already reported it, so the action must simply not
 * run — and honouring it exactly once is what this exists for.
 */
export async function runListTargetAction(
  listName: string | undefined,
  options: ListTypeFlags & Partial<ScriptingOptions>,
  run: (target: ListTarget, scripting: ScriptingOptions) => Promise<void>,
): Promise<void> {
  const scripting = normalizeScriptingOptions(options)
  await runCommandAction(scripting, async () => {
    const target = await resolveListTarget(listName, options, scripting)
    if (target === 'conflict') return
    await run(target, scripting)
  })
}

/** {@link findTargetEntry}, with the interactive picker for a selector-less run. */
export async function resolveTarget(
  type: ListType,
  filePath: string,
  input: EntryQuery,
): Promise<EntryRef> {
  const entries = await loadEntryRefs(type, filePath)
  const found = findTargetEntry({ type, filePath, entries }, input)
  return isTargetPick(found) ? promptCardSelection(found.candidates) : found
}

async function promptCardSelection(entries: EntryRef[]): Promise<EntryRef> {
  requireInteractive('a card name or --card-id <id>')
  const choices = entries.map((e, i) => ({
    title: e.note
      ? t('cli.cardOps.cardChoiceWithNote', { entry: describeEntry(e), note: e.note })
      : describeEntry(e),
    value: i,
  }))
  const index = await ask<number>({
    type: 'autocomplete',
    message: t('cli.cardOps.promptSelectCard'),
    choices,
    limit: 15,
    suggest: suggestByTitleTerms,
  })
  if (typeof index !== 'number') throw cancelledError()
  const target = entries[index]
  if (!target) {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.cardOps.selectionOutOfRange',
    )
  }
  return target
}
