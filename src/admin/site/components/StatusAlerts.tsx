import type { Component } from 'solid-js'
import { Show } from 'solid-js'

interface StatusAlertsProps {
  status: string | null
  error: string | null
}

export const StatusAlerts: Component<StatusAlertsProps> = (props) => {
  return (
    <>
      <Show when={props.status}>
        <div class="alert alert-success">{props.status}</div>
      </Show>
      <Show when={props.error}>
        <div class="alert alert-error">{props.error}</div>
      </Show>
    </>
  )
}
