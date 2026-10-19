/** Translator metadata for {@link domainConfigMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { domainConfigMessages } from './domain-config'

const SETTINGS_FILE =
  'Ritual keeps its settings in a JSON file named ritual.config.json; a user edits it by hand, with `ritual config set`, or from the admin Settings page.'

const REFUSAL = `${SETTINGS_FILE} This refuses one setting's value. Starts lowercase and has no closing period: it may follow a prefix such as "site config: ", and is also shown on its own.`

const FIELD =
  '{field} is the setting\'s key exactly as it appears in the file (for example "cacheSource" or "rateLimitMaxAttempts"); never translate it. Keep the straight quotes around it.'

export const domainConfigMeta = {
  'domain.config.mustBeBoolean': {
    description: `${REFUSAL} ${FIELD} The value must be JSON true or false.`,
  },
  'domain.config.mustBeNumber': {
    description: `${REFUSAL} ${FIELD} The value must be a JSON number.`,
  },
  'domain.config.mustBeString': {
    description: `${REFUSAL} ${FIELD} The value must be a JSON string (text in quotes).`,
  },
  'domain.config.mustBeStringArray': {
    description: `${REFUSAL} ${FIELD} The value must be a JSON array whose every element is a string.`,
  },
  'domain.config.mustBePositiveInteger': {
    description: `${REFUSAL} ${FIELD} The value must be a whole number greater than zero.`,
  },
  'domain.config.mustBeNonNegativeInteger': {
    description: `${REFUSAL} ${FIELD} The value must be a whole number, zero or greater.`,
  },
  'domain.config.mustBeOneOf': {
    description: `${REFUSAL} ${FIELD} {values} is the list of accepted values (code words such as "scryfall", "feed"), already joined in the reader's language; never translate the values.`,
  },
  'domain.config.unknownStore': {
    description: `${REFUSAL} ${FIELD} The value is a list of price stores, and one of them is not a store Ritual knows. {value} is that entry as written (in the file, a \`config set\` argument, or an admin save); {values} is the list of accepted store names (code words such as "tcgplayer", "cardmarket"), already joined in the reader's language. Never translate the store names.`,
  },
  'domain.config.mustBeEither': {
    description: `${REFUSAL} ${FIELD} {first} and {second} are the only two accepted values, code words such as "github-actions" and "manual"; never translate them.`,
  },
  'domain.config.mustBeHttpUrl': {
    description: `${REFUSAL} ${FIELD} The value must be a web address starting with http:// or https://. "http(s)" is literal.`,
  },
  'domain.config.mustBeHttpUrlOrEmpty': {
    description: `${REFUSAL} ${FIELD} The value must be a web address starting with http:// or https://, or an empty string (meaning "the same server"). "http(s)" is literal.`,
  },
  'domain.config.mustBeSemver': {
    description: `${REFUSAL} ${FIELD} The value must be a version number such as "1.2.3" ("semver" is the name of that format).`,
  },
  'domain.config.mustBeHash': {
    description: `${REFUSAL} ${FIELD} The value must be text starting with the literal prefix "sha256:" (a content hash Ritual writes itself). Keep "sha256:" as is.`,
  },
  'domain.config.mustBeListName': {
    description: `${REFUSAL} ${FIELD} The value must name a list (a collection of cards the user keeps) and cannot be blank.`,
  },
  'domain.config.bannedPrinting': {
    description: `${REFUSAL} One entry of the banned-printings setting is not a printing. {value} is the entry as the user wrote it. "SET:COLLECTOR" is the literal shape a printing takes (a set code, a colon, a collector number) and "sld:123" an example; keep both exactly.`,
  },
  'domain.config.uiLocaleMalformed': {
    description: `${REFUSAL} The interface-language setting (a language tag such as "de-AT") is not a valid tag at all. {reason} is the tag parser’s explanation, already translated (e.g. “invalid locale tag: de_DE”).`,
  },
  'domain.config.uiLocaleUnknown': {
    description: `${REFUSAL} The interface-language setting is a well-formed tag, but for no language this system knows. {tag} is the tag. "BCP-47" is the name of the tag standard; "en" and "de-AT" are example tags; keep all three exactly.`,
  },
  'domain.config.defaultLanguage': {
    description: `${SETTINGS_FILE} The "defaultLanguage" setting (the language newly added cards are printed in, e.g. Japanese cards) names no known card language. {value} is the value as given, already in quotes; {languages} is the list of accepted card-language codes ("en", "ja", …), already joined in the reader's language. "defaultLanguage" is the setting's key; never translate it or the codes.`,
  },
  'domain.config.defaultCategoriesNotArray': {
    description: `${SETTINGS_FILE} The "defaultCategories" setting — the card categories (a card's role in a deck, like "Ramp") the program suggests — is not a JSON array of names. "defaultCategories" is the setting's key; never translate it. Shown on its own, and also after a prefix.`,
  },
  'domain.config.defaultCategoriesNotText': {
    description: `${SETTINGS_FILE} An entry of the "defaultCategories" setting — the card categories (a card's role in a deck, like "Ramp") the program suggests — is not text. {value} is that entry as JSON; leave it as it is. "defaultCategories" is the setting's key; never translate it.`,
  },
  'domain.config.section': {
    description: `${SETTINGS_FILE} The name of one block of settings, shown as the subject of a warning ("ignoring invalid admin config"). {section} is the block's key in the file ("admin", "site", "managed", "collectionSync"); never translate it.`,
  },
  'domain.config.sectionNotObject': {
    description: `${REFUSAL} A whole block of settings is not a JSON object ({ … }). {section} is the block's key in the file ("admin", "site", "managed", "collectionSync"); never translate it.`,
  },
  'domain.config.inSection': {
    description: `${REFUSAL} A setting inside one block of settings is refused. {section} is the block's key in the file ("admin", "site", …); never translate it. {reason} is the refusal, a phrase of its own. Keep the colon layout.`,
  },
  'domain.config.field': {
    description: `${REFUSAL} The refusal of one setting, headed by the setting it is about. {field} is the setting's key exactly as in the file (e.g. "updateCheck"); never translate it. {reason} is the refusal, a phrase of its own. Keep the colon layout.`,
  },
  'domain.config.ignoringInvalid': {
    description: `${SETTINGS_FILE} A warning the server or CLI console prints while loading the file: one setting holds a value Ritual cannot use, so it is ignored and its built-in default applies until the file is fixed. {field} is the setting's key (e.g. "cacheSource") or the name of a block of settings (domain.config.section, e.g. "admin config"); {reason} is why, a phrase of its own. Keep the file name and the colon layout.`,
  },
  'domain.config.fileNotJson': {
    description: `${SETTINGS_FILE} The file could not be read as settings at all, so the command stopped without changing it. {path} is the file's full path; {reason} is why, either the JSON parser's own message (usually English) or a phrase of its own. Keep the three lines, the two-space indent of the reason, and the file name exactly.`,
  },
  'domain.config.fileNotObject': {
    description: `${SETTINGS_FILE} The file is valid JSON but not an object ({ … }) of settings. Starts lowercase and has no closing period: it is shown indented under "ritual.config.json is not valid JSON: <path>".`,
  },
} as const satisfies MetaFor<typeof domainConfigMessages>
