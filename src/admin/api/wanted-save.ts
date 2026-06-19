import path from 'node:path'
import { writeFileWithHash, hashPath } from '../../content-hash'
import { getErrorMessage } from '../../errors'
import { isPathWithinDir } from '../../path-validation'
import { appendChangelog } from '../../changelog-writer'
import type { WantedListCardEntry } from '../../site/data-types'
import type { ChangeEvent } from '../../change-event'
import { getWantedDir } from '../../ritual-config'
import { wantedToMarkdown } from '../../editor/list-export'
import { parseTitleFromContent } from '../../section-format'
import { applyOutgoingMoves } from './move-save'
import {
  validateBodySize,
  validateContentHash,
  autoCommitAndPush,
  normalizeRequestNotes,
} from './save-helpers'

interface WantedListSaveRequest {
  changes: ChangeEvent[]
  entries: WantedListCardEntry[]
  contentHash: string
  /** Section names in display order, including empty sections. Optional for back-compat. */
  sectionOrder?: string[]
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
    const { changes, entries, contentHash, sectionOrder } = body

    if (!entries || !changes || typeof contentHash !== 'string') {
      return Response.json(
        { success: false, message: 'changes, entries, and contentHash are required' },
        { status: 400 },
      )
    }

    const noteError = normalizeRequestNotes(changes, entries)
    if (noteError) return noteError

    const wantedListsDir = getWantedDir()
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

    // Re-serialize as a sectioned list, preserving the `# Title` H1. Entries carry their
    // section from the client; the client-sent section order drives ordering (including any
    // now-empty sections), falling back to the order discovered in the entries themselves.
    const title = parseTitleFromContent(hashCheck.content) ?? slug

    // Apply the destination side of any cross-list moves first; a bad destination
    // aborts before the source is rewritten.
    const movedFiles = await applyOutgoingMoves({ type: 'wanted', name: title }, changes)
    filesToCommit.push(...movedFiles)

    const order = sectionOrder ?? []
    const newContent = wantedToMarkdown(title, entries, order)
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
