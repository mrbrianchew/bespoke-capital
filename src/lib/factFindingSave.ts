import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Safely writes a fact_finding section row, resistant to concurrent
 * autosaves from other tabs or pages editing the same client.
 *
 * fact_finding stores one row per (client_id, section), with `data` as a
 * JSONB blob. Some sections are written from more than one page — e.g.
 * both the Protection tab and the Objectives tab write to
 * `protection_portfolio`, each touching a different nested field
 * (statusOverrides vs. policies). The naive pattern of "read the row,
 * merge in memory, write it back" silently loses data in that situation:
 * if two saves race, whichever writes last overwrites the other's edit
 * with a stale copy that never saw it.
 *
 * This uses optimistic concurrency instead: it reads the row's current
 * `updated_at`, and the write only takes effect if `updated_at` hasn't
 * changed since the read. If someone else wrote in between, it re-reads
 * the now-current data, re-applies `patch` to that fresh copy, and
 * retries — folding in the other write instead of discarding it.
 *
 * @param patch  Pure function: (existingSectionData) => newSectionData.
 *               Must derive its result entirely from the argument it's
 *               given, not from state captured before this call, or the
 *               retry-on-conflict behaviour above can't do its job.
 */
export async function saveFactFindingSection(
  supabase: SupabaseClient,
  clientId: string,
  section: string,
  patch: (existing: any) => any,
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data: row, error: readError } = await supabase
      .from('fact_finding')
      .select('data, updated_at')
      .eq('client_id', clientId)
      .eq('section', section)
      .maybeSingle()
    if (readError) throw readError

    const newData = patch(row?.data ?? {})
    const nowIso = new Date().toISOString()

    if (!row) {
      // No row yet — insert. If a concurrent save beat us to creating it,
      // the unique (client_id, section) constraint rejects this insert
      // and we loop around to retry as an update against what now exists.
      const { error } = await supabase
        .from('fact_finding')
        .insert({ client_id: clientId, section, data: newData, updated_at: nowIso })
      if (!error) return
      if (!isUniqueViolation(error)) throw error
      continue
    }

    // Row exists — only apply the update if it still has the updated_at
    // we just read. If another writer changed it in between, this matches
    // zero rows and we loop around to re-read + re-patch + retry.
    let query = supabase
      .from('fact_finding')
      .update({ data: newData, updated_at: nowIso })
      .eq('client_id', clientId)
      .eq('section', section)
    query = row.updated_at ? query.eq('updated_at', row.updated_at) : query.is('updated_at', null)

    const { data: updated, error } = await query.select('id')
    if (error) throw error
    if (updated && updated.length > 0) return
    // else: conflict — loop and retry against fresh data
  }
  throw new Error(`saveFactFindingSection: conflict retry exhausted for section "${section}"`)
}

function isUniqueViolation(error: any): boolean {
  return error?.code === '23505'
}
