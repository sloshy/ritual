import { Command } from 'commander'
import prompts, { type Choice } from 'prompts'
import type { PromptState } from './prompts-types'
import { promptExitMenu } from './prompts-helpers'
import { resolveCardPrinting } from './collection-helpers'
import { listRefLabel, type ListRef } from '../change-event'
import type { ListEntry, MoveSessionConfig, PhysicalCard, VirtualCard } from './move-helpers'
import type { DroppedNote } from './move-io'
import {
  loadAllLists,
  loadPhysicalCards,
  buildVirtualState,
  applyVirtualMove,
  getPendingMoves,
  buildCardSearchChoices,
  commitAllMoves,
  getToggleState,
  toggleStateChar,
  toggleSetAll,
  finishLabel,
} from './move-helpers'
import {
  addScriptingOptions,
  emitOutput,
  emitResolveListError,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'
import { CardCommandError } from '../errors'
import {
  describeEntry,
  parseCardIdFlag,
  resolvePinnedPrinting,
  runCommandAction,
} from './card-target'
import { parsePositiveInteger } from '../parse-number'
import { requireInteractive } from '../no-input'
import { isResolveListError, parseListArgument, resolveList } from '../resolve-list'
import { matchByNormalizedName } from '../term-match'
import { getCardPrintings } from '../scryfall'
import { isFinish, normalizeFinishValue, VALID_FINISHES } from '../finish-condition'
import { parseSetCode } from '../set-codes'
import type { Finish } from '../types'
import type { ListType } from '../list-type'

/** The main move-session prompt resolves to a menu sentinel or a physical-card key. */
type MoveSelectionResponse = { selection?: string }

/**
 * Print the card index's read/parse warnings to stderr.
 *
 * A list that could not be read contributes no cards, which looks exactly like
 * an empty list — so a move session that silently dropped a whole deck would
 * leave the user hunting for a card that is right there on disk. stderr, not
 * stdout, so a scripted run's payload stays parseable.
 */
function reportIndexWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) {
    process.stderr.write(`Warning: ${warning}\n`)
  }
}

/**
 * The move menu's sentinel values. Matched by exact membership rather than a
 * `__` prefix check, since a card choice's value is a physical-card key and must
 * never be mistaken for a menu item.
 */
const MOVE_MENU_SENTINELS: ReadonlySet<string> = new Set([
  '__VIEW_PENDING__',
  '__CONFIG__',
  '__EXIT__',
])

/** A choice is a menu item (vs. a card) when its value is exactly a known sentinel. */
export const isMoveMenuChoice = (choice: Choice): boolean =>
  typeof choice.value === 'string' && MOVE_MENU_SENTINELS.has(choice.value)

/**
 * The move session's menu items, which sit above the card choices. The moves
 * queued so far lead it — they are what the last search actually produced —
 * while the source/destination filters are a once-per-session setup step, and
 * Exit sits at the foot where it cannot be reached by overshooting.
 */
export function buildMoveMenuChoices(pendingCount: number): Choice[] {
  return [
    {
      title:
        pendingCount > 0 ? `📋 View Pending Changes (${pendingCount})` : '📋 View Pending Changes',
      value: '__VIEW_PENDING__',
    },
    { title: '⚙️  Configure Session Filters', value: '__CONFIG__' },
    { title: '🚪 Exit', value: '__EXIT__' },
  ]
}

/** The session's lists, bucketed by list type for the toggle menus. */
type ListsByType = Record<ListRef['type'], ListEntry[]>

/** Raw commander option values for `move`; validated in the action. */
type MoveCliOptions = {
  from?: string
  to?: string
  quantity?: string
  cardId?: string
  set?: string
  collectorNumber?: string
  finish?: string
  toSection?: string
} & Partial<ScriptingOptions>

