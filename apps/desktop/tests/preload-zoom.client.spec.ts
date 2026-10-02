// @vitest-environment jsdom
/** Native chrome keeps its minimum physical clearance at reduced workspace zoom. */
import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../src/ipc.ts'
import { syncWorkspaceZoom } from '../src/preload-zoom.ts'

const electron = vi.hoisted(() => ({ ipcRenderer: { on: vi.fn(), off: vi.fn() }, webFrame: { getZoomFactor: vi.fn(() => 1) } }))
vi.mock('electron', () => electron)
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  document.documentElement.style.cssText = ''
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

it.each(['darwin', 'win32', 'linux'] as const)('restores and updates %s chrome compensation', (platform) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
  electron.webFrame.getZoomFactor.mockReturnValue(0.5)
  syncWorkspaceZoom()
  const style = document.documentElement.style
  expect(style.getPropertyValue('--dsh-native-chrome-scale')).toBe('2')
  expect(style.getPropertyValue('--dsh-windows-titlebar-height')).toBe(platform === 'win32' ? '80px' : '')
  const listener = electron.ipcRenderer.on.mock.calls.find(([name]) => name === DESKTOP_IPC.zoomChanged)![1] as
    (event: object, factor: number) => void
  listener({}, 2)
  expect(style.getPropertyValue('--dsh-native-chrome-scale')).toBe('1')
  expect(style.getPropertyValue('--dsh-windows-titlebar-height')).toBe(platform === 'win32' ? '40px' : '')
  window.dispatchEvent(new Event('pagehide'))
  expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.zoomChanged, listener)
})

it('waits for the document root and uses the latest zoom notification', () => {
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
  electron.webFrame.getZoomFactor.mockReturnValue(1)
  syncWorkspaceZoom()
  expect(document.documentElement.style.getPropertyValue('--dsh-native-chrome-scale')).toBe('')
  const listener = electron.ipcRenderer.on.mock.calls[0]![1] as (event: object, factor: number) => void
  const root = document.documentElement
  const getter = vi.spyOn(document, 'documentElement', 'get').mockReturnValue(null as never)
  listener({}, 0.5)
  getter.mockRestore()
  window.dispatchEvent(new Event('DOMContentLoaded'))
  expect(root.style.getPropertyValue('--dsh-native-chrome-scale')).toBe('2')
})
