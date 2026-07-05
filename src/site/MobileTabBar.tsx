import type { Component } from 'solid-js'
import { For } from 'solid-js'
import { NAV_DESTINATIONS, type NavActiveState } from './nav-destinations'

export type MobileTabBarProps = {
  active: NavActiveState
}

/**
 * Fixed bottom tab bar — the phone-layout replacement for the header nav links
 * (hidden at the same breakpoint; see MOBILE_LAYOUT_QUERY). Hidden while edit
 * mode is on, where the editor's bottom action dock owns that edge.
 */
export const MobileTabBar: Component<MobileTabBarProps> = (props) => (
  <nav class="mobile-tabbar" aria-label="Primary">
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
          <span class="mobile-tab-label">{tab.label}</span>
        </a>
      )}
    </For>
  </nav>
)
