import type { ProviderCapabilities } from '@shared/ipc'
import { cn } from '../lib/utils'
import { buildNavSections } from '../navigation'

interface NavSidebarProps {
  capabilities: ProviderCapabilities[]
  selected: string
  onSelect(key: string): void
}

export function NavSidebar({ capabilities, selected, onSelect }: NavSidebarProps) {
  const sections = buildNavSections(capabilities)
  return (
    <nav
      aria-label="Main navigation"
      className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-muted/40 p-3"
    >
      <div className="px-2 pt-1 text-sm font-semibold tracking-tight">Agent Control</div>
      {sections.map((section) => (
        <div key={section.key}>
          {section.label ? (
            <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {section.label}
            </div>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  aria-current={selected === item.key ? 'page' : undefined}
                  onClick={() => onSelect(item.key)}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
                    selected === item.key
                      ? 'bg-accent font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
