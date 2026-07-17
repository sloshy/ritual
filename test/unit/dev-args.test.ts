import { describe, test, expect } from 'bun:test'
import { hasAnswerFlag, answerFlagRequiredMessage } from '../../scripts/dev-args'

describe('hasAnswerFlag', () => {
  test('false when no refresh answer is present', () => {
    expect(hasAnswerFlag('serve-site', [])).toBe(false)
    expect(hasAnswerFlag('serve-site', ['--port', '3000', '--decks', 'Burn'])).toBe(false)
  })

  test('true for each accepted refresh flag', () => {
    expect(hasAnswerFlag('serve-site', ['--allow-refresh'])).toBe(true)
    expect(hasAnswerFlag('serve-site', ['--allow-refresh-no-bulk'])).toBe(true)
    expect(hasAnswerFlag('serve-site', ['--no-refresh'])).toBe(true)
  })

  test('true when a refresh flag is mixed with other args', () => {
    expect(hasAnswerFlag('serve-site', ['--port', '8080', '--no-refresh'])).toBe(true)
  })

  test('admin does not accept the no-bulk flag it no longer has', () => {
    expect(hasAnswerFlag('admin', ['--allow-refresh-no-bulk'])).toBe(false)
    expect(hasAnswerFlag('admin', ['--allow-refresh'])).toBe(true)
    expect(hasAnswerFlag('admin', ['--no-refresh'])).toBe(true)
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

  test('omits the no-bulk suggestion for admin', () => {
    const message = answerFlagRequiredMessage('admin')
    expect(message).toContain('admin')
    expect(message).not.toContain('--allow-refresh-no-bulk')
    expect(message).toContain('--no-refresh')
  })
})
