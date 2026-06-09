import path from 'node:path'
import fs from 'node:fs/promises'
import { writeFileWithHash, hashPath } from '../../content-hash'
import { getErrorMessage } from '../../errors'
import { isPathWithinDir } from '../../path-validation'
import { sanitizeDeckFileName, capitalize } from '../../utils'
import { parseTitleFromContent } from '../../section-format'
import { autoCommitAndPush, validateBodySize } from './save-helpers'

export type SimpleListKind = 'collection' | 'wanted'

export type SimpleListConfig = {
  kind: SimpleListKind
  getDir: () => string
  /** Singular human-readable label, e.g. 'collection' or 'wanted list'. */
  label: string
}

type SimpleListResponse = {
  success: boolean
  message: string
  slug?: string
  newSlug?: string
}

type CreateRequest = { name: string }
type RenameRequest = { newName: string }
type DeleteRequest = { confirmName: string }

/** Replace the first H1 line in content with `# <newTitle>`. If no H1 exists, prepend one. */
function replaceFirstH1(content: string, newTitle: string): string {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined && line.startsWith('# ')) {
      lines[i] = `# ${newTitle}`
      return lines.join('\n')
    }
  }
  return `# ${newTitle}\n\n${content}`
}

function slugFromUrl(req: Request): string | null {
  const url = new URL(req.url)
  const pathParts = url.pathname.split('/')
  const raw = pathParts[3]
  if (!raw) return null
  return decodeURIComponent(raw)
}

export async function handleSimpleListCreate(
  req: Request,
  cfg: SimpleListConfig,
): Promise<Response> {
  try {
    const tooLarge = validateBodySize(req)
    if (tooLarge) return tooLarge

    const body = (await req.json()) as CreateRequest
    const { name } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      const resp: SimpleListResponse = {
        success: false,
        message: `${capitalize(cfg.label)} name is required`,
      }
      return Response.json(resp, { status: 400 })
    }

    const trimmedName = name.trim()
    const slug = sanitizeDeckFileName(trimmedName)

    if (!slug) {
      const resp: SimpleListResponse = {
        success: false,
        message: `${capitalize(cfg.label)} name must contain at least one valid character`,
      }
      return Response.json(resp, { status: 400 })
    }

    const dir = cfg.getDir()
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `${slug}.md`)

    if (!isPathWithinDir(filePath, dir)) {
      const resp: SimpleListResponse = {
        success: false,
        message: `Invalid ${cfg.label} name`,
      }
      return Response.json(resp, { status: 400 })
    }

    if (await Bun.file(filePath).exists()) {
      const resp: SimpleListResponse = {
        success: false,
        message: `A ${cfg.label} with slug '${slug}' already exists`,
      }
      return Response.json(resp, { status: 409 })
    }

    const content = `# ${trimmedName}\n\n`
    await writeFileWithHash(filePath, content)

    await autoCommitAndPush(
      dir,
      [filePath, hashPath(filePath)],
      `Create ${cfg.label}: ${trimmedName}`,
    )

    const resp: SimpleListResponse = {
      success: true,
      message: `Created ${cfg.label} '${trimmedName}'`,
      slug,
    }
    return Response.json(resp)
  } catch (error) {
    const resp: SimpleListResponse = { success: false, message: getErrorMessage(error) }
    return Response.json(resp, { status: 500 })
  }
}

