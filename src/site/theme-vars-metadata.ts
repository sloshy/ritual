// Metadata for every CSS variable exposed in the theme editor.
//
// The editor reads this list to know which variables exist, how they are
// grouped, what controls to render, and what description to show users.
// New themable variables MUST be added here — if a value is referenced
// from CSS via `var(--…)`, it should be in this list.
//
// This table is evaluated once at import, so it holds message *keys* rather
// than rendered text (plan §7.2): `ThemeEditor` resolves them through `useTKey`
// at render time, which is what lets a locale switch relabel the editor.

import type { MessageKey } from '../i18n/messages/en'

export type ThemeVarType = 'color' | 'length'

/** Units a `length` theme variable may be authored in. */
export type LengthUnit = 'px' | '%'

/** A `site.themeVar.*` or `site.themeGroup.*` catalog key. */
export type ThemeVarMessageKey = Extract<MessageKey, `site.theme${'Var' | 'Group'}.${string}`>

export type ThemeVarMeta = {
  /** CSS custom property name, e.g. `--bg-body`. */
  name: string
  /** Short user-facing label shown in the editor. */
  label: ThemeVarMessageKey
  /** One-sentence description shown in the editor's tooltip / details pane. */
  description: ThemeVarMessageKey
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
  label: ThemeVarMessageKey
  description: ThemeVarMessageKey
}

export const themeVarGroups: ThemeVarGroup[] = [
  {
    id: 'surfaces',
    label: 'site.themeGroup.surfaces.label',
    description: 'site.themeGroup.surfaces.description',
  },
  {
    id: 'borders',
    label: 'site.themeGroup.borders.label',
    description: 'site.themeGroup.borders.description',
  },
  {
    id: 'text',
    label: 'site.themeGroup.text.label',
    description: 'site.themeGroup.text.description',
  },
  {
    id: 'accent',
    label: 'site.themeGroup.accent.label',
    description: 'site.themeGroup.accent.description',
  },
  {
    id: 'buttons',
    label: 'site.themeGroup.buttons.label',
    description: 'site.themeGroup.buttons.description',
  },
  {
    id: 'status',
    label: 'site.themeGroup.status.label',
    description: 'site.themeGroup.status.description',
  },
  {
    id: 'overlays',
    label: 'site.themeGroup.overlays.label',
    description: 'site.themeGroup.overlays.description',
  },
  {
    id: 'modals',
    label: 'site.themeGroup.modals.label',
    description: 'site.themeGroup.modals.description',
  },
  {
    id: 'flame',
    label: 'site.themeGroup.flame.label',
    description: 'site.themeGroup.flame.description',
  },
  {
    id: 'labels',
    label: 'site.themeGroup.labels.label',
    description: 'site.themeGroup.labels.description',
  },
  {
    id: 'misc',
    label: 'site.themeGroup.misc.label',
    description: 'site.themeGroup.misc.description',
  },
]

