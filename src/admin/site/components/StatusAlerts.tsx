interface StatusAlertsProps {
  status: string | null
  error: string | null
}

export function StatusAlerts({ status, error }: StatusAlertsProps) {
  return (
    <>
      {status && <div class="alert alert-success">{status}</div>}
      {error && <div class="alert alert-error">{error}</div>}
    </>
  )
}
