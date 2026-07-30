import * as fs from 'node:fs/promises'
import path from 'node:path'
import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import type { Card, DeckData, DeckSection } from '../types'
import {
  createRemoveChange,
  isSamePrinting,
  type ChangeEvent,
  type PrintingTuple,
} from '../change-event'
import { getDecksDir } from '../ritual-config'
import { listFilePath } from '../resolve-list'
import { unusableFileNameMessage } from '../list-file-name'
import { DECK_FORMAT_KEYS, getDeckFormatLabel, type DeckFormatKey } from '../deck-format'
import { ask } from './prompts-helpers'
import { writeFileWithHash } from '../content-hash'
import {
  newDeckMarkdown,
  parseDeckFrontMatter,
  serializeDeckToMarkdown,
  type DeckFrontMatter,
} from '../deck-file'
import { listDeckFiles, loadDeckFile, readDeckName } from '../importers/text-file'
import { assignMissingDeckCardIds, repackSessionIds } from '../card-id'
import { applyChangeToDeck } from '../editor/deck-changes'
import {
  applySessionConfigAnswers,
  buildSessionConfigQuestions,
  ensureListFile,
  reloadCardNames,
  type SessionAddItem,
  type SessionConfig,
  type SessionConfigAnswers,
} from './card-session'

/**
 * Session state for interactive deck-editing sessions. Extends the shared
 * {@link SessionConfig} (set filters, default finish/condition, entry mode)
 * with a deck-specific **target section**: the named section new cards are
 * added to. `null` means "prompt for the section on every card".
 */
export type DeckSessionConfig = SessionConfig & {
  targetSection: string | null
}

/** A loaded deck file: its parsed structure plus the front matter needed to round-trip it. */
export type LoadedDeck = {
  deck: DeckData
  frontMatter: DeckFrontMatter
}

/** Response of a section `select` prompt (an existing name, or a sentinel value). */
type SectionPromptResponse = { section?: string }
/** The deck config prompt's answers: the shared filters plus the target-section pick. */
type DeckConfigAnswers = SessionConfigAnswers & { section?: string }
/** Response of a free-form section-name `text` prompt. */
type SectionNameResponse = { name?: string }

/**
 * The path a deck with this display name lives at. The file is named as the deck
 * is — see `listFilePath`. Throws when the name has no usable filename
 * characters; callers that take a name from the user validate it first.
 */
export function deckFilePath(name: string): string {
  const filePath = listFilePath('deck', name)
  if (!filePath) throw new Error(unusableFileNameMessage(name))
  return filePath
}

/**
 * Ensure a deck file exists for `name`, creating it with YAML front matter when
 * missing (mirroring `ritual new deck`). Returns the resolved file path.
 * `format` only applies to a newly created file — an existing deck keeps its own.
 */
export async function ensureDeckFile(name: string, format: DeckFormatKey): Promise<string> {
  const content = newDeckMarkdown(name, format)
  return ensureListFile(getDecksDir(), path.basename(deckFilePath(name)), content, 'deck')
}

/**
 * The deck-format select choices, in `keys` order (declaration order by
 * default), with a "(current)" marker on the deck's present format.
 */
export function deckFormatChoices(
  current: DeckFormatKey | null,
  keys: readonly DeckFormatKey[] = DECK_FORMAT_KEYS,
): prompts.Choice[] {
  return keys.map((key) => ({
    title: key === current ? `${getDeckFormatLabel(key)} (current)` : getDeckFormatLabel(key),
    value: key,
  }))
}

/** How a deck-format prompt presents its choices. */
export type DeckFormatPromptOptions = {
  /** The deck's present format: marked "(current)" and given the initial cursor. */
  current?: DeckFormatKey | null
  /** Choice order — e.g. `deckFormatKeysForSignal(...)`. Declaration order by default. */
  keys?: readonly DeckFormatKey[]
}

/**
 * Prompt for a deck format, defaulting the cursor to `current` when given.
 * Returns null when the prompt is cancelled.
 */
