import { describe, expect, test } from 'bun:test'
import { listDisplayNameFromContent } from '../../src/list/list-display-name'

describe('listDisplayNameFromContent', () => {
  test('the first # H1 names the list', () => {
    expect(listDisplayNameFromContent('# Trade Binder\n\n- Sol Ring\n', '/w/binder.md')).toBe(
      'Trade Binder',
    )
  })

  test('without a title, the file slug does', () => {
    expect(listDisplayNameFromContent('## Main\n1 Sol Ring\n', '/w/decks/burn.md')).toBe('burn')
  })

  test('a heading inside front matter or a fence is not a title', () => {
    const content = ['---', 'note: "# not a title"', '---', '```', '# Nor this', '```', ''].join(
      '\n',
    )
    expect(listDisplayNameFromContent(content, '/w/wanted/wants.md')).toBe('wants')
  })
})
