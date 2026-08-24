import { describe, expect, test } from 'bun:test'
import { readCardArtValue } from '../../../src/admin/site/components/ArtRefField'

/**
 * The shared art-reference field, minus its markup: what the typed value means
 * under each of the two source modes. Both dialogs built on it — a card's
 * custom art and a list's cover image — refuse a value here on the same terms.
 *
 * The grammar itself belongs to `card-art.ts` (unit-tested there). What is
 * pinned here is that the dialog runs it at all — a card the session added
 * stages its reference locally and never reaches the art route until the save
 * that writes its line, so a value refused only by the server would be refused
 * long after this dialog closed.
 */

describe('readCardArtValue', () => {
  test('an empty field is nothing yet, not a refusal', () => {
    expect(readCardArtValue('file', '')).toEqual({ state: 'empty' })
    expect(readCardArtValue('url', '   ')).toEqual({ state: 'empty' })
  })

  test('a path under the art directory is a file reference, normalized', () => {
    expect(readCardArtValue('file', ' proxies/./sol-ring.png ')).toEqual({
      state: 'valid',
      art: { file: 'proxies/sol-ring.png' },
    })
  })

  test('an http address is a url reference, kept verbatim', () => {
    expect(readCardArtValue('url', 'https://example.test/bolt.jpg')).toEqual({
      state: 'valid',
      art: { url: 'https://example.test/bolt.jpg' },
    })
  })

  test('the mode decides which half of the grammar applies', () => {
    // The same string is a fine path and a hopeless URL.
    expect(readCardArtValue('file', 'sol-ring.png').state).toBe('valid')
    expect(readCardArtValue('url', 'sol-ring.png').state).toBe('invalid')
  })

  test.each([
    ['file', '../secrets.png'],
    ['file', 'notes.txt'],
    ['file', 'C:\\art\\ring.png'],
    ['file', '/etc/ring.png'],
    ['url', 'ftp://example.test/ring.png'],
  ] as const)('%s mode refuses %s with the parser’s own reason', (mode, raw) => {
    const parsed = readCardArtValue(mode, raw)
    expect(parsed.state).toBe('invalid')
    if (parsed.state !== 'invalid') throw new Error('expected a refusal')
    expect(parsed.reason.length).toBeGreaterThan(0)
  })
})