export async function promptDeckFormat(
  options: DeckFormatPromptOptions = {},
): Promise<DeckFormatKey | null> {
  const keys = options.keys ?? DECK_FORMAT_KEYS
  const current = options.current ?? null
  const choices = deckFormatChoices(current, keys)
  const format = await ask<DeckFormatKey>({
    type: 'select',
    message: 'Deck format:',
    choices,
    initial: current ? Math.max(0, keys.indexOf(current)) : 0,
  })
  return format ?? null
}

/** Load a deck file into structured data plus its front matter for later re-serialization. */
export async function loadDeck(filePath: string): Promise<LoadedDeck> {
  const { deck: parsed, warnings } = await loadDeckFile(filePath)
  // Parity with the flat-list sessions: a session save re-serializes the whole
  // file, so any line the parser skipped would be dropped by that save. Warn
  // up front rather than losing them silently.
  for (const warning of warnings) console.warn(`${path.basename(filePath)}: ${warning}`)
  const deck = assignMissingDeckCardIds(parsed)
  const frontMatter = await parseDeckFrontMatter(filePath)
  return { deck, frontMatter }
}

/**
 * Serialize a deck (assigning any missing card IDs) and write it back to disk
 * with a fresh hash, creating the decks directory when the deck is a new one
 * whose file has never existed.
 */
export async function writeDeck(
  filePath: string,
  deck: DeckData,
  frontMatter: DeckFrontMatter,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await writeFileWithHash(filePath, serializeDeckToMarkdown(deck, frontMatter))
}

/** List the section names currently present in a deck, in file order. */
export function deckSectionNames(deck: DeckData): string[] {
  return deck.sections.map((s) => s.name)
}

/** A located deck card: the section it lives in and its assigned ID (if any). */
export type LocatedDeckCard = { section: string; cardId?: number }

/**
 * Locate a card in a deck by name and printing, preferring `preferredSection`.
 * Used to recover the card's assigned ID after applying an add/edit so it can be
 * recorded in the changelog and tracked as the "last added" card.
 */
export function findDeckCard(
  deck: DeckData,
  name: string,
  printing: PrintingTuple,
  preferredSection?: string,
): LocatedDeckCard | null {
  const sections = preferredSection
    ? [...deck.sections].sort((a, b) =>
        a.name === preferredSection ? -1 : b.name === preferredSection ? 1 : 0,
      )
    : deck.sections
  for (const section of sections) {
    const card = section.cards.find((c) => c.name === name && isSamePrinting(c, printing))
    if (card) return { section: section.name, cardId: card.cardId }
  }
  return null
}

// ── Discarding session adds ─────────────────────────────────────────

/** One copy added to the deck this session, tracked for the Undo Last Add and session-changes pickers. */
export type DeckCopyRecord = {
  cardId: number
  name: string
  printing: PrintingTuple
  section: string
}

/** Render a session copy record for the Undo Last Add and session-changes pickers. */
export function renderDeckCopyRecord(record: DeckCopyRecord): SessionAddItem {
  const printingInfo = record.printing.set
    ? ` (${record.printing.set.toUpperCase()}:${record.printing.collectorNumber})`
    : ''
  return { label: `${record.name}${printingInfo} → ${record.section}`, name: record.name }
}

/** A located deck card together with the section it lives in. */
export type DeckCardLocation = { section: DeckSection; card: Card }

/** Locate a deck card (with its quantity) by its card ID, across all sections. */
export function findCardById(deck: DeckData, cardId: number): DeckCardLocation | null {
  for (const section of deck.sections) {
    const card = section.cards.find((c) => c.cardId === cardId)
    if (card) return { section, card }
  }
  return null
}

/** The mutable session state a discard transforms. */
export type DeckDiscardState = {
  deck: DeckData
  sessionChanges: ChangeEvent[]
  /** Per-copy adds this session, in add order. */
  sessionAdds: DeckCopyRecord[]
  /** Distinct line ids first created this session, for re-pack on full removal. */
  sessionLineIds: number[]
}

