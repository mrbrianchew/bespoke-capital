'use client'

// "Your growth" card on the client's own statement page, shown after they submit.
// Real figures only (the records the advisor has saved): no projection, no scoring.
// Receives finished numbers from /api/statement/[token] (action 'growth').

import React, { useState } from 'react'
import { currentMonthStartSG } from '@/lib/cpfHistory'
import type { GrowthPoint } from '@/lib/growth'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const label = (asAt: string, short = false) => {
  const [y, m] = asAt.split('-')
  return `${MONTHS[Number(m) - 1]} ${short ? y.slice(2) : y}`
}
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const monthIndex = (asAt: string) => { const [y, m] = asAt.split('-').map(Number); return y * 12 + (m - 1) }

const EMERALD = '#2A5E46', GOLD_TXT = '#8A6C3A', INK = '#1C1A17', LINE = '#E0DDD6'
const W = 390, H = 250, X0 = 34, X1 = 356, Y_TOP = 76, Y_BOT = 196, Y_BASE = 206

export default function GrowthClientView({ points, submittedAt }: { points: GrowthPoint[]; submittedAt: string | null }) {
  const [sel, setSel] = useState<number | null>(null)
  if (points.length === 0) return null

  const idx = sel !== null && sel < points.length ? sel : points.length - 1
  const cur = points[idx]
  const prev = idx > 0 ? points[idx - 1] : null
  const only = points.length === 1
  const last = points[points.length - 1]
  const submittedMonth = submittedAt ? currentMonthStartSG(new Date(submittedAt)) : null
  const pending = !!submittedMonth && last.asAt < submittedMonth

  const m0 = monthIndex(points[0].asAt), m1 = monthIndex(last.asAt)
  const xs = points.map(p => (only || m1 === m0 ? (X0 + X1) / 2 : X0 + ((monthIndex(p.asAt) - m0) / (m1 - m0)) * (X1 - X0)))
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
  const bx = Math.min(Math.max(xs[idx], 66), W - 66)
  const short = points.length > 5
  const every = points.length > 10 ? 2 : 1
  const up = prev ? cur.netWorth >= prev.netWorth : true
  const select = (i: number) => setSel(i)
  const onKey = (i: number) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i) } }
  const anySimple = points.some(p => p.savingsIncludedInExpenses)

  const row = (name: string, v: number, p: number | null, goodWhenUp: boolean) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '14px 0', borderTop: `1px solid ${LINE}` }}>
      <span style={{ fontSize: 15, color: '#4A4740' }}>{name}</span>
      <span style={{ fontSize: 15, fontWeight: 600 }}>
        {money(v)}
        {p !== null && v !== p && (
          <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 8, color: (v > p) === goodWhenUp ? EMERALD : GOLD_TXT }}>
            {v > p ? '+' : '-'}{money(Math.abs(v - p)).replace('$', '')}
          </span>
        )}
      </span>
    </div>
  )

  return (
    <section aria-label="Your growth" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '22px 20px 18px', marginBottom: 24 }}>
      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: GOLD_TXT, fontWeight: 600 }}>Your growth</div>
      <div style={{ fontSize: 13.5, color: '#6B665E', marginTop: 10 }}>Net worth · {label(cur.asAt)}</div>
      <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 54, fontWeight: 500, lineHeight: 1.05, color: INK }}>{money(cur.netWorth)}</div>
      <div style={{ marginTop: 8 }}>
        {prev ? (
          <span style={{ display: 'inline-block', fontSize: 13, fontWeight: 500, borderRadius: 6, padding: '5px 10px', background: up ? '#E8F2ED' : '#F5EFE3', color: up ? EMERALD : GOLD_TXT }}>
            {up ? 'Up' : 'Down'} {money(Math.abs(cur.netWorth - prev.netWorth))} since {label(prev.asAt)}
          </span>
        ) : (
          <span style={{ display: 'inline-block', fontSize: 13, fontWeight: 500, borderRadius: 6, padding: '5px 10px', background: '#F5EFE3', color: GOLD_TXT }}>Your starting point</span>
        )}
      </div>
      {only && <p style={{ fontSize: 14, lineHeight: 1.55, color: '#4A4740', margin: '12px 0 0' }}>Thank you for your first update. From your next one, you will see how far you have come.</p>}

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label="Net worth over time. Select a point to see that update." style={{ display: 'block', height: 'auto', marginTop: 8 }}>
        <defs><linearGradient id="gClientGrowth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={EMERALD} stopOpacity=".22" /><stop offset="1" stopColor={EMERALD} stopOpacity="0" /></linearGradient></defs>
        {[Y_BASE, 166, 126].map(y => <line key={y} x1={20} y1={y} x2={W - 20} y2={y} stroke={y === Y_BASE ? '#D0CDC5' : '#E8E5DE'} />)}
        {!only && <path d={area} fill="url(#gClientGrowth)" />}
        {!only && <path d={line} fill="none" stroke={EMERALD} strokeWidth={3.5} strokeLinecap="round" />}
        <line x1={xs[idx]} y1={Y_TOP - 12} x2={xs[idx]} y2={Y_BASE} stroke="#C9C5BC" strokeWidth={1.5} />
        {points.map((p, i) => i === idx ? null : <circle key={p.asAt} cx={xs[i]} cy={ys[i]} r={5} fill="#fff" stroke={EMERALD} strokeWidth={2.5} />)}
        <circle cx={xs[idx]} cy={ys[idx]} r={15} fill={EMERALD} fillOpacity={0.16} />
        <circle cx={xs[idx]} cy={ys[idx]} r={8} fill="#fff" stroke={EMERALD} strokeWidth={4} />
        <rect x={bx - 64} y={6} width={128} height={50} rx={8} fill={INK} />
        <text x={bx} y={26} textAnchor="middle" fontSize={11.5} fill="#A8A39A" fontFamily="Inter, sans-serif">{label(cur.asAt)}</text>
        <text x={bx} y={46} textAnchor="middle" fontSize={16} fontWeight={700} fill="#fff" fontFamily="DM Mono, monospace">{money(cur.netWorth)}</text>
        {points.map((p, i) => (i % every === 0 || i === points.length - 1) ? (
          <text key={`l${p.asAt}`} x={xs[i]} y={228} textAnchor="middle" fontSize={12} fill="#4A4740" fontFamily="Inter, sans-serif">{label(p.asAt, short)}</text>
        ) : null)}
        {points.map((p, i) => (
          <circle key={`h${p.asAt}`} cx={xs[i]} cy={ys[i]} r={24} fill="transparent" tabIndex={0} role="button" style={{ cursor: 'pointer', outline: 'none' }}
            aria-label={`${label(p.asAt)}, net worth ${money(p.netWorth)}`} onClick={() => select(i)} onFocus={() => select(i)} onKeyDown={onKey(i)} />
        ))}
      </svg>

      {pending && (
        <div style={{ background: '#F5EFE3', border: '1px solid #E6D9BC', borderRadius: 10, padding: '12px 14px', fontSize: 13.5, lineHeight: 1.5, color: '#4A4740', margin: '4px 0 16px' }}>
          Your update is with your advisor. It will appear here once it has been reviewed.
        </div>
      )}

      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: GOLD_TXT, fontWeight: 600, margin: '14px 0 2px' }}>{prev ? `Compared with ${label(prev.asAt)}` : 'Your numbers'}</div>
      {row('Income per year', cur.income, prev ? prev.income : null, true)}
      {row('Spending per year', cur.expenses, prev ? prev.expenses : null, false)}
      {row('Saved per year', cur.savings, prev ? prev.savings : null, true)}

      <p style={{ fontSize: 12, lineHeight: 1.55, color: '#8B867E', margin: '14px 0 0' }}>
        Based on the records your advisor has saved. Net worth includes CPF and property at the values recorded. Income is after CPF, before income tax.
        {anySimple && ' Where you gave simplified expenses, savings show only the money left over.'} This is a summary of what you told us, not advice.
      </p>
    </section>
  )
}