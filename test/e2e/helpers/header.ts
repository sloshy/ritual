import { type Page } from '@playwright/test'
import { isHeaderFold, type HeaderFold } from '../../../src/site/header-fit'

/**
 * Probes for the public site's header layout: where its main row's items sit,
 * which fold level it shows, and how often that level changed. The fold logic
 * itself is unit-tested (test/unit/site/header-fit.test.ts); these read what
 * the browser actually laid out.
 */

/** One child of the header's main row, named for failure messages. */
type HeaderRowItem = { name: string; box: DOMRect }

/** The fold-level transitions a page has recorded (see {@link recordFoldTransitions}). */
type FoldLog = { __foldTransitions: string[] }

/**
 * The header main row's visible children that intersect another (by more than a
 * pixel of rounding) or stick out of the row, as readable descriptions — an
 * empty list means the row is laid out cleanly.
 */
export async function headerRowOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const row = document.querySelector('.site-header-main')
    if (!row) return ['no .site-header-main']
    const rowBox = row.getBoundingClientRect()
    const items: HeaderRowItem[] = [...row.children]
      .map((el) => ({
        name: el.getAttribute('class') ?? el.tagName,
        box: el.getBoundingClientRect(),
      }))
      .filter((item) => item.box.width > 0 && item.box.height > 0)
    const problems: string[] = items.length < 2 ? ['fewer than two visible items'] : []
    for (const { name, box } of items) {
      if (
        box.left < rowBox.left - 1 ||
        box.right > rowBox.right + 1 ||
        box.top < rowBox.top - 1 ||
        box.bottom > rowBox.bottom + 1
      ) {
        problems.push(`${name} leaves the row`)
      }
    }
    items.forEach((a, i) => {
      for (const b of items.slice(i + 1)) {
        const x = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left)
        const y = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top)
        if (x > 1 && y > 1) problems.push(`${a.name} overlaps ${b.name} by ${Math.round(x)}px`)
      }
    })
    return problems
  })
}

/**
 * Wait two animation frames: long enough for a resize's observers, and the
 * frame-deferred re-measure they may schedule, to have settled the header
 * before a one-shot layout read.
 */
export async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
}

/** Resize the viewport and let the header settle. */
export async function resizeTo(page: Page, width: number, height = 900): Promise<void> {
  await page.setViewportSize({ width, height })
  await settleLayout(page)
}

/** The header's fold level, null on phones (or for a value that is no level). */
export async function headerFold(page: Page): Promise<HeaderFold | null> {
  const value = await page.locator('.site-header').getAttribute('data-fold')
  return value !== null && isHeaderFold(value) ? value : null
}

/** Start logging every change of the header's fold level; call before `goto`. */
export async function recordFoldTransitions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: string[] = []
    ;(window as unknown as FoldLog).__foldTransitions = log
    new MutationObserver((records) => {
      for (const r of records) {
        const now = (r.target as Element).getAttribute('data-fold')
        if (r.oldValue !== now) log.push(`${r.oldValue}→${now}`)
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-fold'],
      attributeOldValue: true,
    })
  })
}

/** The fold-level changes logged since the last call, clearing the log. */
export async function takeFoldTransitions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const log = (window as unknown as FoldLog).__foldTransitions
    return log.splice(0, log.length)
  })
}

/**
 * The row width the unfolded header needs, read from its live layout. Mirrors
 * `requiredHeaderWidth('full', …)` in src/site/header-fit.ts, with the browser's
 * layout as the oracle for the widths: the quick switch is centered, so twice the wider side plus the button and its two
 * gaps. Read while unfolded (the folded row lacks the utilities). Lets a spec
 * place a viewport just inside or outside the fold boundary whatever the
 * platform's fonts.
 */
export async function unfoldedRowRequirement(page: Page): Promise<number> {
  return page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('.site-header-main')
    const nav = row?.querySelector<HTMLElement>('.site-nav')
    const quickSwitch = row?.querySelector<HTMLElement>('.quick-switch-trigger')
    if (!row || !nav || !quickSwitch) throw new Error('header row, nav or quick switch missing')
    const rowBox = row.getBoundingClientRect()
    const gap = parseFloat(getComputedStyle(row).columnGap)
    const navIndex = [...row.children].indexOf(nav)
    const right = [...row.children]
      .slice(navIndex + 1)
      .filter((el) => el !== quickSwitch && el.getBoundingClientRect().width > 0)
    const left = nav.getBoundingClientRect().right - rowBox.left
    const rightWidth =
      rowBox.right - Math.min(...right.map((el) => el.getBoundingClientRect().left))
    return 2 * Math.max(left, rightWidth) + quickSwitch.getBoundingClientRect().width + 2 * gap
  })
}

/** Viewport width minus the header main row's width (the page and header padding). */
export async function rowInset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const row = document.querySelector('.site-header-main')
    if (!row) throw new Error('header row missing')
    return window.innerWidth - row.getBoundingClientRect().width
  })
}
