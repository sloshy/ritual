import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  OAuthStateInvariantError,
  OAuthStateUnavailableError,
  OAuthStore,
  oauthStatePath,
} from '../../../../src/auth/mcp-oauth/store'
import type { OAuthState } from '../../../../src/auth/mcp-oauth/state'
import { MCP_RESOURCE, openStore } from '../../../helpers/oauth'
import { bindWorkspace, writeLoginFile, type BoundWorkspace } from '../../../helpers/workspace'

const NOW = Date.now()

/**
 * A worker that checks, as fast as it can, whether `file` exists, until told
 * to stop; it then reports how often it found the file missing. A worker runs
 * on its own thread, so it sees the file between the store's awaits too.
 */
const POLLER = `
const { existsSync } = require('node:fs')
let file, stop = false, counting = false, misses = 0, polls = 0
const loop = () => {
  for (let i = 0; i < 5000; i++) {
    const missing = !existsSync(file)
    if (counting) { polls++; if (missing) misses++ }
  }
  if (stop) postMessage({ misses, polls }); else setTimeout(loop, 0)
}
self.onmessage = (event) => {
  if (event.data.stop) { stop = true; return }
  if (event.data.go) { counting = true; return }
  file = event.data.file
  postMessage('started')
  loop()
}
`

type PollReport = { misses: number; polls: number }

/**
 * Run `work` while a worker polls `file`; how often it found the file absent.
 * Polls count only from a `go` sent just before `work`, so a positive count
 * shows the worker really was polling while it ran. A failing worker rejects
 * at once instead of leaving the test to time out.
 */
async function pollWhile(file: string, work: () => Promise<void>): Promise<PollReport> {
  const worker = new Worker(URL.createObjectURL(new Blob([POLLER], { type: 'text/javascript' })))
  let fail: (error: unknown) => void = () => undefined
  worker.onerror = (event) => fail(event.error ?? new Error(event.message))
  try {
    const started = new Promise<void>((resolve, reject) => {
      fail = reject
      worker.onmessage = () => resolve()
    })
    worker.postMessage({ file })
    await started
    worker.postMessage({ go: true })
    await work()
    const report = new Promise<PollReport>((resolve, reject) => {
      fail = reject
      worker.onmessage = (event: MessageEvent<PollReport>) => resolve(event.data)
    })
    worker.postMessage({ stop: true })
    return await report
  } finally {
    worker.terminate()
  }
}

/** The files beside the state file that belong to it: leftovers of a write. */
async function strayFiles(): Promise<string[]> {
  const name = path.basename(oauthStatePath())
  const entries = await fs.readdir(path.dirname(oauthStatePath()))
  return entries.filter((entry) => entry.startsWith(`${name}.`))
}

function addClient(id: string) {
  return (draft: OAuthState): void => {
    draft.clients.push({ clientId: id, redirectUris: ['https://a.example/cb'], createdAt: NOW })
  }
}

function addGrant(draft: OAuthState): void {
  draft.grants.push({
    grantId: 'g1',
    clientId: 'c1',
    scopes: ['mcp'],
    resource: MCP_RESOURCE,
    credentialFingerprint: 'fp',
    createdAt: NOW,
    refreshTokenHash: 'r',
    refreshExpiresAt: NOW + 60_000,
    rotatedRefreshTokens: [],
    accessTokens: [],
  })
}

