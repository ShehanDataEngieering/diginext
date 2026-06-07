import { Clerk } from '@clerk/clerk-js'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

if (!publishableKey) {
  throw new Error(
    'VITE_CLERK_PUBLISHABLE_KEY is not set. Copy .env.example to .env and fill in your Clerk keys.'
  )
}

export const clerk = new Clerk(publishableKey)

let loadPromise: Promise<void> | null = null

// Clerk.load() is not idempotent-safe to call from multiple components, so
// every caller awaits this single shared promise instead of calling load() itself.
export function ensureClerkLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = clerk.load()
  }
  return loadPromise
}
