import path from 'node:path'
import fs from 'node:fs/promises'
import { resolveDeckFilePath, parseDeckFrontMatter } from '../../deck-file'
import { loadConfig } from '../config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { getErrorMessage } from '../../errors'
import { MAX_BODY_SIZE } from '../validation'

interface DeckDeleteRequest {
  confirmName: string
}

interface DeckDeleteResponse {
  success: boolean
  message: string
}

export async function handleDeckDelete(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const slug = pathParts[3]

    if (!slug) {
      const resp: DeckDeleteResponse = { success: false, message: 'Deck slug is required' }
      return Response.json(resp, { status: 400 })
    }

    const contentLength = Number(req.headers.get('Content-Length') ?? '0')
    if (contentLength > MAX_BODY_SIZE) {
      return Response.json({ success: false, message: 'Request body too large' }, { status: 413 })
    }
    const body = (await req.json()) as DeckDeleteRequest
    const { confirmName } = body

    if (!confirmName || typeof confirmName !== 'string') {
      const resp: DeckDeleteResponse = {
        success: false,
        message: 'confirmName is required',
      }
      return Response.json(resp, { status: 400 })
    }

    const decksDir = path.join(process.cwd(), 'decks')
    const filePath = await resolveDeckFilePath(decksDir, slug)

    if (!filePath) {
      const resp: DeckDeleteResponse = {
        success: false,
        message: `Deck '${slug}' not found`,
      }
      return Response.json(resp, { status: 404 })
    }

    const frontMatter = await parseDeckFrontMatter(filePath)
    const deckName = typeof frontMatter['name'] === 'string' ? frontMatter['name'] : slug

    if (confirmName !== deckName) {
      const resp: DeckDeleteResponse = {
        success: false,
        message: `Confirmation name does not match. Expected '${deckName}'.`,
      }
      return Response.json(resp, { status: 400 })
    }

    // Collect paths before deleting (git add works on deleted files for staging)
    const filesToCommit: string[] = [filePath]
    const changelogPath = filePath.replace(/\.md$/, '.changes.md')
    const primerPath = filePath.replace(/\.md$/, '.primer.md')

    if (await Bun.file(changelogPath).exists()) {
      filesToCommit.push(changelogPath)
    }
    if (await Bun.file(primerPath).exists()) {
      filesToCommit.push(primerPath)
    }

    // Delete files
    await fs.unlink(filePath)
    for (const extra of filesToCommit.slice(1)) {
      await fs.unlink(extra)
    }

    // Auto-commit if enabled (git add stages deletions of tracked files)
    const config = await loadConfig()
    if (shouldAutoCommit(config, decksDir)) {
      commitFiles(filesToCommit, `Delete deck: ${deckName}`)
      if (shouldAutoPush(config, decksDir)) {
        pushChanges(decksDir)
      }
    }

    const resp: DeckDeleteResponse = {
      success: true,
      message: `Deleted deck '${deckName}'`,
    }
    return Response.json(resp)
  } catch (error) {
    const resp: DeckDeleteResponse = { success: false, message: getErrorMessage(error) }
    return Response.json(resp, { status: 500 })
  }
}
