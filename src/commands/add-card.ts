import { Command } from 'commander'
import path from 'path'
import * as fs from 'fs/promises'
import { searchCards } from '../scryfall'
import * as readline from 'readline'

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

      const quantity = parseInt(options.quantity, 10)
      if (isNaN(quantity) || quantity <= 0) {
        console.error('Quantity must be a positive integer')
        process.exit(1)
      }

      let deckFileName = deckName.endsWith('.md') ? deckName : `${deckName}.md`
      let deckFilePath = path.join(decksDir, deckFileName)

      if (!(await Bun.file(deckFilePath).exists())) {
        const files = await fs.readdir(decksDir)
        const match = files.find((f) => f.toLowerCase().includes(deckName.toLowerCase()))
        if (match) {
          deckFileName = match
          deckFilePath = path.join(decksDir, match)
          console.log(`Found deck file: ${match}`)
        } else {
          console.error(`Deck file not found for '${deckName}'`)
          process.exit(1)
        }
      }

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
        const index = parseInt(answer) - 1
        const selection = results[index]
        if (selection) {
          selectedName = selection.name
        } else {
          console.log('Cancelled.')
          process.exit(0)
        }
      } else {
        // More than 3
        const terminalHeight = process.stdout.rows || 20
        const limit = Math.max(5, terminalHeight - 5) // Leave room for prompt
        const displayList = results.slice(0, limit)

        console.log(`Found ${results.length} results. Top matches:`)
        displayList.forEach((c, i) => console.log(`${i + 1}. ${c.name}`))

        const answer = await promptUser(
          `Select a card (1-${displayList.length}) or return to cancel: `,
        )
        const index = parseInt(answer) - 1
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
        const fileContent = await fs.readFile(deckFilePath, 'utf-8')
        const lines = fileContent.split('\n')
        let mainIndex = lines.findIndex((l) => l.trim() === '## Main')
        if (mainIndex === -1) {
          // If not found, create it at end
          lines.push('')
          lines.push('## Main')
          mainIndex = lines.length - 1
        }

        lines.splice(mainIndex + 1, 0, `${quantity} ${selectedName}`)

        await fs.writeFile(deckFilePath, lines.join('\n'))
        console.log(`Added '${quantity} ${selectedName}' to ${deckFileName}`)
      } catch (e) {
        console.error('Failed to update deck file:', e)
      }
    })
}

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}
