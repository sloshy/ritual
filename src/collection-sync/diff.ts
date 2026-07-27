/**
 * Pure diff and planning logic for `ritual collection-sync` — the collection
 * counterpart to `deck-sync/diff.ts`.
 *
 * Where deck sync compares one deck file against one Archidekt deck by card
 * name, a collection sync compares the **union of the in-scope collection
 * lists** against the account's single Archidekt collection, joined on the
 * printing-level key `(set, collectorNumber, finish, condition)`. Two things
 * follow from that and shape every type here:
 *
 * - **Locally, one line is one physical copy** (`parseCollectionFile` reads
 *   every line as `quantity: 1`), so a key's local quantity is a count of lines
 *   and each copy remembers which list and which line it came from. That is
 *   what lets a pull remove the right binder's tail lines — and what makes a
 *   *partial* removal ambiguous when the copies span several binders (taking
 *   every copy never is: each binder simply loses what it holds).
 * - **Remotely, one printing may span several records** that differ only by
 *   language, tags, or purchase price. They aggregate into one key for the
 *   diff, but the record list is kept intact: the push planner needs it to
 *   decide which record to grow, trim, or delete.
 *
 * Everything in this module is pure (the one async function takes its Scryfall
 * lookup as a parameter), so the semantics are unit-testable without a client,
 * a cache, or the filesystem.
 */

import { printingSuffix } from '../card-line'
import { findPrinting, type CardPrintingsLookup } from '../card-printing'
import { createAddChange, createRemoveChange } from '../change-event'
import { resolveFinish, type CollectionEntry } from '../collection-file'
import {
  ARCHIDEKT_GAME_PAPER,
  ARCHIDEKT_LANGUAGE_ENGLISH,
  archidektConditionId,
  archidektModifier,
  parseArchidektCondition,
  parseArchidektModifier,
  type ArchidektCollectionRecord,
  type CollectionUpsertBody,
} from '../importers/archidekt-collection'
import type { CardMutationChange } from '../list-mutate'
import type { SyncChangeFilter } from '../sync-common'
import type { ScryfallCard } from '../types'
// Deliberately imported rather than re-exported: `describe.ts` is the leaf with
// no filesystem or network imports, and it stays the one place the browser
// bundle reaches for these — a re-export here would put this module (and the
// Archidekt client types it pulls in) one autocomplete away from the SPA.
import type { AmbiguousRemoval, CollectionKeyParts } from './describe'

// ── The join key ──────────────────────────────────────────────────────

/**
 * The join key for a printing+variant: `set|collectorNumber|finish|condition`,
 * with set and collector number lowercased so the two sides cannot miss each
 * other over casing alone. Names are deliberately *not* part of the key — the
 * two sides disagree about them (Archidekt reports the oracle name, Scryfall
 * the full `Front // Back` name), while set and collector number always agree.
 */
export function collectionKey(parts: CollectionKeyParts): string {
  return [
    parts.set.toLowerCase(),
    parts.collectorNumber.toLowerCase(),
    parts.finish,
    parts.condition,
  ].join('|')
}

// ── Local side ────────────────────────────────────────────────────────

/** One physical copy of a card: one line in one collection list. */
export type LocalCopy = {
  /** The list the line lives in (file basename, the identifier lists are addressed by). */
  list: string
  /** The card name as the line spells it. */
  name: string
  parts: CollectionKeyParts
  /** The line's stable `&N` id, when the file carries one. */
  cardId?: number
  /** Position of the line within its list, so removals can take the tail. */
  fileOrder: number
}

/** Every in-scope copy of one key, and the lists they live in. */
export type LocalKeyGroup = {
  key: string
  parts: CollectionKeyParts
  /** The name the first copy spells; what a push searches Archidekt for. */
  name: string
  /**
   * The copies, in scope order then file order. `copies.length` is the local
   * quantity. Non-empty: a group only exists because a copy created it, and both
   * arrays only ever grow.
   */
  copies: [LocalCopy, ...LocalCopy[]]
  /** Distinct lists holding a copy, in first-seen order. One list means removals are unambiguous. */
  lists: [string, ...string[]]
}

export type LocalCollectionIndex = Map<string, LocalKeyGroup>

