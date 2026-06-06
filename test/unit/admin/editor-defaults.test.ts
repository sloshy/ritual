import { describe, expect, test } from 'bun:test'
import {
  parseStored,
  parseSetCodesInput,
  formatSetCodesForDisplay,
} from '../../../src/editor/useEditorDefaults'

describe('parseSetCodesInput', () => {
  test('normalizes to lowercase and trims whitespace', () => {
    expect(parseSetCodesInput('FDN, Spg ,  LEA')).toEqual(['fdn', 'spg', 'lea'])
  })

  test('drops empty entries', () => {
    expect(parseSetCodesInput(' , fdn , ,, ')).toEqual(['fdn'])
  })

  test('removes duplicates while preserving order', () => {
    expect(parseSetCodesInput('FDN, fdn, lea, FDN')).toEqual(['fdn', 'lea'])
  })

  test('returns empty array for blank input', () => {
    expect(parseSetCodesInput('')).toEqual([])
    expect(parseSetCodesInput('   ')).toEqual([])
  })
})

describe('formatSetCodesForDisplay', () => {
  test('uppercases and joins with comma+space', () => {
    expect(formatSetCodesForDisplay(['fdn', 'spg'])).toBe('FDN, SPG')
  })

  test('returns empty string for empty array', () => {
    expect(formatSetCodesForDisplay([])).toBe('')
  })
})

describe('parseStored', () => {
  test('returns empty defaults for null input', () => {
    expect(parseStored(null, 'deck')).toEqual({ kind: 'deck', sets: [] })
    expect(parseStored(null, 'wanted')).toEqual({ kind: 'wanted', sets: [] })
  })

  test('returns error string for malformed JSON', () => {
    const result = parseStored('{not json', 'deck')
    expect(typeof result).toBe('string')
    expect(result).toContain('Failed to parse')
  })

  test('parses valid deck defaults', () => {
    const raw = JSON.stringify({ sets: ['fdn', 'spg'], finish: 'foil', condition: 'NM' })
    expect(parseStored(raw, 'deck')).toEqual({
      kind: 'deck',
      sets: ['fdn', 'spg'],
      finish: 'foil',
      condition: 'NM',
    })
  })

  test('parses valid collection defaults the same as deck', () => {
    const raw = JSON.stringify({ sets: [], finish: 'etched', condition: 'LP' })
    expect(parseStored(raw, 'collection')).toEqual({
      kind: 'collection',
      sets: [],
      finish: 'etched',
      condition: 'LP',
    })
  })

  test('strips condition for kind=wanted even when present in storage', () => {
    const raw = JSON.stringify({ sets: ['fdn'], finish: 'foil', condition: 'NM' })
    const result = parseStored(raw, 'wanted')
    expect(result).toEqual({ kind: 'wanted', sets: ['fdn'], finish: 'foil' })
    expect(result).not.toHaveProperty('condition')
  })

  test('drops invalid finish and condition values', () => {
    const raw = JSON.stringify({ sets: [], finish: 'sparkly', condition: 'BROKEN' })
    expect(parseStored(raw, 'deck')).toEqual({
      kind: 'deck',
      sets: [],
      finish: undefined,
      condition: undefined,
    })
  })

  test('lowercases set codes from stored payload', () => {
    const raw = JSON.stringify({ sets: ['FDN', '  SpG  '] })
    const result = parseStored(raw, 'deck')
    if (typeof result === 'string') throw new Error('expected parsed result')
    expect(result.sets).toEqual(['fdn', 'spg'])
  })

  test('handles non-array sets gracefully', () => {
    const raw = JSON.stringify({ sets: 'fdn,spg' })
    const result = parseStored(raw, 'deck')
    if (typeof result === 'string') throw new Error('expected parsed result')
    expect(result.sets).toEqual([])
  })

  test('drops non-string entries from sets array', () => {
    const raw = JSON.stringify({ sets: ['fdn', 42, null, 'spg'] })
    const result = parseStored(raw, 'deck')
    if (typeof result === 'string') throw new Error('expected parsed result')
    expect(result.sets).toEqual(['fdn', 'spg'])
  })
})
