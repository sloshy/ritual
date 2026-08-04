import path from 'node:path'
import fs from 'node:fs/promises'
import { Command, Option } from 'commander'
import {
  applyDeckMetadata,
  DECK_METADATA_KEYS,
  isDeckMetadataKey,
  type DeckMetadataPatch,
} from '../deck-metadata'
import {
  applyCollectionMetadata,
  COLLECTION_METADATA_KEYS,
  isCollectionMetadataKey,
  type CollectionMetadataPatch,
} from '../flat-list-metadata'
import { parseDeckFrontMatter } from '../deck-file'
import { readFrontMatterMapping } from '../front-matter-write'
import { CARD_LABELS, isCardLabel, parseCardLabelsValue, type CardLabel } from '../card-labels'
import { parseCollectionMetadataBody, parseDeckMetadataBody } from '../admin/api/metadata'
import { checkArchidektLink } from '../deck-sync/link'
import { CardCommandError } from '../errors'
import {
  formatSettableValue,
  mergeArrayValues,
  splitCommaTokens,
  type ArrayMode,
} from '../config-fields'
import {
  addListTypeFlags,
  resolveListSelection,
  resolveListTypeFlag,
  runCommandAction,
  type ResolvedList,
} from './card-target'
import type { ListType } from '../list-type'
import type { ListTypeFlags } from '../resolve-list'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

/**
 * `ritual metadata` — inspect and modify a list's front-matter metadata from
 * scripts, mirroring `ritual config`'s subcommand shape (`set`/`get`/`list`/
 * `unset`). Decks take `description`/`tags`/`format`/`sourceId`/`sourceUrl`;
 * collections take `labels` (their default card labels); wanted lists carry no
 * metadata and are refused. Writes go through the same engines as the admin
 * route and the MCP `set_list_metadata` tool ({@link applyDeckMetadata} /
 * {@link applyCollectionMetadata}), so validation and the body-preserving,
 * sidecar-aware write live exactly once.
 */

type MetadataTypeFlags = ListTypeFlags & Partial<ScriptingOptions>

type MetadataSetOptions = MetadataTypeFlags & { add?: boolean; remove?: boolean }

/** JSON payload of a successful `metadata set`. */
type MetadataSetResult = {
  type: ListType
  list: string
  property: string
  /** The property's new stored value; null when the write cleared it. */
  value: unknown
}

/** JSON payload of a successful `metadata unset`. */
type MetadataUnsetResult = {
  type: ListType
  list: string
  property: string
  status: 'unset'
}

/** JSON payload of `metadata list`: the full front matter, unknown keys included. */
type MetadataListResult = {
  type: ListType
  list: string
  frontMatter: Record<string, unknown>
}

/** A resolved non-wanted target: the list plus its display slug. */
type MetadataTarget = {
  type: 'deck' | 'collection'
  filePath: string
  list: string
}

/**
 * A validated patch paired with the list type it belongs to. The top-level
 * discriminant correlates the payload with the engine, so a deck patch can
 * never be handed to the collection engine (or vice versa) without a compile
 * error.
 */
type MetadataApply =
  | { type: 'deck'; filePath: string; patch: DeckMetadataPatch }
  | { type: 'collection'; filePath: string; patch: CollectionMetadataPatch }

/** The accepted-keys listing for error messages, per list type. */
function acceptedKeys(type: 'deck' | 'collection'): string {
  const keys = type === 'deck' ? DECK_METADATA_KEYS : COLLECTION_METADATA_KEYS
  return keys.join(', ')
}

/**
 * CLI wording for the deck keys that exist in front matter but are not
 * settable here — matching the vocabulary the admin route rejects, but phrased
 * for the CLI (the HTTP parser's messages point at admin routes).
 */
const REJECTED_KEY_MESSAGES: Record<string, string> = {
  name: "name cannot be set here — a list's display name is changed with ritual rename, which also renames the file and its sidecars.",
  created: 'created is stamped when the deck is created and cannot be edited.',
  lastSynced: 'lastSynced is stamped by deck sync and cannot be edited.',
}

function unknownKeyError(type: 'deck' | 'collection', property: string): CardCommandError {
  const rejected = REJECTED_KEY_MESSAGES[property]
  return new CardCommandError(
    'usage_error',
    rejected ??
      `Unknown metadata field '${property}'. Accepted fields for a ${type}: ${acceptedKeys(type)}.`,
    ExitCode.UsageError,
  )
}

/** Throw unless `property` is settable on the target's type. */
function requireKnownProperty(type: 'deck' | 'collection', property: string): void {
  const known = type === 'deck' ? isDeckMetadataKey(property) : isCollectionMetadataKey(property)
  if (!known) throw unknownKeyError(type, property)
}

