import { describe, expect, test } from 'bun:test'
import { jsonErrorPosition } from '../../src/util/json'
import { invalidJsonMessage } from '../../src/list/sidecar-message'

describe('jsonErrorPosition', () => {
  test("reads the line and column from V8's and SpiderMonkey's wording", () => {
    const v8 = new SyntaxError(
      "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
    )
    const spiderMonkey = new SyntaxError(
      "JSON.parse: expected property name or '}' at line 3 column 14 of the JSON data",
    )
    expect(jsonErrorPosition(v8)).toEqual({ line: 1, column: 2 })
    expect(jsonErrorPosition(spiderMonkey)).toEqual({ line: 3, column: 14 })
  })

  test('reads only the frame at the end of the message, never the quoted input', () => {
    // V8 quotes the input it choked on: a document reading "line 5 column 9".
    const quoted = new SyntaxError('Unexpected token \'l\', "line 5 column 9" is not valid JSON')
    // A synthetic V8 message (Bun's own engine words this differently): the
    // quoted input does hold a position-shaped phrase, which only the anchored
    // frame ignores.
    expect(quoted.message).toMatch(/line \d+ column \d+/)
    expect(jsonErrorPosition(quoted)).toBeUndefined()
    const both = new SyntaxError(
      'Unexpected token \'l\', "line 5 column 9" is not valid JSON (line 1 column 1)',
    )
    expect(jsonErrorPosition(both)).toEqual({ line: 1, column: 1 })
  })

  test('is undefined when the engine names no position, or for a non-error', () => {
    expect(jsonErrorPosition(new SyntaxError("JSON Parse error: Expected '}'"))).toBeUndefined()
    expect(jsonErrorPosition('line 1 column 2')).toBeUndefined()
  })
})

describe('invalidJsonMessage', () => {
  test('names the position when the engine gives one, and never its own text', () => {
    const v8 = new SyntaxError(
      "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
    )
    expect(invalidJsonMessage(v8)).toEqual({
      message: 'not valid JSON (line 1, column 2)',
      messageKey: 'domain.list.sidecar.invalidJsonAt',
      messageParams: { line: 1, column: 2 },
    })
    expect(invalidJsonMessage(new SyntaxError("JSON Parse error: Expected '}'"))).toEqual({
      message: 'not valid JSON',
      messageKey: 'domain.list.sidecar.invalidJson',
    })
  })
})
