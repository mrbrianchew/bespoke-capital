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

export interface AttentionProduct {
  case_id: string
  premium: number | null
  premium_frequency: string | null
  status: string
  outcome: string | null
}

// Single source of truth for AFYP (Annualized First Year Premium) — used by
// both the New Business board's own metrics strip and the Business
// Dashboard Overview page. Previously duplicated (copy-pasted formula in
// both files); they drifted the moment Brian asked to exclude Postponed
// from one of them but not the other, so this is now the only place the
// definition lives — change it here, both pages pick it up.
//
// Scope: products on cases with no case-level outcome (not Lost/Deferred).
// Excludes products that are withdrawn, or have a product-level outcome of
// 'declined' OR 'postponed' (fix, Aug 2026 — postponed previously still
// counted; Brian confirmed postponed should NOT count toward AFYP, since a
// postponed sale isn't premium you can currently forecast). Monthly
// premiums are annualized ×12; yearly/single taken as-is.
export function calcAfyp(cases: AttentionCase[], productsByCase: Record<string, AttentionProduct[]>): number {
  return cases
    .filter(c => !c.outcome)
    .flatMap(c => productsByCase[c.id] || [])
    .filter(p => p.status !== 'withdrawn' && p.outcome !== 'declined' && p.outcome !== 'postponed')
    .reduce((sum, p) => sum + (p.premium || 0) * (p.premium_frequency === 'monthly' ? 12 : 1), 0)
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

// Firm-wide count for the sidebar badge — same role as
// fetchServiceRequestsAttentionCount / fetchClaimsAttentionCount, but
// matches this pipeline's own "Needs a follow-up" definition (stale AND
// zero open to-dos — see the board's needsFollowupCases) rather than pure
// staleness, plus overdue/today to-dos and meetings. Keeps this count
// consistent with what "This week's follow-ups" actually shows, rather
// than two different numbers for the same idea.
export async function fetchNewBusinessAttentionCount(supabase: any): Promise<number> {
  const { data: caseRows } = await supabase.from('new_business_cases')
    .select('id, stage, stage_changed_at, outcome').is('outcome', null)
  const rows = (caseRows || []) as AttentionCase[]
  if (rows.length === 0) return 0
  const ids = rows.map(r => r.id)
  const [meetingsRes, todosRes] = await Promise.all([
    supabase.from('new_business_case_meetings').select('case_id, meeting_date, is_scheduled').in('case_id', ids).eq('is_scheduled', true).is('outcome', null),
    supabase.from('new_business_case_todos').select('id, case_id, due_date, done').in('case_id', ids).eq('done', false),
  ])
  const meetings = (meetingsRes.data || []) as AttentionMeeting[]
  const todos = (todosRes.data || []) as { id: string; case_id: string; due_date: string | null }[]

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const isUrgentDate = (d: string | null) => {
    if (!d) return false
    const dt = new Date(d + 'T00:00:00')
    return !isNaN(dt.getTime()) && dt.getTime() <= today.getTime()
  }
  const urgentTodos = todos.filter(t => isUrgentDate(t.due_date)).length
  const urgentMeetings = meetings.filter(m => isUrgentDate(m.meeting_date)).length

  const openTodoCaseIds = new Set(todos.map(t => t.case_id))
  const needsFollowup = rows.filter(r => staleLevel(r, meetings) === 'stale' && !openTodoCaseIds.has(r.id)).length

  return urgentTodos + urgentMeetings + needsFollowup
}