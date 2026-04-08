import { log } from './log.js'

const SERVER_HOST = '127.0.0.1'
const RCON_PORT = 25575
const RCON_PASSWORD = 'spire'

let rconClient = null

export function setRconClient(client) {
  rconClient = client
}

export function getRconClient() {
  return rconClient
}

export async function sendRcon(cmd) {
  if (!rconClient) return { error: 'RCON not connected' }
  try {
    const response = await rconClient.send(cmd)
    return { response }
  } catch (e) {
    return { error: String(e.message || e) }
  }
}

export async function waitForRcon() {
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
