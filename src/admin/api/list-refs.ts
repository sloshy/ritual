import { LIST_TYPES } from '../../list/list-type'
import { parseEnumField } from '../../util/parse-enum'
import { uniqueListIdentities, type ListIdentity } from '../../list/list-identity'
import { apiMessage, isApiMessage, type ApiMessage } from '../../api/result'
import { isValidListSlug } from './target'

/**
 * Parse one `type:slug` list reference from a query parameter — the spelling
 * `listIdentityKey` (`list-identity.ts`) writes, so one format names a list in a query string
 * and in a map key. A list of them travels as one repeated parameter
 * (`list=deck:Burn&list=collection:binder`), never comma-joined: a slug may
 * hold a comma. The type is
 * everything before the first `:` — a list type never holds one — and the
 * slug everything after, so a slug's own spaces, commas and colons (a
 * hand-named file may carry one) survive. Refused, as the message explaining it: an unknown type, an empty
 * slug, or a slug carrying path separators.
 */
export function parseListRefParam(raw: string): ListIdentity | ApiMessage {
  const trimmed = raw.trim()
  const separator = trimmed.indexOf(':')
  // The type through the shared enum rule, case-insensitive like every other
  // enum parameter (`Deck:burn` is a deck); the slug is a file name, kept as is.
  const listType = parseEnumField(
    separator > 0 ? trimmed.slice(0, separator) : '',
    LIST_TYPES,
    'list',
  )
  const slug = separator > 0 ? trimmed.slice(separator + 1) : ''
  if (!listType.ok || slug === '' || !isValidListSlug(slug)) {
    return apiMessage('admin.api.listRefInvalid', { ref: trimmed })
  }
  return { listType: listType.value, slug }
}

/**
 * Parse every value of a repeated list-reference parameter (`params.getAll`):
 * blanks are skipped, the first refusal stops the parse, and a list named
 * twice is kept once (`uniqueListIdentities`). Values given but all blank
 * parse to `[]`, which a caller refuses rather than widening the scope to
 * every list.
 */
export function parseListRefParams(raws: readonly string[]): ListIdentity[] | ApiMessage {
  const refs: ListIdentity[] = []
  for (const raw of raws) {
    if (raw.trim() === '') continue
    const ref = parseListRefParam(raw)
    if (isApiMessage(ref)) return ref
    refs.push(ref)
  }
  return uniqueListIdentities(refs)
}
