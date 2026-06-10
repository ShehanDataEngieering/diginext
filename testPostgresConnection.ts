// Simple test to verify we can connect to Supabase with IPv4
import { Pool } from 'pg'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

// Use the connection string from your environment
const connectionString = process.env.POSTGRES_CONNECTION_STRING || ''

if (!connectionString) {
  console.error('POSTGRES_CONNECTION_STRING not found in environment variables')
  console.error('Please check your .env file')
  process.exit(1)
}

console.log('Testing PostgreSQL connection with Session Pooler...')
console.log('Connection string (redacted):', connectionString.replace(/:[^@]*@/, ':***@'))

// Test connection with explicit IPv4 settings
const poolConfig = {
  connectionString: connectionString,
  max: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Try to force IPv4
  host: 'db.ahnauivoqhrvzodsaqwq.supabase.co',
  port: 5432,
  ssl: {
    rejectUnauthorized: true
  }
}

const pool = new Pool(poolConfig)

async function testConnection() {
  try {
    console.log('Connecting to PostgreSQL with explicit IPv4 settings...')
    const client = await pool.connect()
    console.log('✅ Successfully connected to PostgreSQL!')
    
    // Test a simple query
    const result = await client.query('SELECT NOW() as time')
    console.log('✅ Connection test successful:', result.rows[0].time)
    
    client.release()
    
    console.log('\n🎉 PostgreSQL connection test successful!')
    console.log('Your Supabase Session Pooler configuration is working correctly.')
    console.log('\nYou can now proceed with data migration.')
    
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error.message)
    console.error('\nCommon troubleshooting steps:')
    console.error('1. Check your Supabase password in .env file')
    console.error('2. Verify your network allows connections to Supabase')
    console.error('3. Make sure Session Pooler is enabled in your Supabase project')
    console.error('4. Try adding &connect_timeout=10 to your connection string')
    console.error('5. Check if your firewall blocks outbound connections to port 5432')
    
    // Test if we can resolve the hostname
    try {
      const dns = await import('dns').then(m => m.default)
      console.log('\nTesting DNS resolution...')
      const addresses = await dns.promises.resolve('db.ahnauivoqhrvzodsaqwq.supabase.co')
      console.log('Resolved addresses:', addresses)
    } catch (dnsError) {
      console.error('DNS resolution failed:', dnsError.message)
    }
    
    process.exit(1)
  } finally {
    await pool.end()
  }
}

testConnection().catch(console.error)