/** A successful discard's next state, plus the copy that was removed. */
export type DeckDiscardOutcome = DeckDiscardState & { discarded: DeckCopyRecord }

/**
 * Discard the session copy at `index` (into {@link DeckDiscardState.sessionAdds}):
 * decrement that line (dropping it at quantity 0), drop one matching add event (or the
 * line's whole changelog footprint when it's fully removed), and — only when a
 * session-created line is fully removed — re-pack the surviving session line ids so
 * they stay dense, freeing the highest. Pure: returns the next state, or null when the
 * index is out of range. Pre-existing (non-session) cards and their ids are untouched.
 */
export function discardDeckCopy(state: DeckDiscardState, index: number): DeckDiscardOutcome | null {
  const record = state.sessionAdds[index]
  if (!record) return null
  const { cardId } = record

  // Remove one copy: applyChangeToDeck deep-clones, so the result is safe to mutate.
  const deck = applyChangeToDeck(
    state.deck,
    createRemoveChange(record.name, { cardId, section: record.section }),
  )
  const sessionAdds = state.sessionAdds.filter((_, i) => i !== index)
  const lineRemoved = findCardById(deck, cardId) === null

  // A surviving line keeps its id, so only one add event for it is dropped; a fully
  // removed line takes its whole changelog footprint with it.
  let sessionChanges: ChangeEvent[]
  if (lineRemoved) {
    sessionChanges = state.sessionChanges.filter((c) => !('cardId' in c) || c.cardId !== cardId)
  } else {
    sessionChanges = [...state.sessionChanges]
    const lastAddIdx = sessionChanges.findLastIndex(
      (c) => c.action === 'add' && c.cardId === cardId,
    )
    if (lastAddIdx !== -1) sessionChanges.splice(lastAddIdx, 1)
  }

  let sessionLineIds = state.sessionLineIds
  if (lineRemoved && sessionLineIds.includes(cardId)) {
    const survivors = sessionLineIds.filter((id) => id !== cardId)
    const { remap } = repackSessionIds(sessionLineIds, survivors)
    for (const section of deck.sections) {
      for (const card of section.cards) {
        if (card.cardId !== undefined && remap.has(card.cardId)) {
          card.cardId = remap.get(card.cardId)!
        }
      }
    }
    for (const c of sessionChanges) {
      if ('cardId' in c && c.cardId !== undefined && remap.has(c.cardId)) {
        c.cardId = remap.get(c.cardId)!
      }
    }
    for (const rec of sessionAdds) {
      if (remap.has(rec.cardId)) rec.cardId = remap.get(rec.cardId)!
    }
    sessionLineIds = survivors.map((id) => remap.get(id) ?? id)
  }

  return { deck, sessionChanges, sessionAdds, sessionLineIds, discarded: record }
}

const PROMPT_EVERY_TIME = '__PROMPT__'
const NEW_SECTION = '__NEW__'

/** Prompt for a free-form new section name. Returns the trimmed name, or null on cancel/empty. */
export async function promptNewSectionName(): Promise<string | null> {
  const response = (await prompts({
    type: 'text',
    name: 'name',
    message: 'New section name:',
    initial: 'Main',
    validate: (val: string) => (val.trim().length > 0 ? true : 'Section name cannot be empty'),
  })) as SectionNameResponse
  const name = response.name?.trim()
  return name ? name : null
}

/**
 * Resolve the section to add a card to. When the session pins a target section it
 * is returned directly; otherwise the user is prompted to pick an existing
 * section or create a new one. Returns null if the prompt was cancelled.
 */
export async function resolveTargetSection(
  deck: DeckData,
  config: DeckSessionConfig,
): Promise<string | null> {
  if (config.targetSection) return config.targetSection
  const existing = deckSectionNames(deck)
  let isExited = false
  const response = (await prompts({
    type: 'select',
    name: 'section',
    message: 'Add to which section?',
    choices: [
      ...existing.map((n) => ({ title: n, value: n })),
      { title: '+ New Section', value: NEW_SECTION },
    ],
    onState: (state: PromptState) => {
      if (state.exited) isExited = true
    },
  })) as SectionPromptResponse
  if (isExited || response.section === undefined) return null
  if (response.section !== NEW_SECTION) return response.section
  return promptNewSectionName()
}

