import type { ProviderCapabilities, ProviderStatus } from '@shared/ipc'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { cn } from '../lib/utils'

const PROVIDER_DOT: Record<string, string> = {
  codex: 'bg-provider-codex',
  claude: 'bg-provider-claude'
}

interface OverviewScreenProps {
  providers: ProviderStatus[] | null
  capabilities: ProviderCapabilities[]
}

export function OverviewScreen({ providers, capabilities }: OverviewScreenProps) {
  const categoryCount = (providerId: string) =>
    capabilities.find((c) => c.providerId === providerId)?.categories.length ?? 0

  return (
    <div className="mx-auto max-w-3xl px-8 py-7">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Providers Agent Control found on this machine.
        </p>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(providers ?? []).map((provider) => (
          <Card key={provider.id} className="gap-3 py-4">
            <CardHeader className="px-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-[13px] font-semibold">
                  <span
                    aria-hidden
                    className={cn(
                      'size-2 rounded-full',
                      PROVIDER_DOT[provider.id] ?? 'bg-muted-foreground'
                    )}
                  />
                  {provider.displayName}
                </CardTitle>
                {provider.detected ? (
                  <Badge variant="outline" className="gap-1.5 text-[11px] font-normal">
                    <span aria-hidden className="size-1.5 rounded-full bg-ok" />
                    Detected
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[11px] font-normal">
                    Not detected
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-4">
              {provider.configRoot ? (
                <code className="block truncate rounded bg-muted px-1.5 py-1 font-mono text-[11px] text-muted-foreground">
                  {provider.configRoot}
                </code>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  No configuration folder found. Install {provider.displayName} or run it once to
                  create one.
                </p>
              )}
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                {categoryCount(provider.id)} resource categories
              </p>
            </CardContent>
          </Card>
        ))}
        {providers === null ? (
          <p className="text-[13px] text-muted-foreground">Checking for providers…</p>
        ) : null}
      </div>

      <section className="mt-8 rounded-lg border border-border bg-muted/40 p-4">
        <h2 className="text-[13px] font-semibold">What you can do right now</h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
          <li>
            Register project folders under <span className="font-medium text-foreground">Projects</span> so
            their resources are included when discovery arrives.
          </li>
          <li>
            Browsing and inspecting agents, skills, and MCP servers lands in Milestone 2 — safe
            editing with previews and backups in Milestone 3.
          </li>
        </ul>
      </section>
    </div>
  )
}
