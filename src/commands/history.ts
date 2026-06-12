import { Command } from 'commander'
import prompts from 'prompts'
import * as fs from 'node:fs/promises'
import type { PromptState } from './prompts-types'
import {
  formatResolveListError,
  isResolveListError,
  listLocations,
  listTypeFromFlags,
  resolveList,
  type ListLocation,
  type ListTypeFlags,
} from '../resolve-list'
import { LIST_TYPE_DISPLAY, type ListType } from '../list-type'
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
import { promptExitMenu } from './prompts-helpers'

type HistoryOptions = ListTypeFlags

function listTypeLabel(type: ListType): string {
  return LIST_TYPE_DISPLAY[type].label.replace(/s$/, '')
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
  program
    .command('history')
    .description('Compact and rewrite the change history for a deck, collection, or wanted list')
    .argument(
      '[listName]',
      'Name of the deck, collection, or wanted list (resolved across all types unless a type flag is given)',
    )
    .option('--deck', 'Resolve the name as a deck')
    .option('--collection', 'Resolve the name as a collection')
    .option('--wanted', 'Resolve the name as a wanted list')
    .action(async (listNameArg: string | undefined, options: HistoryOptions) => {
      const type = listTypeFromFlags(options)
      if (type === 'conflict') {
        console.error('Specify only one of --deck, --collection, or --wanted.')
        process.exitCode = 2
        return
      }

      const location = await resolveLocation(listNameArg, type)
      if (!location) return

      await runHistoryEditor(location)
    })
}

/**
 * Resolve the target list: by name when given, otherwise via an interactive
 * picker over the lists in scope. Prints an error and sets the exit code on
 * failure; returns null when resolution fails or the user cancels.
 */
async function resolveLocation(
  listName: string | undefined,
  type: ListType | undefined,
): Promise<ListLocation | null> {
  if (listName !== undefined) {
    const resolved = await resolveList(listName, type)
    if (isResolveListError(resolved)) {
      console.error(formatResolveListError(resolved))
      process.exitCode = resolved.kind === 'ambiguous' ? 2 : 3
      return null
    }
    return resolved
  }

  const locations = await listLocations(type)
  if (locations.length === 0) {
    console.error(
      type
        ? `No ${listTypeLabel(type).toLowerCase()} lists found.`
        : 'No decks, collections, or wanted lists found.',
    )
    process.exitCode = 3
    return null
  }

  const choice = await autocompleteMenu(
    'Select a list (type to filter):',
    locations.map((loc, i) => ({
      title: `${loc.name} — ${listTypeLabel(loc.type)}`,
      value: String(i),
    })),
  )
  if (choice === null) return null
  return locations[Number(choice)] ?? null
}

