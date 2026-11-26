import { describe, expect, test } from 'bun:test'
import { SignInGate } from '../../../../src/mcp/oauth/sign-in-gate'

/** Tasks that record how many run at once, overall and per key. */
type Probe = {
  peak: number
  peakPerKey: Map<string, number>
  task: (key: string, ms?: number) => () => Promise<void>
}

function probe(): Probe {
  let running = 0
  const perKey = new Map<string, number>()
  const result: Probe = {
    peak: 0,
    peakPerKey: new Map(),
    task:
      (key, ms = 5) =>
      async () => {
        running += 1
        perKey.set(key, (perKey.get(key) ?? 0) + 1)
        result.peak = Math.max(result.peak, running)
        result.peakPerKey.set(key, Math.max(result.peakPerKey.get(key) ?? 0, perKey.get(key) ?? 0))
        await Bun.sleep(ms)
        running -= 1
        perKey.set(key, (perKey.get(key) ?? 1) - 1)
      },
  }
  return result
}

describe('SignInGate', () => {
  test('runs one task at a time per key', async () => {
    const gate = new SignInGate(10, 10)
    const p = probe()
    await Promise.all(Array.from({ length: 6 }, () => gate.run('a', p.task('a'))))
    expect(p.peakPerKey.get('a')).toBe(1)
  })

  test('caps tasks across keys at the limit, and runs them all', async () => {
    const gate = new SignInGate(2, 10)
    const p = probe()
    const keys = ['a', 'b', 'c', 'd', 'e', 'f']
    const results = await Promise.all(keys.map((key) => gate.run(key, p.task(key))))
    expect(results.every((result) => result.ok)).toBe(true)
    expect(p.peak).toBe(2)
    expect([...p.peakPerKey.keys()].sort()).toEqual(keys)
  })

  test('past the limit plus the queue, a task is refused at once, and room comes back', async () => {
    const gate = new SignInGate(1, 2)
    const p = probe()
    const admitted = [
      gate.run('a', p.task('a', 30)),
      gate.run('b', p.task('b')),
      gate.run('c', p.task('c')),
    ]
    expect(gate.hasRoom()).toBe(false)
    const refused = await gate.run('d', p.task('d'))
    expect(refused).toEqual({ ok: false })
    expect(p.peakPerKey.has('d')).toBe(false)
    expect((await Promise.all(admitted)).every((result) => result.ok)).toBe(true)
    expect(gate.hasRoom()).toBe(true)
  })

  test('a failing task does not block the next one for its key', async () => {
    const gate = new SignInGate(1, 4)
    const failing = gate.run('a', () => Promise.reject(new Error('boom')))
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(failing).rejects.toThrow('boom')
    expect(await gate.run('a', () => Promise.resolve(42))).toEqual({ ok: true, value: 42 })
  })
})
