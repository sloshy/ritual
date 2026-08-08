/**
 * @fileoverview Ban plural morphology expressed in code.
 *
 * `count === 1 ? '' : 's'` is English grammar compiled into a control-flow
 * expression: it has no string a translator can edit, and it is wrong in every
 * language with more than two plural categories (Russian needs one/few/many,
 * Japanese needs only other). The message catalog expresses this as a
 * `PluralForms` entry, selected by `Intl.PluralRules(locale).select(count)`:
 *
 * ```ts
 * 'cli.addCard.added': {
 *   $plural: 'count',
 *   one: 'Added {count} copy of {name}.',
 *   other: 'Added {count} copies of {name}.',
 * }
 * ```
 *
 * ❌ Flagged:
 *   `${n} card${n === 1 ? '' : 's'}`
 *   n === 1 ? 'copy' : 'copies'
 *   n > 1 ? 'entries' : 'entry'
 *   noun.replace(/s$/, '')            // suffix-stripping morphology
 *
 * ✅ Allowed:
 *   t('cli.addCard.added', { count: n, name })
 *   n === 1 ? singleCard : cardList   // not a string-form choice
 */

import { matchesAny } from './path-match.js'

const COMPARISON_OPERATORS = new Set(['===', '!==', '==', '!=', '>', '<', '>=', '<='])

/** Files that legitimately contain morphology (none today; kept as an option seam). */
const DEFAULT_EXCLUDE = ['src/generated/']

/** Whether a node is a plain string literal (including a no-expression template). */
function isStringForm(node) {
  if (node === undefined || node === null) return false
  if (node.type === 'Literal' && typeof node.value === 'string') return true
  return node.type === 'TemplateLiteral' && node.expressions.length === 0
}

/** Whether a comparison has `1` on either side — the tell-tale singular test. */
function comparesToOne(test) {
  if (test.type !== 'BinaryExpression') return false
  if (!COMPARISON_OPERATORS.has(test.operator)) return false
  const isOne = (node) => node.type === 'Literal' && node.value === 1
  return isOne(test.left) || isOne(test.right)
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow inline plural morphology; use a $plural message instead',
    },
    messages: {
      inlinePlural:
        'Plural morphology belongs in the catalog, not in code. Replace this with a $plural message rendered by t(key, { count }).',
      suffixStrip:
        'Stripping a plural suffix with a regex is English-only morphology. Use a $plural message with distinct singular and plural forms.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          exclude: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] ?? {}
    const exclude = options.exclude ?? DEFAULT_EXCLUDE
    const filename = context.filename ?? context.getFilename()
    if (matchesAny(filename, exclude)) return {}

    return {
      ConditionalExpression(node) {
        if (!comparesToOne(node.test)) return
        if (!isStringForm(node.consequent) || !isStringForm(node.alternate)) return
        context.report({ node, messageId: 'inlinePlural' })
      },

      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression' || callee.computed) return
        if (callee.property.type !== 'Identifier' || callee.property.name !== 'replace') return
        const pattern = node.arguments[0]
        if (pattern === undefined || pattern.type !== 'Literal' || pattern.regex === undefined) {
          return
        }
        // `/s$/`, `/es$/`, `/ies$/` — trailing-plural stripping, in any flags.
        if (!/^(?:e?s|ies)\$$/.test(pattern.regex.pattern)) return
        context.report({ node, messageId: 'suffixStrip' })
      },
    }
  },
}
