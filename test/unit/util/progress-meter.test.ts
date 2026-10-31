import { describe, expect, test } from 'bun:test'
import { createProgressMeter, type ProgressFrame } from '../../../src/util/progress-meter'
import { fetchProgressFrame } from '../../../src/site-build/card-fetch'

/** Drive a meter through `frames`, then end it; everything it wrote, joined. */
function drive(interactive: boolean, frames: readonly ProgressFrame[]): string {
  let written = ''
  const meter = createProgressMeter({ interactive, write: (text) => (written += text) })
  for (const frame of frames) meter.update(frame)
  meter.end()
  return written
}

/** Frames for every whole percent from 0 to 100, as a fine-grained download reports them. */
const everyPercent: ProgressFrame[] = Array.from({ length: 101 }, (_, percent) => ({
  percent,
  line: `Processing: ${percent}%`,
}))

describe('createProgressMeter', () => {
  test('on a terminal, every frame redraws the one line, closed by a newline', () => {
    const written = drive(true, everyPercent.slice(0, 3))
    expect(written).toBe('\rProcessing: 0%\rProcessing: 1%\rProcessing: 2%\n')
  })

  test('off a terminal, it prints whole lines at the start and each 25% milestone only', () => {
    expect(drive(false, everyPercent).split('\n')).toEqual([
      'Processing: 0%',
      'Processing: 25%',
      'Processing: 50%',
      'Processing: 75%',
      'Processing: 100%',
      '',
    ])
  })

  test('off a terminal, the last frame is printed even when it lands between milestones', () => {
    const frames: ProgressFrame[] = [10, 30, 40].map((percent) => ({
      percent,
      line: `${percent}%`,
    }))
    // 10 opens, 30 crosses 25, and 40 — short of 50 — is printed by end().
    expect(drive(false, frames)).toBe('10%\n30%\n40%\n')
  })

  test('off a terminal, a frame that skips several milestones prints once', () => {
    const frames: ProgressFrame[] = [0, 90, 100].map((percent) => ({
      percent,
      line: `${percent}%`,
    }))
    expect(drive(false, frames)).toBe('0%\n90%\n100%\n')
  })

  test('an unsized run prints its first and last frames', () => {
    const frames: ProgressFrame[] = ['1 MiB', '2 MiB', '3 MiB'].map((line) => ({
      percent: undefined,
      line,
    }))
    expect(drive(false, frames)).toBe('1 MiB\n3 MiB\n')
  })

  test('a meter that was never updated writes nothing, on a terminal or off one', () => {
    expect(drive(true, [])).toBe('')
    expect(drive(false, [])).toBe('')
  })
})

describe('fetchProgressFrame', () => {
  test('a terminal frame carries the bar; a log frame is the bare count', () => {
    expect(fetchProgressFrame(1, 2, true)).toEqual({
      percent: 50,
      line: `[${'█'.repeat(15)}${'░'.repeat(15)}] 50% (1/2)`,
    })
    expect(fetchProgressFrame(1, 2, false)).toEqual({ percent: 50, line: '50% (1/2)' })
  })
})
