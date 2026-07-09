import { useState } from 'react'
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import type { ChangePreview, FileOperation } from '@shared/resource'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { DiffView } from './DiffView'

interface PreviewDialogProps {
  preview: ChangePreview
  busy: boolean
  title?: string
  description?: string
  confirmLabel?: string
  confirmVariant?: 'default' | 'destructive'
  onConfirm(): void
  onClose(): void
}

function operationLabel(operation: FileOperation): string {
  if (operation.kind === 'move') {
    return operation.toPath === undefined
      ? `Move ${operation.path}`
      : `Move ${operation.path} -> ${operation.toPath}`
  }
  if (operation.kind === 'delete') return `Delete ${operation.path}`
  if (operation.kind === 'rmdir') return `Remove directory ${operation.path}`
  if (operation.kind === 'mkdir') return `Create directory ${operation.path}`
  return `Write ${operation.path}`
}

export function PreviewDialog({
  preview,
  busy,
  title = 'Review changes',
  description = 'A backup of every affected file is created before anything is written.',
  confirmLabel = 'Apply changes',
  confirmVariant = 'default',
  onConfirm,
  onClose
}: PreviewDialogProps) {
  const [warningsConfirmed, setWarningsConfirmed] = useState(false)
  const errors = preview.validation.diagnostics.filter((d) => d.severity === 'error')
  const warnings = preview.validation.diagnostics.filter((d) => d.severity === 'warning')
  const nonWriteOperations = preview.operations.filter((operation) => operation.kind !== 'write')
  const hasChanges =
    preview.diffs.some((diff) => diff.unified !== '') || nonWriteOperations.length > 0
  const blocked =
    busy ||
    errors.length > 0 ||
    preview.conflicts.length > 0 ||
    !hasChanges ||
    (warnings.length > 0 && !warningsConfirmed)

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[min(85vh,52rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          {preview.conflicts.length > 0 ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px]">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <span>
                Changed outside Agent Control since you loaded it: {preview.conflicts.join(', ')}.
                Close this dialog and reload before applying.
              </span>
            </div>
          ) : null}

          {preview.validation.diagnostics.length > 0 ? (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Validation
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {preview.validation.diagnostics.map((diagnostic, index) => (
                  <li key={index} className="flex items-start gap-2 text-[12px]">
                    {diagnostic.severity === 'error' ? (
                      <OctagonAlert
                        aria-hidden
                        className="mt-0.5 size-3.5 shrink-0 text-destructive"
                      />
                    ) : diagnostic.severity === 'warning' ? (
                      <AlertTriangle
                        aria-hidden
                        className="mt-0.5 size-3.5 shrink-0 text-amber-500"
                      />
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

          {preview.diffs.map((diff) => (
            <section key={diff.path}>
              <code className="font-mono text-[11px] text-muted-foreground">{diff.path}</code>
              {diff.unified === '' ? (
                <p className="mt-1 text-[12px] text-muted-foreground">No changes.</p>
              ) : (
                <div className="mt-1">
                  <DiffView unified={diff.unified} />
                </div>
              )}
            </section>
          ))}
          {nonWriteOperations.length > 0 ? (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                File operations
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {nonWriteOperations.map((operation, index) => (
                  <li key={`${operation.kind}:${operation.path}:${index}`} className="rounded-md border border-border bg-muted/40 px-3 py-2">
                    <code className="break-all font-mono text-[11px] text-muted-foreground">
                      {operationLabel(operation)}
                    </code>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {!hasChanges ? (
            <p className="text-[12px] text-muted-foreground">
              Nothing to apply — the edit produces identical content.
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          {warnings.length > 0 ? (
            <label className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={warningsConfirmed}
                onChange={(event) => setWarningsConfirmed(event.target.checked)}
              />
              Apply despite warnings
            </label>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant={confirmVariant} onClick={onConfirm} disabled={blocked}>
              {busy ? 'Applying...' : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
