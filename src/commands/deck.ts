import { Command } from 'commander'
import prompts, { type Choice } from 'prompts'
import { getAllCardNames, getCardsBySet } from '../scryfall'
import type { DeckData, ScryfallCard } from '../types'
import {
  resolveCardPrinting,
  promptFinishAndCondition,
  manageSetCodes,
  isFinish,
  isCondition,
  type LastAddedCard,
  type SetsPromptResponse,
} from './collection-helpers'
import {
  type DeckSessionConfig,
  ensureDeckFile,
  loadDeck,
  writeDeck,
  resolveTargetSection,
  promptDeckConfigUpdate,
  promptSetTargetSection,
  findDeckCard,
  listExistingDecks,
} from './deck-helpers'
import { assignMissingDeckCardIds } from '../card-id'
import { normalizeBoard } from './deck-sync-helpers'
import { appendChangelog } from '../changelog-writer'
import {
  createAddChange,
  createSetNoteChange,
  createSetPrintingChange,
  type ChangeEvent,
  type PrintingTuple,
} from '../change-event'
import { applyChangeToDeck } from '../editor/deck-changes'
import { trackAdd } from '../session-changelog'
import { formatSpecificPrintingPrice } from '../price-currency'
import { parseSetCodesInput, formatSetCodesForDisplay } from '../set-codes'

type DeckCommandOptions = {
  sets?: string
  finish?: string
  condition?: string
  section?: string
  collector?: boolean
  allowDigitalOnlyCards?: boolean
}

type ListPromptResponse = { deck?: string }
type NamePromptResponse = { name?: string }

/**
 * The menu sentinel values (e.g. `__DONE__`). Matched by exact membership rather
 * than a `__` prefix check, because real card names can begin with underscores
 * (e.g. the Unstable card `_____ Goblin`) and must not be mistaken for menu items.
 */
const MENU_SENTINELS: ReadonlySet<string> = new Set([
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
])

/** A choice is a menu item (vs. a card) when its value is exactly a known sentinel. */
export const isMenuChoice = (choice: Choice): boolean =>
  typeof choice.value === 'string' && MENU_SENTINELS.has(choice.value)

/** A collector-mode autocomplete choice value: a specific printing keyed by collector number. */
type CollectorChoiceValue = { type: 'card'; num: string; card: ScryfallCard }
/** The card-entry prompt resolves to a menu sentinel/card-name string or a collector choice. */
type CardSelectionResponse = { cardName?: string | CollectorChoiceValue }

