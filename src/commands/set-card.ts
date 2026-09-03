import { Command, InvalidArgumentError } from 'commander'
import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createAddTagChange,
  createRemoveTagChange,
  createSetCommanderChange,
  createSetCategoriesChange,
  createSetFinishChange,
  createSetLabelChange,
  createSetLanguageChange,
  createSetPrintingChange,
  createSetSectionChange,
  createUnsetCommanderChange,
  type ConditionUpdate,
} from '../changes/change-event'
import { languageDisplayName, type CardLanguage } from '../card/card-language'
import type { PrintingFields } from '../card/card-printing'
import { parseCardLabelsToken, type CardLabel } from '../card/card-labels'
import { formatCardTags, normalizeCardTags, type CardTag } from '../card/card-tags'
import { formatCardCategories, type CardCategory } from '../card/card-categories'
import {
  cardArtFilePath,
  isCardArtRefError,
  loadCardArt,
  parseCardArtInput,
  saveCardArt,
  type CardArtFileRef,
  type CardArtRef,
} from '../list/card-art'
import { getArtDir } from '../config/ritual-config'
import type { CardMutationChange } from '../list/list-mutate'
import { applyTargetedChanges, type TargetedMutateResult } from '../list/line-mutate'
import {
  addDryRunOption,
  addScriptingOptions,
  type DryRunOptions,
  addListTypeFlags,
  ensureLabelsSupported,
  parseCardIdFlag,
  parseConditionFlag,
  parseFinishFlag,
  parseLanguageFlag,
  parseSetFlag,
  tagsFlagParser,
  categoriesFlagParser,
  resolveListTypeFlag,
  type CardCommandResultBase,
} from '../cli/options'
import {
  classifyFileReadError,
  emitCardResult,
  emitWarnings,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from '../cli/output'
import { ExitCode, getErrorMessage, localizedCommandError } from '../util/errors'
import { t } from '../i18n/t'
import { describeEntry, type EntryRef } from '../list/entry-ref'
import {
  ensureFinishAvailable,
  ensureFinishAvailableForEntry,
  ensureLanguageAvailableForEntry,
  resolvePinnedPrinting,
  type FinishCheckSkip,
} from '../card/printing-pin'
import { resolveListSelection, resolveTarget } from './card-target'
import { exitCodeFor, runCommandAction } from '../cli/action'
import type { ListTypeFlags } from '../list/resolve-list'
import { VALID_CONDITIONS, VALID_FINISHES, type Finish } from '../card/finish-condition'
import type { ListType } from '../list/list-type'

/**
 * `--art none`: remove whatever custom art the card carries. Spelled as an
 * object rather than the `null` the admin route's body uses, because Commander
 * rewrites an argParser's `null` result to `''` before the action ever sees it.
 */
export type CardArtClear = { clear: true }

/** A `--art` value once parsed: the reference to record, or the `none` clear. */
export type CardArtUpdate = CardArtRef | CardArtClear

/** True when a parsed `--art` value asks for the card's art to be removed. */
function isCardArtClear(update: CardArtUpdate): update is CardArtClear {
  return 'clear' in update
}

/**
 * The `--categories` option key as Commander leaves it: the parsed list, or the
 * literal `false` its `--no-categories` negation writes into the same key.
 * Commander only defaults a `--no-x` flag to `true` when the positive flag is
 * *not* also declared, so an absent flag stays `undefined` and the negation is
 * the only source of `false`.
 */
type CategoriesFlagValue = CardCategory[] | false

type SetCardOptions = {
  cardId?: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: ConditionUpdate
  /** The new language; `en` clears the token (a bare line means English). */
  language?: CardLanguage
  /** The new label override; an empty array (`--label none`) clears it. */
  label?: CardLabel[]
  /** Tags to put on the line (`--tag`), canonical. */
  tag?: CardTag[]
  /** Tags to take off the line (`--untag`), canonical. */
  untag?: CardTag[]
  /**
   * The card's new categories in this list, canonical and primary first;
   * `false` when `--no-categories` cleared them.
   */
  categories?: CategoriesFlagValue
  /** The new custom art; a clear for `--art none`. */
  art?: CardArtUpdate
  section?: string
  /** true = --commander, false = --no-commander, undefined = neither. */
  commander?: boolean
} & ListTypeFlags &
  DryRunOptions &
  Partial<ScriptingOptions>

/**
 * Commander argParser for `--label`: a comma-separated label set (`sale,trade`,
 * `keep`), or `none` to clear the override — mapped to the empty array the
 * set-label event uses as its clear.
 */
export function parseLabelFlag(value: string): CardLabel[] {
  if (value.trim().toLowerCase() === 'none') return []
  const parsed = parseCardLabelsToken(value)
  if (!parsed.ok) {
    throw new InvalidArgumentError(t('cli.setCard.labelWithNone', { reason: parsed.message }))
  }
  return parsed.labels
}

/**
 * Commander argParser for `--art`: `none` to clear the card's custom art, an
 * http(s) URL kept verbatim, or an image path relative to the configured art
 * directory. Whether that path exists is checked later, against the art
 * directory the run resolves.
 */
export function parseArtFlag(value: string): CardArtUpdate {
  if (value.trim().toLowerCase() === 'none') return { clear: true }
  const ref = parseCardArtInput(value)
  if (isCardArtRefError(ref)) {
    throw new InvalidArgumentError(t('cli.setCard.artInvalid', { reason: ref.error }))
  }
  return ref
}

export function registerSetCardCommand(program: Command): void {
  const command = addScriptingOptions(
    addListTypeFlags(
      program
        .command('set-card')
        .description(t('help.setCard.description'))
        .argument('[listName]', t('help.listArg.crossType'))
        .argument('[cardName...]', t('help.setCard.cardName')),
    )
      .option('--card-id <id>', t('help.cardId.disambiguate'))
      .option('--set <code>', t('help.setCard.set'), parseSetFlag)
      .option('--collector-number <cn>', t('help.setCard.collectorNumber'))
      .option(
        '--finish <finish>',
        t('help.setCard.finish', { finishes: VALID_FINISHES.join(', ') }),
        parseFinishFlag,
      )
      .option('--language <code>', t('help.setCard.language'), (value: string) =>
        parseLanguageFlag(value, t('cli.setCard.languageFlagHint')),
      )
      .option(
        '--condition <condition>',
        t('help.setCard.condition', { choices: VALID_CONDITIONS.join(', ') }),
        parseConditionFlag,
      )
      .option('--label <labels>', t('help.setCard.label'), parseLabelFlag)
      .option('--tag <tags>', t('help.setCard.tag'), tagsFlagParser('--tag'))
      .option('--untag <tags>', t('help.setCard.untag'), tagsFlagParser('--untag'))
      .option(
        '--categories <categories>',
        t('help.setCard.categories'),
        categoriesFlagParser('--categories'),
      )
      .option('--no-categories', t('help.setCard.noCategories'))
      .option('--art <value>', t('help.setCard.art'), parseArtFlag)
      .option('--section <name>', t('help.setCard.section'))
      .option('--commander', t('help.setCard.commander'))
      .option('--no-commander', t('help.setCard.noCommander')),
    'text',
  )
  addDryRunOption(command, t('help.setCard.dryRun'))
  command.action(
    async (listNameArg: string | undefined, cardNameParts: string[], options: SetCardOptions) => {
      const scripting = normalizeScriptingOptions(options, 'text')
      const type = resolveListTypeFlag(options, scripting)
      if (type === 'conflict') return
      await runCommandAction(scripting, () =>
        runSetCard(
          {
            type,
            listName: listNameArg,
            cardName: cardNameParts.join(' ').trim() || undefined,
            cardId: options.cardId,
            set: options.set,
            collectorNumber: options.collectorNumber,
            finish: options.finish,
            condition: options.condition,
            language: options.language,
            label: options.label,
            tag: options.tag,
            untag: options.untag,
            categories: options.categories === false ? [] : options.categories,
            art: options.art,
            section: options.section,
            commander: options.commander,
            dryRun: options.dryRun ?? false,
          },
          scripting,
        ),
      )
    },
  )
}

type RunInput = {
  type: ListType | undefined
  listName: string | undefined
  cardName: string | undefined
  cardId: string | undefined
  /** Lowercased set code (internal representation). */
  set: string | undefined
  collectorNumber: string | undefined
  finish: Finish | undefined
  /** A grade, or `'NONE'` to clear the recorded grade. */
  condition: ConditionUpdate | undefined
  /** The new language; `en` clears the token. */
  language: CardLanguage | undefined
  /** The new label override; an empty array clears it. */
  label: CardLabel[] | undefined
  /** Tags to put on the line, canonical; never empty when given. */
  tag: CardTag[] | undefined
  /** Tags to take off the line, canonical; never empty when given. */
  untag: CardTag[] | undefined
  /**
   * The card's new categories in this list, primary first; an empty array
   * clears them (what `--no-categories` normalizes to).
   */
  categories: CardCategory[] | undefined
  /** The new custom art; a clear removes it. */
  art: CardArtUpdate | undefined
  section: string | undefined
  commander: boolean | undefined
  dryRun: boolean
}

type SetCardResult = CardCommandResultBase & {
  applied: string[]
  /**
   * Absolute paths this run wrote: the list file and its `.sha256`, the
   * changelog, and any sidecar (`.categories.json` + its hash, `.art.json`).
   * Deduplicated, and empty on a dry run.
   */
  writtenFiles: string[]
}

/**
 * How an applied condition reads in the success output. `NONE` clears the grade,
 * and `NM` is the *unrecorded* default the serializer omits — so neither may be
 * reported as a grade now recorded on the line.
 */
function describeConditionUpdate(condition: ConditionUpdate): string {
  if (condition === 'NONE') return t('cli.setCard.conditionCleared')
  if (condition === 'NM') return t('cli.setCard.conditionDefault')
  return t('cli.setCard.conditionSet', { condition })
}

/**
 * How an applied language reads in the success output. `en` clears the token —
 * a bare line is English — so it must not read as a token now on the line.
 */
function describeLanguageUpdate(language: CardLanguage): string {
  if (language === 'en') return t('cli.setCard.languageCleared')
  return t('cli.setCard.languageSet', {
    code: language,
    language: languageDisplayName(language),
  })
}

/**
 * Why a `--finish` could not be checked against the entry's own printing. The
 * two skip reasons need different advice: a cache miss is fixable by preloading,
 * while a printing the cache does not know is a fact about the entry — no amount
 * of preloading will make `ZZZ:999` a printing of the card.
 */
function describeSkippedFinishCheck(
  finish: Finish,
  target: EntryRef,
  reason: FinishCheckSkip,
): string {
  const entry = describeEntry(target)
  if (reason === 'printing-unknown') {
    return t('cli.setCard.finishCheckUnknownPrinting', {
      finish,
      entry,
      printing: `${target.set?.toUpperCase()}:${target.collectorNumber}`,
      name: target.name,
    })
  }
  return t('cli.setCard.finishCheckCacheMiss', { finish, entry })
}

/**
 * Reject a `--art` file reference with nothing behind it. The resolved path is
 * part of the message: the flag value is art-dir-relative, so without it the
 * user cannot tell which directory was searched.
 */
async function ensureArtFileExists(ref: CardArtFileRef): Promise<void> {
  const artDir = getArtDir()
  const filePath = cardArtFilePath(artDir, ref)
  let stats: Stats
  try {
    stats = await fs.stat(filePath)
  } catch (err) {
    const { errorCode } = classifyFileReadError(err)
    const exitCode = exitCodeFor(errorCode)
    throw errorCode === 'not_found'
      ? localizedCommandError(errorCode, exitCode, 'cli.setCard.artFileMissing', {
          path: filePath,
          dir: artDir,
        })
      : localizedCommandError(errorCode, exitCode, 'cli.setCard.artFileUnreadable', {
          path: filePath,
          reason: getErrorMessage(err),
        })
  }
  if (!stats.isFile()) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.setCard.artNotAFile', {
      path: filePath,
    })
  }
}

