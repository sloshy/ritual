import type { Choice } from 'prompts'
import type { ScryfallCard } from '../../scryfall/types'
import { appendChangelog } from '../../changes/changelog-writer'
import { createSetNoteChange } from '../../changes/change-event'
import { formatSetCodesForDisplay } from '../../card/set-codes'
import { t } from '../../i18n/t'
import { ask, promptExitMenu } from '../../cli/prompts'
import {
  asMenuSentinel,
  ensureCollectorChoices,
  buildMenuChoices,
  FORCE_SUFFIX,
  isCollectorChoiceValue,
  isEntryChoiceValue,
  SESSION_MENU_LIMIT,
  suggestCollectorMode,
  suggestEditMode,
  suggestNameMode,
  type CollectorChoiceValue,
  type EntryChoiceValue,
} from './menu'
import {
  createCardSessionContext,
  similarCopyInput,
  type CardChoiceIntent,
  type CardSessionContext,
  type CardSessionStrategy,
  type LastAdded,
  type SessionMode,
} from './strategy'

/**
 * Shared engine for the unified `edit` command's interactive card-entry
 * sessions. Owns everything the three list types have in common — the
 * autocomplete loop, menu construction, entry modes, the collector-mode
 * printing pool, session filters, and save/exit/changelog plumbing — and delegates the
 * list-type-specific flows (printing/finish/condition prompts, change
 * application, copy semantics) to a {@link CardSessionStrategy}.
 */

/** The card-entry prompt resolves to a menu sentinel/card-name string, a collector choice, or an entry. */
type CardSelection = string | CollectorChoiceValue | EntryChoiceValue

/**
 * What the card prompt submits when Enter is pressed on an empty match list.
 * The autocomplete resolves that to `undefined`, which `ask` cannot tell from
 * Esc; the prompt's `format` swaps in this marker so "no such card" stays a
 * retry and never becomes an exit.
 */
const NO_MATCH = Symbol('no-match')

// ── The session loop ────────────────────────────────────────────────

/**
 * Hooks the unified multi-list editor injects into the session loop. When
 * present, Save writes every open list, Esc and the Switch List item back out
 * to the list selection menu (keeping unsaved changes in memory), and the exit
 * menu accounts for every open list's pending changes.
 */
export type MultiListSessionControls = {
  /** Pending changes across every open list, including the current one. */
  totalChangeCount: () => number
  /** How many open lists have pending changes. */
  listsWithChanges: () => number
  /** Whether any open list has unsaved changes. */
  hasAnyUnsaved: () => boolean
  /**
   * Persist every open list's pending changes and reset their session
   * tracking. False when any list could not be saved (a pending cross-list
   * move whose destination cannot be committed) — the exit gate then keeps
   * the editor open instead of discarding the unsaved session.
   */
  saveAll: () => Promise<boolean>
  /**
   * Persist the current list only (the Save Current item). Routed through the
   * editor rather than {@link saveCardSession} directly so a save always
   * commits the destination side of the list's pending cross-list moves.
   */
  saveCurrent: () => Promise<boolean>
}

/**
 * The unified editor's exit gate, shared by the in-session Exit action and the
 * list selection menu's Exit item: with unsaved changes anywhere, offer to save
 * them all, discard them all, or cancel. Returns false when the user cancels
 * (keep editing); logs the exit message otherwise.
 */
export async function confirmMultiListExit(multiList: MultiListSessionControls): Promise<boolean> {
  if (multiList.hasAnyUnsaved()) {
    const choice = await promptExitMenu(multiList.totalChangeCount())
    if (choice === 'cancel') return false
    if (choice === 'save') {
      // A failed save (a cross-list move whose destination could not be
      // committed) must not fall through to exiting — the unsaved session
      // would be silently thrown away right after the error.
      if (!(await multiList.saveAll())) return false
    } else console.log(t('cli.session.discardedAll'))
  }
  console.log(t('cli.session.exitingEditor'))
  return true
}

/** Inputs to {@link runCardSession}. */
export type CardSessionOptions = {
  strategy: CardSessionStrategy
  /** Initial autocomplete card names (already filtered by the session's set codes). */
  cardNames: string[]
  excludeDigitalOnly: boolean
  /**
   * The session context to work in, re-read at the top of every loop iteration.
   * The unified editor owns one per open list, so pending changes survive
   * backing out to the list selection menu; a multi-list scope returns the context
   * of whichever list the last card was added to, so the last-added shortcuts
   * and the note action land there. Omitted, a fresh context is created.
   */
  ctx?: () => CardSessionContext
  /** Present when the session runs inside the unified multi-list editor. */
  multiList?: MultiListSessionControls
  /** The strategy spans several lists at once (a multi-list scope). */
  scoped?: boolean
}

