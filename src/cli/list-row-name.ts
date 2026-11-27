import { t } from '../i18n/t'
import {
  listIdentityKey,
  listInfoOfEntry,
  uniqueListIdentities,
  type ListEntryLabel,
  type ListInfo,
} from '../list/list-identity'

/**
 * A list's name as a text row shows it: its title, with its slug added when
 * another of `lists` of the same type shares that title — two rows that read
 * the same would otherwise be told apart only by their position.
 */
export function listRowName(list: ListInfo, lists: readonly ListInfo[]): string {
  const key = listIdentityKey(list)
  const shared = lists.some(
    (other) =>
      other.listType === list.listType &&
      other.name === list.name &&
      listIdentityKey(other) !== key,
  )
  return shared ? t('cli.price.listNameWithSlug', { name: list.name, slug: list.slug }) : list.name
}

/** The distinct lists `entries` came from, first-seen order. */
export function listsOfEntries(entries: readonly ListEntryLabel[]): ListInfo[] {
  return uniqueListIdentities(entries.map(listInfoOfEntry))
}
