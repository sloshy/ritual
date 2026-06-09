import * as fs from 'node:fs/promises'
import path from 'node:path'
import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import { getAllCardNames } from '../scryfall'
import type { DeckData } from '../types'
import { isSamePrinting, type PrintingTuple } from '../change-event'
import { getDecksDir } from '../ritual-config'
import { parseSetCodesInput, formatSetCodesForDisplay } from '../set-codes'
import { writeFileWithHash } from '../content-hash'
import { serializeDeckToMarkdown, parseDeckFrontMatter } from '../deck-file'
import { importFromTextFile, listDeckFiles, readDeckName } from '../importers/text-file'
import { assignMissingDeckCardIds } from '../card-id'
import { type SessionConfig, VALID_FINISHES } from './collection-helpers'

/**
 * Session state for the interactive `deck` command. Extends the shared
 * collection {@link SessionConfig} (set filters, default finish/condition, entry
 * mode) with a deck-specific **target section**: the named section new cards are
 * added to. `null` means "prompt for the section on every card".
 */
export type DeckSessionConfig = SessionConfig & {
  targetSection: string | null
}

/** A loaded deck file: its parsed structure plus the front matter needed to round-trip it. */
export type LoadedDeck = {
  deck: DeckData
  frontMatter: Record<string, unknown>
}

/** Response of a section `select` prompt (an existing name, or a sentinel value). */
type SectionPromptResponse = { section?: string }
/** Response of a free-form section-name `text` prompt. */
type SectionNameResponse = { name?: string }

/**
 * Ensure a deck file exists for `name`, creating it with YAML front matter when
 * missing (mirroring `new-deck`). Returns the resolved file path. The on-disk
 * file name is a slug of `name`; the display name is preserved in front matter.
 */
export async function ensureDeckFile(name: string): Promise<string> {
  const decksDir = getDecksDir()
  await fs.mkdir(decksDir, { recursive: true })
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  const filePath = path.join(decksDir, `${safeName}.md`)
  if (!(await Bun.file(filePath).exists())) {
    const content = `---\nname: "${name}"\nformat: "commander"\ntags: []\n---\n\n## Main\n`
    await writeFileWithHash(filePath, content)
    console.log(`Created new deck file: ${safeName}.md`)
  } else {
    console.log(`Using deck file: ${safeName}.md`)
  }
  return filePath
}

/** Load a deck file into structured data plus its front matter for later re-serialization. */
export async function loadDeck(filePath: string): Promise<LoadedDeck> {
  const deck = assignMissingDeckCardIds(await importFromTextFile(filePath))
  const frontMatter = await parseDeckFrontMatter(filePath)
  return { deck, frontMatter }
}

/** Serialize a deck (assigning any missing card IDs) and write it back to disk with a fresh hash. */
export async function writeDeck(
  filePath: string,
  deck: DeckData,
  frontMatter: Record<string, unknown>,
): Promise<void> {
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

const PROMPT_EVERY_TIME = '__PROMPT__'
const NEW_SECTION = '__NEW__'

/** Prompt for a free-form new section name. Returns the trimmed name, or null on cancel/empty. */
async function promptNewSectionName(): Promise<string | null> {
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
  const finishOptions = ['', ...VALID_FINISHES] as const
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

  const configResponse = await prompts([
    {
      type: 'text',
      name: 'sets',
      message: 'Filter by Set Codes (comma separated, e.g. "ECL, ECC"):',
      initial: sessionConfig.sets ? formatSetCodesForDisplay(sessionConfig.sets) : '',
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
      initial: sessionConfig.finish ? finishOptions.indexOf(sessionConfig.finish) : 0,
    },
    {
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
    },
    {
      type: 'select',
      name: 'section',
      message: 'Add cards to section:',
      choices: sectionChoices,
      initial: currentSectionIndex,
    },
  ])

  if (configResponse.sets !== undefined) {
    sessionConfig.sets = configResponse.sets.length > 0 ? configResponse.sets : undefined
  }
  if (configResponse.finish !== undefined) {
    sessionConfig.finish = configResponse.finish === '' ? undefined : configResponse.finish
  }
  if (configResponse.condition !== undefined) {
    sessionConfig.condition = configResponse.condition === '' ? undefined : configResponse.condition
  }
  if (configResponse.section !== undefined) {
    if (configResponse.section === PROMPT_EVERY_TIME) {
      sessionConfig.targetSection = null
    } else if (configResponse.section === NEW_SECTION) {
      sessionConfig.targetSection = await promptNewSectionName()
    } else {
      sessionConfig.targetSection = configResponse.section
    }
  }

  console.log('Reloading card database with new filters...')
  const cardNames = await getAllCardNames({ sets: sessionConfig.sets, excludeDigitalOnly })
  console.log(`Loaded ${cardNames.length} cards.`)
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
