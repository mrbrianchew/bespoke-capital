'use client'

// Growth panel for the Annual Reviews tab (advisor view).
// Shows net worth, yearly income, yearly expenses and yearly savings across the
// client's SAVED records (fact_finding_versions, section 'financials'). Real figures
// only: no projection yet. This component only reads; it never writes anything.
// The numbers come from src/lib/growth.ts.

import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { cpfConfigAt, currentMonthStartSG, type HistConfig } from '@/lib/cpfHistory'
import { growthSeries, type GrowthPoint } from '@/lib/growth'

type Kind = 'initial' | 'review' | 'earlier'
const KIND_LABEL: Record<Kind, string> = { initial: 'Initial plan', review: 'Annual review', earlier: 'Earlier record' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Row { id: string; as_at: string; kind: Kind; created_at: string; data: Record<string, unknown> }
interface Loaded { points: GrowthPoint[]; kinds: Record<string, Kind> }

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

export default function GrowthPanel({ clientId, refreshKey }: { clientId: string; refreshKey: string }) {
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
      const live = (cfg.data?.value as HistConfig | undefined) ?? cpfConfigAt(currentMonthStartSG()).config
      const points = growthSeries(rows, { client: cli.data ?? {}, spouse, liveConfig: live })
      const kinds: Record<string, Kind> = {}
      rows.forEach(r => { kinds[r.as_at] = r.kind })
      setData({ points, kinds })
      setSel(points.length - 1)
    }
    run().catch(() => { if (!off) setError('Could not load the growth figures. Please refresh the page.') })
    return () => { off = true }
  }, [supabase, clientId, refreshKey])

  const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', borderRadius: 14, padding: 24, marginBottom: 20 }
  const eyebrow = <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>Growth</div>

  if (error) return <div style={card}>{eyebrow}<div style={{ fontSize: 12, color: ROUGE }}>{error}</div></div>
  if (!data) return <div style={card}>{eyebrow}<div style={{ fontSize: 12, color: 'var(--ink3)' }}>Loading…</div></div>
  const { points, kinds } = data
  if (points.length === 0) return null

  const idx = sel !== null && sel < points.length ? sel : points.length - 1
  const cur = points[idx]
  const prev = idx > 0 ? points[idx - 1] : null
  const first = points.length === 1

  // Chart geometry: x by real date, y by net worth.
  const m0 = monthIndex(points[0].asAt), m1 = monthIndex(points[points.length - 1].asAt)
  const xs = points.map(p => (first || m1 === m0 ? (X0 + X1) / 2 : X0 + ((monthIndex(p.asAt) - m0) / (m1 - m0)) * (X1 - X0)))
  const vals = points.map(p => p.netWorth)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = hi - lo || Math.max(hi * 0.1, 1)
  const ys = vals.map(v => Y_BOT - ((v - (lo - span * 0.25)) / (span * 1.25)) * (Y_BOT - Y_TOP))
  let line = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`
  for (let i = 1; i < xs.length; i++) {
    const mx = (xs[i - 1] + xs[i]) / 2
    line += ` C${mx.toFixed(1)},${ys[i - 1].toFixed(1)} ${mx.toFixed(1)},${ys[i].toFixed(1)} ${xs[i].toFixed(1)},${ys[i].toFixed(1)}`
  }
  const area = `${line} L${xs[xs.length - 1].toFixed(1)},${Y_BASE} L${xs[0].toFixed(1)},${Y_BASE} Z`
  const bx = Math.min(Math.max(xs[idx], 90), W - 90)
  const short = points.length > 6
  const labelEvery = points.length > 12 ? 2 : 1
  const gain = (a: number) => (a >= 0 ? EMERALD : ROUGE)

  const headline = prev
    ? `Net worth is ${money(cur.netWorth)}, ${cur.netWorth >= prev.netWorth ? 'up' : 'down'} ${money(Math.abs(cur.netWorth - prev.netWorth))} since ${label(prev.asAt)}.`
    : `Net worth is ${money(cur.netWorth)} at ${label(cur.asAt)}.`
  const anySimple = points.some(p => p.savingsIncludedInExpenses)
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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 18, marginBottom: 18 }}>
        <div style={{ ...card, marginBottom: 0, padding: '18px 18px 12px' }}>
          <div className="font-serif" style={{ fontSize: 20, marginBottom: 2 }}>Net worth over time</div>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label="Net worth by saved record. Select a point to see that record." style={{ display: 'block', height: 'auto' }}>
            <defs><linearGradient id="gGrowth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={EMERALD} stopOpacity=".2" /><stop offset="1" stopColor={EMERALD} stopOpacity="0" /></linearGradient></defs>
            {[Y_BASE, 206, 150, 94].map(y => <line key={y} x1={24} y1={y} x2={W - 24} y2={y} stroke={y === Y_BASE ? '#D0CDC5' : '#E8E5DE'} />)}
            {!first && <path d={area} fill="url(#gGrowth)" />}
            {!first && <path d={line} fill="none" stroke={EMERALD} strokeWidth={3.5} strokeLinecap="round" />}
            <line x1={xs[idx]} y1={Y_TOP - 14} x2={xs[idx]} y2={Y_BASE} stroke="#C9C5BC" strokeWidth={1.5} />
            {points.map((p, i) => i === idx ? null : <circle key={p.asAt} cx={xs[i]} cy={ys[i]} r={5} fill="#fff" stroke={EMERALD} strokeWidth={2.5} />)}
            <circle cx={xs[idx]} cy={ys[idx]} r={15} fill={EMERALD} fillOpacity={0.16} />
            <circle cx={xs[idx]} cy={ys[idx]} r={8} fill="#fff" stroke={EMERALD} strokeWidth={4} />
            <rect x={bx - 75} y={6} width={150} height={prev ? 58 : 48} rx={8} fill={INK} />
            <text x={bx} y={26} textAnchor="middle" fontSize={11.5} fill="#A8A39A" fontFamily="Inter, sans-serif">{label(cur.asAt)}</text>
            <text x={bx} y={45} textAnchor="middle" fontSize={16} fontWeight={700} fill="#fff" fontFamily="DM Mono, monospace">{money(cur.netWorth)}</text>
            {prev && <text x={bx} y={59} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={cur.netWorth >= prev.netWorth ? '#9BD4B2' : '#E8A3A3'} fontFamily="Inter, sans-serif">{signed(cur.netWorth - prev.netWorth)} since {label(prev.asAt, true)}</text>}
            {points.map((p, i) => i % labelEvery === 0 || i === points.length - 1 ? (
              <text key={`l${p.asAt}`} x={xs[i]} y={286} textAnchor="middle" fontSize={12} fill="#4A4740" fontFamily="Inter, sans-serif">{label(p.asAt, short)}</text>
            ) : null)}
            {points.map((p, i) => (
              <circle key={`h${p.asAt}`} cx={xs[i]} cy={ys[i]} r={24} fill="transparent" tabIndex={0} role="button" style={{ cursor: 'pointer', outline: 'none' }}
                aria-label={`${label(p.asAt)}, net worth ${money(p.netWorth)}`} onClick={() => select(i)} onFocus={() => select(i)} onKeyDown={onKey(i)} />
            ))}
          </svg>
        </div>

        <div style={{ ...card, marginBottom: 0 }}>
          <div className="font-serif" style={{ fontSize: 20, marginBottom: 8 }}>{prev ? `Since ${label(prev.asAt)}` : `At ${label(cur.asAt)}`}</div>
          {prev ? (
            <>
              {sideRow('Income / yr', cur.income, prev.income, true)}
              {sideRow('Expenses / yr', cur.expenses, prev.expenses, false)}
              {sideRow('Savings / yr', cur.savings, prev.savings, true)}
              <div style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.5, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                Net worth {signed(cur.netWorth - prev.netWorth)} ({pct(cur.netWorth, prev.netWorth) || 'n/a'}), over {Math.max(monthIndex(cur.asAt) - monthIndex(prev.asAt), 1)} months.
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
          return (
            <div key={p.asAt} role="button" tabIndex={0} aria-pressed={on} aria-label={`Select ${label(p.asAt)}`} onClick={() => select(i)} onKeyDown={onKey(i)}
              style={{ ...seg, borderTop: '1px solid var(--line)', cursor: 'pointer', background: on ? '#F5EFE3' : 'transparent', fontSize: 14 }}>
              <span style={{ fontWeight: 600 }}>{label(p.asAt)}</span>
              <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{KIND_LABEL[kinds[p.asAt]] ?? 'Saved record'}</span>
              <span style={{ ...mono, fontWeight: 600 }}>{money(p.netWorth)}</span>
              <span style={mono}>{money(p.income)}</span>
              <span style={mono}>{money(p.expenses)}</span>
              <span style={{ ...mono, color: gain(p.savings) }}>{money(p.savings)}</span>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink3)', lineHeight: 1.6 }}>
        Real figures from saved records only. Net worth includes CPF and property at the values recorded. Income is yearly take-home after CPF, before income tax, worked out with the age and CPF rates of each record&apos;s month. Expenses leave out regular savings and investments, which count as savings.
        {anySimple && ' Some records use simple expense mode, where regular savings cannot be separated, so their savings show only the money left over.'}
      </div>
    </div>
  )
}