export function registerMoveCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('move')
      .description(
        'Move cards between decks, collections, and wanted lists — interactively, or scripted with --from/--to',
      )
      .argument('[cardName...]', 'Card to move (fuzzy match; requires --from and --to)')
      .option(
        '--from <list>',
        "Source list; accepts a 'deck:'/'collection:'/'wanted:' prefix. Alone, launches the interactive session filtered to this source",
      )
      .option(
        '--to <list>',
        'Destination list (same prefix convention). Together with --from, moves without prompts',
      )
      .option('-q, --quantity <n>', 'Number of copies to move (default 1)')
      .option('--card-id <id>', 'Select the source card by ID (the &N suffix in list files)')
      .option(
        '--set <code>',
        'Narrow the match to this set code, or assign the printing when the card has none',
      )
      .option(
        '--collector-number <cn>',
        'Narrow the match to this collector number, or assign the printing when the card has none',
      )
      .option('--finish <finish>', `Narrow the match to this finish: ${VALID_FINISHES.join(', ')}`)
      .option(
        '--to-section <name>',
        'Deck destinations only: add the card to this section (exact name, created if missing)',
      ),
  ).action(async (cardNameParts: string[], options: MoveCliOptions) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    const cardName = cardNameParts.join(' ').trim() || undefined

    await runCommandAction(scripting, async () => {
      if (options.to !== undefined && options.from === undefined) {
        throw new CardCommandError(
          'usage_error',
          '--to requires --from. Pass both to script a move.',
          ExitCode.UsageError,
        )
      }

      if (options.from !== undefined && options.to !== undefined) {
        await runHeadlessMove(
          {
            fromRaw: options.from,
            toRaw: options.to,
            cardName,
            cardIdRaw: options.cardId,
            quantityRaw: options.quantity,
            setRaw: options.set,
            collectorNumber: options.collectorNumber,
            finishRaw: options.finish,
            toSectionRaw: options.toSection,
          },
          scripting,
        )
        return
      }

      if (
        cardName !== undefined ||
        options.cardId !== undefined ||
        options.quantity !== undefined ||
        options.set !== undefined ||
        options.collectorNumber !== undefined ||
        options.finish !== undefined ||
        options.toSection !== undefined
      ) {
        throw new CardCommandError(
          'usage_error',
          'Scripted moves need both --from and --to. Run `ritual move` without card arguments for the interactive session.',
          ExitCode.UsageError,
        )
      }

      if (options.from !== undefined) {
        const arg = parseListArgument(options.from)
        const resolved = await resolveList(arg.name, arg.type)
        if (isResolveListError(resolved)) {
          emitResolveListError(resolved, scripting)
          return
        }
        await runInteractiveMove(resolved.filePath)
        return
      }

      await runInteractiveMove(undefined)
    })
  })
}

// ── Interactive session ───────────────────────────────────────────────────────

/**
 * The interactive move session. When `sourceFilterPath` is given (from `--from`
 * without `--to`), the session starts with only that list enabled as a source —
 * the same set the Session Filters screen edits, so the user can widen it again
 * mid-session.
 */
async function runInteractiveMove(sourceFilterPath: string | undefined): Promise<void> {
  // The session is prompt-driven end to end; without a terminal (or with
  // prompts disabled via --no-input) the only path is the headless one.
  requireInteractive('--from and --to')
  console.log('Loading all lists...')
  const allLists = await loadAllLists()

  if (allLists.length === 0) {
    console.log('No list files found. Create a deck, collection, or wanted list first.')
    return
  }

  let sourceFilter: ListEntry | undefined
  if (sourceFilterPath !== undefined) {
    sourceFilter = allLists.find((l) => l.filePath === sourceFilterPath)
    if (!sourceFilter) {
      console.log('Source list not found among loaded lists.')
      process.exitCode = ExitCode.NotFound
      return
    }
  }

  console.log('Loading cards...')
  const { cards: physicalCards, warnings } = await loadPhysicalCards(allLists)
  reportIndexWarnings(warnings)

  if (physicalCards.length === 0) {
    console.log('No cards found in any list.')
    return
  }

  const virtualState = buildVirtualState(physicalCards)
  const config: MoveSessionConfig = {
    enabledSources: new Set(
      sourceFilter ? [sourceFilter.filePath] : allLists.map((l) => l.filePath),
    ),
    enabledDestinations: new Set(allLists.map((l) => l.filePath)),
    allLists,
  }

  if (sourceFilter) {
    console.log(
      `Source filter: ${listRefLabel(sourceFilter.ref)} (widen it under Session Filters).`,
    )
  }

  console.log(`Ready. ${physicalCards.length} card(s) across ${allLists.length} list(s).`)

  while (true) {
    let isExited = false
    const pending = getPendingMoves(virtualState)
    const cardChoices = buildCardSearchChoices(virtualState, config.enabledSources)

    const menuChoices: Choice[] = buildMoveMenuChoices(pending.length)

    const allChoices: Choice[] = [
      ...menuChoices,
      ...cardChoices.map((c) => ({ title: c.title, value: c.value })),
    ]

    const response = (await prompts({
      type: 'autocomplete',
      name: 'selection',
      message: 'Search for a card to move, or choose an option:',
      choices: allChoices,
      limit: 12,
      suggest: async (rawInput, choices) => {
        const input = String(rawInput).toLowerCase().trim()
        if (!input) return choices.filter(isMoveMenuChoice)

        const terms = input.split(/\s+/).filter(Boolean)
        return choices.filter((choice) => {
          // Always show menu items when filtering
          if (isMoveMenuChoice(choice)) return true
          const title = choice.title.toLowerCase()
          return terms.every((term) => title.includes(term))
        })
      },
      onState: (state: PromptState) => {
        if (state.exited) isExited = true
      },
    })) as MoveSelectionResponse

    if (isExited || response.selection === undefined || response.selection === '__EXIT__') {
      const pendingNow = getPendingMoves(virtualState)
      if (pendingNow.length > 0) {
        const choice = await promptExitMenu(pendingNow.length)
        if (choice === 'cancel') continue
        if (choice === 'save') await savePendingMoves(virtualState)
      }
      break
    }

    const selection: string = response.selection

    if (selection === '__CONFIG__') {
      await handleConfig(config)
      continue
    }

    if (selection === '__VIEW_PENDING__') {
      handleViewPending(virtualState)
      continue
    }

    // Card selection
    const vc = virtualState.get(selection)
    if (!vc) continue

    await handleCardMove(vc, config, virtualState)
  }
}

