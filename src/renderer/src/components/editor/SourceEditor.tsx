import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView } from '@codemirror/view'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import type { Extension } from '@codemirror/state'
import type { ResourceDocument } from '@shared/resource'

interface SourceEditorProps {
  /** Initial content. The editor owns the text after mount — remount via key to reset. */
  value: string
  format: ResourceDocument['native']['format']
  onChange(next: string): void
}

function language(format: SourceEditorProps['format']): Extension[] {
  if (format === 'markdown') return [markdown()]
  if (format === 'json') return [json()]
  return []
}

export function SourceEditor({ value, format, onChange }: SourceEditorProps) {
  const container = useRef<HTMLDivElement>(null)
  const latestOnChange = useRef(onChange)
  latestOnChange.current = onChange

  useEffect(() => {
    if (!container.current) return
    const view = new EditorView({
      doc: value,
      parent: container.current,
      extensions: [
        basicSetup,
        ...language(format),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latestOnChange.current(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { fontSize: '12px', backgroundColor: 'transparent' },
          '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, monospace)' },
          '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
          '&.cm-focused': { outline: '2px solid var(--ring)', outlineOffset: '-2px' }
        }),
        EditorView.contentAttributes.of({
          role: 'textbox',
          'aria-label': 'Source editor',
          'aria-multiline': 'true'
        })
      ]
    })
    return () => view.destroy()
    // Mount-only by design: `value` seeds the document, the editor owns it after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format])

  return (
    <div
      ref={container}
      role="region"
      aria-label="Source editor"
      className="max-h-96 min-h-40 overflow-auto rounded-lg border border-border bg-muted/30"
    />
  )
}
