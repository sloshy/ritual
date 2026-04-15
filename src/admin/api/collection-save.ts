import path from 'node:path'
import { loadHash, computeHash, writeFileWithHash, hashPath } from '../../content-hash'
import { loadConfig } from '../config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { getErrorMessage } from '../../errors'
import { isPathWithinDir } from '../../path-validation'
import { MAX_BODY_SIZE } from '../validation'
import { appendChangelog } from '../../changelog-writer'
import type { CollectionCardEntry } from '../../site/data-types'
import type { ChangeEvent } from '../site/types/deck-changes'
import { formatCollectionLine } from '../../commands/collection-helpers'
import { getBaseDir } from '../../base-dir'
import { parseCollectionFile } from '../../commands/price-collection'
import { applyChangeToCollection } from '../site/types/collection-changes'
import { initializeEntriesWithIds } from '../../card-id'
import type { Finish, Condition } from '../../types'

interface CollectionSaveRequest {
  changes: ChangeEvent[]
  contentHash: string
}

function serializeCollectionEntry(entry: CollectionCardEntry): string {
  return formatCollectionLine(
    entry.name,
    entry.set,
    entry.collectorNumber,
    entry.finish,
    entry.condition,
    entry.note,
    entry.cardId,
  ).trimEnd()
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

    const contentLength = Number(req.headers.get('Content-Length') ?? '0')
    if (contentLength > MAX_BODY_SIZE) {
      return Response.json({ success: false, message: 'Request body too large' }, { status: 413 })
    }
    const body = (await req.json()) as CollectionSaveRequest
    const { changes, contentHash } = body

    if (!changes || typeof contentHash !== 'string') {
      return Response.json(
        { success: false, message: 'changes and contentHash are required' },
        { status: 400 },
      )
    }

    const collectionsDir = path.join(getBaseDir(), 'collections')
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

    const filesToCommit: string[] = [filePath, hashPath(filePath)]

    // Read existing file and verify content hash for conflict detection
    const existingContent = await file.text()
    const existingHash = (await loadHash(filePath)) ?? computeHash(existingContent)

    if (existingHash !== contentHash) {
      return Response.json(
        {
          success: false,
          message: 'Collection has been modified since you loaded it. Please reload.',
          conflict: true,
        },
        { status: 409 },
      )
    }

    // Parse the file and build card entries
    const parsed = parseCollectionFile(existingContent)
    const cardEntries: CollectionCardEntry[] = parsed.entries.map((e, i) => ({
      name: e.name,
      set: e.set.toLowerCase(),
      collectorNumber: e.collectorNumber,
      finish: (e.finish ?? 'nonfoil') as Finish,
      condition: (e.condition ?? 'NM') as Condition,
      price: 0,
      fileOrder: i,
      note: e.note,
      cardId: e.cardId,
    }))

    // Initialize IDs and apply changes
    const { entries: entriesWithIds } = initializeEntriesWithIds(cardEntries)
    let current = entriesWithIds as CollectionCardEntry[]
    for (const change of changes) {
      current = applyChangeToCollection(current, change)
    }

    // Preserve header lines (everything before first `- ` line)
    const existingLines = existingContent.split('\n')
    const headerLines: string[] = []
    for (const line of existingLines) {
      if (line.trimStart().startsWith('- ')) break
      headerLines.push(line)
    }

    // Serialize entries
    const entryLines = current.map(serializeCollectionEntry)
    const newContent = headerLines.join('\n') + entryLines.join('\n') + '\n'
    const newContentHash = await writeFileWithHash(filePath, newContent)

    // Write changelog
    if (changes.length > 0) {
      const changelogPath = await appendChangelog(filePath, slug, changes)
      filesToCommit.push(changelogPath)
    }

    // Auto-commit if enabled
    const config = await loadConfig()
    if (shouldAutoCommit(config, collectionsDir)) {
      commitFiles(filesToCommit, `Edit collection: ${slug} (${changes.length} changes)`)
      if (shouldAutoPush(config, collectionsDir)) {
        pushChanges(collectionsDir)
      }
    }

    return Response.json({
      success: true,
      message: `Saved ${changes.length} changes to ${slug}`,
      contentHash: newContentHash,
    })
  } catch (error) {
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}
