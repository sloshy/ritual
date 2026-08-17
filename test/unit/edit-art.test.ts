import { describe, expect, test } from 'bun:test'
import {
  artBrowseRows,
  cardArtActionRows,
  cardArtDisplay,
  type ArtDirEntry,
} from '../../src/commands/edit-art'

function dir(name: string): ArtDirEntry {
  return { name, isDirectory: true }
}

function file(name: string): ArtDirEntry {
  return { name, isDirectory: false }
}

const tree: ArtDirEntry[] = [
  file('sol-ring.jpg'),
  dir('proxies'),
  file('notes.txt'),
  file('.DS_Store'),
  dir('.git'),
  file('bolt.PNG'),
  dir('alters'),
]

describe('art file browser rows', () => {
  test('lists directories before images, each in path order', () => {
    expect(artBrowseRows(tree, '').map((row) => row.value)).toEqual([
      { kind: 'dir', path: 'alters' },
      { kind: 'dir', path: 'proxies' },
      { kind: 'file', path: 'bolt.PNG' },
      { kind: 'file', path: 'sol-ring.jpg' },
    ])
  })

  test('hides files the art route would never serve, and dot-entries', () => {
    const titles = artBrowseRows(tree, '').map((row) => row.title)
    expect(titles.some((title) => title.includes('notes.txt'))).toBeFalse()
    expect(titles.some((title) => title.includes('.DS_Store'))).toBeFalse()
    expect(titles.some((title) => title.includes('.git'))).toBeFalse()
    // Directory rows read as directories; the extension match is case-insensitive.
    expect(titles).toContain('📁 proxies/')
    expect(titles.some((title) => title.includes('bolt.PNG'))).toBeTrue()
  })

  test('a subdirectory leads with a way back out, and paths stay art-dir-relative', () => {
    const rows = artBrowseRows([dir('nested'), file('sol-ring.jpg')], 'proxies/mono')
    expect(rows.map((row) => row.value)).toEqual([
      { kind: 'up', path: 'proxies' },
      { kind: 'dir', path: 'proxies/mono/nested' },
      { kind: 'file', path: 'proxies/mono/sol-ring.jpg' },
    ])
  })

  test('the top of the tree offers no way out and is reached from one level down', () => {
    expect(artBrowseRows([], '')).toEqual([])
    expect(artBrowseRows([], 'proxies')[0]?.value).toEqual({ kind: 'up', path: '' })
  })
})

describe('the Set Custom Art menu', () => {
  test('a card with no art is offered no way to clear it', () => {
    expect(cardArtActionRows(null).map((row) => row.value)).toEqual(['url', 'file', 'cancel'])
  })

  test('a card wearing art can drop it, and the row sits before the way out', () => {
    expect(cardArtActionRows({ file: 'proxies/ring.png' }).map((row) => row.value)).toEqual([
      'url',
      'file',
      'clear',
      'cancel',
    ])
    expect(
      cardArtActionRows({ url: 'https://example.test/ring.png' }).map((row) => row.value),
    ).toEqual(['url', 'file', 'clear', 'cancel'])
  })

  test('every row is titled', () => {
    for (const row of cardArtActionRows({ file: 'ring.png' })) {
      expect(row.title.length).toBeGreaterThan(2)
    }
  })
})

describe('how a reference reads back', () => {
  test('a file shows its path and a URL shows itself', () => {
    expect(cardArtDisplay({ file: 'proxies/sol-ring.jpg' })).toBe('proxies/sol-ring.jpg')
    expect(cardArtDisplay({ url: 'https://example.com/bolt.png' })).toBe(
      'https://example.com/bolt.png',
    )
  })
})