// ── Headless (scripted) mode ──────────────────────────────────────────────────

/** Raw inputs to a scripted move, before validation. */
type HeadlessMoveArgs = {
  fromRaw: string
  toRaw: string
  cardName: string | undefined
  cardIdRaw: string | undefined
  quantityRaw: string | undefined
  setRaw: string | undefined
  collectorNumber: string | undefined
  finishRaw: string | undefined
  toSectionRaw: string | undefined
}

/** Validated card-selection criteria for a scripted move. */
type HeadlessSelection = {
  cardName: string | undefined
  cardId: number | undefined
  quantity: number
  /** Set code, lowercased. */
  set: string | undefined
  collectorNumber: string | undefined
  finish: Finish | undefined
}

/** The card the move applied to, as reported in JSON output. */
type MovedCardSummary = {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  /** The card's ID in the source list (destination lists assign fresh IDs). */
  cardId?: number
}

/** A list endpoint of the move, as reported in JSON output. */
type MoveListRefOutput = {
  type: ListType
  name: string
}

/** JSON success payload for a scripted move. */
type MoveSuccessOutput = {
  moved: number
  card: MovedCardSummary
  from: MoveListRefOutput
  to: MoveListRefOutput
  /** Notes discarded by deck quantity-merges at the destination. */
  droppedNotes: DroppedNote[]
}

function parseQuantityFlag(raw: string): number {
  const parsed = parsePositiveInteger(raw)
  if (parsed === undefined) {
    throw new CardCommandError(
      'usage_error',
      `--quantity must be a positive integer (got '${raw}').`,
      ExitCode.UsageError,
    )
  }
  return parsed
}

function parseFinishFlag(raw: string): Finish {
  const result = normalizeFinishValue(raw)
  if (!isFinish(result)) {
    throw new CardCommandError('usage_error', result, ExitCode.UsageError)
  }
  return result
}

/** Validate `--set`: a normalized (lowercase alphanumeric) set code. */
function parseSetFlag(raw: string): string {
  const result = parseSetCode(raw)
  if (!result.ok) {
    throw new CardCommandError('usage_error', result.error, ExitCode.UsageError)
  }
  return result.code
}

/**
 * Scripted move: resolve both lists, pick the requested copies out of the source
 * list, resolve a printing when the destination is a collection, and commit
 * through the same engine the interactive session uses.
 */
