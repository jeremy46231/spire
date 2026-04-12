import type { ChildProcess } from 'child_process'

export interface BotInstance {
  id: number
  filePath: string
  username: string
  resolvedUsername: string
  enabled: boolean
  proc: ChildProcess | null
  isDefault: boolean
}

export interface BotInfo {
  id: number
  username: string
  filePath: string
  enabled: boolean
  running: boolean
  isDefault: boolean
}

export interface BotCatalog {
  user: { filePath: string; username: string }[]
  basic: { filePath: string; username: string }[]
}

export interface InitMessage {
  type: 'init'
  config: {
    serverHost: string
    serverPort: number
    username: string
    botScript: string
  }
  [key: string]: unknown
}

export interface StartMessage {
  type: 'start'
}

export type DaemonMessage = InitMessage | StartMessage

export interface RconResponse {
  response?: string
  error?: string
}

export interface WebSocketData {
  type: 'control' | 'viewer-proxy'
  target?: string
  backend?: WebSocket
  queue?: (string | ArrayBuffer | null)[] | null
}

export interface Handlers {
  restartBots?: () => Promise<void>
  stop?: () => Promise<void>
  rcon?: (cmd: string) => Promise<RconResponse>
  addBot?: (filePath: string, username: string) => Promise<void>
  removeBot?: (id: number) => Promise<void>
  toggleBot?: (id: number, enabled: boolean) => Promise<void>
  restartBot?: (id: number) => Promise<void>
  getBots?: () => BotInfo[]
  getCatalog?: () => BotCatalog
}
