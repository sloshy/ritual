/** Translator metadata for {@link domainImportMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { domainImportMessages } from './domain-import'

const CSV_CONTEXT =
  'Importing a CSV file (a spreadsheet export from another card tool) into one of the user’s Magic: The Gathering card lists. Shown in the CLI’s `ritual import`, on the admin Import CSV page, and to scripts and AI agents through the API.'

const MAPPING_CONTEXT = `${CSV_CONTEXT} The column mapping says which column of the file holds which card field; it is written like \`name=1,set=2,collector-number=3\`, where the field names (name, set, collector-number, condition, finish, language, tags, categories, section, quantity) are fixed syntax and stay untranslated.`

const ROW_CONTEXT = `${CSV_CONTEXT} One reason a single row of the file was not imported; several reasons for the same row are joined into one line.`

const FIELD_CONTEXT = `${CSV_CONTEXT} The name of one card field a column can be mapped to, shown beside the column picker ("Which column holds: {field}?"). Short, capitalized like a form label.`

const HEADERS_CONTEXT =
  'Never shown to anyone. A list of the column headings a CSV export written in your language uses for one card field, separated by "|" with no spaces around it and no empty entries, so the importer can pre-select that column and recognize a header row. Matching ignores case, spaces, hyphens and underscores. List every common spelling (singular, plural, abbreviated); the English spellings are always recognized as well, so do not repeat them. Never list a word that could also be a cell value — a finish word (foil, etched), a condition code (NM, LP), a language code (ja, de) or a bare number: a data row holding it would be mistaken for a header and its card skipped.'

const TEXT_CONTEXT =
  'A warning from reading a decklist or card-list text file being imported (or a list file Ritual reads), reported in the CLI, by the admin API, and in the admin pages that show what a list file contained.'

const URL_CONTEXT =
  'Importing a deck from a deck-building website by its URL. Archidekt, Moxfield and MTGGoldfish are those websites’ names.'

const HTTP_CONTEXT = `${URL_CONTEXT} The website answered an error instead of the data; {status} is the HTTP status code (a number) and {statusText} its standard English reason phrase as the server sent it (for example "Not Found").`

const ARCHIDEKT_CONTEXT =
  'Uploading a card collection to Archidekt (a card-collection website) as a CSV file during `ritual collection-sync`. Shown in the sync report, the CLI and the admin Sync Collection page.'

const RESPONSE_CONTEXT = `${ARCHIDEKT_CONTEXT} Why Archidekt’s reply to one uploaded chunk of the file could not be fully read; it is shown inside a longer sentence naming the chunk, so it starts lowercase and has no closing period.`

export const domainImportMeta = {
  'domain.import.csv.unterminatedQuote': {
    description: `${CSV_CONTEXT} The file could not be read: a field opened with a double quote that never closes. {line} is the 1-based line number where that field starts.`,
  },
  'domain.import.csv.collectionNeedsPrinting': {
    description: `${MAPPING_CONTEXT} Refusal: a collection records exact printings, so the mapping must name both a set column and a collector-number column.`,
  },
  'domain.import.csv.wantedNoCondition': {
    description: `${MAPPING_CONTEXT} Refusal: a wanted list has no card condition, so a condition column cannot be mapped for it.`,
  },
  'domain.import.csv.sameColumn': {
    description: `${MAPPING_CONTEXT} Refusal: two fields point at the same column. {first} and {second} are field names (untranslated syntax); {column} is the 1-based column number.`,
  },
  'domain.import.csv.invalidAssignment': {
    description: `${MAPPING_CONTEXT} Refusal: one part of the mapping is not written as field=column. {assignment} is that part as typed; "field=column" is the syntax and stays untranslated.`,
  },
  'domain.import.csv.unknownField': {
    description: `${MAPPING_CONTEXT} Refusal: the mapping names a field that does not exist. {field} is what was typed; {fields} is the comma-separated list of valid field names (untranslated syntax).`,
  },
  'domain.import.csv.fieldMappedTwice': {
    description: `${MAPPING_CONTEXT} Refusal: the mapping assigns the same field twice. {field} is the field name (untranslated syntax).`,
  },
  'domain.import.csv.invalidColumnNumber': {
    description: `${MAPPING_CONTEXT} Refusal: a column number is not a positive whole number. {value} is what was typed, {field} the field name (untranslated syntax). Columns are counted from 1.`,
  },
  'domain.import.csv.nameUnmapped': {
    description: `${MAPPING_CONTEXT} Refusal: the mapping has no column for the card name, which every import needs. "name" is the field name and stays untranslated.`,
  },
  'domain.import.csv.columnMissing': {
    description: `${MAPPING_CONTEXT} Refusal: a mapped column number is past the last column of the file. {column} is that 1-based column number, {field} the field name (untranslated syntax), and {count} how many columns the file actually has.`,
  },
  'domain.import.csv.field.name': { description: `${FIELD_CONTEXT} The card’s name.` },
  'domain.import.csv.field.set': {
    description: `${FIELD_CONTEXT} The short code of the set (expansion) a card was printed in, such as "MKM".`,
  },
  'domain.import.csv.field.collectorNumber': {
    description: `${FIELD_CONTEXT} The number printed on a card that identifies it within its set.`,
  },
  'domain.import.csv.field.condition': {
    description: `${FIELD_CONTEXT} The physical condition of a card (near mint, played, …).`,
  },
  'domain.import.csv.field.finish': {
    description: `${FIELD_CONTEXT} Whether a card is foil, etched or non-foil.`,
  },
  'domain.import.csv.field.language': {
    description: `${FIELD_CONTEXT} The language a card was printed in.`,
  },
  'domain.import.csv.field.tags': {
    description: `${FIELD_CONTEXT} Free-form labels the owner attaches to a card.`,
  },
  'domain.import.csv.field.categories': {
    description: `${FIELD_CONTEXT} A card’s roles in a deck (Ramp, Card Draw, …).`,
  },
  'domain.import.csv.field.section': {
    description: `${FIELD_CONTEXT} The part of the list a card belongs in, such as a deck’s Sideboard.`,
  },
  'domain.import.csv.field.quantity': {
    description: `${FIELD_CONTEXT} How many copies of the card.`,
  },
  'domain.import.csv.headers.name': {
    description: `${HEADERS_CONTEXT} This field: the card’s name.`,
  },
  'domain.import.csv.headers.set': {
    description: `${HEADERS_CONTEXT} This field: the set (expansion) code or set name.`,
  },
  'domain.import.csv.headers.collectorNumber': {
    description: `${HEADERS_CONTEXT} This field: the collector number printed on the card.`,
  },
  'domain.import.csv.headers.condition': {
    description: `${HEADERS_CONTEXT} This field: the card’s physical condition.`,
  },
  'domain.import.csv.headers.finish': {
    description: `${HEADERS_CONTEXT} This field: whether the card is foil or etched.`,
  },
  'domain.import.csv.headers.language': {
    description: `${HEADERS_CONTEXT} This field: the language the card was printed in.`,
  },
  'domain.import.csv.headers.tags': {
    description: `${HEADERS_CONTEXT} This field: free-form tags.`,
  },
  'domain.import.csv.headers.categories': {
    description: `${HEADERS_CONTEXT} This field: the card’s categories (deck roles).`,
  },
  'domain.import.csv.headers.section': {
    description: `${HEADERS_CONTEXT} This field: the section or board (main deck, sideboard, …).`,
  },
  'domain.import.csv.headers.quantity': {
    description: `${HEADERS_CONTEXT} This field: how many copies.`,
  },
  'domain.import.csv.missingName': {
    description: `${ROW_CONTEXT} The row’s card-name cell is empty.`,
  },
  'domain.import.csv.lineBreak': {
    description: `${ROW_CONTEXT} One of these cells spans several lines, which a card line cannot hold.`,
  },
  'domain.import.csv.missingSet': {
    description: `${ROW_CONTEXT} The row has no set code, which a collection requires.`,
  },
  'domain.import.csv.missingCollectorNumber': {
    description: `${ROW_CONTEXT} The row has no collector number, which a collection requires.`,
  },
  'domain.import.csv.unknownCondition': {
    description: `${ROW_CONTEXT} The condition cell is not a condition Ritual knows. {value} is the cell as written.`,
  },
  'domain.import.csv.unknownFinish': {
    description: `${ROW_CONTEXT} The finish cell is not foil, etched or non-foil. {value} is the cell as written.`,
  },
  'domain.import.csv.unknownLanguage': {
    description: `${ROW_CONTEXT} The language cell is not a card language Ritual knows. {value} is the cell as written.`,
  },
  'domain.import.csv.invalidQuantity': {
    description: `${ROW_CONTEXT} The quantity cell is not a whole number. {value} is the cell as written.`,
  },
  'domain.import.csv.quantityTooSmall': {
    description: `${ROW_CONTEXT} The quantity cell is zero. {value} is the cell as written.`,
  },
  'domain.import.csv.rowUnexplained': {
    description: `${CSV_CONTEXT} An internal error: a row was rejected but no reason was recorded, which should never happen. {line} is the row's 1-based line number in the file.`,
  },
  'domain.import.moxfieldFailed': {
    description:
      'Console log prefix written just before the raw error when importing a deck from Moxfield (a deck-building website) failed; the error itself follows on the same line. Shown in the CLI and in the admin or MCP server’s log. "Lib" is short for library — the part of Ritual that reads Moxfield decks.',
  },
  'domain.import.archidektUnnamedEntries': {
    description:
      'Console warning while reading a deck from Archidekt (a deck-building website): some of its card entries carried no card name and were left out. Shown in the CLI and in the admin or MCP server’s log. {deckId} is the deck’s number on Archidekt; {count} how many entries were skipped.',
  },
  'domain.import.csv.rowNotice': {
    description: `${CSV_CONTEXT} A note about a row that DID import. {line} is the row’s 1-based line number in the file, {notice} one of the "ignored category …" / "category … names a board …" clauses (lowercase), and {card} the card’s name.`,
  },
  'domain.import.csv.categoryIgnored': {
    description: `${CSV_CONTEXT} A clause inside "Line {line}: {notice} on …": one value of the row’s categories cell was dropped because it is not a valid category. {value} is that value in double quotes, written as code. Starts lowercase.`,
  },
  'domain.import.csv.categoryIsBoard': {
    description: `${CSV_CONTEXT} A clause inside "Line {line}: {notice} on …": a value of the row’s categories cell names a deck board (such as Sideboard), so it set the row’s section instead of being kept as a category. {value} is that value in double quotes; {section} is the section the row landed in (a deck board name, untranslated). Starts lowercase.`,
  },
  'domain.import.fileExists': {
    description:
      'An import was asked to create a new list file, but the file is already there. {path} is the file’s path. "overwrite" and "append" are the names of the other two import modes.',
  },
  'domain.import.nameTaken': {
    description:
      'An import was asked to create a new list, but its name matches an existing list. {reason} is the full sentence naming that list; this adds what to do instead. "overwrite" and "append" are the names of the other two import modes.',
  },
  'domain.import.deckNeedsFormat': {
    description:
      'Refusal: a CSV import that creates a deck must say which game format (Commander, Modern, …) the deck is.',
  },
  'domain.import.categoriesForMissingCards': {
    description:
      'A note after an import: the list’s categories file (a card’s roles in a deck) still names cards the list no longer holds. {count} is how many cards; {names} is their names, already joined into a list.',
  },
  'domain.import.categoriesPruned': {
    description:
      'A note after an import that replaced a list: the categories (a card’s roles in a deck) of cards no longer in it were removed. {count} is how many cards; {names} is their names, already joined into a list.',
  },
  'domain.import.categoriesRefused': {
    description:
      'A note after importing a deck from a website: some of the deck’s category names (a card’s roles in a deck) could not be kept. The parenthesis states the rule a category name must follow. {names} is the refused names, each in double quotes, already joined into a list.',
  },
  'domain.import.categoriesNotSaved': {
    description:
      'A note after importing a deck: the deck was saved, but the file holding its categories (a card’s roles in a deck) could not be written. {error} is why, already worded.',
  },
  'domain.import.fileNotFound': {
    description:
      'A list or decklist file to read does not exist. {path} is the path that was given.',
  },
  'domain.import.text.labelsUnsupported': {
    description: `${TEXT_CONTEXT} A card line carries labels the destination list type cannot hold, so the card was kept without them. Branch on the list type ("deck", "collection" or "wanted" — a wanted list is a list of cards the user is looking for). {labels} is the comma-separated label names (untranslated syntax), {card} the card’s name, and {line} the whole line as written in the file.`,
  },
  'domain.import.text.imageIgnored': {
    description: `${TEXT_CONTEXT} The file’s front matter (its settings block at the top) has an \`image\` setting — the list’s cover picture — that cannot be read, so it was ignored. {reason} is why, a sentence of its own. "image" is the setting’s name and stays untranslated.`,
  },
  'domain.import.text.extraTitle': {
    description: `${TEXT_CONTEXT} A second "# Title" line was skipped; only the first names the list. {line} is the skipped line as written.`,
  },
  'domain.import.text.malformedLine': {
    description: `${TEXT_CONTEXT} A line that is neither a card nor a heading was skipped. {line} is the line as written.`,
  },
  'domain.import.text.malformedLineLanguage': {
    description: `${TEXT_CONTEXT} A line that is neither a card nor a heading was skipped; it carries a bracketed card-language token in a spelling the format does not accept ([JA], [jp], [Japanese]), so the accepted spelling is suggested. {line} is the line as written; {language} is the accepted language code (e.g. ja) — keep the square brackets around it.`,
  },
  'domain.import.text.aboutLineSkipped': {
    description: `${TEXT_CONTEXT} A line of an MTG Arena export’s "About" block (deck details) was not read. "About" is the block’s literal heading in the file. {line} is the line as written.`,
  },
  'domain.import.text.emptySectionDropped': {
    description: `${TEXT_CONTEXT} A deck section with no cards (such as an empty Maybeboard) was left out. {section} is the section’s name as written in the file.`,
  },
  'domain.import.url.unsupported': {
    description: `${URL_CONTEXT} Refusal: the URL is not one of those three websites’ deck pages.`,
  },
  'domain.import.url.moxfieldUserAgent': {
    description: `${URL_CONTEXT} Refusal: Moxfield only answers programs that identify themselves with a user-agent string Moxfield approved. MOXFIELD_USER_AGENT (an environment variable) and --moxfield-user-agent <agent> (a command-line option) are literal and stay untranslated.`,
  },
  'domain.import.url.fetchingArchidekt': {
    description: `${URL_CONTEXT} Progress line while the deck downloads. {id} is the deck’s number on Archidekt.`,
  },
  'domain.import.url.fetchingMoxfield': {
    description: `${URL_CONTEXT} Progress line while the deck downloads. {id} is the deck’s id on Moxfield.`,
  },
  'domain.import.url.fetchingMtgGoldfish': {
    description: `${URL_CONTEXT} Progress line while the deck downloads.`,
  },
  'domain.import.url.mtgGoldfishPageFailed': {
    description: `${HTTP_CONTEXT} This was the deck’s web page.`,
  },
  'domain.import.url.mtgGoldfishListFailed': {
    description: `${HTTP_CONTEXT} This was the deck’s downloadable card list.`,
  },
  'domain.import.url.mtgGoldfishNoDownloadLink': {
    description: `${URL_CONTEXT} The deck’s page on MTGGoldfish has no link to download its card list, so the deck cannot be read.`,
  },
  'domain.import.url.moxfieldDeckFailed': {
    description: `${HTTP_CONTEXT} This was the deck itself.`,
  },
  'domain.import.url.moxfieldPrimerFailed': {
    description: `${HTTP_CONTEXT} This was the deck’s primer (the author’s write-up about the deck).`,
  },
  'domain.import.archidekt.unknownCondition': {
    description: `${ARCHIDEKT_CONTEXT} Archidekt described a card with a condition number Ritual does not know. {id} is that number; {expected} the comma-separated numbers Ritual does know.`,
  },
  'domain.import.archidekt.unknownModifier': {
    description: `${ARCHIDEKT_CONTEXT} Archidekt described a card with a finish ("modifier") Ritual does not know. {modifier} is the value Archidekt sent; {expected} the comma-separated values Ritual knows (Archidekt’s own words, untranslated).`,
  },
  'domain.import.archidekt.csvNoColumns': {
    description: `${ARCHIDEKT_CONTEXT} Refusal: the upload was set up with no columns at all.`,
  },
  'domain.import.archidekt.csvTooManyColumns': {
    description: `${ARCHIDEKT_CONTEXT} Refusal: Archidekt accepts at most {max} columns per upload; this one had {count}.`,
  },
  'domain.import.archidekt.csvNoPrintingColumns': {
    description: `${ARCHIDEKT_CONTEXT} Refusal: the upload’s columns cannot identify a card printing. The quoted names are Archidekt’s column names and stay untranslated; {columns} is the comma-separated columns the upload had.`,
  },
  'domain.import.archidekt.responseNotJson': {
    description: `${RESPONSE_CONTEXT} The reply was not JSON (a data format) at all.`,
  },
  'domain.import.archidekt.responseNoData': {
    description: `${RESPONSE_CONTEXT} The reply had no "data" list of per-row results. "data" is the field’s literal name.`,
  },
  'domain.import.archidekt.rowsNotObjects': {
    description: `${RESPONSE_CONTEXT} {malformed} of the {total} per-row results in the reply’s "data" list were not readable records. "data" is the field’s literal name.`,
  },
  'domain.import.archidekt.rowCountMismatch': {
    description: `${RESPONSE_CONTEXT} The reply held {reported} per-row results, but {uploaded} rows were sent.`,
  },
} satisfies MetaFor<typeof domainImportMessages>