async function runHeadlessMove(args: HeadlessMoveArgs, scripting: ScriptingOptions): Promise<void> {
  const cardId = args.cardIdRaw !== undefined ? parseCardIdFlag(args.cardIdRaw) : undefined
  if (args.cardName === undefined && cardId === undefined) {
    throw new CardCommandError(
      'usage_error',
      'Provide a card name or --card-id to select the card to move.',
      ExitCode.UsageError,
    )
  }

  const selection: HeadlessSelection = {
    cardName: args.cardName,
    cardId,
    quantity: args.quantityRaw !== undefined ? parseQuantityFlag(args.quantityRaw) : 1,
    set: args.setRaw !== undefined ? parseSetFlag(args.setRaw) : undefined,
    collectorNumber: args.collectorNumber,
    finish: args.finishRaw !== undefined ? parseFinishFlag(args.finishRaw) : undefined,
  }

  const fromArg = parseListArgument(args.fromRaw)
  const fromResolved = await resolveList(fromArg.name, fromArg.type)
  if (isResolveListError(fromResolved)) {
    emitResolveListError(fromResolved, scripting)
    return
  }
  const toArg = parseListArgument(args.toRaw)
  const toResolved = await resolveList(toArg.name, toArg.type)
  if (isResolveListError(toResolved)) {
    emitResolveListError(toResolved, scripting)
    return
  }
  if (fromResolved.filePath === toResolved.filePath) {
    throw new CardCommandError(
      'usage_error',
      'Source and destination are the same list.',
      ExitCode.UsageError,
    )
  }

  const toSection = args.toSectionRaw?.trim()
  if (toSection !== undefined && toSection === '') {
    throw new CardCommandError('usage_error', '--to-section cannot be empty.', ExitCode.UsageError)
  }
  if (toSection !== undefined && toResolved.type !== 'deck') {
    throw new CardCommandError(
      'usage_error',
      '--to-section requires a deck destination.',
      ExitCode.UsageError,
    )
  }

  const allLists = await loadAllLists()
  const fromEntry = allLists.find((l) => l.filePath === fromResolved.filePath)
  const toEntry = allLists.find((l) => l.filePath === toResolved.filePath)
  if (!fromEntry || !toEntry) {
    throw new CardCommandError(
      'runtime_error',
      'A resolved list could not be loaded.',
      ExitCode.RuntimeError,
    )
  }

  const loaded = await loadPhysicalCards([fromEntry])
  reportIndexWarnings(loaded.warnings)
  const state = buildVirtualState(loaded.cards)
  const selected = selectCopies(state, fromEntry, selection)

  // Collection destinations require a concrete printing. Resolve it BEFORE any
  // virtual move so a failure here leaves nothing half-applied.
  const sample = selected[0]!
  if (toEntry.ref.type === 'collection' && (!sample.card.set || !sample.card.collectorNumber)) {
    const printing = await resolvePrintingForCollection(sample.card.name, selection)
    for (const vc of selected) {
      vc.card = { ...vc.card, set: printing.set, collectorNumber: printing.collectorNumber }
    }
  }

  for (const vc of selected) {
    applyVirtualMove(state, vc.physicalKey, toEntry, { section: toSection })
  }
  const { moved, droppedNotes } = await commitAllMoves(state)

  // Surface any note discarded by a destination quantity-merge on stderr, so it
  // never pollutes stdout in json/ndjson mode. Data loss is essential output —
  // not suppressed by --quiet.
  for (const dn of droppedNotes) {
    const idPart = dn.cardId !== undefined ? ` &${dn.cardId}` : ''
    process.stderr.write(
      `Warning: note on "${dn.cardName}"${idPart} was dropped (merged onto an existing line): ${dn.note}\n`,
    )
  }

  if (moved < selection.quantity) {
    throw new CardCommandError(
      'runtime_error',
      `Moved only ${moved} of ${selection.quantity} requested cop${selection.quantity === 1 ? 'y' : 'ies'}.`,
      ExitCode.RuntimeError,
      { moved, requested: selection.quantity },
    )
  }

  emitMoveSuccess(selected[0]!.card, moved, fromEntry, toEntry, droppedNotes, scripting)
}

/**
 * Pick the copies a scripted move applies to: by `--card-id`, or by normalized
 * name (exact tier first, then substring), narrowed by any printing flags.
 * A selection that still spans more than one distinct printing is rejected —
 * moving an arbitrary mix would be unpredictable for scripts.
 */