/** One loaded collection list: its identifying name and the lines the parser read. */
export type LocalListEntries = {
  name: string
  entries: readonly CollectionEntry[]
}

/** A canonicalization warning, attributed to the list whose line caused it. */
export type LocalIndexWarning = { list: string; message: string }

export type LocalIndexResult = {
  index: LocalCollectionIndex
  warnings: LocalIndexWarning[]
}

/**
 * Index the in-scope lists by sync key, one entry per physical copy.
 *
 * A line without an explicit `[finish]` is canonicalized through
 * {@link resolveFinish} against the cached printing, so an etched-only printing
 * (Archidekt's `Etched` modifier, its own collector number) compares as
 * `etched` rather than sliding to `nonfoil` and reading as a different card.
 * A printing the cache does not hold canonicalizes to `nonfoil` with a warning
 * — the sync still runs, it just says which line it had to guess about.
 */
export async function buildLocalIndex(
  lists: readonly LocalListEntries[],
  lookup: CardPrintingsLookup,
): Promise<LocalIndexResult> {
  const index: LocalCollectionIndex = new Map()
  const warnings: LocalIndexWarning[] = []

  // One lookup per distinct name per run: a collection list repeats names often
  // (several copies, several printings), and the lookup is a cache read.
  const printingsByName = new Map<string, ScryfallCard[]>()
  const printingsFor = async (name: string): Promise<ScryfallCard[]> => {
    const memoKey = name.toLowerCase()
    const cached = printingsByName.get(memoKey)
    if (cached) return cached
    const printings = await lookup(name)
    printingsByName.set(memoKey, printings)
    return printings
  }

  for (const list of lists) {
    for (const [fileOrder, entry] of list.entries.entries()) {
      const set = entry.set.toLowerCase()
      let finish = entry.finish
      if (!finish) {
        const card = findPrinting(await printingsFor(entry.name), set, entry.collectorNumber)
        if (card) {
          finish = resolveFinish(entry, card)
        } else {
          finish = 'nonfoil'
          warnings.push({
            list: list.name,
            message: `${entry.name}${printingSuffix(set, entry.collectorNumber)} is not in the Scryfall cache; syncing it as nonfoil.`,
          })
        }
      }

      const parts: CollectionKeyParts = {
        set,
        collectorNumber: entry.collectorNumber,
        finish,
        condition: entry.condition ?? 'NM',
      }
      const key = collectionKey(parts)
      const copy: LocalCopy = {
        list: list.name,
        name: entry.name,
        parts,
        cardId: entry.cardId,
        fileOrder,
      }

      const group = index.get(key)
      if (group) {
        group.copies.push(copy)
        if (!group.lists.includes(list.name)) group.lists.push(list.name)
      } else {
        index.set(key, { key, parts, name: entry.name, copies: [copy], lists: [list.name] })
      }
    }
  }

  return { index, warnings }
}

// ── Remote side ───────────────────────────────────────────────────────

/** Every remote record that aggregates into one key. */
export type RemoteKeyGroup = {
  key: string
  parts: CollectionKeyParts
  /** The oracle name Archidekt reports; a pull resolves the Scryfall name before writing. */
  name: string
  /** Scryfall id of the printing, for resolving that name against the cache. */
  scryfallId: string
  /**
   * The records behind this key, in fetch order. Records differing only by
   * language, tags, or purchase price land here together — the push planner
   * decides which of them to grow, trim, or delete.
   */
  records: ArchidektCollectionRecord[]
  /** Summed quantity across {@link records}. */
  quantity: number
}

export type RemoteCollectionIndex = Map<string, RemoteKeyGroup>

export type RemoteIndexResult = {
  index: RemoteCollectionIndex
  /** One message per record that could not be read; those records are skipped. */
  warnings: string[]
}

/**
 * Index fetched collection records by sync key, summing the quantities of
 * records that differ only in dimensions Ritual does not model.
 *
 * A record whose modifier, condition, or printing cannot be read is skipped
 * with a warning rather than guessed at — the alternative is silently syncing
 * a card as the wrong variant.
 */