/**
 * Why the session loop returned: the user exited the editor, or backed out to
 * the list selection menu (multi-list sessions only). Carries the possibly
 * reloaded card-name list so a later session can resume with current filters.
 */
export type CardSessionResult = { reason: 'exit' | 'switch'; cardNames: string[] }

/** Persist the in-memory list model and append the session changelog, when either is pending. */
export async function saveCardSession(
  strategy: CardSessionStrategy,
  ctx: CardSessionContext,
): Promise<void> {
  const { saveTarget } = strategy
  if (!saveTarget) {
    throw new Error('A multi-list session must be saved one open list at a time.')
  }
  if (strategy.hasUnsavedChanges()) {
    await strategy.persist()
    console.log(t('cli.session.changesSaved'))
  }
  if (ctx.sessionChanges.length > 0) {
    await appendChangelog(saveTarget.filePath, saveTarget.listName, ctx.sessionChanges, {
      continueSession: ctx.hasSavedChangelog,
    })
    ctx.hasSavedChangelog = true
    console.log(t('cli.session.changelogSaved'))
  }
}

/**
 * Reset the session tracking after a save: everything up to here is committed,
 * so the undo/discard menus must not be able to claw back changes that are
 * already on disk.
 */
export function resetCardSessionTracking(
  strategy: CardSessionStrategy,
  ctx: CardSessionContext,
): void {
  strategy.sessionSaved()
  ctx.sessionChanges = []
  ctx.lastChangeIndex = null
  ctx.lastAdded = null
  ctx.lastAddedCount = 0
}

/**
 * The View Session Changes screen: list every change made this session and
 * offer to discard the selected one. Discarding re-renders the list; Back (or
 * escape) returns to the main prompt.
 */
async function viewSessionChanges(
  strategy: CardSessionStrategy,
  ctx: CardSessionContext,
): Promise<void> {
  while (true) {
    const items = strategy.listSessionChanges()
    if (items.length === 0) {
      console.log(t('cli.session.noChanges'))
      return
    }
    // Resolves to an item index, null (Back), or undefined (escaped).
    const index = await ask<number | null>({
      type: 'select',
      message: t('cli.session.promptPickChangeToDiscard', { count: items.length }),
      subjectKey: 'cli.prompt.subject.changeToDiscard',
      choices: [
        ...items.map((item, index) => ({ title: item.label, value: index })).reverse(),
        { title: `← ${t('cli.menu.back')}`, value: null },
      ],
    })
    if (index == null) return
    const item = items[index]
    if (!item) return
    if (item.blocked) {
      console.log(t('cli.session.discardBlocked', { reason: item.blocked }))
      continue
    }
    const confirmed = await ask<boolean>({
      type: 'confirm',
      message: t('cli.session.promptDiscardChange', { label: item.label }),
      subjectKey: 'cli.prompt.subject.discardConfirm',
      initial: false,
    })
    if (confirmed) {
      await strategy.discardSessionChange(ctx, index)
      // Discarding a list's creation takes the list away with it: there is
      // nothing left to render, let alone discard.
      if (strategy.discarded?.()) return
    }
  }
}

/**
 * Run the interactive card-entry loop until the user exits. Changes accumulate
 * on the in-memory list model; Save writes the file and the session changelog
 * without leaving the session, and Exit (or Esc) opens the shared exit menu to
 * save and exit, exit without saving, or keep editing.
 *
 * In a unified multi-list session (`multiList` present), Save flushes every
 * open list, Esc and Switch List return to the list selection menu with
 * unsaved changes kept in memory, and the exit menu covers all open lists.
 */
