import { Command, InvalidArgumentError } from 'commander'
import prompts from 'prompts'
import * as fs from 'node:fs/promises'
import type { PromptState } from './prompts-types'
import {
  isResolveListError,
  listLocations,
  listTypeFromFlags,
  resolveList,
  type ListLocation,
  type ListTypeFlags,
} from '../resolve-list'
import { listTypeSingularTitle, type ListType } from '../list-type'
import {
  cloneSets,
  combineSetsInto,
  deleteSetAt,
  isValidIso8601,
  parseChangeSets,
  retimeSetAt,
  serializeChangeSets,
  sortNewestFirst,
  type ChangeSet,
} from '../changelog-blocks'
import { buildDefaultChangeLines, changesPathFor, loadListSnapshot } from './history-helpers'
import {
  addOutputOption,
  emitError,
  emitOutput,
  emitResolveListError,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'
import { promptExitMenu } from './prompts-helpers'
import { inputRequiredError, promptsUnavailable, requireInteractive } from '../no-input'
import { runCommandAction } from './card-target'
import { parsePositiveInteger } from '../parse-number'
import { t } from '../i18n/t'

export type HistoryOptions = ListTypeFlags &
  Partial<ScriptingOptions> & {
    show?: boolean
    limit?: number
  }

/** Commander argParser for `--limit`: positive integers only. */
function parseLimitFlag(value: string): number {
  const parsed = parsePositiveInteger(value)
  if (parsed === undefined) {
    throw new InvalidArgumentError(t('cli.history.limitInvalid', { value }))
  }
  return parsed
}

function listTypeLabel(type: ListType): string {
  return listTypeSingularTitle(type)
}

/**
 * One change set's header line — `2026-05-29T12:00:00.000Z  (3 changes)`. The
 * `--show` output and three editor screens all render it, and a `:` is appended
 * where the block's lines follow, so the wording lives in exactly one place.
 */
function setHeading(set: ChangeSet): string {
  return t('cli.history.setHeading', {
    timestamp: set.timestamp,
    changes: t('domain.count.changes', { count: set.lines.length }),
  })
}

/** Run a single-select prompt, returning the chosen value or null on cancel/ESC. */
async function selectMenu(message: string, choices: prompts.Choice[]): Promise<string | null> {
  let exited = false
  const resp = await prompts({
    type: 'select',
    name: 'value',
    message,
    choices,
    onState: (state: PromptState) => {
      if (state.exited) exited = true
    },
  })
  if (exited || typeof resp.value !== 'string') return null
  return resp.value
}

/**
 * Run a type-to-filter autocomplete prompt, returning the chosen value or null on
 * cancel/ESC. Matching mirrors the card pickers elsewhere in the CLI: an empty
 * query shows everything, otherwise a choice is kept when every whitespace-split
 * term is a case-insensitive substring of its title. Values in `pinned` always
 * stay visible regardless of the query (used to keep action items shown while the
 * change sets are being filtered).
 */
async function autocompleteMenu(
  message: string,
  choices: prompts.Choice[],
  pinned?: ReadonlySet<string>,
): Promise<string | null> {
  let exited = false
  const resp = await prompts({
    type: 'autocomplete',
    name: 'value',
    message,
    choices,
    limit: 15,
    suggest: async (input, items) => {
      const terms = String(input).toLowerCase().split(/\s+/).filter(Boolean)
      if (terms.length === 0) return items
      return items.filter(
        (choice) =>
          (pinned?.has(String(choice.value)) ?? false) ||
          terms.every((term) => choice.title.toLowerCase().includes(term)),
      )
    },
    onState: (state: PromptState) => {
      if (state.exited) exited = true
    },
  })
  if (exited || typeof resp.value !== 'string') return null
  return resp.value
}

export function registerHistoryCommand(program: Command): void {
  // `--output` only: `--show` prints its payload and the interactive editor
  // needs a terminal, so there is no scriptable chatter for `--quiet`.
  addOutputOption(
    program
      .command('history')
      .description(t('help.history.description'))
      .argument('[listName]', t('help.history.listName'))
      .option('--deck', t('help.history.deck'))
      .option('--collection', t('help.history.collection'))
      .option('--wanted', t('help.history.wanted'))
      .option('--show', t('help.history.show'), false)
      .option('--limit <n>', t('help.history.limit'), parseLimitFlag),
  ).action(async (listNameArg: string | undefined, options: HistoryOptions) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    const type = listTypeFromFlags(options)
    if (type === 'conflict') {
      emitError(
        'usage_error',
        t('cli.history.typeFlagConflict'),
        scripting,
        undefined,
        'cli.history.typeFlagConflict',
      )
      process.exitCode = ExitCode.UsageError
      return
    }

    if (options.limit !== undefined && !options.show) {
      emitError(
        'usage_error',
        t('cli.history.limitRequiresShow'),
        scripting,
        undefined,
        'cli.history.limitRequiresShow',
      )
      process.exitCode = ExitCode.UsageError
      return
    }

    // Structured output belongs to the read-only fork: the editor writes prompt
    // UI to stdout, so `history <list> --output json` without --show could only
    // ever produce ANSI noise where a payload was expected.
    if (options.output !== undefined && options.output !== 'text' && !options.show) {
      emitError(
        'usage_error',
        t('cli.history.outputRequiresShow', { output: options.output }),
        scripting,
        undefined,
        'cli.history.outputRequiresShow',
      )
      process.exitCode = ExitCode.UsageError
      return
    }

    // Both forks can need a prompt: --show without a list name opens the list
    // picker, and the editor is interactive from its first screen. Refuse up
    // front rather than exiting 0 having done nothing.
    await runCommandAction(scripting, async () => {
      if (listNameArg === undefined) requireInteractive('a list name')
      if (!options.show && promptsUnavailable()) {
        throw inputRequiredError(t('cli.history.noEditorHeadless'))
      }

      const location = await resolveLocation(listNameArg, type, scripting)
      if (!location) return

      if (options.show) {
        await runHistoryShow(location, options.limit, scripting)
        return
      }

      await runHistoryEditor(location)
    })
  })
}

