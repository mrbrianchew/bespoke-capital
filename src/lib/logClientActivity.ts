/**
 * src/lib/logClientActivity.ts
 *
 * One shared write path into the `client_activity` table — the merged
 * notebook that the rebuilt Contact Report page (session 3) reads from.
 *
 * Call this from any place that already saves something meaningful about a
 * client (a meeting, a claim status change, a todo) right after that save
 * succeeds. It never throws — a failed activity log should never block or
 * roll back the real save it's describing, so callers can fire-and-forget
 * or await it, either is safe.
 *
 * `sourceTable` / `sourceId` point back at the row that caused this entry
 * (e.g. 'service_request_meetings' / that row's id) so a future "jump to
 * source" link on an auto-logged entry has somewhere to go. Leave both
 * undefined for entries with no single origin row.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ClientActivityType =
  | 'meeting_f2f'
  | 'meeting_video'
  | 'meeting_phone'
  | 'claim_status'
  | 'policy_milestone'
  | 'todo'
  | 'other'

export interface LogClientActivityInput {
  clientId: string
  advisorId: string
  type: ClientActivityType
  title: string
  description?: string | null
  /** Defaults to today if omitted. */
  date?: string
  sourceTable?: string
  sourceId?: string
}

export async function logClientActivity(
  supabase: SupabaseClient,
  input: LogClientActivityInput,
): Promise<void> {
  try {
    const { error } = await supabase.from('client_activity').insert({
      client_id: input.clientId,
      advisor_id: input.advisorId,
      activity_type: input.type,
      source_type: 'auto',
      source_table: input.sourceTable ?? null,
      source_id: input.sourceId ?? null,
      title: input.title,
      description: input.description ?? null,
      activity_date: input.date ?? new Date().toISOString().slice(0, 10),
    })

    if (error) {
      // Non-fatal by design — see file header. The caller's own save has
      // already succeeded by the time this runs; losing the notebook copy
      // is a display gap, not a data-loss bug.
      console.warn('[logClientActivity] insert failed:', error.message)
    }
  } catch (err) {
    console.warn('[logClientActivity] unexpected error:', err)
  }
}
