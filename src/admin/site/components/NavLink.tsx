import type { ParentComponent } from 'solid-js'
import { type NavigateOptions, type Page, routeToHash, toRoute, useRouting } from '../routing'

type NavLinkProps = {
  /** Page this link goes to. */
  page: Page
  /** Deep-link details for the target page (the editor's tab and list). */
  options?: NavigateOptions
  class: string
  /** Marks the link as the page currently shown, via `data-active`. */
  active?: boolean
  /** Runs once an in-app navigation has been started, e.g. to close the mobile menu. */
  onNavigate?: () => void
}

/**
 * A real `<a href="#/…">` to another admin page. Middle-clicks and
 * modifier-clicks open the URL in a new tab like any other link, while a plain
 * click is handled in-app so the unsaved-changes guard gets to intercept it
 * before the address bar moves.
 */
export const NavLink: ParentComponent<NavLinkProps> = (props) => {
  const routing = useRouting()

  const handleClick = (event: MouseEvent): void => {
    const opensElsewhere =
      event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    if (event.defaultPrevented || opensElsewhere) return
    event.preventDefault()
    routing.navigate(props.page, props.options)
    props.onNavigate?.()
  }

  return (
    <a
      class={props.class}
      href={routeToHash(toRoute(props.page, props.options))}
      data-active={props.active ? 'true' : undefined}
      aria-current={props.active ? 'page' : undefined}
      onClick={handleClick}
    >
      {props.children}
    </a>
  )
}
