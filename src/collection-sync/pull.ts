/**
 * @fileoverview The pull half of the collection-sync engine (Archidekt →
 * local): placing remote additions into the target list, resolving removals
 * that span several lists, and validating pull destinations before anything
 * is written.
 */

import type { SelectBranch } from '../i18n/t'
import { normalizeListName } from '../list/resolve-list'
import { describeSkippedChanges, dryRunReason, noChangesReason } from '../sync/common'
import {
  errorParam,
  isNonEmpty,
  isSyncMessage,
  joinSyncMessages,
  nestSync,
  syncList,
  syncMessage,
  syncRef,
  toSyncMessage,
  type SyncListParam,
  type SyncMessage,
} from '../sync/message'
import type { ScryfallCard } from '../scryfall/types'
import {
  collectionChangeCounts,
  describeAmbiguousRemoval,
  describeCollectionChangeSummary,
  type AmbiguousRemoval,
} from './describe'
import { describeSyncCard } from '../sync/describe'
import {
  applyRemovalAssignments,
  planPull,
  pullChangesByList,
  resolveAmbiguousByPriority,
  type LocalCollectionIndex,
  type PullAddition,
  type PulledCardName,
  type PullListChanges,
  type PullRemoval,
  type RemoteCollectionIndex,
} from './diff'
import type { CollectionListStore } from './store'
import {
  type AmbiguityResolutionOutcome,
  type SyncFlow,
  type FlowOutcome,
  abortedOutcome,
  emitListLines,
  markCancelled,
} from './types'

// ── Pull (Archidekt → local) ──────────────────────────────────────────

