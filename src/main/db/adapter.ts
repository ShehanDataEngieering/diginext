export interface QueryResult {
  rows: Record<string, unknown>[]
  rowCount: number
  lastInsertRowid: number
}

export interface DatabaseAdapter {
  query(sql: string, params?: unknown[]): Promise<QueryResult>
  queryOne(sql: string, params?: unknown[]): Promise<Record<string, unknown> | null>
  exec(sql: string): Promise<void>
  transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export function getDatabaseType(): string {
  return process.env.DATABASE_TYPE || 'sqlite'
}

export function getPostgresConnectionString(): string {
  return process.env.POSTGRES_CONNECTION_STRING || ''
}
