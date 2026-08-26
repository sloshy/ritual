import fs from 'node:fs/promises'
import path from 'node:path'
import { getErrorMessage, hasErrorCode } from '../util/errors'
import { isRecord } from '../util/json'

/**
 * Custom card art: a per-list `<name>.art.json` sidecar mapping a card's `&N` id
 * to the image that replaces its Scryfall art.
 *
 * The sidecar is list *metadata*, like `<name>.primer.md` — it carries no change
 * events and no changelog entries, and `detect-changes` does not track hand
 * edits to it.
 *
 * A reference is either a file inside the configured art directory (see
 * `getArtDir`) or an http(s) URL. Files are referenced by their art-dir-relative
 * path with forward slashes and may not escape that directory, so the same
 * relative path identifies the image in the workspace, in the built site
 * (`art/<relpath>`), and in the served art route.
 *
 * The parse messages here are plain English on purpose: like the other engine
 * parsers (`parseCollectionFile`, the `ritual-config` parsers) this module is
 * below the UI layer, and the surface that reports the failure owns its wording.
 */

/** Custom art stored as a file inside the configured art directory. */
export type CardArtFileRef = {
  /** Art-dir-relative path, forward slashes, never escaping the art directory. */
  file: string
}

/** Custom art referenced from the web, used verbatim. */
export type CardArtUrlRef = {
  /** An absolute http(s) URL. */
  url: string
}

/** One card's custom art: exactly one of a local file or a URL. */
export type CardArtRef = CardArtFileRef | CardArtUrlRef

/**
 * The file extensions a custom-art file may carry, lowercase and dotted.
 *
 * The art directory is user-owned and may hold anything, so a reference is only
 * accepted for a file the site can actually show as an image. The rule lives
 * here, at the parse boundary, rather than at the read route alone: otherwise
 * `set-card --art notes.txt` is written, deployed into the built site, and only
 * then 404'd by the route that serves these extensions and nothing else.
 *
 * SVG is deliberately absent: it can carry script, and the art route is
 * same-origin with the admin UI.
 *
 * URL references carry no such rule — a perfectly good image URL often ends in a
 * query string, or in no extension at all, and the browser rather than Ritual
 * decides what it can render.
 */
export const ART_IMAGE_EXTENSIONS = ['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'] as const

/** One of {@link ART_IMAGE_EXTENSIONS}. */
export type ArtImageExtension = (typeof ART_IMAGE_EXTENSIONS)[number]

/**
 * Whether a lowercase dotted extension is one custom art accepts. Narrowing, so
 * a table keyed by {@link ArtImageExtension} — the read route's content types —
 * stays exhaustive by construction.
 */
export function isArtImageExtension(extension: string): extension is ArtImageExtension {
  return (ART_IMAGE_EXTENSIONS as readonly string[]).includes(extension)
}

/** A list's custom art, keyed by the card line's `&N` id. */
export type CardArtMap = Map<number, CardArtRef>

/** The rejection branch of the single-reference parsers. */
export type CardArtRefError = { error: string }

/** True when a reference parser returned its error branch. */
export function isCardArtRefError(value: CardArtRef | CardArtRefError): value is CardArtRefError {
  return 'error' in value
}

/**
 * Sidecar entries whose card id is not in the list any more. The entries are
 * kept (removing them is the caller's decision), and the raw ids are reported
 * as-is — resolving them to card names would mean a lookup for data that no
 * longer exists.
 */
export type UnknownCardIdsWarning = {
  kind: 'unknown-card-ids'
  ids: number[]
}

export type CardArtWarning = UnknownCardIdsWarning

/** Everything a caller may tell the parser about the list the sidecar belongs to. */
export type CardArtParseOptions = {
  /**
   * The card ids the list currently has. Entries outside this set become an
   * {@link UnknownCardIdsWarning}. Omit to skip the check entirely.
   */
  knownCardIds?: ReadonlySet<number>
}

export type CardArtParseSuccess = {
  ok: true
  art: CardArtMap
  warnings: CardArtWarning[]
}

