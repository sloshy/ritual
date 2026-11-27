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
import { hashPath, isRitualClean, writeFileWithHash, writeListFile } from '../changes/content-hash'
import { newDeckMarkdown } from './deck-file'
import { invalidDeckFormatMessage, parseDeckFormat } from './deck-format'
import { findFoldedListFile, listFileSlug, listSlug, sanitizeListFileName } from './list-file-name'
import {
  LIST_SIDECAR_KINDS,
  listSidecarPath,
  moveListSidecars,
  renameListThroughTemp,
  type SidecarMove,
} from './list-sidecars'
import type { ListType } from './list-type'
import { isPathWithinDir } from '../util/path-validation'
import { dirForType, listLocations, type ListLocation } from './resolve-list'
import { isSameFile as statSameFile, type SameFileCheck } from '../util/same-file'
import { listDisplayNameFromContent } from './list-display-name'
import { frontMatterBodyStart, markFencedLines } from './markdown-fence'
import { titleHeading } from './heading'
import { singleLineText } from '../util/single-line'
import { moveToTrash } from '../util/safekeeping'
import { errorParam, syncMessage, type SyncMessage } from '../sync/message'
import { hasErrorCode } from '../util/errno'

/**
 * Structured failure of a lifecycle operation. `message` is English plus its
 * catalog key: the admin API and MCP answer with the English, the CLI renders
 * the key in its own language.
 */
export type ListLifecycleError =
  | { kind: 'invalid-name'; message: SyncMessage }
  | { kind: 'invalid-format'; message: SyncMessage }
  | {
      kind: 'already-exists'
      slug: string
      /** The file of the list already going by that name. */
      existingFilePath: string
      message: SyncMessage
    }
  | { kind: 'not-found'; message: SyncMessage }
  | {
      kind: 'sidecar-in-the-way'
      /** The companion file already at the destination, with no list of its own there. */
      sidecarPath: string
      message: SyncMessage
    }

export type CreateListSuccess = { slug: string; filePath: string; touchedFiles: string[] }
export type CreateListResult = CreateListSuccess | ListLifecycleError

export type RenameListSuccess = {
  newSlug: string
  /**
   * The name actually written as the list's title: the requested name folded
   * to one line and trimmed — what every surface reports as the new `name`.
   */
  newName: string
  newFilePath: string
  /** The path the list occupied before the rename (equal to `newFilePath` in place). */
  oldFilePath: string
  /** The display name the list had before the rename (for messages/commits). */
  oldName: string
  touchedFiles: string[]
  /**
   * What the rename could not finish, though the list is renamed: the old file
   * left beside the new one (`domain.list.lifecycle.oldFileLeft`). Usually empty.
   */
  warnings: SyncMessage[]
}
export type RenameListResult = RenameListSuccess | ListLifecycleError

/**
 * A rename that failed part-way and could not put every file back: `cause` is
 * what failed, `leftovers` the files still at the new name (or the partial new
 * list file) that need moving back, or deleting, by hand.
 */
export class RenameRollbackError extends Error {
  readonly leftovers: readonly string[]

  constructor(cause: unknown, leftovers: readonly string[]) {
    super(
      syncMessage('domain.list.lifecycle.rollbackFailed', {
        reason: errorParam(cause),
        files: leftovers.map((file) => path.basename(file)).join(', '),
      }).message,
      { cause },
    )
    this.name = 'RenameRollbackError'
    this.leftovers = leftovers
  }
}

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
  /**
   * Absolute path of the trash folder now holding them; inside it each file
   * keeps its workspace-relative path.
   */
  trashDir: string
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
  'sidecar-in-the-way': true,
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
export type ListLifecycleErrorStatus = { status: number; message: SyncMessage }

/**
 * Map a lifecycle error to the status/message pair every admin handler
 * responds with: a slug collision is a 409, a missing list a 404, and any
 * validation failure a 400. Returns data rather than a `Response` so this
 * engine module stays HTTP-free — handlers wrap it in `Response.json`.
 */
export function listLifecycleErrorStatus(error: ListLifecycleError): ListLifecycleErrorStatus {
  const status =
    error.kind === 'already-exists' || error.kind === 'sidecar-in-the-way'
      ? 409
      : error.kind === 'not-found'
        ? 404
        : 400
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
): SyncMessage | null {
  if (confirmed !== displayName) {
    return syncMessage('domain.list.lifecycle.confirmMismatch', { name: displayName })
  }
  return null
}

/**
 * The message every surface uses when it refuses a name it cannot make a file
 * name out of ({@link sanitizeListFileName} left nothing), so the CLI, the
 * editors, the importers and the admin API say the same thing.
 */
export function unusableFileNameMessage(name: string): SyncMessage {
  return sanitizeListFileName(name) === null
    ? syncMessage('domain.list.name.unusable', { name })
    : syncMessage('domain.list.name.reservedEnding', { name })
}

/** The refusal for a list of `type` that is not on disk, named by its file slug. */
function notFoundError(type: ListType, filePath: string): ListLifecycleError {
  return {
    kind: 'not-found',
    message: syncMessage('domain.list.lifecycle.notFound', { type, name: listSlug(filePath) }),
  }
}

