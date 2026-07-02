import { Command } from 'commander'
import path from 'node:path'
import type { Choice } from 'prompts'
import { LIST_TYPES, LIST_TYPE_DISPLAY, listTypeLabel, type ListType } from '../list-type'
import { dirForType } from '../resolve-list'
import { matchesAllTerms } from '../term-match'
import { parseSetCodesInput } from '../set-codes'
import {
  applyCacheRefreshOptions,
  buildInitialSessionConfig,
  confirmMultiListExit,
  createCardSessionContext,
  listMarkdownNames,
  prepareCardSessionCache,
  resetCardSessionTracking,
  runCardSession,
  saveCardSession,
  type CacheRefreshOptions,
  type CardSessionContext,
  type CardSessionStrategy,
  type MultiListSessionControls,
} from './card-session'
import { ask } from './prompts-helpers'
import { ensureCollectionFile } from './collection-helpers'
import { ensureWantedListFile } from './wanted-helpers'
import {
  ensureDeckFile,
  listExistingDecks,
  loadDeck,
  promptDeckFormat,
  type DeckSessionConfig,
} from './deck-helpers'
import { loadCollectionSession, loadWantedSession } from './flat-list-session'
import { createCollectionStrategy } from './collection-strategy'
import { createWantedStrategy } from './wanted-strategy'
import { createDeckStrategy } from './deck-strategy'

/**
 * The unified `edit` command: one interactive editor over every list type. It
 * fronts the shared card-session engine with a cross-type list selection menu
 * and a per-type strategy for each opened list. Each opened list keeps its
 * in-memory session (pending changes included) when the user backs out to the
 * menu, so edits can span several lists before a single save.
 */

type EditCommandOptions = CacheRefreshOptions & {
  sets?: string
  finish?: string
  condition?: string
  section?: string
  collector?: boolean
  allowDigitalOnlyCards?: boolean
}

/** One list offered in the unified selection menu. `name` is its display name. */
export type UnifiedListRef = { type: ListType; name: string; file: string }

/** The unified selection menu resolves to a list, a create-new action, or exit. */
export type UnifiedSelection =
  | { kind: 'open'; list: UnifiedListRef }
  | { kind: 'new'; type: ListType }
  | { kind: 'exit' }

/** An opened list's live editing state, kept while the user is in other lists. */
type OpenList = {
  ref: UnifiedListRef
  strategy: CardSessionStrategy
  ctx: CardSessionContext
}

/** Pending-change counts for the selection menu badges, keyed by list file path. */
export type PendingChangesByFile = Map<string, number>

const NEW_LIST_TITLES: Record<ListType, string> = {
  deck: '➕ New Deck',
  collection: '➕ New Collection',
  wanted: '➕ New Wanted List',
}

/**
 * Build the unified selection menu: every list grouped by type (each with its
 * type icon, plus an unsaved-changes badge for open lists), then the three
 * create-new items and Exit.
 */
export function buildListSelectionChoices(
  refs: UnifiedListRef[],
  pending: PendingChangesByFile,
): Choice[] {
  const listChoices = LIST_TYPES.flatMap((type) =>
    refs
      .filter((ref) => ref.type === type)
      .map((ref): Choice => {
        const count = pending.get(ref.file) ?? 0
        const badge = count > 0 ? ` — ${count} unsaved change(s)` : ''
        return {
          title: `${LIST_TYPE_DISPLAY[type].icon} ${ref.name}${badge}`,
          value: { kind: 'open', list: ref } satisfies UnifiedSelection,
        }
      }),
  )
  return [
    ...listChoices,
    ...LIST_TYPES.map(
      (type): Choice => ({
        title: NEW_LIST_TITLES[type],
        value: { kind: 'new', type } satisfies UnifiedSelection,
      }),
    ),
    { title: '🚪 Exit', value: { kind: 'exit' } satisfies UnifiedSelection },
  ]
}

/** Enumerate every list on disk for the selection menu (decks by display name). */
async function collectListRefs(): Promise<UnifiedListRef[]> {
  const decks = await listExistingDecks()
  const collections = await listMarkdownNames(dirForType('collection'))
  const wanted = await listMarkdownNames(dirForType('wanted'))
  return [
    ...decks.map((d): UnifiedListRef => ({ type: 'deck', name: d.name, file: d.file })),
    ...collections.map(
      (name): UnifiedListRef => ({
        type: 'collection',
        name,
        file: path.join(dirForType('collection'), `${name}.md`),
      }),
    ),
    ...wanted.map(
      (name): UnifiedListRef => ({
        type: 'wanted',
        name,
        file: path.join(dirForType('wanted'), `${name}.md`),
      }),
    ),
  ]
}

/**
 * Prompt for the next list to edit. Returns undefined when the prompt is
 * cancelled (Esc / Ctrl-C), which the caller treats like picking Exit.
 */
async function promptListToEdit(choices: Choice[]): Promise<UnifiedSelection | undefined> {
  return ask<UnifiedSelection>({
    type: 'autocomplete',
    message: 'Select a list to edit',
    choices,
    limit: 12,
    // Term-match on the whole title: the default prefix filter would never
    // match because every list title starts with its type icon.
    suggest: async (rawInput, suggestChoices) => {
      const input = String(rawInput)
      if (!input) return suggestChoices
      return suggestChoices.filter((choice) => matchesAllTerms(choice.title, input))
    },
  })
}

/** Prompt for a new list's name. Returns null when cancelled or empty. */
async function promptNewListName(type: ListType): Promise<string | null> {
  const name = await ask<string>({
    type: 'text',
    message: `Enter name for new ${listTypeLabel(type)}:`,
    validate: (value: string) => (value.length > 0 ? true : 'Name cannot be empty'),
  })
  return name ?? null
}

