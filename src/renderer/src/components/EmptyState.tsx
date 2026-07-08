interface EmptyStateProps {
  title: string
  description: string
  milestone?: string
}

export function EmptyState({ title, description, milestone }: EmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        {milestone ? (
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {milestone}
          </span>
        ) : null}
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
