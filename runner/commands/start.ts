import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  existsSync,
  readFileSync,
  readSync,
  closeSync,
  mkdirSync,
  openSync,
  watchFile,
} from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const DAEMON = resolve(__dirname, '../daemon/daemon.ts')
const PID_FILE = resolve(ROOT, '.spire/daemon.pid')
const LOG_FILE = resolve(ROOT, '.spire/daemon.log')
const WEB_PORT = 3000
const API = `http://127.0.0.1:${WEB_PORT}/api`
const attachLogs = !(
  process.argv.slice(2).includes('--detach') ||
  process.argv.slice(2).includes('-d')
)

async function isDaemonRunning() {
  try {
    const res = await fetch(`${API}/status`, {
      signal: AbortSignal.timeout(1000),
    })
    return res.ok
  } catch {
    return false
  }
}

function tailLog() {
  let pos = 0

  function readNew() {
    try {
      const fd = openSync(LOG_FILE, 'r')
      const buf = Buffer.alloc(65536)
      let bytesRead
      do {
        bytesRead = readSync(fd, buf, 0, buf.length, pos)
        if (bytesRead > 0) {
          process.stdout.write(buf.subarray(0, bytesRead))
          pos += bytesRead
        }
      } while (bytesRead > 0)
      closeSync(fd)
    } catch {
      // Read failed
    }
  }

  // Wait for the log file to appear
  const waitForFile = () => {
    if (existsSync(LOG_FILE)) {
      readNew()
      watchFile(LOG_FILE, { interval: 200 }, () => readNew())
    } else {
      setTimeout(waitForFile, 100)
    }
  }
  waitForFile()
}

if (await isDaemonRunning()) {
  console.log('[start] Daemon already running, restarting bots...')
  const res = await fetch(`${API}/restart-bots`, { method: 'POST' })
  const data = (await res.json()) as Record<string, unknown>
  if (data.ok) {
    console.log('[start] Bots restarted')
  } else {
    console.error('[start] Failed to restart bots')
    process.exit(1)
  }
  process.exit(0)
}

// Clean stale PID file
if (existsSync(PID_FILE)) {
  const pid = parseInt(readFileSync(PID_FILE, 'utf8'), 10)
  try {
    process.kill(pid, 0)
    // Process exists but API didn't respond — wait and retry
    console.log('[start] Daemon process exists but not responding, waiting...')
    await new Promise((r) => setTimeout(r, 3000))
    if (await isDaemonRunning()) {
      console.log('[start] Daemon recovered, restarting bots...')
      await fetch(`${API}/restart-bots`, { method: 'POST' })
      console.log('[start] Bots restarted')
      process.exit(0)
    }
    // Still not responding, kill it
    console.log('[start] Killing unresponsive daemon...')
    process.kill(pid, 'SIGKILL')
    await new Promise((r) => setTimeout(r, 500))
  } catch {
    // Process doesn't exist, stale PID file
  }
}

console.log('[start] Starting daemon...')
mkdirSync(resolve(ROOT, '.spire'), { recursive: true })

const logFd = openSync(LOG_FILE, 'w')
const child = spawn('bun', [DAEMON], {
  cwd: ROOT,
  detached: true,
  stdio: ['ignore', logFd, logFd],
})
child.unref()

console.log(`[start] Daemon started (PID ${child.pid})`)
console.log(`[start] Viewer: http://localhost:${WEB_PORT}`)
if (attachLogs) {
  console.log('[start] Tailing daemon log (Ctrl+C to detach)...')
  console.log('')
  tailLog()
}
