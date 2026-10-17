/** Translator metadata for the `errors.*` namespace. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { errorMessages } from './errors'

export const errorsMeta = {
  'errors.input.required': {
    description:
      'Refusal under --no-input. {subject} is a short noun phrase naming what was needed (e.g. "a card name"), {reason} says why prompting is impossible. Keep the frame declarative — {subject} is never a question.',
  },
  'errors.enum.invalid': {
    description:
      'Rejection of an unknown value for a fixed-choice option. {field} names where the value was given, spelled exactly as typed there — a CLI flag or argument (`--format`, `<direction>`) or a request-body field (`finish`); {value} is what the user typed; {choices} is a comma-joined list of the accepted values. All three are identifiers and must not be translated.',
  },
  'errors.enum.type': {
    description:
      'Rejection of a non-string value for a fixed-choice field (an HTTP body sending a number where an enum was expected). {field} is the field name and {choices} a comma-joined list; both are English identifiers.',
  },
  'errors.invariant.unhandled': {
    description:
      'An internal consistency failure: an exhaustive switch met a value none of its cases handles (a programming error, not a user mistake). {value} is that value as raw data — a quoted token, an object’s kind, or JSON, capped at 200 characters — and is never translated.',
  },
  'errors.invariant.outsideProvider': {
    description:
      'An internal consistency failure: a user-interface component asked for shared state it can only get from inside a surrounding component, and was placed outside it (a programming error, not a user mistake). {hook} and {provider} are code names (like useTheme and ThemeProvider) and are never translated.',
  },

  'errors.invariant.calledBeforeSetup': {
    description:
      'An internal consistency failure: a part of Ritual was used before it was set up (a programming error, not a user mistake). {method} is the code name of what was called (like FeedSeeder.sync) and {setup} the code name of the call that must come first (like start()); both are never translated.',
  },

  'errors.label.exclusive': {
    description:
      'Rejection of an illegal card-label combination. {label} is the exclusive label the user asked for (the untranslated token `keep` or `proxy`), which stands alone and cannot be paired with any other label. Keep the quotes around it.',
  },
  'errors.label.contradictory': {
    description:
      'Rejection of a card-label value that both sets and negates the same label (for example `proxy,no-proxy`). {label} is the untranslated label token (`sale`, `trade`, `keep` or `proxy`). Keep the quotes around it.',
  },
  'errors.label.emptyPart': {
    description:
      'Rejection of a --label value with an empty entry (such as "sale," or ",trade"). {choices} is the comma-joined list of accepted label tokens (sale, trade, keep, proxy and their no- forms), which are machine values and must not be translated.',
  },
  'errors.skills.unknown': {
    description:
      'Rejection of `ritual skills install <name>` for a name that is not in the catalog. {names} is a comma-joined list of what the user asked for, {available} a comma-joined list of every skill name. Both are English skill identifiers and must not be translated.',
  },
  'errors.scripting.fieldsNeedStructuredOutput': {
    description:
      'Rejection of --fields alongside --output text. The flag names are CLI identifiers and must not be translated.',
  },
  'errors.scripting.fieldsEmpty': {
    description:
      'Rejection of an empty or whitespace-only --fields value. The flag name is a CLI identifier.',
  },
  'errors.scripting.portRange': {
    description: 'Rejection of a --port value that is not an integer in the TCP port range.',
  },
  'errors.resolveList.noLists': {
    description:
      'No list files of any kind exist in the workspace, and the command did not pin a type.',
  },
  'errors.resolveList.noListsOfType': {
    description:
      'No list files of the pinned type exist. One branch per list type so the noun can carry its own article and agreement; {type} is `deck`, `collection`, or `wanted`.',
  },
  'errors.resolveList.notFound': {
    description:
      'A list name matched nothing, and the command did not pin a type. {query} is what the user typed, quoted.',
  },
  'errors.resolveList.notFoundOfType': {
    description:
      'A list name matched nothing within the pinned type. One branch per list type; {query} is what the user typed, quoted.',
  },
  'errors.resolveList.ambiguous': {
    description:
      'A list name matched several lists. {query} is what the user typed, {matches} the already-rendered indented match lines (one per line, from errors.resolveList.match), {advice} the remedy sentence. Keep both newlines: {matches} is a block, not a phrase.',
  },
  'errors.resolveList.match': {
    description:
      'One line of the ambiguous-match block. {type} is the singular list-type name, {name} the list file name. The two leading spaces and the dash are the indent of a terminal bullet list — keep them.',
  },
  'errors.resolveList.adviceNarrow': {
    description:
      'Remedy when every match is byte-identical, so no longer name can break the tie and no example can be offered.',
  },
  'errors.resolveList.adviceNarrowExample': {
    description:
      'Remedy when typing more of the name resolves the ambiguity. {name} is a real list name that would resolve, quoted.',
  },
  'errors.resolveList.adviceExactName': {
    description:
      'Remedy when the matches fold together under case/punctuation folding, so only the byte-exact name resolves. {name} is that name, quoted.',
  },
  'errors.resolveList.adviceTypeFlags': {
    description:
      'Remedy for a command that registers --deck / --collection / --wanted. The flag names are CLI identifiers and must not be translated.',
  },
  'errors.resolveList.adviceTypePrefix': {
    description:
      "Remedy for an argument that accepts a `deck:` / `collection:` / `wanted:` prefix. {prefixes} is an already-joined list of quoted examples such as \"'deck:burn' or 'wanted:burn'\" (joined with errors.resolveList.alternative); the prefixes themselves are file-format vocabulary and never translate.",
  },
  'errors.resolveList.adviceTypeField': {
    description:
      "Remedy for a request carrying a structured per-list type field (the admin API, MCP). {types} is an already-joined list of quoted type slugs such as \"'deck' or 'collection'\" (joined with errors.resolveList.alternative); the slugs never translate.",
  },
  'errors.resolveList.alternative': {
    description:
      "Joins two alternatives in the list-resolution remedies, applied pairwise for three: \"'deck:burn' or 'wanted:burn'\". {first} and {second} are quoted, shell-pasteable examples (or an already-joined pair); keep them exactly as they are and translate only the word between them.",
  },
  'errors.resolveList.typeConflict': {
    description:
      "A `deck:` / `collection:` / `wanted:` prefix contradicts the command's own type flag. One branch per list type; {query} is the whole argument as typed and {flag} is the conflicting flag's name (an English CLI identifier, appearing twice). The `deck:` / `collection:` / `wanted:` prefix inside each branch is file-format vocabulary and must stay as-is.",
  },
} as const satisfies MetaFor<typeof errorMessages>
