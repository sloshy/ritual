import { Command } from 'commander'
import path from 'node:path'
import { createRemoveChange, printingOptionsFrom } from '../changes/change-event'
import type { CardMutationChange } from '../list/list-mutate'
import { applyTargetedChanges } from '../list/line-mutate'
import {
  addDryRunOption,
  addScriptingOptions,
  type DryRunOptions,
  addListTypeFlags,
  parseCardIdFlag,
  resolveListTypeFlag,
  type CardCommandResultBase,
  parseQuantityFlag,
} from '../cli/options'
import { emitCardResult, normalizeScriptingOptions, type ScriptingOptions } from '../cli/output'
import { ExitCode, CardCommandError, localizedCommandError } from '../util/errors'
import { t, type MessageParams } from '../i18n/t'
import { describeEntry } from '../list/entry-ref'
import { resolveListSelection, resolveTarget } from './card-target'
import { runCommandAction } from '../cli/action'
import type { ListTypeFlags } from '../list/resolve-list'
import type { ListType } from '../list/list-type'

type RemoveCardOptions = {
  cardId?: string
  quantity?: number
  allCopies?: boolean
} & ListTypeFlags &
  DryRunOptions &
  Partial<ScriptingOptions>

export function registerRemoveCardCommand(program: Command): void {
  const command = addScriptingOptions(
    addListTypeFlags(
      program
        .command('remove-card')
        .description(t('help.removeCard.description'))
        .argument('[listName]', t('help.listArg.crossType'))
        .argument('[cardName...]', t('help.removeCard.cardName')),
    )
      .option('--card-id <id>', t('help.cardId.disambiguate'))
      .option('-q, --quantity <n>', t('help.removeCard.quantity'), parseQuantityFlag)
      .option('--all-copies', t('help.removeCard.allCopies'), false),
    'text',
  )
  addDryRunOption(command, t('help.removeCard.dryRun'))
  command.action(
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
  quantity: number | undefined
  allCopies: boolean
  dryRun: boolean
}

type RemoveCardResult = CardCommandResultBase & {
  removed: number
  remaining: number
}

async function runRemoveCard(input: RunInput, scripting: ScriptingOptions): Promise<void> {
  const cardId = input.cardId !== undefined ? parseCardIdFlag(input.cardId) : undefined

  if (input.quantity !== undefined && input.allCopies) {
    throw localizedCommandError(
      'usage_error',
      ExitCode.UsageError,
      'cli.removeCard.quantityAllCopiesExclusive',
    )
  }

  const { type, filePath } = await resolveListSelection(input.listName, input.type)
  const listSlug = path.basename(filePath, '.md')

  if (type !== 'deck') {
    // One sentence per list type: the noun it names is gendered in most target
    // languages, so it cannot be spliced into a shared frame.
    if (input.allCopies) {
      throw localizedCommandError(
        'usage_error',
        ExitCode.UsageError,
        'cli.removeCard.allCopiesDeckOnly',
        { type },
      )
    }
    if (input.quantity !== undefined && input.quantity > 1) {
      throw localizedCommandError(
        'usage_error',
        ExitCode.UsageError,
        'cli.removeCard.quantityDeckOnly',
        { type },
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
      const params: MessageParams<'cli.removeCard.tooManyCopies'> = {
        count: copies,
        name: target.name,
        available: lineQuantity,
      }
      throw new CardCommandError(
        'usage_error',
        t('cli.removeCard.tooManyCopies', params),
        ExitCode.UsageError,
        { quantity: lineQuantity },
        { key: 'cli.removeCard.tooManyCopies', params },
      )
    }
    remaining = lineQuantity - copies
  }

  // One remove event per copy: the deck engine decrements quantity per event and
  // drops the line at zero; flat-list engines remove the single matching entry.
  const changes: CardMutationChange[] = []
  for (let i = 0; i < copies; i++) {
    changes.push(createRemoveChange(target.name, printingOptionsFrom(target)))
  }
  // A dry run resolves the list, the target, and every validation above, then
  // stops before the first write: no list file, no changelog, no sidecar.
  if (!input.dryRun) await applyTargetedChanges(type, filePath, target, changes)

  const result: RemoveCardResult = {
    type,
    list: listSlug,
    cardName: target.name,
    cardId: target.cardId,
    removed: copies,
    remaining,
  }
  const line = t('cli.removeCard.removed', {
    mode: input.dryRun ? 'preview' : 'done',
    count: copies,
    entry: describeEntry(target),
    list: listSlug,
    remaining,
  })
  emitCardResult(result, line, scripting, input.dryRun)
}
