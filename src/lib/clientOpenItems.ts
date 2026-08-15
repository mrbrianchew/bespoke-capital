// Fetches everything open for ONE client across all three Business
// Dashboard pipelines. Single source of truth (Aug 2026) — used by both
// the Client Everything View page and the Global Quick-Add modal, so the
// two features can't quietly disagree about what "open" means the way the
// AFYP formula did before it was consolidated into calcAfyp().
//
// Claims are addressed at LINE ITEM granularity, not claim granularity —
// claim_followup_todos attaches to line_item_id, not claim_id, so a line
// item is the actual addressable unit for "add a todo here." New Business
// and Service Requests are addressed at case/request granularity — todos
// and meetings both attach directly to case_id / service_request_id.

export interface OpenTodo { id: string; text: string; due_date: string | null }
export interface OpenMeeting { id: string; title: string; meeting_date: string; meeting_time: string | null; is_scheduled: boolean }

export interface ClaimLineItemTarget {
  id: string
  claimId: string
  policyLabel: string
  description: string
  todos: OpenTodo[]
}

export interface NewBusinessCaseTarget {
  id: string
  title: string
  stage: string
  todos: OpenTodo[]
  meetings: OpenMeeting[]
}

export interface ServiceRequestTarget {
  id: string
  requestType: string
  status: string
  todos: OpenTodo[]
  meetings: OpenMeeting[]
}

export interface ClientOpenItems {
  claims: ClaimLineItemTarget[]
  newBusiness: NewBusinessCaseTarget[]
  service: ServiceRequestTarget[]
}

export async function fetchClientOpenItems(supabase: any, clientId: string): Promise<ClientOpenItems> {
  const [claims, newBusiness, service] = await Promise.all([
    fetchClaimTargets(supabase, clientId),
    fetchNewBusinessTargets(supabase, clientId),
    fetchServiceTargets(supabase, clientId),
  ])
  return { claims, newBusiness, service }
}

async function fetchClaimTargets(supabase: any, clientId: string): Promise<ClaimLineItemTarget[]> {
  const { data: claimRows } = await supabase.from('claims').select('id, label, policy_id').eq('client_id', clientId)
  const claims = (claimRows || []) as { id: string; label: string | null; policy_id: string }[]
  if (claims.length === 0) return []
  const claimIds = claims.map(c => c.id)
  const claimById: Record<string, typeof claims[0]> = {}
  claims.forEach(c => { claimById[c.id] = c })

  const { data: itemRows } = await supabase.from('claim_line_items')
    .select('id, claim_id, description').in('claim_id', claimIds).eq('approved', false).eq('rejected', false)
  const items = (itemRows || []) as { id: string; claim_id: string; description: string | null }[]
  if (items.length === 0) return []

  const itemIds = items.map(i => i.id)
  const { data: todoRows } = await supabase.from('claim_followup_todos')
    .select('id, line_item_id, task, due_date').in('line_item_id', itemIds).eq('done', false)
  const todosByItem: Record<string, OpenTodo[]> = {}
  ;(todoRows || []).forEach((t: any) => { (todosByItem[t.line_item_id] ||= []).push({ id: t.id, text: t.task, due_date: t.due_date }) })

  return items.map(i => ({
    id: i.id,
    claimId: i.claim_id,
    policyLabel: claimById[i.claim_id]?.label || claimById[i.claim_id]?.policy_id || 'Claim',
    description: i.description || 'Line item',
    todos: todosByItem[i.id] || [],
  }))
}

async function fetchNewBusinessTargets(supabase: any, clientId: string): Promise<NewBusinessCaseTarget[]> {
  const { data: caseRows } = await supabase.from('new_business_cases')
    .select('id, case_title, stage').eq('client_id', clientId).is('outcome', null)
  const cases = (caseRows || []) as { id: string; case_title: string; stage: string }[]
  if (cases.length === 0) return []
  const caseIds = cases.map(c => c.id)

  const [todosRes, meetingsRes] = await Promise.all([
    supabase.from('new_business_case_todos').select('id, case_id, text, due_date').in('case_id', caseIds).eq('done', false),
    supabase.from('new_business_case_meetings').select('id, case_id, title, meeting_date, meeting_time, is_scheduled').in('case_id', caseIds),
  ])
  const todosByCase: Record<string, OpenTodo[]> = {}
  ;(todosRes.data || []).forEach((t: any) => { (todosByCase[t.case_id] ||= []).push({ id: t.id, text: t.text, due_date: t.due_date }) })
  const meetingsByCase: Record<string, OpenMeeting[]> = {}
  ;(meetingsRes.data || []).forEach((m: any) => { (meetingsByCase[m.case_id] ||= []).push({ id: m.id, title: m.title, meeting_date: m.meeting_date, meeting_time: m.meeting_time, is_scheduled: m.is_scheduled }) })

  return cases.map(c => ({
    id: c.id, title: c.case_title, stage: c.stage,
    todos: todosByCase[c.id] || [], meetings: meetingsByCase[c.id] || [],
  }))
}

async function fetchServiceTargets(supabase: any, clientId: string): Promise<ServiceRequestTarget[]> {
  const { data: srRows } = await supabase.from('service_requests')
    .select('id, request_type, status').eq('client_id', clientId).neq('status', 'done')
  const srs = (srRows || []) as { id: string; request_type: string; status: string }[]
  if (srs.length === 0) return []
  const srIds = srs.map(s => s.id)

  const [todosRes, meetingsRes] = await Promise.all([
    supabase.from('service_request_todos').select('id, service_request_id, text, due_date').in('service_request_id', srIds).eq('done', false),
    supabase.from('service_request_meetings').select('id, service_request_id, title, meeting_date, meeting_time, is_scheduled').in('service_request_id', srIds),
  ])
  const todosByReq: Record<string, OpenTodo[]> = {}
  ;(todosRes.data || []).forEach((t: any) => { (todosByReq[t.service_request_id] ||= []).push({ id: t.id, text: t.text, due_date: t.due_date }) })
  const meetingsByReq: Record<string, OpenMeeting[]> = {}
  ;(meetingsRes.data || []).forEach((m: any) => { (meetingsByReq[m.service_request_id] ||= []).push({ id: m.id, title: m.title, meeting_date: m.meeting_date, meeting_time: m.meeting_time, is_scheduled: m.is_scheduled }) })

  return srs.map(s => ({
    id: s.id, requestType: s.request_type, status: s.status,
    todos: todosByReq[s.id] || [], meetings: meetingsByReq[s.id] || [],
  }))
}