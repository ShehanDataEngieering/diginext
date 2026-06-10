import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

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
      <div className="w-full max-w-sm">
        <h2 className="mb-6 text-xl font-semibold text-gray-800">Sign in to Inventory Manager</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-left text-sm text-gray-600">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-left text-sm text-gray-600">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
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
