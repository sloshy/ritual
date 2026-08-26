import { describe, expect, test } from 'bun:test'
import type { ActiveManagedFile, HistoricalManagedFile } from '../../src/list/managed-files'
import { computeMigrations, isActiveManagedFile } from '../../src/list/managed-files'
import { MANAGED_FILES } from '../../src/commands/init-site'
import { version as ritualVersion } from '../../src/config/version'
import type { InitSiteConfig } from '../../src/config/ritual-config'

const config: InitSiteConfig = {
  ciSystem: 'github-actions',
  deployMode: 'publish-for-me',
  distDir: 'dist',
  detectChanges: false,
}

const manualConfig: InitSiteConfig = { ciSystem: 'manual' }

describe('isActiveManagedFile', () => {
  test('returns true for active files', () => {
    const file: ActiveManagedFile = {
      ciSystem: 'github-actions',
      paths: [{ path: 'test.yml' }],
      generate: () => 'content',
    }
    expect(isActiveManagedFile(file)).toBe(true)
  })

  test('returns false for historical files', () => {
    const file: HistoricalManagedFile = {
      ciSystem: 'github-actions',
      paths: [{ path: 'test.yml', until: '1.0.0' }],
    }
    expect(isActiveManagedFile(file)).toBe(false)
  })
})