/**
 * Resolve the target list for a metadata subcommand, refusing wanted lists —
 * they define no front-matter keys, so there is nothing to read or write. The
 * refusal fires up front for `--wanted`, and the interactive picker only
 * offers decks and collections; a wanted list named explicitly still resolves
 * first, so the refusal names what actually matched.
 */
async function resolveMetadataTarget(
  listName: string | undefined,
  flags: ListTypeFlags,
  scripting: ScriptingOptions,
): Promise<MetadataTarget | 'conflict'> {
  const type = resolveListTypeFlag(flags, scripting)
  if (type === 'conflict') return 'conflict'
  if (type === 'wanted') throw wantedListsCarryNoMetadata()
  const resolved: ResolvedList = await resolveListSelection(listName, type, {
    pickerTypes: ['deck', 'collection'],
  })
  if (resolved.type === 'wanted') throw wantedListsCarryNoMetadata()
  return {
    type: resolved.type,
    filePath: resolved.filePath,
    list: path.basename(resolved.filePath, '.md'),
  }
}

function wantedListsCarryNoMetadata(): CardCommandError {
  return new CardCommandError(
    'usage_error',
    'Wanted lists carry no metadata. Use ritual rename to change the display name.',
    ExitCode.UsageError,
  )
}

/**
 * Read the target's front-matter mapping, refusing when it cannot be read as
 * YAML — for a write, a merge over keys that cannot be seen would clobber
 * them; for a read, there is nothing trustworthy to report. One guard for both
 * list types, so decks and collections fail the same way (exit 1) instead of
 * a deck's parse error escaping as a raw exception.
 */
async function readFrontMatterData(target: MetadataTarget): Promise<Record<string, unknown>> {
  const content = await fs.readFile(target.filePath, 'utf-8')
  const mapping = readFrontMatterMapping(content)
  if (!mapping.ok) {
    const problem =
      mapping.reason === 'not-a-mapping'
        ? 'is not a key/value mapping'
        : 'could not be read as YAML'
    throw new CardCommandError(
      'runtime_error',
      `The file's front matter ${problem}. Fix the block by hand first.`,
      ExitCode.RuntimeError,
    )
  }
  return mapping.data
}

/** A collection's current default labels, or `[]`; throws when the stored value is invalid. */
function currentCollectionLabels(data: Record<string, unknown>): CardLabel[] {
  if (data.labels === undefined) return []
  const parsed = parseCardLabelsValue(data.labels, 'labels')
  if (!parsed.ok) {
    throw new CardCommandError(
      'runtime_error',
      `The stored 'labels' value is invalid: ${parsed.message}`,
      ExitCode.RuntimeError,
    )
  }
  return parsed.labels
}

/**
 * Coerce `metadata set`'s raw string values into the body shape the shared
 * metadata parsers validate. `description` joins its values with spaces (it is
 * prose); `tags` tokenizes on commas and whitespace-separated arguments alike;
 * everything else takes exactly one value. The property is validated before
 * this runs, so only known keys arrive.
 */
export function buildDeckSetBody(
  property: string,
  values: readonly string[],
  currentTags: readonly string[],
  mode: ArrayMode,
): Record<string, unknown> | string {
  if (mode !== 'replace' && property !== 'tags') {
    return `--add/--remove apply to array properties (a deck's: tags).`
  }
  if (property === 'tags') {
    return { tags: mergeArrayValues(currentTags, splitCommaTokens(values), mode) }
  }
  if (property === 'description') return { description: values.join(' ') }
  if (values.length !== 1) {
    return `${property} takes exactly one value.`
  }
  return { [property]: values.join(' ') }
}

/**
 * Coerce `metadata set`'s raw string values for a collection. Label tokens are
 * lowercased and validated against the vocabulary up front, so a typo'd
 * `--remove` errors instead of silently removing nothing; an empty replace is
 * refused (clearing is `unset`'s job), while `--remove` down to nothing clears.
 */
export function buildCollectionSetBody(
  property: string,
  values: readonly string[],
  currentLabels: readonly string[],
  mode: ArrayMode,
): Record<string, unknown> | string {
  if (mode !== 'replace' && property !== 'labels') {
    return `--add/--remove apply to array properties (a collection's: labels).`
  }
  const tokens = splitCommaTokens(values).map((token) => token.toLowerCase())
  const unknown = tokens.find((token) => !isCardLabel(token))
  if (unknown !== undefined) {
    return `Invalid label '${unknown}'. Use one of: ${CARD_LABELS.join(', ')}.`
  }
  if (mode === 'replace' && tokens.length === 0) {
    return 'No labels given. To clear the default, use ritual metadata unset.'
  }
  return { labels: mergeArrayValues(currentLabels, tokens, mode) }
}

