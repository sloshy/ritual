import { Command } from 'commander'
import prompts, { type Choice } from 'prompts'
import { promptExitMenu } from './prompts-helpers'
import { listRefLabel } from '../change-event'
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
  finishLabel,
} from './move-helpers'
import { promptListToggle } from './move-toggle'
import {
  promptDestinationSection,
  promptMoveDestination,
  resolveMovePrinting,
} from './move-prompts'
import { ask, suggestCardsWithMenu } from './prompts-helpers'
import { createBatchSession, runBatchRound, type BatchSession } from './move-batch'
import {
  addScriptingOptions,
  emitOutput,
  emitResolveListError,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'
import { CardCommandError, localizedCommandError } from '../errors'
import {
  describeEntry,
  ensureCardIdMatchesName,
  parseCardIdFlag,
  resolvePinnedPrinting,
  runCommandAction,
} from './card-target'
import { parsePositiveInteger } from '../parse-number'
import { requireInteractive } from '../no-input'
import { isResolveListError, parseListArgument, resolveList } from '../resolve-list'
import { matchByNormalizedName } from '../term-match'
import { getCardPrintingsResult } from '../scryfall'
import { printingsAreComplete } from '../card-printing'
import { isFinish, normalizeFinishValue, VALID_FINISHES } from '../finish-condition'
import { parseSetCode } from '../set-codes'
import { languageToken, type CardLanguage } from '../card-language'
import type { Finish } from '../types'
import type { ListType } from '../list-type'
import { t } from '../i18n/t'

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
    process.stderr.write(`${t('cli.move.indexWarning', { warning })}\n`)
  }
}

/**
 * The move menu's sentinel values. Matched by exact membership rather than a
 * `__` prefix check, since a card choice's value is a physical-card key and must
 * never be mistaken for a menu item.
 */
const MOVE_MENU_SENTINELS = ['__VIEW_PENDING__', '__BATCH__', '__CONFIG__', '__EXIT__'] as const
type MoveMenuSentinel = (typeof MOVE_MENU_SENTINELS)[number]
const MOVE_MENU_SENTINEL_SET: ReadonlySet<string> = new Set(MOVE_MENU_SENTINELS)

/** A choice is a menu item (vs. a card) when its value is exactly a known sentinel. */
export const isMoveMenuChoice = (choice: Choice): boolean =>
  typeof choice.value === 'string' && MOVE_MENU_SENTINEL_SET.has(choice.value)

/**
 * The move session's menu items, which sit above the card choices. The moves
 * queued so far lead it — they are what the last search actually produced —
 * while the source/destination filters are a once-per-session setup step, and
 * Exit sits at the foot where it cannot be reached by overshooting.
 */
/** One row of the session menu, whose value is always a sentinel. */
type MoveMenuChoice = Choice & { value: MoveMenuSentinel }

