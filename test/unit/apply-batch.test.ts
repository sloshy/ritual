import { describe, expect, test } from 'bun:test'
import {
  describeUnmatchedChanges,
  listUnmatchedChanges,
  type UnmatchedChange,
} from '../../src/changes/apply-batch'
import {
  createAddChange,
  createMoveFromChange,
  createSetCommanderChange,
  createSetFinishChange,
  createSetLanguageChange,
  type ChangeEvent,
} from '../../src/changes/change-event'
import { formatChange } from '../../src/changes/change-message'
import { DEFAULT_LOCALE } from '../../src/i18n/runtime'
import type { LocaleCatalog } from '../../src/i18n/types'
import { renderSyncMessage } from '../../src/sync/message'
import { keyedMessage } from '../helpers/api-message'
import { withSyntheticLocale } from '../helpers/sync-text'

/**
 * "These changes did not apply" — the save route's refusal and the
 * collection-sync abort. One message, English plus its key, whose every part
 * (each change it names included) a reader in another language gets in theirs.
 */

const missed = (
  change: ChangeEvent,
  reason: UnmatchedChange<ChangeEvent>['reason'],
): UnmatchedChange<ChangeEvent> => ({ change, reason })

const BOLT = createAddChange('Lightning Bolt', { cardId: 3 })
const SOL_RING = createAddChange('Sol Ring', { cardId: 4 })

describe('describeUnmatchedChanges', () => {
  test('words one reason, the list it was aimed at, and each change, in English', () => {
    const message = describeUnmatchedChanges([missed(BOLT, 'no-target')], {
      type: 'deck',
      slug: 'burn',
    })
    expect(keyedMessage(message)).toBe(
      '1 change matched no card in deck "burn": "Add Lightning Bolt &3" — card names match exactly (case-sensitive). Nothing was saved.',
    )
  })

  test('counts its changes and joins every reason that missed', () => {
    const message = describeUnmatchedChanges(
      [
        missed(BOLT, 'no-target'),
        missed(SOL_RING, 'no-target'),
        missed(createSetCommanderChange('Avacyn'), 'not-applicable'),
        missed(createSetFinishChange('Forest', { finish: 'foil' }), 'needs-printing'),
      ],
      { type: 'collection', slug: 'binder' },
    )
    expect(keyedMessage(message)).toBe(
      '2 changes matched no card in collection "binder": "Add Lightning Bolt &3", "Add Sol Ring &4" — card names match exactly (case-sensitive); ' +
        '1 change never applies to a collection list: "Set Avacyn as commander"; ' +
        '1 change would set a finish on a card with no printing: "Set Forest finish to foil" — set the printing first, then the finish. ' +
        'Nothing was saved.',
    )
  })

  const SYNTHETIC: LocaleCatalog = {
    'domain.changes.unmatched.summary': '{reasons}. Nichts gespeichert.',
    'domain.changes.unmatched.notApplicable': {
      $plural: 'count',
      one: '{count} Änderung gilt nie für {list}: {changes}',
      other: '{count} Änderungen gelten nie für {list}: {changes}',
    },
    'domain.changes.unmatched.listOfType': {
      $select: 'type',
      deck: 'ein Deck',
      collection: 'eine Sammlung',
      wanted: 'eine Wunschliste',
    },
    'domain.change.listRef': {
      $select: 'type',
      deck: 'Deck „{name}“',
      collection: 'Sammlung „{name}“',
      wanted: 'Wunschliste „{name}“',
    },
    'domain.change.moveToList': {
      $select: 'tense',
      present: '{name}{annotation}{id} nach {list} verschieben',
      past: '{name}{annotation}{id} nach {list} verschoben',
    },
  }

  test('a reader in another language gets the whole refusal in it, while the API keeps English', () => {
    const moved = createMoveFromChange('Sol Ring', { to: { type: 'deck', name: 'Burn' } })
    const message = withSyntheticLocale('xx', SYNTHETIC, () =>
      describeUnmatchedChanges([missed(moved, 'not-applicable')], {
        type: 'wanted',
        slug: 'wishlist',
      }),
    )
    expect(keyedMessage(message)).toBe(
      `1 change never applies to a wanted list: "Move Sol Ring to Deck 'Burn'". Nothing was saved.`,
    )
    const translated = withSyntheticLocale('xx', SYNTHETIC, () => renderSyncMessage(message))
    // Vacuity guard: the synthetic locale is live.
    expect(translated).not.toBe(renderSyncMessage(message, DEFAULT_LOCALE))
    expect(translated).toBe(
      '1 Änderung gilt nie für eine Wunschliste: "Sol Ring nach Deck „Burn“ verschieben". Nichts gespeichert.',
    )
  })
})

describe('listUnmatchedChanges', () => {
  test('names each change in English with its machine reason, whatever the UI locale', () => {
    const items = [
      missed(BOLT, 'no-target'),
      missed(createSetLanguageChange('Sol Ring', { language: 'ja' }), 'no-target'),
    ]
    const english = listUnmatchedChanges(items)
    expect(english).toEqual([
      'Add Lightning Bolt &3 (no-target)',
      'Set language of Sol Ring to Japanese (no-target)',
    ])
    const [underLocale, display] = withSyntheticLocale(
      'xx',
      { 'domain.change.setLanguage': '{name}: Sprache {language}{id}' },
      () => [listUnmatchedChanges(items), formatChange(items[1]!.change)] as const,
    )
    // Vacuity guard: the synthetic locale does reword the change for display.
    expect(display).toBe('Sol Ring: Sprache Japanese')
    expect(underLocale).toEqual(english)
  })
})
