import prompts, { type Choice } from 'prompts'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { getAllCardNames, getCardsBySet } from '../scryfall'
import type { Condition, Finish, ScryfallCard } from '../types'
import { isCondition, isFinish } from '../finish-condition'
import type { PromptState } from './prompts-types'
import { appendChangelog } from '../changelog-writer'
import { createSetNoteChange, type ChangeEvent } from '../change-event'
import { writeFileWithHash } from '../content-hash'
import { formatSetCodesForDisplay, parseSetCodesInput } from '../set-codes'

/**
 * Shared engine for the interactive card-entry commands (`deck`, `collection`,
 * `wanted-list`). Owns everything the three sessions have in common — the
 * autocomplete loop, menu construction, entry modes, collector-set management,
 * session filters, and Done/Exit/changelog plumbing — and delegates the
 * list-type-specific flows (printing/finish/condition prompts, change
 * application, copy semantics) to a {@link CardSessionStrategy}.
 */

// ── Session config ──────────────────────────────────────────────────

export type EntryMode = 'name' | 'collector'

/** Session-wide filters and entry-mode state shared by all card-entry commands. */
export type SessionConfig = {
  sets?: string[]
  finish?: Finish
  condition?: Condition | 'NONE'
  entryMode: EntryMode
  collectorSets: string[]
  activeSetIndex: number
  setCardMaps: Map<string, Map<string, ScryfallCard>>
}

/** The slice of {@link SessionConfig} used by collector-set management. */
export type CollectorSessionConfig = Pick<
  SessionConfig,
  'collectorSets' | 'activeSetIndex' | 'setCardMaps'
>

/** Shape of a free-form text prompt asking for set codes. */
export type SetsPromptResponse = { sets?: string }

// ── Menu sentinels ──────────────────────────────────────────────────

/**
 * The menu sentinel values (e.g. `__DONE__`). Matched by exact membership rather
 * than a `__` prefix check, because real card names can begin with underscores
 * (e.g. the Unstable card `_____ Goblin`) and must not be mistaken for menu items.
 */
export const MENU_SENTINELS: ReadonlySet<string> = new Set([
  '__ADD_ANOTHER__',
  '__ADD_NOTE__',
  '__SECTION__',
  '__CONFIG__',
  '__COLLECTOR_MODE__',
  '__MANAGE_SETS__',
  '__NAME_MODE__',
  '__DONE__',
  '__EXIT__',
  '__EDIT_LAST__',
  '__UNDO_LAST__',
  '__DISCARD__',
])

/** A choice is a menu item (vs. a card) when its value is exactly a known sentinel. */
export const isMenuChoice = (choice: Choice): boolean =>
  typeof choice.value === 'string' && MENU_SENTINELS.has(choice.value)

// ── Choice values & prompt responses ────────────────────────────────

/** A collector-mode autocomplete choice value: a specific printing keyed by collector number. */
export type CollectorChoiceValue = { type: 'card'; num: string; card: ScryfallCard }
/** The card-entry prompt resolves to a menu sentinel/card-name string or a collector choice. */
type CardSelectionResponse = { cardName?: string | CollectorChoiceValue }

type ListPromptResponse = { list?: string }
type NamePromptResponse = { name?: string }
type NotePromptResponse = { note?: string }
type ConfirmPromptResponse = { confirm?: boolean }
/** The discard picker resolves to an add-order index, null (Cancel), or undefined (escaped). */
type DiscardPromptResponse = { index?: number | null }
type CodePromptResponse = { code?: string }
/** An action picked in the Manage Set Codes menu. */
type SetAction =
  | { type: 'toggle'; index: number }
  | { type: 'add' }
  | { type: 'remove' }
  | { type: 'back' }
type SetActionPromptResponse = { action?: SetAction }

// ── Session context & strategy ──────────────────────────────────────

/** The most recently added/edited card, tracked for the menu shortcuts. */
export type LastAdded = { name: string; hasNote: boolean; cardId?: number }

/** Mutable per-session state owned by the engine and shared with the strategy. */
export type CardSessionContext = {
  /** Change events accumulated for the session changelog. */
  sessionChanges: ChangeEvent[]
  /** Index into {@link sessionChanges} of the entry an edit would update in place. */
  lastChangeIndex: number | null
  lastAdded: LastAdded | null
  /** Consecutive copies of {@link lastAdded} added this streak. */
  lastAddedCount: number
}

