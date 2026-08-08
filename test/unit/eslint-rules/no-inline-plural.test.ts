import { RuleTester } from '@typescript-eslint/rule-tester'
import { afterAll, describe, it } from 'bun:test'
import rule from '../../../eslint-rules/no-inline-plural.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it

const ruleTester = new RuleTester()

const FILE = 'src/commands/add-card.ts'

ruleTester.run('no-inline-plural', rule as never, {
  valid: [
    // The catalog does the morphology.
    { code: `t('cli.addCard.added', { count, name, list })`, filename: FILE },
    // A conditional that chooses values, not word forms.
    { code: `const card = count === 1 ? single : list`, filename: FILE },
    { code: `const label = count === 1 ? getSingular() : getPlural()`, filename: FILE },
    // A comparison against something other than 1.
    { code: `const s = count === 0 ? 'none' : 'some'`, filename: FILE },
    // Replacements that are not plural-suffix stripping.
    { code: `name.replace(/\\s+/g, ' ')`, filename: FILE },
    { code: `slug.replace(/^-+/, '')`, filename: FILE },
    // Generated code is exempt by default.
    { code: `const s = n === 1 ? '' : 's'`, filename: 'src/generated/locales.ts' },
  ],

  invalid: [
    {
      code: 'const label = `${n} card${n === 1 ? "" : "s"}`',
      filename: FILE,
      errors: [{ messageId: 'inlinePlural' }],
    },
    {
      code: `const noun = count === 1 ? 'copy' : 'copies'`,
      filename: FILE,
      errors: [{ messageId: 'inlinePlural' }],
    },
    {
      code: `const verb = count === 1 ? 'was' : 'were'`,
      filename: FILE,
      errors: [{ messageId: 'inlinePlural' }],
    },
    {
      code: `const noun = count > 1 ? 'entries' : 'entry'`,
      filename: FILE,
      errors: [{ messageId: 'inlinePlural' }],
    },
    {
      code: `const noun = 1 !== count ? 'decks' : 'deck'`,
      filename: FILE,
      errors: [{ messageId: 'inlinePlural' }],
    },
    // Template-literal branches are string forms too.
    {
      code: 'const s = n === 1 ? `` : `s`',
      filename: FILE,
      errors: [{ messageId: 'inlinePlural' }],
    },
    // Suffix-stripping morphology.
    {
      code: `const singular = noun.replace(/s$/, '')`,
      filename: FILE,
      errors: [{ messageId: 'suffixStrip' }],
    },
    {
      code: `const singular = noun.replace(/ies$/, 'y')`,
      filename: FILE,
      errors: [{ messageId: 'suffixStrip' }],
    },
  ],
})
