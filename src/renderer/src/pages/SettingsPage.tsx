import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { KeyRound, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { supabase } from '../auth/supabaseClient'
import { UserManagementSection } from './UserManagementSection'

export function SettingsPage(): React.JSX.Element {
  const [email, setEmail] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  // Self-service "change my password"
  const [pwOpen, setPwOpen] = useState(false)
  const [pwValue, setPwValue] = useState('')
  const [pwSaving, setPwSaving] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setEmail(session?.user.email ?? null)
      setToken(session?.access_token ?? null)
    })
  }, [])

  // Updates the signed-in user's own password through their own session — no
  // admin rights needed, and the service-role key is never involved.
  async function handleChangePassword(): Promise<void> {
    if (pwValue.length < 8) return
    setPwSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pwValue })
      if (error) throw error
      toast.success('Your password was updated')
      setPwOpen(false)
      setPwValue('')
    } catch (err) {
      toast.error('Could not update password', {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#1D1D1F]">Settings</h2>
          <p className="mt-0.5 text-xs text-[#6E6E73]">Account and user management.</p>
        </div>
        {email && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#6E6E73]">
              Signed in as <span className="font-medium text-[#1D1D1F]">{email}</span>
            </span>
            <Button variant="outline" size="sm" onClick={() => setPwOpen(true)}>
              <KeyRound size={14} strokeWidth={1.5} /> Change password
            </Button>
            <Button variant="outline" size="sm" onClick={() => supabase.auth.signOut()}>
              <LogOut size={14} strokeWidth={1.5} /> Sign out
            </Button>
          </div>
        )}
      </div>

      {token && <UserManagementSection token={token} currentEmail={email} />}

      {/* Change-my-password dialog */}
      <Dialog open={pwOpen} onOpenChange={(open) => { setPwOpen(open); if (!open) setPwValue('') }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change your password</DialogTitle>
            <DialogDescription>
              Set a new password for {email}. You&apos;ll stay signed in on this device.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="my-new-password">New password</Label>
            <Input
              id="my-new-password"
              type="password"
              value={pwValue}
              onChange={(e) => setPwValue(e.target.value)}
              placeholder="At least 8 characters"
              minLength={8}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwOpen(false)} disabled={pwSaving}>
              Cancel
            </Button>
            <Button onClick={handleChangePassword} disabled={pwSaving || pwValue.length < 8}>
              {pwSaving ? 'Saving…' : 'Update password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
