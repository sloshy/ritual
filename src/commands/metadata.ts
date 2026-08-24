import path from 'node:path'
import fs from 'node:fs/promises'
import { Command, Option } from 'commander'
import {
  applyDeckMetadata,
  DECK_METADATA_KEYS,
  isDeckMetadataKey,
  type DeckMetadataKey,
  type DeckMetadataPatch,
} from '../deck-metadata'
import {
  applyFlatListMetadata,
  FLAT_LIST_METADATA_KEYS,
  type FlatListMetadataPatch,
  type FlatListType,
} from '../flat-list-metadata'
import { readListDescription } from '../list-description'
import { parseDeckFrontMatter } from '../deck-file'
import { readFrontMatterMapping } from '../front-matter-write'
import { isCardLabel, LIST_TYPE_LABELS, parseCardLabelsValue, type CardLabel } from '../card-labels'
import { parseDeckMetadataBody, parseFlatListMetadataBody } from '../admin/api/metadata'
import { checkArchidektLink } from '../deck-sync/link'
import { CardCommandError, localizedCommandError } from '../errors'
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'
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
 * `unset`). Every list type takes `description`, the blurb the site prints above
 * the cards. Decks add `tags`/`format`/`sourceId`/`sourceUrl` plus `labels`
 * (their default card labels, `proxy` alone); collections add `labels` over the
 * whole vocabulary; a wanted list carries the description alone. `image` is the
 * one key of every type's vocabulary this command does not write — only `list`
 * reports it (see {@link settableKeys}). Writes go through the same engines as
 * the admin route and the MCP `set_list_metadata` tool ({@link applyDeckMetadata}
 * / {@link applyFlatListMetadata}), so validation and the body-preserving,
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

/** A resolved target: the list, its type, and its display slug. */
type MetadataTarget = {
  type: ListType
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
  | { type: FlatListType; filePath: string; patch: FlatListMetadataPatch }

/**
 * A key `set`/`unset` may write on *some* list type — the union of all three
 * vocabularies minus `image`. Derived from the same `as const` tables the
 * engines validate against, so a key added there reaches the guard below rather
 * than drifting into a `string` nobody checks.
 */
type SettableMetadataKey = Exclude<
  DeckMetadataKey | (typeof FLAT_LIST_METADATA_KEYS)[FlatListType][number],
  'image'
>

/**
 * The keys `set`/`unset` may write, per list type: the metadata vocabulary minus
 * `image`. A list's cover image is a mapping (`{card: 12}`, `{file: …}`), not
 * something this command's scalar `<value>…` arguments can spell, so it has its
 * own command and is out of scope here: `list` reports the stored mapping, while
 * `set`, `unset` and `get` alike refuse the key and name `ritual set-list-image`.
 */
function settableKeys(type: ListType): readonly SettableMetadataKey[] {
  const keys: readonly string[] =
    type === 'deck' ? DECK_METADATA_KEYS : FLAT_LIST_METADATA_KEYS[type]
  return keys.filter((key): key is SettableMetadataKey => key !== 'image')
}

/** The `<property>` argument's help, naming each type's settable keys. */
function metadataPropertyHelp(): string {
  return t('help.metadata.property', { keys: settableKeys('deck').join(', ') })
}

/** The accepted-keys listing for error messages, per list type. */
function acceptedKeys(type: ListType): string {
  return settableKeys(type).join(', ')
}

/**
 * CLI wording for the deck keys that exist in front matter but are not
 * settable here — matching the vocabulary the admin route rejects, but phrased
 * for the CLI (the HTTP parser's messages point at admin routes).
 *
 * The table holds catalog keys rather than rendered text: it is evaluated once
 * at module load, so a rendered string would freeze in whatever language was
 * active when this module was first imported.
 */
const REJECTED_KEY_MESSAGES: Record<string, RejectedKeyMessage> = {
  name: 'cli.metadata.rejectedName',
  created: 'cli.metadata.rejectedCreated',
  lastSynced: 'cli.metadata.rejectedLastSynced',
}

/**
 * The keys naming a non-settable front-matter field. Narrowed to the three
 * params-free messages so the refusal below needs no parameter bag.
 */
type RejectedKeyMessage = Extract<MessageKey, `cli.metadata.rejected${string}`>

function unknownKeyError(type: ListType, property: string): CardCommandError {
  // `image` is a real metadata key on both types — it is only unsettable *here*,
  // because a cover is a mapping this command's scalar `<value>…` arguments
  // cannot spell. Point at the command that can rather than claiming the key
  // does not exist; `list`/`get` still show what is stored.
  if (property === 'image') {
    return localizedCommandError('usage_error', ExitCode.UsageError, 'cli.metadata.useSetListImage')
  }
  const rejected = REJECTED_KEY_MESSAGES[property]
  if (rejected !== undefined) {
    return localizedCommandError('usage_error', ExitCode.UsageError, rejected)
  }
  return localizedCommandError('usage_error', ExitCode.UsageError, 'cli.metadata.unknownField', {
    type,
    property,
    keys: acceptedKeys(type),
  })
}

/**
 * Throw unless `property` is settable on the target's type — an assertion
 * rather than a `void` check, so the key narrows for every write that follows:
 * a patch built as `{ [property]: null }` is then checked against the patch type
 * instead of typing as an unchecked index signature.
 */
function requireKnownProperty(
  type: ListType,
  property: string,
): asserts property is SettableMetadataKey {
  const keys: readonly string[] = settableKeys(type)
  if (!keys.includes(property)) throw unknownKeyError(type, property)
}

/**
 * Resolve the target list for a metadata subcommand. Every list type is offered:
 * a wanted list carries `description` like the others, so the picker lists all
 * three and a `--wanted` flag resolves normally.
 */
async function resolveMetadataTarget(
  listName: string | undefined,
  flags: ListTypeFlags,
  scripting: ScriptingOptions,
): Promise<MetadataTarget | 'conflict'> {
  const type = resolveListTypeFlag(flags, scripting)
  if (type === 'conflict') return 'conflict'
  const resolved: ResolvedList = await resolveListSelection(listName, type)
  return {
    type: resolved.type,
    filePath: resolved.filePath,
    list: path.basename(resolved.filePath, '.md'),
  }
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
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.metadata.frontMatterUnreadable',
      { reason: mapping.reason === 'not-a-mapping' ? 'notAMapping' : 'invalidYaml' },
    )
  }
  return mapping.data
}

