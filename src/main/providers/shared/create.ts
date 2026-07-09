import { AppOperationError } from '../../errors'
import { serializeTomlValue } from '../../fidelity/toml-edit'

export function slugifyName(name: string, operation: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug === '') {
    throw new AppOperationError(
      'invalid-request',
      operation,
      'Name must contain at least one letter or number.'
    )
  }
  return slug
}

export function assertEntryKey(name: string, operation: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new AppOperationError(
      'invalid-request',
      operation,
      'MCP server name may contain only letters, numbers, underscores, and hyphens.'
    )
  }
  return name
}

export function markdownTemplate(
  kind: 'agents' | 'skills' | 'commands',
  name: string,
  description: string,
  body: string
): string {
  const singular = kind === 'agents' ? 'agent' : kind === 'skills' ? 'skill' : 'command'
  const content = body === '' ? `Describe what this ${singular} does.` : body
  const fields =
    kind === 'commands'
      ? `description: ${description}`
      : `name: ${name}\ndescription: ${description}`
  return `---\n${fields}\n---\n\n${content.endsWith('\n') ? content : `${content}\n`}`
}

export function codexAgentTemplate(
  name: string,
  description: string,
  developerInstructions: string
): string {
  return [
    `name = ${serializeTomlValue(name)}`,
    `description = ${serializeTomlValue(description)}`,
    `developer_instructions = ${serializeTomlValue(developerInstructions)}`
  ].join('\n') + '\n'
}
