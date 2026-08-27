import type { Component, JSX } from 'solid-js'
import { useT } from '../../../ui/i18n'

export type StepHeaderProps = {
  onBack: () => void
  heading: string
  /** An optional trailing control beside the heading (the printing step's price source). */
  children?: JSX.Element
}

/** The header every step past the search shares: "← Back", the heading, and an optional trailing child. */
export const StepHeader: Component<StepHeaderProps> = (props) => {
  const t = useT()
  return (
    <div class="search-modal-header">
      <button onClick={props.onBack} class="search-tab-btn">
        {t('ui.addCard.back')}
      </button>
      <h3 class="modal-heading-flex">{props.heading}</h3>
      {props.children}
    </div>
  )
}
