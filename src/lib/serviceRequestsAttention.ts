// Shared "needs attention" count for Service Requests — the sidebar badge.
//
// Simpler than claimsAttention.ts: service_request_todos has no due_date
// column (unlike claim_followup_todos), so there's no overdue/due-today
// distinction to make here. The count is just "how many requests aren't
// done yet" — everything in Requested or In Progress. That's deliberately
// blunt for v1; if a stale/idle threshold turns out to be wanted later,
// this is the one place to add it.

export interface AttentionServiceRequest {
  id: string
  status: 'requested' | 'in_progress' | 'done'
}

export function openServiceRequests(rows: AttentionServiceRequest[]): AttentionServiceRequest[] {
  return rows.filter(r => r.status !== 'done')
}

export function serviceRequestsAttentionCount(rows: AttentionServiceRequest[]): number {
  return openServiceRequests(rows).length
}

// Firm-wide fetch for the sidebar, which renders on every page. RLS on
// service_requests scopes through clients.advisor_id (own_service_requests
// policy), so a plain select with no client_id filter already returns only
// this advisor's own rows — same trust boundary as fetchClaimsAttentionCount.
export async function fetchServiceRequestsAttentionCount(supabase: any): Promise<number> {
  const { data } = await supabase.from('service_requests').select('id, status').neq('status', 'done')
  return ((data || []) as AttentionServiceRequest[]).length
}