/** The value a patch stores for `property`, or null when it clears it. */
function patchValue(patch: Record<string, unknown>, property: string): unknown {
  const value = patch[property]
  return value === undefined || value === null ? null : value
}

function emitSetResult(
  target: MetadataTarget,
  property: string,
  value: unknown,
  scripting: ScriptingOptions,
): void {
  if (scripting.output === 'text') {
    if (scripting.quiet) return
    const rendered =
      value === null ? `Cleared ${property}` : `Set ${property} = ${formatSettableValue(value)}`
    emitOutput(`${rendered} on ${target.type} '${target.list}'`, scripting)
    return
  }
  const result: MetadataSetResult = {
    type: target.type,
    list: target.list,
    property,
    value,
  }
  emitOutput(result, scripting)
}

/** Apply a validated patch through its type's engine, throwing on refusal. */
async function applyPatch(apply: MetadataApply): Promise<void> {
  const outcome =
    apply.type === 'deck'
      ? await applyDeckMetadata(apply.filePath, apply.patch, checkArchidektLink)
      : await applyCollectionMetadata(apply.filePath, apply.patch)
  if (typeof outcome === 'string') {
    throw new CardCommandError('usage_error', outcome, ExitCode.UsageError)
  }
}

export function registerMetadataCommand(program: Command): void {
  const metadata = program
    .command('metadata')
    .description(
      "Inspect and modify a list's front-matter metadata " +
        '(deck description/tags/format/source link, collection default labels)',
    )

  registerSetSubcommand(metadata)
  registerGetSubcommand(metadata)
  registerListSubcommand(metadata)
  registerUnsetSubcommand(metadata)
}

function registerSetSubcommand(metadata: Command): void {
  addScriptingOptions(
    addListTypeFlags(
      metadata
        .command('set')
        .description('Set or update a metadata property on a deck or collection')
        .argument('[listName]', 'Name of the deck or collection (prompted when omitted)')
        .argument('<property>', `Deck: ${DECK_METADATA_KEYS.join(', ')}. Collection: labels.`)
        .argument('<value...>', 'Value(s) to set')
        .addOption(
          new Option(
            '--add',
            'Add value(s) to an array property (tags, labels) instead of replacing it',
          ).conflicts('remove'),
        )
        .addOption(new Option('--remove', 'Remove value(s) from an array property')),
    ),
  ).action(
    async (
      listName: string | undefined,
      property: string,
      values: string[],
      options: MetadataSetOptions,
    ) => {
      const scripting = normalizeScriptingOptions(options)
      await runCommandAction(scripting, async () => {
        const target = await resolveMetadataTarget(listName, options, scripting)
        if (target === 'conflict') return
        requireKnownProperty(target.type, property)
        const mode: ArrayMode = options.add ? 'add' : options.remove ? 'remove' : 'replace'
        const data = await readFrontMatterData(target)

        if (target.type === 'deck') {
          const current = await parseDeckFrontMatter(target.filePath)
          const body = buildDeckSetBody(property, values, current.tags ?? [], mode)
          if (typeof body === 'string') {
            throw new CardCommandError('usage_error', body, ExitCode.UsageError)
          }
          const parsed = parseDeckMetadataBody(body)
          if (typeof parsed === 'string') {
            throw new CardCommandError('usage_error', parsed, ExitCode.UsageError)
          }
          await applyPatch({ type: 'deck', filePath: target.filePath, patch: parsed.patch })
          emitSetResult(target, property, patchValue(parsed.patch, property), scripting)
          return
        }

        // The current value is only an input to `--add`/`--remove`; a replace
        // must not read it, so an invalid stored value can be repaired.
        const current = mode === 'replace' ? [] : currentCollectionLabels(data)
        const body = buildCollectionSetBody(property, values, current, mode)
        if (typeof body === 'string') {
          throw new CardCommandError('usage_error', body, ExitCode.UsageError)
        }
        const parsed = parseCollectionMetadataBody(body)
        if (typeof parsed === 'string') {
          throw new CardCommandError('usage_error', parsed, ExitCode.UsageError)
        }
        await applyPatch({ type: 'collection', filePath: target.filePath, patch: parsed.patch })
        emitSetResult(target, property, patchValue(parsed.patch, property), scripting)
      })
    },
  )
}

