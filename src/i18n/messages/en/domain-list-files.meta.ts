/** Translator metadata for {@link domainListFilesMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { domainListFilesMessages } from './domain-list-files'

const LOWERCASE =
  'Starts lowercase and has no closing period: it is shown after the file name ("binder.art.json: …").'

const ART_SIDECAR_CONTEXT = `Why a list's .art.json file — which maps each card line's id (&N) to the custom picture that replaces the card's image — could not be read. ${LOWERCASE}`

const FRONT_MATTER_ADVISORY = `A note about a list file's front matter (the YAML settings block at its top), reported when the list is read. Nothing is lost: the block is kept exactly as written.`

const WRITE_REFUSAL = `A change to a list file's front matter (the YAML settings block at its top) was refused, because the existing block cannot be read and writing over it would lose what it holds. One branch per reason: the block is valid YAML but not a key/value mapping, or it is not valid YAML at all.`

const LIFECYCLE = `Refusal when creating, renaming or deleting a list. One branch per list type (a deck, a collection, or a wanted list — a list of cards the user is looking for).`

const GUARD = `An internal error: a part of Ritual called a list-file engine the wrong way. Users should never see it except in a bug report, so a plain, literal translation is fine. The function and event names are code and never translated.`

export const domainListFilesMeta = {
  'domain.list.sidecar.problem': {
    description:
      'A list sidecar file (a small JSON file beside the list, holding its custom art or its card categories) could not be read. {file} is its path; {reason} is why, a phrase of its own. Keep the colon layout.',
  },
  'domain.list.sidecar.notListPath': {
    description: `${GUARD} {path} is a path that should have ended in ".md".`,
  },
  'domain.list.art.sidecarNotObject': {
    description: `${ART_SIDECAR_CONTEXT} The file holds something other than a JSON object keyed by card id.`,
  },
  'domain.list.art.sidecarBadKey': {
    description: `${ART_SIDECAR_CONTEXT} {key} is a key that is not a card id; keys must be the number after a card line's "&" (its &N id). "&N" is literal syntax.`,
  },
  'domain.list.art.sidecarBadEntry': {
    description: `${ART_SIDECAR_CONTEXT} One entry is not a usable art reference. {cardId} is the entry's card id (a number); {reason} is why, a phrase of its own.`,
  },
  'domain.list.frontMatter.notMapping': {
    description: `${FRONT_MATTER_ADVISORY} The block is valid YAML but not a key/value mapping, so its settings were ignored.`,
  },
  'domain.list.frontMatter.invalidYaml': {
    description: `${FRONT_MATTER_ADVISORY} The block is not valid YAML, so its settings were ignored. {detail} is the YAML parser's own message (usually English).`,
  },
  'domain.list.frontMatter.labelsIgnored': {
    description: `${FRONT_MATTER_ADVISORY} The "labels" setting (the list's default card labels, like "sale" or "trade") is unusable and was ignored. {reason} is why, a sentence of its own. "labels" is the setting's name and stays untranslated.`,
  },
  'domain.list.metadata.frontMatterUnreadable': {
    description: `${WRITE_REFUSAL} The change was a metadata edit (the list's description, default labels or cover image).`,
  },
  'domain.list.image.frontMatterUnreadable': {
    description: `${WRITE_REFUSAL} The change was a rewrite of the list's cover image setting after its cards were renumbered.`,
  },
  'domain.list.image.fileUnreadable': {
    description:
      "The list file itself could not be read, so its cover image setting (the picture shown for the list) was ignored and the default cover is used. {error} is the file system's own message.",
  },
  'domain.list.image.notMappingIgnored': {
    description:
      "The list file's front matter (its YAML settings block) is valid YAML but not a key/value mapping, so its cover image setting was ignored and the default cover is used.",
  },
  'domain.list.image.invalidYamlIgnored': {
    description:
      "The list file's front matter (its YAML settings block) is not valid YAML, so its cover image setting was ignored and the default cover is used. {detail} is the YAML parser's own message (usually English).",
  },
  'domain.list.image.cardNotInList': {
    description:
      'Refusal: a list\'s cover image is set to a card of the list by its id, but no card line in the list has that id. {card} is the id number, written after "&" (literal syntax). Starts lowercase: "image" is the setting\'s name and stays untranslated.',
  },
  'domain.list.deckFormat.invalid': {
    description:
      'Refusal: the deck format given (like commander or modern) is not one Ritual knows. {format} is what was given; {formats} is the list of valid format names, already joined in your language’s list style; the names are fixed identifiers and stay untranslated.',
  },
  'domain.list.name.unusable': {
    description:
      'Refusal: a list name has no characters that can appear in a file name (it is made only of characters like ? * : / that file systems forbid), so no list file can be named after it. {name} is the name as typed.',
  },
  'domain.list.lifecycle.exists': {
    description: `${LIFECYCLE} A list of that type with that exact name already exists. {name} is the name.`,
  },
  'domain.list.lifecycle.existsFolded': {
    description: `${LIFECYCLE} An existing list's name differs from the requested one only in capitalization, accents, spacing or punctuation, so the two could not be told apart when typed. {name} is the existing list's name; {query} is the name requested.`,
  },
  'domain.list.lifecycle.invalidName': {
    description: `${LIFECYCLE} The name would place the list file outside its folder.`,
  },
  'domain.list.lifecycle.notFound': {
    description: `${LIFECYCLE} The list to rename or delete does not exist. {name} is its file name without the extension.`,
  },
  'domain.list.lifecycle.confirmMismatch': {
    description:
      "Refusal when deleting a list: the confirmation typed is not the list's name exactly. {name} is the name that must be typed.",
  },
  'domain.list.fencedContent': {
    description:
      'One problem in a list file that a full rewrite would lose: a fenced code block (lines between ``` markers). Ritual reads it as plain text, but rewriting the whole file from its cards would delete it. {count} is the number of lines in such blocks. No closing period: several problems are joined into one sentence.',
  },
  'domain.list.unreadableContent': {
    description:
      "Refusal: a list file holds content Ritual cannot write back, and the operation would rewrite the whole file and delete it, freeing the card ids (&N, literal syntax) it holds. One branch per operation (saving the list, moving cards out of or into it, appending imported cards). {file} is the file's path; {problems} lists each problem, already worded and joined.",
  },
  'domain.list.rewriteHoldLine': {
    description:
      "Refusal shown in the CLI and returned by the API and MCP when a one-card change (a note, a printing, a label, adding a copy) is aimed at a card line the program read but would rewrite with a different meaning — e.g. '- 1234 Sol Ring', which may be 1,234 copies written by an older version or one card whose name starts with 1234. Nothing was changed; the user must edit the line by hand. {problem} is the note about that line, already a full sentence with its line number.",
  },
  'domain.list.rewriteHold': {
    description:
      "Refusal shown in the CLI, the admin site and returned by the API and MCP when a list file holds a card line the program read, but would rewrite with a different meaning if it wrote the whole file back — e.g. '- 1234 Sol Ring', which may be 1,234 copies written by an older version or one card whose name starts with 1234. Nothing is deleted; the user must edit the line by hand. {file} is the list file; {problems} is the list of such lines, each already a full sentence. Branches on {action}: saving, moving (cards between lists), appending (an import into the list), opening (the interactive editor declines to open the list), syncing (with a deck website).",
  },
  'domain.list.move.destinationNotFound': {
    description:
      "A cross-list move aborted before writing: the destination list does not exist (deleted or renamed since the move was queued). {name} is the card name; {list} is the list, already named in the reader's language (domain.change.listRef, e.g. Deck 'Burn').",
  },
  'domain.list.move.sourceNotFound': {
    description:
      "An incoming cross-list move (a `move-to` saved on its destination) aborted before writing: the source list it names does not exist (deleted or renamed since the move was staged). {name} is the card name; {list} is the list, already named in the reader's language (domain.change.listRef, e.g. Collection 'Binder').",
  },
  'domain.list.move.sourceCopyNotFound': {
    description:
      "An incoming cross-list move aborted before writing: the source list exists but holds no copy of the card (by line id, printing, or name) to take out — it was already removed or moved. {name} is the card name; {list} is the list, already named in the reader's language (domain.change.listRef).",
  },
  'domain.list.move.artUnfiled': {
    description:
      "The reason an incoming move's custom art was dropped from the source list but could not be re-filed on the destination (the destination line has no id yet, or its file could not be read). Rendered as the {reason} of admin.api.save.artUnreconciled, so it reads as a clause, lowercase. {name} is the card name; {list} is the list, already named in the reader's language (domain.change.listRef).",
  },
  'domain.list.move.cannotReadDeck': {
    description: 'A deck file could not be read or parsed for staging.',
  },
  'domain.list.move.cannotReadFile': {
    description: 'A collection or wanted file could not be read for staging.',
  },
  'domain.list.move.abortDestinationMissing': {
    description: 'The move aborted before writing: a destination file is gone.',
  },
  'domain.list.move.abortSourceUnreadable': {
    description: 'The move aborted before writing: a source file cannot be read.',
  },
  'domain.list.move.abortRemoveSourceUnreadable': {
    description: 'A bulk removal aborted before writing: a source file cannot be read.',
  },
  'domain.list.move.abortMove': {
    description: "The move aborted before writing. {reason} is the loader's own sentence.",
  },
  'domain.list.move.abortRemove': {
    description: "A bulk removal aborted before writing. {reason} is the loader's own sentence.",
  },
  'domain.list.move.appendIntoOpenFence': {
    description:
      'Refusal: the destination file ends inside an unclosed markdown code fence, where a new card line would be invisible to every later parse.',
  },

  'domain.list.idBackfill.readFailed': {
    description:
      'Operator log: while giving every card line its id (&N), a list folder or file could not be read, so its cards were left without ids. "ensure-card-ids" is the name of that step and stays as-is. {path} is the folder or file; {error} is the file system\'s own message.',
  },
  'domain.list.guard.unhandledAction': {
    description: `${GUARD} {action} is the change event's name.`,
  },
  'domain.list.guard.deckOnlyAction': {
    description: `${GUARD} A deck-only change (moving a card between deck sections, or making it the commander) was aimed at another list type; one branch per type. {action} is the change event's name.`,
  },
  'domain.list.guard.unsupportedLabels': {
    description: `${GUARD} A card-label change names labels this list type does not carry. {reason} is the sentence saying which. "set-label" is an event name.`,
  },
  'domain.list.guard.noCopies': {
    description: `${GUARD} {copies} is the number of copies that was asked for (zero, negative or fractional).`,
  },
  'domain.list.guard.noCardId': {
    description: `${GUARD} Adding a card to a deck finished without giving the card line an id.`,
  },
  'domain.list.guard.moveEvents': {
    description: `${GUARD} A change moving a card between lists reached an engine that edits one list only.`,
  },
  'domain.list.guard.commitTwice': {
    description: `${GUARD} A prepared cross-list move was written a second time.`,
  },
} as const satisfies MetaFor<typeof domainListFilesMessages>
