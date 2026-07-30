import { describe, expect, test } from 'bun:test'
import { Command } from 'commander'
import { COMMANDS_WITH_ID_BACKFILL, shouldBackfillCardIds } from '../../src/commands/id-backfill'

/**
 * The full decision matrix for the card-ID backfill predicate. The root
 * preAction hook's wiring (that index.ts actually consults this predicate) is
 * pinned by test/integration/ensure-ids-hook.test.ts; everything about WHICH
 * invocations backfill is pinned here.
 */

function command(name: string, options: Record<string, unknown> = {}): Command {
  const cmd = new Command(name)
  for (const [key, value] of Object.entries(options)) {
    cmd.setOptionValue(key, value)
  }
  return cmd
}

describe('shouldBackfillCardIds', () => {
  test('every allowlisted command backfills by default (except plain serve)', () => {
    for (const name of COMMANDS_WITH_ID_BACKFILL) {
      if (name === 'serve') continue
      expect(shouldBackfillCardIds(command(name))).toBe(true)
    }
  })

  // Read commands, the list lifecycle, utilities, and every command absent
  // from the allowlist must never trigger the file-writing backfill.
  const exempt = [
    'lists',
    'diff',
    'price',
    'export',
    'get-primer',
    'list-all-cards',
    'hash',
    'scry',
    'card',
    'new',
    'rename',
    'delete',
    // Deliberately exempt: it must see the working tree exactly as committed.
    'git-detect-changes',
    'init-site',
    'config',
    'login',
    'cache',
    'skills',
    'license',
    'dep-license',
    // Admin account subcommands are matched by their own leaf names, so they
    // stay exempt even though bare `admin` backfills.
    'setup',
    'reset-password',
    'disable-totp',
  ]
  test.each(exempt)('`%s` never backfills', (name) => {
    expect(shouldBackfillCardIds(command(name))).toBe(false)
  })

  test('plain `serve` skips; `serve --build` and `serve --api` backfill', () => {
    expect(shouldBackfillCardIds(command('serve'))).toBe(false)
    expect(shouldBackfillCardIds(command('serve', { build: true }))).toBe(true)
    expect(shouldBackfillCardIds(command('serve', { api: true }))).toBe(true)
  })

  test('`history` backfills in editor mode but not under --show', () => {
    expect(shouldBackfillCardIds(command('history', { show: false }))).toBe(true)
    expect(shouldBackfillCardIds(command('history', { show: true }))).toBe(false)
  })

  test('--dry-run suppresses the backfill on any allowlisted command', () => {
    expect(shouldBackfillCardIds(command('import', { dryRun: true }))).toBe(false)
    expect(shouldBackfillCardIds(command('cleanup', { dryRun: true }))).toBe(false)
    expect(shouldBackfillCardIds(command('serve', { build: true, dryRun: true }))).toBe(false)
  })
})
