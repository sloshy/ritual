import { describe, test, expect, afterEach } from 'bun:test'
import prompts from 'prompts'
import { cliRefreshPolicy } from '../../../src/cli/refresh-policy'
import { setNoInputOverride } from '../../../src/util/no-input'
import { stubTty } from '../../test-utils'

// Prompts enabled on a terminal by default; the cases that prove the other
// half of the gate flip one stream each.
stubTty({ stdin: true })

/**
 * The CLI policy's `confirm` is a courtesy offer: it declines — never throws —
 * when prompts are unavailable, whatever the prompt's default, so a headless
 * run can neither hang nor be surprised by a multi-MB download.
 */
describe('cliRefreshPolicy', () => {
  const prompt = { message: 'go?', initial: true }

  afterEach(() => {
    setNoInputOverride(undefined)
  })

  test('carries the mode it was built for', () => {
    expect(cliRefreshPolicy('no-bulk').mode).toBe('no-bulk')
  })

  test('declines when stdin is not a TTY, whatever the prompt default', async () => {
    process.stdin.isTTY = false
    expect(await cliRefreshPolicy('ask').confirm(prompt)).toBe(false)
    expect(await cliRefreshPolicy('ask').confirm({ message: 'go?', initial: false })).toBe(false)
  })

  test('declines under --no-input, even on a TTY', async () => {
    setNoInputOverride(true)
    expect(await cliRefreshPolicy('ask').confirm(prompt)).toBe(false)
  })

  test.each([true, false])(
    'on a TTY with prompts enabled follows the answer (%p)',
    async (answer) => {
      setNoInputOverride(false)
      prompts.inject([answer])
      expect(await cliRefreshPolicy('ask').confirm(prompt)).toBe(answer)
    },
  )
})
