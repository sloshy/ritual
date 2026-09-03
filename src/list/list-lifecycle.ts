/**
 * Pure list lifecycle engines — create, rename, and delete a deck, collection,
 * or wanted list file. Every surface that manages list files (the CLI commands
 * `new`/`rename`/`delete`, the admin handlers, and through them the MCP tools)
 * routes through here, so the file mechanics — slug sanitization, display-name
 * rewrites, and the `.sha256`/`.changes.md`/`.primer.md`/`.art.json` sidecar
 * set — cannot drift between surfaces.
 *
 * The engines never touch git: callers that auto-commit (the admin handlers)
 * receive the touched file paths and commit them themselves.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { hashPath, isRitualClean, writeFileWithHash } from '../changes/content-hash'
import { newDeckMarkdown } from './deck-file'
import { invalidDeckFormatMessage, parseDeckFormat } from './deck-format'
import { sanitizeListFileName, unusableFileNameMessage, listSlug } from './list-file-name'
import {
  LIST_SIDECAR_KINDS,
  listSidecarPath,
  moveListSidecars,
  renameListThroughTemp,
} from './list-sidecars'
import { listTypeLabel, type ListType } from './list-type'
import { isPathWithinDir } from '../util/path-validation'
import { dirForType, listLocations, normalizeListName } from './resolve-list'
import { isSameFile as statSameFile, type SameFileCheck } from '../util/same-file'
import { parseTitleFromContent } from './section-format'
import { frontMatterBodyStart, markFencedLines } from './markdown-fence'
import { capitalize } from '../util/strings'

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
  /** The path the list occupied before the rename (equal to `newFilePath` in place). */
  oldFilePath: string
  /** The display name the list had before the rename (for messages/commits). */
  oldName: string
  touchedFiles: string[]
}
export type RenameListResult = RenameListSuccess | ListLifecycleError

/** Seams a rename can be run with; production callers pass none. */
export type RenameListOptions = {
  /**
   * How "is the destination this very file?" is decided. Defaults to a
   * device+inode comparison; injectable so the case-insensitive-file-system
   * path can be exercised on a case-sensitive one.
   */
  isSameFile?: SameFileCheck
}

export type DeleteListSuccess = {
  /** Every file removed: the list plus whichever sidecars it had. */
  deletedFiles: string[]
}
export type DeleteListResult = DeleteListSuccess | ListLifecycleError

/**
 * The error kinds {@link isListLifecycleError} recognizes. `satisfies` makes the
 * compiler reject a new {@link ListLifecycleError} variant that is not listed —
 * without it, a new variant would be silently classified as a *success*.
 */
const LIFECYCLE_ERROR_KINDS = {
  'invalid-name': true,
  'invalid-format': true,
  'already-exists': true,
  'not-found': true,
} as const satisfies Record<ListLifecycleError['kind'], true>

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
  const kind: unknown = result.kind
  return typeof kind === 'string' && kind in LIFECYCLE_ERROR_KINDS
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
 * The display name of a list file: its first `# H1`, falling back to the file
 * slug. The same read for all three list types.
 */
export async function listDisplayName(_type: ListType, filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8')
  return parseTitleFromContent(content) ?? listSlug(filePath)
}

/**
 * The existing list of `type` that a new name would **resolve to**, if any —
 * checked with the resolver's own exact tier ({@link normalizeListName}), not a
 * byte comparison of slugs.
 *
 * A byte-exact slug check alone let `new deck "atraxa superfriends"` succeed
 * beside `Atraxa Superfriends.md`, after which every name-resolving command
 * reported the pair as ambiguous. Refusing at creation is what keeps a workspace
 * addressable; `exceptFilePath` exempts the list being renamed from colliding
 * with itself.
 */
export async function findCollidingList(
  type: ListType,
  name: string,
  exceptFilePath?: string,
  sameFile: SameFileCheck = statSameFile,
): Promise<CollidingList | null> {
  const normalized = normalizeListName(name)
  for (const location of await listLocations(type)) {
    // The exemption is by file identity, not by string: an admin caller's
    // `filePath` is built from the URL slug, whose casing need not match the
    // enumerated on-disk name. A string compare there refused a list's own
    // case-only rename as a collision with itself.
    if (exceptFilePath !== undefined) {
      if (path.resolve(location.filePath) === path.resolve(exceptFilePath)) continue
      if (await sameFile(location.filePath, exceptFilePath)) continue
    }
    if (normalizeListName(location.name) === normalized) return location
  }
  return null
}

