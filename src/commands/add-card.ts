import { Command } from 'commander'
import path from 'node:path'
import { searchCards } from '../scryfall'
import { createInterface } from 'node:readline/promises'
import { resolveDeckFilePath, addCardToDeckFile } from '../deck-file'

export function registerAddCardCommand(program: Command) {
  program
    .command('add-card')
    .description('Add a card to a deck by name')
    .argument('<deckName>', 'Name of the deck (file name without extension)')
    .argument('<cardName...>', 'Name of the card to search for')
    .option('-q, --quantity <number>', 'Number of copies to add', '1')
    .action(async (deckName, cardNameParts, options) => {
      const cardName = cardNameParts.join(' ')
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

      let selectedName: string | null = null

      if (results.length === 1 && results[0]) {
        selectedName = results[0].name
        console.log(`Found: ${selectedName}`)
      } else if (results.length <= 3) {
        console.log(`Multiple matches found:`)
        results.forEach((c, i) => console.log(`${i + 1}. ${c.name}`))

        const answer = await promptUser('Select a card (1-3) or return to cancel: ')
        const index = Number.parseInt(answer, 10) - 1
        const selection = results[index]
        if (selection) {
          selectedName = selection.name
        } else {
          console.log('Cancelled.')
          process.exit(0)
        }
      } else {
        // More than 3
        const terminalHeight = process.stdout.rows ?? 20
        const limit = Math.max(5, terminalHeight - 5) // Leave room for prompt
        const displayList = results.slice(0, limit)

        console.log(`Found ${results.length} results. Top matches:`)
        displayList.forEach((c, i) => console.log(`${i + 1}. ${c.name}`))

        const answer = await promptUser(
          `Select a card (1-${displayList.length}) or return to cancel: `,
        )
        const index = Number.parseInt(answer, 10) - 1
        const selection = displayList[index]
        if (selection) {
          selectedName = selection.name
        } else {
          console.log('Cancelled.')
          process.exit(0)
        }
      }

      if (!selectedName) {
        console.error('No card selected.')
        process.exit(1)
      }

      try {
        await addCardToDeckFile(deckFilePath, { quantity, name: selectedName })
        console.log(`Added '${quantity} ${selectedName}' to ${deckFileName}`)
      } catch (e) {
        console.error('Failed to update deck file:', e)
      }
    })
}

async function promptUser(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}