function selectCopies(
  state: Map<string, VirtualCard>,
  fromEntry: ListEntry,
  selection: HeadlessSelection,
): VirtualCard[] {
  const label = listRefLabel(fromEntry.ref)
  const all = [...state.values()]

  let matches: VirtualCard[]
  if (selection.cardId !== undefined) {
    matches = all.filter((vc) => vc.card.cardId === selection.cardId)
    if (matches.length === 0) {
      throw new CardCommandError(
        'not_found',
        `No card with id ${selection.cardId} found in ${label}.`,
        ExitCode.NotFound,
      )
    }
  } else {
    matches = matchByNormalizedName(all, selection.cardName!, (vc) => vc.card.name)
    if (matches.length === 0) {
      throw new CardCommandError(
        'not_found',
        `No card matching '${selection.cardName}' found in ${label}.`,
        ExitCode.NotFound,
      )
    }
  }

  const hasNarrowing =
    selection.set !== undefined ||
    selection.collectorNumber !== undefined ||
    selection.finish !== undefined
  if (hasNarrowing) {
    // Strict tier: the printing flags match the entry's own printing. Fallback
    // tier: entries with no printing of their own (e.g. name-only wanted cards)
    // are compatible with any --set/--collector-number, which is what lets the
    // wanted → collection purchase flow both select and assign in one command.
    const strict = matches.filter((vc) => printingMatches(vc.card, selection, 'strict'))
    const narrowed =
      strict.length > 0
        ? strict
        : matches.filter((vc) => printingMatches(vc.card, selection, 'compatible'))
    if (narrowed.length === 0) {
      throw new CardCommandError(
        'not_found',
        `No copies of '${matches[0]!.card.name}' matching ${describeNarrowing(selection)} found in ${label}.`,
        ExitCode.NotFound,
      )
    }
    matches = narrowed
  }

  const combos = new Map<string, PhysicalCard>()
  for (const vc of matches) {
    combos.set(printingComboKey(vc.card), vc.card)
  }
  if (combos.size > 1) {
    const distinct = [...combos.values()]
    const lines = distinct
      .slice(0, 10)
      .map((c) => `  - ${describeEntry(c)}`)
      .join('\n')
    const suffix = distinct.length > 10 ? `\n  ... and ${distinct.length - 10} more` : ''
    throw new CardCommandError(
      'usage_error',
      `Multiple printings match in ${label}. Narrow with --set, --collector-number, --finish, or --card-id:\n${lines}${suffix}`,
      ExitCode.UsageError,
      {
        matches: distinct.map((c) => ({
          name: c.name,
          cardId: c.cardId,
          set: c.set,
          collectorNumber: c.collectorNumber,
          finish: c.finish,
        })),
      },
    )
  }

  if (matches.length < selection.quantity) {
    throw new CardCommandError(
      'not_found',
      `Only ${matches.length} cop${matches.length === 1 ? 'y' : 'ies'} of '${matches[0]!.card.name}' in ${label} (requested ${selection.quantity}).`,
      ExitCode.NotFound,
      { available: matches.length, requested: selection.quantity },
    )
  }

  return matches.slice(0, selection.quantity)
}

/**
 * Whether a card's printing satisfies the narrowing flags. In `strict` mode the
 * card must carry the flagged set/collector number itself; in `compatible` mode
 * a card with *no* printing also passes (it can become that printing). A missing
 * finish always means nonfoil — there is no "unassigned" finish.
 */
function printingMatches(
  card: PhysicalCard,
  selection: HeadlessSelection,
  mode: 'strict' | 'compatible',
): boolean {
  if (selection.set !== undefined) {
    if (card.set === undefined) {
      if (mode === 'strict') return false
    } else if (card.set.toLowerCase() !== selection.set) {
      return false
    }
  }
  if (selection.collectorNumber !== undefined) {
    if (card.collectorNumber === undefined) {
      if (mode === 'strict') return false
    } else if (card.collectorNumber !== selection.collectorNumber) {
      return false
    }
  }
  if (selection.finish !== undefined && (card.finish ?? 'nonfoil') !== selection.finish) {
    return false
  }
  return true
}

function printingComboKey(card: PhysicalCard): string {
  return `${card.set?.toLowerCase() ?? ''}|${card.collectorNumber ?? ''}|${card.finish ?? 'nonfoil'}`
}

function describeNarrowing(selection: HeadlessSelection): string {
  const parts: string[] = []
  if (selection.set !== undefined) parts.push(`set ${selection.set.toUpperCase()}`)
  if (selection.collectorNumber !== undefined) {
    parts.push(`collector number ${selection.collectorNumber}`)
  }
  if (selection.finish !== undefined) parts.push(`finish ${selection.finish}`)
  return parts.join(', ')
}

/** The printing assigned to a name-only card headed for a collection. */
type AssignedPrinting = {
  /** Set code, lowercase. */
  set: string
  collectorNumber: string
}

/**
 * Resolve the printing a name-only card lands with in a collection: the
 * `--set`/`--collector-number` flags when given (validated against the card's
 * known printings — an unknown pair is a usage error listing the printings
 * that do exist), else the card's single known printing from the local
 * Scryfall cache. Anything ambiguous (or unknown) is a usage error — the
 * headless path never prompts.
 */