/** The custom-art write a run performs, once the target's `&N` id is known. */
type ArtWrite = {
  cardId: number
  art: CardArtUpdate
}

/**
 * The `&N` id `--art` will be filed under. Custom art is keyed by card id, so a
 * line that carries none cannot hold any — every command that writes card lines
 * backfills ids first, so this only fires on a target resolved from a file the
 * backfill did not touch.
 */
function resolveArtWrite(target: EntryRef, art: CardArtUpdate): ArtWrite {
  if (target.cardId === undefined) {
    throw localizedCommandError('runtime_error', ExitCode.RuntimeError, 'cli.setCard.artNeedsId', {
      entry: describeEntry(target),
    })
  }
  return { cardId: target.cardId, art }
}

/**
 * Record (or clear) one card's custom art in the list's `.art.json` sidecar.
 * Art is list metadata like the primer: written straight to the sidecar, with
 * no change event and no changelog entry.
 */
async function writeCardArt(filePath: string, write: ArtWrite): Promise<string[]> {
  const loaded = await loadCardArt(filePath)
  if (!loaded.ok) {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.setCard.artSidecarUnreadable',
      { reason: loaded.message },
    )
  }
  if (isCardArtClear(write.art)) loaded.art.delete(write.cardId)
  else loaded.art.set(write.cardId, write.art)
  const saved = await saveCardArt(filePath, loaded.art)
  // `absent` means there was nothing to remove: no path was touched, and
  // reporting one would hand an auto-commit a `git add` of a missing file.
  return saved.action === 'written' || saved.action === 'removed' ? [saved.path] : []
}

