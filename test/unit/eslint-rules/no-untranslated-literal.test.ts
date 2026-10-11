import rule from '../../../eslint-rules/no-untranslated-literal.js'
import { makeRuleTester } from './tester'

const ruleTester = makeRuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
})

/** A command file — localized, like everything under `src/`. */
const COMMAND_FILE = 'src/commands/add-card.ts'
/** A JSX file inside the localized scope. */
const SITE_FILE = 'src/site/Toolbar.tsx'
/** An engine file: in scope now that the rule covers all of `src/`. */
const ENGINE_FILE = 'src/cache/lock.ts'
/** An admin API handler, for the commit-message contract. */
const ADMIN_FILE = 'src/admin/api/import-deck.ts'

const UNTRANSLATED = [{ messageId: 'untranslated' }]

/** An English sentence that fails in any position the rule judges. */
const SENTENCE = `const s = 'Deck was saved.'`

/** Each English-by-contract exclusion beside an in-scope sibling that is still checked. */
const EXCLUSIONS: ReadonlyArray<readonly [excluded: string, sibling: string]> = [
  ['src/i18n/messages/en/cli.ts', 'src/i18n/runtime.ts'],
  ['src/mcp/tools/read-tools.ts', 'src/mcp/run.ts'],
  ['src/mcp/server.ts', 'src/mcp/dispatch.ts'],
  ['src/mcp/schema-json.ts', 'src/mcp/notify.ts'],
  ['src/skills/content/core.ts', 'src/skills/install.ts'],
  ['src/skills/catalog.ts', 'src/skills/types.ts'],
  ['src/migrate/managed-files.ts', 'src/migrate/migrations.ts'],
]

/** An absolute checkout that itself sits under a `src/` directory. */
const ROOT = '/home/me/src/ritual'

