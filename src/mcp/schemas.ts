import { z } from 'zod'
import { DECK_FORMAT_KEYS } from '../list/deck-format'
import {
  CARD_LABELS,
  checkLabelsForListType,
  isCardLabel,
  unsupportedLabelsMessage,
} from '../card/card-labels'
import { CARD_LANGUAGES } from '../card/card-language'
import { VALID_CONDITIONS, VALID_FINISHES } from '../card/finish-condition'
import { isListType } from '../list/list-type'
import { VALID_CURRENCIES } from '../pricing/price-currency'
import type { ListImageRef } from '../list/list-image'

/**
 * Shared zod field schemas composed into each tool's `inputSchema` object.
 * Centralizing them keeps the card-identity and printing fields consistent across
 * the add/remove/set/move tools and their descriptions in one place.
 */

export const listTypeSchema = z.enum(['deck', 'collection', 'wanted'])
/** Derived from the canonical currency list, so the tool schema cannot drift from it. */
export const currencySchema = z.enum(VALID_CURRENCIES)
export const finishSchema = z.enum(VALID_FINISHES)
export const conditionSchema = z.enum(VALID_CONDITIONS)
/**
 * A condition *update*: a grade, or `NONE` to clear a recorded grade — the same
 * vocabulary `ritual set-card --condition` accepts. Only the set-printing paths
 * take it; an `add` records a grade and has none to clear.
 */
export const conditionUpdateSchema = z.enum([...VALID_CONDITIONS, 'NONE'])
/** Derived from the canonical format list, so the tool schema cannot drift from it. */
export const deckFormatSchema = z.enum(DECK_FORMAT_KEYS)
/** Derived from the canonical label vocabulary, so the tool schema cannot drift from it. */
export const cardLabelSchema = z.enum(CARD_LABELS)
/**
 * A label-override *update*: the new override, where `sale` and `trade` combine
 * and `keep`/`proxy` each stand alone, or an empty array to clear the override
 * so the list's front-matter default applies again. Which labels a list type
 * carries is enforced by {@link refineLabelsForListType}.
 */
export const labelsUpdateField = z
  .array(cardLabelSchema)
  .describe(
    'New label override: "sale"/"trade" (combinable), "keep" or "proxy" (each exclusive). ' +
      'An empty array clears the override (the list default applies). Collections take the ' +
      'whole vocabulary; decks take "proxy" alone; wanted lists carry no labels.',
  )
/**
 * A label override attached to a newly added card — unlike
 * {@link labelsUpdateField} there is no override to clear, so an empty array is
 * rejected rather than meaning "clear".
 */
export const labelsOverrideField = z
  .array(cardLabelSchema)
  .min(1)
  .optional()
  .describe(
    'Label override for the new card: "sale"/"trade" (combinable), "keep" or "proxy" ' +
      '(each exclusive). Collections take the whole vocabulary, decks "proxy" alone; ' +
      'omit to inherit the list default.',
  )

export const DECK_ONLY_FORMAT_MESSAGE = 'format is only valid when listType is "deck".'

/** A custom cross-field issue as the shared refinements report it. */
type RefinementIssue = { code: 'custom'; message: string }

/** The subset of a refinement context the shared refinements need (zod-version-agnostic). */
type RefinementIssueSink = { addIssue: (issue: RefinementIssue) => void }

/** The fields the deck-only `format` rule inspects. */
type ListTypeWithFormat = { listType: string; format?: unknown }

/**
 * Shared cross-field rule: `format` may only accompany `listType: "deck"`.
 * Used by every tool whose schema pairs a list type with an optional deck format.
 */
export function refineDeckOnlyFormat(val: ListTypeWithFormat, ctx: RefinementIssueSink): void {
  if (val.format !== undefined && val.listType !== 'deck') {
    ctx.addIssue({ code: 'custom', message: DECK_ONLY_FORMAT_MESSAGE })
  }
}

/** The fields the per-type labels rule inspects. */
type ListTypeWithLabels = { listType: string; labels?: readonly string[] }

/**
 * Shared cross-field rule: a `labels` field may only name labels `listType`
 * carries — the whole vocabulary on a collection, `proxy` alone on a deck, none
 * on a wanted list. The decision itself is `checkLabelsForListType` and the
 * wording `unsupportedLabelsMessage`, so the CLI, the admin routes, the bundle
 * importer, and the tools refuse exactly the same sets in the same words; this
 * only reports the outcome as a zod issue.
 */
export function refineLabelsForListType(val: ListTypeWithLabels, ctx: RefinementIssueSink): void {
  const { labels, listType } = val
  // An unknown list type is the enum's own issue to report, not this rule's.
  // The element enum has likewise already refused any non-label string, so the
  // survivors are label values.
  if (labels === undefined || !isListType(listType)) return
  const check = checkLabelsForListType(listType, labels.filter(isCardLabel))
  if (!check.ok) {
    ctx.addIssue({ code: 'custom', message: unsupportedLabelsMessage(listType, check.unsupported) })
  }
}

/** One list addressed like CLI list arguments, optionally pinned to a type. */
export const listRefSchema = z.object({
  listType: listTypeSchema.optional().describe('Pin the list type of an ambiguous name.'),
  name: z
    .string()
    .min(1)
    .describe('List name (matched like CLI list arguments; a slug/file basename also works).'),
})

export type ListRefInput = z.infer<typeof listRefSchema>

