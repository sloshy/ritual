import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import prompts from 'prompts'
import { registerMigrateCommand } from '../../../src/commands/migrate'
import { ExitCode } from '../../../src/util/errors'
import { runInProcess } from '../../helpers/cli'
import { REFRESH_DUE_CONFIG } from '../../helpers/migrations'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'
import { stubTty } from '../../test-utils'

// The confirm answer comes from prompts.inject; ask() still wants a terminal.
stubTty({ stdin: true })

describe('migrate confirmation prompt', () => {
  const log = spyOn(console, 'log').mockImplementation(() => {})
  const error = spyOn(console, 'error').mockImplementation(() => {})
  let ws: BoundWorkspace

  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: REFRESH_DUE_CONFIG })
  })
  afterEach(async () => {
    await ws.dispose()
    log.mockClear()
    error.mockClear()
  })
  afterAll(() => {
    log.mockRestore()
    error.mockRestore()
  })

  const readConfig = (): Promise<string> =>
    fs.readFile(path.join(ws.dir, 'ritual.config.json'), 'utf-8')

  test('yes applies the plan', async () => {
    prompts.inject([true])

    expect(await runInProcess(registerMigrateCommand, ['migrate'])).toBe(ExitCode.Success)
    expect(JSON.parse(await readConfig()).managed.output).toStartWith('sha256:')
  })

  test('no cancels with a usage exit and writes nothing', async () => {
    const before = await readConfig()
    prompts.inject([false])

    expect(await runInProcess(registerMigrateCommand, ['migrate'])).toBe(ExitCode.UsageError)
    expect(error).toHaveBeenCalledWith('Cancelled; nothing was written.')
    expect(await readConfig()).toBe(before)
  })
})
