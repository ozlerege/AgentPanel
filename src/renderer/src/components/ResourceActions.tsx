import { useState } from 'react'
import {
  Copy,
  Download,
  Eye,
  MoreHorizontal,
  Power,
  RotateCcw,
  Trash2
} from 'lucide-react'
import type { AppError } from '@shared/ipc'
import type { ChangePreview, ResourceDocument, ResourceMutation } from '@shared/resource'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { PreviewDialog } from './editor/PreviewDialog'

interface ResourceActionTarget {
  id: string
  kind: string
  name: string
  enabled: boolean | 'unsupported'
  scope: 'user' | 'project' | 'directory'
}

interface ResourceActionsProps {
  resource: ResourceActionTarget
  scopeLabel: string
  buttonLabel?: string
  onChanged(selectedId?: string): void
}

type PendingKind = 'duplicate' | 'delete' | 'set-enabled'

interface PendingMutation {
  kind: PendingKind
  mutation: ResourceMutation
  preview: ChangePreview
}

function errorFrom(cause: unknown, operation: string): AppError {
  return {
    code: 'internal',
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    changed: false
  }
}

export function ResourceActions({
  resource,
  scopeLabel,
  buttonLabel,
  onChanged
}: ResourceActionsProps) {
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [duplicateName, setDuplicateName] = useState(`${resource.name} copy`)
  const [pending, setPending] = useState<PendingMutation | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<AppError | null>(null)
  const [deletedBackup, setDeletedBackup] = useState<{ id: string; name: string } | null>(null)
  const [exportedTo, setExportedTo] = useState<string | null>(null)

  const previewMutation = async (kind: PendingKind, mutation: ResourceMutation) => {
    setBusy(true)
    setFailure(null)
    const envelope = await window.desktopApi.resources.preview(mutation)
    setBusy(false)
    if (!envelope.ok) {
      setFailure(envelope.error)
      return
    }
    setPending({ kind, mutation, preview: envelope.data })
  }

  const duplicate = async () => {
    setDuplicateOpen(false)
    await previewMutation('duplicate', {
      action: 'duplicate',
      resourceId: resource.id,
      newName: duplicateName.trim()
    })
  }

  const previewFromDocument = async (kind: 'delete' | 'set-enabled', enabled?: boolean) => {
    setBusy(true)
    setFailure(null)
    let doc: ResourceDocument
    try {
      doc = await window.desktopApi.resources.read(resource.id)
    } catch (cause) {
      setFailure(errorFrom(cause, 'resources:read'))
      setBusy(false)
      return
    }
    setBusy(false)
    await previewMutation(
      kind,
      kind === 'delete'
        ? { action: 'delete', resourceId: doc.id, base: doc.fingerprints }
        : { action: 'set-enabled', resourceId: doc.id, enabled: enabled === true, base: doc.fingerprints }
    )
  }

  const applyPending = async () => {
    if (pending === null) return
    setBusy(true)
    setFailure(null)
    const envelope = await window.desktopApi.resources.apply(pending.mutation)
    setBusy(false)
    const appliedKind = pending.kind
    setPending(null)
    if (!envelope.ok) {
      setFailure(envelope.error)
      return
    }
    if (appliedKind === 'delete') {
      setDeletedBackup({ id: envelope.data.backupId, name: resource.name })
      onChanged(undefined)
      return
    }
    onChanged(envelope.data.document?.id)
  }

  const restoreDeleted = async () => {
    if (deletedBackup === null) return
    setBusy(true)
    const envelope = await window.desktopApi.resources.restore(deletedBackup.id)
    setBusy(false)
    setDeletedBackup(null)
    if (!envelope.ok) {
      setFailure(envelope.error)
      return
    }
    onChanged(envelope.data.document?.id)
  }

  const exportResource = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const result = await window.desktopApi.resources.export(resource.id)
      if (result.savedTo !== null) setExportedTo(result.savedTo)
    } catch (cause) {
      setFailure(errorFrom(cause, 'resources:export'))
    } finally {
      setBusy(false)
    }
  }

  const revealResource = async () => {
    setBusy(true)
    setFailure(null)
    try {
      await window.desktopApi.resources.reveal(resource.id)
    } catch (cause) {
      setFailure(errorFrom(cause, 'resources:reveal'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={buttonLabel === undefined ? 'icon-xs' : 'sm'}
            aria-label={buttonLabel ?? `Actions for ${resource.name}`}
            disabled={busy}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal aria-hidden />
            {buttonLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
          {resource.kind !== 'instructions' ? (
            <DropdownMenuItem onSelect={() => setDuplicateOpen(true)}>
              <Copy aria-hidden /> Duplicate
            </DropdownMenuItem>
          ) : null}
          {resource.enabled !== 'unsupported' ? (
            <DropdownMenuItem onSelect={() => previewFromDocument('set-enabled', !resource.enabled)}>
              <Power aria-hidden /> {resource.enabled ? 'Disable' : 'Enable'}
            </DropdownMenuItem>
          ) : null}
          {resource.kind !== 'mcp-servers' ? (
            <DropdownMenuItem onSelect={exportResource}>
              <Download aria-hidden /> Export
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={revealResource}>
            <Eye aria-hidden /> Reveal in Finder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => previewFromDocument('delete')}>
            <Trash2 aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {failure ? (
        <Dialog open onOpenChange={(open) => (!open ? setFailure(null) : undefined)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Action failed</DialogTitle>
              <DialogDescription>{failure.message}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setFailure(null)}>
                OK
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {duplicateOpen ? (
        <Dialog open onOpenChange={(open) => setDuplicateOpen(open)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Duplicate {resource.name}</DialogTitle>
              <DialogDescription>Choose a name for the new resource.</DialogDescription>
            </DialogHeader>
            <Input value={duplicateName} onChange={(event) => setDuplicateName(event.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDuplicateOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={duplicate} disabled={duplicateName.trim() === ''}>
                Duplicate
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {pending ? (
        <PreviewDialog
          preview={pending.preview}
          busy={busy}
          title={
            pending.kind === 'delete'
              ? `Delete ${resource.name}`
              : pending.kind === 'duplicate'
                ? `Duplicate ${resource.name}`
                : `${resource.enabled ? 'Disable' : 'Enable'} ${resource.name}`
          }
          description={
            pending.kind === 'delete'
              ? `${scopeLabel} resource. Review every affected file before deleting. A backup is created first.`
              : 'A backup of every affected file is created before anything is written.'
          }
          confirmLabel={
            pending.kind === 'delete'
              ? 'Delete resource'
              : pending.kind === 'duplicate'
                ? 'Create duplicate'
                : resource.enabled
                  ? 'Disable resource'
                  : 'Enable resource'
          }
          confirmVariant={pending.kind === 'delete' ? 'destructive' : 'default'}
          onConfirm={applyPending}
          onClose={() => setPending(null)}
        />
      ) : null}

      {deletedBackup ? (
        <Dialog open onOpenChange={(open) => (!open ? setDeletedBackup(null) : undefined)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Deleted {deletedBackup.name}</DialogTitle>
              <DialogDescription>
                {scopeLabel} resource deleted. A backup was created before files were removed.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={restoreDeleted} disabled={busy}>
                <RotateCcw aria-hidden /> Undo
              </Button>
              <Button size="sm" onClick={() => setDeletedBackup(null)}>
                OK
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {exportedTo ? (
        <Dialog open onOpenChange={(open) => (!open ? setExportedTo(null) : undefined)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Export complete</DialogTitle>
              <DialogDescription className="break-all font-mono">{exportedTo}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setExportedTo(null)}>
                OK
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
