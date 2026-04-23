import { Command } from 'commander'
import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { getAllCardNames, getCardPrintings } from '../scryfall'
import { resolveDeckFilePath, addCardToDeckFile } from '../deck-file'
import {
  resolveCardPrinting,
  promptFinishAndCondition,
  formatCollectionLine,
  ensureCollectionFile,
  isFinish,
  isCondition,
  type PrintingFilterConfig,
  type FinishConditionConfig,
} from './collection-helpers'
import { ensureWantedListFile, formatWantedListLine, promptWantedFinish } from './wanted-helpers'
import { ensureFreshCardCache } from '../cache/freshness'
import { appendChangelog } from '../changelog-writer'
import { createAddChange } from '../change-event'
import { allocateNextIdFromContent } from '../card-id'
import { getBaseDir } from '../base-dir'
import { appendFileWithHash } from '../content-hash'
import {
  findCheapestPrinting,
  formatSpecificPrintingPrice,
  formatCheapestPrintingDisplay,
} from '../price-currency'

/** Parse existing &N IDs from a file and allocate the next available ID. */
async function allocateNextIdFromFile(filePath: string): Promise<number> {
  let content = ''
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    // File may not exist yet
  }
  const { nextId } = allocateNextIdFromContent(content)
  return nextId
}

type TargetType = 'deck' | 'collection' | 'wanted'

function isTargetType(value: string): value is TargetType {
  return value === 'deck' || value === 'collection' || value === 'wanted'
}

type AddCardOptions = {
  quantity: string
  finish?: string
  condition?: string
  exact?: boolean
}

/**
 * Normalize a card name for exact matching by stripping punctuation
 * and collapsing to lowercase.
 */
export function normalizeCardName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Attempt an exact match against cached card names.
 * Returns the canonical card name if exactly one match is found, null otherwise.
 */
function findExactMatch(inputName: string, cardNames: string[]): string | null {
  const normalized = normalizeCardName(inputName)
  const matches = cardNames.filter((name) => normalizeCardName(name) === normalized)
  if (matches.length === 1 && matches[0]) return matches[0]
  return null
}

/**
 * Count how many card names contain the input as a normalized substring.
 * Short-circuits at `limit` to avoid scanning the full list unnecessarily.
 */
function countSubstringMatches(inputName: string, cardNames: string[], limit: number): number {
  const normalized = normalizeCardName(inputName)
  let count = 0
  for (const name of cardNames) {
    if (normalizeCardName(name).includes(normalized)) {
      count++
      if (count >= limit) return count
    }
  }
  return count
}

/**
 * Select a card name using an autocomplete prompt backed by the card cache.
 * When initialSearch is provided, pre-sorts matching cards to the top.
 */
async function selectCardAutocomplete(
  cardNames: string[],
  initialSearch: string,
): Promise<string | null> {
  // Pre-filter: only include cards whose normalized name contains the normalized search as a substring
  let filteredNames = cardNames
  if (initialSearch) {
    const normalizedSearch = normalizeCardName(initialSearch)
    filteredNames = cardNames.filter((name) => normalizeCardName(name).includes(normalizedSearch))

    if (filteredNames.length === 0) {
      console.log(`No cards found matching '${initialSearch}'.`)
      return null
    }

    console.log(
      `Found ${filteredNames.length} card${filteredNames.length !== 1 ? 's' : ''} matching '${initialSearch}'.`,
    )
  }

  const choices = filteredNames.map((name) => ({ title: name, value: name }))

  let isExited = false
  const response = await prompts({
    type: 'autocomplete',
    name: 'cardName',
    message: 'Select a card:',
    choices,
    limit: 15,
    suggest: async (rawInput, choices) => {
      const input = String(rawInput)
      if (!input) return choices.slice(0, 15)

      const terms = input.toLowerCase().split(/\s+/).filter(Boolean)
      return choices.filter((choice) => {
        const title = choice.title.toLowerCase()
        return terms.every((term) => title.includes(term))
      })
    },
    onState: (state: PromptState) => {
      if (state.exited) isExited = true
    },
  })

  if (isExited || !response.cardName) return null
  return response.cardName as string
}

