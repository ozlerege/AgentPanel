import { Archive, ChevronDown, Folder, LayoutGrid, Settings, SlidersHorizontal } from 'lucide-react'
import type { ProviderCapabilities, ProviderStatus } from '@shared/ipc'
import { cn } from '../lib/utils'
import { buildNavSections, type NavSection } from '../navigation'
import { ProviderLogo } from './ProviderLogo'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

const ITEM_ICONS: Record<string, typeof LayoutGrid> = {
  overview: LayoutGrid,
  projects: Folder,
  backups: Archive,
  settings: Settings
}

interface NavSidebarProps {
  capabilities: ProviderCapabilities[]
  providers: ProviderStatus[] | null
  selected: string
  onSelect(key: string): void
}

interface ProviderNavSectionProps {
  section: NavSection
  status?: ProviderStatus
  selected: string
  onSelect(key: string): void
}

function ProviderNavSection({ section, status, selected, onSelect }: ProviderNavSectionProps) {
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-1.5 rounded-md px-2 pb-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          <ProviderLogo providerId={section.providerId!} className="size-3" />
          <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {section.label}
          </span>
          {status ? (
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              <span
                aria-hidden
                className={cn('size-1.5 rounded-full', status.detected ? 'bg-ok' : 'bg-border')}
              />
              {status.detected ? 'detected' : 'not found'}
            </span>
          ) : null}
          <ChevronDown
            aria-hidden
            className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <NavItems items={section.items} selected={selected} onSelect={onSelect} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function NavItems({
  items,
  selected,
  onSelect
}: {
  items: NavSection['items']
  selected: string
  onSelect(key: string): void
}) {
  return (
    <ul className="flex flex-col gap-px">
      {items.map((item) => {
        const Icon = ITEM_ICONS[item.key]
        const active = selected === item.key
        return (
          <li key={item.key}>
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(item.key)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left text-[13px] transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                active
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              {Icon ? (
                <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
              ) : (
                <span className="w-3.5 shrink-0" aria-hidden />
              )}
              {item.label}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function NavSidebar({ capabilities, providers, selected, onSelect }: NavSidebarProps) {
  const sections = buildNavSections(capabilities)

  const statusFor = (providerId: string) =>
    providers?.find((status) => status.id === providerId)

  return (
    <nav
      aria-label="Main navigation"
      className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-muted/50"
    >
      <div className="flex items-center gap-2 px-4 pb-4 pt-5">
        <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <SlidersHorizontal className="size-3.5" aria-hidden />
        </div>
        <span className="text-[13px] font-semibold tracking-tight">Agent Control</span>
      </div>

      <div className="flex flex-col gap-5 px-3 pb-4">
        {sections.map((section) => {
          const status = section.providerId ? statusFor(section.providerId) : undefined
          if (section.providerId) {
            return (
              <ProviderNavSection
                key={section.key}
                section={section}
                status={status}
                selected={selected}
                onSelect={onSelect}
              />
            )
          }

          return (
            <div key={section.key}>
              {section.label ? (
                <div className="flex items-center justify-between px-2 pb-1.5">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {section.label}
                  </span>
                </div>
              ) : null}
              <NavItems items={section.items} selected={selected} onSelect={onSelect} />
            </div>
          )
        })}
      </div>
    </nav>
  )
}
