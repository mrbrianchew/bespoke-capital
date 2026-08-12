// Shared staleness scoring for the New Business Pipeline — same shape as
// serviceRequestsAttention.ts / claimsAttention.ts, but with a per-stage
// threshold rather than one flat number. Consideration and Outreach are
// where cases actually die from neglect (client lag / uncontacted referral),
// so both get a tighter window than Fact-Find/Planning/Processing, where the
// advisor or the insurer — not silence — is the bottleneck.
//
// A case with an upcoming scheduled meeting is never "stale" regardless of
// days-in-stage: a booked meeting means the client IS engaged, the clock
// just hasn't caught up yet. This is a deliberate product decision (Brian,
// Aug 2026), not an oversight — do not "fix" it back to pure date math.

export type Stage =
  | 'outreach' | 'fact_find' | 'planning' | 'presentation'
  | 'consideration' | 'implementation' | 'processing' | 'completed'

export const STAGES: { key: Stage; label: string }[] = [
  { key: 'outreach', label: 'Outreach' },
  { key: 'fact_find', label: 'Fact-Find' },
  { key: 'planning', label: 'Planning' },
  { key: 'presentation', label: 'Presentation' },
  { key: 'consideration', label: 'Consideration' },
  { key: 'implementation', label: 'Implementation' },
  { key: 'processing', label: 'Processing' },
  { key: 'completed', label: 'Completed' },
]

export const IDLE_THRESHOLD_DAYS: Record<Stage, number | null> = {
  outreach: 3,       // uncontacted referral/lead — decays fast
  fact_find: 14,
  planning: 14,
  presentation: 7,
  consideration: 3,  // pure client-side lag — the highest silent-death risk
  implementation: 7,
  processing: 14,     // insurer-side wait, advisor is chasing not driving
  completed: null,   // terminal, no staleness
}

export interface AttentionCase {
  id: string
  stage: Stage
  stage_changed_at: string
  outcome: 'lost' | 'deferred' | null
}

export interface AttentionMeeting {
  case_id: string
  meeting_date: string
  is_scheduled: boolean
}

export function daysInStage(row: AttentionCase): number {
  const d = new Date(row.stage_changed_at)
  if (isNaN(d.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}

export function hasUpcomingMeeting(caseId: string, meetings: AttentionMeeting[]): AttentionMeeting | null {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const upcoming = meetings
    .filter(m => m.case_id === caseId && m.is_scheduled && new Date(m.meeting_date + 'T00:00:00').getTime() >= today.getTime())
    .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))
  return upcoming[0] || null
}

export type StaleLevel = 'ok' | 'warn' | 'stale' | 'meeting'

export function staleLevel(row: AttentionCase, meetings: AttentionMeeting[]): StaleLevel {
  if (row.outcome) return 'ok' // Lost/Deferred cases aren't scored for staleness
  if (hasUpcomingMeeting(row.id, meetings)) return 'meeting'
  const threshold = IDLE_THRESHOLD_DAYS[row.stage]
  if (threshold === null) return 'ok'
  const days = daysInStage(row)
  if (days >= threshold) return 'stale'
  if (days >= Math.ceil(threshold * 0.6)) return 'warn'
  return 'ok'
}

// Firm-wide count of active (no outcome) cases sitting stale — for the
// sidebar badge and the metrics strip, same role as
// fetchServiceRequestsAttentionCount / fetchClaimsAttentionCount.
export async function fetchNewBusinessAttentionCount(supabase: any): Promise<number> {
  const { data: caseRows } = await supabase.from('new_business_cases')
    .select('id, stage, stage_changed_at, outcome').is('outcome', null)
  const rows = (caseRows || []) as AttentionCase[]
  if (rows.length === 0) return 0
  const ids = rows.map(r => r.id)
  const { data: meetingRows } = await supabase.from('new_business_case_meetings')
    .select('case_id, meeting_date, is_scheduled').in('case_id', ids).eq('is_scheduled', true)
  const meetings = (meetingRows || []) as AttentionMeeting[]
  return rows.filter(r => staleLevel(r, meetings) === 'stale').length
}