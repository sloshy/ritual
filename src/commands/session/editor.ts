import type { Choice } from 'prompts'
import { t } from '../../i18n/t'
import { LIST_TYPES, type ListType } from '../../list/list-type'
import type { SessionConfig } from './config'
import { confirmMultiListExit, runCardSession, type MultiListSessionControls } from './loop'
import { ask, suggestByTitleTerms } from '../../cli/prompts'
import { promptDeckFormat } from './deck-prompts'
import {
  collectListRefs,
  hasUnsavedChanges,
  newListSession,
  newListTitle,
  openListSession,
  pendingListCollision,
  saveOpenList,
  type OpenList,
  type UnifiedListRef,
} from './edit-lists'
import { isUsableFileName, unusableFileNameMessage } from '../../list/list-file-name'
import { listNameCollision } from '../../list/list-lifecycle'
import { listFilePath } from '../../list/resolve-list'
import { sameListRef, type ListRef } from '../../changes/change-event'
import { listRefTitle } from './edit-move'
import {
  createScopedSession,
  createScopedSessionState,
  LIST_SCOPES,
  listScopeTitle,
  listsInScope,
  type ListScope,
} from './scoped-session'

/**
 * The unified editor behind the `edit` command: one interactive session over
 * every list type. It fronts the shared card-session engine with a cross-type
 * list selection menu and a per-type strategy for each opened list. Each
 * opened list keeps its in-memory session (pending changes included) when the
 * user backs out to the menu, so edits can span several lists before a single
 * save.
 *
 * The menu also leads with multi-list scopes (All Lists, All Decks, …), each of
 * which edits several lists in one session — see {@link createScopedSession}.
 */

/** The unified selection menu resolves to a list, a multi-list scope, a create-new action, or exit. */
export type UnifiedSelection =
  | { kind: 'open'; list: UnifiedListRef }
  | { kind: 'scope'; scope: ListScope }
  | { kind: 'new'; type: ListType }
  | { kind: 'exit' }

/** What an open list has pending: edits, and (for a list created this session) its own creation. */
export type ListPendingState = { changes: number; isNew: boolean }

/** Pending state for the selection menu badges, keyed by list file path. */
export type PendingChangesByFile = Map<string, ListPendingState>

/** The `— …` badge trailing an open list's name in the selection menu. */
function pendingBadge(pending: ListPendingState | undefined): string {
  if (!pending) return ''
  const parts = [
    ...(pending.isNew ? [t('cli.edit.badgeNew')] : []),
    ...(pending.changes > 0 ? [t('cli.edit.badgeUnsaved', { count: pending.changes })] : []),
  ]
  return parts.length > 0 ? ` — ${parts.join(', ')}` : ''
}

/**
 * Whether a multi-list scope is worth offering: it must span at least two
 * lists. `All Lists` is additionally hidden when every list shares one type,
 * because it would then be the same session as that type's own scope.
 */
export function isScopeOffered(scope: ListScope, refs: UnifiedListRef[]): boolean {
  const inScope = listsInScope(scope, refs)
  if (inScope.length < 2) return false
  if (scope !== 'all') return true
  return new Set(inScope.map((ref) => ref.type)).size > 1
}

/**
 * Build the unified selection menu: the multi-list scope items (All Lists, then
 * All Decks / All Collections / All Wanted Lists, each only when it spans two
 * or more lists), every list grouped by type (each with its type icon, plus an
 * unsaved-changes badge for open lists), then the create-new items and Exit.
 */
export function buildListSelectionChoices(
  refs: UnifiedListRef[],
  pending: PendingChangesByFile,
): Choice[] {
  const listChoices = LIST_TYPES.flatMap((type) =>
    refs
      .filter((ref) => ref.type === type)
      .map(
        (ref): Choice => ({
          title: `${listRefTitle(ref)}${pendingBadge(pending.get(ref.file))}`,
          value: { kind: 'open', list: ref } satisfies UnifiedSelection,
        }),
      ),
  )
  return [
    ...LIST_SCOPES.filter((scope) => isScopeOffered(scope, refs)).map(
      (scope): Choice => ({
        title: listScopeTitle(scope),
        value: { kind: 'scope', scope } satisfies UnifiedSelection,
      }),
    ),
    ...listChoices,
    ...LIST_TYPES.map(
      (type): Choice => ({
        title: newListTitle(type),
        value: { kind: 'new', type } satisfies UnifiedSelection,
      }),
    ),
    { title: `🚪 ${t('cli.menu.exit')}`, value: { kind: 'exit' } satisfies UnifiedSelection },
  ]
}

/**
 * Prompt for the next list to edit. Returns undefined when the prompt is
 * cancelled (Esc / Ctrl-C), which the caller treats like picking Exit.
 */
