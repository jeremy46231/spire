import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { unlinkSync, writeFileSync } from 'fs'
import type { ChildProcess } from 'child_process'

import { setStatus, setHandlers } from '../../web/server.js'
import { log } from './log.js'
import { startPaperServer, waitForProcessExit } from './server.js'
import { waitForRcon, setRconClient, getRconClient, sendRcon } from './rcon.js'
import { startViewerBot, startPlayerCountPolling } from './viewer.js'
import {
  initBots,
  addBot,
  removeBot,
  toggleBot,
  restartBot,
  restartBots,
  killAllBots,
  getBotList,
  getBotCatalog,
} from './bots.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const SERVER_DIR = resolve(ROOT, '.spire/server')
const SERVER_JAR = resolve(SERVER_DIR, 'paper.jar')
const BOT_WRAPPER = resolve(__dirname, '../child/bot-wrapper.js')
const PID_FILE = resolve(ROOT, '.spire/daemon.pid')

initBots(ROOT, BOT_WRAPPER)

// --- PID file ---

writeFileSync(PID_FILE, String(process.pid))
process.on('exit', () => {
  try {
    unlinkSync(PID_FILE)
  } catch {
    // Unlink failed
  }
})

// --- Web server handlers ---

setHandlers({
  restartBots: async () => {
    await restartBots()
  },
  stop: async () => {
    await shutdown()
  },
  rcon: (cmd) => sendRcon(cmd),
  addBot: async (filePath, username) => {
    addBot(filePath, username)
  },
  removeBot: (id) => removeBot(id),
  toggleBot: (id, enabled) => toggleBot(id, enabled),
  restartBot: (id) => restartBot(id),
  getBots: () => getBotList(),
  getCatalog: () => getBotCatalog(),
})

// --- Shutdown ---

// eslint-disable-next-line prefer-const
let serverProc: ChildProcess | undefined
let shuttingDown = false

async function shutdown() {
  if (shuttingDown) return new Promise(() => {})
  shuttingDown = true

  log('[runner] Shutting down...')
  await killAllBots()
  if (serverProc && serverProc.exitCode === null) {
    try {
      await getRconClient()!.send('stop')
    } catch {
      // RCON send failed
    }

    const cleanExit = await waitForProcessExit(serverProc, 10000)
    if (!cleanExit) {
      try {
        serverProc.kill('SIGTERM')
      } catch {
        // Kill failed
      }
      const termExit = await waitForProcessExit(serverProc, 3000)
      if (!termExit) {
        try {
          serverProc.kill('SIGKILL')
        } catch {
          // Kill failed
        }
        await waitForProcessExit(serverProc, 1000)
      }
    }
  }

  try {
    await getRconClient()?.end()
  } catch {
    // End failed
  }

  process.exit(0)
}

// --- Main ---

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    shutdown()
  })
}

setStatus({ phase: 'starting-server' })
serverProc = startPaperServer(SERVER_DIR, SERVER_JAR)

const rcon = await waitForRcon()
setRconClient(rcon)

await startViewerBot(rcon)

// temp because there isn't a world yet
await rcon.send('fill -20 59 -20 20 59 20 grass_block')
await rcon.send('setblock 0 59 0 diamond_block')
await rcon.send('gamerule advance_time false')
await rcon.send('gamerule advance_weather false')

setTimeout(() => setStatus({ viewerReady: true }), 2000)

addBot('src/bot', 'SpireBot', true)

startPlayerCountPolling(rcon)

setStatus({ phase: 'ready' })
log('[runner] Everything is running.')
