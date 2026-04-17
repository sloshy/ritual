import path from 'node:path'
import { writeFileWithHash, hashPath } from '../../content-hash'
import { resolveDeckFilePath, serializeDeckToMarkdown } from '../../deck-file'
import { getErrorMessage } from '../../errors'
import { appendChangelog } from '../../changelog-writer'
import type { DeckData } from '../../types'
import type { ChangeEvent } from '../site/types/deck-changes'
import { getBaseDir } from '../../base-dir'
import { validateBodySize, validateContentHash, autoCommitAndPush } from './save-helpers'

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

    const sizeError = validateBodySize(req)
    if (sizeError) return sizeError
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
    const hashCheck = await validateContentHash(filePath, contentHash, 'Deck')
    if (!hashCheck.valid) return hashCheck.response

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
    await autoCommitAndPush(
      decksDir,
      filesToCommit,
      `Edit deck: ${deck.name} (${changes.length} changes)`,
    )

    return Response.json({
      success: true,
      message: `Saved ${changes.length} changes to ${deck.name}`,
      contentHash: newContentHash,
    })
  } catch (error) {
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}
