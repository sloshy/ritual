import path from 'node:path'
import { writeFileWithHash, hashPath } from '../../content-hash'
import { getErrorMessage } from '../../errors'
import { isPathWithinDir } from '../../path-validation'
import { appendChangelog } from '../../changelog-writer'
import type { WantedListCardEntry } from '../../site/data-types'
import type { ChangeEvent } from '../../change-event'
import { formatWantedListLine } from '../../commands/wanted-helpers'
import { getBaseDir } from '../../base-dir'
import { validateBodySize, validateContentHash, autoCommitAndPush } from './save-helpers'

interface WantedListSaveRequest {
  changes: ChangeEvent[]
  entries: WantedListCardEntry[]
  contentHash: string
}

function serializeWantedListEntry(entry: WantedListCardEntry): string {
  return formatWantedListLine(
    entry.name,
    entry.set && entry.collectorNumber
      ? { set: entry.set, collectorNumber: entry.collectorNumber }
      : undefined,
    entry.finish,
    entry.note,
    entry.cardId,
  ).trimEnd()
}

export async function handleWantedListSave(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const rawSlug = pathParts[3]

    if (!rawSlug) {
      return Response.json(
        { success: false, message: 'Wanted list slug is required' },
        { status: 400 },
      )
    }

    const slug = decodeURIComponent(rawSlug)

    const sizeError = validateBodySize(req)
    if (sizeError) return sizeError
    const body = (await req.json()) as WantedListSaveRequest
    const { changes, entries, contentHash } = body

    if (!entries || !changes || typeof contentHash !== 'string') {
      return Response.json(
        { success: false, message: 'changes, entries, and contentHash are required' },
        { status: 400 },
      )
    }

    const wantedListsDir = path.join(getBaseDir(), 'wanted')
    const filePath = path.join(wantedListsDir, slug + '.md')
    if (!isPathWithinDir(filePath, wantedListsDir)) {
      return Response.json({ success: false, message: 'Invalid wanted list slug' }, { status: 400 })
    }
    const file = Bun.file(filePath)

    if (!(await file.exists())) {
      return Response.json(
        { success: false, message: `Wanted list '${slug}' not found` },
        { status: 404 },
      )
    }

    // Validate content hash for conflict detection
    const hashCheck = await validateContentHash(filePath, contentHash, 'Wanted list')
    if (!hashCheck.valid) return hashCheck.response

    const filesToCommit: string[] = [filePath, hashPath(filePath)]

    const existingLines = hashCheck.content.split('\n')
    const headerLines: string[] = []
    for (const line of existingLines) {
      if (line.trimStart().startsWith('- ')) break
      headerLines.push(line)
    }

    // Serialize entries
    const entryLines = entries.map(serializeWantedListEntry)
    const newContent = headerLines.join('\n') + entryLines.join('\n') + '\n'
    const newContentHash = await writeFileWithHash(filePath, newContent)

    // Write changelog
    if (changes.length > 0) {
      const changelogPath = await appendChangelog(filePath, slug, changes)
      filesToCommit.push(changelogPath)
    }

    // Auto-commit if enabled
    await autoCommitAndPush(
      wantedListsDir,
      filesToCommit,
      `Edit wanted list: ${slug} (${changes.length} changes)`,
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
