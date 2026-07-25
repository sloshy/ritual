/**
 * Pagination math for the add-card modal's printing grid.
 *
 * The grid is a responsive `auto-fill` of 140px tracks: 2 columns on a phone and
 * 3 in the 600px desktop modal. {@link PRINTING_PAGE_SIZE} divides evenly by both
 * (and by 4, should the modal ever get wider), so a full page always fills whole
 * rows rather than leaving an orphan.
 *
 * A page is counted in *grid cells*, not printings — the "No specific printing"
 * tile occupies one cell on the first page, so that page shows one fewer printing.
 */

/** Grid cells shown per page of the printing picker. */
export const PRINTING_PAGE_SIZE = 12

/**
 * Cells taken by the "No specific printing" tile: 1 when the tile is offered
 * (decks and wanted lists), 0 when a printing is required (collections).
 */
export type PrintingCellOffset = 0 | 1

/** Index into the printing list of the first printing shown on `page`. */
export function printingsPageStart(page: number, offset: PrintingCellOffset): number {
  return Math.max(0, page * PRINTING_PAGE_SIZE - offset)
}

/**
 * Grid cell index of the first tile on `page`. Cells run unbroken across pages,
 * so this is independent of the "No specific printing" tile.
 */
export function firstCellOfPage(page: number): number {
  return page * PRINTING_PAGE_SIZE
}

/** The page holding the printing at `index` in the printing list. */
export function pageOfPrinting(index: number, offset: PrintingCellOffset): number {
  return Math.floor((index + offset) / PRINTING_PAGE_SIZE)
}

/** Number of pages needed for `total` printings. */
export function totalPrintingPages(total: number, offset: PrintingCellOffset): number {
  return Math.ceil((total + offset) / PRINTING_PAGE_SIZE)
}
