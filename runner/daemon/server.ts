import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { log } from './log.js'

export function waitForProcessExit(
  proc: ChildProcess | null,
  timeoutMs: number
) {
  return new Promise<boolean>((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve(true)

    let settled = false
    const onExit = () => {
      if (settled) return
      settled = true
      resolve(true)
    }

    proc.once('exit', onExit)

    setTimeout(() => {
      if (settled) return
      settled = true
      proc.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
  })
}

export function startPaperServer(serverDir: string, serverJar: string) {
  log('[runner] Starting Paper server...')
  const proc = spawn(
    'java',
    ['-Xms2G', '-Xmx2G', '-jar', serverJar, '--nogui'],
    {
      cwd: serverDir,
      stdio: ['pipe', 'pipe', 'pipe'] as const,
    }
  )

  proc.stdout?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) {
      const trimmed = line.trimEnd()
      if (trimmed) log(`[server] ${trimmed}`)
    }
  })
  proc.stderr?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) {
      const trimmed = line.trimEnd()
      if (trimmed) log(`[server] ${trimmed}`)
    }
  })
  proc.on('exit', (code: number | null) => {
    log(`[runner] Server exited with code ${code}`)
    process.exit(code ?? 1)
  })

  return proc
}
