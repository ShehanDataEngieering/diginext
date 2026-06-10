import { Pool, type PoolClient } from 'pg'
import type { DatabaseAdapter, QueryResult } from './adapter'

function convertPlaceholders(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

export class PostgresAdapter implements DatabaseAdapter {
  private pool: Pool
  private clientOverride: PoolClient | null = null

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  }

  private async getClient(): Promise<PoolClient> {
    if (this.clientOverride) return this.clientOverride
    return this.pool.connect()
  }

  private async releaseClient(client: PoolClient): Promise<void> {
    if (client !== this.clientOverride) {
      client.release()
    }
  }

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const client = await this.getClient()
    try {
      const pgSql = convertPlaceholders(sql)
      const result = await client.query(pgSql, params)
      const rows = (result.rows ?? []) as Record<string, unknown>[]
      const lastInsertRowid = rows.length > 0 && 'id' in rows[0]
        ? Number(rows[0].id)
        : 0
      return {
        rows,
        rowCount: result.rowCount ?? 0,
        lastInsertRowid
      }
    } finally {
      await this.releaseClient(client)
    }
  }

  async queryOne(sql: string, params: unknown[] = []): Promise<Record<string, unknown> | null> {
    const client = await this.getClient()
    try {
      const pgSql = convertPlaceholders(sql)
      const result = await client.query(pgSql, params)
      return (result.rows[0] as Record<string, unknown>) ?? null
    } finally {
      await this.releaseClient(client)
    }
  }

  async exec(sql: string): Promise<void> {
    const client = await this.getClient()
    try {
      await client.query(sql)
    } finally {
      await this.releaseClient(client)
    }
  }

  async transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    this.clientOverride = client
    try {
      await client.query('BEGIN')
      const result = await fn(this)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      this.clientOverride = null
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
