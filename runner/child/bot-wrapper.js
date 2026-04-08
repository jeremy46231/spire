import { pathToFileURL } from 'url'

// Parse newline-delimited JSON from stdin
const lineHandlers = []
let stdinBuf = ''
process.stdin.on('data', (chunk) => {
  stdinBuf += chunk.toString()
  let nl
  while ((nl = stdinBuf.indexOf('\n')) !== -1) {
    const line = stdinBuf.slice(0, nl)
    stdinBuf = stdinBuf.slice(nl + 1)
    for (const h of lineHandlers) h(line)
  }
})

function waitForMessage(type) {
  return new Promise((resolve) => {
    const handler = (line) => {
      try {
        const msg = JSON.parse(line)
        if (msg.type === type) {
          lineHandlers.splice(lineHandlers.indexOf(handler), 1)
          resolve(msg)
        }
      } catch {}
    }
    lineHandlers.push(handler)
  })
}

function send(msg) {
  process.stdout.write('\x00' + JSON.stringify(msg) + '\n')
}

// Wait for init message from runner
const { config } = await waitForMessage('init')
const { serverHost, serverPort, username, botScript } = config

// Import mineflayer and create bot
const mineflayer = await import('mineflayer')
const { pathfinder } = await import('mineflayer-pathfinder')

const bot = mineflayer.default.createBot({
  host: serverHost,
  port: serverPort,
  username,
  version: '1.21.11',
  hideErrors: false,
})

bot.loadPlugin(pathfinder)

// Wait for spawn
await new Promise((resolve, reject) => {
  bot.once('spawn', resolve)
  bot.once('error', reject)
  bot.once('kick', (reason) => reject(new Error(`Kicked: ${reason}`)))
})

console.log(`Bot "${username}" spawned`)

// Tell daemon we're in the server, then wait for it to finish resetting us
send({ type: 'spawned' })
await waitForMessage('start')

// Now import the user's bot code
try {
  const mod = await import(pathToFileURL(botScript).href)
  if (typeof mod.onInit === 'function') {
    await mod.onInit(bot)
  }
} catch (err) {
  console.error(`Error loading bot script: ${err.message}`)
  console.error(err.stack)
}

// Listen for game events from runner
lineHandlers.push((line) => {
  try {
    const event = JSON.parse(line)
    // Future: dispatch events to competitor bot handlers
  } catch {}
})

// Keep the process alive
setInterval(() => {}, 1 << 30)

// Handle clean shutdown
bot.on('end', () => {
  process.exit(0)
})
