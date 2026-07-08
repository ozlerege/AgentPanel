import { cn } from '@renderer/lib/utils'

interface DiffViewProps {
  unified: string
}

/** Renders a unified diff with line coloring; hides the jsdiff header lines. */
export function DiffView({ unified }: DiffViewProps) {
  const lines = unified.split('\n')
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'))
  const visible = firstHunk === -1 ? lines : lines.slice(firstHunk)
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
      {visible.map((line, index) => (
        <div
          key={index}
          className={cn(
            line.startsWith('+') && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
            line.startsWith('-') && 'bg-red-500/15 text-red-700 dark:text-red-400',
            line.startsWith('@@') && 'text-muted-foreground'
          )}
        >
          {line === '' ? ' ' : line}
        </div>
      ))}
    </pre>
  )
}
