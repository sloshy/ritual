import type { Choice } from 'prompts'
import type { ChangeEvent } from '../changes/change-event'
import { t } from '../i18n/t'
import { LIST_TYPES, LIST_TYPE_DISPLAY, type ListType } from '../list/list-type'
import {
  createCardSessionContext,
  promptSessionConfigUpdate,
  type CardChoiceInput,
  type CardSessionContext,
  type CardSessionStrategy,
  type EditableEntryItem,
  type MenuChoice,
  type MenuSentinel,
  type SessionAddItem,
  type SessionChangeItem,
  type SessionConfig,
} from './card-session'
import { hasUnsavedChanges, newListTitle, type OpenList, type UnifiedListRef } from './edit-lists'
import { listRefTitle } from './edit-move'
import { ask, suggestByTitleTerms } from '../cli/prompts'

/**
 * The multi-list modes of the unified `edit` command: one card session spanning
 * every list at once (All Lists), or every list of one type (All Decks, All
 * Collections, All Wanted Lists). Each is a {@link CardSessionStrategy} that
 * owns no list of its own and instead routes each operation to one of the open
 * per-list strategies, always handing that list its own {@link CardSessionContext}
 * so pending changes, undo stacks, and changelogs stay attributed to the right file.
 *
 * Adding a card asks which list to add it to — offering to create a new list
 * too — and then runs that list's normal add flow, so e.g. a deck may take a
 * name-only card while a collection still demands a printing. Edit mode
 * autocompletes over every in-scope list's entries at once.
 */

/** Which lists a multi-list session spans: every one, or every one of a type. */
export type ListScope = 'all' | ListType

/** Every scope, in the order the selection menu offers them. */
export const LIST_SCOPES: readonly ListScope[] = ['all', ...LIST_TYPES]

/** The scope's menu title, e.g. `🗃️ All Lists` or `🎴 All Decks`. */
export function listScopeTitle(scope: ListScope): string {
  if (scope === 'all') return `🗃️ ${t('cli.scope.allLists')}`
  return `${LIST_TYPE_DISPLAY[scope].icon} ${t('cli.scope.allOfType', { type: scope })}`
}

/** Whether a list belongs to a scope. Every list is in the `all` scope. */
export function inListScope(scope: ListScope, type: ListType): boolean {
  return scope === 'all' || scope === type
}

/**
 * The lists a scope spans. A scoped session never filters for itself: it edits
 * exactly the lists it is handed, so this is what decides that `All Decks` sees
 * only decks.
 */
export function listsInScope(scope: ListScope, refs: UnifiedListRef[]): UnifiedListRef[] {
  return refs.filter((ref) => inListScope(scope, ref.type))
}

/** The list types a new list may be created as, within a scope. */
export function scopeCreatableTypes(scope: ListScope): readonly ListType[] {
  return scope === 'all' ? LIST_TYPES : [scope]
}

/**
 * Which list the next add-mode shortcut acts on, and which list owns the most
 * recent edit-mode operation. Kept outside the strategy so the pointers survive
 * leaving a multi-list mode for a single list and coming back.
 */
export type ScopedSessionState = {
  /** File path of the list the last card was added to, or null before the first add. */
  activeFile: string | null
  /** File path of the list the last edit-mode operation ran against. */
  lastEditFile: string | null
}

export function createScopedSessionState(): ScopedSessionState {
  return { activeFile: null, lastEditFile: null }
}

/** A card session over every list, plus the context provider the engine re-reads. */
export type ScopedSession = {
  strategy: CardSessionStrategy
  /** The active list's context, or a scratch one before the first add. */
  ctx: () => CardSessionContext
}

export type ScopedSessionArgs = {
  /** Which lists the session spans, and which types it can create. */
  scope: ListScope
  /**
   * Every in-scope list, already opened into a live session (edit mode
   * enumerates them all). Re-read on each use, so a list created mid-session
   * joins immediately, and one whose creation is discarded drops back out.
   */
  lists: () => OpenList[]
  /**
   * Create a list of `type` (prompting for its name and, for a deck, its
   * format) and open it. Returns undefined when the user cancels. The list is
   * held in memory only — its file appears when the editor is saved.
   */
  createList: (type: ListType) => Promise<OpenList | undefined>
  sessionConfig: SessionConfig
  /** Persist every open list, exactly as the Save item does. */
  saveAll: () => Promise<boolean>
  state: ScopedSessionState
}

/** Where an entry offered in the cross-list edit picker actually lives. */
type EntryTarget = { open: OpenList; cardId: number }
/** Where a change shown in the cross-list session-changes picker actually lives. */
type ChangeTarget = { open: OpenList; index: number }

/** The destination picked for a card being added: an open list, or a list to create. */
type AddTarget = { kind: 'list'; open: OpenList } | { kind: 'new'; type: ListType }

/**
 * Build the destination choices: every in-scope list, then a create-new item per
 * type the scope allows — just the one, in a single-type scope, since a list
 * created there could only ever be of that type.
 */
