/**
 * The English catalog: the single type source for every message key and every
 * message parameter in the project. Translations are shipped as validated JSON
 * data with the same keys, so English is the only catalog authored in
 * TypeScript — a stale `t()` call site is a `tsc` error rather than a runtime
 * surprise.
 *
 * English is imported directly by the CLI and by both SPAs, so the default path
 * is inline: never a fetch waterfall, never a blank UI, and always the
 * per-key fallback for a partially translated locale.
 */

import type { MessageCatalogShape } from '../types'
import { adminMessages } from './en/admin'
import { cliMessages } from './en/cli'
import { cliCardsMessages } from './en/cli-cards'
import { cliEditMessages } from './en/cli-edit'
import { cliInfraMessages } from './en/cli-infra'
import { cliSyncMessages } from './en/cli-sync'
import { domainMessages } from './en/domain'
import { errorMessages } from './en/errors'
import { helpMessages } from './en/help'
import { helpCardsMessages } from './en/help-cards'
import { helpEditMessages } from './en/help-edit'
import { helpInfraMessages } from './en/help-infra'
import { helpSyncMessages } from './en/help-sync'
import { siteMessages } from './en/site'
import { siteCardsMessages } from './en/site-cards'
import { siteChromeMessages } from './en/site-chrome'
import { siteEditorMessages } from './en/site-editor'
import { sitePagesMessages } from './en/site-pages'
import { uiMessages } from './en/ui'

/**
 * The merged English catalog.
 *
 * Three namespaces are authored across several files so independent surfaces can
 * be converted without contending for one file:
 *
 * - `site` — `site` (shared) plus the four surface fragments;
 * - `cli` — `cli` (the shared CLI core) plus one fragment per command family;
 * - `help` — `help` (global options and the shared scripting flags) plus the
 *   same four command-family fragments.
 *
 * The split is a source-layout detail only: every key still begins with its
 * namespace, and a translator sees one flat catalog.
 */
export const en = {
  ...adminMessages,
  ...cliMessages,
  ...cliCardsMessages,
  ...cliEditMessages,
  ...cliInfraMessages,
  ...cliSyncMessages,
  ...domainMessages,
  ...errorMessages,
  ...helpMessages,
  ...helpCardsMessages,
  ...helpEditMessages,
  ...helpInfraMessages,
  ...helpSyncMessages,
  ...siteMessages,
  ...siteCardsMessages,
  ...siteChromeMessages,
  ...siteEditorMessages,
  ...sitePagesMessages,
  ...uiMessages,
} as const satisfies MessageCatalogShape

/** Every message key that exists. */
export type MessageKey = keyof typeof en & string

/** The English catalog's type — what a translation is validated against. */
export type EnglishCatalog = typeof en

/** The segment of a key before its first dot. */
type NamespaceOf<K> = K extends `${infer N}.${string}` ? N : never

/**
 * A namespace prefix of a message key — derived from the keys themselves, so a
 * key whose prefix is not a real namespace (`'clii.foo.bar'`) fails `tsc` rather
 * than waiting for `MESSAGE_KEY_PATTERN` in `scripts/check-locales.ts`.
 */
export type MessageNamespace = NamespaceOf<MessageKey>

/**
 * The message-key namespaces, which double as import boundaries.
 *
 * `satisfies` polices the list against the derived union in one direction (an
 * entry naming a namespace no key uses is a compile error); the union itself is
 * what polices the keys in the other.
 */
export const MESSAGE_NAMESPACES = [
  'cli',
  'help',
  'site',
  'admin',
  'ui',
  'domain',
  'errors',
] as const satisfies readonly MessageNamespace[]

/** The namespace a key belongs to (the segment before the first dot). */
export function messageNamespace<K extends MessageKey>(key: K): NamespaceOf<K> {
  return key.slice(0, key.indexOf('.')) as NamespaceOf<K>
}
