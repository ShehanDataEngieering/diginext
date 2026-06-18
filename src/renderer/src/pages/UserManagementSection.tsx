import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'
import type { AppUser } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Admin-only user management. Renders only when SettingsPage has confirmed the
 * signed-in user is an admin, and every call passes the caller's access token —
 * the main process re-checks admin status, so this UI gating is convenience,
 * not the security boundary.
 */
export function UserManagementSection({
  token,
  currentEmail
}: {
  token: string
  currentEmail: string | null
}): React.JSX.Element {
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [creating, setCreating] = useState(false)

  async function load(): Promise<void> {
    setLoading(true)
    try {
      setUsers(await window.api.users.list(token))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!newEmail.trim() || newPassword.length < 8) return
    setCreating(true)
    setError(null)
    try {
      const created = await window.api.users.create(token, {
        email: newEmail.trim(),
        password: newPassword
      })
      toast.success('User created', { description: created.email })
      setNewEmail('')
      setNewPassword('')
      await load()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error('Could not create user', { description: message })
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(user: AppUser): Promise<void> {
    if (!confirm(`Remove ${user.email}? They will immediately lose access to the app.`)) return
    setError(null)
    try {
      await window.api.users.delete(token, user.id)
      toast.success('User removed', { description: user.email })
      await load()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error('Could not remove user', { description: message })
    }
  }

  return (
    <div className="rounded-md border border-[#E5E5E5] bg-white">
      <div className="border-b border-[#E5E5E5] px-4 py-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#1D1D1F]">
          <Users size={16} strokeWidth={1.5} className="text-[#6E6E73]" />
          User Management
        </h3>
        <p className="mt-0.5 text-xs text-[#6E6E73]">
          Create or remove people who can sign in. New users can sign in immediately with the email
          and password you set here.
        </p>
      </div>

      {/* Create user */}
      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3 border-b border-[#E5E5E5] px-4 py-3">
        <div className="flex flex-1 flex-col gap-1" style={{ minWidth: 200 }}>
          <Label htmlFor="new-user-email">Email</Label>
          <Input
            id="new-user-email"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="person@company.com"
            required
          />
        </div>
        <div className="flex flex-1 flex-col gap-1" style={{ minWidth: 200 }}>
          <Label htmlFor="new-user-password">Temporary password</Label>
          <Input
            id="new-user-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            required
          />
        </div>
        <Button type="submit" disabled={creating || !newEmail.trim() || newPassword.length < 8}>
          <UserPlus size={14} strokeWidth={1.5} /> {creating ? 'Creating…' : 'Add user'}
        </Button>
      </form>

      {error && <div className="border-b border-[#E5E5E5] px-4 py-2 text-sm text-red-600">{error}</div>}

      {/* User list */}
      <div className="px-4 py-3">
        {loading ? (
          <p className="text-sm text-[#6E6E73]">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-[#6E6E73]">No users found.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {users.map((user) => {
              const isSelf = currentEmail?.toLowerCase() === user.email.toLowerCase()
              return (
                <div
                  key={user.id}
                  className="group flex items-center justify-between rounded-md border border-[#E5E5E5] px-3 py-2 transition-colors duration-150 hover:bg-[#F5F5F7]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-[#1D1D1F]">
                      <span className="truncate">{user.email}</span>
                      {user.isAdmin && (
                        <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                          <ShieldCheck size={11} strokeWidth={1.5} /> Admin
                        </span>
                      )}
                      {isSelf && <span className="text-[11px] text-[#AEAEB2]">(you)</span>}
                    </div>
                    <div className="text-xs text-[#6E6E73]">
                      {user.lastSignInAt
                        ? `Last sign-in ${new Date(user.lastSignInAt).toLocaleString()}`
                        : 'Never signed in'}
                    </div>
                  </div>
                  {/* Admins can't be deleted from the UI — demote via ADMIN_EMAILS
                      first. Prevents an admin from locking themselves out. */}
                  {!user.isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-[#6E6E73] opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-red-600"
                      title={`Remove ${user.email}`}
                      onClick={() => handleDelete(user)}
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