export function registerDeckCommand(program: Command): void {
  program
    .command('deck')
    .description('Manage a deck by interactively adding cards to named sections')
    .option('-s, --sets <codes>', 'Filter by set codes (comma-separated, e.g., "FDN, SPG")')
    .option('-f, --finish <finish>', 'Default finish (nonfoil, foil, etched)')
    .option('-c, --condition <condition>', 'Default condition (NM, LP, MP, HP, DMG)')
    .option('--section <name>', 'Add cards to this section (otherwise prompts per card)')
    .option('--collector', 'Start in collector number mode')
    .option('--allow-digital-only-cards', 'Include digital-only sets (e.g., Alchemy)')
    .action(async (options: DeckCommandOptions) => {
      const parsedSets = options.sets ? parseSetCodesInput(options.sets) : undefined
      const excludeDigitalOnly = !options.allowDigitalOnlyCards

      console.log('Loading card database for autocomplete...')
      let cardNames = await getAllCardNames({ sets: parsedSets, excludeDigitalOnly })

      if (cardNames.length === 0) {
        console.log('Cache is empty. Please run preload to populate the cache for autocomplete.')
        return
      }

      console.log(`Loaded ${cardNames.length} cards.`)

      // Select or create a deck. Choices show each deck's display name (front
      // matter `name:`), while the selected value carries its file path.
      const existingDecks = await listExistingDecks()
      const selectionResponse = (await prompts({
        type: 'autocomplete',
        name: 'deck',
        message: 'Select a deck',
        choices: [
          ...existingDecks.map((d) => ({ title: d.name, value: d.file })),
          { title: '+ Create New Deck', value: '__NEW__' },
        ],
      })) as ListPromptResponse

      if (!selectionResponse.deck) return

      let selectedDeckName: string
      let deckFile: string
      if (selectionResponse.deck === '__NEW__') {
        const nameResponse = (await prompts({
          type: 'text',
          name: 'name',
          message: 'Enter name for new deck:',
          validate: (value: string) => (value.length > 0 ? true : 'Name cannot be empty'),
        })) as NamePromptResponse
        if (!nameResponse.name) return
        selectedDeckName = nameResponse.name
        deckFile = await ensureDeckFile(selectedDeckName)
      } else {
        const selected = existingDecks.find((d) => d.file === selectionResponse.deck)
        if (!selected) return
        selectedDeckName = selected.name
        deckFile = selected.file
      }

      const loaded = await loadDeck(deckFile)
      // Mutable in-memory deck — the single source of truth, re-serialized after each change.
      let deck: DeckData = loaded.deck
      const { frontMatter } = loaded

      const upperCondition = options.condition?.toUpperCase()
      const sessionConfig: DeckSessionConfig = {
        sets: parsedSets,
        finish: isFinish(options.finish) ? options.finish : undefined,
        condition: isCondition(upperCondition) ? upperCondition : undefined,
        entryMode: options.collector ? 'collector' : 'name',
        collectorSets: [],
        activeSetIndex: 0,
        setCardMaps: new Map(),
        targetSection: options.section ?? null,
      }

      // Pre-load set data when starting in collector mode with sets provided
      if (options.collector && parsedSets && parsedSets.length > 0) {
        console.log('Loading set data...')
        for (const setCode of parsedSets) {
          console.log(`Loading ${setCode.toUpperCase()}...`)
          const cardMap = await getCardsBySet(setCode)
          sessionConfig.setCardMaps.set(setCode.toLowerCase(), cardMap)
          console.log(`  ${cardMap.size} cards loaded`)
        }
        sessionConfig.collectorSets = parsedSets
        sessionConfig.activeSetIndex = 0
      }

      let lastAddedCard: LastAddedCard | null = null
      let lastAddedSection: string | null = null
      let lastAddedPrinting: PrintingTuple | null = null
      let lastAddedCount = 0
      const sessionChanges: ChangeEvent[] = []

      /**
       * Apply a change to the in-memory deck and persist it. IDs are assigned to
       * the in-memory copy too (not just on serialize) so the in-memory deck and
       * the file stay identical and subsequent edits resolve cards by ID.
       */
      const applyAndSave = async (change: ChangeEvent): Promise<void> => {
        deck = assignMissingDeckCardIds(applyChangeToDeck(deck, change))
        await writeDeck(deckFile, deck, frontMatter)
      }

      const sectionLabel = (): string => sessionConfig.targetSection ?? 'prompt every time'

      while (true) {
        let isExited = false
        let forcePrompts = false
        let isEditing = false

        let choices: Choice[]

        if (sessionConfig.entryMode === 'name') {
          choices = [
            ...(lastAddedCard
              ? [{ title: `➕ Add Another Copy (${lastAddedCard.name})`, value: '__ADD_ANOTHER__' }]
              : []),
            ...(lastAddedCard && !lastAddedCard.hasNote
              ? [{ title: `📝 Add Note (${lastAddedCard.name})`, value: '__ADD_NOTE__' }]
              : []),
            { title: `🗂️  Set Target Section (${sectionLabel()})`, value: '__SECTION__' },
            { title: '⚙️  Configure Session Filters', value: '__CONFIG__' },
            { title: '🔢 Switch to Collector Number Mode', value: '__COLLECTOR_MODE__' },
            {
              title:
                sessionChanges.length > 0
                  ? `✅ Done — Save ${sessionChanges.length} change(s)`
                  : '✅ Done',
              value: '__DONE__',
            },
            { title: '🚪 Exit Without Saving', value: '__EXIT__' },
            ...(lastAddedCard
              ? [
                  {
                    title: `✏️  Edit Previous Card (${lastAddedCard.name})`,
                    value: '__EDIT_LAST__',
                  },
                ]
              : []),
            ...cardNames.map((name) => ({ title: name, value: name })),
          ]
        } else {
          const activeSet = sessionConfig.collectorSets[sessionConfig.activeSetIndex] || ''
          const setCardMap: Map<string, ScryfallCard> =
            sessionConfig.setCardMaps.get(activeSet.toLowerCase()) || new Map()

          const collectorChoices: Choice[] = []
          for (const [num, card] of setCardMap) {
            const value: CollectorChoiceValue = { type: 'card', num, card }
            collectorChoices.push({ title: `${num} - ${card.name}`, value })
          }
          collectorChoices.sort((a, b) => {
            const aNum = (a.value as CollectorChoiceValue).num
            const bNum = (b.value as CollectorChoiceValue).num
            const numA = parseInt(aNum, 10) || 0
            const numB = parseInt(bNum, 10) || 0
            if (numA !== numB) return numA - numB
            return aNum.localeCompare(bNum)
          })

          choices = [
            ...(lastAddedCard
              ? [{ title: `➕ Add Another Copy (${lastAddedCard.name})`, value: '__ADD_ANOTHER__' }]
              : []),
            ...(lastAddedCard && !lastAddedCard.hasNote
              ? [{ title: `📝 Add Note (${lastAddedCard.name})`, value: '__ADD_NOTE__' }]
              : []),
            { title: `🗂️  Set Target Section (${sectionLabel()})`, value: '__SECTION__' },
            {
              title: `📦 Manage Set Codes (Active: ${activeSet.toUpperCase() || 'none'})`,
              value: '__MANAGE_SETS__',
            },
            { title: '🔤 Switch to Name Mode', value: '__NAME_MODE__' },
            {
              title:
                sessionChanges.length > 0
                  ? `✅ Done — Save ${sessionChanges.length} change(s)`
                  : '✅ Done',
              value: '__DONE__',
            },
            { title: '🚪 Exit Without Saving', value: '__EXIT__' },
            ...(lastAddedCard
              ? [
                  {
                    title: `✏️  Edit Previous Card (${lastAddedCard.name})`,
                    value: '__EDIT_LAST__',
                  },
                ]
              : []),
            ...collectorChoices,
          ]
        }

        const streakHint: string =
          lastAddedCard && lastAddedCount > 0 ? ` (${lastAddedCount}x ${lastAddedCard.name})` : ''
        const promptMessage: string =
          sessionConfig.entryMode === 'name'
            ? `Enter card name to add${streakHint}`
            : `Enter collector # for ${sessionConfig.collectorSets[sessionConfig.activeSetIndex]?.toUpperCase() || 'SET'}${streakHint}`

        const response = (await prompts({
          type: 'autocomplete',
          name: 'cardName',
          message: promptMessage,
          choices,
          limit: 10,
          suggest: async (rawInput, choices) => {
            const input = String(rawInput)
            if (sessionConfig.entryMode === 'name') {
              const isForce = input.endsWith('!')
              const cleanInput = isForce ? input.slice(0, -1) : input

              if (!cleanInput) return choices.filter(isMenuChoice)

              const terms = cleanInput.toLowerCase().split(/\s+/).filter(Boolean)
              const matches = choices.filter((choice) => {
                const title = choice.title.toLowerCase()
                return terms.every((term) => title.includes(term))
              })

              if (isForce) {
                return matches.map((m) => ({
                  ...m,
                  title: `${m.title} (Force Options)`,
                  value: `${m.value}__FORCE__`,
                }))
              }
              return matches
            } else {
              if (!input) return choices.filter(isMenuChoice)
              return choices.filter((choice) => {
                const value = choice.value as string | CollectorChoiceValue
                if (typeof value === 'string') return true
                return value.num.startsWith(input)
              })
            }
          },
          onState: (state) => {
            if (state.exited) isExited = true
          },
        })) as CardSelectionResponse

        if (isExited || response.cardName === '__DONE__') {
          if (sessionChanges.length > 0) {
            await appendChangelog(deckFile, selectedDeckName, sessionChanges)
            console.log('Changelog saved.')
          }
          console.log('Exiting deck manager.')
          break
        }

        if (response.cardName === '__EXIT__') {
          if (sessionChanges.length > 0) {
            const confirmResponse = await prompts({
              type: 'confirm',
              name: 'confirm',
              message: `Are you sure you want to exit and lose ${sessionChanges.length} change(s)?`,
              initial: false,
            })
            if (!confirmResponse.confirm) continue
          }
          console.log('Exiting deck manager.')
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
        if (response.cardName === '__ADD_ANOTHER__' && lastAddedCard && lastAddedSection) {
          const change = createAddChange(lastAddedCard.name, {
            ...(lastAddedPrinting ?? undefined),
            cardId: lastAddedCard.cardId,
            section: lastAddedSection,
            board: normalizeBoard(lastAddedSection),
          })
          await applyAndSave(change)
          lastAddedCount++
          trackAdd(sessionChanges, change)
          console.log(
            `Added another ${lastAddedCard.name} to ${lastAddedSection} (${lastAddedCount}x total)`,
          )
          continue
        }

        if (response.cardName === '__ADD_NOTE__' && lastAddedCard) {
          const target: LastAddedCard = lastAddedCard
          const noteResponse = await prompts({ type: 'text', name: 'note', message: 'Enter note:' })
          const note = noteResponse.note?.trim()
          if (note) {
            const change = createSetNoteChange(target.name, { note, cardId: target.cardId })
            await applyAndSave(change)
            trackAdd(sessionChanges, change)
            lastAddedCard = {
              name: target.name,
              line: target.line,
              hasNote: true,
              cardId: target.cardId,
            }
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

            const setCodes = parseSetCodesInput(setsResponse.sets)
            console.log('Loading set data...')
            for (const setCode of setCodes) {
              console.log(`Loading ${setCode.toUpperCase()}...`)
              const cardMap = await getCardsBySet(setCode)
              sessionConfig.setCardMaps.set(setCode.toLowerCase(), cardMap)
              console.log(`  ${cardMap.size} cards loaded`)
            }
            sessionConfig.collectorSets = setCodes
            sessionConfig.activeSetIndex = 0
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
          cardNames = await promptDeckConfigUpdate(deck, sessionConfig, excludeDigitalOnly)
          continue
        }

        if (response.cardName === '__SECTION__') {
          await promptSetTargetSection(deck, sessionConfig)
          continue
        }

        // ── Resolve the chosen card ───────────────────────────────────
        let cardName: string
        let selectedPrinting: ScryfallCard | null = null

        if (
          sessionConfig.entryMode === 'collector' &&
          typeof response.cardName === 'object' &&
          response.cardName.type === 'card'
        ) {
          cardName = response.cardName.card.name
          selectedPrinting = response.cardName.card
        } else {
          // In this branch `response.cardName` is a string (the object case is handled above
          // and the empty/undefined case returned earlier).
          cardName = response.cardName as string
          if (cardName.endsWith('__FORCE__')) {
            cardName = cardName.replace('__FORCE__', '')
            forcePrompts = true
          }
          if (cardName === '__EDIT_LAST__' && lastAddedCard) {
            cardName = lastAddedCard.name
            forcePrompts = true
            isEditing = true
            console.log(`Editing: ${lastAddedCard.name}`)
          }
        }

        if (!selectedPrinting) {
          const result = await resolveCardPrinting(cardName, sessionConfig, excludeDigitalOnly)
          if (!result) {
            if (isEditing) continue
            console.error('No printings found. Skipping.')
            continue
          }
          selectedPrinting = result.printing
        }

        const finishAndCondition = await promptFinishAndCondition(
          selectedPrinting,
          sessionConfig,
          forcePrompts,
        )
        if (!finishAndCondition) continue

        const printing: PrintingTuple = {
          set: selectedPrinting.set.toLowerCase(),
          collectorNumber: selectedPrinting.collector_number,
          finish: finishAndCondition.finish,
          condition: finishAndCondition.condition,
        }

        // ── Edit: re-set the printing on the existing card ────────────
        if (isEditing && lastAddedCard) {
          const change = createSetPrintingChange(lastAddedCard.name, {
            ...printing,
            cardId: lastAddedCard.cardId,
          })
          await applyAndSave(change)
          trackAdd(sessionChanges, change)
          lastAddedPrinting = printing
          console.log(
            `Edited ${lastAddedCard.name} → ${printing.set?.toUpperCase()}:${printing.collectorNumber}`,
          )
          continue
        }

        // ── Add a new copy to the resolved section ────────────────────
        const section = await resolveTargetSection(deck, sessionConfig)
        if (!section) {
          console.log('No section selected. Skipping.')
          continue
        }

        await applyAndSave(
          createAddChange(cardName, { ...printing, section, board: normalizeBoard(section) }),
        )

        // Recover the assigned card ID for the changelog and "last added" tracking.
        const located = findDeckCard(deck, cardName, printing, section)
        trackAdd(
          sessionChanges,
          createAddChange(cardName, {
            ...printing,
            section,
            board: normalizeBoard(section),
            cardId: located?.cardId,
          }),
        )

        lastAddedCard = { name: cardName, line: '', hasNote: false, cardId: located?.cardId }
        lastAddedSection = located?.section ?? section
        lastAddedPrinting = printing
        lastAddedCount = 1
        console.log(
          `Added: ${cardName} (${printing.set?.toUpperCase()}:${printing.collectorNumber}) to ${section}`,
        )
        console.log(formatSpecificPrintingPrice(selectedPrinting, finishAndCondition.finish))
      }
    })
}
