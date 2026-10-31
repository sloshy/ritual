import { describe, expect, test } from 'bun:test'
import type { CacheStatusResult } from '../../src/cache/status'
import { CONTEXT, FRESH_CACHE, HOUR, NOW, healthy } from '../helpers/doctor-facts'
import { formatDoctorText } from '../../src/commands/doctor'
import {
  buildDoctorReport,
  DOCTOR_CHECK_IDS,
  homeRelative,
  type DoctorCheck,
  type DoctorCheckId,
  type DoctorFacts,
} from '../../src/doctor/report'
import { syncMessage, syncText } from '../../src/sync/message'

/**
 * `ritual doctor`'s verdicts, judged from injected facts. Gathering the facts
 * from a real workspace is the integration suite's (`doctor.test.ts`); here
 * every branch of every check is reachable without one.
 */

type FactsChange = (facts: DoctorFacts) => void

/** The one check `id` of the report built from {@link healthy} facts after `change`. */
function checkOf(id: DoctorCheckId, change: FactsChange = () => {}): DoctorCheck {
  const facts = healthy()
  change(facts)
  const found = buildDoctorReport(facts, CONTEXT).checks.find((c) => c.id === id)
  if (found === undefined) throw new Error(`no ${id} check`)
  return found
}

/** A check as status + catalog keys: what a verdict *is*, independent of wording. */
type Verdict = { status: string; summary?: string; hint?: string | null }

function verdict(c: DoctorCheck): Verdict {
  return { status: c.status, summary: c.summary.messageKey, hint: c.hint?.messageKey ?? null }
}

const PROBLEM = syncMessage('domain.config.mustBeBoolean', { field: 'updateCheck' })

describe('buildDoctorReport', () => {
  test('a healthy setup passes every check, in report order', () => {
    const report = buildDoctorReport(healthy(), CONTEXT)
    expect(report.checks.map((c) => c.id)).toEqual([...DOCTOR_CHECK_IDS])
    expect(report.checks.map((c) => c.status)).toEqual(DOCTOR_CHECK_IDS.map(() => 'ok'))
    expect(report.checks.every((c) => c.hint === null && c.details.length === 0)).toBe(true)
    expect(report.ok).toBe(true)
  })

  test('the report carries the facts it was judged from', () => {
    const facts = healthy()
    const { ok: _ok, checks: _checks, ...rest } = buildDoctorReport(facts, CONTEXT)
    expect(rest).toEqual(facts)
  })

  test('warnings alone keep the report ok; one failure does not', () => {
    const warned = healthy()
    warned.migrations.state = 'pending'
    expect(buildDoctorReport(warned, CONTEXT).ok).toBe(true)
    warned.config = { state: 'invalid', problems: [PROBLEM] }
    expect(buildDoctorReport(warned, CONTEXT).ok).toBe(false)
  })

  test('the build line names version, build, install, platform and Bun', () => {
    expect(checkOf('ritual').summary.message).toBe(
      'Ritual 0.1.0 (release build, installed binary) on linux x64, Bun 1.4.4',
    )
  })
})

describe('workspace check', () => {
  test('counts each list type, with the home folder shown as ~', () => {
    expect(checkOf('workspace').summary.message).toBe(
      'Workspace ~/mtg: 3 decks, 1 collection, 0 wanted lists',
    )
  })

  test('a folder with no list folders and no config is not a workspace', () => {
    const c = checkOf('workspace', (f) => {
      f.workspace.configFile = false
      for (const folder of Object.values(f.workspace.folders)) folder.exists = false
    })
    expect(verdict(c)).toEqual({
      status: 'warn',
      summary: 'domain.doctor.workspace.notFound',
      hint: 'domain.doctor.workspace.notFoundHint',
    })
  })

  test('a config file alone makes it a workspace', () => {
    const c = checkOf('workspace', (f) => {
      for (const folder of Object.values(f.workspace.folders)) folder.exists = false
    })
    expect(c.status).toBe('ok')
  })
})

describe('config check', () => {
  test('a missing file is fine: every setting has its default', () => {
    const c = checkOf('config', (f) => {
      f.config = { state: 'absent', problems: [] }
    })
    expect(verdict(c)).toEqual({ status: 'ok', summary: 'domain.doctor.config.absent', hint: null })
  })

  test('invalid settings fail, each listed under the summary', () => {
    const second = syncText('another refusal')
    const c = checkOf('config', (f) => {
      f.config = { state: 'invalid', problems: [PROBLEM, second] }
    })
    expect(verdict(c)).toEqual({
      status: 'fail',
      summary: 'domain.doctor.config.invalid',
      hint: 'domain.doctor.config.invalidHint',
    })
    expect(c.summary.messageParams).toMatchObject({ count: 2 })
    expect(c.details).toEqual([PROBLEM, second])
  })

  test('a file that is not JSON fails with the parser reason under it', () => {
    const reason = syncText("JSON Parse error: Expected '}'")
    const c = checkOf('config', (f) => {
      f.config = { state: 'unreadable', problems: [reason] }
    })
    expect(verdict(c)).toEqual({
      status: 'fail',
      summary: 'domain.doctor.config.unreadable',
      hint: 'domain.doctor.config.unreadableHint',
    })
    expect(c.details).toEqual([reason])
  })
})

