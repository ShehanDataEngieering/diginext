import { createClerkClient, verifyToken } from '@clerk/backend'

// Belt-and-suspenders access control: Clerk's "Restricted" sign-up mode keeps
// strangers from creating accounts at all, but the email allowlist below is
// what actually decides who gets into *this* app — and it's free (Clerk's own
// allowlist add-on requires a paid plan). Configure it via ALLOWED_EMAILS in
// .env as a comma-separated list, e.g. "alice@example.com,bob@example.com".
// Comparison is case-insensitive since email providers treat case loosely.
function getAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

// Re-checks the session JWT against Clerk's servers independently of whatever
// the renderer claims about its own sign-in state — a compromised renderer
// could fake a "signed in" UI, but it can't forge a token that passes this.
//
// Both secrets are read lazily (not at module load) because dotenv's config()
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
    const claims = await verifyToken(token, { secretKey })

    const allowedEmails = getAllowedEmails()
    if (allowedEmails.length === 0) {
      // No allowlist configured — fall back to "any verified Clerk session is
      // trusted". Misconfiguration-safe default would be to lock everyone out,
      // but that would brick a fresh setup before .env is filled in; instead
      // we rely on Clerk's dashboard restrictions in that case.
      return true
    }

    const clerk = createClerkClient({ secretKey })
    const user = await clerk.users.getUser(claims.sub)
    const email = user.primaryEmailAddress?.emailAddress?.toLowerCase()

    return !!email && allowedEmails.includes(email)
  } catch {
    return false
  }
}
