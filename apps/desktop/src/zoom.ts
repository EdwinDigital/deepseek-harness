/** Device-local workspace zoom with serialized, atomic preference writes. */
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopLocale } from './locale.ts'

/** Browser-style zoom steps; native window controls retain their OS dimensions. */
const FACTORS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const
/** Native menu actions for the entire workspace, not its focused embedded document. */
export type ZoomAction = 'in' | 'out' | 'reset'

/** One application process owns the preference writer. */
export class DesktopZoom {
  private pending: Promise<void> = Promise.resolve()
  /** @param value - validated initial factor. @param write - atomic persistence operation. */
  constructor(private value: number, private readonly write: (factor: number) => Promise<void>) {}

  /** Current committed workspace scale. */
  get factor(): number { return this.value }

  /**
   * Serialize relative steps and publish only after persistence succeeds.
   * @param action - zoom direction or reset to 100%.
   * @returns the committed factor; a failed write retains the previous value and rejects.
   */
  change(action: ZoomAction): Promise<number> {
    const operation = this.pending.then(async () => {
      const next = action === 'reset' ? 1
        : action === 'in' ? FACTORS.find(factor => factor > this.value) ?? this.value
          : FACTORS.findLast(factor => factor < this.value) ?? this.value
      if (next !== this.value) {
        await this.write(next)
        this.value = next
      }
      return this.value
    })
    this.pending = operation.then(() => {}, () => {})
    return operation
  }

  /** @returns after all admitted writes settle, including failures reported to their callers. */
  idle(): Promise<void> { return this.pending }
}

/**
 * Read the Electron-owned preference without modifying missing or invalid files.
 * @param path - absolute preference path under Electron userData.
 * @returns the workspace zoom controller; malformed, unsupported, or unreadable files reject.
 */
export async function openDesktopZoom(path: string): Promise<DesktopZoom> {
  let raw: string | undefined
  try { raw = await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  let factor = 1
  if (raw !== undefined) {
    let parsed: unknown
    try { parsed = JSON.parse(raw) }
    catch { throw new Error(`desktop zoom: invalid preferences at ${path}`) }
    if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || parsed.version !== 1
      || !('factor' in parsed) || typeof parsed.factor !== 'number' || !FACTORS.some(value => value === parsed.factor)) {
      throw new Error(`desktop zoom: unsupported preferences at ${path}`)
    }
    factor = parsed.factor
  }
  return new DesktopZoom(factor, next => writeFileAtomic(path, `${JSON.stringify({ version: 1, factor: next })}\n`, {
    mode: 0o600, dirMode: 0o700,
  }))
}

/**
 * Build localized native commands with explicit workspace-owned callbacks.
 * @param messages - current shell dictionary.
 * @param change - workspace action, also used by hidden accelerator aliases.
 * @returns visible zoom commands and the unshifted equals-key accelerator.
 */
export function desktopZoomItems(messages: DesktopLocale['messages'], change: (action: ZoomAction) => void): MenuItemConstructorOptions[] {
  return [
    { label: messages.zoomIn, accelerator: 'CommandOrControl+Plus', click: () => { change('in') } },
    { label: messages.zoomOut, accelerator: 'CommandOrControl+-', click: () => { change('out') } },
    { label: messages.zoomReset, accelerator: 'CommandOrControl+0', click: () => { change('reset') } },
    { label: messages.zoomIn, accelerator: 'CommandOrControl+=', visible: false,
      acceleratorWorksWhenHidden: true, click: () => { change('in') } },
  ]
}