/**
 * The `--show` JSON payload. Deliberately the same shape as the admin
 * `GET /api/history/:type/:slug` response (`HistoryLoadResponse` in
 * `src/admin/api/history.ts`) minus its `success` and `defaultLines` fields.
 */
type HistoryShowResult = {
  /** Everything before the first change set (e.g. `# Changelog for My Deck`). */
  header: string
  /** Change sets, newest first (truncated to `--limit` when given). */
  sets: ChangeSet[]
}

/** The read-only `--show` fork: print the change history and return. */
async function runHistoryShow(
  location: ListLocation,
  limit: number | undefined,
  scripting: ScriptingOptions,
): Promise<void> {
  const changesPath = changesPathFor(location.filePath)
  let content = ''
  try {
    content = await fs.readFile(changesPath, 'utf-8')
  } catch {
    // No changelog yet — an empty history.
  }
  const parsed = parseChangeSets(content, location.name)
  const allSets = sortNewestFirst(parsed.sets)
  const sets = limit === undefined ? allSets : allSets.slice(0, limit)

  if (scripting.output !== 'text') {
    const result: HistoryShowResult = { header: parsed.header, sets }
    emitOutput(result, scripting)
    return
  }

  if (allSets.length === 0) {
    emitOutput(t('cli.history.noHistory'), scripting)
    return
  }

  const lines: string[] = [
    t('cli.history.heading', {
      type: location.type,
      name: location.name,
      sets: t('cli.history.setCount', { count: allSets.length }),
    }),
  ]
  for (const set of sets) {
    lines.push('', `${setHeading(set)}:`)
    for (const line of set.lines) lines.push(`  ${line}`)
    for (const line of set.trailing ?? []) lines.push(`  ${line}`)
  }
  emitOutput(lines.join('\n'), scripting)
}

/**
 * Resolve the target list: by name when given, otherwise via an interactive
 * picker over the lists in scope. Prints an error and sets the exit code on
 * failure; returns null when resolution fails or the user cancels.
 */
async function resolveLocation(
  listName: string | undefined,
  type: ListType | undefined,
  scripting: ScriptingOptions,
): Promise<ListLocation | null> {
  if (listName !== undefined) {
    const resolved = await resolveList(listName, type)
    if (isResolveListError(resolved)) {
      // `history --show --output json` must fail through the structured channel
      // like every other scripted command; the command registers the type flags.
      emitResolveListError(resolved, scripting, 'type-flags')
      return null
    }
    return resolved
  }

  const locations = await listLocations(type)
  if (locations.length === 0) {
    const messageKey = type ? 'cli.history.noListsOfType' : 'errors.resolveList.noLists'
    emitError(
      'not_found',
      type ? t('cli.history.noListsOfType', { type }) : t('errors.resolveList.noLists'),
      scripting,
      undefined,
      messageKey,
    )
    process.exitCode = ExitCode.NotFound
    return null
  }

  const choice = await autocompleteMenu(
    t('cli.history.promptSelectList'),
    locations.map((loc, i) => ({
      title: t('cli.history.listRow', { name: loc.name, type: listTypeLabel(loc.type) }),
      value: String(i),
    })),
  )
  if (choice === null) return null
  return locations[Number(choice)] ?? null
}

