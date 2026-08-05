// Metadata for every CSS variable exposed in the theme editor.
//
// The editor reads this list to know which variables exist, how they are
// grouped, what controls to render, and what description to show users.
// New themable variables MUST be added here — if a value is referenced
// from CSS via `var(--…)`, it should be in this list.

export type ThemeVarType = 'color' | 'length'

/** Units a `length` theme variable may be authored in. */
export type LengthUnit = 'px' | '%'

export type ThemeVarMeta = {
  /** CSS custom property name, e.g. `--bg-body`. */
  name: string
  /** Short user-facing label shown in the editor. */
  label: string
  /** One-sentence description shown in the editor's tooltip / details pane. */
  description: string
  /** Group key used to bucket variables under tabs in the editor toolbar. */
  group: ThemeVarGroupId
  /** Control type — determines the picker rendered for this variable. */
  type: ThemeVarType
  /** CSS unit for `length` variables. Defaults to `px`. */
  unit?: LengthUnit
}

export type ThemeVarGroupId =
  | 'surfaces'
  | 'borders'
  | 'text'
  | 'accent'
  | 'buttons'
  | 'status'
  | 'labels'
  | 'overlays'
  | 'modals'
  | 'flame'
  | 'misc'

export type ThemeVarGroup = {
  id: ThemeVarGroupId
  label: string
  description: string
}

export const themeVarGroups: ThemeVarGroup[] = [
  {
    id: 'surfaces',
    label: 'Surfaces',
    description: 'Page and panel backgrounds at every interaction depth.',
  },
  {
    id: 'borders',
    label: 'Borders',
    description: 'Border, separator, and focus-outline colors.',
  },
  {
    id: 'text',
    label: 'Text',
    description: 'Foreground text colors at varying emphasis levels.',
  },
  {
    id: 'accent',
    label: 'Accent',
    description: 'Highlight color used for links, focus rings, and visual emphasis.',
  },
  {
    id: 'buttons',
    label: 'Buttons',
    description: 'Surfaces and labels for the various button styles.',
  },
  {
    id: 'status',
    label: 'Status',
    description:
      'Success and error semantic colors. Bright on dark themes, deep on light themes for legibility.',
  },
  {
    id: 'overlays',
    label: 'Overlays',
    description:
      'Translucent dark scrims — and the text drawn on them — for modals, tooltips, and gradients on top of card art. Universal across themes.',
  },
  {
    id: 'modals',
    label: 'Modals',
    description: 'Corner rounding and drop-shadow shared by every modal dialog.',
  },
  {
    id: 'flame',
    label: 'Flame icon',
    description:
      'Gradient stops for the app’s candle-flame logo and browser-tab favicon. Derived from the accent by default; the flame recolors live as you edit them.',
  },
  {
    id: 'labels',
    label: 'Labels',
    description:
      'Tones for the For sale / For trade / To keep badges on collection cards and trade rows.',
  },
  { id: 'misc', label: 'Misc', description: 'Sizing tokens and other non-color values.' },
]

