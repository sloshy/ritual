import { Show, type Component } from 'solid-js'
import { useI18n } from '../../../ui/i18n'
import { displayLanguage, formatLanguageList, languageLabel } from '../../../card/card-language'
import { defaultLanguage } from '../../default-language'
import { KeyChips } from '../../../ui/KeyHints'
import { CONFIRM_KEYS } from '../../card-search/key-hints'
import type { LanguageNotice } from '../../card-search/dialog-state'
import { StepHeader } from './StepHeader'

export type LanguageNoticeStepProps = {
  cardName: string
  notice: LanguageNotice
  onContinue: () => void
  onBack: () => void
}

/**
 * Step 2b: the picked printing does not exist in the configured default
 * language — Continue stamps the resolved language, Back returns to the
 * printing grid.
 */
export const LanguageNoticeStep: Component<LanguageNoticeStepProps> = (props) => {
  const { t, locale } = useI18n()
  return (
    <>
      <StepHeader
        onBack={props.onBack}
        heading={t('ui.addCard.printingHeading', {
          name: props.cardName,
          set: props.notice.printing.set.toUpperCase(),
          number: props.notice.printing.collector_number,
        })}
      />
      <div class="search-modal-body">
        <div class="search-modal-hint">
          <Show
            when={props.notice.available.length > 1}
            fallback={t('ui.addCard.languageOnly', {
              languages: formatLanguageList(props.notice.available, locale()),
            })}
          >
            {t('ui.addCard.languageUnavailable', {
              preferred: languageLabel(displayLanguage(defaultLanguage()), locale()),
              languages: formatLanguageList(props.notice.available, locale()),
              language: languageLabel(props.notice.language, locale()),
            })}
          </Show>
        </div>
        <div class="add-card-actions">
          <button onClick={props.onContinue} class="btn-add-card">
            {t('ui.dialog.continue')}
            <span class="btn-key-hint" aria-hidden="true">
              <KeyChips keys={CONFIRM_KEYS} />
            </span>
          </button>
        </div>
      </div>
    </>
  )
}
