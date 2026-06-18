import { Pool, type PoolClient } from 'pg'
import type { DatabaseAdapter, QueryResult } from './adapter'

function convertPlaceholders(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

// Runs queries against a single bound pg client — the adapter handed to a
// `transaction()` callback. Crucially this is a SEPARATE object from the
// pool-backed PostgresAdapter, so an open transaction never reroutes unrelated
// concurrent queries (e.g. a dashboard refresh firing in parallel) onto its
// connection. Nested transaction() calls reuse the same client rather than
// issuing a second BEGIN.
class TransactionAdapter implements DatabaseAdapter {
  constructor(private client: PoolClient) {}

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const result = await this.client.query(convertPlaceholders(sql), params)
    const rows = (result.rows ?? []) as Record<string, unknown>[]
    const lastInsertRowid = rows.length > 0 && 'id' in rows[0] ? Number(rows[0].id) : 0
    return { rows, rowCount: Number(result.rowCount ?? 0), lastInsertRowid }
  }

  async queryOne(sql: string, params: unknown[] = []): Promise<Record<string, unknown> | null> {
    const result = await this.client.query(convertPlaceholders(sql), params)
    return (result.rows[0] as Record<string, unknown>) ?? null
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql)
  }

  // Already inside a transaction — just run the callback on the same client.
  async transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this)
  }

  async close(): Promise<void> {
    // The pool owns the client's lifecycle; nothing to close here.
  }
}

export class PostgresAdapter implements DatabaseAdapter {
  private pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  }

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const client = await this.pool.connect()
    try {
      const result = await client.query(convertPlaceholders(sql), params)
      const rows = (result.rows ?? []) as Record<string, unknown>[]
      const lastInsertRowid = rows.length > 0 && 'id' in rows[0] ? Number(rows[0].id) : 0
      return { rows, rowCount: Number(result.rowCount ?? 0), lastInsertRowid }
    } finally {
      client.release()
    }
  }

  async queryOne(sql: string, params: unknown[] = []): Promise<Record<string, unknown> | null> {
    const client = await this.pool.connect()
    try {
      const result = await client.query(convertPlaceholders(sql), params)
      return (result.rows[0] as Record<string, unknown>) ?? null
    } finally {
      client.release()
    }
  }

  async exec(sql: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query(sql)
    } finally {
      client.release()
    }
  }

  async transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    // All queries inside `fn` go through a client-bound adapter — never through
    // `this` — so the transaction is fully isolated from concurrent pool traffic.
    const tx = new TransactionAdapter(client)
    try {
      await client.query('BEGIN')
      const result = await fn(tx)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
