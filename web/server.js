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

export function setHandlers({ restartBots, stop }) {
  if (restartBots) onRestartBots = restartBots
  if (stop) onStop = stop
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
      await onStop()
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
