import { useMemo, useState } from 'react'
import { AlertTriangle, Plus, X } from 'lucide-react'
import type { AppError } from '@shared/ipc'
import type {
  ChangePreview,
  ResourceDocument,
  ResourceEdit,
  ResourceEditPayload
} from '@shared/resource'
import {
  formFieldSpecs,
  hasBodyEditor,
  initialArgs,
  initialEnv,
  initialFieldValues,
  splitBody,
  supportsSourceEdit
} from '../../lib/editor-model'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { PreviewDialog } from './PreviewDialog'
import { SourceEditor } from './SourceEditor'

interface ResourceEditorProps {
  doc: ResourceDocument
  onCancel(): void
  onSaved(fresh: ResourceDocument): void
  /** Re-read the document after an external change (drops current edits). */
  onReload(): void
}

type EditorTab = 'form' | 'source'

interface EnvRow {
  key: string
  value: string
}

export function ResourceEditor({ doc, onCancel, onSaved, onReload }: ResourceEditorProps) {
  const specs = useMemo(() => formFieldSpecs(doc), [doc])
  const isMcp = doc.kind === 'mcp-servers'
  const sourceEditable = supportsSourceEdit(doc)
  const bodyEditable = hasBodyEditor(doc)

  const [tab, setTab] = useState<EditorTab>('form')
  const [fields, setFields] = useState(() => initialFieldValues(doc, specs))
  const [body, setBody] = useState(() => splitBody(doc.native.raw ?? ''))
  const [command, setCommand] = useState(() =>
    typeof doc.fields['command'] === 'string' ? doc.fields['command'] : ''
  )
  const [argsText, setArgsText] = useState(() => initialArgs(doc))
  const [envRows, setEnvRows] = useState<EnvRow[]>(() => initialEnv(doc))
  const [source, setSource] = useState(doc.native.raw ?? '')
  const [preview, setPreview] = useState<ChangePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<AppError | null>(null)

  const buildEdit = (): ResourceEdit => {
    let payload: ResourceEditPayload
    if (tab === 'source' && sourceEditable) {
      payload = { mode: 'source', raw: source }
    } else if (isMcp) {
      payload = {
        mode: 'form',
        fields: {
          command,
          args: argsText
            .split('\n')
            .map((arg) => arg.trim())
            .filter((arg) => arg !== ''),
          env: Object.fromEntries(
            envRows.filter((row) => row.key.trim() !== '').map((row) => [row.key.trim(), row.value])
          )
        }
      }
    } else {
      payload = {
        mode: 'form',
        fields: { ...fields },
        body: bodyEditable ? body : undefined
      }
    }
    return { resourceId: doc.id, base: doc.fingerprints, edit: payload }
  }

  const requestPreview = async () => {
    setBusy(true)
    setFailure(null)
    const envelope = await window.desktopApi.resources.preview(buildEdit())
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
    const envelope = await window.desktopApi.resources.apply(buildEdit())
    setBusy(false)
    setPreview(null)
    if (!envelope.ok) {
      setFailure(envelope.error)
      return
    }
    onSaved(envelope.data.document)
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-4">
      {sourceEditable ? (
        <div className="flex gap-1 self-start rounded-lg border border-border p-0.5">
          {(['form', 'source'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => setTab(candidate)}
              className={cn(
                'rounded-md px-3 py-1 text-[12px] font-medium transition-colors',
                tab === candidate
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {candidate === 'form' ? 'Form' : 'Source'}
            </button>
          ))}
        </div>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px]"
        >
          <span className="flex items-start gap-2">
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
            <span>
              {failure.code === 'conflict'
                ? 'This file changed outside Agent Control since you loaded it.'
                : failure.message}
              {failure.recovery ? ` ${failure.recovery}` : ''}
            </span>
          </span>
          {failure.code === 'conflict' ? (
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onReload}>
                Reload latest (drops your edits)
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFailure(null)}>
                Keep editing
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}

      {tab === 'source' && sourceEditable ? (
        <SourceEditor value={source} format={doc.native.format} onChange={setSource} />
      ) : isMcp ? (
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
                    setEnvRows(
                      envRows.map((r, i) => (i === index ? { ...r, key: event.target.value } : r))
                    )
                  }
                />
                <Input
                  aria-label={`Variable ${index + 1} value`}
                  className="font-mono"
                  value={row.value}
                  onChange={(event) =>
                    setEnvRows(
                      envRows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r))
                    )
                  }
                />
                <Button
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
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setEnvRows([...envRows, { key: '', value: '' }])}
            >
              <Plus aria-hidden /> Add variable
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {specs.map((spec) => (
            <label key={spec.key} className="flex flex-col gap-1 text-[12px]">
              <span className="font-medium">{spec.label}</span>
              {spec.multiline ? (
                <Textarea
                  rows={3}
                  value={fields[spec.key] ?? ''}
                  onChange={(event) => setFields({ ...fields, [spec.key]: event.target.value })}
                />
              ) : (
                <Input
                  value={fields[spec.key] ?? ''}
                  onChange={(event) => setFields({ ...fields, [spec.key]: event.target.value })}
                />
              )}
            </label>
          ))}
          {bodyEditable ? (
            <label className="flex flex-col gap-1 text-[12px]">
              <span className="font-medium">
                {doc.kind === 'instructions' ? 'Content' : 'Body'}
              </span>
              <Textarea
                rows={10}
                className="font-mono"
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>
          ) : null}
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={requestPreview} disabled={busy}>
          {busy && !preview ? 'Preparing…' : 'Review & save'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
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
    </div>
  )
}