export function registerAddCardCommand(program: Command) {
  program
    .command('add-card')
    .description('Add a card to a deck, collection, or wanted list by name')
    .argument('<type>', 'Target type: "deck", "collection", or "wanted"')
    .argument(
      '<targetName>',
      'Name of the deck, collection, or wanted list (file name without extension)',
    )
    .argument('<cardName...>', 'Name of the card to search for')
    .option('-q, --quantity <number>', 'Number of copies to add (deck only)', '1')
    .option('-f, --finish <finish>', 'Card finish: nonfoil, foil, etched (collection/wanted only)')
    .option('-c, --condition <condition>', 'Card condition: NM, LP, MP, HP, DMG (collection only)')
    .option('-e, --exact', 'Use exact matching (skip interactive selection if name matches)', false)
    .action(
      async (
        type: string,
        targetName: string,
        cardNameParts: string[],
        options: AddCardOptions,
      ) => {
        if (!isTargetType(type)) {
          console.error(`Invalid type '${type}'. Must be 'deck', 'collection', or 'wanted'.`)
          process.exit(1)
        }

        const cardNameInput = cardNameParts.join(' ')

        // Ensure card cache is available and fresh
        const cacheResult = await ensureFreshCardCache()
        if (!cacheResult.ready) {
          console.error('Card cache is not available. Cannot proceed without cached card data.')
          process.exit(1)
        }

        console.log(`Loaded ${cacheResult.cardCount} cards from cache.`)

        const cardNames = await getAllCardNames()

        // Resolve the card name (exact match or autocomplete)
        let selectedName: string | null = null

        if (options.exact) {
          selectedName = findExactMatch(cardNameInput, cardNames)
          if (selectedName) {
            console.log(`Exact match found: ${selectedName}`)
          } else {
            const matchCount = countSubstringMatches(cardNameInput, cardNames, 100)
            const countLabel = matchCount >= 100 ? '100+' : String(matchCount)
            console.error(
              `No exact match for '${cardNameInput}'. ${countLabel} card${matchCount !== 1 ? 's' : ''} contain that name.`,
            )
            process.exit(1)
          }
        } else {
          selectedName = await selectCardAutocomplete(cardNames, cardNameInput)
        }

        if (!selectedName) {
          console.log('Cancelled.')
          process.exit(0)
        }

        switch (type) {
          case 'deck':
            await handleDeckAddCard(targetName, selectedName, options)
            break
          case 'collection':
            await handleCollectionAddCard(targetName, selectedName, options)
            break
          case 'wanted':
            await handleWantedAddCard(targetName, selectedName, options)
            break
        }
      },
    )
}

async function handleDeckAddCard(
  deckName: string,
  selectedName: string,
  options: AddCardOptions,
): Promise<void> {
  const decksDir = path.join(getBaseDir(), 'decks')

  const quantity = Number.parseInt(options.quantity, 10)
  if (Number.isNaN(quantity) || quantity <= 0) {
    console.error('Quantity must be a positive integer')
    process.exit(1)
  }

  const deckFilePath = await resolveDeckFilePath(decksDir, deckName)
  if (!deckFilePath) {
    console.error(`Deck file not found for '${deckName}'`)
    process.exit(1)
  }
  const deckFileName = path.basename(deckFilePath)

  try {
    await addCardToDeckFile(deckFilePath, { quantity, name: selectedName })
    console.log(`Added '${quantity} ${selectedName}' to ${deckFileName}`)
  } catch (e) {
    console.error('Failed to update deck file:', e)
    process.exit(1)
  }

  // Note: addCardToDeckFile allocates the cardId internally.
  // The changelog records the change without the ID since it was assigned during file write.
  const change = createAddChange(selectedName)
  await appendChangelog(deckFilePath, deckName, [change])
}

