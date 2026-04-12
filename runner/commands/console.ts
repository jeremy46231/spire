import { Rcon } from 'rcon-client'
import { createInterface } from 'readline'

const rcon = new Rcon({ host: '127.0.0.1', port: 25575, password: 'spire' })
await rcon.connect()
console.log('Connected to RCON. Type commands:')

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
})
rl.prompt()

rl.on('line', async (line: string) => {
  const cmd = line.trim()
  if (!cmd) {
    rl.prompt()
    return
  }
  try {
    const res = await rcon.send(cmd)
    if (res) console.log(res)
  } catch (err) {
    console.error('Error:', (err as Error).message)
  }
  rl.prompt()
})

rl.on('close', () => {
  rcon.end()
  process.exit(0)
})
