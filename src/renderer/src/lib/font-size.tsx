import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from 'react'

export type FontSize = 'default' | 'medium' | 'large'

interface FontSizeContextValue {
  fontSize: FontSize
  setFontSize(size: FontSize): void
}

const STORAGE_KEY = 'agent-control-font-size'

const FONT_SIZE_ZOOM: Record<FontSize, string> = {
  default: '1',
  medium: '1.1',
  large: '1.2'
}

const FontSizeContext = createContext<FontSizeContextValue>({
  fontSize: 'default',
  setFontSize: () => undefined
})

function isFontSize(value: string | null): value is FontSize {
  return value === 'default' || value === 'medium' || value === 'large'
}

function applyFontSize(size: FontSize): void {
  document.documentElement.style.zoom = FONT_SIZE_ZOOM[size]
}

export function applyStoredFontSizeBeforePaint(): void {
  const stored = localStorage.getItem(STORAGE_KEY)
  applyFontSize(isFontSize(stored) ? stored : 'default')
}

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSize] = useState<FontSize>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isFontSize(stored) ? stored : 'default'
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, fontSize)
    applyFontSize(fontSize)
  }, [fontSize])

  return (
    <FontSizeContext.Provider value={{ fontSize, setFontSize }}>
      {children}
    </FontSizeContext.Provider>
  )
}

export function useFontSize(): FontSizeContextValue {
  return useContext(FontSizeContext)
}
