import { type Accessor, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js'
import { decideHeaderFold, isHeaderFold, type HeaderFitWidths, type HeaderFold } from './header-fit'

/**
 * The utility controls' root elements, inline in the main row. Named by their
 * components' own classes (PriceStoreSelect, LanguageSwitcher, EditModeButton,
 * ThemeHeaderControls) rather than wrapped, because a wrapper around a control
 * that renders nothing would still take a flex gap.
 */
const UTILITY_ITEMS = '.price-store-selector, .language-switcher, .btn-edit, .theme-picker-wrapper'

/**
 * The header's focusable controls that a fold can unmount and remount: each
 * utility's own control, and the ⚙ toggle. A control that had focus is found
 * again by the first of these it matches.
 */
const FOCUS_HOMES = [
  '.price-store-selector select',
  '.language-switcher select',
  '.btn-edit',
  '.theme-customize-btn',
  '.header-utility-toggle',
] as const

/**
 * Mutations that never change the main row's widths: the editor's own row,
 * which churns while editing, and the content of popovers anchored in the row
 * (the selection menu's panel, the theme picker).
 */
const IGNORED_MUTATIONS = '.site-header-edit-row, .selection-menu-panel, .theme-picker'

/**
 * The ⚙ toggle's width before it has ever rendered (it renders only once the
 * header folds). An upper bound for the icon button; replaced by the measured
 * width the first time the toggle is on screen.
 */
const TOGGLE_FALLBACK_WIDTH = 40

/**
 * Level changes allowed before the next animation frame. A decision is stable
 * by construction (see UNFOLD_SLACK), so a third change in one frame means the
 * measurements disagree with the model; deferring stops it spinning in
 * microtasks.
 */
const MAX_TRANSITIONS_PER_FRAME = 2

export type HeaderFitOptions = {
  /** The `<header>` element; read after mount. */
  header: Accessor<HTMLElement | undefined>
  /** False at phone widths, where the phone layout decides the header. */
  enabled: Accessor<boolean>
  /**
   * Read reactively; a change means the utility controls may have changed
   * width while folded out of sight — the UI language, Edit becoming Done, a
   * theme change, or a control (the price store or language picker) appearing
   * once its data loads.
   */
  invalidate: Accessor<unknown>
  /**
   * True while re-measuring must wait: the ⚙ row is open, and a probe would
   * remount its controls (closing an open theme picker, dropping focus). The
   * header keeps its level meanwhile and re-measures once this turns false.
   */
  probeBlocked: Accessor<boolean>
}

const width = (el: Element | null | undefined): number => el?.getBoundingClientRect().width ?? 0

/** The level the header shows right now, read from the DOM. */
const renderedFold = (header: HTMLElement): HeaderFold | undefined => {
  const value = header.dataset.fold
  return value !== undefined && isHeaderFold(value) ? value : undefined
}

/**
 * Folds the header main row only when it runs out of room (see header-fit.ts).
 *
 * Everything the decision needs is measured from the live header except the
 * utility controls' widths once they fold: those are cached from the last time
 * they rendered inline. When that cache is missing or invalidated, the header
 * is briefly rendered unfolded and measured — inside the same task as the
 * change, so it never reaches the screen.
 */
export function useHeaderFit(options: HeaderFitOptions): Accessor<HeaderFold> {
  const [fold, setFold] = createSignal<HeaderFold>('full')
  let utilities: number[] | undefined
  let stale = false
  let toggleWidth = TOGGLE_FALLBACK_WIDTH
  let transitions = 0
  let disposed = false

  /**
   * Reads the live header. Undefined when the utilities' cached widths cannot
   * be trusted and they are not inline to re-measure.
   *
   * The level is read from the DOM (`data-fold`), not the signal, so a
   * measurement never mistakes a not-yet-rendered level for the one on screen.
   */
  const measure = (header: HTMLElement, allowStale = false): HeaderFitWidths | undefined => {
    const row = header.querySelector<HTMLElement>('.site-header-main')
    const nav = row?.querySelector('.site-nav')
    if (!row || !nav) return undefined
    const level = renderedFold(header)
    const rowBox = row.getBoundingClientRect()
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0

    // Inline only: the model is the inline layout, and the ⚙ row may lay them
    // out differently.
    if (level === 'full') {
      utilities = [...row.children].filter((el) => el.matches(UTILITY_ITEMS)).map(width)
      stale = false
    }
    if (!utilities || (stale && !allowStale)) return undefined

    // At the icon level the label and key hint are hidden out of flow, not
    // removed, so the full button's width can still be worked out.
    const quickSwitch = row.querySelector<HTMLElement>('.quick-switch-trigger')
    const button = width(quickSwitch)
    const label = width(quickSwitch?.querySelector('.quick-switch-trigger-label'))
    const kbd = width(quickSwitch?.querySelector('.quick-switch-trigger-kbd'))
    const innerGap = quickSwitch ? parseFloat(getComputedStyle(quickSwitch).columnGap) || 0 : 0
    const labelPart = (label > 0 ? label + innerGap : 0) + (kbd > 0 ? kbd + innerGap : 0)

    const toggle = row.querySelector('.header-utility-toggle')
    if (toggle) toggleWidth = width(toggle)

    // Everything right of the nav that is neither folded nor the fold's own
    // machinery: the selection menu, and whatever joins it later.
    const navIndex = [...row.children].indexOf(nav)
    const extras = [...row.children]
      .slice(navIndex + 1)
      .filter((el) => el !== quickSwitch && el !== toggle && !el.matches(UTILITY_ITEMS))
      .map(width)

    // The nav may be squeezed (and scrolling) at the icon level when nothing
    // fits; its scroll width is what it needs.
    const navBox = nav.getBoundingClientRect()
    return {
      available: rowBox.width,
      gap,
      left: navBox.left - rowBox.left + Math.max(navBox.width, nav.scrollWidth),
      quickSwitchFull: level === 'icon' ? button + labelPart : button,
      quickSwitchIcon: level === 'icon' ? button : button - labelPart,
      utilities,
      extras,
      toggle: toggleWidth,
    }
  }

  /** The header control that has keyboard focus, as one of FOCUS_HOMES. */
  const focusedHome = (header: HTMLElement): string | undefined => {
    const active = document.activeElement
    if (!(active instanceof Element) || !header.contains(active)) return undefined
    const home = FOCUS_HOMES.find((selector) => active.matches(selector))
    if (home !== undefined) return home
    // Inside a utility but on none of its homes (a theme picker item): the
    // ⚙ toggle is where it can be found again once folded.
    return active.closest(UTILITY_ITEMS) ? '.header-utility-toggle' : undefined
  }

  /**
   * After a write, keeps keyboard focus in the header: a control the write
   * unmounted is focused again where it remounted, and a utility folded out of
   * sight hands focus to the ⚙ toggle (without opening the row). A toggle
   * that unfolding removed leaves focus where the browser put it.
   */
  const restoreFocus = (header: HTMLElement, home: string | undefined) => {
    if (home === undefined || focusedHome(header) !== undefined) return
    const target =
      header.querySelector<HTMLElement>(home) ??
      (home === '.header-utility-toggle'
        ? null
        : header.querySelector<HTMLElement>('.header-utility-toggle'))
    target?.focus({ preventScroll: true })
  }

  const update = () => {
    const header = options.header()
    if (disposed || !header || !options.enabled()) return
    const current = fold()
    const home = focusedHome(header)
    // While a probe must wait, decide from the stale widths: better than
    // nothing, and the probe follows once the ⚙ row closes.
    let widths = measure(header, options.probeBlocked())
    if (!widths) {
      // Probe: render the utilities inline to measure them. Writing the signal
      // outside a reactive update re-renders synchronously; inside one (never
      // the case from the observers below) the measurement retries next frame.
      setFold('full')
      widths = measure(header)
      if (!widths) {
        setFold(current)
        restoreFocus(header, home)
        scheduleFrame()
        return
      }
      setFold(decideHeaderFold(widths, current))
      restoreFocus(header, home)
      return
    }
    const next = decideHeaderFold(widths, current)
    if (next === current) return
    if (transitions >= MAX_TRANSITIONS_PER_FRAME) {
      scheduleFrame()
      return
    }
    if (transitions++ === 0) requestAnimationFrame(() => (transitions = 0))
    setFold(next)
    restoreFocus(header, home)
  }

  let frameQueued = false
  const scheduleFrame = () => {
    if (frameQueued) return
    frameQueued = true
    requestAnimationFrame(() => {
      frameQueued = false
      update()
    })
  }

  let queued = false
  const schedule = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      update()
    })
  }

  onMount(() => {
    const header = options.header()
    if (!header) return
    // First decision before the first paint, so a narrow window never shows
    // the unfolded row. (`fold` starts at 'full', so this never needs a probe.)
    update()

    // Room changes: the zero-height measure strip spans the row's width at
    // every level, and the nav's width is the left side. Decided on the next
    // frame, not in the callback: a fold changes the header's height, which
    // the app's own header ResizeObserver watches, so folding inside this
    // callback is a ResizeObserver loop. The cost is one frame of the previous
    // level while a window is being resized.
    const strip = header.querySelector('.site-header-measure')
    const nav = header.querySelector('.site-nav')
    const resize = new ResizeObserver(scheduleFrame)
    if (strip) resize.observe(strip)
    if (nav) resize.observe(nav)
    // Items coming and going (the selection menu, the live badge) and labels
    // changing (a selection count, Edit/Done).
    const mutations = new MutationObserver((records) => {
      const counts = (r: MutationRecord) =>
        !(r.target instanceof Element ? r.target : r.target.parentElement)?.closest(
          IGNORED_MUTATIONS,
        )
      if (records.some(counts)) schedule()
    })
    mutations.observe(header, { childList: true, characterData: true, subtree: true })
    onCleanup(() => {
      disposed = true
      resize.disconnect()
      mutations.disconnect()
    })

    // Web fonts arriving after the first measurement change every width; when
    // they had already loaded, that measurement is fresh.
    if (document.fonts && document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => {
        stale = true
        schedule()
      })
    }
  })

  createEffect(
    on(
      () => [options.enabled(), options.invalidate()],
      () => {
        stale = true
        // A frame, not a microtask: the theme editor invalidates on every
        // slider step, and one re-measure per frame (still before its paint)
        // is plenty.
        scheduleFrame()
      },
      { defer: true },
    ),
  )

  // The ⚙ row closing lets a waiting probe run.
  createEffect(
    on(
      options.probeBlocked,
      (blocked) => {
        if (!blocked && stale) scheduleFrame()
      },
      { defer: true },
    ),
  )

  return fold
}
