/**
 * `domain.card.*` — the card vocabulary's human text: why a card line could
 * not be read (the card-line grammar's diagnostics, worded by
 * `src/card/card-line-message.ts`), and why a label, tag, category, language,
 * note or set code was refused (`src/card/*`).
 *
 * A fragment of the domain namespace, registered by the CLI and **both** SPAs:
 * the editors validate tags, categories and notes as they are typed and show
 * the refusal under the field, and the admin shows a list's unreadable lines.
 * The same sentences reach the admin API, MCP and `--output json` as English
 * plus their key, and the CLI renders them in its own language.
 *
 * The card-line tokens these sentences quote — `[foil]`, `[NM]`, `[ja]`,
 * `(SET:CN)`, `#tag`, `{note}`, `&N` — and the label, tag and category values
 * are file-format vocabulary or user data. They stay exactly as written inside
 * every translation.
 */

import type { MessageCatalogShape } from '../../types'

export const domainCardMessages = {
  // ── Where a card-line diagnostic was found ────────────────────────────
  'domain.card.line.inFile': '{file}:{line}: {text}',
  'domain.card.line.atLine': 'line {line}: {text}',
  'domain.card.line.withHint': '{text} ({hint})',

  // ── Why a card line could not be read, or how it was read ─────────────
  'domain.card.line.blank': 'Blank line.',
  'domain.card.line.notACardLine': 'Not a card line: {line}',
  'domain.card.line.zeroQuantity': 'A card line must name at least one copy.',
  'domain.card.line.quantityExpandedCollection': {
    $plural: 'count',
    one: 'Read {count} copy: a collection holds one line per copy, so this line becomes {count} line on the next save.',
    other:
      'Read {count} copies: a collection holds one line per copy, so this line becomes {count} lines on the next save.',
  },
  'domain.card.line.quantityExpandedWanted': {
    $plural: 'count',
    one: 'Read {count} copy: a wanted list holds one line per copy, so this line becomes {count} line on the next save.',
    other:
      'Read {count} copies: a wanted list holds one line per copy, so this line becomes {count} lines on the next save.',
  },
  'domain.card.line.tokenNotAllowed': {
    $select: 'listType',
    deck: '{token} is not a deck token.',
    collection: '{token} is not a collection token.',
    wanted: '{token} is not a wanted list token.',
  },
  'domain.card.line.wantedCondition':
    '{token} is not a wanted list token — wanted lists never carry a condition.',
  'domain.card.line.wantedLabels':
    '{token} is not a wanted list token — wanted lists never carry labels.',
  'domain.card.line.duplicateToken': {
    $select: 'kind',
    quantity: 'Duplicate quantity token {token}.',
    printing: 'Duplicate printing token {token}.',
    finish: 'Duplicate finish token {token}.',
    condition: 'Duplicate condition token {token}.',
    language: 'Duplicate language token {token}.',
    labels: 'Duplicate labels token {token}.',
    tags: 'Duplicate tags token {token}.',
    note: 'Duplicate note token {token}.',
    id: 'Duplicate id token {token}.',
  },
  'domain.card.line.labelsExclusive':
    'Conflicting labels {token} — [{label}] cannot be combined with any other label.',
  'domain.card.line.labelsContradictory':
    'Conflicting labels {token} — [{label}] cannot be both set and negated.',
  'domain.card.line.unknownToken': 'Unrecognized token {token}.',
  'domain.card.line.malformedTag': 'Malformed tag token {token}: {rule}.',
  'domain.card.line.unclosedNote': 'Unclosed note: a {syntax} must end with a closing brace.',
  'domain.card.line.emptyName': 'No card name: {line}',
  'domain.card.line.unseparatedToken':
    "{token} runs into the text beside it: a card line's tokens are separated by whitespace.",
  'domain.card.line.misplacedToken':
    "{token} is inside the card name: a card line's tokens all follow the name.",
  'domain.card.line.missingPrinting': {
    $select: 'listType',
    deck: 'A deck line must name a printing, e.g. (LEA:161): {line}',
    collection: 'A collection line must name a printing, e.g. (LEA:161): {line}',
    wanted: 'A wanted list line must name a printing, e.g. (LEA:161): {line}',
  },
  'domain.card.line.exportFinishMarker': 'Read the export finish marker {token} as [{finish}].',
  'domain.card.line.exportPrinting': 'Read the export printing {token} as ({printing}).',
  'domain.card.line.exportPrintingFinish':
    'Read the export printing {token} as ({printing}) [{finish}].',
  'domain.card.line.suspectPrintingInName':
    "Card name still contains a printing token, so the line's format was not recognized: {line}",
  'domain.card.line.lineBreak': 'A card line cannot hold a line break: {text}',

  // ── The next step a refused card line suggests ────────────────────────
  'domain.card.line.hint.didYouMean': 'did you mean [{language}]?',
  'domain.card.line.hint.insertSpace': {
    $select: 'side',
    after: 'insert a space after {token}',
    before: 'insert a space before {token}',
  },
  'domain.card.line.hint.idLast': 'the &N id must be the last token on the line',
  'domain.card.line.hint.moveAfterName': 'move {token} after the name',

  // ── Card labels ───────────────────────────────────────────────────────
  'domain.card.label.notArray': '{field} must be an array of labels ({choices}).',
  'domain.card.label.notString': '{field} must be one of: {choices}.',
  'domain.card.label.invalid': "Invalid {field} '{value}'. Use one of: {choices}.",
  'domain.card.label.unsupported': {
    $select: 'listType',
    deck: 'labels [{labels}] are not supported on a deck; supported: {supported}.',
    collection: 'labels [{labels}] are not supported on a collection; supported: {supported}.',
    wanted: 'labels [{labels}] are not supported on a wanted list; supported: {supported}.',
  },
  'domain.card.label.notApplicable': {
    $select: 'listType',
    deck: 'labels do not apply to a deck.',
    collection: 'labels do not apply to a collection.',
    wanted: 'labels do not apply to a wanted list.',
  },
  'domain.card.label.frontMatterDropped':
    "Front matter 'labels' ignored: {reason} A rewrite would drop the key.",

  // ── Card tags ─────────────────────────────────────────────────────────
  'domain.card.tag.shapeRule':
    "a tag is non-empty plain text that cannot contain '#', ',', '&', '*', double quotes, brackets, braces or parentheses",
  'domain.card.tag.invalid': 'Invalid tag {value}: {rule}.',
  'domain.card.tag.notArray': '{field} must be an array of tags.',
  'domain.card.tag.noneGiven': 'No tags given.',

  // ── Card categories ───────────────────────────────────────────────────
  'domain.card.category.shapeRule':
    'a category is non-empty plain text that cannot contain a comma or a control character',
  'domain.card.category.invalid': 'Invalid category {value}: {rule}.',
  'domain.card.category.notArray': '{field} must be an array of categories.',

  // ── Card languages ────────────────────────────────────────────────────
  'domain.card.language.invalidField':
    'Invalid language {value} for "{field}". Valid languages: {languages}',

  // ── Notes and set codes ───────────────────────────────────────────────
  'domain.card.note.invalid':
    'Notes must be single-line text with no control characters (newlines, tabs, etc. are not allowed).',
  'domain.card.setCode.invalid': "Invalid set code '{value}'.",
} as const satisfies MessageCatalogShape
