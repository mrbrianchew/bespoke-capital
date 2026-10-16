// "Before you submit" numbers for the public statement page. Server-side only.
// Takes the form as it stands now, lays it over the live plan (same mapping as the
// advisor's Apply), and compares it with the last saved record from an EARLIER month.
// Only finished numbers leave the server: never the plan, the records or the advisor's
// questions. Read-only: nothing here writes.

import type { SupabaseClient } from '@supabase/supabase-js'
import { cpfConfigAt, currentMonthStartSG, type HistConfig } from './cpfHistory'
import { BUFFER_MONTHS, durationText, reviewInsights, snapshot } from './reviewInsights'
import { buildApplyPatch, normalizeData, type SectionId } from './statementApply'
import type { Person } from './statementPrefill'
import type { StatementData } from './statementFields'

export interface ClientInsights {
  /** 'YYYY-MM-01' of the last saved record. */
  sinceAsAt: string
  sinceText: string
  /** Bank cash the cashflow suggests, and what the form says now. */
  expectedCash: number
  cash: number
  /** expected - now. Positive = less in the bank than expected. */
  gap: number
  income: number
  spending: number
  incomeGrowthPa: number | null
  spendGrowthPa: number | null
  /** Null when either side can't separate regular savings (simple expense mode). */
  savingsRateWas: number | null
  savingsRateNow: number | null
  monthsOfCash: number
  bufferMonths: number
}

const SECTIONS: SectionId[] = ['income', 'expenses', 'assets', 'properties', 'liabilities']
type Rec = Record<string, unknown>

/** The live plan with this person's form laid over it. Pure. */
export function planWithStatement(live: Rec, data: StatementData, person: Person, baseline: StatementData | null): Rec {
  const plan: Rec = { ...live }
  const key = person === 'client' ? 'person1' : 'person2'
  for (const section of SECTIONS) {
    const patch = buildApplyPatch(section, data, person, plan, baseline)
    Object.assign(plan, patch.fields)
    if (patch.personKey) plan[key] = { ...((plan[key] as Rec) || {}), ...patch.personFields }
  }
  return plan
}

export async function loadStatementInsights(
  db: SupabaseClient,
  clientId: string | null | undefined,
  person: Person,
  rawData: unknown,
  rawBaseline: unknown,
): Promise<ClientInsights | null> {
  if (!clientId) return null
  const [vers, ff, cli, fam, cfg] = await Promise.all([
    db.from('fact_finding_versions').select('as_at, created_at, data').eq('client_id', clientId).eq('section', 'financials'),
    db.from('fact_finding').select('data').eq('client_id', clientId).eq('section', 'financials').maybeSingle(),
    db.from('clients').select('dob, age').eq('id', clientId).maybeSingle(),
    db.from('family_members').select('relationship, dob, age').eq('client_id', clientId),
    db.from('config').select('value').eq('key', 'cpf_rates').maybeSingle(),
  ])
  if (vers.error || cli.error || ff.error) throw new Error('insights_load_failed')
  const live = ff.data?.data as Rec | undefined
  if (!live) return null

  const thisMonth = currentMonthStartSG()
  const byMonth = new Map<string, { as_at: string; created_at: string; data: Rec }>()
  for (const r of (vers.data ?? []) as { as_at: string; created_at: string; data: Rec }[]) {
    if (r.as_at >= thisMonth) continue
    const cur = byMonth.get(r.as_at)
    if (!cur || r.created_at >= cur.created_at) byMonth.set(r.as_at, r)
  }
  const last = Array.from(byMonth.values()).sort((a, b) => a.as_at.localeCompare(b.as_at)).pop()
  if (!last) return null

  const spouse = ((fam.data ?? []) as { relationship: string; dob?: string | null; age?: number | null }[]).find(f => f.relationship === 'Spouse') ?? null
  const base = {
    client: cli.data ?? {}, spouse,
    liveConfig: (cfg.data?.value as HistConfig | undefined) ?? cpfConfigAt(thisMonth).config,
  }
  const baseline = rawBaseline && typeof rawBaseline === 'object' ? normalizeData(rawBaseline) : null
  const plan = planWithStatement(live, normalizeData(rawData), person, baseline)

  const prev = snapshot({ ...base, asAt: last.as_at, data: last.data })
  const now = snapshot({ ...base, asAt: thisMonth, data: plan })
  const ins = reviewInsights(prev, now)
  if (!ins) return null
  const both = !prev.simple && !now.simple
  return {
    sinceAsAt: last.as_at,
    sinceText: durationText(ins.months),
    expectedCash: Math.round(ins.expectedCash),
    cash: now.cash,
    gap: Math.round(ins.shortfall),
    income: now.income,
    spending: now.spending,
    incomeGrowthPa: ins.incomeGrowthPa,
    spendGrowthPa: ins.spendGrowthPa,
    savingsRateWas: both ? prev.savingsRate : null,
    savingsRateNow: both ? now.savingsRate : null,
    monthsOfCash: ins.monthsOfCash,
    bufferMonths: BUFFER_MONTHS,
  }
}