/**
 * The refusal a new list `name` of this type would earn for colliding with an
 * existing list, or null when the name is free. Exported for surfaces that
 * decide on a name **before** the file is written (the interactive editor
 * creates lists in memory and saves later), so they refuse the same names the
 * engines do rather than hand-rolling a byte-exact path check.
 *
 * A name with no usable file-name characters is not this check's business — the
 * caller's invalid-name path owns that.
 */
export async function listNameCollision(
  type: ListType,
  name: string,
  exceptFilePath?: string,
  isSameFile: SameFileCheck = statSameFile,
): Promise<ListLifecycleError | null> {
  const slug = sanitizeListFileName(name.trim())
  if (slug === null) return null
  const existing = await findCollidingList(type, slug, exceptFilePath, isSameFile)
  return existing ? collisionError(type, slug, existing) : null
}

/** The existing list a proposed name would resolve to. */
export type CollidingList = { name: string; filePath: string }

/**
 * The refusal a {@link findCollidingList} hit becomes. Terminated with a period like
 * every other {@link ListLifecycleError} message, so no surface has to punctuate
 * it at the call site.
 */
function collisionError(
  type: ListType,
  slug: string,
  existing: Pick<CollidingList, 'name'>,
): ListLifecycleError {
  const label = listTypeLabel(type)
  const message =
    existing.name === slug
      ? `A ${label} named '${slug}' already exists.`
      : `A ${label} named '${existing.name}' already exists (it matches '${slug}' under list-name folding).`
  return { kind: 'already-exists', slug, message }
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
    return { kind: 'invalid-name', message: `Invalid ${listTypeLabel(type)} name.` }
  }

  await fs.mkdir(dir, { recursive: true })

  const collision = await listNameCollision(type, trimmedName)
  if (collision) return collision
  // A file the resolver never enumerates (e.g. a deck file it filters out) would
  // still be overwritten, so the byte-exact path check stays as a backstop.
  if (await Bun.file(filePath).exists()) {
    return collisionError(type, slug, { name: slug })
  }

  await writeFileWithHash(filePath, content)
  return { slug, filePath, touchedFiles: [filePath, hashPath(filePath)] }
}

/**
 * Rename a list: re-derive the slug from the new display name, rewrite the
 * first `# H1` inside the file, move the file and its changelog/primer sidecars,
 * and drop the old `.sha256` (a new one is written only when the old file was
 * Ritual-clean). When the new name sanitizes to the same slug, the file is
 * updated in place.
 *
 * A destination that is the source file under a different spelling — what a
 * case-only rename looks like on a case-insensitive file system — is not a
 * collision: the file and every sidecar move through a temporary name so the
 * capitalization actually changes on disk.
 */