async function promptListToEdit(choices: Choice[]): Promise<UnifiedSelection | undefined> {
  return ask<UnifiedSelection>({
    type: 'autocomplete',
    message: t('cli.edit.promptSelectList'),
    subjectKey: 'cli.prompt.subject.listToEdit',
    choices,
    limit: 12,
    suggest: suggestByTitleTerms,
  })
}

/**
 * Prompt for a new list's name. The list's file is named as the name is entered,
 * so a name left with nothing usable once filename-illegal characters are stripped
 * is rejected here rather than at save time. Returns null when cancelled.
 */
async function promptNewListName(type: ListType): Promise<string | null> {
  const name = await ask<string>({
    type: 'text',
    message: t('cli.edit.promptNewListName', { type }),
    subjectKey: 'cli.prompt.subject.newListName',
    validate: (value: string) => {
      if (value.trim().length === 0) return t('cli.edit.nameEmpty')
      if (!isUsableFileName(value)) return unusableFileNameMessage(value)
      return true
    },
  })
  return name ?? null
}

/** What {@link runUnifiedEditor} needs from the command: the resolved flags and the warmed cache. */
export type UnifiedEditorOptions = {
  /** A list named on the command line, opened straight into its session. */
  directRef?: UnifiedListRef
  cardNames: string[]
  /**
   * One config shared by every list, so filters, entry mode, and the deck
   * target section carry over when switching lists mid-session. The wanted
   * flow never reads `condition`, and only the deck flow reads `targetSection`.
   */
  sessionConfig: SessionConfig
  excludeDigitalOnly: boolean
}

