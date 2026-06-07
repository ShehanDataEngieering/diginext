import { useEffect, useState } from 'react'
import { ClerkProvider, SignedIn, SignedOut, SignIn, useAuth } from '@clerk/clerk-react'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!publishableKey) {
  throw new Error(
    'VITE_CLERK_PUBLISHABLE_KEY is not set. Copy .env.example to .env and fill in your Clerk keys.'
  )
}

/**
 * Gates the whole app behind Clerk sign-in. <ClerkProvider> renders its
 * Google-only <SignIn> UI when signed out; once Clerk reports a session,
 * MainProcessGate re-checks that session's JWT with the main process (see
 * src/main/auth/verifySession.ts) before unlocking the app — a tampered
 * renderer can fake "signed in" locally, but it can't forge a token that
 * passes independent verification there.
 */
export function AuthGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <SignedOut>
        <CenteredMessage>
          <h2>Sign in to Inventory Manager</h2>
          <SignIn />
        </CenteredMessage>
      </SignedOut>
      <SignedIn>
        <MainProcessGate>{children}</MainProcessGate>
      </SignedIn>
    </ClerkProvider>
  )
}

type VerifyState = 'pending' | 'verified' | 'rejected'

function MainProcessGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { getToken, signOut } = useAuth()
  const [state, setState] = useState<VerifyState>('pending')

  useEffect(() => {
    let cancelled = false

    async function verify(): Promise<void> {
      setState('pending')
      const token = await getToken()
      const verified = token ? await window.api.auth.verifySession(token) : false
      if (!cancelled) setState(verified ? 'verified' : 'rejected')
    }

    verify()
    return () => {
      cancelled = true
    }
  }, [getToken])

  if (state === 'pending') {
    return <CenteredMessage>Checking your sign-in status…</CenteredMessage>
  }

  if (state === 'rejected') {
    return (
      <CenteredMessage>
        <h2>Access denied</h2>
        <p>Your account isn&apos;t authorized to use this app. Contact your administrator.</p>
        <button onClick={() => signOut()}>Sign out</button>
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
