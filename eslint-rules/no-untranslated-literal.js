/**
 * @fileoverview Flag human-readable text that never went through `t()`.
 *
 * Every string a human reads — CLI output, both SPAs, admin API errors,
 * engine errors, server/operator console logs — comes from the message
 * catalog. This rule finds the text that escaped it.
 *
 * **What a string is.** A string literal, a template literal (each expression
 * standing in as `${…}`), a `+` concatenation, or an array literal joined with
 * `.join(sep)` (through `.filter` / `.flat` / `.map`) is judged as *one* text.
 * Literal branches of `?:` / `&&` / `||` / `??` inside such a text are folded
 * in: every branch combination (up to {@link MAX_VARIANTS}) is judged, and the
 * baseline key spells the alternatives as `{a|b}` so rewording any branch
 * re-keys the entry. Nested templates fold into the outer one.
 *
 * **Tiers.** Each text is judged by where it lands ({@link classifyPosition}):
 *
 *   - `sink` ({@link isSinkText}) — any letter that is not a catalog key or a
 *     code identifier: `console.*`; methods on `log` / `logger` / `ui` / `out` /
 *     `reporter` / `spinner` receivers; `stdout`/`stderr.write`;
 *     `alert`/`confirm`/`toast`; `program.error`; the message argument of
 *     `new *Error(…)` / error helpers ({@link MESSAGE_ARGUMENT}), `super(…)` in
 *     an `Error` subclass, `reject(…)` / `Promise.reject(…)`; `throw`;
 *     `new Response(…)` / `Response.json(…)`; the payload of
 *     `emit('status' | 'progress' | 'message' | …, payload)`. Colour wrappers
 *     (`pc.red(…)`, `chalk.*`) are looked through.
 *   - `text` ({@link isProse}) — one word is enough: JSX text and `{…}`
 *     children; text-named properties, JSX attributes, variables, parameters,
 *     destructuring defaults and class fields — and every value inside an
 *     object/array literal initialising one ({@link isTextName}); unknown JSX
 *     attributes; prompt `choices` and choice `name`s; commander help
 *     arguments; assignment to `textContent` / `innerText` / a text-named
 *     target; returns from text-named functions ({@link isTextFunctionName});
 *     a catalog call's parameter object; English appended to a `t()` call.
 *   - `sentence` ({@link isSentence}) — two words: every other position.
 *   - `skip` — structurally never text (see {@link classifyPosition}).
 *
 * Machine-parsed `key=value` log tokens (`section=cards action=fill`) and HTML
 * tags are removed before every test.
 *
 * **Scope.** `include` / `exclude` are repo-relative fragments (a trailing `/`
 * is a directory, anything else one exact file) resolved against the `root`
 * option. All of `src/` is in scope except the English-by-contract surfaces.
 * Git commit messages the admin server writes into the user's workspace repo
 * are English by contract too: `contractCalls` names the functions (by the
 * module that defines them, matched through the file's imports) whose
 * commit-message argument is skipped.
 *
 * **Baseline.** `baseline` maps a repo-relative file to `{ text: count }` — the
 * untranslated text that predates this rule's widening
 * (`eslint-rules/untranslated-baseline.json`). A baselined occurrence is
 * suppressed; an occurrence beyond its count is reported; and a baselined entry
 * the file no longer contains is reported as **stale**, so converting a string
 * forces deleting its entry and the baseline only shrinks. Entries are keyed by
 * text, not line. `collect: true` reports every candidate with its baseline key
 * (for `scripts/untranslated-baseline.ts`, never the lint config).
 *
 * **Escape hatch.** A comment that *starts* with `i18n-exempt: <reason>`, on
 * its own line, exempts the next line of code; as a trailing comment it exempts
 * its own line. A text is exempt when any line it spans is. The reason is
 * mandatory.
 */

import path from 'node:path'

// ─── Scope ──────────────────────────────────────────────────────────────────

/** Where human-readable strings live: everything under `src/`. */
export const DEFAULT_INCLUDE = ['src/']

/**
 * The English-by-contract surfaces (see AGENTS.md "Localization"). A trailing
 * `/` is a directory; any other entry is one exact file.
 */
export const DEFAULT_EXCLUDE = [
  // The catalog is where the English text is supposed to be.
  'src/i18n/messages/',
  // Model-facing MCP prose: tool definitions, schemas, server instructions,
  // resource descriptions. The rest of `src/mcp/` (operator logs) is in scope.
  'src/mcp/tools/',
  'src/mcp/server.ts',
  'src/mcp/schemas.ts',
  'src/mcp/schema-defs.ts',
  'src/mcp/schema-json.ts',
  'src/mcp/resources.ts',
  // Skill content and skill descriptions.
  'src/skills/content/',
  'src/skills/catalog.ts',
  // Generated code (also ESLint-ignored; listed so the baseline loader agrees).
  'src/generated/',
  // Managed generated files (the CI workflow) are workspace data.
  'src/migrate/managed-files.ts',
]

/**
 * Calls whose commit-message argument is English by contract: the admin
 * server's git auto-commit writes it into the user's workspace repository.
 * Matched only when the callee is imported from (or defined in) `module`.
 */
const DEFAULT_CONTRACT_CALLS = [
  { name: 'autoCommitAndPush', argument: 2, module: 'src/admin/api/save-helpers.ts' },
  { name: 'commitFiles', argument: 1, module: 'src/admin/git.ts' },
]

/** Whether a repo-relative POSIX path is linted by this rule. */
export function isInScope(relative, include = DEFAULT_INCLUDE, exclude = DEFAULT_EXCLUDE) {
  if (relative.startsWith('../') || path.isAbsolute(relative)) return false
  const matches = (fragment) =>
    fragment.endsWith('/') ? relative.startsWith(fragment) : relative === fragment
  return include.some(matches) && !exclude.some(matches)
}

// ─── Text names ─────────────────────────────────────────────────────────────

/**
 * The one vocabulary for names that hold prose — property, attribute,
 * variable, parameter, class-field and function names alike. A name is
 * text-named when its last word (split on camelCase, `_`, `-` and `:`, any
 * case, singular or plural) is one of these: `title`, `emptyMessage`,
 * `DEFAULT_TITLE`, `FINISH_LABELS`, `aria-label`.
 */
