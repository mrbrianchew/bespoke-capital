// Loads a client's saved records and turns them into growth points (net worth,
// yearly income, expenses, savings per record). Read-only. Used by the public
// statement route, which passes its service-role client, so only the finished
// numbers ever leave the server, never the raw plan data.

import type { SupabaseClient } from '@supabase/supabase-js'
import { cpfConfigAt, currentMonthStartSG, type HistConfig } from './cpfHistory'
import { growthSeries, type GrowthPoint } from './growth'

export async function loadGrowthPoints(db: SupabaseClient, clientId: string | null | undefined): Promise<GrowthPoint[]> {
  if (!clientId) return []
  const [vers, cli, fam, cfg] = await Promise.all([
    db.from('fact_finding_versions').select('as_at, created_at, data').eq('client_id', clientId).eq('section', 'financials'),
    db.from('clients').select('dob, age').eq('id', clientId).maybeSingle(),
    db.from('family_members').select('relationship, dob, age').eq('client_id', clientId),
    db.from('config').select('value').eq('key', 'cpf_rates').maybeSingle(),
  ])
  if (vers.error || cli.error) throw new Error('growth_load_failed')
  const rows = (vers.data ?? []) as { as_at: string; created_at: string; data: Record<string, unknown> }[]
  const spouse = ((fam.data ?? []) as { relationship: string; dob?: string | null; age?: number | null }[]).find(f => f.relationship === 'Spouse') ?? null
  const live = (cfg.data?.value as HistConfig | undefined) ?? cpfConfigAt(currentMonthStartSG()).config
  return growthSeries(rows, { client: cli.data ?? {}, spouse, liveConfig: live })
}