import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = resolve(__dirname, 'public')
const VIEWER_PORT = 3001
const WEB_PORT = 3000
const MAX_LOG_LINES = 500

// --- State ---

let status = {
  phase: 'starting',
  players: 0,
  viewerReady: false,
}

const logBuffer = []
const wsClients = new Set()

// --- Exported API for daemon ---

export function broadcast(type, data) {
  if (type === 'log' && data?.line != null) {
    logBuffer.push(data.line)
    if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift()
  }
  const msg = JSON.stringify({ type, ...data })
  for (const ws of wsClients) {
    ws.send(msg)
  }
}

export function getStatus() {
  return { ...status }
}

export function setStatus(updates) {
  Object.assign(status, updates)
  broadcast('status', status)
}

// --- Handlers ---

let onRestartBots = async () => {}
let onStop = async () => {}
let onRcon = async () => ({ error: 'Not connected' })
let onAddBot = async () => {}
let onRemoveBot = async () => {}
let onToggleBot = async () => {}
let onRestartBot = async () => {}
let onGetBots = () => []
let onGetCatalog = () => ({})

export function setHandlers(h) {
  if (h.restartBots) onRestartBots = h.restartBots
  if (h.stop) onStop = h.stop
  if (h.rcon) onRcon = h.rcon
  if (h.addBot) onAddBot = h.addBot
  if (h.removeBot) onRemoveBot = h.removeBot
  if (h.toggleBot) onToggleBot = h.toggleBot
  if (h.restartBot) onRestartBot = h.restartBot
  if (h.getBots) onGetBots = h.getBots
  if (h.getCatalog) onGetCatalog = h.getCatalog
}

// --- Server ---

const server = Bun.serve({
  port: WEB_PORT,
  async fetch(req, server) {
    const url = new URL(req.url)

    // WebSocket upgrade for /ws (control channel)
    if (
      url.pathname === '/ws' &&
      req.headers.get('upgrade')?.toLowerCase() === 'websocket'
    ) {
      const ok = server.upgrade(req, { data: { type: 'control' } })
      return ok
        ? undefined
        : new Response('WebSocket upgrade failed', { status: 500 })
    }

    // WebSocket upgrade for /viewer/ (proxy to prismarine-viewer)
    if (
      url.pathname.startsWith('/viewer/') &&
      req.headers.get('upgrade')?.toLowerCase() === 'websocket'
    ) {
      const stripped = url.pathname.replace(/^\/viewer/, '') || '/'
      const ok = server.upgrade(req, {
        data: {
          type: 'viewer-proxy',
          target: `ws://127.0.0.1:${VIEWER_PORT}${stripped}${url.search}`,
        },
      })
      return ok
        ? undefined
        : new Response('WebSocket upgrade failed', { status: 500 })
    }

    // API routes
    if (url.pathname === '/api/status') {
      return Response.json(status)
    }

    if (url.pathname === '/api/restart-bots' && req.method === 'POST') {
      await onRestartBots()
      return Response.json({ ok: true })
    }

    if (url.pathname === '/api/stop' && req.method === 'POST') {
      // Respond first so callers don't lose the response while daemon exits.
      setTimeout(() => {
        Promise.resolve(onStop()).catch(() => {})
      }, 0)
      return Response.json({ ok: true })
    }

    if (url.pathname === '/api/rcon' && req.method === 'POST') {
      try {
        const body = await req.json()
        const result = await onRcon(body.command)
        return Response.json(result)
      } catch (e) {
        return Response.json({ error: String(e.message || e) })
      }
    }

    if (url.pathname === '/api/bots' && req.method === 'GET') {
      return Response.json({ bots: onGetBots() })
    }

    if (url.pathname === '/api/bots/catalog' && req.method === 'GET') {
      return Response.json(onGetCatalog())
    }

    if (url.pathname === '/api/bots/add' && req.method === 'POST') {
      const body = await req.json()
      await onAddBot(body.filePath, body.username)
      return Response.json({ ok: true })
    }

    if (url.pathname === '/api/bots/remove' && req.method === 'POST') {
      const body = await req.json()
      await onRemoveBot(body.id)
      return Response.json({ ok: true })
    }

    if (url.pathname === '/api/bots/toggle' && req.method === 'POST') {
      const body = await req.json()
      await onToggleBot(body.id, body.enabled)
      return Response.json({ ok: true })
    }

    if (url.pathname === '/api/bots/restart' && req.method === 'POST') {
      const body = await req.json()
      await onRestartBot(body.id)
      return Response.json({ ok: true })
    }

    // Proxy /viewer/ to prismarine-viewer
    if (url.pathname.startsWith('/viewer/')) {
      const stripped = url.pathname.replace(/^\/viewer/, '') || '/'
      const target = `http://127.0.0.1:${VIEWER_PORT}${stripped}${url.search}`
      try {
        const proxyRes = await fetch(target, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        })
        const headers = new Headers(proxyRes.headers)
        headers.delete('content-encoding')
        headers.delete('content-length')
        return new Response(proxyRes.body, {
          status: proxyRes.status,
          headers,
        })
      } catch {
        return new Response('Viewer not ready', { status: 502 })
      }
    }

    // Static files from public/
    const filePath = url.pathname === '/' ? '/index.html' : url.pathname
    const file = Bun.file(resolve(PUBLIC_DIR, '.' + filePath))
    if (await file.exists()) {
      return new Response(file)
    }

    return new Response('Not found', { status: 404 })
  },
  websocket: {
    open(ws) {
      if (ws.data.type === 'control') {
        wsClients.add(ws)
        ws.send(JSON.stringify({ type: 'backlog', lines: [...logBuffer] }))
        ws.send(JSON.stringify({ type: 'status', ...status }))
        ws.send(JSON.stringify({ type: 'bots', bots: onGetBots() }))
        return
      }

      // Viewer proxy
      const backend = new WebSocket(ws.data.target)
      ws.data.backend = backend
      ws.data.queue = []

      backend.addEventListener('open', () => {
        for (const msg of ws.data.queue) backend.send(msg)
        ws.data.queue = null
      })
      backend.addEventListener('message', (e) => {
        ws.send(e.data)
      })
      backend.addEventListener('close', () => ws.close())
      backend.addEventListener('error', () => ws.close())
    },
    message(ws, msg) {
      if (ws.data.type === 'control') return

      // Viewer proxy
      if (ws.data.queue) {
        ws.data.queue.push(msg)
      } else {
        ws.data.backend?.send(msg)
      }
    },
    close(ws) {
      if (ws.data.type === 'control') {
        wsClients.delete(ws)
        return
      }
      ws.data.backend?.close()
    },
  },
})

console.log(`[web] Server on http://localhost:${WEB_PORT}`)
