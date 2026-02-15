import { Command } from 'commander'
import path from 'path'

export function registerNewDeckCommand(program: Command) {
  program
    .command('new-deck')
    .description('Create a new deck file')
    .argument('<name>', 'Name of the deck')
    .option('-f, --format <format>', 'Deck format (e.g., standard, commander)', 'commander')
    .action(async (name, options) => {
      const decksDir = path.join(process.cwd(), 'decks')
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
        // Simple file check to avoid overwrite
        const fileExists = await Bun.file(filePath).exists()
        if (fileExists) {
          console.error(`Error: Deck file '${fileName}' already exists.`)
          process.exit(1)
        }

        await Bun.write(filePath, content)
        console.log(`Created new deck: ${filePath}`)
      } catch (error) {
        console.error('Failed to create deck:', error)
      }
    })
}