/**
 * A card added during the current session, for the discard menu. `label` is the
 * full rendered line shown in the picker; `name` is the bare card name used in the
 * "Undo Last Add" shortcut.
 */
export type SessionAddItem = { label: string; name: string }

/** Input to {@link CardSessionStrategy.handleCard} once the engine has resolved a selection. */
export type CardChoiceInput = {
  cardName: string
  /** Printing preselected via collector mode, or null in name mode. */
  preselected: ScryfallCard | null
  /** Force the finish/condition prompts even when session defaults would apply. */
  forcePrompts: boolean
  /** The selection is an edit of the last added card rather than a new add. */
  isEditing: boolean
}

/**
 * The list-type-specific half of a card-entry session. Implementations close
 * over their list model (deck structure or flat entry array + ID pool) and apply
 * every mutation as a {@link ChangeEvent}, persisting after each change.
 */
export type CardSessionStrategy = {
  /** Used in exit messages, e.g. `collection manager`. */
  managerLabel: string
  /** File the session edits; changelog entries are appended next to it. */
  filePath: string
  /** Display name recorded in the changelog. */
  listName: string
  sessionConfig: SessionConfig
  /** Extra menu entries inserted after the note shortcut in both modes (values must be in {@link MENU_SENTINELS}). */
  extraMenuItems?: () => Choice[]
  /** Handle a strategy-specific sentinel; returns true when it was handled. */
  handleSentinel?: (ctx: CardSessionContext, value: string) => Promise<boolean>
  /** Re-prompt session filters and return the reloaded card-name list. */
  updateConfig: (excludeDigitalOnly: boolean) => Promise<string[]>
  /** Apply a change to the in-memory list model and persist it. */
  applyAndSave: (change: ChangeEvent) => Promise<void>
  /** Run the full add/edit flow for a selected card. */
  handleCard: (ctx: CardSessionContext, input: CardChoiceInput) => Promise<void>
  /** Add another copy of the last added card. */
  addAnotherCopy: (ctx: CardSessionContext) => Promise<void>
  /** Notify the strategy that the engine applied a note to the last added card. */
  noteAdded?: (note: string) => void
  /** The cards added this session, in add order, for the discard menu. */
  listSessionAdds?: () => SessionAddItem[]
  /** Discard the session add at `index` into {@link listSessionAdds}, re-packing ids. */
  discardSessionAdd?: (ctx: CardSessionContext, index: number) => Promise<void>
}

// ── Shared startup helpers ──────────────────────────────────────────

/**
 * Load the card-name list for autocomplete, logging progress. Returns null (after
 * telling the user to preload) when the Scryfall cache is empty.
 */
export async function loadCardNamesOrWarn(
  sets: string[] | undefined,
  excludeDigitalOnly: boolean,
): Promise<string[] | null> {
  console.log('Loading card database for autocomplete...')
  const cardNames = await getAllCardNames({ sets, excludeDigitalOnly })
  if (cardNames.length === 0) {
    console.log('Cache is empty. Please run preload to populate the cache for autocomplete.')
    return null
  }
  console.log(`Loaded ${cardNames.length} cards.`)
  return cardNames
}

/** Result of the list-selection prompt: an existing list's value, or a new list's name. */
export type ListSelection = { kind: 'existing'; value: string } | { kind: 'new'; name: string }

const NEW_LIST = '__NEW__'

/** Inputs to {@link promptListSelection}. */
export type ListSelectionPromptOptions = {
  message: string
  items: Choice[]
  createTitle: string
  newNameMessage: string
}

/**
 * Prompt to select an existing list or create a new one. Returns null when the
 * prompt is cancelled or the new-list name is empty.
 */
export async function promptListSelection(
  options: ListSelectionPromptOptions,
): Promise<ListSelection | null> {
  const selectionResponse = (await prompts({
    type: 'autocomplete',
    name: 'list',
    message: options.message,
    choices: [...options.items, { title: options.createTitle, value: NEW_LIST }],
  })) as ListPromptResponse

  if (!selectionResponse.list) return null
  if (selectionResponse.list !== NEW_LIST) {
    return { kind: 'existing', value: selectionResponse.list }
  }

  const nameResponse = (await prompts({
    type: 'text',
    name: 'name',
    message: options.newNameMessage,
    validate: (value: string) => (value.length > 0 ? true : 'Name cannot be empty'),
  })) as NamePromptResponse
  if (!nameResponse.name) return null
  return { kind: 'new', name: nameResponse.name }
}

