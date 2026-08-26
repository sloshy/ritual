/**
 * `help.*` — Commander's registered strings (`.description()`, `.option()`,
 * `.argument()`). Kept apart from `cli.*` because these are *registered* rather
 * than called: they are evaluated while `buildProgram()` constructs the command
 * tree, which is why the locale has to be resolved from a tolerant argv
 * pre-scan before registration (see `argv-prescan.ts`).
 *
 * This fragment holds the *shared* half: the program's own description, the
 * four global options, the scripting flags every command inherits through
 * `src/cli/options.ts`, the command-group headings, and the strings
 * Commander itself owns. Per-command help lives in the `help-cards`,
 * `help-edit`, `help-sync` and `help-infra` fragments.
 *
 * The `help.commander.*` half is unusual: those strings are *Commander's*, not
 * ours, so English here must stay byte-identical to the library's own literals
 * (`node_modules/commander/lib/{command,help}.js`). `index.ts` feeds them back
 * in through the hooks Commander exposes — `.version()`, `.helpOption()`,
 * `.helpCommand()`, `configureHelp({ styleTitle })` and
 * `configureOutput({ outputError })` — so an English run produces exactly the
 * bytes it did before and only a translated run diverges. Upgrading Commander
 * therefore means re-checking these against the library; a string that stops
 * matching degrades to Commander's English rather than breaking.
 */

import type { MessageCatalogShape } from '../../types'

export const helpMessages = {
  'help.program.description': 'Ritual, a Magic: The Gathering toolkit',

  // ── Global options ────────────────────────────────────────────────────
  'help.global.cacheServer':
    'Use a cache server for card and pricing cache (overrides local cache files)',
  'help.global.baseDir': 'Use this directory instead of the current working directory',
  'help.global.noInput':
    'Never prompt; fail or use documented defaults where input would be required',
  'help.global.locale':
    "Language for Ritual's own interface text (BCP-47, e.g. de-AT); not the card language",

  // ── The shared scripting flags ────────────────────────────────────────
  'help.global.output': 'Output format: {formats}',
  'help.global.quiet': 'Suppress progress and status messages (never the data payload)',
  'help.global.fields': 'Comma-separated fields for json/ndjson output',
  'help.option.refresh':
    'Card cache refresh policy: ask (prompt; skip when prompts are unavailable), auto, no-bulk, never',

  // ── Command-group headings (`program.commandsGroup(…)`) ───────────────
  'help.group.lists': 'Lists',
  'help.group.cards': 'Cards',
  'help.group.importExport': 'Import & Export',
  'help.group.lookupPricing': 'Lookup & Pricing',
  'help.group.site': 'Site',
  'help.group.integrations': 'Integrations',
  'help.group.cache': 'Cache',
  'help.group.utilities': 'Utilities',
  'help.group.legal': 'Legal',

  // ── Commander's built-in flag and command descriptions ────────────────
  'help.commander.version': 'output the version number',
  'help.commander.help': 'display help for command',

  // ── Commander's help section headings (`styleTitle`) ──────────────────
  'help.commander.usageTitle': 'Usage:',
  'help.commander.argumentsTitle': 'Arguments:',
  'help.commander.optionsTitle': 'Options:',
  'help.commander.globalOptionsTitle': 'Global Options:',
  'help.commander.commandsTitle': 'Commands:',

  // ── Commander's parse errors (`configureOutput({ outputError })`) ─────
  'help.commander.unknownOption': "error: unknown option '{flag}'",
  'help.commander.unknownCommand': "error: unknown command '{name}'",
  'help.commander.missingArgument': "error: missing required argument '{name}'",
  'help.commander.optionArgumentMissing': "error: option '{flags}' argument missing",
  'help.commander.requiredOption': "error: required option '{flags}' not specified",
  'help.commander.excessArguments': {
    $plural: 'count',
    one: 'error: too many arguments. Expected {expected} argument but got {received}: {details}.',
    other:
      'error: too many arguments. Expected {expected} arguments but got {received}: {details}.',
  },
  'help.commander.excessArgumentsFor': {
    $plural: 'count',
    one: "error: too many arguments for '{command}'. Expected {expected} argument but got {received}: {details}.",
    other:
      "error: too many arguments for '{command}'. Expected {expected} arguments but got {received}: {details}.",
  },
  'help.commander.conflictingOption': 'error: {source} cannot be used with {other}',
  'help.commander.conflictOption': "option '{flags}'",
  'help.commander.conflictEnv': "environment variable '{name}'",
  'help.commander.invalidOptionArgument': "error: option '{flags}' argument '{value}' is invalid.",
  'help.commander.invalidOptionEnv':
    "error: option '{flags}' value '{value}' from env '{env}' is invalid.",
  'help.commander.invalidCommandArgument':
    "error: command-argument value '{value}' is invalid for argument '{name}'.",
  'help.commander.didYouMean': '(Did you mean {suggestion}?)',
  'help.commander.didYouMeanOneOf': '(Did you mean one of {suggestions}?)',
} as const satisfies MessageCatalogShape