export type CardArtParseFailure = {
  ok: false
  message: string
}

export type CardArtParseResult = CardArtParseSuccess | CardArtParseFailure

/** The path of a list's `.art.json` custom-art sidecar. */
export function artSidecarPath(mdPath: string): string {
  return mdPath.replace(/\.md$/, '.art.json')
}

/** Where a file reference's image lives on disk, given the configured art directory. */
export function cardArtFilePath(artDir: string, ref: CardArtFileRef): string {
  return path.join(artDir, ref.file)
}

/**
 * Validate an art-dir-relative image path. Backslashes and absolute paths are
 * rejected rather than normalized: the same string is used as a file path, a
 * built-site URL path, and a served route path, so only one spelling can be
 * canonical. `.` segments collapse; a `..` that survives normalization would
 * escape the art directory and is an error. The extension must be one the art
 * route serves ({@link ART_IMAGE_EXTENSIONS}), so a reference that could only
 * ever 404 is refused where it is typed.
 */
function parseCardArtFile(value: unknown): CardArtFileRef | CardArtRefError {
  if (typeof value !== 'string') return { error: '"file" must be a string' }
  const trimmed = value.trim()
  if (trimmed === '') return { error: '"file" must not be empty' }
  if (trimmed.includes('\\')) {
    return { error: `"${trimmed}" must use forward slashes` }
  }
  if (trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) {
    return { error: `"${trimmed}" must be relative to the art directory, not absolute` }
  }
  const normalized = path.posix.normalize(trimmed)
  if (normalized === '..' || normalized.startsWith('../')) {
    return { error: `"${trimmed}" escapes the art directory` }
  }
  if (normalized === '.' || normalized.endsWith('/')) {
    return { error: `"${trimmed}" is a directory, not an image file` }
  }
  const extension = path.posix.extname(normalized).toLowerCase()
  if (!isArtImageExtension(extension)) {
    return {
      error: `"${trimmed}" is not an image file — custom art must be one of: ${ART_IMAGE_EXTENSIONS.join(', ')}`,
    }
  }
  return { file: normalized }
}

/** Validate an art URL: absolute http(s) only, kept verbatim. */
function parseCardArtUrl(value: unknown): CardArtUrlRef | CardArtRefError {
  if (typeof value !== 'string') return { error: '"url" must be a string' }
  const trimmed = value.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { error: `"${trimmed}" is not a valid URL` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: `"${trimmed}" must be an http(s) URL` }
  }
  return { url: trimmed }
}

/**
 * Parse one art reference in its object form — a sidecar value or an API body's
 * `art` field. Exactly one of `file` / `url` must be present, and no other key
 * may ride along (a misspelled key must not be silently dropped on the next
 * save).
 */
export function parseCardArtRef(value: unknown): CardArtRef | CardArtRefError {
  if (!isRecord(value)) {
    return { error: 'an art reference must be an object with a "file" or "url"' }
  }
  const obj = value
  const extra = Object.keys(obj).filter((key) => key !== 'file' && key !== 'url')
  if (extra.length > 0) {
    return { error: `an art reference has no such key: ${extra.join(', ')}` }
  }
  const hasFile = obj.file !== undefined
  const hasUrl = obj.url !== undefined
  if (hasFile && hasUrl) {
    return { error: 'an art reference must have either "file" or "url", not both' }
  }
  if (hasFile) return parseCardArtFile(obj.file)
  if (hasUrl) return parseCardArtUrl(obj.url)
  return { error: 'an art reference must have a "file" or a "url"' }
}

/**
 * Parse an art reference typed as one string — the CLI's `--art` value and the
 * web editors' single text field. Anything carrying a URL scheme is validated as
 * a URL (so a typo'd `htp://…` is reported as a bad URL rather than silently
 * becoming a file name); everything else is an art-dir-relative path.
 */
export function parseCardArtInput(raw: string): CardArtRef | CardArtRefError {
  const trimmed = raw.trim()
  if (trimmed === '') return { error: 'an art reference must not be empty' }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) return parseCardArtUrl(trimmed)
  return parseCardArtFile(trimmed)
}

