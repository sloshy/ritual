import type { Choice } from 'prompts'
import type { ChangeEvent } from '../change-event'
import {
  createCardSessionContext,
  promptSessionConfigUpdate,
  type CardChoiceInput,
  type CardSessionContext,
  type CardSessionStrategy,
  type EditableEntryItem,
  type SessionAddItem,
  type SessionChangeItem,
  type SessionConfig,
} from './card-session'
import { hasUnsavedChanges, listRefLabel, type OpenList } from './edit-lists'
import { ask, suggestByTitleTerms } from './prompts-helpers'

/**
 * The All Lists mode of the unified `edit` command: one card session spanning
 * every list at once. It is a {@link CardSessionStrategy} that owns no list of
 * its own and instead routes each operation to one of the open per-list
 * strategies, always handing that list its own {@link CardSessionContext} so
 * pending changes, undo stacks, and changelogs stay attributed to the right file.
 *
 * Adding a card asks which list to add it to and then runs that list's normal
 * add flow, so e.g. a deck may take a name-only card while a collection still
 * demands a printing. Edit mode autocompletes over every list's entries at once.
 */

export const ALL_LISTS_LABEL = 'All Lists'
export const ALL_LISTS_ICON = '🗃️'

/**
 * Which list the next add-mode shortcut acts on, and which list owns the most
 * recent edit-mode operation. Kept outside the strategy so the pointers survive
 * leaving All Lists mode for a single list and coming back.
 */
export type AllListsState = {
  /** File path of the list the last card was added to, or null before the first add. */
  activeFile: string | null
  /** File path of the list the last edit-mode operation ran against. */
  lastEditFile: string | null
}

export function createAllListsState(): AllListsState {
  return { activeFile: null, lastEditFile: null }
}

/** A card session over every list, plus the context provider the engine re-reads. */
export type AllListsSession = {
  strategy: CardSessionStrategy
  /** The active list's context, or a scratch one before the first add. */
  ctx: () => CardSessionContext
}

export type AllListsStrategyArgs = {
  /** Every list, already opened into a live session (edit mode enumerates them all). */
  lists: OpenList[]
  sessionConfig: SessionConfig
  /** Persist every open list, exactly as the Save item does. */
  saveAll: () => Promise<void>
  state: AllListsState
}

/** Where an entry offered in the cross-list edit picker actually lives. */
type EntryTarget = { open: OpenList; cardId: number }
/** Where a change shown in the cross-list session-changes picker actually lives. */
type ChangeTarget = { open: OpenList; index: number }

/** Prompt for the list a card should be added to. Returns undefined when cancelled. */
async function promptTargetList(lists: OpenList[]): Promise<OpenList | undefined> {
  return ask<OpenList>({
    type: 'autocomplete',
    message: 'Add to which list?',
    choices: lists.map((open): Choice => ({ title: listRefLabel(open.ref), value: open })),
    limit: 12,
    suggest: suggestByTitleTerms,
  })
}

