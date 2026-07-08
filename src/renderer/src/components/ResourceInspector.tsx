import { useEffect, useState } from 'react'
import { AlertTriangle, Expand, Info, OctagonAlert } from 'lucide-react'
import type { ResourceDocument } from '@shared/resource'
import { formatFieldValue } from '../lib/mask'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from './ui/dialog'
import { ProviderLogo } from './ProviderLogo'

interface ResourceInspectorProps {
  resourceId: string
  kindLabel: string
  projectName?: string
}

interface FieldValueProps {
  name: string
  value: string
}

function FieldValue({ name, value }: FieldValueProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
      <span className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono">
        {value}
      </span>
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Expand ${name}`}
            title={`Expand ${name}`}
          >
            <Expand />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[min(80vh,48rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="break-all font-mono text-base">{name}</DialogTitle>
            <DialogDescription>Full field value</DialogDescription>
          </DialogHeader>
          <pre className="min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/50 p-3 font-mono text-[12px] leading-relaxed">
            {value}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ResourceInspector({ resourceId, kindLabel, projectName }: ResourceInspectorProps) {
  const [doc, setDoc] = useState<ResourceDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setError(null)
    window.desktopApi.resources
      .read(resourceId)
      .then((loaded) => {
        if (!cancelled) setDoc(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [resourceId])

  if (error) {
    return (
      <p role="alert" className="p-6 text-[13px] text-destructive">
        {error}
      </p>
    )
  }
  if (!doc) {
    return <p className="p-6 text-[13px] text-muted-foreground">Loading…</p>
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <ProviderLogo providerId={doc.provider} className="size-4" />
          <h2 className="text-[15px] font-semibold tracking-tight">{doc.name}</h2>
          <Badge variant="outline">{kindLabel}</Badge>
          <Badge variant="secondary">
            {doc.scope === 'user' ? 'User' : (projectName ?? 'Project')}
          </Badge>
        </div>
        {doc.description ? (
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {doc.description}
          </p>
        ) : null}
        <div className="mt-3 flex flex-col gap-1">
          {doc.sourcePaths.map((path) => (
            <code key={path} className="truncate font-mono text-[11px] text-muted-foreground">
              {path}
            </code>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Modified {new Date(doc.modifiedAt).toLocaleString()}
        </p>
      </header>

      {doc.diagnostics.length > 0 ? (
        <section className="border-b border-border px-6 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Diagnostics
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {doc.diagnostics.map((diagnostic, index) => (
              <li key={index} className="flex items-start gap-2 text-[12px]">
                {diagnostic.severity === 'error' ? (
                  <OctagonAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                ) : diagnostic.severity === 'warning' ? (
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                ) : (
                  <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span>
                  <span className="sr-only">{diagnostic.severity}: </span>
                  {diagnostic.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {Object.keys(doc.fields).length > 0 ? (
        <section className="border-b border-border px-6 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Fields
          </h3>
          <dl className="mt-2 divide-y divide-border/60">
            {Object.entries(doc.fields).map(([key, value]) => (
              <div
                key={key}
                className="grid grid-cols-[140px_1fr] gap-4 py-2.5 text-[12px] first:pt-0 last:pb-0"
              >
                <dt className="truncate font-mono text-muted-foreground">{key}</dt>
                <dd className="min-w-0">
                  <FieldValue name={key} value={formatFieldValue(key, value)} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {doc.native.raw !== undefined ? (
        <section className="px-6 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Source
          </h3>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
            {doc.native.raw}
          </pre>
        </section>
      ) : null}
    </div>
  )
}
