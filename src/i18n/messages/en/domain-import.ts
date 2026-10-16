/**
 * `domain.import.*` — the text the importers (`src/importers/`) produce: the CSV
 * reader's refusals and per-row reasons, the column labels and header
 * spellings of its mapping wizard, the text-file parser's warnings, a URL
 * import's refusals and progress, and the Archidekt collection upload's
 * validation.
 *
 * A fragment of the domain namespace, registered by the CLI and the admin SPA.
 * The importers run under `ritual import`, the admin import routes and the MCP
 * import tools alike, so a message is built once as English plus its key: the
 * API and MCP read the English, the CLI renders the key in its own language,
 * and the admin Import CSV page renders it (and its column labels) in the
 * reader's. The public site never imports.
 *
 * Column-mapping field names (`name`, `collector-number`), `--columns` syntax,
 * flag and environment-variable names, Archidekt's CSV column names
 * (`oracleCard__name`), card names, list names, file paths and raw CSV cell
 * values are machine vocabulary or user data and stay as they are inside the
 * sentences that mention them.
 */

import type { MessageCatalogShape } from '../../types'

export const domainImportMessages = {
  // ── CSV: reading the file ─────────────────────────────────────────────
  'domain.import.csv.unterminatedQuote': 'Unterminated quoted field starting on line {line}',

  // ── CSV: the column mapping ───────────────────────────────────────────
  'domain.import.csv.collectionNeedsPrinting':
    'Collection imports require both a set and a collector-number column',
  'domain.import.csv.wantedNoCondition':
    'Wanted lists do not track condition; remove the condition column',
  'domain.import.csv.sameColumn':
    "Fields '{first}' and '{second}' are mapped to the same column {column}",
  'domain.import.csv.invalidAssignment':
    "Invalid column assignment '{assignment}': expected field=column",
  'domain.import.csv.unknownField': "Unknown field '{field}'. Valid fields: {fields}",
  'domain.import.csv.fieldMappedTwice': "Field '{field}' is mapped more than once",
  'domain.import.csv.invalidColumnNumber':
    "Invalid column number '{value}' for field '{field}': expected a 1-based column number",
  'domain.import.csv.nameUnmapped': "Missing required field 'name' in column mapping",
  'domain.import.csv.columnMissing': {
    $plural: 'count',
    one: "Column {column} (mapped to '{field}') does not exist: the file has {count} column",
    other: "Column {column} (mapped to '{field}') does not exist: the file has {count} columns",
  },

  // ── CSV: what each field is called ────────────────────────────────────
  'domain.import.csv.field.name': 'Card name',
  'domain.import.csv.field.set': 'Set code',
  'domain.import.csv.field.collectorNumber': 'Collector number',
  'domain.import.csv.field.condition': 'Condition',
  'domain.import.csv.field.finish': 'Finish',
  'domain.import.csv.field.language': 'Language',
  'domain.import.csv.field.tags': 'Tags',
  'domain.import.csv.field.categories': 'Categories',
  'domain.import.csv.field.section': 'Section',
  'domain.import.csv.field.quantity': 'Quantity',

  // ── CSV: header spellings the mapping wizard recognizes ───────────────
  //
  // Never shown. Each is a `|`-separated list of the column headings a CSV
  // export in the reader's language uses for one field; the wizard pre-selects
  // a column whose heading matches one. The English spellings are always
  // recognized as well, whatever the language.
  'domain.import.csv.headers.name': 'Name|Card name|Card',
  'domain.import.csv.headers.set': 'Set|Set code|Edition|Edition code',
  'domain.import.csv.headers.collectorNumber': 'Collector number|Card number|Number|No|CN',
  'domain.import.csv.headers.condition': 'Condition',
  'domain.import.csv.headers.finish': 'Finish|Foil|Printing',
  'domain.import.csv.headers.language': 'Language|Lang',
  'domain.import.csv.headers.tags': 'Tags|Tag',
  'domain.import.csv.headers.categories': 'Categories|Category',
  'domain.import.csv.headers.section': 'Section|Board',
  'domain.import.csv.headers.quantity': 'Quantity|Count|Qty|Amount',

  // ── CSV: why a row was not imported ───────────────────────────────────
  'domain.import.csv.missingName': 'Missing card name',
  'domain.import.csv.lineBreak': 'Line break inside the card name, set code, or collector number',
  'domain.import.csv.missingSet': 'Missing set code (required for collections)',
  'domain.import.csv.missingCollectorNumber': 'Missing collector number (required for collections)',
  'domain.import.csv.unknownCondition': "Unrecognized condition '{value}'",
  'domain.import.csv.unknownFinish': "Unrecognized finish '{value}'",
  'domain.import.csv.unknownLanguage': "Unrecognized language '{value}'",
  'domain.import.csv.invalidQuantity': "Invalid quantity '{value}'",
  'domain.import.csv.quantityTooSmall': "Invalid quantity '{value}': must be at least 1",
  'domain.import.csv.quantityTooLarge': "Invalid quantity '{value}': too large to store exactly",
  'domain.import.csv.rowUnexplained':
    'Row on line {line} was rejected without a reason; this is a bug in Ritual',

  // ── CSV: notices about a row that did import ──────────────────────────
  'domain.import.csv.rowNotice': 'Line {line}: {notice} on "{card}"',
  'domain.import.csv.categoryIgnored': 'ignored category {value}',
  'domain.import.csv.categoryIsBoard':
    "category {value} names a board — dropped from the categories, and the row's section is '{section}'",

  // ── Writing the imported list ─────────────────────────────────────────
  'domain.import.fileExists':
    'File already exists: {path}. Use overwrite or append mode to change it.',
  'domain.import.nameTaken': '{reason} Use overwrite or append mode to change it.',
  'domain.import.deckNeedsFormat': 'Creating a deck from CSV requires a format',
  'domain.import.categoriesForMissingCards': {
    $plural: 'count',
    one: 'Categories are recorded for a card the list does not hold: {names}',
    other: 'Categories are recorded for cards the list does not hold: {names}',
  },
  'domain.import.categoriesPruned': {
    $plural: 'count',
    one: 'Dropped categories for a card no longer in the list: {names}',
    other: 'Dropped categories for cards no longer in the list: {names}',
  },
  'domain.import.categoriesRefused':
    'Skipped categories Ritual cannot store (a category is non-empty plain text that cannot contain a comma or a control character): {names}',
  'domain.import.categoriesNotSaved':
    'The deck was imported, but its categories could not be saved: {error}',

  // ── Text files ────────────────────────────────────────────────────────
  'domain.import.fileNotFound': 'File not found: {path}',
  'domain.import.text.labelsUnsupported': {
    $select: 'listType',
    deck: "Labels [{labels}] on '{card}' are not supported on a deck. The labels were ignored, and a rewrite would drop them: {line}",
    collection:
      "Labels [{labels}] on '{card}' are not supported on a collection. The labels were ignored, and a rewrite would drop them: {line}",
    wanted:
      "Labels [{labels}] on '{card}' are not supported on a wanted list. The labels were ignored, and a rewrite would drop them: {line}",
  },
  'domain.import.text.imageIgnored':
    "Front matter 'image' ignored: {reason} A rewrite would drop the key.",
  'domain.import.text.extraTitle': 'Skipped extra title line: {line}',
  'domain.import.text.malformedLine': 'Skipped malformed line: {line}',
  'domain.import.text.malformedLineLanguage':
    'Skipped malformed line: {line} (did you mean [{language}]?)',
  'domain.import.text.aboutLineSkipped': 'Skipped About line: {line}',
  'domain.import.text.emptySectionDropped': 'Dropped empty section: {section}',

  // ── Deck services: console logs ───────────────────────────────────────
  'domain.import.moxfieldFailed': 'Moxfield Lib Error:',
  'domain.import.archidektUnnamedEntries': {
    $plural: 'count',
    one: 'Archidekt deck {deckId}: skipped {count} card entry with no card name.',
    other: 'Archidekt deck {deckId}: skipped {count} card entries with no card name.',
  },
  'domain.import.archidektUnwritableQuantity': {
    $plural: 'count',
    one: 'Archidekt deck {deckId}: skipped {count} card entry whose quantity no deck can hold (negative, a fraction, or too large).',
    other:
      'Archidekt deck {deckId}: skipped {count} card entries whose quantity no deck can hold (negative, a fraction, or too large).',
  },

  // ── Deck URLs ─────────────────────────────────────────────────────────
  'domain.import.url.unsupported':
    'URL not supported. Use Archidekt, Moxfield, or MTGGoldfish URLs.',
  'domain.import.url.moxfieldUserAgent':
    'Moxfield imports require a unique Moxfield-approved user agent string. Set MOXFIELD_USER_AGENT or pass --moxfield-user-agent <agent>. Contact Moxfield support if you need one.',
  'domain.import.url.fetchingArchidekt': 'Fetching deck ID {id} from Archidekt...',
  'domain.import.url.fetchingMoxfield': 'Fetching deck ID {id} from Moxfield...',
  'domain.import.url.fetchingMtgGoldfish': 'Fetching deck from MTGGoldfish...',
  'domain.import.url.mtgGoldfishPageFailed':
    'Failed to fetch MTGGoldfish page: {status} {statusText}',
  'domain.import.url.mtgGoldfishListFailed':
    'Failed to fetch deck list text: {status} {statusText}',
  'domain.import.url.mtgGoldfishNoDownloadLink':
    'Could not find deck download link on MTGGoldfish page',
  'domain.import.url.moxfieldDeckFailed': 'Failed to fetch Moxfield deck: {status} {statusText}',
  'domain.import.url.moxfieldPrimerFailed':
    'Failed to fetch Moxfield primer: {status} {statusText}',

  // ── Archidekt collection uploads ──────────────────────────────────────
  'domain.import.archidekt.unknownCondition':
    "Unknown Archidekt condition id '{id}'. Expected one of: {expected}.",
  'domain.import.archidekt.unknownModifier':
    "Unknown Archidekt modifier '{modifier}'. Expected one of: {expected}.",
  'domain.import.archidekt.csvNoColumns': 'A CSV upload needs at least one column.',
  'domain.import.archidekt.csvTooManyColumns':
    'A CSV upload takes at most {max} columns, got {count}.',
  'domain.import.archidekt.csvNoPrintingColumns':
    "A CSV upload's columns must include 'uid', or 'oracleCard__name' plus 'collectorNumber' plus 'edition__editionname' or 'edition__editioncode'; got: {columns}.",
  'domain.import.archidekt.responseNotJson': 'the response was not JSON',
  'domain.import.archidekt.responseNoData':
    'the response carried no "data" array of per-row results',
  'domain.import.archidekt.rowsNotObjects':
    '{malformed} of {total} row results in "data" were not objects',
  'domain.import.archidekt.rowCountMismatch':
    'the response reported {reported} row results for {uploaded} uploaded rows',
} as const satisfies MessageCatalogShape