/**
 * Prompt for a new list's remaining details (a format, for decks), create its
 * file, and return its ref. Returns null when a prompt is cancelled. The format
 * only applies to a newly created deck file — an existing deck keeps its own.
 */
async function createListRef(type: ListType, name: string): Promise<UnifiedListRef | null> {
  if (type === 'deck') {
    const format = await promptDeckFormat('commander')
    if (!format) return null
    return { type, name, file: await ensureDeckFile(name, format) }
  }
  const file =
    type === 'collection' ? await ensureCollectionFile(name) : await ensureWantedListFile(name)
  return { type, name, file }
}

/** Load a list into a fresh session and build its type-specific strategy. */
async function openListSession(
  ref: UnifiedListRef,
  sessionConfig: DeckSessionConfig,
  excludeDigitalOnly: boolean,
): Promise<OpenList> {
  const ctx = createCardSessionContext()
  if (ref.type === 'deck') {
    const loaded = await loadDeck(ref.file)
    return {
      ref,
      ctx,
      strategy: createDeckStrategy({
        deckFile: ref.file,
        deckName: ref.name,
        initialDeck: loaded.deck,
        frontMatter: loaded.frontMatter,
        sessionConfig,
        excludeDigitalOnly,
      }),
    }
  }
  if (ref.type === 'collection') {
    const session = await loadCollectionSession(ref.file)
    return {
      ref,
      ctx,
      strategy: createCollectionStrategy(session, sessionConfig, ref.name, excludeDigitalOnly),
    }
  }
  const session = await loadWantedSession(ref.file)
  return {
    ref,
    ctx,
    strategy: createWantedStrategy(session, sessionConfig, ref.name, excludeDigitalOnly),
  }
}

/** Whether an open list has anything unsaved (pending events or a dirty model). */
function hasUnsavedChanges(open: OpenList): boolean {
  return open.ctx.sessionChanges.length > 0 || open.strategy.hasUnsavedChanges()
}

export function registerEditCommand(program: Command): void {
  const editCommand = program
    .command('edit')
    .description('Edit any deck, collection, or wanted list in one interactive session')
    .option('-s, --sets <codes>', 'Filter by set codes (comma-separated, e.g., "FDN, SPG")')
    .option('-f, --finish <finish>', 'Default finish (nonfoil, foil, etched)')
    .option('-c, --condition <condition>', 'Default condition (NM, LP, MP, HP, DMG)')
    .option('--section <name>', 'Add deck cards to this section (otherwise prompts per card)')
    .option('--collector', 'Start in collector number mode')
    .option('--allow-digital-only-cards', 'Include digital-only sets (e.g., Alchemy)')
  applyCacheRefreshOptions(editCommand)
  editCommand.action(async (options: EditCommandOptions) => {
    const parsedSets = options.sets ? parseSetCodesInput(options.sets) : undefined
    const excludeDigitalOnly = !options.allowDigitalOnlyCards

    let cardNames = await prepareCardSessionCache(options, parsedSets, excludeDigitalOnly)
    if (!cardNames) return

    // One config shared by every list, so filters, entry mode, and the deck
    // target section carry over when switching lists mid-session. The wanted
    // strategy's config type omits `condition`, but sharing the full shape is
    // fine — the wanted flow never reads it (same as the `wanted-list` command).
    const sessionConfig: DeckSessionConfig = {
      ...(await buildInitialSessionConfig(options, parsedSets)),
      targetSection: options.section ?? null,
    }

    // Every list opened this session, keyed by file path. Sessions stay open
    // (with their unsaved changes) while the user edits other lists.
    const openLists = new Map<string, OpenList>()
    const unsavedLists = (): OpenList[] => [...openLists.values()].filter(hasUnsavedChanges)

    const multiList: MultiListSessionControls = {
      totalChangeCount: () =>
        [...openLists.values()].reduce((sum, open) => sum + open.ctx.sessionChanges.length, 0),
      listsWithChanges: () => unsavedLists().length,
      hasAnyUnsaved: () => unsavedLists().length > 0,
      saveAll: async (): Promise<void> => {
        for (const open of unsavedLists()) {
          console.log(`Saving ${listTypeLabel(open.ref.type)} "${open.ref.name}"...`)
          await saveCardSession(open.strategy, open.ctx)
          resetCardSessionTracking(open.strategy, open.ctx)
        }
      },
    }

    while (true) {
      const refs = await collectListRefs()
      const pending: PendingChangesByFile = new Map(
        [...openLists.values()].map((open) => [open.ref.file, open.ctx.sessionChanges.length]),
      )
      const selection = await promptListToEdit(buildListSelectionChoices(refs, pending))

      if (!selection || selection.kind === 'exit') {
        if (!(await confirmMultiListExit(multiList))) continue
        return
      }

      let ref: UnifiedListRef
      if (selection.kind === 'new') {
        const name = await promptNewListName(selection.type)
        if (!name) continue
        const created = await createListRef(selection.type, name)
        if (!created) continue
        ref = created
      } else {
        ref = selection.list
      }

      let open = openLists.get(ref.file)
      if (!open) {
        open = await openListSession(ref, sessionConfig, excludeDigitalOnly)
        openLists.set(ref.file, open)
      }

      const result = await runCardSession({
        strategy: open.strategy,
        cardNames,
        excludeDigitalOnly,
        ctx: open.ctx,
        multiList,
      })
      cardNames = result.cardNames
      // The engine already ran the exit menu (save-all / discard / cancel).
      if (result.reason === 'exit') return
    }
  })
}
