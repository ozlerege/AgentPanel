import { useTheme, type Theme } from '../lib/theme'
import { cn } from '../lib/utils'

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

export function SettingsScreen() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <div className="mt-5 max-w-md rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium">Appearance</div>
        <div role="radiogroup" aria-label="Theme" className="mt-3 flex gap-2">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={theme === option.value}
              onClick={() => setTheme(option.value)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                theme === option.value
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