export async function pullFromArchidekt(
  flow: SyncFlow,
  local: LocalCollectionIndex,
  remote: RemoteCollectionIndex,
  names: string[],
): Promise<FlowOutcome> {
  const { emit, results, store, dryRun } = flow
  const writtenFiles: string[] = []

  const plan = planPull(local, remote, flow.only)
  const skippedMessage = describeSkippedChanges(flow.only, plan.skipped)
  if (skippedMessage) emit({ kind: 'log', level: 'info', item: null, ...skippedMessage })

  let target = flow.into
  let applicable = plan

  /**
   * Give up on the whole pull. Nothing has been written at this point — not a
   * list, not the target list a pull creates, not the sync timestamp — which is
   * what `aborted` tells `runCollectionSync`.
   */
  const abort = (message: SyncMessage, unresolvedAmbiguity = false): FlowOutcome => {
    emit({ kind: 'log', level: 'error', item: null, ...message })
    return abortedOutcome([message], plan.ambiguous, unresolvedAmbiguity)
  }

  // Ambiguity is settled before anything is written: a run that cannot place
  // every ambiguous removal writes nothing at all, so a half-made decision can
  // never reach a list file.
  const priority = await resolveRemovalPriority(flow.store, flow.removalPriority)
  if (isSyncMessage(priority)) return abort(priority)

  for (const ambiguous of plan.ambiguous) {
    emit({
      kind: 'log',
      level: 'warn',
      item: null,
      ...toSyncMessage(describeAmbiguousRemoval(ambiguous)),
    })
  }

  if (plan.ambiguous.length > 0) {
    const placed = await placeAmbiguous(flow, local, plan.ambiguous, priority)
    // Every way `placeAmbiguous` refuses is the same thing to a caller: the
    // ambiguity is still open, and a rerun carrying a decision is the fix.
    if (isSyncMessage(placed)) return abort(placed, true)
    if (placed.length > 0) applicable = { ...plan, removals: [...plan.removals, ...placed] }
  }

  // A list that dropped out of the comparison makes every card it holds look
  // remote-only, so pulling would copy that whole file into the target list.
  // Removals are safe (they only ever name a list that *was* loaded), so only
  // the additions are withheld.
  if (!flow.localComplete && applicable.additions.length > 0) {
    const copies = applicable.additions.reduce((total, addition) => total + addition.quantity, 0)
    emit({
      kind: 'log',
      level: 'error',
      item: null,
      ...syncMessage('domain.sync.pullAdditionsWithheld', { count: copies, target: flow.into }),
    })
    applicable = { ...applicable, additions: [] }
  }

  // The target list is only needed — and only created — when something is
  // actually being added. When it cannot be resolved, the additions are
  // dropped (they have nowhere to go) and the removals still apply.
  if (applicable.additions.length > 0) {
    const resolved = await resolveTarget(flow)
    if (isSyncMessage(resolved)) {
      emit({ kind: 'log', level: 'error', item: null, ...resolved })
      results.fail(flow.into, resolved)
      results.finish(flow.into)
      applicable = { ...applicable, additions: [] }
    } else {
      target = resolved.name
      writtenFiles.push(...resolved.writtenFiles)
    }
  }

  const resolveName = await pulledNameResolver(flow, applicable.additions)
  const changesByList = new Map<string, PullListChanges>()
  for (const entry of pullChangesByList(applicable, target, resolveName)) {
    changesByList.set(entry.list, entry)
  }

  // Every in-scope list is reported, plus the target list when it is not one of
  // them — a pull that only adds still has something to say about where.
  const ordered = [...names]
  if (changesByList.has(target) && !ordered.includes(target)) ordered.push(target)

  let added = 0
  let removed = 0
  let cancelled = false
  for (const [index, name] of ordered.entries()) {
    if (flow.signal?.aborted) {
      markCancelled(ordered.slice(index), emit, results, 'pull')
      cancelled = true
      break
    }
    emit({ kind: 'item-start', item: name, index, total: ordered.length })
    const changes = changesByList.get(name)
    if (!changes || changes.changes.length === 0) {
      emit({ kind: 'log', level: 'info', item: name, ...syncMessage('domain.sync.noChanges') })
      results.succeed(name, 'unchanged', noChangesReason())
      continue
    }

    const { cardChanges } = changes
    const counts = collectionChangeCounts(cardChanges)

    /**
     * Record what went through — once the write lands, or on a dry run — and
     * say it: the count line and the per-card lines come from the changes the
     * result reports, so they describe only what happened.
     */
    const landed = (): void => {
      for (const change of cardChanges) results.record(name, change)
      added += counts.added
      removed += counts.removed
      emitListLines(emit, name, results.track(name).changes, name)
    }

    if (dryRun) {
      landed()
      emit({ kind: 'log', level: 'info', item: name, ...syncMessage('domain.sync.dryRunNotSaved') })
      results.succeed(name, 'dry-run', dryRunReason(describeCollectionChangeSummary(counts)))
      continue
    }

    try {
      writtenFiles.push(...(await store.apply(name, changes.changes)))
      landed()
      emit({ kind: 'log', level: 'info', item: name, ...syncMessage('domain.sync.saved') })
      results.succeed(name, 'changed')
    } catch (error: unknown) {
      const reason = syncMessage('domain.sync.saveFailed', { error: errorParam(error) })
      emit({ kind: 'log', level: 'error', item: name, ...reason })
      results.fail(name, reason)
      results.finish(name)
    }
  }

  return {
    writtenFiles,
    // A pull's only failures belong to a list — including a target list that
    // could not be resolved, which is reported under the name it was asked for.
    errors: [],
    ambiguous: plan.ambiguous,
    // The CSV path is a push's answer to a large batch of additions; a pull
    // writes list files, which have no such cost.
    csv: null,
    totals: { added, removed, skipped: plan.skipped, pending: 0 },
    aborted: false,
    cancelled,
    unresolvedAmbiguity: false,
  }
}

// ── Ambiguous removals ────────────────────────────────────────────────

/**
 * How an ambiguous removal's list was chosen: by the removal priority, or by the
 * resolver — the branch of its log line, read off the catalog.
 */
type RemovalPlacement = SelectBranch<'domain.sync.removingAmbiguous'>

/** List names in a message, joined without a conjunction (`A, B, C`). */
function listNames(names: readonly string[]): SyncListParam {
  return syncList([...names], 'unit')
}

/**
 * Resolve the run's removal priority to canonical list names, or the message
 * explaining why it cannot be used.
 *
 * Names are matched exactly (normalized), the way the pull target is: a priority
 * is a promise about which binders may lose cards, and the substring rule could
 * quietly take copies out of a neighbouring one. Every bad name is reported at
 * once, so a fixed run does not trip over the next typo.
 */
