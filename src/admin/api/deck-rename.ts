import path from 'node:path'
import fs from 'node:fs/promises'
import { resolveDeckFilePath, parseDeckFrontMatter } from '../../deck-file'
import { loadConfig } from '../config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { getErrorMessage } from '../../errors'
import { MAX_BODY_SIZE } from '../validation'
import { getBaseDir } from '../../base-dir'
import { writeFileWithHash, hashPath } from '../../content-hash'

interface DeckRenameRequest {
  newName: string
}

interface DeckRenameResponse {
  success: boolean
  message: string
  newSlug?: string
}

export async function handleDeckRename(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const slug = pathParts[3]

    if (!slug) {
      const resp: DeckRenameResponse = { success: false, message: 'Deck slug is required' }
      return Response.json(resp, { status: 400 })
    }

    const contentLength = Number(req.headers.get('Content-Length') ?? '0')
    if (contentLength > MAX_BODY_SIZE) {
      return Response.json({ success: false, message: 'Request body too large' }, { status: 413 })
    }
    const body = (await req.json()) as DeckRenameRequest
    const { newName } = body

    if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
      const resp: DeckRenameResponse = { success: false, message: 'New deck name is required' }
      return Response.json(resp, { status: 400 })
    }

    const trimmedName = newName.trim()
    const newSlug = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    if (!newSlug) {
      const resp: DeckRenameResponse = {
        success: false,
        message: 'New name must contain at least one alphanumeric character',
      }
      return Response.json(resp, { status: 400 })
    }

    const decksDir = path.join(getBaseDir(), 'decks')
    const filePath = await resolveDeckFilePath(decksDir, slug)

    if (!filePath) {
      const resp: DeckRenameResponse = {
        success: false,
        message: `Deck '${slug}' not found`,
      }
      return Response.json(resp, { status: 404 })
    }

    const newFilePath = path.join(decksDir, `${newSlug}.md`)

    if (newFilePath !== filePath && (await Bun.file(newFilePath).exists())) {
      const resp: DeckRenameResponse = {
        success: false,
        message: `A deck with slug '${newSlug}' already exists`,
      }
      return Response.json(resp, { status: 409 })
    }

    // Load existing content and old name before making changes
    const existingContent = await fs.readFile(filePath, 'utf-8')
    const frontMatter = await parseDeckFrontMatter(filePath)
    const oldName = typeof frontMatter['name'] === 'string' ? frontMatter['name'] : slug

    // Replace the frontmatter name field in the file content
    const updatedContent = existingContent.replace(
      /^(---[\s\S]*?)name:\s*["']?[^"'\n]*["']?([\s\S]*?---)/m,
      (_, before, after) => `${before}name: "${trimmedName}"${after}`,
    )
    const finalContent = updatedContent.replace(
      new RegExp(`^# ${escapeRegex(oldName)}$`, 'm'),
      `# ${trimmedName}`,
    )

    const filesToCommit: string[] = []

    if (newFilePath !== filePath) {
      // Write new file with updated content, then remove old file and its sidecar
      await writeFileWithHash(newFilePath, finalContent)
      await fs.unlink(filePath)
      await fs.unlink(hashPath(filePath)).catch(() => undefined)
      filesToCommit.push(filePath, hashPath(filePath), newFilePath, hashPath(newFilePath))

      // Handle changelog file
      const oldChangelogPath = filePath.replace(/\.md$/, '.changes.md')
      const newChangelogPath = newFilePath.replace(/\.md$/, '.changes.md')
      if (await Bun.file(oldChangelogPath).exists()) {
        const changelogContent = await fs.readFile(oldChangelogPath, 'utf-8')
        await Bun.write(newChangelogPath, changelogContent)
        await fs.unlink(oldChangelogPath)
        filesToCommit.push(oldChangelogPath, newChangelogPath)
      }

      // Handle primer file
      const oldPrimerPath = filePath.replace(/\.md$/, '.primer.md')
      const newPrimerPath = newFilePath.replace(/\.md$/, '.primer.md')
      if (await Bun.file(oldPrimerPath).exists()) {
        const primerContent = await fs.readFile(oldPrimerPath, 'utf-8')
        await Bun.write(newPrimerPath, primerContent)
        await fs.unlink(oldPrimerPath)
        filesToCommit.push(oldPrimerPath, newPrimerPath)
      }
    } else {
      // Same slug, just update name in file
      await writeFileWithHash(filePath, finalContent)
      filesToCommit.push(filePath, hashPath(filePath))
    }

    const config = await loadConfig()
    if (shouldAutoCommit(config, decksDir)) {
      commitFiles(filesToCommit, `Rename deck: ${oldName} → ${trimmedName}`)
      if (shouldAutoPush(config, decksDir)) {
        pushChanges(decksDir)
      }
    }

    const resp: DeckRenameResponse = {
      success: true,
      message: `Renamed deck to '${trimmedName}'`,
      newSlug,
    }
    return Response.json(resp)
  } catch (error) {
    const resp: DeckRenameResponse = { success: false, message: getErrorMessage(error) }
    return Response.json(resp, { status: 500 })
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
