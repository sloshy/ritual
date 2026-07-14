import { Command } from 'commander'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { writeFileWithHash } from '../content-hash'
import { newDeckMarkdown } from '../deck-file'
import { invalidDeckFormatMessage, parseDeckFormat } from '../deck-format'
import { listFileName, unusableFileNameMessage } from '../list-file-name'
import { getDecksDir } from '../ritual-config'

type NewDeckOptions = { format: string }

export function registerNewDeckCommand(program: Command): void {
  program
    .command('new-deck')
    .description('Create a new deck file')
    .argument('<name>', 'Name of the deck')
    .option('-f, --format <format>', 'Deck format (e.g., standard, commander)', 'commander')
    .action(async (name: string, options: NewDeckOptions) => {
      const decksDir = getDecksDir()
      const format = parseDeckFormat(options.format)
      if (!format) {
        console.error(invalidDeckFormatMessage(options.format))
        process.exit(1)
      }

      const fileName = listFileName(name)
      if (fileName === null) {
        console.error(unusableFileNameMessage(name))
        process.exit(1)
      }
      const filePath = path.join(decksDir, fileName)

      const content = newDeckMarkdown(name, format)

      try {
        await fs.mkdir(decksDir, { recursive: true })

        // Simple file check to avoid overwrite
        const fileExists = await Bun.file(filePath).exists()
        if (fileExists) {
          console.error(`Error: Deck file '${fileName}' already exists.`)
          process.exit(1)
        }

        await writeFileWithHash(filePath, content)
        console.log(`Created new deck: ${filePath}`)
      } catch (error) {
        console.error('Failed to create deck:', error)
        process.exit(1)
      }
    })
}
