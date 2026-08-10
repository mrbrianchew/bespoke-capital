import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireUser } from '@/lib/requireUser'

// Starts the Calendar OAuth connection. Same authorization-code flow as
// /api/gmail/connect (access_type=offline + prompt=consent for a refresh
// token) — see that route's comment for why this isn't the client-side GIS
// token-client flow Drive uses.
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (!clientId || !siteUrl) {
    return NextResponse.json({ error: 'Calendar integration is not configured' }, { status: 500 })
  }

  // Same CSRF protection as Gmail's connect route — random state bound to an
  // httpOnly cookie, verified on callback via double-submit comparison.
  const state = crypto.randomBytes(24).toString('hex')
  const redirectUri = `${siteUrl}/api/calendar/callback`

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.events')
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', state)

  const res = NextResponse.redirect(authUrl.toString())
  res.cookies.set('calendar_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return res
}