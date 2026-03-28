import path from 'node:path'
import fs from 'node:fs/promises'
import { loadConfig } from '../config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { getErrorMessage } from '../../errors'
import { isPathWithinDir } from '../../path-validation'
import { MAX_BODY_SIZE } from '../validation'
import { appendChangelog } from '../../changelog-writer'
import type { CollectionCardEntry } from '../../site/data-types'
import type { ChangeEvent } from '../site/types/deck-changes'
import { formatCollectionLine } from '../../commands/collection-helpers'

interface CollectionSaveRequest {
  changes: ChangeEvent[]
  entries: CollectionCardEntry[]
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
    const { changes, entries } = body

    if (!entries || !changes) {
      return Response.json(
        { success: false, message: 'changes and entries are required' },
        { status: 400 },
      )
    }

    const collectionsDir = path.join(process.cwd(), 'collections')
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

    const filesToCommit: string[] = [filePath]

    // Read existing file to preserve header/front matter
    const existingContent = await file.text()
    const existingLines = existingContent.split('\n')
    const headerLines: string[] = []
    for (const line of existingLines) {
      if (line.trimStart().startsWith('- ')) break
      headerLines.push(line)
    }

    // Serialize entries
    const entryLines = entries.map(serializeCollectionEntry)
    const newContent = headerLines.join('\n') + entryLines.join('\n') + '\n'
    await fs.writeFile(filePath, newContent)

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
    })
  } catch (error) {
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}