async function resolvePrintingForCollection(
  cardName: string,
  selection: HeadlessSelection,
): Promise<AssignedPrinting> {
  if (selection.set !== undefined && selection.collectorNumber !== undefined) {
    const printing = await resolvePinnedPrinting(cardName, {
      set: selection.set,
      collectorNumber: selection.collectorNumber,
    })
    return { set: printing.set.toLowerCase(), collectorNumber: printing.collector_number }
  }
  if (selection.set !== undefined || selection.collectorNumber !== undefined) {
    throw new CardCommandError(
      'usage_error',
      `'${cardName}' has no printing; pass both --set and --collector-number to assign one for the collection destination.`,
      ExitCode.UsageError,
    )
  }

  const printings = await getCardPrintings(cardName)
  if (printings.length === 1) {
    const p = printings[0]!
    return { set: p.set.toLowerCase(), collectorNumber: p.collector_number }
  }
  if (printings.length === 0) {
    throw new CardCommandError(
      'usage_error',
      `No printings of '${cardName}' found in the card cache. Pass --set and --collector-number to assign one for the collection destination.`,
      ExitCode.UsageError,
    )
  }
  const lines = printings
    .slice(0, 10)
    .map((p) => `  - ${p.set_name} (${p.set.toUpperCase()}:${p.collector_number})`)
    .join('\n')
  const suffix = printings.length > 10 ? `\n  ... and ${printings.length - 10} more` : ''
  throw new CardCommandError(
    'usage_error',
    `'${cardName}' has multiple printings. Pick one with --set and --collector-number:\n${lines}${suffix}`,
    ExitCode.UsageError,
    {
      printings: printings.map((p) => ({
        set: p.set.toLowerCase(),
        collectorNumber: p.collector_number,
        setName: p.set_name,
      })),
    },
  )
}

function emitMoveSuccess(
  card: PhysicalCard,
  moved: number,
  from: ListEntry,
  to: ListEntry,
  droppedNotes: DroppedNote[],
  scripting: ScriptingOptions,
): void {
  if (scripting.output === 'text') {
    if (scripting.quiet) return
    const printingPart =
      card.set && card.collectorNumber ? ` (${card.set.toUpperCase()}:${card.collectorNumber})` : ''
    emitOutput(
      `Moved ${moved} x ${card.name}${printingPart}${finishLabel(card.finish)} from ${listRefLabel(from.ref)} to ${listRefLabel(to.ref)}`,
      scripting,
    )
    return
  }

  const payload: MoveSuccessOutput = {
    moved,
    card: {
      name: card.name,
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: card.finish,
      cardId: card.cardId,
    },
    from: { type: from.ref.type, name: from.ref.name },
    to: { type: to.ref.type, name: to.ref.name },
    droppedNotes,
  }
  emitOutput(payload, scripting)
}

async function savePendingMoves(virtualState: Map<string, VirtualCard>): Promise<void> {
  const pending = getPendingMoves(virtualState)
  if (pending.length === 0) {
    console.log('No pending moves.')
    return
  }

  console.log(`Saving ${pending.length} move(s)...`)
  const { moved, droppedNotes } = await commitAllMoves(virtualState)
  for (const dn of droppedNotes) {
    const idPart = dn.cardId !== undefined ? ` &${dn.cardId}` : ''
    console.log(
      `  ⚠ Note on "${dn.cardName}"${idPart} was dropped (merged onto an existing line): ${dn.note}`,
    )
  }
  console.log(`Done. Moved ${moved} card(s).`)
}

function handleViewPending(virtualState: Map<string, VirtualCard>): void {
  const pending = getPendingMoves(virtualState)
  if (pending.length === 0) {
    console.log('No pending moves.')
    return
  }

  console.log(`\nPending moves (${pending.length}):`)
  for (const vc of pending) {
    const card = vc.card
    const from = listRefLabel(vc.pendingMove.originalList.ref)
    const to = listRefLabel(vc.currentList.ref)
    const printingPart =
      card.set && card.collectorNumber ? ` (${card.set.toUpperCase()}:${card.collectorNumber})` : ''
    const finishPart = finishLabel(card.finish)
    const idPart = card.cardId !== undefined ? ` &${card.cardId}` : ''
    console.log(`  ${card.name}${printingPart}${finishPart}${idPart}: ${from} → ${to}`)
  }
  console.log('')
}

