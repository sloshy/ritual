import { describe, expect, test } from 'bun:test'
import {
  createFenceTracker,
  endsInsideOpenFence,
  frontMatterBodyStart,
  markFencedLines,
} from '../../src/list/markdown-fence'

/** Feed every line of `text` and return the opaque flag for each, in order. */
function opaqueFlags(text: string): boolean[] {
  const tracker = createFenceTracker()
  return text.split('\n').map((line) => tracker.feed(line).opaque)
}

/** The lines of `text` the tracker leaves visible to a parser. */
function visibleLines(text: string): string[] {
  const flags = opaqueFlags(text)
  return text.split('\n').filter((_, i) => !flags[i])
}

describe('createFenceTracker', () => {
  test('a backtick fence hides its delimiters and its content', () => {
    expect(opaqueFlags(['1 Sol Ring', '```', 'inside', '```', '1 Mox Pearl'].join('\n'))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ])
  })

  test('a CRLF file split on LF still opens and closes its fences', () => {
    const lines = ['1 Sol Ring', '```', '1 Mox Pearl', '```', '1 Island'].join('\r\n')
    expect(opaqueFlags(lines)).toEqual([false, true, true, true, false])
  })

  test('a tilde fence works the same as a backtick fence', () => {
    expect(visibleLines(['before', '~~~', 'inside', '~~~', 'after'].join('\n'))).toEqual([
      'before',
      'after',
    ])
  })

  test('an info string opens a fence and is not confused for a closer', () => {
    expect(visibleLines(['```markdown', '## Fake Section', '```', 'after'].join('\n'))).toEqual([
      'after',
    ])
  })

  test('a backtick fence whose info string contains a backtick does not open a block', () => {
    // CommonMark: ``` followed by an info string containing a backtick is a paragraph.
    expect(opaqueFlags(['``` js `x`', '1 Sol Ring'].join('\n'))).toEqual([false, false])
  })

  test('a tilde fence info string may contain backticks', () => {
    expect(visibleLines(['~~~ `js`', 'inside', '~~~', 'after'].join('\n'))).toEqual(['after'])
  })

  test('a closer may be longer than its opener, but not shorter', () => {
    expect(
      visibleLines(['````', 'inside', '```', 'still inside', '````', 'after'].join('\n')),
    ).toEqual(['after'])
  })

  test('a closing fence may not carry an info string', () => {
    expect(
      visibleLines(['```', 'inside', '``` js', 'still inside', '```', 'after'].join('\n')),
    ).toEqual(['after'])
  })

  test('a closing fence may carry trailing whitespace', () => {
    expect(visibleLines(['```', 'inside', '```   ', 'after'].join('\n'))).toEqual(['after'])
  })

  test('fences do not nest: the other fence character is ordinary content', () => {
    expect(visibleLines(['```', '~~~', 'inside', '~~~', '```', 'after'].join('\n'))).toEqual([
      'after',
    ])
    expect(visibleLines(['~~~', '```', 'inside', '```', '~~~', 'after'].join('\n'))).toEqual([
      'after',
    ])
  })

  test('a fence may be indented up to three spaces; four is not a fence', () => {
    expect(visibleLines(['   ```', 'inside', '   ```', 'after'].join('\n'))).toEqual(['after'])
    expect(opaqueFlags(['    ```', '1 Sol Ring'].join('\n'))).toEqual([false, false])
  })

  test('fewer than three fence characters is not a fence', () => {
    expect(opaqueFlags(['``', '1 Sol Ring', '``'].join('\n'))).toEqual([false, false, false])
  })

  test('an unclosed fence extends to the end of the file (CommonMark)', () => {
    const flags = opaqueFlags(['1 Sol Ring', '```', 'inside', '1 Mox Pearl', ''].join('\n'))
    expect(flags).toEqual([false, true, true, true, true])
  })

  test('isOpen reports whether the file ended inside a fence', () => {
    const tracker = createFenceTracker()
    tracker.feed('```')
    expect(tracker.isOpen).toBe(true)
    tracker.feed('```')
    expect(tracker.isOpen).toBe(false)
  })

  test('role names each part of a block, and outside for everything else', () => {
    const tracker = createFenceTracker()
    const roles = ['before', '```js', 'inside', '```', 'after'].map(
      (line) => tracker.feed(line).role,
    )
    expect(roles).toEqual(['outside', 'open', 'content', 'close', 'outside'])
  })

  test('a returned state cannot be mutated into a different classification', () => {
    const tracker = createFenceTracker()
    const outside = tracker.feed('1 Sol Ring')
    expect(() => {
      // The `outside` result is a shared frozen singleton: a caller writing to
      // it would otherwise poison every later result in the process.
      ;(outside as { opaque: boolean }).opaque = true
    }).toThrow()
    expect(tracker.feed('1 Mox Pearl').opaque).toBe(false)
  })

  test('a blank line is never a fence and never closes one', () => {
    expect(opaqueFlags(['', '```', '', '```', ''].join('\n'))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ])
  })
})

describe('markFencedLines', () => {
  test('flags fenced lines by index', () => {
    expect(markFencedLines(['a', '```', 'b', '```', 'c'])).toEqual([false, true, true, true, false])
  })

  test('lines before startIndex are never fenced and do not feed the tracker', () => {
    // The front matter's ``` must not open a fence over the body.
    const lines = ['---', 'note: "```"', '---', '1 Sol Ring &1']
    expect(markFencedLines(lines, 3)).toEqual([false, false, false, false])
  })
})

describe('frontMatterBodyStart', () => {
  test('is 0 when the content has no front matter', () => {
    expect(frontMatterBodyStart(['# Title', '- Sol Ring &1'])).toBe(0)
  })

  test('points past a closed front-matter block', () => {
    expect(frontMatterBodyStart(['---', 'name: D', '---', '', '## Main'])).toBe(3)
  })

  test('an unterminated block is body, matching gray-matter', () => {
    expect(frontMatterBodyStart(['---', 'name: D', '## Main'])).toBe(0)
  })
})

describe('endsInsideOpenFence', () => {
  test('is false for a closed fence', () => {
    expect(endsInsideOpenFence('- A &1\n```\n- Example\n```\n')).toBe(false)
  })

  test('is true when a fence is never closed', () => {
    expect(endsInsideOpenFence('- A &1\n```\n- Example\n')).toBe(true)
  })

  test('a ``` inside front matter does not leave the file open', () => {
    expect(endsInsideOpenFence('---\nnote: "```"\n---\n\n- A &1\n')).toBe(false)
  })
})
