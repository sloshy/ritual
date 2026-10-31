import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { buildProgram, type CommandRegistrar } from '../../../src/cli/program'
import { addDryRunOption, addOutputOption, addQuietOption } from '../../../src/cli/options'
import { createSidecarNotice } from '../../../src/commands/sidecar-notice'
import { t } from '../../../src/i18n/t'
import { FILE } from '../../../src/util/cli-tokens'
import { captureConsole } from '../../helpers/capture'
import { captureExitCode, NO_UPDATE_NOTICE } from '../../helpers/cli'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'

const NOTICE = t('cli.sidecarNotice.introduction', { file: FILE.hashSidecar })

describe('createSidecarNotice', () => {
  let ws: BoundWorkspace
  beforeEach(async () => {
    ws = await bindWorkspace()
  })
  afterEach(async () => {
    await ws.dispose()
  })

  /** A command that writes a list with its sidecar, the way `ritual new` does. */
  function writer(name: string): CommandRegistrar {
    return (root) => {
      addDryRunOption(addQuietOption(addOutputOption(root.command(name))), 'dry run').action(
        async () => {
          const decks = path.join(ws.dir, 'decks')
          await fs.mkdir(decks, { recursive: true })
          await fs.writeFile(path.join(decks, `${name}.md`), '# Deck\n')
          await fs.writeFile(path.join(decks, `${name}.md.sha256`), 'hash')
        },
      )
    }
  }

  /** A command (one that may write) whose run happens to write nothing. */
  function idle(name: string): CommandRegistrar {
    return (root) => {
      root.command(name).action(() => undefined)
    }
  }

  async function run(args: string[]): Promise<string[]> {
    const program = buildProgram({
      groups: [
        {
          titleKey: 'help.group.utilities',
          // `new` and `import` can write a first sidecar; `lists` cannot, so
          // it is never probed even when (as this fake does) it writes one.
          commands: [writer('new'), writer('import'), writer('lists'), idle('add-card')],
        },
      ],
      backfill: () => false,
      workspaceCheck: () => Promise.resolve(),
      updateNotice: NO_UPDATE_NOTICE,
      sidecarNotice: createSidecarNotice(),
    })
    const captured = await captureConsole(['warn'], () =>
      captureExitCode(() => program.parseAsync(['--base-dir', ws.dir, ...args], { from: 'user' })),
    )
    return captured.lines.warn
  }

  test('introduces the sidecars once, when a run writes the workspace’s first', async () => {
    expect(await run(['new'])).toEqual([NOTICE])
    expect(await run(['import'])).toEqual([])
  })

  test.each([
    [['new', '--output', 'json']],
    [['new', '--quiet']],
    [['new', '--dry-run']],
    [['lists']],
  ])('stays quiet for %p', async (args) => {
    expect(await run(args)).toEqual([])
  })

  test('a run that leaves the workspace without a sidecar says nothing', async () => {
    expect(await run(['add-card'])).toEqual([])
  })

  test('a sidecar in any list folder, nested or not, counts as existing', async () => {
    const nested = path.join(ws.dir, 'wanted', 'old')
    await fs.mkdir(nested, { recursive: true })
    await fs.writeFile(path.join(nested, 'Grails.md.sha256'), 'hash')
    expect(await run(['new'])).toEqual([])
  })
})
