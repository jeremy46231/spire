import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, readFileSync, unlinkSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const PID_FILE = resolve(ROOT, '.spire/daemon.pid')
const WEB_PORT = 3000
const API = `http://127.0.0.1:${WEB_PORT}/api`
const POLL_INTERVAL_MS = 500
const GRACEFUL_WAIT_MS = 20_000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function getDaemonPid() {
  if (!existsSync(PID_FILE)) return null
  const pid = Number.parseInt(readFileSync(PID_FILE, 'utf8'), 10)
  return Number.isFinite(pid) ? pid : null
}

async function waitForPidToExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return true
    await sleep(POLL_INTERVAL_MS)
  }
  return !isPidRunning(pid)
}

async function requestGracefulStop() {
  try {
    const res = await fetch(`${API}/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

const daemonPid = getDaemonPid()

if (!daemonPid || !isPidRunning(daemonPid)) {
  try {
    unlinkSync(PID_FILE)
  } catch {}
  console.log('[stop] No daemon running')
  process.exit(0)
}

const apiStopRequested = await requestGracefulStop()

if (apiStopRequested) {
  console.log('[stop] Requested graceful shutdown')
  const stopped = await waitForPidToExit(daemonPid, GRACEFUL_WAIT_MS)
  if (stopped) {
    try {
      unlinkSync(PID_FILE)
    } catch {}
    console.log('[stop] Daemon stopped')
    process.exit(0)
  }
}

console.error('[stop] Graceful stop failed or timed out')
process.exit(1)