export type EditorState = {
  readonly header: string
  sets: ChangeSet[]
  readonly originalSerialized: string
  readonly undoStack: ChangeSet[][]
}

async function runHistoryEditor(location: ListLocation): Promise<void> {
  const changesPath = changesPathFor(location.filePath)
  let content = ''
  try {
    content = await fs.readFile(changesPath, 'utf-8')
  } catch {
    // No changelog yet — start from an empty history.
  }
  const parsed = parseChangeSets(content, location.name)

  const state: EditorState = {
    header: parsed.header,
    sets: sortNewestFirst(parsed.sets),
    originalSerialized: serializeChangeSets(parsed),
    undoStack: [],
  }

  console.log(
    `\n${t('cli.history.heading', {
      type: location.type,
      name: location.name,
      sets: t('cli.history.setCount', { count: state.sets.length }),
    })}`,
  )

  while (true) {
    const choice = await autocompleteMenu(
      t('cli.history.promptMain'),
      buildMainChoices(state),
      MAIN_ACTION_VALUES,
    )
    // ESC at the top level behaves like Exit.
    const selection = choice ?? '__exit__'

    if (selection === '__exit__') {
      const done = await handleExit(state, changesPath)
      if (done) return
      continue
    }
    if (selection === '__rewrite__') {
      await handleRewrite(state, location)
      continue
    }
    if (selection === '__preview__') {
      await handlePreview(state)
      continue
    }
    if (selection === '__undo__') {
      handleUndo(state)
      continue
    }
    if (selection.startsWith('set:')) {
      await handleSet(state, Number(selection.slice(4)))
      continue
    }
  }
}

const MAIN_ACTION_VALUES: ReadonlySet<string> = new Set([
  '__rewrite__',
  '__preview__',
  '__undo__',
  '__exit__',
])

export function buildMainChoices(state: EditorState): prompts.Choice[] {
  const setChoices: prompts.Choice[] = state.sets.map((s, i) => ({
    title: setHeading(s),
    value: `set:${i}`,
  }))

  // Undo first (it takes back whatever you just did), then the safe review
  // action, and only then the one item that rewrites every set — a destructive
  // action must never sit above the harmless ones.
  const actions: prompts.Choice[] = []
  if (state.undoStack.length > 0) {
    actions.push({
      title: `↩️  ${t('cli.history.undoLast', { count: state.undoStack.length })}`,
      value: '__undo__',
    })
  }
  actions.push(
    { title: `🔍 ${t('cli.history.preview')}`, value: '__preview__' },
    { title: `🔄 ${t('cli.history.rewrite')}`, value: '__rewrite__' },
    { title: `🚪 ${t('cli.menu.exit')}`, value: '__exit__' },
  )

  return [...setChoices, ...actions]
}

function pushUndo(state: EditorState): void {
  state.undoStack.push(cloneSets(state.sets))
}

function hasUnsavedChanges(state: EditorState): boolean {
  return (
    serializeChangeSets({ header: state.header, sets: state.sets }) !== state.originalSerialized
  )
}

/** Show one change set's lines, then offer the per-set actions. */
async function handleSet(state: EditorState, index: number): Promise<void> {
  const set = state.sets[index]
  if (!set) return

  console.log(`\n${setHeading(set)}:`)
  for (const line of set.lines) console.log(`  ${line}`)
  if (set.trailing !== undefined && set.trailing.length > 0) {
    // Preserved hand-written text — it travels with the set (and is deleted with it).
    for (const line of set.trailing) console.log(`  ${line}`)
  }
  console.log('')

  const action = await selectMenu(t('cli.history.promptSetAction'), [
    { title: `➖ ${t('cli.history.deleteSet')}`, value: 'delete' },
    { title: `🔗 ${t('cli.history.combineSet')}`, value: 'combine' },
    { title: `✏️  ${t('cli.history.editTimestamp')}`, value: 'retime' },
    { title: `← ${t('cli.menu.back')}`, value: 'back' },
  ])

  if (action === 'delete') {
    pushUndo(state)
    state.sets = sortNewestFirst(deleteSetAt(state.sets, index))
    console.log(t('cli.history.setDeleted'))
  } else if (action === 'combine') {
    await handleCombine(state, index)
  } else if (action === 'retime') {
    await handleRetime(state, index)
  }
}

