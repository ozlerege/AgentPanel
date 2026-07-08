export function changedLineNumbers(before: string, after: string): number[] {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const changed: number[] = []
  const max = Math.max(beforeLines.length, afterLines.length)
  for (let i = 0; i < max; i++) {
    if (beforeLines[i] !== afterLines[i]) changed.push(i + 1)
  }
  return changed
}
