/** Keeps native window-control clearances usable when the workspace is zoomed out. */
import { ipcRenderer, webFrame } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'
import { WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'

/** Publish chrome compensation only inside the trusted workspace document. */
export function syncWorkspaceZoom(): void {
  let factor = webFrame.getZoomFactor()
  const apply = (): void => {
    const root = document.documentElement as HTMLElement | null
    if (root === null) return
    const scale = Math.max(1, 1 / factor)
    root.style.setProperty('--dsh-native-chrome-scale', String(scale))
    if (process.platform === 'win32') root.style.setProperty('--dsh-windows-titlebar-height', `${WINDOWS_TITLEBAR_HEIGHT * scale}px`)
  }
  const changed = (_event: Electron.IpcRendererEvent, value: number): void => {
    factor = value
    apply()
  }
  ipcRenderer.on(DESKTOP_IPC.zoomChanged, changed)
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', apply, { once: true })
  else apply()
  window.addEventListener('pagehide', () => { ipcRenderer.off(DESKTOP_IPC.zoomChanged, changed) }, { once: true })
}
