import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

// Called from DashboardProvider (see checkAuth in DashboardContext.tsx) at
// most once per 24h per advisor, to answer "is this advisor actually using
// the app" for the Admin Hub — distinct from auth.users.last_sign_in_at,
// which only reflects login and can stay stale for weeks under a persisted
// session. Fire-and-forget from the client; failure here should never block
// dashboard rendering.
//
// Uses the caller's own session (not service role) — the "advisors_own" RLS
// policy (auth.uid() = id) already scopes this to the advisor's own row, so
// there is nothing here for a signed-in advisor to escalate.
export async function POST() {
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

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error: updateErr } = await supabase
    .from('advisors')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', user.id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
  return NextResponse.json({ success: true })
}