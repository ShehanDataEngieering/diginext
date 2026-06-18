/**
 * Integration test for user management against the real Supabase Auth Admin
 * API. Creates a throwaway user, verifies it lists, then deletes it — fully
 * self-cleaning, so it leaves no account behind.
 *
 * Run: npx tsx test/integration/userManagement.ts   (from the project root)
 */
import 'dotenv/config'
import {
  listUsers,
  createUser,
  deleteUser,
  setUserPassword,
  setUserDisabled
} from '../../src/main/auth/userManagement'
import { verifySession, isAdmin, adminEmails } from '../../src/main/auth/verifySession'

let passed = 0
let failed = 0
const failures: string[] = []
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { failed++; failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? ` — ${detail}` : ''}`) }
}
function eq(label: string, actual: unknown, expected: unknown): void {
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
async function expectThrow(label: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); check(label, false, 'expected an error') } catch { check(label, true) }
}

async function main(): Promise<void> {
  const testEmail = `diginext-test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`
  let createdId: string | null = null

  try {
    console.log('Auth helpers — reject paths & admin config')
    eq('verifySession rejects empty token', await verifySession(''), false)
    eq('isAdmin rejects empty token', await isAdmin(''), false)
    check('adminEmails resolves a non-empty admin list', adminEmails().length > 0,
      'set ADMIN_EMAILS (or ALLOWED_EMAILS) in .env')

    console.log('\nUser management — create / list / delete round-trip (Supabase Admin API)')
    const before = await listUsers()
    check('listUsers returns an array', Array.isArray(before))

    const created = await createUser(testEmail, 'temp-Password-123')
    createdId = created.id
    eq('createUser returns the new email', created.email, testEmail)
    check('new user has an id', !!created.id)

    const after = await listUsers()
    check('created user appears in the list', after.some((u) => u.id === createdId))

    await expectThrow('duplicate email rejected', () => createUser(testEmail, 'temp-Password-123'))
    await expectThrow('short password rejected', () => createUser(`x-${testEmail}`, 'short'))

    console.log('\nPassword reset & disable/enable (Supabase Admin API)')
    const reset = await setUserPassword(createdId, 'new-Password-456')
    eq('setUserPassword returns the same user', reset.id, createdId)
    await expectThrow('short reset password rejected', () => setUserPassword(createdId!, 'short'))

    const disabled = await setUserDisabled(createdId, true)
    eq('disabled user reports disabled = true', disabled.disabled, true)
    const stillDisabled = (await listUsers()).find((u) => u.id === createdId)
    eq('disabled state persists in the list', stillDisabled?.disabled, true)

    const enabled = await setUserDisabled(createdId, false)
    eq('re-enabled user reports disabled = false', enabled.disabled, false)

    await deleteUser(createdId)
    createdId = null
    const afterDelete = await listUsers()
    check('deleted user is gone from the list', !afterDelete.some((u) => u.email === testEmail))
  } finally {
    if (createdId) { try { await deleteUser(createdId) } catch { /* best effort cleanup */ } }
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`\x1b[1m${passed} passed, ${failed} failed\x1b[0m`)
  if (failed > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  • ${f}`)
    process.exit(1)
  }
  console.log('User management verified.')
}

main().catch((err) => { console.error('\nTest run crashed:', err); process.exit(1) })
