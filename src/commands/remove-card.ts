import { Command, InvalidArgumentError } from 'commander'
import path from 'node:path'
import { createRemoveChange } from '../change-event'
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
  listTypeLabel,
  parseCardIdFlag,
  resolveListSelection,
  resolveListTypeFlag,
  resolveTarget,
  runCommandAction,
  type CardCommandResultBase,
} from './card-target'
import { parsePositiveInteger } from '../parse-number'
import { type ListTypeFlags } from '../resolve-list'
import type { ListType } from '../list-type'

type RemoveCardOptions = {
  cardId?: string
  quantity?: number
  allCopies?: boolean
} & ListTypeFlags &
  Partial<ScriptingOptions>

/** Commander argParser for `-q/--quantity`: positive integers only. */
function parseQuantityFlag(value: string): number {
  const parsed = parsePositiveInteger(value)
  if (parsed === undefined) {
    throw new InvalidArgumentError(`--quantity must be a positive integer (got '${value}').`)
  }
  return parsed
}

export function registerRemoveCardCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('remove-card')
      .description('Remove a card from a deck, collection, or wanted list')
      .argument(
        '[listName]',
        'Name of the deck, collection, or wanted list (resolved across all types unless a type flag is given)',
      )
      .argument('[cardName...]', 'Name of the card to remove (fuzzy match)')
      .option('--deck', 'Resolve the name as a deck')
      .option('--collection', 'Resolve the name as a collection')
      .option('--wanted', 'Resolve the name as a wanted list')
      .option('--card-id <id>', 'Disambiguate by card ID (the &N suffix in list files)')
      .option('-q, --quantity <n>', 'Number of copies to remove (decks only)', parseQuantityFlag)
      .option('--all-copies', "Remove every copy on the card's line (decks only)", false),
    'text',
  ).action(
    async (
      listNameArg: string | undefined,
      cardNameParts: string[],
      options: RemoveCardOptions,
    ) => {
      const scripting = normalizeScriptingOptions(options, 'text')
      const type = resolveListTypeFlag(options, scripting)
      if (type === 'conflict') return
      await runCommandAction(scripting, () =>
        runRemoveCard(
          {
            type,
            listName: listNameArg,
            cardName: cardNameParts.join(' ').trim() || undefined,
            cardId: options.cardId,
            quantity: options.quantity,
            allCopies: options.allCopies ?? false,
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
  quantity: number | undefined
  allCopies: boolean
}

type RemoveCardResult = CardCommandResultBase & {
  removed: number
  remaining: number
}

async function runRemoveCard(input: RunInput, scripting: ScriptingOptions): Promise<void> {
  const cardId = input.cardId !== undefined ? parseCardIdFlag(input.cardId) : undefined

  if (input.quantity !== undefined && input.allCopies) {
    throw new CardCommandError(
      'usage_error',
      '--quantity and --all-copies are mutually exclusive.',
      ExitCode.UsageError,
    )
  }

  const { type, filePath } = await resolveListSelection(input.listName, input.type)
  const listSlug = path.basename(filePath, '.md')

  if (type !== 'deck') {
    const noun = listTypeLabel(type).toLowerCase()
    if (input.allCopies) {
      throw new CardCommandError(
        'usage_error',
        `--all-copies only applies to decks — each ${noun} entry is one physical card. Remove other copies individually (disambiguate with --card-id).`,
        ExitCode.UsageError,
      )
    }
    if (input.quantity !== undefined && input.quantity > 1) {
      throw new CardCommandError(
        'usage_error',
        `--quantity only applies to decks — each ${noun} entry is one physical card. Remove other copies individually (disambiguate with --card-id).`,
        ExitCode.UsageError,
      )
    }
  }

  const target = await resolveTarget(type, filePath, { cardId, cardName: input.cardName })

  // Flat-list entries are one physical card each; only deck lines carry a quantity.
  let copies = 1
  let remaining = 0
  if (type === 'deck') {
    const lineQuantity = target.quantity ?? 1
    copies = input.allCopies ? lineQuantity : (input.quantity ?? 1)
    if (copies > lineQuantity) {
      throw new CardCommandError(
        'usage_error',
        `Cannot remove ${copies} copies of '${target.name}' — the deck has ${lineQuantity}.`,
        ExitCode.UsageError,
        { quantity: lineQuantity },
      )
    }
    remaining = lineQuantity - copies
  }

  // One remove event per copy: the deck engine decrements quantity per event and
  // drops the line at zero; flat-list engines remove the single matching entry.
  const changes: CardMutationChange[] = []
  for (let i = 0; i < copies; i++) {
    changes.push(
      createRemoveChange(target.name, {
        set: target.set,
        collectorNumber: target.collectorNumber,
        finish: target.finish,
        condition: target.condition,
        cardId: target.cardId,
      }),
    )
  }
  await applyChangesToListFile(type, filePath, changes)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      emitOutput(
        `Removed ${copies} x ${describeEntry(target)} from ${listSlug} (${remaining} remaining)`,
        scripting,
      )
    }
    return
  }

  const result: RemoveCardResult = {
    type,
    list: listSlug,
    cardName: target.name,
    cardId: target.cardId,
    removed: copies,
    remaining,
  }
  emitOutput(result, scripting)
}
