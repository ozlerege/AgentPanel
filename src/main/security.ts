import { app } from 'electron'
import { isTrustedUrl } from './ipc/trust'

/**
 * Global hardening per spec section 14: deny window creation, block
 * navigation to untrusted origins, and refuse webview attachment for every
 * WebContents the app ever creates. Call before app ready.
 */
export function applySecurityPolicy(devServerUrl: string | undefined): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url, devServerUrl)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })
}
