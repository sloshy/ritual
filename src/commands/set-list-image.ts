import { Command, Option } from 'commander'
import path from 'node:path'
import {
  isListImageCardRef,
  isListImageRefError,
  listImageMode,
  parseListImage,
  serializeListImageRef,
  type ListImageMode,
  type ListImageRef,
} from '../list/list-image'
import { checkListImageCardId, readListImageFile } from '../list/list-image-file'
import { applyDeckMetadata } from '../list/deck-metadata'
import { applyFlatListMetadata } from '../list/flat-list-metadata'
import {
  parseDeckMetadataBody,
  parseFlatListMetadataBody,
  type DeckMetadataRequest,
  type FlatListMetadataRequest,
} from '../admin/api/metadata'
import { checkArchidektLink } from '../deck-sync/link'
import { CardCommandError, localizedCommandError, ExitCode } from '../util/errors'
import { t } from '../i18n/t'
import type { ListType } from '../list/list-type'
import type { ListTypeFlags } from '../list/resolve-list'
import { browseArtFile, promptArtUrl } from './edit-art'
import { ask, suggestByTitleTerms } from '../cli/prompts'
import {
  addListTypeFlags,
  describeEntry,
  loadEntryRefs,
  listTypeLabel,
  parseCardIdFlag,
  resolveListSelection,
  resolveListTypeFlag,
  type EntryRef,
} from './card-target'
import { cancelledError, runCommandAction } from '../cli/action'
import { addDryRunOption, addScriptingOptions, type DryRunOptions } from '../cli/options'
import { emitOutput, normalizeScriptingOptions, type ScriptingOptions } from '../cli/output'

/**
 * `ritual set-list-image` — choose the cover image a deck, collection or wanted
 * list shows on the site, written as the `image:` key in its front matter.
 *
 * Four modes, matching the front matter's own grammar (`src/list-image.ts`): the
 * built-in rule (`--default`, which removes the key), a card line in the list
 * (`--card`, by its `&N` id), a file in the art directory (`--file`), or a URL
 * (`--url`). With no mode flag the command runs as a wizard — pick the list,
 * pick the mode, then pick the card / browse for a file / type the URL.
 *
 * This is deliberately its own command rather than a `ritual metadata set`
 * property: a cover is a *mapping* (`{card: 12}`), which that command's scalar
 * `<value>…` arguments cannot spell, and only this one of the two speaks to
 * wanted lists (`image` is the single key they carry). Writes still go through
 * the shared metadata parsers and engines the admin route and the MCP
 * `set_list_metadata` tool use, so one grammar, one card-id existence check and
 * one body-preserving, sidecar-aware write serve every surface.
 */

/** The command's raw Commander options. The four modes are mutually exclusive. */
export type SetListImageOptions = {
  /** `--card <id>`: the `&N` of a line in the list; a leading `&` is accepted. */
  card?: string
  /** `--file <path>`: an image in the configured art directory, relative to it. */
  file?: string
  /** `--url <url>`: an absolute http(s) URL, used verbatim by the site. */
  url?: string
  /** `--default`: remove the key and fall back to the built-in cover rule. */
  default?: boolean
} & ListTypeFlags &
  DryRunOptions &
  Partial<ScriptingOptions>

/**
 * The resolved run: the list to write, and the cover to write on it. `image`
 * being `undefined` is what separates a flagged run from the wizard — `null` is
 * a decision (clear the key), absence is "ask me".
 */
export type SetListImageInput = {
  listName?: string
  type?: ListType
  image?: ListImageRef | null
  dryRun: boolean
}

/** `--output json` payload of a successful run. */
export type SetListImageResult = {
  type: ListType
  /** The list's slug — its file name without the extension. */
  list: string
  /** Which rule the list's cover now follows. */
  mode: ListImageMode
  /** The stored mapping, or null when the key was removed. */
  image: ListImageRef | null
  /** Present and true when `--dry-run` reported the change without writing it. */
  dryRun?: true
}

