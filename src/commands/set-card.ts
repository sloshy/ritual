import { Command, InvalidArgumentError } from 'commander'
import path from 'node:path'
import {
  createSetCommanderChange,
  createSetFinishChange,
  createSetPrintingChange,
  createSetSectionChange,
  createUnsetCommanderChange,
} from '../change-event'
import { applyChangesToListFile, type CardMutationChange } from '../list-mutate'
import {
  addScriptingOptions,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'
import { CardCommandError } from '../errors'
import {
  describeEntry,
  ensureFinishAvailable,
  parseCardIdFlag,
  resolveListSelection,
  resolveListTypeFlag,
  resolvePinnedPrinting,
  resolveTarget,
  runCommandAction,
  type CardCommandResultBase,
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
import type { Condition, Finish } from '../types'

type SetCardOptions = {
  cardId?: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  section?: string
  /** true = --commander, false = --no-commander, undefined = neither. */
  commander?: boolean
} & ListTypeFlags &
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

/** Commander argParser for `--condition`: one of the valid conditions (case-insensitive). */
function parseConditionFlag(value: string): Condition {
  const normalized = value.toUpperCase()
  if (!isCondition(normalized)) {
    throw new InvalidArgumentError(
      `Invalid condition '${value}'. Use one of: ${VALID_CONDITIONS.join(', ')}.`,
    )
  }
  return normalized
}

export function registerSetCardCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('set-card')
      .description(
        "Update a card's printing, finish, condition, section, or commander status in place",
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
        '--condition <condition>',
        `New condition: ${VALID_CONDITIONS.join(', ')} (decks and collections only)`,
        parseConditionFlag,
      )
      .option('--section <name>', 'Move the card to this section, created if missing (decks only)')
      .option('--commander', 'Move the card to the Commander section (decks only)')
      .option('--no-commander', 'Move the card out of the Commander section (decks only)'),
    'text',
  ).action(
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
            section: options.section,
            commander: options.commander,
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
  condition: Condition | undefined
  section: string | undefined
  commander: boolean | undefined
}

type SetCardResult = CardCommandResultBase & {
  applied: string[]
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
    input.section !== undefined ||
    input.commander !== undefined
  if (!hasMutation) {
    throw new CardCommandError(
      'usage_error',
      'Specify at least one change: --set/--collector-number, --finish, --condition, --section, --commander, or --no-commander.',
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
  if (type !== 'deck' && input.commander !== undefined) {
    throw new CardCommandError(
      'usage_error',
      '--commander/--no-commander only apply to decks.',
      ExitCode.UsageError,
    )
  }

  const target = await resolveTarget(type, filePath, { cardId, cardName: input.cardName })

  if (input.set !== undefined && input.collectorNumber !== undefined) {
    const printing = await resolvePinnedPrinting(target.name, {
      set: input.set,
      collectorNumber: input.collectorNumber,
    })
    if (input.finish !== undefined) ensureFinishAvailable(target.name, printing, input.finish)
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
    if (input.condition !== undefined) applied.push(`condition → ${input.condition}`)
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
    applied.push(`condition → ${input.condition}`)
    if (input.finish !== undefined) applied.push(`finish → ${input.finish}`)
  } else if (input.finish !== undefined) {
    changes.push(
      createSetFinishChange(target.name, { finish: input.finish, cardId: target.cardId }),
    )
    applied.push(`finish → ${input.finish}`)
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

  await applyChangesToListFile(type, filePath, changes)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      emitOutput(
        `Updated ${describeEntry(target)} in ${listSlug}: ${applied.join(', ')}`,
        scripting,
      )
    }
    return
  }

  const result: SetCardResult = {
    type,
    list: listSlug,
    cardName: target.name,
    cardId: target.cardId,
    applied,
  }
  emitOutput(result, scripting)
}