const TEXT_WORDS = new Set([
  'message',
  'title',
  'description',
  'placeholder',
  'alt',
  'label',
  'error',
  'text',
  'hint',
  'reason',
  'detail',
  'tooltip',
  'heading',
  'subtitle',
  'summary',
  'warning',
  'note',
  'fallback',
  'caption',
  'prompt',
  'notice',
])

/** Text-shaped names that are not text. */
const NOT_TEXT_NAMES = new Set(['cssText'])

/** Leading words that make a function's return value display text (`describeSync`, `formatPrice`). */
const TEXT_FUNCTION_VERBS = new Set(['describe', 'format', 'render'])

/** Assignment targets that render their value as text. */
const TEXT_ASSIGNMENT_TARGETS = new Set(['textContent', 'innerText', 'innerHTML'])

/** A name's words, lowercased: `DEFAULT_TITLE` → `default title`, `emptyMessage` → `empty message`. */
function nameWords(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_:-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase())
}

/** A word's singular when it is a plural text word (`labels`, `summaries`). */
function singular(word) {
  if (word.endsWith('ies') && TEXT_WORDS.has(`${word.slice(0, -3)}y`))
    return `${word.slice(0, -3)}y`
  if (word.endsWith('s') && TEXT_WORDS.has(word.slice(0, -1))) return word.slice(0, -1)
  return word
}

/** Whether a property / variable / parameter / attribute name holds prose. */
function isTextName(name) {
  if (name === null || name === undefined || NOT_TEXT_NAMES.has(name)) return false
  const words = nameWords(name)
  const last = words.at(-1)
  return last !== undefined && TEXT_WORDS.has(singular(last))
}

/**
 * Whether a function returns display text: a text-named function (`rowLabel`),
 * a `describe*` / `format*` / `render*` one, or `<text word>For…` (`reasonFor`).
 */
function isTextFunctionName(name) {
  if (name === null) return false
  if (isTextName(name)) return true
  const words = nameWords(name)
  const first = words[0]
  if (first === undefined) return false
  if (TEXT_FUNCTION_VERBS.has(first)) return true
  return TEXT_WORDS.has(singular(first)) && words[1] === 'for'
}

// ─── JSX attributes ─────────────────────────────────────────────────────────

/** The `aria-*` attributes whose value is read aloud (the rest hold ids or tokens). */
const TEXT_ARIA_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
])

/**
 * Attributes of *intrinsic* elements (`<div>`, `<input>`) that never hold
 * text. On a component the same names are only usually non-text, so they are
 * judged as sentences there (`<StatTile value="Not priced" />`).
 */
const NON_TEXT_JSX_ATTRIBUTES = new Set([
  'id',
  'href',
  'src',
  'srcset',
  'type',
  'name',
  'for',
  'role',
  'rel',
  'target',
  'method',
  'action',
  'accept',
  'autocomplete',
  'inputmode',
  'pattern',
  'viewBox',
  'd',
  'fill',
  'stroke',
  'transform',
  'xmlns',
  'lang',
  'dir',
  'download',
  'value',
  'width',
  'height',
  'loading',
  'decoding',
  'enterkeyhint',
])

/** Attributes that never hold text on any element: identity, styling, handlers. */
const NEVER_TEXT_ATTRIBUTE =
  /^(?:key|ref|style|class(?:Name|List)?|\w+Class(?:Name|List)?|on[A-Z]\w*)$/

// ─── Calls ──────────────────────────────────────────────────────────────────

/**
 * Commander methods: which argument is help text, and which are specs
 * (flags, `<arg>` names, command names). A spec slot is skipped only when the
 * string matches {@link isCommanderSpec}; anything else there is judged.
 */
const COMMANDER_ARGUMENTS = new Map([
  ['description', { text: [0], spec: [] }],
  ['summary', { text: [0], spec: [] }],
  ['option', { text: [1], spec: [0] }],
  ['requiredOption', { text: [1], spec: [0] }],
  ['argument', { text: [1], spec: [0] }],
  ['addHelpText', { text: [1], spec: [0] }],
  ['version', { text: [2], spec: [0, 1] }],
  ['helpOption', { text: [1], spec: [0] }],
  ['showHelpAfterError', { text: [0], spec: [] }],
  ['command', { text: [], spec: [0] }],
  ['alias', { text: [], spec: [0] }],
  ['aliases', { text: [], spec: [0] }],
  ['usage', { text: [], spec: [0] }],
  ['name', { text: [], spec: [0] }],
])

/** `new Option(flags, description)` / `new Argument(name, description)`. */
const COMMANDER_CONSTRUCTORS = new Set(['Option', 'Argument'])

const ARG = '(?:<[\\w.-]+(?:\\.{3})?>|\\[[\\w.-]+(?:\\.{3})?\\])'
/** Commander's spec grammar: flags, argument lists, command names, help positions, versions. */
const COMMANDER_SPECS = [
  new RegExp(`^(?:-[A-Za-z0-9],?\\s*)?(?:--[a-z0-9][\\w-]*|-[A-Za-z0-9])(?:\\s+${ARG})?$`),
  new RegExp(`^${ARG}(?:\\s+${ARG})*$`),
  new RegExp(`^[a-z][\\w:-]*(?:\\s+${ARG})*$`),
  /^(?:before|after)(?:All)?$/,
  /^v?\d[\w.+-]*$/,
]

function isCommanderSpec(text) {
  const trimmed = text.trim()
  return COMMANDER_SPECS.some((spec) => spec.test(trimmed))
}

/** Catalog accessors: their direct arguments are keys and locales. */
const CATALOG_CALLS = new Set([
  't',
  'tIn',
  'tp',
  'tDynamic',
  'tSegments',
  'tSegmentsIn',
  'tSegmentsDynamic',
  'isMessageKey',
])

/**
 * Bare calls that show their arguments to a human. (A bare `toast(…)` is not
 * here: local helpers by that name take a kind first; `toast.*` methods are a
 * sink receiver.)
 */
const UI_SINK_CALLS = new Set(['alert', 'confirm'])

/** Receivers whose every method prints to a human (`logger.warn`, `spinner.succeed`). */
const SINK_RECEIVER = /^(?:console|log|logger|ui|out|reporter|spinner|toast)$|Logger$/

/** Receivers whose `.error(…)` prints and exits (commander). */
const COMMANDER_RECEIVER = /^(?:program|command|cmd)$/

/**
 * Error constructors and helpers whose message is not argument 0. Any other
 * `…Error` callee takes its message first.
 */