export const themeVarMetadata: ThemeVarMeta[] = [
  // ----- Surfaces -----
  {
    name: '--bg-body',
    label: 'Page background',
    description: 'The main background filling the entire viewport.',
    group: 'surfaces',
    type: 'color',
  },
  {
    name: '--bg-panel',
    label: 'Panel background',
    description: 'Background for raised surfaces — modals, sidebars, deck covers.',
    group: 'surfaces',
    type: 'color',
  },
  {
    name: '--bg-hover',
    label: 'Hover background',
    description: 'Subtle hover state for list rows, buttons, and other interactive surfaces.',
    group: 'surfaces',
    type: 'color',
  },
  {
    name: '--bg-active',
    label: 'Active background',
    description:
      'Pressed / selected state — accent-tinted to signal an active selection (e.g. an active toolbar button).',
    group: 'surfaces',
    type: 'color',
  },
  {
    name: '--bg-subtle',
    label: 'Subtle background',
    description: 'Slightly recessed surface, used for inputs and inset areas.',
    group: 'surfaces',
    type: 'color',
  },

  // ----- Borders -----
  {
    name: '--border',
    label: 'Default border',
    description: 'Standard 1px borders between panels, cards, and inputs.',
    group: 'borders',
    type: 'color',
  },
  {
    name: '--border-hover',
    label: 'Hover border',
    description: 'Border color when an interactive surface is hovered.',
    group: 'borders',
    type: 'color',
  },
  {
    name: '--border-focus',
    label: 'Focus border',
    description: 'Border color around the actively focused input or control.',
    group: 'borders',
    type: 'color',
  },
  {
    name: '--border-separator',
    label: 'Separator',
    description: 'Faint horizontal rules between rows in lists and modals.',
    group: 'borders',
    type: 'color',
  },

  // ----- Text -----
  {
    name: '--text-primary',
    label: 'Primary text',
    description: 'Highest-emphasis text — headings and key labels.',
    group: 'text',
    type: 'color',
  },
  {
    name: '--text-body',
    label: 'Body text',
    description: 'Default body copy color.',
    group: 'text',
    type: 'color',
  },
  {
    name: '--text-secondary',
    label: 'Secondary text',
    description: 'De-emphasised text — subtitles, helper text.',
    group: 'text',
    type: 'color',
  },
  {
    name: '--text-muted',
    label: 'Muted text',
    description: 'Quiet metadata text — counts, file paths, set codes.',
    group: 'text',
    type: 'color',
  },
  {
    name: '--text-dim',
    label: 'Dim text',
    description: 'Lowest-emphasis text — placeholders and inactive labels.',
    group: 'text',
    type: 'color',
  },
  {
    name: '--text-accent',
    label: 'Accent text',
    description: 'Accent-colored text used for tag labels, quantity badges, and links.',
    group: 'text',
    type: 'color',
  },

  // ----- Accent -----
  {
    name: '--accent',
    label: 'Accent',
    description:
      'The primary highlight color of the theme. Used for focus rings, primary links, and emphasis.',
    group: 'accent',
    type: 'color',
  },
  {
    name: '--accent-hover',
    label: 'Accent hover',
    description: 'Accent color shifted slightly for hover states.',
    group: 'accent',
    type: 'color',
  },
  {
    name: '--accent-dim',
    label: 'Accent dim',
    description: 'Dimmed accent color for borders and subtle emphasis.',
    group: 'accent',
    type: 'color',
  },
  {
    name: '--card-link',
    label: 'Card link',
    description:
      'Blue hyperlink color for card names (e.g. in the changes dialog). Deep on light themes, soft on dark themes.',
    group: 'accent',
    type: 'color',
  },
  {
    name: '--card-link-hover',
    label: 'Card link hover',
    description: 'Hover color for card-name hyperlinks.',
    group: 'accent',
    type: 'color',
  },
  {
    name: '--progress-end',
    label: 'Progress bar end',
    description:
      'Far end of the progress-bar gradient (the near end is the accent). A fixed teal across themes.',
    group: 'accent',
    type: 'color',
  },

  // ----- Buttons -----
  {
    name: '--btn-bg',
    label: 'Button surface',
    description: 'Background for the default secondary buttons.',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-hover',
    label: 'Button hover',
    description: 'Hover background for default secondary buttons.',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-text',
    label: 'Button label',
    description: 'Text color on default secondary buttons.',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-primary',
    label: 'Primary button',
    description: 'Background for primary call-to-action buttons.',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-primary-hover',
    label: 'Primary button hover',
    description: 'Hover state for primary call-to-action buttons.',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-danger',
    label: 'Danger button',
    description: 'Background for destructive action buttons.',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-danger-hover',
    label: 'Danger button hover',
    description: 'Hover state for destructive action buttons.',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-export',
    label: 'Export button',
    description: 'Background for export/download buttons.',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-export-hover',
    label: 'Export button hover',
    description: 'Hover state for export/download buttons.',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-add',
    label: 'Add button',
    description: 'Background for "Add" / success buttons. Universal green.',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-add-hover',
    label: 'Add button hover',
    description: 'Hover state for "Add" / success buttons.',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-on-color-text',
    label: 'On-color label',
    description:
      'Text color used on saturated colored buttons (primary / add / export). Should contrast with the button background, not the page background.',
    group: 'buttons',
    type: 'color',
  },

  // ----- Status -----
  {
    name: '--success-bg',
    label: 'Success background',
    description: 'Translucent green background for success banners.',
    group: 'status',
    type: 'color',
  },
  {
    name: '--success-border',
    label: 'Success border',
    description: 'Border for success banners and badges.',
    group: 'status',
    type: 'color',
  },
  {
    name: '--success-text',
    label: 'Success text',
    description: 'Green text for prices, confirmations, and additions.',
    group: 'status',
    type: 'color',
  },
  {
    name: '--error',
    label: 'Error',
    description: 'Solid error/danger color used in destructive button hovers.',
    group: 'status',
    type: 'color',
  },
  {
    name: '--error-bg',
    label: 'Error background',
    description: 'Translucent red background for error banners and danger buttons.',
    group: 'status',
    type: 'color',
  },
  {
    name: '--error-border',
    label: 'Error border',
    description: 'Border for error banners and danger buttons.',
    group: 'status',
    type: 'color',
  },
  {
    name: '--error-text',
    label: 'Error text',
    description: 'Red text used for warnings and removal markers.',
    group: 'status',
    type: 'color',
  },
  {
    name: '--warning-bg',
    label: 'Warning background',
    description:
      'Translucent amber background for cautionary notices (e.g. stale prices, missing tag data).',
    group: 'status',
    type: 'color',
  },
  {
    name: '--warning-border',
    label: 'Warning border',
    description: 'Border for cautionary notice banners.',
    group: 'status',
    type: 'color',
  },
  {
    name: '--warning-text',
    label: 'Warning text',
    description: 'Amber text for cautionary notice banners.',
    group: 'status',
    type: 'color',
  },

  // ----- Labels -----
  {
    name: '--label-sale',
    label: 'For sale',
    description: 'Tone of the SALE badge on collection cards labeled for sale.',
    group: 'labels',
    type: 'color',
  },
  {
    name: '--label-trade',
    label: 'For trade',
    description: 'Tone of the TRADE badge on collection cards labeled for trade.',
    group: 'labels',
    type: 'color',
  },
  {
    name: '--label-keep',
    label: 'To keep',
    description:
      'Tone of the KEEP badge on collection cards labeled to keep, and the Keep tag on trade rows.',
    group: 'labels',
    type: 'color',
  },

  // ----- Overlays -----
  {
    name: '--overlay-light',
    label: 'Light overlay',
    description: 'Translucent dark scrim for shadows and small backdrops.',
    group: 'overlays',
    type: 'color',
  },
  {
    name: '--overlay-medium',
    label: 'Medium overlay',
    description: 'Translucent dark scrim for tooltips and hover backdrops.',
    group: 'overlays',
    type: 'color',
  },
  {
    name: '--overlay-heavy',
    label: 'Heavy overlay',
    description: 'Strong dark scrim for modal backdrops and image gradients.',
    group: 'overlays',
    type: 'color',
  },
  {
    name: '--card-label-text',
    label: 'Card label text',
    description:
      'Card name shown on the hover label over card art. Stays bright on every theme so it reads against the dark scrim.',
    group: 'overlays',
    type: 'color',
  },
  {
    name: '--card-label-meta',
    label: 'Card label meta',
    description: 'Secondary detail (e.g. foil/etched finish) on the card hover label.',
    group: 'overlays',
    type: 'color',
  },
  {
    name: '--card-label-price',
    label: 'Card label price',
    description: 'Price shown on the card hover label — a universally bright green.',
    group: 'overlays',
    type: 'color',
  },
  {
    name: '--card-label-buylist',
    label: 'Card buylist price',
    description:
      'Buylist offer shown beside the retail price in sell mode — a universally bright amber.',
    group: 'overlays',
    type: 'color',
  },

  // ----- Modals -----
  {
    name: '--modal-radius',
    label: 'Modal radius',
    description: 'Corner rounding of modal dialog panels.',
    group: 'modals',
    type: 'length',
    unit: 'px',
  },
  {
    name: '--modal-shadow-color',
    label: 'Modal shadow',
    description: 'Tint of the drop shadow cast by modal dialog panels.',
    group: 'modals',
    type: 'color',
  },

  // ----- Flame icon -----
  {
    name: '--flame-outer-1',
    label: 'Flame body (bright)',
    description: 'Brightest part of the flame’s dark outer body, near the inner core.',
    group: 'flame',
    type: 'color',
  },
  {
    name: '--flame-outer-2',
    label: 'Flame body (mid)',
    description: 'Mid tone of the flame’s outer body.',
    group: 'flame',
    type: 'color',
  },
  {
    name: '--flame-outer-3',
    label: 'Flame body (edge)',
    description: 'Darkest tone at the outer edge of the flame.',
    group: 'flame',
    type: 'color',
  },
  {
    name: '--flame-inner-1',
    label: 'Flame core (hot)',
    description: 'The hot, near-white center of the flame’s glowing inner core.',
    group: 'flame',
    type: 'color',
  },
  {
    name: '--flame-inner-2',
    label: 'Flame core (glow)',
    description: 'Mid glow of the flame’s inner core.',
    group: 'flame',
    type: 'color',
  },
  {
    name: '--flame-inner-3',
    label: 'Flame core (base)',
    description: 'Saturated base of the flame’s inner core.',
    group: 'flame',
    type: 'color',
  },

  // ----- Misc -----
  {
    name: '--card-radius',
    label: 'Card radius',
    description:
      'Corner rounding of card images, as a percentage of the card width, so it scales with the card at every display size.',
    group: 'misc',
    type: 'length',
    unit: '%',
  },
]

// Lookup: variable name → metadata.
export const themeVarsByName: Record<string, ThemeVarMeta> = Object.fromEntries(
  themeVarMetadata.map((m) => [m.name, m]),
)

// Lookup: group id → variables in that group.
export const themeVarsByGroup: Record<ThemeVarGroupId, ThemeVarMeta[]> = themeVarGroups.reduce(
  (acc, group) => {
    acc[group.id] = themeVarMetadata.filter((m) => m.group === group.id)
    return acc
  },
  {} as Record<ThemeVarGroupId, ThemeVarMeta[]>,
)
