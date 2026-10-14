import { describe, expect, test } from 'bun:test'
import { readCardArtValue } from '../../../src/admin/site/components/ArtRefField'
import { keyedMessage } from '../../helpers/api-message'

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
    ['file', '../secrets.png', 'domain.list.art.escapes'],
    ['file', 'notes.txt', 'domain.list.art.notImage'],
    ['file', 'C:\\art\\ring.png', 'domain.list.art.backslashes'],
    ['file', '/etc/ring.png', 'domain.list.art.absolute'],
    ['url', 'ftp://example.test/ring.png', 'domain.list.art.notHttp'],
  ] as const)('%s mode refuses %s with the parser’s own reason', (mode, raw, key) => {
    const parsed = readCardArtValue(mode, raw)
    if (parsed.state !== 'invalid') throw new Error('expected a refusal')
    expect(parsed.reason.messageKey).toBe(key)
    // The value as typed rides through the refusal, whatever its wording.
    expect(keyedMessage(parsed.reason)).toContain(`"${raw}"`)
  })
})
