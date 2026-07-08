import { useEffect, useState } from 'react'
import type { ProviderCapabilities } from '@shared/ipc'
import { EmptyState } from './components/EmptyState'
import { NavSidebar } from './components/NavSidebar'
import { ThemeProvider } from './lib/theme'
import { OverviewScreen } from './screens/OverviewScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { SettingsScreen } from './screens/SettingsScreen'

function Screen({ selected, capabilities }: { selected: string; capabilities: ProviderCapabilities[] }) {
  if (selected === 'overview') return <OverviewScreen />
  if (selected === 'projects') return <ProjectsScreen />
  if (selected === 'settings') return <SettingsScreen />
  if (selected === 'backups') {
    return (
      <EmptyState
        title="Backups"
        description="Every change Agent Control makes will create a restorable backup here."
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
        description="Read-only discovery of this resource type is the next milestone."
        milestone="Milestone 2"
      />
    )
  }
  return <EmptyState title="Not found" description="Unknown navigation target." />
}

export default function App() {
  const [selected, setSelected] = useState('overview')
  const [capabilities, setCapabilities] = useState<ProviderCapabilities[]>([])

  useEffect(() => {
    window.desktopApi.providers
      .capabilities()
      .then(setCapabilities)
      .catch(() => setCapabilities([]))
  }, [])

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden">
        <NavSidebar capabilities={capabilities} selected={selected} onSelect={setSelected} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Screen selected={selected} capabilities={capabilities} />
        </main>
      </div>
    </ThemeProvider>
  )
}