const MESSAGE_ARGUMENT = new Map([
  ['CardCommandError', 1],
  ['errorResponse', 0],
  ['badRequest', 0],
  ['throwHttpError', 1],
])

/** `emit(event, payload)` events whose payload is shown to a human. */
const TEXT_EVENTS = new Set(['status', 'progress', 'message', 'warning', 'error', 'log', 'notice'])

/** Colour / style wrappers: `pc.red(text)` shows `text`. */
const STYLE_WRAPPERS = new Set(['pc', 'picocolors', 'chalk', 'kleur', 'colors', 'styleText'])

/**
 * Methods and functions whose arguments at these indexes are identifiers,
 * patterns, selectors, paths, URLs, event names or argv. `'all'` covers every
 * argument.
 */
const NON_TEXT_CALL_ARGUMENTS = new Map([
  ['includes', [0]],
  ['startsWith', [0]],
  ['endsWith', [0]],
  ['indexOf', [0]],
  ['lastIndexOf', [0]],
  ['split', [0]],
  ['replace', [0]],
  ['replaceAll', [0]],
  ['match', [0]],
  ['matchAll', [0]],
  ['search', [0]],
  ['padStart', [1]],
  ['padEnd', [1]],
  ['has', [0]],
  ['get', [0]],
  ['set', [0]],
  ['delete', [0]],
  ['getItem', [0]],
  ['setItem', [0, 1]],
  ['removeItem', [0]],
  ['querySelector', [0]],
  ['querySelectorAll', [0]],
  ['closest', [0]],
  ['matches', [0]],
  ['getAttribute', [0]],
  ['removeAttribute', [0]],
  ['hasAttribute', [0]],
  ['toggleAttribute', [0]],
  ['setAttribute', [0]],
  ['createElement', [0]],
  ['getElementById', [0]],
  ['getPropertyValue', [0]],
  ['setProperty', [0, 1]],
  ['addEventListener', [0]],
  ['removeEventListener', [0]],
  ['on', [0]],
  ['once', [0]],
  ['off', [0]],
  ['emit', [0]],
  ['require', [0]],
  ['fetch', [0]],
  ['Symbol', [0]],
  ['URL', [0, 1]],
  ['URLSearchParams', [0]],
  ['RegExp', 'all'],
  ['execFileSync', 'all'],
  ['execFile', 'all'],
  ['execSync', 'all'],
  ['exec', 'all'],
  ['spawn', 'all'],
  ['spawnSync', 'all'],
])

/** `path.join(…)` and friends: every argument is a path. */
const PATH_MODULES = new Set(['path', 'posix', 'win32'])

/** Tags whose template is code, not text. Other tagged templates are judged. */
const NON_TEXT_TEMPLATE_TAGS = new Set(['css', 'sql', '$', 'keyframes', 'gql', 'graphql'])

/** Array methods a `.join` looks through: the joined text is still these strings. */
const JOIN_PASS_THROUGH = new Set(['filter', 'flat', 'map'])

/** An HTTP header name: its value is a protocol token. */
const HTTP_HEADER_NAME =
  /^(?:[A-Z][a-z0-9]*(?:-[A-Z][a-z0-9]*)+|(?:content|accept|access-control|cache|cross-origin|x)-[a-z0-9-]+)$/

/** Comparison and type-test operators: their string operands are tokens. */
const COMPARISON_OPERATORS = new Set(['===', '!==', '==', '!=', 'in', 'instanceof'])

/** Parent node types that pass their child's position through unchanged. */
const TRANSPARENT_PARENTS = new Set([
  'ConditionalExpression',
  'LogicalExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'ChainExpression',
  'AwaitExpression',
  'SequenceExpression',
  'ArrayExpression',
  'SpreadElement',
])

// ─── Text tests ─────────────────────────────────────────────────────────────

/** A comment that grants an exemption: `i18n-exempt:` first, then a reason. */
const EXEMPT_COMMENT = /^\s*i18n-exempt:\s*\S/

/**
 * A message key (`site.toolbar.groupLabel`) — a *reference* to catalog text.
 *
 * Namespaces are duplicated from `src/i18n/messages/en.ts` because an ESLint
 * rule cannot import TypeScript; `test/unit/i18n-conventions.test.ts` pins the
 * two lists together.
 */
const MESSAGE_KEY_LIKE =
  /^(?:cli|help|site|admin|ui|domain|errors)\.[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)+$/

/** Stands in for a template expression in a baseline key and the text tests. */
const PLACEHOLDER = '${…}'

/** The most branch combinations of one folded text that are judged. */
const MAX_VARIANTS = 16

/** A machine-parsed log token: `section=cards`, `key='…'`, `ms=${…}`. */
const MACHINE_TOKEN = /^[A-Za-z_][\w.-]*=\S*$/