export function buildRemoteIndex(records: readonly ArchidektCollectionRecord[]): RemoteIndexResult {
  const index: RemoteCollectionIndex = new Map()
  const warnings: string[] = []

  for (const record of records) {
    // The wire JSON is cast rather than validated by the client, so every nested
    // read is guarded: one malformed row must degrade to a warning naming its
    // record id, not throw out of the whole run.
    const name = record.card?.oracleCard?.name
    const set = record.card?.edition?.editioncode?.toLowerCase() ?? ''
    const collectorNumber = record.card?.collectorNumber
    if (!name || !set || !collectorNumber) {
      warnings.push(
        `Skipping Archidekt record ${record.id}: it does not name a card, set code, and collector number.`,
      )
      continue
    }

    const finish = parseArchidektModifier(record.modifier)
    if (!finish.ok) {
      warnings.push(`Skipping Archidekt record ${record.id} (${name}): ${finish.message}`)
      continue
    }

    const condition = parseArchidektCondition(record.condition)
    if (!condition.ok) {
      warnings.push(`Skipping Archidekt record ${record.id} (${name}): ${condition.message}`)
      continue
    }

    const parts: CollectionKeyParts = {
      set,
      collectorNumber,
      finish: finish.value,
      condition: condition.value,
    }
    const key = collectionKey(parts)
    const group = index.get(key)
    if (group) {
      group.records.push(record)
      group.quantity += record.quantity
    } else {
      index.set(key, {
        key,
        parts,
        name,
        scryfallId: record.card.uid,
        records: [record],
        quantity: record.quantity,
      })
    }
  }

  return { index, warnings }
}

// ── Pull planning (Archidekt → local) ─────────────────────────────────

/** Copies a pull must write into the target list. */
export type PullAddition = {
  key: string
  parts: CollectionKeyParts
  /** The oracle name Archidekt reports; {@link PulledCardName} may improve on it. */
  name: string
  /** Scryfall id of the printing, for resolving the name against the cache. */
  scryfallId: string
  /** How many copies to add. */
  quantity: number
}

/**
 * Copies a pull must delete from one list. A key whose copies span several lists
 * produces one removal per list — either because every copy is going (a total
 * removal, which is never ambiguous) or because an ambiguity-resolution strategy
 * decided which lists give copies up.
 */
export type PullRemoval = {
  key: string
  parts: CollectionKeyParts
  name: string
  /** The list these copies live in. */
  list: string
  /** The copies to remove — that list's tail lines for the key. */
  copies: LocalCopy[]
}

/** One list's share of a key's copies, in file order. */
export type ListCopies = {
  list: string
  copies: LocalCopy[]
}

/**
 * Split a key's copies by the list they live in, in first-seen list order and
 * file order within each list — the order a removal consumes them in reverse,
 * so the tail lines are the ones that go.
 */
export function copiesByList(group: LocalKeyGroup): ListCopies[] {
  const byList = new Map<string, LocalCopy[]>()
  for (const copy of group.copies) {
    const existing = byList.get(copy.list)
    if (existing) existing.push(copy)
    else byList.set(copy.list, [copy])
  }
  return group.lists.map((list) => ({ list, copies: byList.get(list) ?? [] }))
}

export type PullPlan = {
  additions: PullAddition[]
  removals: PullRemoval[]
  ambiguous: AmbiguousRemoval[]
  /** How many changes the `only` filter dropped, for the run's log line. */
  skipped: number
}

/** One list's removal entry for a key, carrying the copies it gives up. */
function removalOf(group: LocalKeyGroup, list: string, copies: LocalCopy[]): PullRemoval {
  return { key: group.key, parts: group.parts, name: group.name, list, copies }
}

/**
 * Plan a pull: the remote collection is the truth, the in-scope lists are
 * reshaped to match.
 *
 * The `only` filter is applied *before* the ambiguity check, so a run narrowed
 * to additions never reports removals it was never going to make.
 */
