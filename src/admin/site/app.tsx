import type { ComponentChild } from 'preact'
import { render } from 'preact'
import { useState, useEffect, useCallback } from 'preact/hooks'
import type { Page } from './types'
import { Layout } from './components/Layout'
import { AuthGuard } from './components/AuthGuard'
import { Dashboard } from './pages/Dashboard'
import { ImportDeck } from './pages/ImportDeck'
import { BuildSite } from './pages/BuildSite'
import { CacheRefresh } from './pages/CacheRefresh'
import { ArchidektLogin } from './pages/ArchidektLogin'
import { Settings } from './pages/Settings'
import { AuditLog } from './pages/AuditLog'
import { DeckEditor } from './pages/DeckEditor'
import { DeckManager } from './pages/DeckManager'
import { CollectionEditor } from './pages/CollectionEditor'
import { WantedListEditor } from './pages/WantedListEditor'

function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [totpEnabled, setTotpEnabled] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)

  const checkStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/status')
      const data = (await resp.json()) as { setupRequired: boolean; totpEnabled?: boolean }
      setSetupRequired(data.setupRequired)
      setTotpEnabled(data.totpEnabled === true)

      // Check if we have an active session by probing an authenticated endpoint
      if (!data.setupRequired) {
        const probe = await fetch('/api/decks', { credentials: 'same-origin' })
        if (probe.ok) {
          setLoggedIn(true)
        }
      }
    } catch {
      setSetupRequired(true)
    }
  }, [])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  const onSetupComplete = useCallback(() => {
    setSetupRequired(false)
    setLoggedIn(true)
  }, [])

  const onLogin = useCallback(() => {
    setLoggedIn(true)
  }, [])

  const onLogout = useCallback(async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {
      // ignore
    }
    setLoggedIn(false)
  }, [])

  if (setupRequired === null) {
    return (
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh;">
        <p style="color: var(--text-muted);">Loading...</p>
      </div>
    )
  }

  if (setupRequired) {
    return <AuthGuard onSetupComplete={onSetupComplete} />
  }

  if (!loggedIn) {
    return <AuthGuard onLogin={onLogin} isLogin totpEnabled={totpEnabled} />
  }

  const pages = {
    dashboard: () => <Dashboard onNavigate={setPage} />,
    'deck-editor': () => <DeckEditor />,
    'deck-manager': () => <DeckManager />,
    'collection-editor': () => <CollectionEditor />,
    'wanted-list-editor': () => <WantedListEditor />,
    'import-deck': () => <ImportDeck />,
    'build-site': () => <BuildSite />,
    'cache-refresh': () => <CacheRefresh />,
    'archidekt-login': () => <ArchidektLogin />,
    settings: () => <Settings />,
    'audit-log': () => <AuditLog />,
  } satisfies Record<Page, () => ComponentChild>

  const renderPage = pages[page] ?? pages['dashboard']

  return (
    <Layout
      currentPage={page}
      onNavigate={setPage}
      onLogout={onLogout}
      fullWidth={
        page === 'deck-editor' || page === 'collection-editor' || page === 'wanted-list-editor'
      }
    >
      {renderPage()}
    </Layout>
  )
}

const root = document.getElementById('app')
if (root) {
  render(<App />, root)
}
