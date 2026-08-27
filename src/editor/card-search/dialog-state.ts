/**
 * The add dialog's step machine as plain values: which step is on screen, and
 * the printing held while the language-notice step asks whether to proceed.
 */

import type { ScryfallCard } from '../../scryfall/types'
import type { CardLanguage } from '../../card/card-language'

export type CardSearchStep = 'search' | 'printing' | 'language-notice' | 'finish-condition'

/**
 * A picked printing held while the language-notice step asks whether to proceed:
 * the printing is not available in the configured default language, so
 * continuing stamps `language` on the entry instead.
 */
export type LanguageNotice = {
  printing: ScryfallCard
  /** The language the entry will be stamped with on Continue. */
  language: CardLanguage
  /** Every language this `set:cn` is available in. */
  available: CardLanguage[]
  /**
   * The full printing list the language was resolved against, committed as-is
   * on Continue so the commit can never diverge from what the notice showed
   * (e.g. when the auto-advance path resolved against a fresher list than
   * `allLanguagePrintings()`).
   */
  allPrintings: ScryfallCard[]
}