/**
 * Interactive "set the target section" picker: choose to prompt per card, target
 * an existing section, or create a new one. Updates `config.targetSection` in place.
 */
export async function promptSetTargetSection(
  deck: DeckData,
  config: DeckSessionConfig,
): Promise<void> {
  const choices = [
    { title: 'Prompt every time', value: PROMPT_EVERY_TIME },
    ...deckSectionNames(deck).map((n) => ({ title: n, value: n })),
    { title: '+ New Section', value: NEW_SECTION },
  ]
  const initial = config.targetSection
    ? Math.max(
        0,
        choices.findIndex((c) => c.value === config.targetSection),
      )
    : 0
  const response = (await prompts({
    type: 'select',
    name: 'section',
    message: 'Add cards to section:',
    choices,
    initial,
  })) as SectionPromptResponse
  if (response.section === undefined) return
  if (response.section === PROMPT_EVERY_TIME) {
    config.targetSection = null
  } else if (response.section === NEW_SECTION) {
    const newName = await promptNewSectionName()
    if (newName) config.targetSection = newName
  } else {
    config.targetSection = response.section
  }
  console.log(`Target section: ${config.targetSection ?? 'prompt every time'}.`)
}

/**
 * Interactive "Configure Session Filters" for the deck command. Updates set
 * filters, default finish/condition, and the target section in place, then
 * reloads and returns the card-name list for the (possibly changed) set filter.
 */
export async function promptDeckConfigUpdate(
  deck: DeckData,
  sessionConfig: DeckSessionConfig,
  excludeDigitalOnly: boolean,
): Promise<string[]> {
  const sectionChoices = [
    { title: 'Prompt every time', value: PROMPT_EVERY_TIME },
    ...deckSectionNames(deck).map((n) => ({ title: n, value: n })),
    { title: 'New section…', value: NEW_SECTION },
  ]
  const currentSectionIndex = sessionConfig.targetSection
    ? Math.max(
        0,
        sectionChoices.findIndex((c) => c.value === sessionConfig.targetSection),
      )
    : 0

  const configResponse = (await prompts([
    ...buildSessionConfigQuestions(sessionConfig, true),
    {
      type: 'select',
      name: 'section',
      message: 'Add cards to section:',
      choices: sectionChoices,
      initial: currentSectionIndex,
    },
  ])) as DeckConfigAnswers

  applySessionConfigAnswers(sessionConfig, configResponse)
  if (configResponse.section !== undefined) {
    if (configResponse.section === PROMPT_EVERY_TIME) {
      sessionConfig.targetSection = null
    } else if (configResponse.section === NEW_SECTION) {
      sessionConfig.targetSection = await promptNewSectionName()
    } else {
      sessionConfig.targetSection = configResponse.section
    }
  }

  const cardNames = await reloadCardNames(sessionConfig, excludeDigitalOnly)
  console.log(
    `Session filters updated. Target section: ${sessionConfig.targetSection ?? 'prompt every time'}.`,
  )
  return cardNames
}

/** An existing deck on disk: its display name (from front matter) and absolute file path. */
export type ExistingDeck = { name: string; file: string }

/**
 * List existing decks for the selection prompt. Each entry pairs the deck's
 * display name (the `name:` front matter field, not the file slug) with its file
 * path, sorted by display name. Mirrors how the collection/wanted pickers present
 * lists by their human-facing name.
 */
export async function listExistingDecks(): Promise<ExistingDeck[]> {
  const decksDir = getDecksDir()
  await fs.mkdir(decksDir, { recursive: true })
  const files = await listDeckFiles(decksDir)
  const decks = await Promise.all(
    files.map(async (f) => {
      const file = path.join(decksDir, f)
      return { name: await readDeckName(file), file }
    }),
  )
  return decks.sort((a, b) => a.name.localeCompare(b.name))
}
