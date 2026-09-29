import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readableDirs } from './sandbox.js'

describe('readableDirs', () => {
  it('grants the main checkout node_modules a linked worktree resolves through', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-dirs-')))
    try {
      const main = join(root, 'main')
      const worktree = join(root, 'worktree')
      for (const dir of ['node_modules/.bin', '.deps-cache', 'packages/agent-loop/node_modules']) mkdirSync(join(main, dir), { recursive: true })
      mkdirSync(join(worktree, 'node_modules'), { recursive: true })
      mkdirSync(join(worktree, 'packages/agent-loop'), { recursive: true })
      mkdirSync(join(worktree, 'packages/other'))
      symlinkSync(join(main, '.deps-cache'), join(worktree, '.deps-cache'))
      symlinkSync(join(main, 'node_modules/.bin'), join(worktree, 'node_modules/.bin'))
      symlinkSync(join(main, 'packages/agent-loop/node_modules'), join(worktree, 'packages/agent-loop/node_modules'))

      const dirs = readableDirs(pathToFileURL(`${worktree}/`))
      expect(dirs).toContain(join(main, '.deps-cache'))
      expect(dirs).toContain(join(main, 'node_modules'))
      expect(dirs).toContain(join(main, 'packages/agent-loop/node_modules'))
      expect(dirs).not.toContain(join(main, 'packages'))
      expect(dirs).not.toContain(join(main, 'packages/agent-loop'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('grants only its own dirs in a plain checkout', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-dirs-')))
    try {
      for (const dir of ['node_modules', '.deps-cache', 'packages']) mkdirSync(join(root, dir))
      expect(readableDirs(pathToFileURL(`${root}/`)).sort()).toEqual(
        ['node_modules', '.deps-cache', 'packages'].map((d) => join(root, d)).sort(),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
