import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'
import { parseEnumField } from '../util/parse-enum'
import type { ScryfallCard } from '../scryfall/types'

export type Finish = 'nonfoil' | 'foil' | 'etched'
export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'
/** A condition to set, or `'NONE'` to clear the condition. */
export type ConditionUpdate = Condition | 'NONE'

export const VALID_FINISHES = ['nonfoil', 'foil', 'etched'] as const satisfies readonly Finish[]
export const VALID_CONDITIONS = [
  'NM',
  'LP',
  'MP',
  'HP',
  'DMG',
] as const satisfies readonly Condition[]

/**
 * Message keys for the condition codes, shared by every condition prompt. Keys
 * rather than rendered text: the table is evaluated once at module load, so a
 * string here would freeze every condition menu in the boot-time language.
 * Resolve with {@link conditionLabel}.
 */
export const CONDITION_LABELS = {
  NM: 'domain.condition.nm',
  LP: 'domain.condition.lp',
  MP: 'domain.condition.mp',
  HP: 'domain.condition.hp',
  DMG: 'domain.condition.dmg',
} as const satisfies Record<Condition, MessageKey>

/** A condition code's human-readable name in the active UI locale. */
export function conditionLabel(condition: Condition): string {
  return t(CONDITION_LABELS[condition])
}

export function isFinish(value: string | undefined): value is Finish {
  return value !== undefined && (VALID_FINISHES as readonly string[]).includes(value)
}

/**
 * Parse a raw `--finish` flag value: case-insensitive, must be one of
 * {@link VALID_FINISHES}. Returns the normalized finish, or an error message
 * string (discriminate with {@link isFinish}) — callers wrap it in their own
 * error type (commander's `InvalidArgumentError` vs `CardCommandError`).
 *
 * Delegates to {@link parseEnumField} so both the case-insensitive matching rule
 * and the refusal's wording come from the one place every other fixed-choice
 * option in the project gets them — this used to hand-roll an untranslated twin
 * of `errors.enum.invalid`.
 */
export function normalizeFinishValue(raw: string): Finish | string {
  const result = parseEnumField(raw, VALID_FINISHES, 'finish')
  return result.ok ? result.value : result.message
}

export function isCondition(value: string | undefined): value is Condition {
  return value !== undefined && (VALID_CONDITIONS as readonly string[]).includes(value)
}

/**
 * Resolve a condition update against an entry's current grade: `undefined`
 * leaves it alone, `'NONE'` clears it, and a grade replaces it. The one place
 * the `'NONE'` sentinel is interpreted, shared by every apply path.
 *
 * Typed on {@link ConditionUpdate} so a caller cannot reach the clearing branch
 * with an unvalidated string by accident; the runtime {@link isCondition} check
 * stays as a backstop for values that crossed a wire boundary.
 */
export function applyConditionUpdate(
  update: ConditionUpdate | undefined,
  current: Condition | undefined,
): Condition | undefined {
  if (update === undefined) return current
  return isCondition(update) ? update : undefined
}

/**
 * The finishes a printing's cache entry declares, with unknown tokens dropped
 * and no default applied: an entry with no usable finish data yields `[]`.
 * For the prompts that treat "nothing declared" as its own case (the wanted
 * finish picker answers "no preference"); everything that wants a finish to
 * read a card at goes through {@link printingFinishes}.
 */
export function declaredFinishes(printing: ScryfallCard): Finish[] {
  return (printing.finishes ?? []).filter(isFinish)
}

/**
 * The finishes a printing is actually offered in. Cache entries that carry no
 * usable finish data are treated as plain nonfoil, matching the default the
 * finish prompts fall back to.
 */
export function printingFinishes(printing: ScryfallCard): Finish[] {
  const available = declaredFinishes(printing)
  return available.length > 0 ? available : ['nonfoil']
}

/**
 * The finish a printing is read at when none has been chosen: nonfoil when the
 * printing is offered in it, otherwise its first finish — foil-only and
 * etched-only printings have no nonfoil price to quote.
 *
 * Shared by collection pricing (via {@link displayFinish}) and the interactive
 * pickers' price column, so a printing is never quoted at one finish in a list
 * total and a different one in the prompt that added it. The site's
 * trade planner deliberately keeps its own `defaultFinishForCard`: that one ranks
 * nonfoil > foil > etched because its result decides whether a finish token is
 * omitted from a shared trade URL, which is an encoding contract rather than a
 * display choice.
 */
export function defaultPrintingFinish(printing: ScryfallCard): Finish {
  const finishes = printingFinishes(printing)
  return finishes.includes('nonfoil') ? 'nonfoil' : finishes[0]!
}

/**
 * The finish a copy actually is: the entry's own when it states one, else the
 * printing's default (a foil-only printing is foil, not nonfoil), else nonfoil
 * when there is no printing to ask.
 *
 * The single answer to "what finish is this?" across the whole codebase —
 * collection and wanted pricing, the collection sync diff, `ritual sell`'s
 * matcher, every producer of a buylist quote key (the request builder, the tile
 * fields, the cart export), and the copies filter's `finish` mode. When callers
 * disagree, the same card gets asked for under one key and looked up under
 * another, which reads as "not on the buylist" on a card whose tile shows a
 * price. A missing printing is passed as null or undefined interchangeably —
 * both mean the same thing here, and callers get it from lookups that return
 * either.
 */
export function displayFinish(
  printing: ScryfallCard | null | undefined,
  finish: Finish | undefined,
): Finish {
  if (finish !== undefined) return finish
  return printing ? defaultPrintingFinish(printing) : 'nonfoil'
}

/**
 * Whether a finish is a claim about a *specific printing*. `nonfoil` is the
 * absence of such a claim — clearing a line back to plain — so it is the one
 * finish a name-only line can carry meaningfully.
 *
 * The single rule behind "you cannot make a card foil before you say which
 * card it is": the change-apply engines refuse a `set-finish` that would put a
 * foil/etched token on a line that pins no printing, the CLI's one-shot
 * `set-card --finish` refuses the same edit, and the two site menus grey out
 * the action rather than let a user reach a refusal.
 */
export function finishRequiresPrinting(finish: Finish): boolean {
  return finish !== 'nonfoil'
}

/**
 * A finish's display name. A key table rather than `capitalize(finish)`: the
 * slugs are file-format vocabulary that must never move, and capitalising one
 * leaves a translator with no string to translate at all (plan §7.3).
 */
const FINISH_LABELS = {
  nonfoil: 'cli.session.finishNonfoil',
  foil: 'cli.session.finishFoil',
  etched: 'cli.session.finishEtched',
} as const satisfies Record<Finish, MessageKey>

/** A finish's display name in the active UI locale. */
export function finishLabel(finish: Finish): string {
  return t(FINISH_LABELS[finish])
}
