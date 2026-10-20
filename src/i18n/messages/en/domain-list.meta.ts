/** Translator metadata for {@link domainListMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { domainListMessages } from './domain-list'

const REFUSAL =
  'Starts lowercase and has no closing period: it is shown on its own under a form field, and also inside longer sentences ("card 12: …", "Front matter \'image\' ignored: …").'

const ART_CONTEXT = `Why a card's custom-art reference was refused. Custom art replaces a Magic card's picture with an image file from the user's art folder ("art directory") or with a web address. The reference is typed into a field in the CLI or an editor, or read from a list's .art.json file. ${REFUSAL}`

const ART_FILE_CONTEXT = `${ART_CONTEXT} {file} is the art-directory-relative path as written.`

const ART_URL_CONTEXT = `${ART_CONTEXT} {url} is the web address as written.`

const IMAGE_CONTEXT = `Why a list's cover image setting was refused. The cover is set in the list file's front matter (its settings block) as a mapping naming exactly one of "card" (the &N id of a card line in the list), "file" (an image in the art folder) or "url" (a web address). Those three key names are literal and never translated. ${REFUSAL}`

const SIDECAR_LOWERCASE =
  'Starts lowercase and has no closing period: it is shown after the file name ("binder.art.json: …").'

const CATEGORIES_CONTEXT = `Why a list's .categories.json file — which records each card's categories (its roles in a deck, like "Ramp") — could not be read. Its JSON keys "order" and "cards" are literal. ${SIDECAR_LOWERCASE}`

export const domainListMeta = {
  'domain.list.art.fileNotString': {
    description: `${ART_CONTEXT} The "file" key holds something other than text. "file" is literal.`,
  },
  'domain.list.art.fileEmpty': {
    description: `${ART_CONTEXT} The "file" key is blank. "file" is literal.`,
  },
  'domain.list.art.backslashes': {
    description: `${ART_FILE_CONTEXT} The path uses backslashes; only forward slashes (/) are accepted.`,
  },
  'domain.list.art.absolute': {
    description: `${ART_FILE_CONTEXT} The path is absolute (starts at the disk root or a drive letter); it must be relative to the art directory.`,
  },
  'domain.list.art.escapes': {
    description: `${ART_FILE_CONTEXT} The path climbs out of the art directory (with ..).`,
  },
  'domain.list.art.directory': {
    description: `${ART_FILE_CONTEXT} The path names a folder, not an image file.`,
  },
  'domain.list.art.notImage': {
    description: `${ART_FILE_CONTEXT} The file's extension is not an image type custom art accepts. {extensions} is the list of accepted extensions (".png", ".jpg", …), machine vocabulary, already joined in your language's list style.`,
  },
  'domain.list.art.urlNotString': {
    description: `${ART_CONTEXT} The "url" key holds something other than text. "url" is literal.`,
  },
  'domain.list.art.invalidUrl': {
    description: `${ART_URL_CONTEXT} The text cannot be read as a web address at all.`,
  },
  'domain.list.art.notHttp': {
    description: `${ART_URL_CONTEXT} The address does not start with http:// or https://. "http(s)" is literal.`,
  },
  'domain.list.art.notObject': {
    description: `${ART_CONTEXT} The reference is not a key/value object. "file" and "url" are literal key names.`,
  },
  'domain.list.art.unknownKeys': {
    description: `${ART_CONTEXT} The reference carries keys it does not accept. {keys} is the list of those keys, as written, already joined in your language's list style.`,
  },
  'domain.list.art.fileAndUrl': {
    description: `${ART_CONTEXT} The reference names both a file and a web address; it must name exactly one. "file" and "url" are literal key names.`,
  },
  'domain.list.art.noFileOrUrl': {
    description: `${ART_CONTEXT} The reference names neither a file nor a web address. "file" and "url" are literal key names.`,
  },
  'domain.list.art.empty': {
    description: `${ART_CONTEXT} The field was left blank.`,
  },
  'domain.list.image.cardNotId': {
    description: `${IMAGE_CONTEXT} The "card" value is not a positive whole number (a card line's id).`,
  },
  'domain.list.image.unknownKeys': {
    description: `${IMAGE_CONTEXT} The setting carries keys it does not accept. {keys} is the list of those keys, as written, already joined in your language's list style.`,
  },
  'domain.list.image.shape': {
    description: `${IMAGE_CONTEXT} The setting is not a key/value mapping at all.`,
  },
  'domain.list.image.exactlyOne': {
    description: `${IMAGE_CONTEXT} The setting names none, or more than one, of the three keys.`,
  },
  'domain.list.description.notText': {
    description: `Why a list's description (the prose blurb printed above its cards, set as "description" in the list file's settings block or through the API) was refused: it is not text — a number, a list or a mapping. ${REFUSAL}`,
  },
  'domain.list.sidecar.invalidJson': {
    description: `A list sidecar file is not valid JSON. ${SIDECAR_LOWERCASE}`,
  },
  'domain.list.sidecar.invalidJsonAt': {
    description: `The same, when the JSON parser reported where the file stops being valid: {line} and {column} are 1-based numbers. ${SIDECAR_LOWERCASE}`,
  },
  'domain.list.categories.notObject': {
    description: `${CATEGORIES_CONTEXT} The file holds something other than a JSON object.`,
  },
  'domain.list.categories.cardsNotObject': {
    description: `${CATEGORIES_CONTEXT} The "cards" entry is not an object keyed by card name.`,
  },
  'domain.list.categories.emptyName': {
    description: `${CATEGORIES_CONTEXT} One of the "cards" keys is blank; each must be a card name.`,
  },
  'domain.list.categories.noCategories': {
    description: `${CATEGORIES_CONTEXT} {name} is a card name whose category list is empty; the fix is to delete that entry.`,
  },
  'domain.list.categories.duplicateName': {
    description: `${CATEGORIES_CONTEXT} {name} is a card name that appears twice, spelled differently (for example with different capitalization).`,
  },
} as const satisfies MetaFor<typeof domainListMessages>