export function planPull(
  local: LocalCollectionIndex,
  remote: RemoteCollectionIndex,
  only?: SyncChangeFilter,
): PullPlan {
  const additions: PullAddition[] = []
  const removals: PullRemoval[] = []
  const ambiguous: AmbiguousRemoval[] = []
  let skipped = 0

  const keepAdditions = only !== 'removals'
  const keepRemovals = only !== 'additions'

  /** Place a removal of `quantity` copies, or record that it needs a decision. */
  const removeCopies = (group: LocalKeyGroup, quantity: number): void => {
    if (!keepRemovals) {
      skipped++
      return
    }
    const shares = copiesByList(group)

    // A *total* removal — every in-scope copy goes, which is what every key the
    // remote does not hold at all amounts to — is never ambiguous however many
    // lists are involved: there is nothing to choose between, each list simply
    // loses everything it holds.
    if (quantity >= group.copies.length) {
      for (const share of shares) {
        removals.push(removalOf(group, share.list, share.copies))
      }
      return
    }

    // A partial removal whose copies all live in one list takes its tail lines.
    const single = shares[0]
    if (shares.length === 1 && single) {
      removals.push(removalOf(group, single.list, single.copies.slice(-quantity)))
      return
    }

    // A partial removal spanning several lists is genuinely ambiguous: nothing
    // in the data says which binder the card physically left.
    ambiguous.push({
      key: group.key,
      parts: group.parts,
      name: group.name,
      quantity,
      lists: shares.map((share) => ({ list: share.list, copies: share.copies.length })),
    })
  }

  for (const [key, group] of remote) {
    const localGroup = local.get(key)
    const localQuantity = localGroup?.copies.length ?? 0
    if (group.quantity > localQuantity) {
      if (keepAdditions) {
        additions.push({
          key,
          parts: group.parts,
          name: group.name,
          scryfallId: group.scryfallId,
          quantity: group.quantity - localQuantity,
        })
      } else {
        skipped++
      }
    } else if (group.quantity < localQuantity && localGroup) {
      removeCopies(localGroup, localQuantity - group.quantity)
    }
  }

  for (const [key, group] of local) {
    if (remote.has(key)) continue
    removeCopies(group, group.copies.length)
  }

  return { additions, removals, ambiguous, skipped }
}

// ── Ambiguity resolution ──────────────────────────────────────────────

/** How many copies of one ambiguous removal a single list gives up. */
export type RemovalChoice = {
  list: string
  copies: number
}

/**
 * A complete decision for one ambiguous removal — which lists lose copies, and
 * how many each. Produced by an interactive session (the CLI walks the copies
 * one at a time) and applied by {@link applyRemovalAssignments}.
 */
export type RemovalAssignment = {
  /** The ambiguous removal's key. */
  key: string
  /** The lists losing copies; the counts must sum to the removal's quantity. */
  choices: RemovalChoice[]
}

/**
 * The outcome of placing ambiguous removals.
 *
 * Resolution is **all-or-nothing**: a strategy that cannot place every removal
 * reports the ones it could not and produces no removals at all, because a
 * caller must never write half a decision.
 */
export type AmbiguityResolution =
  | { ok: true; removals: PullRemoval[] }
  | { ok: false; unresolved: AmbiguousRemoval[] }

/**
 * Choose which lists lose copies for one ambiguous removal, or `null` when this
 * strategy cannot place it.
 */
type ChooseRemovalLists = (
  entry: AmbiguousRemoval,
  shares: readonly ListCopies[],
) => RemovalChoice[] | null

/**
 * Turn a strategy's per-removal choices into ordinary removal entries, keeping
 * the all-or-nothing rule: one removal the strategy cannot place sinks the whole
 * resolution, so the caller either applies every ambiguous removal or none.
 */
function placeAmbiguousRemovals(
  local: LocalCollectionIndex,
  ambiguous: readonly AmbiguousRemoval[],
  choose: ChooseRemovalLists,
): AmbiguityResolution {
  const removals: PullRemoval[] = []
  const unresolved: AmbiguousRemoval[] = []

  for (const entry of ambiguous) {
    const group = local.get(entry.key)
    // The index the ambiguity was planned from is the one being resolved, so a
    // key that is not in it means the two came from different runs.
    if (!group) {
      unresolved.push(entry)
      continue
    }
    const shares = copiesByList(group)
    const choices = choose(entry, shares)
    if (!choices) {
      unresolved.push(entry)
      continue
    }
    for (const choice of choices) {
      // A zero take is not a removal — and `slice(-0)` would take every copy.
      if (choice.copies <= 0) continue
      const share = shares.find((candidate) => candidate.list === choice.list)
      if (!share) continue
      removals.push(removalOf(group, choice.list, share.copies.slice(-choice.copies)))
    }
  }

  return unresolved.length > 0 ? { ok: false, unresolved } : { ok: true, removals }
}

