import { describe, expect, test } from 'bun:test'
import { sharedBulkEdit } from '../../src/editor/shared-bulk-edit'
import type { UseEditorResult } from '../../src/editor/editor-config'
import { contextInfoFromSelected } from '../../src/list-view/selected-to-context'
import { makeSelectedCard } from '../test-utils'

type Editor = UseEditorResult<unknown, unknown>

/** The editor as `sharedBulkEdit` sees it: only the members it forwards to are stubbed. */
const asEditor = (stub: Partial<Editor>): Editor => stub as Editor

const card = makeSelectedCard({ name: 'Sol Ring', cardIds: [4] })

test('sharedBulkEdit forwards each operation to the editor with the selection as context infos', () => {
  const calls: unknown[][] = []
  const editor = asEditor({
    startBulkChangePrinting: (...args) => calls.push(['changePrinting', ...args]),
    handleMoveCardsToSection: (...args) => calls.push(['moveToSection', ...args]),
    promptNewSectionForCards: (...args) => calls.push(['promptNewSection', ...args]),
    sectionOrder: () => ['Main'],
    moveTargets: () => [{ type: 'deck', name: 'Goblins' }],
  })
  const bulk = sharedBulkEdit(editor)
  const info = [contextInfoFromSelected(card)]

  bulk.changePrinting([card])
  bulk.moveToSection([card], 'Sideboard')
  bulk.promptNewSection([card])
  expect(calls).toEqual([
    ['changePrinting', info],
    ['moveToSection', info, 'Sideboard'],
    ['promptNewSection', info],
  ])
  expect(bulk.sections()).toEqual(['Main'])
  expect(bulk.moveTargets()).toEqual([{ type: 'deck', name: 'Goblins' }])
})

describe('the passthroughs read the editor live', () => {
  test('sections follow a rebound sectionOrder', () => {
    const editor = asEditor({ sectionOrder: () => ['Main'] })
    const bulk = sharedBulkEdit(editor)
    editor.sectionOrder = () => ['Main', 'Sideboard']
    expect(bulk.sections()).toEqual(['Main', 'Sideboard'])
  })

  test('moveTargets follow a rebound moveTargets', () => {
    const editor = asEditor({ moveTargets: () => [] })
    const bulk = sharedBulkEdit(editor)
    editor.moveTargets = () => [{ type: 'collection', name: 'Binder' }]
    expect(bulk.moveTargets()).toEqual([{ type: 'collection', name: 'Binder' }])
  })
})
