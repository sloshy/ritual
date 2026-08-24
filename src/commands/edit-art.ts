import fs from 'node:fs/promises'
import path from 'node:path'
import {
  isArtImageExtension,
  isCardArtRefError,
  isSameCardArtRef,
  parseCardArtRef,
  ART_IMAGE_EXTENSIONS,
  type CardArtRef,
  type CardArtRefError,
} from '../card-art'
import { getErrorMessage, hasErrorCode } from '../errors'
import { compareData } from '../i18n/collate'
import { t } from '../i18n/t'
import { getArtDir } from '../ritual-config'
import { ask, suggestByTitleTerms } from './prompts-helpers'
import { currentSessionArt, noteArtSet, type SessionArtChanges } from './session-art'
import type { EditUndoEntry } from './edit-undo'

/**
 * The edit-mode **Set Custom Art** action, shared by the deck and flat-list
 * sessions: pick an image URL, browse the configured art directory for a local
 * file, or clear the card's art.
 *
 * Like every other session edit the result is deferred — it is staged in the
 * session's art accumulator (`session-art.ts`) and written by the same save
 * that writes the card lines, so exiting without saving leaves the sidecar
 * alone. The card *line* is untouched, which is why the operation records no
 * change event and no changelog entry: custom art is list metadata.
 */

/** How the file browser reports one directory entry, independent of `node:fs`. */
export type ArtDirEntry = {
  name: string
  isDirectory: boolean
}

/** What selecting a browser row does. */
export type ArtBrowseTarget =
  /** Step out of the directory being listed, to `path` ('' is the art directory itself). */
  | { kind: 'up'; path: string }
  /** Descend into `path` (art-dir-relative, forward slashes). */
  | { kind: 'dir'; path: string }
  /** Choose the image at `path` (art-dir-relative, forward slashes). */
  | { kind: 'file'; path: string }

/** One row of the file browser. */
export type ArtBrowseRow = {
  title: string
  value: ArtBrowseTarget
}

