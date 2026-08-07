/**
 * The configured default card language: the language stamped on newly added
 * cards. A bare card line always means `en` regardless of this value — files
 * stay self-describing — so this only ever influences what *new* entries are
 * written as, never how existing lines are read.
 *
 * The effective value resolves in precedence order:
 *
 * 1. The `__ritualDefaultLanguage__` global — the end-to-end test seam, so a
 *    test can pin the language without a config file. Always wins so a
 *    configured value can never leak into an assertion.
 * 2. The configured `defaultLanguage` from ritual.config.json, applied at app
 *    boot via {@link setDefaultLanguage} (the admin SPA fetches `/api/config`;
 *    the public site reads the value baked into `index.json`).
 * 3. {@link DEFAULT_CARD_LANGUAGE} (`en`).
 *
 * This module is browser-safe (no node imports) so both the SPAs and the
 * node-side config loader can share the default.
 */

import { DEFAULT_CARD_LANGUAGE, isCardLanguage, type CardLanguage } from '../card-language'

/**
 * Test-seam override for the default language, set on the global object.
 * Shared with the e2e helper that injects it.
 */
export type DefaultLanguageOverride = { __ritualDefaultLanguage__?: string }

/** The configured default language for this app instance; null until config arrives. */
let configuredLanguage: CardLanguage | null = null

/**
 * Apply the configured `defaultLanguage`. Called at app boot once the config
 * (admin) or site index (public site) has loaded.
 */
export function setDefaultLanguage(language: CardLanguage): void {
  configuredLanguage = language
}

/** Resolve the effective default language (see module doc for precedence). */
export function defaultLanguage(): CardLanguage {
  const override = (globalThis as unknown as DefaultLanguageOverride).__ritualDefaultLanguage__
  if (typeof override === 'string' && isCardLanguage(override)) return override
  return configuredLanguage ?? DEFAULT_CARD_LANGUAGE
}

/** Clear any applied configured value. Intended for tests. */
export function resetDefaultLanguage(): void {
  configuredLanguage = null
}
