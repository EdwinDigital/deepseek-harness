/** Built desktop zoom and preload behavior across real Electron process restarts. */
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const hasDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)

// Linux Electron needs an actual display or xvfb; all data stays in the fixture-owned directory.
it.skipIf(!hasDisplay)('scales the workspace, aligns native views, and restores zoom after restart', { retry: 0 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-zoom-electron-'))
  try {
    const userData = join(root, 'browser')
    await mkdir(userData)
    const built = fileURLToPath(new URL('../lib/types/zoom.js', import.meta.url))
    const preload = fileURLToPath(new URL('../lib/preload-app.cjs', import.meta.url))
    const styles = ['ui-layout', 'ui-conversation'].map(name => fileURLToPath(
      new URL(`../../../packages/client/${name}/lib/client.js`, import.meta.url)))
    if (![built, preload, ...styles].every(path => existsSync(path))) {
      throw new Error('Desktop zoom artifacts are missing; build Host and Client libraries before this test')
    }
    const electron: unknown = require('electron')
    if (typeof electron !== 'string') throw new Error('Electron executable is unavailable')
    const fixture = fileURLToPath(new URL('./fixtures/zoom-smoke.mjs', import.meta.url))
    const observed: string[] = []
    for (const phase of ['first', 'restart']) {
      const result = await execa(electron, [fixture, built, preload, userData, phase], {
        env: { ELECTRON_RUN_AS_NODE: undefined, DSH_CLIENT_VERSION: '1.2.3' },
        timeout: 45_000, forceKillAfterDelay: 5_000, reject: false,
      })
      expect(result.timedOut, result.stderr).toBe(false)
      expect(result.signal, result.stderr).toBeUndefined()
      expect(result.exitCode, result.stderr).toBe(0)
      const line = result.stdout.split('\n').find(value => value.startsWith('ZOOM_RESULT '))
      if (line === undefined) throw new Error(`Missing Electron result: ${result.stdout}\n${result.stderr}`)
      const states: unknown = JSON.parse(line.slice('ZOOM_RESULT '.length))
      if (!Array.isArray(states) || !states.every((value): value is string => typeof value === 'string')) {
        throw new Error('Invalid Electron zoom result')
      }
      observed.push(...states)
    }
    expect(observed.join('\n') + '\n').toBe(await readFile(new URL('./expected/zoom.txt', import.meta.url), 'utf8'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
