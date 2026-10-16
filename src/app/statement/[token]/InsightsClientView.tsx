'use client'

// "Before you submit" card on a review link, shown on the last step above the disclaimer.
// Plain facts in soft words: bank savings against what the cashflow suggests, income and
// spending a year, savings rate, and months of spending in the bank. It re-checks a moment
// after each change to the form. Failure or no earlier record simply hides it.
// Receives finished numbers from /api/statement/[token] (action 'insights'). Never writes.

import React, { useEffect, useRef, useState } from 'react'
import type { StatementData } from '@/lib/statementFields'
import type { ClientInsights } from '@/lib/statementInsights'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const label = (asAt: string) => { const [y, m] = asAt.split('-'); return `${MONTHS[Number(m) - 1]} ${y}` }
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const pa = (v: number | null) => (v === null ? null : `${v >= 0 ? '+' : ''}${v.toFixed(1)}% a year`)
const pc = (v: number) => `${Math.round(v * 100)}%`

const EMERALD = '#2A5E46', GOLD_TXT = '#8A6C3A', INK = '#1C1A17', LINE = '#E0DDD6'

export default function InsightsClientView({ token, passwordRef, data }: {
  token: string
  passwordRef: React.MutableRefObject<string>
  data: StatementData
}) {
  const [ins, setIns] = useState<ClientInsights | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    const t = setTimeout(() => {
      if (!passwordRef.current) return
      fetch(`/api/statement/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'insights', password: passwordRef.current, data }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(j => { if (mine === seq.current) setIns(j && j.insights ? (j.insights as ClientInsights) : null) })
        .catch(() => { if (mine === seq.current) setIns(null) })
    }, 700)
    return () => clearTimeout(t)
  }, [token, passwordRef, data])

  if (!ins) return null

  const showBank = ins.expectedCash > 0 || ins.cash > 0
  const barMax = Math.max(ins.expectedCash, ins.cash, 1)
  const near = Math.abs(ins.gap) < Math.max(0.03 * ins.expectedCash, 1000)
  const gapText = near ? 'About what your cashflow suggests' : ins.gap > 0 ? `${money(ins.gap)} less than expected` : `${money(-ins.gap)} more than expected`
  const scale = Math.max(ins.monthsOfCash, ins.bufferMonths * 1.5)
  const monthsText = ins.monthsOfCash >= 10 ? Math.round(ins.monthsOfCash).toString() : ins.monthsOfCash.toFixed(1)

  const bar = (name: string, v: number, color: string) => (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: '#4A4740' }}><span>{name}</span><b style={{ color: INK }}>{money(v)}</b></div>
      <div style={{ height: 8, borderRadius: 4, background: '#EFECE5', marginTop: 5, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(2, Math.min(100, (v / barMax) * 100))}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
    </div>
  )
  const row = (name: string, big: string, note: string | null) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '12px 0', borderTop: `1px solid ${LINE}`, fontSize: 15 }}>
      <span style={{ color: '#4A4740' }}>{name}</span>
      <span><b>{big}</b>{note && <span style={{ fontSize: 12.5, marginLeft: 8, color: GOLD_TXT }}>{note}</span>}</span>
    </div>
  )
  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 18px 14px', marginTop: 12 }
  const lbl: React.CSSProperties = { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: GOLD_TXT, fontWeight: 600 }

  return (
    <section aria-label="Before you submit" aria-live="polite" style={{ marginTop: 24 }}>
      <div style={lbl}>Before you submit</div>
      <h2 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 28, fontWeight: 500, margin: '6px 0 2px', color: INK }}>Since your last review</h2>
      <div style={{ fontSize: 13.5, color: '#6B665E' }}>{label(ins.sinceAsAt)} · {ins.sinceText} ago</div>

      {showBank && (
        <div style={card}>
          <div style={lbl}>Bank savings</div>
          {bar('Expected from your cashflow', ins.expectedCash, '#CFC9BB')}
          {bar('Now', ins.cash, EMERALD)}
          <div style={{ fontSize: 14.5, marginTop: 12 }}>{gapText}</div>
        </div>
      )}

      <div style={card}>
        <div style={lbl}>Income and spending</div>
        <div style={{ height: 6 }} />
        {row('Income per year', money(ins.income), pa(ins.incomeGrowthPa))}
        {row('Spending per year', money(ins.spending), pa(ins.spendGrowthPa))}
        {ins.savingsRateNow !== null && ins.savingsRateWas !== null && row('Savings rate', pc(ins.savingsRateNow), `was ${pc(ins.savingsRateWas)}`)}
      </div>

      {ins.spending > 0 && (
        <div style={card}>
          <div style={lbl}>Safety buffer</div>
          <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 34, lineHeight: 1.1, margin: '4px 0 10px', color: INK }}>{monthsText} months</div>
          <div style={{ position: 'relative', height: 8, borderRadius: 4, background: '#EFECE5' }}>
            <div style={{ width: `${Math.min(100, (ins.monthsOfCash / scale) * 100)}%`, height: '100%', background: EMERALD, borderRadius: 4 }} />
            <div style={{ position: 'absolute', left: `${(ins.bufferMonths / scale) * 100}%`, top: -4, height: 16, borderLeft: `2px solid ${INK}` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#4A4740', marginTop: 8 }}>
            <span>of spending in the bank</span><span>| usual: {ins.bufferMonths} months</span>
          </div>
        </div>
      )}

      <details style={{ margin: '12px 2px 0', fontSize: 12.5, lineHeight: 1.6, color: '#6B665E' }}>
        <summary style={{ cursor: 'pointer', color: GOLD_TXT, fontWeight: 600 }}>How is this worked out?</summary>
        <p style={{ margin: '6px 0 0' }}>
          Expected = your last bank balance plus the average of what was left after spending then and now, over the months between.
          Savings rate = income less spending, not counting regular savings and investments, as a share of income.
          These are estimates from what you entered. They may include money set aside for a purpose, or moved into investments or loans.
          You can still go back and change your numbers.
        </p>
      </details>
    </section>
  )
}