/**
 * A sidecar key is the card line's `&N`: a positive integer in canonical form.
 * Exported so every reader of the sidecar's JSON shape — the parser here, the
 * editors' `cardArtRefsFrom` — narrows a key the same strict way, rather than
 * one of them accepting `Number('1e3')` or `' 4'` as an id.
 */
export function parseCardIdKey(key: string): number | null {
  if (!/^[1-9][0-9]*$/.test(key)) return null
  const id = Number.parseInt(key, 10)
  return Number.isSafeInteger(id) ? id : null
}

/**
 * Parse a `.art.json` sidecar. A malformed file fails as a whole rather than
 * dropping the entries it could read: the sidecar is machine-written, so a bad
 * entry means something is wrong that a silent partial load would hide (and the
 * next save would erase).
 */
export function parseCardArtSidecar(
  content: string,
  options: CardArtParseOptions = {},
): CardArtParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (error) {
    return { ok: false, message: `not valid JSON: ${getErrorMessage(error)}` }
  }
  if (!isRecord(raw)) {
    return { ok: false, message: 'the file must contain a JSON object keyed by card id' }
  }

  const art: CardArtMap = new Map()
  const unknownIds: number[] = []
  for (const [key, value] of Object.entries(raw)) {
    const cardId = parseCardIdKey(key)
    if (cardId === null) {
      return { ok: false, message: `"${key}" is not a card id — keys are the card line's &N` }
    }
    const ref = parseCardArtRef(value)
    if (isCardArtRefError(ref)) {
      return { ok: false, message: `card ${cardId}: ${ref.error}` }
    }
    if (options.knownCardIds !== undefined && !options.knownCardIds.has(cardId)) {
      unknownIds.push(cardId)
    }
    art.set(cardId, ref)
  }

  const warnings: CardArtWarning[] =
    unknownIds.length > 0 ? [{ kind: 'unknown-card-ids', ids: unknownIds }] : []
  return { ok: true, art, warnings }
}

/**
 * A list's custom art as a JSON object — the sidecar's own shape, and what an
 * API body carries (JSON has no map, and no numeric keys). Ascending numeric
 * key order, so a diff of either reflects the edit rather than insertion order.
 */
export type CardArtRecord = Record<string, CardArtRef>

/** {@link CardArtMap} in its JSON shape. Empty map → empty object. */
export function cardArtToRecord(art: CardArtMap): CardArtRecord {
  const ordered: CardArtRecord = {}
  for (const [cardId, ref] of [...art.entries()].sort((a, b) => a[0] - b[0])) {
    ordered[String(cardId)] = ref
  }
  return ordered
}

/** Serialize a list's custom art. */
export function serializeCardArtSidecar(art: CardArtMap): string {
  return JSON.stringify(cardArtToRecord(art), null, 2) + '\n'
}

/**
 * Read a list's custom art. An absent sidecar is the normal case and yields an
 * empty map; a sidecar that exists but cannot be read or parsed is reported to
 * the caller rather than silently treated as "no art" — that would make the
 * next save delete art the user still has on disk.
 */
export async function loadCardArt(
  listFilePath: string,
  options: CardArtParseOptions = {},
): Promise<CardArtParseResult> {
  const sidecarPath = artSidecarPath(listFilePath)
  let content: string
  try {
    content = await fs.readFile(sidecarPath, 'utf-8')
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return { ok: true, art: new Map(), warnings: [] }
    return { ok: false, message: `${sidecarPath}: ${getErrorMessage(error)}` }
  }
  const parsed = parseCardArtSidecar(content, options)
  if (!parsed.ok) return { ok: false, message: `${sidecarPath}: ${parsed.message}` }
  return parsed
}

/**
 * A per-run cache of lists' custom art, read at most once per file.
 *
 * Every path that carries art across a cross-list move needs the same thing: the
 * departing card's reference, looked up by the `&N` its *source* list filed it
 * under, read **before** anything is written (the source's own save re-files its
 * sidecar against the ids the removal freed, and by then the entry is gone).
 * Lists are keyed by file path rather than by name, because a list's display
 * name is not the same string on every surface — a slug in the CLI editor, the
 * `# Title` H1 in `loadAllLists` — and a name lookup that missed would silently
 * carry no art while the source dropped it, destroying the reference instead of
 * moving it.
 */