/**
 * Ensure `fileName` exists in `dir`, creating it (and the directory) with
 * `initialContent` and a content hash when missing. Returns the resolved path.
 */
export async function ensureListFile(
  dir: string,
  fileName: string,
  initialContent: string,
  label: string,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, fileName)
  if (!(await Bun.file(filePath).exists())) {
    await writeFileWithHash(filePath, initialContent)
    console.log(`Created new ${label} file: ${fileName}`)
  } else {
    console.log(`Using ${label} file: ${fileName}`)
  }
  return filePath
}

/** List the `.md` files in a flat-list directory (excluding change files), as bare names. */
export async function listMarkdownNames(dir: string): Promise<string[]> {
  await fs.mkdir(dir, { recursive: true })
  const files = await fs.readdir(dir)
  return files
    .filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
    .map((f) => f.replace('.md', ''))
}

/** Load card maps for `setCodes` and make them the session's collector sets. */
export async function loadCollectorSets(
  config: CollectorSessionConfig,
  setCodes: string[],
): Promise<void> {
  console.log('Loading set data...')
  for (const setCode of setCodes) {
    console.log(`Loading ${setCode.toUpperCase()}...`)
    const cardMap = await getCardsBySet(setCode)
    config.setCardMaps.set(setCode.toLowerCase(), cardMap)
    console.log(`  ${cardMap.size} cards loaded`)
  }
  config.collectorSets = setCodes
  config.activeSetIndex = 0
}

// ── Session filter configuration ────────────────────────────────────

/** Answers shared by every session-filter prompt (deck adds a section question on top). */
export type SessionConfigAnswers = {
  sets?: string[]
  finish?: string
  condition?: string
}

/**
 * The session-filter questions common to all card-entry commands: set filter,
 * default finish, and (optionally) default condition.
 */
export function buildSessionConfigQuestions(
  config: SessionConfig,
  includeCondition: boolean,
): prompts.PromptObject[] {
  const questions: prompts.PromptObject[] = [
    {
      type: 'text',
      name: 'sets',
      message: 'Filter by Set Codes (comma separated, e.g. "ECL, ECC"):',
      initial: config.sets ? formatSetCodesForDisplay(config.sets) : '',
      format: (val: string) => parseSetCodesInput(val),
    },
    {
      type: 'select',
      name: 'finish',
      message: 'Default Finish:',
      choices: [
        { title: 'None (Always Prompt)', value: '' },
        { title: 'Nonfoil', value: 'nonfoil' },
        { title: 'Foil', value: 'foil' },
        { title: 'Etched', value: 'etched' },
      ],
      initial: config.finish ? ['', 'nonfoil', 'foil', 'etched'].indexOf(config.finish) : 0,
    },
  ]
  if (includeCondition) {
    questions.push({
      type: 'select',
      name: 'condition',
      message: 'Default Condition:',
      choices: [
        { title: 'None (Always Prompt)', value: '' },
        { title: "Don't Care", value: 'NONE' },
        { title: 'Near Mint', value: 'NM' },
        { title: 'Lightly Played', value: 'LP' },
        { title: 'Moderately Played', value: 'MP' },
        { title: 'Heavily Played', value: 'HP' },
        { title: 'Damaged', value: 'DMG' },
      ],
      initial: 0,
    })
  }
  return questions
}

/**
 * Write the shared session-filter answers back onto the config. The raw prompt
 * strings are validated through the domain guards; an empty string (or any
 * unexpected value) clears the default back to "always prompt".
 */
export function applySessionConfigAnswers(
  config: SessionConfig,
  answers: SessionConfigAnswers,
): void {
  if (answers.sets !== undefined) {
    config.sets = answers.sets.length > 0 ? answers.sets : undefined
  }
  if (answers.finish !== undefined) {
    config.finish = isFinish(answers.finish) ? answers.finish : undefined
  }
  if (answers.condition !== undefined) {
    config.condition =
      answers.condition === 'NONE'
        ? 'NONE'
        : isCondition(answers.condition)
          ? answers.condition
          : undefined
  }
}

