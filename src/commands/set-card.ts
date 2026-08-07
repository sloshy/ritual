import { Command, InvalidArgumentError } from 'commander'
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
} from '../change-event'
import { languageDisplayName, type CardLanguage } from '../card-language'
import type { PrintingFields } from '../card-printing'
import { parseCardLabelsToken, type CardLabel } from '../card-labels'
import type { CardMutationChange } from '../list-mutate'
import { applyTargetedChanges } from './line-mutate'
import {
  addDryRunOption,
  addScriptingOptions,
  emitOutput,
  emitWarnings,
  ExitCode,
  normalizeScriptingOptions,
  type DryRunOptions,
  type ScriptingOptions,
} from './scripting'
import { CardCommandError } from '../errors'
import {
  describeEntry,
  ensureFinishAvailable,
  ensureFinishAvailableForEntry,
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
import { type ListTypeFlags } from '../resolve-list'
import {
  isCondition,
  isFinish,
  normalizeFinishValue,
  VALID_CONDITIONS,
  VALID_FINISHES,
} from '../finish-condition'
import { parseSetCode } from '../set-codes'
import type { ListType } from '../list-type'
import type { Finish } from '../types'

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
      `Invalid condition '${value}'. Use one of: ${VALID_CONDITIONS.join(', ')}, or NONE to clear the recorded condition.`,
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
    throw new InvalidArgumentError(`${parsed.message} Or pass 'none' to clear the override.`)
  }
  return parsed.labels
}

export function registerSetCardCommand(program: Command): void {
  const command = addScriptingOptions(
    program
      .command('set-card')
      .description(
        "Update a card's printing, finish, condition, label, section, or commander status in place",
      )
      .argument(
        '[listName]',
        'Name of the deck, collection, or wanted list (resolved across all types unless a type flag is given)',
      )
      .argument('[cardName...]', 'Name of the card to update (fuzzy match)')
      .option('--deck', 'Resolve the name as a deck')
      .option('--collection', 'Resolve the name as a collection')
      .option('--wanted', 'Resolve the name as a wanted list')
      .option('--card-id <id>', 'Disambiguate by card ID (the &N suffix in list files)')
      .option('--set <code>', 'New set code — requires --collector-number', parseSetFlag)
      .option('--collector-number <cn>', 'New collector number — requires --set')
      .option('--finish <finish>', `New finish: ${VALID_FINISHES.join(', ')}`, parseFinishFlag)
      .option(
        '--language <code>',
        'New language (e.g. ja); en clears the token — a bare line means English. Recorded as its own change, even alongside --set/--collector-number',
        (value: string) => parseLanguageFlag(value, '(en clears the token)'),
      )
      .option(
        '--condition <condition>',
        `New condition: ${VALID_CONDITIONS.join(', ')}, or NONE to clear it (decks and collections only)`,
        parseConditionFlag,
      )
      .option(
        '--label <labels>',
        'New label override: sale,trade (combinable), keep, or none to clear it (collections only)',
        parseLabelFlag,
      )
      .option('--section <name>', 'Move the card to this section, created if missing (decks only)')
      .option('--commander', 'Move the card to the Commander section (decks only)')
      .option('--no-commander', 'Move the card out of the Commander section (decks only)'),
    'text',
  )
  addDryRunOption(command, 'Report what would change without writing anything')
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
  if (condition === 'NONE') return 'condition → none (grade cleared)'
  if (condition === 'NM') return 'condition → NM (written as an ungraded line — NM is the default)'
  return `condition → ${condition}`
}

/**
 * How an applied language reads in the success output. `en` clears the token —
 * a bare line is English — so it must not read as a token now on the line.
 */
function describeLanguageUpdate(language: CardLanguage): string {
  if (language === 'en') {
    return 'language → en (token cleared — a bare line means English)'
  }
  return `language → ${language} (${languageDisplayName(language)})`
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
  const lead = `Note: could not verify finish '${finish}' for ${describeEntry(target)}`
  if (reason === 'printing-unknown') {
    return `${lead} — ${target.set?.toUpperCase()}:${target.collectorNumber} is not a known printing of '${target.name}'.`
  }
  return `${lead} — the card cache holds no complete printing list for it. Run 'ritual cache preload-all' to enable the check.`
}