export type CardArtCache = {
  /** A list's whole art map. An unreadable sidecar reads as no art. */
  load: (listFilePath: string) => Promise<CardArtMap>
  /** One card's art in that list; `undefined` for an id-less card or no entry. */
  lookup: (listFilePath: string, cardId: number | undefined) => Promise<CardArtRef | undefined>
}

/**
 * A {@link CardArtCache} for one operation.
 *
 * An unreadable sidecar yields an empty map rather than aborting: every read
 * path (the load routes, the site bakers, `set-card --art`) already reports such
 * a file, and a move that carries no art is a smaller loss than a save that
 * cannot complete.
 */
export function createCardArtCache(): CardArtCache {
  const byFile = new Map<string, CardArtMap>()
  const load = async (listFilePath: string): Promise<CardArtMap> => {
    const cached = byFile.get(listFilePath)
    if (cached !== undefined) return cached
    const loaded = await loadCardArt(listFilePath)
    const art: CardArtMap = loaded.ok ? loaded.art : new Map()
    byFile.set(listFilePath, art)
    return art
  }
  return {
    load,
    lookup: async (listFilePath, cardId) =>
      cardId === undefined ? undefined : (await load(listFilePath)).get(cardId),
  }
}

/** What {@link saveCardArt} did with the sidecar, for callers tracking touched files. */
export type CardArtSaveAction = 'written' | 'removed' | 'absent'

export type CardArtSaveResult = {
  path: string
  action: CardArtSaveAction
}

/**
 * Write a list's custom art. An empty map removes the sidecar instead of
 * writing `{}`, so clearing the last card's art leaves the list as it was
 * before any art was set.
 */
export async function saveCardArt(
  listFilePath: string,
  art: CardArtMap,
): Promise<CardArtSaveResult> {
  const sidecarPath = artSidecarPath(listFilePath)
  if (art.size === 0) {
    try {
      await fs.unlink(sidecarPath)
      return { path: sidecarPath, action: 'removed' }
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return { path: sidecarPath, action: 'absent' }
      throw error
    }
  }
  await fs.writeFile(sidecarPath, serializeCardArtSidecar(art))
  return { path: sidecarPath, action: 'written' }
}

/**
 * How a list's `&N` ids changed, so the sidecar can follow them.
 *
 * The sidecar is keyed by card id, and ids are *reused*: removing a card line
 * releases its `&N` to the pool, which hands it to the next card added. An art
 * entry left behind therefore does not merely go stale — it reappears on a
 * different card. Every path that removes, moves, or renumbers a card line
 * reports what it did here.
 *
 * All ids are in the sidecar's own key space, i.e. the ids as they were *before*
 * the edit; `renumbered` maps each of those to the id its line now carries.
 */
export type CardArtReconcileInput = {
  /** Ids whose card line is gone; their art goes with it. */
  removed?: Iterable<number>
  /** Old id → new id, for lines a save had to renumber. */
  renumbered?: ReadonlyMap<number, number>
  /**
   * References to file under ids the list just allocated — the destination side
   * of a move, where the art follows the card onto its new line.
   */
  added?: ReadonlyMap<number, CardArtRef>
}

/** The pure result of {@link reconcileCardArtMap}: the new map, and whether it differs. */
export type CardArtReconcileMap = {
  art: CardArtMap
  changed: boolean
}

/** Whether two references name the same image. */
export function isSameCardArtRef(a: CardArtRef, b: CardArtRef): boolean {
  if ('file' in a) return 'file' in b && a.file === b.file
  return 'url' in b && a.url === b.url
}

/** Whether two art maps hold the same references under the same ids. */
function isSameCardArt(a: CardArtMap, b: CardArtMap): boolean {
  if (a.size !== b.size) return false
  for (const [cardId, ref] of a) {
    const other = b.get(cardId)
    if (other === undefined || !isSameCardArtRef(ref, other)) return false
  }
  return true
}