/** Reload the autocomplete card names after the set filter may have changed. */
export async function reloadCardNames(
  config: SessionConfig,
  excludeDigitalOnly: boolean,
): Promise<string[]> {
  console.log('Reloading card database with new filters...')
  const cardNames = await getAllCardNames({ sets: config.sets, excludeDigitalOnly })
  console.log(`Loaded ${cardNames.length} cards.`)
  return cardNames
}

/**
 * The full "Configure Session Filters" flow shared by the collection and wanted
 * commands (the deck command composes its extra target-section question on top).
 * Updates `config` in place and returns the reloaded card-name list.
 */
export async function promptSessionConfigUpdate(
  config: SessionConfig,
  includeCondition: boolean,
  excludeDigitalOnly: boolean,
): Promise<string[]> {
  const answers = (await prompts(
    buildSessionConfigQuestions(config, includeCondition),
  )) as SessionConfigAnswers
  applySessionConfigAnswers(config, answers)
  const cardNames = await reloadCardNames(config, excludeDigitalOnly)
  console.log('Session filters updated.')
  return cardNames
}

// ── Collector-set management ────────────────────────────────────────

/** Interactive add/remove/switch of the collector-mode set codes. */
export async function manageSetCodes(config: CollectorSessionConfig): Promise<void> {
  while (true) {
    const setChoices: Choice[] = config.collectorSets.map((code, idx) => ({
      title: `${idx === config.activeSetIndex ? '→ ' : '  '}${code.toUpperCase()}${idx === config.activeSetIndex ? ' (active)' : ''}`,
      value: { type: 'toggle', index: idx },
    }))

    setChoices.push(
      { title: '+ Add Set Code', value: { type: 'add' } },
      { title: '- Remove Set Code', value: { type: 'remove' } },
      { title: '← Back', value: { type: 'back' } },
    )

    const response = (await prompts({
      type: 'select',
      name: 'action',
      message: 'Manage Set Codes:',
      choices: setChoices,
    })) as SetActionPromptResponse

    if (!response.action || response.action.type === 'back') {
      break
    }

    if (response.action.type === 'toggle') {
      config.activeSetIndex = response.action.index
      console.log(
        `Active set changed to: ${config.collectorSets[config.activeSetIndex]?.toUpperCase()}`,
      )
      break
    }

    if (response.action.type === 'add') {
      const addResponse = (await prompts({
        type: 'text',
        name: 'code',
        message: 'Enter set code to add:',
        validate: (val: string) => (val.trim().length > 0 ? true : 'Set code cannot be empty'),
      })) as CodePromptResponse

      if (addResponse.code) {
        const newCode = addResponse.code.trim().toLowerCase()
        if (!config.collectorSets.includes(newCode)) {
          console.log(`Loading ${newCode.toUpperCase()}...`)
          const cardMap = await getCardsBySet(newCode)
          config.setCardMaps.set(newCode, cardMap)
          config.collectorSets.push(newCode)
          console.log(`  ${cardMap.size} cards loaded`)
        } else {
          console.log(`Set ${newCode.toUpperCase()} already added.`)
        }
      }
    }

    if (response.action.type === 'remove') {
      if (config.collectorSets.length === 0) {
        console.log('No sets to remove.')
        continue
      }

      const removeResponse = (await prompts({
        type: 'select',
        name: 'code',
        message: 'Select set to remove:',
        choices: config.collectorSets.map((code) => ({
          title: code.toUpperCase(),
          value: code,
        })),
      })) as CodePromptResponse

      if (removeResponse.code) {
        const idx = config.collectorSets.indexOf(removeResponse.code)
        if (idx !== -1) {
          config.collectorSets.splice(idx, 1)
          config.setCardMaps.delete(removeResponse.code)
          if (config.activeSetIndex >= config.collectorSets.length) {
            config.activeSetIndex = Math.max(0, config.collectorSets.length - 1)
          }
          console.log(`Removed ${removeResponse.code.toUpperCase()}`)
        }
      }
    }
  }
}

// ── Menu construction & suggestion filtering ────────────────────────

/** Inputs to {@link buildMenuChoices}. */
export type MenuBuildInput = {
  mode: EntryMode
  lastAdded: LastAdded | null
  changeCount: number
  /** Active collector set code (collector mode only). */
  activeSet: string
  /** Strategy-specific entries inserted after the note shortcut. */
  extraItems: Choice[]
  /** Cards added this session, in add order (drives the undo/discard menu items). */
  sessionAdds: SessionAddItem[]
  /** Card-name or collector-number choices appended after the menu entries. */
  cardChoices: Choice[]
}

