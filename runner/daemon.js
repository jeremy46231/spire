import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'fs'

// Web server starts first — no heavy deps
import { broadcast, setStatus, setHandlers } from '../web/server.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SERVER_DIR = resolve(ROOT, '.spire/server')
const SERVER_JAR = resolve(SERVER_DIR, 'paper.jar')
const BOT_WRAPPER = resolve(__dirname, 'bot-wrapper.js')
const PID_FILE = resolve(ROOT, '.spire/daemon.pid')
const ARCHIVE = resolve(ROOT, '.spire/server.tar.zst')
const DOWNLOAD_URL = 'https://files.jer.app/share/2026-04-spire/server.tar.zst'

const SERVER_HOST = '127.0.0.1'
const SERVER_PORT = 25565
const RCON_PORT = 25575
const RCON_PASSWORD = 'spire'
const VIEWER_PORT = 3001

// --- Logging ---

function log(line) {
  console.log(line)
  broadcast('log', { line })
}

// --- PID file ---

writeFileSync(PID_FILE, String(process.pid))
process.on('exit', () => {
  try {
    unlinkSync(PID_FILE)
  } catch {}
})

// --- Web server (start immediately) ---

setHandlers({
  restartBots: () => restartBots(),
  stop: () => shutdown(),
})

// --- Server ---

let serverProc

function startPaperServer() {
  log('[runner] Starting Paper server...')
  const proc = spawn(
    'java',
    ['-Xms512M', '-Xmx1G', '-jar', SERVER_JAR, '--nogui'],
    {
      cwd: SERVER_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  proc.stdout.on('data', (d) => {
    for (const line of d.toString().split('\n')) {
      const trimmed = line.trimEnd()
      if (trimmed) log(`[server] ${trimmed}`)
    }
  })
  proc.stderr.on('data', (d) => {
    for (const line of d.toString().split('\n')) {
      const trimmed = line.trimEnd()
      if (trimmed) log(`[server] ${trimmed}`)
    }
  })
  proc.on('exit', (code) => {
    log(`[runner] Server exited with code ${code}`)
    process.exit(code ?? 1)
  })

  return proc
}

// --- RCON ---

async function waitForRcon() {
  const { Rcon } = await import('rcon-client')
  log('[runner] Waiting for RCON...')
  for (let i = 0; i < 120; i++) {
    try {
      const rcon = new Rcon({
        host: SERVER_HOST,
        port: RCON_PORT,
        password: RCON_PASSWORD,
      })
      await rcon.connect()
      log('[runner] RCON connected')
      return rcon
    } catch {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw new Error('RCON failed to connect after 240s')
}

// --- Player count polling ---

function startPlayerCountPolling(rcon) {
  setInterval(async () => {
    try {
      const response = await rcon.send('list')
      const match = response.match(/There are (\d+) of a max of (\d+) players online:(.*)/)
      if (match) {
        const names = match[3].trim().split(',').map((n) => n.trim()).filter(Boolean)
        const count = names.filter((n) => n !== 'SpireViewer').length
        setStatus({ players: count })
      }
    } catch {}
  }, 5000)
}

// --- Spectator viewer bot ---

async function startViewerBot(rcon) {
  const mineflayer = (await import('mineflayer')).default
  const { mineflayer: viewer } = await import('prismarine-viewer')
  log('[runner] Creating spectator viewer bot...')
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

  log('[runner] Viewer bot spawned, setting spectator mode...')
  await rcon.send('gamemode spectator SpireViewer')
  await rcon.send('tp SpireViewer 0 61 0')

  viewer(bot, { viewDistance: 8, firstPerson: false, port: VIEWER_PORT })
  log(`[runner] Prismarine viewer on internal port ${VIEWER_PORT}`)

  return bot
}

// --- Bot subprocess management ---

const botProcs = []

function spawnBotProcess(botScript, username) {
  log(`[runner] Spawning bot "${username}" from ${botScript}`)

  const proc = spawn('bun', [BOT_WRAPPER], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  proc.stdout.on('data', (d) => {
    for (const line of d.toString().split('\n')) {
      const trimmed = line.trimEnd()
      if (trimmed) log(`[bot:${username}] ${trimmed}`)
    }
  })
  proc.stderr.on('data', (d) => {
    for (const line of d.toString().split('\n')) {
      const trimmed = line.trimEnd()
      if (trimmed) log(`[bot:${username}] ${trimmed}`)
    }
  })
  proc.on('exit', (code) => {
    log(`[runner] Bot "${username}" exited with code ${code}`)
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
  log('[runner] Restarting bots...')
  await killAllBots()
  spawnAllBots()
  log('[runner] Bots restarted')
}

// --- Shutdown ---

async function shutdown() {
  log('[runner] Shutting down...')
  await killAllBots()
  if (serverProc) serverProc.kill('SIGTERM')
  process.exit(0)
}

// --- Setup: Java ---

async function ensureJava() {
  try {
    const proc = Bun.spawnSync(['java', '-version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (proc.exitCode === 0) return
  } catch {}

  if (process.platform !== 'linux') {
    throw new Error('Java is not installed and auto-install is only supported on Linux')
  }

  setStatus({ phase: 'installing-java' })
  log('[runner] Java not found, installing...')

  await new Promise((resolve, reject) => {
    const proc = spawn('apt-get', ['install', '-y', 'default-jre-headless'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    proc.stdout.on('data', (d) => {
      for (const line of d.toString().split('\n')) {
        const trimmed = line.trimEnd()
        if (trimmed) log(`[install] ${trimmed}`)
      }
    })
    proc.stderr.on('data', (d) => {
      for (const line of d.toString().split('\n')) {
        const trimmed = line.trimEnd()
        if (trimmed) log(`[install] ${trimmed}`)
      }
    })
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`apt-get install failed with code ${code}`))
    })
    proc.on('error', reject)
  })

  log('[runner] Java installed successfully')
}

// --- Setup: Server download ---

async function ensureServer() {
  if (existsSync(SERVER_DIR)) return

  setStatus({ phase: 'downloading-server' })
  log('[runner] Server not found, downloading...')

  mkdirSync(resolve(ROOT, '.spire'), { recursive: true })

  if (existsSync(ARCHIVE)) {
    log('[runner] Using local .spire/server.tar.zst')
  } else {
    log(`[runner] Downloading ${DOWNLOAD_URL}`)
    const res = await fetch(DOWNLOAD_URL)
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`)
    }
    writeFileSync(ARCHIVE, Buffer.from(await res.arrayBuffer()))
    log('[runner] Download complete')
  }

  log('[runner] Decompressing...')
  const { decompress } = await import('fzstd')
  const tar = await import('tar')
  const { Readable } = await import('stream')
  const { pipeline } = await import('stream/promises')

  const compressed = readFileSync(ARCHIVE)
  const tarData = Buffer.from(decompress(compressed))

  mkdirSync(SERVER_DIR, { recursive: true })

  log('[runner] Extracting to .spire/server/')
  await pipeline(Readable.from(tarData), tar.x({ cwd: SERVER_DIR }))
  log('[runner] Server extracted')
}

// --- Main ---

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => shutdown())
}

setStatus({ phase: 'starting' })

await ensureJava()
await ensureServer()

setStatus({ phase: 'starting-server' })
serverProc = startPaperServer()

const rcon = await waitForRcon()

await rcon.send('fill -10 60 -10 10 60 10 oak_planks')

const viewerBot = await startViewerBot(rcon)
setStatus({ viewerReady: true })

spawnAllBots()

startPlayerCountPolling(rcon)

setStatus({ phase: 'ready' })
log('[runner] Everything is running.')