export function createAllListsSession(args: AllListsStrategyArgs): AllListsSession {
  const { lists, sessionConfig, saveAll, state } = args

  // Stands in for the active list's context until the first add. Nothing writes
  // to it: the engine only reads `lastAdded` and the change count off it.
  const scratchCtx = createCardSessionContext()

  const byFile = (file: string | null): OpenList | undefined =>
    file === null ? undefined : lists.find((open) => open.ref.file === file)
  const activeList = (): OpenList | undefined => byFile(state.activeFile)
  const lastEditList = (): OpenList | undefined => byFile(state.lastEditFile)
  const activeCtx = (): CardSessionContext => activeList()?.ctx ?? scratchCtx

  // Rebuilt every time the pickers are rendered, immediately before the engine
  // resolves a selection against them, so a stale key can never be chosen.
  const entryTargets = new Map<number, EntryTarget>()
  let nextEntryKey = 1
  let changeTargets: ChangeTarget[] = []

  const strategy: CardSessionStrategy = {
    managerLabel: 'editor',
    // No file of its own: the engine's Save routes to the multi-list `saveAll`,
    // which writes each open list to its own file and changelog.
    saveTarget: null,
    sessionConfig,

    updateConfig: (excludeDigital: boolean) =>
      promptSessionConfigUpdate(sessionConfig, true, excludeDigital),

    // The engine applies a note to the last added card itself, so both of these
    // belong to whichever list that card was added to.
    applyChange: (change: ChangeEvent) => activeList()?.strategy.applyChange(change),
    noteAdded: (note: string) => activeList()?.strategy.noteAdded?.(note),

    persist: saveAll,
    hasUnsavedChanges: () => lists.some(hasUnsavedChanges),
    sessionSaved: () => {
      for (const open of lists) open.strategy.sessionSaved()
    },

    async handleCard(_ctx: CardSessionContext, input: CardChoiceInput): Promise<void> {
      // Editing the previous card stays in the list that card was added to;
      // only a fresh add asks where it should go.
      if (input.isEditing) {
        const open = activeList()
        if (open) await open.strategy.handleCard(open.ctx, input)
        return
      }
      const open = await promptTargetList(lists)
      if (!open) {
        console.log('No list selected. Skipping.')
        return
      }
      state.activeFile = open.ref.file
      await open.strategy.handleCard(open.ctx, input)
    },

    async addAnotherCopy(_ctx: CardSessionContext): Promise<void> {
      const open = activeList()
      if (open) await open.strategy.addAnotherCopy(open.ctx)
    },

    // The engine only ever offers to undo the *last* add, and every add sets the
    // active list, so the active list's adds are the only ones it can reach.
    listSessionAdds: (): SessionAddItem[] => activeList()?.strategy.listSessionAdds?.() ?? [],

    async discardSessionAdd(_ctx: CardSessionContext, index: number): Promise<void> {
      const open = activeList()
      if (open) await open.strategy.discardSessionAdd?.(open.ctx, index)
    },

    listSessionChanges: (): SessionChangeItem[] => {
      changeTargets = []
      const items: SessionChangeItem[] = []
      for (const open of lists) {
        open.strategy.listSessionChanges().forEach((item, index) => {
          changeTargets.push({ open, index })
          items.push({ ...item, label: `${listRefLabel(open.ref)}: ${item.label}` })
        })
      }
      return items
    },

    async discardSessionChange(_ctx: CardSessionContext, index: number): Promise<void> {
      const target = changeTargets[index]
      if (!target) return
      await target.open.strategy.discardSessionChange(target.open.ctx, target.index)
    },

    listEntries: (): EditableEntryItem[] => {
      entryTargets.clear()
      const items: EditableEntryItem[] = []
      for (const open of lists) {
        for (const entry of open.strategy.listEntries()) {
          // Card ids are only unique within a list, so the picker gets a synthetic
          // key that resolves back to the owning list.
          const key = nextEntryKey++
          entryTargets.set(key, { open, cardId: entry.cardId })
          items.push({ label: `${listRefLabel(open.ref)}: ${entry.label}`, cardId: key })
        }
      }
      return items
    },

    async editEntry(_ctx: CardSessionContext, entryKey: number): Promise<void> {
      const target = entryTargets.get(entryKey)
      if (!target) return
      state.lastEditFile = target.open.ref.file
      await target.open.strategy.editEntry(target.open.ctx, target.cardId)
    },

    lastEditUndoLabel: (): string | null => {
      const open = lastEditList()
      if (!open) return null
      const label = open.strategy.lastEditUndoLabel()
      return label === null ? null : `${listRefLabel(open.ref)}: ${label}`
    },

    async undoLastEdit(_ctx: CardSessionContext): Promise<void> {
      const open = lastEditList()
      if (open) await open.strategy.undoLastEdit(open.ctx)
    },
  }

  return { strategy, ctx: activeCtx }
}