export function registerSetListImageCommand(program: Command): void {
  addScriptingOptions(
    // Long form only: `-n` would be this command's `--name`-shaped territory.
    addDryRunOption(
      addListTypeFlags(
        program
          .command('set-list-image')
          .description(t('help.setListImage.description'))
          .argument('[listName]', t('help.listArg.crossType')),
      )
        .addOption(
          new Option('--card <id>', t('help.setListImage.card')).conflicts([
            'file',
            'url',
            'default',
          ]),
        )
        .addOption(
          new Option('--file <path>', t('help.setListImage.file')).conflicts([
            'card',
            'url',
            'default',
          ]),
        )
        .addOption(
          new Option('--url <url>', t('help.setListImage.url')).conflicts([
            'card',
            'file',
            'default',
          ]),
        )
        .addOption(
          new Option('--default', t('help.setListImage.default')).conflicts([
            'card',
            'file',
            'url',
          ]),
        ),
      t('help.setListImage.dryRun'),
      { short: false },
    ),
    'text',
  ).action(async (listNameArg: string | undefined, options: SetListImageOptions) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    const type = resolveListTypeFlag(options, scripting)
    if (type === 'conflict') return
    await runCommandAction(scripting, () =>
      runSetListImage(
        {
          listName: listNameArg,
          type,
          image: imageFromFlags(options),
          dryRun: options.dryRun ?? false,
        },
        scripting,
      ),
    )
  })
}

/**
 * The cover the flags name, `null` for `--default`, or `undefined` when no mode
 * flag was passed and the wizard should ask.
 *
 * Commander's `.conflicts()` has already refused two modes at once. Flag parsing
 * is not the YAML grammar: `--card &12` and `--card 12` both name id 12, since
 * `&12` is how the id is spelled in a list file and typing it is the obvious
 * thing to do. Everything else is handed to {@link parseListImage} as the
 * single-key mapping it would be in front matter, so a bad path or URL is
 * refused with the same sentence a hand-edited file's `image:` would report.
 */
function imageFromFlags(options: SetListImageOptions): ListImageRef | null | undefined {
  if (options.default === true) return null
  if (options.card !== undefined) {
    return { card: parseCardIdFlag(options.card.replace(/^&/, '')) }
  }
  if (options.file !== undefined) return acceptedListImage({ file: options.file })
  if (options.url !== undefined) return acceptedListImage({ url: options.url })
  return undefined
}

/**
 * Parse a `{file}`/`{url}` mapping into a reference, throwing the parser's own
 * reason as a usage error. Shared by the flags and the wizard so a rejection
 * reads the same however the value was named.
 */
function acceptedListImage(value: object): ListImageRef {
  const parsed = parseListImage(value)
  if (isListImageRefError(parsed)) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.setListImage.invalid', {
      reason: parsed.error,
    })
  }
  return parsed
}

/** How a cover reads in a message: the `&N`, the art path, or the URL. */
function listImageValue(image: ListImageRef): string {
  if (isListImageCardRef(image)) return `&${image.card}`
  return 'file' in image ? image.file : image.url
}

/**
 * Write a validated cover through the same path the admin route takes: the
 * shared body parser for the list's type, then that type's metadata engine. The
 * body speaks the front matter's grammar, so the parser here is not a second
 * validation pass — it is the same one, and a refusal it produces is the same
 * sentence the HTTP client would receive.
 */
