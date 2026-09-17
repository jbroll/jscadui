# Rowboat storage — design

Date: 2026-09-17. Status: approved sections 1-3 in brainstorming.

## Goal

Give `apps/jscad-web` local-first rowboat storage: model files live in local
files or rowboat files/folders per project, and everything else
(conversations, versions, metadata) lives in rowboat tables locally until
connected — then syncs, with sharing possible later.

## Background

jscad-web keeps model files in the service-worker FS, provider selection in
`localStorage`, keys in `@jscadui/key-store`, and conversations nowhere. The
studio plan specified the storage interface and rowboat tables (plan
`docs/superpowers/plans/2026-09-16-jscad-studio.md` Task 10); checklist
(`src/lib/rowboat.tsx`) proves the local-first sync pattern: `buildRowboatDb`
IndexedDB store, `syncWithServer` on an interval while signed in, short-lived
JWTs, anonymous users local-only. jscad-web is vanilla JS, so only the
lower-level client pieces transfer, not the React bindings.

## 1. Schema and local-first store

Tables in `apps/jscad-web/src/storage/schema.js`: `projects (id, name,
entry, kind, mode, created, updated)`, `files (projectId, path, hash)`,
`versions (projectId, versionId, created, message, manifest)`,
`conversations (projectId, messages, updated)`. Settings stay where they are
(`localStorage` selection, `key-store` custody). Compiled with
`@jbroll/rowboat-schema`, stored with `buildRowboatDb` from
`@jbroll/rowboat-client`. Anonymous users get the local store only; sign-in
starts the sync loop with a short-lived JWT from a new studio-server route
`GET /api/sync-token` (15m expiry, same shape as the data-plane tokens).

## 2. File-content modes, mixing, sync, and sharing

Per-project `mode`: `local` (default, current FS/handle behavior) or
`rowboat` (bytes as blobs via rowboat file routes, media tables declared so
reads are not default-deny). `writeModel` and editor saves write through the
mode backend, then record a `versions` row plus `files` hashes either way.

Mixed local/rowboat models work by merging at load time: `jscadScript`
assembles one file map from both backends — manifest files from their tagged
backend, unlisted sibling requires resolved local-first then rowboat — and
hands it to the worker's `require`. Each manifest path names exactly one
backend, so collisions cannot occur. Local models can require rowboat parts
and vice versa.

Sync pushes/pulls tables on an interval while signed in; blobs upload on
write and download on demand. Sharing is schema-ready but off: rows carry
group scoping from day one, no share UI or routes in this slice.

## 3. Wiring, tests, deploy

`editor.runScript` and `writeModel` go through the storage interface; chat
conversations persist per project; the `view`/`measure` loop is untouched.
Tests: interface against a fake local backend plus a recorded sync
transcript (no live server); mixed-manifest map assembly; zip
export/import round trip.

Prod push (owner actions, after code lands): provision the prod rowboat
tenant and record its `databaseId`; create
`/etc/jscad-relay/providers.json` on the server (the relay answers `500`
without it); run `deploy-full.sh prod`; run smoke including the relay
origin probe.

## Non-goals

Settings/key sync across devices, share UI and share routes, server-side
model execution, migration of existing anonymous local files (they become
`local`-mode projects as-is).
