/**
 * Small presentational pieces the Swap Printings wizard steps share: a card
 * thumbnail, a list name with its type icon, a finish chip, a price figure and
 * the "SET:CN" printing label, so every step spells them the same way — plus
 * the card-preview context every step hovers through.
 */

import { createContext, onCleanup, useContext, For, Show, type Component, type JSX } from 'solid-js'
import type { Finish, ScryfallCard } from '../../../types'
import type { CardLanguage } from '../../../card-language'
import type { PriceCurrency } from '../../../price-currency'
import { getCardImageUrl } from '../../../card-image'
import { languageBadge } from '../../../card-language'
import { formatPrintingLabel } from '../../../printing-key'
import { LIST_TYPE_DISPLAY } from '../../../list-type'
import { finishChipName } from '../../../site/printing-display'
import { printingPriceText } from '../../../site/printing-prices'
import { useT } from '../../../ui/i18n'
import type { NamedListRef } from '../../../site/combined-list'
import type { SwapCandidate, SwapTarget } from '../../swap-printings'

/** Raises and clears the wizard's cursor-following card preview. */
export type CardPreviewControl = {
  /** Preview `card`; null (a copy with no printing, or an uncached one) previews the placeholder. */
  show: (card: ScryfallCard | null) => void
  hide: () => void
}

/** No preview at all — what a step rendered outside the wizard's provider gets. */
const NO_PREVIEW: CardPreviewControl = { show: () => {}, hide: () => {} }

const CardPreviewContext = createContext<CardPreviewControl>(NO_PREVIEW)

/** Wraps the wizard's steps so every card row can raise the shared preview. */
export const CardPreviewProvider = CardPreviewContext.Provider

/** The wizard's preview control, for a step that raises or clears it directly. */
export function useCardPreview(): CardPreviewControl {
  return useContext(CardPreviewContext)
}

export type PreviewHandlers = {
  onMouseEnter: () => void
  onMouseLeave: () => void
}

/**
 * Hover handlers that preview `card` — spread onto anything standing for one
 * card (a thumbnail, a card name, a planned move), so the whole wizard hovers
 * the same way. A hook: call it during rendering, like any other context read.
 *
 * A row that unmounts under the cursor — the picker's query filtered it out,
 * the pick queue advanced, the step changed — never fires its `mouseleave`, so
 * each row drops its own preview on the way out.
 */
export function useCardPreviewHandlers(card: () => ScryfallCard | null): PreviewHandlers {
  const preview = useCardPreview()
  let showing = false
  onCleanup(() => {
    if (showing) preview.hide()
  })
  return {
    onMouseEnter: () => {
      showing = true
      preview.show(card())
    },
    onMouseLeave: () => {
      showing = false
      preview.hide()
    },
  }
}

export type CardThumbProps = { card: ScryfallCard | null; name: string }

/** A small card image, or an empty placeholder box when the printing is not cached. */
export const CardThumb: Component<CardThumbProps> = (props) => {
  const url = (): string | null => (props.card ? getCardImageUrl(props.card) : null)
  return (
    <span class="swap-wizard-thumb" {...useCardPreviewHandlers(() => props.card)}>
      <Show when={url()}>{(src) => <img src={src()} alt={props.name} loading="lazy" />}</Show>
    </span>
  )
}

export type ListNameProps = { list: NamedListRef }

/** A list's type icon and display name. */
export const ListName: Component<ListNameProps> = (props) => (
  <span class="swap-wizard-list-name">
    <span aria-hidden="true">{LIST_TYPE_DISPLAY[props.list.type].icon}</span> {props.list.name}
  </span>
)

export type FinishChipProps = { finish: Finish | undefined }

/** The finish chip a row wears; plain nonfoil copies wear none. */
export const FinishChip: Component<FinishChipProps> = (props) => {
  const t = useT()
  return (
    <Show when={props.finish !== undefined && props.finish !== 'nonfoil' ? props.finish : null}>
      {(finish) => (
        <span class={`swap-wizard-chip swap-wizard-chip--${finish()}`}>
          {finishChipName(t, finish())}
        </span>
      )}
    </Show>
  )
}

export type LanguageChipProps = { language: CardLanguage | undefined }

/** A non-English copy's language badge (`JA`); English wears none. */
export const LanguageChip: Component<LanguageChipProps> = (props) => (
  <Show when={languageBadge(props.language)}>
    {(badge) => <span class="swap-wizard-chip swap-wizard-chip--lang">{badge()}</span>}
  </Show>
)

export type PriceTextProps = {
  price: number | null
  currency: PriceCurrency
}

/** A formatted price, or the no-price stand-in. */
export const PriceText: Component<PriceTextProps> = (props) => {
  const t = useT()
  return (
    <span class="swap-wizard-price" classList={{ 'swap-wizard-price--none': props.price === null }}>
      {props.price === null
        ? t('ui.swap.noPrice')
        : printingPriceText(t, props.price, props.currency)}
    </span>
  )
}

/** `SET:CN` for a target's current printing. */
export function targetPrintingLabel(target: SwapTarget): string {
  return formatPrintingLabel(target.set, target.collectorNumber)
}

/** `SET:CN` for a printing candidate; null for a printingless one. */
export function candidatePrintingLabel(candidate: SwapCandidate): string | null {
  if (candidate.kind !== 'printing' || !candidate.set || !candidate.collectorNumber) return null
  return formatPrintingLabel(candidate.set, candidate.collectorNumber)
}

export type StepIndicatorProps<S extends string> = {
  steps: readonly S[]
  current: S
  label: (step: S) => string
}

/** The row of step chips at the top of the wizard; the current step is highlighted. */
export function StepIndicator<S extends string>(props: StepIndicatorProps<S>): JSX.Element {
  return (
    <ol class="swap-wizard-steps">
      <For each={props.steps}>
        {(step) => (
          <li
            class="swap-wizard-step"
            classList={{ 'swap-wizard-step--current': step === props.current }}
            aria-current={step === props.current ? 'step' : undefined}
          >
            {props.label(step)}
          </li>
        )}
      </For>
    </ol>
  )
}
