import type { TranslateFn } from '../i18n/t'
import type { WantedListEntryState } from '../list/site-data'

/**
 * The badge beside a wanted card naming how loosely its line is specified: a
 * name-only line accepts any printing, a printing-only line any finish. A fully
 * specified line has no badge, and says so with `undefined` rather than `''`, so
 * the caller's `if` reads as a presence check instead of a truthiness one.
 */
export function wantedStateLabel(t: TranslateFn, state: WantedListEntryState): string | undefined {
  switch (state) {
    case 'name-only':
      return t('site.wanted.anyPrinting')
    case 'printing':
      return t('site.wanted.anyFinish')
    default:
      return undefined
  }
}
