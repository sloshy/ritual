/**
 * Solid bindings for the i18n runtime.
 *
 * The runtime (`src/i18n/runtime.ts`) is plain module state, which Solid cannot
 * observe. This wraps it in a signal so a locale switch actually re-renders:
 * {@link useT} hands back a `t` that **reads `locale()` on every call**, which
 * makes every `t()` inside JSX a real reactive dependency.
 *
 * The store also registers its accessor with the runtime
 * (`registerLocaleSource`), so `currentLocale()` itself becomes reactive inside
 * a tracking scope. That is what keeps the module-level renderers that read the
 * locale ambiently — `formatDateTime`, `formatPrice`, `compareDisplay`,
 * `changeSegments`, `cardLabelName` — in step with the `t()` calls around them,
 * without threading a translator through every one of them.
 *
 * That is necessary but not sufficient. Module-level label tables
 * (`SORT_BY_LABELS`, `NAV_DESTINATIONS`, …) are evaluated once at import, so a
 * table holding rendered strings would keep the nav and toolbar in the previous
 * language after a switch. The mechanical rule is that a label table holds
 * `MessageKey`s — data — and is resolved at render time.
 */

import { createContext, createSignal, useContext, type Accessor, type JSX } from 'solid-js'
import {
  appliedLocaleTag,
  getDictionary,
  registerDictionaryListener,
  registerLocaleSource,
  setLocale as applyRuntimeLocale,
} from '../i18n/runtime'
import {
  tDynamic,
  tIn,
  tSegmentsIn,
  type MessageParams,
  type ParameterlessKey,
  type RenderParams,
  type TranslateArgs,
} from '../i18n/t'
import type { MessageKey } from '../i18n/messages/en'
import type { LocaleCatalog, LocaleTag, MessageSegment } from '../i18n/types'

/** The reactive translator handed to components. */
export type I18nStore = {
  /** The active UI locale. Read inside JSX to make a subtree locale-reactive. */
  locale: Accessor<LocaleTag>
  /** Switch the UI locale for the whole app. */
  setLocale: (tag: LocaleTag) => void
  /** Reactive `t` — tracks {@link I18nStore.locale} on every call. */
  t: <K extends MessageKey>(key: K, ...args: TranslateArgs<K>) => string
  /** Reactive renderer for a key chosen at runtime. See {@link useTDynamic}. */
  tDynamic: (key: MessageKey, params?: RenderParams) => string
  /** Reactive `tSegments`, for a parameter that must render as markup mid-sentence. */
  tSegments: <K extends MessageKey>(key: K, params: MessageParams<K>) => MessageSegment[]
}

/**
 * The one store, built lazily on first use.
 *
 * There is exactly one i18n runtime (module state in `src/i18n/runtime.ts`), so
 * there is exactly one signal mirroring it. A second store would hold a second
 * signal that `setLocale` never reaches, and every consumer resolving to it —
 * a component outside `I18nProvider`, a `useT()` called after an `await` — would
 * silently stop following language switches. Both app roots call
 * {@link createI18nStore} and get this same object, and so does
 * {@link useI18n}'s no-provider path.
 */
let store: I18nStore | undefined

/**
 * Installs {@link store}'s two hooks into the runtime. Kept beside it and run
 * on every {@link createI18nStore} call, so a runtime reset (which clears both
 * slots) never leaves the cached store unwired.
 */
let wireStore: (() => void) | undefined

/**
 * What the text on screen was rendered from: the applied locale **and** the
 * dictionary it had when it rendered. Either changing means every `t()` call
 * may now answer differently.
 */
type RenderedLocale = { tag: LocaleTag; dictionary: LocaleCatalog | undefined }

/** The runtime's current {@link RenderedLocale}. */
function renderedLocale(): RenderedLocale {
  const tag = appliedLocaleTag()
  return { tag, dictionary: getDictionary(tag) }
}

function sameRendering(a: RenderedLocale, b: RenderedLocale): boolean {
  return a.tag === b.tag && a.dictionary === b.dictionary
}

/** A built store and the function that wires it into the runtime. */
type BuiltStore = { store: I18nStore; wire: () => void }

