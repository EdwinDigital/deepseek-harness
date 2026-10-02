/** Real Electron workspace zoom, isolated from the user's application and data. */
import { app, BrowserWindow, Menu, protocol, WebContentsView } from 'electron'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

/** Read one literal stylesheet emitted by the desktop's CSS-module bundler. */
function stylesheet(packageName, filename) {
  const repository = fileURLToPath(new URL('../../../../', import.meta.url))
  const bundle = readFileSync(join(repository, 'packages/client', packageName, 'lib/client.js'), 'utf8')
  const start = bundle.indexOf(`/${filename}.mjs`)
  assert.ok(start >= 0, `missing built stylesheet ${filename}`)
  const literal = /const css(?:\$\d+)? = ("(?:[^"\\]|\\.)*");/.exec(bundle.slice(start))
  assert.ok(literal, `missing CSS literal for ${filename}`)
  const css = JSON.parse(literal[1])
  return {
    css,
    name: name => {
      const match = new RegExp(`\\.([\\w-]+_${name})\\b`).exec(css)
      assert.ok(match, `missing built class ${name}`)
      return match[1]
    },
  }
}

async function run() {
  const [modulePath, preload, userData, phase] = process.argv.slice(2)
  app.setPath('userData', userData)
  protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: { standard: true, secure: true } }])
  const { openDesktopZoom, desktopZoomItems } = await import(pathToFileURL(modulePath).href)
  const { platformBounds } = await import(pathToFileURL(join(modulePath, '..', 'platform-view.js')).href)
  const { resolveDesktopLocale } = await import(pathToFileURL(join(modulePath, '..', 'locale.js')).href)
  let window
  try {
    await app.whenReady()
    const frame = stylesheet('ui-layout', 'AppFrame.module.css')
    const conversation = stylesheet('ui-conversation', 'ConversationRoot.module.css')
    const html = `<!doctype html><html><head><style>
      html,body{height:100%;margin:0} ${frame.css} ${conversation.css}
      </style></head><body>
      <div class="${frame.name('frame')}" data-sidebar-collapsed>
        <div class="${conversation.name('root')}">
          <header class="${conversation.name('header')}">
            <div class="${conversation.name('titleRow')}">Saved conversation</div>
            <div id="tabs" class="${conversation.name('tabs')}"><button class="${conversation.name('tab')}">Chat</button></div>
          </header>
          <main style="width:100px;height:100px">Workspace</main><iframe src="about:blank"></iframe>
        </div>
        <div id="leading" class="${frame.name('leadingSeat')}"><button style="width:28px;height:28px">B</button></div>
      </div></body></html>`
    protocol.handle('dsh-app', () => new Response(html, { headers: { 'content-type': 'text/html' } }))
    const zoom = await openDesktopZoom(join(userData, 'zoom.json'))
    assert.equal(zoom.factor, phase === 'first' ? 1 : 1.25)
    window = new BrowserWindow({ show: false, width: 800, height: 600, useContentSize: true,
      webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false, zoomFactor: zoom.factor } })
    await window.loadURL('dsh-app://app/')
    const apply = async () => {
      window.webContents.setZoomFactor(zoom.factor)
      window.webContents.send('dsh-desktop:zoom-changed', zoom.factor)
      // Exercise the same fixed native-button geometry on every Chromium test host.
      await window.webContents.executeJavaScript(`
        document.documentElement.dataset.platform = 'darwin';
        document.documentElement.removeAttribute('data-windows-titlebar');
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      `)
    }
    await apply()
    let changing = Promise.resolve()
    const items = desktopZoomItems(resolveDesktopLocale('en').messages, action => {
      changing = zoom.change(action).then(apply)
    })
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'View', submenu: items }]))
    const run = async accelerator => {
      items.find(item => item.accelerator === accelerator).click()
      await changing
    }
    const observed = []
    if (phase === 'first') {
      for (let i = 0; i < 20; i++) await run('CommandOrControl+-')
      for (const expected of [0.5, 1, 2]) {
        if (expected === 1) await run('CommandOrControl+0')
        if (expected === 2) for (let i = 0; i < 20; i++) await run('CommandOrControl+Plus')
        const geometry = await window.webContents.executeJavaScript(`({
          viewport: innerWidth,
          tabsTop: document.querySelector('#tabs').getBoundingClientRect().top,
          leadingBottom: document.querySelector('#leading').getBoundingClientRect().bottom,
          chrome: getComputedStyle(document.documentElement).getPropertyValue('--dsh-native-chrome-scale'),
          rect: (() => { const r = document.querySelector('main').getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height } })()
        })`)
        assert.equal(window.webContents.getZoomFactor(), expected)
        assert.ok(Math.abs(geometry.viewport * expected - window.getContentBounds().width) <= 1)
        assert.equal(Number(geometry.chrome), Math.max(1, 1 / expected))
        assert.ok(geometry.tabsTop * expected >= 48, 'conversation tabs overlap native window controls')
        assert.ok(geometry.tabsTop >= geometry.leadingBottom, 'conversation tabs overlap sidebar controls')
        const fullscreenClear = await window.webContents.executeJavaScript(`(() => {
          document.documentElement.dataset.fullscreen = 'true';
          const clear = document.querySelector('#tabs').getBoundingClientRect().top >= document.querySelector('#leading').getBoundingClientRect().bottom;
          delete document.documentElement.dataset.fullscreen;
          return clear;
        })()`)
        assert.equal(fullscreenClear, true, 'fullscreen sidebar controls overlap conversation tabs')
        const view = new WebContentsView()
        window.contentView.addChildView(view)
        view.setBounds(platformBounds(geometry.rect, expected))
        assert.equal(view.getBounds().width, Math.round(100 * expected))
        window.contentView.removeChildView(view)
        const closed = new Promise(resolve => view.webContents.once('destroyed', resolve))
        view.webContents.close()
        await closed
        observed.push(`zoom=${expected} viewport-and-native-bounds=aligned conversation-tabs=clear`)
      }
      await run('CommandOrControl+0')
      await run('CommandOrControl+=')
      await run('CommandOrControl+=')
      assert.equal(zoom.factor, 1.25)
      observed.push('saved=1.25')
    } else {
      assert.equal(window.webContents.getZoomFactor(), 1.25)
      const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve))
      window.reload()
      await loaded
      await apply()
      assert.equal(window.webContents.getZoomFactor(), 1.25)
      observed.push('restart-and-reload=1.25')
      await run('CommandOrControl+0')
      observed.push(`reset=${zoom.factor}`)
    }
    await zoom.idle()
    console.log(`ZOOM_RESULT ${JSON.stringify(observed)}`)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    window?.destroy()
    app.exit(process.exitCode ?? 0)
  }
}

void run().catch(error => { console.error(error); app.exit(1) })