/** Build the full autocomplete choice list (menu shortcuts first, then cards). */
export function buildMenuChoices(input: MenuBuildInput): Choice[] {
  const { mode, lastAdded, changeCount, activeSet, extraItems, sessionAdds, cardChoices } = input
  const modeItems: Choice[] =
    mode === 'name'
      ? [
          { title: '⚙️  Configure Session Filters', value: '__CONFIG__' },
          { title: '🔢 Switch to Collector Number Mode', value: '__COLLECTOR_MODE__' },
        ]
      : [
          {
            title: `📦 Manage Set Codes (Active: ${activeSet.toUpperCase() || 'none'})`,
            value: '__MANAGE_SETS__',
          },
          { title: '🔤 Switch to Name Mode', value: '__NAME_MODE__' },
        ]

  return [
    ...(lastAdded
      ? [{ title: `➕ Add Another Copy (${lastAdded.name})`, value: '__ADD_ANOTHER__' }]
      : []),
    ...(lastAdded && !lastAdded.hasNote
      ? [{ title: `📝 Add Note (${lastAdded.name})`, value: '__ADD_NOTE__' }]
      : []),
    ...extraItems,
    ...modeItems,
    {
      title: changeCount > 0 ? `✅ Done — Save ${changeCount} change(s)` : '✅ Done',
      value: '__DONE__',
    },
    { title: '🚪 Exit Without Saving Changelog', value: '__EXIT__' },
    ...(lastAdded
      ? [{ title: `✏️  Edit Previous Card (${lastAdded.name})`, value: '__EDIT_LAST__' }]
      : []),
    ...(sessionAdds.length > 0
      ? [
          {
            title: `↩️  Undo Last Add (${sessionAdds[sessionAdds.length - 1]!.name})`,
            value: '__UNDO_LAST__',
          },
          {
            title: `🗑️  Discard a Card Added This Session (${sessionAdds.length})`,
            value: '__DISCARD__',
          },
        ]
      : []),
    ...cardChoices,
  ]
}

/** A collector-mode choice with its value still concretely typed (before widening to Choice). */
type CollectorChoice = { title: string; value: CollectorChoiceValue }

/** Build the collector-mode card choices for a set, sorted numerically by collector number. */
export function buildCollectorChoices(setCardMap: Map<string, ScryfallCard>): Choice[] {
  const collectorChoices: CollectorChoice[] = []
  for (const [num, card] of setCardMap) {
    collectorChoices.push({ title: `${num} - ${card.name}`, value: { type: 'card', num, card } })
  }
  collectorChoices.sort((a, b) => {
    const numA = parseInt(a.value.num, 10) || 0
    const numB = parseInt(b.value.num, 10) || 0
    if (numA !== numB) return numA - numB
    return a.value.num.localeCompare(b.value.num)
  })
  return collectorChoices
}

/**
 * Name-mode suggestion filter: empty input shows the menu shortcuts; otherwise
 * all space-separated terms must appear in a title. A trailing `!` marks the
 * selection to force the finish/condition prompts past any session defaults.
 */
export function suggestNameMode(input: string, choices: Choice[]): Choice[] {
  const isForce = input.endsWith('!')
  const cleanInput = isForce ? input.slice(0, -1) : input

  if (!cleanInput) return choices.filter(isMenuChoice)

  const terms = cleanInput.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = choices.filter((choice) => {
    const title = choice.title.toLowerCase()
    return terms.every((term) => title.includes(term))
  })

  if (isForce) {
    return matches.map((m) =>
      isMenuChoice(m)
        ? m
        : {
            ...m,
            title: `${m.title} (Force Options)`,
            value: `${m.value}__FORCE__`,
          },
    )
  }
  return matches
}

/** Whether a prompt choice value is a collector-mode printing (vs. a menu sentinel string). */
function isCollectorChoiceValue(value: unknown): value is CollectorChoiceValue {
  return (
    typeof value === 'object' && value !== null && (value as CollectorChoiceValue).type === 'card'
  )
}

/**
 * Collector-mode suggestion filter: empty input shows the menu shortcuts;
 * otherwise filters printings by collector-number prefix (menu items stay).
 */
