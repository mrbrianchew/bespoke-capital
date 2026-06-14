'use client'
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

// ─── TYPES ────────────────────────────────────────────────────────────────────

type RecMode = 'new' | 'replacement'
type ContribFreq = 'Monthly' | 'Annual' | 'Quarterly'
type ProjMethod = 'illustration' | 'rate'
type RankLabel = 'Recommended' | 'Alternative 1' | 'Alternative 2'

const RANK_LABELS: RankLabel[] = ['Recommended', 'Alternative 1', 'Alternative 2']

const PLAN_TYPES = [
  '101 ILP', 'ILP', 'Endowment', 'Unit Trust', 'Annuity',
  'Indexed Savings', 'RSP', 'CPF Top-up (OA)', 'CPF Top-up (SA)',
  'CPF Top-up (MA)', 'SRS', 'Cash Savings', 'Other',
]

interface ReplacedPolicy {
  policyId: string          // from protection_portfolio
  policyName: string
  companyName: string
  annualPremium: number     // overrideable
  currentCashValue: number  // manually input
}

interface ProtRec {
  id: string
  rank: RankLabel
  mode: RecMode
  // Core fields
  productName: string
  insurer: string
  coverageType: string
  sumAssured: number
  annualPremium: number
  premiumTerm: string
  policyTerm: string
  // Text
  benefits: string
  limitations: string
  // Replacement
  replacedPolicies: ReplacedPolicy[]
  // Chosen
  isChosen: boolean
}

interface AccRec {
  id: string
  rank: RankLabel
  mode: RecMode
  // Core fields
  productType: string
  company: string
  planType: string
  // Contribution
  hasLumpSum: boolean
  lumpSumAmount: number
  hasRegular: boolean
  regularFreq: ContribFreq
  regularAmount: number
  regularYears: number
  // Projection
  projMethod: ProjMethod
  illusTerm: number
  illusGuaranteed: number
  illusNonGuaranteed: number
  rateYears: number
  rateReturn: number
  // Replacement (if mode === 'replacement')
  replacedPolicies: ReplacedPolicy[]
  // Text
  benefits: string
  limitations: string
  // Goal allocation
  allocatedGoalIds: string[]
  // Chosen
  isChosen: boolean
}

interface RecPageData {
  protection: ProtRec[]
  accumulation: AccRec[]
}

const EMPTY: RecPageData = { protection: [], accumulation: [] }

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function newId() { return 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) }

function fmt(n: number) {
  if (!n || isNaN(n)) return 'S$0'
  if (n >= 1_000_000) return 'S$' + (n / 1_000_000).toFixed(2) + 'M'
  return 'S$' + Math.round(n).toLocaleString('en-SG')
}

function calcIRR(invested: number, fv: number, years: number): number {
  if (invested <= 0 || years <= 0 || fv <= 0) return 0
  return (Math.pow(fv / invested, 1 / years) - 1) * 100
}

function calcProjectedValue(rec: AccRec): number {
  if (rec.projMethod === 'illustration') {
    const ng = rec.illusNonGuaranteed > 0 ? rec.illusNonGuaranteed : rec.illusGuaranteed
    return ng
  }
  const total = calcTotalInvested(rec)
  const r = (rec.rateReturn || 0) / 100
  const y = rec.rateYears || 1
  return total * Math.pow(1 + r, y)
}

function calcTotalInvested(rec: AccRec): number {
  const lump = rec.hasLumpSum ? (rec.lumpSumAmount || 0) : 0
  const perYear = rec.regularFreq === 'Monthly' ? 12 : rec.regularFreq === 'Quarterly' ? 4 : 1
  const reg = rec.hasRegular ? (rec.regularAmount || 0) * perYear * (rec.regularYears || 0) : 0
  return lump + reg
}

function calcAnnualContrib(rec: AccRec): number {
  const lumpAmort = rec.hasLumpSum && rec.regularYears > 0
    ? (rec.lumpSumAmount || 0) / rec.regularYears
    : rec.hasLumpSum ? (rec.lumpSumAmount || 0) : 0
  const perYear = rec.regularFreq === 'Monthly' ? 12 : rec.regularFreq === 'Quarterly' ? 4 : 1
  const reg = rec.hasRegular ? (rec.regularAmount || 0) * perYear : 0
  return lumpAmort + reg
}

// ─── SHARED STYLES ────────────────────────────────────────────────────────────

const S = {
  inp: {
    background: 'var(--cream2)', border: '1px solid var(--cream3)', borderRadius: 4,
    padding: '5px 8px', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink)',
    width: '100%', outline: 'none',
  } as React.CSSProperties,
  lbl: {
    fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
    color: 'var(--ink3)', marginBottom: 3, display: 'block',
  } as React.CSSProperties,
  card: {
    background: '#fff', border: '1px solid var(--cream3)', borderRadius: 10,
    overflow: 'hidden', marginBottom: 12,
  } as React.CSSProperties,
  sectionWrap: {
    background: 'var(--cream)', border: '1px solid var(--cream3)', borderRadius: 10,
    padding: 24, marginBottom: 24,
  } as React.CSSProperties,
}

// ─── RANK BADGE ───────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: RankLabel }) {
  const isRec = rank === 'Recommended'
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, fontFamily: 'Inter',
      background: isRec ? '#D1FAE5' : 'var(--cream2)',
      color: isRec ? '#1E4D35' : 'var(--ink3)',
      display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
    }}>
      {isRec && '★ '}{rank}
    </span>
  )
}

// ─── MODE TOGGLE ──────────────────────────────────────────────────────────────

function ModeToggle({ mode, onChange }: { mode: RecMode; onChange: (m: RecMode) => void }) {
  const btn = (m: RecMode, label: string) => (
    <button onClick={() => onChange(m)} style={{
      fontSize: 12, padding: '4px 12px', border: 'none', cursor: 'pointer', fontFamily: 'Inter',
      background: mode === m ? 'var(--cream2)' : 'transparent',
      color: mode === m ? 'var(--ink)' : 'var(--ink3)',
      fontWeight: mode === m ? 600 : 400,
    }}>{label}</button>
  )
  return (
    <div style={{
      display: 'flex', border: '1px solid var(--cream3)', borderRadius: 6,
      overflow: 'hidden', marginLeft: 'auto', flexShrink: 0,
    }}>
      {btn('new', 'New addition')}
      {btn('replacement', 'Replacement')}
    </div>
  )
}