export async function handleSimpleListRename(
  req: Request,
  cfg: SimpleListConfig,
): Promise<Response> {
  try {
    const slug = slugFromUrl(req)
    if (!slug) {
      const resp: SimpleListResponse = {
        success: false,
        message: `${capitalize(cfg.label)} slug is required`,
      }
      return Response.json(resp, { status: 400 })
    }

    const tooLarge = validateBodySize(req)
    if (tooLarge) return tooLarge

    const body = (await req.json()) as RenameRequest
    const { newName } = body

    if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
      const resp: SimpleListResponse = {
        success: false,
        message: `New ${cfg.label} name is required`,
      }
      return Response.json(resp, { status: 400 })
    }

    const trimmedName = newName.trim()
    const newSlug = sanitizeDeckFileName(trimmedName)

    if (!newSlug) {
      const resp: SimpleListResponse = {
        success: false,
        message: 'New name must contain at least one valid character',
      }
      return Response.json(resp, { status: 400 })
    }

    const dir = cfg.getDir()
    const filePath = path.join(dir, `${slug}.md`)

    if (!isPathWithinDir(filePath, dir)) {
      const resp: SimpleListResponse = {
        success: false,
        message: `Invalid ${cfg.label} slug`,
      }
      return Response.json(resp, { status: 400 })
    }

    if (!(await Bun.file(filePath).exists())) {
      const resp: SimpleListResponse = {
        success: false,
        message: `${capitalize(cfg.label)} '${slug}' not found`,
      }
      return Response.json(resp, { status: 404 })
    }

    const newFilePath = path.join(dir, `${newSlug}.md`)

    if (newFilePath !== filePath && (await Bun.file(newFilePath).exists())) {
      const resp: SimpleListResponse = {
        success: false,
        message: `A ${cfg.label} with slug '${newSlug}' already exists`,
      }
      return Response.json(resp, { status: 409 })
    }

    const existingContent = await fs.readFile(filePath, 'utf-8')
    const oldName = parseTitleFromContent(existingContent) ?? slug
    const updatedContent = replaceFirstH1(existingContent, trimmedName)

    const filesToCommit: string[] = []

    if (newFilePath !== filePath) {
      await writeFileWithHash(newFilePath, updatedContent)
      await fs.unlink(filePath)
      await fs.unlink(hashPath(filePath)).catch(() => undefined)
      filesToCommit.push(filePath, hashPath(filePath), newFilePath, hashPath(newFilePath))

      const oldChangelogPath = filePath.replace(/\.md$/, '.changes.md')
      const newChangelogPath = newFilePath.replace(/\.md$/, '.changes.md')
      if (await Bun.file(oldChangelogPath).exists()) {
        const changelogContent = await fs.readFile(oldChangelogPath, 'utf-8')
        await Bun.write(newChangelogPath, changelogContent)
        await fs.unlink(oldChangelogPath)
        filesToCommit.push(oldChangelogPath, newChangelogPath)
      }
    } else {
      await writeFileWithHash(filePath, updatedContent)
      filesToCommit.push(filePath, hashPath(filePath))
    }

    await autoCommitAndPush(dir, filesToCommit, `Rename ${cfg.label}: ${oldName} → ${trimmedName}`)

    const resp: SimpleListResponse = {
      success: true,
      message: `Renamed ${cfg.label} to '${trimmedName}'`,
      newSlug,
    }
    return Response.json(resp)
  } catch (error) {
    const resp: SimpleListResponse = { success: false, message: getErrorMessage(error) }
    return Response.json(resp, { status: 500 })
  }
}

export async function handleSimpleListDelete(
  req: Request,
  cfg: SimpleListConfig,
): Promise<Response> {
  try {
    const slug = slugFromUrl(req)
    if (!slug) {
      const resp: SimpleListResponse = {
        success: false,
        message: `${capitalize(cfg.label)} slug is required`,
      }
      return Response.json(resp, { status: 400 })
    }

    const tooLarge = validateBodySize(req)
    if (tooLarge) return tooLarge

    const body = (await req.json()) as DeleteRequest
    const { confirmName } = body

    if (!confirmName || typeof confirmName !== 'string') {
      const resp: SimpleListResponse = { success: false, message: 'confirmName is required' }
      return Response.json(resp, { status: 400 })
    }

    const dir = cfg.getDir()
    const filePath = path.join(dir, `${slug}.md`)

    if (!isPathWithinDir(filePath, dir)) {
      const resp: SimpleListResponse = {
        success: false,
        message: `Invalid ${cfg.label} slug`,
      }
      return Response.json(resp, { status: 400 })
    }

    if (!(await Bun.file(filePath).exists())) {
      const resp: SimpleListResponse = {
        success: false,
        message: `${capitalize(cfg.label)} '${slug}' not found`,
      }
      return Response.json(resp, { status: 404 })
    }

    const existingContent = await fs.readFile(filePath, 'utf-8')
    const displayName = parseTitleFromContent(existingContent) ?? slug

    if (confirmName !== displayName) {
      const resp: SimpleListResponse = {
        success: false,
        message: `Confirmation name does not match. Expected '${displayName}'.`,
      }
      return Response.json(resp, { status: 400 })
    }

    const filesToCommit: string[] = [filePath, hashPath(filePath)]
    const changelogPath = filePath.replace(/\.md$/, '.changes.md')
    if (await Bun.file(changelogPath).exists()) {
      filesToCommit.push(changelogPath)
    }

    await fs.unlink(filePath)
    await fs.unlink(hashPath(filePath)).catch(() => undefined)
    if (filesToCommit.includes(changelogPath)) {
      await fs.unlink(changelogPath)
    }

    await autoCommitAndPush(dir, filesToCommit, `Delete ${cfg.label}: ${displayName}`)

    const resp: SimpleListResponse = {
      success: true,
      message: `Deleted ${cfg.label} '${displayName}'`,
    }
    return Response.json(resp)
  } catch (error) {
    const resp: SimpleListResponse = { success: false, message: getErrorMessage(error) }
    return Response.json(resp, { status: 500 })
  }
}
