import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { requireUser } from '@/lib/requireUser'
import { encryptToken } from '@/lib/tokenCrypto'
import { exchangeCodeForTokens, getGmailProfile } from '@/lib/googleGmail'

export async function GET(req: Request) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''
  const profileUrl = `${siteUrl}/dashboard/profile`

  const user = await requireUser()
  if (!user) return NextResponse.redirect(`${profileUrl}?gmail=unauthorized`)

  const url = new URL(req.url)
  const oauthError = url.searchParams.get('error')
  if (oauthError) return NextResponse.redirect(`${profileUrl}?gmail=denied`)

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieStore = cookies()
  const expectedState = cookieStore.get('gmail_oauth_state')?.value

  // Reject if state is missing, absent from the cookie, or doesn't match —
  // this is the CSRF check described in /api/gmail/connect.
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${profileUrl}?gmail=invalid_state`)
  }

  try {
    const redirectUri = `${siteUrl}/api/gmail/callback`
    const tokens = await exchangeCodeForTokens(code, redirectUri)

    if (!tokens.refresh_token) {
      // Google omits refresh_token on repeat consent in some edge cases.
      // /connect always sends prompt=consent specifically to avoid this, so
      // treat it as a hard failure rather than silently storing a connection
      // that can never actually be used to search.
      return NextResponse.redirect(`${profileUrl}?gmail=no_refresh_token`)
    }

    const profile = await getGmailProfile(tokens.access_token)
    const encrypted = encryptToken(tokens.refresh_token)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { error: dbErr } = await supabase.from('gmail_connections').upsert({
      advisor_id: user.id,
      gmail_email: profile.emailAddress,
      encrypted_refresh_token: encrypted,
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    })
    if (dbErr) throw new Error(dbErr.message)

    const res = NextResponse.redirect(`${profileUrl}?gmail=connected`)
    res.cookies.set('gmail_oauth_state', '', { maxAge: 0, path: '/' })
    return res
  } catch (e: any) {
    console.error('[gmail/callback]', e?.message || e)
    return NextResponse.redirect(`${profileUrl}?gmail=error`)
  }
}