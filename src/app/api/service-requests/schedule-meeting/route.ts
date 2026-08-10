import { NextRequest, NextResponse } from 'next/server'

// Calendar sync is NOT built yet — Gmail OAuth (gmail_connections table) only
// covers the gmail.readonly scope, not calendar.events. Wiring this up for
// real needs its own OAuth consent flow, same shape as the Gmail build:
// a calendar_connections table, encrypted refresh tokens, a consent screen.
// Until then this returns 501 so the meeting still saves in
// service_request_meetings (is_scheduled: true) with no calendar event id —
// see ServiceRequestExtras.tsx, which treats this as non-fatal.
export async function POST(req: NextRequest) {
  return NextResponse.json({ error: 'Calendar sync is not connected yet.' }, { status: 501 })
}