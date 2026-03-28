import { describe, expect, test } from 'bun:test'
import { parseCollectionFile } from '../../src/commands/price-collection'

describe('parseCollectionFile', () => {
  test('parses card with set and collector number', () => {
    const content = `# My Collection\n\n- Arcane Signet (ECC:55)\n`
    const { entries, warnings } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Arcane Signet')
    expect(entries[0]!.set).toBe('ecc')
    expect(entries[0]!.collectorNumber).toBe('55')
    expect(entries[0]!.quantity).toBe(1)
    expect(warnings).toHaveLength(0)
  })

  test('warns and skips cards missing set code', () => {
    const content = `- Bitterbloom Bearer\n- Jeska's Will (CLB:799)\n`
    const { entries, warnings } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe("Jeska's Will")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Bitterbloom Bearer')
    expect(warnings[0]).toContain('missing set code')
  })

  test('parses card with finish and condition', () => {
    const content = `- Arahbo, the First Fang (FDN:2) [foil] [NM]\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Arahbo, the First Fang')
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.condition).toBe('NM')
  })

  test('parses condition without finish', () => {
    const content = `- Adeline, Resplendent Cathar (MID:1) [NM]\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Adeline, Resplendent Cathar')
    expect(entries[0]!.finish).toBeUndefined()
    expect(entries[0]!.condition).toBe('NM')
  })

  test('does not aggregate duplicates — each line is a separate entry', () => {
    const content = `- Sol Ring (C19:221)\n- Sol Ring (MH3:300)\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.set).toBe('c19')
    expect(entries[1]!.set).toBe('mh3')
  })

  test('handles double-faced card names', () => {
    const content = `- Elesh Norn // The Argent Etchings (MOM:12) [NM]\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Elesh Norn // The Argent Etchings')
  })

  test('skips non-card lines', () => {
    const content = `# Header\n\nSome text\n- Actual Card (SET:1)\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Actual Card')
  })

  test('handles collector numbers with letters', () => {
    const content = `- Nomad Mythmaker (PLST:10E-30) [NM]\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.collectorNumber).toBe('10E-30')
  })

  test('handles collector numbers with special characters', () => {
    const content = `- Serpent of Yawning Depths (SLD:1489★) [foil] [NM]\n`
    const { entries, warnings } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Serpent of Yawning Depths')
    expect(entries[0]!.set).toBe('sld')
    expect(entries[0]!.collectorNumber).toBe('1489★')
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.condition).toBe('NM')
    expect(warnings).toHaveLength(0)
  })

  test('parses card with note', () => {
    const content = `- Mana Crypt (2XM:270) [foil] [NM] {Japanese language, ignore pricing}\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Mana Crypt')
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.condition).toBe('NM')
    expect(entries[0]!.note).toBe('Japanese language, ignore pricing')
  })

  test('parses card with note but no finish or condition', () => {
    const content = `- Sol Ring (C19:221) {Signed by artist}\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Sol Ring')
    expect(entries[0]!.finish).toBeUndefined()
    expect(entries[0]!.condition).toBeUndefined()
    expect(entries[0]!.note).toBe('Signed by artist')
  })

  test('card without note has undefined note field', () => {
    const content = `- Arcane Signet (ECC:55)\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.note).toBeUndefined()
  })

  test('parses card ID suffix', () => {
    const content = `- Sol Ring (C19:221) [foil] [NM] &5\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Sol Ring')
    expect(entries[0]!.cardId).toBe(5)
  })

  test('parses card ID with note', () => {
    const content = `- Mana Crypt (2XM:270) [foil] [NM] {JP} &12\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.note).toBe('JP')
    expect(entries[0]!.cardId).toBe(12)
  })

  test('parses card ID without finish or condition', () => {
    const content = `- Arcane Signet (ECC:55) &1\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.cardId).toBe(1)
  })

  test('entry without card ID has undefined cardId', () => {
    const content = `- Arcane Signet (ECC:55)\n`
    const { entries } = parseCollectionFile(content)
    expect(entries[0]!.cardId).toBeUndefined()
  })
})
