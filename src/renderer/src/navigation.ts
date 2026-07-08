import type { ProviderCapabilities } from '@shared/ipc'

export interface NavItem {
  key: string
  label: string
}

export interface NavSection {
  key: string
  label: string | null
  items: NavItem[]
}

/**
 * Build the sidebar from adapter capabilities. Provider categories are data,
 * never hard-coded here (spec section 8.2).
 */
export function buildNavSections(capabilities: ProviderCapabilities[]): NavSection[] {
  return [
    { key: 'general', label: null, items: [{ key: 'overview', label: 'Overview' }] },
    ...capabilities.map((provider) => ({
      key: `provider/${provider.providerId}`,
      label: provider.displayName,
      items: provider.categories.map((category) => ({
        key: `provider/${provider.providerId}/${category.id}`,
        label: category.label
      }))
    })),
    {
      key: 'app',
      label: null,
      items: [
        { key: 'projects', label: 'Projects' },
        { key: 'backups', label: 'Backups' },
        { key: 'settings', label: 'Settings' }
      ]
    }
  ]
}
