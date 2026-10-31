import type { DoctorConfigFacts, DoctorMigrationFacts } from '../doctor/report'
import { aheadRemedyCommand, hasPendingWork, planMigration } from './runner'

/**
 * `ritual doctor`'s migration check: what `ritual migrate --check` would find,
 * skipped when there is no readable config. Installed into the doctor engine at
 * startup (`setMigrationProbe`), which sits below this engine's layer.
 */
export async function doctorMigrationProbe(
  config: DoctorConfigFacts,
): Promise<DoctorMigrationFacts> {
  if (config.state === 'absent') return { state: 'no-config', remedy: null, problem: null }
  if (config.state === 'unreadable') return { state: 'unknown', remedy: null, problem: null }
  const outcome = await planMigration()
  switch (outcome.kind) {
    case 'no-config':
      return { state: 'no-config', remedy: null, problem: null }
    case 'ahead':
      return {
        state: 'ahead',
        // `self-update --tag` takes the release after the flag, as the
        // pre-command warning spells it out.
        remedy:
          outcome.version === undefined
            ? aheadRemedyCommand(outcome)
            : `${aheadRemedyCommand(outcome)} ${outcome.version}`,
        problem: null,
      }
    case 'invalid':
      // A config that is already invalid fails the plan's validation for its
      // own reasons: the config check reports them, and its fix comes first.
      return config.state === 'invalid'
        ? { state: 'unknown', remedy: null, problem: null }
        : { state: 'invalid', remedy: null, problem: outcome.error }
    case 'plan':
      return {
        state: hasPendingWork(outcome) ? 'pending' : 'current',
        remedy: null,
        problem: null,
      }
    default:
      return outcome satisfies never
  }
}
