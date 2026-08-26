/**
 * The card-language picker, reusing the shared move-target singleton
 * (`site/move-prompt.ts` / `MoveTargetPicker`) exactly like the label picker
 * (`site/label-prompt.ts`) does, so no new modal plumbing is needed. The option
 * list is {@link CARD_LANGUAGES} in canonical order — English first — with the
 * card's current language marked.
 */

import { promptMoveTarget } from '../list-view/move-prompt'
import { t } from '../i18n/t'
import {
  CARD_LANGUAGES,
  displayLanguage,
  languageDisplayName,
  type CardLanguage,
} from '../card/card-language'

/**
 * Open the language picker for a card. `current` is the entry's stored language
 * (undefined for a bare line, which means `en` and marks English as current).
 * `onPick` receives the chosen code — including `en`, which callers record so a
 * non-English card can be set back to a bare line.
 */
export function promptCardLanguage(
  current: CardLanguage | undefined,
  onPick: (language: CardLanguage) => void,
): void {
  const resolved = displayLanguage(current)
  // Plain `t()` rather than `useT()`: this is opened from an event handler, not
  // rendered, and the picker it drives is a singleton outside any component.
  promptMoveTarget({
    title: t('ui.editor.setLanguageTitle'),
    options: CARD_LANGUAGES.map((code) => ({
      label:
        code === resolved
          ? t('ui.editor.languageCurrent', { name: languageDisplayName(code) })
          : languageDisplayName(code),
      onSelect: () => onPick(code),
    })),
  })
}