export function buildMoveMenuChoices(pendingCount: number): MoveMenuChoice[] {
  return [
    {
      title:
        pendingCount > 0
          ? t('cli.move.menuViewPendingCount', { count: pendingCount })
          : t('cli.move.menuViewPending'),
      value: '__VIEW_PENDING__',
    },
    { title: t('cli.move.menuBatch'), value: '__BATCH__' },
    { title: t('cli.move.menuFilters'), value: '__CONFIG__' },
    { title: t('cli.move.menuExit'), value: '__EXIT__' },
  ]
}

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
      .description(t('help.move.description'))
      .argument('[cardName...]', t('help.move.cardName'))
      .option('--from <list>', t('help.move.from'))
      .option('--to <list>', t('help.move.to'))
      .option('-q, --quantity <n>', t('help.move.quantity'))
      .option('--card-id <id>', t('help.move.cardId'))
      .option('--set <code>', t('help.move.set'))
      .option('--collector-number <cn>', t('help.move.collectorNumber'))
      .option('--finish <finish>', t('help.move.finish', { finishes: VALID_FINISHES.join(', ') }))
      .option('--to-section <name>', t('help.move.toSection')),
  ).action(async (cardNameParts: string[], options: MoveCliOptions) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    const cardName = cardNameParts.join(' ').trim() || undefined

    await runCommandAction(scripting, async () => {
      if (options.to !== undefined && options.from === undefined) {
        throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.move.toRequiresFrom')
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
        throw localizedCommandError(
          'usage_error',
          ExitCode.UsageError,
          'cli.move.scriptedNeedsBoth',
        )
      }

      if (options.from !== undefined) {
        const arg = parseListArgument(options.from)
        const resolved = await resolveList(arg.name, arg.type)
        if (isResolveListError(resolved)) {
          emitResolveListError(resolved, scripting, 'type-prefix')
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
  console.log(t('cli.move.loadingLists'))
  const allLists = await loadAllLists()

  if (allLists.length === 0) {
    console.log(t('cli.move.noLists'))
    return
  }

  let sourceFilter: ListEntry | undefined
  if (sourceFilterPath !== undefined) {
    sourceFilter = allLists.find((l) => l.filePath === sourceFilterPath)
    if (!sourceFilter) {
      console.log(t('cli.move.sourceNotLoaded'))
      process.exitCode = ExitCode.NotFound
      return
    }
  }

  console.log(t('cli.move.loadingCards'))
  const { cards: physicalCards, warnings } = await loadPhysicalCards(allLists)
  reportIndexWarnings(warnings)

  if (physicalCards.length === 0) {
    console.log(t('cli.move.noCards'))
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
    console.log(t('cli.move.sourceFilter', { list: listRefLabel(sourceFilter.ref) }))
  }

  console.log(
    t('cli.move.ready', {
      cards: t('domain.count.cards', { count: physicalCards.length }),
      lists: t('domain.count.lists', { count: allLists.length }),
    }),
  )

  // Batch Mode is a session-level toggle: while it is on, the round-based batch
  // screens replace the single-card search entirely.
  let batch: BatchSession | undefined

  while (true) {
    if (batch !== undefined) {
      const outcome = await runBatchRound(virtualState, config, batch)
      if (outcome === 'exit') batch = undefined
      continue
    }

    const pending = getPendingMoves(virtualState)
    const cardChoices = buildCardSearchChoices(virtualState, config.enabledSources)

    const menuChoices = buildMoveMenuChoices(pending.length)

    const selection = await ask<string>({
      type: 'autocomplete',
      message: t('cli.move.promptSearch'),
      subjectKey: 'cli.prompt.subject.cardsToMove',
      choices: [...menuChoices, ...cardChoices],
      limit: 12,
      // The menu rows stay visible while the cards filter, so the session can
      // always be left; an empty input shows them alone rather than every card.
      suggest: suggestCardsWithMenu({ isMenuChoice: isMoveMenuChoice, emptyShows: 'menu' }),
    })

    if (selection === undefined || selection === '__EXIT__') {
      const pendingNow = getPendingMoves(virtualState)
      if (pendingNow.length > 0) {
        const choice = await promptExitMenu(pendingNow.length)
        if (choice === 'cancel') continue
        if (choice === 'save') await savePendingMoves(virtualState)
      }
      break
    }

    if (selection === '__BATCH__') {
      batch = createBatchSession(config)
      continue
    }

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
  /** The moved copy's language; omitted for English (bare-line default). */
  language?: CardLanguage
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
    throw localizedCommandError(
      'usage_error',
      ExitCode.UsageError,
      'cli.cardOps.quantityPositive',
      {
        value: raw,
      },
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
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.move.selectorRequired')
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
    emitResolveListError(fromResolved, scripting, 'type-prefix')
    return
  }
  const toArg = parseListArgument(args.toRaw)
  const toResolved = await resolveList(toArg.name, toArg.type)
  if (isResolveListError(toResolved)) {
    emitResolveListError(toResolved, scripting, 'type-prefix')
    return
  }
  if (fromResolved.filePath === toResolved.filePath) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.move.sameList')
  }

  const toSection = args.toSectionRaw?.trim()
  if (toSection !== undefined && toSection === '') {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.move.toSectionEmpty')
  }
  if (toSection !== undefined && toResolved.type !== 'deck') {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.move.toSectionDeckOnly')
  }

  const allLists = await loadAllLists()
  const fromEntry = allLists.find((l) => l.filePath === fromResolved.filePath)
  const toEntry = allLists.find((l) => l.filePath === toResolved.filePath)
  if (!fromEntry || !toEntry) {
    throw localizedCommandError('runtime_error', ExitCode.RuntimeError, 'cli.move.listNotLoaded')
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
    process.stderr.write(
      `${t('cli.move.noteDroppedWarning', {
        name: dn.cardName,
        id: cardIdLabel(dn.cardId),
        note: dn.note,
      })}\n`,
    )
  }

  if (moved < selection.quantity) {
    throw new CardCommandError(
      'runtime_error',
      t('cli.move.movedFewer', { moved, count: selection.quantity }),
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
      throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.move.noCardWithId', {
        id: selection.cardId,
        list: label,
      })
    }
    // A name given alongside the ID must agree with it — a stale ID would
    // otherwise move whatever card now carries it, reported as success.
    ensureCardIdMatchesName({
      cardId: selection.cardId,
      entryName: matches[0]!.card.name,
      requestedName: selection.cardName,
    })
  } else {
    matches = matchByNormalizedName(all, selection.cardName!, (vc) => vc.card.name)
    if (matches.length === 0) {
      throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.move.noCardMatching', {
        name: String(selection.cardName),
        list: label,
      })
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
      throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.move.noCopiesMatching', {
        name: matches[0]!.card.name,
        criteria: describeNarrowing(selection),
        list: label,
      })
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
      .map((c) => t('cli.cardOps.matchLine', { entry: describeEntry(c) }))
      .join('\n')
    const suffix =
      distinct.length > 10 ? `\n${t('cli.cardOps.andMore', { count: distinct.length - 10 })}` : ''
    throw new CardCommandError(
      'usage_error',
      t('cli.move.multiplePrintings', { list: label, matches: `${lines}${suffix}` }),
      ExitCode.UsageError,
      {
        matches: distinct.map((c) => ({
          name: c.name,
          cardId: c.cardId,
          set: c.set,
          collectorNumber: c.collectorNumber,
          finish: c.finish,
          language: c.language,
        })),
      },
      { key: 'cli.move.multiplePrintings' },
    )
  }

  if (matches.length < selection.quantity) {
    throw new CardCommandError(
      'not_found',
      t('cli.move.notEnoughCopies', {
        count: matches.length,
        name: matches[0]!.card.name,
        list: label,
        requested: selection.quantity,
      }),
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
  // Language joins the key like finish: a request that matched both an English
  // and a [ja] copy of the same printing must be narrowed (with --card-id)
  // rather than moving an arbitrary mix.
  return `${card.set?.toLowerCase() ?? ''}|${card.collectorNumber ?? ''}|${card.finish ?? 'nonfoil'}|${card.language ?? 'en'}`
}

function describeNarrowing(selection: HeadlessSelection): string {
  const parts: string[] = []
  if (selection.set !== undefined) {
    parts.push(t('cli.move.criteriaSet', { set: selection.set.toUpperCase() }))
  }
  if (selection.collectorNumber !== undefined) {
    parts.push(t('cli.move.criteriaCollectorNumber', { value: selection.collectorNumber }))
  }
  if (selection.finish !== undefined) {
    parts.push(t('cli.move.criteriaFinish', { finish: selection.finish }))
  }
  return parts.join(', ')
}

/**
 * The ` &N` suffix a card line carries, or the empty string — attached to the
 * preceding token with no space of its own.
 */
function cardIdLabel(cardId: number | undefined): string {
  return cardId !== undefined ? ` &${cardId}` : ''
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
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.move.printingNeedsBoth', {
      name: cardName,
    })
  }

  // Cache-only: only the cache's own printing list is exhaustive. A cache miss
  // would fall back to a single `/cards/named` fetch, whose one result says
  // nothing about how many printings exist — auto-accepting it would silently
  // record an arbitrary printing, so it is not worth fetching in the first place.
  const result = await getCardPrintingsResult(cardName, { network: false })
  const printings = result.printings
  if (!printingsAreComplete(result)) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.move.printingsUnknown', {
      name: cardName,
    })
  }
  if (printings.length === 1) {
    const p = printings[0]!
    return { set: p.set.toLowerCase(), collectorNumber: p.collector_number }
  }
  const lines = printings
    .slice(0, 10)
    .map((p) =>
      t('cli.move.printingLine', {
        setName: p.set_name,
        printing: `${p.set.toUpperCase()}:${p.collector_number}`,
      }),
    )
    .join('\n')
  const suffix =
    printings.length > 10 ? `\n${t('cli.cardOps.andMore', { count: printings.length - 10 })}` : ''
  throw new CardCommandError(
    'usage_error',
    t('cli.move.multipleCardPrintings', { name: cardName, printings: `${lines}${suffix}` }),
    ExitCode.UsageError,
    {
      printings: printings.map((p) => ({
        set: p.set.toLowerCase(),
        collectorNumber: p.collector_number,
        setName: p.set_name,
      })),
    },
    { key: 'cli.move.multipleCardPrintings' },
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
      t('cli.move.moved', {
        count: moved,
        card: `${card.name}${printingPart}${finishLabel(card.finish)}${languageToken(card.language)}`,
        from: listRefLabel(from.ref),
        to: listRefLabel(to.ref),
      }),
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
      language: card.language,
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
    console.log(t('cli.move.noPending'))
    return
  }

  console.log(t('cli.move.saving', { count: pending.length }))
  const { moved, droppedNotes } = await commitAllMoves(virtualState)
  for (const dn of droppedNotes) {
    console.log(
      t('cli.move.noteDroppedLine', {
        name: dn.cardName,
        id: cardIdLabel(dn.cardId),
        note: dn.note,
      }),
    )
  }
  console.log(t('cli.move.doneMoved', { count: moved }))
}

