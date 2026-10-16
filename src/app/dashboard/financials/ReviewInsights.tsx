'use client'

// "Review insights" for the Annual Reviews tab (advisor view).
// Compares the live plan with the last saved record from an EARLIER month: bank cash
// expected vs actual, income and spending growth per year, savings rate, months of
// cash, loans against income, and questions to ask. Read-only: it never writes.
// The numbers come from src/lib/reviewInsights.ts.

import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { cpfConfigAt, currentMonthStartSG, type HistConfig } from '@/lib/cpfHistory'
import { type PersonRef } from '@/lib/growth'
import { BUFFER_MONTHS, durationText, monthsBetween, reviewInsights, snapshot, type Snapshot } from '@/lib/reviewInsights'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const label = (asAt: string) => { const [y, m] = asAt.split('-'); return `${MONTHS[Number(m) - 1]} ${y}` }
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const signedMoney = (n: number) => `${n < 0 ? '-' : '+'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const kay = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}m` : `$${Math.round(v / 1000)}k`)
const k1 = (v: number) => `$${(Math.round(v / 100) / 10).toLocaleString('en-US')}k`
const pc = (v: number) => `${Math.round(v * 100)}%`
const sgn = (v: number | null, dp = 1) => (v === null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`)

const EMERALD = '#2A5E46', GOLD = '#A8834A', ROUGE = '#B04A4A', INK = '#1A1816'
interface Row { id: string; as_at: string; created_at: string; data: Record<string, unknown> }

interface Pt { m: number; v: number }
interface Series { pts: Pt[]; color: string; dash?: string; width?: number }

const CW = 960, CH = 340, PL = 56, PR = 190, PT = 24, PB = 56

function Chart({ series, m0, m1, ticks, children, xLabels }: {
  series: Series[]; m0: number; m1: number; ticks: number[]
  children?: (x: (m: number) => number, y: (v: number) => number) => React.ReactNode
  xLabels: { m: number; text: string }[]
}) {
  const all = series.flatMap(s => s.pts.map(p => p.v))
  const lo = Math.min(...all, ...ticks), hi = Math.max(...all, ...ticks)
  const span = hi - lo || 1
  const x = (m: number) => PL + (m1 === m0 ? 0.5 : (m - m0) / (m1 - m0)) * (CW - PL - PR)
  const y = (v: number) => CH - PB - ((v - lo) / span) * (CH - PB - PT)
  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" role="img" aria-label="Bank cash, expected against actual" style={{ display: 'block' }}>
      {ticks.map(t => (
        <g key={t}><line x1={PL} y1={y(t)} x2={CW - 16} y2={y(t)} stroke="#ECEAE4" />
          <text x={PL - 8} y={y(t) + 4} fontSize={12} fill="#8B867E" textAnchor="end">{kay(t)}</text></g>
      ))}
      <line x1={PL} y1={CH - PB} x2={CW - 16} y2={CH - PB} stroke="#D0CDC5" />
      {series.map((s, i) => (
        <g key={i}>
          <polyline points={s.pts.map(p => `${x(p.m).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.width ?? 3} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
          {s.pts.map((p, j) => <circle key={j} cx={x(p.m)} cy={y(p.v)} r={5} fill="#fff" stroke={s.color} strokeWidth={2.4} />)}
        </g>
      ))}
      {children?.(x, y)}
      {xLabels.map((l, i) => (
        <text key={i} x={x(l.m)} y={CH - PB + 24} fontSize={12} fill="#4A4740" textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}>{l.text}</text>
      ))}
    </svg>
  )
}

