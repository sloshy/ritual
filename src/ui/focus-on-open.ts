/**
 * Focus an input and select its contents once a dialog has opened, so the seeded
 * default is overwritten by whatever the user types first.
 *
 * Deferred a microtask so the seeded value has landed and the dialog is in the top
 * layer before the focus call. Takes a getter rather than the element so the ref is
 * read at focus time — never captured while the previous open's node is still around.
 */
export function focusAndSelectOnOpen(getInput: () => HTMLInputElement | undefined): void {
  queueMicrotask(() => {
    const el = getInput()
    el?.focus()
    el?.select()
  })
}