function buildStore(): BuiltStore {
  // The signal tracks the dictionary as well as the tag. A tag alone misses the
  // case where the locale is known before its dictionary is: the
  // `__ritualLocale__` seam (or any boot that applies a tag ahead of its fetch)
  // renders the first paint from the English fallback, and when the dictionary
  // lands the tag is unchanged — so a tag-only signal's equality check would
  // swallow the update and leave that first paint English for good.
  const [rendered, setRendered] = createSignal<RenderedLocale>(renderedLocale(), {
    equals: sameRendering,
  })
  // A plain accessor, never a memo: `currentLocale()` reads it through
  // `registerLocaleSource`, and the module-level renderers it serves must re-run
  // on a dictionary-only change too. A memo of the tag would compare equal
  // across that change and swallow it, which is the very bug this guards.
  const locale: Accessor<LocaleTag> = () => rendered().tag

  function setLocale(tag: LocaleTag): void {
    // The module state is updated *before* the signal, and the signal is
    // re-seeded from the runtime rather than from `tag`, so the two holders can
    // never disagree: non-reactive callers (`compareDisplay`, the formatters,
    // anything outside a component) must never observe a stale locale
    // mid-render, and the `__ritualLocale__` test seam must keep outranking an
    // applied value on both paths.
    applyRuntimeLocale(tag)
    setRendered(renderedLocale())
  }

  function wire(): void {
    // Reading `locale()` from inside `currentLocale()` is what makes every
    // module-level renderer reactive.
    registerLocaleSource(locale)
    // A dictionary arriving for the locale already applied re-renders the text
    // it now translates; one for any other locale changes nothing on screen,
    // which the equality check absorbs.
    registerDictionaryListener(() => setRendered(renderedLocale()))
  }

  const built: I18nStore = {
    locale,
    setLocale,
    t: <K extends MessageKey>(key: K, ...args: TranslateArgs<K>): string =>
      tIn(locale(), key, ...args),
    tDynamic: (key: MessageKey, params?: RenderParams): string => tDynamic(locale(), key, params),
    tSegments: <K extends MessageKey>(key: K, params: MessageParams<K>): MessageSegment[] =>
      tSegmentsIn(locale(), key, params),
  }
  return { store: built, wire }
}

/**
 * The app-wide i18n store. Seeded from the runtime, so whatever boot resolved
 * (the `__ritualLocale__` test seam, a `?locale=` query, localStorage,
 * `navigator.languages`, the baked default) is already in place on first paint.
 *
 * Idempotent — see {@link store} for why there can only be one.
 */
export function createI18nStore(): I18nStore {
  if (store === undefined) {
    const built = buildStore()
    store = built.store
    wireStore = built.wire
  }
  wireStore?.()
  return store
}

const I18nContext = createContext<I18nStore | undefined>(undefined)

/** Props for {@link I18nProvider}. */
export type I18nProviderProps = {
  store: I18nStore
  children: JSX.Element
}

export function I18nProvider(props: I18nProviderProps): JSX.Element {
  return <I18nContext.Provider value={props.store}>{props.children}</I18nContext.Provider>
}

/**
 * The i18n store.
 *
 * Outside a provider it resolves to the same store {@link createI18nStore}
 * returns rather than throwing. Shared components (`src/ui`, `src/editor`) are
 * mounted by three different app roots and by unit/Playwright fixtures that
 * render a single dialog; throwing there would make "no provider yet" a blank
 * screen rather than untranslated text, which is the wrong failure for a
 * *translation* layer.
 */
export function useI18n(): I18nStore {
  return useContext(I18nContext) ?? createI18nStore()
}

/**
 * The reactive translator. `const t = useT()` at the top of a component, then
 * `t('ui.dialog.cancel')` in JSX — each call reads the locale signal, so the
 * text updates when the language changes.
 */
export function useT(): I18nStore['t'] {
  return useI18n().t
}

/**
 * A reactive translator for a key read out of a **data table** at render time —
 * `KeyHint.label`, `ShortcutGroup.title`, and the other `Record<Key, MessageKey>`
 * tables that store message keys rather than rendered text.
 *
 * `t`'s parameter checking keys off the *literal* message key, and a table
 * lookup has already widened that to the whole `MessageKey` union, so the check
 * cannot fire. The widening is absorbed by {@link ParameterlessKey}: a table
 * whose values need parameters will not type-check against this signature, so
 * "a label table entry that renders a raw `{placeholder}`" is a compile error
 * rather than a doc-comment rule.
 */
export function useTKey(): (key: ParameterlessKey) => string {
  return useI18n().tDynamic
}

/**
 * A reactive translator for a key **and** parameters chosen at runtime — a
 * response's `messageKey`/`messageParams`, a stored `EditorStatusMessage`.
 *
 * Unlike {@link useTKey} the parameters are unchecked here, which is sound only
 * because the producer (`apiMessage`, `statusMessage`) validated the pair while
 * it still had the literal key. Prefer `useT()` wherever the key is a literal.
 */
export function useTDynamic(): I18nStore['tDynamic'] {
  return useI18n().tDynamic
}

/**
 * The reactive segment renderer, for a sentence with one parameter that must
 * carry markup — a bolded phrase, a `<code>` span, a clickable card name. Render
 * the segments with `<For>` and wrap the `param` segment you care about; the
 * translator keeps control of where in the sentence it sits. When the markup is
 * a link to another site, `LinkedMessage` (`ui/LinkedMessage.tsx`) does this.
 */
export function useTSegments(): I18nStore['tSegments'] {
  return useI18n().tSegments
}