/** The art-dir-relative path of `name` inside `dir` ('' being the art directory itself). */
function joinArtPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`
}

/** The directory containing `dir`, as an art-dir-relative path ('' at the top). */
function parentArtPath(dir: string): string {
  const parent = path.posix.dirname(dir)
  return parent === '.' || parent === '/' ? '' : parent
}

/**
 * The browser rows for one directory of the art tree: a step back out (except
 * at the top), then subdirectories, then the image files.
 *
 * Directories lead because they are the only rows that go anywhere, and each
 * group is ordered with {@link compareData} — these are paths, not display
 * names. Files the art route would never serve are hidden rather than shown and
 * refused: the reference is validated by the same extension rule
 * ({@link ART_IMAGE_EXTENSIONS}), so an offered row that could only be rejected
 * is a row worth not offering. Dot-entries are hidden too — an art directory
 * under version control is full of them, and none of them is a picture.
 */
export function artBrowseRows(entries: readonly ArtDirEntry[], dir: string): ArtBrowseRow[] {
  const visible = entries.filter((entry) => !entry.name.startsWith('.'))
  const byName = (a: ArtDirEntry, b: ArtDirEntry): number => compareData(a.name, b.name)
  const directories = visible.filter((entry) => entry.isDirectory).sort(byName)
  const files = visible
    .filter(
      (entry) =>
        !entry.isDirectory && isArtImageExtension(path.posix.extname(entry.name).toLowerCase()),
    )
    .sort(byName)

  const rows: ArtBrowseRow[] = []
  if (dir !== '') {
    rows.push({
      title: `⬆️  ${t('cli.art.rowUp')}`,
      value: { kind: 'up', path: parentArtPath(dir) },
    })
  }
  for (const entry of directories) {
    rows.push({
      title: `📁 ${entry.name}/`,
      value: { kind: 'dir', path: joinArtPath(dir, entry.name) },
    })
  }
  for (const entry of files) {
    rows.push({
      title: `🖼️  ${entry.name}`,
      value: { kind: 'file', path: joinArtPath(dir, entry.name) },
    })
  }
  return rows
}

/** How a reference reads in a prompt or a confirmation: the path or the URL itself. */
export function cardArtDisplay(ref: CardArtRef): string {
  return 'file' in ref ? ref.file : ref.url
}

/** Whether two art states (a reference, or none) are the same. */
function isSameArtState(a: CardArtRef | null, b: CardArtRef | null): boolean {
  if (a === null || b === null) return a === b
  return isSameCardArtRef(a, b)
}

/** The browser's own rows plus its way out. */
type ArtBrowseChoice = ArtBrowseTarget | { kind: 'cancel' }

/** How many browser rows are visible at once, matching the session prompt's window. */
const ART_BROWSE_LIMIT = 15

/**
 * Browse the configured art directory for an image, one directory at a time:
 * directory rows descend, `..` goes back out, and an image row picks the file.
 * Typing filters the visible rows (the same term match the other icon-titled
 * pickers use). Returns the art-dir-relative path, or null when the user backs
 * out or there is nothing to pick.
 */
export async function browseArtFile(): Promise<string | null> {
  const artDir = getArtDir()
  let dir = ''
  while (true) {
    const absolute = dir === '' ? artDir : path.join(artDir, dir)
    let entries: ArtDirEntry[]
    try {
      const dirents = await fs.readdir(absolute, { withFileTypes: true })
      entries = dirents.map((dirent) => ({
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
      }))
    } catch (error) {
      // A missing directory reads differently depending on which one it is: at
      // the top there is no art directory to browse yet, and the way forward is
      // to make one (or point `artDir` elsewhere). Deeper in, the tree the user
      // is walking lost a directory that was listed a moment ago, so the message
      // names *that* path rather than the root the browse started from.
      console.error(
        !hasErrorCode(error, 'ENOENT')
          ? t('cli.art.dirUnreadable', { dir: absolute, reason: getErrorMessage(error) })
          : dir === ''
            ? t('cli.art.dirMissing', { dir: artDir })
            : t('cli.art.dirGone', { dir: absolute }),
      )
      return null
    }

    const rows = artBrowseRows(entries, dir)
    if (!rows.some((row) => row.value.kind !== 'up')) {
      // Nothing to pick here. At the top that ends the flow; deeper in, the
      // prompt still opens so the `..` row can take the user back out.
      console.log(
        t('cli.art.dirEmpty', { dir: absolute, extensions: ART_IMAGE_EXTENSIONS.join(', ') }),
      )
      if (dir === '') return null
    }

    const choice = await ask<ArtBrowseChoice>({
      type: 'autocomplete',
      message: t('cli.art.promptPickFile', { dir: absolute }),
      subjectKey: 'cli.prompt.subject.artFile',
      choices: [...rows, { title: `← ${t('cli.menu.cancel')}`, value: { kind: 'cancel' } }],
      limit: ART_BROWSE_LIMIT,
      suggest: suggestByTitleTerms,
    })
    if (choice === undefined || choice.kind === 'cancel') return null
    if (choice.kind === 'file') return choice.path
    dir = choice.path
  }
}

/** What the Set Custom Art prompt resolved to: a reference, or `null` to clear. */
export type CardArtEdit = { ref: CardArtRef | null }

/** What the Set Custom Art menu's rows resolve to. */
type ArtAction = 'url' | 'file' | 'clear' | 'cancel'

/** One row of the Set Custom Art menu. */
export type ArtActionRow = {
  title: string
  value: ArtAction
}

/**
 * The Set Custom Art menu's rows for a card wearing `current`.
 *
 * Clearing is offered only when there is art to clear — an empty reference is
 * not a thing the sidecar can hold, and a row that could only report "nothing
 * changed" is a row worth not offering. Split out from the prompt so the gating
 * is a plain function rather than something only a live terminal can show.
 */
export function cardArtActionRows(current: CardArtRef | null): ArtActionRow[] {
  const rows: ArtActionRow[] = [
    { title: `🔗 ${t('cli.art.actionUrl')}`, value: 'url' },
    { title: `📁 ${t('cli.art.actionFile')}`, value: 'file' },
  ]
  if (current !== null) {
    rows.push({ title: `🚫 ${t('cli.art.actionClear')}`, value: 'clear' })
  }
  rows.push({ title: `← ${t('cli.menu.cancel')}`, value: 'cancel' })
  return rows
}

/**
 * Accept a parsed reference, or report the parser's refusal and change nothing.
 * Both ways of naming an image — the URL prompt and the file browser — land
 * here, so a rejection reads the same however it was typed.
 */
function acceptedArt(ref: CardArtRef | CardArtRefError): CardArtEdit | null {
  if (isCardArtRefError(ref)) {
    console.error(t('cli.art.invalid', { reason: ref.error }))
    return null
  }
  return { ref }
}

/**
 * Ask for an image URL, returning the raw text or null when the user backs out.
 *
 * A blank submit is a way out, not a value: the URL parser would report it as
 * `"" is not a valid URL`, which reads as a typo rather than as the "never mind"
 * it was. Clearing what is stored is a menu row's job, not an empty answer's.
 *
 * The text is deliberately returned unparsed — `set-list-image` shares this
 * prompt but refuses a bad value in its own words ("Cover image unchanged"),
 * which it could not do if the parse and the report happened here.
 */
export async function promptArtUrl(initial: string): Promise<string | null> {
  const value = await ask<string>({
    type: 'text',
    message: t('cli.art.promptUrl'),
    subjectKey: 'cli.prompt.subject.artUrl',
    initial,
  })
  if (value === undefined || value.trim() === '') return null
  return value
}

/**
 * The Set Custom Art prompt: enter a URL, pick a local file, or clear what is
 * there. Returns null when the user backs out at any step, including when the
 * value they gave is not a usable reference — the parsers in `card-art.ts` are
 * the single authority on that, so the CLI accepts exactly what the sidecar,
 * the admin route, and `set-card --art` do.
 */
export async function promptCardArt(current: CardArtRef | null): Promise<CardArtEdit | null> {
  const action = await ask<ArtAction>({
    type: 'select',
    message: t('cli.art.promptAction', {
      art: current === null ? t('cli.art.none') : cardArtDisplay(current),
    }),
    subjectKey: 'cli.prompt.subject.artChoice',
    choices: cardArtActionRows(current),
  })
  if (action === undefined || action === 'cancel') return null
  if (action === 'clear') return { ref: null }

  if (action === 'url') {
    const value = await promptArtUrl(current !== null && 'url' in current ? current.url : '')
    if (value === null) return null
    return acceptedArt(parseCardArtRef({ url: value }))
  }

  const file = await browseArtFile()
  if (file === null) return null
  return acceptedArt(parseCardArtRef({ file }))
}

/** The one card an art edit acts on, and the session state it is staged in. */
export type CardArtEditTarget = {
  /** The list file whose `.art.json` sidecar the art is filed in. */
  filePath: string
  /** The card line's `&N` — the sidecar's key. */
  cardId: number
  cardName: string
  /** The session's pending art, which the next save commits. */
  art: SessionArtChanges
  /** The session's undo stack, which the edit joins. */
  editUndo: EditUndoEntry[]
  /** Mark the session unsaved, so the sidecar write has a save to ride along with. */
  markDirty: () => void
}

/**
 * Run the Set Custom Art action for one card: read what it wears now, prompt,
 * and stage the result.
 *
 * The undo entry carries no changes and no changelog footprint — an art edit
 * has neither — only the reference to put back, so `↩️ Undo Last Edit` and the
 * session-changes list revert it like any other edit. The add shortcuts are
 * deliberately *not* invalidated: the card line is untouched, so "add another
 * copy of it" still means what it meant.
 */
export async function editCardArt(target: CardArtEditTarget): Promise<void> {
  const current = await currentSessionArt(target.filePath, target.art, target.cardId)
  if (!current.ok) {
    console.error(t('cli.art.sidecarUnreadable', { reason: current.message }))
    return
  }
  const edit = await promptCardArt(current.ref)
  if (edit === null || isSameArtState(edit.ref, current.ref)) return

  noteArtSet(target.art, target.cardId, edit.ref)
  target.editUndo.push({
    cardId: target.cardId,
    kind: 'edit',
    label: t('cli.editLabel.art', { name: target.cardName }),
    inverse: [],
    addedToChangelog: [],
    removedFromChangelog: [],
    restoreArt: { ref: current.ref },
  })
  target.markDirty()
  console.log(
    edit.ref === null
      ? t('cli.art.cleared', { name: target.cardName })
      : t('cli.art.set', { name: target.cardName, art: cardArtDisplay(edit.ref) }),
  )
}
