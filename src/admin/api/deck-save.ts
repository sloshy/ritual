import path from 'node:path'
import { loadHash, computeHash, writeFileWithHash, hashPath } from '../../content-hash'
import { resolveDeckFilePath, serializeDeckToMarkdown } from '../../deck-file'
import { loadConfig } from '../config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { getErrorMessage } from '../../errors'
import { MAX_BODY_SIZE } from '../validation'
import { appendChangelog } from '../../changelog-writer'
import type { DeckData } from '../../types'
import type { ChangeEvent } from '../site/types/deck-changes'
import { getBaseDir } from '../../base-dir'

interface DeckSaveRequest {
  changes: ChangeEvent[]
  deck: DeckData
  frontMatter: Record<string, unknown>
  contentHash: string
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
    const { changes, deck, frontMatter, contentHash } = body

    if (!deck || !changes || typeof contentHash !== 'string') {
      return Response.json(
        { success: false, message: 'changes, deck, and contentHash are required' },
        { status: 400 },
      )
    }

    const decksDir = path.join(getBaseDir(), 'decks')
    const filePath = await resolveDeckFilePath(decksDir, slug)

    if (!filePath) {
      return Response.json({ success: false, message: `Deck '${slug}' not found` }, { status: 404 })
    }

    // Validate content hash for conflict detection
    const existingContent = await Bun.file(filePath).text()
    const existingHash = (await loadHash(filePath)) ?? computeHash(existingContent)
    if (existingHash !== contentHash) {
      return Response.json(
        {
          success: false,
          message: 'Deck has been modified since you loaded it. Please reload.',
          conflict: true,
        },
        { status: 409 },
      )
    }

    const filesToCommit: string[] = [filePath, hashPath(filePath)]

    // Write changelog
    if (changes.length > 0) {
      const changelogPath = await appendChangelog(filePath, deck.name, changes)
      filesToCommit.push(changelogPath)
    }

    // Write deck file
    const markdown = serializeDeckToMarkdown(deck, frontMatter)
    const newContentHash = await writeFileWithHash(filePath, markdown)

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
      contentHash: newContentHash,
    })
  } catch (error) {
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}
