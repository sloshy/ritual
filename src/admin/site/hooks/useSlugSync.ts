import { createEffect, on, type Accessor } from 'solid-js'

/** The list-selection props every admin list editor takes, so its page can track it in the URL. */
export type EditorSlugProps = {
  /** List to select on mount, as read from the page URL. */
  initialSlug?: string | null
  /** Report a list picked inside the editor, so the URL can follow it. */
  onSlugChange?: (slug: string | null) => void
}

/**
 * Report the editor's list selection back to its page.
 *
 * Nothing is reported until the selection actually moves. An editor starts with
 * no list selected and only applies a deep-linked one once its list has loaded,
 * so reporting either of those would strip the slug from the URL — for the
 * length of that fetch, or for good if the fetch fails.
 */
export function useSlugSync(slug: Accessor<string | null>, props: EditorSlugProps): void {
  let reported: string | null = props.initialSlug ?? null
  createEffect(
    on(
      slug,
      (next) => {
        // The deep-linked slug lands here when the list resolves; that is the
        // URL we already have, so only a genuine change is worth reporting.
        if (next === reported) return
        reported = next
        props.onSlugChange?.(next)
      },
      // Skips the editor's pre-selection `null`.
      { defer: true },
    ),
  )
}
