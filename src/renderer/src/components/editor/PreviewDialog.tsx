import { useState } from 'react'
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import type { ChangePreview } from '@shared/resource'
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
  onConfirm(): void
  onClose(): void
}

export function PreviewDialog({ preview, busy, onConfirm, onClose }: PreviewDialogProps) {
  const [warningsConfirmed, setWarningsConfirmed] = useState(false)
  const errors = preview.validation.diagnostics.filter((d) => d.severity === 'error')
  const warnings = preview.validation.diagnostics.filter((d) => d.severity === 'warning')
  const hasChanges = preview.diffs.some((diff) => diff.unified !== '')
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
          <DialogTitle>Review changes</DialogTitle>
          <DialogDescription>
            A backup of every affected file is created before anything is written.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          {preview.conflicts.length > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px]">
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
            <Button size="sm" onClick={onConfirm} disabled={blocked}>
              {busy ? 'Applying…' : 'Apply changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
