import type { ScryfallCard } from './types'

/** Confidence weight Scryfall Tagger assigns to a tagging. */
export type ScryfallTaggingWeight = 'very_strong' | 'strong' | 'median'

/** A single link between a tag and a card, by oracle identity or artwork. */
export interface ScryfallTagging {
  oracle_id?: string
  illustration_id?: string
  weight?: ScryfallTaggingWeight
  annotation?: string
}

/** A tag object from the Scryfall `oracle_tags` / `art_tags` bulk files. */
export interface ScryfallTag {
  object: string
  id: string
  label: string
  slug: string
  type: 'oracle' | 'illustration'
  taggings?: ScryfallTagging[]
}

/**
 * Derived lookup index inverting tag taggings into id → slug maps.
 * `oracle` is keyed by `oracle_id`, `illustration` by `illustration_id`.
 * Each slug list is sorted and deduped.
 */
export interface TagIndex {
  updatedAt: number
  oracle: Record<string, string[]>
  illustration: Record<string, string[]>
}

/**
 * Validate and parse a raw Scryfall tag bulk payload into `ScryfallTag[]`.
 * Returns an error string (never throws) when the payload is not a well-formed
 * array of tag objects, per the parser conventions in AGENTS.md.
 */
export function parseTagBulk(json: unknown): ScryfallTag[] | string {
  if (!Array.isArray(json)) {
    return 'Invalid tag bulk: expected a JSON array'
  }

  const tags: ScryfallTag[] = []
  for (let i = 0; i < json.length; i++) {
    const entry: unknown = json[i]
    if (!entry || typeof entry !== 'object') {
      return `Invalid tag bulk: entry ${i} is not an object`
    }
    const raw = entry as Record<string, unknown>
    if (typeof raw['object'] !== 'string') {
      return `Invalid tag bulk: entry ${i} is missing a string object`
    }
    if (typeof raw['id'] !== 'string') {
      return `Invalid tag bulk: entry ${i} is missing a string id`
    }
    if (typeof raw['label'] !== 'string') {
      return `Invalid tag bulk: entry ${i} is missing a string label`
    }
    if (typeof raw['slug'] !== 'string') {
      return `Invalid tag bulk: entry ${i} is missing a string slug`
    }
    if (raw['type'] !== 'oracle' && raw['type'] !== 'illustration') {
      return `Invalid tag bulk: entry ${i} has unexpected type '${String(raw['type'])}'`
    }
    tags.push(raw as unknown as ScryfallTag)
  }
  return tags
}

/**
 * Validate and parse a persisted {@link TagIndex} (e.g. from `cache/tags.json`).
 * Returns an error string (never throws) when the shape is wrong.
 */
export function parseTagIndex(json: unknown): TagIndex | string {
  if (!json || typeof json !== 'object') {
    return 'Invalid tag index: expected an object'
  }
  const raw = json as Record<string, unknown>
  if (typeof raw['updatedAt'] !== 'number') {
    return 'Invalid tag index: missing numeric updatedAt'
  }
  if (!raw['oracle'] || typeof raw['oracle'] !== 'object') {
    return 'Invalid tag index: missing oracle map'
  }
  if (!raw['illustration'] || typeof raw['illustration'] !== 'object') {
    return 'Invalid tag index: missing illustration map'
  }
  return raw as unknown as TagIndex
}

/** Accumulate `slug` under `id` in a Set-backed map for O(1) dedup. */
function indexSlug(map: Map<string, Set<string>>, id: string, slug: string): void {
  const existing = map.get(id)
  if (existing) {
    existing.add(slug)
  } else {
    map.set(id, new Set([slug]))
  }
}

/** Convert a Set-backed map into a plain object of sorted, deduped slug arrays. */
function finalizeSlugMap(map: Map<string, Set<string>>): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [id, slugs] of map) {
    result[id] = Array.from(slugs).sort()
  }
  return result
}

/**
 * Build a {@link TagIndex} from parsed oracle and art tag bulks by inverting each
 * tag's taggings into id → slug maps. Slug lists are sorted alphabetically.
 */
export function buildTagIndex(
  oracleTags: ScryfallTag[],
  artTags: ScryfallTag[],
  updatedAt: number,
): TagIndex {
  const oracle = new Map<string, Set<string>>()
  for (const tag of oracleTags) {
    for (const tagging of tag.taggings ?? []) {
      if (tagging.oracle_id) indexSlug(oracle, tagging.oracle_id, tag.slug)
    }
  }

  const illustration = new Map<string, Set<string>>()
  for (const tag of artTags) {
    for (const tagging of tag.taggings ?? []) {
      if (tagging.illustration_id) indexSlug(illustration, tagging.illustration_id, tag.slug)
    }
  }

  return {
    updatedAt,
    oracle: finalizeSlugMap(oracle),
    illustration: finalizeSlugMap(illustration),
  }
}

/**
 * Collect every artwork identity for a card: the top-level `illustration_id`
 * (single-faced/split cards) plus each face's `illustration_id` (double-faced cards).
 */
export function getIllustrationIds(card: ScryfallCard): string[] {
  const ids: string[] = []
  if (card.illustration_id) ids.push(card.illustration_id)
  for (const face of card.card_faces ?? []) {
    if (face.illustration_id) ids.push(face.illustration_id)
  }
  return ids
}

/**
 * Enrich a card in place with `oracleTags` (by `oracle_id`) and `artTags`
 * (unioned across all artwork ids). Fields are left unset when there are no
 * matching tags, keeping the cache lean.
 */
export function attachTags(card: ScryfallCard, index: TagIndex): void {
  const oracleTags = card.oracle_id ? index.oracle[card.oracle_id] : undefined
  if (oracleTags && oracleTags.length > 0) {
    card.oracleTags = [...oracleTags]
  } else {
    delete card.oracleTags
  }

  const artSlugs = new Set<string>()
  for (const id of getIllustrationIds(card)) {
    for (const slug of index.illustration[id] ?? []) artSlugs.add(slug)
  }
  if (artSlugs.size > 0) {
    card.artTags = Array.from(artSlugs).sort()
  } else {
    delete card.artTags
  }
}
