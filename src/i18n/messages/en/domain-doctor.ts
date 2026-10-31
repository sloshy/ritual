/**
 * `domain.doctor.*` — the verdicts of `ritual doctor` (`src/doctor/report.ts`):
 * one summary line per check, and the one-line fix for a check that found
 * something to do.
 *
 * A fragment of the domain namespace. The report is built once, as English
 * plus its key, and read three ways: `GET /api/doctor` and the MCP
 * `get_diagnostics` tool return the English, and the CLI renders the key in its
 * own language. The admin SPA has no page for it, so only the CLI registers it.
 *
 * Paths, file names (`ritual.config.json`), config keys, environment variables,
 * versions, platform names and command lines are machine vocabulary and stay
 * as they are inside the sentences.
 */

import type { MessageCatalogShape } from '../../types'

export const domainDoctorMessages = {
  'domain.doctor.ritual.summary':
    'Ritual {version} ({build}, {install}) on {platform} {arch}, Bun {bun}',
  'domain.doctor.build.release': 'release build',
  'domain.doctor.build.development': 'development build',
  'domain.doctor.install.binary': 'installed binary',
  'domain.doctor.install.source': 'run from source',
  'domain.doctor.install.docker': 'Docker image',

  'domain.doctor.workspace.found': 'Workspace {path}: {lists}',
  'domain.doctor.workspace.notFound':
    '{path} does not look like a Ritual workspace: it has no deck, collection or wanted-list folder and no {file}',
  'domain.doctor.workspace.notFoundHint':
    'Run Ritual from your workspace folder or pass {flag}; to start a workspace here, run `{command}`.',

  'domain.doctor.config.absent': 'No {file}, so every setting has its default',
  'domain.doctor.config.valid': '{file} is valid',
  'domain.doctor.config.invalid': {
    $plural: 'count',
    one: '{file} has {count} invalid setting',
    other: '{file} has {count} invalid settings',
  },
  'domain.doctor.config.invalidHint':
    'Ritual uses the default instead of each one, and will not publish a site with an invalid site block: correct them in {file}, or reset one with `{command}`.',
  'domain.doctor.config.unreadable': '{file} cannot be read',
  'domain.doctor.config.unreadableHint':
    'Repair {file} so it holds one JSON object; until then, other commands refuse to run.',

  'domain.doctor.migrations.noConfig': 'No workspace updates to check without a {file}',
  'domain.doctor.migrations.current': 'The workspace is up to date with this Ritual',
  'domain.doctor.migrations.pending': 'The workspace has pending updates',
  'domain.doctor.migrations.pendingHint':
    'Preview them with `{preview}`, then apply them with `{command}`.',
  'domain.doctor.migrations.ahead': 'A newer Ritual has already updated this workspace',
  'domain.doctor.migrations.aheadHint': 'Update Ritual with `{command}`.',
  'domain.doctor.migrations.invalid': 'Updating the workspace would leave an invalid config',
  'domain.doctor.migrations.invalidHint':
    'Correct the setting in {file}, then run the check again.',
  'domain.doctor.migrations.unknown': 'Could not check for workspace updates',
  'domain.doctor.migrations.noProbe': 'This process has no migration check to run',
  'domain.doctor.migrations.blocked': 'Workspace updates are checked once {file} is fixed',

  'domain.doctor.cache.server': 'Card data comes from the cache server at {address}',
  'domain.doctor.cache.unreadable': 'The card cache at {path} cannot be read',
  'domain.doctor.cache.empty': 'The card cache at {path} is empty',
  'domain.doctor.cache.emptyHint': 'Run `{command}` to download it.',
  'domain.doctor.cache.bulkStale':
    'The card cache at {path} ({cards}) was built for a different {configKey}',
  'domain.doctor.cache.refreshHint': 'Run `{command}` to refresh it.',
  'domain.doctor.cache.neverRefreshed':
    'The card cache at {path} holds {cards} but has never had a full refresh',
  'domain.doctor.cache.stale':
    'The card cache at {path} holds {cards}, refreshed {age} ago, so its prices are out of date',
  'domain.doctor.cache.fresh': 'The card cache at {path} holds {cards}, refreshed {age} ago',

  'domain.doctor.update.development': 'Development build, so there are no update checks',
  'domain.doctor.update.docker': 'Docker image: update it with `{command}`',
  'domain.doctor.update.off': 'Update checks are turned off ({configKey} or {envVar})',
  'domain.doctor.update.available': 'Ritual {latest} is available (this is {current})',
  'domain.doctor.update.availableHint': 'Update with `{command}`.',
  'domain.doctor.update.neverChecked': 'No update check has run yet',
  'domain.doctor.update.current': 'Up to date as of the last update check, {age} ago',
} as const satisfies MessageCatalogShape
