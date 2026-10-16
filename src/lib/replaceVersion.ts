import type { SupabaseClient } from '@supabase/supabase-js'

// Overwrites the figures of one saved financials record with the plan as it is now.
// Same steps as Annual Reviews > "Replace with current plan": the record keeps its
// month, kind and note; the old row is put back if the new one cannot be written.
export type ReplaceResult = { ok: true } | { ok: false; message: string }

export async function replaceVersionWithPlan(
  db: SupabaseClient,
  clientId: string,
  versionId: string,
  userId?: string,
): Promise<ReplaceResult> {
  const [{ data: ffRow, error: fErr }, { data: old, error: rErr }] = await Promise.all([
    db.from('fact_finding').select('data').eq('client_id', clientId).eq('section', 'financials').maybeSingle(),
    db.from('fact_finding_versions')
      .select('client_id, section, as_at, kind, note, data, created_by')
      .eq('id', versionId).eq('client_id', clientId).single(),
  ])
  if (fErr || rErr || !ffRow?.data || !old) return { ok: false, message: 'Could not read the plan or the record. Nothing was changed.' }

  const { data: del, error: delErr } = await db.from('fact_finding_versions').delete().eq('id', versionId).select('id')
  if (delErr || !del || del.length === 0) {
    return { ok: false, message: delErr ? 'Could not replace. Nothing was changed.' : 'Delete is not switched on yet. Run the delete SQL in Supabase once, then try again.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { client_id: _omit, ...planData } = ffRow.data as Record<string, unknown>
  const { error: insErr } = await db.from('fact_finding_versions').insert({
    client_id: old.client_id, section: old.section, as_at: old.as_at, kind: old.kind, note: old.note,
    data: JSON.parse(JSON.stringify(planData)), created_by: userId || old.created_by,
  })
  if (insErr) {
    await db.from('fact_finding_versions').insert(old) // put the original back
    return { ok: false, message: 'Could not replace. The original record was restored.' }
  }
  return { ok: true }
}