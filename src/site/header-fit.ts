/**
 * How much the public site's header main row has to fold to fit, above the
 * phone breakpoint (phones have their own layout; see MOBILE_LAYOUT_QUERY).
 *
 * - `full`: everything inline, the quick switch centered in the row.
 * - `folded`: the utility controls (price store, language, Edit, theme) move
 *   behind the ⚙ toggle, and the quick switch goes back in flow.
 * - `icon`: folded, and the quick switch shows its icon alone.
 *
 * Pure so it can be unit-tested: the DOM measuring lives in `useHeaderFit.ts`.
 * Listed least folded first — the order {@link decideHeaderFold} tries them in.
 */
export const HEADER_FOLDS = ['full', 'folded', 'icon'] as const

/** One fold level; {@link HEADER_FOLDS} lists them least folded first. */
export type HeaderFold = (typeof HEADER_FOLDS)[number]

/** The most folded level: what is left when nothing fits. */
const MOST_FOLDED: HeaderFold = HEADER_FOLDS[2]

/** Narrows a string (a `data-fold` value) to a fold level. */
export function isHeaderFold(value: string): value is HeaderFold {
  return (HEADER_FOLDS as readonly string[]).includes(value)
}

/** Natural (unshrunk) widths in CSS pixels, as measured from the header. */
export type HeaderFitWidths = {
  /** The main row's content width — what the items have to fit in. */
  available: number
  /** The row's column gap. */
  gap: number
  /** From the row's left edge to the nav's right edge: logo, live badge, separator, nav. */
  left: number
  /** The quick-switch button with its label and key hint. */
  quickSwitchFull: number
  /** The quick-switch button showing its icon alone. */
  quickSwitchIcon: number
  /** Each utility control (price store, language, Edit, theme) that renders. */
  utilities: readonly number[]
  /** Every other right-hand item that stays in the row at all levels (the selection menu). */
  extras: readonly number[]
  /** The ⚙ toggle that the folded levels add. */
  toggle: number
}

/**
 * The spare room, beyond the requirement, a less folded level needs before the
 * header unfolds to it. Folding happens as soon as a level stops fitting; the
 * margin only delays unfolding, so a width sitting on the boundary — or a
 * classic scrollbar (≤ 17px) appearing because the fold changed the page —
 * can never make it flap.
 */
export const UNFOLD_SLACK = 24

/** Items laid out side by side with `gap` between them; zero-width items take no slot. */
function packedWidth(items: readonly number[], gap: number): number {
  const present = items.filter((width) => width > 0)
  if (present.length === 0) return 0
  return present.reduce((sum, width) => sum + width, 0) + gap * (present.length - 1)
}

/** The row width a level needs to lay its items out without overlap. */
export function requiredHeaderWidth(level: HeaderFold, widths: HeaderFitWidths): number {
  const { gap, left } = widths
  switch (level) {
    case 'full': {
      // The quick switch is centered in the row, out of flow: each side needs
      // half the row minus half the button, so the wider side sets the width.
      const right = packedWidth([...widths.utilities, ...widths.extras], gap)
      return 2 * Math.max(left, right) + widths.quickSwitchFull + 2 * gap
    }
    case 'folded':
    case 'icon': {
      // In flow: the nav, the quick switch, then the right-hand items.
      const quickSwitch = level === 'folded' ? widths.quickSwitchFull : widths.quickSwitchIcon
      const right = packedWidth([...widths.extras, widths.toggle], gap)
      return left + gap + quickSwitch + gap + right
    }
  }
}

/**
 * The least folded level that fits, given the level in force now. A level less
 * folded than `current` must fit with {@link UNFOLD_SLACK} to spare. When
 * nothing fits, the most folded level is the best there is.
 */
export function decideHeaderFold(widths: HeaderFitWidths, current: HeaderFold): HeaderFold {
  const currentRank = HEADER_FOLDS.indexOf(current)
  for (const [rank, level] of HEADER_FOLDS.entries()) {
    const slack = rank < currentRank ? UNFOLD_SLACK : 0
    if (requiredHeaderWidth(level, widths) + slack <= widths.available) return level
  }
  return MOST_FOLDED
}
