/**
 * What every offer of a first card-cache download says before it asks: where
 * the data will live, and roughly how big it is. One source, so the empty-cache
 * gates (`add-card`, `edit`, `price`, `sell`, `admin`) and `build-site`'s
 * never-downloaded prompt never disagree about either.
 */

import { getCacheDirLocation } from './file-cache'
import { configuredCardBulkType } from '../scryfall/bulk-manifest'
import { t } from '../i18n/t'

/**
 * Where a first download will land, so the user knows what the download fills
 * (and, for the per-user default, that other workspaces share it).
 */
export function cacheLocationLine(): string {
  const location = getCacheDirLocation()
  return location.source === 'default'
    ? t('cli.cacheGate.locationShared', { path: location.dir })
    : t('cli.cacheGate.location', { path: location.dir })
}

/**
 * The approximate size of the download the configured card language needs.
 * Approximate on purpose: Scryfall's bulk files grow with every set, so the
 * figures are rounded and worded as "about".
 */
export function downloadSizeLine(): string {
  return t('cli.cacheGate.downloadSize', { bulk: configuredCardBulkType() })
}

/** The lines printed before a first-download offer: location, then size. */
export function firstDownloadNotes(): string[] {
  return [cacheLocationLine(), downloadSizeLine()]
}
