import { describe, expect, test } from 'bun:test'
import { runCli, withTempDir } from './helpers/cli'

/** The parsed shape of one `dep-license --list --output json` row. */
type ParsedDepLicenseListEntry = {
  name: string
  version: string
  license: string
  isPrimary: boolean
}

// dep-license reads only the bundled license data — no workspace files — so an
// empty temp dir is a sufficient cwd (it is in COMMANDS_WITHOUT_LIST_IDS).
describe('dep-license command (Integration)', () => {
  test('--list prints the grouped text listing', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['dep-license', '--list'], dir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Primary:')
      expect(result.stdout).toContain('Transitive:')
      expect(result.stdout).toContain('commander')
    })
  })

  test('--list --output json emits the entry array without the license text', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['dep-license', '--list', '--output', 'json'], dir)

      expect(result.exitCode).toBe(0)
      const entries = JSON.parse(result.stdout) as ParsedDepLicenseListEntry[]
      expect(Array.isArray(entries)).toBe(true)

      const commander = entries.find((entry) => entry.name === 'commander')
      expect(commander?.isPrimary).toBe(true)
      expect(commander?.license).not.toBe('')

      // The bundled license text is deliberately excluded from the list payload.
      expect(entries.some((entry) => 'text' in entry)).toBe(false)
    })
  })

  test('a package name combined with --list is a usage error', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['dep-license', 'commander', '--list'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Cannot combine')
      expect(result.stdout).toBe('')
    })
  })

  test('no arguments without a TTY is a usage error instead of a hung prompt', async () => {
    await withTempDir(async (dir) => {
      // runCli spawns the binary without a terminal, so the interactive picker
      // cannot run; the command must refuse with guidance rather than hang.
      const result = await runCli(['dep-license'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Provide a package name argument or use --list')
    })
  })
})
