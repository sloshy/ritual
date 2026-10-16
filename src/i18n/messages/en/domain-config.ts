/**
 * `domain.config.*` — the text of the `ritual.config.json` validator
 * (`src/config/ritual-config.ts`): why a value in the file, a `PUT /api/config`
 * body or a `config set` argument is not one the configuration accepts, and
 * the refusal of a file that is not JSON at all.
 *
 * A fragment of the domain namespace, registered by the CLI and the admin SPA.
 * The validator runs under the CLI, the admin API and the MCP server alike, so
 * a refusal is built once as English plus its key: the API and MCP read the
 * English, the CLI renders the key in its own language, and the admin Settings
 * page renders it in the reader's. The public site never edits a config.
 *
 * Config keys (`cacheSource`, `site.bannedPrintings`), section names (`site`,
 * `admin`), the values a key accepts (`scryfall`, `github-actions`), locale
 * tags, card-language codes, file paths and the file name `ritual.config.json`
 * are machine vocabulary and stay as they are inside the sentences that
 * mention them.
 */

import type { MessageCatalogShape } from '../../types'

export const domainConfigMessages = {
  // ── A value of the wrong shape ────────────────────────────────────────
  'domain.config.mustBeBoolean': '"{field}" must be a boolean',
  'domain.config.mustBeNumber': '"{field}" must be a number',
  'domain.config.mustBeString': '"{field}" must be a string',
  'domain.config.mustBeStringArray': '"{field}" must be an array of strings',
  'domain.config.mustBePositiveInteger': '"{field}" must be a positive integer',
  'domain.config.mustBeNonNegativeInteger': '"{field}" must be a non-negative integer',
  'domain.config.mustBeOneOf': '"{field}" must be one of: {values}',
  'domain.config.mustBeEither': '"{field}" must be "{first}" or "{second}"',
  'domain.config.mustBeHttpUrl': '"{field}" must be an http(s) URL',
  'domain.config.mustBeHttpUrlOrEmpty': '"{field}" must be an http(s) URL or an empty string',
  'domain.config.mustBeSemver': '"{field}" must be a semver string',
  'domain.config.mustBeHash': '"{field}" must be a "sha256:" hash string',
  'domain.config.mustBeListName': '"{field}" must be a non-empty list name',
  'domain.config.bannedPrinting':
    'banned printing "{value}" must be in "SET:COLLECTOR" form (e.g. "sld:123")',
  'domain.config.uiLocaleMalformed': 'invalid UI locale: {reason}',
  'domain.config.uiLocaleUnknown':
    'invalid UI locale "{tag}": no such language is known (expected a BCP-47 tag such as "en" or "de-AT")',
  'domain.config.defaultLanguage':
    'Invalid language {value} for "defaultLanguage". Valid languages: {languages}',
  'domain.config.defaultCategoriesNotArray': 'defaultCategories must be an array of category names',
  'domain.config.defaultCategoriesNotText':
    'defaultCategories must be an array of category names, got {value}',

  // ── Sections and fields ───────────────────────────────────────────────
  'domain.config.section': '{section} config',
  'domain.config.sectionNotObject': '{section} config must be a JSON object',
  'domain.config.inSection': '{section} config: {reason}',
  'domain.config.field': '{field}: {reason}',
  'domain.config.ignoringInvalid': 'ritual.config.json: ignoring invalid {field} — {reason}',

  // ── The file itself ───────────────────────────────────────────────────
  'domain.config.fileNotJson':
    'ritual.config.json is not valid JSON: {path}\n  {reason}\nFix the file (or delete it to fall back to defaults) and try again.',
  'domain.config.fileNotObject': 'the file must contain a JSON object',
} as const satisfies MessageCatalogShape
