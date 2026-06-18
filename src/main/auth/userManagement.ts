import { adminEmails } from './verifySession'
import type { AppUser } from '../../shared/ipc'

// Talks to the Supabase Auth Admin API with the service-role key. These calls
// only ever run in the main process behind an admin check (see the IPC handlers
// in main/index.ts) — the service-role key must never reach the renderer.
function adminApi(): { url: string; headers: Record<string, string> } {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env for user management.')
  }
  return {
    url,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  }
}

interface GoTrueUser {
  id: string
  email?: string
  created_at?: string
  last_sign_in_at?: string | null
  banned_until?: string | null
}

// A user is "disabled" when GoTrue has a ban that hasn't expired yet. Unbanning
// (ban_duration: 'none') clears banned_until back to null.
function isDisabled(u: GoTrueUser): boolean {
  if (!u.banned_until) return false
  const until = new Date(u.banned_until).getTime()
  return Number.isFinite(until) && until > Date.now()
}

function toAppUser(u: GoTrueUser, admins: string[]): AppUser {
  const email = u.email ?? ''
  return {
    id: u.id,
    email,
    createdAt: u.created_at ?? '',
    lastSignInAt: u.last_sign_in_at ?? null,
    isAdmin: !!email && admins.includes(email.toLowerCase()),
    disabled: isDisabled(u)
  }
}

// Updates a GoTrue user via the admin endpoint, returning the updated AppUser.
async function adminUpdateUser(id: string, patch: Record<string, unknown>): Promise<AppUser> {
  if (!id) throw new Error('User id is required.')
  const { url, headers } = adminApi()
  const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(patch)
  })
  if (!res.ok) throw new Error(`Failed to update user: ${res.status} ${await res.text()}`)
  return toAppUser((await res.json()) as GoTrueUser, adminEmails())
}

export async function listUsers(): Promise<AppUser[]> {
  const { url, headers } = adminApi()
  const res = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers })
  if (!res.ok) throw new Error(`Failed to list users: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { users?: GoTrueUser[] } | GoTrueUser[]
  const users = Array.isArray(data) ? data : (data.users ?? [])
  const admins = adminEmails()
  return users.map((u) => toAppUser(u, admins)).sort((a, b) => a.email.localeCompare(b.email))
}

export async function createUser(email: string, password: string): Promise<AppUser> {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) throw new Error('Email is required.')
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.')

  const { url, headers } = adminApi()
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    // email_confirm: true creates the user already-confirmed so they can sign in
    // immediately without a confirmation email round-trip.
    body: JSON.stringify({ email: trimmed, password, email_confirm: true })
  })
  if (!res.ok) {
    const body = await res.text()
    // Surface the common "already exists" case in plain language.
    if (res.status === 422 || /already.*registered|exists/i.test(body)) {
      throw new Error(`A user with email ${trimmed} already exists.`)
    }
    throw new Error(`Failed to create user: ${res.status} ${body}`)
  }
  return toAppUser((await res.json()) as GoTrueUser, adminEmails())
}

export async function deleteUser(id: string): Promise<void> {
  if (!id) throw new Error('User id is required.')

  // Lockout guard: refuse to remove the last account, which would leave nobody
  // able to sign in or manage users. Disable instead if access must be revoked.
  const existing = await listUsers()
  if (existing.length <= 1) {
    throw new Error('Cannot delete the last remaining user — at least one account must stay.')
  }

  const { url, headers } = adminApi()
  const res = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers })
  if (!res.ok) throw new Error(`Failed to delete user: ${res.status} ${await res.text()}`)
}

// Admin password reset — sets a new password for any user without needing their
// current one. The user can sign in with it immediately.
export async function setUserPassword(id: string, password: string): Promise<AppUser> {
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.')
  return adminUpdateUser(id, { password })
}

// Suspends or restores access without destroying the account or its history.
// A disabled user keeps existing but cannot sign in until re-enabled.
export async function setUserDisabled(id: string, disabled: boolean): Promise<AppUser> {
  // '876000h' ≈ 100 years (indefinite); 'none' lifts the ban.
  return adminUpdateUser(id, { ban_duration: disabled ? '876000h' : 'none' })
}
