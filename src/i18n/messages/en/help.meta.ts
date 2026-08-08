/** Translator metadata for the `help.*` namespace. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { helpMessages } from './help'

export const helpMeta = {
  'help.program.description': {
    description:
      'One-line summary of Ritual itself, shown at the top of `ritual --help`. "Magic: The Gathering" is a trademark and stays as-is.',
  },
  'help.global.cacheServer': {
    description:
      'Help text for the global --cache-server flag, which points card and price lookups at a shared cache process instead of the local files.',
  },
  'help.global.baseDir': {
    description:
      'Help text for the global --base-dir flag, which chooses the workspace directory holding decks/, collections/ and wanted/.',
  },
  'help.global.noInput': {
    description:
      'Help text for the global --no-input flag. Both halves matter: a command either fails outright or falls back to a documented default, and which one it does is per command.',
  },
  'help.global.locale': {
    description:
      'Help text for the global --locale flag. This is the interface language, NOT the card printing language (that is `defaultLanguage`). "BCP-47" and the example tag stay as-is.',
  },
  'help.global.output': {
    description:
      'Help text for the shared --output flag. {formats} is a comma-joined list of the format names this command accepts; they are machine values and are never translated.',
  },
  'help.global.quiet': {
    description:
      'Help text for the shared --quiet flag. The parenthetical is the promise that matters: --quiet never silences the data itself.',
  },
  'help.global.fields': {
    description:
      'Help text for the shared --fields flag, which projects a subset of properties out of structured output. "json"/"ndjson" are format names and never translate.',
  },

  'help.group.lists': {
    description:
      'Heading over the commands that create, rename, edit and inspect whole lists in `ritual --help`.',
  },
  'help.group.cards': {
    description:
      'Heading over the commands that add, remove, change or move individual cards in `ritual --help`.',
  },
  'help.group.importExport': {
    description:
      'Heading over the commands that bring cards in from, or send them out to, another format or service.',
  },
  'help.group.lookupPricing': {
    description:
      'Heading over the read-only lookup commands and the price/buylist reports in `ritual --help`.',
  },
  'help.group.site': {
    description:
      'Heading over the commands that build, serve and administer the generated web site.',
  },
  'help.group.integrations': {
    description:
      'Heading over the commands that talk to another service or client — Archidekt sync, the MCP server, agent skills.',
  },
  'help.group.cache': {
    description: 'Heading over the card-cache commands in `ritual --help`.',
  },
  'help.group.utilities': {
    description: 'Heading over the maintenance and configuration commands in `ritual --help`.',
  },
  'help.group.legal': {
    description: 'Heading over the license-reporting commands in `ritual --help`.',
  },

  'help.commander.version': {
    description:
      "Description of the built-in -V/--version flag. Commander's own default wording, which is lowercase and verb-first; match the register of the other option descriptions in your language.",
  },
  'help.commander.help': {
    description:
      'Description of the built-in -h/--help flag and of the `help [command]` subcommand — Commander uses one string for both. "command" here means the subcommand whose help is shown, not the word \'command\' generically.',
  },
  'help.commander.usageTitle': {
    description:
      'Heading introducing the one-line usage synopsis at the top of any help screen. Commander appends the synopsis after it, so keep any trailing punctuation that separates the two.',
  },
  'help.commander.argumentsTitle': {
    description: 'Heading over the list of positional arguments a command accepts.',
  },
  'help.commander.optionsTitle': {
    description: 'Heading over the list of flags a command accepts.',
  },
  'help.commander.globalOptionsTitle': {
    description:
      "Heading over flags inherited from a parent command. Ritual does not currently enable Commander's global-options section, so this is registered for completeness.",
  },
  'help.commander.commandsTitle': {
    description:
      'Heading over the list of subcommands, for subcommands with no group of their own.',
  },
  'help.commander.unknownOption': {
    description:
      'Parse error: the user passed a flag no command defines. {flag} is the flag exactly as typed and is never translated. The lowercase "error: " prefix is a shell convention shared by every Commander diagnostic — keep the same prefix across all of them.',
  },
  'help.commander.unknownCommand': {
    description: 'Parse error: the first argument names no subcommand. {name} is what was typed.',
  },
  'help.commander.missingArgument': {
    description:
      'Parse error: a required positional argument was omitted. {name} is the argument name as declared in the help screen.',
  },
  'help.commander.optionArgumentMissing': {
    description:
      'Parse error: a flag that takes a value was given none. {flags} is the flag spelling as declared, e.g. "-o, --output <format>".',
  },
  'help.commander.requiredOption': {
    description: 'Parse error: a mandatory flag was not passed at all. {flags} is its declaration.',
  },
  'help.commander.excessArguments': {
    description:
      'Parse error: more positional arguments were given than the command accepts. {expected} and {received} are counts, {details} the surplus arguments joined by ", "; {count} equals {expected} and selects the form.',
  },
  'help.commander.excessArgumentsFor': {
    description:
      'The same error raised on a subcommand rather than the root program, so it can name it: {command} is the subcommand. See help.commander.excessArguments.',
  },
  'help.commander.conflictingOption': {
    description:
      'Parse error: two settings that cannot be combined were both supplied. {source} and {other} are pre-rendered phrases — help.commander.conflictOption or help.commander.conflictEnv — because either side may have come from a flag or from an environment variable.',
  },
  'help.commander.conflictOption': {
    description:
      'One side of help.commander.conflictingOption, when the value came from a flag. {flags} is its declaration.',
  },
  'help.commander.conflictEnv': {
    description:
      'One side of help.commander.conflictingOption, when the value came from the environment. {name} is the variable name and never translates.',
  },
  'help.commander.invalidOptionArgument': {
    description:
      "Parse error: a flag's value failed its own validator. Ritual's validator appends its reason as a second sentence, so this one ends where it does deliberately.",
  },
  'help.commander.invalidOptionEnv': {
    description:
      'The same failure when the value came from an environment variable rather than the command line. {env} is the variable name.',
  },
  'help.commander.invalidCommandArgument': {
    description:
      "Parse error: a positional argument's value failed its validator. {name} is the argument name; a reason may be appended.",
  },
  'help.commander.didYouMean': {
    description:
      'Appended on its own line after an unknown option or command when exactly one close match was found. {suggestion} is that flag or command name and never translates.',
  },
  'help.commander.didYouMeanOneOf': {
    description:
      'The same suggestion for several close matches. {suggestions} is the list, already joined by ", ".',
  },
} as const satisfies MetaFor<typeof helpMessages>
