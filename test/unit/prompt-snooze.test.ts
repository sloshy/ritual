import { describe, expect, test } from 'bun:test'
import {
  isMigratePromptSnoozed,
  MIGRATE_PROMPT_SNOOZE_MS,
  recordMigratePrompt,
} from '../../src/migrate/prompt-snooze'
import type { MigratePromptTimes } from '../../src/util/user-state'

const NOW = 1_000_000_000_000
const DAY = MIGRATE_PROMPT_SNOOZE_MS

describe('isMigratePromptSnoozed', () => {
  test.each<[string, number | undefined, boolean]>([
    ['never asked', undefined, false],
    ['asked just now', NOW, true],
    ['asked almost a day ago', NOW - DAY + 1, true],
    ['asked a day ago', NOW - DAY, false],
    ['asked in the future (clock moved back)', NOW + 1, false],
  ])('%s', (_label, last, expected) => {
    const times: MigratePromptTimes = last === undefined ? {} : { '/ws': last }
    expect(isMigratePromptSnoozed(times, '/ws', NOW)).toBe(expected)
  })

  test('is per workspace', () => {
    expect(isMigratePromptSnoozed({ '/a': NOW }, '/b', NOW)).toBeFalse()
  })
})

test('the snooze is one day', () => {
  expect(MIGRATE_PROMPT_SNOOZE_MS).toBe(86_400_000)
})

describe('recordMigratePrompt', () => {
  test('stamps the workspace and drops lapsed entries, keeping live ones', () => {
    const times = { '/old': NOW - DAY, '/recent': NOW - 1, '/ws': NOW - 2 * DAY }
    expect(recordMigratePrompt(times, '/ws', NOW)).toEqual({ '/recent': NOW - 1, '/ws': NOW })
  })
})
