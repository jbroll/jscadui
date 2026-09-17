import { rb } from '@jbroll/rowboat-schema'
import { z } from 'zod'

export const Project = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  name: rb.text(),
  entry: rb.text(),
  kind: rb.text(),
  mode: rb.text(),
  created: rb.int(),
  updated: rb.int(),
})

export const FileRow = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  projectId: rb.text({ index: true }),
  path: rb.text(),
  hash: rb.media(),
})

export const Version = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  projectId: rb.text({ index: true }),
  versionId: rb.text(),
  created: rb.int(),
  message: rb.text(),
  manifest: rb.json(z.array(z.object({ path: z.string(), hash: rb.media() }))),
})

export const Conversation = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  projectId: rb.text({ index: true }),
  messages: rb.json(z.array(z.unknown())),
  updated: rb.int(),
})

export const schema = {
  projects: Project,
  files: FileRow,
  versions: Version,
  conversations: Conversation,
}