async function runSetCard(input: RunInput, scripting: ScriptingOptions): Promise<void> {
  const cardId = input.cardId !== undefined ? parseCardIdFlag(input.cardId) : undefined

  if ((input.set !== undefined) !== (input.collectorNumber !== undefined)) {
    throw new CardCommandError(
      'usage_error',
      '--set and --collector-number must be given together.',
      ExitCode.UsageError,
    )
  }
  const hasMutation =
    input.set !== undefined ||
    input.finish !== undefined ||
    input.condition !== undefined ||
    input.language !== undefined ||
    input.label !== undefined ||
    input.section !== undefined ||
    input.commander !== undefined
  if (!hasMutation) {
    throw new CardCommandError(
      'usage_error',
      'Specify at least one change: --set/--collector-number, --finish, --condition, --language, --label, --section, --commander, or --no-commander.',
      ExitCode.UsageError,
    )
  }

  const { type, filePath } = await resolveListSelection(input.listName, input.type)
  const listSlug = path.basename(filePath, '.md')

  if (type === 'wanted' && input.condition !== undefined) {
    throw new CardCommandError(
      'usage_error',
      'Wanted list entries do not track condition — --condition applies to decks and collections only.',
      ExitCode.UsageError,
    )
  }
  if (type !== 'deck' && input.section !== undefined) {
    throw new CardCommandError(
      'usage_error',
      '--section only applies to decks.',
      ExitCode.UsageError,
    )
  }
  if (type !== 'collection' && input.label !== undefined) {
    throw new CardCommandError(
      'usage_error',
      '--label only applies to collections.',
      ExitCode.UsageError,
    )
  }
  if (type !== 'deck' && input.commander !== undefined) {
    throw new CardCommandError(
      'usage_error',
      '--commander/--no-commander only apply to decks.',
      ExitCode.UsageError,
    )
  }

  const target = await resolveTarget(type, filePath, { cardId, cardName: input.cardName })

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
          `Note: could not verify that ${printingForLanguage.set?.toUpperCase()}:${printingForLanguage.collectorNumber} exists in ${languageDisplayName(input.language)} (${input.language}) — Scryfall could not be reached${check.detail ? `: ${check.detail}` : ''}. Recording it as asserted.`,
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
    applied.push(`printing → ${input.set.toUpperCase()}:${input.collectorNumber}`)
    if (input.finish !== undefined) applied.push(`finish → ${input.finish}`)
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
    if (input.finish !== undefined) applied.push(`finish → ${input.finish}`)
  } else if (input.finish !== undefined) {
    changes.push(
      createSetFinishChange(target.name, { finish: input.finish, cardId: target.cardId }),
    )
    applied.push(`finish → ${input.finish}`)
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
        ? 'label → none (list default)'
        : `label → ${input.label.join(', ')}`,
    )
  }
  if (input.section !== undefined) {
    changes.push(createSetSectionChange(target.name, input.section, target.cardId))
    applied.push(`section → ${input.section}`)
  }
  if (input.commander === true) {
    changes.push(createSetCommanderChange(target.name, { cardId: target.cardId }))
    applied.push('commander')
  } else if (input.commander === false) {
    changes.push(createUnsetCommanderChange(target.name, { cardId: target.cardId }))
    applied.push('not commander')
  }

  // A dry run resolves the list, the target, and every validation above, then
  // stops before the first write: no list file, no changelog, no sidecar.
  if (!input.dryRun) await applyTargetedChanges(type, filePath, target, changes)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      const prefix = input.dryRun ? '[dry-run] Would update' : 'Updated'
      emitOutput(
        `${prefix} ${describeEntry(target)} in ${listSlug}: ${applied.join(', ')}`,
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
