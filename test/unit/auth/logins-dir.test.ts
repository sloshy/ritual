import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ensureLoginsDir,
  LOGINS_DIR,
  LOGINS_GITIGNORE,
  LOGINS_GITIGNORE_CONTENT,
} from '../../../src/auth/logins-dir'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'

/**
 * `.logins/` is ignored by git from its first write: every write into it goes
 * through `ensureLoginsDir`, which adds the folder's own `.gitignore`.
 */

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ dirs: [], config: false })
})

afterEach(async () => {
  await ws.dispose()
})

const readIgnore = (): Promise<string> => fs.readFile(path.join(ws.dir, LOGINS_GITIGNORE), 'utf-8')

describe('ensureLoginsDir', () => {
  test('creates a private folder that ignores everything in it', async () => {
    await ensureLoginsDir()

    expect((await fs.stat(path.join(ws.dir, LOGINS_DIR))).mode & 0o777).toBe(0o700)
    expect(await readIgnore()).toBe(LOGINS_GITIGNORE_CONTENT)
  })

  // A folder an older Ritual made gets its ignore file on the next write.
  test('adds the ignore file to a folder made without one', async () => {
    await fs.mkdir(path.join(ws.dir, LOGINS_DIR), { mode: 0o700 })
    await fs.writeFile(path.join(ws.dir, LOGINS_DIR, 'archidekt.json'), '{}\n')

    await ensureLoginsDir()

    expect(await readIgnore()).toBe(LOGINS_GITIGNORE_CONTENT)
  })

  test('keeps an ignore file the user wrote', async () => {
    await fs.mkdir(path.join(ws.dir, LOGINS_DIR), { mode: 0o700 })
    await fs.writeFile(path.join(ws.dir, LOGINS_GITIGNORE), 'admin-audit.log\n')

    await ensureLoginsDir()

    expect(await readIgnore()).toBe('admin-audit.log\n')
  })
})
