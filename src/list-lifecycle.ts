/**
 * Pure list lifecycle engines — create, rename, and delete a deck, collection,
 * or wanted list file. Every surface that manages list files (the CLI commands
 * `new`/`rename`/`delete`, the admin handlers, and through them the MCP tools)
 * routes through here, so the file mechanics — slug sanitization, display-name
 * rewrites, and the `.sha256`/`.changes.md`/`.primer.md` sidecar set — cannot
 * drift between surfaces.
 *
 * The engines never touch git: callers that auto-commit (the admin handlers)
 * receive the touched file paths and commit them themselves.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { hashPath, isRitualClean, writeFileWithHash } from './content-hash'
import { newDeckMarkdown, parseDeckFrontMatter } from './deck-file'
import { invalidDeckFormatMessage, parseDeckFormat } from './deck-format'
import { sanitizeListFileName, unusableFileNameMessage } from './list-file-name'
import { listSlug } from './list-info'
import { changelogSidecarPath, moveListSidecars, primerSidecarPath } from './list-sidecars'
import { listTypeLabel, type ListType } from './list-type'
import { isPathWithinDir } from './path-validation'
import { dirForType } from './resolve-list'
import { parseTitleFromContent } from './section-format'
import { capitalize } from './utils'

/** Structured failure of a lifecycle operation. */
export type ListLifecycleError =
  | { kind: 'invalid-name'; message: string }
  | { kind: 'invalid-format'; message: string }
  | { kind: 'already-exists'; slug: string; message: string }
  | { kind: 'not-found'; message: string }

export type CreateListSuccess = { slug: string; filePath: string; touchedFiles: string[] }
export type CreateListResult = CreateListSuccess | ListLifecycleError

export type RenameListSuccess = {
  newSlug: string
  newFilePath: string
  /** The display name the list had before the rename (for messages/commits). */
  oldName: string
  touchedFiles: string[]
}
export type RenameListResult = RenameListSuccess | ListLifecycleError

export type DeleteListSuccess = { touchedFiles: string[] }
export type DeleteListResult = DeleteListSuccess | ListLifecycleError

const LIFECYCLE_ERROR_KINDS: ReadonlySet<string> = new Set<ListLifecycleError['kind']>([
  'invalid-name',
  'invalid-format',
  'already-exists',
  'not-found',
])

/**
 * Type guard: a lifecycle result that is an error rather than a success. Checks
 * the `kind` value against the {@link ListLifecycleError} variants — mere key
 * presence would misclassify other kind-tagged unions (ResolveListError,
 * ConfigGetOutcome) if one ever flowed through here.
 */
export function isListLifecycleError<T>(
  result: T | ListLifecycleError,
): result is ListLifecycleError {
  if (typeof result !== 'object' || result === null || !('kind' in result)) return false
  const kind: unknown = (result as Record<'kind', unknown>).kind
  return typeof kind === 'string' && LIFECYCLE_ERROR_KINDS.has(kind)
}

/** The HTTP mapping of a {@link ListLifecycleError}: a status code plus the message. */
export type ListLifecycleErrorStatus = { status: number; message: string }

/**
 * Map a lifecycle error to the status/message pair every admin handler
 * responds with: a slug collision is a 409, a missing list a 404, and any
 * validation failure a 400. Returns data rather than a `Response` so this
 * engine module stays HTTP-free — handlers wrap it in `Response.json`.
 */
export function listLifecycleErrorStatus(error: ListLifecycleError): ListLifecycleErrorStatus {
  const status = error.kind === 'already-exists' ? 409 : error.kind === 'not-found' ? 404 : 400
  return { status, message: error.message }
}

/**
 * The delete-confirmation gate shared by every destructive list surface: the
 * caller-supplied confirmation must equal the list's display name exactly.
 * Returns the standard mismatch message, or null when the deletion is
 * confirmed — the caller wraps the message in its own error shape.
 */
export function requireDeleteConfirmation(
  confirmed: string | undefined,
  displayName: string,
): string | null {
  if (confirmed !== displayName) {
    return `Confirmation name does not match. Expected '${displayName}'.`
  }
  return null
}

/**
 * The display name of a list file: a deck's front-matter `name`, a flat list's
 * first `# H1`, falling back to the file slug in either case.
 */
export async function listDisplayName(type: ListType, filePath: string): Promise<string> {
  if (type === 'deck') {
    const frontMatter = await parseDeckFrontMatter(filePath)
    return typeof frontMatter.name === 'string' ? frontMatter.name : listSlug(filePath)
  }
  const content = await fs.readFile(filePath, 'utf-8')
  return parseTitleFromContent(content) ?? listSlug(filePath)
}

/**
 * Create a new list file. Decks start from {@link newDeckMarkdown} with a
 * validated format (default `commander`); collections and wanted lists start as
 * a bare `# Name` heading. The file is named through
 * {@link sanitizeListFileName}, so every surface lands the same name at the
 * same path.
 */
export async function createList(
  type: ListType,
  name: string,
  format?: string,
): Promise<CreateListResult> {
  const trimmedName = name.trim()

  let content: string
  if (type === 'deck') {
    const rawFormat = format ?? 'commander'
    const parsedFormat = parseDeckFormat(rawFormat)
    if (!parsedFormat) {
      return { kind: 'invalid-format', message: invalidDeckFormatMessage(rawFormat) }
    }
    content = newDeckMarkdown(trimmedName, parsedFormat)
  } else {
    content = `# ${trimmedName}\n\n`
  }

  const slug = sanitizeListFileName(trimmedName)
  if (slug === null) {
    return { kind: 'invalid-name', message: unusableFileNameMessage(trimmedName) }
  }

  const dir = dirForType(type)
  const filePath = path.join(dir, `${slug}.md`)
  if (!isPathWithinDir(filePath, dir)) {
    return { kind: 'invalid-name', message: `Invalid ${listTypeLabel(type)} name` }
  }

  await fs.mkdir(dir, { recursive: true })

  if (await Bun.file(filePath).exists()) {
    return {
      kind: 'already-exists',
      slug,
      message: `A ${listTypeLabel(type)} with slug '${slug}' already exists`,
    }
  }

  await writeFileWithHash(filePath, content)
  return { slug, filePath, touchedFiles: [filePath, hashPath(filePath)] }
}