async function handleCardMove(
  vc: VirtualCard,
  config: MoveSessionConfig,
  virtualState: Map<string, VirtualCard>,
): Promise<void> {
  const card = vc.card

  // Determine valid destinations (enabled destinations minus the card's current list)
  const validDests = config.allLists.filter(
    (l) => config.enabledDestinations.has(l.filePath) && l.filePath !== vc.currentList.filePath,
  )

  if (validDests.length === 0) {
    console.log('No valid destinations available. Configure destinations in session filters.')
    return
  }

  // If card is a name-only wanted entry moving to a collection, prompt for printing
  let resolvedCard = card

  // Pick destination first
  let destList: ListEntry

  if (validDests.length === 1) {
    destList = validDests[0]!
  } else {
    const destChoices: Choice[] = validDests.map((l) => ({
      title: listRefLabel(l.ref),
      value: l.filePath,
    }))

    let destExited = false
    const destResponse = await prompts({
      type: 'autocomplete',
      name: 'dest',
      message: `Move "${card.name}" to:`,
      choices: destChoices,
      limit: 15,
      suggest: async (rawInput, choices) => {
        const input = String(rawInput).toLowerCase().trim()
        if (!input) return choices
        const terms = input.split(/\s+/).filter(Boolean)
        return choices.filter((choice) => {
          const title = choice.title.toLowerCase()
          return terms.every((term) => title.includes(term))
        })
      },
      onState: (state: PromptState) => {
        if (state.exited) destExited = true
      },
    })

    if (destExited || destResponse.dest === undefined) return

    const found = validDests.find((l) => l.filePath === destResponse.dest)
    if (!found) return
    destList = found
  }

  // Only resolve printing when the chosen destination is a collection and the card lacks it
  if (destList.ref.type === 'collection' && (!card.set || !card.collectorNumber)) {
    console.log(`"${card.name}" has no printing info. Resolve printing for collection destination.`)
    const result = await resolveCardPrinting(card.name, {}, false)
    if (result.kind === 'cancelled') {
      console.log('Printing selection cancelled.')
      return
    }
    if (result.kind === 'none') {
      console.log(`No printings found for "${card.name}"; cannot move it to a collection.`)
      return
    }
    resolvedCard = {
      ...card,
      set: result.printing.set.toLowerCase(),
      collectorNumber: result.printing.collector_number,
    }
  }

  // If we resolved printing, update the virtual card's data in-place
  if (resolvedCard !== card) {
    const updatedVc = virtualState.get(vc.physicalKey)
    if (updatedVc) {
      updatedVc.card = resolvedCard
    }
  }

  applyVirtualMove(virtualState, vc.physicalKey, destList)

  const printingPart =
    resolvedCard.set && resolvedCard.collectorNumber
      ? ` (${resolvedCard.set.toUpperCase()}:${resolvedCard.collectorNumber})`
      : ''
  const finishPart = finishLabel(resolvedCard.finish)
  console.log(
    `  ✓ Queued: ${resolvedCard.name}${printingPart}${finishPart} → ${listRefLabel(destList.ref)}`,
  )
}

async function handleConfig(config: MoveSessionConfig): Promise<void> {
  while (true) {
    const response = await prompts({
      type: 'select',
      name: 'option',
      message: 'Session Filters:',
      choices: [
        { title: 'Configure Sources (which lists to move cards FROM)', value: 'sources' },
        { title: 'Configure Destinations (which lists to move cards TO)', value: 'destinations' },
        { title: '← Back', value: 'back' },
      ],
    })

    if (!response.option || response.option === 'back') break

    if (response.option === 'sources') {
      await promptListToggle(config.enabledSources, config.allLists, 'Move FROM', false)
    } else if (response.option === 'destinations') {
      await promptListToggle(config.enabledDestinations, config.allLists, 'Move TO', true)
    }
  }
}

