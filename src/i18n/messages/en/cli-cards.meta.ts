/** Translator metadata for {@link cliCardsMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { cliCardsMessages } from './cli-cards'

export const cliCardsMeta = {
  // ── Shared by every one-shot card command ─────────────────────────────
  'cli.cardOps.cancelled': {
    description: 'Shown when the user aborts an interactive picker with Esc or Ctrl-C.',
  },
  'cli.cardOps.pinNeedsBoth': {
    description:
      'Refusal when only one half of the --set/--collector-number printing pin was given. The flag names never translate.',
  },
  'cli.cardOps.wantedNoCondition': {
    description:
      'Refusal when --condition is used on a wanted list, which records no card condition.',
  },
  'cli.cardOps.labelsUnsupported': {
    description:
      'Refusal when --label names labels the list type does not carry. {labels} lists the offenders and {supported} the labels that type accepts (both are comma-joined machine slugs); the wanted branch has neither, since wanted entries carry no labels at all. One sentence per type: the noun is gendered in most languages.',
  },
  'cli.cardOps.cardIdPositive': {
    description:
      '--card-id rejected a non-positive or non-numeric value. {value} is what was typed.',
  },
  'cli.cardOps.quantityPositive': {
    description:
      '--quantity rejected a non-positive or non-numeric value. {value} is what was typed.',
  },
  'cli.cardOps.oneTypeFlag': {
    description: 'Refusal when more than one of the three list-type flags was passed.',
  },
  'cli.cardOps.noListFiles': {
    description:
      'The workspace holds no lists at all, so the interactive list picker has nothing to offer.',
  },
  'cli.cardOps.noListFilesOfType': {
    description:
      'The workspace holds no list of the requested type. One sentence per type: the noun is gendered in most languages.',
  },
  'cli.cardOps.promptSelectList': {
    description: 'Prompt heading for the interactive list picker.',
  },
  'cli.cardOps.listChoice': {
    description:
      'One row of the list picker: the list name, then its type. The dash is an em dash separator.',
  },
  'cli.cardOps.promptSelectCard': {
    description: 'Prompt heading for the interactive card picker.',
  },
  'cli.cardOps.cardChoiceWithNote': {
    description:
      "One row of the card picker for a card that carries a note. {entry} is the card's rendered description.",
  },
  'cli.cardOps.selectionOutOfRange': {
    description: 'Internal guard: the picker returned an index that no longer names a row.',
  },
  'cli.cardOps.typeLabel': {
    description:
      'A list type as the one-shot pickers display it. Sentence case, since it also appears mid-row; nothing case-folds it.',
  },
  'cli.cardOps.listEmpty': {
    description: 'The resolved list holds no cards, so there is nothing to target.',
  },
  'cli.cardOps.noCardWithId': {
    description: 'No card in {file} carries the requested &N id. {id} is that number.',
  },
  'cli.cardOps.noCardMatching': { description: 'No card in {file} matched the typed name.' },
  'cli.cardOps.ambiguousCard': {
    description:
      'The typed name matched several cards. {matches} is the pre-rendered, newline-separated list of candidates; keep it on its own line.',
  },
  'cli.cardOps.matchLine': {
    description:
      'One candidate row inside a multi-match refusal. The two leading spaces are the indent; keep them.',
  },
  'cli.cardOps.andMore': {
    description:
      'The tail of a truncated candidate list. The two leading spaces are the indent; keep them.',
  },
  'cli.cardOps.cardIdNameMismatch': {
    description:
      'The --card-id and the card name given alongside it name different cards. Ids are reused after a removal, so this refusal is what stops a stale id from mutating the wrong card.',
  },
  'cli.cardOps.noCachedPrintingList': {
    description:
      "Advice clause spliced into the two pin-verification refusals below. The 'ritual cache preload-all' command never translates.",
  },
  'cli.cardOps.verifyPrintingFailed': {
    description:
      'Scryfall could not be reached while verifying a pinned printing. {advice} is the cached-list advice above.',
  },
  'cli.cardOps.printingUnverified': {
    description: 'Scryfall returned no such printing. {advice} is the cached-list advice above.',
  },
  'cli.cardOps.printingIsOther': {
    description: 'The pinned printing exists but belongs to a different card than the one named.',
  },
  'cli.cardOps.printingLookupFailed': {
    description: "The local card cache could not be read. {reason} is the underlying error's text.",
  },
  'cli.cardOps.languageUnavailable': {
    description:
      'Refusal when a printing is known not to exist in the requested card language. {code} is the Scryfall language code, {available} a comma-joined list of language names.',
  },
  'cli.cardOps.noLanguageObject': {
    description: 'Scryfall confirmed the printing has no object in the requested card language.',
  },
  'cli.cardOps.finishCarriedOver': {
    description:
      "Wraps the finish refusal when the finish came from the entry rather than a flag. {reason} is the engine's own sentence.",
  },
  'cli.cardOps.dryRunLine': {
    description:
      'Marks a line as a dry-run preview. The bracketed marker is a machine-readable prefix and stays as-is.',
  },

  // ── Refused prompts ───────────────────────────────────────────────────
  'cli.prompt.subject.wantedAdd': {
    description:
      'Noun phrase for the refused wanted-list specificity prompt, interpolated into "Input required: … (…)". Not a sentence.',
  },
  'cli.prompt.subject.fullCardName': {
    description:
      'Noun phrase for the refused card picker, interpolated into "Input required: … (…)". Not a sentence.',
  },

  // ── add-card ──────────────────────────────────────────────────────────
  'cli.addCard.invalidCondition': {
    description:
      '--condition rejected a value. {choices} is the comma-joined grade list; NONE is a machine value.',
  },
  'cli.addCard.quantityPositive': { description: 'add-card --quantity rejected a value.' },
  'cli.addCard.collectorNumberEmpty': {
    description: 'add-card --collector-number was given an empty string.',
  },
  'cli.addCard.cacheUnavailable': {
    description:
      'Lead sentence of the empty-cache refusal; the shared advice about preloading is appended to it.',
  },
  'cli.addCard.loadedFromCache': {
    description: 'Progress line naming how many cards the local cache holds.',
  },
  'cli.addCard.wantedOnlyFlags': {
    description: 'Refusal when --name-only/--specific are used on a deck or collection.',
  },
  'cli.addCard.deckOnlyFlags': {
    description: 'Refusal when --section/--commander are used outside a deck.',
  },
  'cli.addCard.quantityDeckOnly': {
    description: 'Refusal when --quantity is used outside a deck, with the reason why.',
  },
  'cli.addCard.changelogNotAList': {
    description:
      'The named target is a .changes.md changelog file, which is never a list. The extension never translates.',
  },
  'cli.addCard.deckNotFound': {
    description:
      "A deck is never auto-created by add-card. The 'ritual new deck' command never translates.",
  },
  'cli.addCard.noExactMatch': {
    description:
      '--exact found no exact card name. {matches} is a pre-rendered sentence from cli.addCard.matchCount ("3 cards match that name."), which carries the verb because it has to agree with the count; the whole message reads "No exact match for \'X\'. 3 cards match that name."',
  },
  'cli.addCard.exactMatchFound': { description: 'Progress line confirming the --exact match.' },
  'cli.addCard.noCardsMatching': { description: 'No cached card name matched what was typed.' },
  'cli.addCard.foundMatching': {
    description: '{counted} is a pre-rendered counted noun ("12 cards"); {name} is what was typed.',
  },
  'cli.addCard.addedToDeck': {
    description:
      "Success line for a deck add. {card} is the quantity plus the card's name and printing; {section} is the deck section it landed in.",
  },
  'cli.addCard.addedLine': {
    description:
      'Success line for a collection or wanted add. {line} is the markdown card line exactly as written to the file.',
  },
  'cli.addCard.noPrintingSelected': {
    description: 'A collection add needs a concrete printing and could not resolve one.',
  },
  'cli.addCard.noPrintingResolved': {
    description: 'A specific wanted add needs a concrete printing and could not resolve one.',
  },
  'cli.addCard.promptSpecificity': {
    description: 'Prompt asking whether a wanted entry records a specific printing.',
  },
  'cli.addCard.specificityNameOnly': {
    description: 'Specificity choice: any copy of the card satisfies the want.',
  },
  'cli.addCard.specificityChoosePrinting': {
    description: 'Specificity choice: pick one exact printing.',
  },

  // ── remove-card ───────────────────────────────────────────────────────
  'cli.removeCard.quantityAllCopiesExclusive': {
    description: 'Refusal when both --quantity and --all-copies were passed.',
  },
  'cli.removeCard.allCopiesDeckOnly': {
    description:
      'Refusal when --all-copies is used outside a deck. Only the collection and wanted branches can be reached; a deck never refuses.',
  },
  'cli.removeCard.quantityDeckOnly': {
    description:
      'Refusal when --quantity > 1 is used outside a deck. Only the collection and wanted branches can be reached.',
  },
  'cli.removeCard.tooManyCopies': {
    description:
      "More copies were requested than the deck line holds. {available} is the line's quantity.",
  },
  'cli.removeCard.removed': {
    description:
      "Success line. {entry} is the card's rendered description, {remaining} how many copies the line keeps.",
  },

  // ── set-card ──────────────────────────────────────────────────────────
  'cli.setCard.invalidCondition': {
    description:
      '--condition rejected a value. {choices} is the comma-joined grade list; NONE is a machine value.',
  },
  'cli.setCard.labelWithNone': {
    description:
      "Wraps the label parser's refusal with set-card's extra escape hatch. 'none' is a machine value.",
  },
  'cli.setCard.languageFlagHint': {
    description:
      "Parenthetical appended to the --language refusal, reminding that 'en' clears the token. Kept in brackets.",
  },
  'cli.setCard.conditionCleared': {
    description:
      'One entry of the applied-changes list: the recorded grade was removed. The arrow is a separator.',
  },
  'cli.setCard.conditionDefault': {
    description:
      'One entry of the applied-changes list: NM is the unwritten default, so the line stays ungraded.',
  },
  'cli.setCard.conditionSet': {
    description: 'One entry of the applied-changes list. {condition} is a grade abbreviation.',
  },
  'cli.setCard.languageCleared': {
    description:
      'One entry of the applied-changes list: a bare line means English, so the token is removed.',
  },
  'cli.setCard.languageSet': {
    description:
      'One entry of the applied-changes list. {code} is the Scryfall language code, {language} its display name.',
  },
  'cli.setCard.finishCheckUnknownPrinting': {
    description:
      "Warning: the finish could not be checked because the entry's printing is not a known one.",
  },
  'cli.setCard.finishCheckCacheMiss': {
    description:
      "Warning: the finish could not be checked because the cache holds no printing list. The 'ritual cache preload-all' command never translates.",
  },
  'cli.setCard.noChangeGiven': {
    description: 'set-card was run with no mutating flag. The flag names never translate.',
  },
  'cli.setCard.artInvalid': {
    description:
      "Wraps the art-reference parser's refusal of a --art value with the escape hatch. 'none' is a machine value; {reason} is untranslated engine prose.",
  },
  'cli.setCard.artFileMissing': {
    description:
      "Refusal when --art names a file that is not in the art directory. {path} is the absolute path checked, {dir} the art directory. The 'ritual config set artDir' command never translates.",
  },
  'cli.setCard.artFileUnreadable': {
    description:
      'Refusal when the --art file exists but could not be examined. {reason} is the operating system error text.',
  },
  'cli.setCard.artNotAFile': {
    description: 'Refusal when the --art path resolves to a directory rather than an image file.',
  },
  'cli.setCard.artNeedsId': {
    description:
      "Refusal when --art targets a card line with no &N id to file the art under. '&N' is the file format's card-id token.",
  },
  'cli.setCard.artSidecarUnreadable': {
    description:
      "Refusal when the list's existing custom-art sidecar could not be read. {reason} is untranslated engine prose naming the file.",
  },
  'cli.setCard.appliedArt': {
    description:
      'One entry of the applied-changes list. {art} is the image path or URL now recorded for the card.',
  },
  'cli.setCard.artCleared': {
    description:
      "One entry of the applied-changes list: the card's custom art was removed, so its real art shows again.",
  },
  'cli.setCard.sectionDecksOnly': { description: 'Refusal when --section is used outside a deck.' },
  'cli.setCard.commanderDecksOnly': {
    description: 'Refusal when --commander/--no-commander are used outside a deck.',
  },
  'cli.setCard.languageUnverified': {
    description:
      'Warning: the language claim could not be verified, so it is recorded as asserted. {detail} is an optional ": reason" clause and may be empty.',
  },
  'cli.setCard.reasonSuffix': {
    description:
      'The optional ": reason" clause of the warning above. Keep it attached to the preceding word.',
  },
  'cli.setCard.appliedPrinting': {
    description: 'One entry of the applied-changes list. {printing} is SET:number.',
  },
  'cli.setCard.appliedFinish': {
    description: 'One entry of the applied-changes list. {finish} is a machine value.',
  },
  'cli.setCard.labelCleared': {
    description:
      "One entry of the applied-changes list: the card's label override was removed, so the list default applies.",
  },
  'cli.setCard.appliedLabel': {
    description: 'One entry of the applied-changes list. {labels} is a comma-joined slug list.',
  },
  'cli.setCard.appliedSection': { description: 'One entry of the applied-changes list.' },
  'cli.setCard.appliedCommander': {
    description: 'One entry of the applied-changes list: the card became the commander.',
  },
  'cli.setCard.appliedNotCommander': {
    description: 'One entry of the applied-changes list: the card stopped being the commander.',
  },
  'cli.setCard.updated': {
    description: 'Success line. {changes} is the comma-joined list of applied changes.',
  },

  // ── note ──────────────────────────────────────────────────────────────
  'cli.note.set': {
    description:
      "Success line for setting a note. {id} is the card's ' &N' suffix and may be empty; keep it attached to the name.",
  },
  'cli.note.nothingToClear': {
    description: 'Idempotent no-op: --clear ran against a card that has no note.',
  },
  'cli.note.cleared': { description: 'Success line for clearing a note.' },
  'cli.note.promptReplace': {
    description: 'Prompt for new note text when the card already carries one.',
  },
  'cli.note.promptText': { description: 'Prompt for note text when the card has none.' },
  'cli.note.emptyNote': {
    description: 'Refusal: an empty note is not how a note is removed. --clear never translates.',
  },

  // ── set-list-image ────────────────────────────────────────────────────
  'cli.setListImage.set': {
    description:
      "Success line for set-list-image. {type} is a capitalized list-type word ('Deck', 'Collection', 'Wanted list') and opens the sentence, {list} is the list's file name. {value} is the card's '&N' id, an art path, or a URL — never translated.",
  },
  'cli.setListImage.setPreview': {
    description: 'The --dry-run form of cli.setListImage.set; same parameters.',
  },
  'cli.setListImage.cleared': {
    description:
      "Success line for --default, which removes the front-matter key. {type} is a list-type word, {list} the list's file name.",
  },
  'cli.setListImage.clearedPreview': {
    description: 'The --dry-run form of cli.setListImage.cleared; same parameters.',
  },
  'cli.setListImage.invalid': {
    description:
      "Refusal when a path or URL is not a usable image reference. {reason} is the parser's own untranslated sentence.",
  },
  'cli.setListImage.noCards': {
    description:
      'Refusal when the card mode was chosen for a list with no card lines. {type} is a list-type word.',
  },
  'cli.setListImage.current': {
    description:
      "Names what a list's cover image is set to now, spliced into cli.setListImage.modePrompt. {value} is a raw id, path or URL and is empty in the 'default' branch.",
  },
  'cli.setListImage.modePrompt': {
    description:
      'Header of the wizard menu asking how the cover image should be chosen. {current} is cli.setListImage.current.',
  },
  'cli.setListImage.modeDefault': {
    description:
      "Menu row: let Ritual choose (the commander of a commander deck, otherwise the list's most expensive printing).",
  },
  'cli.setListImage.modeCard': {
    description: "Menu row: choose one of the list's own cards as the cover.",
  },
  'cli.setListImage.cardPrompt': {
    description: 'Prompt above the card picker in the cover-image wizard.',
  },

  // ── card ──────────────────────────────────────────────────────────────
  'cli.card.stdinOrFile': { description: 'Refusal when both batch input flags were passed.' },
  'cli.card.readFailed': { description: 'The --from-file path could not be read.' },
  'cli.card.nameRequired': {
    description: 'The command was run with no card name and no batch flag.',
  },
  'cli.card.fetchFailed': { description: "Scryfall's lookup failed. {reason} is its own text." },
  'cli.card.notFound': { description: 'Scryfall knows no card by that name.' },

  // ── scry ──────────────────────────────────────────────────────────────
  'cli.scry.pagesWithRandom': {
    description: 'Usage refusal: paging is meaningless for random picks.',
  },
  'cli.scry.csvWithRandom': {
    description: 'Usage refusal: CSV output is unavailable for random picks.',
  },
  'cli.scry.countNeedsRandom': {
    description: 'Usage refusal: --count only applies with --random.',
  },
  'cli.scry.queryRequired': { description: 'Usage refusal: a search needs a query.' },
  'cli.scry.fieldsWithCsv': {
    description: 'Usage refusal: the field projection cannot apply to a server-rendered CSV.',
  },
  'cli.scry.pageFetchFailed': { description: 'One result page could not be fetched.' },
  'cli.scry.noResults': { description: 'The search matched nothing.' },
  'cli.scry.promptNextPage': { description: 'Interactive paging prompt shown after each page.' },
  'cli.scry.truncatedUnknown': {
    description:
      'Notice that a capped run stopped early, when the row count is unknown (CSV output). {pages} is a pre-rendered "page 1" / "pages 1-3" fragment.',
  },
  'cli.scry.truncated': {
    description:
      'Notice that a capped run stopped early. {pages} is a pre-rendered "page 1" / "pages 1-3" fragment.',
  },
  'cli.scry.randomFailed': { description: "A --random fetch failed. {reason} is Scryfall's text." },
  'cli.scry.randomNotFound': { description: 'The random filter matched no card.' },
  'cli.scry.pagesPositive': {
    description:
      'Refusal for a non-numeric --pages value. "Pages" is the flag\'s name as a subject.',
  },
  'cli.scry.pagesTooLarge': {
    description: 'Refusal for a --pages value above the cap. {max} is that cap.',
  },
  'cli.scry.countPositive': {
    description:
      'Refusal for a non-numeric --count value. "Count" is the flag\'s name as a subject.',
  },
  'cli.scry.countTooLarge': {
    description: 'Refusal for a --count value above the cap. {max} is that cap.',
  },

  // ── diff ──────────────────────────────────────────────────────────────
  'cli.diff.invalidMode': {
    description: "--by rejected a value. 'name' and 'printing' are machine values.",
  },
  'cli.diff.identical': {
    description: 'The two lists match. {by} is the machine value of the comparison mode.',
  },
  'cli.diff.noPrinting': {
    description: 'Stands in for a printing in the breakdown when the card line pins none.',
  },
  'cli.diff.onlyInHeading': {
    description: 'Section heading for cards present in only one of the two lists.',
  },
  'cli.diff.quantityHeading': {
    description: 'Section heading for cards present in both lists in different quantities.',
  },
  'cli.diff.onlyLine': {
    description: 'One row under an "only in" heading. The two leading spaces are the indent.',
  },
  'cli.diff.mismatchLine': {
    description: 'One row under the quantity heading, naming both sides. The indent is two spaces.',
  },
  'cli.diff.warningLine': {
    description: 'Prefixes a parse warning on stderr. The emoji is part of the marker.',
  },

  // ── move ──────────────────────────────────────────────────────────────
  'cli.move.indexWarning': {
    description: 'Prefixes a card-index warning on stderr while a move loads lists.',
  },
  'cli.move.menuViewPending': {
    description: 'Move-session menu row opening the pending-changes view (nothing queued yet).',
  },
  'cli.move.menuViewPendingCount': {
    description: 'Move-session menu row opening the pending-changes view, with the queued count.',
  },
  'cli.move.menuFilters': {
    description: 'Move-session menu row opening the source/destination filters.',
  },
  'cli.move.menuBatch': {
    description:
      'Move-session menu row that switches the session into batch mode, where many cards are selected before one destination is chosen.',
  },
  'cli.move.menuExit': { description: 'Move-session menu row that leaves the session.' },
  'cli.move.toRequiresFrom': { description: 'Usage refusal: --to is only meaningful with --from.' },
  'cli.move.scriptedNeedsBoth': {
    description:
      'Usage refusal: card-selection flags were given without both list flags. `ritual move` is a command and never translates.',
  },
  'cli.move.loadingLists': {
    description: 'Progress line while the move session reads every list.',
  },
  'cli.move.noLists': { description: 'The workspace holds no lists, so there is nothing to move.' },
  'cli.move.sourceNotLoaded': {
    description: 'The --from list resolved but is not among the loaded lists.',
  },
  'cli.move.loadingCards': { description: 'Progress line while the move session indexes cards.' },
  'cli.move.noCards': { description: 'Every list is empty, so there is nothing to move.' },
  'cli.move.sourceFilter': {
    description:
      'Notice that the session started narrowed to one source list. "Session Filters" names the menu row that widens it.',
  },
  'cli.move.ready': {
    description:
      'The session is ready. {cards} and {lists} are pre-rendered counted nouns ("12 cards", "3 lists").',
  },
  'cli.move.promptSearch': { description: "Prompt heading for the move session's main picker." },
  'cli.move.selectorRequired': { description: 'A scripted move named no card.' },
  'cli.move.sameList': {
    description: 'A scripted move named one list as both source and destination.',
  },
  'cli.move.toSectionEmpty': { description: '--to-section was given an empty value.' },
  'cli.move.toSectionDeckOnly': {
    description: 'Refusal: only decks have sections for --to-section to name.',
  },
  'cli.move.listNotLoaded': {
    description: 'Internal guard: a resolved list vanished before loading.',
  },
  'cli.move.noteDroppedWarning': {
    description:
      "Data-loss warning on stderr: a merged deck line kept its own note. {id} is the card's ' &N' suffix and may be empty.",
  },
  'cli.move.noteDroppedLine': {
    description:
      'The same data-loss notice inside the interactive session, indented under the save summary.',
  },
  'cli.move.noCardWithId': {
    description: 'No card in the source list carries the requested &N id.',
  },
  'cli.move.noCardMatching': { description: 'No card in the source list matched the typed name.' },
  'cli.move.noCopiesMatching': {
    description:
      'Copies exist but none match the printing flags. {criteria} is a comma-joined list of the criteria below.',
  },
  'cli.move.multiplePrintings': {
    description:
      'The selection spans several printings, which a scripted move refuses. {matches} is the pre-rendered candidate list.',
  },
  'cli.move.criteriaSet': { description: 'One narrowing criterion: the set code, uppercased.' },
  'cli.move.criteriaCollectorNumber': {
    description: 'One narrowing criterion: the collector number.',
  },
  'cli.move.criteriaFinish': {
    description: 'One narrowing criterion: the finish, a machine value.',
  },
  'cli.move.printingNeedsBoth': {
    description: 'A collection destination needs a printing, and only half the pin was given.',
  },
  'cli.move.printingsUnknown': {
    description:
      "The card cache cannot say what printings exist. The 'ritual cache preload-all' command never translates.",
  },
  'cli.move.multipleCardPrintings': {
    description:
      'The card has several printings and the destination needs one. {printings} is the pre-rendered candidate list.',
  },
  'cli.move.printingLine': {
    description:
      'One candidate printing row: the set name, then SET:number. The two leading spaces are the indent.',
  },
  'cli.move.moved': {
    description:
      'Success line for a scripted move. {card} carries the name, printing, finish and language tokens.',
  },
  'cli.move.noPending': { description: 'Nothing has been queued in the move session yet.' },
  'cli.move.saving': { description: 'Progress line while queued moves are written.' },
  'cli.move.doneMoved': { description: 'Summary after the queued moves were written.' },
  'cli.move.pendingHeading': { description: 'Heading of the pending-changes view.' },
  'cli.move.pendingLine': {
    description:
      'One queued move: the card, then source and destination. The indent is two spaces and the arrow is a separator.',
  },
  'cli.move.noDestinations': {
    description: 'Every destination is filtered out, so the picked card has nowhere to go.',
  },
  'cli.move.promptDestination': { description: 'Prompt asking which list a card moves to.' },
  'cli.move.needsPrinting': {
    description: 'A name-only card is headed for a collection, which needs a concrete printing.',
  },
  'cli.move.printingCancelled': {
    description: 'The printing picker was cancelled, so the move is off.',
  },
  'cli.move.noPrintingsFound': {
    description: 'No printing could be found for a collection-bound card.',
  },
  'cli.move.queued': {
    description:
      'Confirms a move was added to the queue. The check mark and indent are decoration.',
  },
  'cli.move.sectionPrompt': {
    description:
      'Asks which section of the destination deck the card(s) should be added to. {list} is the deck, named as "Deck \'Burn\'".',
  },
  'cli.move.sectionNew': {
    description:
      'Row on the destination-section picker that creates a section the deck does not have yet.',
  },
  'cli.move.sectionNewPrompt': {
    description: 'Text prompt asking for the name of the deck section to create.',
  },
  'cli.move.sectionNameInvalid': {
    description:
      "Refusal when a typed new-section name would not survive being written as a '## ' heading — it starts with '#' or carries a line break. {name} is what was typed.",
  },
  'cli.move.batchNoSources': {
    description:
      'Shown when the batch-mode list picker was left with no lists ticked, which ends batch mode.',
  },
  'cli.move.batchNoCards': {
    description:
      'Shown when none of the lists batch mode is viewing holds a card that can still be moved, which ends batch mode.',
  },
  'cli.move.batchPrompt': {
    description:
      'Prompt above the batch-mode card checklist. {count} is how many cards are ticked so far.',
  },
  'cli.move.batchDone': {
    description:
      'Batch-mode row that finishes selecting and moves on to the destination question. {count} is how many cards are ticked.',
  },
  'cli.move.batchSelectAll': {
    description:
      'Batch-mode row that ticks every card on screen. Shown only when a single list is being viewed.',
  },
  'cli.move.batchDeselectAll': {
    description:
      'Batch-mode row that unticks every card on screen, replacing "Select all" once everything is ticked.',
  },
  'cli.move.batchSelectAllFrom': {
    description:
      'Batch-mode row that opens a per-list picker for bulk selection. Shown when more than one list is being viewed. The trailing ellipsis marks it as opening another screen.',
  },
  'cli.move.batchExit': {
    description: 'Batch-mode row that leaves batch mode and returns to the single-card search.',
  },
  'cli.move.batchNoneSelected': {
    description: 'Refusal shown when "Done selecting" is chosen with no cards ticked.',
  },
  'cli.move.batchSelectFromPrompt': {
    description:
      'Prompt of the "Select all from…" screen, which ticks every card of whichever viewed lists are chosen.',
  },
  'cli.move.batchAllSelectedLists': {
    description:
      'Row on the "Select all from…" screen that takes every card of every list being viewed, whatever the individual boxes say.',
  },
  'cli.move.batchContinue': {
    description: 'Row that applies the "Select all from…" screen\'s choices and returns.',
  },
  'cli.move.batchNoListsPicked': {
    description:
      'Refusal shown when Continue is chosen on the "Select all from…" screen with no list picked.',
  },
  'cli.move.batchDestination': {
    description:
      'Prompt asking where the whole batch goes. {count} is how many cards were selected.',
  },
  'cli.move.batchQueued': {
    description:
      'Result line after a batch is queued. {count} is how many cards were queued, {list} the destination named as "Deck \'Burn\'".',
  },
  'cli.move.batchSkippedSameList': {
    description:
      'Warns that some selected cards already sat in the chosen destination and were left alone. {count} is how many.',
  },
  'cli.move.batchSkippedPrinting': {
    description:
      'Warns that some selected cards could not enter a collection because no printing was resolved for them. {count} is how many.',
  },
  'cli.move.batchAbandoned': {
    description:
      'Warns that a cancelled printing prompt ended the batch early, so the cards after it were never queued. {count} is how many were left.',
  },
  'cli.move.filtersPrompt': { description: 'Prompt heading of the session-filters menu.' },
  'cli.move.configureSources': {
    description:
      'Menu row opening the source-list toggles. FROM is capitalized for contrast with TO.',
  },
  'cli.move.configureDestinations': {
    description: 'Menu row opening the destination-list toggles. TO is capitalized for contrast.',
  },
  'cli.move.back': {
    description: 'Menu row returning to the previous screen. The arrow is decoration.',
  },
  'cli.move.done': { description: 'Menu row closing a toggle screen. The arrow is decoration.' },
  'cli.move.toggleListsPrompt': {
    description: 'Prompt heading of a toggle screen, naming which side of the move it edits.',
  },
  'cli.move.toggleGroupDecks': {
    description:
      'Toggle row for all decks. {state} is X, ~ or a space and stays inside the brackets; {enabled}/{total} is a count.',
  },
  'cli.move.toggleGroupCollections': {
    description: 'Toggle row for all collections. See the decks row for the placeholders.',
  },
  'cli.move.toggleGroupWanted': {
    description: 'Toggle row for all wanted lists. See the decks row for the placeholders.',
  },
  'cli.move.toggleAllOn': {
    description: 'Toggle row enabling every list. The box-drawing dashes are decoration.',
  },
  'cli.move.toggleAllOff': {
    description: 'Toggle row disabling every list. The box-drawing dashes are decoration.',
  },
  'cli.move.toggleItem': {
    description: 'Toggle row for one list. {state} is X or a space and stays inside the brackets.',
  },
  'cli.move.categoryPrompt': {
    description:
      'Prompt heading of a per-type toggle screen. {category} is a plural list-type name.',
  },
  'cli.move.keepOneDestination': {
    description: 'Refusal: at least one destination list must stay enabled.',
  },
  'cli.move.finishFoil': {
    description:
      'Display annotation for a foil printing, appended to a card name. The leading space is deliberate; the brackets are the annotation style.',
    maxLen: 8,
  },
  'cli.move.finishEtched': {
    description:
      'Display annotation for an etched printing, appended to a card name. The leading space is deliberate.',
    maxLen: 10,
  },
  'cli.move.listUnreadable': {
    description: 'A list could not be parsed, so its cards are missing from the move index.',
  },
  'cli.move.listWarning': {
    description: 'Prefixes a parser warning with the list file it came from.',
  },
  'cli.move.destinationNotFound': {
    description:
      "A cross-list move aborted before writing: the destination list does not exist (deleted or renamed since the move was queued). {name} is the card name; {list} is a pre-rendered English list label (e.g. Deck 'Burn') matching the changelog vocabulary — leave its shape alone.",
  },
  'cli.move.sourceNotFound': {
    description:
      "An incoming cross-list move (a `move-to` saved on its destination) aborted before writing: the source list it names does not exist (deleted or renamed since the move was staged). {name} is the card name; {list} is a pre-rendered English list label (e.g. Collection 'Binder') matching the changelog vocabulary — leave its shape alone.",
  },
  'cli.move.sourceCopyNotFound': {
    description:
      'An incoming cross-list move aborted before writing: the source list exists but holds no copy of the card (by line id, printing, or name) to take out — it was already removed or moved. {name} is the card name; {list} is a pre-rendered English list label.',
  },
  'cli.move.artUnfiled': {
    description:
      "The reason an incoming move's custom art was dropped from the source list but could not be re-filed on the destination (the destination line has no id yet, or its file could not be read). Rendered as the {reason} of admin.api.save.artUnreconciled, so it reads as a clause, lowercase. {name} is the card name; {list} is a pre-rendered English list label.",
  },
  'cli.move.abortDestinationMissing': {
    description: 'The move aborted before writing: a destination file is gone.',
  },
  'cli.move.abortSourceUnreadable': {
    description: 'The move aborted before writing: a source file cannot be read.',
  },
  'cli.move.abortMove': {
    description: "The move aborted before writing. {reason} is the loader's own sentence.",
  },
  'cli.move.abortRemoveSourceUnreadable': {
    description: 'A bulk removal aborted before writing: a source file cannot be read.',
  },
  'cli.move.abortRemove': {
    description: "A bulk removal aborted before writing. {reason} is the loader's own sentence.",
  },
  'cli.move.cannotReadDeck': {
    description: 'A deck file could not be read or parsed for staging.',
  },
  'cli.move.cannotReadFile': {
    description: 'A collection or wanted file could not be read for staging.',
  },
  'cli.move.collectionNeedsPrinting': {
    description: 'Internal guard: a collection line always records a printing.',
  },
  'cli.move.appendIntoOpenFence': {
    description:
      'Refusal: the destination file ends inside an unclosed markdown code fence, where a new card line would be invisible to every later parse.',
  },

  // ── List lifecycle: new / rename / delete ─────────────────────────────
  'cli.new.invalidType': {
    description: 'The <type> argument was not one of the three type slugs, which never translate.',
  },
  'cli.new.formatDecksOnly': { description: 'Refusal: only decks carry a format.' },
  'cli.new.created': { description: 'Success line naming the file the new list was written to.' },
  'cli.rename.renamed': {
    description: 'Success line naming the old name, the new name, and the new file path.',
  },
  'cli.delete.deleted': { description: 'Success line for a deleted list.' },
  'cli.delete.notice': {
    description:
      'Printed before the confirmation prompt so the user sees exactly which list resolved. "sidecar files" are the list\'s .sha256/.changes.md companions.',
  },
  'cli.delete.promptConfirm': {
    description:
      "Confirmation prompt. The user must type the list's display name exactly; {name} is that string.",
  },

  // ── lists / list-all-cards ────────────────────────────────────────────
  'cli.lists.empty': {
    description:
      'Placeholder row when the listing is empty. The parentheses mark it as not a list name.',
  },
  'cli.listAllCards.warning': {
    description: 'A parser warning collected while scanning list files.',
  },
  'cli.listAllCards.skipped': {
    description: 'A file the scan could not read at all, so the manifest is incomplete.',
  },
  'cli.listAllCards.wrote': { description: 'Confirms the manifest was written to a file.' },
  'cli.listAllCards.writeFailed': { description: 'The manifest file could not be written.' },

  // ── metadata ──────────────────────────────────────────────────────────
  'cli.metadata.rejectedName': {
    description:
      'The `name` front-matter key is not settable here. `ritual rename` is a command and never translates.',
  },
  'cli.metadata.rejectedCreated': {
    description: 'The `created` front-matter key is stamped by Ritual and not settable.',
  },
  'cli.metadata.rejectedLastSynced': {
    description: 'The `lastSynced` front-matter key is stamped by deck sync and not settable.',
  },
  'cli.metadata.unknownField': {
    description:
      'The named property is not a metadata key of that list type. {keys} is the comma-joined list of accepted key names, which never translate.',
  },
  'cli.metadata.useSetListImage': {
    description:
      'Refusal when `image` is passed to metadata set/unset. `ritual set-list-image` is a command name and never translates.',
  },
  'cli.metadata.frontMatterUnreadable': {
    description:
      "The file's YAML front matter cannot be merged over safely. One sentence per reason rather than a spliced clause.",
  },
  'cli.metadata.storedLabelsInvalid': {
    description:
      "The stored `labels` value failed validation. {reason} is the parser's own sentence.",
  },
  'cli.metadata.storedDescriptionInvalid': {
    description:
      'The stored `description` value is not text, so `metadata get` reports it rather than answering "unset". {reason} is the parser\'s own English sentence.',
  },
  'cli.metadata.arrayOnly': {
    description:
      "--add/--remove were used on a property that is not a list. {type} selects the list type (machine value: deck, collection or wanted); 'tags' and 'labels' are key names.",
  },
  'cli.metadata.singleValue': { description: 'The named property accepts exactly one value.' },
  'cli.metadata.invalidLabel': {
    description:
      'A label token was not in the vocabulary. {choices} is the comma-joined slug list.',
  },
  'cli.metadata.noLabels': {
    description:
      'A replace with no values is refused; clearing is a separate subcommand. `ritual metadata unset` never translates.',
  },
  'cli.metadata.set': {
    description:
      'Success line for a metadata write. {value} is the stored value, already formatted.',
  },
  'cli.metadata.cleared': {
    description: 'Success line when a write cleared the property instead.',
  },
  'cli.metadata.unset': { description: 'Success line for `metadata unset`.' },
  'cli.metadata.notSet': {
    description: 'The requested property has no value on that list (exit code 3).',
  },
  'cli.metadata.row': {
    description: 'One row of `metadata list`: the key name (never translated) and its value.',
  },
  'cli.metadata.rowUnset': {
    description:
      'One row of `metadata list` for a key with no value. The parentheses mark the absence.',
  },

  // ── cleanup ───────────────────────────────────────────────────────────
  'cli.cleanup.couldNotRead': {
    description: 'Per-file warning: the file could not be read or parsed at all.',
  },
  'cli.cleanup.skipped': {
    description: 'Per-file warning following the one above: nothing was changed for this file.',
  },
  'cli.cleanup.notRenamedOccupied': {
    description: 'Per-file warning: the target file name belongs to another list.',
  },
  'cli.cleanup.notRenamedCollision': {
    description:
      "Per-file warning: the target name would collide with another list. {reason} is the checker's sentence.",
  },
  'cli.cleanup.notRewritten': {
    description:
      'Per-file warning: the parse skipped lines, so re-emitting the file would drop them.',
  },
  'cli.cleanup.actionFormatSet': {
    description: 'One reported action: a deck got a format. {format} is a format slug.',
  },
  'cli.cleanup.actionRenamed': { description: 'One reported action: the file was renamed.' },
  'cli.cleanup.actionRewritten': {
    description: 'One reported action: the file was re-emitted in canonical form.',
  },
  'cli.cleanup.actionNeedsFormat': {
    description: 'One reported action under --dry-run: this deck would be asked for a format.',
  },
  'cli.cleanup.actionFormatSkipped': {
    description: 'One reported action under --skip-formats: the format question was not asked.',
  },
  'cli.cleanup.actionNoFormat': {
    description: 'One reported action: the format question was asked and declined.',
  },
  'cli.cleanup.signalCommandZone': {
    description:
      'Printed above the format prompt: the deck has a command zone, so those formats are offered first.',
  },
  'cli.cleanup.signalConstructed': {
    description:
      'Printed above the format prompt: a 60-card-shaped deck. {count} is its main-deck size.',
  },
  'cli.cleanup.signalLimited': {
    description: 'Printed above the format prompt: a small deck suggests Limited play.',
  },
  'cli.cleanup.signalNone': {
    description: "Printed above the format prompt when the deck's shape suggests nothing.",
  },
  'cli.cleanup.formatlessDecks': {
    description:
      'Refusal before any file is touched: formats are needed but cannot be asked for. {names} is a comma-joined list of file paths.',
  },
  'cli.cleanup.fileLine': {
    description:
      'One reported file. {prefix} is an empty string or a "[dry-run] "/"[check] " marker; {actions} is the comma-joined action list.',
  },
  'cli.cleanup.fileWarning': {
    description: 'One warning about a reported file. {prefix} is the same run marker as above.',
  },
  'cli.cleanup.noListFiles': { description: 'The workspace holds no list files at all.' },
  'cli.cleanup.allClean': {
    description: 'Every file is already canonical. {counted} is a pre-rendered counted noun.',
  },
  'cli.cleanup.summary': {
    description:
      'Closing summary. {changed} is how many files a real run would write; {counted} is a pre-rendered counted noun for the total.',
  },

  // ── get-primer ────────────────────────────────────────────────────────
  'cli.getPrimer.userAgentRequired': {
    description:
      'Moxfield requires an approved user agent. The env var and flag names never translate.',
  },
  'cli.getPrimer.noPrimerFetched': { description: 'The fetched Moxfield deck carries no primer.' },
  'cli.getPrimer.readFailed': {
    description:
      'The local deck file could not be read. The underlying error is logged after this line, hence the trailing colon.',
  },
  'cli.getPrimer.noPrimer': {
    description: 'The local deck has no primer sidecar. The file extension never translates.',
  },

  // ── Ambiguous collection-sync removals ────────────────────────────────
  'cli.resolveAmbiguity.priorityAdvice': {
    description:
      'The one actionable hint for settling ambiguous removals without a terminal. The flag name never translates.',
  },
  'cli.resolveAmbiguity.leftUnresolved': {
    description:
      'The confirmation was declined. {counted} is a pre-rendered counted noun; {advice} is the hint above.',
  },
  'cli.resolveAmbiguity.copiesLiveIn': {
    description:
      'Context line before the per-copy prompts. {lists} is a pre-rendered list of lists with their copy counts.',
  },
  'cli.resolveAmbiguity.promptWhichList': {
    description: 'Per-copy prompt asking which list lost this copy.',
  },
  'cli.resolveAmbiguity.listChoice': {
    description: 'One row of that prompt: a list name and how many copies it still has to give.',
  },
  'cli.resolveAmbiguity.cancelledAfter': {
    description: 'The session was cancelled part way through; nothing is written.',
  },
} as const satisfies MetaFor<typeof cliCardsMessages>
