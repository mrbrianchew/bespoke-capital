'use client'

// Growth panel for the Annual Reviews tab (advisor view).
// Shows net worth, yearly income, yearly expenses and yearly savings across the
// client's SAVED records (fact_finding_versions, section 'financials'). Real figures
// only: no projection yet. This component only reads; it never writes anything.
// The numbers come from src/lib/growth.ts.

import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { cpfConfigAt, currentMonthStartSG, type HistConfig } from '@/lib/cpfHistory'
import { growthPoint, growthSeries, type GrowthPoint, type PersonRef } from '@/lib/growth'

type Kind = 'initial' | 'review' | 'earlier'
const KIND_LABEL: Record<Kind, string> = { initial: 'Initial plan', review: 'Annual review', earlier: 'Earlier record' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Row { id: string; as_at: string; kind: Kind; created_at: string; data: Record<string, unknown> }
interface Loaded { points: GrowthPoint[]; kinds: Record<string, Kind>; client: PersonRef; spouse: PersonRef | null; liveCfg: HistConfig }

const label = (asAt: string, short = false) => {
  const [y, m] = asAt.split('-')
  return `${MONTHS[Number(m) - 1]} ${short ? y.slice(2) : y}`
}
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const signed = (n: number) => `${n < 0 ? '-' : '+'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const pct = (cur: number, prev: number) => (prev > 0 ? `${cur >= prev ? '+' : '-'}${Math.abs(((cur - prev) / prev) * 100).toFixed(1)}%` : '')
const monthIndex = (asAt: string) => { const [y, m] = asAt.split('-').map(Number); return y * 12 + (m - 1) }

const EMERALD = '#2A5E46', GOLD = '#A8834A', ROUGE = '#8A2828', INK = '#1C1A17'
const W = 640, H = 300, X0 = 40, X1 = 600, Y_TOP = 84, Y_BOT = 248, Y_BASE = 262

export default function GrowthPanel({ clientId, refreshKey, live, onSaveNow, busy }: {
  clientId: string
  refreshKey: string
  /** The live plan. When given, a hollow "Now" point is drawn if it differs from the last saved record. */
  live?: Record<string, unknown> | null
  /** Saves the live plan as this month's record (replaces it if one exists). */
  onSaveNow?: () => void
  busy?: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  const [sel, setSel] = useState<number | null>(null)

  useEffect(() => {
    let off = false
    async function run() {
      setError('')
      const [vers, cli, fam, cfg] = await Promise.all([
        supabase.from('fact_finding_versions').select('id, as_at, kind, created_at, data').eq('client_id', clientId).eq('section', 'financials'),
        supabase.from('clients').select('dob, age').eq('id', clientId).maybeSingle(),
        supabase.from('family_members').select('relationship, dob, age').eq('client_id', clientId),
        supabase.from('config').select('value').eq('key', 'cpf_rates').maybeSingle(),
      ])
      if (off) return
      if (vers.error || cli.error) { setError('Could not load the growth figures. Please refresh the page.'); return }
      const rows = (vers.data as Row[] | null) ?? []
      const spouse = ((fam.data as { relationship: string; dob?: string | null; age?: number | null }[] | null) ?? []).find(f => f.relationship === 'Spouse') ?? null
      const liveCfg = (cfg.data?.value as HistConfig | undefined) ?? cpfConfigAt(currentMonthStartSG()).config
      const points = growthSeries(rows, { client: cli.data ?? {}, spouse, liveConfig: liveCfg })
      const kinds: Record<string, Kind> = {}
      rows.forEach(r => { kinds[r.as_at] = r.kind })
      setData({ points, kinds, client: cli.data ?? {}, spouse, liveCfg })
      setSel(null)
    }
    run().catch(() => { if (!off) setError('Could not load the growth figures. Please refresh the page.') })
    return () => { off = true }
  }, [supabase, clientId, refreshKey])

  const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', borderRadius: 14, padding: 24, marginBottom: 20 }
  const eyebrow = <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>Growth</div>

  if (error) return <div style={card}>{eyebrow}<div style={{ fontSize: 12, color: ROUGE }}>{error}</div></div>
  if (!data) return <div style={card}>{eyebrow}<div style={{ fontSize: 12, color: 'var(--ink3)' }}>Loading…</div></div>
  const { points: saved, kinds } = data
  if (saved.length === 0) return null

  // "Now": the live plan as a point, only when it differs from the last saved record.
  const thisMonth = currentMonthStartSG()
  let nowPt: GrowthPoint | null = null
  if (live) {
    try {
      const p = growthPoint({ asAt: thisMonth, data: live, client: data.client, spouse: data.spouse, liveConfig: data.liveCfg })
      const l = saved[saved.length - 1]
      const same = [p.netWorth - l.netWorth, p.income - l.income, p.expenses - l.expenses, p.savings - l.savings].every(d => Math.abs(d) < 0.5)
      if (!same) nowPt = p
    } catch { nowPt = null }
  }
  const hasThisMonth = saved.some(p => p.asAt === thisMonth)
  const points = nowPt ? [...saved, nowPt] : saved
  const ns = saved.length
  const n = points.length
  const isNow = (i: number) => !!nowPt && i === n - 1

  const idx = sel !== null && sel < n ? sel : n - 1
  const cur = points[idx]
  const prev = idx > 0 ? points[idx - 1] : null
  const first = n === 1

  // Chart geometry: x by real date, y by net worth.
  // Now sits at this month, but never on top of the latest saved record.
  const pos = points.map((p, i) => (isNow(i) ? Math.max(monthIndex(p.asAt), monthIndex(saved[ns - 1].asAt) + 0.5) : monthIndex(p.asAt)))
  const m0 = pos[0], m1 = pos[n - 1]
  const xs = pos.map(v => (first || m1 === m0 ? (X0 + X1) / 2 : X0 + ((v - m0) / (m1 - m0)) * (X1 - X0)))
  const vals = points.map(p => p.netWorth)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = hi - lo || Math.max(hi * 0.1, 1)
  const ys = vals.map(v => Y_BOT - ((v - (lo - span * 0.25)) / (span * 1.25)) * (Y_BOT - Y_TOP))
  const seg1 = (i: number) => {
    const mx = (xs[i - 1] + xs[i]) / 2
    return ` C${mx.toFixed(1)},${ys[i - 1].toFixed(1)} ${mx.toFixed(1)},${ys[i].toFixed(1)} ${xs[i].toFixed(1)},${ys[i].toFixed(1)}`
  }
  let line = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`
  for (let i = 1; i < ns; i++) line += seg1(i)
  const area = `${line} L${xs[ns - 1].toFixed(1)},${Y_BASE} L${xs[0].toFixed(1)},${Y_BASE} Z`
  const nowLine = nowPt ? `M${xs[ns - 1].toFixed(1)},${ys[ns - 1].toFixed(1)}${seg1(ns)}` : ''
  const bx = Math.min(Math.max(xs[idx], 90), W - 90)
  const short = n > 6
  const labelEvery = n > 12 ? 2 : 1
  const gain = (a: number) => (a >= 0 ? EMERALD : ROUGE)

  const since = prev ? (isNow(idx - 1) ? 'Now' : label(prev.asAt)) : ''
  const headline = prev
    ? `Net worth is ${money(cur.netWorth)}${isNow(idx) ? ' now' : ''}, ${cur.netWorth >= prev.netWorth ? 'up' : 'down'} ${money(Math.abs(cur.netWorth - prev.netWorth))} since ${since}.`
    : `Net worth is ${money(cur.netWorth)} at ${label(cur.asAt)}.`
  const anySimple = saved.some(p => p.savingsIncludedInExpenses)
  const select = (i: number) => setSel(i)
  const onKey = (i: number) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i) } }

  const seg: React.CSSProperties = { display: 'grid', gridTemplateColumns: '0.9fr 1.5fr repeat(4, minmax(0, 1fr))', gap: 12, padding: '13px 24px', alignItems: 'center' }
  const mono: React.CSSProperties = { fontFamily: 'DM Mono, monospace', fontSize: 13, textAlign: 'right' }
  const th: React.CSSProperties = { ...seg, fontFamily: 'DM Mono, monospace', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', borderBottom: '1px solid var(--line)' }

  const sideRow = (name: string, a: number, b: number, goodWhenUp: boolean) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, fontSize: 14, padding: '11px 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ color: 'var(--ink2)' }}>{name}</span>
      <span style={{ fontWeight: 600 }}>{money(a)} <span style={{ fontSize: 12, marginLeft: 4, color: (a >= b) === goodWhenUp ? EMERALD : '#8A6C3A' }}>{pct(a, b)}</span></span>
    </div>
  )

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ marginBottom: 14 }}>
        {eyebrow}
        <div className="font-serif" style={{ fontSize: 30, lineHeight: 1.15, color: 'var(--ink)' }}>{headline}</div>
        {first && <div style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 6 }}>This is the starting point. Save or add another record to see the change over time.</div>}
      </div>

      {nowPt && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', background: '#F5EFE3', border: '1px solid #E3D6B8', borderRadius: 12, padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5, flex: '1 1 280px' }}>
            <b style={{ color: 'var(--ink)' }}>Now is not saved yet.</b> The gold point is your plan as it is today. It becomes part of the history only when you save it.
          </div>
          {onSaveNow && (
            <button type="button" disabled={busy} onClick={onSaveNow}
              style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: '9px 18px', fontSize: 13, fontWeight: 500, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {hasThisMonth ? `Update ${label(thisMonth)} record` : `Save as ${label(thisMonth)} review record`}
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 18, marginBottom: 18 }}>
        <div style={{ ...card, marginBottom: 0, padding: '18px 18px 12px' }}>
          <div className="font-serif" style={{ fontSize: 20, marginBottom: 2 }}>Net worth over time</div>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label="Net worth by saved record. Select a point to see that record." style={{ display: 'block', height: 'auto' }}>
            <defs><linearGradient id="gGrowth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={EMERALD} stopOpacity=".2" /><stop offset="1" stopColor={EMERALD} stopOpacity="0" /></linearGradient></defs>
            {[Y_BASE, 206, 150, 94].map(y => <line key={y} x1={24} y1={y} x2={W - 24} y2={y} stroke={y === Y_BASE ? '#D0CDC5' : '#E8E5DE'} />)}
            {!first && <path d={area} fill="url(#gGrowth)" />}
            {!first && <path d={line} fill="none" stroke={EMERALD} strokeWidth={3.5} strokeLinecap="round" />}
            <line x1={xs[idx]} y1={Y_TOP - 14} x2={xs[idx]} y2={Y_BASE} stroke="#C9C5BC" strokeWidth={1.5} />
            {nowPt && <path d={nowLine} fill="none" stroke={GOLD} strokeWidth={3} strokeLinecap="round" strokeDasharray="2 7" />}
            {points.map((p, i) => i === idx ? null : <circle key={isNow(i) ? 'now' : p.asAt} cx={xs[i]} cy={ys[i]} r={5} fill="#fff" stroke={isNow(i) ? GOLD : EMERALD} strokeWidth={2.5} />)}
            <circle cx={xs[idx]} cy={ys[idx]} r={15} fill={isNow(idx) ? GOLD : EMERALD} fillOpacity={0.16} />
            <circle cx={xs[idx]} cy={ys[idx]} r={8} fill="#fff" stroke={isNow(idx) ? GOLD : EMERALD} strokeWidth={4} />
            <rect x={bx - 75} y={6} width={150} height={prev ? 58 : 48} rx={8} fill={INK} />
            <text x={bx} y={26} textAnchor="middle" fontSize={11.5} fill="#A8A39A" fontFamily="Inter, sans-serif">{isNow(idx) ? 'Now · not saved yet' : label(cur.asAt)}</text>
            <text x={bx} y={45} textAnchor="middle" fontSize={16} fontWeight={700} fill="#fff" fontFamily="DM Mono, monospace">{money(cur.netWorth)}</text>
            {prev && <text x={bx} y={59} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={cur.netWorth >= prev.netWorth ? '#9BD4B2' : '#E8A3A3'} fontFamily="Inter, sans-serif">{signed(cur.netWorth - prev.netWorth)} since {isNow(idx - 1) ? 'Now' : label(prev.asAt, true)}</text>}
            {points.map((p, i) => (i % labelEvery === 0 || i === n - 1) && !(nowPt && i === ns - 1 && xs[n - 1] - xs[ns - 1] < 56) ? (
              <text key={`l${i}`} x={xs[i]} y={286} textAnchor="middle" fontSize={12} fill={isNow(i) ? GOLD : '#4A4740'} fontWeight={isNow(i) ? 600 : 400} fontFamily="Inter, sans-serif">{isNow(i) ? 'Now' : label(p.asAt, short)}</text>
            ) : null)}
            {points.map((p, i) => (
              <circle key={`h${i}`} cx={xs[i]} cy={ys[i]} r={24} fill="transparent" tabIndex={0} role="button" style={{ cursor: 'pointer', outline: 'none' }}
                aria-label={`${isNow(i) ? 'Now, not saved yet' : label(p.asAt)}, net worth ${money(p.netWorth)}`} onClick={() => select(i)} onFocus={() => select(i)} onKeyDown={onKey(i)} />
            ))}
          </svg>
        </div>

        <div style={{ ...card, marginBottom: 0 }}>
          <div className="font-serif" style={{ fontSize: 20, marginBottom: 8 }}>{prev ? `Since ${since}` : `At ${label(cur.asAt)}`}</div>
          {prev ? (
            <>
              {sideRow('Income / yr', cur.income, prev.income, true)}
              {sideRow('Expenses / yr', cur.expenses, prev.expenses, false)}
              {sideRow('Savings / yr', cur.savings, prev.savings, true)}
              <div style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.5, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                Net worth {signed(cur.netWorth - prev.netWorth)} ({pct(cur.netWorth, prev.netWorth) || 'n/a'}), over {Math.max(Math.round(monthIndex(cur.asAt) - monthIndex(prev.asAt)), 1)} months.
              </div>
            </>
          ) : (
            <>
              {[['Income / yr', cur.income], ['Expenses / yr', cur.expenses], ['Savings / yr', cur.savings]].map(([n, v]) => (
                <div key={n as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '11px 0', borderTop: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--ink2)' }}>{n}</span><span style={{ fontWeight: 600 }}>{money(v as number)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div style={{ ...card, padding: 0, marginBottom: 10, overflow: 'hidden' }}>
        <div style={th}><span>As at</span><span>Source</span><span style={{ textAlign: 'right' }}>Net worth</span><span style={{ textAlign: 'right' }}>Income</span><span style={{ textAlign: 'right' }}>Expenses</span><span style={{ textAlign: 'right' }}>Savings</span></div>
        {[...points].reverse().map(p => {
          const i = points.indexOf(p)
          const on = i === idx
          const nw = isNow(i)
          return (
            <div key={nw ? 'now' : p.asAt} role="button" tabIndex={0} aria-pressed={on} aria-label={`Select ${label(p.asAt)}`} onClick={() => select(i)} onKeyDown={onKey(i)}
              style={{ ...seg, borderTop: '1px solid var(--line)', cursor: 'pointer', background: on ? '#F5EFE3' : 'transparent', fontSize: 14 }}>
              <span style={{ fontWeight: 600, color: nw ? GOLD : undefined }}>{nw ? 'Now' : label(p.asAt)}</span>
              <span style={{ fontSize: 12, color: nw ? GOLD : 'var(--ink2)' }}>{nw ? 'Not saved yet' : KIND_LABEL[kinds[p.asAt]] ?? 'Saved record'}</span>
              <span style={{ ...mono, fontWeight: 600 }}>{money(p.netWorth)}</span>
              <span style={mono}>{money(p.income)}</span>
              <span style={mono}>{money(p.expenses)}</span>
              <span style={{ ...mono, color: gain(p.savings) }}>{money(p.savings)}</span>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink3)', lineHeight: 1.6 }}>
        Real figures from saved records only{nowPt ? ', plus your live plan as the gold "Now" point (not saved)' : ''}. Net worth includes CPF and property at the values recorded. Income is yearly take-home after CPF, before income tax, worked out with the age and CPF rates of each record&apos;s month. Expenses leave out regular savings and investments, which count as savings.
        {anySimple && ' Some records use simple expense mode, where regular savings cannot be separated, so their savings show only the money left over.'}
      </div>
    </div>
  )
}