export default function ReviewInsights({ clientId, refreshKey, live }: { clientId: string; refreshKey: string; live: Record<string, unknown> | null }) {
  const supabase = useMemo(() => createClient(), [])
  const [ctx, setCtx] = useState<{ rows: Row[]; client: PersonRef; spouse: PersonRef | null; cfg: HistConfig } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let off = false
    async function run() {
      setError('')
      const [vers, cli, fam, cfg] = await Promise.all([
        supabase.from('fact_finding_versions').select('id, as_at, created_at, data').eq('client_id', clientId).eq('section', 'financials'),
        supabase.from('clients').select('dob, age').eq('id', clientId).maybeSingle(),
        supabase.from('family_members').select('relationship, dob, age').eq('client_id', clientId),
        supabase.from('config').select('value').eq('key', 'cpf_rates').maybeSingle(),
      ])
      if (off) return
      if (vers.error || cli.error) { setError('Could not load the review insights. Please refresh the page.'); return }
      const spouse = ((fam.data as { relationship: string; dob?: string | null; age?: number | null }[] | null) ?? []).find(f => f.relationship === 'Spouse') ?? null
      setCtx({
        rows: (vers.data as Row[] | null) ?? [], client: cli.data ?? {}, spouse,
        cfg: (cfg.data?.value as HistConfig | undefined) ?? cpfConfigAt(currentMonthStartSG()).config,
      })
    }
    run().catch(() => { if (!off) setError('Could not load the review insights. Please refresh the page.') })
    return () => { off = true }
  }, [supabase, clientId, refreshKey])

  const view = useMemo(() => {
    if (!ctx || !live) return null
    const thisMonth = currentMonthStartSG()
    const byMonth = new Map<string, Row>()
    for (const r of ctx.rows) {
      if (r.as_at >= thisMonth) continue
      const cur = byMonth.get(r.as_at)
      if (!cur || r.created_at >= cur.created_at) byMonth.set(r.as_at, r)
    }
    const hist = Array.from(byMonth.values()).sort((a, b) => a.as_at.localeCompare(b.as_at))
    if (hist.length === 0) return null
    try {
      const base = { client: ctx.client, spouse: ctx.spouse, liveConfig: ctx.cfg }
      const snaps: Snapshot[] = hist.map(r => snapshot({ ...base, asAt: r.as_at, data: r.data }))
      const now = snapshot({ ...base, asAt: thisMonth, data: live })
      const ins = reviewInsights(snaps[snaps.length - 1], now)
      return ins ? { ins, snaps, now } : null
    } catch { return null }
  }, [ctx, live])

  const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', borderRadius: 14, padding: 20, marginBottom: 14 }
  const lbl: React.CSSProperties = { fontFamily: 'DM Mono, monospace', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8A6C3A' }
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '9px 0', borderTop: '1px solid var(--line)', fontSize: 13.5 }
  const mono: React.CSSProperties = { fontFamily: 'DM Mono, monospace', fontWeight: 500 }
  const h2: React.CSSProperties = { fontFamily: 'Georgia, serif', fontSize: 20, margin: '0 0 8px', fontWeight: 500 }

  if (error) return <div style={card}><div style={lbl}>Review insights</div><div style={{ fontSize: 12, color: ROUGE }}>{error}</div></div>
  if (!view) return null
  const { ins, snaps, now } = view
  const { prev, cur } = ins
  const origin = monthsBetween(snaps[0].asAt, cur.asAt)
  const mOf = (asAt: string) => origin - monthsBetween(asAt, cur.asAt) // months from first record
  const pts = (f: (s: Snapshot) => number): Pt[] => [...snaps.map(s => ({ m: mOf(s.asAt), v: f(s) })), { m: origin, v: f(now) }]
  const xl = [...snaps.map((s, i) => ({ m: mOf(s.asAt), text: i === snaps.length - 1 ? `${label(s.asAt)} · last review` : label(s.asAt) })), { m: origin, text: 'Now' }]
  const thin = xl.length > 4 ? xl.filter((_, i) => i === 0 || i >= xl.length - 2) : xl

  const cashTicks = (() => { const hi = Math.max(ins.expectedCash, cur.cash, ...snaps.map(s => s.cash)); const st = niceStep(hi / 3); return [st, st * 2, st * 3] })()

  const cashAhead = ins.shortfall < 0
  const gapPct = ins.expectedCash > 0 ? Math.round((ins.shortfall / ins.expectedCash) * 100) : 0
  const faster = ins.incomeGrowthPa !== null && ins.spendGrowthPa !== null && ins.incomeGrowthPa > 0 ? ins.spendGrowthPa / ins.incomeGrowthPa : null
  const heading = cashAhead
    ? `Cash is ${money(-ins.shortfall)} ahead of cashflow, and ${ins.monthsOfCash.toFixed(0)} months of spending is in the bank`
    : `Cash is ${money(ins.shortfall)} short of cashflow, and ${ins.monthsOfCash.toFixed(0)} months of spending is in the bank`

  const tile = (name: string, big: React.ReactNode, sub: React.ReactNode) => (
    <div style={{ ...card, marginBottom: 0 }}><div style={lbl}>{name}</div><div style={{ fontFamily: 'Georgia, serif', fontSize: 30, lineHeight: 1.1, margin: '4px 0' }}>{big}</div><div style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink3)' }}>{sub}</div></div>
  )

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={lbl}>Review insights · since {label(prev.asAt)} ({durationText(ins.months)})</div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 26, lineHeight: 1.2, margin: '4px 0 14px' }}>{heading}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 14 }}>
        {tile('Savings rate', pc(cur.savingsRate),
          <>
            <div>Was {pc(prev.savingsRate)} at last review</div>
            {cur.simple || prev.simple
              ? <div>Simple expense mode, so regular savings are not separated.</div>
              : <div style={{ marginTop: 4 }}>
                  Share of income now: <b>{pc(cur.bankShare)}</b> left in the bank + <b>{pc(cur.productsShare)}</b> put into savings plans and investments.
                  Last time: {pc(prev.bankShare)} + {pc(prev.productsShare)}.
                </div>}
          </>)}
        {tile(cashAhead ? 'Cash ahead' : 'Cash gap', <span style={{ color: cashAhead ? EMERALD : ROUGE }}>{signedMoney(-ins.shortfall)}</span>,
          <>expected {money(ins.expectedCash)}, actual {money(cur.cash)}{ins.expectedCash > 0 ? ` (${-gapPct > 0 ? '+' : ''}${-gapPct}%)` : ''}</>)}
        {tile('Months of cash', ins.monthsOfCash.toFixed(1),
          <>{BUFFER_MONTHS} mths = {money(ins.bufferAmount)}. {ins.aboveBuffer >= 0 ? <>Above: <b>{money(ins.aboveBuffer)}</b></> : <>Below by <b>{money(-ins.aboveBuffer)}</b></>}</>)}
        {tile('Loans vs income', pc(ins.loansVsIncome), <>was {pc(ins.prevLoansVsIncome)}. {money(cur.loanRepayments)}/yr cash repayments</>)}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          <h2 style={{ ...h2, margin: 0 }}>Bank cash and yearly cashflow</h2>
          <div style={{ fontSize: 11.5, color: 'var(--ink3)' }}>
            Per year since last review: income <b style={{ color: EMERALD }}>{sgn(ins.incomeGrowthPa)}</b> · spending <b style={{ color: ROUGE }}>{sgn(ins.spendGrowthPa)}</b>
            {faster !== null && faster > 1.2 ? ` · spending is growing ${faster.toFixed(1)}× as fast` : ''}
          </div>
        </div>
        <div>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...lbl, marginBottom: 2 }}>Bank cash: expected vs actual</div>
            <Chart m0={0} m1={origin} ticks={cashTicks} xLabels={thin}
              series={[
                { pts: [{ m: mOf(prev.asAt), v: prev.cash }, { m: origin, v: ins.expectedCash }], color: GOLD, dash: '5 6', width: 2.4 },
                { pts: pts(s => s.cash), color: EMERALD },
              ]}>
              {(x, y) => {
                const hiV = Math.max(ins.expectedCash, cur.cash), loV = Math.min(ins.expectedCash, cur.cash)
                const lab = (v: number) => (v === ins.expectedCash && ins.expectedCash !== cur.cash ? { t: `Expected ${k1(ins.expectedCash)}`, c: '#8A6C3A' } : { t: `Actual ${k1(cur.cash)}`, c: EMERALD })
                const hiL = lab(hiV), loL = hiV === loV ? { t: '', c: EMERALD } : lab(loV)
                const gapRoom = y(loV) - y(hiV) > 40
                return (
                  <>
                    <circle cx={x(origin)} cy={y(ins.expectedCash)} r={5} fill="#fff" stroke={GOLD} strokeWidth={2.4} />
                    <line x1={x(origin) + 14} y1={y(hiV)} x2={x(origin) + 14} y2={y(loV)} stroke={cashAhead ? EMERALD : ROUGE} strokeWidth={2} />
                    <text x={x(origin) + 24} y={y(hiV) + 4} fontSize={13} fontWeight={600} fill={hiL.c}>{hiL.t}</text>
                    {loL.t && <text x={x(origin) + 24} y={y(loV) + 4} fontSize={13} fontWeight={600} fill={loL.c}>{loL.t}</text>}
                    {gapRoom && <text x={x(origin) + 24} y={(y(hiV) + y(loV)) / 2 + 4} fontSize={13} fontWeight={600} fill={cashAhead ? EMERALD : ROUGE}>{cashAhead ? '+' : '-'}{k1(Math.abs(ins.shortfall))}</text>}
                  </>
                )
              }}
            </Chart>
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {([
                { name: 'Income per year', now: cur.income, was: prev.income, pa: ins.incomeGrowthPa, tot: ins.incomeTotalPct, goodUp: true },
                { name: 'Spending per year', now: cur.spending, was: prev.spending, pa: ins.spendGrowthPa, tot: ins.spendTotalPct, goodUp: false },
                { name: 'Left over per year', now: cur.freeCash, was: prev.freeCash, pa: null, tot: prev.freeCash > 0 ? ((cur.freeCash - prev.freeCash) / prev.freeCash) * 100 : null, goodUp: true },
              ] as { name: string; now: number; was: number; pa: number | null; tot: number | null; goodUp: boolean }[]).map(t => {
                const up = t.now >= t.was
                const col = up === t.goodUp ? EMERALD : ROUGE
                return (
                  <div key={t.name} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', background: '#FBFAF7' }}>
                    <div style={lbl}>{t.name}</div>
                    <div style={{ fontFamily: 'Georgia, serif', fontSize: 26, lineHeight: 1.15, margin: '4px 0 6px' }}>{money(t.now)}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>Was <b style={mono}>{money(t.was)}</b> in {label(prev.asAt)}</div>
                    <div style={{ fontSize: 12.5, color: col, marginTop: 2 }}>
                      {t.pa !== null ? <>{sgn(t.pa)} a year</> : <>{signedMoney(t.now - t.was)}</>}
                      {t.tot !== null && <span style={{ color: 'var(--ink3)' }}> · {sgn(t.tot)} in all</span>}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink3)', lineHeight: 1.55, paddingTop: 8 }}>Spending is the whole expenses table. Left over is income less spending, the part that should reach the bank.</div>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 6 }}>Dated points are saved records. &quot;Now&quot; is the live plan.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <div>
          <div style={card}>
            <h2 style={h2}>Cash gap and what else moved</h2>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginBottom: 6 }}>Context only. It does not prove where the money went.</div>
            <div style={row}><span>Expected cash build (average cashflow × {ins.years.toFixed(1)} yrs)</span><b style={mono}>{signedMoney(ins.expectedBuild)}</b></div>
            <div style={row}><span>Actual cash change</span><b style={mono}>{signedMoney(ins.actualChange)}</b></div>
            <div style={row}><span>{cashAhead ? 'Ahead of expected' : 'Short of expected'}</span><b style={{ ...mono, color: cashAhead ? EMERALD : ROUGE }}>{money(Math.abs(ins.shortfall))}</b></div>
            <div style={row}><span>Investments up, beyond regular savings put in</span><b style={mono}>{signedMoney(ins.investBeyondSavings)}</b></div>
            <div style={row}><span>Debts and loans change</span><b style={{ ...mono, color: ins.debtChange <= 0 ? EMERALD : ROUGE }}>{signedMoney(ins.debtChange)}</b></div>
            <div style={{ fontSize: 11.5, color: 'var(--ink3)', lineHeight: 1.55, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
              Regular savings and loan repayments in the expenses table are already taken off the expected build. Investments beyond them can be top-ups or market gains.
            </div>
          </div>
          <div style={card}>
            <h2 style={h2}>Biggest spending increases</h2>
            {ins.increases.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink3)' }}>No line has gone up.</div>}
            {ins.increases.map(i => <div key={i.label} style={row}><span>{i.label}</span><b style={{ ...mono, color: ROUGE }}>{signedMoney(i.change)}</b></div>)}
            <div style={{ fontSize: 11.5, color: 'var(--ink3)', paddingTop: 8, borderTop: '1px solid var(--line)' }}>
              Total {signedMoney(cur.spending - prev.spending)} a year. Income {signedMoney(cur.income - prev.income)}.
            </div>
          </div>
        </div>
        <div>
          <div style={{ ...card, background: '#F5EFE3', borderColor: '#E3D6B8' }}>
            <h2 style={h2}>Questions to ask</h2>
            {ins.questions.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink2)' }}>Nothing stands out. Ask what has changed in their life since {label(prev.asAt)}.</div>}
            {ins.questions.map((q, i) => <div key={i} style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink2)', marginBottom: 8 }}>{i + 1}. {q}</div>)}
            <div style={{ fontSize: 11.5, color: 'var(--ink3)' }}>For you only. Not shown to the client.</div>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink3)', lineHeight: 1.6 }}>
        Free cashflow = income after CPF, less the whole expenses table. Savings rate leaves regular savings and investments out of spending. Cash = savings accounts, fixed deposits and custom cash rows. Estimates from the two records, not a ledger.
      </div>
    </div>
  )
}

function niceStep(raw: number): number {
  if (!isFinite(raw) || raw <= 0) return 1000
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}