export function suggestCollectorMode(input: string, choices: Choice[]): Choice[] {
  if (!input) return choices.filter(isMenuChoice)
  return choices.filter((choice) => {
    if (!isCollectorChoiceValue(choice.value)) return true
    return choice.value.num.startsWith(input)
  })
}

// ── The session loop ────────────────────────────────────────────────

/** Inputs to {@link runCardSession}. */
export type CardSessionOptions = {
  strategy: CardSessionStrategy
  /** Initial autocomplete card names (already filtered by the session's set codes). */
  cardNames: string[]
  excludeDigitalOnly: boolean
}

/**
 * Run the interactive card-entry loop until the user finishes or exits. All
 * card changes are persisted as they are made; Done additionally appends the
 * session changelog, while Exit discards it (after confirmation).
 */
export async function runCardSession(options: CardSessionOptions): Promise<void> {
  const { strategy, excludeDigitalOnly } = options
  const { sessionConfig } = strategy
  let cardNames = options.cardNames

  const ctx: CardSessionContext = {
    sessionChanges: [],
    lastChangeIndex: null,
    lastAdded: null,
    lastAddedCount: 0,
  }

  while (true) {
    let isExited = false
    let forcePrompts = false
    let isEditing = false

    const activeSet = sessionConfig.collectorSets[sessionConfig.activeSetIndex] || ''
    const cardChoices: Choice[] =
      sessionConfig.entryMode === 'name'
        ? cardNames.map((name) => ({ title: name, value: name }))
        : buildCollectorChoices(
            sessionConfig.setCardMaps.get(activeSet.toLowerCase()) ??
              new Map<string, ScryfallCard>(),
          )

    const sessionAdds = strategy.listSessionAdds?.() ?? []

    const choices = buildMenuChoices({
      mode: sessionConfig.entryMode,
      lastAdded: ctx.lastAdded,
      changeCount: ctx.sessionChanges.length,
      activeSet,
      extraItems: strategy.extraMenuItems?.() ?? [],
      sessionAdds,
      cardChoices,
    })

    const streakHint: string =
      ctx.lastAdded && ctx.lastAddedCount > 0
        ? ` (${ctx.lastAddedCount}x ${ctx.lastAdded.name})`
        : ''
    const promptMessage: string =
      sessionConfig.entryMode === 'name'
        ? `Enter card name to add${streakHint}`
        : `Enter collector # for ${activeSet.toUpperCase() || 'SET'}${streakHint}`

    const response = (await prompts({
      type: 'autocomplete',
      name: 'cardName',
      message: promptMessage,
      choices,
      limit: 10,
      suggest: async (rawInput, suggestChoices) =>
        sessionConfig.entryMode === 'name'
          ? suggestNameMode(String(rawInput), suggestChoices)
          : suggestCollectorMode(String(rawInput), suggestChoices),
      onState: (state: PromptState) => {
        if (state.exited) isExited = true
      },
    })) as CardSelectionResponse

    if (isExited || response.cardName === '__DONE__') {
      if (ctx.sessionChanges.length > 0) {
        await appendChangelog(strategy.filePath, strategy.listName, ctx.sessionChanges)
        console.log('Changelog saved.')
      }
      console.log(`Exiting ${strategy.managerLabel}.`)
      break
    }

    if (response.cardName === '__EXIT__') {
      if (ctx.sessionChanges.length > 0) {
        const confirmResponse = (await prompts({
          type: 'confirm',
          name: 'confirm',
          message: `Card changes are already saved to the file. Exit without writing ${ctx.sessionChanges.length} change(s) to the changelog?`,
          initial: false,
        })) as ConfirmPromptResponse
        if (!confirmResponse.confirm) continue
      }
      console.log(`Exiting ${strategy.managerLabel}.`)
      break
    }

    if (!response.cardName) {
      console.error('❌ Card not found.')
      if (sessionConfig.sets && sessionConfig.sets.length > 0) {
        console.warn(
          `(Note: Set filters are active: ${formatSetCodesForDisplay(sessionConfig.sets)}. The card might exist in a different set.)`,
        )
      }
      continue
    }

    // ── Menu actions ──────────────────────────────────────────────
    if (response.cardName === '__ADD_ANOTHER__' && ctx.lastAdded) {
      await strategy.addAnotherCopy(ctx)
      continue
    }

    if (response.cardName === '__ADD_NOTE__' && ctx.lastAdded) {
      const target: LastAdded = ctx.lastAdded
      const noteResponse = (await prompts({
        type: 'text',
        name: 'note',
        message: 'Enter note:',
      })) as NotePromptResponse
      const note = noteResponse.note?.trim()
      if (note) {
        const change = createSetNoteChange(target.name, { note, cardId: target.cardId })
        await strategy.applyAndSave(change)
        // Notes never become the in-place edit target, so lastChangeIndex stays put.
        ctx.sessionChanges.push(change)
        ctx.lastAdded = { ...target, hasNote: true }
        strategy.noteAdded?.(note)
        console.log(`Note added to ${target.name}: ${note}`)
      }
      continue
    }

    if (response.cardName === '__COLLECTOR_MODE__') {
      if (sessionConfig.collectorSets.length === 0) {
        const setsResponse = (await prompts({
          type: 'text',
          name: 'sets',
          message: 'Enter set codes to use (comma-separated, e.g., "FDN, SPG"):',
          validate: (val: string) =>
            val.trim().length > 0 ? true : 'At least one set code required',
        })) as SetsPromptResponse
        if (!setsResponse.sets) continue
        await loadCollectorSets(sessionConfig, parseSetCodesInput(setsResponse.sets))
      }
      sessionConfig.entryMode = 'collector'
      console.log(
        `Switched to collector number mode. Active set: ${sessionConfig.collectorSets[sessionConfig.activeSetIndex]?.toUpperCase()}`,
      )
      continue
    }

    if (response.cardName === '__NAME_MODE__') {
      sessionConfig.entryMode = 'name'
      console.log('Switched to name mode.')
      continue
    }

    if (response.cardName === '__MANAGE_SETS__') {
      await manageSetCodes(sessionConfig)
      continue
    }

    if (response.cardName === '__CONFIG__') {
      cardNames = await strategy.updateConfig(excludeDigitalOnly)
      continue
    }

    if (response.cardName === '__UNDO_LAST__' && strategy.discardSessionAdd) {
      if (sessionAdds.length > 0) await strategy.discardSessionAdd(ctx, sessionAdds.length - 1)
      continue
    }

    if (response.cardName === '__DISCARD__' && strategy.discardSessionAdd) {
      if (sessionAdds.length === 0) continue
      // Present newest-first; the choice value is the original add-order index, or
      // null for Cancel (and undefined if the prompt itself is escaped).
      const discardResponse = (await prompts({
        type: 'select',
        name: 'index',
        message: 'Discard which card added this session?',
        choices: [
          ...sessionAdds.map((item, index) => ({ title: item.label, value: index })).reverse(),
          { title: '← Cancel', value: null },
        ],
      })) as DiscardPromptResponse
      if (discardResponse.index != null) {
        await strategy.discardSessionAdd(ctx, discardResponse.index)
      }
      continue
    }

    if (
      typeof response.cardName === 'string' &&
      MENU_SENTINELS.has(response.cardName) &&
      response.cardName !== '__EDIT_LAST__'
    ) {
      if (strategy.handleSentinel && (await strategy.handleSentinel(ctx, response.cardName))) {
        continue
      }
      // An unhandled sentinel (e.g. __ADD_ANOTHER__ with no last card) is ignored.
      continue
    }

    // ── Resolve the chosen card ───────────────────────────────────
    let cardName: string
    let preselected: ScryfallCard | null = null

    if (typeof response.cardName === 'string') {
      cardName = response.cardName
      if (cardName.endsWith('__FORCE__')) {
        cardName = cardName.replace('__FORCE__', '')
        forcePrompts = true
      }
      if (cardName === '__EDIT_LAST__') {
        if (!ctx.lastAdded) continue
        cardName = ctx.lastAdded.name
        forcePrompts = true
        isEditing = true
        console.log(`Editing: ${ctx.lastAdded.name}`)
      }
    } else if (isCollectorChoiceValue(response.cardName)) {
      cardName = response.cardName.card.name
      preselected = response.cardName.card
    } else {
      // Unexpected value from the prompt library — ignore and re-prompt.
      continue
    }

    await strategy.handleCard(ctx, { cardName, preselected, forcePrompts, isEditing })
  }
}
