// Migration script to transfer data from SQLite to Supabase PostgreSQL using Session Pooler
// This is a simplified, working version that directly uses Node.js

const { app } = require('electron');
const { join } = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { Pool } = require('pg');
const fs = require('fs');

// Read environment variables
const DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite';
const POSTGRES_CONNECTION_STRING = process.env.POSTGRES_CONNECTION_STRING || '';

// SQLite database path
const DB_FILE_NAME = 'inventory.sqlite';
const SQLITE_DB_PATH = join(app.getPath('userData'), DB_FILE_NAME);

// Check if we have a SQLite database to migrate
if (!fs.existsSync(SQLITE_DB_PATH)) {
  console.log('❌ No SQLite database found at:', SQLITE_DB_PATH);
  console.log('Make sure your application has been run at least once to create the database.');
  process.exit(1);
}

console.log('✅ Found SQLite database at:', SQLITE_DB_PATH);
console.log('🔧 Starting migration to Supabase PostgreSQL...');

async function migrateData() {
  try {
    // Connect to SQLite
    console.log('Connecting to SQLite database...');
    const sqliteDb = new Database(SQLITE_DB_PATH);
    console.log('✅ Connected to SQLite successfully');
    
    // Connect to PostgreSQL with Session Pooler
    console.log('Connecting to Supabase PostgreSQL with Session Pooler...');
    const pool = new Pool({
      connectionString: POSTGRES_CONNECTION_STRING,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    
    const client = await pool.connect();
    console.log('✅ Connected to Supabase PostgreSQL successfully');
    
    // Create schema in PostgreSQL (simplified version)
    console.log('Creating schema in PostgreSQL...');
    
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version    INTEGER PRIMARY KEY,
          name       TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (NOW())
        )
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS projects (
          id                INTEGER PRIMARY KEY,
          name              TEXT NOT NULL UNIQUE,
          location          TEXT,
          updated_by        TEXT,
          last_updated_date TEXT,
          status            TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'completed'))
        )
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS items (
          id            INTEGER PRIMARY KEY,
          category      TEXT NOT NULL,
          name          TEXT NOT NULL,
          initial_stock INTEGER NOT NULL DEFAULT 0,
          UNIQUE (category, name)
        )
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS item_units (
          id                  INTEGER PRIMARY KEY,
          item_id             INTEGER NOT NULL,
          serial_id           TEXT,
          assigned_project_id INTEGER,
          audit_date          TEXT,
          remarks             TEXT,
          status              TEXT NOT NULL DEFAULT 'Available',
          photo_evidence_ref  TEXT
        )
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS transfers (
          id              INTEGER PRIMARY KEY,
          date            TEXT NOT NULL,
          item_id         INTEGER NOT NULL,
          serial_id       TEXT,
          qty             INTEGER NOT NULL DEFAULT 1,
          from_project_id INTEGER,
          to_project_id   INTEGER,
          transferred_by  TEXT,
          authorized_by   TEXT,
          notes           TEXT,
          status          TEXT NOT NULL DEFAULT 'Recorded'
        )
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS handovers (
          id             INTEGER PRIMARY KEY,
          project_id     INTEGER NOT NULL,
          handover_date  TEXT NOT NULL,
          handed_over_by TEXT,
          received_by    TEXT,
          notes          TEXT,
          signature_ref  TEXT
        )
      `);
      
      console.log('✅ Schema created successfully');
    } catch (schemaError) {
      console.error('⚠️ Schema creation error (may already exist):', schemaError.message);
    }
    
    // Migrate projects
    console.log('Migrating projects...');
    const projects = sqliteDb.prepare('SELECT * FROM projects').all();
    for (const project of projects) {
      await client.query(
        'INSERT INTO projects (id, name, location, updated_by, last_updated_date, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [project.id, project.name, project.location, project.updated_by, project.last_updated_date, project.status]
      );
    }
    console.log(`✅ Migrated ${projects.length} projects`);
    
    // Migrate items
    console.log('Migrating items...');
    const items = sqliteDb.prepare('SELECT * FROM items').all();
    for (const item of items) {
      await client.query(
        'INSERT INTO items (id, category, name, initial_stock) VALUES ($1, $2, $3, $4)',
        [item.id, item.category, item.name, item.initial_stock]
      );
    }
    console.log(`✅ Migrated ${items.length} items`);
    
    // Migrate item_units
    console.log('Migrating item units...');
    const itemUnits = sqliteDb.prepare('SELECT * FROM item_units').all();
    for (const unit of itemUnits) {
      await client.query(
        'INSERT INTO item_units (id, item_id, serial_id, assigned_project_id, audit_date, remarks, status, photo_evidence_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [unit.id, unit.item_id, unit.serial_id, unit.assigned_project_id, unit.audit_date, unit.remarks, unit.status, unit.photo_evidence_ref]
      );
    }
    console.log(`✅ Migrated ${itemUnits.length} item units`);
    
    // Migrate transfers
    console.log('Migrating transfers...');
    const transfers = sqliteDb.prepare('SELECT * FROM transfers').all();
    for (const transfer of transfers) {
      await client.query(
        'INSERT INTO transfers (id, date, item_id, serial_id, qty, from_project_id, to_project_id, transferred_by, authorized_by, notes, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        [transfer.id, transfer.date, transfer.item_id, transfer.serial_id, transfer.qty, transfer.from_project_id, transfer.to_project_id, transfer.transferred_by, transfer.authorized_by, transfer.notes, transfer.status]
      );
    }
    console.log(`✅ Migrated ${transfers.length} transfers`);
    
    // Migrate handovers
    console.log('Migrating handovers...');
    const handovers = sqliteDb.prepare('SELECT * FROM handovers').all();
    for (const handover of handovers) {
      await client.query(
        'INSERT INTO handovers (id, project_id, handover_date, handed_over_by, received_by, notes, signature_ref) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [handover.id, handover.project_id, handover.handover_date, handover.handed_over_by, handover.received_by, handover.notes, handover.signature_ref]
      );
    }
    console.log(`✅ Migrated ${handovers.length} handovers`);
    
    // Clean up
    client.release();
    sqliteDb.close();
    await pool.end();
    
    console.log('\n🎉 Migration completed successfully!');
    console.log('Your data has been transferred to Supabase PostgreSQL.');
    console.log('\n✅ Next steps:');
    console.log('1. Verify your data in Supabase Dashboard');
    console.log('2. Update your application to use PostgreSQL');
    console.log('3. Test the application with the new database connection');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

// Run the migration
if (require.main === module) {
  migrateData().catch(console.error);
}

module.exports = { migrateData };