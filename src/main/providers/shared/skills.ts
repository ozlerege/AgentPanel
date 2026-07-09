import { basename, dirname, join } from 'node:path'
import type { NativeResource, ResourceDocument } from '../../../shared/resource'
import { buildDocument, missingFieldDiagnostics, stringField } from './document'
import type { ScopeTemplate } from './document'
import { parseFrontmatter } from './frontmatter'
import { fileExists, listFiles, listSubdirectories, readTextFile } from './scan'

export function discoverSkills(skillsDir: string, template: ScopeTemplate): NativeResource[] {
  return listSubdirectories(skillsDir).map((dir) => {
    const active = join(dir, 'SKILL.md')
    const disabled = join(dir, 'SKILL.md.disabled')
    const isDisabled = !fileExists(active) && fileExists(disabled)
    return {
      ...template,
      kind: 'skills',
      paths: [isDisabled ? disabled : active],
      disabled: isDisabled
    }
  })
}

export function parseSkill(native: NativeResource): ResourceDocument {
  const skillMd = native.paths[0]
  const dir = dirname(skillMd)
  const fallbackName = basename(dir)
  const supportingFiles = listFiles(dir, '')
    .map((path) => basename(path))
    .filter((name) => name !== 'SKILL.md' && name !== 'SKILL.md.disabled')
  const raw = readTextFile(skillMd)
  if (raw === null) {
    return buildDocument(native, {
      name: fallbackName,
      fields: supportingFiles.length > 0 ? { supportingFiles } : {},
      native: { format: 'directory' },
      diagnostics: [
        {
          severity: 'error',
          message: 'Skill directory has no SKILL.md',
          path: dir
        }
      ]
    })
  }
  const parsed = parseFrontmatter(raw)
  const diagnostics = parsed.diagnostics.map((diagnostic) => ({ ...diagnostic, path: skillMd }))
  const parseFailed = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  return buildDocument(native, {
    name: stringField(parsed.fields, 'name') ?? fallbackName,
    description: stringField(parsed.fields, 'description'),
    fields: supportingFiles.length > 0 ? { ...parsed.fields, supportingFiles } : parsed.fields,
    native: { format: 'markdown', raw },
    diagnostics: parseFailed
      ? diagnostics
      : [
          ...diagnostics,
          ...missingFieldDiagnostics(parsed.fields, ['name', 'description'], skillMd)
        ]
  })
}
