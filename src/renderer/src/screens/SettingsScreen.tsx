import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { useFontSize, type FontSize } from '../lib/font-size'
import { useTheme, type Theme } from '../lib/theme'
import { cn } from '../lib/utils'

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

const FONT_SIZES: Array<{ value: FontSize; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' }
]

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange(value: T): void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border border-border bg-muted p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1 text-[12px] transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            value === option.value
              ? 'bg-background font-medium shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsScreen() {
  const { theme, setTheme } = useTheme()
  const { fontSize, setFontSize } = useFontSize()
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
          <CardContent className="flex flex-col gap-5 px-4">
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-muted-foreground">Theme</span>
              <SegmentedControl
                label="Theme"
                options={THEMES}
                value={theme}
                onChange={setTheme}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-muted-foreground">Font size</span>
              <SegmentedControl
                label="Font size"
                options={FONT_SIZES}
                value={fontSize}
                onChange={setFontSize}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
