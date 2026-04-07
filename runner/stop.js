import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, readFileSync, unlinkSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PID_FILE = resolve(ROOT, '.spire/daemon.pid')
const WEB_PORT = 3000
const API = `http://127.0.0.1:${WEB_PORT}/api`

// Try graceful shutdown via API
try {
  const res = await fetch(`${API}/stop`, {
    method: 'POST',
    signal: AbortSignal.timeout(3000),
  })
  if (res.ok) {
    console.log('[stop] Daemon stopping gracefully')
    return
  }
} catch {}

// Fall back to PID file
if (existsSync(PID_FILE)) {
  const pid = parseInt(readFileSync(PID_FILE, 'utf8'), 10)
  try {
    process.kill(pid, 'SIGTERM')
    console.log(`[stop] Sent SIGTERM to daemon (PID ${pid})`)
    // Wait a bit, then force kill if needed
    await new Promise((r) => setTimeout(r, 3000))
    try {
      process.kill(pid, 0)
      process.kill(pid, 'SIGKILL')
      console.log('[stop] Force killed daemon')
    } catch {
      // Already dead
    }
  } catch {
    console.log('[stop] Daemon not running, cleaning up PID file')
  }
  try {
    unlinkSync(PID_FILE)
  } catch {}
  return
}

console.log('[stop] No daemon running')
