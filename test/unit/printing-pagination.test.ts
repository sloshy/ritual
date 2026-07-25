import { describe, test, expect } from 'bun:test'
import {
  PRINTING_PAGE_SIZE,
  firstCellOfPage,
  pageOfPrinting,
  printingsPageStart,
  totalPrintingPages,
} from '../../src/editor/printing-pagination'

/** Printings shown on `page`, given a list of `total` printings. */
function pageLength(page: number, total: number, offset: 0 | 1): number {
  return (
    Math.min(printingsPageStart(page + 1, offset), total) -
    Math.min(printingsPageStart(page, offset), total)
  )
}

describe('printing grid pagination', () => {
  test('the page size fills whole rows at every column count the grid produces', () => {
    for (const columns of [2, 3, 4]) {
      expect(PRINTING_PAGE_SIZE % columns).toBe(0)
    }
  })

  test('with no extra tile, every full page is exactly one page size of printings', () => {
    const total = PRINTING_PAGE_SIZE * 2 + 3
    expect(totalPrintingPages(total, 0)).toBe(3)
    expect(pageLength(0, total, 0)).toBe(PRINTING_PAGE_SIZE)
    expect(pageLength(1, total, 0)).toBe(PRINTING_PAGE_SIZE)
    expect(pageLength(2, total, 0)).toBe(3)
    expect(printingsPageStart(1, 0)).toBe(PRINTING_PAGE_SIZE)
  })

  test('the "No specific printing" tile takes a cell from the first page only', () => {
    const total = PRINTING_PAGE_SIZE * 2
    // First page: one fewer printing, so cells (tile + printings) still total a page.
    expect(pageLength(0, total, 1)).toBe(PRINTING_PAGE_SIZE - 1)
    expect(pageLength(1, total, 1)).toBe(PRINTING_PAGE_SIZE)
    // The displaced printing spills onto a third page.
    expect(totalPrintingPages(total, 1)).toBe(3)
    expect(pageLength(2, total, 1)).toBe(1)
  })

  test('an exactly-full grid stays on one page', () => {
    expect(totalPrintingPages(PRINTING_PAGE_SIZE, 0)).toBe(1)
    expect(totalPrintingPages(PRINTING_PAGE_SIZE - 1, 1)).toBe(1)
    expect(totalPrintingPages(0, 1)).toBe(1)
    expect(totalPrintingPages(0, 0)).toBe(0)
  })

  test("a page's first cell is the printing that page starts with, past page 0's tile", () => {
    // Page 0's first cell is the "No specific printing" tile when it is offered.
    expect(firstCellOfPage(0)).toBe(0)
    // Later pages open on a printing: cell index = printing index + the tile.
    expect(firstCellOfPage(1)).toBe(printingsPageStart(1, 1) + 1)
    expect(firstCellOfPage(2)).toBe(printingsPageStart(2, 1) + 1)
    expect(firstCellOfPage(1)).toBe(printingsPageStart(1, 0))
  })

  test('pageOfPrinting lands on the page whose slice contains that printing', () => {
    for (const offset of [0, 1] as const) {
      for (let index = 0; index < PRINTING_PAGE_SIZE * 3; index++) {
        const page = pageOfPrinting(index, offset)
        expect(index).toBeGreaterThanOrEqual(printingsPageStart(page, offset))
        expect(index).toBeLessThan(printingsPageStart(page + 1, offset))
      }
    }
  })
})