// ─── CHOSEN BADGE ─────────────────────────────────────────────────────────────

function ChosenBadge() {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, fontFamily: 'Inter',
      background: '#D1FAE5', color: '#1E4D35', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
    }}>✓ Client chosen</span>
  )
}

// ─── COMPARISON TABLE ─────────────────────────────────────────────────────────

function CompareTable({ existing, newPremium, newSA, newCoverageType, existingPolicies }: {
  existing: ReplacedPolicy[]
  newPremium: number
  newSA: number
  newCoverageType: string
  existingPolicies: ReplacedPolicy[]
}) {
  const oldPremium = existing.reduce((s, p) => s + p.annualPremium, 0)
  const deltaP = newPremium - oldPremium
  const tdS: React.CSSProperties = { padding: '6px 10px', fontFamily: 'Inter', fontSize: 12, borderBottom: '1px solid var(--cream3)' }
  const thS: React.CSSProperties = { ...tdS, fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink3)', background: 'var(--cream2)', fontWeight: 600 }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ ...S.lbl, marginBottom: 8 }}>Side-by-side comparison</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--cream3)', borderRadius: 6, overflow: 'hidden' }}>
        <thead>
          <tr>
            <th style={thS}></th>
            <th style={thS}>Existing (combined)</th>
            <th style={thS}>New product</th>
            <th style={thS}>Change</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...tdS, color: 'var(--ink3)', fontSize: 11 }}>Annual premium</td>
            <td style={{ ...tdS, color: '#9B1C1C' }}>{fmt(oldPremium)}</td>
            <td style={{ ...tdS, color: '#1E4D35', fontWeight: 600 }}>{fmt(newPremium)}</td>
            <td style={{ ...tdS, color: deltaP > 0 ? '#9B1C1C' : '#1E4D35', fontWeight: 600 }}>
              {deltaP > 0 ? '+' : ''}{fmt(deltaP)} / yr
            </td>
          </tr>
          <tr>
            <td style={{ ...tdS, color: 'var(--ink3)', fontSize: 11 }}>Sum assured / benefit</td>
            <td style={{ ...tdS, color: '#9B1C1C' }}>—</td>
            <td style={{ ...tdS, color: '#1E4D35', fontWeight: 600 }}>{fmt(newSA)}</td>
            <td style={{ ...tdS, color: '#1E4D35', fontWeight: 600 }}>—</td>
          </tr>
          {newCoverageType && (
            <tr>
              <td style={{ ...tdS, color: 'var(--ink3)', fontSize: 11 }}>Coverage type</td>
              <td style={{ ...tdS, color: '#9B1C1C' }}>—</td>
              <td style={{ ...tdS, color: '#1E4D35', fontWeight: 600 }}>{newCoverageType}</td>
              <td style={tdS}>—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── PROTECTION IMPACT MODAL ──────────────────────────────────────────────────

function ProtImpactModal({ rec, onClose }: { rec: ProtRec; onClose: () => void }) {
  const [cvValues, setCvValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    rec.replacedPolicies.forEach(p => { init[p.policyId] = p.currentCashValue || 0 })
    return init
  })

  const oldPremium = rec.replacedPolicies.reduce((s, p) => s + p.annualPremium, 0)
  const netAnnual = rec.annualPremium - oldPremium
  const totalCV = Object.values(cvValues).reduce((s, v) => s + v, 0)
  const policyTermYrs = parseInt(rec.policyTerm) || 20
  const yearsCV = netAnnual > 0 ? Math.floor(totalCV / netAnnual) : (netAnnual < 0 ? 999 : 0)
  const totalNetOutcome = totalCV - Math.max(0, netAnnual) * policyTermYrs

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  const modal: React.CSSProperties = {
    background: '#fff', borderRadius: 12, border: '1px solid var(--cream3)',
    width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', padding: '28px',
  }
  const metricCard = (label: string, value: string, sub: string, color: string) => (
    <div style={{ background: 'var(--cream)', borderRadius: 8, padding: '14px', border: '1px solid var(--cream3)' }}>
      <div style={{ ...S.lbl, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color }}>{value}</div>
      {sub && <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={modal}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>
            Impact analysis
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', marginBottom: 16 }}>
          {rec.productName} — {rec.insurer}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          {metricCard('New annual premium', fmt(rec.annualPremium), rec.premiumTerm ? `${rec.premiumTerm} payment term` : '', '#854F0B')}
          {rec.mode === 'replacement'
            ? metricCard('Old premiums freed up', fmt(oldPremium) + ' / yr', `${rec.replacedPolicies.length} polic${rec.replacedPolicies.length === 1 ? 'y' : 'ies'} cancelled`, '#1E4D35')
            : metricCard('Policy term', rec.policyTerm || '—', 'Coverage duration', 'var(--ink2)')
          }
          {rec.mode === 'replacement' && metricCard(
            'Net annual change',
            (netAnnual > 0 ? '+' : '') + fmt(netAnnual) + ' / yr',
            netAnnual > 0 ? 'Additional outflow' : 'Annual savings',
            netAnnual > 0 ? '#9B1C1C' : '#1E4D35'
          )}
          {metricCard('Coverage increase', fmt(rec.sumAssured), rec.coverageType || 'Sum assured', '#1E4D35')}
        </div>

        {/* Cash value section — only for replacements */}
        {rec.mode === 'replacement' && rec.replacedPolicies.length > 0 && (
          <div style={{ borderTop: '1px solid var(--cream3)', paddingTop: 16, marginTop: 4 }}>
            <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>
              Cash value mitigation
            </div>

            {rec.replacedPolicies.map(p => (
              <div key={p.policyId} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1, fontFamily: 'Inter', fontSize: 12, color: 'var(--ink2)' }}>
                  Surrender value — {p.policyName || p.companyName}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>S$</span>
                  <input
                    type="number"
                    value={cvValues[p.policyId] ?? 0}
                    onChange={e => setCvValues(prev => ({ ...prev, [p.policyId]: Number(e.target.value) }))}
                    style={{ ...S.inp, width: 130 }}
                  />
                </div>
              </div>
            ))}

            <div style={{ borderTop: '1px solid var(--cream3)', paddingTop: 10, marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Total cash value available</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{fmt(totalCV)}</span>
              </div>
              {netAnnual > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink2)' }}>Years cash value offsets net additional cost</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 600, color: '#1E4D35' }}>
                    {yearsCV >= 999 ? '∞' : yearsCV} yr{yearsCV !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>

            <div style={{
              background: totalNetOutcome >= 0 ? '#D1FAE5' : '#FEE2E2',
              borderRadius: 8, padding: '12px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12,
            }}>
              <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                Total net outcome over {policyTermYrs}-year premium term
              </span>
              <span style={{
                fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600,
                color: totalNetOutcome >= 0 ? '#1E4D35' : '#9B1C1C',
              }}>
                {totalNetOutcome >= 0 ? '' : '-'}{fmt(Math.abs(totalNetOutcome))} {totalNetOutcome >= 0 ? 'saved' : 'increase'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── ACCUMULATION IMPACT MODAL ────────────────────────────────────────────────

interface GoalItem {
  id: string
  label: string
  icon: string
  targetCorpus: number
  targetAge: number
  existingProjected: number
}

function AccImpactModal({ rec, goals, existingPortfolioValue, onClose }: {
  rec: AccRec
  goals: GoalItem[]
  existingPortfolioValue: number
  onClose: () => void
}) {
  const [view, setView] = useState<'existing' | 'with'>('existing')
  const [orderedGoals, setOrderedGoals] = useState<GoalItem[]>(() =>
    [...goals].sort((a, b) => a.targetAge - b.targetAge)
  )
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const totalInvested = calcTotalInvested(rec)
  const projValue = calcProjectedValue(rec)
  const gain = projValue - totalInvested
  const annualContrib = calcAnnualContrib(rec)
  const monthlyContrib = annualContrib / 12
  const irr = calcIRR(totalInvested, projValue, rec.projMethod === 'illustration' ? rec.illusTerm : rec.rateYears)

  // Goal waterfall — simple waterfall: portfolio fills each goal sequentially
  const portfolioBase = view === 'existing' ? existingPortfolioValue : existingPortfolioValue + projValue
  let remaining = portfolioBase

  const goalResults = orderedGoals.map(g => {
    const funded = Math.min(remaining, g.targetCorpus)
    remaining = Math.max(0, remaining - g.targetCorpus)
    const shortfall = Math.max(0, g.targetCorpus - funded)
    const pct = g.targetCorpus > 0 ? Math.min(100, Math.round((funded / g.targetCorpus) * 100)) : 100
    return { ...g, funded, shortfall, pct }
  })

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  const modal: React.CSSProperties = {
    background: '#fff', borderRadius: 12, border: '1px solid var(--cream3)',
    width: 580, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', padding: '28px',
  }

  // Drag handlers
  function onDragStart(idx: number) { setDragIdx(idx) }
  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    const next = [...orderedGoals]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(idx, 0, moved)
    setOrderedGoals(next)
    setDragIdx(idx)
  }
  function onDragEnd() { setDragIdx(null) }

  const statusBg = (pct: number) => pct >= 100 ? '#D1FAE5' : pct >= 60 ? '#FEF3C7' : '#FEE2E2'
  const statusColor = (pct: number) => pct >= 100 ? '#1E4D35' : pct >= 60 ? '#854F0B' : '#9B1C1C'
  const statusLabel = (pct: number) => pct >= 100 ? 'Fully funded' : pct >= 60 ? 'Partially funded' : 'Shortfall'
  const barColor = (pct: number) => pct >= 100 ? '#2D5A4E' : pct >= 60 ? '#c8a96e' : '#9B1C1C'

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={modal}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>
            Impact analysis
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', marginBottom: 16 }}>
          {rec.productType || rec.planType} — {rec.company}
        </div>

        {/* Key figures */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Total invested', val: fmt(totalInvested), color: '#854F0B' },
            { label: 'Projected value', val: fmt(projValue), color: '#1E4D35' },
            { label: 'Projected gain', val: (gain >= 0 ? '+' : '') + fmt(gain), color: gain >= 0 ? '#1E4D35' : '#9B1C1C' },
          ].map(m => (
            <div key={m.label} style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
              <div style={S.lbl}>{m.label}</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: m.color }}>{m.val}</div>
            </div>
          ))}
        </div>

        {/* Cash flow impact */}
        <div style={{ background: 'var(--cream)', borderRadius: 8, padding: '14px 16px', marginBottom: 20, border: '1px solid var(--cream3)' }}>
          <div style={{ ...S.lbl, marginBottom: 8 }}>Cash flow impact</div>
          <div style={{ display: 'flex', gap: 32 }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginBottom: 2 }}>Monthly outflow</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 600, color: '#9B1C1C' }}>
                {fmt(monthlyContrib)} / mo
              </div>
            </div>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginBottom: 2 }}>Annual outflow</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 600, color: '#9B1C1C' }}>
                {fmt(annualContrib)} / yr
              </div>
            </div>
            {irr > 0 && (
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginBottom: 2 }}>Projected IRR</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 600, color: '#1E4D35' }}>
                  {irr.toFixed(1)}% p.a.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Goal waterfall */}
        {orderedGoals.length > 0 && (
          <div style={{ borderTop: '1px solid var(--cream3)', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                Goal progress
              </div>
              <div style={{ display: 'flex', border: '1px solid var(--cream3)', borderRadius: 6, overflow: 'hidden' }}>
                {(['existing', 'with'] as const).map(v => (
                  <button key={v} onClick={() => setView(v)} style={{
                    fontSize: 11, padding: '4px 12px', border: 'none', cursor: 'pointer', fontFamily: 'Inter',
                    background: view === v ? 'var(--cream2)' : 'transparent',
                    color: view === v ? 'var(--ink)' : 'var(--ink3)',
                    fontWeight: view === v ? 600 : 400,
                  }}>
                    {v === 'existing' ? 'Existing only' : '+ This product'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginBottom: 10 }}>
              Drag to reorder. Portfolio waterfall funds goals in order shown.
            </div>

            {goalResults.map((g, idx) => (
              <div
                key={g.id}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={e => onDragOver(e, idx)}
                onDragEnd={onDragEnd}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0',
                  borderBottom: idx < goalResults.length - 1 ? '1px solid var(--cream3)' : 'none',
                  cursor: 'grab', opacity: dragIdx === idx ? 0.5 : 1,
                }}
              >
                {/* Icon */}
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 14, flexShrink: 0,
                  background: statusBg(g.pct), color: statusColor(g.pct),
                }}>
                  {g.icon}
                </div>
                {/* Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{g.label}</div>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, fontFamily: 'Inter',
                      background: statusBg(g.pct), color: statusColor(g.pct),
                    }}>{statusLabel(g.pct)}</span>
                  </div>
                  <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginBottom: 6 }}>
                    Target age {g.targetAge} · Need {fmt(g.targetCorpus)}
                  </div>
                  <div style={{ height: 6, background: 'var(--cream3)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{ width: `${g.pct}%`, height: '100%', background: barColor(g.pct), borderRadius: 3, transition: 'width 0.4s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'Inter', fontSize: 11 }}>
                    <span style={{ color: statusColor(g.pct) }}>{fmt(g.funded)} covered</span>
                    {g.shortfall > 0 && <span style={{ color: '#9B1C1C' }}>{fmt(g.shortfall)} short</span>}
                  </div>
                </div>
                {/* Drag handle */}
                <div style={{ color: 'var(--ink3)', fontSize: 14, paddingTop: 6, cursor: 'grab' }}>⠿</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PROTECTION CARD ──────────────────────────────────────────────────────────

function ProtCard({ rec, onChange, onDelete, onChoose, existingPolicies, canAddMore, rankIdx }: {
  rec: ProtRec
  onChange: (r: ProtRec) => void
  onDelete: () => void
  onChoose: () => void
  existingPolicies: { id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number }[]
  canAddMore: boolean
  rankIdx: number
}) {
  const [showImpact, setShowImpact] = useState(false)
  function upd<K extends keyof ProtRec>(k: K, v: ProtRec[K]) { onChange({ ...rec, [k]: v }) }

  function togglePolicy(pol: typeof existingPolicies[0]) {
    const exists = rec.replacedPolicies.find(p => p.policyId === pol.id)
    if (exists) {
      upd('replacedPolicies', rec.replacedPolicies.filter(p => p.policyId !== pol.id))
    } else {
      upd('replacedPolicies', [...rec.replacedPolicies, {
        policyId: pol.id, policyName: pol.policyName, companyName: pol.companyName,
        annualPremium: pol.annualPremium, currentCashValue: pol.currentCashValue,
      }])
    }
  }

  function updateReplacedField(policyId: string, field: 'annualPremium' | 'currentCashValue', val: number) {
    upd('replacedPolicies', rec.replacedPolicies.map(p =>
      p.policyId === policyId ? { ...p, [field]: val } : p
    ))
  }

  const borderStyle = rec.isChosen
    ? '2px solid #2D5A4E'
    : `1px solid var(--cream3)`

  return (
    <>
      <div style={{ ...S.card, border: borderStyle }}>
        {/* Card top bar */}
        <div style={{ background: 'var(--cream)', padding: '12px 16px', borderBottom: '1px solid var(--cream3)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <RankBadge rank={rec.rank} />
          {rec.isChosen && <ChosenBadge />}
          <ModeToggle mode={rec.mode} onChange={m => upd('mode', m)} />
        </div>

        {/* Core fields */}
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px' }}>
          <div>
            <label style={S.lbl}>Product name</label>
            <input style={S.inp} value={rec.productName} onChange={e => upd('productName', e.target.value)} placeholder="e.g. MultiPay CI Advantage" />
          </div>
          <div>
            <label style={S.lbl}>Insurer</label>
            <input style={S.inp} value={rec.insurer} onChange={e => upd('insurer', e.target.value)} placeholder="e.g. Prudential" />
          </div>
          <div>
            <label style={S.lbl}>Coverage type</label>
            <input style={S.inp} value={rec.coverageType} onChange={e => upd('coverageType', e.target.value)} placeholder="e.g. Critical Illness" />
          </div>
          <div>
            <label style={S.lbl}>Sum assured</label>
            <input type="number" style={S.inp} value={rec.sumAssured || ''} onChange={e => upd('sumAssured', Number(e.target.value))} placeholder="0" />
          </div>
          <div>
            <label style={S.lbl}>Annual premium (S$)</label>
            <input type="number" style={S.inp} value={rec.annualPremium || ''} onChange={e => upd('annualPremium', Number(e.target.value))} placeholder="0" />
          </div>
          <div>
            <label style={S.lbl}>Premium term / Policy term</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...S.inp }} value={rec.premiumTerm} onChange={e => upd('premiumTerm', e.target.value)} placeholder="e.g. 20 yrs" />
              <input style={{ ...S.inp }} value={rec.policyTerm} onChange={e => upd('policyTerm', e.target.value)} placeholder="e.g. Life" />
            </div>
          </div>
          <div style={{ gridColumn: '1/3' }}>
            <label style={S.lbl}>Benefits</label>
            <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 70, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.benefits} onChange={e => upd('benefits', e.target.value)} placeholder="Key benefits of this product…" />
          </div>
          <div>
            <label style={S.lbl}>Limitations</label>
            <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 70, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.limitations} onChange={e => upd('limitations', e.target.value)} placeholder="Limitations or trade-offs…" />
          </div>
        </div>

        {/* Replacement section */}
        {rec.mode === 'replacement' && (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
              <div style={{ ...S.lbl, marginBottom: 10 }}>Replacing existing policies</div>

              {existingPolicies.length === 0 && (
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>
                  No existing policies found — add them in the Protection Portfolio tab first.
                </div>
              )}

              {/* Policy multi-select */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {existingPolicies.map(pol => {
                  const selected = !!rec.replacedPolicies.find(p => p.policyId === pol.id)
                  return (
                    <button key={pol.id} onClick={() => togglePolicy(pol)} style={{
                      fontSize: 12, padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: 'Inter',
                      border: `1px solid ${selected ? '#2D5A4E' : 'var(--cream3)'}`,
                      background: selected ? '#D1FAE5' : '#fff',
                      color: selected ? '#1E4D35' : 'var(--ink2)',
                      fontWeight: selected ? 600 : 400,
                    }}>
                      {selected ? '✓ ' : ''}{pol.policyName || pol.companyName}
                    </button>
                  )
                })}
              </div>

              {/* Override fields for selected policies */}
              {rec.replacedPolicies.length > 0 && (
                <div>
                  {rec.replacedPolicies.map(p => (
                    <div key={p.policyId} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'end', marginBottom: 8 }}>
                      <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink2)', paddingBottom: 6 }}>
                        {p.policyName || p.companyName}
                      </div>
                      <div>
                        <label style={S.lbl}>Annual premium</label>
                        <input type="number" style={{ ...S.inp, width: 120 }}
                          value={p.annualPremium || ''}
                          onChange={e => updateReplacedField(p.policyId, 'annualPremium', Number(e.target.value))} />
                      </div>
                      <div>
                        <label style={S.lbl}>Cash value</label>
                        <input type="number" style={{ ...S.inp, width: 120 }}
                          value={p.currentCashValue || ''}
                          onChange={e => updateReplacedField(p.policyId, 'currentCashValue', Number(e.target.value))} />
                      </div>
                    </div>
                  ))}

                  {/* Comparison table */}
                  <CompareTable
                    existing={rec.replacedPolicies}
                    newPremium={rec.annualPremium}
                    newSA={rec.sumAssured}
                    newCoverageType={rec.coverageType}
                    existingPolicies={rec.replacedPolicies}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--cream3)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {rec.isChosen ? (
            <>
              <button onClick={() => setShowImpact(true)} style={{
                fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter',
                border: '1px solid #2D5A4E', background: 'transparent', color: '#2D5A4E', fontWeight: 600,
              }}>View impact</button>
              <button onClick={onChoose} style={{
                fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter',
                border: '1px solid var(--cream3)', background: 'transparent', color: 'var(--ink2)',
              }}>Unmark as chosen</button>
            </>
          ) : (
            <button onClick={onChoose} style={{
              fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter',
              border: 'none', background: 'var(--charcoal)', color: 'var(--cream)', fontWeight: 600,
            }}>Mark as chosen</button>
          )}
          <button onClick={onDelete} style={{
            fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter',
            border: '1px solid var(--cream3)', background: 'transparent', color: '#9B1C1C', marginLeft: 'auto',
          }}>Remove</button>
        </div>
      </div>

      {showImpact && <ProtImpactModal rec={rec} onClose={() => setShowImpact(false)} />}
    </>
  )
}

// ─── ACCUMULATION CARD ────────────────────────────────────────────────────────

function AccCard({ rec, onChange, onDelete, onChoose, goals, existingPortfolioValue, existingPolicies, rankIdx }: {
  rec: AccRec
  onChange: (r: AccRec) => void
  onDelete: () => void
  onChoose: () => void
  goals: GoalItem[]
  existingPortfolioValue: number
  existingPolicies: { id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number }[]
  rankIdx: number
}) {
  const [showImpact, setShowImpact] = useState(false)
  function upd<K extends keyof AccRec>(k: K, v: AccRec[K]) { onChange({ ...rec, [k]: v }) }

  const totalInvested = calcTotalInvested(rec)
  const projValue = calcProjectedValue(rec)
  const gain = projValue - totalInvested
  const irr = calcIRR(totalInvested, projValue, rec.projMethod === 'illustration' ? rec.illusTerm : rec.rateYears)

  const borderStyle = rec.isChosen ? '2px solid #2D5A4E' : '1px solid var(--cream3)'

  return (
    <>
      <div style={{ ...S.card, border: borderStyle }}>
        {/* Top bar */}
        <div style={{ background: 'var(--cream)', padding: '12px 16px', borderBottom: '1px solid var(--cream3)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <RankBadge rank={rec.rank} />
          {rec.isChosen && <ChosenBadge />}
          <ModeToggle mode={rec.mode} onChange={m => upd('mode', m)} />
        </div>

        {/* Core fields */}
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px' }}>
          <div>
            <label style={S.lbl}>Product / Type</label>
            <input style={S.inp} value={rec.productType} onChange={e => upd('productType', e.target.value)} placeholder="e.g. Gro Capital Ease II" />
          </div>
          <div>
            <label style={S.lbl}>Company</label>
            <input style={S.inp} value={rec.company} onChange={e => upd('company', e.target.value)} placeholder="e.g. NTUC Income" />
          </div>
          <div>
            <label style={S.lbl}>Plan</label>
            <select style={S.inp} value={rec.planType} onChange={e => upd('planType', e.target.value)}>
              <option value="">Select…</option>
              {PLAN_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* Contribution structure */}
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
            <div style={{ ...S.lbl, marginBottom: 10 }}>Contribution structure</div>

            {/* Lump sum */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={rec.hasLumpSum} onChange={e => upd('hasLumpSum', e.target.checked)} style={{ accentColor: '#2D5A4E', width: 15, height: 15 }} />
              <span style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)' }}>Lump sum</span>
            </label>
            {rec.hasLumpSum && (
              <div style={{ marginLeft: 23, marginBottom: 12 }}>
                <label style={S.lbl}>Amount (S$)</label>
                <input type="number" style={{ ...S.inp, width: 200 }} value={rec.lumpSumAmount || ''} onChange={e => upd('lumpSumAmount', Number(e.target.value))} placeholder="0" />
              </div>
            )}

            {/* Regular */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={rec.hasRegular} onChange={e => upd('hasRegular', e.target.checked)} style={{ accentColor: '#2D5A4E', width: 15, height: 15 }} />
              <span style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)' }}>Regular contribution / top-up</span>
            </label>
            {rec.hasRegular && (
              <div style={{ marginLeft: 23, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 12px' }}>
                <div>
                  <label style={S.lbl}>Frequency</label>
                  <select style={S.inp} value={rec.regularFreq} onChange={e => upd('regularFreq', e.target.value as ContribFreq)}>
                    {(['Monthly', 'Annual', 'Quarterly'] as ContribFreq[]).map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>Amount (S$)</label>
                  <input type="number" style={S.inp} value={rec.regularAmount || ''} onChange={e => upd('regularAmount', Number(e.target.value))} placeholder="0" />
                </div>
                <div>
                  <label style={S.lbl}>For how many years</label>
                  <input type="number" style={S.inp} value={rec.regularYears || ''} onChange={e => upd('regularYears', Number(e.target.value))} placeholder="yrs" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Projected value */}
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
            <div style={{ ...S.lbl, marginBottom: 8 }}>Projected value at maturity</div>
            {/* Method toggle */}
            <div style={{ display: 'flex', border: '1px solid var(--cream3)', borderRadius: 6, overflow: 'hidden', width: 'fit-content', marginBottom: 14 }}>
              {(['illustration', 'rate'] as ProjMethod[]).map(m => (
                <button key={m} onClick={() => upd('projMethod', m)} style={{
                  fontSize: 12, padding: '5px 14px', border: 'none', cursor: 'pointer', fontFamily: 'Inter',
                  background: rec.projMethod === m ? 'var(--cream2)' : 'transparent',
                  color: rec.projMethod === m ? 'var(--ink)' : 'var(--ink3)',
                  fontWeight: rec.projMethod === m ? 600 : 400,
                }}>
                  {m === 'illustration' ? 'From illustration' : 'By projected rate'}
                </button>
              ))}
            </div>

            {rec.projMethod === 'illustration' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 12px' }}>
                <div>
                  <label style={S.lbl}>Policy / maturity term (yrs)</label>
                  <input type="number" style={S.inp} value={rec.illusTerm || ''} onChange={e => upd('illusTerm', Number(e.target.value))} placeholder="yrs" />
                </div>
                <div>
                  <label style={S.lbl}>Guaranteed value (S$)</label>
                  <input type="number" style={S.inp} value={rec.illusGuaranteed || ''} onChange={e => upd('illusGuaranteed', Number(e.target.value))} placeholder="0" />
                </div>
                <div>
                  <label style={S.lbl}>Non-guaranteed value (S$)</label>
                  <input type="number" style={S.inp} value={rec.illusNonGuaranteed || ''} onChange={e => upd('illusNonGuaranteed', Number(e.target.value))} placeholder="0 (uses guaranteed if blank)" />
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                <div>
                  <label style={S.lbl}>Investment horizon (yrs)</label>
                  <input type="number" style={S.inp} value={rec.rateYears || ''} onChange={e => upd('rateYears', Number(e.target.value))} placeholder="yrs" />
                </div>
                <div>
                  <label style={S.lbl}>Projected annual return (% p.a.)</label>
                  <input type="number" step="0.1" style={S.inp} value={rec.rateReturn || ''} onChange={e => upd('rateReturn', Number(e.target.value))} placeholder="e.g. 6" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Replacement section */}
        {rec.mode === 'replacement' && (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
              <div style={{ ...S.lbl, marginBottom: 10 }}>Replacing existing policies</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {existingPolicies.map(pol => {
                  const selected = !!rec.replacedPolicies.find(p => p.policyId === pol.id)
                  return (
                    <button key={pol.id} onClick={() => {
                      const exists = rec.replacedPolicies.find(p => p.policyId === pol.id)
                      if (exists) {
                        upd('replacedPolicies', rec.replacedPolicies.filter(p => p.policyId !== pol.id))
                      } else {
                        upd('replacedPolicies', [...rec.replacedPolicies, {
                          policyId: pol.id, policyName: pol.policyName, companyName: pol.companyName,
                          annualPremium: pol.annualPremium, currentCashValue: pol.currentCashValue,
                        }])
                      }
                    }} style={{
                      fontSize: 12, padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: 'Inter',
                      border: `1px solid ${selected ? '#2D5A4E' : 'var(--cream3)'}`,
                      background: selected ? '#D1FAE5' : '#fff',
                      color: selected ? '#1E4D35' : 'var(--ink2)',
                    }}>
                      {selected ? '✓ ' : ''}{pol.policyName || pol.companyName}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Benefits / Limitations */}
        <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={S.lbl}>Benefits</label>
            <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 70, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.benefits} onChange={e => upd('benefits', e.target.value)} placeholder="Key benefits…" />
          </div>
          <div>
            <label style={S.lbl}>Limitations</label>
            <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 70, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.limitations} onChange={e => upd('limitations', e.target.value)} placeholder="Limitations or trade-offs…" />
          </div>
        </div>

        {/* Summary bar */}
        {(totalInvested > 0 || projValue > 0) && (
          <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { label: 'Total invested', val: fmt(totalInvested), color: '#854F0B' },
              { label: 'Projected value', val: fmt(projValue), color: '#1E4D35' },
              { label: irr > 0 ? `Projected gain (${irr.toFixed(1)}% IRR)` : 'Projected gain', val: (gain >= 0 ? '+' : '') + fmt(gain), color: gain >= 0 ? '#1E4D35' : '#9B1C1C' },
            ].map(m => (
              <div key={m.label} style={{ background: 'var(--cream)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--cream3)' }}>
                <div style={S.lbl}>{m.label}</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 600, color: m.color }}>{m.val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--cream3)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {rec.isChosen ? (
            <>
              <button onClick={() => setShowImpact(true)} style={{
                fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter',
                border: '1px solid #2D5A4E', background: 'transparent', color: '#2D5A4E', fontWeight: 600,
              }}>View impact</button>
              <button onClick={onChoose} style={{
                fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter',
                border: '1px solid var(--cream3)', background: 'transparent', color: 'var(--ink2)',
              }}>Unmark as chosen</button>
            </>
          ) : (
            <button onClick={onChoose} style={{
              fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter',
              border: 'none', background: 'var(--charcoal)', color: 'var(--cream)', fontWeight: 600,
            }}>Mark as chosen</button>
          )}
          <button onClick={onDelete} style={{
            fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter',
            border: '1px solid var(--cream3)', background: 'transparent', color: '#9B1C1C', marginLeft: 'auto',
          }}>Remove</button>
        </div>
      </div>

      {showImpact && (
        <AccImpactModal
          rec={rec}
          goals={goals}
          existingPortfolioValue={existingPortfolioValue}
          onClose={() => setShowImpact(false)}
        />
      )}
    </>
  )
}

// ─── SECTION HEADER ───────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle, onAdd, canAdd }: {
  title: string; subtitle: string; onAdd: () => void; canAdd: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid var(--cream3)' }}>
      <div>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.1 }}>{title}</div>
        <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', marginTop: 3 }}>{subtitle}</div>
      </div>
      <button
        onClick={onAdd}
        disabled={!canAdd}
        style={{
          background: canAdd ? 'var(--charcoal)' : 'var(--cream3)', color: canAdd ? 'var(--cream)' : 'var(--ink3)',
          border: 'none', borderRadius: 6, padding: '8px 16px', fontFamily: 'Inter', fontSize: 12,
          cursor: canAdd ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
        {canAdd ? 'Add option' : 'Max 3 options'}
      </button>
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function RecommendationsPage() {
  const supabase = createClient()
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState('Client')
  const [data, setData] = useState<RecPageData>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Existing policies from protection_portfolio
  const [existingPolicies, setExistingPolicies] = useState<{
    id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number
  }[]>([])

  // Goals for accumulation waterfall
  const [goals, setGoals] = useState<GoalItem[]>([])
  const [existingPortfolioValue, setExistingPortfolioValue] = useState(0)

  useEffect(() => {
    const id = localStorage.getItem('selectedClientId')
    if (id) setClientId(id)
  }, [])

  useEffect(() => { if (clientId) loadAll(clientId) }, [clientId])

  async function loadAll(id: string) {
    try {
      setError(null)
      const { data: ffRows } = await supabase
        .from('fact_finding').select('section,data').eq('client_id', id)
        .in('section', ['financials', 'protection_portfolio', 'capital_mandate', 'retirement', 'education', 'accumulation', 'strategic_recommendations_v2'])

      const by: Record<string, any> = {}
      if (ffRows) ffRows.forEach((r: any) => { by[r.section] = r.data })

      // Client name
      const fin = by['financials'] ?? {}
      const cName = fin?.client?.firstName
        ? `${fin.client.firstName} ${fin.client.lastName || ''}`.trim()
        : 'Client'
      setClientName(cName)

      // Existing policies from protection_portfolio
      const pPort = by['protection_portfolio'] ?? {}
      const policies: any[] = pPort?.risk_management?.policies ?? []
      const ACTIVE = ['In-Force', 'Premium Holiday', 'Paid-up']
      const mapped = policies
        .filter((p: any) => ACTIVE.includes(p.status))
        .map((p: any) => {
          const premFreq = p.frequency || p.premiumMode || 'Annual'
          const annualPrem = premFreq === 'Monthly'
            ? (p.premiumCash || 0) * 12
            : premFreq === 'Quarterly'
              ? (p.premiumCash || 0) * 4
              : (p.premiumCash || 0)
          return {
            id: p.id,
            policyName: p.productName || p.briefDescription || '',
            companyName: p.companyName || '',
            annualPremium: annualPrem,
            currentCashValue: p.currentCashValue || 0,
          }
        })
      setExistingPolicies(mapped)

      // Goals for waterfall
      const cm = by['capital_mandate'] ?? {}
      const ret = by['retirement'] ?? {}
      const edu = by['education'] ?? {}
      const clientAge = fin?.client?.age
        ? Number(fin.client.age)
        : fin?.client?.dob
          ? new Date().getFullYear() - Number(String(fin.client.dob).slice(0, 4))
          : 35

      const builtGoals: GoalItem[] = []
      // Retirement
      const retCorpus = ret?.corpusNeeded || cm?.settings?.retirementCorpus || 0
      const retAge = ret?.ret?.client?.retirementAge || ret?.retirementAge || 65
      if (retCorpus > 0) {
        builtGoals.push({ id: 'retirement', label: 'Retirement', icon: '🌅', targetCorpus: retCorpus, targetAge: retAge, existingProjected: 0 })
      }
      // Education goals
      ;(edu?.edu?.children || []).forEach((c: any) => {
        if ((c.corpus || 0) > 0) {
          builtGoals.push({ id: `edu_${c.childId || c.name}`, label: `${c.name}'s Education`, icon: '🎓', targetCorpus: c.corpus, targetAge: clientAge + (c.yearsAway || 18), existingProjected: 0 })
        }
      })
      // Custom goals from capital mandate
      ;(cm?.customGoals || []).forEach((g: any) => {
        if ((g.targetCorpus || 0) > 0) {
          builtGoals.push({ id: g.id || `goal_${g.label}`, label: g.label, icon: g.icon || '✦', targetCorpus: g.targetCorpus, targetAge: g.targetAge || 0, existingProjected: 0 })
        }
      })

      // Sort by target age
      builtGoals.sort((a, b) => a.targetAge - b.targetAge)
      setGoals(builtGoals)

      // Existing portfolio projected value from capital mandate
      const portValue = cm?.retirementShortfall != null
        ? Math.max(0, (cm?.settings?.retirementCorpus || 0) - (cm?.retirementShortfall || 0))
        : 0
      setExistingPortfolioValue(portValue)

      // Load saved recommendations
      const saved = by['strategic_recommendations_v2']
      if (saved?.protection || saved?.accumulation) {
        setData({ protection: saved.protection || [], accumulation: saved.accumulation || [] })
      } else {
        setData(EMPTY)
      }
    } catch (e: any) {
      setError('Failed to load: ' + e.message)
    }
  }

  const schedSave = useCallback((d: RecPageData) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(d), 1200)
  }, [clientId])

  async function save(d: RecPageData) {
    if (!clientId) return
    setSaving(true)
    try {
      const payload = { ...d, updatedAt: new Date().toISOString() }
      const { data: rows } = await supabase.from('fact_finding').select('id')
        .eq('client_id', clientId).eq('section', 'strategic_recommendations_v2')
      if (rows && rows.length > 0) {
        await supabase.from('fact_finding').update({ data: payload }).eq('id', rows[0].id)
      } else {
        await supabase.from('fact_finding').insert({ client_id: clientId, section: 'strategic_recommendations_v2', data: payload })
      }
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2000)
    } catch (e) { console.error('Save failed', e) }
    setSaving(false)
  }

  function handleChange(d: RecPageData) { setData(d); schedSave(d) }

  // ── Protection helpers ──────────────────────────────────────────────────────
  function addProt() {
    if (data.protection.length >= 3) return
    const rank = RANK_LABELS[data.protection.length]
    const rec: ProtRec = {
      id: newId(), rank, mode: 'new', productName: '', insurer: '', coverageType: '',
      sumAssured: 0, annualPremium: 0, premiumTerm: '', policyTerm: '',
      benefits: '', limitations: '', replacedPolicies: [], isChosen: false,
    }
    handleChange({ ...data, protection: [...data.protection, rec] })
  }
  function updateProt(id: string, r: ProtRec) {
    handleChange({ ...data, protection: data.protection.map(x => x.id === id ? r : x) })
  }
  function deleteProt(id: string) {
    const next = data.protection.filter(x => x.id !== id).map((r, i) => ({ ...r, rank: RANK_LABELS[i] }))
    handleChange({ ...data, protection: next })
  }
  function chooseProt(id: string) {
    handleChange({ ...data, protection: data.protection.map(r => ({ ...r, isChosen: r.id === id ? !r.isChosen : false })) })
  }

  // ── Accumulation helpers ────────────────────────────────────────────────────
  function addAcc() {
    if (data.accumulation.length >= 3) return
    const rank = RANK_LABELS[data.accumulation.length]
    const rec: AccRec = {
      id: newId(), rank, mode: 'new', productType: '', company: '', planType: '',
      hasLumpSum: false, lumpSumAmount: 0, hasRegular: true,
      regularFreq: 'Monthly', regularAmount: 0, regularYears: 0,
      projMethod: 'illustration', illusTerm: 0, illusGuaranteed: 0, illusNonGuaranteed: 0,
      rateYears: 0, rateReturn: 0, replacedPolicies: [], benefits: '', limitations: '',
      allocatedGoalIds: [], isChosen: false,
    }
    handleChange({ ...data, accumulation: [...data.accumulation, rec] })
  }
  function updateAcc(id: string, r: AccRec) {
    handleChange({ ...data, accumulation: data.accumulation.map(x => x.id === id ? r : x) })
  }
  function deleteAcc(id: string) {
    const next = data.accumulation.filter(x => x.id !== id).map((r, i) => ({ ...r, rank: RANK_LABELS[i] }))
    handleChange({ ...data, accumulation: next })
  }
  function chooseAcc(id: string) {
    handleChange({ ...data, accumulation: data.accumulation.map(r => ({ ...r, isChosen: r.id === id ? !r.isChosen : false })) })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Hero band */}
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div style={{ paddingTop: 32, paddingBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9A9690', marginBottom: 6 }}>
                Advisory Summary
              </div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 30, fontWeight: 300, color: '#F0EDE8', lineHeight: 1.1 }}>
                Strategic Recommendations
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 12, color: '#9A9690', marginTop: 6, fontStyle: 'italic' }}>
                {clientName} · Product recommendations &amp; impact analysis
              </div>
            </div>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: saveOk ? '#4A9E8A' : saving ? '#c8a96e' : 'transparent', transition: 'color 0.3s' }}>
              {saveOk ? '✓ Saved' : saving ? 'Saving…' : '.'}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '32px 48px', maxWidth: 1100 }}>
        {error && (
          <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontFamily: 'Inter', fontSize: 13, color: '#9B1C1C' }}>
            {error}
          </div>
        )}

        {/* ── Wealth Protection ── */}
        <div style={S.sectionWrap}>
          <SectionHeader
            title="Wealth protection"
            subtitle="Insurance & risk coverage recommendations (max 3 options)"
            onAdd={addProt}
            canAdd={data.protection.length < 3}
          />
          {data.protection.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', fontStyle: 'italic' }}>
              No protection recommendations yet — click <strong>Add option</strong> to begin
            </div>
          ) : (
            data.protection.map((rec, idx) => (
              <ProtCard
                key={rec.id}
                rec={rec}
                rankIdx={idx}
                onChange={r => updateProt(rec.id, r)}
                onDelete={() => deleteProt(rec.id)}
                onChoose={() => chooseProt(rec.id)}
                existingPolicies={existingPolicies}
                canAddMore={data.protection.length < 3}
              />
            ))
          )}
        </div>

        {/* ── Wealth Accumulation ── */}
        <div style={S.sectionWrap}>
          <SectionHeader
            title="Wealth accumulation"
            subtitle="Investment & savings recommendations (max 3 options)"
            onAdd={addAcc}
            canAdd={data.accumulation.length < 3}
          />
          {data.accumulation.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', fontStyle: 'italic' }}>
              No accumulation recommendations yet — click <strong>Add option</strong> to begin
            </div>
          ) : (
            data.accumulation.map((rec, idx) => (
              <AccCard
                key={rec.id}
                rec={rec}
                rankIdx={idx}
                onChange={r => updateAcc(rec.id, r)}
                onDelete={() => deleteAcc(rec.id)}
                onChoose={() => chooseAcc(rec.id)}
                goals={goals}
                existingPortfolioValue={existingPortfolioValue}
                existingPolicies={existingPolicies}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
