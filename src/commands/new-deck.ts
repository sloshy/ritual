import { Command } from 'commander'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { getBaseDir } from '../base-dir'
import { writeFileWithHash } from '../content-hash'

export function registerNewDeckCommand(program: Command) {
  program
    .command('new-deck')
    .description('Create a new deck file')
    .argument('<name>', 'Name of the deck')
    .option('-f, --format <format>', 'Deck format (e.g., standard, commander)', 'commander')
    .action(async (name, options) => {
      const decksDir = path.join(getBaseDir(), 'decks')
      const safeName = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
      const fileName = `${safeName}.md`
      const filePath = path.join(decksDir, fileName)

      // Frontmatter template
      const content = `---
name: "${name}"
format: "${options.format}"
created: "${new Date().toISOString()}"
tags: []
---

# ${name}

// Add your cards here
`

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