ruleTester.run('no-untranslated-literal', rule as never, {
  valid: [
    // ── Scope.
    { code: SENTENCE, filename: 'scripts/build.ts' },
    ...EXCLUSIONS.map(([excluded]) => ({ code: SENTENCE, filename: excluded })),
    // Scope is root-relative: a parent `src/` directory does not put `scripts/` in scope.
    { code: SENTENCE, filename: `${ROOT}/scripts/build.ts`, options: [{ root: ROOT }] },
    // …and baseline keys are root-relative for absolute filenames too.
    {
      code: SENTENCE,
      filename: `${ROOT}/src/deck.ts`,
      options: [{ root: ROOT, baseline: { 'src/deck.ts': { 'Deck was saved.': 1 } } }],
    },

    // ── Catalog references.
    { code: `const o = { message: t('cli.addCard.added', { count: 1 }) }`, filename: COMMAND_FILE },
    { code: `const el = <span>{t('site.toolbar.sortBy')}</span>`, filename: SITE_FILE },
    { code: `const o = { title: 'site.toolbar.groupLabel' }`, filename: SITE_FILE },
    // A catalog parameter that is a select key, not text.
    { code: `const s = t('cli.sync.mode', { mode: 'dryRun' })`, filename: COMMAND_FILE },

    // ── Text positions with non-text values.
    { code: `const o = { description: 'file-order' }`, filename: COMMAND_FILE },
    { code: `const o = { title: '—' }`, filename: COMMAND_FILE },
    { code: `const o = { error: 'alert alert-error toast' }`, filename: 'src/ui/StatusToast.tsx' },

    // ── Non-sentences outside text positions.
    { code: `const o = { slug: 'My-Deck' }`, filename: COMMAND_FILE },
    { code: 'const line = `${a} ${b}`', filename: ENGINE_FILE },
    { code: 'const file = `${dir}/${name}.md`', filename: ENGINE_FILE },
    // Card-line grammar is English by construction and carries no words.
    {
      code: 'const line = `${qty} ${name} (${set}:${cn}) [foil] [NM] #${tag} &${id}`',
      filename: 'src/list/deck-file.ts',
    },
    // Machine-parsed `key=value` log tokens, even in a logger sink.
    {
      code: "logger.debug(`section=cards action=read-through-fill key='${key}'`)",
      filename: 'src/cache-server/handler.ts',
    },
    { code: `const style = 'color: red; gap: 4px'`, filename: SITE_FILE },
    { code: `const cls = 'flex items-center gap-2'`, filename: SITE_FILE },
    { code: 'const cls = `btn btn-secondary btn-${variant}`', filename: SITE_FILE },
    { code: `const methods = 'GET, POST, OPTIONS'`, filename: ENGINE_FILE },
    { code: `const kinds = 'TOTP SMS'`, filename: ENGINE_FILE },
    // A whole-string command line is copied, not read.
    { code: `const hint = 'ritual cache refresh --force'`, filename: ENGINE_FILE },
    { code: "const hint = '`ritual import-changes`'", filename: ENGINE_FILE },
    // Inline script source.
    {
      code: "const s = `<script>try { var t = localStorage.getItem('k'); if (t) apply(t); } catch {}</script>`",
      filename: 'src/theme/themes.ts',
    },

    // ── Structural non-text positions.
    { code: `'use client side'`, filename: ENGINE_FILE },
    { code: `import x from './Some Module Name'`, filename: ENGINE_FILE },
    { code: `export * from './Some Module Name'`, filename: ENGINE_FILE },
    { code: `const m = await import('./Some Module Name')`, filename: ENGINE_FILE },
    { code: `const o = { 'Some Key Here': 1 }`, filename: ENGINE_FILE },
    { code: `const v = obj['Some Key Here']`, filename: ENGINE_FILE },
    { code: `class A { 'Some Key Here' = 1 }`, filename: ENGINE_FILE },
    { code: `type Reason = 'not found here' | 'gone for good'`, filename: ENGINE_FILE },
    { code: `if (s === 'Invalid Date value') f()`, filename: ENGINE_FILE },
    { code: `if ('two words here' in obj) f()`, filename: ENGINE_FILE },
    { code: `switch (s) { case 'Two words': break }`, filename: ENGINE_FILE },
    { code: `if (text.includes('two words')) f()`, filename: ENGINE_FILE },
    { code: `localStorage.setItem('two words', 'more words here')`, filename: SITE_FILE },
    { code: `const re = new RegExp('one two three')`, filename: ENGINE_FILE },
    { code: `bus.emit('cards were saved', payload)`, filename: ENGINE_FILE },
    { code: `const p = path.join('two words', 'more words')`, filename: ENGINE_FILE },
    { code: `el.setAttribute('data-id', 'two words here')`, filename: SITE_FILE },
    { code: `const parts = names.join(', ')`, filename: ENGINE_FILE },
    { code: 'const style = css`margin: two words here`', filename: SITE_FILE },
    {
      code: `const headers = { 'Cache-Control': 'no store please' }`,
      filename: 'src/serve/server.ts',
    },
    // Non-text JSX attributes.
    { code: `const el = <div class="card name" />`, filename: SITE_FILE },
    { code: `const el = <Panel panelClass="card name" />`, filename: SITE_FILE },
    { code: `const el = <div aria-describedby="hint error" />`, filename: SITE_FILE },
    // Commander specs and defaults.
    { code: `program.option('--dry-run')`, filename: COMMAND_FILE },
    { code: `program.argument('<name>')`, filename: COMMAND_FILE },
    {
      code: `program.option('--refresh <mode>', t('help.refresh'), 'auto')`,
      filename: COMMAND_FILE,
    },
    // Code values in text positions: CSS functions, URLs, all-caps constants.
    {
      code: `const t = { '--warning-text': 'oklch(45% 0.1 85)' }`,
      filename: 'src/theme/themes.ts',
    },
    { code: `const o = { title: 'https://scryfall.com/docs/api' }`, filename: SITE_FILE },
    { code: `const TRANSIENT_ERRORS = ['EPERM', 'EACCES']`, filename: 'src/util/atomic-write.ts' },
    // A lowercase `…Error` helper and a bare local `toast` take a code or kind first.
    { code: `const e = siteDeployGuardError('set')`, filename: 'src/config/config-fields.ts' },
    { code: `const el = toast('status', status())`, filename: 'src/ui/StatusToast.tsx' },
    // A multi-line text is exempt when any line it spans is.
    {
      code: ['const s = `Deck saved', '  for good` // i18n-exempt: fixture'].join('\n'),
      filename: ENGINE_FILE,
    },
    // A function not named for text returns a non-sentence freely.
    { code: `function rowKey() { return 'Total' }`, filename: ENGINE_FILE },

    // ── Workspace commit messages are English by contract — in the message slot,
    // for the callee imported from its defining module.
    {
      code: [
        `import { autoCommitAndPush } from './save-helpers'`,
        'await autoCommitAndPush(dir, files, `Import deck: ${name}`)',
      ].join('\n'),
      filename: ADMIN_FILE,
    },
    {
      code: [
        `import { commitFiles as commit } from '../git'`,
        `commit(files, 'Update ritual configuration')`,
      ].join('\n'),
      filename: 'src/admin/api/config.ts',
    },

    // ── Escape hatch: an own-line comment covers the next line of code…
    {
      code: [`// i18n-exempt: protocol text`, `throw new Error('Invalid cache lock')`].join('\n'),
      filename: ENGINE_FILE,
    },
    // …past the rest of a multi-line comment block…
    {
      code: [
        `// i18n-exempt: a data file, not prose:`,
        `// the manifest is a CI cache key.`,
        `const header = '# All cards'`,
      ].join('\n'),
      filename: COMMAND_FILE,
    },
    // …and a trailing comment covers its own line.
    {
      code: `throw new Error('Invalid cache lock') // i18n-exempt: protocol identifier`,
      filename: ENGINE_FILE,
    },

    // ── Baseline: suppressed, matched on whitespace-normalized text.
    {
      code: SENTENCE,
      filename: 'src/deck.ts',
      options: [{ baseline: { 'src/deck.ts': { 'Deck was saved.': 1 } } }],
    },
    {
      code: 'throw new Error(`Lock held\n    by ${pid}, try again`)',
      filename: ENGINE_FILE,
      options: [{ baseline: { [ENGINE_FILE]: { 'Lock held by ${…}, try again': 1 } } }],
    },
    // Collect mode never collects exempt text.
    {
      code: `const a = 'Deck was saved.' // i18n-exempt: fixture`,
      filename: ENGINE_FILE,
      options: [{ collect: true }],
    },
  ],

  invalid: [
    // ── Scope: everything under `src/`, including each exclusion's sibling, the
    // persistence fence (detection only) and `src/export/`.
    ...EXCLUSIONS.map(([, sibling]) => ({
      code: SENTENCE,
      filename: sibling,
      errors: UNTRANSLATED,
    })),
    { code: SENTENCE, filename: 'src/changes/change-bundle.ts', errors: UNTRANSLATED },
    { code: SENTENCE, filename: 'src/export/render.ts', errors: UNTRANSLATED },
    {
      code: SENTENCE,
      filename: `${ROOT}/src/cache/lock.ts`,
      options: [{ root: ROOT }],
      errors: UNTRANSLATED,
    },
    // Baseline keys are per file: an entry for one file does not cover another.
    {
      code: SENTENCE,
      filename: 'src/other.ts',
      options: [{ baseline: { 'src/deck.ts': { 'Deck was saved.': 1 } } }],
      errors: UNTRANSLATED,
    },

    // ── Text positions: a single word counts.
    { code: `const el = <span>Save</span>`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `const el = <span>save</span>`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `const el = <p>{'Saved'}</p>`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `const el = <img alt="Card" />`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `const el = <button aria-label="Close" />`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `const el = <Empty heading="Nothing" />`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `const o = { title: 'Settings' }`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `const o = { emptyLabel: 'None' }`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: 'const o = { message: `${n} cards` }', filename: COMMAND_FILE, errors: UNTRANSLATED },
    {
      code: `const o = { cacheNote: 'no store please' }`,
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: `const o = { description: 'Deck.saved.now' }`,
      filename: COMMAND_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: `const s = t('cli.lock.held', { reason: 'Lock is held elsewhere' })`,
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    { code: `program.description('Synchronize')`, filename: COMMAND_FILE, errors: UNTRANSLATED },
    {
      code: `program.option('-n, --name <name>', 'Name of the list.')`,
      filename: COMMAND_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: `program.addHelpText('after', 'More help')`,
      filename: COMMAND_FILE,
      errors: UNTRANSLATED,
    },
    { code: `const o = new Option('-x', 'Help')`, filename: COMMAND_FILE, errors: UNTRANSLATED },
    // Only spec-shaped strings are skipped at a spec index.
    {
      code: `menu.option('Delete this list', remove)`,
      filename: COMMAND_FILE,
      errors: UNTRANSLATED,
    },
    { code: `el.setAttribute('title', 'Close')`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `el.textContent = 'Saved'`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `function f(label = 'Save') {}`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `const { title = 'Untitled' } = props`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `class A { title = 'Settings' }`, filename: SITE_FILE, errors: UNTRANSLATED },
    {
      code: `class A { constructor(private label = 'Save') {} }`,
      filename: SITE_FILE,
      errors: UNTRANSLATED,
    },
    { code: `function rowLabel() { return 'Total' }`, filename: SITE_FILE, errors: UNTRANSLATED },
    {
      code: `const q = { choices: ['Yes', 'No'] }`,
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated' }, { messageId: 'untranslated' }],
    },
    {
      code: `const choice = { name: 'Delete', value: 'delete' }`,
      filename: COMMAND_FILE,
      errors: UNTRANSLATED,
    },

    // ── Sinks: a single word counts.
    { code: `console.log('Done')`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `this.logger.info('Saved')`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `process.stdout.write('Done\\n')`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `alert('Saved')`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `throw new TypeError('Missing')`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    {
      code: `class LockError extends Error { constructor() { super('Locked') } }`,
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: `new Promise((resolve, reject) => reject('Failed'))`,
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    { code: `throw 'Failed'`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `const r = new Response('Forbidden')`, filename: ENGINE_FILE, errors: UNTRANSLATED },

    // ── Every other position: sentences, including templates with expressions.
    {
      code: 'function f(n) { return `Removed ${n} cards from the deck.` }',
      filename: 'src/deck-sync/describe.ts',
      errors: UNTRANSLATED,
    },
    {
      code: 'const note = cond ? `Kept ${n} copies.` : null',
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: `const o = { mode: 'two words here' }`,
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    { code: `class A { mode = 'two words here' }`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `enum E { A = 'Some text here' }`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: 'const p = html`<p>Some prose here</p>`', filename: SITE_FILE, errors: UNTRANSLATED },
    // A code tag's own text is skipped, but its expressions are still judged.
    {
      code: "const style = css`margin: ${'Some words here'}`",
      filename: SITE_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: `s.replaceAll('two words', 'Some replacement text')`,
      filename: ENGINE_FILE,
      errors: [{ messageId: 'untranslated', column: 27 }],
    },
    { code: `const parts = names.join(' and ')`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    {
      code: `program.option('-x, --xyz <v>', t('help.xyz'), 'some default text')`,
      filename: COMMAND_FILE,
      errors: UNTRANSLATED,
    },
    // Prose that a heuristic must not mistake for a class list, command or acronyms.
    {
      code: 'const s = `could not open ${file}: ${err}`',
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    { code: `const s = 'file is read-only'`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    {
      code: 'const s = `skipped ${n} up-to-date lists`',
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    { code: `const s = 're-run the import.'`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `const s = 'git push failed'`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: 'const s = `ritual ${cmd} failed`', filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `const s = 'INVALID CACHE LOCK FILE'`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `const s = 'Note: this is the text'`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `const s = '<p>Saved the deck</p>'`, filename: SITE_FILE, errors: UNTRANSLATED },
    {
      code: `const s = '<script>var a = 1; var b = 2; if (a) {}</script><p>Loading your deck</p>'`,
      filename: SITE_FILE,
      errors: UNTRANSLATED,
    },
    // Prose around machine tokens is still prose.
    {
      code: 'logger.info(`Cache miss for this card section=cards key=${key}`)',
      filename: 'src/cache-server/handler.ts',
      errors: UNTRANSLATED,
    },
    // A sentence that embeds a command is prose.
    {
      code: "const hint = 'Run `ritual cache refresh` first.'",
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },

    // ── Round-2 holes.
    { code: `const hint = 'ritual build-site'`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    {
      code: `const s = 'git rev-parse failed in the workspace'`,
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    { code: `const s = 'note: this is the text'`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: 'const s = String.raw`two words here`', filename: ENGINE_FILE, errors: UNTRANSLATED },
    // Component attributes that are only usually non-text are judged as sentences.
    {
      code: `const el = <StatTile name="Total value" value="Not priced" />`,
      filename: SITE_FILE,
      errors: [{ messageId: 'untranslated' }, { messageId: 'untranslated' }],
    },
    { code: `const el = <div data-tooltip="Copy" />`, filename: SITE_FILE, errors: UNTRANSLATED },
    {
      code: `const el = <input attr:placeholder="Search" />`,
      filename: SITE_FILE,
      errors: UNTRANSLATED,
    },
    // Text names on any case boundary, plural, and the literals they initialise.
    { code: `const DEFAULT_TITLE = 'Untitled'`, filename: SITE_FILE, errors: UNTRANSLATED },
    { code: `const FALLBACK_LABEL = 'None'`, filename: SITE_FILE, errors: UNTRANSLATED },
    {
      code: `const FINISH_LABELS = { foil: 'Foil', etched: 'Etched' }`,
      filename: SITE_FILE,
      errors: [{ messageId: 'untranslated' }, { messageId: 'untranslated' }],
    },
    {
      code: `const o = { hints: { add: ['Press A'] } }`,
      filename: SITE_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: `function reasonFor(x) { return 'Locked' }`,
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    { code: `const formatPrice = () => 'Free'`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    // Sinks take any word, through style wrappers and on every sink receiver.
    { code: `console.log('done')`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `console.log(pc.red('Failed'))`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `log.warn('careful')`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `spinner.succeed('Synced')`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `spinner.text = 'Loading'`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: `program.error('Bad input')`, filename: COMMAND_FILE, errors: UNTRANSLATED },
    { code: `const p = Promise.reject('Failed')`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    {
      code: `throw new CardCommandError('usage_error', 'Bad flag')`,
      filename: ENGINE_FILE,
      errors: [{ messageId: 'untranslated', column: 43 }],
    },
    {
      code: `return badRequest('Missing name')`,
      filename: 'src/api/cards.ts',
      errors: UNTRANSLATED,
    },
    { code: `bus.emit('status', 'Syncing')`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    // A commander spec slot judges anything that is not spec grammar.
    {
      code: `program.option('Delete everything now', 'x')`,
      filename: COMMAND_FILE,
      errors: UNTRANSLATED,
    },
    { code: `program.command('sync now please')`, filename: COMMAND_FILE, errors: UNTRANSLATED },
    // Every branch combination is judged, not only the longest.
    {
      code: "const s = `${c ? 'flex items-center gap-2' : 'Deck saved'}`",
      filename: SITE_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: `const s = [a && 'Could not', 'read the file'].filter(Boolean).join(' ')`,
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: `const s = 'Deck ' + (saved ? 'saved' : 'kept') + ' today'`,
      filename: ENGINE_FILE,
      options: [{ collect: true }],
      errors: [{ messageId: 'collect', data: { key: 'Deck {saved|kept} today' } }],
    },

    // ── Fragments fold into one text, reported once.
    {
      code: `const s = 'Deck ' + name + ' was saved.'`,
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: "const s = `${n} card${n === 1 ? '' : 's'} removed`",
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: `const s = (cond ? 'Deck' : 'List') + ' was saved'`,
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: "const s = `${cond ? `two ${b}` : ''} words`",
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    {
      code: `const s = ['Could not', 'read the file'].join(' ')`,
      filename: ENGINE_FILE,
      errors: UNTRANSLATED,
    },
    // English appended to catalog text is judged as text.
    { code: `const s = t('cli.a.b') + ' Done.'`, filename: ENGINE_FILE, errors: UNTRANSLATED },
    { code: "const s = `${t('cli.a.b')} (ignored)`", filename: ENGINE_FILE, errors: UNTRANSLATED },

    // ── The commit contract: only the message slot of the real callee.
    {
      code: [
        `import { autoCommitAndPush } from './save-helpers'`,
        `await autoCommitAndPush('two words here', files, msg)`,
      ].join('\n'),
      filename: ADMIN_FILE,
      errors: [{ messageId: 'untranslated', line: 2 }],
    },
    {
      code: [
        `import { autoCommitAndPush } from '../../elsewhere'`,
        `await autoCommitAndPush(dir, files, 'Import the deck now')`,
      ].join('\n'),
      filename: ADMIN_FILE,
      errors: [{ messageId: 'untranslated', line: 2 }],
    },
    {
      code: [
        `import { autoCommitAndPush } from './save-helpers'`,
        'await autoCommitAndPush(dir, files, msg); log(`Committed ${n} files to git.`)',
      ].join('\n'),
      filename: ADMIN_FILE,
      errors: [{ messageId: 'untranslated', line: 2 }],
    },

    // ── Escape hatch rules.
    {
      code: [`// i18n-exempt`, SENTENCE].join('\n'),
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated', line: 2 }],
    },
    {
      code: [`// see i18n-exempt: not at the start`, SENTENCE].join('\n'),
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated', line: 2 }],
    },
    {
      code: [`// i18n-exempt: this one only`, SENTENCE, `const b = 'Deck was deleted.'`].join('\n'),
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated', line: 3 }],
    },
    // A trailing comment does not reach the next line.
    {
      code: [`const a = 1 // i18n-exempt: only this line`, SENTENCE].join('\n'),
      filename: COMMAND_FILE,
      errors: [{ messageId: 'untranslated', line: 2 }],
    },

    // ── Baseline.
    {
      code: [SENTENCE, SENTENCE].join('\n'),
      filename: 'src/deck.ts',
      options: [{ baseline: { 'src/deck.ts': { 'Deck was saved.': 1 } } }],
      errors: [{ messageId: 'untranslated', line: 2 }],
    },
    {
      code: `const a = t('cli.deck.saved')`,
      filename: 'src/deck.ts',
      options: [{ baseline: { 'src/deck.ts': { 'Deck was saved.': 1 } } }],
      errors: [
        { messageId: 'stale', data: { text: 'Deck was saved.', expected: '1', actual: '0' } },
      ],
    },
    {
      code: SENTENCE,
      filename: 'src/deck.ts',
      options: [{ baseline: { 'src/deck.ts': { 'Deck was saved.': 2 } } }],
      errors: [
        { messageId: 'stale', data: { text: 'Deck was saved.', expected: '2', actual: '1' } },
      ],
    },
    {
      code: SENTENCE,
      filename: 'src/mcp/tools/read-tools.ts',
      options: [{ baseline: { 'src/mcp/tools/read-tools.ts': { 'Deck was saved.': 1 } } }],
      errors: [
        { messageId: 'stale', data: { text: 'Deck was saved.', expected: '1', actual: '0' } },
      ],
    },

    // ── Collect mode reports each occurrence by its baseline key.
    {
      code: 'throw new Error(`Lock held by ${pid}, try again`)',
      filename: ENGINE_FILE,
      options: [{ collect: true }],
      errors: [{ messageId: 'collect', data: { key: 'Lock held by ${…}, try again' } }],
    },
    {
      code: `const s = 'Deck ' + name + ' was saved.'`,
      filename: ENGINE_FILE,
      options: [{ collect: true }],
      errors: [{ messageId: 'collect', data: { key: 'Deck ${…} was saved.' } }],
    },
  ],
})
