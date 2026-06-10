#!/usr/bin/env node

/**
 * Migration script to transfer data from SQLite to PostgreSQL
 * 
 * Usage:
 * 1. Set DATABASE_TYPE=sqlite in .env (to read from existing SQLite DB)
 * 2. Set DATABASE_TYPE=postgres and POSTGRES_CONNECTION_STRING in .env (to write to PostgreSQL)
 * 3. Run this script: node migrateToPostgres.js
 */

import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3-multiple-ciphers'
import { Pool } from 'pg'
import fs from 'fs'

// Read environment variables
const DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite'
const POSTGRES_CONNECTION_STRING = process.env.POSTGRES_CONNECTION_STRING || ''

// SQLite database path
const DB_FILE_NAME = 'inventory.sqlite'
const SQLITE_DB_PATH = join(app.getPath('userData'), DB_FILE_NAME)

// PostgreSQL connection pool
let pool: Pool | null = null

async function connectToPostgres() {
  if (!POSTGRES_CONNECTION_STRING) {
    throw new Error('POSTGRES_CONNECTION_STRING environment variable is required')
  }
  
  pool = new Pool({
    connectionString: POSTGRES_CONNECTION_STRING,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })
  
  console.log('Connecting to PostgreSQL...')
  const client = await pool.connect()
  console.log('Connected to PostgreSQL successfully')
  client.release()
}

async function connectToSqlite() {
  console.log('Connecting to SQLite database...')
  const db = new Database(SQLITE_DB_PATH)
  console.log('Connected to SQLite database successfully')
  return db
}

async function migrateSchema() {
  if (!pool) {
    throw new Error('Not connected to PostgreSQL')
  }
  
  console.log('Creating schema in PostgreSQL...')
  
  const client = await pool.connect()
  
  try {
    // Create the schema from the existing migrations
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (NOW())
      )
    `)
    
    // Create projects table
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        name              TEXT NOT NULL UNIQUE,
        location          TEXT,
        updated_by        TEXT,
        last_updated_date TEXT,
        status            TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'completed'))
      )
    `)
    
    // Create items table
    await client.query(`
      CREATE TABLE IF NOT EXISTS items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        category      TEXT NOT NULL,
        name          TEXT NOT NULL,
        initial_stock INTEGER NOT NULL DEFAULT 0,
        UNIQUE (category, name)
      )
    `)
    
    // Create item_units table
    await client.query(`
      CREATE TABLE IF NOT EXISTS item_units (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id             INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
        serial_id           TEXT,
        assigned_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        audit_date          TEXT,
        remarks             TEXT,
        status              TEXT NOT NULL DEFAULT 'Available'
                              CHECK (status IN ('In Use', 'Available', 'Retired-Damaged')),
        photo_evidence_ref  TEXT
      )
    `)
    
    // Create transfers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS transfers (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        date            TEXT NOT NULL,
        item_id         INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
        serial_id       TEXT,
        qty             INTEGER NOT NULL DEFAULT 1,
        from_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        to_project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        transferred_by  TEXT,
        authorized_by   TEXT,
        notes           TEXT,
        status          TEXT NOT NULL DEFAULT 'Recorded'
      )
    `)
    
    // Create handovers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS handovers (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        handover_date  TEXT NOT NULL,
        handed_over_by TEXT,
        received_by    TEXT,
        notes          TEXT,
        signature_ref  TEXT
      )
    `)
    
    // Create indexes
    await client.query('CREATE INDEX IF NOT EXISTS idx_item_units_item_id ON item_units(item_id)')
    await client.query('CREATE INDEX IF NOT EXISTS idx_item_units_project_id ON item_units(assigned_project_id)')
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_item_units_serial_id ON item_units(serial_id) WHERE serial_id IS NOT NULL')
    await client.query('CREATE INDEX IF NOT EXISTS idx_transfers_item_id ON transfers(item_id)')
    await client.query('CREATE INDEX IF NOT EXISTS idx_transfers_from_project ON transfers(from_project_id)')
    await client.query('CREATE INDEX IF NOT EXISTS idx_transfers_to_project ON transfers(to_project_id)')
    await client.query('CREATE INDEX IF NOT EXISTS idx_handovers_project_id ON handovers(project_id)')
    
    console.log('Schema migration completed successfully')
  } finally {
    client.release()
  }
}

async function migrateData() {
  if (!pool) {
    throw new Error('Not connected to PostgreSQL')
  }
  
  const sqliteDb = await connectToSqlite()
  const client = await pool.connect()
  
  try {
    console.log('Starting data migration...')
    
    // Migrate projects
    console.log('Migrating projects...')
    const projects = sqliteDb.prepare('SELECT * FROM projects').all()
    for (const project of projects) {
      await client.query(
        'INSERT INTO projects (id, name, location, updated_by, last_updated_date, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [project.id, project.name, project.location, project.updated_by, project.last_updated_date, project.status]
      )
    }
    
    // Migrate items
    console.log('Migrating items...')
    const items = sqliteDb.prepare('SELECT * FROM items').all()
    for (const item of items) {
      await client.query(
        'INSERT INTO items (id, category, name, initial_stock) VALUES ($1, $2, $3, $4)',
        [item.id, item.category, item.name, item.initial_stock]
      )
    }
    
    // Migrate item_units
    console.log('Migrating item units...')
    const itemUnits = sqliteDb.prepare('SELECT * FROM item_units').all()
    for (const unit of itemUnits) {
      await client.query(
        'INSERT INTO item_units (id, item_id, serial_id, assigned_project_id, audit_date, remarks, status, photo_evidence_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [unit.id, unit.item_id, unit.serial_id, unit.assigned_project_id, unit.audit_date, unit.remarks, unit.status, unit.photo_evidence_ref]
      )
    }
    
    // Migrate transfers
    console.log('Migrating transfers...')
    const transfers = sqliteDb.prepare('SELECT * FROM transfers').all()
    for (const transfer of transfers) {
      await client.query(
        'INSERT INTO transfers (id, date, item_id, serial_id, qty, from_project_id, to_project_id, transferred_by, authorized_by, notes, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        [transfer.id, transfer.date, transfer.item_id, transfer.serial_id, transfer.qty, transfer.from_project_id, transfer.to_project_id, transfer.transferred_by, transfer.authorized_by, transfer.notes, transfer.status]
      )
    }
    
    // Migrate handovers
    console.log('Migrating handovers...')
    const handovers = sqliteDb.prepare('SELECT * FROM handovers').all()
    for (const handover of handovers) {
      await client.query(
        'INSERT INTO handovers (id, project_id, handover_date, handed_over_by, received_by, notes, signature_ref) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [handover.id, handover.project_id, handover.handover_date, handover.handed_over_by, handover.received_by, handover.notes, handover.signature_ref]
      )
    }
    
    console.log('Data migration completed successfully')
  } finally {
    client.release()
    sqliteDb.close()
  }
}

async function main() {
  try {
    if (DATABASE_TYPE === 'postgres') {
      await connectToPostgres()
      await migrateSchema()
      await migrateData()
      console.log('Migration completed successfully!')
    } else {
      console.log('Please set DATABASE_TYPE=postgres and POSTGRES_CONNECTION_STRING in your environment')
      console.log('Example:')
      console.log('DATABASE_TYPE=postgres')
      console.log('POSTGRES_CONNECTION_STRING=postgresql://user:password@host:port/database')
    }
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    if (pool) {
      pool.end()
    }
  }
}

if (require.main === module) {
  main()
}

export { main }