/**
 * Helpers for the `history` command's "rewrite with defaults" action: load any
 * list type into a uniform snapshot, then derive a single change set's worth of
 * raw changelog lines describing that current state.
 */

import * as fs from 'node:fs/promises'
import { importFromTextFile } from '../importers/text-file'
import { parseCollectionFile } from '../collection-file'
import { parseWantedListFile } from './wanted-helpers'
import { DEFAULT_SECTION, type Condition, type Finish } from '../types'
import type { ListType } from '../list-type'
import {
  createAddChange,
  createAddSectionChange,
  createSetCommanderChange,
  createSetLabelChange,
  createSetNoteChange,
  createSetSectionChange,
  formatChangeCore,
  type ChangeEvent,
} from '../change-event'
import type { CardLabel } from '../card-labels'

/** A single list entry, normalized across decks, collections, and wanted lists. */
export type SnapshotEntry = {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** Label override — collection entries only. */
  labels?: CardLabel[]
  note?: string
  cardId?: number
  section: string
  quantity: number
  isCommander: boolean
}

/** A list's current contents, normalized for default-changelog generation. */
export type ListSnapshot = {
  /** Section names in display order. */
  sectionOrder: string[]
  entries: SnapshotEntry[]
}

function isCommanderSection(name: string): boolean {
  return name.toLowerCase() === 'commander'
}

/** Derive the `.changes.md` changelog path that sits alongside a list's `.md`/`.txt` file. */
export function changesPathFor(filePath: string): string {
  return filePath.replace(/\.(md|txt)$/i, '') + '.changes.md'
}

/** Load a list of any type into a uniform {@link ListSnapshot}. */
export async function loadListSnapshot(type: ListType, filePath: string): Promise<ListSnapshot> {
  if (type === 'deck') {
    const deck = await importFromTextFile(filePath)
    const entries: SnapshotEntry[] = []
    for (const section of deck.sections) {
      const commander = isCommanderSection(section.name)
      for (const card of section.cards) {
        entries.push({
          name: card.name,
          set: card.set,
          collectorNumber: card.collectorNumber,
          finish: card.finish,
          condition: card.condition,
          note: card.note,
          cardId: card.cardId,
          section: section.name,
          quantity: card.quantity,
          isCommander: commander,
        })
      }
    }
    return { sectionOrder: deck.sections.map((s) => s.name), entries }
  }

  const content = await fs.readFile(filePath, 'utf-8')
  if (type === 'collection') {
    const { entries, sectionOrder } = parseCollectionFile(content)
    return {
      sectionOrder,
      entries: entries.map((e) => ({
        name: e.name,
        set: e.set,
        collectorNumber: e.collectorNumber,
        finish: e.finish,
        condition: e.condition,
        labels: e.labels,
        note: e.note,
        cardId: e.cardId,
        section: e.section,
        quantity: e.quantity,
        isCommander: false,
      })),
    }
  }

  const { entries, sectionOrder } = parseWantedListFile(content)
  return {
    sectionOrder,
    entries: entries.map((e) => ({
      name: e.name,
      set: e.set,
      collectorNumber: e.collectorNumber,
      finish: e.finish,
      note: e.note,
      cardId: e.cardId,
      section: e.section,
      quantity: e.quantity,
      isCommander: false,
    })),
  }
}

/**
 * Build the raw changelog lines for a single "current state" change set. Emits, in
 * order: an add-section line per non-default section, then per entry — one add per
 * copy (matching how the diff logs quantities), a set-commander line for
 * commanders, a set-note line for noted cards, a set-labels line for cards with a
 * label override, and a set-section line for cards outside the default section.
 * Lines are formatted identically to the changelog writer (past tense, quoted
 * card names) so the result is indistinguishable from an organically written
 * change set.
 */
export function buildDefaultChangeLines(snapshot: ListSnapshot): string[] {
  const events: ChangeEvent[] = []

  for (const section of snapshot.sectionOrder) {
    if (section !== DEFAULT_SECTION) events.push(createAddSectionChange(section))
  }

  for (const entry of snapshot.entries) {
    const copies = Math.max(1, entry.quantity)
    for (let i = 0; i < copies; i++) {
      events.push(
        createAddChange(entry.name, {
          set: entry.set,
          collectorNumber: entry.collectorNumber,
          finish: entry.finish,
          condition: entry.condition,
          cardId: entry.cardId,
        }),
      )
    }
    if (entry.isCommander) {
      events.push(createSetCommanderChange(entry.name, { cardId: entry.cardId }))
    }
    if (entry.note) {
      events.push(createSetNoteChange(entry.name, { note: entry.note, cardId: entry.cardId }))
    }
    if (entry.labels && entry.labels.length > 0) {
      events.push(createSetLabelChange(entry.name, { labels: entry.labels, cardId: entry.cardId }))
    }
    if (entry.section !== DEFAULT_SECTION) {
      events.push(createSetSectionChange(entry.name, entry.section, entry.cardId))
    }
  }

  return events.map((c) => `- ${formatChangeCore(c, { tense: 'past', quoteCardName: true })}`)
}