describe('migrations check', () => {
  test.each<[string, FactsChange, Verdict]>([
    [
      'no config',
      (f) => (f.migrations.state = 'no-config'),
      { status: 'ok', summary: 'domain.doctor.migrations.noConfig', hint: null },
    ],
    [
      'pending updates',
      (f) => (f.migrations.state = 'pending'),
      {
        status: 'warn',
        summary: 'domain.doctor.migrations.pending',
        hint: 'domain.doctor.migrations.pendingHint',
      },
    ],
    [
      'skipped behind a failing config check',
      (f) => (f.migrations.state = 'unknown'),
      { status: 'warn', summary: 'domain.doctor.migrations.blocked', hint: null },
    ],
  ])('%s', (_label, change, expected) => {
    expect(verdict(checkOf('migrations', change))).toEqual(expected)
  })

  test('a workspace a newer Ritual updated falls back to self-update without a remedy', () => {
    const c = checkOf('migrations', (f) => {
      f.migrations = { state: 'ahead', remedy: null, problem: null }
    })
    expect(verdict(c)).toEqual({
      status: 'warn',
      summary: 'domain.doctor.migrations.ahead',
      hint: 'domain.doctor.migrations.aheadHint',
    })
    expect(c.hint?.messageParams).toEqual({ command: 'ritual self-update' })
  })

  test('a workspace a newer Ritual updated names the remedy the runner chose', () => {
    const c = checkOf('migrations', (f) => {
      f.migrations = { state: 'ahead', remedy: 'docker pull example', problem: null }
    })
    expect(c.status).toBe('warn')
    expect(c.hint?.messageParams).toEqual({ command: 'docker pull example' })
  })

  test('an invalid migrated config fails with the refused setting under it', () => {
    const c = checkOf('migrations', (f) => {
      f.migrations = { state: 'invalid', remedy: null, problem: PROBLEM }
    })
    expect(c.status).toBe('fail')
    expect(c.details).toEqual([PROBLEM])
  })

  test('a check that failed says why', () => {
    const why = syncText('EACCES: permission denied')
    const c = checkOf('migrations', (f) => {
      f.migrations = { state: 'unknown', remedy: null, problem: why }
    })
    expect(verdict(c)).toEqual({
      status: 'warn',
      summary: 'domain.doctor.migrations.unknown',
      hint: null,
    })
    expect(c.details).toEqual([why])
  })
})

describe('cache check', () => {
  test('a fresh cache reports its size and age, home shown as ~', () => {
    expect(checkOf('cache').summary.message).toBe(
      'The card cache at ~/.cache/ritual holds 31240 cards, refreshed 3 hours ago',
    )
  })

  test('a configured cache server is named, never asked', () => {
    const c = checkOf('cache', (f) => {
      f.cache.server = '127.0.0.1:4000'
      f.cache.status = null
    })
    expect(verdict(c)).toEqual({ status: 'ok', summary: 'domain.doctor.cache.server', hint: null })
  })

  const status = (change: Partial<CacheStatusResult>): FactsChange => {
    return (f) => {
      f.cache.status = { ...FRESH_CACHE, ...change }
    }
  }

  test.each<[string, FactsChange, Verdict]>([
    [
      'an empty cache',
      status({ empty: true, cardCount: 0, lastCardRefresh: null }),
      {
        status: 'warn',
        summary: 'domain.doctor.cache.empty',
        hint: 'domain.doctor.cache.emptyHint',
      },
    ],
    [
      'a cache built for another defaultLanguage',
      status({ bulkTypeStale: true }),
      {
        status: 'warn',
        summary: 'domain.doctor.cache.bulkStale',
        hint: 'domain.doctor.cache.refreshHint',
      },
    ],
    [
      'stale prices',
      status({ lastCardRefresh: new Date(NOW - 30 * HOUR).toISOString(), priceStale: true }),
      {
        status: 'warn',
        summary: 'domain.doctor.cache.stale',
        hint: 'domain.doctor.cache.refreshHint',
      },
    ],
    [
      'a cache that cannot be read',
      (f) => {
        f.cache.status = null
        f.cache.problem = syncText('JSON Parse error')
      },
      {
        status: 'warn',
        summary: 'domain.doctor.cache.unreadable',
        hint: 'domain.doctor.cache.refreshHint',
      },
    ],
    [
      'no status at all (nothing read)',
      (f) => (f.cache.status = null),
      {
        status: 'warn',
        summary: 'domain.doctor.cache.empty',
        hint: 'domain.doctor.cache.emptyHint',
      },
    ],
    [
      'a cache built for another language wins over stale prices',
      status({ bulkTypeStale: true, priceStale: true }),
      {
        status: 'warn',
        summary: 'domain.doctor.cache.bulkStale',
        hint: 'domain.doctor.cache.refreshHint',
      },
    ],
    [
      'a never-refreshed cache whose prices are not stale',
      status({ lastCardRefresh: null, priceStale: false }),
      { status: 'ok', summary: 'domain.doctor.cache.neverRefreshed', hint: null },
    ],
    [
      'a cache filled card by card, never bulk-refreshed',
      status({ lastCardRefresh: null, priceStale: true }),
      {
        status: 'warn',
        summary: 'domain.doctor.cache.neverRefreshed',
        hint: 'domain.doctor.cache.refreshHint',
      },
    ],
  ])('%s', (_label, change, expected) => {
    expect(verdict(checkOf('cache', change))).toEqual(expected)
  })
})