describe('OAuthStore', () => {
  let ws: BoundWorkspace
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
  })
  afterEach(async () => {
    await ws.dispose()
  })

  const open = openStore

  test('a missing file opens as an empty state and is written 0600 on the first change', async () => {
    const store = await open()
    expect(store.state.clients).toEqual([])
    await store.update(NOW, addClient('c1'))
    const stat = await fs.stat(oauthStatePath())
    expect(stat.mode & 0o777).toBe(0o600)
    const reopened = await open()
    expect(reopened.state.clients.map((c) => c.clientId)).toEqual(['c1'])
  })

  test('a damaged file is a problem naming the file, never a silent reset', async () => {
    const file = await writeLoginFile(ws.dir, 'mcp-oauth.json', '{"version":1,"clients":')
    expect(await OAuthStore.open()).toEqual({ problem: 'json', file })
    expect(await fs.readFile(file, 'utf-8')).toBe('{"version":1,"clients":')
  })

  test('a file that cannot be read is an io problem, not a throw', async () => {
    await fs.mkdir(oauthStatePath(), { recursive: true })
    expect(await OAuthStore.open()).toMatchObject({ problem: 'io', file: oauthStatePath() })
  })

  test('updates run one at a time, each seeing the one before', async () => {
    const store = await open()
    const add = (id: string): Promise<number> =>
      store.update(NOW, (draft) => {
        addClient(id)(draft)
        return draft.clients.length
      })
    expect(await Promise.all([add('a'), add('b'), add('c')])).toEqual([1, 2, 3])
  })

  test('a change that throws leaves the state as it was, and later changes still run', async () => {
    const store = await open()
    const failing = store.update(NOW, (draft) => {
      addClient('x')(draft)
      throw new Error('boom')
    })
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(failing).rejects.toThrow('boom')
    expect(store.state.clients).toEqual([])
    await store.update(NOW, addClient('y'))
    expect(store.state.clients.map((c) => c.clientId)).toEqual(['y'])
  })

  test('a failed write leaves memory unchanged', async () => {
    const store = await open()
    await store.update(NOW, addClient('c1'))
    // A directory where the temporary file would go makes the write fail.
    await fs.chmod(path.dirname(oauthStatePath()), 0o500)
    try {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
      await expect(store.update(NOW, addClient('c2'))).rejects.toThrow()
    } finally {
      await fs.chmod(path.dirname(oauthStatePath()), 0o700)
    }
    expect(store.state.clients.map((c) => c.clientId)).toEqual(['c1'])
  })

  test('a change that would produce an unparseable file is refused before anything is written', async () => {
    const store = await open()
    await store.update(NOW, addClient('c1'))
    const before = await fs.readFile(oauthStatePath(), 'utf-8')
    const orphan = store.update(NOW, (draft) => {
      addGrant(draft)
      draft.grants[0]!.resource = 'not a url'
    })
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(orphan).rejects.toBeInstanceOf(OAuthStateInvariantError)
    expect(await fs.readFile(oauthStatePath(), 'utf-8')).toBe(before)
  })

  test('a change that changes nothing writes nothing', async () => {
    const store = await open()
    await store.update(NOW, addClient('c1'))
    const before = await fs.stat(oauthStatePath())
    await Bun.sleep(5)
    await store.update(NOW, () => undefined)
    const after = await fs.stat(oauthStatePath())
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs])
  })

  test('deleting the file while the store is open empties it instead of being rewritten', async () => {
    const store = await open()
    await store.update(NOW, (draft) => {
      addClient('c1')(draft)
      addGrant(draft)
    })
    await fs.rm(oauthStatePath())
    expect((await store.read()).grants).toEqual([])
    await store.update(NOW, addClient('c2'))
    expect((await store.read()).clients.map((c) => c.clientId)).toEqual(['c2'])
  })

  test('once the file exists, no update leaves a moment without it, nor a stray file', async () => {
    const store = await open()
    await store.update(NOW, addClient('c0'))
    // Renamed over, never written in place: the temp file exists beside the
    // target, so each write must land on a different inode than the one before
    // it. (Across several writes a file system may hand a freed number back.)
    let ino = (await fs.stat(oauthStatePath())).ino
    let writtenInPlace = 0
    const report = await pollWhile(oauthStatePath(), async () => {
      for (let i = 1; i <= 100; i++) {
        await store.update(NOW, (draft) => {
          draft.clients = [
            { clientId: `c${i}`, redirectUris: ['https://a.example/cb'], createdAt: NOW },
          ]
        })
        const next = (await fs.stat(oauthStatePath())).ino
        if (next === ino) writtenInPlace += 1
        ino = next
      }
    })
    expect(writtenInPlace).toBe(0)
    expect(report.polls).toBeGreaterThan(0)
    expect(report.misses).toBe(0)
    expect(store.state.clients.map((c) => c.clientId)).toEqual(['c100'])
    expect(await strayFiles()).toEqual([])
    const after = await fs.stat(oauthStatePath())
    expect(after.mode & 0o777).toBe(0o600)
  })

  test('a file rewritten by another process between the check and the write is merged, not overwritten', async () => {
    const store = await open()
    await store.update(NOW, addClient('c1'))
    const good = await fs.readFile(oauthStatePath(), 'utf-8')
    let calls = 0
    await store.update(NOW, (draft) => {
      calls += 1
      // The first time through, another process rewrites the file meanwhile.
      if (calls === 1) writeFileSync(oauthStatePath(), good.replace('"c1"', '"other-process"'))
      addClient('mine')(draft)
    })
    expect(calls).toBe(2)
    const reopened = await open()
    expect(reopened.state.clients.map((c) => c.clientId)).toEqual(['other-process', 'mine'])
    expect(await strayFiles()).toEqual([])
  })

  test('a file deleted between the check and the write is honoured: its grants stay gone', async () => {
    const store = await open()
    await store.update(NOW, (draft) => {
      addClient('c1')(draft)
      addGrant(draft)
    })
    let calls = 0
    await store.update(NOW, (draft) => {
      calls += 1
      if (calls === 1) rmSync(oauthStatePath())
      addClient('c2')(draft)
    })
    expect(calls).toBe(2)
    const reopened = await open()
    expect(reopened.state.grants).toEqual([])
    expect(reopened.state.clients.map((c) => c.clientId)).toEqual(['c2'])
    expect((await fs.stat(oauthStatePath())).mode & 0o777).toBe(0o600)
    expect(await strayFiles()).toEqual([])
  })

  test("another process's file renamed in just after the store's write is merged by the next update", async () => {
    const store = await open()
    await store.update(NOW, addClient('c1'))
    const target = oauthStatePath()
    const realStat = fs.stat
    let replaced = false
    // The first stat of the target once the store's own version is in place
    // (where the store used to read its new identity) finds another process
    // has already renamed its own version over it.
    const stat = spyOn(fs, 'stat').mockImplementation(((file: string, ...rest: unknown[]) => {
      if (!replaced && file === target && readFileSync(target, 'utf-8').includes('"mine"')) {
        replaced = true
        const foreign = `${target}.foreign`
        writeFileSync(foreign, readFileSync(target, 'utf-8').replace('"mine"', '"foreign"'))
        renameSync(foreign, target)
      }
      return (realStat as (...args: unknown[]) => unknown)(file, ...rest)
    }) as typeof fs.stat)
    try {
      await store.update(NOW, addClient('mine'))
      await store.update(NOW, addClient('next'))
    } finally {
      stat.mockRestore()
    }
    expect(replaced).toBe(true)
    const reopened = await open()
    expect(reopened.state.clients.map((c) => c.clientId)).toEqual(['c1', 'foreign', 'next'])
  })

  test('an outside rewrite is picked up; an outside corruption fails closed until fixed', async () => {
    const store = await open()
    await store.update(NOW, addClient('c1'))
    const good = await fs.readFile(oauthStatePath(), 'utf-8')
    await fs.writeFile(oauthStatePath(), good.replace('"c1"', '"c9"'))
    expect((await store.read()).clients.map((c) => c.clientId)).toEqual(['c9'])
    await fs.writeFile(oauthStatePath(), '{')
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(store.read()).rejects.toBeInstanceOf(OAuthStateUnavailableError)
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(store.update(NOW, addClient('c2'))).rejects.toBeInstanceOf(
      OAuthStateUnavailableError,
    )
    expect(await fs.readFile(oauthStatePath(), 'utf-8')).toBe('{')
    await fs.writeFile(oauthStatePath(), good)
    expect((await store.read()).clients.map((c) => c.clientId)).toEqual(['c1'])
  })

  test('a write whose new identity is unknown still counts, and the next check reloads', async () => {
    const store = await open()
    await store.update(NOW, addClient('c1'))
    expect(store.state.clients.map((c) => c.clientId)).toEqual(['c1'])
    const good = await fs.readFile(oauthStatePath(), 'utf-8')
    // An outside rewrite of the same size within the same millisecond would be
    // invisible to the identity check; after an unknown identity it is not.
    ;(store as unknown as { identity: string }).identity = 'unknown'
    await fs.writeFile(oauthStatePath(), good.replace('"c1"', '"c2"'))
    expect((await store.read()).clients.map((c) => c.clientId)).toEqual(['c2'])
  })
})
