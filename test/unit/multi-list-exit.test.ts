import { describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import {
  confirmMultiListExit,
  type MultiListSessionControls,
} from '../../src/commands/session/loop'
import { stubTty } from '../test-utils'

// `ask` refuses to prompt without a terminal; these tests simulate an
// interactive session via prompts.inject, so pretend stdin is a TTY.
stubTty({ stdin: true })

/** Controls with one unsaved list whose saveAll reports the given outcome. */
function controlsWith(saveAllResult: boolean): {
  controls: MultiListSessionControls
  calls: number[]
} {
  const calls: number[] = []
  const controls: MultiListSessionControls = {
    totalChangeCount: () => 2,
    listsWithChanges: () => 1,
    hasAnyUnsaved: () => true,
    saveAll: async () => {
      calls.push(1)
      return saveAllResult
    },
    saveCurrent: async () => saveAllResult,
  }
  return { controls, calls }
}

describe('confirmMultiListExit', () => {
  test('save-and-exit exits once every list saved', async () => {
    const { controls, calls } = controlsWith(true)
    prompts.inject(['save'])
    expect(await confirmMultiListExit(controls)).toBe(true)
    expect(calls).toHaveLength(1)
  })

  test('a failed save keeps the editor open instead of discarding the session', async () => {
    const { controls, calls } = controlsWith(false)
    prompts.inject(['save'])
    // saveAll reported a list it could not save (e.g. a cross-list move whose
    // destination cannot be committed) — exiting now would throw that
    // session away right after the error message.
    expect(await confirmMultiListExit(controls)).toBe(false)
    expect(calls).toHaveLength(1)
  })
})
