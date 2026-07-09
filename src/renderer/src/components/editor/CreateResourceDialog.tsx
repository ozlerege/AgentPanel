import { useMemo, useState } from 'react'
import { AlertTriangle, FileUp, Plus, X } from 'lucide-react'
import type { AppError, Project } from '@shared/ipc'
import type { ChangePreview, ProviderId, ResourceDocument } from '@shared/resource'
import {
  buildResourceCreateDraft,
  type EnvRow
} from '../../lib/editor-model'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Input } from '../ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select'
import { Textarea } from '../ui/textarea'
import { PreviewDialog } from './PreviewDialog'

interface CreateResourceDialogProps {
  providerId: ProviderId
  kind: string
  kindLabel: string
  createScopes: Array<'user' | 'project'>
  projects: Project[]
  onCreated(doc: ResourceDocument): void
  onClose(): void
}

function stem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

function initialScope(createScopes: Array<'user' | 'project'>, projects: Project[]): string {
  if (createScopes.includes('user')) return 'user'
  return projects[0] === undefined ? 'project:' : `project:${projects[0].id}`
}

export function CreateResourceDialog({
  providerId,
  kind,
  kindLabel,
  createScopes,
  projects,
  onCreated,
  onClose
}: CreateResourceDialogProps) {
  const [scopeValue, setScopeValue] = useState(() => initialScope(createScopes, projects))
  const [name, setName] = useState(kind === 'instructions' ? 'Instructions' : '')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [developerInstructions, setDeveloperInstructions] = useState('')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [imported, setImported] = useState<{ fileName: string; raw: string } | null>(null)
  const [preview, setPreview] = useState<ChangePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<AppError | null>(null)

  const selectedScope = scopeValue.startsWith('project:') ? 'project' : 'user'
  const selectedProjectId = scopeValue.startsWith('project:') ? scopeValue.slice('project:'.length) : undefined
  const canImport = kind === 'agents' || kind === 'commands'
  const isMcp = kind === 'mcp-servers'
  const isCodexAgent = providerId === 'codex' && kind === 'agents'
  const hasBody = !isMcp && !isCodexAgent
  const canSubmit = name.trim() !== '' && (selectedScope === 'user' || selectedProjectId !== '')

  const scopeOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = []
    if (createScopes.includes('user')) options.push({ value: 'user', label: 'User' })
    if (createScopes.includes('project')) {
      projects.forEach((project) => options.push({ value: `project:${project.id}`, label: project.name }))
    }
    return options
  }, [createScopes, projects])

  const buildMutation = () => ({
    action: 'create' as const,
    draft: buildResourceCreateDraft({
      provider: providerId,
      kind,
      scope: selectedScope,
      projectId: selectedProjectId,
      name: name.trim(),
      description,
      body: hasBody ? body : undefined,
      developerInstructions,
      command,
      argsText,
      envRows,
      raw: imported?.raw
    })
  })

  const pickImport = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const result = await window.desktopApi.imports.pick(providerId, kind)
      if (result !== null) {
        setImported(result)
        setName(stem(result.fileName))
      }
    } catch (cause) {
      setFailure({
        code: 'invalid-request',
        operation: 'imports:pick',
        message: cause instanceof Error ? cause.message : String(cause),
        changed: false
      })
    } finally {
      setBusy(false)
    }
  }

  const requestPreview = async () => {
    setBusy(true)
    setFailure(null)
    const envelope = await window.desktopApi.resources.preview(buildMutation())
    setBusy(false)
    if (!envelope.ok) {
      setFailure(envelope.error)
      return
    }
    setPreview(envelope.data)
  }

  const confirmApply = async () => {
    setBusy(true)
    setFailure(null)
    const envelope = await window.desktopApi.resources.apply(buildMutation())
    setBusy(false)
    setPreview(null)
    if (!envelope.ok) {
      setFailure(envelope.error)
      return
    }
    if (envelope.data.document !== null) onCreated(envelope.data.document)
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[min(86vh,48rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create {kindLabel}</DialogTitle>
          <DialogDescription>Review the planned files before applying.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto pr-1">
          <div className="flex flex-col gap-3">
            {failure ? (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px]">
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <span>{failure.message}</span>
              </div>
            ) : null}

            <label className="flex flex-col gap-1 text-[12px]">
              <span className="font-medium">Scope</span>
              <Select value={scopeValue} onValueChange={setScopeValue}>
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scopeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            {kind === 'instructions' ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
                {providerId === 'codex' ? 'AGENTS.md' : 'CLAUDE.md'}
              </div>
            ) : (
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="font-medium">{isMcp ? 'Entry key' : 'Name'}</span>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            )}

            {canImport ? (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] font-medium">
                    {imported === null ? 'Native import' : imported.fileName}
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={pickImport} disabled={busy}>
                    <FileUp aria-hidden /> Import file
                  </Button>
                </div>
                {imported !== null ? (
                  <Textarea className="max-h-40 font-mono" value={imported.raw} readOnly rows={6} />
                ) : null}
              </div>
            ) : null}

            {!isMcp && kind !== 'instructions' ? (
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="font-medium">Description</span>
                <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
            ) : null}

            {isCodexAgent ? (
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="font-medium">Developer instructions</span>
                <Textarea
                  rows={8}
                  className="font-mono"
                  value={developerInstructions}
                  onChange={(event) => setDeveloperInstructions(event.target.value)}
                />
              </label>
            ) : null}

            {isMcp ? (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-[12px]">
                  <span className="font-medium">Command</span>
                  <Input value={command} onChange={(event) => setCommand(event.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-[12px]">
                  <span className="font-medium">Arguments (one per line)</span>
                  <Textarea
                    rows={4}
                    className="font-mono"
                    value={argsText}
                    onChange={(event) => setArgsText(event.target.value)}
                  />
                </label>
                <div className="flex flex-col gap-1 text-[12px]">
                  <span className="font-medium">Environment variables</span>
                  {envRows.map((row, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        aria-label={`Variable ${index + 1} name`}
                        className="font-mono"
                        value={row.key}
                        onChange={(event) =>
                          setEnvRows(envRows.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)))
                        }
                      />
                      <Input
                        aria-label={`Variable ${index + 1} value`}
                        className="font-mono"
                        value={row.value}
                        onChange={(event) =>
                          setEnvRows(envRows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove variable ${index + 1}`}
                        onClick={() => setEnvRows(envRows.filter((_, i) => i !== index))}
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => setEnvRows([...envRows, { key: '', value: '' }])}
                  >
                    <Plus aria-hidden /> Add variable
                  </Button>
                </div>
              </div>
            ) : null}

            {hasBody ? (
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="font-medium">{kind === 'instructions' ? 'Content' : 'Body'}</span>
                <Textarea
                  rows={10}
                  className="font-mono"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </label>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={requestPreview} disabled={busy || !canSubmit}>
            {busy && preview === null ? 'Preparing...' : 'Review & create'}
          </Button>
        </div>

        {preview ? (
          <PreviewDialog
            preview={preview}
            busy={busy}
            onConfirm={confirmApply}
            onClose={() => setPreview(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