export async function renameList(
  type: ListType,
  filePath: string,
  newName: string,
  options: RenameListOptions = {},
): Promise<RenameListResult> {
  const trimmedName = newName.trim()
  const newSlug = sanitizeListFileName(trimmedName)
  if (newSlug === null) {
    return { kind: 'invalid-name', message: unusableFileNameMessage(trimmedName) }
  }

  if (!(await Bun.file(filePath).exists())) {
    return {
      kind: 'not-found',
      message: `${capitalize(listTypeLabel(type))} '${listSlug(filePath)}' not found.`,
    }
  }

  const dir = path.dirname(filePath)
  const newFilePath = path.join(dir, `${newSlug}.md`)
  const sameFile = options.isSameFile ?? statSameFile

  // The destination path can name the source file itself (a case-only rename on
  // a case-insensitive file system). That is a rename of this list, not a
  // collision with another one, so it is exempt from every refusal below.
  const isSelfDestination =
    newFilePath === filePath || (await sameFile(filePath, newFilePath).catch(() => false))

  if (!isSelfDestination) {
    const collision = await listNameCollision(type, trimmedName, filePath, sameFile)
    if (collision) return collision
    if (await Bun.file(newFilePath).exists()) {
      return collisionError(type, newSlug, { name: newSlug })
    }
  }

  const existingContent = await fs.readFile(filePath, 'utf-8')
  const oldName = parseTitleFromContent(existingContent) ?? listSlug(filePath)
  const updatedContent = replaceFirstH1(existingContent, trimmedName)

  // A rename rewrites the display name only; card lines pass through untouched.
  // Refresh the .sha256 sidecar only when it matched the file before the rename
  // — stamping a file that holds unrecorded hand edits would make
  // detect-changes skip it and drop the edits' changelog entries.
  const wasRitualClean = await isRitualClean(filePath, existingContent)
  // A `.sha256` that never existed must not be reported as touched: a caller
  // that auto-commits runs `git add` per path, which fails on a path that is
  // neither present nor tracked.
  const hadHash = await Bun.file(hashPath(filePath)).exists()
  const touchedFiles: string[] = []
  if (isSelfDestination && newFilePath !== filePath) {
    // Same file, different spelling: rename it (and every sidecar) through a
    // temporary name, since a direct rename would be a no-op on the file system
    // that produced this case.
    const moves = await renameListThroughTemp(filePath, newFilePath)
    if (wasRitualClean) {
      await writeFileWithHash(newFilePath, updatedContent)
    } else {
      await fs.writeFile(newFilePath, updatedContent)
      // The stale hash rode along with the file. Drop it, exactly as the
      // cross-name branch does — one rename must not leave two different
      // on-disk outcomes.
      await fs.unlink(hashPath(newFilePath)).catch(() => undefined)
    }
    touchedFiles.push(filePath, newFilePath)
    if (hadHash) touchedFiles.push(hashPath(filePath))
    if (wasRitualClean) touchedFiles.push(hashPath(newFilePath))
    for (const move of moves) {
      // The `.sha256` is accounted for above, whether it was refreshed or dropped.
      if (move.kind === 'hash') continue
      touchedFiles.push(move.from, move.to)
    }
  } else if (newFilePath !== filePath) {
    // Write the new file, then remove the old file and its hash sidecar.
    if (wasRitualClean) {
      await writeFileWithHash(newFilePath, updatedContent)
      touchedFiles.push(hashPath(newFilePath))
    } else {
      await fs.writeFile(newFilePath, updatedContent)
    }
    await fs.unlink(filePath)
    await fs.unlink(hashPath(filePath)).catch(() => undefined)
    touchedFiles.push(filePath, newFilePath)
    if (hadHash) touchedFiles.push(hashPath(filePath))

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

  return { newSlug, newFilePath, oldFilePath: filePath, oldName, touchedFiles }
}

/**
 * Delete a list file and every sidecar it may have: the `.sha256` content hash,
 * the `.changes.md` changelog, the `.primer.md` primer, and the `.art.json`
 * custom art, and its categories sidecar with its own hash. Sidecar paths come
 * from `list-sidecars`/`content-hash`/`card-art`/`card-categories-sidecar`
 * uniformly, so none can be orphaned by a
 * hand-rolled path at one call site.
 */
export async function deleteList(type: ListType, filePath: string): Promise<DeleteListResult> {
  if (!(await Bun.file(filePath).exists())) {
    return {
      kind: 'not-found',
      message: `${capitalize(listTypeLabel(type))} '${listSlug(filePath)}' not found.`,
    }
  }

  // Every kind in the sidecar table, so a new one cannot be orphaned here.
  const candidates = [
    filePath,
    ...LIST_SIDECAR_KINDS.map((kind) => listSidecarPath[kind](filePath)),
  ]
  const deletedFiles: string[] = []
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      await fs.unlink(candidate)
      deletedFiles.push(candidate)
    }
  }
  return { deletedFiles }
}

/**
 * Replace the first H1 line in content with `# <newTitle>`. If no H1 exists,
 * insert one at the top of the body — after any YAML front matter, so a deck's
 * metadata block stays first. A `# ...` line inside a fenced code block is prose
 * and is left alone, matching {@link parseTitleFromContent}. Scanning line by
 * line also avoids a regex replacement string treating `$&`/`$$` in the new
 * name as a substitution pattern.
 */
function replaceFirstH1(content: string, newTitle: string): string {
  const lines = content.split('\n')
  const start = frontMatterBodyStart(lines)
  const fenced = markFencedLines(lines, start)
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    if (!fenced[i] && line !== undefined && line.startsWith('# ')) {
      lines[i] = `# ${newTitle}`
      return lines.join('\n')
    }
  }
  if (start === 0) return `# ${newTitle}\n\n${content}`
  lines.splice(start, 0, '', `# ${newTitle}`)
  return lines.join('\n')
}
