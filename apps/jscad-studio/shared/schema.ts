/**
 * jscad-studio project data plane — rowboat rb.* tables, compiled with
 * @jbroll/rowboat-schema and provisioned out of band with rowboat-cli.
 *
 * Lives at the app root (not under src/) because the same manifest is imported by
 * the app's storage layer and by rowboat-cli provision-tenant, which needs a
 * module path it can import directly.
 *
 * Every table is scoped (rb.scope()): rows carry owner_group_id and the rowboat
 * engine routes reads/writes by the acting author's groups.
 *
 * `files.hash` is an rb.media() cell ({ hash, size }) — the media-table
 * declaration the file routes' read authz needs. Until the rowboat server wires
 * per-database media read authz, blob reads stay default-deny (403); uploads and
 * sync work.
 */
import { type RowOf, rb } from '@jbroll/rowboat-schema'
import { z } from 'zod'

export const Project = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  name: rb.text(),
  entry: rb.text(),
  // Derived from the entry's extension at write time: 'jscad' or 'openscad'.
  kind: rb.text(),
  // The storage mode that owns this project: 'cloud' | 'folder' | 'git'.
  mode: rb.text(),
  created: rb.int(), // epoch ms
  updated: rb.int(), // epoch ms
})

export const FileRow = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  projectId: rb.text({ index: true }),
  path: rb.text(),
  // The file's bytes live in rowboat's object store; this cell references them.
  hash: rb.media(),
})

export const Version = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  projectId: rb.text({ index: true }),
  versionId: rb.text(),
  created: rb.int(), // epoch ms
  message: rb.text(),
  // The version's file snapshot: an array of { path, hash: { hash, size } }.
  // An array, not a record: the server's blob-GC probe compiler only descends
  // object properties and array items, and refuses a record's dynamic keys.
  manifest: rb.json(z.array(z.object({ path: z.string(), hash: rb.media() }))),
})

// One row per project; a session resumes from the messages it holds.
export const Conversation = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  projectId: rb.text({ index: true }),
  messages: rb.json(z.array(z.unknown())),
  updated: rb.int(), // epoch ms
})

// Per-user singleton: one row whose id IS the user's id.
export const Settings = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  provider: rb.text(),
  model: rb.text(),
  keyMode: rb.text(),
  encryptedKey: rb.text(),
})

export const schema = {
  projects: Project,
  files: FileRow,
  versions: Version,
  conversations: Conversation,
  settings: Settings,
}

export type ProjectRow = RowOf<typeof Project>
export type FileRowRow = RowOf<typeof FileRow>
export type VersionRow = RowOf<typeof Version>
export type ConversationRow = RowOf<typeof Conversation>
export type SettingsRow = RowOf<typeof Settings>