/** Run the unified editor until the user exits (the exit menu included). */
export async function runUnifiedEditor(options: UnifiedEditorOptions): Promise<void> {
  const { directRef, sessionConfig, excludeDigitalOnly } = options
  let { cardNames } = options

  // Every list opened this session, keyed by file path. Sessions stay open
  // (with their unsaved changes) while the user edits other lists.
  const openLists = new Map<string, OpenList>()
  const unsavedLists = (): OpenList[] => [...openLists.values()].filter(hasUnsavedChanges)

  // Where the edit-mode Move to Another List action may send a card: every
  // list on disk plus the ones created this session (no file yet). Each
  // strategy filters its own list out.
  const moveTargets = async (): Promise<UnifiedListRef[]> => {
    const created = [...openLists.values()].filter((open) => open.isNew())
    return [...(await collectListRefs()), ...created.map((open) => open.ref)]
  }

  // How many pending (unsaved) moves across all open sessions target `ref`.
  const pendingInboundMoves = (ref: UnifiedListRef): number =>
    [...openLists.values()].reduce(
      (count, open) =>
        count +
        open.ctx.sessionChanges.filter(
          (change) => change.action === 'move-from' && sameListRef(change.to, ref),
        ).length,
      0,
    )

  const openList = async (ref: UnifiedListRef): Promise<OpenList> => {
    const existing = openLists.get(ref.file)
    if (existing) return existing
    const opened = await openListSession(ref, sessionConfig, excludeDigitalOnly, moveTargets)
    openLists.set(ref.file, opened)
    return opened
  }

  /**
   * Create a list in memory: prompt for its name (and a deck's format), then
   * open an empty session for it. Nothing is written — the list's file appears
   * only when the editor saves, so backing out discards the creation too.
   */
  const createList = async (type: ListType): Promise<OpenList | undefined> => {
    const name = await promptNewListName(type)
    if (!name) return undefined
    // The prompt already rejected a name with no usable filename characters.
    const file = listFilePath(type, name)
    if (!file) return undefined
    if (openLists.has(file)) {
      console.error(t('cli.edit.listFileExists', { type, file }))
      return undefined
    }
    // Lists created earlier in this session are not on disk yet, so
    // `listNameCollision` cannot see them — but two of them that fold together
    // would both be written on save, re-creating the mutually-unaddressable
    // pair the refusal exists to prevent. Check the session first.
    const pending = pendingListCollision(openLists.values(), type, name)
    if (pending) {
      console.error(t('cli.edit.pendingCollision', { type, name: pending.ref.name, query: name }))
      return undefined
    }
    // The same refusal `new` and the admin route give, so a list created here
    // can never land beside one whose name only folds to the same thing.
    const collision = await listNameCollision(type, name)
    if (collision) {
      console.error(collision.message)
      return undefined
    }
    const format = type === 'deck' ? await promptDeckFormat({ current: 'commander' }) : null
    if (type === 'deck' && !format) return undefined
    // Taking the creation back out of the session changes drops the whole list.
    const ref: UnifiedListRef = { type, name, file }
    const created = newListSession(
      ref,
      format,
      sessionConfig,
      excludeDigitalOnly,
      () => openLists.delete(file),
      moveTargets,
      // Discarding the creation is blocked while another open list holds a
      // pending move into it — the move would have nowhere to deliver.
      () => pendingInboundMoves(ref),
    )
    openLists.set(file, created)
    console.log(t('cli.edit.createdList', { type, name }))
    return created
  }

  // Saving a list also commits the destination side of its pending
  // cross-list moves (writing closed destinations to disk, and saving open
  // ones in the same pass) — see saveOpenList. False when that commit
  // failed and the list was left unsaved.
  const saveList = async (open: OpenList): Promise<boolean> => {
    const params: ListRef = { type: open.ref.type, name: open.ref.name }
    console.log(
      open.isNew() ? t('cli.edit.creatingList', params) : t('cli.edit.savingList', params),
    )
    // Also clears the list's pending-creation change, now that it is on disk.
    return saveOpenList(open, () => openLists.values())
  }

  const saveAll = async (): Promise<boolean> => {
    let allSaved = true
    for (const open of unsavedLists()) {
      // A list may already have been saved as an earlier list's move destination.
      if (!hasUnsavedChanges(open)) continue
      // Keep saving the rest — a failure only holds back its own list.
      if (!(await saveList(open))) allSaved = false
    }
    return allSaved
  }

  const controls = (saveCurrent: () => Promise<boolean>): MultiListSessionControls => ({
    totalChangeCount: () =>
      [...openLists.values()].reduce((sum, open) => sum + open.ctx.sessionChanges.length, 0),
    listsWithChanges: () => unsavedLists().length,
    hasAnyUnsaved: () => unsavedLists().length > 0,
    saveAll,
    saveCurrent,
  })

  // Which list a multi-list mode adds to / last edited, kept across re-entry.
  const scopeState = createScopedSessionState()

  // A list named on the command line opens straight into its session. Backing
  // out (Switch List / Esc) falls through to the normal selection menu; the
  // engine already ran the exit menu (save-all / discard / cancel) on 'exit'.
  if (directRef) {
    const open = await openList(directRef)
    const result = await runCardSession({
      strategy: open.strategy,
      cardNames,
      excludeDigitalOnly,
      ctx: () => open.ctx,
      multiList: controls(() => saveList(open)),
    })
    cardNames = result.cardNames
    if (result.reason === 'exit') return
  }

  while (true) {
    // Lists created this session have no file yet, so they are absent from the
    // on-disk scan and must be folded back in to stay reachable and saveable.
    const created = [...openLists.values()].filter((open) => open.isNew())
    const refs = [...(await collectListRefs()), ...created.map((open) => open.ref)]
    const pending: PendingChangesByFile = new Map(
      [...openLists.values()].map((open) => [
        open.ref.file,
        { changes: open.ctx.sessionChanges.length, isNew: open.isNew() },
      ]),
    )
    const selection = await promptListToEdit(buildListSelectionChoices(refs, pending))

    if (!selection || selection.kind === 'exit') {
      if (!(await confirmMultiListExit(controls(saveAll)))) continue
      return
    }

    if (selection.kind === 'scope') {
      const { scope } = selection
      const inScope = listsInScope(scope, refs)
      // Edit mode autocompletes over every in-scope list's entries, so they
      // must all be loaded up front — the engine builds that picker synchronously.
      console.log(t('cli.edit.openingLists', { count: inScope.length }))
      const files: string[] = []
      for (const ref of inScope) files.push((await openList(ref)).ref.file)
      const session = createScopedSession({
        scope,
        // Resolved against the open-list map on every read, so a list created
        // from the "Add to which list?" prompt joins the session immediately,
        // and one whose creation is discarded drops straight back out of it.
        lists: () => files.flatMap((file) => openLists.get(file) ?? []),
        createList: async (type) => {
          const open = await createList(type)
          if (open) files.push(open.ref.file)
          return open
        },
        sessionConfig,
        saveAll,
        state: scopeState,
      })
      const result = await runCardSession({
        strategy: session.strategy,
        cardNames,
        excludeDigitalOnly,
        ctx: session.ctx,
        // Save Current is suppressed in a scoped session; save-all stands in.
        multiList: controls(saveAll),
        scoped: true,
      })
      cardNames = result.cardNames
      if (result.reason === 'exit') return
      continue
    }

    let open: OpenList
    if (selection.kind === 'new') {
      const newList = await createList(selection.type)
      if (!newList) continue
      open = newList
    } else {
      open = await openList(selection.list)
    }

    const result = await runCardSession({
      strategy: open.strategy,
      cardNames,
      excludeDigitalOnly,
      ctx: () => open.ctx,
      multiList: controls(() => saveList(open)),
    })
    cardNames = result.cardNames
    // The engine already ran the exit menu (save-all / discard / cancel).
    if (result.reason === 'exit') return
  }
}