/**
 * Rename a list: re-derive the slug from the new display name, rewrite the
 * display name inside the file (front-matter `name` + legacy H1 for decks, the
 * first H1 for flat lists), move the file and its changelog/primer sidecars,
 * and drop the old `.sha256` (a new one is written only when the old file was
 * Ritual-clean). When the new name sanitizes to the same slug, the file is
 * updated in place.
 */
export async function renameList(
  type: ListType,
  filePath: string,
  newName: string,
): Promise<RenameListResult> {
  const trimmedName = newName.trim()
  const newSlug = sanitizeListFileName(trimmedName)
  if (newSlug === null) {
    return { kind: 'invalid-name', message: unusableFileNameMessage(trimmedName) }
  }

  if (!(await Bun.file(filePath).exists())) {
    return {
      kind: 'not-found',
      message: `${capitalize(listTypeLabel(type))} '${listSlug(filePath)}' not found`,
    }
  }

  const dir = path.dirname(filePath)
  const newFilePath = path.join(dir, `${newSlug}.md`)

  if (newFilePath !== filePath && (await Bun.file(newFilePath).exists())) {
    return {
      kind: 'already-exists',
      slug: newSlug,
      message: `A ${listTypeLabel(type)} with slug '${newSlug}' already exists`,
    }
  }

  const existingContent = await fs.readFile(filePath, 'utf-8')
  let oldName: string
  let updatedContent: string
  if (type === 'deck') {
    const frontMatter = await parseDeckFrontMatter(filePath)
    oldName = typeof frontMatter.name === 'string' ? frontMatter.name : listSlug(filePath)
    updatedContent = renameDeckContent(existingContent, oldName, trimmedName)
  } else {
    oldName = parseTitleFromContent(existingContent) ?? listSlug(filePath)
    updatedContent = replaceFirstH1(existingContent, trimmedName)
  }

  // A rename rewrites the display name only; card lines pass through untouched.
  // Refresh the .sha256 sidecar only when it matched the file before the rename
  // — stamping a file that holds unrecorded hand edits would make
  // detect-changes skip it and drop the edits' changelog entries.
  const wasRitualClean = await isRitualClean(filePath, existingContent)
  const touchedFiles: string[] = []
  if (newFilePath !== filePath) {
    // Write the new file, then remove the old file and its hash sidecar.
    if (wasRitualClean) {
      await writeFileWithHash(newFilePath, updatedContent)
      touchedFiles.push(hashPath(newFilePath))
    } else {
      await fs.writeFile(newFilePath, updatedContent)
    }
    await fs.unlink(filePath)
    await fs.unlink(hashPath(filePath)).catch(() => undefined)
    touchedFiles.push(filePath, hashPath(filePath), newFilePath)

    for (const { from, to } of await moveListSidecars(filePath, newFilePath)) {
      touchedFiles.push(from, to)
    }
  } else {
    // Same slug — just update the display name in the file.
    if (wasRitualClean) {
      await writeFileWithHash(filePath, updatedContent)
      touchedFiles.push(filePath, hashPath(filePath))
    } else {
      await fs.writeFile(filePath, updatedContent)
      touchedFiles.push(filePath)
    }
  }

  return { newSlug, newFilePath, oldName, touchedFiles }
}

/**
 * Delete a list file and every sidecar it may have: the `.sha256` content hash,
 * the `.changes.md` changelog, and the `.primer.md` primer. Sidecar paths come
 * from `list-sidecars`/`content-hash` uniformly, so none can be orphaned by a
 * hand-rolled path at one call site.
 */
export async function deleteList(type: ListType, filePath: string): Promise<DeleteListResult> {
  if (!(await Bun.file(filePath).exists())) {
    return {
      kind: 'not-found',
      message: `${capitalize(listTypeLabel(type))} '${listSlug(filePath)}' not found`,
    }
  }

  const candidates = [
    filePath,
    hashPath(filePath),
    changelogSidecarPath(filePath),
    primerSidecarPath(filePath),
  ]
  const touchedFiles: string[] = []
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      await fs.unlink(candidate)
      touchedFiles.push(candidate)
    }
  }
  return { touchedFiles }
}

/**
 * Rewrite a deck's display name: the front-matter `name:` field, plus a legacy
 * `# Old Name` H1 in the body when one matches the old name exactly. The front
 * matter goes through gray-matter (the same serializer every deck save uses) —
 * a hand-rolled regex would corrupt the YAML on names containing quotes.
 */
function renameDeckContent(content: string, oldName: string, newName: string): string {
  const parsed = matter(content)
  // Copy before mutating: gray-matter caches parses by content string, so the
  // parsed front-matter object is shared between byte-identical files.
  const frontMatter = { ...parsed.data, name: newName }
  const updated = matter.stringify(parsed.content, frontMatter)
  // Function replacer: a plain replacement string would treat `$&`/`$$` in the
  // new name as substitution patterns.
  return updated.replace(new RegExp(`^# ${escapeRegex(oldName)}$`, 'm'), () => `# ${newName}`)
}

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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