/**
 * The display name of a list file: its first `# H1`, falling back to the file
 * slug. The same read for all three list types.
 */
export async function listDisplayName(_type: ListType, filePath: string): Promise<string> {
  return listDisplayNameFromContent(await fs.readFile(filePath, 'utf-8'), filePath)
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
  const others: ListLocation[] = []
  for (const location of await listLocations(type)) {
    // The exemption is by file identity, not by string: an admin caller's
    // `filePath` is built from the URL slug, whose casing need not match the
    // enumerated on-disk name. A string compare there refused a list's own
    // case-only rename as a collision with itself.
    if (exceptFilePath !== undefined) {
      if (path.resolve(location.filePath) === path.resolve(exceptFilePath)) continue
      if (await sameFile(location.filePath, exceptFilePath)) continue
    }
    others.push(location)
  }
  const file = findFoldedListFile(
    others.map((location) => path.basename(location.filePath)),
    name,
  )
  return others.find((location) => path.basename(location.filePath) === file) ?? null
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
function collisionError(type: ListType, slug: string, existing: CollidingList): ListLifecycleError {
  const message =
    existing.name === slug
      ? syncMessage('domain.list.lifecycle.exists', { type, name: slug })
      : syncMessage('domain.list.lifecycle.existsFolded', {
          type,
          name: existing.name,
          query: slug,
        })
  return { kind: 'already-exists', slug, existingFilePath: existing.filePath, message }
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
  const trimmedName = singleLineText(name).trim()

  let content: string
  if (type === 'deck') {
    const rawFormat = format ?? 'commander'
    const parsedFormat = parseDeckFormat(rawFormat)
    if (!parsedFormat) {
      return { kind: 'invalid-format', message: invalidDeckFormatMessage(rawFormat) }
    }
    content = newDeckMarkdown(trimmedName, parsedFormat)
  } else {
    content = `${titleHeading(trimmedName)}\n\n`
  }

  const slug = listFileSlug(trimmedName)
  if (slug === null) {
    return { kind: 'invalid-name', message: unusableFileNameMessage(trimmedName) }
  }

  const dir = dirForType(type)
  const filePath = path.join(dir, `${slug}.md`)
  if (!isPathWithinDir(filePath, dir)) {
    return {
      kind: 'invalid-name',
      message: syncMessage('domain.list.lifecycle.invalidName', { type }),
    }
  }

  await fs.mkdir(dir, { recursive: true })

  const collision = await listNameCollision(type, trimmedName)
  if (collision) return collision
  // A file the resolver never enumerates (e.g. a deck file it filters out) would
  // still be overwritten, so the byte-exact path check stays as a backstop.
  if (await Bun.file(filePath).exists()) {
    return collisionError(type, slug, { name: slug, filePath })
  }

  await writeFileWithHash(filePath, content)
  return { slug, filePath, touchedFiles: [filePath, hashPath(filePath)] }
}

/** Where a rename would put a list, as {@link planListRename} settles it. */
export type ListRenamePlan = {
  newSlug: string
  /** The requested name folded to one line and trimmed: the title the rename writes. */
  newName: string
  newFilePath: string
  /**
   * True when the destination is the list's own file — the same path, or the
   * same file under another spelling (a case-only rename on a case-insensitive
   * file system).
   */
  isSelfDestination: boolean
}

/**
 * Every check {@link renameList} makes before it touches a file, without
 * touching one: the name must make a file name, the list must exist, and no
 * other list of the type may already go by the name (folded as names are
 * matched) or hold the destination path. `ritual cleanup` previews its renames
 * through this, so a dry run refuses exactly what the real run would.
 */
export async function planListRename(
  type: ListType,
  filePath: string,
  newName: string,
  options: RenameListOptions = {},
): Promise<ListRenamePlan | ListLifecycleError> {
  const trimmedName = singleLineText(newName).trim()
  const newSlug = listFileSlug(trimmedName)
  if (newSlug === null) {
    return { kind: 'invalid-name', message: unusableFileNameMessage(trimmedName) }
  }

  if (!(await Bun.file(filePath).exists())) return notFoundError(type, filePath)

  const newFilePath = path.join(path.dirname(filePath), `${newSlug}.md`)
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
      return collisionError(type, newSlug, { name: newSlug, filePath: newFilePath })
    }
    // A companion file left at the destination with no list beside it (an
    // orphaned `Burn.changes.md`) would be overwritten by this list's own, or
    // inherited by it — either way another list's history or art lost.
    for (const kind of LIST_SIDECAR_KINDS) {
      const sidecarPath = listSidecarPath[kind](newFilePath)
      if (await Bun.file(sidecarPath).exists()) {
        return {
          kind: 'sidecar-in-the-way',
          sidecarPath,
          message: syncMessage('domain.list.lifecycle.sidecarInTheWay', {
            file: path.basename(sidecarPath),
            name: trimmedName,
          }),
        }
      }
    }
  }
  return { newSlug, newName: trimmedName, newFilePath, isSelfDestination }
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
  const plan = await planListRename(type, filePath, newName, options)
  if (isListLifecycleError(plan)) return plan
  const { newSlug, newName: trimmedName, newFilePath, isSelfDestination } = plan

  const existingContent = await fs.readFile(filePath, 'utf-8')
  const oldName = listDisplayNameFromContent(existingContent, filePath)
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
  const warnings: SyncMessage[] = []
  if (isSelfDestination && newFilePath !== filePath) {
    // Same file, different spelling: rename it (and every sidecar) through a
    // temporary name, since a direct rename would be a no-op on the file system
    // that produced this case.
    const moves = await renameListThroughTemp(filePath, newFilePath)
    await writeListFile(newFilePath, updatedContent, wasRitualClean)
    if (!wasRitualClean) {
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
    // Companions first, then the new list file, then the old one goes — the
    // commit-point order `moveListFileAndSidecars` keeps: an interruption leaves
    // the list readable where it was with some companions parked at the new
    // name, never a list at the new name whose changelog stayed behind.
    const sidecarMoves: SidecarMove[] = []
    try {
      await moveListSidecars(filePath, newFilePath, sidecarMoves)
      await writeListFile(newFilePath, updatedContent, wasRitualClean)
    } catch (error) {
      // Nothing at the destination was there before (the plan refused that),
      // so anything there now is this rename's: undo it and leave the list
      // whole where it was. What cannot be undone is named, never swallowed.
      const leftovers: string[] = []
      const undo = async (step: () => Promise<void>, leftover: string): Promise<void> => {
        try {
          await step()
        } catch (undoError) {
          if (!hasErrorCode(undoError, 'ENOENT')) leftovers.push(leftover)
        }
      }
      await undo(() => fs.unlink(newFilePath), newFilePath)
      await undo(() => fs.unlink(hashPath(newFilePath)), hashPath(newFilePath))
      for (const move of [...sidecarMoves].reverse()) {
        await undo(() => fs.rename(move.to, move.from), move.to)
      }
      throw leftovers.length === 0 ? error : new RenameRollbackError(error, leftovers)
    }
    if (wasRitualClean) touchedFiles.push(hashPath(newFilePath))
    try {
      await fs.unlink(filePath)
    } catch (error) {
      // The renamed list is whole at its new name; the old file could not be
      // removed, so two files now hold the list. Said, not retried.
      warnings.push(
        syncMessage('domain.list.lifecycle.oldFileLeft', {
          file: path.basename(filePath),
          reason: errorParam(error),
        }),
      )
    }
    await fs.unlink(hashPath(filePath)).catch(() => undefined)
    touchedFiles.push(filePath, newFilePath)
    if (hadHash) touchedFiles.push(hashPath(filePath))
    for (const { from, to } of sidecarMoves) touchedFiles.push(from, to)
  } else {
    // Same slug — just update the display name in the file.
    await writeListFile(filePath, updatedContent, wasRitualClean)
    touchedFiles.push(filePath)
    if (wasRitualClean) touchedFiles.push(hashPath(filePath))
  }

  return {
    newSlug,
    newName: trimmedName,
    newFilePath,
    oldFilePath: filePath,
    oldName,
    touchedFiles,
    warnings,
  }
}

