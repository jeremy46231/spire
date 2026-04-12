import { spawn } from 'child_process'
import { resolve } from 'path'
import { broadcast } from '../../web/server.js'
import { log } from './log.js'
import { sendRcon } from './rcon.js'
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
    { filePath: 'runner/bots/basic/looker', username: 'LookerBot' },
    { filePath: 'runner/bots/basic/walker', username: 'WalkerBot' },
    { filePath: 'runner/bots/basic/camper', username: 'CamperBot' },
  ],
}

export function getBotCatalog() {
  return BOT_CATALOG
}

// --- Bot instance management ---

let nextBotId = 1
const activeBots: BotInstance[] = []

function resolveUsername(desired: string): string {
  const taken = new Set(activeBots.map((b) => b.resolvedUsername))
  if (!taken.has(desired)) return desired
  for (let i = 2; ; i++) {
    const candidate = desired + i
    if (!taken.has(candidate)) return candidate
  }
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

const MIN_SPAWN_RADIUS = 10
const MAX_SPAWN_RADIUS = 20
const SPAWN_Y = 60

function randSpawn() {
  const angle = Math.random() * 2 * Math.PI
  const radius = Math.sqrt(
    Math.random() * (MAX_SPAWN_RADIUS ** 2 - MIN_SPAWN_RADIUS ** 2) +
      MIN_SPAWN_RADIUS ** 2
  )
  const x = Math.round(Math.cos(angle) * radius)
  const z = Math.round(Math.sin(angle) * radius)
  const yaw = Math.random() * 360 - 180
  return `${x} ${SPAWN_Y} ${z} ${yaw} 0`
}

async function resetPlayer(username: string) {
  log(`[runner] Resetting player data for "${username}"`)
  const commands = [
    `clear ${username}`,
    `xp set ${username} 0 levels`,
    `xp set ${username} 0 points`,
    `effect clear ${username}`,
    `gamemode survival ${username}`,
    `advancement revoke ${username} everything`,
    `tp ${username} ${randSpawn()}`,
  ]
  for (const cmd of commands) {
    await sendRcon(cmd)
  }
}

function sendToProc(proc: ChildProcess, msg: DaemonMessage) {
  proc.stdin?.write(JSON.stringify(msg) + '\n')
}

function spawnBotProcess(bot: BotInstance) {
  const username = bot.resolvedUsername
  log(`[runner] Spawning bot "${username}" from ${bot.filePath}`)

  const proc = spawn('bun', [BOT_WRAPPER], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'] as const,
  })

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
            resetPlayer(username).then(() =>
              sendToProc(proc, { type: 'start' })
            )
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
    if (bot.proc === proc) bot.proc = null
    broadcastBots()
  })

  sendToProc(proc, {
    type: 'init',
    config: {
      serverHost: SERVER_HOST,
      serverPort: SERVER_PORT,
      username,
      botScript: resolve(bot.filePath),
    },
  })

  bot.proc = proc
}

function killBotProc(bot: BotInstance) {
  return new Promise<void>((resolve) => {
    if (!bot.proc || bot.proc.exitCode !== null) {
      bot.proc = null
      return resolve()
    }
    bot.proc.once('exit', () => {
      bot.proc = null
      resolve()
    })
    bot.proc.kill('SIGTERM')
    const p = bot.proc
    setTimeout(() => {
      if (p.exitCode === null) p.kill('SIGKILL')
    }, 2000)
  })
}

export function addBot(filePath: string, username: string, isDefault = false) {
  const id = nextBotId++
  const resolvedUsername = resolveUsername(username)
  const bot: BotInstance = {
    id,
    filePath,
    username,
    resolvedUsername,
    enabled: true,
    proc: null,
    isDefault,
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
  } else if (!enabled && bot.proc && bot.proc.exitCode === null) {
    await killBotProc(bot)
  }
  broadcastBots()
}

export async function restartBot(id: number) {
  const bot = activeBots.find((b) => b.id === id)
  if (!bot) return
  if (bot.enabled) {
    await killBotProc(bot)
    spawnBotProcess(bot)
    broadcastBots()
  }
}

export function killAllBots() {
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
