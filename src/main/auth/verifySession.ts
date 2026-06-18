function envEmails(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

// Admins (allowed to manage users) come from ADMIN_EMAILS, falling back to the
// legacy ALLOWED_EMAILS so the original owner stays an admin without extra
// config. Plain app access is NOT gated by this list — see verifySession.
export function adminEmails(): string[] {
  const admins = envEmails('ADMIN_EMAILS')
  return admins.length > 0 ? admins : envEmails('ALLOWED_EMAILS')
}

function getSupabaseConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env for session verification.')
  }
  return { url, key }
}

/**
 * Resolves the lowercased email of the user the access token belongs to, by
 * asking Supabase to validate it (the token is never trusted client-side).
 * Returns null for a missing, expired, or invalid token.
 */
export async function getVerifiedEmail(token: string): Promise<string | null> {
  if (!token) return null
  const { url, key } = getSupabaseConfig()
  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: key }
    })
    if (!response.ok) return null
    const user = (await response.json()) as { email?: string }
    return user.email?.toLowerCase() ?? null
  } catch {
    return null
  }
}

/**
 * Anyone with a valid Supabase session may use the app — the set of users is
 * controlled by admins through the User Management screen (and self-signups
 * must be disabled in the Supabase project). Returns false only for a
 * missing/invalid token.
 */
export async function verifySession(token: string): Promise<boolean> {
  return (await getVerifiedEmail(token)) !== null
}

/** True only if the token belongs to a user whose email is in ADMIN_EMAILS. */
export async function isAdmin(token: string): Promise<boolean> {
  const email = await getVerifiedEmail(token)
  if (!email) return false
  return adminEmails().includes(email)
}
