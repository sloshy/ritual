import path from 'node:path'
import fs from 'node:fs/promises'
import { resolveDeckFilePath, serializeDeckToMarkdown } from '../../deck-file'
import { loadConfig } from '../config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { getErrorMessage } from '../../errors'
import { MAX_BODY_SIZE } from '../validation'
import { appendChangelog } from '../../changelog-writer'
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

    const contentLength = Number(req.headers.get('Content-Length') ?? '0')
    if (contentLength > MAX_BODY_SIZE) {
      return Response.json({ success: false, message: 'Request body too large' }, { status: 413 })
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
      const changelogPath = await appendChangelog(filePath, deck.name, changes)
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