/** How an applied `--art` reads in the success output. */
function describeArtUpdate(art: CardArtUpdate): string {
  if (isCardArtClear(art)) return t('cli.setCard.artCleared')
  return t('cli.setCard.appliedArt', { art: 'file' in art ? art.file : art.url })
}

async function runSetCard(input: RunInput, scripting: ScriptingOptions): Promise<void> {
  const cardId = input.cardId !== undefined ? parseCardIdFlag(input.cardId) : undefined

  if ((input.set !== undefined) !== (input.collectorNumber !== undefined)) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.cardOps.pinNeedsBoth')
  }
  const hasMutation =
    input.set !== undefined ||
    input.finish !== undefined ||
    input.condition !== undefined ||
    input.language !== undefined ||
    input.label !== undefined ||
    input.tag !== undefined ||
    input.untag !== undefined ||
    input.categories !== undefined ||
    input.art !== undefined ||
    input.section !== undefined ||
    input.commander !== undefined
  if (!hasMutation) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.setCard.noChangeGiven')
  }
  if (input.tag !== undefined && input.untag !== undefined) {
    const untag = new Set(input.untag)
    const bothWays = input.tag.filter((tag) => untag.has(tag))
    if (bothWays.length > 0) {
      throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.setCard.tagBothWays', {
        tags: formatCardTags(bothWays),
      })
    }
  }

  const { type, filePath } = await resolveListSelection(input.listName, input.type)
  const listSlug = path.basename(filePath, '.md')

  if (type === 'wanted' && input.condition !== undefined) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.cardOps.wantedNoCondition')
  }
  if (type !== 'deck' && input.section !== undefined) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.setCard.sectionDecksOnly')
  }
  if (input.label !== undefined) ensureLabelsSupported(type, input.label)
  // Checked before the target is resolved: a path with no image behind it is
  // the user's mistake whichever card they meant.
  if (input.art !== undefined && 'file' in input.art) {
    await ensureArtFileExists(input.art)
  }
  if (type !== 'deck' && input.commander !== undefined) {
    throw localizedCommandError(
      'usage_error',
      ExitCode.UsageError,
      'cli.setCard.commanderDecksOnly',
    )
  }

  const target = await resolveTarget(type, filePath, { cardId, cardName: input.cardName })
  const artWrite = input.art !== undefined ? resolveArtWrite(target, input.art) : undefined

  // A finish is validated on every branch that records one — against the pinned
  // printing when the command pins one, otherwise against the printing the entry
  // already carries. Only a printing-less line (a bare deck entry) goes
  // unvalidated, because there is nothing to validate against.
  if (input.set !== undefined && input.collectorNumber !== undefined) {
    const printing = await resolvePinnedPrinting(target.name, {
      set: input.set,
      collectorNumber: input.collectorNumber,
    })
    // The finish the entry ends up with is validated whether it was passed or
    // carried over: repinning a `[foil]` entry to a nonfoil-only printing would
    // otherwise record a finish that printing is not offered in.
    const effectiveFinish = input.finish ?? target.finish
    if (effectiveFinish !== undefined) {
      ensureFinishAvailable(target.name, printing, effectiveFinish, input.finish === undefined)
    }
  } else if (input.finish !== undefined) {
    const check = await ensureFinishAvailableForEntry(target.name, target, input.finish)
    if (!check.checked && check.reason !== 'no-printing') {
      emitWarnings([describeSkippedFinishCheck(input.finish, target, check.reason)], scripting)
    }
  }

  // A non-en language is validated against the printing the entry ends up with:
  // the new pin when the command repins, otherwise the entry's own printing.
  // `en` needs no check (it clears the token), and a positive "Scryfall has no
  // such object" refuses; an unverifiable claim proceeds with a warning.
  if (input.language !== undefined && input.language !== 'en') {
    const printingForLanguage: PrintingFields =
      input.set !== undefined && input.collectorNumber !== undefined
        ? { set: input.set, collectorNumber: input.collectorNumber }
        : { set: target.set, collectorNumber: target.collectorNumber }
    const check = await ensureLanguageAvailableForEntry(
      target.name,
      printingForLanguage,
      input.language,
    )
    if (!check.checked && check.reason === 'verify-failed') {
      emitWarnings(
        [
          t('cli.setCard.languageUnverified', {
            printing: `${printingForLanguage.set?.toUpperCase()}:${printingForLanguage.collectorNumber}`,
            language: languageDisplayName(input.language),
            code: input.language,
            detail:
              check.detail !== undefined
                ? t('cli.setCard.reasonSuffix', { reason: check.detail })
                : '',
          }),
        ],
        scripting,
      )
    }
  }

  const changes: CardMutationChange[] = []
  const applied: string[] = []

  if (input.set !== undefined && input.collectorNumber !== undefined) {
    // A finish given alongside the printing folds into the same set-printing
    // event. When --finish is absent we must still carry the target's current
    // finish: the deck and wanted engines assign `finish = change.finish`
    // verbatim, so an undefined finish would silently clear it.
    changes.push(
      createSetPrintingChange(target.name, {
        set: input.set,
        collectorNumber: input.collectorNumber,
        finish: input.finish ?? target.finish,
        condition: input.condition,
        cardId: target.cardId,
      }),
    )
    applied.push(
      t('cli.setCard.appliedPrinting', {
        printing: `${input.set.toUpperCase()}:${input.collectorNumber}`,
      }),
    )
    if (input.finish !== undefined) {
      applied.push(t('cli.setCard.appliedFinish', { finish: input.finish }))
    }
    if (input.condition !== undefined) applied.push(describeConditionUpdate(input.condition))
  } else if (input.condition !== undefined) {
    // There is no standalone set-condition event; a set-printing carrying the
    // target's current printing updates the condition while leaving the rest
    // in place (the engines only touch condition when it is defined).
    changes.push(
      createSetPrintingChange(target.name, {
        set: target.set,
        collectorNumber: target.collectorNumber,
        finish: input.finish ?? target.finish,
        condition: input.condition,
        cardId: target.cardId,
      }),
    )
    applied.push(describeConditionUpdate(input.condition))
    if (input.finish !== undefined) {
      applied.push(t('cli.setCard.appliedFinish', { finish: input.finish }))
    }
  } else if (input.finish !== undefined) {
    changes.push(
      createSetFinishChange(target.name, { finish: input.finish, cardId: target.cardId }),
    )
    applied.push(t('cli.setCard.appliedFinish', { finish: input.finish }))
  }

  if (input.language !== undefined) {
    // Always its own set-language event, even alongside a --set/--collector-number
    // repin: the targeted apply engine's set-printing deliberately leaves the
    // line's language token alone, so folding the language into it would drop
    // the change — and a dedicated event keeps the changelog line explicit.
    changes.push(
      createSetLanguageChange(target.name, { language: input.language, cardId: target.cardId }),
    )
    applied.push(describeLanguageUpdate(input.language))
  }

  if (input.label !== undefined) {
    changes.push(createSetLabelChange(target.name, { labels: input.label, cardId: target.cardId }))
    applied.push(
      input.label.length === 0
        ? t('cli.setCard.labelCleared')
        : t('cli.setCard.appliedLabel', { labels: input.label.join(', ') }),
    )
  }

  // Tags are recorded one event per tag that actually changes — a tag the line
  // already carries (or already lacks) is not a change, and logging it would
  // put an `Added tag` in the changelog that the history then cannot balance.
  // Normalized at the compare: `CardTag` is a plain string alias, so the rule
  // that both sides are canonical is enforced here, where the domain owns it.
  const currentTags = new Set(normalizeCardTags(target.tags ?? []))
  if (input.tag !== undefined) {
    const added = input.tag.filter((tag) => !currentTags.has(tag))
    for (const tag of added) {
      changes.push(createAddTagChange(target.name, { tag, cardId: target.cardId }))
    }
    applied.push(
      added.length > 0
        ? t('cli.setCard.appliedTagsAdded', { tags: formatCardTags(added) })
        : t('cli.setCard.tagsAlreadyPresent', { tags: formatCardTags(input.tag) }),
    )
  }
  if (input.untag !== undefined) {
    const removed = input.untag.filter((tag) => currentTags.has(tag))
    for (const tag of removed) {
      changes.push(createRemoveTagChange(target.name, { tag, cardId: target.cardId }))
    }
    applied.push(
      removed.length > 0
        ? t('cli.setCard.appliedTagsRemoved', { tags: formatCardTags(removed) })
        : t('cli.setCard.tagsAlreadyAbsent', { tags: formatCardTags(input.untag) }),
    )
  }
  if (input.categories !== undefined) {
    // Two invariants this event does not share with the ones above. It carries
    // no `cardId`: categories belong to the card NAME in this list, so
    // `line-mutate`'s stamping loop (guarded on `'cardId' in change`) leaves it
    // alone and the write lands in the `.categories.json` sidecar, not the line.
    // And it is a whole-list replacement — `set-categories` is latest-wins, so
    // it is recorded even when the new list equals the old, the sidecar write
    // being idempotent either way.
    changes.push(createSetCategoriesChange(target.name, input.categories))
    applied.push(
      input.categories.length === 0
        ? t('cli.setCard.categoriesCleared')
        : t('cli.setCard.appliedCategories', {
            categories: formatCardCategories(input.categories),
          }),
    )
  }
  if (input.art !== undefined) applied.push(describeArtUpdate(input.art))
  if (input.section !== undefined) {
    changes.push(createSetSectionChange(target.name, input.section, target.cardId))
    applied.push(t('cli.setCard.appliedSection', { section: input.section }))
  }
  if (input.commander === true) {
    changes.push(createSetCommanderChange(target.name, { cardId: target.cardId }))
    applied.push(t('cli.setCard.appliedCommander'))
  } else if (input.commander === false) {
    changes.push(createUnsetCommanderChange(target.name, { cardId: target.cardId }))
    applied.push(t('cli.setCard.appliedNotCommander'))
  }

  // A dry run resolves the list, the target, and every validation above, then
  // stops before the first write: no list file, no changelog, no sidecar. It
  // still *runs* the apply and throws the result away, because some refusals
  // (a foil finish on a line that names no printing) live in the apply itself —
  // a preview that skipped it would report an edit the real run rejects.
  // `--art` alone leaves no line change to apply, and an empty batch would
  // still rewrite the list file and open a changelog entry for nothing.
  const mutation: TargetedMutateResult =
    changes.length > 0
      ? await applyTargetedChanges(type, filePath, target, changes, { dryRun: input.dryRun })
      : { writtenFiles: [] }
  const artFiles =
    !input.dryRun && artWrite !== undefined ? await writeCardArt(filePath, artWrite) : []

  const result: SetCardResult = {
    type,
    list: listSlug,
    cardName: target.name,
    cardId: target.cardId,
    applied,
    writtenFiles: [...new Set([...mutation.writtenFiles, ...artFiles])],
  }
  const line = t('cli.setCard.updated', {
    mode: input.dryRun ? 'preview' : 'done',
    entry: describeEntry(target),
    list: listSlug,
    changes: applied.join(', '),
  })
  emitCardResult(result, line, scripting, input.dryRun)
}
