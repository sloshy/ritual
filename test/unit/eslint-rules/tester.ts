import { RuleTester } from '@typescript-eslint/rule-tester'
import { afterAll, describe, it } from 'bun:test'

// The four adapter hooks are static on the class, so assigning them once when
// this module first loads is what every importer would otherwise repeat.
RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it

/** Config for {@link makeRuleTester}, as `RuleTester`'s constructor takes it. */
export type RuleTesterConfig = ConstructorParameters<typeof RuleTester>[0]

/** A `RuleTester` wired to Bun's runner. A factory, not a shared instance: a
 * suite that needs its own `languageOptions` (JSX, say) passes them here. */
export function makeRuleTester(config?: RuleTesterConfig): RuleTester {
  return new RuleTester(config)
}
