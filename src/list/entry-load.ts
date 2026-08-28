/**
 * The one loader behind both {@link EntryRef} and `SnapshotEntry`: read a list
 * file of any type into a uniform entry list plus its section order.
 *
 * Deliberately free of any *direct* i18n import — `src/changes/list-snapshot.ts`
 * re-exports it and sits inside the persistence fence (`EntryRef` is imported as
 * a type, which erases). The fence is direct-import-only by design; nothing here
 * writes catalog prose into a file.
 */

import * as fs from 'node:fs/promises'
import { importFromTextFile } from '../importers/text-file'
import { parseCollectionFile } from './collection-file'
import { parseWantedListFile } from './wanted-file'
import { isCommanderSection } from './deck-format'
import type { EntryRef } from './entry-ref'
import type { ListType } from './list-type'

/** An {@link EntryRef} plus the placement fields every list type carries. */
export type ListEntryRef = EntryRef & {
  section: string
  quantity: number
  isCommander: boolean
}

/** A list's entries, normalized across decks, collections, and wanted lists. */
export type LoadedListEntries = {
  /** Section names in display order. */
  sectionOrder: string[]
  entries: ListEntryRef[]
}

/** Load a list of any type into a uniform {@link LoadedListEntries}. */
export async function loadListEntries(
  type: ListType,
  filePath: string,
): Promise<LoadedListEntries> {
  if (type === 'deck') {
    const deck = await importFromTextFile(filePath)
    const entries: ListEntryRef[] = []
    for (const section of deck.sections) {
      const commander = isCommanderSection(section.name)
      for (const card of section.cards) {
        entries.push({
          name: card.name,
          set: card.set,
          collectorNumber: card.collectorNumber,
          finish: card.finish,
          condition: card.condition,
          language: card.language,
          labels: card.labels,
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
  switch (type) {
    case 'collection': {
      const { entries, sectionOrder } = parseCollectionFile(content)
      return {
        sectionOrder,
        entries: entries.map((e) => ({
          name: e.name,
          set: e.set,
          collectorNumber: e.collectorNumber,
          finish: e.finish,
          condition: e.condition,
          language: e.language,
          labels: e.labels,
          note: e.note,
          cardId: e.cardId,
          section: e.section,
          quantity: e.quantity,
          isCommander: false,
        })),
      }
    }
    case 'wanted': {
      const { entries, sectionOrder } = parseWantedListFile(content)
      return {
        sectionOrder,
        entries: entries.map((e) => ({
          name: e.name,
          set: e.set,
          collectorNumber: e.collectorNumber,
          finish: e.finish,
          language: e.language,
          note: e.note,
          cardId: e.cardId,
          section: e.section,
          quantity: e.quantity,
          isCommander: false,
        })),
      }
    }
    default:
      return type satisfies never
  }
}