export const themeVarMetadata: ThemeVarMeta[] = [
  // ----- Surfaces -----
  {
    name: '--bg-body',
    label: 'site.themeVar.bgBody.label',
    description: 'site.themeVar.bgBody.description',
    group: 'surfaces',
    type: 'color',
  },
  {
    name: '--bg-panel',
    label: 'site.themeVar.bgPanel.label',
    description: 'site.themeVar.bgPanel.description',
    group: 'surfaces',
    type: 'color',
  },
  {
    name: '--bg-hover',
    label: 'site.themeVar.bgHover.label',
    description: 'site.themeVar.bgHover.description',
    group: 'surfaces',
    type: 'color',
  },
  {
    name: '--bg-active',
    label: 'site.themeVar.bgActive.label',
    description: 'site.themeVar.bgActive.description',
    group: 'surfaces',
    type: 'color',
  },
  {
    name: '--bg-subtle',
    label: 'site.themeVar.bgSubtle.label',
    description: 'site.themeVar.bgSubtle.description',
    group: 'surfaces',
    type: 'color',
  },

  // ----- Borders -----
  {
    name: '--border',
    label: 'site.themeVar.border.label',
    description: 'site.themeVar.border.description',
    group: 'borders',
    type: 'color',
  },
  {
    name: '--border-hover',
    label: 'site.themeVar.borderHover.label',
    description: 'site.themeVar.borderHover.description',
    group: 'borders',
    type: 'color',
  },
  {
    name: '--border-focus',
    label: 'site.themeVar.borderFocus.label',
    description: 'site.themeVar.borderFocus.description',
    group: 'borders',
    type: 'color',
  },
  {
    name: '--border-separator',
    label: 'site.themeVar.borderSeparator.label',
    description: 'site.themeVar.borderSeparator.description',
    group: 'borders',
    type: 'color',
  },

  // ----- Text -----
  {
    name: '--text-primary',
    label: 'site.themeVar.textPrimary.label',
    description: 'site.themeVar.textPrimary.description',
    group: 'text',
    type: 'color',
  },
  {
    name: '--text-body',
    label: 'site.themeVar.textBody.label',
    description: 'site.themeVar.textBody.description',
    group: 'text',
    type: 'color',
  },
  {
    name: '--text-secondary',
    label: 'site.themeVar.textSecondary.label',
    description: 'site.themeVar.textSecondary.description',
    group: 'text',
    type: 'color',
  },
  {
    name: '--text-muted',
    label: 'site.themeVar.textMuted.label',
    description: 'site.themeVar.textMuted.description',
    group: 'text',
    type: 'color',
  },
  {
    name: '--text-dim',
    label: 'site.themeVar.textDim.label',
    description: 'site.themeVar.textDim.description',
    group: 'text',
    type: 'color',
  },
  {
    name: '--text-accent',
    label: 'site.themeVar.textAccent.label',
    description: 'site.themeVar.textAccent.description',
    group: 'text',
    type: 'color',
  },

  // ----- Accent -----
  {
    name: '--accent',
    label: 'site.themeVar.accent.label',
    description: 'site.themeVar.accent.description',
    group: 'accent',
    type: 'color',
  },
  {
    name: '--accent-hover',
    label: 'site.themeVar.accentHover.label',
    description: 'site.themeVar.accentHover.description',
    group: 'accent',
    type: 'color',
  },
  {
    name: '--accent-dim',
    label: 'site.themeVar.accentDim.label',
    description: 'site.themeVar.accentDim.description',
    group: 'accent',
    type: 'color',
  },
  {
    name: '--card-link',
    label: 'site.themeVar.cardLink.label',
    description: 'site.themeVar.cardLink.description',
    group: 'accent',
    type: 'color',
  },
  {
    name: '--card-link-hover',
    label: 'site.themeVar.cardLinkHover.label',
    description: 'site.themeVar.cardLinkHover.description',
    group: 'accent',
    type: 'color',
  },
  {
    name: '--progress-end',
    label: 'site.themeVar.progressEnd.label',
    description: 'site.themeVar.progressEnd.description',
    group: 'accent',
    type: 'color',
  },

  // ----- Buttons -----
  {
    name: '--btn-bg',
    label: 'site.themeVar.btnBg.label',
    description: 'site.themeVar.btnBg.description',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-hover',
    label: 'site.themeVar.btnHover.label',
    description: 'site.themeVar.btnHover.description',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-text',
    label: 'site.themeVar.btnText.label',
    description: 'site.themeVar.btnText.description',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-primary',
    label: 'site.themeVar.btnPrimary.label',
    description: 'site.themeVar.btnPrimary.description',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-primary-hover',
    label: 'site.themeVar.btnPrimaryHover.label',
    description: 'site.themeVar.btnPrimaryHover.description',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-danger',
    label: 'site.themeVar.btnDanger.label',
    description: 'site.themeVar.btnDanger.description',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-danger-hover',
    label: 'site.themeVar.btnDangerHover.label',
    description: 'site.themeVar.btnDangerHover.description',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-export',
    label: 'site.themeVar.btnExport.label',
    description: 'site.themeVar.btnExport.description',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-export-hover',
    label: 'site.themeVar.btnExportHover.label',
    description: 'site.themeVar.btnExportHover.description',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-add',
    label: 'site.themeVar.btnAdd.label',
    description: 'site.themeVar.btnAdd.description',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-add-hover',
    label: 'site.themeVar.btnAddHover.label',
    description: 'site.themeVar.btnAddHover.description',
    group: 'buttons',
    type: 'color',
  },
  {
    name: '--btn-on-color-text',
    label: 'site.themeVar.btnOnColorText.label',
    description: 'site.themeVar.btnOnColorText.description',
    group: 'buttons',
    type: 'color',
  },

  // ----- Status -----
  {
    name: '--success-bg',
    label: 'site.themeVar.successBg.label',
    description: 'site.themeVar.successBg.description',
    group: 'status',
    type: 'color',
  },
  {
    name: '--success-border',
    label: 'site.themeVar.successBorder.label',
    description: 'site.themeVar.successBorder.description',
    group: 'status',
    type: 'color',
  },
  {
    name: '--success-text',
    label: 'site.themeVar.successText.label',
    description: 'site.themeVar.successText.description',
    group: 'status',
    type: 'color',
  },
  {
    name: '--error',
    label: 'site.themeVar.error.label',
    description: 'site.themeVar.error.description',
    group: 'status',
    type: 'color',
  },
  {
    name: '--error-bg',
    label: 'site.themeVar.errorBg.label',
    description: 'site.themeVar.errorBg.description',
    group: 'status',
    type: 'color',
  },
  {
    name: '--error-border',
    label: 'site.themeVar.errorBorder.label',
    description: 'site.themeVar.errorBorder.description',
    group: 'status',
    type: 'color',
  },
  {
    name: '--error-text',
    label: 'site.themeVar.errorText.label',
    description: 'site.themeVar.errorText.description',
    group: 'status',
    type: 'color',
  },
  {
    name: '--warning-bg',
    label: 'site.themeVar.warningBg.label',
    description: 'site.themeVar.warningBg.description',
    group: 'status',
    type: 'color',
  },
  {
    name: '--warning-border',
    label: 'site.themeVar.warningBorder.label',
    description: 'site.themeVar.warningBorder.description',
    group: 'status',
    type: 'color',
  },
  {
    name: '--warning-text',
    label: 'site.themeVar.warningText.label',
    description: 'site.themeVar.warningText.description',
    group: 'status',
    type: 'color',
  },

  // ----- Labels -----
  {
    name: '--label-sale',
    label: 'site.themeVar.labelSale.label',
    description: 'site.themeVar.labelSale.description',
    group: 'labels',
    type: 'color',
  },
  {
    name: '--label-trade',
    label: 'site.themeVar.labelTrade.label',
    description: 'site.themeVar.labelTrade.description',
    group: 'labels',
    type: 'color',
  },
  {
    name: '--label-keep',
    label: 'site.themeVar.labelKeep.label',
    description: 'site.themeVar.labelKeep.description',
    group: 'labels',
    type: 'color',
  },

  // ----- Overlays -----
  {
    name: '--overlay-light',
    label: 'site.themeVar.overlayLight.label',
    description: 'site.themeVar.overlayLight.description',
    group: 'overlays',
    type: 'color',
  },
  {
    name: '--overlay-medium',
    label: 'site.themeVar.overlayMedium.label',
    description: 'site.themeVar.overlayMedium.description',
    group: 'overlays',
    type: 'color',
  },
  {
    name: '--overlay-heavy',
    label: 'site.themeVar.overlayHeavy.label',
    description: 'site.themeVar.overlayHeavy.description',
    group: 'overlays',
    type: 'color',
  },
  {
    name: '--card-label-text',
    label: 'site.themeVar.cardLabelText.label',
    description: 'site.themeVar.cardLabelText.description',
    group: 'overlays',
    type: 'color',
  },
  {
    name: '--card-label-meta',
    label: 'site.themeVar.cardLabelMeta.label',
    description: 'site.themeVar.cardLabelMeta.description',
    group: 'overlays',
    type: 'color',
  },
  {
    name: '--card-label-price',
    label: 'site.themeVar.cardLabelPrice.label',
    description: 'site.themeVar.cardLabelPrice.description',
    group: 'overlays',
    type: 'color',
  },
  {
    name: '--card-label-buylist',
    label: 'site.themeVar.cardLabelBuylist.label',
    description: 'site.themeVar.cardLabelBuylist.description',
    group: 'overlays',
    type: 'color',
  },

  // ----- Modals -----
  {
    name: '--modal-radius',
    label: 'site.themeVar.modalRadius.label',
    description: 'site.themeVar.modalRadius.description',
    group: 'modals',
    type: 'length',
    unit: 'px',
  },
  {
    name: '--modal-shadow-color',
    label: 'site.themeVar.modalShadowColor.label',
    description: 'site.themeVar.modalShadowColor.description',
    group: 'modals',
    type: 'color',
  },

  // ----- Flame icon -----
  {
    name: '--flame-outer-1',
    label: 'site.themeVar.flameOuter1.label',
    description: 'site.themeVar.flameOuter1.description',
    group: 'flame',
    type: 'color',
  },
  {
    name: '--flame-outer-2',
    label: 'site.themeVar.flameOuter2.label',
    description: 'site.themeVar.flameOuter2.description',
    group: 'flame',
    type: 'color',
  },
  {
    name: '--flame-outer-3',
    label: 'site.themeVar.flameOuter3.label',
    description: 'site.themeVar.flameOuter3.description',
    group: 'flame',
    type: 'color',
  },
  {
    name: '--flame-inner-1',
    label: 'site.themeVar.flameInner1.label',
    description: 'site.themeVar.flameInner1.description',
    group: 'flame',
    type: 'color',
  },
  {
    name: '--flame-inner-2',
    label: 'site.themeVar.flameInner2.label',
    description: 'site.themeVar.flameInner2.description',
    group: 'flame',
    type: 'color',
  },
  {
    name: '--flame-inner-3',
    label: 'site.themeVar.flameInner3.label',
    description: 'site.themeVar.flameInner3.description',
    group: 'flame',
    type: 'color',
  },

  // ----- Misc -----
  {
    name: '--card-radius',
    label: 'site.themeVar.cardRadius.label',
    description: 'site.themeVar.cardRadius.description',
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