/** A word: two or more letters, optionally punctuated. */
const WORD = /^[("'`“‘]*[A-Za-z][A-Za-z'’-]*[A-Za-z][)"'`”’.,:;!?…]*$/

/** `<script>…</script>` / `<style>…</style>` blocks inside an HTML string. */
const CODE_BLOCKS = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

/** An HTML tag. */
const HTML_TAG = /<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g

/** A whole-string command line: the tool, then subcommands, flags, `<args>`, placeholders. */
const COMMAND_LINE =
  /^(?:ritual|bun|bunx|git|npx|npm)(?:\s+(?:[a-z0-9][\w.:/-]*|--?[\w-]+(?:=\S*)?|<[^>]+>|\[[^\]]+\]|\$\{…\}))+$/

/** What marks a command line as code rather than a sentence: a flag or an `<arg>`. */
const COMMAND_MARKER = /(?:^|\s)(?:--?[\w-]|<[^>]+>)/

/** A CSS declaration list: `color: red; gap: 4px`. */
const CSS_DECLARATIONS = /^(?:\s*[a-z-]+\s*:\s*[^;]+;?)+\s*$/

/** English function words: a token list containing one is prose. */
const FUNCTION_WORDS = new Set(
  (
    'a an the of to in on at by for from with and or not no nor is are was were be been ' +
    'it its this that these those as if then than so but can cannot could would should ' +
    'will may might must has have had do does did up all any some each every only into ' +
    'out off over per via you your we our they their there here when which who what'
  ).split(' '),
)

/** A short all-caps acronym (`GET`, `CSV`, `TOTP`). */
const ACRONYM = /^[A-Z]{2,5}[,.:;]?$/

/** Name-shaped tokens: `camelCase` keys, flags, file names. */
const NAME_TOKEN_SOURCE = '[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+|--?[\\w-]+|[\\w-]+\\.[a-z0-9]{1,5}'
const NAME_TOKEN = new RegExp(`^(?:${NAME_TOKEN_SOURCE})$`)
/** A single token that names something rather than saying it — {@link NAME_TOKEN} or a slug. */
const IDENTIFIER_LIKE = new RegExp(`^(?:[a-z0-9][a-z0-9._-]*|${NAME_TOKEN_SOURCE})$`)
/**
 * A value that is code, not words: a CSS function (`oklch(45% 0.1 85)`,
 * `var(--x)`), a URL, an all-caps constant (`EACCES`, `NOT_FOUND`).
 */
const CODE_VALUE =
  /^(?:[a-z-]+\([^()]*(?:\([^()]*\)[^()]*)*\)|[a-z][a-z0-9+.-]*:\/\/\S+|[A-Z][A-Z0-9_]+)$/

/** A code identifier a sink may print: `snake_case`, `camelCase`, `dotted.path`. */
const CODE_IDENTIFIER = /^(?:[A-Za-z0-9]+(?:[_.][A-Za-z0-9]+)+|[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+)$/

function hasFunctionWord(tokens) {
  return tokens.some((token) => FUNCTION_WORDS.has(token.toLowerCase().replace(/[^a-z]/g, '')))
}

function isCommandLine(text) {
  const backticked = /^`[^`]+`$/.test(text)
  const inner = backticked ? text.slice(1, -1) : text
  if (!COMMAND_LINE.test(inner) || hasFunctionWord(inner.split(/\s+/).slice(1))) return false
  return backticked || COMMAND_MARKER.test(inner)
}

/** Text with code blocks, HTML tags and machine `key=value` tokens removed. */
function readableTokens(text) {
  const stripped = text.replace(CODE_BLOCKS, ' ').replace(HTML_TAG, ' ')
  return stripped.split(/\s+/).filter((token) => token.length > 0 && !MACHINE_TOKEN.test(token))
}

/**
 * The `sink` test: any readable letter that is not a catalog key, a code
 * identifier, or a command line. `'done'` printed to the console is prose.
 */
function isSinkText(text) {
  const trimmed = text.trim()
  if (MESSAGE_KEY_LIKE.test(trimmed) || isCommandLine(trimmed) || CODE_VALUE.test(trimmed)) {
    return false
  }
  const statics = readableTokens(trimmed).join(' ').replaceAll(PLACEHOLDER, ' ').trim()
  if (!/[A-Za-z]/.test(statics)) return false
  return !CODE_IDENTIFIER.test(statics)
}

/**
 * The `text` test: readable text with a run of two or more letters that is
 * not an identifier, a catalog key, a command line or a class list. A single
 * word counts (a lowercase one when it ends a sentence: `'saved.'`); with
 * placeholders, a word next to one (`${n} cards`) counts.
 */
function isProse(text) {
  const trimmed = text.trim()
  if (MESSAGE_KEY_LIKE.test(trimmed) || isCommandLine(trimmed) || CODE_VALUE.test(trimmed)) {
    return false
  }
  const tokens = readableTokens(trimmed)
  const statics = tokens.join(' ').replaceAll(PLACEHOLDER, ' ').trim()
  if (!/[A-Za-z]{2,}/.test(statics)) return false
  if (isClassList(tokens)) return false
  if (trimmed.includes(PLACEHOLDER)) {
    return tokens.some((token) => WORD.test(token) && !NAME_TOKEN.test(token))
  }
  return !IDENTIFIER_LIKE.test(statics) || /[a-z][.!?…]$/.test(statics)
}

/**
 * The `sentence` test: at least two words, and not a command line, CSS, an
 * inline script, an acronym list, or a class list.
 */
function isSentence(text) {
  const trimmed = text.trim()
  if (!isProse(trimmed)) return false
  const tokens = readableTokens(trimmed)
  if (CSS_DECLARATIONS.test(trimmed) && !/[A-Z]/.test(trimmed) && !hasFunctionWord(tokens)) {
    return false
  }
  const readable = tokens.join(' ').replaceAll(PLACEHOLDER, '')
  if (/[{}]/.test(readable) && (readable.match(/;/g) ?? []).length >= 2) return false
  const words = tokens.filter((token) => WORD.test(token))
  if (words.length < 2) return false
  if (
    words.every((word) => !/[a-z]/.test(word)) &&
    (words.every((word) => ACRONYM.test(word)) || /^[A-Z]+(?:,\s*[A-Z]+)+$/.test(trimmed))
  ) {
    return false
  }
  return true
}

/**
 * `flex items-center gap-2`, `btn btn-${variant}`, `alert alert-error toast`:
 * two or more lowercase tokens with no sentence punctuation and no function
 * words, that are mostly dash-joined, share a dash segment, or use BEM `--`.
 * (`skipped ${n} up-to-date lists` is none of those.)
 */
function isClassList(tokens) {
  const named = tokens.filter((token) => token !== PLACEHOLDER)
  if (named.length < 2) return false
  if (!named.every((token) => /^[a-z0-9_[\]/.${}…-]+$/.test(token) && !/[.,;!?]$/.test(token))) {
    return false
  }
  if (hasFunctionWord(named)) return false
  const dashed = named.filter((token) => /[a-z0-9]-[a-z0-9$]/.test(token))
  if (dashed.length * 2 > named.length || named.some((token) => token.includes('--'))) return true
  const segments = named.map((token) => new Set(token.split('-').filter((part) => part.length > 1)))
  return segments.some((mine, index) =>
    segments.some((theirs, other) => other !== index && [...mine].some((part) => theirs.has(part))),
  )
}

/** A join separator is text when it carries a word (`' and '`). */
function isSeparatorText(text) {
  return /[A-Za-z]{2,}/.test(text)
}

/** Whether a text fails its tier's test. */
function isUntranslated(text, tier) {
  switch (tier) {
    case 'skip':
      return false
    case 'sink':
      return isSinkText(text)
    case 'text':
      return isProse(text)
    case 'separator':
      return isSeparatorText(text)
    case 'spec':
      return !isCommanderSpec(text) && isSentence(text)
    default:
      return isSentence(text)
  }
}

// ─── AST helpers ────────────────────────────────────────────────────────────

/** The bare name a callee resolves to (`t`, `console.error` → `error`). */
function calleeName(callee) {
  if (!callee) return null
  if (callee.type === 'Identifier') return callee.name
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier'
  ) {
    return callee.property.name
  }
  return null
}

/** The name of a member callee's receiver (`console.log` → `console`, `this.logger.x` → `logger`). */
function receiverName(callee) {
  if (callee?.type !== 'MemberExpression') return null
  const object = callee.object
  if (object.type === 'Identifier') return object.name
  if (
    object.type === 'MemberExpression' &&
    !object.computed &&
    object.property.type === 'Identifier'
  ) {
    return object.property.name
  }
  return null
}

function keyName(node) {
  if (!node.key) return null
  if (node.key.type === 'Identifier' && !node.computed) return node.key.name
  if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value
  return null
}

/** An attribute's name, with Solid's `attr:` / `prop:` prefixes removed. */
function jsxAttributeName(node) {
  if (node.name.type === 'JSXIdentifier') return node.name.name
  if (node.name.type === 'JSXNamespacedName') {
    const namespace = node.name.namespace.name
    const name = node.name.name.name
    return namespace === 'attr' || namespace === 'prop' ? name : `${namespace}:${name}`
  }
  return null
}

function isTextAttributeName(name) {
  return isTextName(name) || TEXT_ARIA_ATTRIBUTES.has(name)
}

/** Whether a JSX attribute belongs to an intrinsic element (`<div>`) rather than a component. */
function isIntrinsicElement(attribute) {
  const name = attribute.parent?.name
  return name?.type === 'JSXIdentifier' && /^[a-z]/.test(name.name)
}

function attributeTier(attribute) {
  const name = jsxAttributeName(attribute)
  if (name === null) return 'sentence'
  if (TEXT_ARIA_ATTRIBUTES.has(name)) return 'text'
  if (name.startsWith('data-')) return isTextName(name.slice(5)) ? 'text' : 'skip'
  if (name.startsWith('aria-') || name.includes(':') || NEVER_TEXT_ATTRIBUTE.test(name)) {
    return 'skip'
  }
  if (isTextName(name)) return 'text'
  if (NON_TEXT_JSX_ATTRIBUTES.has(name)) return isIntrinsicElement(attribute) ? 'skip' : 'sentence'
  return 'text'
}

function tagName(tag) {
  if (tag.type === 'Identifier') return tag.name
  if (tag.type === 'MemberExpression' && tag.property.type === 'Identifier')
    return tag.property.name
  if (tag.type === 'CallExpression') return tagName(tag.callee)
  return null
}

function isNonTextTaggedQuasi(template) {
  const parent = template.parent
  return (
    parent?.type === 'TaggedTemplateExpression' &&
    parent.quasi === template &&
    NON_TEXT_TEMPLATE_TAGS.has(tagName(parent.tag))
  )
}

/** The array literal a `.join` call joins, looking through `.filter` / `.flat` / `.map`. */
function joinedArray(call) {
  if (call?.type !== 'CallExpression' || calleeName(call.callee) !== 'join') return null
  if (call.callee.type !== 'MemberExpression') return null
  let object = call.callee.object
  while (
    object.type === 'CallExpression' &&
    object.callee.type === 'MemberExpression' &&
    JOIN_PASS_THROUGH.has(calleeName(object.callee))
  ) {
    object = object.callee.object
  }
  return object.type === 'ArrayExpression' ? object : null
}

/** The `.join` call an array literal flows into, through `.filter` / `.flat` / `.map`. */
function joinCallOf(array) {
  let current = array
  for (;;) {
    const member = current.parent
    if (member?.type !== 'MemberExpression' || member.object !== current || member.computed) {
      return null
    }
    const call = member.parent
    if (call?.type !== 'CallExpression' || call.callee !== member) return null
    const method = calleeName(member)
    if (method === 'join') return call
    if (!JOIN_PASS_THROUGH.has(method)) return null
    current = call
  }
}

function isCatalogCall(node) {
  return node?.type === 'CallExpression' && CATALOG_CALLS.has(calleeName(node.callee))
}

/** Whether a call only styles its argument (`pc.red(text)`, `chalk.bold.red(text)`). */
function isStyleWrapper(call) {
  if (call?.type !== 'CallExpression') return false
  let callee = call.callee
  while (callee.type === 'MemberExpression') callee = callee.object
  return callee.type === 'Identifier' && STYLE_WRAPPERS.has(callee.name)
}

/** The name of the function a node's enclosing `return` / arrow body belongs to. */
function functionName(fn) {
  if (fn.id?.type === 'Identifier') return fn.id.name
  const parent = fn.parent
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier')
    return parent.id.name
  if (
    parent?.type === 'MethodDefinition' ||
    parent?.type === 'Property' ||
    parent?.type === 'PropertyDefinition'
  ) {
    return keyName(parent)
  }
  return null
}

function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression'
    ) {
      return current
    }
  }
  return null
}

/** Whether a `super(…)` call sits in a class that extends an `…Error`. */
function isErrorSuperCall(call) {
  for (let current = call.parent; current; current = current.parent) {
    if (current.type === 'ClassDeclaration' || current.type === 'ClassExpression') {
      const name = calleeName(current.superClass)
      return name !== null && /Error$/.test(name)
    }
  }
  return false
}

/**
 * Whether an object or array literal initialises something text-named —
 * `const FINISH_LABELS = { foil: 'Foil' }`, `{ hints: ['Try this'] }` — so
 * every value inside it is text.
 */
function isInTextContainer(literal) {
  let current = literal
  while (current.parent) {
    const parent = current.parent
    switch (parent.type) {
      case 'Property':
        if (parent.value !== current) return false
        if (isTextName(keyName(parent))) return true
        current = parent.parent
        continue
      case 'ArrayExpression':
      case 'ObjectExpression':
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
        current = parent
        continue
      case 'VariableDeclarator':
        return parent.id.type === 'Identifier' && isTextName(parent.id.name)
      case 'PropertyDefinition':
        return isTextName(keyName(parent))
      default:
        return false
    }
  }
  return false
}

// ─── Folding fragments into one text ────────────────────────────────────────

/**
 * The node a string-valued node folds into, or null when it is the whole
 * text: a template's expression, a `+` operand, a `?:` / `&&` / `||` branch
 * inside one of those, or an element / separator of a joined array.
 */
function foldParent(node) {
  const parent = node.parent
  if (!parent) return null
  if (parent.type === 'TemplateLiteral' && parent.expressions.includes(node)) {
    return isNonTextTaggedQuasi(parent) ? null : parent
  }
  if (parent.type === 'BinaryExpression' && parent.operator === '+') return parent
  if (
    (parent.type === 'ConditionalExpression' && parent.test !== node) ||
    parent.type === 'LogicalExpression' ||
    parent.type === 'TSAsExpression' ||
    parent.type === 'TSNonNullExpression'
  ) {
    return foldParent(parent) === null ? null : parent
  }
  if (parent.type === 'ArrayExpression') return joinCallOf(parent)
  if (joinedArray(parent) !== null && parent.arguments[0] === node) return parent
  return null
}

function foldRoot(node) {
  let current = node
  for (let next = foldParent(current); next !== null; next = foldParent(current)) current = next
  return current
}

/** A folded text: every branch combination (capped), and the key spelling alternatives as `{a|b}`. */
const PLACEHOLDER_FOLD = { variants: [PLACEHOLDER], key: PLACEHOLDER }

function literalFold(text) {
  return { variants: [text], key: text }
}

function concatFolds(a, b) {
  const variants = []
  for (const left of a.variants) {
    for (const right of b.variants) {
      if (variants.length < MAX_VARIANTS) variants.push(left + right)
    }
  }
  return { variants, key: a.key + b.key }
}

function alternativeFolds(a, b) {
  if (a.key === PLACEHOLDER && b.key === PLACEHOLDER) return PLACEHOLDER_FOLD
  const variants = [...new Set([...a.variants, ...b.variants])].slice(0, MAX_VARIANTS)
  return { variants, key: `{${a.key}|${b.key}}` }
}

/**
 * Fold a text root. `facts.strings` records whether any part was a string;
 * `facts.catalog` whether a part was a catalog call.
 */
function fold(node, facts) {
  switch (node.type) {
    case 'Literal':
      if (typeof node.value !== 'string') return PLACEHOLDER_FOLD
      facts.strings = true
      return literalFold(node.value)
    case 'TemplateLiteral': {
      facts.strings = true
      let result = literalFold('')
      node.quasis.forEach((quasi, index) => {
        result = concatFolds(result, literalFold(quasi.value.cooked ?? ''))
        const expression = node.expressions[index]
        if (expression) result = concatFolds(result, fold(expression, facts))
      })
      return result
    }
    case 'BinaryExpression':
      if (node.operator !== '+') return PLACEHOLDER_FOLD
      return concatFolds(fold(node.left, facts), fold(node.right, facts))
    case 'ConditionalExpression':
      return alternativeFolds(fold(node.consequent, facts), fold(node.alternate, facts))
    case 'LogicalExpression':
      return alternativeFolds(fold(node.left, facts), fold(node.right, facts))
    case 'TSAsExpression':
    case 'TSNonNullExpression':
      return fold(node.expression, facts)
    case 'CallExpression': {
      if (isCatalogCall(node)) {
        facts.catalog = true
        return PLACEHOLDER_FOLD
      }
      const array = joinedArray(node)
      if (array === null) return PLACEHOLDER_FOLD
      const separator = node.arguments[0] ? fold(node.arguments[0], facts) : literalFold(',')
      let result = literalFold('')
      array.elements.forEach((element, index) => {
        if (index > 0) result = concatFolds(result, separator)
        result = concatFolds(result, element ? fold(element, facts) : PLACEHOLDER_FOLD)
      })
      return result
    }
    default:
      return PLACEHOLDER_FOLD
  }
}

// ─── Positions ──────────────────────────────────────────────────────────────

/**
 * Climb from a text through the parents that do not change what it is for
 * (`a ? 'x' : 'y'`, `x as T`, an array element, a judged tagged template, a
 * style wrapper).
 */
function effectiveNode(node) {
  let current = node
  while (current.parent) {
    const parent = current.parent
    if (parent.type === 'ConditionalExpression' && parent.test === current) return current
    if (parent.type === 'SequenceExpression' && parent.expressions.at(-1) !== current) {
      return current
    }
    if (
      TRANSPARENT_PARENTS.has(parent.type) ||
      (parent.type === 'TaggedTemplateExpression' && parent.quasi === current) ||
      (isStyleWrapper(parent) && parent.arguments.includes(current))
    ) {
      current = parent
      continue
    }
    return current
  }
  return current
}

/**
 * How strictly to judge a text, by position: `'sink'`, `'text'`,
 * `'sentence'`, `'separator'` (a `.join` separator), `'spec'` (a commander
 * spec slot), or `'skip'` for a slot that is structurally never human text:
 * module specifiers, property keys, type positions, comparisons and `switch`
 * cases, catalog-key arguments, identifier arguments of string / DOM / event /
 * storage / path / URL / regex / process calls, non-text JSX attributes, HTTP
 * header values, code-tagged templates, and workspace commit messages.
 */
function classifyPosition(root, ctx) {
  if (root.type === 'TemplateLiteral' && isNonTextTaggedQuasi(root)) return 'skip'
  const current = effectiveNode(root)
  const parent = current.parent
  if (!parent) return 'sentence'

  for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
    if (
      ancestor.type === 'TSLiteralType' ||
      ancestor.type === 'TSImportType' ||
      ancestor.type === 'TSExternalModuleReference'
    ) {
      return 'skip'
    }
    if (ancestor.type.endsWith('Statement') || ancestor.type === 'Program') break
  }
  if (parent.type.startsWith('TS') && parent.key === current) return 'skip'
  if (parent.type === 'TSEnumMember' && parent.id === current) return 'skip'
  if (parent.type === 'TSModuleDeclaration' && parent.id === current) return 'skip'

  switch (parent.type) {
    case 'ImportExpression':
    case 'ImportDeclaration':
    case 'ExportAllDeclaration':
    case 'ExportNamedDeclaration':
    case 'ImportAttribute':
    case 'SwitchCase':
    case 'ExpressionStatement':
      return 'skip'

    case 'ThrowStatement':
      return 'sink'

    case 'ReturnStatement':
    case 'ArrowFunctionExpression': {
      if (parent.type === 'ArrowFunctionExpression' && parent.body !== current) return 'skip'
      const fn = parent.type === 'ReturnStatement' ? enclosingFunction(parent) : parent
      return fn !== null && isTextFunctionName(functionName(fn)) ? 'text' : 'sentence'
    }

    case 'Property': {
      if (parent.key === current) return 'skip'
      const name = keyName(parent)
      // A CSS custom property (`'--warning-text': 'oklch(…)'`) holds a style value.
      if (name?.startsWith('--')) return 'skip'
      if (isTextName(name) || name === 'choices') return 'text'
      if (name === 'name' && isPromptChoice(parent.parent)) return 'text'
      const object = parent.parent
      if (isCatalogCall(object.parent) && object.parent.arguments.includes(object)) return 'text'
      if (isInTextContainer(object)) return 'text'
      return name !== null && (HTTP_HEADER_NAME.test(name) || name.startsWith('--'))
        ? 'skip'
        : 'sentence'
    }

    case 'PropertyDefinition':
      if (parent.key === current) return 'skip'
      return isTextName(keyName(parent)) ? 'text' : 'sentence'

    case 'MethodDefinition':
      return 'skip'

    case 'MemberExpression':
      return parent.property === current ? 'skip' : 'sentence'

    case 'BinaryExpression':
      return COMPARISON_OPERATORS.has(parent.operator) ? 'skip' : 'sentence'

    case 'AssignmentExpression': {
      if (parent.left === current) return 'skip'
      const target = parent.left
      const name =
        target.type === 'Identifier'
          ? target.name
          : target.type === 'MemberExpression' && !target.computed
            ? target.property.name
            : null
      return TEXT_ASSIGNMENT_TARGETS.has(name) || isTextName(name) ? 'text' : 'sentence'
    }

    case 'AssignmentPattern':
      if (parent.left === current) return 'skip'
      return parent.left.type === 'Identifier' && isTextName(parent.left.name) ? 'text' : 'sentence'

    case 'VariableDeclarator':
      return parent.id.type === 'Identifier' && isTextName(parent.id.name) ? 'text' : 'sentence'

    case 'JSXAttribute':
      return attributeTier(parent)

    case 'JSXExpressionContainer': {
      const container = parent.parent
      if (container?.type === 'JSXAttribute') return attributeTier(container)
      if (container?.type === 'JSXElement' || container?.type === 'JSXFragment') return 'text'
      return 'sentence'
    }

    case 'CallExpression':
    case 'NewExpression':
      return classifyArgument(parent, current, ctx)

    default:
      return 'sentence'
  }
}

/** A `prompts` choice: an object literal with both `name`/`title` and `value`. */
function isPromptChoice(object) {
  return (
    object?.type === 'ObjectExpression' &&
    object.properties.some(
      (property) => property.type === 'Property' && keyName(property) === 'value',
    )
  )
}

/** The tier of a call argument. */
function classifyArgument(call, argument, ctx) {
  if (call.callee === argument) return 'skip'
  const index = call.arguments.indexOf(argument)
  const callee = call.callee
  const name = calleeName(callee)
  const receiver = receiverName(callee)

  // Workspace commit messages: English by contract.
  if (callee.type === 'Identifier' && ctx.contractArguments.get(callee.name) === index)
    return 'skip'

  if (callee.type === 'Super') return isErrorSuperCall(call) && index === 0 ? 'sink' : 'sentence'
  if (name === null) return 'sentence'
  if (CATALOG_CALLS.has(name)) return 'skip'

  // Sinks: text a human reads directly.
  if (receiver !== null && SINK_RECEIVER.test(receiver)) return 'sink'
  if (name === 'write' && (receiver === 'stdout' || receiver === 'stderr')) {
    return index === 0 ? 'sink' : 'skip'
  }
  if (UI_SINK_CALLS.has(name) && callee.type === 'Identifier') return 'sink'
  if (name === 'error' && receiver !== null && COMMANDER_RECEIVER.test(receiver)) {
    return index === 0 ? 'sink' : 'skip'
  }
  // `new LockError(msg)` / `TypeError(msg)`: a class-shaped `…Error` takes its
  // message first. Lowercase `…Error(…)` helpers take whatever they declare.
  const messageIndex =
    MESSAGE_ARGUMENT.get(name) ?? (/^(?:[A-Z]\w*)?Error$/.test(name) ? 0 : undefined)
  if (messageIndex !== undefined) return index === messageIndex ? 'sink' : 'sentence'
  if (name === 'reject' && (callee.type === 'Identifier' || receiver === 'Promise')) {
    return index === 0 ? 'sink' : 'sentence'
  }
  if (name === 'Response' && call.type === 'NewExpression') return index === 0 ? 'sink' : 'skip'
  if (name === 'json' && receiver === 'Response') return index === 0 ? 'sink' : 'skip'
  if (name === 'emit' && index === 1) {
    const event = call.arguments[0]
    if (event?.type === 'Literal' && TEXT_EVENTS.has(String(event.value))) return 'sink'
  }

  // Commander.
  if (call.type === 'NewExpression' && COMMANDER_CONSTRUCTORS.has(name)) {
    return index === 1 ? 'text' : index === 0 ? 'spec' : 'sentence'
  }
  const commander = callee.type === 'MemberExpression' ? COMMANDER_ARGUMENTS.get(name) : undefined
  if (commander !== undefined) {
    if (commander.text.includes(index)) return 'text'
    if (commander.spec.includes(index)) return 'spec'
  }

  if (receiver !== null && PATH_MODULES.has(receiver)) return 'skip'
  if (name === 'join' && callee.type === 'MemberExpression') return 'separator'
  if (name === 'setAttribute' && index === 1) {
    const attribute = call.arguments[0]
    return attribute?.type === 'Literal' && isTextAttributeName(String(attribute.value))
      ? 'text'
      : 'skip'
  }
  const skipped = NON_TEXT_CALL_ARGUMENTS.get(name)
  if (skipped === 'all' || skipped?.includes(index)) return 'skip'
  return 'sentence'
}

// ─── Paths ──────────────────────────────────────────────────────────────────

/** Repo-relative POSIX path of the linted file, matching baseline keys. */
function relativeFile(filename, root) {
  const posix = filename.replace(/\\/g, '/')
  if (!path.isAbsolute(filename)) return posix
  return path.relative(root, filename).replace(/\\/g, '/')
}

/** A relative import specifier resolved to a repo-relative path without extension. */
function resolveImport(fromFile, source) {
  if (!source.startsWith('.')) return null
  return stripExtension(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), source)))
}

function stripExtension(file) {
  return file.replace(/\.(?:ts|tsx|js|jsx)$/, '')
}

/** Local callee name → commit-message argument index, for this file's contract calls. */
function contractArgumentsFor(program, file, contractCalls) {
  const result = new Map()
  for (const contract of contractCalls) {
    if (stripExtension(file) === stripExtension(contract.module)) {
      result.set(contract.name, contract.argument)
    }
  }
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue
    const resolved = resolveImport(file, String(statement.source.value))
    if (resolved === null) continue
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier') continue
      const imported =
        specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : specifier.imported.value
      for (const contract of contractCalls) {
        if (contract.name === imported && stripExtension(contract.module) === resolved) {
          result.set(specifier.local.name, contract.argument)
        }
      }
    }
  }
  return result
}

function truncate(text) {
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

// ─── Rule ───────────────────────────────────────────────────────────────────

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow untranslated human-readable text outside the message catalog',
    },
    messages: {
      untranslated:
        'Human-readable text must come from the message catalog: use t(\'<namespace>.<area>.<name>\') instead of "{{text}}". Add `// i18n-exempt: <reason>` only if this string is English by contract.',
      stale:
        'Stale entry in eslint-rules/untranslated-baseline.json for this file: "{{text}}" is baselined {{expected}}× but occurs {{actual}}×. Run `bun run scripts/untranslated-baseline.ts` to delete it — the baseline only shrinks.',
      collect: '{{key}}',
    },
    schema: [
      {
        type: 'object',
        properties: {
          root: { type: 'string' },
          include: { type: 'array', items: { type: 'string' } },
          exclude: { type: 'array', items: { type: 'string' } },
          contractCalls: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                argument: { type: 'integer', minimum: 0 },
                module: { type: 'string' },
              },
              required: ['name', 'argument', 'module'],
              additionalProperties: false,
            },
          },
          baseline: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              additionalProperties: { type: 'integer', minimum: 1 },
            },
          },
          collect: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] ?? {}
    const root = options.root ?? context.cwd
    const file = relativeFile(context.filename, root)
    const collect = options.collect === true
    const fileBaseline = (options.baseline ?? {})[file] ?? {}

    if (!isInScope(file, options.include, options.exclude)) {
      // An out-of-scope file can hold no debt: every entry for it is stale.
      const stale = Object.entries(fileBaseline)
      if (stale.length === 0) return {}
      return {
        Program(node) {
          for (const [text, expected] of stale) {
            context.report({
              node,
              messageId: 'stale',
              data: { text: truncate(text), expected: String(expected), actual: '0' },
            })
          }
        },
      }
    }

    const sourceCode = context.sourceCode
    const exemptLines = new Set()
    for (const comment of sourceCode.getAllComments()) {
      if (!EXEMPT_COMMENT.test(comment.value)) continue
      const line = sourceCode.lines[comment.loc.start.line - 1] ?? ''
      const before = line.slice(0, comment.loc.start.column)
      const after =
        comment.loc.end.line === comment.loc.start.line ? line.slice(comment.loc.end.column) : ''
      const ownLine = /^\s*\{?\s*$/.test(before) && /^\s*\}?\s*$/.test(after)
      if (!ownLine) {
        exemptLines.add(comment.loc.start.line)
        continue
      }
      // The next line of code: past a `}` closing a JSX comment, and past
      // the rest of a multi-line comment block.
      let next = sourceCode.getTokenAfter(comment, { includeComments: false })
      while (next && next.loc.start.line <= comment.loc.end.line) {
        next = sourceCode.getTokenAfter(next, { includeComments: false })
      }
      if (next) exemptLines.add(next.loc.start.line)
    }

    /** A text is exempt when any line it spans is. */
    function isExempt(node) {
      for (let line = node.loc.start.line; line <= node.loc.end.line; line += 1) {
        if (exemptLines.has(line)) return true
      }
      return false
    }

    const ctx = { contractArguments: new Map() }
    /** Every untranslated occurrence, in source order. */
    const found = []

    function judge(node) {
      if (foldRoot(node) !== node) return
      const facts = { strings: false, catalog: false }
      const folded = fold(node, facts)
      if (!facts.strings) return
      let tier = classifyPosition(node, ctx)
      if (tier === 'sentence' && facts.catalog) tier = 'text'
      if (!folded.variants.some((variant) => isUntranslated(variant, tier))) return
      if (isExempt(node)) return
      found.push({ node, key: folded.key.replace(/\s+/g, ' ').trim() })
    }

    return {
      Program(program) {
        ctx.contractArguments = contractArgumentsFor(
          program,
          file,
          options.contractCalls ?? DEFAULT_CONTRACT_CALLS,
        )
      },

      JSXText(node) {
        if (!/[A-Za-z]/.test(node.value) || isExempt(node)) return
        found.push({ node, key: node.value.replace(/\s+/g, ' ').trim() })
      },

      Literal(node) {
        if (typeof node.value === 'string') judge(node)
      },
      TemplateLiteral: judge,
      BinaryExpression(node) {
        if (node.operator === '+') judge(node)
      },
      CallExpression(node) {
        if (joinedArray(node) !== null) judge(node)
      },

      'Program:exit'(program) {
        const byKey = new Map()
        for (const occurrence of found) {
          const list = byKey.get(occurrence.key) ?? []
          list.push(occurrence)
          byKey.set(occurrence.key, list)
        }
        if (collect) {
          for (const [key, list] of byKey) {
            for (const { node } of list) {
              context.report({ node, messageId: 'collect', data: { key } })
            }
          }
          return
        }
        for (const [key, list] of byKey) {
          for (const { node } of list.slice(fileBaseline[key] ?? 0)) {
            context.report({ node, messageId: 'untranslated', data: { text: truncate(key) } })
          }
        }
        for (const [key, expected] of Object.entries(fileBaseline)) {
          const actual = byKey.get(key)?.length ?? 0
          if (actual >= expected) continue
          context.report({
            node: program,
            messageId: 'stale',
            data: { text: truncate(key), expected: String(expected), actual: String(actual) },
          })
        }
      },
    }
  },
}
