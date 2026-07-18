import { describe, test, expect } from 'bun:test'
import { hasAnswerFlag, answerFlagRequiredMessage } from '../../scripts/dev-args'

describe('hasAnswerFlag', () => {
  test('false when no refresh answer is present', () => {
    expect(hasAnswerFlag([])).toBe(false)
    expect(hasAnswerFlag(['--port', '3000', '--decks', 'Burn'])).toBe(false)
  })

  test('false for --refresh ask — it restates the prompting default', () => {
    expect(hasAnswerFlag(['--refresh', 'ask'])).toBe(false)
    expect(hasAnswerFlag(['--refresh=ask'])).toBe(false)
  })

  test('true for each non-ask refresh mode', () => {
    expect(hasAnswerFlag(['--refresh', 'auto'])).toBe(true)
    expect(hasAnswerFlag(['--refresh', 'no-bulk'])).toBe(true)
    expect(hasAnswerFlag(['--refresh', 'never'])).toBe(true)
  })

  test('accepts the --refresh=<mode> spelling', () => {
    expect(hasAnswerFlag(['--refresh=auto'])).toBe(true)
    expect(hasAnswerFlag(['--refresh=no-bulk'])).toBe(true)
    expect(hasAnswerFlag(['--refresh=never'])).toBe(true)
  })

  test('true for --no-input, even alongside --refresh ask', () => {
    expect(hasAnswerFlag(['--no-input'])).toBe(true)
    expect(hasAnswerFlag(['--refresh', 'ask', '--no-input'])).toBe(true)
  })

  test('true when a refresh answer is mixed with other args', () => {
    expect(hasAnswerFlag(['--port', '8080', '--refresh', 'never'])).toBe(true)
  })

  test('the last --refresh wins, matching commander', () => {
    expect(hasAnswerFlag(['--refresh', 'ask', '--refresh', 'auto'])).toBe(true)
    expect(hasAnswerFlag(['--refresh', 'auto', '--refresh', 'ask'])).toBe(false)
  })

  test('matches the mode value case-insensitively, like the CLI parser', () => {
    expect(hasAnswerFlag(['--refresh', 'AUTO'])).toBe(true)
    expect(hasAnswerFlag(['--refresh', 'Never'])).toBe(true)
  })

  test('false when --refresh is missing its value or given an unknown mode', () => {
    expect(hasAnswerFlag(['--refresh'])).toBe(false)
    expect(hasAnswerFlag(['--refresh', 'sometimes'])).toBe(false)
  })
})

describe('answerFlagRequiredMessage', () => {
  test('names the subcommand and every prompt-free answer', () => {
    const message = answerFlagRequiredMessage('serve')
    expect(message).toContain("'serve'")
    expect(message).toContain('--refresh auto')
    expect(message).toContain('--refresh no-bulk')
    expect(message).toContain('--refresh never')
    expect(message).toContain('--no-input')
  })
})
