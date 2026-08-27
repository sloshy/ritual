/**
 * @fileoverview Flag user-facing string literals that never went through `t()`.
 *
 * The i18n framework (see `research/i18n-framework-plan-2026-08-07.md` §9)
 * routes every human-readable string through the message catalog. This rule
 * catches the positions where a raw literal is almost always user-facing text:
 *
 *   - JSX text nodes:                 <span>Save and exit</span>
 *   - Object properties:              { message: 'Deck saved.' }
 *                                     { title: … }, { description: … },
 *                                     { placeholder: … }, { alt: … },
 *                                     { 'aria-label': … }
 *   - JSX attributes:                 title=, placeholder=, alt=, aria-label=
 *   - Commander help positions:       .description('…')
 *                                     .option('-x, --xyz', '…')
 *                                     .argument('<name>', '…')
 *
 * **Scope is mandatory, not decorative.** Unscoped, this rule fires on ~20,000
 * lines. It runs only inside the surfaces that get localized (`src/cli`, `src/commands`,
 * `src/site`, `src/admin/site`, `src/ui`, `src/editor`, `src/list-view`,
 * `src/site-build`) and never inside the
 * surfaces that are English by contract (`src/mcp`, `src/skills`, the changelog
 * persistence modules, `src/export`, generated code, tests,
 * docs). Both lists are options so the ratchet in §12 can widen or narrow them
 * per directory as each surface converts.
 *
 * Escape hatch: a `// i18n-exempt: <reason>` comment on the reported line or on
 * the line above it suppresses the report. The reason is mandatory — a bare
 * `// i18n-exempt` does not count.
 */

import { matchesAny } from './path-match.js'

/** Directories whose strings are localized. */
const DEFAULT_INCLUDE = [
  'src/cli/',
  'src/commands/',
  'src/site/',
  'src/admin/site/',
  'src/ui/',
  'src/editor/',
  'src/list-view/',
  'src/site-build/',
]

/** Files and directories that are English by contract (plan §4.9, §11). */
const DEFAULT_EXCLUDE = [
  'src/mcp/',
  'src/skills/',
  'src/changes/change-event.ts',
  'src/changes/changelog-',
  'src/export/',
  'src/generated/',
  'test/',
  'docs-site/',
]

/** Object-property and JSX-attribute names that hold user-facing prose. */
const TEXT_PROPERTY_NAMES = new Set([
  'message',
  'title',
  'description',
  'placeholder',
  'alt',
  'aria-label',
  'ariaLabel',
])

/** Commander methods whose help text is registered as a literal. */
const COMMANDER_HELP_ARGUMENT_INDEX = new Map([
  ['description', 0],
  ['summary', 0],
  ['option', 1],
  ['requiredOption', 1],
  ['argument', 1],
])

const EXEMPT_COMMENT = /i18n-exempt:\s*\S/

/** A lowercase token (`file-order`, `sort_by`, `nm`) — a slug, not a sentence. */
const SLUG_LIKE = /^[a-z0-9][a-z0-9._-]*$/

/**
 * A message key (`site.toolbar.groupLabel`) — a *reference* to catalog text,
 * not untranslated text.
 *
 * The plan's §7.2 rule turns every module-level label table into
 * `Record<Key, MessageKey>`, and those rows sit in exactly the `label:` /
 * `description:` / `title:` positions this rule polices. Without this the
 * correct pattern would need an exempt comment on every row, which would train
 * everyone to write exempt comments.
 *
 * Namespaces are duplicated from `src/i18n/messages/en.ts` because an ESLint
 * rule cannot import TypeScript; `test/unit/i18n-conventions.test.ts` pins the
 * two lists together.
 */
const MESSAGE_KEY_LIKE =
  /^(?:cli|help|site|admin|ui|domain|errors)\.[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)+$/

/** The literal text of a node, or null when it is not a plain string literal. */
function literalText(node) {
  if (node === undefined || node === null) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? '').join('')
  }
  return null
}

/** Whether a string reads as prose a translator would need to see. */
function isProse(text) {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  if (!/[A-Za-z]/.test(trimmed)) return false
  // A catalog key is a reference to translated text, not text.
  if (MESSAGE_KEY_LIKE.test(trimmed)) return false
  // Single lowercase tokens are slugs, CSS classes, or enum values — not prose.
  if (SLUG_LIKE.test(trimmed)) return false
  return true
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow untranslated user-facing string literals outside the message catalog',
    },
    messages: {
      untranslated:
        'User-facing text must come from the message catalog: use t(\'<namespace>.<area>.<name>\') instead of the literal "{{text}}". Add `// i18n-exempt: <reason>` if this string is English by contract.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          include: { type: 'array', items: { type: 'string' } },
          exclude: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] ?? {}
    const include = options.include ?? DEFAULT_INCLUDE
    const exclude = options.exclude ?? DEFAULT_EXCLUDE
    const filename = context.filename ?? context.getFilename()

    if (!matchesAny(filename, include) || matchesAny(filename, exclude)) return {}

    const sourceCode = context.sourceCode ?? context.getSourceCode()
    const exemptLines = new Set()
    for (const comment of sourceCode.getAllComments()) {
      if (EXEMPT_COMMENT.test(comment.value)) exemptLines.add(comment.loc.start.line)
    }

    function isExempt(node) {
      const line = node.loc.start.line
      return exemptLines.has(line) || exemptLines.has(line - 1)
    }

    function report(node, text) {
      if (isExempt(node)) return
      const trimmed = text.trim()
      context.report({
        node,
        messageId: 'untranslated',
        data: { text: trimmed.length > 40 ? `${trimmed.slice(0, 37)}…` : trimmed },
      })
    }

    function checkValue(node) {
      const text = literalText(node)
      if (text === null || !isProse(text)) return
      report(node, text)
    }

    function propertyName(node) {
      if (node.key.type === 'Identifier' && !node.computed) return node.key.name
      if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value
      return null
    }

    return {
      JSXText(node) {
        if (!isProse(node.value)) return
        report(node, node.value)
      },

      Property(node) {
        const name = propertyName(node)
        if (name === null || !TEXT_PROPERTY_NAMES.has(name)) return
        checkValue(node.value)
      },

      JSXAttribute(node) {
        const name =
          node.name.type === 'JSXIdentifier'
            ? node.name.name
            : node.name.type === 'JSXNamespacedName'
              ? `${node.name.namespace.name}:${node.name.name.name}`
              : null
        if (name === null || !TEXT_PROPERTY_NAMES.has(name)) return
        const value = node.value
        if (value === null) return
        if (value.type === 'JSXExpressionContainer') {
          checkValue(value.expression)
          return
        }
        checkValue(value)
      },

      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression' || node.callee.computed) return
        const property = node.callee.property
        if (property.type !== 'Identifier') return
        const index = COMMANDER_HELP_ARGUMENT_INDEX.get(property.name)
        if (index === undefined) return
        checkValue(node.arguments[index])
      },
    }
  },
}
