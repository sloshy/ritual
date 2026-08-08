import type { Component } from 'solid-js'
import { For } from 'solid-js'
import { useT } from '../ui/i18n'
import { NAV_DESTINATIONS, type NavActiveState } from './nav-destinations'

export type MobileTabBarProps = {
  active: NavActiveState
}

/**
 * Fixed bottom tab bar — the phone-layout replacement for the header nav links
 * (hidden at the same breakpoint; see MOBILE_LAYOUT_QUERY). Hidden while edit
 * mode is on, where the editor's bottom action dock owns that edge.
 */
export const MobileTabBar: Component<MobileTabBarProps> = (props) => {
  const t = useT()
  return (
    <nav class="mobile-tabbar" aria-label={t('site.header.primaryNav')}>
      <For each={NAV_DESTINATIONS}>
        {(tab) => (
          <a
            href={tab.href}
            class="mobile-tab"
            classList={{ active: props.active[tab.key] }}
            aria-current={props.active[tab.key] ? 'page' : undefined}
          >
            <span class="mobile-tab-icon" aria-hidden="true">
              {tab.icon}
            </span>
            {/* The destination names are message keys, resolved through the
                reactive `t` so a language switch relabels the tabs in the same
                render as the page they sit under. */}
            <span class="mobile-tab-label">{t(tab.label)}</span>
          </a>
        )}
      </For>
    </nav>
  )
}
