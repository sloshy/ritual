// The UI-language switcher, sitting beside the theme control in the site
// header (and, at phone widths, in the header's collapsible utility row — it
// renders wherever `HeaderControls`' controls do, so both layouts get it from
// one definition).
//
// Deliberately *not* the card-language setting: this picks the language Ritual
// speaks, while `defaultLanguage` picks which printing of a card is shown. The
// two are orthogonal — a Japanese UI listing English printings is a valid,
// expected combination — and the wording keeps them apart.
//
// Each locale is named in its own language ("Deutsch", not "German"), which is
// the only naming a reader who cannot read the current language can act on.

import { type Component, For, Show, createEffect, createMemo, on } from 'solid-js'
import { isLocaleTagError, parseLocaleTag } from '../i18n/locale-tag'
import type { LocaleTag } from '../i18n/types'
import { useT } from '../ui/i18n'

/** One row of the switcher: the tag to apply and how to name it. */
export type LocaleChoice = {
  tag: LocaleTag
  /** The locale's name in its own language, e.g. `Deutsch` for `de`. */
  endonym: string
}

export type LanguageSwitcherProps = {
  /** The locale in force — the one a dictionary is actually loaded for. */
  locale: LocaleTag
  /** Every locale this deployment ships a dictionary for, English first. */
  available: readonly LocaleTag[]
  /** Apply a locale. Loading its dictionary is the caller's job. */
  onChange: (tag: LocaleTag) => void
}

/**
 * A locale's name in its own language, falling back to the tag itself.
 *
 * `Intl.DisplayNames` is asked for the name *in that locale* — the whole point
 * of an endonym — and answers with the tag for a language it has no name for,
 * which is already the fallback we want. The try/catch covers a tag ICU rejects
 * outright; `parseLocaleTag` should have caught that long before here.
 */
export function localeEndonym(tag: LocaleTag): string {
  try {
    const names = new Intl.DisplayNames([tag], { type: 'language', fallback: 'code' })
    return names.of(tag) ?? tag
  } catch {
    return tag
  }
}

/** The switcher's rows, in the order the deployment lists its locales. */
export function localeChoices(available: readonly LocaleTag[]): LocaleChoice[] {
  return available.map((tag) => ({ tag, endonym: localeEndonym(tag) }))
}

/**
 * Renders nothing when the site ships a single locale: a picker with one option
 * is noise, and the English-only build is the common case.
 */
export const LanguageSwitcher: Component<LanguageSwitcherProps> = (props) => {
  const t = useT()
  const choices = createMemo(() => localeChoices(props.available))
  let select: HTMLSelectElement | undefined

  // `props.locale` only advances once the dictionary fetch resolves, and an
  // unreachable dictionary degrades to English without advancing it at all. The
  // DOM control, meanwhile, moved the moment the user picked — so re-assert the
  // element's value against the locale that was actually *applied*, or the
  // switcher is left naming a language the page is not in. Solid will not do
  // this for us: the accessor's value did not change.
  createEffect(
    on(
      () => props.locale,
      (tag) => {
        if (select !== undefined && select.value !== tag) select.value = tag
      },
    ),
  )

  return (
    <Show when={props.available.length > 1}>
      <div class="language-switcher currency-selector">
        <label class="currency-label" for="ui-locale">
          {t('site.header.languageLabel')}
        </label>
        <select
          id="ui-locale"
          class="currency-select"
          ref={select}
          aria-label={t('site.header.language')}
          value={props.locale}
          onChange={(e) => {
            // The option values come from `available`, which is already parsed —
            // but the element's value is a `string` as far as the DOM is
            // concerned, and `LocaleTag` is only mintable by the parser.
            const tag = parseLocaleTag(e.currentTarget.value)
            if (!isLocaleTagError(tag)) props.onChange(tag)
          }}
        >
          {/* Marks the matching option `selected` as well as binding `value`:
              the option list is rebuilt whenever `availableLocales` changes, and
              a plain value binding does not re-run for that. */}
          <For each={choices()}>
            {(choice) => (
              <option value={choice.tag} selected={choice.tag === props.locale} lang={choice.tag}>
                {choice.endonym}
              </option>
            )}
          </For>
        </select>
      </div>
    </Show>
  )
}
