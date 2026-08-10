// Shared helper for the Servicing History feature — writes and reads against
// the policy_service_history table. Used by both service_requests pages
// (per-client Servicing and the firm-wide Business Board) when a request is
// resolved, and by the Protection page (Variant D row indicator + the
// Servicing History section inside PolicyModal).
//
// Design (per Aug 2026 scoping):
// - Entries are append-only. "Correcting" an entry never edits it — it
//   inserts a new entry with supersedes_id pointing at the original, and
//   flips is_superseded=true on the original. See addCorrection().
// - policy_id is a loose text reference into the `id` field of policy
//   objects living inside fact_finding.data (protection_portfolio,
//   accumulation, etc). There is no FK — fact_finding is JSONB — so this
//   mirrors the same pattern already used by service_requests.policy_id.

export interface PolicyHistoryEntry {
  id: string
  client_id: string
  policy_id: string
  policy_label: string | null
  service_request_id: string | null
  entry_type: 'service_resolution' | 'manual' | 'correction' | 'onboarded'
  description: string
  occurred_at: string
  created_by: string | null
  created_at: string
  supersedes_id: string | null
  correction_reason: string | null
  is_superseded: boolean
}

// Call when a Service Request transitions to status 'done'. No-ops silently
// if the request isn't linked to a policy — most requests aren't (e.g.
// "client asked for a statement copy"), and that's expected, not an error.
export async function logServiceResolution(
  supabase: any,
  request: { id: string; client_id: string; policy_id: string | null; policy_label: string | null; request_type: string; description: string }
): Promise<void> {
  if (!request.policy_id) return
  const description = request.description?.trim()
    ? `${request.request_type} — ${request.description.trim()}`
    : request.request_type
  const { error } = await supabase.from('policy_service_history').insert({
    client_id: request.client_id,
    policy_id: request.policy_id,
    policy_label: request.policy_label,
    service_request_id: request.id,
    entry_type: 'service_resolution',
    description,
  })
  if (error) console.error('Failed to log policy service history:', error.message)
}

// Fetch the latest non-superseded entry per policy_id for a client, keyed by
// policy_id. Used to drive the Variant D row indicator across all policy
// tables (Protection, Wealth Accumulation, etc) in one query.
export async function getLatestHistoryByPolicy(
  supabase: any,
  clientId: string
): Promise<Record<string, PolicyHistoryEntry>> {
  const { data, error } = await supabase
    .from('policy_service_history')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_superseded', false)
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) { console.error('Failed to load policy service history:', error.message); return {} }
  const latest: Record<string, PolicyHistoryEntry> = {}
  for (const row of (data || []) as PolicyHistoryEntry[]) {
    if (!latest[row.policy_id]) latest[row.policy_id] = row
  }
  return latest
}

// Fetch the full history for a single policy (all entries, superseded and
// not), newest first — for the Servicing History section inside PolicyModal.
export async function getHistoryForPolicy(
  supabase: any,
  clientId: string,
  policyId: string
): Promise<PolicyHistoryEntry[]> {
  const { data, error } = await supabase
    .from('policy_service_history')
    .select('*')
    .eq('client_id', clientId)
    .eq('policy_id', policyId)
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) { console.error('Failed to load policy history:', error.message); return [] }
  return (data || []) as PolicyHistoryEntry[]
}

// Adds a correction: inserts a new entry superseding `original`, and flips
// is_superseded on the original. Both writes happen together; if the second
// fails the correction still exists but the original won't show as struck
// through — caller should alert and let the advisor retry.
export async function addCorrection(
  supabase: any,
  original: PolicyHistoryEntry,
  correction: { description: string; reason: string; createdBy: string | null }
): Promise<{ error: string | null }> {
  const { data: inserted, error: insertError } = await supabase
    .from('policy_service_history')
    .insert({
      client_id: original.client_id,
      policy_id: original.policy_id,
      policy_label: original.policy_label,
      service_request_id: original.service_request_id,
      entry_type: 'correction',
      description: correction.description,
      supersedes_id: original.id,
      correction_reason: correction.reason,
      created_by: correction.createdBy,
    })
    .select()
    .maybeSingle()
  if (insertError) return { error: insertError.message }

  const { error: updateError } = await supabase
    .from('policy_service_history')
    .update({ is_superseded: true })
    .eq('id', original.id)
  if (updateError) return { error: updateError.message }

  return { error: null }
}

// Manual entry — for backfilling history that predates this feature, or
// logging a change that didn't come through a Service Request. Freely
// editable/deletable by the advisor, unlike system-generated entries.
export async function addManualEntry(
  supabase: any,
  entry: { clientId: string; policyId: string; policyLabel: string | null; description: string; occurredAt: string; createdBy: string | null }
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('policy_service_history').insert({
    client_id: entry.clientId,
    policy_id: entry.policyId,
    policy_label: entry.policyLabel,
    entry_type: 'manual',
    description: entry.description,
    occurred_at: entry.occurredAt,
    created_by: entry.createdBy,
  })
  return { error: error?.message || null }
}