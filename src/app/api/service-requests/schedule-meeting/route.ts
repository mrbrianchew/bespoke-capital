import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/requireUser'
import { decryptToken } from '@/lib/tokenCrypto'
import { refreshAccessToken, createCalendarEvent, deleteCalendarEvent } from '@/lib/googleCalendar'

// Looks up the calling advisor's own calendar_connections row (never anyone
// else's — advisor_id is taken from the authenticated session, not from the
// request body), refreshes a short-lived access token from the stored
// refresh token, and creates one event on that advisor's primary calendar.
// Returns 501 (not connected) rather than an error if there's no row yet,
// so ServiceRequestExtras.tsx's existing non-fatal handling — the meeting
// still saves locally either way — continues to work unchanged.
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.title || !body?.date) {
    return NextResponse.json({ error: 'title and date are required' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: row } = await supabase
    .from('calendar_connections')
    .select('encrypted_refresh_token')
    .eq('advisor_id', user.id)
    .maybeSingle()

  if (!row?.encrypted_refresh_token) {
    return NextResponse.json({ error: 'Calendar is not connected yet.' }, { status: 501 })
  }

  try {
    const refreshToken = decryptToken(row.encrypted_refresh_token)
    const { access_token } = await refreshAccessToken(refreshToken)
    const event = await createCalendarEvent(access_token, {
      title: body.title,
      description: body.notes || undefined,
      date: body.date,
      time: body.time || null,
    })
    return NextResponse.json({ eventId: event.id, htmlLink: event.htmlLink })
  } catch (e: any) {
    console.error('[schedule-meeting]', e?.message || e)
    return NextResponse.json({ error: 'Could not create the calendar event.' }, { status: 500 })
  }
}

// Cleans up the calendar-side event when a scheduled meeting is deleted from
// the app, so deleting here doesn't leave an orphaned event sitting on the
// advisor's actual calendar. Best-effort — if the advisor has since
// disconnected Calendar, or the event was already removed on the Google
// side, this silently succeeds from the app's perspective either way; the
// local meeting row is what the person is trying to delete, not the event.
export async function DELETE(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.eventId) return NextResponse.json({ success: true }) // nothing to clean up

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: row } = await supabase
    .from('calendar_connections')
    .select('encrypted_refresh_token')
    .eq('advisor_id', user.id)
    .maybeSingle()

  if (row?.encrypted_refresh_token) {
    try {
      const refreshToken = decryptToken(row.encrypted_refresh_token)
      const { access_token } = await refreshAccessToken(refreshToken)
      await deleteCalendarEvent(access_token, body.eventId)
    } catch (e) {
      console.error('[schedule-meeting DELETE] cleanup failed (non-fatal)', e)
    }
  }
  return NextResponse.json({ success: true })
}