export function buildAddTargetChoices(lists: OpenList[], scope: ListScope): Choice[] {
  return [
    ...lists.map(
      (open): Choice => ({
        title: open.isNew()
          ? t('cli.edit.new', { label: listRefTitle(open.ref) })
          : listRefTitle(open.ref),
        value: { kind: 'list', open } satisfies AddTarget,
      }),
    ),
    ...scopeCreatableTypes(scope).map(
      (type): Choice => ({
        title: newListTitle(type),
        value: { kind: 'new', type } satisfies AddTarget,
      }),
    ),
  ]
}

/** Prompt for the list a card should be added to. Returns undefined when cancelled. */
async function promptAddTarget(
  lists: OpenList[],
  scope: ListScope,
): Promise<AddTarget | undefined> {
  return ask<AddTarget>({
    type: 'autocomplete',
    message: t('cli.edit.promptAddTarget'),
    choices: buildAddTargetChoices(lists, scope),
    limit: 12,
    suggest: suggestByTitleTerms,
  })
}

export function createScopedSession(args: ScopedSessionArgs): ScopedSession {
  const { scope, lists, createList, sessionConfig, saveAll, state } = args

  // Stands in for the active list's context until the first add. Nothing writes
  // to it: the engine only reads `lastAdded` and the change count off it.
  const scratchCtx = createCardSessionContext()

  const byFile = (file: string | null): OpenList | undefined =>
    file === null ? undefined : lists().find((open) => open.ref.file === file)
  const activeList = (): OpenList | undefined => byFile(state.activeFile)
  const lastEditList = (): OpenList | undefined => byFile(state.lastEditFile)
  const activeCtx = (): CardSessionContext => activeList()?.ctx ?? scratchCtx

  // Rebuilt every time the pickers are rendered, immediately before the engine
  // resolves a selection against them, so a stale key can never be chosen.
  const entryTargets = new Map<number, EntryTarget>()
  let nextEntryKey = 1
  let changeTargets: ChangeTarget[] = []

  const strategy: CardSessionStrategy = {
    managerLabel: t('cli.manager.editor'),
    // No file of its own: the engine's Save routes to the multi-list `saveAll`,
    // which writes each open list to its own file and changelog.
    saveTarget: null,
    sessionConfig,

    updateConfig: (excludeDigital: boolean) =>
      promptSessionConfigUpdate(sessionConfig, true, excludeDigital),

    // The engine applies a note to the last added card itself, so both of these
    // belong to whichever list that card was added to.
    applyChange: (change: ChangeEvent) => activeList()?.strategy.applyChange(change),
    // Never a move destination: moves target concrete lists, and the save path
    // resolves them against the open per-list sessions, not this aggregate.
    receiveMove: (): void => {},
    noteAdded: (note: string) => activeList()?.strategy.noteAdded?.(note),

    // Per-list session actions (target section, format, tags, default labels)
    // belong to the active list too — the one the last add/edit landed in.
    // Each item names that list, since the menu otherwise spans several.
    extraMenuItems: (): MenuChoice[] => {
      const open = activeList()
      if (!open) return []
      return (open.strategy.extraMenuItems?.() ?? []).map((item) => ({
        ...item,
        title: `${item.title} — ${open.ref.name}`,
      }))
    },
    handleSentinel: async (_ctx: CardSessionContext, value: MenuSentinel): Promise<void> => {
      const open = activeList()
      await open?.strategy.handleSentinel?.(open.ctx, value)
    },

    persist: async (): Promise<void> => {
      await saveAll()
    },
    hasUnsavedChanges: () => lists().some(hasUnsavedChanges),
    sessionSaved: () => {
      for (const open of lists()) open.strategy.sessionSaved()
    },

    async handleCard(_ctx: CardSessionContext, input: CardChoiceInput): Promise<void> {
      // Editing the previous card, or adding a similar copy of it, stays in the
      // list that card was added to; only a fresh add asks where it should go.
      if (input.intent !== 'add') {
        // No active list is unreachable here: both re-entry shortcuts require a
        // last added card, and only an add (which sets the active list) can
        // provide one — so the silent no-op is a type-level formality.
        const open = activeList()
        if (open) await open.strategy.handleCard(open.ctx, input)
        return
      }
      const target = await promptAddTarget(lists(), scope)
      const open = target?.kind === 'new' ? await createList(target.type) : target?.open
      if (!open) {
        console.log(t('cli.edit.noListSelected'))
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
      for (const open of lists()) {
        open.strategy.listSessionChanges().forEach((item, index) => {
          changeTargets.push({ open, index })
          items.push({ ...item, label: `${listRefTitle(open.ref)}: ${item.label}` })
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
      for (const open of lists()) {
        for (const entry of open.strategy.listEntries()) {
          // Card ids are only unique within a list, so the picker gets a synthetic
          // key that resolves back to the owning list.
          const key = nextEntryKey++
          entryTargets.set(key, { open, cardId: entry.cardId })
          items.push({ label: `${listRefTitle(open.ref)}: ${entry.label}`, cardId: key })
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
      return label === null ? null : `${listRefTitle(open.ref)}: ${label}`
    },

    async undoLastEdit(_ctx: CardSessionContext): Promise<void> {
      const open = lastEditList()
      if (open) await open.strategy.undoLastEdit(open.ctx)
    },
  }

  return { strategy, ctx: activeCtx }
}
