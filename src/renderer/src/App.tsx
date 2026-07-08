import { useEffect, useState } from 'react'
import type { ProviderCapabilities, ProviderStatus } from '@shared/ipc'
import { EmptyState } from './components/EmptyState'
import { NavSidebar } from './components/NavSidebar'
import { ThemeProvider } from './lib/theme'
import { OverviewScreen } from './screens/OverviewScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { SettingsScreen } from './screens/SettingsScreen'

interface ScreenProps {
  selected: string
  capabilities: ProviderCapabilities[]
  providers: ProviderStatus[] | null
}

function Screen({ selected, capabilities, providers }: ScreenProps) {
  if (selected === 'overview') {
    return <OverviewScreen providers={providers} capabilities={capabilities} />
  }
  if (selected === 'projects') return <ProjectsScreen />
  if (selected === 'settings') return <SettingsScreen />
  if (selected === 'backups') {
    return (
      <EmptyState
        title="No backups yet"
        description="Agent Control snapshots every file before changing it. Restorable backups will be listed here."
        milestone="Milestone 3"
      />
    )
  }
  if (selected.startsWith('provider/')) {
    const [, providerId, categoryId] = selected.split('/')
    const provider = capabilities.find((c) => c.providerId === providerId)
    const category = provider?.categories.find((c) => c.id === categoryId)
    return (
      <EmptyState
        title={`${provider?.displayName ?? ''} ${category?.label ?? ''}`.trim()}
        description="Everything this provider keeps on disk will be listed and inspectable here, without opening a single config file."
        milestone="Milestone 2"
      />
    )
  }
  return <EmptyState title="Nothing selected" description="Pick a section from the sidebar." />
}

export default function App() {
  const [selected, setSelected] = useState('overview')
  const [capabilities, setCapabilities] = useState<ProviderCapabilities[]>([])
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null)

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

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden">
        <NavSidebar
          capabilities={capabilities}
          providers={providers}
          selected={selected}
          onSelect={setSelected}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Screen selected={selected} capabilities={capabilities} providers={providers} />
        </main>
      </div>
    </ThemeProvider>
  )
}