async function promptListToggle(
  enabledSet: Set<string>,
  allLists: ListEntry[],
  label: string,
  requireAtLeastOne: boolean,
): Promise<void> {
  const byType: ListsByType = {
    deck: allLists.filter((l) => l.ref.type === 'deck'),
    collection: allLists.filter((l) => l.ref.type === 'collection'),
    wanted: allLists.filter((l) => l.ref.type === 'wanted'),
  }

  while (true) {
    const deckPaths = byType.deck.map((l) => l.filePath)
    const collPaths = byType.collection.map((l) => l.filePath)
    const wantedPaths = byType.wanted.map((l) => l.filePath)

    const deckState = getToggleState(deckPaths, enabledSet)
    const collState = getToggleState(collPaths, enabledSet)
    const wantedState = getToggleState(wantedPaths, enabledSet)

    const choices: Choice[] = []

    if (byType.deck.length > 0) {
      choices.push({
        title: `[${toggleStateChar(deckState)}] Decks (${deckPaths.filter((p) => enabledSet.has(p)).length}/${deckPaths.length})`,
        value: 'type:deck',
      })
    }
    if (byType.collection.length > 0) {
      choices.push({
        title: `[${toggleStateChar(collState)}] Collections (${collPaths.filter((p) => enabledSet.has(p)).length}/${collPaths.length})`,
        value: 'type:collection',
      })
    }
    if (byType.wanted.length > 0) {
      choices.push({
        title: `[${toggleStateChar(wantedState)}] Wanted Lists (${wantedPaths.filter((p) => enabledSet.has(p)).length}/${wantedPaths.length})`,
        value: 'type:wanted',
      })
    }

    choices.push(
      { title: '── Toggle All ON ──', value: '__ALL_ON__' },
      { title: '── Toggle All OFF ──', value: '__ALL_OFF__' },
      { title: '← Done', value: '__BACK__' },
    )

    const response = await prompts({
      type: 'select',
      name: 'action',
      message: `${label} — Toggle Lists:`,
      choices,
    })

    if (!response.action || response.action === '__BACK__') break

    if (response.action === '__ALL_ON__') {
      toggleSetAll(
        enabledSet,
        allLists.map((l) => l.filePath),
        true,
      )
      continue
    }

    if (response.action === '__ALL_OFF__') {
      if (requireAtLeastOne) {
        console.log('At least one destination must remain enabled.')
        continue
      }
      toggleSetAll(
        enabledSet,
        allLists.map((l) => l.filePath),
        false,
      )
      continue
    }

    if (response.action === 'type:deck') {
      await promptSubListToggle(enabledSet, byType.deck, 'Decks', requireAtLeastOne, allLists)
    } else if (response.action === 'type:collection') {
      await promptSubListToggle(
        enabledSet,
        byType.collection,
        'Collections',
        requireAtLeastOne,
        allLists,
      )
    } else if (response.action === 'type:wanted') {
      await promptSubListToggle(
        enabledSet,
        byType.wanted,
        'Wanted Lists',
        requireAtLeastOne,
        allLists,
      )
    }
  }
}

async function promptSubListToggle(
  enabledSet: Set<string>,
  lists: ListEntry[],
  categoryLabel: string,
  requireAtLeastOne: boolean,
  allLists: ListEntry[],
): Promise<void> {
  while (true) {
    const choices: Choice[] = lists.map((l) => ({
      title: `[${enabledSet.has(l.filePath) ? 'X' : ' '}] ${l.ref.name}`,
      value: l.filePath,
    }))

    choices.push(
      { title: '── Toggle All ON ──', value: '__ALL_ON__' },
      { title: '── Toggle All OFF ──', value: '__ALL_OFF__' },
      { title: '← Back', value: '__BACK__' },
    )

    const response = await prompts({
      type: 'select',
      name: 'action',
      message: `${categoryLabel}:`,
      choices,
    })

    if (!response.action || response.action === '__BACK__') break

    if (response.action === '__ALL_ON__') {
      toggleSetAll(
        enabledSet,
        lists.map((l) => l.filePath),
        true,
      )
      continue
    }

    if (response.action === '__ALL_OFF__') {
      if (requireAtLeastOne) {
        const allPaths = allLists.map((l) => l.filePath)
        const otherEnabled = allPaths.filter(
          (p) => enabledSet.has(p) && !lists.some((l) => l.filePath === p),
        )
        if (otherEnabled.length === 0) {
          console.log('At least one destination must remain enabled.')
          continue
        }
      }
      toggleSetAll(
        enabledSet,
        lists.map((l) => l.filePath),
        false,
      )
      continue
    }

    // Toggle individual item
    if (typeof response.action !== 'string') break
    const targetPath = response.action
    if (enabledSet.has(targetPath)) {
      if (requireAtLeastOne) {
        const remaining = allLists.filter(
          (l) => enabledSet.has(l.filePath) && l.filePath !== targetPath,
        )
        if (remaining.length === 0) {
          console.log('At least one destination must remain enabled.')
          continue
        }
      }
      enabledSet.delete(targetPath)
    } else {
      enabledSet.add(targetPath)
    }
  }
}