/**
 * Place ambiguous removals from an ordered list of collection lists: copies may
 * come **only** from the named lists, walking them in priority order and taking
 * each list's tail lines first.
 *
 * A removal the priority cannot fully cover — its copies live elsewhere, or the
 * priority lists hold too few of them — is reported as unresolved, which makes
 * the whole resolution fail.
 */
export function resolveAmbiguousByPriority(
  local: LocalCollectionIndex,
  ambiguous: readonly AmbiguousRemoval[],
  priority: readonly string[],
): AmbiguityResolution {
  // A list named twice must not hand over the same copies twice.
  const ordered = [...new Set(priority)]

  return placeAmbiguousRemovals(local, ambiguous, (entry, shares) => {
    const choices: RemovalChoice[] = []
    let outstanding = entry.quantity
    for (const list of ordered) {
      if (outstanding === 0) break
      const share = shares.find((candidate) => candidate.list === list)
      if (!share || share.copies.length === 0) continue
      const copies = Math.min(outstanding, share.copies.length)
      choices.push({ list, copies })
      outstanding -= copies
    }
    return outstanding === 0 ? choices : null
  })
}

/**
 * Place ambiguous removals from an explicit per-list assignment, as an
 * interactive session produces.
 *
 * The assignment is validated rather than trusted: a removal with no assignment,
 * one naming a list that holds no copies of the key, one asking a list for more
 * copies than it holds, one asking for a fraction of a copy, or one whose counts
 * do not add up to the removal's quantity is reported as unresolved — which
 * fails the whole resolution.
 */
export function applyRemovalAssignments(
  local: LocalCollectionIndex,
  ambiguous: readonly AmbiguousRemoval[],
  assignments: readonly RemovalAssignment[],
): AmbiguityResolution {
  const byKey = new Map(assignments.map((assignment) => [assignment.key, assignment]))

  return placeAmbiguousRemovals(local, ambiguous, (entry, shares) => {
    const assignment = byKey.get(entry.key)
    if (!assignment) return null

    // Summed per list, so an assignment naming the same list twice is read as
    // one take of the combined size rather than two overlapping ones.
    const taken = new Map<string, number>()
    for (const choice of assignment.choices) {
      // Copies are whole physical cards. A fraction would slip past both counts
      // below and then reach `slice(-0.5)`, which takes the whole list.
      if (!Number.isInteger(choice.copies)) return null
      if (choice.copies <= 0) continue
      const share = shares.find((candidate) => candidate.list === choice.list)
      if (!share) return null
      const total = (taken.get(choice.list) ?? 0) + choice.copies
      if (total > share.copies.length) return null
      taken.set(choice.list, total)
    }

    const placed = [...taken.values()].reduce((total, copies) => total + copies, 0)
    if (placed !== entry.quantity) return null
    return [...taken].map(([list, copies]) => ({ list, copies }))
  })
}

/** The name a pulled printing is written under; see `pulledNameResolver` in the engine. */
export type PulledCardName = (addition: PullAddition) => string

/** One list's share of a pull, ready for `applyChangesToListFile`. */
export type PullListChanges = {
  list: string
  changes: CardMutationChange[]
  /** Copies added to this list. */
  added: number
  /** Copies removed from this list. */
  removed: number
}

/**
 * Turn a pull plan into per-list `ChangeEvent`s — the same events the admin
 * editors emit, so `&N` allocation, changelog entries, and hash sidecars behave
 * identically on a sync.
 *
 * Additions all land in `targetList` (a pulled card belongs in *some* binder and
 * only the user knows which); each removal lands in the list it names. Removals
 * are emitted before additions for a list that receives both, so a reused `&N`
 * id cannot be handed to a new line before the old one releases it.
 */