export async function runCardSession(options: CardSessionOptions): Promise<CardSessionResult> {
  const { strategy, excludeDigitalOnly, multiList } = options
  const { sessionConfig } = strategy
  let cardNames = options.cardNames
  let sessionMode: SessionMode = 'add'

  const ownCtx = createCardSessionContext()
  const currentCtx: () => CardSessionContext = options.ctx ?? (() => ownCtx)

  while (true) {
    const ctx = currentCtx()
    let forcePrompts = false
    let intent: CardChoiceIntent = 'add'

    const cardChoices: Choice[] =
      sessionMode === 'edit'
        ? strategy.listEntries().map(
            (entry): Choice => ({
              title: entry.label,
              value: { type: 'entry', cardId: entry.cardId } satisfies EntryChoiceValue,
            }),
          )
        : sessionConfig.entryMode === 'name'
          ? cardNames.map((name) => ({ title: name, value: name }))
          : // Built once and cached on the shared config, so the whole-cache
            // printing pool is not rebuilt on every loop iteration.
            await ensureCollectorChoices(sessionConfig, excludeDigitalOnly)

    const sessionAdds = strategy.listSessionAdds?.() ?? []

    const choices = buildMenuChoices({
      sessionMode,
      mode: sessionConfig.entryMode,
      lastAdded: ctx.lastAdded,
      changeCount: ctx.sessionChanges.length,
      extraItems: strategy.extraMenuItems?.() ?? [],
      sessionAdds,
      editUndoLabel: strategy.lastEditUndoLabel(),
      sessionChangeCount: strategy.listSessionChanges().length,
      cardChoices,
      dirty: strategy.hasUnsavedChanges(),
      multiList: multiList
        ? {
            totalChangeCount: multiList.totalChangeCount(),
            listsWithChanges: multiList.listsWithChanges(),
            scoped: options.scoped === true,
          }
        : undefined,
    })

    const streak: string =
      ctx.lastAdded && ctx.lastAddedCount > 0
        ? t('cli.session.streakHint', { count: ctx.lastAddedCount, name: ctx.lastAdded.name })
        : ''
    const promptMessage: string =
      sessionMode === 'edit'
        ? t('cli.session.promptPickToEdit')
        : sessionConfig.entryMode === 'name'
          ? t('cli.session.promptCardName', { streak })
          : t('cli.session.promptCollectorSearch', { streak })

    const picked = await ask<CardSelection | typeof NO_MATCH>({
      type: 'autocomplete',
      message: promptMessage,
      subjectKey: 'cli.prompt.subject.sessionCard',
      choices,
      limit: SESSION_MENU_LIMIT,
      suggest: async (rawInput, suggestChoices) =>
        sessionMode === 'edit'
          ? suggestEditMode(String(rawInput), suggestChoices)
          : sessionConfig.entryMode === 'name'
            ? suggestNameMode(String(rawInput), suggestChoices)
            : suggestCollectorMode(String(rawInput), suggestChoices),
      format: (value: unknown) => (value === undefined ? NO_MATCH : value),
    })
    const isExited = picked === undefined
    const selection: CardSelection | undefined = picked === NO_MATCH ? undefined : picked

    // The menu shortcut this selection is, or null for a card/entry choice.
    const menuAction = asMenuSentinel(selection)

    // In a multi-list session, Esc backs out to the list selection menu (like
    // Switch List) rather than exiting — unsaved changes stay in memory.
    if (multiList && (isExited || menuAction === '__SWITCH_LIST__')) {
      console.log(t('cli.session.returningToLists'))
      return { reason: 'switch', cardNames }
    }

    if (isExited || menuAction === '__EXIT__') {
      if (multiList) {
        if (!(await confirmMultiListExit(multiList))) continue
        return { reason: 'exit', cardNames }
      }
      if (ctx.sessionChanges.length > 0 || strategy.hasUnsavedChanges()) {
        const choice = await promptExitMenu(ctx.sessionChanges.length)
        if (choice === 'cancel') continue
        if (choice === 'save') await saveCardSession(strategy, ctx)
        else console.log(t('cli.session.discardedAll'))
      }
      console.log(t('cli.session.exitingManager', { manager: strategy.managerLabel }))
      return { reason: 'exit', cardNames }
    }

    // In a multi-list session, Save flushes every open list (saveAll also
    // resets each list's tracking, including this session's ctx).
    if (menuAction === '__SAVE__' && multiList) {
      await multiList.saveAll()
      continue
    }

    // Save Current in a multi-list session goes through the editor's save
    // path, which also commits the destination side of pending cross-list moves.
    if (menuAction === '__SAVE_CURRENT__' && multiList) {
      await multiList.saveCurrent()
      continue
    }

    // The single-list Save (no multi-list controls present).
    if (menuAction === '__SAVE__' || menuAction === '__SAVE_CURRENT__') {
      await saveCardSession(strategy, ctx)
      // Everything up to here is committed: the undo/discard menus reset so a
      // later undo can never claw back changes that are already on disk.
      resetCardSessionTracking(strategy, ctx)
      continue
    }

    if (!selection) {
      console.error(t('cli.session.cardNotFound'))
      if (sessionConfig.sets && sessionConfig.sets.length > 0) {
        console.warn(
          t('cli.session.setFiltersActive', {
            sets: formatSetCodesForDisplay(sessionConfig.sets),
          }),
        )
      }
      continue
    }

    // ── Menu actions ──────────────────────────────────────────────
    if (menuAction === '__ADD_ANOTHER__' && ctx.lastAdded) {
      await strategy.addAnotherCopy(ctx)
      continue
    }

    if (menuAction === '__ADD_SIMILAR__' && ctx.lastAdded) {
      console.log(t('cli.session.addingSimilar', { name: ctx.lastAdded.name }))
      await strategy.handleCard(ctx, similarCopyInput(ctx.lastAdded))
      continue
    }

    if (menuAction === '__ADD_NOTE__' && ctx.lastAdded) {
      const target: LastAdded = ctx.lastAdded
      const note = (
        await ask<string>({
          type: 'text',
          message: t('cli.session.promptNote'),
          subjectKey: 'cli.prompt.subject.noteText',
        })
      )?.trim()
      if (note) {
        const change = createSetNoteChange(target.name, { note, cardId: target.cardId })
        strategy.applyChange(change)
        // Notes never become the in-place edit target, so lastChangeIndex stays put.
        ctx.sessionChanges.push(change)
        ctx.lastAdded = { ...target, hasNote: true }
        strategy.noteAdded?.(note)
        console.log(t('cli.session.noteAdded', { name: target.name, note }))
      }
      continue
    }

    if (menuAction === '__EDIT_MODE__') {
      sessionMode = 'edit'
      console.log(t('cli.session.switchedToEdit'))
      continue
    }

    if (menuAction === '__ADD_MODE__') {
      sessionMode = 'add'
      console.log(t('cli.session.switchedToAdd'))
      continue
    }

    if (menuAction === '__UNDO_EDIT__') {
      await strategy.undoLastEdit(ctx)
      continue
    }

    if (menuAction === '__COLLECTOR_MODE__') {
      // No set codes to pick first: the pool spans every printing the cache
      // holds (narrowed only by the session's own set filter), and the next
      // loop iteration builds it.
      sessionConfig.entryMode = 'collector'
      console.log(t('cli.session.switchedToCollector'))
      continue
    }

    if (menuAction === '__NAME_MODE__') {
      sessionConfig.entryMode = 'name'
      console.log(t('cli.session.switchedToName'))
      continue
    }

    if (menuAction === '__CONFIG__') {
      cardNames = await strategy.updateConfig(excludeDigitalOnly)
      continue
    }

    if (menuAction === '__UNDO_LAST__' && strategy.discardSessionAdd) {
      if (sessionAdds.length > 0) await strategy.discardSessionAdd(ctx, sessionAdds.length - 1)
      continue
    }

    if (menuAction === '__CHANGES__') {
      await viewSessionChanges(strategy, ctx)
      // The session's own list was discarded, so back out to the selection menu.
      if (strategy.discarded?.()) {
        console.log(t('cli.session.returningToLists'))
        return { reason: 'switch', cardNames }
      }
      continue
    }

    if (menuAction && menuAction !== '__EDIT_LAST__') {
      // A sentinel neither the engine nor the strategy handles (e.g.
      // __ADD_ANOTHER__ with no last card) is ignored.
      await strategy.handleSentinel?.(ctx, menuAction)
      continue
    }

    // ── Resolve the chosen card ───────────────────────────────────
    let cardName: string
    let preselected: ScryfallCard | null = null

    if (typeof selection === 'string') {
      cardName = selection
      if (cardName.endsWith(FORCE_SUFFIX)) {
        cardName = cardName.slice(0, -FORCE_SUFFIX.length)
        forcePrompts = true
      }
      if (menuAction === '__EDIT_LAST__') {
        if (!ctx.lastAdded) continue
        cardName = ctx.lastAdded.name
        forcePrompts = true
        intent = 'edit-last'
        console.log(t('cli.session.editingCard', { name: ctx.lastAdded.name }))
      }
    } else if (isCollectorChoiceValue(selection)) {
      cardName = selection.card.name
      preselected = selection.card
    } else if (isEntryChoiceValue(selection)) {
      await strategy.editEntry(ctx, selection.cardId)
      continue
    } else {
      // Unexpected value from the prompt library — ignore and re-prompt.
      continue
    }

    await strategy.handleCard(ctx, { cardName, preselected, forcePrompts, intent })
  }
}
