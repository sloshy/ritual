import path from 'node:path'
import { writeFileWithHash, hashPath } from '../../content-hash'
import { getErrorMessage } from '../../errors'
import { isPathWithinDir } from '../../path-validation'
import { appendChangelog } from '../../changelog-writer'
import type { CollectionCardEntry } from '../../site/data-types'
import type { ChangeEvent } from '../../change-event'
import { getCollectionsDir } from '../../ritual-config'
import { parseCollectionFile } from '../../commands/price-collection'
import { applyChangeToCollection } from '../../editor/collection-changes'
import { collectionToMarkdown } from '../../editor/list-export'
import { parseTitleFromContent } from '../../section-format'
import { applyOutgoingMoves } from './move-save'
import {
  validateBodySize,
  validateContentHash,
  autoCommitAndPush,
  normalizeRequestNotes,
} from './save-helpers'

interface CollectionSaveRequest {
  changes: ChangeEvent[]
  contentHash: string
  /** Section names in display order, including empty sections. Optional for back-compat. */
  sectionOrder?: string[]
  /** Merge into the session's existing changelog entry instead of a new one. */
  continueSession?: boolean
}

export async function handleCollectionSave(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const rawSlug = pathParts[3]

    if (!rawSlug) {
      return Response.json(
        { success: false, message: 'Collection slug is required' },
        { status: 400 },
      )
    }

    const slug = decodeURIComponent(rawSlug)

    const sizeError = validateBodySize(req)
    if (sizeError) return sizeError
    const body = (await req.json()) as CollectionSaveRequest
    const { changes, contentHash, sectionOrder, continueSession } = body

    if (!changes || typeof contentHash !== 'string') {
      return Response.json(
        { success: false, message: 'changes and contentHash are required' },
        { status: 400 },
      )
    }

    const noteError = normalizeRequestNotes(changes, [])
    if (noteError) return noteError

    const collectionsDir = getCollectionsDir()
    const filePath = path.join(collectionsDir, slug + '.md')
    if (!isPathWithinDir(filePath, collectionsDir)) {
      return Response.json({ success: false, message: 'Invalid collection slug' }, { status: 400 })
    }
    const file = Bun.file(filePath)

    if (!(await file.exists())) {
      return Response.json(
        { success: false, message: `Collection '${slug}' not found` },
        { status: 404 },
      )
    }

    // Validate content hash for conflict detection
    const hashCheck = await validateContentHash(filePath, contentHash, 'Collection')
    if (!hashCheck.valid) return hashCheck.response

    const filesToCommit: string[] = [filePath, hashPath(filePath)]

    // Parse the file and build card entries
    const parsed = parseCollectionFile(hashCheck.content)
    const cardEntries: CollectionCardEntry[] = parsed.entries.map((e, i) => ({
      name: e.name,
      set: e.set.toLowerCase(),
      collectorNumber: e.collectorNumber,
      finish: e.finish ?? 'nonfoil',
      condition: e.condition ?? 'NM',
      price: 0,
      fileOrder: i,
      section: e.section,
      note: e.note,
      cardId: e.cardId,
    }))

    let current = cardEntries
    for (const change of changes) {
      current = applyChangeToCollection(current, change)
    }

    // Re-serialize as a sectioned list, preserving the `# Title` H1. The client-sent section
    // order (which reflects any add/rename/remove-section edits, including now-empty sections)
    // drives ordering; fall back to the file's parsed order when the client omits it.
    const title = parseTitleFromContent(hashCheck.content) ?? slug

    // Apply the destination side of any cross-list moves first; a bad destination
    // aborts before the source is rewritten.
    const movedFiles = await applyOutgoingMoves({ type: 'collection', name: title }, changes)
    filesToCommit.push(...movedFiles)

    const order = sectionOrder ?? parsed.sectionOrder
    const newContent = collectionToMarkdown(title, current, order)
    const newContentHash = await writeFileWithHash(filePath, newContent)

    // Write changelog
    if (changes.length > 0) {
      const changelogPath = await appendChangelog(filePath, slug, changes, { continueSession })
      filesToCommit.push(changelogPath)
    }

    // Auto-commit if enabled
    await autoCommitAndPush(
      collectionsDir,
      filesToCommit,
      `Edit collection: ${slug} (${changes.length} changes)`,
    )

    return Response.json({
      success: true,
      message: `Saved ${changes.length} changes to ${slug}`,
      contentHash: newContentHash,
    })
  } catch (error) {
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}
