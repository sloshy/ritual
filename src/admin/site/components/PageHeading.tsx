import type { JSX } from 'solid-js'
import { useTKey } from '../../../ui/i18n'
import { PAGE_DISPLAY, type Page } from '../routing'

type PageHeadingProps = { page: Page }

/**
 * A page's own title, taken from the same name and icon the sidebar item and the
 * dashboard card use — so a page cannot end up called one thing in the nav and
 * another on the page itself.
 */
export function PageHeading(props: PageHeadingProps): JSX.Element {
  const tKey = useTKey()
  return (
    <h2 class="section-heading">
      {PAGE_DISPLAY[props.page].icon} {tKey(PAGE_DISPLAY[props.page].label)}
    </h2>
  )
}
