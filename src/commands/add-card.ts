import { Command } from 'commander'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { searchCards } from '../scryfall'
import { resolveDeckFilePath, addCardToDeckFile } from '../deck-file'
import {
  resolveCardPrinting,
  promptFinishAndCondition,
  formatCollectionLine,
  ensureCollectionFile,
  isFinish,
  isCondition,
  type SessionConfig,
} from './collection-helpers'
import type { ScryfallCard } from '../types'
import { promptUser } from '../utils'

type TargetType = 'deck' | 'collection'

function isTargetType(value: string): value is TargetType {
  return value === 'deck' || value === 'collection'
}

type AddCardOptions = {
  quantity: string
  finish?: string
  condition?: string
}

export function registerAddCardCommand(program: Command) {
  program
    .command('add-card')
    .description('Add a card to a deck or collection by name')
    .argument('<type>', 'Target type: "deck" or "collection"')
    .argument('<targetName>', 'Name of the deck or collection (file name without extension)')
    .argument('<cardName...>', 'Name of the card to search for')
    .option('-q, --quantity <number>', 'Number of copies to add (deck only)', '1')
    .option('-f, --finish <finish>', 'Card finish: nonfoil, foil, etched (collection only)')
    .option('-c, --condition <condition>', 'Card condition: NM, LP, MP, HP, DMG (collection only)')
    .action(
      async (
        type: string,
        targetName: string,
        cardNameParts: string[],
        options: AddCardOptions,
      ) => {
        if (!isTargetType(type)) {
          console.error(`Invalid type '${type}'. Must be 'deck' or 'collection'.`)
          process.exit(1)
        }

        const cardName = cardNameParts.join(' ')

        if (type === 'deck') {
          await handleDeckAddCard(targetName, cardName, options)
        } else {
          await handleCollectionAddCard(targetName, cardName, options)
        }
      },
    )
}

async function handleDeckAddCard(
  deckName: string,
  cardName: string,
  options: AddCardOptions,
): Promise<void> {
  const decksDir = path.join(process.cwd(), 'decks')

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
  console.log(`Found deck file: ${deckFileName}`)

  console.log(`Searching for '${cardName}'...`)
  const results = await searchCards(cardName)

  if (results.length === 0) {
    console.error(`No cards found for '${cardName}'`)
    process.exit(1)
  }

  const selectedName = await selectCardFromResults(results)
  if (!selectedName) return

  try {
    await addCardToDeckFile(deckFilePath, { quantity, name: selectedName })
    console.log(`Added '${quantity} ${selectedName}' to ${deckFileName}`)
  } catch (e) {
    console.error('Failed to update deck file:', e)
    process.exit(1)
  }
}

async function handleCollectionAddCard(
  collectionName: string,
  cardName: string,
  options: AddCardOptions,
): Promise<void> {
  const collectionFilePath = await ensureCollectionFile(collectionName)

  console.log(`Searching for '${cardName}'...`)
  const results = await searchCards(cardName)

  if (results.length === 0) {
    console.error(`No cards found for '${cardName}'`)
    process.exit(1)
  }

  const selectedName = await selectCardFromResults(results)
  if (!selectedName) return

  const normalizedCondition = options.condition?.toUpperCase()
  const sessionConfig: SessionConfig = {
    sets: undefined,
    finish: options.finish && isFinish(options.finish) ? options.finish : undefined,
    condition:
      normalizedCondition && isCondition(normalizedCondition) ? normalizedCondition : undefined,
    entryMode: 'name',
    collectorSets: [],
    activeSetIndex: 0,
    setCardMaps: new Map<string, Map<string, ScryfallCard>>(),
  }

  const printingResult = await resolveCardPrinting(selectedName, sessionConfig, true)
  if (!printingResult) {
    console.error('No printing selected.')
    process.exit(1)
  }

  const finishAndCondition = await promptFinishAndCondition(
    printingResult.printing,
    sessionConfig,
    false,
  )
  if (!finishAndCondition) {
    console.log('Cancelled.')
    process.exit(0)
  }

  const line = formatCollectionLine(
    selectedName,
    printingResult.printing,
    finishAndCondition.finish,
    finishAndCondition.condition,
  )

  await fs.appendFile(collectionFilePath, line)
  console.log(`Added: ${line.trim()}`)
}

async function selectCardFromResults(results: ScryfallCard[]): Promise<string | null> {
  if (results.length === 1 && results[0]) {
    const selectedName = results[0].name
    console.log(`Found: ${selectedName}`)
    return selectedName
  }

  if (results.length <= 3) {
    console.log('Multiple matches found:')
    results.forEach((c, i) => console.log(`${i + 1}. ${c.name}`))

    const answer = await promptUser(`Select a card (1-${results.length}) or return to cancel: `)
    const parsed = Number.parseInt(answer, 10)
    if (Number.isNaN(parsed) || parsed < 1 || parsed > results.length) {
      console.log('Cancelled.')
      process.exit(0)
    }
    return results[parsed - 1]!.name
  }

  const terminalHeight = process.stdout.rows ?? 20
  const limit = Math.max(5, terminalHeight - 5)
  const displayList = results.slice(0, limit)

  console.log(`Found ${results.length} results. Top matches:`)
  displayList.forEach((c, i) => console.log(`${i + 1}. ${c.name}`))

  const answer = await promptUser(`Select a card (1-${displayList.length}) or return to cancel: `)
  const parsed = Number.parseInt(answer, 10)
  if (Number.isNaN(parsed) || parsed < 1 || parsed > displayList.length) {
    console.log('Cancelled.')
    process.exit(0)
  }
  return displayList[parsed - 1]!.name
}
