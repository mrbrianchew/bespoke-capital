import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server-side guard for privileged (service-role) API routes.
 *
 * These routes use SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely,
 * so they MUST verify the caller's identity themselves — the client-side
 * `user.id === CREATOR_ID` check in the UI only hides buttons and provides
 * no protection against a direct POST to the endpoint.
 *
 * Reads the caller's Supabase session from the request cookies and confirms
 * they are the creator. Returns the authenticated user on success, or null.
 *
 * Usage in a route handler:
 *   const creator = await requireCreator()
 *   if (!creator) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 *
 * Env: prefers a server-only CREATOR_ID; falls back to NEXT_PUBLIC_CREATOR_ID
 * (which the app already sets) so this works without any env change. Adding a
 * server-only CREATOR_ID with the same value is recommended but not required —
 * the creator's UUID is not itself a secret (access requires being logged in
 * *as* that user, which requires their password/session).
 */
export async function requireCreator() {
  const creatorId = process.env.CREATOR_ID || process.env.NEXT_PUBLIC_CREATOR_ID
  if (!creatorId) {
    // Fail closed: if no creator is configured, nobody is authorised.
    console.error('[requireCreator] CREATOR_ID is not configured')
    return null
  }

  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
      },
    },
  )

  // getUser() validates the JWT against the Supabase auth server (it does not
  // trust the cookie blindly), so this is a genuine authentication check.
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user || user.id !== creatorId) return null

  return user
}
