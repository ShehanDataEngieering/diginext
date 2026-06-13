import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import diginextLogo from '../assets/diginext-logo.png'

type VerifyState = 'pending' | 'verified' | 'rejected'

export function AuthGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setInitialized(true)
    })

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setInitialized(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (!initialized) {
    return <CenteredMessage>Loading...</CenteredMessage>
  }

  if (!session) {
    return <SignInForm />
  }

  return (
    <MainProcessGate
      session={session}
      onReject={() => supabase.auth.signOut()}
    >
      {children}
    </MainProcessGate>
  )
}

function SignInForm(): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  return (
    <CenteredMessage>
      <div className="w-full max-w-sm rounded-lg border border-[#E5E5E5] bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <img src={diginextLogo} alt="Diginext Scandinavia" className="mx-auto mb-6 h-16 w-auto" />
        <h2 className="mb-6 text-base font-semibold text-[#1D1D1F]">Sign in to Inventory Manager</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-left text-sm font-medium text-[#1D1D1F]">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-8 w-full rounded-md border border-[#D1D1D6] px-3 text-sm transition-colors duration-150 focus:border-[#0066CC] focus:ring-1 focus:ring-[#0066CC] focus:outline-none"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-left text-sm font-medium text-[#1D1D1F]">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-8 w-full rounded-md border border-[#D1D1D6] px-3 text-sm transition-colors duration-150 focus:border-[#0066CC] focus:ring-1 focus:ring-[#0066CC] focus:outline-none"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="h-8 w-full rounded-md bg-[#0066CC] px-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#0052A3] disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </CenteredMessage>
  )
}

function MainProcessGate({
  session,
  onReject,
  children
}: {
  session: Session
  onReject: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const [state, setState] = useState<VerifyState>('pending')

  useEffect(() => {
    let cancelled = false

    async function verify(): Promise<void> {
      setState('pending')
      const verified = await window.api.auth.verifySession(session.access_token)
      if (!cancelled) setState(verified ? 'verified' : 'rejected')
    }

    verify()
    return () => {
      cancelled = true
    }
  }, [session.access_token])

  if (state === 'pending') {
    return <CenteredMessage>Checking your sign-in status...</CenteredMessage>
  }

  if (state === 'rejected') {
    return (
      <CenteredMessage>
        <h2>Access denied</h2>
        <p>Your account isn&apos;t authorized to use this app. Contact your administrator.</p>
        <button
          onClick={onReject}
          className="mt-4 rounded-md bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Sign out
        </button>
      </CenteredMessage>
    )
  }

  return <>{children}</>
}

function CenteredMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="auth-gate">
      <div className="auth-gate__panel">{children}</div>
    </div>
  )
}
