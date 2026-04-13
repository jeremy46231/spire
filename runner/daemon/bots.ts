import { spawn } from 'child_process'
import { resolve } from 'path'
import { broadcast } from '../../web/server.js'
import { log } from './log.js'
import type { ChildProcess } from 'child_process'
import type {
  BotInstance,
  BotInfo,
  BotCatalog,
  DaemonMessage,
} from '../types.js'

const SERVER_HOST = '127.0.0.1'
const SERVER_PORT = 25565

let ROOT: string
let BOT_WRAPPER: string

export function initBots(root: string, botWrapper: string) {
  ROOT = root
  BOT_WRAPPER = botWrapper
}

// --- Bot catalog ---

const BOT_CATALOG: BotCatalog = {
  user: [{ filePath: 'src/bot', username: 'SpireBot' }],
  basic: [
    { filePath: 'runner/bots/basic/looker', username: 'Looker' },
    { filePath: 'runner/bots/basic/walker', username: 'Walker' },
    { filePath: 'runner/bots/basic/camper', username: 'Camper' },
    { filePath: 'runner/bots/basic/attacker', username: 'Attacker' },
  ],
}

export function getBotCatalog() {
  return BOT_CATALOG
}

// --- Bot instance management ---

let nextBotId = 1
const activeBots: BotInstance[] = []

const RANDOM_ID_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function randomId() {
  let id = ''
  for (let i = 0; i < 6; i++) {
    id += RANDOM_ID_CHARS[Math.floor(Math.random() * RANDOM_ID_CHARS.length)]
  }
  return id
}

function broadcastBots() {
  broadcast('bots', {
    bots: activeBots.map(
      (b): BotInfo => ({
        id: b.id,
        username: b.resolvedUsername,
        filePath: b.filePath,
        enabled: b.enabled,
        running: b.proc !== null && b.proc.exitCode === null,
        isDefault: b.isDefault,
      })
    ),
  })
}

function sendToProc(proc: ChildProcess, msg: DaemonMessage) {
  proc.stdin?.write(JSON.stringify(msg) + '\n')
}

function clearRespawnTimer(bot: BotInstance) {
  if (bot.respawnTimer) {
    clearTimeout(bot.respawnTimer)
    bot.respawnTimer = null
  }
}

function spawnBotProcess(bot: BotInstance) {
  const username = `${bot.username}_${randomId()}`
  bot.resolvedUsername = username
  log(`[runner] Spawning bot "${username}" from ${bot.filePath}`)

  const proc = spawn('bun', [BOT_WRAPPER], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'] as const,
  })

  // Set proc immediately so exit/kill guards work before any async callbacks
  bot.proc = proc
  clearRespawnTimer(bot)

  let stdoutBuf = ''
  proc.stdout?.on('data', (d: Buffer) => {
    stdoutBuf += d.toString()
    let nl
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl)
      stdoutBuf = stdoutBuf.slice(nl + 1)
      // Lines starting with \0 are JSON messages from the child
      if (line.charCodeAt(0) === 0) {
        try {
          const msg = JSON.parse(line.slice(1))
          if (msg.type === 'spawned') {
            if (bot.proc === proc && proc.exitCode === null && bot.enabled) {
              sendToProc(proc, { type: 'start' })
            }
          }
        } catch {
          // Parse failed
        }
      } else if (line.trimEnd()) {
        log(`[bot:${username}] ${line.trimEnd()}`)
      }
    }
  })
  proc.stderr?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) {
      const trimmed = line.trimEnd()
      if (trimmed) log(`[bot:${username}] ${trimmed}`)
    }
  })
  proc.on('exit', (code: number | null) => {
    log(`[runner] Bot "${username}" exited with code ${code}`)
    // Only clear if we're still the current proc (not replaced by a new spawn)
    if (bot.proc === proc) bot.proc = null
    broadcastBots()
    // Auto-respawn if still enabled, still active, and no timer already pending
    if (bot.enabled && activeBots.includes(bot) && !bot.respawnTimer) {
      log(`[runner] Automatically respawning ${username} in 3 seconds...`)
      bot.respawnTimer = setTimeout(() => {
        bot.respawnTimer = null
        if (
          bot.enabled &&
          activeBots.includes(bot) &&
          (!bot.proc || bot.proc.exitCode !== null)
        ) {
          spawnBotProcess(bot)
          broadcastBots()
        }
      }, 3000)
    }
  })
  proc.on('error', () => {})
  proc.stdin?.on('error', () => {})

  sendToProc(proc, {
    type: 'init',
    config: {
      serverHost: SERVER_HOST,
      serverPort: SERVER_PORT,
      username,
      botScript: resolve(bot.filePath),
    },
  })
}

function killBotProc(bot: BotInstance) {
  return new Promise<void>((resolve) => {
    const proc = bot.proc
    if (!proc || proc.exitCode !== null) {
      bot.proc = null
      return resolve()
    }
    // Wait for the exit handler in spawnBotProcess to clean up bot.proc
    proc.once('exit', () => resolve())
    proc.kill('SIGTERM')
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill('SIGKILL')
    }, 2000)
  })
}

export function addBot(filePath: string, username: string, isDefault = false) {
  const id = nextBotId++
  const bot: BotInstance = {
    id,
    filePath,
    username,
    resolvedUsername: username,
    enabled: true,
    proc: null,
    isDefault,
    respawnTimer: null,
  }
  activeBots.push(bot)
  spawnBotProcess(bot)
  broadcastBots()
  return bot
}

export async function removeBot(id: number) {
  const idx = activeBots.findIndex((b) => b.id === id)
  if (idx === -1) return
  const bot = activeBots[idx]!
  if (bot.isDefault) return
  clearRespawnTimer(bot)
  await killBotProc(bot)
  activeBots.splice(idx, 1)
  broadcastBots()
}

export async function toggleBot(id: number, enabled: boolean) {
  const bot = activeBots.find((b) => b.id === id)
  if (!bot) return
  bot.enabled = enabled
  if (enabled && (!bot.proc || bot.proc.exitCode !== null)) {
    spawnBotProcess(bot)
  } else if (!enabled) {
    clearRespawnTimer(bot)
    if (bot.proc && bot.proc.exitCode === null) {
      await killBotProc(bot)
    }
  }
  broadcastBots()
}

export async function restartBot(id: number) {
  const bot = activeBots.find((b) => b.id === id)
  if (!bot) return
  if (bot.enabled) {
    clearRespawnTimer(bot)
    await killBotProc(bot)
    // Re-check after async kill: bot may have been disabled or removed
    if (!bot.enabled || !activeBots.includes(bot)) return
    spawnBotProcess(bot)
    broadcastBots()
  }
}

export function killAllBots() {
  for (const bot of activeBots) clearRespawnTimer(bot)
  return Promise.all(activeBots.map((b) => killBotProc(b)))
}

export async function restartBots() {
  log('[runner] Restarting bots...')
  await killAllBots()
  for (const bot of activeBots) {
    if (bot.enabled) spawnBotProcess(bot)
  }
  broadcastBots()
  log('[runner] Bots restarted')
}

export function getBotList(): BotInfo[] {
  return activeBots.map(
    (b): BotInfo => ({
      id: b.id,
      username: b.resolvedUsername,
      filePath: b.filePath,
      enabled: b.enabled,
      running: b.proc !== null && b.proc.exitCode === null,
      isDefault: b.isDefault,
    })
  )
}