async function applyListImage(
  type: ListType,
  filePath: string,
  image: ListImageRef | null,
): Promise<void> {
  const body: FlatListMetadataRequest & DeckMetadataRequest = {
    image: image === null ? null : serializeListImageRef(image),
  }
  if (type === 'deck') {
    const parsed = parseDeckMetadataBody(body)
    if (typeof parsed === 'string') {
      throw new CardCommandError('usage_error', parsed, ExitCode.UsageError)
    }
    const write = await applyDeckMetadata(filePath, parsed.patch, checkArchidektLink)
    if (typeof write === 'string') {
      throw new CardCommandError('usage_error', write, ExitCode.UsageError)
    }
    return
  }
  const parsed = parseFlatListMetadataBody(body, type)
  if (typeof parsed === 'string') {
    throw new CardCommandError('usage_error', parsed, ExitCode.UsageError)
  }
  const write = await applyFlatListMetadata(filePath, parsed.patch)
  if (typeof write === 'string') {
    throw new CardCommandError('usage_error', write, ExitCode.UsageError)
  }
}

/**
 * Resolve the list, settle on a cover, and write it.
 *
 * The card-id existence check is the admin route's own
 * ({@link checkListImageCardId}), not a CLI copy: a `card` reference is refused
 * identically here, over HTTP, and from the MCP tool, and a `file` path is
 * deliberately never checked so the art can be added later. A dry run resolves
 * and validates everything, then stops before the first write.
 */
export async function runSetListImage(
  input: SetListImageInput,
  scripting: ScriptingOptions,
): Promise<void> {
  const { type, filePath } = await resolveListSelection(input.listName, input.type)
  const list = path.basename(filePath, '.md')

  let image: ListImageRef | null
  if (input.image !== undefined) {
    image = input.image
  } else {
    const current = await readListImageFile(filePath)
    const chosen = await promptListImage(type, list, filePath, current.image ?? null)
    if (chosen === undefined) throw cancelledError()
    image = chosen
  }

  const badCardRef = await checkListImageCardId(filePath, image)
  if (badCardRef !== null) {
    throw new CardCommandError('usage_error', badCardRef, ExitCode.UsageError)
  }

  if (!input.dryRun) await applyListImage(type, filePath, image)

  if (scripting.output === 'text') {
    if (scripting.quiet) return
    emitOutput(messageFor(type, list, image, input.dryRun), scripting)
    return
  }
  const result: SetListImageResult = {
    ...(input.dryRun ? { dryRun: true as const } : {}),
    type,
    list,
    mode: listImageMode(image),
    image: image === null ? null : serializeListImageRef(image),
  }
  emitOutput(result, scripting)
}

/** The success (or preview) line for a written cover. */
function messageFor(
  type: ListType,
  list: string,
  image: ListImageRef | null,
  dryRun: boolean,
): string {
  const params = { type: listTypeLabel(type), list }
  if (image === null) {
    return dryRun
      ? t('cli.setListImage.clearedPreview', params)
      : t('cli.setListImage.cleared', params)
  }
  const setParams = { ...params, mode: listImageMode(image), value: listImageValue(image) }
  return dryRun ? t('cli.setListImage.setPreview', setParams) : t('cli.setListImage.set', setParams)
}

// ── The wizard ────────────────────────────────────────────────────────────────

/** One row of the mode menu. */
export type ListImageModeChoice = {
  value: ListImageMode
  title: string
}

/**
 * The mode menu's rows, with the list's current mode marked.
 *
 * The mark rather than a pre-selected row: the menu is a *change* prompt, and
 * "what is set now" is the one thing a user opening it wants to know before
 * choosing. Split out from the prompt so the marking is a plain function rather
 * than something only a live terminal can show. `file` and `url` reuse the
 * custom-art menu's own wording — they name the same two things.
 */
export function listImageModeChoices(current: ListImageRef | null): ListImageModeChoice[] {
  const currentMode = listImageMode(current)
  const rows: ListImageModeChoice[] = [
    { value: 'default', title: `✨ ${t('cli.setListImage.modeDefault')}` },
    { value: 'card', title: `🃏 ${t('cli.setListImage.modeCard')}` },
    { value: 'file', title: `📁 ${t('cli.art.actionFile')}` },
    { value: 'url', title: `🔗 ${t('cli.art.actionUrl')}` },
  ]
  return rows.map((row) => (row.value === currentMode ? { ...row, title: `${row.title} ✓` } : row))
}

