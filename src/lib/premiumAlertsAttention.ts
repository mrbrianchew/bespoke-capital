// Sidebar badge count for the Premium Alerts nav item. Same shape/pattern as
// claimsAttention.ts / serviceRequestsAttention.ts. Unlike those, "needs
// attention" for a premium alert isn't idle-days-since-update — it's simply
// whether its premium_due_date has arrived. Counts Overdue + Due Today only
// (not "This Week") to keep the badge meaning "needs action now", matching
// the Claims/Service Requests badges' urgency bar.

const PREMIUM_TYPES = ['Insurance Premium Reminder', 'Investment Premium Reminder']

export interface AttentionPremiumRow {
  id: string
  status: 'requested' | 'in_progress' | 'done'
  field_values: Record<string, string> | null
}

function isOverdueOrDueToday(dueDateStr: string | null | undefined): boolean {
  if (!dueDateStr) return false
  const d = new Date(dueDateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return d.getTime() <= today.getTime()
}

export function urgentPremiumAlerts(rows: AttentionPremiumRow[]): AttentionPremiumRow[] {
  return rows.filter(r => r.status !== 'done' && isOverdueOrDueToday(r.field_values?.premium_due_date))
}

// Firm-wide fetch for the sidebar. Same RLS trust boundary as
// fetchServiceRequestsAttentionCount — a plain select already scopes to this
// advisor's own clients via service_requests' own_service_requests policy.
export async function fetchPremiumAlertsAttentionCount(supabase: any): Promise<number> {
  const { data } = await supabase.from('service_requests')
    .select('id, status, field_values')
    .in('request_type', PREMIUM_TYPES)
    .neq('status', 'done')
  const rows = (data || []) as AttentionPremiumRow[]
  return urgentPremiumAlerts(rows).length
}