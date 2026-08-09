import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireUser } from '@/lib/requireUser'

// Starts the Gmail OAuth connection. Uses the authorization-code flow with
// access_type=offline + prompt=consent so Google issues a refresh token we
// can use later without the advisor being present (this is deliberately NOT
// the client-side GIS token-client flow used for Drive — that flow never
// yields a refresh token and requires the advisor's browser tab to be open).
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (!clientId || !siteUrl) {
    return NextResponse.json({ error: 'Gmail integration is not configured' }, { status: 500 })
  }

  // CSRF protection: random state, bound to an httpOnly cookie, verified on
  // callback via double-submit comparison. Prevents an attacker from tricking
  // an advisor into completing an OAuth flow that links the attacker's own
  // Gmail account to the advisor's session (state fixation).
  const state = crypto.randomBytes(24).toString('hex')
  const redirectUri = `${siteUrl}/api/gmail/callback`

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.readonly')
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', state)

  const res = NextResponse.redirect(authUrl.toString())
  res.cookies.set('gmail_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return res
}