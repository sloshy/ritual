/** Translator metadata for {@link domainChangesMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { domainChangesMessages } from './domain-changes'

const BUNDLE_CONTEXT =
  "Why a change bundle (the JSON file the public site exports from its edit mode) was refused, shown when importing it on the CLI, the admin Import Changes page and the editors' import dialog, and readable by agents. JSON field names in double quotes and the words deck, collection and wanted are the file's own vocabulary — leave them untranslated."

const LIST_CONTEXT =
  '{list} is the 1-based position of the entry in the bundle\'s "lists" array; keep the "List #{list}:" prefix shape so the reader can find the entry.'

const RECORD_CONTEXT =
  "Why one change or move in imported or saved change JSON was refused. {subject} names the record — e.g. 'List #2: Change #3', 'Move #1', 'Move #1 \"from\"', 'changes[0]' or 'The change' — and is rendered separately, so keep it as the sentence's subject. JSON field names in double quotes are the file's own vocabulary — leave them untranslated."

const FIELD_CONTEXT = '{field} is a JSON field name such as set or cardId — leave it untranslated.'

const VALUE_CONTEXT =
  '{value} is the offending input, shown as it appeared in the JSON (quoted when it is a string) — leave it untranslated.'

const ACTION_CONTEXT =
  '{action} is a change action token such as add, set-printing or rename-category — leave it untranslated.'

const SUBJECT_CONTEXT =
  'Names the record a change problem is about; it is the {subject} of the problem sentences (domain.changes.problem.*), so render it as a noun phrase that can begin a sentence.'

const UNMATCHED_CONTEXT =
  "One reason a save refused its changes, shown in the editors' save status and returned by the save API. Several reasons are joined by domain.sync.clauseJoin and closed by domain.changes.unmatched.summary. {changes} is a comma-separated list of quoted change descriptions, already translated."

export const domainChangesMeta = {
  'domain.changes.problem.jsonInvalid': {
    description: `${BUNDLE_CONTEXT} The text is not JSON at all. Also recorded for an unreadable line of a changelog's ritual-changes block.`,
  },
  'domain.changes.problem.jsonNotObject': {
    description: `${BUNDLE_CONTEXT} The text is JSON, but not a JSON object.`,
  },
  'domain.changes.problem.bundleFormatMissing': {
    description: `${BUNDLE_CONTEXT} The JSON lacks the bundle's format marker. {format} is the marker value (ritual-change-bundle) — leave it untranslated, quotes included.`,
  },
  'domain.changes.problem.bundleVersionUnsupported': {
    description: `${BUNDLE_CONTEXT} The bundle declares a version this Ritual cannot read. {version} is the declared version as written in the file.`,
  },
  'domain.changes.problem.bundleFieldInvalid': {
    description: `${BUNDLE_CONTEXT} A required top-level field is absent or of the wrong type. ${FIELD_CONTEXT}`,
  },
  'domain.changes.problem.bundleArrayInvalid': {
    description: `${BUNDLE_CONTEXT} A required top-level array (lists or moves) is absent or not an array. ${FIELD_CONTEXT}`,
  },
  'domain.changes.problem.bundleLineBreak': {
    description: `${BUNDLE_CONTEXT} A string in the bundle's moves holds a line break, which could forge lines in a list file. {path} is the JSON path of that string, such as moves[0].cardName — leave it untranslated.`,
  },
  'domain.changes.problem.bundleListNotObject': {
    description: `${BUNDLE_CONTEXT} An entry of the "lists" array is not a JSON object. ${LIST_CONTEXT}`,
  },
  'domain.changes.problem.bundleListKindInvalid': {
    description: `${BUNDLE_CONTEXT} An entry of the "lists" array names an unknown list kind. ${LIST_CONTEXT} {kind} is the value it named — leave it untranslated.`,
  },
  'domain.changes.problem.bundleListFieldInvalid': {
    description: `${BUNDLE_CONTEXT} An entry of the "lists" array lacks a required field (slug or name) or holds the wrong type. ${LIST_CONTEXT} ${FIELD_CONTEXT}`,
  },
  'domain.changes.problem.bundleListArrayInvalid': {
    description: `${BUNDLE_CONTEXT} An entry of the "lists" array lacks its "changes" array. ${LIST_CONTEXT} ${FIELD_CONTEXT}`,
  },
  'domain.changes.problem.bundleListFieldMalformed': {
    description: `${BUNDLE_CONTEXT} An optional field of a "lists" entry (baseContentHash) holds the wrong type. ${LIST_CONTEXT} ${FIELD_CONTEXT}`,
  },
  'domain.changes.problem.saveChangesNotArray': {
    description:
      'A list save request was refused because its "changes" field is not an array. Returned by the save API. "changes" is the JSON field name — leave it untranslated.',
  },
  'domain.changes.problem.saveTooMany': {
    description:
      'A list save request was refused because it carries more changes than one save may. {count} is the limit (it selects the plural form) and {received} is how many the request carried (always more than {count}). Returned by the save API.',
  },
  'domain.changes.problem.notObject': {
    description: `${RECORD_CONTEXT} The record is not a JSON object.`,
  },
  'domain.changes.problem.actionUnknown': {
    description: `${RECORD_CONTEXT} The change names an action Ritual does not know. {action} is the value it named — leave it untranslated.`,
  },
  'domain.changes.problem.fieldMissing': {
    description: `${RECORD_CONTEXT} The record lacks a field it must carry. ${FIELD_CONTEXT}`,
  },
  'domain.changes.problem.fieldInvalid': {
    description: `${RECORD_CONTEXT} A field of the record holds a value of the wrong type or shape. ${FIELD_CONTEXT}`,
  },
  'domain.changes.problem.lineBreak': {
    description: `${RECORD_CONTEXT} A string in the change holds a line break, which could forge lines in a list file. {path} is the JSON path of that string, such as change.to.name — leave it untranslated.`,
  },
  'domain.changes.problem.actionFieldMissing': {
    description: `${RECORD_CONTEXT} The change lacks the field its action requires. ${ACTION_CONTEXT} ${FIELD_CONTEXT}`,
  },
  'domain.changes.problem.categoryCardId': {
    description: `${RECORD_CONTEXT} A category change names a card line id, but category changes apply to every line of a card name. ${ACTION_CONTEXT}`,
  },
  'domain.changes.problem.listActionCardName': {
    description: `${RECORD_CONTEXT} A change to the list itself (a section or the category order) names a card. ${ACTION_CONTEXT}`,
  },
  'domain.changes.problem.printingHalf': {
    description: `${RECORD_CONTEXT} The record names only one of the two fields that identify a printing (set code and collector number).`,
  },
  'domain.changes.problem.valueUnknown': {
    description: `${RECORD_CONTEXT} A closed-vocabulary field holds a value outside it. One branch per field (language, finish, condition, board); {field} selects the branch. ${VALUE_CONTEXT}`,
  },
  'domain.changes.problem.listTypeInvalid': {
    description: `${RECORD_CONTEXT} A move's other list names an unknown list type. ${VALUE_CONTEXT}`,
  },
  'domain.changes.problem.listKindInvalid': {
    description: `${RECORD_CONTEXT} A bundle move's source or destination names an unknown list kind. ${VALUE_CONTEXT}`,
  },
  'domain.changes.problem.replacementCondition': {
    description: `${RECORD_CONTEXT} A move's replacement printing (the card the source list gets back) names a condition grade, which a replacement may not carry.`,
  },
  'domain.changes.problem.replacementPrintingMissing': {
    description: `${RECORD_CONTEXT} A move's replacement printing does not name both a set code and a collector number.`,
  },
  'domain.changes.problem.replacementUnpinned': {
    description: `${RECORD_CONTEXT} A move carries a replacement printing but pins no destination line for it to replace.`,
  },
  'domain.changes.problem.moveInChanges': {
    description: `${RECORD_CONTEXT} A list's own changes hold a move event, which a bundle records once in its top-level "moves" array instead. ${ACTION_CONTEXT}`,
  },
  'domain.changes.problem.moveSameList': {
    description: `${RECORD_CONTEXT} A bundle move names the same list as its source and its destination.`,
  },
  'domain.changes.problem.movePinWithoutTarget': {
    description: `${RECORD_CONTEXT} A bundle move pins a destination line but does not name the line the moved copy lands on.`,
  },
  'domain.changes.problem.moveReplacementUnpinned': {
    description: `${RECORD_CONTEXT} A bundle move carries a replacement printing without pinning a destination line, and only a pinning move may.`,
  },
  'domain.changes.problem.fieldRejected': {
    description: `${RECORD_CONTEXT} A label, tag or category field of the record broke its rules. {detail} is the rule's own refusal, worded elsewhere (for example: "tags" must be an array of tags.) and appended as it is after a colon.`,
  },
  'domain.changes.subject.change': {
    description: `${SUBJECT_CONTEXT} A single change whose position in its file is not known.`,
  },
  'domain.changes.subject.bundleChange': {
    description: `${SUBJECT_CONTEXT} A change in a change bundle: {list} is the 1-based position of its list in the bundle, {change} its 1-based position in that list's changes.`,
  },
  'domain.changes.subject.bundleMove': {
    description: `${SUBJECT_CONTEXT} A move in a change bundle: {move} is its 1-based position in the bundle's "moves" array.`,
  },
  'domain.changes.subject.saveChange': {
    description: `${SUBJECT_CONTEXT} An event in a list save request: {index} is its 0-based index in the request's "changes" array. The text is a JSON path — leave it as it is.`,
  },
  'domain.changes.subject.historyEvent': {
    description: `${SUBJECT_CONTEXT} An event in a change-history rewrite: {set} is the 1-based position of its change set, {event} its 1-based position within that set.`,
  },
  'domain.changes.subject.part': {
    description: `${SUBJECT_CONTEXT} A nested object of a record: {subject} is the record (rendered from another subject key) and {part} is the JSON field name of the nested object (from, to or replacement) — leave {part} untranslated, quotes included.`,
  },
  'domain.changes.unmatched.summary': {
    description:
      'Closes a save refusal: {reasons} is one or more reasons the changes did not apply (domain.changes.unmatched.*), already joined with domain.sync.clauseJoin. Nothing in the list was written.',
  },
  'domain.changes.unmatched.noTarget': {
    description: `${UNMATCHED_CONTEXT} {count} changes named a card the list does not hold. {list} names the list (domain.changes.unmatched.namedList). The closing remark tells the reader that card names are compared exactly.`,
  },
  'domain.changes.unmatched.notApplicable': {
    description: `${UNMATCHED_CONTEXT} {count} changes have an action that can never apply to this kind of list (setting a commander on a collection). {list} is the kind of list (domain.changes.unmatched.listOfType).`,
  },
  'domain.changes.unmatched.needsPrinting': {
    description: `${UNMATCHED_CONTEXT} {count} changes would set a foil or etched finish on a card that names no specific printing. The closing remark tells the reader how to fix it.`,
  },
  'domain.changes.unmatched.namedList': {
    description:
      "The list a save refusal is about, as the {list} of domain.changes.unmatched.noTarget. One branch per list type ({type} is deck, collection or wanted); {slug} is the list's file name and is never translated.",
  },
  'domain.changes.unmatched.listOfType': {
    description:
      'A kind of list, as the {list} of domain.changes.unmatched.notApplicable ("never apply to a collection list"). One branch per list type; {type} selects it.',
  },
  'domain.changes.unmatched.quotedChange': {
    description:
      "One change description inside a save refusal, quoted. {change} is the change, already described (domain.change.*). Use your language's quotation marks.",
  },
  'domain.changes.collectionPrinting.add': {
    description:
      "A change that would add a card to a collection was refused because it names no printing (set code and collector number), which every collection line needs. {name} is the card name and is never translated. Shown by the editors' save status and the CLI, and returned by the save API.",
  },
  'domain.changes.collectionPrinting.setPrinting': {
    description:
      "A change that would set a collection card's printing was refused because it names no set code and collector number. {name} is the card name and is never translated.",
  },
} satisfies MetaFor<typeof domainChangesMessages>