async function resolveRemovalPriority(
  store: CollectionListStore,
  removalPriority: readonly string[],
): Promise<string[] | SyncMessage> {
  if (removalPriority.length === 0) return []

  const resolved: string[] = []
  const problems: SyncMessage[] = []
  for (const name of removalPriority) {
    const matches = await listsNamed(store, name)
    if (matches.length === 0) {
      problems.push(syncMessage('domain.sync.priorityNoList', { name }))
    } else if (matches.length > 1) {
      problems.push(
        syncMessage('domain.sync.priorityAmbiguousList', { name, matches: listNames(matches) }),
      )
    } else if (!resolved.includes(matches[0]!)) {
      resolved.push(matches[0]!)
    }
  }

  return isNonEmpty(problems)
    ? syncMessage('domain.sync.priorityUnusable', {
        // Every bad name at once (see above), never a count of the rest.
        problems: nestSync(joinSyncMessages(problems, { complete: true })),
      })
    : resolved
}

/** The cards an unplaceable set of removals is about, for the failure message. */
function describeUnplaceable(unresolved: readonly AmbiguousRemoval[]): SyncListParam {
  return syncList(
    unresolved.map((entry) =>
      syncRef('domain.sync.unplacedCopies', {
        quantity: entry.quantity,
        card: describeSyncCard(entry.name, entry.parts),
      }),
    ),
    'and',
  )
}

/**
 * Place the plan's ambiguous removals, or return the message explaining why the
 * run cannot proceed.
 *
 * Precedence: a removal priority is the only strategy consulted when one was
 * given (it never prompts, even on a terminal); otherwise the caller's
 * {@link ResolveAmbiguousRemovals} decides; with neither, an ambiguous removal
 * fails the run. A dry run resolves nothing for real — it reports what a real
 * run would do, and never fails.
 */
async function placeAmbiguous(
  flow: SyncFlow,
  local: LocalCollectionIndex,
  ambiguous: readonly AmbiguousRemoval[],
  priority: readonly string[],
): Promise<PullRemoval[] | SyncMessage> {
  const { emit, dryRun } = flow
  /** A line as a preview prints it: tagged, so it is never read as done. */
  const preview = (line: SyncMessage): SyncMessage =>
    dryRun ? syncMessage('domain.sync.dryRunLine', { line: nestSync(line) }) : line

  const announce = (removals: readonly PullRemoval[], via: RemovalPlacement): void => {
    for (const removal of removals) {
      emit({
        kind: 'log',
        level: 'info',
        item: null,
        ...preview(
          syncMessage('domain.sync.removingAmbiguous', {
            via,
            quantity: removal.copies.length,
            card: describeSyncCard(removal.name, removal.parts),
            list: removal.list,
          }),
        ),
      })
    }
  }

  if (priority.length > 0) {
    const resolution = resolveAmbiguousByPriority(local, ambiguous, priority)
    if (resolution.ok) {
      announce(resolution.removals, 'priority')
      return resolution.removals
    }
    const message = syncMessage('domain.sync.priorityCannotPlace', {
      priority: listNames(priority),
      cards: describeUnplaceable(resolution.unresolved),
    })
    if (!dryRun) return message
    emit({ kind: 'log', level: 'warn', item: null, ...preview(message) })
    return []
  }

  if (dryRun) {
    // A preview neither prompts nor fails; it says what a real run would need.
    emit({
      kind: 'log',
      level: 'warn',
      item: null,
      ...preview(
        syncMessage('domain.sync.ambiguityPreview', { cards: describeUnplaceable(ambiguous) }),
      ),
    })
    return []
  }

  if (!flow.resolveAmbiguous) {
    return syncMessage('domain.sync.ambiguityUnresolved', { cards: describeUnplaceable(ambiguous) })
  }

  let outcome: AmbiguityResolutionOutcome
  try {
    outcome = await flow.resolveAmbiguous(ambiguous)
  } catch (error: unknown) {
    // A resolver that throws is a decision that was never made — refuse.
    return syncMessage('domain.sync.ambiguityResolverFailed', { error: errorParam(error) })
  }
  // The resolver's own wording — which of "no terminal", "declined", and
  // "cancelled" happened is the actionable part, and only it knows.
  if (!outcome.ok)
    return syncMessage('domain.sync.nothingWritten', { message: nestSync(outcome.message) })

  const resolution = applyRemovalAssignments(local, ambiguous, outcome.assignments)
  if (!resolution.ok) {
    return syncMessage('domain.sync.ambiguityResolutionIncomplete', {
      cards: describeUnplaceable(resolution.unresolved),
    })
  }
  announce(resolution.removals, 'resolved')
  return resolution.removals
}

// ── The pull target ───────────────────────────────────────────────────