export function pullChangesByList(
  plan: PullPlan,
  targetList: string,
  resolveName: PulledCardName,
): PullListChanges[] {
  const byList = new Map<string, PullListChanges>()
  const forList = (list: string): PullListChanges => {
    const existing = byList.get(list)
    if (existing) return existing
    const created: PullListChanges = { list, changes: [], added: 0, removed: 0 }
    byList.set(list, created)
    return created
  }

  for (const removal of plan.removals) {
    const entry = forList(removal.list)
    // Tail lines first, so removing several copies never renumbers a line this
    // same batch still has to find.
    for (const copy of [...removal.copies].reverse()) {
      entry.changes.push(
        createRemoveChange(copy.name, {
          set: copy.parts.set,
          collectorNumber: copy.parts.collectorNumber,
          finish: copy.parts.finish,
          condition: copy.parts.condition,
          cardId: copy.cardId,
        }),
      )
      entry.removed++
    }
  }

  for (const addition of plan.additions) {
    const entry = forList(targetList)
    const name = resolveName(addition)
    for (let i = 0; i < addition.quantity; i++) {
      entry.changes.push(
        createAddChange(name, {
          set: addition.parts.set,
          collectorNumber: addition.parts.collectorNumber,
          finish: addition.parts.finish,
          condition: addition.parts.condition,
        }),
      )
      entry.added++
    }
  }

  return [...byList.values()]
}

// ── Push planning (local → Archidekt) ─────────────────────────────────

/** Fields every push operation carries: what it is about, and who it belongs to. */
type PushOperationBase = {
  key: string
  parts: CollectionKeyParts
  name: string
  /**
   * The in-scope lists holding copies of this key, in first-seen order. Empty
   * when the key is gone from every list — the operation then belongs to the
   * run rather than to a list. The first entry owns the operation's execution;
   * a failure is reported against all of them, since a card split across two
   * binders is equally unpushed from either.
   */
  lists: string[]
}

/** A key with no remote counterpart: resolve the printing, then create a record. */
export type PushCreate = PushOperationBase & {
  kind: 'create'
  quantity: number
}

/** A record whose quantity must change: grown to absorb new copies, or trimmed. */
export type PushUpdate = PushOperationBase & {
  kind: 'update'
  record: ArchidektCollectionRecord
  /** The record's new quantity. */
  quantity: number
  /** Signed change in copies: positive grows the collection, negative shrinks it. */
  delta: number
}

/** Records to delete outright — a shrink that consumed them, or a key gone locally. */
export type PushDelete = PushOperationBase & {
  kind: 'delete'
  /** The records to delete, in the order the shrink consumed them (tail first). */
  records: ArchidektCollectionRecord[]
  /** Copies removed by the deletion — the summed quantity of {@link records}. */
  removed: number
}

export type PushOperation = PushCreate | PushUpdate | PushDelete

export type PushPlan = {
  operations: PushOperation[]
  /** How many keys the `only` filter dropped, for the run's log line. */
  skipped: number
}

/**
 * The order records are consumed in: English first (the language Ritual writes,
 * and the one a user is most likely to be holding), then by quantity descending,
 * then by id so the plan is stable across runs. Growing patches the first
 * record; shrinking walks in from the end, so the odd-language and small
 * records are the ones that disappear.
 */
export function orderRecordsForPush(
  records: readonly ArchidektCollectionRecord[],
): ArchidektCollectionRecord[] {
  return [...records].sort((a, b) => {
    const aEnglish = a.language === ARCHIDEKT_LANGUAGE_ENGLISH ? 0 : 1
    const bEnglish = b.language === ARCHIDEKT_LANGUAGE_ENGLISH ? 0 : 1
    if (aEnglish !== bEnglish) return aEnglish - bEnglish
    if (a.quantity !== b.quantity) return b.quantity - a.quantity
    return a.id - b.id
  })
}

/**
 * Plan a push: the union of the in-scope lists is the truth, and the account's
 * records are reshaped to match it.
 *
 * Growth is a single PATCH of the leading record; a shrink walks the ordered
 * records from the end, deleting the ones it fully consumes and trimming the
 * one it partially consumes; a key that is gone locally has all of its records
 * deleted. `/api/collection/clear/` is never involved.
 */
