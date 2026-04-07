import { spawn } from 'child_process'
import { Rcon } from 'rcon-client'
import mineflayer from 'mineflayer'
import { mineflayer as viewer } from 'prismarine-viewer'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { writeFileSync, unlinkSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SERVER_DIR = resolve(ROOT, '.spire/server')
const SERVER_JAR = resolve(SERVER_DIR, 'paper.jar')
const BOT_WRAPPER = resolve(__dirname, 'bot-wrapper.js')
const PID_FILE = resolve(ROOT, '.spire/daemon.pid')

const SERVER_HOST = '127.0.0.1'
const SERVER_PORT = 25565
const RCON_PORT = 25575
const RCON_PASSWORD = 'spire'
const WEB_PORT = 3000
const VIEWER_PORT = 3001 // internal, proxied through Bun.serve

// --- PID file ---

writeFileSync(PID_FILE, String(process.pid))
process.on('exit', () => {
  try {
    unlinkSync(PID_FILE)
  } catch {}
})

// --- Server ---

function startServer() {
  console.log('[runner] Starting Paper server...')
  const proc = spawn(
    'java',
    ['-Xms512M', '-Xmx1G', '-jar', SERVER_JAR, '--nogui'],
    {
      cwd: SERVER_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  proc.stdout.on('data', (d) => {
    const line = d.toString().trimEnd()
    if (line) console.log('[server]', line)
  })
  proc.stderr.on('data', (d) => {
    const line = d.toString().trimEnd()
    if (line) console.error('[server]', line)
  })
  proc.on('exit', (code) => {
    console.log(`[runner] Server exited with code ${code}`)
    process.exit(code ?? 1)
  })

  return proc
}

// --- RCON ---

async function waitForRcon() {
  console.log('[runner] Waiting for RCON...')
  for (let i = 0; i < 120; i++) {
    try {
      const rcon = new Rcon({
        host: SERVER_HOST,
        port: RCON_PORT,
        password: RCON_PASSWORD,
      })
      await rcon.connect()
      console.log('[runner] RCON connected')
      return rcon
    } catch {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw new Error('RCON failed to connect after 240s')
}

// --- Spectator viewer bot ---

async function startViewerBot(rcon) {
  console.log('[runner] Creating spectator viewer bot...')
  const bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: 'SpireViewer',
    version: '1.21.11',
    hideErrors: false,
  })
  bot.physics = false
  bot.setMaxListeners(50)

  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve)
    bot.once('error', reject)
    bot.once('kick', (reason) => reject(new Error(`Kicked: ${reason}`)))
  })

  console.log('[runner] Viewer bot spawned, setting spectator mode...')
  await rcon.send('gamemode spectator SpireViewer')
  await rcon.send('tp SpireViewer 0 61 0')

  viewer(bot, { viewDistance: 8, firstPerson: false, port: VIEWER_PORT })
  console.log(`[runner] Prismarine viewer on internal port ${VIEWER_PORT}`)

  return bot
}

// --- Bot subprocess management ---

const botProcs = []

function spawnBotProcess(botScript, username) {
  console.log(`[runner] Spawning bot "${username}" from ${botScript}`)

  const proc = spawn('bun', [BOT_WRAPPER], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  proc.stdout.on('data', (d) => {
    const line = d.toString().trimEnd()
    if (line) console.log(`[bot:${username}]`, line)
  })
  proc.stderr.on('data', (d) => {
    const line = d.toString().trimEnd()
    if (line) console.error(`[bot:${username}]`, line)
  })
  proc.on('exit', (code) => {
    console.log(`[runner] Bot "${username}" exited with code ${code}`)
    const idx = botProcs.indexOf(proc)
    if (idx !== -1) botProcs.splice(idx, 1)
  })

  const initMsg = JSON.stringify({
    type: 'init',
    config: {
      serverHost: SERVER_HOST,
      serverPort: SERVER_PORT,
      username,
      botScript: resolve(botScript),
    },
  })
  proc.stdin.write(initMsg + '\n')

  botProcs.push(proc)
  return proc
}

function killAllBots() {
  return Promise.all(
    botProcs.map(
      (proc) =>
        new Promise((resolve) => {
          if (proc.exitCode !== null) return resolve()
          proc.once('exit', resolve)
          proc.kill('SIGTERM')
          setTimeout(() => {
            if (proc.exitCode === null) proc.kill('SIGKILL')
          }, 2000)
        }),
    ),
  )
}

function spawnAllBots() {
  spawnBotProcess('src/bot.js', 'SpireBot')
}

async function restartBots() {
  console.log('[runner] Restarting bots...')
  await killAllBots()
  spawnAllBots()
  console.log('[runner] Bots restarted')
}

// --- Web server (Bun.serve) ---

function startWebServer() {
  const server = Bun.serve({
    port: WEB_PORT,
    async fetch(req, server) {
      const url = new URL(req.url)

      // API routes
      if (url.pathname === '/api/status') {
        return Response.json({
          ok: true,
          pid: process.pid,
          bots: botProcs.length,
        })
      }

      if (url.pathname === '/api/restart-bots' && req.method === 'POST') {
        await restartBots()
        return Response.json({ ok: true })
      }

      if (url.pathname === '/api/stop' && req.method === 'POST') {
        setTimeout(() => shutdown(), 100)
        return Response.json({ ok: true })
      }

      // WebSocket upgrade — proxy to prismarine-viewer
      if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const ok = server.upgrade(req, {
          data: { target: `ws://127.0.0.1:${VIEWER_PORT}${url.pathname}${url.search}` },
        })
        return ok ? undefined : new Response('WebSocket upgrade failed', { status: 500 })
      }

      // HTTP proxy to prismarine-viewer
      const target = `http://127.0.0.1:${VIEWER_PORT}${url.pathname}${url.search}`
      try {
        const proxyRes = await fetch(target, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        })
        // Strip content-encoding — Bun's fetch already decompresses the body,
        // so forwarding the header makes the browser try to decompress again
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
    },
    websocket: {
      open(ws) {
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
        if (ws.data.queue) {
          ws.data.queue.push(msg)
        } else {
          ws.data.backend?.send(msg)
        }
      },
      close(ws) {
        ws.data.backend?.close()
      },
    },
  })

  console.log(`[runner] Web server on http://localhost:${WEB_PORT}`)
  return server
}

// --- Shutdown ---

async function shutdown() {
  console.log('[runner] Shutting down...')
  await killAllBots()
  serverProc.kill('SIGTERM')
  process.exit(0)
}

// --- Main ---

const serverProc = startServer()

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => shutdown())
}

const rcon = await waitForRcon()
const viewerBot = await startViewerBot(rcon)
startWebServer()
spawnAllBots()

console.log('[runner] Everything is running.')
