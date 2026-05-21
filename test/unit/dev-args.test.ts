import { describe, test, expect } from 'bun:test'
import { hasAnswerFlag, answerFlagRequiredMessage } from '../../scripts/dev-args'

describe('hasAnswerFlag', () => {
  test('false when no refresh answer is present', () => {
    expect(hasAnswerFlag([])).toBe(false)
    expect(hasAnswerFlag(['--port', '3000', '--decks', 'Burn'])).toBe(false)
  })

  test('true for each accepted refresh flag', () => {
    expect(hasAnswerFlag(['--allow-refresh'])).toBe(true)
    expect(hasAnswerFlag(['--allow-refresh-no-bulk'])).toBe(true)
    expect(hasAnswerFlag(['--no-refresh'])).toBe(true)
  })

  test('true when a refresh flag is mixed with other args', () => {
    expect(hasAnswerFlag(['--port', '8080', '--no-refresh'])).toBe(true)
  })
})

describe('answerFlagRequiredMessage', () => {
  test('names the subcommand and all three refresh choices', () => {
    const message = answerFlagRequiredMessage('serve-site')
    expect(message).toContain('serve-site')
    expect(message).toContain('--allow-refresh')
    expect(message).toContain('--allow-refresh-no-bulk')
    expect(message).toContain('--no-refresh')
  })
})
