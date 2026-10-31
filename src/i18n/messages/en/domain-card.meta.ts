/** Translator metadata for {@link domainCardMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { domainCardMessages } from './domain-card'

const LINE_CONTEXT =
  "A list file (a deck, a collection or a wanted list) holds one card per line, written in Ritual's card-line format, e.g. '- 2 Sol Ring (LEA:270) [foil] [NM] [ja] #Ramp {a note} &4'. The bracketed and braced parts are tokens the program matches literally: never translate a token, a set code or a card name quoted in the message."

const DIAGNOSTIC_CONTEXT = `${LINE_CONTEXT} Why one card line could not be read, shown in the CLI, in the admin site and returned by the API, usually after a location such as 'decks/burn.md:12:'.`

const ADVISORY_CONTEXT = `${LINE_CONTEXT} A note about a card line that WAS read, but differently from how it was written.`

const TOKEN_PARAM =
  '{token} is the offending token exactly as written in the file, e.g. [NM] or &4.'

const LINE_PARAM = '{line} is the whole card line exactly as written in the file.'

const HINT_CONTEXT = `${LINE_CONTEXT} The suggested fix shown in parentheses after a refused card line's message ('Unrecognized token [jp]. (did you mean [ja]?)'). Starts lowercase and has no closing period.`

const LIST_TYPE_BRANCHES =
  'Branches on {listType}: deck, collection or wanted (a wanted list) — the kind of list file the line is in.'

const LABEL_CONTEXT =
  'Why a list\'s card labels were refused. Labels are a closed vocabulary of tokens — sale, trade, keep, proxy and their negations no-sale, no-trade, no-keep, no-proxy — written into list files; never translate them. {field} names the field that held the value, e.g. labels or "labels" — leave it as written. {choices} is the comma-separated list of accepted label tokens.'

const TAG_CONTEXT =
  'Tags are short plain-text words a user attaches to a card copy (e.g. Ramp, Card Draw), written into the list file after a # sign.'

const CATEGORY_CONTEXT =
  "Categories name a card's role in one list (e.g. Ramp, Removal, Board Wipes), stored in the list's .categories.json file."

const RULE_PARAM =
  '{rule} is the shape rule (domain.card.tag.shapeRule or domain.card.category.shapeRule), rendered separately; keep it after the colon.'

const FIELD_PARAM =
  '{field} names the JSON or request field that held the value, e.g. tags or "categories" — leave it as written, quotes included.'

const LANGUAGES_PARAM =
  '{languages} is the list of valid language codes (en, es, fr, …), already joined in the reader’s language; {value} is the refused value as JSON (quoted when it was text). Leave the codes and the value as they are.'

export const domainCardMeta = {
  'domain.card.line.inFile': {
    description: `${LINE_CONTEXT} A card-line diagnostic with its location, in the style of a compiler message. {file} is the list file's path, {line} the 1-based line number, {text} the diagnostic itself (rendered separately). Keep the file:line: shape.`,
  },
  'domain.card.line.atLine': {
    description: `${LINE_CONTEXT} A card-line diagnostic for pasted text, which has no file. {line} is the 1-based line number and {text} the diagnostic itself (rendered separately). 'line' is the word for a line of text.`,
  },
  'domain.card.line.withHint': {
    description: `${LINE_CONTEXT} A refused card line's message followed by the suggested fix in parentheses. {text} is the message and {hint} the fix (both rendered separately).`,
  },
  'domain.card.line.blank': {
    description: `${DIAGNOSTIC_CONTEXT} The line is empty.`,
  },
  'domain.card.line.notACardLine': {
    description: `${DIAGNOSTIC_CONTEXT} The line is a heading, a // comment, a code-fence or a --- rule rather than a card. ${LINE_PARAM}`,
  },
  'domain.card.line.zeroQuantity': {
    description: `${DIAGNOSTIC_CONTEXT} The line starts with a quantity of 0 copies.`,
  },
  'domain.card.line.quantityTooLarge': {
    description: `${DIAGNOSTIC_CONTEXT} The line starts with a quantity so large (more than about nine quadrillion copies) that it cannot be stored exactly. ${TOKEN_PARAM}`,
  },
  'domain.card.line.quantityExpandedCollection': {
    description: `${ADVISORY_CONTEXT} A collection holds one line per physical copy, so a line that names a quantity (e.g. '3 Sol Ring') is split into that many lines when the file is next saved. {count} is the number of copies (always 2 or more in practice).`,
  },
  'domain.card.line.quantityExpandedWanted': {
    description: `${ADVISORY_CONTEXT} A wanted list holds one line per wanted copy, so a line that names a quantity (e.g. '3 Sol Ring') is split into that many lines when the file is next saved. {count} is the number of copies (always 2 or more in practice).`,
  },
  'domain.card.line.tokenNotAllowed': {
    description: `${DIAGNOSTIC_CONTEXT} The token is well formed but this kind of list never carries it. ${TOKEN_PARAM} ${LIST_TYPE_BRANCHES}`,
  },
  'domain.card.line.wantedCondition': {
    description: `${DIAGNOSTIC_CONTEXT} A wanted list line carries a card condition token such as [NM]; wanted lists ask for a card rather than grading one. ${TOKEN_PARAM}`,
  },
  'domain.card.line.wantedLabels': {
    description: `${DIAGNOSTIC_CONTEXT} A wanted list line carries a labels token such as [sale]; labels describe cards the user owns. ${TOKEN_PARAM}`,
  },
  'domain.card.line.duplicateToken': {
    description: `${DIAGNOSTIC_CONTEXT} The same kind of token appears twice on one line. ${TOKEN_PARAM} Branches on {kind}, the kind of token: quantity, printing (the set and collector number), finish (foil, etched), condition (NM, LP…), language, labels, tags, note or id (the &N card id).`,
  },
  'domain.card.line.labelsExclusive': {
    description: `${DIAGNOSTIC_CONTEXT} A labels token combines a label that must stand alone (keep, proxy) with another label. ${TOKEN_PARAM} {label} is the label token that must stand alone; keep its square brackets.`,
  },
  'domain.card.line.labelsContradictory': {
    description: `${DIAGNOSTIC_CONTEXT} A labels token both sets a label and negates it (e.g. [proxy,no-proxy]). ${TOKEN_PARAM} {label} is that label token; keep its square brackets.`,
  },
  'domain.card.line.unknownToken': {
    description: `${DIAGNOSTIC_CONTEXT} A bracketed token names no known finish, condition, language or label. ${TOKEN_PARAM}`,
  },
  'domain.card.line.malformedTag': {
    description: `${DIAGNOSTIC_CONTEXT} A #tag token is empty or holds a character tags cannot contain. ${TOKEN_PARAM} ${RULE_PARAM}`,
  },
  'domain.card.line.unclosedNote': {
    description: `${DIAGNOSTIC_CONTEXT} A note opened with { is never closed with }. {syntax} is the literal note syntax {note}, shown as it is written in a file; leave it untranslated.`,
  },
  'domain.card.line.emptyName': {
    description: `${DIAGNOSTIC_CONTEXT} The line holds only tokens, with no card name left. ${LINE_PARAM}`,
  },
  'domain.card.line.unseparatedToken': {
    description: `${DIAGNOSTIC_CONTEXT} A token is written with no space between it and the text next to it (e.g. 'Sol Ring(LEA:270)'). ${TOKEN_PARAM}`,
  },
  'domain.card.line.misplacedToken': {
    description: `${DIAGNOSTIC_CONTEXT} A token sits inside the card name instead of after it (e.g. 'Sol Ring &4 [foil]'). ${TOKEN_PARAM}`,
  },
  'domain.card.line.missingPrinting': {
    description: `${DIAGNOSTIC_CONTEXT} The line names no printing (a set code and collector number in parentheses, like the literal example (LEA:161)), which this kind of list requires of every line. ${LINE_PARAM} ${LIST_TYPE_BRANCHES}`,
  },
  'domain.card.line.exportFinishMarker': {
    description: `${ADVISORY_CONTEXT} Another tool's export marks a foil or etched card with *F* or *E* at the end of the line; it was read as Ritual's finish token. {token} is the marker as written (e.g. *F*), {finish} the finish token it became (foil or etched); keep the square brackets around it.`,
  },
  'domain.card.line.exportPrinting': {
    description: `${ADVISORY_CONTEXT} Another tool's export writes the printing as '(SET) number'; it was read as Ritual's (SET:number) token. {token} is the text as written, e.g. '(M10) 146'; {printing} is the SET:number form it became, e.g. M10:146 — keep the parentheses around it.`,
  },
  'domain.card.line.exportPrintingFinish': {
    description: `${ADVISORY_CONTEXT} As domain.card.line.exportPrinting, for an export line that also marked the finish. {token} is the text as written, e.g. '(2XM) *F* 270'; {printing} is the SET:number form, e.g. 2XM:270 — keep its parentheses; {finish} is the finish token (foil or etched) — keep its square brackets.`,
  },
  'domain.card.line.suspectPrintingInName': {
    description: `${ADVISORY_CONTEXT} The card name still ends in something that looks like a set code in parentheses, so the line probably came from an export format the program does not recognize and the card name may be wrong. ${LINE_PARAM}`,
  },
  'domain.card.line.lineBreak': {
    description: `${LINE_CONTEXT} An internal safeguard: a card name, set code or collector number about to be written into a list file contains a line break, which would forge a second card line. {text} is that value as JSON (quoted).`,
  },
  'domain.card.line.unwritableQuantity': {
    description: `${LINE_CONTEXT} An internal safeguard: a card line was about to be written with a quantity no card line can hold — zero, negative, a fraction, or too large to store exactly. {quantity} is that value as the program holds it; {max} is the largest quantity allowed (9007199254740991).`,
  },
  'domain.card.line.hint.didYouMean': {
    description: `${HINT_CONTEXT} A bracketed token names a card language in a spelling the format does not accept ([JA], [jp], [Japanese]). {language} is the accepted language code (e.g. ja); keep the square brackets.`,
  },
  'domain.card.line.hint.insertSpace': {
    description: `${HINT_CONTEXT} A token touches the text beside it. {token} is that token as written. Branches on {side}: after (the space belongs after the token) or before (the space belongs before it).`,
  },
  'domain.card.line.hint.idLast': {
    description: `${HINT_CONTEXT} The &N card id was found inside the card name; it must be the line's final token. &N is literal syntax (an ampersand and a number); leave it untranslated.`,
  },
  'domain.card.line.hint.moveAfterName': {
    description: `${HINT_CONTEXT} A token was found inside the card name; it belongs after the name. {token} is that token as written.`,
  },
  'domain.card.label.notArray': {
    description: `${LABEL_CONTEXT} The value is not a list (array) at all.`,
  },
  'domain.card.label.notString': {
    description: `${LABEL_CONTEXT} An entry of the list is not text.`,
  },
  'domain.card.label.invalid': {
    description: `${LABEL_CONTEXT} An entry names no known label. {value} is that entry as written; keep the single quotes around it.`,
  },
  'domain.card.label.unsupported': {
    description: `${LABEL_CONTEXT} The labels are valid tokens but this kind of list does not carry them (a deck carries only proxy). {labels} is the comma-separated refused label tokens (keep the square brackets around them); {supported} the comma-separated tokens the list does carry. ${LIST_TYPE_BRANCHES} Today only the deck branch is ever shown (a collection carries every label and a wanted list none, which domain.card.label.notApplicable words); the other two keep the sentence whole should that change, so a short literal translation is enough.`,
  },
  'domain.card.label.notApplicable': {
    description: `${LABEL_CONTEXT} This kind of list carries no labels at all. ${LIST_TYPE_BRANCHES} Today only the wanted branch is ever shown (decks and collections carry labels); the other two keep the sentence whole should that change, so a short literal translation is enough.`,
  },
  'domain.card.label.frontMatterDropped': {
    description: `${LABEL_CONTEXT} A deck file's front matter (its YAML settings block at the top) holds a 'labels' default the deck cannot use, so it was ignored and the next save of the file deletes it. 'labels' is the literal key name. {reason} is why the value was refused — a complete sentence ending in a period, rendered separately.`,
  },
  'domain.card.tag.shapeRule': {
    description: `${TAG_CONTEXT} The rule a tag must follow, quoted after a colon inside refusals (domain.card.tag.invalid, domain.card.line.malformedTag). The quoted characters are literal. Starts lowercase and has no closing period.`,
  },
  'domain.card.tag.invalid': {
    description: `${TAG_CONTEXT} A tag was refused. {value} is the tag as given, as JSON (quoted). ${RULE_PARAM}`,
  },
  'domain.card.tag.notArray': {
    description: `${TAG_CONTEXT} A tags value in a request or a change file is not a list of text. ${FIELD_PARAM}`,
  },
  'domain.card.tag.noneGiven': {
    description: `${TAG_CONTEXT} A tag filter (e.g. 'export --tags' or 'sell --tags') was given no tags at all.`,
  },
  'domain.card.category.shapeRule': {
    description: `${CATEGORY_CONTEXT} The rule a category name must follow, quoted after a colon inside refusals (domain.card.category.invalid) and log lines. Starts lowercase and has no closing period.`,
  },
  'domain.card.category.invalid': {
    description: `${CATEGORY_CONTEXT} A category name was refused. {value} is the name as given, as JSON (quoted). ${RULE_PARAM}`,
  },
  'domain.card.category.notArray': {
    description: `${CATEGORY_CONTEXT} A categories value in a request, a change file or a .categories.json file is not a list of text. ${FIELD_PARAM}`,
  },
  'domain.card.language.invalidField': {
    description: `A card language value in a request field names no language Ritual knows. {field} is the request field, e.g. printings[0].language — leave it as written. ${LANGUAGES_PARAM}`,
  },
  'domain.card.note.invalid': {
    description:
      "A card's note (free text kept on its line in the list file) was refused because it holds a line break, a tab or another control character.",
  },
  'domain.card.setCode.invalid': {
    description:
      'A set code (the short code of a Magic set, e.g. MKM or 2XM) is not letters, digits and underscores. {value} is the code as typed; keep the single quotes around it.',
  },
} as const satisfies MetaFor<typeof domainCardMessages>
