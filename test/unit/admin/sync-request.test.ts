import { describe, expect, test } from 'bun:test'
import {
  parseEnumField,
  parseNameArray,
  parseOptionalText,
  parseSyncRequestCore,
  readBooleanFlags,
  type NameArrayRules,
} from '../../../src/admin/api/sync-request'

/**
 * The rules both admin sync endpoints share, tested once at the layer that owns
 * them. The endpoint tests then only have to prove their own fields and that
 * this core is actually reached.
 */

describe('parseEnumField', () => {
  const values = ['push', 'pull'] as const

  test('matches case-insensitively and returns the canonical member', () => {
    for (const raw of ['push', 'PUSH', 'Push']) {
      expect(parseEnumField(raw, values, 'direction')).toEqual({ ok: true, value: 'push' })
    }
  })

  test('refuses a non-string, naming the choices', () => {
    expect(parseEnumField(7, values, 'direction')).toEqual({
      ok: false,
      message: 'direction must be one of: push, pull.',
    })
  })

  test('refuses an unknown member, echoing what was sent', () => {
    expect(parseEnumField('sideways', values, 'direction')).toEqual({
      ok: false,
      message: "Invalid direction 'sideways'. Use one of: push, pull.",
    })
  })

  test('matches a member that is not itself lowercase', () => {
    expect(parseEnumField('mixed', ['Mixed'] as const, 'mode')).toEqual({
      ok: true,
      value: 'Mixed',
    })
  })
})

describe('parseSyncRequestCore', () => {
  test('defaults both flags to false and leaves an absent filter off', () => {
    expect(parseSyncRequestCore({ direction: 'pull' })).toEqual({
      direction: 'pull',
      dryRun: false,
      ignoreUnreadableLines: false,
    })
  })

  test('carries the flags and the change filter through', () => {
    expect(
      parseSyncRequestCore({
        direction: 'PUSH',
        dryRun: true,
        ignoreUnreadableLines: true,
        only: 'Removals',
      }),
    ).toEqual({
      direction: 'push',
      dryRun: true,
      ignoreUnreadableLines: true,
      only: 'removals',
    })
  })

  test.each([null, '', undefined])('reads %p as an unfiltered run', (only) => {
    const parsed = parseSyncRequestCore({ direction: 'pull', only })
    expect(typeof parsed === 'string' ? parsed : parsed.only).toBeUndefined()
  })

  test.each<[string, Record<string, unknown>, string]>([
    ['a missing direction', {}, 'direction is required (push or pull)'],
    ['a blank direction', { direction: '' }, 'direction is required (push or pull)'],
    ['an unknown direction', { direction: 'sideways' }, "Invalid direction 'sideways'"],
    ['an unknown filter', { direction: 'pull', only: 'both' }, "Invalid only 'both'"],
    ['a non-string filter', { direction: 'pull', only: 7 }, 'only must be one of'],
    ['a non-boolean dryRun', { direction: 'pull', dryRun: 'yes' }, 'dryRun must be a boolean'],
    [
      'a non-boolean ignoreUnreadableLines',
      { direction: 'pull', ignoreUnreadableLines: 1 },
      'ignoreUnreadableLines must be a boolean',
    ],
  ])('refuses %s', (_label, body, message) => {
    const parsed = parseSyncRequestCore(body)
    expect(typeof parsed).toBe('string')
    expect(parsed).toContain(message)
  })
})

describe('parseNameArray', () => {
  const dropping: NameArrayRules = {
    field: 'lists',
    noun: 'collection list names',
    blanks: 'drop',
  }
  const rejecting: NameArrayRules = { ...dropping, field: 'removalPriority', blanks: 'reject' }

  test('reads a missing field as "everything"', () => {
    expect(parseNameArray(undefined, dropping)).toEqual([])
  })

  test('trims names and drops the blanks a form control leaves behind', () => {
    expect(parseNameArray([' binder ', '', '   ', 'long-box'], dropping)).toEqual([
      'binder',
      'long-box',
    ])
  })

  test('keeps the order it was given, which is a priority’s whole content', () => {
    expect(parseNameArray([' long-box ', 'binder'], rejecting)).toEqual(['long-box', 'binder'])
  })

  test('refuses a blank entry where the order is the meaning', () => {
    // Dropping it would silently promote every name after it.
    expect(parseNameArray(['long-box', '  '], rejecting)).toBe(
      'removalPriority must not contain blank names',
    )
  })

  test.each([['not-an-array'], [{ 0: 'binder' }], [[1, 2]], [['ok', null]]])(
    'refuses %p',
    (raw: unknown) => {
      expect(parseNameArray(raw, dropping)).toBe('lists must be an array of collection list names')
    },
  )
})

describe('parseOptionalText', () => {
  test.each([undefined, null, '', '   '])('reads %p as unset', (raw) => {
    expect(parseOptionalText(raw, 'into', 'a collection list name')).toEqual({
      ok: true,
      value: undefined,
    })
  })

  test('trims a value it accepts', () => {
    expect(parseOptionalText('  Inbox ', 'into', 'a collection list name')).toEqual({
      ok: true,
      value: 'Inbox',
    })
  })

  test('refuses a non-string', () => {
    expect(parseOptionalText(7, 'into', 'a collection list name')).toEqual({
      ok: false,
      message: 'into must be a collection list name',
    })
  })
})

describe('readBooleanFlags', () => {
  const flags = { dryRun: true, ignoreUnreadableLines: true } as const

  test('reads an absent flag as false rather than undefined', () => {
    expect(readBooleanFlags(new URLSearchParams(), flags)).toEqual({
      dryRun: false,
      ignoreUnreadableLines: false,
    })
  })

  test('reads the two spellings a query string may use', () => {
    expect(
      readBooleanFlags(new URLSearchParams('dryRun=true&ignoreUnreadableLines=false'), flags),
    ).toEqual({ dryRun: true, ignoreUnreadableLines: false })
  })

  test.each(['1', 'yes', 'TRUE', ''])('refuses %p rather than reading it as "no"', (raw) => {
    expect(readBooleanFlags(new URLSearchParams([['dryRun', raw]]), flags)).toBe(
      "dryRun must be 'true' or 'false'",
    )
  })
})