describe('computeMigrations', () => {
  // An active file with a single path active from before versioning onward
  const activeFile: ActiveManagedFile = {
    ciSystem: 'github-actions',
    paths: [{ path: '.github/workflows/deploy.yml' }],
    generate: (c) => `content for ${c.ciSystem}`,
  }

  // A file removed at 0.2.0 (any version < 0.2.0 had it)
  const historicalFile: HistoricalManagedFile = {
    ciSystem: 'github-actions',
    paths: [{ path: '.github/workflows/old-deploy.yml', until: '0.2.0' }],
  }

  test('writes active file matching ciSystem', () => {
    const migrations = computeMigrations('0.1.0', '0.2.0', [activeFile], config)
    expect(migrations).toHaveLength(1)
    expect(migrations[0]).toEqual({
      type: 'write',
      path: '.github/workflows/deploy.yml',
      content: 'content for github-actions',
    })
  })

  test('skips active files whose ciSystem does not match config', () => {
    const migrations = computeMigrations('0.1.0', '0.2.0', [activeFile], manualConfig)
    expect(migrations).toHaveLength(0)
  })

  test('passes config to active file generate function', () => {
    const localConfig: InitSiteConfig = {
      ciSystem: 'github-actions',
      deployMode: 'local-build',
      distDir: 'public',
      detectChanges: false,
    }
    const file: ActiveManagedFile = {
      ciSystem: 'github-actions',
      paths: [{ path: 'deploy.yml' }],
      generate: (c) => `mode=${c.ciSystem === 'github-actions' ? c.deployMode : 'none'}`,
    }
    const migrations = computeMigrations('0.1.0', '0.2.0', [file], localConfig)
    expect(migrations[0]).toMatchObject({ content: 'mode=local-build' })
  })

  test('deletes historical file path when fromVersion had the file', () => {
    const migrations = computeMigrations('0.1.0', '0.3.0', [historicalFile], config)
    expect(migrations).toHaveLength(1)
    expect(migrations[0]).toEqual({
      type: 'delete',
      path: '.github/workflows/old-deploy.yml',
    })
  })

  test('no delete when fromVersion is at or after the file was removed', () => {
    // until: '0.2.0' means the file is gone starting at 0.2.0
    const migrations = computeMigrations('0.2.0', '0.3.0', [historicalFile], config)
    expect(migrations).toHaveLength(0)
  })

  test('deletes when toVersion equals the until boundary (file gone at toVersion)', () => {
    // fromVersion 0.1.0 had the file; toVersion 0.2.0 does not (until is exclusive)
    const migrations = computeMigrations('0.1.0', '0.2.0', [historicalFile], config)
    expect(migrations).toHaveLength(1)
    expect(migrations[0]).toMatchObject({ type: 'delete' })
  })

  test('fresh install (fromVersion null) emits only writes — no deletes', () => {
    const migrations = computeMigrations(null, '0.3.0', [activeFile, historicalFile], config)
    expect(migrations.every((m) => m.type === 'write')).toBe(true)
    expect(migrations).toHaveLength(1) // only the active file write
  })

  describe('renames', () => {
    const renamedFile: ActiveManagedFile = {
      ciSystem: 'github-actions',
      paths: [
        { path: 'ci.yml', until: '2.1.0' },
        { path: 'pr.yml', since: '2.1.0' },
      ],
      generate: () => 'content',
    }

    test('deletes old path and writes new path when upgrading across a rename', () => {
      const migrations = computeMigrations('2.0.0', '2.1.0', [renamedFile], config)
      expect(migrations).toHaveLength(2)
      expect(migrations.find((m) => m.type === 'delete')).toEqual({
        type: 'delete',
        path: 'ci.yml',
      })
      expect(migrations.find((m) => m.type === 'write')).toEqual({
        type: 'write',
        path: 'pr.yml',
        content: 'content',
      })
    })

    test('only writes (no delete) when fromVersion is already on the new path', () => {
      const migrations = computeMigrations('2.1.0', '2.3.0', [renamedFile], config)
      expect(migrations).toHaveLength(1)
      expect(migrations[0]).toMatchObject({ type: 'write', path: 'pr.yml' })
    })

    test('no delete on fresh install even if file has a historical path', () => {
      const migrations = computeMigrations(null, '2.3.0', [renamedFile], config)
      expect(migrations).toHaveLength(1)
      expect(migrations[0]).toMatchObject({ type: 'write', path: 'pr.yml' })
    })
  })

  test('handles multiple files: active write + historical delete', () => {
    const migrations = computeMigrations('0.1.0', '0.3.0', [activeFile, historicalFile], config)
    expect(migrations).toHaveLength(2)
    expect(migrations.find((m) => m.type === 'write')).toBeDefined()
    expect(migrations.find((m) => m.type === 'delete')).toBeDefined()
  })

  test('historical delete respects ciSystem — skips when ciSystem does not match config', () => {
    const migrations = computeMigrations('0.1.0', '0.3.0', [historicalFile], manualConfig)
    expect(migrations).toHaveLength(0)
  })

  test('returns empty array when no files provided', () => {
    const migrations = computeMigrations('0.1.0', '0.2.0', [], config)
    expect(migrations).toHaveLength(0)
  })

  describe('real init-site managed files', () => {
    test.each([
      ['publish-for-me', config],
      [
        'local-build',
        {
          ciSystem: 'github-actions',
          deployMode: 'local-build',
          distDir: 'dist',
          detectChanges: false,
        } satisfies InitSiteConfig,
      ],
    ] as const)(
      'upgrading a %s workflow regenerates deploy-site.yml with the current flag vocabulary',
      (_mode, migrationConfig) => {
        // Older generated workflows used `build-site --allow-refresh` and a bare
        // `list-all-cards` invocation (which wrote all-cards.md by default); the
        // upgrade migration must rewrite them with the current flags.
        const migrations = computeMigrations('0.0.1', ritualVersion, MANAGED_FILES, migrationConfig)

        const write = migrations.find(
          (m) => m.type === 'write' && m.path === '.github/workflows/deploy-site.yml',
        )
        expect(write).toBeDefined()
        if (write?.type !== 'write') throw new Error('expected a write migration')
        expect(write.content).not.toContain('--allow-refresh')
        // list-all-cards now prints to stdout by default — the regenerated
        // workflow must never carry a bare (fileless) invocation.
        expect(write.content).not.toMatch(/list-all-cards\s*$/m)
        if (migrationConfig.deployMode === 'publish-for-me') {
          expect(write.content).toContain('./ritual build-site --refresh auto')
          expect(write.content).toContain('./ritual list-all-cards --out all-cards.md')
        }
      },
    )

    test('manual CI has no managed workflow to migrate', () => {
      const migrations = computeMigrations('0.0.1', ritualVersion, MANAGED_FILES, manualConfig)
      expect(migrations).toHaveLength(0)
    })
  })
})
