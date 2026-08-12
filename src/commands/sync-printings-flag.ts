import type { Command } from 'commander'
import { t } from '../i18n/t'

/**
 * The negatable `--sync-printings` / `--no-sync-printings` pair every
 * URL-importing command registers (`import`, `import-account`), declared once
 * so the spellings, help text, and — above all — the tri-state read cannot
 * drift. (`deck-sync --sync-printings` is deliberately not this pair: it is a
 * positive-only flag with a `false` default and no prompt.)
 */
export type SyncPrintingsOptions = {
  /**
   * `--sync-printings` (true) / `--no-sync-printings` (false); absent when
   * neither flag was given — commander only defaults a `--no-x` flag to true
   * when the positive flag is NOT also declared, and here it is. Read the
   * answer through {@link readSyncPrintingsFlag} rather than off this field,
   * so a `.default()` added to the pair later cannot silently swallow the
   * prompt path.
   */
  syncPrintings?: boolean
}

/** Register the pair on a command; the option key is `syncPrintings`. */
export function addSyncPrintingsOptions(command: Command): Command {
  return command
    .option('--sync-printings', t('help.import.syncPrintings'))
    .option('--no-sync-printings', t('help.import.noSyncPrintings'))
}

/**
 * The tri-state the pair encodes: `true`/`false` when a flag was given on the
 * command line, `undefined` when neither was — which is what sends
 * `resolveImportPrintings` down its prompt path. With both flags declared the
 * pair currently has no default, so the field alone would do — the
 * `getOptionValueSource` check is what keeps this correct should the pair
 * ever gain one.
 */
export function readSyncPrintingsFlag(
  command: Command,
  options: SyncPrintingsOptions,
): boolean | undefined {
  return command.getOptionValueSource('syncPrintings') === 'cli' ? options.syncPrintings : undefined
}
