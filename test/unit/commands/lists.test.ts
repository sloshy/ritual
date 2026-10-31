import { describe, expect, test } from 'bun:test'
import { formatListsTable } from '../../../src/commands/lists'
import type { ListInfo } from '../../../src/list/list-info'

const info = (type: ListInfo['type'], name: string, slug = name): ListInfo => ({ type, slug, name })

describe('formatListsTable', () => {
  test('heads the columns, and leaves out the file column when every file is named after its list', () => {
    expect(formatListsTable([info('deck', 'Pauper Elves'), info('wanted', 'Upgrades')])).toEqual([
      'Type         Name',
      'deck         Pauper Elves',
      'wanted list  Upgrades',
    ])
  })

  test('adds the file column when some list name differs from its file name', () => {
    expect(
      formatListsTable([
        info('deck', "Atraxa: Praetors' Voice", "Atraxa Praetors' Voice"),
        info('collection', 'Binder'),
      ]),
    ).toEqual([
      'Type        Name                     File',
      "deck        Atraxa: Praetors' Voice  Atraxa Praetors' Voice",
      'collection  Binder                   Binder',
    ])
  })
})
