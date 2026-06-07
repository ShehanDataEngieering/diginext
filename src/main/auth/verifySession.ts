import { verifyToken } from '@clerk/backend'

// Re-checks the session JWT against Clerk's servers independently of whatever
// the renderer claims about its own sign-in state — a compromised renderer
// could fake a "signed in" UI, but it can't forge a token that passes this.
//
// The secret key is read lazily (not at module load) because dotenv's config()
// runs at the top of src/main/index.ts, and ES module imports are hoisted
// above it — reading process.env at import time would see an empty value.
export async function verifySession(token: string): Promise<boolean> {
  if (!token) return false

  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) {
    throw new Error(
      'CLERK_SECRET_KEY is not set. Copy .env.example to .env and fill in your Clerk keys.'
    )
  }

  try {
    await verifyToken(token, { secretKey })
    return true
  } catch {
    return false
  }
}
