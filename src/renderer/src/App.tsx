import { useCallback, useEffect, useRef, useState } from 'react'
import { PanelLeft } from 'lucide-react'
import type { ProviderCapabilities, ProviderStatus, ProviderUsage } from '@shared/ipc'
import { EmptyState } from './components/EmptyState'
import { NavSidebar } from './components/NavSidebar'
import { Button } from './components/ui/button'
import { FontSizeProvider } from './lib/font-size'
import { ThemeProvider } from './lib/theme'
import { cn } from './lib/utils'
import { HistoryScreen } from './screens/HistoryScreen'
import { OverviewScreen } from './screens/OverviewScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { ResourceListScreen } from './screens/ResourceListScreen'
import { SettingsScreen } from './screens/SettingsScreen'

interface ScreenProps {
  selected: string
  capabilities: ProviderCapabilities[]
  providers: ProviderStatus[] | null
  usage: ProviderUsage[] | null
  usageLoading: boolean
  resourceChangeVersion: number
  onRefreshUsage(): void
}

function Screen({
  selected,
  capabilities,
  providers,
  usage,
  usageLoading,
  resourceChangeVersion,
  onRefreshUsage
}: ScreenProps) {
  if (selected === 'overview') {
    return (
      <OverviewScreen
        providers={providers}
        usage={usage}
        usageLoading={usageLoading}
        onRefreshUsage={onRefreshUsage}
      />
    )
  }
  if (selected === 'projects') return <ProjectsScreen />
  if (selected === 'settings') return <SettingsScreen />
  if (selected === 'backups') return <HistoryScreen />
  if (selected.startsWith('provider/')) {
    const [, providerId, categoryId] = selected.split('/')
    const provider = capabilities.find((c) => c.providerId === providerId)
    const category = provider?.categories.find((c) => c.id === categoryId)
    if (provider && category) {
      return (
        <ResourceListScreen
          key={selected}
          providerId={provider.providerId}
          kind={category.id}
          title={`${provider.displayName} ${category.label}`}
          kindLabel={category.label}
          createScopes={category.createScopes}
          resourceChangeVersion={resourceChangeVersion}
        />
      )
    }
    return (
      <EmptyState
        title="Unknown category"
        description="Pick a section from the sidebar."
      />
    )
  }
  return <EmptyState title="Nothing selected" description="Pick a section from the sidebar." />
}

const SIDEBAR_STORAGE_KEY = 'agent-control-sidebar'

export default function App() {
  const [selected, setSelected] = useState('overview')
  const [capabilities, setCapabilities] = useState<ProviderCapabilities[]>([])
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null)
  const [usage, setUsage] = useState<ProviderUsage[] | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [resourceChangeVersion, setResourceChangeVersion] = useState(0)
  const usageRequestInFlight = useRef(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'false'
  })

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarOpen))
  }, [sidebarOpen])

  useEffect(() => {
    window.desktopApi.providers
      .capabilities()
      .then(setCapabilities)
      .catch(() => setCapabilities([]))
    window.desktopApi.providers
      .detect()
      .then(setProviders)
      .catch(() => setProviders([]))
  }, [])

  useEffect(() => {
    return window.desktopApi.events.onResourcesChanged(() => {
      setResourceChangeVersion((version) => version + 1)
    })
  }, [])

  const refreshUsage = useCallback(() => {
    if (usageRequestInFlight.current) return
    usageRequestInFlight.current = true
    setUsageLoading(true)
    window.desktopApi.usage
      .list()
      .then(setUsage)
      .catch(() => setUsage([]))
      .finally(() => {
        usageRequestInFlight.current = false
        setUsageLoading(false)
      })
  }, [])

  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(refreshUsage, { timeout: 1000 })
      return () => window.cancelIdleCallback(idleId)
    }
    const timeoutId = globalThis.setTimeout(refreshUsage, 250)
    return () => globalThis.clearTimeout(timeoutId)
  }, [refreshUsage])

  return (
    <ThemeProvider>
      <FontSizeProvider>
        <div className="flex h-screen overflow-hidden">
          <div
            className={cn(
              'shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out motion-reduce:transition-none',
              sidebarOpen ? 'w-60' : 'w-0'
            )}
            aria-hidden={!sidebarOpen}
          >
            <NavSidebar
              capabilities={capabilities}
              providers={providers}
              selected={selected}
              onSelect={setSelected}
              onToggle={() => setSidebarOpen(false)}
              className={cn(
                'transition-opacity duration-200 ease-in-out motion-reduce:transition-none',
                sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            />
          </div>
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div
              className={cn(
                'sticky top-0 z-10 overflow-hidden border-b border-border bg-background/95 backdrop-blur-sm transition-[max-height,opacity,border-color] duration-300 ease-in-out motion-reduce:transition-none',
                sidebarOpen ? 'max-h-0 border-transparent opacity-0' : 'max-h-14 opacity-100'
              )}
            >
              <div className="px-4 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Show sidebar"
                  aria-hidden={sidebarOpen}
                  tabIndex={sidebarOpen ? -1 : 0}
                  onClick={() => setSidebarOpen(true)}
                >
                  <PanelLeft aria-hidden />
                </Button>
              </div>
            </div>
            <Screen
              selected={selected}
              capabilities={capabilities}
              providers={providers}
              usage={usage}
              usageLoading={usageLoading}
              resourceChangeVersion={resourceChangeVersion}
              onRefreshUsage={refreshUsage}
            />
          </main>
        </div>
      </FontSizeProvider>
    </ThemeProvider>
  )
}
