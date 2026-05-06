type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVELS: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3, silent: 4,
}

export class Logger {
  constructor(private level: LogLevel = 'silent') {}

  debug(msg: string): void { this.log('debug', msg) }
  info(msg: string): void { this.log('info', msg) }
  warn(msg: string): void { this.log('warn', msg) }
  error(msg: string): void { this.log('error', msg) }

  private log(level: Exclude<LogLevel, 'silent'>, msg: string): void {
    if (LEVELS[level] >= LEVELS[this.level]) {
      const method = level === 'debug' ? 'log' : level
      console[method](`[memorag:${level}] ${msg}`)
    }
  }
}