async function handleCollectionAddCard(
  collectionName: string,
  selectedName: string,
  options: AddCardOptions,
): Promise<void> {
  if (collectionName.endsWith('.changes') || collectionName.endsWith('.changes.md')) {
    console.error(`'${collectionName}' is a changelog file and cannot be used as a collection.`)
    process.exit(1)
  }
  const collectionFilePath = await ensureCollectionFile(collectionName)

  const normalizedCondition = options.condition?.toUpperCase()
  const printingConfig: PrintingFilterConfig = {}
  const finishConditionConfig: FinishConditionConfig = {
    finish: options.finish && isFinish(options.finish) ? options.finish : undefined,
    condition:
      normalizedCondition && isCondition(normalizedCondition) ? normalizedCondition : undefined,
  }

  const printingResult = await resolveCardPrinting(selectedName, printingConfig, true)
  if (!printingResult) {
    console.error('No printing selected.')
    process.exit(1)
  }

  const finishAndCondition = await promptFinishAndCondition(
    printingResult.printing,
    finishConditionConfig,
    false,
  )
  if (!finishAndCondition) {
    console.log('Cancelled.')
    process.exit(0)
  }

  // Parse existing IDs to allocate the next one
  const cardId = await allocateNextIdFromFile(collectionFilePath)

  const line = formatCollectionLine(
    selectedName,
    printingResult.printing.set,
    printingResult.printing.collector_number,
    finishAndCondition.finish,
    finishAndCondition.condition,
    undefined,
    cardId,
  )

  await appendFileWithHash(collectionFilePath, line)
  console.log(`Added: ${line.trim()}`)
  console.log(formatSpecificPrintingPrice(printingResult.printing, finishAndCondition.finish))

  const change = createAddChange(selectedName, {
    set: printingResult.printing.set.toLowerCase(),
    collectorNumber: printingResult.printing.collector_number,
    finish: finishAndCondition.finish,
    condition: finishAndCondition.condition,
    cardId,
  })
  await appendChangelog(collectionFilePath, collectionName, [change])
}

async function handleWantedAddCard(
  wantedListName: string,
  selectedName: string,
  options: AddCardOptions,
): Promise<void> {
  if (wantedListName.endsWith('.changes') || wantedListName.endsWith('.changes.md')) {
    console.error(`'${wantedListName}' is a changelog file and cannot be used as a wanted list.`)
    process.exit(1)
  }
  const listFile = await ensureWantedListFile(wantedListName)
  const userFinish = options.finish && isFinish(options.finish) ? options.finish : undefined

  const specificityResponse = await prompts({
    type: 'select',
    name: 'specificity',
    message: `How specific for ${selectedName}?`,
    choices: [
      { title: 'Name only (any copy)', value: 'name-only' },
      { title: 'Choose specific printing', value: 'specific' },
    ],
  })

  if (!specificityResponse.specificity) {
    console.log('Cancelled.')
    process.exit(0)
  }

  if (specificityResponse.specificity === 'name-only') {
    const cardId = await allocateNextIdFromFile(listFile)
    const line = formatWantedListLine(selectedName, undefined, userFinish, undefined, cardId)
    await appendFileWithHash(listFile, line)
    console.log(`Added: ${line.trim()}`)
    const allPrintings = await getCardPrintings(selectedName)
    console.log(formatCheapestPrintingDisplay(findCheapestPrinting(allPrintings)))
    const change = createAddChange(selectedName, { finish: userFinish, cardId })
    await appendChangelog(listFile, wantedListName, [change])
    return
  }

  // Specific printing flow
  const printingResult = await resolveCardPrinting(selectedName, {}, true)
  if (!printingResult) {
    console.log('No printing selected. Adding name only.')
    const cardId = await allocateNextIdFromFile(listFile)
    const line = formatWantedListLine(selectedName, undefined, userFinish, undefined, cardId)
    await appendFileWithHash(listFile, line)
    console.log(`Added: ${line.trim()}`)
    const allPrintings = await getCardPrintings(selectedName)
    console.log(formatCheapestPrintingDisplay(findCheapestPrinting(allPrintings)))
    const change = createAddChange(selectedName, { finish: userFinish, cardId })
    await appendChangelog(listFile, wantedListName, [change])
    return
  }

  const finishResult = await promptWantedFinish(printingResult.printing, userFinish)
  if (finishResult === 'cancelled') {
    console.log('Cancelled.')
    process.exit(0)
  }

  const finish = finishResult === 'nopreference' ? undefined : finishResult
  const cardId = await allocateNextIdFromFile(listFile)
  const line = formatWantedListLine(
    selectedName,
    {
      set: printingResult.printing.set,
      collectorNumber: printingResult.printing.collector_number,
    },
    finish,
    undefined,
    cardId,
  )

  await appendFileWithHash(listFile, line)
  console.log(`Added: ${line.trim()}`)
  console.log(formatSpecificPrintingPrice(printingResult.printing, finish))

  const change = createAddChange(selectedName, {
    set: printingResult.printing.set.toLowerCase(),
    collectorNumber: printingResult.printing.collector_number,
    finish: finish,
    cardId,
  })
  await appendChangelog(listFile, wantedListName, [change])
}