describe('update check', () => {
  test.each<[string, FactsChange, Verdict]>([
    [
      'a development build',
      (f) => (f.update.mode = 'development'),
      { status: 'ok', summary: 'domain.doctor.update.development', hint: null },
    ],
    [
      'the Docker image',
      (f) => (f.update.mode = 'docker'),
      { status: 'ok', summary: 'domain.doctor.update.docker', hint: null },
    ],
    [
      'the Docker image, even with a newer release cached',
      (f) => {
        f.update.mode = 'docker'
        f.update.latest = '0.2.0'
        f.update.available = true
      },
      { status: 'ok', summary: 'domain.doctor.update.docker', hint: null },
    ],
    [
      'checks turned off',
      (f) => (f.update.mode = 'off'),
      { status: 'ok', summary: 'domain.doctor.update.off', hint: null },
    ],
    [
      'a newer release seen',
      (f) => {
        f.update.latest = '0.2.0'
        f.update.available = true
      },
      {
        status: 'warn',
        summary: 'domain.doctor.update.available',
        hint: 'domain.doctor.update.availableHint',
      },
    ],
    [
      'no check yet',
      (f) => {
        f.update.latest = null
        f.update.checkedAt = null
      },
      { status: 'ok', summary: 'domain.doctor.update.neverChecked', hint: null },
    ],
  ])('%s', (_label, change, expected) => {
    expect(verdict(checkOf('update', change))).toEqual(expected)
  })

  test('an up-to-date check says how long ago it ran', () => {
    expect(checkOf('update').summary.message).toBe(
      'Up to date as of the last update check, 2 hours ago',
    )
  })
})

describe('homeRelative', () => {
  test.each<[string, string, string]>([
    ['/home/ana/mtg', '/home/ana', '~/mtg'],
    ['/home/ana', '/home/ana/', '~'],
    ['/home/anabel/mtg', '/home/ana', '/home/anabel/mtg'],
    ['/srv/mtg', '/home/ana', '/srv/mtg'],
    ['C:\\Users\\ana\\mtg', 'C:\\Users\\ana', '~\\mtg'],
    ['/mtg', '/', '/mtg'],
    ['/mtg', '//', '/mtg'],
    ['C:\\mtg', 'C:\\', 'C:\\mtg'],
  ])('%s under home %s → %s', (input, home, expected) => {
    expect(homeRelative(input, home)).toBe(expected)
  })
})

describe('formatDoctorText', () => {
  test('one line per check, problems and fixes indented under it, then where to paste it', () => {
    const facts = healthy()
    facts.config = { state: 'invalid', problems: [PROBLEM, syncText('first line\nsecond line')] }
    const lines = formatDoctorText(buildDoctorReport(facts, CONTEXT)).split('\n')
    expect(lines.slice(2, 7)).toEqual([
      'fail  ritual.config.json has 2 invalid settings',
      `      - ${PROBLEM.message}`,
      '      - first line',
      '      second line',
      '      Fix: Ritual uses the default instead of each one, and will not publish a site with an invalid site block: correct them in ritual.config.json, or reset one with `ritual config unset <key>`.',
    ])
    expect(lines[0]).toStartWith('ok    Ritual 0.1.0')
    expect(lines.slice(-2)).toEqual([
      '',
      'Paste this into a bug report: https://example.test/fork/issues',
    ])
  })
})
