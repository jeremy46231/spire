import { pathToFileURL } from 'url'
import { _initSpire } from './spire.ts'

interface InitConfig {
  serverHost: string
  serverPort: number
  username: string
  botScript: string
}

interface InitMessage {
  type: string
  config: InitConfig
}

// Parse newline-delimited JSON from stdin
const lineHandlers: ((line: string) => void)[] = []
let stdinBuf = ''
process.stdin.on('error', () => process.exit(1))
process.stdin.on('data', (chunk: Buffer) => {
  stdinBuf += chunk.toString()
  let nl
  while ((nl = stdinBuf.indexOf('\n')) !== -1) {
    const line = stdinBuf.slice(0, nl)
    stdinBuf = stdinBuf.slice(nl + 1)
    for (const h of lineHandlers) h(line)
  }
})

function waitForMessage<T>(type: string) {
  return new Promise<T>((resolve) => {
    const handler = (line: string) => {
      try {
        const msg = JSON.parse(line) as T
        if ((msg as Record<string, unknown>).type === type) {
          lineHandlers.splice(lineHandlers.indexOf(handler), 1)
          resolve(msg)
        }
      } catch {
        // Parse failed
      }
    }
    lineHandlers.push(handler)
  })
}

function send(msg: Record<string, unknown>) {
  process.stdout.write('\x00' + JSON.stringify(msg) + '\n')
}

// Wait for init message from runner
const initMsg = await waitForMessage<InitMessage>('init')
const { serverHost, serverPort, username, botScript } = initMsg.config

// Import mineflayer and create bot
const mineflayer = await import('mineflayer')
const { pathfinder } = await import('mineflayer-pathfinder')

const bot = mineflayer.default.createBot({
  host: serverHost,
  port: serverPort,
  username,
  version: '1.21.11',
  hideErrors: false,
  respawn: false,
})

bot.loadPlugin(pathfinder)

// Attach exit handlers immediately so the process can never become a zombie,
// even if a disconnect/error occurs during reset, import, or init
bot.on('end', () => process.exit(0))
bot.on('error', () => process.exit(1))
bot.on('death', () => void setTimeout(() => process.exit(0), 700)) // allow animation to play

// Wait for spawn
await new Promise<void>((resolve, reject) => {
  bot.once('spawn', resolve)
  bot.once('error', reject)
  bot.once('end', () => reject(new Error('Disconnected')))
})

console.log(`Bot "${username}" spawned`)

// Tell daemon we're in the server, then wait for it to finish resetting us
send({ type: 'spawned' })
await waitForMessage('start')

// Initialize $spire runtime (sets bot + default movements)
_initSpire(bot)

// Now import the user's bot code
try {
  await import(pathToFileURL(botScript).href)
} catch (err) {
  console.error(`Error loading bot script: ${(err as Error).message}`)
  console.error((err as Error).stack)
}

// Listen for game events from runner
lineHandlers.push(() => {
  try {
    // Future: dispatch events to competitor bot handlers
  } catch {
    // Event parse failed
  }
})
