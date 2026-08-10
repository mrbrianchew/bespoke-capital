import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { requireUser } from '@/lib/requireUser'
import { encryptToken } from '@/lib/tokenCrypto'
import { exchangeCodeForTokens, getCalendarProfile } from '@/lib/googleCalendar'

export async function GET(req: Request) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''
  const profileUrl = `${siteUrl}/dashboard/profile`

  const user = await requireUser()
  if (!user) return NextResponse.redirect(`${profileUrl}?calendar=unauthorized`)

  const url = new URL(req.url)
  const oauthError = url.searchParams.get('error')
  if (oauthError) return NextResponse.redirect(`${profileUrl}?calendar=denied`)

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieStore = cookies()
  const expectedState = cookieStore.get('calendar_oauth_state')?.value

  // Same CSRF check as Gmail's callback.
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${profileUrl}?calendar=invalid_state`)
  }

  try {
    const redirectUri = `${siteUrl}/api/calendar/callback`
    const tokens = await exchangeCodeForTokens(code, redirectUri)

    if (!tokens.refresh_token) {
      return NextResponse.redirect(`${profileUrl}?calendar=no_refresh_token`)
    }

    const profile = await getCalendarProfile(tokens.access_token)
    // Same encryption key/function as Gmail's refresh token — same trust
    // boundary (server-side secret, never touches the browser), no separate
    // secret to provision for Calendar specifically.
    const encrypted = encryptToken(tokens.refresh_token)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { error: dbErr } = await supabase.from('calendar_connections').upsert({
      advisor_id: user.id,
      calendar_email: profile.email,
      encrypted_refresh_token: encrypted,
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    })
    if (dbErr) throw new Error(dbErr.message)

    const res = NextResponse.redirect(`${profileUrl}?calendar=connected`)
    res.cookies.set('calendar_oauth_state', '', { maxAge: 0, path: '/' })
    return res
  } catch (e: any) {
    console.error('[calendar/callback]', e?.message || e)
    return NextResponse.redirect(`${profileUrl}?calendar=error`)
  }
}