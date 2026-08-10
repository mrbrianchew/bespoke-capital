// Shared "needs attention" scoring for Service Requests — same shape as
// claimsAttention.ts, now that service_request_todos does carry a due_date
// (it always has — the "no due_date column" note in the old version of
// this file was wrong) and requests have a real idle signal to key off.
//
// "Idle" is days since service_requests.updated_at. That column moves on
// every field edit (status, waiting_on, description, policy, custom
// fields) via patchRow, AND on every Attachment/Meeting/Activity-log
// mutation via ServiceRequestExtras' touchRequest() — so a request stays
// looking "fresh" for as long as an advisor is actually working it,
// even if no to-do or status change happened that day.
//
// Used by:
//  - the sidebar badge (layout.tsx) — its own firm-wide fetch, runs on
//    every page
//  - the Business Board's "This week's follow-ups" tab — reuses data that
//    page already has loaded, no extra fetch

const STALE_DAYS = 14 // same threshold as Claims — keeps the two follow-up systems consistent for an advisor switching between them

export interface AttentionServiceRequest {
  id: string
  status: 'requested' | 'in_progress' | 'done'
  updated_at: string
}

export interface AttentionTodo {
  id: string
  service_request_id: string
  due_date: string | null
  done: boolean
}

function daysIdle(row: AttentionServiceRequest): number | null {
  const d = new Date(row.updated_at)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

function isUrgentTodo(todo: AttentionTodo): boolean {
  if (todo.done || !todo.due_date) return false
  const d = new Date(todo.due_date + 'T00:00:00')
  if (isNaN(d.getTime())) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return d.getTime() <= today.getTime()
}

export function openServiceRequests(rows: AttentionServiceRequest[]): AttentionServiceRequest[] {
  return rows.filter(r => r.status !== 'done')
}

// Open requests that are stale AND have zero open (not-done) to-dos tracking
// them — the "invisible" case: nothing is set to chase this, so it never
// shows up in a due-date list at all unless surfaced separately. Mirrors
// needsFollowupItems in claimsAttention.ts exactly.
export function needsFollowupRequests(rows: AttentionServiceRequest[], todos: AttentionTodo[]): AttentionServiceRequest[] {
  const idsWithOpenTodo = new Set(todos.filter(t => !t.done).map(t => t.service_request_id))
  return openServiceRequests(rows).filter(r => {
    const idle = daysIdle(r)
    return idle !== null && idle >= STALE_DAYS && !idsWithOpenTodo.has(r.id)
  })
}

export function urgentTodos(todos: AttentionTodo[]): AttentionTodo[] {
  return todos.filter(isUrgentTodo)
}

export function urgentTodoCount(todos: AttentionTodo[]): number {
  return urgentTodos(todos).length
}

export function attentionCount(rows: AttentionServiceRequest[], todos: AttentionTodo[]): number {
  return urgentTodoCount(todos) + needsFollowupRequests(rows, todos).length
}

// Firm-wide fetch for the sidebar, which renders on every page. RLS on
// service_requests scopes through clients.advisor_id (own_service_requests
// policy), so a plain select with no client_id filter already returns only
// this advisor's own rows — same trust boundary as fetchClaimsAttentionCount.
export async function fetchServiceRequestsAttentionCount(supabase: any): Promise<number> {
  const { data: openRows } = await supabase.from('service_requests')
    .select('id, status, updated_at').neq('status', 'done')
  const rows = (openRows || []) as AttentionServiceRequest[]
  if (rows.length === 0) return 0
  const ids = rows.map(r => r.id)
  const { data: todos } = await supabase.from('service_request_todos')
    .select('id, service_request_id, due_date, done')
    .in('service_request_id', ids).eq('done', false)
  return attentionCount(rows, (todos || []) as AttentionTodo[])
}