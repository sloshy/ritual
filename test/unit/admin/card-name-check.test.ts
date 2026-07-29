import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test'
import {
  COLD_CACHE_MESSAGE,
  MAX_CANDIDATES,
  changeCardNames,
  checkCardNames,
  parseValidateCardNames,
} from '../../../src/admin/api/card-name-check'
import { cardCache } from '../../../src/cache'
import { createAddChange, createRemoveChange, createSetNoteChange } from '../../../src/change-event'
import { bindWorkspace, type BoundWorkspace } from '../../integration/helpers/workspace'
import { makeScryfallCard, seedCardNames } from '../../test-utils'

/**
 * Opt-in card-name validation for write routes. The cache is a process-wide
 * singleton, so the workspace is bound with `clearCardCache` and each test seeds
 * exactly what it needs.
 */

let workspace: BoundWorkspace

beforeAll(async () => {
  workspace = await bindWorkspace({ init: true, clearCardCache: true })
})

afterAll(async () => {
  await workspace.dispose()
})

beforeEach(async () => {
  await cardCache.clear()
})

describe('changeCardNames', () => {
  test('collects every distinct cardName across actions, in first-mention order', () => {
    expect(
      changeCardNames([
        createAddChange('Sol Ring'),
        createSetNoteChange('Sol Ring', { note: 'signed' }),
        createRemoveChange('Arcane Signet'),
        createAddChange('Sol Ring'),
      ]),
    ).toEqual(['Sol Ring', 'Arcane Signet'])
  })

  test('is empty for a batch with no card-level changes', () => {
    expect(changeCardNames([])).toEqual([])
  })
})

describe('checkCardNames', () => {
  test('a name already in the list is accepted without any cache lookup', async () => {
    // The cache is empty, which would otherwise be a cold-cache refusal — the
    // list itself is the authority on what is in it, which is what keeps a
    // custom or unreleased card removable.
    expect(await checkCardNames({ names: ['Proxy Beast'], known: ['Proxy Beast'] })).toEqual({
      ok: true,
    })
  })

  test('a name the cache knows is accepted', async () => {
    await seedCardNames('Lightning Bolt')
    expect(await checkCardNames({ names: ['Lightning Bolt'], known: [] })).toEqual({ ok: true })
  })

  test('an unknown name is refused with the closest cached names', async () => {
    await seedCardNames(
      'Lightning Bolt',
      'Lightning Helix',
      'Lightning Strike',
      'Lightning Axe',
      'Sol Ring',
    )

    const result = await checkCardNames({ names: ['Lightning Bolz'], known: [] })
    expect(result.ok).toBeFalse()
    if (result.ok) throw new Error('expected a refusal')
    expect(result.reason).toBe('unknown-names')
    if (result.reason !== 'unknown-names') throw new Error('expected unknown-names')
    expect(result.unknown).toHaveLength(1)
    expect(result.unknown[0]?.name).toBe('Lightning Bolz')
    // Four cached names match the "lightning" term; the cap is what the caller
    // actually sees, so pin the cap rather than an upper bound on it.
    expect(result.unknown[0]?.candidates).toHaveLength(MAX_CANDIDATES)
    expect(result.unknown[0]?.candidates).toContain('Lightning Bolt')
    expect(result.message).toContain('Lightning Bolz')
    expect(result.message).toContain('Did you mean')
  })

  test('candidates are ranked, closest first — not left in cache order', async () => {
    // Seeded with the best match last, so a passing assertion cannot be the
    // insertion order sneaking through: "Lightning Bolt" leads because the query
    // is a prefix of it, while the others merely share a term.
    await seedCardNames('Lightning Helix', 'Lightning Axe', 'Lightning Bolt')

    const result = await checkCardNames({ names: ['Lightning Bol'], known: [] })
    if (result.ok || result.reason !== 'unknown-names') throw new Error('expected unknown-names')
    expect(result.unknown[0]?.candidates[0]).toBe('Lightning Bolt')
  })

  test('a cached name with no printings is not a known name', async () => {
    // `cardCache.get` returning an empty array means "we have the key, we have
    // nothing behind it" — accepting that would vouch for a name on no evidence.
    await cardCache.bulkSet({ 'Sol Ring': [makeScryfallCard({ name: 'Sol Ring' })], Hollow: [] })

    const result = await checkCardNames({ names: ['Hollow'], known: [] })
    if (result.ok || result.reason !== 'unknown-names') throw new Error('expected unknown-names')
    expect(result.unknown[0]?.name).toBe('Hollow')
  })

  test('a double-faced card is accepted by its front-face name alone', async () => {
    // The cache keys DFCs under the full "Front // Back" name, but list files
    // legally carry just the front face — refusing those would make every DFC
    // unaddressable through a validated write.
    await seedCardNames('Delver of Secrets // Insectile Aberration')

    expect(await checkCardNames({ names: ['Delver of Secrets'], known: [] })).toEqual({ ok: true })
  })

  test('a name with no near matches is still refused, with no candidates', async () => {
    await seedCardNames('Sol Ring')

    const result = await checkCardNames({ names: ['Zzzzyx'], known: [] })
    if (result.ok || result.reason !== 'unknown-names') throw new Error('expected unknown-names')
    expect(result.unknown[0]?.candidates).toEqual([])
    expect(result.message).not.toContain('Did you mean')
  })

  test('an empty cache reports cold-cache, naming both remedies', async () => {
    const result = await checkCardNames({ names: ['Anything'], known: [] })
    if (result.ok) throw new Error('expected a refusal')
    expect(result.reason).toBe('cold-cache')
    expect(result.message).toBe(COLD_CACHE_MESSAGE)
    expect(result.message).toContain('refresh_cache')
    expect(result.message).toContain('ritual cache preload-all')
  })

  test('a name in the list short-circuits even when the cache would reject it', async () => {
    // A warm cache that does not hold the name: the only thing that can accept
    // it is the `known` short-circuit, so this pins that branch rather than
    // re-pinning the cold-cache one above.
    await seedCardNames('Sol Ring')

    expect(await checkCardNames({ names: ['Proxy Beast'], known: ['Proxy Beast'] })).toEqual({
      ok: true,
    })
  })
})

describe('parseValidateCardNames', () => {
  test('defaults to off when absent', () => {
    expect(parseValidateCardNames(undefined)).toEqual({ ok: true, value: false })
  })

  test('is validated, never coerced', () => {
    expect(parseValidateCardNames(true)).toEqual({ ok: true, value: true })
    expect(parseValidateCardNames(false)).toEqual({ ok: true, value: false })
    for (const raw of ['true', 1]) {
      expect(parseValidateCardNames(raw)).toEqual({
        ok: false,
        message: 'validateCardNames must be a boolean.',
      })
    }
  })
})