async function handleCombine(state: EditorState, targetIndex: number): Promise<void> {
  const others = state.sets.map((s, i) => ({ s, i })).filter(({ i }) => i !== targetIndex)
  if (others.length === 0) {
    console.log(t('cli.history.noOtherSet'))
    return
  }

  const choice = await autocompleteMenu(
    t('cli.history.promptCombine'),
    others.map(({ s, i }) => ({ title: setHeading(s), value: String(i) })),
  )
  if (choice === null) return

  pushUndo(state)
  state.sets = sortNewestFirst(combineSetsInto(state.sets, targetIndex, Number(choice)))
  console.log(t('cli.history.setsCombined'))
}

async function handleRetime(state: EditorState, index: number): Promise<void> {
  const set = state.sets[index]
  if (!set) return

  let exited = false
  const resp = await prompts({
    type: 'text',
    name: 'timestamp',
    message: t('cli.history.promptTimestamp'),
    initial: set.timestamp,
    validate: (value: string) =>
      isValidIso8601(value.trim()) ? true : t('cli.history.timestampInvalid'),
    onState: (state: PromptState) => {
      if (state.exited) exited = true
    },
  })
  if (exited || typeof resp.timestamp !== 'string') return

  const next = resp.timestamp.trim()
  if (next === set.timestamp) return

  pushUndo(state)
  state.sets = sortNewestFirst(retimeSetAt(state.sets, index, next))
  console.log(t('cli.history.timestampUpdated'))
}

async function handleRewrite(state: EditorState, location: ListLocation): Promise<void> {
  // Rewrite discards every set — including any preserved hand-written text
  // attached to them. Say so up front rather than losing it silently.
  const droppedProse = state.sets.reduce((n, s) => n + (s.trailing?.length ?? 0), 0)
  const proseWarning =
    droppedProse > 0 ? ` ${t('cli.history.proseWarning', { count: droppedProse })}` : ''
  const confirm = await selectMenu(t('cli.history.confirmRewrite', { warning: proseWarning }), [
    { title: `✅ ${t('cli.history.rewriteYes')}`, value: 'yes' },
    { title: `← ${t('cli.history.rewriteNo')}`, value: 'no' },
  ])
  if (confirm !== 'yes') return

  const snapshot = await loadListSnapshot(location.type, location.filePath)
  const lines = buildDefaultChangeLines(snapshot)
  if (lines.length === 0) {
    console.log(t('cli.history.emptyList'))
    return
  }

  pushUndo(state)
  state.sets = [{ timestamp: new Date().toISOString(), lines }]
  console.log(t('cli.history.rewrote', { count: lines.length }))
}

function handleUndo(state: EditorState): void {
  const previous = state.undoStack.pop()
  if (!previous) {
    console.log(t('cli.history.nothingToUndo'))
    return
  }
  state.sets = sortNewestFirst(previous)
  console.log(t('cli.history.reverted'))
}

async function handlePreview(state: EditorState): Promise<void> {
  const original = parseChangeSets(state.originalSerialized, state.header)
  const originalLineCount = original.sets.reduce((n, s) => n + s.lines.length, 0)
  const currentLineCount = state.sets.reduce((n, s) => n + s.lines.length, 0)

  console.log(`\n${t('cli.history.previewHeading')}`)
  console.log(
    t('cli.history.previewSets', { before: original.sets.length, after: state.sets.length }),
  )
  console.log(t('cli.history.previewLines', { before: originalLineCount, after: currentLineCount }))
  if (!hasUnsavedChanges(state)) {
    console.log(t('cli.history.noPending'))
  }
  console.log(`\n${t('cli.history.resultingSets')}`)
  if (state.sets.length === 0) {
    console.log(`  ${t('cli.history.noneEmptied')}`)
  }
  for (const set of state.sets) {
    console.log(`  ${setHeading(set)}`)
  }
  console.log('')

  await selectMenu(t('cli.history.promptDonePreview'), [
    { title: `←  ${t('cli.history.backToMenu')}`, value: 'back' },
  ])
}

/** Returns true when the editor should exit (saved or discarded), false to keep editing. */
async function handleExit(state: EditorState, changesPath: string): Promise<boolean> {
  if (!hasUnsavedChanges(state)) {
    console.log(t('cli.history.noChangesToSave'))
    return true
  }

  const choice = await promptExitMenu()

  if (choice === 'save') {
    await fs.writeFile(changesPath, serializeChangeSets({ header: state.header, sets: state.sets }))
    console.log(t('cli.history.saved', { count: state.sets.length, file: changesPath }))
    return true
  }
  if (choice === 'discard') {
    console.log(t('cli.history.discardedAll'))
    return true
  }
  // Cancel / ESC — keep editing.
  return false
}