export const slugField = z
  .string()
  .min(1)
  .describe('List slug — the markdown file basename without ".md".')

export const cardNameField = z
  .string()
  .min(1)
  .describe(
    'Card name. Edits and removals match the entry name exactly (case-sensitive) — copy it from ' +
      'get_list. Validated against the local card cache: an unknown name is rejected with the ' +
      'closest cached names, unless the name is already in the list being edited.',
  )

/** The `&N` id's numeric shape, shared by the optional and required spellings. */
const cardIdNumber = z
  .number()
  .int()
  .positive()
  // Bounded so the advertised schema shows a meaningful ceiling rather than
  // JavaScript's MAX_SAFE_INTEGER: &N ids are per-file sequence numbers.
  .max(1_000_000)

export const cardIdField = cardIdNumber
  .optional()
  .describe('Disambiguate by the persistent card ID (the &N suffix in list files).')

/**
 * The `&N` id as a *required* target, for a tool that addresses a card by id
 * alone rather than by name.
 */
export const cardIdTargetField = cardIdNumber.describe(
  'The card line’s persistent card ID (the &N suffix; get_list reports it). Ids are recycled ' +
    'after removals, so take one from a current get_list read.',
)

/**
 * A list's cover image override, in exactly the value space the front matter,
 * the `PUT /api/metadata/:type/:slug` body and the editors all speak: a
 * single-key mapping naming a card line in the list (`&N`), a file under the
 * configured art directory, or an absolute URL. There is deliberately no scalar
 * spelling and no `"default"` — a cover reverts to the built-in rule (commander,
 * else the most expensive printing) by sending `null`, which is the same
 * null-clears encoding every other metadata field uses.
 *
 * The three arms are `.strict()` so a typo'd key (`{ crd: 3 }`) is refused here
 * with the field named rather than reaching the route as a mapping with no
 * recognized key. Everything the schema cannot know — whether the `&N` is a line
 * this list actually has, whether the path has a servable extension — is the
 * route's own 400, since validation lives once, in the handler.
 */
export const listImageSchema = z.union([
  z.object({ card: cardIdNumber.describe('The &N id of a card line in this list.') }).strict(),
  z
    .object({ file: z.string().min(1).describe('Image path relative to the art directory.') })
    .strict(),
  z
    .object({
      url: z
        .string()
        .url()
        // http(s) only, the same rule `parseCardArtRef` enforces: advertising a
        // bare `z.url()` would accept `mailto:` here and have the route refuse
        // it with a 400 the schema said was fine.
        .refine((value) => /^https?:\/\//i.test(value), {
          message: 'must be an absolute http(s) URL',
        })
        .describe('Absolute http(s) image URL, used verbatim.'),
    })
    .strict(),
  // Pinned to the engine union: a fourth mode, or a renamed key, is a compile
  // error here rather than a schema that silently stopped describing the value.
]) satisfies z.ZodType<ListImageRef>

/**
 * A required set code — the array-element form: `z.array(setCodeField)`.
 * Wrapping the optional {@link setField} in an array would admit `undefined`
 * elements.
 */
export const setCodeField = z
  .string()
  .toLowerCase()
  .describe('Set code, e.g. "mkm". Normalized to lowercase.')

export const setField = setCodeField
  .optional()
  .describe(
    'Set code, e.g. "mkm". Normalized to lowercase; pair with collectorNumber to pin a printing.',
  )

/** One list addressed exactly, by type + slug (no name matching). */
export const listSlugRefSchema = z.object({
  listType: listTypeSchema,
  slug: slugField,
})

export const collectorNumberField = z
  .string()
  .optional()
  .describe('Collector number within the set. Pair with set to pin a specific printing.')

export const finishField = finishSchema.optional().describe('Finish; defaults to nonfoil.')

/** Derived from the canonical language vocabulary, so the tool schema cannot drift from it. */
export const languageSchema = z.enum(CARD_LANGUAGES)

export const languageField = languageSchema
  .optional()
  .describe(
    'Scryfall language code (e.g. "ja"; "zhs"/"zht" for Chinese). Omitted (or "en") means ' +
      'English — a card line only carries a language token when it is not English. Adding never ' +
      'prompts for a language: the defaultLanguage config key stamps new cards.',
  )

export const conditionField = conditionSchema
  .optional()
  .describe('Condition grade; defaults to NM.')

/** The set-printing flavour of {@link conditionField}, which can also clear a grade. */
export const conditionUpdateField = conditionUpdateSchema
  .optional()
  .describe(
    'Condition grade, or "NONE" to clear a recorded grade. Omit to leave the current grade ' +
      'alone. NM is the unrecorded default, so setting NM also leaves the line ungraded.',
  )

export const sectionField = z
  .string()
  .optional()
  .describe('Section (markdown "## Section") to place the card in. Defaults to the main section.')

export const quantityField = z
  .number()
  .int()
  .min(1)
  // A bound no real deck or collection edit reaches, so the advertised schema
  // shows a number an agent can read instead of MAX_SAFE_INTEGER.
  .max(1_000)
  .default(1)
  .describe('Number of copies (default 1). Applied as one change per copy in a single save.')

export const copyIndexField = z
  .number()
  .int()
  .min(0)
  .max(10_000)
  .optional()
  .describe('Which copy of a deck line to target (0-based) when its quantity is above 1.')