/** One row of the card picker: the card line, and the `&N` choosing it writes. */
export type ListImageCardRow = {
  cardId: number
  title: string
}

/**
 * The card picker's rows for a list's entries — every line that carries an `&N`,
 * in file order, described the way every other card picker describes one (name,
 * printing annotation with the set code uppercased, then the id).
 *
 * File order rather than a sort: it is the order the user sees in the file and
 * in the editors, and the picker filters by typing anyway. A line with no id
 * cannot be referenced at all, so it is left out rather than offered and
 * refused — the ids are backfilled before this command's action runs, so in
 * practice nothing is missing.
 */
export function listImageCardRows(entries: readonly EntryRef[]): ListImageCardRow[] {
  const rows: ListImageCardRow[] = []
  for (const entry of entries) {
    if (entry.cardId === undefined) continue
    rows.push({ cardId: entry.cardId, title: describeEntry(entry) })
  }
  return rows
}

/** How the current cover reads in the mode prompt's header. */
function describeCurrent(current: ListImageRef | null): string {
  return t('cli.setListImage.current', {
    mode: listImageMode(current),
    value: current === null ? '' : listImageValue(current),
  })
}

/**
 * The wizard: pick a mode, then name the image. Returns the chosen cover
 * (`null` clears the key) or `undefined` when the user backs out at any step —
 * including when the value they gave is not a usable reference, since a refusal
 * is not a decision to change anything.
 *
 * Every prompt goes through `ask()`, so `--no-input` and a missing terminal are
 * refused once, by subject, rather than per step.
 */
async function promptListImage(
  type: ListType,
  list: string,
  filePath: string,
  current: ListImageRef | null,
): Promise<ListImageRef | null | undefined> {
  const mode = await ask<ListImageMode | 'cancel'>({
    type: 'select',
    message: t('cli.setListImage.modePrompt', {
      type: listTypeLabel(type),
      list,
      current: describeCurrent(current),
    }),
    subjectKey: 'cli.prompt.subject.listImageMode',
    choices: [
      ...listImageModeChoices(current),
      { title: `← ${t('cli.menu.cancel')}`, value: 'cancel' as const },
    ],
  })
  if (mode === undefined || mode === 'cancel') return undefined
  if (mode === 'default') return null

  if (mode === 'card') return await promptListImageCard(type, list, filePath)

  if (mode === 'url') {
    const value = await promptArtUrl(current !== null && 'url' in current ? current.url : '')
    if (value === null) return undefined
    return reportedListImage({ url: value })
  }

  const file = await browseArtFile()
  if (file === null) return undefined
  return reportedListImage({ file })
}

/**
 * Parse a value the wizard collected, reporting the parser's refusal and
 * changing nothing. The flag path throws instead ({@link acceptedListImage}) —
 * a script has no prompt to return to, while a wizard step does.
 */
function reportedListImage(value: object): ListImageRef | undefined {
  const parsed = parseListImage(value)
  if (isListImageRefError(parsed)) {
    console.error(t('cli.setListImage.invalid', { reason: parsed.error }))
    return undefined
  }
  return parsed
}

/** The card picker: choose a line of the list by name, and reference its `&N`. */
async function promptListImageCard(
  type: ListType,
  list: string,
  filePath: string,
): Promise<ListImageRef | undefined> {
  const rows = listImageCardRows(await loadEntryRefs(type, filePath))
  if (rows.length === 0) {
    throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.setListImage.noCards', {
      type: listTypeLabel(type),
      list,
    })
  }
  const cardId = await ask<number>({
    type: 'autocomplete',
    message: t('cli.setListImage.cardPrompt'),
    subjectKey: 'cli.prompt.subject.listImageCard',
    choices: rows.map((row) => ({ title: row.title, value: row.cardId })),
    limit: 15,
    suggest: suggestByTitleTerms,
  })
  if (cardId === undefined) return undefined
  return { card: cardId }
}
