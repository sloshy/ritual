import path from 'node:path'
import fs from 'node:fs/promises'
import { resolveDeckFilePath, serializeDeckToMarkdown } from '../../deck-file'
import { loadConfig } from '../config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { getErrorMessage } from '../../errors'
import type { DeckData } from '../../types'
import type { ChangeEvent } from '../site/types/deck-changes'

interface DeckSaveRequest {
  changes: ChangeEvent[]
  deck: DeckData
  frontMatter: Record<string, unknown>
}

export async function handleDeckSave(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const slug = pathParts[3]

    if (!slug) {
      return Response.json({ success: false, message: 'Deck slug is required' }, { status: 400 })
    }

    const body = (await req.json()) as DeckSaveRequest
    const { changes, deck, frontMatter } = body

    if (!deck || !changes) {
      return Response.json(
        { success: false, message: 'changes and deck are required' },
        { status: 400 },
      )
    }

    const decksDir = path.join(process.cwd(), 'decks')
    const filePath = await resolveDeckFilePath(decksDir, slug)

    if (!filePath) {
      return Response.json({ success: false, message: `Deck '${slug}' not found` }, { status: 404 })
    }

    const filesToCommit: string[] = [filePath]

    // Write changelog
    if (changes.length > 0) {
      const changelogPath = filePath.replace(/\.md$/, '.changes.md')
      const timestamp = new Date().toISOString()
      const changeLines = changes.map((c) => {
        let desc = ''
        const printingInfo = c.set && c.collectorNumber ? ` (${c.set}:${c.collectorNumber})` : ''
        const finishInfo = c.finish && c.finish !== 'nonfoil' ? ` [${c.finish}]` : ''
        const conditionInfo = c.condition && c.condition !== 'NM' ? ` [${c.condition}]` : ''

        switch (c.action) {
          case 'add':
            desc = `Added ${c.cardName}${printingInfo}${finishInfo}${conditionInfo}`
            break
          case 'remove':
            desc = `Removed ${c.cardName}${printingInfo}${finishInfo}${conditionInfo}`
            break
          case 'set-commander':
            desc = `Set ${c.cardName} as commander`
            break
          case 'set-finish':
            desc = `Set ${c.cardName} finish to ${c.finish ?? 'nonfoil'}`
            break
        }
        return `- ${desc}`
      })

      const changelogEntry = `\n## ${timestamp}\n\n${changeLines.join('\n')}\n`

      let existingContent = ''
      try {
        existingContent = await fs.readFile(changelogPath, 'utf-8')
      } catch {
        existingContent = `# Changelog for ${deck.name}\n`
      }

      await fs.writeFile(changelogPath, existingContent + changelogEntry)
      filesToCommit.push(changelogPath)
    }

    // Write deck file
    const markdown = serializeDeckToMarkdown(deck, frontMatter)
    await fs.writeFile(filePath, markdown)

    // Auto-commit if enabled
    const config = await loadConfig()
    if (shouldAutoCommit(config, decksDir)) {
      commitFiles(filesToCommit, `Edit deck: ${deck.name} (${changes.length} changes)`)
      if (shouldAutoPush(config, decksDir)) {
        pushChanges(decksDir)
      }
    }

    return Response.json({
      success: true,
      message: `Saved ${changes.length} changes to ${deck.name}`,
    })
  } catch (error) {
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}
