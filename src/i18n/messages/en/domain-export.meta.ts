/** Translator metadata for {@link domainExportMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { domainExportMessages } from './domain-export'

const EXPORT =
  'Ritual can export the cards of a user\'s Magic: The Gathering lists (decks, collections, wanted lists) as a CSV spreadsheet, JSON, a plain-text decklist or Markdown, choosing which properties ("columns") to include.'

const COLUMN = `${EXPORT} A column label, shown in the command-line export wizard while the user picks which columns to export and in what order, and in its summary lines. Title case, short. Only the picker shows this: the file itself keeps its English header.`

const REFUSAL = `${EXPORT} Refuses a value the user gave on the command line (\`--columns\`, \`--condition\`, \`--labels\`), in an API request, or saved in a preset. Shown on its own.`

const COLUMN_IDS =
  '{columns} is the list of column ids the user may type (for example "name, quantity, set, collectorNumber"), already joined; never translate the ids.'

const VALUE = '{value} is the value as the user typed it.'

const PRESET = `${EXPORT} A "preset" is a named, saved export configuration, kept under the "exportPresets" key of the settings file ritual.config.json. This refuses one preset. {preset} is its location in that file, like exportPresets["trade-sheet"]; keep it and the property name after it (.format, .columns, .dialect) exactly as they are. Starts with the location and has no closing period: it may follow a prefix such as "ritual.config.json: ignoring invalid exportPresets — ".`

const WARNING = `${EXPORT} A warning printed beside a finished export (on the command line, or in the export's API response): the export still ran.`

const CACHE = `${WARNING} The "Scryfall cache" is the user's local copy of card data downloaded from Scryfall (a card database website). {name} is a card name; never translate it.`

const ID_UPLOAD =
  'Also logged by "ritual collection-sync push" (and the admin Sync Collection page) when it builds the CSV file it uploads to Archidekt, a collection-tracking website: that file identifies each card by its Scryfall ID, so a card without one cannot be uploaded that way.'

const FILE_NAME = `${EXPORT} An export can be written by the server to a file under an "exports" folder whose name the server picks. This is an internal error refusing that write.`

export const domainExportMeta = {
  'domain.export.column.name': { description: `${COLUMN} The card's name.` },
  'domain.export.column.quantity': { description: `${COLUMN} How many copies.` },
  'domain.export.column.set': {
    description: `${COLUMN} The code of the card's set (a Magic product release), like "LEA".`,
  },
  'domain.export.column.collectorNumber': {
    description: `${COLUMN} The collector number printed on the card, identifying it within its set.`,
  },
  'domain.export.column.edition': {
    description: `${COLUMN} The set code and collector number together, like "LEA:161".`,
  },
  'domain.export.column.scryfallId': {
    description: `${COLUMN} The printing's ID on Scryfall (a card database website). "Scryfall" is a brand name.`,
  },
  'domain.export.column.edhrecRank': {
    description: `${COLUMN} The card's popularity rank on EDHREC (a website ranking cards for the Commander format). "EDHREC" is a brand name.`,
  },
  'domain.export.column.finish': {
    description: `${COLUMN} The card's finish: nonfoil, foil or etched.`,
  },
  'domain.export.column.isFoil': {
    description: `${COLUMN} A true/false column: whether the card is foil (shiny) or etched.`,
  },
  'domain.export.column.condition': {
    description: `${COLUMN} The physical card's wear grade (NM, LP, MP, HP, DMG).`,
  },
  'domain.export.column.language': {
    description: `${COLUMN} The language the card is printed in.`,
  },
  'domain.export.column.labels': {
    description: `${COLUMN} The card's labels: markers like "sale", "trade" or "keep" saying what the owner means to do with it.`,
  },
  'domain.export.column.tags': {
    description: `${COLUMN} The user's own free-text tags on the card.`,
  },
  'domain.export.column.categories': {
    description: `${COLUMN} The card's categories in its list: its roles in a deck, like "Ramp" or "Card Draw".`,
  },
  'domain.export.column.primaryCategory': {
    description: `${COLUMN} The first (main) of the card's categories.`,
  },
  'domain.export.column.note': { description: `${COLUMN} The user's free-text note on the card.` },
  'domain.export.column.section': {
    description: `${COLUMN} The section of the list the card is in (for a deck, a board such as "Sideboard").`,
  },
  'domain.export.column.listName': {
    description: `${COLUMN} The name of the list the card comes from.`,
  },
  'domain.export.column.listType': {
    description: `${COLUMN} Which kind of list the card comes from: deck, collection or wanted list.`,
  },
  'domain.export.column.variant': {
    description: `${COLUMN} The finish column as Archidekt (a deck-building website) names it in its own CSV format, chosen when exporting for Archidekt. Use Archidekt's own word if your language's version of the site has one.`,
  },

  'domain.export.problem.columnsEmpty': {
    description: `${REFUSAL} The column list was empty. ${COLUMN_IDS}`,
  },
  'domain.export.problem.columnUnknown': {
    description: `${REFUSAL} {column} (as typed) is not a column id. ${COLUMN_IDS}`,
  },
  'domain.export.problem.columnDuplicate': {
    description: `${REFUSAL} The column id {column} was given twice.`,
  },
  'domain.export.problem.conditionsEmpty': {
    description: `${REFUSAL} The condition filter list was empty. {values} is the list of accepted values (condition grades like NM, LP, and "none" for cards with no condition marked), already joined; never translate them.`,
  },
  'domain.export.problem.conditionInvalid': {
    description: `${REFUSAL} ${VALUE} {values} is the list of accepted condition values (grades like NM, LP, and "none"), already joined; never translate them.`,
  },
  'domain.export.problem.labelsEmpty': {
    description: `${REFUSAL} The label filter list was empty. {values} is the list of accepted label values (like sale, trade, keep, and "none" for unlabeled cards), already joined; never translate them.`,
  },
  'domain.export.problem.labelInvalid': {
    description: `${REFUSAL} ${VALUE} {values} is the list of accepted label values (like sale, trade, keep, and "none"), already joined; never translate them.`,
  },
  'domain.export.problem.presetsNotObject': {
    description: `${EXPORT} A "preset" is a named, saved export configuration. Refuses the "exportPresets" setting of the settings file ritual.config.json, which must be a JSON object whose keys are preset names. Keep "exportPresets" and its straight quotes as they are. Starts with the quoted key and has no closing period.`,
  },
  'domain.export.problem.presetNotObject': {
    description: `${PRESET} The preset is not a JSON object.`,
  },
  'domain.export.problem.presetFormatInvalid': {
    description: `${PRESET} Its "format" is not one of {formats}, the accepted format names (csv, json, text, md), already joined; never translate them.`,
  },
  'domain.export.problem.presetColumnsNotArray': {
    description: `${PRESET} Its "columns" is not a JSON array of column ids.`,
  },
  'domain.export.problem.presetColumnsInvalid': {
    description: `${PRESET} Its "columns" list was refused; {reason} is that refusal, a full sentence of its own (like "Unknown column 'price'. Available columns: …").`,
  },
  'domain.export.problem.presetFieldNotBoolean': {
    description: `${PRESET} {field} is the property name (header or quoteAll); never translate it. Its value must be JSON true or false.`,
  },
  'domain.export.problem.presetDialectInvalid': {
    description: `${PRESET} Its "dialect" (the vocabulary the export is written in) is not one of {dialects}, the accepted dialect names (ritual, archidekt, arena, moxfield), already joined; never translate them.`,
  },
  'domain.export.problem.fileNameExhausted': {
    description: `${FILE_NAME} Every candidate name was already taken. {count} is how many names were tried; {dir} is the folder's path.`,
  },
  'domain.export.problem.fileNameNotBasename': {
    description: `${FILE_NAME} The generated name {name} contained a folder separator, which would place the file outside the exports folder.`,
  },

  'domain.export.warning.inList': {
    description: `${WARNING} Also shown by "ritual diff", which compares two lists. {list} is the name of a list the export or diff read; {warning} is a full sentence about that list (a line its reader could not understand, or its categories file being unreadable). Only the order and the separator are yours to change.`,
  },
  'domain.export.warning.cardsUnmatched': {
    description: `${WARNING} The user asked to add cards by name search terms, and the terms {terms} (as typed) matched no card in any list.`,
  },
  'domain.export.warning.scryfallIdUnpinned': {
    description: `${CACHE} The export has a "Scryfall ID" column, but this card's list entry does not name a specific printing (a set and collector number), so there is no ID to look up; its cell is left empty.`,
  },
  'domain.export.warning.scryfallIdUncached': {
    description: `${CACHE} {printing} is the printing's set code and collector number, like "LEA:161". The export has a "Scryfall ID" column, but that printing is missing from the local cache; its cell is left empty. ${ID_UPLOAD}`,
  },
  'domain.export.warning.edhrecRankUncached': {
    description: `${CACHE} The export has an "EDHREC Rank" column (popularity on the EDHREC website), but the card is missing from the local cache; its cell is left empty.`,
  },
  'domain.export.warning.extrasOmitted': {
    description: `${WARNING} A plain-text decklist written for MTG Arena or Moxfield (two websites; "Arena" and "Moxfield" are brand names) has no place for a deck's "Maybeboard" (cards being considered) or "Tokens" sections, so their cards were left out. {sections} is the list of sections left out, each with its card count, already joined.`,
  },
  'domain.export.warning.sectionCount': {
    description: `${WARNING} One entry of the list of deck sections an export left out: {section} is the section's name as the deck file spells it (never translate it), {quantity} how many cards it held.`,
  },
  'domain.export.warning.categoriesUnwritable': {
    description: `${WARNING} A Moxfield decklist writes each card's categories (its roles in a deck, like "Ramp") as tags, but some could not be written. {categories} is the list of those category names, already joined; never translate them. "Moxfield" is a brand name; "#", "&" and "!" are literal characters.`,
  },
} as const satisfies MetaFor<typeof domainExportMessages>
