/**
 * src/lib/meetingOutcomes.ts
 *
 * A New Business meeting (`new_business_case_meetings`, is_scheduled=true)
 * used to have no way to resolve once its date passed — it just sat in the
 * "Upcoming follow-ups" feed under Overdue forever (see newBusinessAttention.ts
 * comment history / Sept 2026 fix). This gives every scheduled meeting a
 * terminal outcome once it's due:
 *
 *   met        — happened as planned. Terminal, no side effects beyond the flag.
 *   cancelled  — didn't happen and won't be rescheduled here. Terminal;
 *                cancels the synced Calendar event if there was one.
 *   postponed  — didn't happen at the original slot but IS being rescheduled.
 *                Terminal on the OLD row (kept as a historical record of what
 *                was originally booked), and spawns a brand new meeting row
 *                at the new date/time (fresh outcome=null, so it re-enters
 *                the follow-up feed on its own schedule). Old Calendar event
 *                (if any) is cancelled and a new one created for the new slot.
 *
 * Both the follow-up list (dashboard/business/new-business/page.tsx) and the
 * case drawer (components/NewBusinessCaseExtras.tsx) call these two
 * functions rather than each rolling their own — keeps the Calendar sync and
 * client_activity logging behaviour identical in both places.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logClientActivity } from './logClientActivity'

export type MeetingOutcome = 'met' | 'postponed' | 'cancelled'

// Minimal shape needed to resolve/postpone a meeting — a subset of the full
// meeting row so callers with only a partial select (e.g. the follow-up
// list) can still use this without over-fetching everywhere.
export interface ResolvableMeeting {
  id: string
  case_id: string
  title: string
  meeting_type: string
  meeting_time: string | null
  duration_minutes: number
  notes: string | null
  is_scheduled: boolean
  google_calendar_event_id: string | null
  video_platform: string | null
  meeting_link: string | null
  location: string | null
  phone_number: string | null
}

// Fire-and-forget delete of a synced Calendar event — same non-fatal
// convention as deleteMeeting()/saveMeeting() in NewBusinessCaseExtras.tsx.
function cancelCalendarEvent(eventId: string) {
  fetch('/api/service-requests/schedule-meeting', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId }),
  }).catch(() => {})
}

/**
 * Marks a meeting Met or Cancelled. Terminal — no new row created.
 */
export async function setMeetingOutcome(
  supabase: SupabaseClient,
  meeting: Pick<ResolvableMeeting, 'id' | 'google_calendar_event_id'>,
  outcome: 'met' | 'cancelled',
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('new_business_case_meetings')
    .update({ outcome, updated_at: new Date().toISOString() })
    .eq('id', meeting.id)

  if (error) return { error: error.message }

  if (outcome === 'cancelled' && meeting.google_calendar_event_id) {
    cancelCalendarEvent(meeting.google_calendar_event_id)
  }
  return { error: null }
}

/**
 * Marks a meeting Postponed and creates a new meeting row at the given
 * date/time, carrying over title/type/channel/notes. Returns the new row
 * (or an error) so the caller can push it into local state.
 */
export async function postponeMeeting(
  supabase: SupabaseClient,
  meeting: ResolvableMeeting,
  newDate: string,
  newTime: string,
  ctx: { clientId?: string | null; advisorId?: string | null },
): Promise<{ newMeeting: any | null; error: string | null }> {
  // 1. Close out the old row.
  const { error: closeErr } = await supabase
    .from('new_business_case_meetings')
    .update({ outcome: 'postponed', updated_at: new Date().toISOString() })
    .eq('id', meeting.id)
  if (closeErr) return { newMeeting: null, error: closeErr.message }

  // 2. Drop the old Calendar event, if any.
  if (meeting.google_calendar_event_id) {
    cancelCalendarEvent(meeting.google_calendar_event_id)
  }

  // 3. Book a new Calendar event for the new slot, if this meeting type is
  // calendar-synced. Best-effort — a failed booking here shouldn't block
  // the reschedule itself (same non-fatal pattern as saveMeeting()).
  let newCalendarEventId: string | null = null
  let newMeetingLink = meeting.meeting_link
  if (meeting.is_scheduled) {
    try {
      const res = await fetch('/api/service-requests/schedule-meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: meeting.title, date: newDate, time: newTime || null, notes: meeting.notes,
          durationMinutes: meeting.duration_minutes,
          location: meeting.location || (meeting.phone_number ? `Phone: ${meeting.phone_number}` : null),
          videoPlatform: meeting.video_platform,
          meetingLink: meeting.meeting_link,
        }),
      })
      if (res.ok) {
        const d = await res.json()
        newCalendarEventId = d.eventId || null
        if (d.meetLink) newMeetingLink = d.meetLink
      }
    } catch { /* non-fatal — new row still gets created below */ }
  }

  // 4. Insert the new, pending meeting.
  const { data, error: insertErr } = await supabase
    .from('new_business_case_meetings')
    .insert({
      case_id: meeting.case_id, title: meeting.title, meeting_type: meeting.meeting_type,
      meeting_date: newDate, meeting_time: newTime || null, duration_minutes: meeting.duration_minutes,
      notes: meeting.notes, is_scheduled: meeting.is_scheduled, google_calendar_event_id: newCalendarEventId,
      video_platform: meeting.video_platform, meeting_link: newMeetingLink,
      location: meeting.location, phone_number: meeting.phone_number, outcome: null,
    })
    .select()
    .maybeSingle()
  if (insertErr) return { newMeeting: null, error: insertErr.message }

  // 5. Log the rescheduled meeting into the client's activity notebook, same
  // as a freshly-booked meeting would be. The original client_activity
  // entry (for the old slot) is left as-is — a historical record of what
  // was originally booked.
  if (ctx.clientId && ctx.advisorId && data) {
    logClientActivity(supabase, {
      clientId: ctx.clientId,
      advisorId: ctx.advisorId,
      type: meeting.video_platform ? 'meeting_video' : meeting.phone_number ? 'meeting_phone' : 'meeting_f2f',
      title: `${meeting.title} (rescheduled)`,
      description: meeting.notes,
      date: newDate,
      sourceTable: 'new_business_case_meetings',
      sourceId: data.id,
    })
  }

  return { newMeeting: data, error: null }
}