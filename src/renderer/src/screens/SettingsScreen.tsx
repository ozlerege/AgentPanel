import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
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
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-4">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Settings</h1>
          <p className="text-[12px] text-muted-foreground">How Desmos Agent looks and behaves.</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <Card className="max-w-md gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-[13px]">Appearance</CardTitle>
            <CardDescription className="text-[12px]">
              Follow the system, or pick a side.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <div
              role="radiogroup"
              aria-label="Theme"
              className="inline-flex rounded-lg border border-border bg-muted p-0.5"
            >
              {THEMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === option.value}
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    'rounded-md px-3 py-1 text-[12px] transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    theme === option.value
                      ? 'bg-background font-medium shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