function handleViewPending(virtualState: Map<string, VirtualCard>): void {
  const pending = getPendingMoves(virtualState)
  if (pending.length === 0) {
    console.log(t('cli.move.noPending'))
    return
  }

  console.log(`\n${t('cli.move.pendingHeading', { count: pending.length })}`)
  for (const vc of pending) {
    const card = vc.card
    const printingPart =
      card.set && card.collectorNumber ? ` (${card.set.toUpperCase()}:${card.collectorNumber})` : ''
    const finishPart = finishLabel(card.finish) + languageToken(card.language)
    console.log(
      t('cli.move.pendingLine', {
        card: `${card.name}${printingPart}${finishPart}${cardIdLabel(card.cardId)}`,
        from: listRefLabel(vc.pendingMove.originalList.ref),
        to: listRefLabel(vc.currentList.ref),
      }),
    )
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
    console.log(t('cli.move.noDestinations'))
    return
  }

  // Pick destination first. One valid destination needs no question — there is
  // nothing to choose between.
  const destList =
    validDests.length === 1
      ? validDests[0]!
      : await promptMoveDestination(
          validDests,
          t('cli.move.promptDestination', { name: card.name }),
        )
  if (destList === undefined) return

  // A deck destination asks which section the card lands in; every other
  // destination type has none, and the prompt is skipped.
  const section = await promptDestinationSection(destList)
  if (section.kind === 'cancelled') return

  // Only resolve a printing when the chosen destination is a collection and the
  // card lacks one — the same question Batch Mode asks, asked the same way.
  const printing = await resolveMovePrinting(card, destList)
  if (printing.kind === 'cancelled' || printing.kind === 'none') return
  const resolvedCard = printing.kind === 'resolved' ? printing.card : card

  // If we resolved printing, update the virtual card's data in-place
  if (resolvedCard !== card) {
    const updatedVc = virtualState.get(vc.physicalKey)
    if (updatedVc) {
      updatedVc.card = resolvedCard
    }
  }

  applyVirtualMove(virtualState, vc.physicalKey, destList, { section: section.section })

  const printingPart =
    resolvedCard.set && resolvedCard.collectorNumber
      ? ` (${resolvedCard.set.toUpperCase()}:${resolvedCard.collectorNumber})`
      : ''
  const finishPart = finishLabel(resolvedCard.finish) + languageToken(resolvedCard.language)
  console.log(
    t('cli.move.queued', {
      card: `${resolvedCard.name}${printingPart}${finishPart}`,
      list: listRefLabel(destList.ref),
    }),
  )
}

async function handleConfig(config: MoveSessionConfig): Promise<void> {
  while (true) {
    const response = await prompts({
      type: 'select',
      name: 'option',
      message: t('cli.move.filtersPrompt'),
      choices: [
        { title: t('cli.move.configureSources'), value: 'sources' },
        { title: t('cli.move.configureDestinations'), value: 'destinations' },
        { title: t('cli.move.back'), value: 'back' },
      ],
    })

    if (!response.option || response.option === 'back') break

    if (response.option === 'sources') {
      await promptListToggle(config.enabledSources, config.allLists, 'from', false)
    } else if (response.option === 'destinations') {
      await promptListToggle(config.enabledDestinations, config.allLists, 'to', true)
    }
  }
}
