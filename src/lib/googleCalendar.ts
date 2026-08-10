/**
 * Server-only helpers for Calendar event creation (Service Request
 * "Schedule meeting"). Every function here runs in an API route, never in
 * client code — the client never sees an access token, a refresh token, or
 * a client secret.
 *
 * The token-exchange functions (exchangeCodeForTokens / refreshAccessToken /
 * revokeGoogleToken) are near-identical to the ones in googleGmail.ts —
 * that's deliberate duplication, not an oversight. Both features share the
 * same Google OAuth client (NEXT_PUBLIC_GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
 * but this file exists separately so the working Gmail integration is never
 * touched by a Calendar-only change, and vice versa.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

function credentials() {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth client is not configured (NEXT_PUBLIC_GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)')
  }
  return { clientId, clientSecret }
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = credentials()
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const { clientId, clientSecret } = credentials()
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// Best-effort, same as Gmail's — local row is deleted regardless of whether
// this call succeeds, so a disconnect never gets "stuck" on a flaky network.
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    })
  } catch (e) {
    console.error('[googleCalendar] revoke call failed (non-fatal)', e)
  }
}

export async function getCalendarProfile(accessToken: string): Promise<{ email: string }> {
  // NOT calendars/primary — that's a Calendars-resource read, which the
  // calendar.events scope does not cover (events-only), and was throwing a
  // 403 here that surfaced to the advisor as a generic "something went
  // wrong" on /connect. userinfo is a separate, non-sensitive endpoint that
  // only needs the basic 'email' scope requested alongside calendar.events
  // in /api/calendar/connect — no additional Console consent-screen scope
  // needed for it, unlike calendar.events itself.
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Calendar profile fetch failed: ${res.status}`)
  const data = await res.json()
  return { email: data.email }
}

export interface CreateEventInput {
  title: string
  description?: string | null
  date: string // YYYY-MM-DD
  time?: string | null // HH:MM, 24h — omitted means an all-day event
  durationMinutes?: number // ignored for all-day events; defaults to 30
  location?: string | null // physical address (in-person) or "Phone: <number>" (phone call)
  // Video calls: if videoPlatform is 'google_meet' and no link is supplied,
  // a Meet link is auto-generated via conferenceData and returned as
  // meetLink. For zoom/teams/other, the advisor's own link (if any) is
  // passed straight through as the event location — Calendar renders any
  // URL there as a clickable join link, same as it does for Meet.
  videoPlatform?: 'google_meet' | 'zoom' | 'teams' | 'other' | null
  meetingLink?: string | null
}

export interface CreatedEvent {
  id: string
  htmlLink: string
  meetLink: string | null // only set when a Meet link was auto-generated
}

// Creates a single, non-recurring event on the advisor's primary calendar.
// All-day when no time is given (a plain date, no timezone math needed);
// otherwise a slot of the given duration (default 30 min) starting at the
// given time, in Singapore time — matching every other date/time
// convention already in this app.
export async function createCalendarEvent(accessToken: string, input: CreateEventInput): Promise<CreatedEvent> {
  const body: any = {
    summary: input.title,
    description: input.description || undefined,
  }
  if (input.time) {
    const start = new Date(`${input.date}T${input.time}:00+08:00`)
    const durationMin = input.durationMinutes && input.durationMinutes > 0 ? input.durationMinutes : 30
    const end = new Date(start.getTime() + durationMin * 60000)
    body.start = { dateTime: start.toISOString(), timeZone: 'Asia/Singapore' }
    body.end = { dateTime: end.toISOString(), timeZone: 'Asia/Singapore' }
  } else {
    body.start = { date: input.date }
    // Google's all-day events are exclusive of the end date, so a one-day
    // event's end date must be the day after start, not the same day.
    const endDate = new Date(`${input.date}T00:00:00Z`)
    endDate.setUTCDate(endDate.getUTCDate() + 1)
    body.end = { date: endDate.toISOString().slice(0, 10) }
  }

  // Google Meet: only auto-request a link when the advisor picked Google
  // Meet and didn't already paste one in. requestId just needs to be
  // unique per request — Google dedupes on it if the same request is
  // retried, so a random string per call is fine, no need to persist it.
  const wantsAutoMeet = input.videoPlatform === 'google_meet' && !input.meetingLink
  if (wantsAutoMeet) {
    body.conferenceData = {
      createRequest: { requestId: `bc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    }
  } else if (input.meetingLink) {
    // Zoom / Teams / Other / a manually-pasted Meet link — Calendar treats
    // any URL in `location` as a clickable join link, same rendering Meet
    // gets automatically.
    body.location = input.meetingLink
  } else if (input.location) {
    body.location = input.location
  }

  const url = wantsAutoMeet
    ? `${CALENDAR_API}/calendars/primary/events?conferenceDataVersion=1`
    : `${CALENDAR_API}/calendars/primary/events`

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Calendar event creation failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return { id: data.id, htmlLink: data.htmlLink, meetLink: data.hangoutLink || null }
}

export async function deleteCalendarEvent(accessToken: string, eventId: string): Promise<void> {
  await fetch(`${CALENDAR_API}/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}