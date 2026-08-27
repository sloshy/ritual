/**
 * @fileoverview The pull half of the collection-sync engine (Archidekt →
 * local): placing remote additions into the target list, resolving removals
 * that span several lists, and validating pull destinations before anything
 * is written.
 */

import { getErrorMessage } from '../util/errors'
import { t } from '../i18n/t'
import { normalizeListName } from '../list/resolve-list'
import { describeSkippedChanges } from '../sync/common'
import type { ScryfallCard } from '../scryfall/types'
import { describeAmbiguousRemoval, describeCollectionKey, type AmbiguousRemoval } from './describe'
import {
  applyRemovalAssignments,
  planPull,
  pullChangesByList,
  resolveAmbiguousByPriority,
  type LocalCollectionIndex,
  type PullAddition,
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
  if (skippedMessage) emit({ kind: 'log', level: 'info', list: null, message: skippedMessage })

  let target = flow.into
  let applicable = plan

  /**
   * Give up on the whole pull. Nothing has been written at this point — not a
   * list, not the target list a pull creates, not the sync timestamp — which is
   * what `aborted` tells `runCollectionSync`.
   */
  const abort = (message: string): FlowOutcome => {
    emit({ kind: 'log', level: 'error', list: null, message })
    return abortedOutcome([message], plan.ambiguous)
  }

  // Ambiguity is settled before anything is written: a run that cannot place
  // every ambiguous removal writes nothing at all, so a half-made decision can
  // never reach a list file.
  const priority = await resolveRemovalPriority(flow.store, flow.removalPriority)
  if (typeof priority === 'string') return abort(priority)

  for (const ambiguous of plan.ambiguous) {
    emit({ kind: 'log', level: 'warn', list: null, message: describeAmbiguousRemoval(ambiguous) })
  }

  if (plan.ambiguous.length > 0) {
    const placed = await placeAmbiguous(flow, local, plan.ambiguous, priority)
    if (typeof placed === 'string') return abort(placed)
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
      list: null,
      message: `Not adding ${t('domain.count.copies', { count: copies })}: some collection lists in scope could not be read, so cards they already hold would be duplicated into "${flow.into}". Fix or accept those lists and run again.`,
    })
    applicable = { ...applicable, additions: [] }
  }

  // The target list is only needed — and only created — when something is
  // actually being added. When it cannot be resolved, the additions are
  // dropped (they have nowhere to go) and the removals still apply.
  if (applicable.additions.length > 0) {
    const resolved = await resolveTarget(flow)
    if (typeof resolved === 'string') {
      emit({ kind: 'log', level: 'error', list: null, message: resolved })
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
  for (const [index, name] of ordered.entries()) {
    emit({ kind: 'list-start', list: name, index, total: ordered.length })
    const changes = changesByList.get(name)
    if (!changes || changes.changes.length === 0) {
      emit({ kind: 'log', level: 'info', list: name, message: 'No changes.' })
      results.finish(name, 'no changes')
      continue
    }

    const summary = `+${changes.added} added, -${changes.removed} removed`
    emit({ kind: 'log', level: 'info', list: name, message: `Changes: ${summary}` })

    // Counted only once the write lands, so the totals describe what happened
    // rather than what was planned.
    const countChanges = (): void => {
      const entry = results.track(name)
      entry.added += changes.added
      entry.removed += changes.removed
      added += changes.added
      removed += changes.removed
    }

    if (dryRun) {
      countChanges()
      emit({ kind: 'log', level: 'info', list: name, message: '[dry-run] Not saved.' })
      results.finish(name, `dry-run: ${summary}`)
      continue
    }

    try {
      writtenFiles.push(...(await store.apply(name, changes.changes)))
      countChanges()
      emit({ kind: 'log', level: 'info', list: name, message: 'Saved.' })
      results.finish(name)
    } catch (error: unknown) {
      const reason = `Failed to save: ${getErrorMessage(error)}`
      emit({ kind: 'log', level: 'error', list: name, message: reason })
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
  }
}

// ── Ambiguous removals ────────────────────────────────────────────────

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
): Promise<string[] | string> {
  if (removalPriority.length === 0) return []

  const resolved: string[] = []
  const problems: string[] = []
  for (const name of removalPriority) {
    const matches = await listsNamed(store, name)
    if (matches.length === 0) {
      problems.push(`no collection list is named "${name}"`)
    } else if (matches.length > 1) {
      problems.push(`more than one collection list is named "${name}": ${matches.join(', ')}`)
    } else if (!resolved.includes(matches[0]!)) {
      resolved.push(matches[0]!)
    }
  }

  return problems.length > 0 ? `Cannot use the removal priority: ${problems.join('; ')}.` : resolved
}

/** The cards an unplaceable set of removals is about, for the failure message. */
function describeUnplaceable(unresolved: readonly AmbiguousRemoval[]): string {
  return unresolved
    .map((entry) => `${entry.quantity} × ${describeCollectionKey(entry.name, entry.parts)}`)
    .join(', ')
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
): Promise<PullRemoval[] | string> {
  const { emit, dryRun } = flow
  const preview = dryRun ? '[dry-run] ' : ''

  const announce = (removals: readonly PullRemoval[], reason: string): void => {
    for (const removal of removals) {
      emit({
        kind: 'log',
        level: 'info',
        list: null,
        message: `${preview}Removing ${removal.copies.length} × ${describeCollectionKey(removal.name, removal.parts)} from "${removal.list}" (${reason}).`,
      })
    }
  }

  if (priority.length > 0) {
    const resolution = resolveAmbiguousByPriority(local, ambiguous, priority)
    if (resolution.ok) {
      announce(resolution.removals, 'removal priority')
      return resolution.removals
    }
    const message = `The removal priority (${priority.join(', ')}) cannot place ${describeUnplaceable(resolution.unresolved)}. Nothing was written.`
    if (!dryRun) return message
    emit({ kind: 'log', level: 'warn', list: null, message: `${preview}${message}` })
    return []
  }

  if (dryRun) {
    // A preview neither prompts nor fails; it says what a real run would need.
    emit({
      kind: 'log',
      level: 'warn',
      list: null,
      message: `${preview}A real run would refuse to place ${describeUnplaceable(ambiguous)} until the ambiguity is resolved.`,
    })
    return []
  }

  if (!flow.resolveAmbiguous) {
    return `Could not place ${describeUnplaceable(ambiguous)}: the removals are ambiguous and were not resolved. Nothing was written.`
  }

  let outcome: AmbiguityResolutionOutcome
  try {
    outcome = await flow.resolveAmbiguous(ambiguous)
  } catch (error: unknown) {
    // A resolver that throws is a decision that was never made — refuse.
    return `Could not resolve the ambiguous removals: ${getErrorMessage(error)}. Nothing was written.`
  }
  // The resolver's own wording — which of "no terminal", "declined", and
  // "cancelled" happened is the actionable part, and only it knows.
  if (!outcome.ok) return `${outcome.message} Nothing was written.`

  const resolution = applyRemovalAssignments(local, ambiguous, outcome.assignments)
  if (!resolution.ok) {
    return `Could not place ${describeUnplaceable(resolution.unresolved)}: the resolution did not say which lists lose those copies. Nothing was written.`
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
): Promise<string | null> {
  const priority = await resolveRemovalPriority(store, removalPriority)
  if (typeof priority === 'string') return priority

  const matches = await listsNamed(store, into)
  if (matches.length > 1) {
    return `More than one collection list is named "${into}": ${matches.join(', ')}. Point --into (or collectionSync.pullTarget) at one of them.`
  }
  return null
}

/** The pull target, created when it does not exist yet, or the reason it could not be. */
type PullTarget = { name: string; writtenFiles: string[] }

async function resolveTarget(flow: SyncFlow): Promise<PullTarget | string> {
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
    return `More than one collection list is named "${into}": ${matches.join(', ')}. Point --into (or collectionSync.pullTarget) at one of them.`
  }

  if (dryRun) {
    emit({
      kind: 'log',
      level: 'info',
      list: null,
      message: `[dry-run] Would create collection list "${into}" for the cards being added.`,
    })
    return { name: into, writtenFiles: [] }
  }

  const created = await store.create(into)
  if (typeof created === 'string') {
    return `Could not create the collection list "${into}": ${created}`
  }
  emit({
    kind: 'log',
    level: 'info',
    list: null,
    message: `Created collection list "${created.name}" for the cards being added.`,
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
): Promise<(addition: PullAddition) => string> {
  if (additions.length === 0) return (addition) => addition.name
  let cards: Map<string, ScryfallCard>
  try {
    cards = await flow.lookupByScryfallId(additions.map((addition) => addition.scryfallId))
  } catch (error: unknown) {
    flow.emit({
      kind: 'log',
      level: 'warn',
      list: null,
      message: `Could not read the Scryfall cache: ${getErrorMessage(error)}`,
    })
    return (addition) => addition.name
  }
  return (addition) => cards.get(addition.scryfallId)?.name ?? addition.name
}