export function planPush(
  local: LocalCollectionIndex,
  remote: RemoteCollectionIndex,
  only?: SyncChangeFilter,
): PushPlan {
  const operations: PushOperation[] = []
  let skipped = 0

  const keepAdditions = only !== 'removals'
  const keepRemovals = only !== 'additions'

  for (const [key, group] of local) {
    const localQuantity = group.copies.length
    const remoteGroup = remote.get(key)

    if (!remoteGroup) {
      if (!keepAdditions) {
        skipped++
        continue
      }
      operations.push({
        kind: 'create',
        key,
        parts: group.parts,
        name: group.name,
        lists: group.lists,
        quantity: localQuantity,
      })
      continue
    }

    if (remoteGroup.quantity === localQuantity) continue

    const ordered = orderRecordsForPush(remoteGroup.records)
    const base: PushOperationBase = {
      key,
      parts: group.parts,
      name: group.name,
      lists: group.lists,
    }

    if (remoteGroup.quantity < localQuantity) {
      if (!keepAdditions) {
        skipped++
        continue
      }
      const grown = ordered[0]!
      const delta = localQuantity - remoteGroup.quantity
      operations.push({
        ...base,
        kind: 'update',
        record: grown,
        quantity: grown.quantity + delta,
        delta,
      })
      continue
    }

    if (!keepRemovals) {
      skipped++
      continue
    }

    // Shrink from the tail: whole records go, and the record that only partly
    // covers what is left over is trimmed rather than deleted.
    let excess = remoteGroup.quantity - localQuantity
    const doomed: ArchidektCollectionRecord[] = []
    let trimmed: PushUpdate | undefined
    for (let i = ordered.length - 1; i >= 0 && excess > 0; i--) {
      const record = ordered[i]!
      if (record.quantity <= excess) {
        doomed.push(record)
        excess -= record.quantity
        continue
      }
      trimmed = {
        ...base,
        kind: 'update',
        record,
        quantity: record.quantity - excess,
        delta: -excess,
      }
      excess = 0
    }
    // Trim before delete: the two together are one shrink, and a trim that runs
    // first leaves the collection closer to the truth if the delete then fails.
    if (trimmed) operations.push(trimmed)
    if (doomed.length > 0) {
      operations.push({
        ...base,
        kind: 'delete',
        records: doomed,
        removed: doomed.reduce((total, record) => total + record.quantity, 0),
      })
    }
  }

  for (const [key, group] of remote) {
    if (local.has(key)) continue
    if (!keepRemovals) {
      skipped++
      continue
    }
    operations.push({
      kind: 'delete',
      key,
      parts: group.parts,
      name: group.name,
      // The key is in no list any more, so the deletion belongs to the run.
      lists: [],
      records: [...group.records],
      removed: group.quantity,
    })
  }

  return { operations, skipped }
}

/** The `POST /api/collection/v2/` body creating a record for a new key. */
export function createRecordBody(
  operation: PushCreate,
  archidektCardId: number,
): CollectionUpsertBody {
  return {
    game: ARCHIDEKT_GAME_PAPER,
    quantity: operation.quantity,
    card: archidektCardId,
    modifier: archidektModifier(operation.parts.finish),
    // Language, tags, and purchase price have no local representation: new
    // records are English, untagged, and unpriced (documented as lossy).
    language: ARCHIDEKT_LANGUAGE_ENGLISH,
    condition: archidektConditionId(operation.parts.condition),
    tags: [],
    purchasePrice: null,
  }
}

/**
 * The `PATCH /api/collection/v2/{id}/` body changing one record's quantity.
 * Every other field is carried over from the record itself — a push adjusts how
 * many copies a record holds, never what kind of copies they are. Finish and
 * condition are re-derived from the key (which is what the record parsed to),
 * so the body is typed rather than echoing raw wire values.
 */
export function updateRecordBody(operation: PushUpdate): CollectionUpsertBody {
  return {
    game: ARCHIDEKT_GAME_PAPER,
    quantity: operation.quantity,
    card: operation.record.card.id,
    modifier: archidektModifier(operation.parts.finish),
    language: operation.record.language,
    condition: archidektConditionId(operation.parts.condition),
    tags: operation.record.tags,
    purchasePrice: operation.record.purchasePrice,
  }
}

/** Copies an operation adds to Archidekt (0 for the ones that take copies away). */
export function operationAdded(operation: PushOperation): number {
  if (operation.kind === 'create') return operation.quantity
  if (operation.kind === 'update') return Math.max(0, operation.delta)
  return 0
}

/** Copies an operation takes away from Archidekt (0 for the ones that add). */
export function operationRemoved(operation: PushOperation): number {
  if (operation.kind === 'delete') return operation.removed
  if (operation.kind === 'update') return Math.max(0, -operation.delta)
  return 0
}
