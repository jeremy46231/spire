import { setStatus } from '../../web/server.js'
import { log } from './log.js'

const SERVER_HOST = '127.0.0.1'
const SERVER_PORT = 25565
const VIEWER_PORT = 3001

export async function startViewerBot(rcon: {
  send: (cmd: string) => Promise<string>
}) {
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
  bot.setMaxListeners(50)

  await new Promise<void>((resolve, reject) => {
    bot.once('spawn', resolve)
    bot.once('error', reject)
    bot.once('end', () => {
      reject(new Error('Disconnected'))
    })
  })

  bot.physicsEnabled = false

  log('[runner] Viewer bot spawned, setting spectator mode...')
  await rcon.send('gamemode spectator SpireViewer')
  await rcon.send('tp SpireViewer 0 57 0')

  viewer(bot, { viewDistance: 8, firstPerson: false, port: VIEWER_PORT })
  log(`[runner] Prismarine viewer on internal port ${VIEWER_PORT}`)

  return bot
}

export function startPlayerCountPolling(rcon: {
  send: (cmd: string) => Promise<string>
}) {
  setInterval(async () => {
    try {
      const response = await rcon.send('list')
      const match = response.match(
        /There are (\d+) of a max of (\d+) players online:(.*)/
      )
      if (match) {
        const names = match[3]!
          .trim()
          .split(',')
          .map((n: string) => n.trim())
          .filter(Boolean)
        const count = names.filter((n: string) => n !== 'SpireViewer').length
        setStatus({ players: count })
      }
    } catch {
      // Polling failed
    }
  }, 5000)
}
