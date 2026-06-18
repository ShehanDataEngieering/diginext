import { useState, useEffect } from 'react'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '../auth/supabaseClient'
import { UserManagementSection } from './UserManagementSection'

export function SettingsPage(): React.JSX.Element {
  const [email, setEmail] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setEmail(session?.user.email ?? null)
      setToken(session?.access_token ?? null)
    })
  }, [])

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
            <Button variant="outline" size="sm" onClick={() => supabase.auth.signOut()}>
              <LogOut size={14} strokeWidth={1.5} /> Sign out
            </Button>
          </div>
        )}
      </div>

      {token && <UserManagementSection token={token} currentEmail={email} />}
    </div>
  )
}
