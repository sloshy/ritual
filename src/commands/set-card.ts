import { Command, InvalidArgumentError } from 'commander'
import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createSetCommanderChange,
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
import { applyTargetedChanges } from './line-mutate'
import {
  addDryRunOption,
  addScriptingOptions,
  classifyFileReadError,
  emitOutput,
  emitWarnings,
  ExitCode,
  normalizeScriptingOptions,
  type DryRunOptions,
  type ScriptingOptions,
} from './scripting'
import { getErrorMessage, localizedCommandError } from '../util/errors'
import { t } from '../i18n/t'
import {
  addListTypeFlags,
  describeEntry,
  ensureFinishAvailable,
  ensureFinishAvailableForEntry,
  ensureLabelsSupported,
  ensureLanguageAvailableForEntry,
  parseCardIdFlag,
  parseLanguageFlag,
  resolveListSelection,
  resolveListTypeFlag,
  resolvePinnedPrinting,
  resolveTarget,
  runCommandAction,
  type CardCommandResultBase,
  type EntryRef,
  type FinishCheckSkip,
} from './card-target'
import { type ListTypeFlags } from '../list/resolve-list'
import {
  isCondition,
  isFinish,
  normalizeFinishValue,
  VALID_CONDITIONS,
  VALID_FINISHES,
  type Finish,
} from '../card/finish-condition'
import { parseSetCode } from '../card/set-codes'
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
  /** The new custom art; a clear for `--art none`. */
  art?: CardArtUpdate
  section?: string
  /** true = --commander, false = --no-commander, undefined = neither. */
  commander?: boolean
} & ListTypeFlags &
  DryRunOptions &
  Partial<ScriptingOptions>

/** Commander argParser for `--finish`: one of the valid finishes (case-insensitive). */
function parseFinishFlag(value: string): Finish {
  const result = normalizeFinishValue(value)
  if (!isFinish(result)) {
    throw new InvalidArgumentError(result)
  }
  return result
}

/** Commander argParser for `--set`: a normalized (lowercase alphanumeric) set code. */
function parseSetFlag(value: string): string {
  const result = parseSetCode(value)
  if (!result.ok) {
    throw new InvalidArgumentError(result.error)
  }
  return result.code
}

/**
 * Commander argParser for `--condition`: one of the valid conditions
 * (case-insensitive), or `NONE` to clear a recorded grade — the same vocabulary
 * `add-card --condition` accepts.
 */
function parseConditionFlag(value: string): ConditionUpdate {
  const normalized = value.toUpperCase()
  if (normalized === 'NONE') return 'NONE'
  if (!isCondition(normalized)) {
    throw new InvalidArgumentError(
      t('cli.setCard.invalidCondition', { value, choices: VALID_CONDITIONS.join(', ') }),
    )
  }
  return normalized
}

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
  /** The new custom art; a clear removes it. */
  art: CardArtUpdate | undefined
  section: string | undefined
  commander: boolean | undefined
  dryRun: boolean
}

type SetCardResult = CardCommandResultBase & {
  applied: string[]
  /** Present and true when `--dry-run` reported the change without writing it. */
  dryRun?: true
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
    const { errorCode, exitCode } = classifyFileReadError(err)
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
async function writeCardArt(filePath: string, write: ArtWrite): Promise<void> {
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
  await saveCardArt(filePath, loaded.art)
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
    input.art !== undefined ||
    input.section !== undefined ||
    input.commander !== undefined
  if (!hasMutation) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.setCard.noChangeGiven')
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
  if (changes.length > 0) {
    await applyTargetedChanges(type, filePath, target, changes, { dryRun: input.dryRun })
  }
  if (!input.dryRun && artWrite !== undefined) await writeCardArt(filePath, artWrite)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      emitOutput(
        t('cli.setCard.updated', {
          mode: input.dryRun ? 'preview' : 'done',
          entry: describeEntry(target),
          list: listSlug,
          changes: applied.join(', '),
        }),
        scripting,
      )
    }
    return
  }

  const result: SetCardResult = {
    ...(input.dryRun ? { dryRun: true as const } : {}),
    type,
    list: listSlug,
    cardName: target.name,
    cardId: target.cardId,
    applied,
  }
  emitOutput(result, scripting)
}
