/** Workspace zoom persists exact steps and orders rapid menu actions. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopZoom, desktopZoomItems, openDesktopZoom } from '../src/zoom.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function path() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-zoom-'))
  roots.push(root)
  return join(root, 'zoom.json')
}

it('defaults to 100%, restores committed zoom after restart, and persists reset', async () => {
  const filename = await path()
  const zoom = await openDesktopZoom(filename)
  expect(zoom.factor).toBe(1)
  await expect(readFile(filename)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await zoom.change('in')).toBe(1.1)
  const restarted = await openDesktopZoom(filename)
  expect(restarted.factor).toBe(1.1)
  await restarted.change('reset')
  expect((await openDesktopZoom(filename)).factor).toBe(1)
  expect(JSON.parse(await readFile(filename, 'utf8'))).toEqual({ version: 1, factor: 1 })
})

it.each(['{', 'null', '[]', '{"version":2,"factor":1}', '{"version":1,"factor":1.234}', '{"version":1,"factor":"1"}', '{"version":1,"factor":1e999}'])
('refuses invalid preferences without rewriting them: %s', async (raw) => {
  const filename = await path()
  await writeFile(filename, raw)
  await expect(openDesktopZoom(filename)).rejects.toThrow('desktop zoom:')
  expect(await readFile(filename, 'utf8')).toBe(raw)
})

it('does not reinterpret an unreadable path as a missing preference', async () => {
  const filename = await path()
  await writeFile(filename, 'not a directory')
  await expect(openDesktopZoom(join(filename, 'zoom.json'))).rejects.toMatchObject({ code: 'ENOTDIR' })
})

it('serializes relative intents and drains pending saves before exit', async () => {
  const first = Promise.withResolvers<undefined>()
  const write = vi.fn<(factor: number) => Promise<void>>().mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
  const zoom = new DesktopZoom(1, write)
  const changes = [zoom.change('in'), zoom.change('in'), zoom.change('out')]
  const idle = vi.fn()
  void zoom.idle().then(idle)
  await Promise.resolve()
  expect(write.mock.calls).toEqual([[1.1]])
  expect(zoom.factor).toBe(1)
  expect(idle).not.toHaveBeenCalled()
  first.resolve(undefined)
  expect(await Promise.all(changes)).toEqual([1.1, 1.25, 1.1])
  await zoom.idle()
  expect(write.mock.calls).toEqual([[1.1], [1.25], [1.1]])
  expect(idle).toHaveBeenCalledOnce()
})

it('retains the previous scale on save failure and permits a retry', async () => {
  const write = vi.fn<(factor: number) => Promise<void>>().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
  const zoom = new DesktopZoom(1, write)
  await expect(zoom.change('in')).rejects.toThrow('disk full')
  expect(zoom.factor).toBe(1)
  expect(await zoom.change('in')).toBe(1.1)
  expect(write.mock.calls).toEqual([[1.1], [1.1]])
})

it('clamps at browser-style limits and avoids redundant writes', async () => {
  const write = vi.fn(async () => {})
  const zoom = new DesktopZoom(1, write)
  for (let i = 0; i < 20; i++) await zoom.change('in')
  expect(zoom.factor).toBe(2)
  for (let i = 0; i < 20; i++) await zoom.change('out')
  expect(zoom.factor).toBe(0.5)
  expect(write).toHaveBeenCalledTimes(15)
  await zoom.change('reset')
  await zoom.change('reset')
  expect(write).toHaveBeenCalledTimes(16)
})

it('registers localized workspace callbacks rather than focused-document zoom roles', () => {
  const change = vi.fn()
  const items = desktopZoomItems(resolveDesktopLocale('zh').messages, change)
  expect(items.map(({ label, accelerator, visible, role }) => ({ label, accelerator, hidden: visible === false, role })))
    .toMatchInlineSnapshot(`
      [
        {
          "accelerator": "CommandOrControl+Plus",
          "hidden": false,
          "label": "放大",
          "role": undefined,
        },
        {
          "accelerator": "CommandOrControl+-",
          "hidden": false,
          "label": "缩小",
          "role": undefined,
        },
        {
          "accelerator": "CommandOrControl+0",
          "hidden": false,
          "label": "重置缩放",
          "role": undefined,
        },
        {
          "accelerator": "CommandOrControl+=",
          "hidden": true,
          "label": "放大",
          "role": undefined,
        },
      ]
    `)
  for (const item of items) item.click?.({} as Electron.MenuItem, undefined, {})
  expect(change.mock.calls).toEqual([['in'], ['out'], ['reset'], ['in']])
})
