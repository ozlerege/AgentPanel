import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyStoredThemeBeforePaint } from './lib/theme'
import './assets/main.css'

// Set the .dark class before the first paint so the app never flashes the
// wrong theme on startup. ThemeProvider takes over once React mounts.
applyStoredThemeBeforePaint()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
