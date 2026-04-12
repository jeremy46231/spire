import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type {
  Handlers,
  BotInfo,
  BotCatalog,
  WebSocketData,
} from '../runner/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = resolve(__dirname, 'public')
const VIEWER_PORT = 3001
const WEB_PORT = 3000
const MAX_LOG_LINES = 500

// --- State ---

interface Status {
  phase: 'starting' | 'starting-server' | 'ready'
  players: number
  viewerReady: boolean
  [key: string]: unknown
}

const status: Status = {
  phase: 'starting',
  players: 0,
  viewerReady: false,
}

const logBuffer: string[] = []
const wsClients = new Set<Bun.ServerWebSocket<WebSocketData>>()

// --- Exported API for daemon ---

export function broadcast<T = Record<string, unknown>>(type: string, data?: T) {
  if (type === 'log' && data && typeof data === 'object') {
    const dataObj = data as Record<string, unknown>
    if ('line' in dataObj && typeof dataObj['line'] === 'string') {
      logBuffer.push(dataObj['line'])
      if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift()
    }
  }
  const msg = JSON.stringify({ type, ...data })
  for (const ws of wsClients) {
    ws.send(msg)
  }
}

export function getStatus() {
  return { ...status }
}

export function setStatus(updates: Partial<Status>) {
  Object.assign(status, updates)
  broadcast('status', status)
}

// --- Handlers ---

let onRestartBots: () => Promise<void> = async () => {}
let onStop: () => Promise<void> = async () => {}
let onRcon: (
  cmd: string
) => Promise<{ error?: string; response?: string }> = async () => ({
  error: 'Not connected',
})
let onAddBot: (
  filePath: string,
  username: string
) => Promise<void> = async () => {}
let onRemoveBot: (id: number) => Promise<void> = async () => {}
let onToggleBot: (
  id: number,
  enabled: boolean
) => Promise<void> = async () => {}
let onRestartBot: (id: number) => Promise<void> = async () => {}
let onGetBots: () => BotInfo[] = () => []
let onGetCatalog: () => BotCatalog = () => ({ user: [], basic: [] })

export function setHandlers(h: Handlers) {
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

Bun.serve<WebSocketData>({
  port: WEB_PORT,
  routes: {
    // API routes
    '/api/status': () => Response.json(status),
    '/api/bots': () => Response.json({ bots: onGetBots() }),
    '/api/bots/catalog': () => Response.json(onGetCatalog()),
    '/api/restart-bots': async (req: Request) => {
      if (req.method !== 'POST') return new Response(null, { status: 405 })
      await onRestartBots()
      return Response.json({ ok: true })
    },
    '/api/stop': async (req: Request) => {
      if (req.method !== 'POST') return new Response(null, { status: 405 })
      // Respond first so callers don't lose the response while daemon exits.
      setTimeout(() => {
        Promise.resolve(onStop()).catch(() => {})
      }, 0)
      return Response.json({ ok: true })
    },
    '/api/rcon': async (req: Request) => {
      if (req.method !== 'POST') return new Response(null, { status: 405 })
      try {
        const body = (await req.json()) as Record<string, unknown>
        const result = await onRcon(String(body.command))
        return Response.json(result)
      } catch (e) {
        return Response.json({ error: String((e as Error).message || e) })
      }
    },
    '/api/bots/add': async (req: Request) => {
      if (req.method !== 'POST') return new Response(null, { status: 405 })
      const body = (await req.json()) as Record<string, unknown>
      await onAddBot(String(body.filePath), String(body.username))
      return Response.json({ ok: true })
    },
    '/api/bots/remove': async (req: Request) => {
      if (req.method !== 'POST') return new Response(null, { status: 405 })
      const body = (await req.json()) as Record<string, unknown>
      await onRemoveBot(Number(body.id))
      return Response.json({ ok: true })
    },
    '/api/bots/toggle': async (req: Request) => {
      if (req.method !== 'POST') return new Response(null, { status: 405 })
      const body = (await req.json()) as Record<string, unknown>
      await onToggleBot(Number(body.id), Boolean(body.enabled))
      return Response.json({ ok: true })
    },
    '/api/bots/restart': async (req: Request) => {
      if (req.method !== 'POST') return new Response(null, { status: 405 })
      const body = (await req.json()) as Record<string, unknown>
      await onRestartBot(Number(body.id))
      return Response.json({ ok: true })
    },
  },
  async fetch(req, server) {
    const url = new URL(req.url)

    // WebSocket upgrade for /ws (control channel)
    if (
      url.pathname === '/ws' &&
      req.headers.get('upgrade')?.toLowerCase() === 'websocket'
    ) {
      const ok = server.upgrade(req, { data: { type: 'control' } })
      return ok
        ? new Response(undefined, { status: 101 })
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
        ? new Response(undefined, { status: 101 })
        : new Response('WebSocket upgrade failed', { status: 500 })
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
      const data = ws.data
      const target = data.target ?? ''
      const backend = new WebSocket(target)
      data.backend = backend
      data.queue = [] as (string | ArrayBuffer)[]

      backend.addEventListener('open', () => {
        const queue = data.queue as (string | ArrayBuffer)[]
        for (const msg of queue) backend.send(msg)
        data.queue = null
      })
      backend.addEventListener('message', (e: MessageEvent) => {
        ws.send(e.data)
      })
      backend.addEventListener('close', () => ws.close())
      backend.addEventListener('error', () => ws.close())
    },
    message(ws, msg) {
      if (ws.data.type === 'control') return

      // Viewer proxy
      const data = ws.data
      if (data.queue) {
        data.queue.push(msg as string | ArrayBuffer)
      } else if (data.backend) {
        data.backend.send(msg as string | ArrayBuffer)
      }
    },
    close(ws) {
      if (ws.data.type === 'control') {
        wsClients.delete(ws)
        return
      }
      if (ws.data.backend) {
        ws.data.backend.close()
      }
    },
  },
})

console.log(`[web] Server on http://localhost:${WEB_PORT}`)