/**
 * Delete a list file and every sidecar it may have: the `.sha256` content hash,
 * the `.changes.md` changelog, the `.primer.md` primer, and the `.art.json`
 * custom art, and its categories sidecar with its own hash. Sidecar paths come
 * from `list-sidecars`/`content-hash`/`card-art`/`card-categories-sidecar`
 * uniformly, so none can be orphaned by a
 * hand-rolled path at one call site.
 *
 * The files are moved into a trash folder (`safekeeping`), not unlinked, so a
 * delete can be undone by moving them back.
 */
export async function deleteList(type: ListType, filePath: string): Promise<DeleteListResult> {
  if (!(await Bun.file(filePath).exists())) return notFoundError(type, filePath)

  // Every kind in the sidecar table, so a new one cannot be orphaned here.
  const candidates = [
    filePath,
    ...LIST_SIDECAR_KINDS.map((kind) => listSidecarPath[kind](filePath)),
  ]
  const deletedFiles: string[] = []
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) deletedFiles.push(candidate)
  }
  // The list file moves last: it is what makes the list exist, so a failure
  // part-way (rolled back by moveToTrash) can never leave sidecars behind for a
  // future list of the same name to inherit.
  const trashDir = await moveToTrash(
    [...deletedFiles.filter((file) => file !== filePath), filePath],
    `${type}-${listSlug(filePath)}`,
  )
  return { deletedFiles, trashDir }
}

/**
 * Replace the first H1 line in content with `# <newTitle>`. If no H1 exists,
 * insert one at the top of the body — after any YAML front matter, so a deck's
 * metadata block stays first. A `# ...` line inside a fenced code block is prose
 * and is left alone, matching `parseTitleFromContent`. Scanning line by
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
      lines[i] = titleHeading(newTitle)
      return lines.join('\n')
    }
  }
  if (start === 0) return `${titleHeading(newTitle)}\n\n${content}`
  lines.splice(start, 0, '', titleHeading(newTitle))
  return lines.join('\n')
}
