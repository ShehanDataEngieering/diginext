function getAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export async function verifySession(token: string): Promise<boolean> {
  if (!token) return false

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env for session verification.'
    )
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: serviceRoleKey
      }
    })

    console.log('[verifySession] Response status:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.log('[verifySession] Error response:', errorText)
      return false
    }

    const user = (await response.json()) as { email?: string }
    console.log('[verifySession] User email:', user.email)
    const email = user.email?.toLowerCase()

    const allowedEmails = getAllowedEmails()
    console.log('[verifySession] Allowed emails:', allowedEmails)
    console.log('[verifySession] Checking email:', email)
    if (allowedEmails.length === 0) return true

    const result = !!email && allowedEmails.includes(email)
    console.log('[verifySession] Result:', result)
    return result
  } catch (err) {
    console.log('[verifySession] Exception:', err)
    return false
  }
}
