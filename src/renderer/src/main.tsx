import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyStoredFontSizeBeforePaint } from './lib/font-size'
import { applyStoredThemeBeforePaint } from './lib/theme'
import './assets/main.css'

// Apply appearance prefs before the first paint so the app never flashes the
// wrong theme or font size on startup. Providers take over once React mounts.
applyStoredThemeBeforePaint()
applyStoredFontSizeBeforePaint()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
