import { useEffect, useRef, useState } from 'react'
import { clerk, ensureClerkLoaded } from './clerkClient'

type Status = 'loading' | 'signed-out' | 'verifying' | 'signed-in' | 'rejected'

/**
 * Gates the whole app behind Clerk sign-in. A signed-in Clerk session in the
 * renderer isn't enough on its own — the session token is re-checked by the
 * main process (see src/main/auth/verifySession.ts) before any DB/IPC access
 * is unlocked, so a tampered renderer can't bypass the gate.
 */
export function AuthGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<Status>('loading')
  const signInRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    async function verifyWithMain(): Promise<void> {
      const token = await clerk.session?.getToken()
      if (!token) {
        if (!cancelled) setStatus('signed-out')
        return
      }
      if (!cancelled) setStatus('verifying')
      const verified = await window.api.auth.verifySession(token)
      if (cancelled) return
      setStatus(verified ? 'signed-in' : 'rejected')
    }

    ensureClerkLoaded().then(() => {
      if (cancelled) return
      verifyWithMain()
      clerk.addListener(() => verifyWithMain())
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (status === 'signed-out' && signInRef.current) {
      clerk.mountSignIn(signInRef.current, {
        // Only Google is enabled as a provider in the Clerk dashboard, so this
        // renders a single "Continue with Google" button rather than a full form.
        appearance: { elements: { rootBox: { width: '100%' } } }
      })
      return () => clerk.unmountSignIn(signInRef.current!)
    }
    return undefined
  }, [status])

  if (status === 'loading' || status === 'verifying') {
    return <CenteredMessage>Checking your sign-in status…</CenteredMessage>
  }

  if (status === 'signed-out') {
    return (
      <CenteredMessage>
        <h2>Sign in to Inventory Manager</h2>
        <div ref={signInRef} />
      </CenteredMessage>
    )
  }

  if (status === 'rejected') {
    return (
      <CenteredMessage>
        <h2>Access denied</h2>
        <p>Your account isn't authorized to use this app. Contact your administrator.</p>
        <button onClick={() => clerk.signOut()}>Sign out</button>
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
