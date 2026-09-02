import { buildInitialSessionConfig } from '../../src/commands/session/config'
import type { CardSessionStrategy } from '../../src/commands/session/strategy'

/**
 * A `CardSessionStrategy` whose every member is a no-op, for tests that drive
 * the session engine (`runCardSession`), a strategy wrapper (`trackListCreation`)
 * or a scope, and care about routing rather than list mutation.
 *
 * It exists so that growing the strategy contract costs one edit here instead of
 * one in each suite that hand-rolls a stub — the failure mode being a suite that
 * quietly keeps testing the old shape. Override only what the test asserts on.
 */
export function noopCardSessionStrategy(
  overrides: Partial<CardSessionStrategy> = {},
): CardSessionStrategy {
  return {
    managerLabel: 'test manager',
    saveTarget: null,
    sessionConfig: buildInitialSessionConfig({}, undefined),
    updateConfig: async () => [],
    applyChange: () => {},
    receiveMove: () => {},
    persist: async () => {},
    hasUnsavedChanges: () => false,
    sessionSaved: () => {},
    handleCard: async () => {},
    addAnotherCopy: async () => {},
    listSessionAdds: () => [],
    discardSessionAdd: async () => {},
    listSessionChanges: () => [],
    discardSessionChange: async () => {},
    editSessionChange: async () => {},
    listEntries: () => [],
    editEntry: async () => {},
    editEntryLanguage: async () => {},
    lastEditUndoLabel: () => null,
    undoLastEdit: async () => {},
    ...overrides,
  }
}
