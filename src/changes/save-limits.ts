/**
 * The most events one list save may carry. Sized well past any single editing
 * session — re-pinning or relabelling every line of a large collection is one
 * event per line — while keeping the route's work and the request it measures
 * bounded. The save route's byte budget (`MAX_EDIT_BODY_SIZE`) is derived from
 * it, and a larger in-process batch (a change-bundle import) is split to fit.
 *
 * A leaf module, imported by both the wire decoder and the admin budgets, so the
 * browser bundles that read the budgets do not pull in the decoder.
 */
export const MAX_SAVE_CHANGES = 50_000

/** What one wire event is budgeted at: generous, a typical one is 60–150 bytes. */
export const SAVE_CHANGE_BYTE_BUDGET = 200
