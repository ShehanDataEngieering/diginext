import Database from 'better-sqlite3-multiple-ciphers'
import type { DatabaseAdapter, QueryResult } from './adapter'

export class SqliteAdapter implements DatabaseAdapter {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const stmt = this.db.prepare(sql)
    if (stmt.reader) {
      const rows = stmt.all(...params) as Record<string, unknown>[]
      return { rows, rowCount: rows.length, lastInsertRowid: 0 }
    }
    const result = stmt.run(...params)
    return {
      rows: [],
      rowCount: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid)
    }
  }

  async queryOne(sql: string, params: unknown[] = []): Promise<Record<string, unknown> | null> {
    const row = this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined
    return row ?? null
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  async transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    const run = this.db.transaction(async () => {
      return await fn(this)
    })
    return await run()
  }

  async close(): Promise<void> {
    this.db.close()
  }

  getRawDb(): Database.Database {
    return this.db
  }
}
