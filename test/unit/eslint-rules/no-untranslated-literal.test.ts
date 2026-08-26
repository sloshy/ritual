import { RuleTester } from '@typescript-eslint/rule-tester'
import { afterAll, describe, it } from 'bun:test'
import rule from '../../../eslint-rules/no-untranslated-literal.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
})

/** A file inside the localized scope. */
const COMMAND_FILE = 'src/commands/add-card.ts'
/** A JSX file inside the localized scope. */
const SITE_FILE = 'src/site/Toolbar.tsx'

ruleTester.run('no-untranslated-literal', rule as never, {
  valid: [
    // Outside the scoped directories entirely.
    { code: `const message = 'Deck saved.'`, filename: 'src/deck.ts' },
    // English-by-contract carve-outs (plan §4.9, §11).
    { code: `const tool = { description: 'Add a card to a list.' }`, filename: 'src/mcp/tools.ts' },
    { code: `const skill = { description: 'Drive the ritual CLI.' }`, filename: 'src/skills/x.ts' },
    { code: `const c = { message: 'Added Sol Ring.' }`, filename: 'src/changes/change-event.ts' },
    // …while the admin HTTP API (machine contract) is out of scope.
    { code: `const o = { message: 'Deck saved.' }`, filename: 'src/admin/api/save.ts' },
    {
      code: `const c = { message: 'Added Sol Ring.' }`,
      filename: 'src/changes/changelog-writer.ts',
    },
    { code: `const c = { description: 'Quantity' }`, filename: 'src/export/properties.ts' },
    // Catalog-sourced text is the whole point.
    { code: `const o = { message: t('cli.addCard.added', { count: 1 }) }`, filename: COMMAND_FILE },
    { code: `const el = <span>{t('site.toolbar.sortBy')}</span>`, filename: SITE_FILE },
    // A label table holds message keys — references to catalog text, resolved
    // at render time. Flagging these would put an exempt comment on every row.
    {
      code: `const LABELS = { name: 'domain.sortBy.name', cmc: 'domain.sortBy.cmc' }`,
      filename: SITE_FILE,
    },
    { code: `const meta = { label: 'site.themeVar.bgBody.label' }`, filename: SITE_FILE },
    {
      code: `const meta = { description: 'site.themeVar.bgBody.description' }`,
      filename: SITE_FILE,
    },
    // Non-prose values: slugs, enum tokens, punctuation, numbers.
    { code: `const o = { description: 'file-order' }`, filename: COMMAND_FILE },
    { code: `const o = { title: '—' }`, filename: COMMAND_FILE },
    { code: `const el = <div title="sort-by" />`, filename: SITE_FILE },
    { code: `const el = <div>{'  '}</div>`, filename: SITE_FILE },
    // Property names the rule does not police.
    { code: `const o = { slug: 'My Deck' }`, filename: COMMAND_FILE },
    // Commander flag strings are not help prose (only the description arg is).
    { code: `program.option('--dry-run')`, filename: COMMAND_FILE },
    { code: `program.argument('<name>')`, filename: COMMAND_FILE },
    // Escape hatch with a reason, on the line above and on the same line.
    {
      code: [
        `// i18n-exempt: MCP tool prose is English by contract`,
        `const o = { description: 'Add a card to a list.' }`,
      ].join('\n'),
      filename: COMMAND_FILE,
    },
    {
      code: `const o = { description: 'Add a card.' } // i18n-exempt: protocol identifier`,
      filename: COMMAND_FILE,
    },
  ],

  invalid: [
    // Scope: the shared list-view layer, the CLI helpers and the admin SPA are localized surfaces…
    {
      code: `const el = <span>Nothing selected</span>`,
      filename: 'src/list-view/CardModal.tsx',
      errors: [{ messageId: 'untranslated' }],
    },
    {
      code: `command.option('--refresh <mode>', 'Card cache refresh policy')`,
      filename: 'src/cli/options.ts',
      errors: [{ messageId: 'untranslated' }],
    },
    {
      code: `const el = <span>Nothing selected</span>`,
      filename: 'src/admin/site/pages/DeckEditor.tsx',
      errors: [{ messageId: 'untranslated' }],
    },
    // JSX text node.
    {
      code: `const el = <span>Save and exit</span>`,
      filename: SITE_FILE,
      errors: [{ messageId: 'untranslated' }],
    },
    // Object property positions.
    {
      code: `const o = { message: 'Deck saved.' }`,
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated' }],
    },
    {
      code: `const o = { title: 'Find other printings' }`,
      filename: 'src/ui/Modal.tsx',
      errors: [{ messageId: 'untranslated' }],
    },
    {
      code: `const o = { 'aria-label': 'Close dialog' }`,
      filename: 'src/editor/useEditorStatus.ts',
      errors: [{ messageId: 'untranslated' }],
    },
    // JSX attribute positions, both literal and expression container.
    {
      code: `const el = <input placeholder="Search cards" />`,
      filename: SITE_FILE,
      errors: [{ messageId: 'untranslated' }],
    },
    {
      code: `const el = <img alt={'Card image'} />`,
      filename: SITE_FILE,
      errors: [{ messageId: 'untranslated' }],
    },
    // Commander help positions.
    {
      code: `program.description('Add a card to a list.')`,
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated' }],
    },
    {
      code: `program.option('-n, --name <name>', 'Name of the list.')`,
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated' }],
    },
    {
      code: `program.argument('<name>', 'Name of the deck.')`,
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated' }],
    },
    // Key-*shaped* is not enough: an unknown namespace is prose, not a key.
    {
      code: `const o = { description: 'Deck.saved.now' }`,
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated' }],
    },
    // A template literal with no expressions is still a hardcoded string.
    {
      code: 'const o = { message: `Deck saved.` }',
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated' }],
    },
    // A bare `i18n-exempt` with no reason does not suppress.
    {
      code: [`// i18n-exempt`, `const o = { message: 'Deck saved.' }`].join('\n'),
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated' }],
    },
    // The exemption is line-scoped: it does not cover the whole file.
    {
      code: [
        `// i18n-exempt: this one only`,
        `const a = { message: 'Deck saved.' }`,
        `const b = { message: 'Deck deleted.' }`,
      ].join('\n'),
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated' }],
    },
  ],
})
