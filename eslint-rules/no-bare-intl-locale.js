/**
 * @fileoverview Require an explicit locale for every `Intl` constructor and
 * every `toLocale*` / `localeCompare` call.
 *
 * Bun resolves no locale from the environment: with `LANG=de_DE.UTF-8` set,
 * `new Intl.DateTimeFormat().resolvedOptions().locale` is still `en-US` and
 * `navigator.language` is `undefined` (measured — plan §0). In a browser the
 * same call follows the *host's* locale instead. A bare constructor is
 * therefore never right: it is silently English on the CLI and host-dependent
 * in the SPAs, which is exactly the class of bug that makes the same list sort
 * two different ways on two machines.
 *
 * ✅ Allowed:
 *   new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' })
 *   numberFormat(currentLocale())            // from src/i18n/format.ts
 *   compareData(a, b) / compareDisplay(a, b) // from src/i18n/collate.ts
 *   a.localeCompare(b, 'en')
 *
 * ❌ Flagged:
 *   new Intl.Collator()
 *   new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
 *   a.localeCompare(b)
 *   value.toLocaleString()
 *
 * `src/i18n/format.ts` and `src/i18n/collate.ts` are the memoized factories
 * every other module goes through, so they are the rule's only exemption — the
 * explicit tag is their parameter.
 */

import { matchesAny } from './path-match.js'

/** `Intl` constructors whose first argument is the locale list. */
const INTL_CONSTRUCTORS = new Set([
  'Collator',
  'DateTimeFormat',
  'DisplayNames',
  'DurationFormat',
  'ListFormat',
  'Locale',
  'NumberFormat',
  'PluralRules',
  'RelativeTimeFormat',
  'Segmenter',
])

/** Methods whose first argument is the locale list. */
const LOCALE_FIRST_ARG_METHODS = new Set([
  'toLocaleString',
  'toLocaleDateString',
  'toLocaleTimeString',
])

/** Methods whose *second* argument is the locale list. */
const LOCALE_SECOND_ARG_METHODS = new Set(['localeCompare'])

/** The modules that own explicit-locale construction. */
const DEFAULT_ALLOW_IN = ['src/i18n/format.ts', 'src/i18n/collate.ts']

/** Whether an argument node supplies a real locale (not absent, `undefined`, or `null`). */
function suppliesLocale(node) {
  if (node === undefined || node === null) return false
  if (node.type === 'Identifier' && node.name === 'undefined') return false
  if (node.type === 'Literal' && node.value === null) return false
  return true
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require an explicit locale for Intl constructors and toLocale*/localeCompare',
    },
    messages: {
      bareIntl:
        'Intl.{{name}} needs an explicit locale — Bun resolves none from the environment. Use the memoized factory in src/i18n/format.ts, or pass a BCP-47 tag.',
      bareMethod:
        '{{name}}() without an explicit locale follows the host. Pass a BCP-47 tag, or use compareData/compareDisplay from src/i18n/collate.ts.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowIn: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] ?? {}
    const allowIn = options.allowIn ?? DEFAULT_ALLOW_IN
    const filename = context.filename ?? context.getFilename()
    if (matchesAny(filename, allowIn)) return {}

    /** `new Intl.X(…)` / `Intl.X(…)` — the locale is argument 0. */
    function checkIntl(node) {
      const callee = node.callee
      if (callee.type !== 'MemberExpression' || callee.computed) return
      if (callee.object.type !== 'Identifier' || callee.object.name !== 'Intl') return
      if (callee.property.type !== 'Identifier') return
      const name = callee.property.name
      if (!INTL_CONSTRUCTORS.has(name)) return
      if (suppliesLocale(node.arguments[0])) return
      context.report({ node, messageId: 'bareIntl', data: { name } })
    }

    return {
      NewExpression: checkIntl,

      CallExpression(node) {
        checkIntl(node)
        const callee = node.callee
        if (callee.type !== 'MemberExpression' || callee.computed) return
        if (callee.property.type !== 'Identifier') return
        const name = callee.property.name
        if (LOCALE_FIRST_ARG_METHODS.has(name) && !suppliesLocale(node.arguments[0])) {
          context.report({ node, messageId: 'bareMethod', data: { name } })
          return
        }
        if (LOCALE_SECOND_ARG_METHODS.has(name) && !suppliesLocale(node.arguments[1])) {
          context.report({ node, messageId: 'bareMethod', data: { name } })
        }
      },
    }
  },
}
