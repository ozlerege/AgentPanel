import { Activity, Gauge, RefreshCw, Waypoints } from 'lucide-react'
import type {
  DailyUsage,
  ProviderStatus,
  ProviderUsage,
  UsageWindow
} from '@shared/ipc'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '../components/ui/card'
import { Separator } from '../components/ui/separator'
import { ProviderLogo } from '../components/ProviderLogo'
import { cn } from '../lib/utils'

interface OverviewScreenProps {
  providers: ProviderStatus[] | null
  usage: ProviderUsage[] | null
  usageLoading: boolean
  onRefreshUsage(): void
}

const numberFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const timeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

function formatTokens(value: number): string {
  return numberFormat.format(value)
}

function formatReset(window: UsageWindow): string {
  return `Resets ${timeFormat.format(new Date(window.resetsAt))}`
}

function providerName(providerId: ProviderUsage['providerId']): string {
  return providerId === 'codex' ? 'Codex' : 'Claude Code'
}

function LimitMeter({ window, providerId }: { window: UsageWindow; providerId: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium">{window.label} limit</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {Math.round(window.usedPercent)}% used
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${window.label} limit used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(window.usedPercent)}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none',
            providerId === 'codex' ? 'bg-provider-codex' : 'bg-provider-claude'
          )}
          style={{ width: `${window.usedPercent}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground">{formatReset(window)}</span>
    </div>
  )
}

function ActivityChart({ days, providerId }: { days: DailyUsage[]; providerId: string }) {
  const maxTokens = Math.max(1, ...days.map((day) => day.tokens))
  const hasActivity = days.some((day) => day.tokens > 0 || day.sessions > 0)

  if (!hasActivity) {
    return (
      <div className="flex h-28 items-center justify-center rounded-lg bg-muted/50 text-[11px] text-muted-foreground">
        No activity in the last 14 days
      </div>
    )
  }

  return (
    <div
      className="grid h-28 grid-cols-14 items-end gap-1 rounded-lg bg-muted/35 px-2 pt-3 pb-2"
      aria-label="Fourteen day token and session activity"
    >
      {days.map((day, index) => {
        const height = day.tokens === 0 ? 2 : Math.max(8, Math.round((day.tokens / maxTokens) * 76))
        const label = `${dateFormat.format(new Date(`${day.date}T12:00:00`))}: ${formatTokens(day.tokens)} tokens, ${day.sessions} sessions`
        return (
          <div key={day.date} className="flex h-full min-w-0 flex-col items-center justify-end gap-1" title={label}>
            <div className="flex min-h-0 w-full flex-1 items-end justify-center">
              <div
                className={cn(
                  'w-full max-w-3 rounded-sm opacity-80',
                  providerId === 'codex' ? 'bg-provider-codex' : 'bg-provider-claude'
                )}
                style={{ height }}
                aria-label={label}
              />
            </div>
            <span className="font-mono text-[8px] leading-none text-muted-foreground">
              {index % 3 === 1 ? new Date(`${day.date}T12:00:00`).getDate() : '·'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function UsageCard({ usage, provider }: { usage: ProviderUsage; provider?: ProviderStatus }) {
  const sessionsInView = usage.daily.reduce((total, day) => total + day.sessions, 0)
  const hasLimits = usage.limits.length > 0

  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className="relative shrink-0"
              role="img"
              aria-label={`${providerName(usage.providerId)} ${provider?.detected ? 'detected' : 'not detected'}`}
            >
              <ProviderLogo providerId={usage.providerId} className="size-5" />
              <span
                aria-hidden
                className={cn(
                  'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card',
                  provider?.detected ? 'bg-ok' : 'bg-muted-foreground'
                )}
              />
            </div>
            <div className="flex flex-col gap-1">
              <CardTitle className="text-[14px]">{providerName(usage.providerId)}</CardTitle>
              <CardDescription className="text-[10px]">{usage.source}</CardDescription>
            </div>
          </div>
          <Badge variant={usage.status === 'available' ? 'outline' : 'secondary'} className="text-[10px] font-normal">
            {usage.status === 'available' ? 'Limits available' : usage.status === 'partial' ? 'Local data' : 'Unavailable'}
          </Badge>
        </div>
        {provider?.configRoot ? (
          <code
            className="mt-1 block break-all rounded bg-muted px-2 py-1.5 font-mono text-[10px] text-muted-foreground"
            title={provider.configRoot}
          >
            {provider.configRoot}
          </code>
        ) : (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {provider ? 'No local configuration folder found.' : 'Checking configuration path…'}
          </p>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4 px-5">
        <section className="flex flex-col gap-3" aria-label={`${providerName(usage.providerId)} limits`}>
          <div className="flex items-center gap-1.5">
            <Gauge aria-hidden className="size-3.5 text-muted-foreground" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Limits</h3>
          </div>
          {hasLimits ? (
            <div className="flex flex-col gap-3">
              {usage.limits.map((window) => (
                <LimitMeter key={`${window.label}-${window.windowMinutes}`} window={window} providerId={usage.providerId} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
              {usage.message ?? 'No current limit data is available.'}
            </div>
          )}
        </section>

        <Separator />

        <section className="flex flex-col gap-3" aria-label={`${providerName(usage.providerId)} activity`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Activity aria-hidden className="size-3.5 text-muted-foreground" />
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">14-day activity</h3>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">tokens / day</span>
          </div>
          <ActivityChart days={usage.daily} providerId={usage.providerId} />
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[16px] font-semibold">{formatTokens(usage.totalTokens)}</span>
              <span className="text-[10px] text-muted-foreground">tokens tracked</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[16px] font-semibold">{sessionsInView}</span>
              <span className="text-[10px] text-muted-foreground">sessions / 14d</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[16px] font-semibold">{usage.totalSessions}</span>
              <span className="text-[10px] text-muted-foreground">all sessions</span>
            </div>
          </div>
        </section>

        <Separator />

        <section className="flex flex-col gap-2" aria-label={`${providerName(usage.providerId)} recent sessions`}>
          <div className="flex items-center gap-1.5">
            <Waypoints aria-hidden className="size-3.5 text-muted-foreground" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recent sessions</h3>
          </div>
          {usage.recentSessions.length > 0 ? (
            <ul className="flex flex-col">
              {usage.recentSessions.slice(0, 3).map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium">{session.project}</p>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
                      {session.model ?? session.id.slice(0, 8)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[10px]">{formatTokens(session.tokens)} tokens</p>
                    <p className="mt-0.5 text-[9px] text-muted-foreground">
                      {dateFormat.format(new Date(session.updatedAt))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-[11px] text-muted-foreground">No sessions found.</p>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

export function OverviewScreen({
  providers,
  usage,
  usageLoading,
  onRefreshUsage
}: OverviewScreenProps) {
  return (
    <div className="mx-auto max-w-5xl px-8 py-7">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Local usage, limits, and sessions. Refreshing does not make model calls.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={usageLoading} onClick={onRefreshUsage}>
          <RefreshCw data-icon="inline-start" className={cn(usageLoading && 'animate-spin')} aria-hidden />
          {usageLoading ? 'Refreshing' : 'Refresh'}
        </Button>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {usage?.map((providerUsage) => (
          <UsageCard
            key={providerUsage.providerId}
            usage={providerUsage}
            provider={providers?.find((provider) => provider.id === providerUsage.providerId)}
          />
        ))}
        {usage === null ? (
          <div className="col-span-full flex min-h-52 items-center justify-center rounded-xl border bg-card text-[12px] text-muted-foreground">
            Reading local provider usage…
          </div>
        ) : null}
        {usage?.length === 0 ? (
          <div className="col-span-full flex min-h-52 flex-col items-center justify-center gap-2 rounded-xl border bg-card text-center">
            <p className="text-[12px] font-medium">Usage data could not be loaded</p>
            <p className="max-w-sm text-[11px] text-muted-foreground">
              Provider detection still works. Refresh to retry reading local session metadata.
            </p>
          </div>
        ) : null}
      </div>

    </div>
  )
}
