// Shared "needs attention" scoring for medical claims follow-ups.
//
// Used by:
//  - the sidebar badge (layout.tsx) — its own firm-wide fetch, runs on
//    every page so the count is visible even outside Claims Board / outside
//    Business Dashboard mode entirely
//  - the Claims Board's "This week's follow-ups" tab (business/claims) —
//    reuses data that page already has loaded, no extra fetch
//
// Keeping the definition in one place means the sidebar badge and the
// board's own "Needs a follow-up" bucket can never disagree with each other.

const STALE_DAYS = 14 // matches the idle threshold used elsewhere on the Claims Board — insurers' own settlement window is typically ~14 days

export interface AttentionLineItem {
  id: string
  claim_id: string
  approved: boolean
  rejected: boolean
  submitted_date: string | null
  date_from: string | null
}

export interface AttentionTodo {
  id: string
  line_item_id: string
  due_date: string | null
  done: boolean
}

function daysIdle(item: AttentionLineItem): number | null {
  const iso = item.submitted_date || item.date_from
  if (!iso) return null
  const d = new Date(iso)
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

export function pendingLineItems(items: AttentionLineItem[]): AttentionLineItem[] {
  return items.filter(i => !i.approved && !i.rejected)
}

// Pending line items that are stale AND have zero open (not-done) follow-up
// todos — the "invisible" case: nothing is tracked to chase this, so it
// never shows up in a due-date list at all unless surfaced separately.
export function needsFollowupItems(items: AttentionLineItem[], todos: AttentionTodo[]): AttentionLineItem[] {
  const itemIdsWithOpenTodo = new Set(todos.filter(t => !t.done).map(t => t.line_item_id))
  return pendingLineItems(items).filter(i => {
    const idle = daysIdle(i)
    return idle !== null && idle >= STALE_DAYS && !itemIdsWithOpenTodo.has(i.id)
  })
}

export function urgentTodos(todos: AttentionTodo[]): AttentionTodo[] {
  return todos.filter(isUrgentTodo)
}

export function urgentTodoCount(todos: AttentionTodo[]): number {
  return urgentTodos(todos).length
}

export function attentionCount(items: AttentionLineItem[], todos: AttentionTodo[]): number {
  return urgentTodoCount(todos) + needsFollowupItems(items, todos).length
}

// Firm-wide fetch for contexts that don't already have claims data loaded
// (the sidebar renders on every page). RLS on both tables scopes through
// clients.advisor_id, so a plain select already returns only this advisor's
// rows — no service-role route needed, same pattern as the Claims Board's
// own firm-wide load.
export async function fetchClaimsAttentionCount(supabase: any): Promise<number> {
  const { data: items } = await supabase.from('claim_line_items')
    .select('id, claim_id, approved, rejected, submitted_date, date_from')
    .eq('approved', false).eq('rejected', false)
  const pending = (items || []) as AttentionLineItem[]
  if (pending.length === 0) return 0
  const ids = pending.map(i => i.id)
  const { data: todos } = await supabase.from('claim_followup_todos')
    .select('id, line_item_id, due_date, done')
    .in('line_item_id', ids).eq('done', false)
  return attentionCount(pending, (todos || []) as AttentionTodo[])
}