/**
 * Apply an id reconcile to an art map, in memory.
 *
 * Removals are applied before renumbering and renumbering before additions, so
 * an id that was freed and handed straight to another line ends up holding that
 * line's art rather than the departed card's. A renumbered entry is re-filed
 * after the entries that kept their ids, so it wins the key it was moved to —
 * the only way the id could already be taken is by an entry the same edit
 * removed or moved elsewhere.
 */
export function reconcileCardArtMap(
  art: CardArtMap,
  input: CardArtReconcileInput,
): CardArtReconcileMap {
  const removed = new Set(input.removed ?? [])
  const renumbered = input.renumbered
  const added = input.added
  if (removed.size === 0 && !(renumbered && renumbered.size > 0) && !(added && added.size > 0)) {
    return { art, changed: false }
  }

  const next: CardArtMap = new Map()
  const refiled: [number, CardArtRef][] = []
  for (const [cardId, ref] of art) {
    if (removed.has(cardId)) continue
    const renamedTo = renumbered?.get(cardId)
    if (renamedTo === undefined) next.set(cardId, ref)
    else refiled.push([renamedTo, ref])
  }
  for (const [cardId, ref] of refiled) next.set(cardId, ref)
  for (const [cardId, ref] of added ?? []) next.set(cardId, ref)

  return { art: next, changed: !isSameCardArt(art, next) }
}

/** What {@link reconcileCardArt} did: nothing, a write, or a refusal to touch the sidecar. */
export type CardArtReconcileResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; saved: CardArtSaveResult }
  | { ok: false; message: string }

/**
 * The refusal branch on its own — a sidecar left exactly as it was, with the
 * reason. Named so a channel carrying reconcile failures across a module
 * boundary is distinguishable from one carrying already-rendered prose: the
 * two are both "strings about art" and only one of them may be shown to a user
 * as-is.
 */
export type CardArtReconcileFailure = Extract<CardArtReconcileResult, { ok: false }>

/**
 * Re-file a list's custom art after its card ids changed, writing the sidecar
 * only when the reconcile actually altered it — a list with no art, or one whose
 * art no card in the edit touched, is never written and never shows up in a
 * caller's touched-file list.
 *
 * An unreadable or malformed sidecar is reported rather than thrown: this runs
 * *after* the card lines were written, and overwriting a sidecar Ritual cannot
 * read would destroy art the user still has. Every read path (the load routes,
 * the site bakers, `set-card --art`) already reports such a file, so the caller
 * is free to ignore the failure.
 */
export async function reconcileCardArt(
  listFilePath: string,
  input: CardArtReconcileInput,
): Promise<CardArtReconcileResult> {
  // Drained into a set up front: `removed` is an iterable, and reading it twice
  // (once to decide there is work, once to do it) would exhaust a generator.
  const removed = new Set(input.removed ?? [])
  const nothingToDo =
    removed.size === 0 &&
    (input.renumbered === undefined || input.renumbered.size === 0) &&
    (input.added === undefined || input.added.size === 0)
  // Short-circuited before the read: most saves change no ids at all, and the
  // sidecar is not worth a stat for them.
  if (nothingToDo) return { ok: true, changed: false }

  const loaded = await loadCardArt(listFilePath)
  if (!loaded.ok) return { ok: false, message: loaded.message }
  const reconciled = reconcileCardArtMap(loaded.art, { ...input, removed })
  if (!reconciled.changed) return { ok: true, changed: false }
  return { ok: true, changed: true, saved: await saveCardArt(listFilePath, reconciled.art) }
}

/**
 * The sidecar path a reconcile wrote, for a caller collecting touched files —
 * or undefined when nothing was written. `absent` is undefined too: committing a
 * path that does not exist would fail the `git add`.
 */
export function reconciledArtPath(result: CardArtReconcileResult): string | undefined {
  if (!result.ok || !result.changed) return undefined
  return result.saved.action === 'absent' ? undefined : result.saved.path
}
