import { describe, it, expect } from 'bun:test'
import {
  renderStatus,
  statusMessage,
  statusText,
  useEditorStatus,
  type EditorStatusMessage,
} from '../../src/editor/useEditorStatus'
import { entityListType } from '../../src/editor/entity'
import { tDynamic, type RenderParams } from '../../src/i18n/t'
import type { MessageKey } from '../../src/i18n/messages/en'
import {
  currentLocale,
  DEFAULT_LOCALE,
  loadDictionary,
  resetI18nRuntime,
  setLocale,
} from '../../src/i18n/runtime'
import type { LocaleCatalog } from '../../src/i18n/types'
import { localeTag } from '../../src/i18n/locale-tag'

/** The dynamic translator a component gets from `useTDynamic()`, in the active locale. */
const t = (key: MessageKey, params?: RenderParams): string => tDynamic(currentLocale(), key, params)

describe('editor status messages', () => {
  it('keeps a message unrendered so the locale can still change under it', () => {
    const message = statusMessage('ui.editor.loading', { listType: 'deck' })
    expect(message).toEqual({
      kind: 'key',
      key: 'ui.editor.loading',
      params: { listType: 'deck' },
    })
  })

  it('stores no parameters for a message that takes none', () => {
    const message = statusMessage('ui.editor.saveSuccess')
    expect(message).toEqual({
      kind: 'key',
      key: 'ui.editor.saveSuccess',
      params: undefined,
    })
    // `toEqual` cannot tell an explicitly-undefined property from an absent one,
    // and the distinction is load-bearing: `renderStatus` forwards `params`
    // straight to `tDynamic`, which treats both the same. Pinned so a future
    // `params: {}` — which would make `t` interpolate against an empty bag — is
    // a failure rather than a silent pass.
    expect(message.kind === 'key' && message.params).toBeUndefined()
  })

  it('renders a stored message through the caller’s translator', () => {
    expect(renderStatus(t, statusMessage('ui.editor.saveSuccess'))).toBe(
      'Changes saved successfully',
    )
  })

  it('selects the list-type variant rather than splicing a noun', () => {
    const rendered = (listType: string): string =>
      renderStatus(t, statusMessage('ui.editor.loadFailed', { listType }))
    expect(rendered('deck')).toBe('Failed to load deck')
    expect(rendered('collection')).toBe('Failed to load collection')
    expect(rendered('wanted')).toBe('Failed to load wanted list')
  })

  it('passes server-authored prose through untouched', () => {
    const message: EditorStatusMessage = statusText('Deck has been modified since you loaded it.')
    expect(renderStatus(t, message)).toBe('Deck has been modified since you loaded it.')
  })

  // The whole point of storing the pair: a banner raised before a locale switch
  // must read in the locale that is active when it is *rendered*.
  it('re-renders a message stored earlier in the new locale', () => {
    const catalog: LocaleCatalog = { 'ui.editor.saveSuccess': 'Änderungen gespeichert' }
    const message = statusMessage('ui.editor.saveSuccess')
    loadDictionary(localeTag('de'), catalog)
    setLocale(localeTag('de'))
    try {
      expect(renderStatus(t, message)).toBe('Änderungen gespeichert')
      // The same stored pair still renders English on demand — nothing about it
      // was decided when it was created.
      expect(renderStatus((key, params) => tDynamic(DEFAULT_LOCALE, key, params), message)).toBe(
        'Changes saved successfully',
      )
    } finally {
      resetI18nRuntime()
    }
  })
})

describe('useEditorStatus transitions', () => {
  it('clears the previous attempt’s error when a new save starts', () => {
    const [state, actions] = useEditorStatus()
    // Raised *after* a save landed — the custom-art write that followed it
    // failed — so no load or save result clears it on the way in.
    actions.setError(
      statusMessage('admin.art.pendingFailed', { count: 1, cardId: 4, reason: 'no' }),
    )
    expect(state.error).not.toBeNull()

    actions.saveStart()
    expect(state.error).toBeNull()
    expect(state.saving).toBe(true)
  })
})

describe('entityListType', () => {
  it('maps each editor entity noun onto its list type', () => {
    expect(entityListType('deck')).toBe('deck')
    expect(entityListType('collection')).toBe('collection')
    expect(entityListType('wanted list')).toBe('wanted')
  })
})