function registerGetSubcommand(metadata: Command): void {
  addScriptingOptions(
    addListTypeFlags(
      metadata
        .command('get')
        .description('Print the value of a single metadata property')
        .argument('[listName]', 'Name of the deck or collection (prompted when omitted)')
        .argument('<property>', `Deck: ${DECK_METADATA_KEYS.join(', ')}. Collection: labels.`),
    ),
  ).action(async (listName: string | undefined, property: string, options: MetadataTypeFlags) => {
    const scripting = normalizeScriptingOptions(options)
    await runCommandAction(scripting, async () => {
      const target = await resolveMetadataTarget(listName, options, scripting)
      if (target === 'conflict') return
      requireKnownProperty(target.type, property)
      const value = await readMetadataValue(target, property)
      if (value === undefined) {
        emitError(
          'not_found',
          `"${property}" is not set on ${target.type} '${target.list}'.`,
          scripting,
        )
        process.exitCode = ExitCode.NotFound
        return
      }
      // The value is the command's entire point, so it prints even under --quiet.
      if (scripting.output === 'text') {
        emitOutput(formatSettableValue(value), scripting)
        return
      }
      emitOutput(value, scripting)
    })
  })
}

/**
 * Read one settable property's stored value, or undefined when unset. An empty
 * array reads as unset for every key — `labels: []` means "no default" and
 * `tags: []` says nothing — so exit codes answer "is anything set?" uniformly.
 */
async function readMetadataValue(target: MetadataTarget, property: string): Promise<unknown> {
  const data = await readFrontMatterData(target)
  let value: unknown
  if (target.type === 'deck') {
    const frontMatter = await parseDeckFrontMatter(target.filePath)
    value = isDeckMetadataKey(property) ? frontMatter[property] : undefined
  } else {
    const labels = currentCollectionLabels(data)
    value = data.labels === undefined ? undefined : labels
  }
  if (Array.isArray(value) && value.length === 0) return undefined
  return value
}

function registerListSubcommand(metadata: Command): void {
  addScriptingOptions(
    addListTypeFlags(
      metadata
        .command('list')
        .description("Print a list's full front-matter metadata")
        .argument('[listName]', 'Name of the deck or collection (prompted when omitted)'),
    ),
  ).action(async (listName: string | undefined, options: MetadataTypeFlags) => {
    const scripting = normalizeScriptingOptions(options)
    await runCommandAction(scripting, async () => {
      const target = await resolveMetadataTarget(listName, options, scripting)
      if (target === 'conflict') return

      // The guard runs first for both types: parseDeckFrontMatter would throw
      // a raw parse error past the scripting error envelope on unreadable YAML.
      const data = await readFrontMatterData(target)
      const frontMatter: Record<string, unknown> =
        target.type === 'deck' ? await parseDeckFrontMatter(target.filePath) : data

      if (scripting.output === 'text') {
        const keys = target.type === 'deck' ? DECK_METADATA_KEYS : COLLECTION_METADATA_KEYS
        const lines = keys.map((key) => {
          const value = frontMatter[key]
          return value === undefined ? `${key} = (unset)` : `${key} = ${formatSettableValue(value)}`
        })
        emitOutput(lines.join('\n'), scripting)
        return
      }
      // The JSON payload is the full mapping, unknown and non-settable keys
      // included — the same honest shape the admin metadata route returns.
      const result: MetadataListResult = {
        type: target.type,
        list: target.list,
        frontMatter,
      }
      emitOutput(result, scripting)
    })
  })
}

function registerUnsetSubcommand(metadata: Command): void {
  addScriptingOptions(
    addListTypeFlags(
      metadata
        .command('unset')
        .description('Remove a metadata property from a deck or collection')
        .argument('[listName]', 'Name of the deck or collection (prompted when omitted)')
        .argument('<property>', `Deck: ${DECK_METADATA_KEYS.join(', ')}. Collection: labels.`),
    ),
  ).action(async (listName: string | undefined, property: string, options: MetadataTypeFlags) => {
    const scripting = normalizeScriptingOptions(options)
    await runCommandAction(scripting, async () => {
      const target = await resolveMetadataTarget(listName, options, scripting)
      if (target === 'conflict') return
      requireKnownProperty(target.type, property)
      // The same unreadable-YAML refusal as `set`, so both writes exit 1 on a
      // block they cannot safely merge over.
      await readFrontMatterData(target)

      if (target.type === 'deck') {
        const patch: DeckMetadataPatch = { [property]: null }
        await applyPatch({ type: 'deck', filePath: target.filePath, patch })
      } else {
        // `property` is validated above; a collection's only settable key is
        // `labels`, so the patch names it directly.
        const patch: CollectionMetadataPatch = { labels: null }
        await applyPatch({ type: 'collection', filePath: target.filePath, patch })
      }

      if (scripting.output === 'text') {
        if (!scripting.quiet) {
          emitOutput(`Unset ${property} on ${target.type} '${target.list}'`, scripting)
        }
        return
      }
      const result: MetadataUnsetResult = {
        type: target.type,
        list: target.list,
        property,
        status: 'unset',
      }
      emitOutput(result, scripting)
    })
  })
}