/**
 * The lists answering exactly to a name (normalized), never by the substring
 * rule `store.resolve` applies — shared by the pull target and the removal
 * priority, both of which name a list that is about to be written to.
 */
async function listsNamed(store: CollectionListStore, name: string): Promise<string[]> {
  const normalized = normalizeListName(name)
  return (await store.allLists()).filter((list) => normalizeListName(list) === normalized)
}

/**
 * Everything a pull can check about its destination names before touching the
 * network: the removal priority resolves, and `--into` is not ambiguous.
 *
 * Both are purely local, so they run right after the lists load and *before* the
 * remote collection is paged in — a typo must not cost a multi-minute fetch
 * first. `--into` naming no list is fine (a pull creates it); `--into` naming
 * two is not, and only the user can say which they meant. The full target
 * resolution still happens later, when something is actually being added.
 *
 * Deliberately a gate rather than a resolver: the resolved names are recomputed
 * inside the flow, because `pullFromArchidekt` takes an injected store and must
 * not depend on this having run — the same reason {@link resolveTarget} repeats
 * its own ambiguity check. The store caches `allLists()`, so the repeat costs
 * nothing.
 */
export async function validatePullDestinations(
  store: CollectionListStore,
  into: string,
  removalPriority: readonly string[],
): Promise<SyncMessage | null> {
  const priority = await resolveRemovalPriority(store, removalPriority)
  if (isSyncMessage(priority)) return priority

  const matches = await listsNamed(store, into)
  if (matches.length > 1) {
    return syncMessage('domain.sync.pullTargetAmbiguous', {
      name: into,
      matches: listNames(matches),
    })
  }
  return null
}

/** The pull target, created when it does not exist yet, or the reason it could not be. */
type PullTarget = { name: string; writtenFiles: string[] }

async function resolveTarget(flow: SyncFlow): Promise<PullTarget | SyncMessage> {
  const { store, emit, dryRun, into } = flow
  // The target is a destination rather than a lookup, so it is matched by name
  // only — never by the substring rule `store.resolve` applies. The default
  // target `Inbox` would otherwise silently resolve to an unrelated
  // `card-inbox` binder and pull a stranger's cards into it.
  const matches = await listsNamed(store, into)
  if (matches.length === 1) return { name: matches[0]!, writtenFiles: [] }
  if (matches.length > 1) {
    // Two lists answer to the name — creating a third would be worse than
    // stopping, and only the user can say which they meant. A run through
    // `runCollectionSync` has already refused this at
    // {@link validatePullDestinations}; the branch stands because the store is
    // injectable and this function must not depend on that gate having run.
    return syncMessage('domain.sync.pullTargetAmbiguous', {
      name: into,
      matches: listNames(matches),
    })
  }

  if (dryRun) {
    emit({
      kind: 'log',
      level: 'info',
      item: null,
      ...syncMessage('domain.sync.dryRunCreateTarget', { name: into }),
    })
    return { name: into, writtenFiles: [] }
  }

  const created = await store.create(into)
  if (isSyncMessage(created)) {
    return syncMessage('domain.sync.createTargetFailed', { name: into, error: nestSync(created) })
  }
  emit({
    kind: 'log',
    level: 'info',
    item: null,
    ...syncMessage('domain.sync.createdTarget', { name: created.name }),
  })
  return { name: created.name, writtenFiles: created.writtenFiles }
}

/**
 * Name pulled cards the way the cache spells them.
 *
 * Archidekt reports the oracle name, while list files (and the cache) use the
 * full Scryfall name — `Front // Back` for split and double-faced cards — so a
 * pulled line written under the oracle name would not resolve to a card. The
 * printing is looked up by its Scryfall id, which every record carries; a
 * printing the cache does not hold falls back to the oracle name.
 */
async function pulledNameResolver(
  flow: SyncFlow,
  additions: readonly PullAddition[],
): Promise<PulledCardName> {
  if (additions.length === 0) return (addition) => addition.name
  let cards: Map<string, ScryfallCard>
  try {
    cards = await flow.lookupByScryfallId(additions.map((addition) => addition.scryfallId))
  } catch (error: unknown) {
    flow.emit({
      kind: 'log',
      level: 'warn',
      item: null,
      ...syncMessage('domain.sync.scryfallCacheUnreadable', { error: errorParam(error) }),
    })
    return (addition) => addition.name
  }
  return (addition) => cards.get(addition.scryfallId)?.name ?? addition.name
}
