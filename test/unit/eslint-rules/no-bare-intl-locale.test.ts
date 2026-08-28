import rule from '../../../eslint-rules/no-bare-intl-locale.js'
import { makeRuleTester } from './tester'

const ruleTester = makeRuleTester()

const FILE = 'src/price-currency.ts'

ruleTester.run('no-bare-intl-locale', rule as never, {
  valid: [
    // Explicit tags, in every form a caller might supply one.
    {
      code: `new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })`,
      filename: FILE,
    },
    { code: `new Intl.Collator(locale)`, filename: FILE },
    { code: `new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium' })`, filename: FILE },
    { code: `new Intl.PluralRules(tag)`, filename: FILE },
    { code: `Intl.NumberFormat('en')`, filename: FILE },
    { code: `a.localeCompare(b, 'en')`, filename: FILE },
    { code: `a.localeCompare(b, locale, { numeric: true })`, filename: FILE },
    { code: `value.toLocaleString('en-US')`, filename: FILE },
    { code: `date.toLocaleDateString(locale, options)`, filename: FILE },
    // The memoized factories are where the explicit tag becomes a parameter.
    { code: `new Intl.Collator(locale, options)`, filename: 'src/i18n/format.ts' },
    { code: `new Intl.NumberFormat()`, filename: 'src/i18n/format.ts' },
    { code: `a.localeCompare(b)`, filename: 'src/i18n/collate.ts' },
    // Unrelated members that merely look similar.
    { code: `x.compare(a, b)`, filename: FILE },
    { code: `Intl.supportedValuesOf('currency')`, filename: FILE },
  ],

  invalid: [
    {
      code: `new Intl.Collator()`,
      filename: FILE,
      errors: [{ messageId: 'bareIntl', data: { name: 'Collator' } }],
    },
    {
      code: `new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })`,
      filename: FILE,
      errors: [{ messageId: 'bareIntl' }],
    },
    {
      code: `new Intl.NumberFormat(null, { style: 'percent' })`,
      filename: FILE,
      errors: [{ messageId: 'bareIntl' }],
    },
    {
      code: `Intl.ListFormat()`,
      filename: FILE,
      errors: [{ messageId: 'bareIntl' }],
    },
    {
      code: `new Intl.Segmenter()`,
      filename: FILE,
      errors: [{ messageId: 'bareIntl' }],
    },
    {
      code: `names.sort((a, b) => a.localeCompare(b))`,
      filename: FILE,
      errors: [{ messageId: 'bareMethod', data: { name: 'localeCompare' } }],
    },
    {
      code: `a.localeCompare(b, undefined, { numeric: true })`,
      filename: FILE,
      errors: [{ messageId: 'bareMethod' }],
    },
    {
      code: `total.toLocaleString()`,
      filename: FILE,
      errors: [{ messageId: 'bareMethod', data: { name: 'toLocaleString' } }],
    },
    {
      code: `date.toLocaleDateString()`,
      filename: FILE,
      errors: [{ messageId: 'bareMethod' }],
    },
    // The allowIn option is a path list, not a blanket exemption.
    {
      code: `new Intl.Collator()`,
      filename: 'src/i18n/collate.ts',
      options: [{ allowIn: ['src/i18n/format.ts'] }],
      errors: [{ messageId: 'bareIntl' }],
    },
  ],
})
