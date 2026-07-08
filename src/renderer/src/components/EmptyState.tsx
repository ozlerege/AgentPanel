interface EmptyStateProps {
  title: string
  description: string
  milestone?: string
}

export function EmptyState({ title, description, milestone }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {milestone ? (
        <span className="mt-2 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
          Planned for {milestone}
        </span>
      ) : null}
    </div>
  )
}
