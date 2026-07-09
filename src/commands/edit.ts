import { Command } from 'commander'
import type { Choice } from 'prompts'
import { LIST_TYPES, LIST_TYPE_DISPLAY, listTypeLabel, type ListType } from '../list-type'
import { parseSetCodesInput } from '../set-codes'
import {
  applyCacheRefreshOptions,
  buildInitialSessionConfig,
  confirmMultiListExit,
  prepareCardSessionCache,
  resetCardSessionTracking,
  runCardSession,
  saveCardSession,
  type CacheRefreshOptions,
  type MultiListSessionControls,
} from './card-session'
import { ask, suggestByTitleTerms } from './prompts-helpers'
import { ensureCollectionFile } from './collection-helpers'
import { ensureWantedListFile } from './wanted-helpers'
import { ensureDeckFile, promptDeckFormat, type DeckSessionConfig } from './deck-helpers'
import {
  collectListRefs,
  hasUnsavedChanges,
  openListSession,
  type OpenList,
  type UnifiedListRef,
} from './edit-lists'
import {
  ALL_LISTS_ICON,
  ALL_LISTS_LABEL,
  createAllListsSession,
  createAllListsState,
} from './all-lists-strategy'

/**
 * The unified `edit` command: one interactive editor over every list type. It
 * fronts the shared card-session engine with a cross-type list selection menu
 * and a per-type strategy for each opened list. Each opened list keeps its
 * in-memory session (pending changes included) when the user backs out to the
 * menu, so edits can span several lists before a single save.
 *
 * The menu's first item (with two or more lists) opens every list at once — see
 * {@link createAllListsSession}.
 */

type EditCommandOptions = CacheRefreshOptions & {
  sets?: string
  finish?: string
  condition?: string
  section?: string
  collector?: boolean
  allowDigitalOnlyCards?: boolean
}

export type { UnifiedListRef } from './edit-lists'

/** The unified selection menu resolves to a list, every list, a create-new action, or exit. */
export type UnifiedSelection =
  | { kind: 'open'; list: UnifiedListRef }
  | { kind: 'all' }
  | { kind: 'new'; type: ListType }
  | { kind: 'exit' }

/** Pending-change counts for the selection menu badges, keyed by list file path. */
export type PendingChangesByFile = Map<string, number>

const NEW_LIST_TITLES: Record<ListType, string> = {
  deck: '➕ New Deck',
  collection: '➕ New Collection',
  wanted: '➕ New Wanted List',
}

/**
 * Build the unified selection menu: the All Lists item (only worth offering
 * once there are two lists to span), every list grouped by type (each with its
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
    ...(refs.length > 1
      ? [
          {
            title: `${ALL_LISTS_ICON} ${ALL_LISTS_LABEL}`,
            value: { kind: 'all' } satisfies UnifiedSelection,
          },
        ]
      : []),
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
    suggest: suggestByTitleTerms,
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

    const openList = async (ref: UnifiedListRef): Promise<OpenList> => {
      const existing = openLists.get(ref.file)
      if (existing) return existing
      const opened = await openListSession(ref, sessionConfig, excludeDigitalOnly)
      openLists.set(ref.file, opened)
      return opened
    }

    const saveAll = async (): Promise<void> => {
      for (const open of unsavedLists()) {
        console.log(`Saving ${listTypeLabel(open.ref.type)} "${open.ref.name}"...`)
        await saveCardSession(open.strategy, open.ctx)
        resetCardSessionTracking(open.strategy, open.ctx)
      }
    }

    const multiList: MultiListSessionControls = {
      totalChangeCount: () =>
        [...openLists.values()].reduce((sum, open) => sum + open.ctx.sessionChanges.length, 0),
      listsWithChanges: () => unsavedLists().length,
      hasAnyUnsaved: () => unsavedLists().length > 0,
      saveAll,
    }

    // Which list All Lists mode adds to / last edited, kept across re-entry.
    const allListsState = createAllListsState()

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

      if (selection.kind === 'all') {
        // Edit mode autocompletes over every list's entries, so they must all be
        // loaded up front — the engine builds that picker synchronously.
        console.log(`Opening ${refs.length} lists...`)
        const lists: OpenList[] = []
        for (const ref of refs) lists.push(await openList(ref))
        const session = createAllListsSession({
          lists,
          sessionConfig,
          saveAll,
          state: allListsState,
        })
        const result = await runCardSession({
          strategy: session.strategy,
          cardNames,
          excludeDigitalOnly,
          ctx: session.ctx,
          multiList,
          allLists: true,
        })
        cardNames = result.cardNames
        if (result.reason === 'exit') return
        continue
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

      const open = await openList(ref)
      const result = await runCardSession({
        strategy: open.strategy,
        cardNames,
        excludeDigitalOnly,
        ctx: () => open.ctx,
        multiList,
      })
      cardNames = result.cardNames
      // The engine already ran the exit menu (save-all / discard / cancel).
      if (result.reason === 'exit') return
    }
  })
}