/** A collection's current default labels, or `[]`; throws when the stored value is invalid. */
function currentCollectionLabels(data: Record<string, unknown>): CardLabel[] {
  if (data.labels === undefined) return []
  const parsed = parseCardLabelsValue(data.labels, 'labels')
  if (!parsed.ok) {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.metadata.storedLabelsInvalid',
      { reason: parsed.message },
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
  current: DeckArrayValues,
  mode: ArrayMode,
): Record<string, unknown> | string {
  if (mode !== 'replace' && property !== 'tags' && property !== 'labels') {
    return t('cli.metadata.arrayOnly', { type: 'deck' })
  }
  if (property === 'tags') {
    return { tags: mergeArrayValues(current.tags, splitCommaTokens(values), mode) }
  }
  if (property === 'labels') return buildLabelsSetBody('deck', values, current.labels, mode)
  if (property === 'description') return { description: values.join(' ') }
  if (values.length !== 1) return t('cli.metadata.singleValue', { property })
  return { [property]: values.join(' ') }
}

/** The deck's current values for the keys `--add`/`--remove` merge against. */
export type DeckArrayValues = {
  tags: readonly string[]
  labels: readonly string[]
}

/**
 * Coerce `metadata set`'s raw string values for a flat list. `description` joins
 * its values with spaces, exactly as a deck's does. Label tokens are lowercased
 * and validated against the vocabulary up front, so a typo'd `--remove` errors
 * instead of silently removing nothing; an empty replace is refused (clearing is
 * `unset`'s job), while `--remove` down to nothing clears.
 */
export function buildFlatListSetBody(
  type: FlatListType,
  property: string,
  values: readonly string[],
  currentLabels: readonly string[],
  mode: ArrayMode,
): Record<string, unknown> | string {
  if (mode !== 'replace' && property !== 'labels') return t('cli.metadata.arrayOnly', { type })
  if (property === 'description') return { description: values.join(' ') }
  return buildLabelsSetBody(type, values, currentLabels, mode)
}

/**
 * The `labels` body both list types build, validated against what that type
 * carries: a deck offers `proxy` alone, so `--add sale` on a deck names the
 * accepted choices rather than writing a label the grammar cannot express.
 */
function buildLabelsSetBody(
  type: ListType,
  values: readonly string[],
  currentLabels: readonly string[],
  mode: ArrayMode,
): Record<string, unknown> | string {
  // Widened from the literal tuple: this asks about membership, not identity.
  const supported: readonly CardLabel[] = LIST_TYPE_LABELS[type]
  const tokens = splitCommaTokens(values).map((token) => token.toLowerCase())
  const unknown = tokens.find((token) => !isCardLabel(token) || !supported.includes(token))
  if (unknown !== undefined) {
    return t('cli.metadata.invalidLabel', { value: unknown, choices: supported.join(', ') })
  }
  if (mode === 'replace' && tokens.length === 0) return t('cli.metadata.noLabels')
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
    emitOutput(
      value === null
        ? t('cli.metadata.cleared', { type: target.type, property, list: target.list })
        : t('cli.metadata.set', {
            type: target.type,
            property,
            value: formatSettableValue(value),
            list: target.list,
          }),
      scripting,
    )
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
      : await applyFlatListMetadata(apply.filePath, apply.patch)
  if (typeof outcome === 'string') {
    throw new CardCommandError('usage_error', outcome, ExitCode.UsageError)
  }
}

export function registerMetadataCommand(program: Command): void {
  const metadata = program.command('metadata').description(t('help.metadata.description'))

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
        .description(t('help.metadata.set'))
        .argument('[listName]', t('help.metadata.listName'))
        .argument('<property>', metadataPropertyHelp())
        .argument('<value...>', t('help.metadata.value'))
        .addOption(new Option('--add', t('help.metadata.add')).conflicts('remove'))
        .addOption(new Option('--remove', t('help.metadata.remove'))),
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
          const body = buildDeckSetBody(
            property,
            values,
            { tags: current.tags ?? [], labels: current.labels ?? [] },
            mode,
          )
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

        // The current value is only an input to `--add`/`--remove` on `labels`;
        // a replace must not read it, so an invalid stored value can be
        // repaired — and a description edit must not read it at all, or a stray
        // hand-authored `labels:` would answer for a key it has nothing to do
        // with (a wanted list carries no labels in the first place).
        const current =
          mode === 'replace' || property !== 'labels' ? [] : currentCollectionLabels(data)
        const body = buildFlatListSetBody(target.type, property, values, current, mode)
        if (typeof body === 'string') {
          throw new CardCommandError('usage_error', body, ExitCode.UsageError)
        }
        const parsed = parseFlatListMetadataBody(body, target.type)
        if (typeof parsed === 'string') {
          throw new CardCommandError('usage_error', parsed, ExitCode.UsageError)
        }
        await applyPatch({ type: target.type, filePath: target.filePath, patch: parsed.patch })
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
        .description(t('help.metadata.get'))
        .argument('[listName]', t('help.metadata.listName'))
        .argument('<property>', metadataPropertyHelp()),
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
          t('cli.metadata.notSet', { type: target.type, property, list: target.list }),
          scripting,
          undefined,
          'cli.metadata.notSet',
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
  } else if (property === 'description') {
    // An unusable stored value is reported, never answered as "unset": that is
    // the rule `currentCollectionLabels` follows for the sibling key, and a
    // silent `not_found` would send the user looking for a key that is there.
    const read = readListDescription(data)
    if (read.advisory !== undefined) {
      throw localizedCommandError(
        'runtime_error',
        ExitCode.RuntimeError,
        'cli.metadata.storedDescriptionInvalid',
        { reason: read.advisory },
      )
    }
    value = read.description
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
        .description(t('help.metadata.list'))
        .argument('[listName]', t('help.metadata.listName')),
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
        const keys: readonly string[] =
          target.type === 'deck' ? DECK_METADATA_KEYS : FLAT_LIST_METADATA_KEYS[target.type]
        const lines = keys.map((key) => {
          const value = frontMatter[key]
          return value === undefined
            ? t('cli.metadata.rowUnset', { key })
            : t('cli.metadata.row', { key, value: formatSettableValue(value) })
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

/**
 * The patch that clears one flat-list key. Exhaustive over the flat vocabulary
 * minus `image` (which `unset` refuses by name), so a key added to
 * `FLAT_LIST_METADATA_KEYS` without a clear rule is a compile error rather than
 * a silent `labels: null` written to a list that carries no labels.
 */
function flatUnsetPatch(property: SettableMetadataKey): FlatListMetadataPatch {
  switch (property) {
    case 'description':
      return { description: null }
    case 'labels':
      return { labels: null }
    default:
      // Deck-only keys cannot reach here: the guard checked `property` against
      // the flat vocabulary before the branch that calls this.
      throw unknownKeyError('collection', property)
  }
}

function registerUnsetSubcommand(metadata: Command): void {
  addScriptingOptions(
    addListTypeFlags(
      metadata
        .command('unset')
        .description(t('help.metadata.unset'))
        .argument('[listName]', t('help.metadata.listName'))
        .argument('<property>', metadataPropertyHelp()),
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

      // `requireKnownProperty` narrowed `property` to a key of the type's own
      // vocabulary, so both patches below are checked rather than typed as an
      // unchecked index signature — and the flat branch's `never` catches a
      // third flat key added without a clear rule here.
      if (target.type === 'deck') {
        const patch: DeckMetadataPatch = { [property]: null }
        await applyPatch({ type: 'deck', filePath: target.filePath, patch })
      } else {
        const patch = flatUnsetPatch(property)
        await applyPatch({ type: target.type, filePath: target.filePath, patch })
      }

      if (scripting.output === 'text') {
        if (!scripting.quiet) {
          emitOutput(
            t('cli.metadata.unset', { type: target.type, property, list: target.list }),
            scripting,
          )
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