type EditorState = {
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
    `\nChange history for ${listTypeLabel(location.type)} '${location.name}' — ${state.sets.length} change set(s).`,
  )

  while (true) {
    const choice = await autocompleteMenu(
      'Change history (type to filter sets):',
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

function buildMainChoices(state: EditorState): prompts.Choice[] {
  const setChoices: prompts.Choice[] = state.sets.map((s, i) => ({
    title: `${s.timestamp}  (${s.lines.length} change${s.lines.length === 1 ? '' : 's'})`,
    value: `set:${i}`,
  }))

  const actions: prompts.Choice[] = [
    { title: '🔄 Rewrite all change sets with defaults', value: '__rewrite__' },
    { title: '🔍 Preview changes to be saved', value: '__preview__' },
  ]
  if (state.undoStack.length > 0) {
    actions.push({ title: `↩️  Undo last change (${state.undoStack.length})`, value: '__undo__' })
  }
  actions.push({ title: '🚪 Exit', value: '__exit__' })

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

  console.log(
    `\n${set.timestamp}  (${set.lines.length} change${set.lines.length === 1 ? '' : 's'}):`,
  )
  for (const line of set.lines) console.log(`  ${line}`)
  console.log('')

  const action = await selectMenu('Action for this change set:', [
    { title: '➖ Delete this change set', value: 'delete' },
    { title: '🔗 Combine with another change set', value: 'combine' },
    { title: '✏️  Edit timestamp', value: 'retime' },
    { title: '← Back', value: 'back' },
  ])

  if (action === 'delete') {
    pushUndo(state)
    state.sets = sortNewestFirst(deleteSetAt(state.sets, index))
    console.log('Change set deleted (in memory).')
  } else if (action === 'combine') {
    await handleCombine(state, index)
  } else if (action === 'retime') {
    await handleRetime(state, index)
  }
}

async function handleCombine(state: EditorState, targetIndex: number): Promise<void> {
  const others = state.sets.map((s, i) => ({ s, i })).filter(({ i }) => i !== targetIndex)
  if (others.length === 0) {
    console.log('No other change set to combine with.')
    return
  }

  const choice = await autocompleteMenu(
    'Combine with which other set (type to filter)? Its entries move in, then it is deleted:',
    others.map(({ s, i }) => ({
      title: `${s.timestamp}  (${s.lines.length} change${s.lines.length === 1 ? '' : 's'})`,
      value: String(i),
    })),
  )
  if (choice === null) return

  pushUndo(state)
  state.sets = sortNewestFirst(combineSetsInto(state.sets, targetIndex, Number(choice)))
  console.log('Change sets combined (in memory).')
}

async function handleRetime(state: EditorState, index: number): Promise<void> {
  const set = state.sets[index]
  if (!set) return

  let exited = false
  const resp = await prompts({
    type: 'text',
    name: 'timestamp',
    message: 'New ISO-8601 timestamp:',
    initial: set.timestamp,
    validate: (value: string) =>
      isValidIso8601(value.trim())
        ? true
        : 'Must be a valid ISO-8601 timestamp (e.g. 2026-05-29T12:00:00.000Z).',
    onState: (state: PromptState) => {
      if (state.exited) exited = true
    },
  })
  if (exited || typeof resp.timestamp !== 'string') return

  const next = resp.timestamp.trim()
  if (next === set.timestamp) return

  pushUndo(state)
  state.sets = sortNewestFirst(retimeSetAt(state.sets, index, next))
  console.log('Timestamp updated (in memory).')
}

async function handleRewrite(state: EditorState, location: ListLocation): Promise<void> {
  const confirm = await selectMenu(
    'Replace ALL change sets with a single set describing the list as it stands now?',
    [
      { title: '✅ Yes, rewrite with defaults', value: 'yes' },
      { title: '← No, cancel', value: 'no' },
    ],
  )
  if (confirm !== 'yes') return

  const snapshot = await loadListSnapshot(location.type, location.filePath)
  const lines = buildDefaultChangeLines(snapshot)
  if (lines.length === 0) {
    console.log('The list is empty — nothing to rewrite.')
    return
  }

  pushUndo(state)
  state.sets = [{ timestamp: new Date().toISOString(), lines }]
  console.log(
    `Rewrote history as a single change set with ${lines.length} entr(y/ies) (in memory).`,
  )
}

function handleUndo(state: EditorState): void {
  const previous = state.undoStack.pop()
  if (!previous) {
    console.log('Nothing to undo.')
    return
  }
  state.sets = sortNewestFirst(previous)
  console.log('Reverted the last change.')
}

async function handlePreview(state: EditorState): Promise<void> {
  const original = parseChangeSets(state.originalSerialized, state.header)
  const originalLineCount = original.sets.reduce((n, s) => n + s.lines.length, 0)
  const currentLineCount = state.sets.reduce((n, s) => n + s.lines.length, 0)

  console.log('\n── Preview of changes to be saved ──')
  console.log(`Change sets: ${original.sets.length} → ${state.sets.length}`)
  console.log(`Change lines: ${originalLineCount} → ${currentLineCount}`)
  if (!hasUnsavedChanges(state)) {
    console.log('No changes pending — the file would be written unchanged.')
  }
  console.log('\nResulting change sets (newest first):')
  if (state.sets.length === 0) {
    console.log('  (none — the changelog would be emptied)')
  }
  for (const set of state.sets) {
    console.log(
      `  ${set.timestamp}  (${set.lines.length} change${set.lines.length === 1 ? '' : 's'})`,
    )
  }
  console.log('')

  await selectMenu('Done previewing?', [{ title: '←  Back to menu', value: 'back' }])
}

/** Returns true when the editor should exit (saved or discarded), false to keep editing. */
async function handleExit(state: EditorState, changesPath: string): Promise<boolean> {
  if (!hasUnsavedChanges(state)) {
    console.log('No changes to save.')
    return true
  }

  const choice = await promptExitMenu()

  if (choice === 'save') {
    await fs.writeFile(changesPath, serializeChangeSets({ header: state.header, sets: state.sets }))
    console.log(`Saved ${state.sets.length} change set(s) to ${changesPath}`)
    return true
  }
  if (choice === 'discard') {
    console.log('Discarded all changes.')
    return true
  }
  // Cancel / ESC — keep editing.
  return false
}
