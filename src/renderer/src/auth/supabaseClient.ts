import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

console.log('[supabaseClient] URL:', supabaseUrl ? 'set' : 'MISSING')
console.log('[supabaseClient] Anon key:', supabaseAnonKey ? 'set' : 'MISSING')

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. Copy .env.example to .env and fill in your Supabase keys.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
