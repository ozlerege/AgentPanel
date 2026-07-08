export function isTrustedUrl(
  url: string,
  devServerUrl: string | undefined
): boolean {
  if (url.startsWith('file://')) return true
  if (devServerUrl && url.startsWith(devServerUrl)) return true
  return false
}
