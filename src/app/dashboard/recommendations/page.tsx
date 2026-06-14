'use client'
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

type RecMode    = 'new' | 'replacement'
type ContribFreq = 'Monthly' | 'Annual' | 'Quarterly'
type ProjMethod  = 'illustration' | 'rate'
type RankLabel   = 'Recommended' | 'Alternative 1' | 'Alternative 2'
type ProtCategory = 'medical' | 'ltc' | 'expense' | 'general'

const RANK_LABELS: RankLabel[] = ['Recommended', 'Alternative 1', 'Alternative 2']

// Protection categories — maps to ins_categories codes
const PROT_CATEGORIES: { key: ProtCategory; label: string; hint: string; color: string; dbCode: string }[] = [
  { key: 'medical',  label: 'Medical Insurance',             hint: 'Medical & hospitalisation coverage',  color: '#7A9CBF', dbCode: 'medical' },
  { key: 'ltc',      label: 'Long Term Care Protection',     hint: 'LTC / disability income protection',  color: '#9B7BAA', dbCode: 'ltc' },
  { key: 'expense',  label: 'Expense Protection',            hint: 'Life, CI, ECI, Term, Whole Life',     color: '#c8a96e', dbCode: 'life' },
  { key: 'general',  label: 'General Insurance',             hint: 'Personal accident, travel, home',     color: '#8A9A7E', dbCode: 'general' },
]

// Fallback coverage type options per category (used if ins_policy_types not loaded)
const COVERAGE_BY_CATEGORY: Record<ProtCategory, string[]> = {
  medical: ['Integrated Shield Plan', 'MediShield Life Top-up', 'Hospital Rider', 'Critical Illness Rider', 'Medical Rider', 'Other'],
  ltc:     ['Long Term Care Plan', 'Disability Income', 'CareShield Life Supplement', 'Early LTC Rider', 'Other'],
  expense: ['Term Life', 'Whole Life', 'Universal Life', 'IUL/VUL', 'Critical Illness', 'Early CI', 'Multi-pay CI', 'CI Rider', 'ECI Rider', 'TPD Rider', 'Personal Accident', 'Other'],
  general: ['Home Insurance', 'Personal Accident', 'Travel Insurance', 'Foreign Domestic Worker', 'Motor Insurance', 'Other'],
}

const PLAN_TYPES = [
  '101 ILP', 'ILP', 'Endowment', 'Unit Trust', 'Annuity',
  'Indexed Savings', 'RSP', 'CPF Top-up (OA)', 'CPF Top-up (SA)',
  'CPF Top-up (MA)', 'SRS', 'Cash Savings', 'Other',
]

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ReplacedPolicy {
  policyId: string
  policyName: string
  companyName: string
  annualPremium: number
  currentCashValue: number
}

interface ProtRec {
  id: string
  rank: RankLabel
  mode: RecMode
  productName: string
  insurer: string
  coverageType: string
  sumAssured: number
  annualPremium: number
  premiumTerm: string
  policyTerm: string
  benefits: string
  limitations: string
  replacedPolicies: ReplacedPolicy[]
  isChosen: boolean
}

interface AccRec {
  id: string
  rank: RankLabel
  mode: RecMode
  productType: string
  company: string
  planType: string
  hasLumpSum: boolean
  lumpSumAmount: number
  hasRegular: boolean
  regularFreq: ContribFreq
  regularAmount: number
  regularYears: number
  projMethod: ProjMethod
  illusTerm: number
  illusGuaranteed: number
  illusNonGuaranteed: number
  rateYears: number
  rateReturn: number
  replacedPolicies: ReplacedPolicy[]
  benefits: string
  limitations: string
  allocatedGoalIds: string[]
  isChosen: boolean
}

interface MedicalRider {
  insurer: string
  productName: string
  annualPremium: number
}

type MedCoverageMode = 'main_only' | 'main_rider' | 'rider_only' | 'international'

interface MedicalRec {
  id: string
  rank: RankLabel
  mode: RecMode
  // Main plan
  insurer: string
  productName: string
  coverageMode: MedCoverageMode   // replaces old coverageType
  briefCoverage: string           // dropdown selection
  briefCoverageOther: string      // free text if 'other' selected
  premiumMedisave: number
  premiumCash: number
  premiumTerm: string
  // Rider (shown when coverageMode includes rider)
  rider: MedicalRider
  // Text
  benefits: string
  limitations: string
  // Replacement
  replacedPolicies: ReplacedPolicy[]
  isChosen: boolean
}

interface RecPageData {
  // keyed by person tab: 'client' | 'spouse' | child id
  medicalByPerson: Record<string, MedicalRec[]>
  ltc: ProtRec[]
  expense: ProtRec[]
  general: ProtRec[]
  accumulation: AccRec[]
}

const EMPTY: RecPageData = { medicalByPerson: {}, ltc: [], expense: [], general: [], accumulation: [] }

function medisaveLimit(age: number): number {
  if (age < 40) return 300
  if (age < 61) return 600
  return 900
}

interface InsProduct { id: number; company_id: number; category_id: number; name: string }

const BRIEF_COVERAGE_MAIN: string[] = [
  'As-Charged — Private Hospital',
  'As-Charged — Restructured Ward A',
  'As-Charged — Restructured Ward B',
  'As-Charged — Restructured Ward C',
  'International Plan',
  'Other',
]
const BRIEF_COVERAGE_RIDER: string[] = [
  'Coverage of Deductible & 50% Co-Insurance',
  'Coverage of Deductible Only',
  'Coverage of Co-Insurance Only',
  'Full Rider (Deductible + Co-Insurance)',
  'Other',
]

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

function calcTotalInvested(rec: AccRec): number {
  const lump = rec.hasLumpSum ? (rec.lumpSumAmount || 0) : 0
  const perYear = rec.regularFreq === 'Monthly' ? 12 : rec.regularFreq === 'Quarterly' ? 4 : 1
  const reg = rec.hasRegular ? (rec.regularAmount || 0) * perYear * (rec.regularYears || 0) : 0
  return lump + reg
}

function calcProjectedValue(rec: AccRec): number {
  if (rec.projMethod === 'illustration') {
    return rec.illusNonGuaranteed > 0 ? rec.illusNonGuaranteed : rec.illusGuaranteed
  }
  const total = calcTotalInvested(rec)
  const r = (rec.rateReturn || 0) / 100
  const y = rec.rateYears || 1
  return total * Math.pow(1 + r, y)
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
    fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.08em',
    textTransform: 'uppercase' as const, color: 'var(--ink3)', marginBottom: 3, display: 'block',
  } as React.CSSProperties,
  card: {
    background: '#fff', border: '1px solid var(--cream3)', borderRadius: 10,
    overflow: 'hidden', marginBottom: 12,
  } as React.CSSProperties,
  sectionWrap: {
    background: 'var(--cream)', border: '1px solid var(--cream3)', borderRadius: 10,
    padding: 24, marginBottom: 20,
  } as React.CSSProperties,
}

// ─── SMALL UI PIECES ──────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: RankLabel }) {
  const isRec = rank === 'Recommended'
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, fontFamily: 'Inter',
      background: isRec ? '#D1FAE5' : 'var(--cream2)', color: isRec ? '#1E4D35' : 'var(--ink3)',
      display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
    }}>
      {isRec && '★ '}{rank}
    </span>
  )
}

function ChosenBadge() {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, fontFamily: 'Inter',
      background: '#D1FAE5', color: '#1E4D35', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
    }}>✓ Client chosen</span>
  )
}

function ModeToggle({ mode, onChange }: { mode: RecMode; onChange: (m: RecMode) => void }) {
  return (
    <div style={{
      display: 'flex', border: '1px solid var(--cream3)', borderRadius: 6,
      overflow: 'hidden', marginLeft: 'auto', flexShrink: 0,
    }}>
      {(['new', 'replacement'] as RecMode[]).map(m => (
        <button key={m} onClick={() => onChange(m)} style={{
          fontSize: 12, padding: '4px 12px', border: 'none', cursor: 'pointer', fontFamily: 'Inter',
          background: mode === m ? 'var(--cream2)' : 'transparent',
          color: mode === m ? 'var(--ink)' : 'var(--ink3)',
          fontWeight: mode === m ? 600 : 400,
        }}>{m === 'new' ? 'New addition' : 'Replacement'}</button>
      ))}
    </div>
  )
}

// ─── COMPARE TABLE ────────────────────────────────────────────────────────────

function CompareTable({ replaced, newPremium, newSA, newCoverageType }: {
  replaced: ReplacedPolicy[]; newPremium: number; newSA: number; newCoverageType: string
}) {
  const oldTotal = replaced.reduce((s, p) => s + p.annualPremium, 0)
  const delta = newPremium - oldTotal
  const td: React.CSSProperties = { padding: '6px 10px', fontFamily: 'Inter', fontSize: 12, borderBottom: '1px solid var(--cream3)' }
  const th: React.CSSProperties = { ...td, fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink3)', background: 'var(--cream2)', fontWeight: 600 }
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ ...S.lbl, marginBottom: 6 }}>Side-by-side comparison</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--cream3)', borderRadius: 6, overflow: 'hidden' }}>
        <thead><tr><th style={th}></th><th style={th}>Existing (combined)</th><th style={th}>New product</th><th style={th}>Change</th></tr></thead>
        <tbody>
          <tr>
            <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>Annual premium</td>
            <td style={{ ...td, color: '#9B1C1C' }}>{fmt(oldTotal)}</td>
            <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{fmt(newPremium)}</td>
            <td style={{ ...td, color: delta > 0 ? '#9B1C1C' : '#1E4D35', fontWeight: 600 }}>
              {delta > 0 ? '+' : ''}{fmt(delta)} / yr
            </td>
          </tr>
          {newSA > 0 && (
            <tr>
              <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>Sum assured / benefit</td>
              <td style={{ ...td, color: '#9B1C1C' }}>—</td>
              <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{fmt(newSA)}</td>
              <td style={td}>—</td>
            </tr>
          )}
          {newCoverageType && (
            <tr>
              <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>Coverage type</td>
              <td style={{ ...td, color: '#9B1C1C' }}>—</td>
              <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{newCoverageType}</td>
              <td style={td}>—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── PROTECTION IMPACT MODAL ──────────────────────────────────────────────────

function ProtImpactModal({ rec, monthlyIncome, monthlyExpenses, onClose }: {
  rec: ProtRec
  monthlyIncome: number
  monthlyExpenses: number
  onClose: () => void
}) {
  const [cvValues, setCvValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    rec.replacedPolicies.forEach(p => { init[p.policyId] = p.currentCashValue || 0 })
    return init
  })

  const oldPremium   = rec.replacedPolicies.reduce((s, p) => s + p.annualPremium, 0)
  const netAnnual    = rec.annualPremium - oldPremium          // + = more expensive, - = saving
  const netMonthly   = netAnnual / 12
  const totalCV      = Object.values(cvValues).reduce((s, v) => s + v, 0)
  const policyTermYrs = parseInt(rec.policyTerm) || 20
  const yearsCV      = netAnnual > 0 ? Math.floor(totalCV / netAnnual) : 999

  // Cash flow impact
  const currentSurplusMonthly = monthlyIncome - monthlyExpenses
  const newSurplusMonthly     = currentSurplusMonthly - netMonthly
  // For new addition there is no "old premium freed up"
  const isReplacement = rec.mode === 'replacement'
  const newAdditionMonthly = !isReplacement ? rec.annualPremium / 12 : 0
  const surplusAfter = isReplacement
    ? currentSurplusMonthly - netMonthly
    : currentSurplusMonthly - newAdditionMonthly

  const totalNetOutcome = totalCV - Math.max(0, netAnnual) * policyTermYrs

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  const modal: React.CSSProperties = {
    background: '#fff', borderRadius: 12, border: '1px solid var(--cream3)',
    width: 580, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', padding: '28px',
  }

  function metCard(label: string, val: string, sub: string, col: string) {
    return (
      <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
        <div style={S.lbl}>{label}</div>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: col }}>{val}</div>
        {sub && <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{sub}</div>}
      </div>
    )
  }

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={modal}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>Impact analysis</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', marginBottom: 16 }}>{rec.productName}{rec.insurer ? ` — ${rec.insurer}` : ''}</div>

        {/* Premium impact */}
        <div style={{ ...S.lbl, marginBottom: 8 }}>Premium impact</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          {metCard('New annual premium', fmt(rec.annualPremium), rec.premiumTerm ? `${rec.premiumTerm} payment term` : '', '#854F0B')}
          {isReplacement
            ? metCard('Old premiums freed up', fmt(oldPremium) + ' / yr', `${rec.replacedPolicies.length} polic${rec.replacedPolicies.length === 1 ? 'y' : 'ies'} cancelled`, '#1E4D35')
            : metCard('Coverage', fmt(rec.sumAssured), rec.coverageType || 'Sum assured / benefit', '#1E4D35')
          }
          {isReplacement && metCard(
            'Net annual change',
            (netAnnual > 0 ? '+' : '') + fmt(netAnnual) + ' / yr',
            netAnnual > 0 ? 'Additional outflow' : 'Annual savings',
            netAnnual > 0 ? '#9B1C1C' : '#1E4D35'
          )}
          {isReplacement && metCard('Coverage increase', fmt(rec.sumAssured), rec.coverageType || 'Sum assured', '#1E4D35')}
        </div>

        {/* Cash flow impact — from Financial Profile */}
        <div style={{ borderTop: '1px solid var(--cream3)', paddingTop: 16, marginBottom: 20 }}>
          <div style={{ ...S.lbl, marginBottom: 10 }}>Cash flow impact</div>
          {monthlyIncome === 0 && monthlyExpenses === 0 ? (
            <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>
              Cash flow data not available — please complete the Financial Profile first.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {metCard('Monthly income', fmt(monthlyIncome) + ' / mo', 'From Financial Profile', 'var(--ink2)')}
              {metCard(
                'Monthly expenses (after)',
                fmt(monthlyExpenses + (isReplacement ? netMonthly : newAdditionMonthly)) + ' / mo',
                isReplacement
                  ? (netMonthly > 0 ? `+${fmt(netMonthly)}/mo net increase` : `${fmt(Math.abs(netMonthly))}/mo net saving`)
                  : `+${fmt(newAdditionMonthly)}/mo new premium`,
                '#854F0B'
              )}
              {metCard(
                'Monthly surplus (after)',
                fmt(surplusAfter) + ' / mo',
                surplusAfter >= 0 ? 'Positive cashflow' : 'Cashflow deficit',
                surplusAfter >= 0 ? '#1E4D35' : '#9B1C1C'
              )}
            </div>
          )}
        </div>

        {/* Cash value section — replacements only */}
        {isReplacement && rec.replacedPolicies.length > 0 && (
          <div style={{ borderTop: '1px solid var(--cream3)', paddingTop: 16 }}>
            <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>Cash value mitigation</div>
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
            <div style={{ borderTop: '1px solid var(--cream3)', paddingTop: 10, marginTop: 4 }}>
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
              <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: totalNetOutcome >= 0 ? '#1E4D35' : '#9B1C1C' }}>
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

interface GoalItem { id: string; label: string; icon: string; targetCorpus: number; targetAge: number }

function AccImpactModal({ rec, goals, existingPortfolioValue, monthlyIncome, monthlyExpenses, onClose }: {
  rec: AccRec; goals: GoalItem[]; existingPortfolioValue: number
  monthlyIncome: number; monthlyExpenses: number; onClose: () => void
}) {
  const [view, setView] = useState<'existing' | 'with'>('existing')
  const [orderedGoals, setOrderedGoals] = useState<GoalItem[]>(() => [...goals].sort((a, b) => a.targetAge - b.targetAge))
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const totalInvested  = calcTotalInvested(rec)
  const projValue      = calcProjectedValue(rec)
  const gain           = projValue - totalInvested
  const annualContrib  = calcAnnualContrib(rec)
  const monthlyContrib = annualContrib / 12
  const irr = calcIRR(totalInvested, projValue, rec.projMethod === 'illustration' ? rec.illusTerm : rec.rateYears)
  const surplusAfter   = (monthlyIncome - monthlyExpenses) - monthlyContrib

  // Waterfall
  const portfolioBase = view === 'existing' ? existingPortfolioValue : existingPortfolioValue + projValue
  let remaining = portfolioBase
  const goalResults = orderedGoals.map(g => {
    const funded = Math.min(remaining, g.targetCorpus)
    remaining = Math.max(0, remaining - g.targetCorpus)
    const shortfall = Math.max(0, g.targetCorpus - funded)
    const pct = g.targetCorpus > 0 ? Math.min(100, Math.round((funded / g.targetCorpus) * 100)) : 100
    return { ...g, funded, shortfall, pct }
  })

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

  const statusBg    = (p: number) => p >= 100 ? '#D1FAE5' : p >= 60 ? '#FEF3C7' : '#FEE2E2'
  const statusColor = (p: number) => p >= 100 ? '#1E4D35' : p >= 60 ? '#854F0B' : '#9B1C1C'
  const statusLabel = (p: number) => p >= 100 ? 'Fully funded' : p >= 60 ? 'Partially funded' : 'Shortfall'
  const barColor    = (p: number) => p >= 100 ? '#2D5A4E' : p >= 60 ? '#c8a96e' : '#9B1C1C'

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }
  const modal:   React.CSSProperties = { background: '#fff', borderRadius: 12, border: '1px solid var(--cream3)', width: 600, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', padding: '28px' }

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={modal}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>Impact analysis</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', marginBottom: 16 }}>{rec.productType || rec.planType} — {rec.company}</div>

        {/* Investment figures */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Total invested',   val: fmt(totalInvested), col: '#854F0B' },
            { label: 'Projected value',  val: fmt(projValue),     col: '#1E4D35' },
            { label: 'Projected gain',   val: (gain >= 0 ? '+' : '') + fmt(gain), col: gain >= 0 ? '#1E4D35' : '#9B1C1C' },
          ].map(m => (
            <div key={m.label} style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
              <div style={S.lbl}>{m.label}</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: m.col }}>{m.val}</div>
            </div>
          ))}
        </div>

        {/* Cash flow impact */}
        <div style={{ borderTop: '1px solid var(--cream3)', paddingTop: 16, marginBottom: 16 }}>
          <div style={{ ...S.lbl, marginBottom: 10 }}>Cash flow impact</div>
          {monthlyIncome === 0 && monthlyExpenses === 0 ? (
            <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>
              Cash flow data not available — please complete the Financial Profile first.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
              {[
                { label: 'Monthly income',       val: fmt(monthlyIncome) + ' / mo',    col: 'var(--ink2)' },
                { label: 'New monthly outflow',  val: fmt(monthlyContrib) + ' / mo',   col: '#854F0B' },
                { label: 'Annual contribution',  val: fmt(annualContrib) + ' / yr',    col: '#854F0B' },
                { label: 'Monthly surplus after',val: fmt(surplusAfter) + ' / mo', col: surplusAfter >= 0 ? '#1E4D35' : '#9B1C1C' },
              ].map(m => (
                <div key={m.label} style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
                  <div style={S.lbl}>{m.label}</div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 600, color: m.col }}>{m.val}</div>
                </div>
              ))}
            </div>
          )}
          {irr > 0 && (
            <div style={{ marginTop: 10, fontFamily: 'Inter', fontSize: 12, color: 'var(--ink2)' }}>
              Projected IRR: <strong style={{ color: '#1E4D35' }}>{irr.toFixed(1)}% p.a.</strong>
            </div>
          )}
        </div>

        {/* Goal waterfall */}
        {orderedGoals.length > 0 && (
          <div style={{ borderTop: '1px solid var(--cream3)', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Goal progress</div>
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
              Drag to reorder priority. Portfolio waterfall funds goals in order shown.
            </div>
            {goalResults.map((g, idx) => (
              <div key={g.id} draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={e => onDragOver(e, idx)}
                onDragEnd={onDragEnd}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0',
                  borderBottom: idx < goalResults.length - 1 ? '1px solid var(--cream3)' : 'none',
                  cursor: 'grab', opacity: dragIdx === idx ? 0.5 : 1,
                }}
              >
                <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, background: statusBg(g.pct), color: statusColor(g.pct) }}>
                  {g.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{g.label}</div>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, fontFamily: 'Inter', background: statusBg(g.pct), color: statusColor(g.pct) }}>
                      {statusLabel(g.pct)}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginBottom: 6 }}>Target age {g.targetAge} · Need {fmt(g.targetCorpus)}</div>
                  <div style={{ height: 6, background: 'var(--cream3)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{ width: `${g.pct}%`, height: '100%', background: barColor(g.pct), borderRadius: 3, transition: 'width 0.4s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'Inter', fontSize: 11 }}>
                    <span style={{ color: statusColor(g.pct) }}>{fmt(g.funded)} covered</span>
                    {g.shortfall > 0 && <span style={{ color: '#9B1C1C' }}>{fmt(g.shortfall)} short</span>}
                  </div>
                </div>
                <div style={{ color: 'var(--ink3)', fontSize: 14, paddingTop: 6 }}>⠿</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── MEDICAL CARD ────────────────────────────────────────────────────────────

const COVERAGE_MODE_LABELS: Record<MedCoverageMode, string> = {
  main_only:    'Main Plan Only',
  main_rider:   'Main Plan + Rider',
  rider_only:   'Rider Only',
  international:'International Medical Plan',
}

function MedicalCard({ rec, personAge, onChange, onDelete, onChoose,
  existingPolicies, medicalCompanies, products, monthlyIncome, monthlyExpenses }: {
  rec: MedicalRec
  personAge: number
  onChange: (r: MedicalRec) => void
  onDelete: () => void
  onChoose: () => void
  existingPolicies: { id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number }[]
  medicalCompanies: { id: number; name: string }[]
  products: InsProduct[]
  monthlyIncome: number
  monthlyExpenses: number
}) {
  const [showImpact, setShowImpact] = useState(false)
  function upd<K extends keyof MedicalRec>(k: K, v: MedicalRec[K]) { onChange({ ...rec, [k]: v }) }
  function updRider<K extends keyof MedicalRider>(k: K, v: MedicalRider[K]) { onChange({ ...rec, rider: { ...rec.rider, [k]: v } }) }

  const msLimit = medisaveLimit(personAge)
  const totalMainPremium = (rec.premiumMedisave || 0) + (rec.premiumCash || 0)
  const hasRider = rec.coverageMode === 'main_rider' || rec.coverageMode === 'rider_only'
  const hasMain  = rec.coverageMode === 'main_only'  || rec.coverageMode === 'main_rider'
  const isIntl   = rec.coverageMode === 'international'

  // Brief coverage options depend on mode
  const briefOptions = rec.coverageMode === 'rider_only' ? BRIEF_COVERAGE_RIDER
    : rec.coverageMode === 'international' ? ['International As-Charged', 'Other']
    : BRIEF_COVERAGE_MAIN

  // Products filtered by insurer (main)
  const selComp = medicalCompanies.find(c => c.name === rec.insurer)
  const filteredProducts = selComp ? products.filter(p => p.company_id === selComp.id) : []

  // Rider products filtered by rider insurer
  const riderComp = medicalCompanies.find(c => c.name === (rec.rider?.insurer || ''))
  const riderProducts = riderComp ? products.filter(p => p.company_id === riderComp.id) : []

  function togglePolicy(pol: typeof existingPolicies[0]) {
    const exists = rec.replacedPolicies.find(p => p.policyId === pol.id)
    if (exists) upd('replacedPolicies', rec.replacedPolicies.filter(p => p.policyId !== pol.id))
    else upd('replacedPolicies', [...rec.replacedPolicies, { policyId: pol.id, policyName: pol.policyName, companyName: pol.companyName, annualPremium: pol.annualPremium, currentCashValue: pol.currentCashValue }])
  }

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

        {/* Row 1: Coverage mode + Insurer + Product + Brief Coverage */}
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px' }}>
          {/* Coverage mode */}
          <div>
            <label style={S.lbl}>Coverage type</label>
            <select style={S.inp} value={rec.coverageMode}
              onChange={e => upd('coverageMode', e.target.value as MedCoverageMode)}>
              {(Object.keys(COVERAGE_MODE_LABELS) as MedCoverageMode[]).map(k => (
                <option key={k} value={k}>{COVERAGE_MODE_LABELS[k]}</option>
              ))}
            </select>
          </div>
          {/* Insurer — medical-filtered */}
          <div>
            <label style={S.lbl}>Insurer</label>
            <select style={S.inp} value={rec.insurer}
              onChange={e => onChange({ ...rec, insurer: e.target.value, productName: '' })}>
              <option value="">Select insurer…</option>
              {medicalCompanies.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          {/* Product — filtered by insurer */}
          <div>
            <label style={S.lbl}>Product name</label>
            <select style={S.inp} value={rec.productName} onChange={e => upd('productName', e.target.value)}
              disabled={!rec.insurer}>
              <option value="">{rec.insurer ? 'Select product…' : 'Select insurer first'}</option>
              {filteredProducts.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>

          {/* Brief coverage */}
          <div>
            <label style={S.lbl}>Brief coverage</label>
            <select style={S.inp} value={rec.briefCoverage}
              onChange={e => onChange({ ...rec, briefCoverage: e.target.value, briefCoverageOther: e.target.value !== 'Other' ? '' : rec.briefCoverageOther })}>
              <option value="">Select…</option>
              {briefOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          {rec.briefCoverage === 'Other' && (
            <div style={{ gridColumn: '2/4' }}>
              <label style={S.lbl}>Specify coverage</label>
              <input style={S.inp} value={rec.briefCoverageOther}
                onChange={e => upd('briefCoverageOther', e.target.value)}
                placeholder="Describe the coverage…" />
            </div>
          )}

          {/* Premium term — only for main/intl */}
          {(hasMain || isIntl) && (
            <div>
              <label style={S.lbl}>Premium term</label>
              <input style={S.inp} value={rec.premiumTerm}
                onChange={e => upd('premiumTerm', e.target.value)} placeholder="e.g. Annual" />
            </div>
          )}
        </div>

        {/* Main plan premium breakdown */}
        {(hasMain || isIntl) && (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={S.lbl}>Main plan premium</div>
                {!isIntl && (
                  <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>
                    Medisave limit age {personAge}: <strong style={{ color: '#7A9CBF' }}>S${msLimit}/yr</strong>
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isIntl ? '1fr 1fr' : '1fr 1fr 1fr', gap: '8px 12px' }}>
                {!isIntl && (
                  <div>
                    <label style={S.lbl}>Medisave (S$/yr)</label>
                    <input type="number"
                      style={{ ...S.inp, borderColor: (rec.premiumMedisave || 0) > msLimit ? '#FCA5A5' : undefined }}
                      value={rec.premiumMedisave || ''} placeholder="0"
                      onChange={e => upd('premiumMedisave', Number(e.target.value))} />
                    {(rec.premiumMedisave || 0) > msLimit && (
                      <div style={{ fontFamily: 'Inter', fontSize: 10, color: '#9B1C1C', marginTop: 2 }}>Exceeds limit</div>
                    )}
                  </div>
                )}
                <div>
                  <label style={S.lbl}>Cash (S$/yr)</label>
                  <input type="number" style={S.inp} value={rec.premiumCash || ''} placeholder="0"
                    onChange={e => upd('premiumCash', Number(e.target.value))} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  <label style={S.lbl}>Total premium</label>
                  <div style={{ ...S.inp, background: 'var(--cream3)', color: 'var(--ink)', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                    S${totalMainPremium.toLocaleString('en-SG')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Rider section */}
        {hasRider && (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
              <div style={{ ...S.lbl, marginBottom: 10 }}>Rider details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 12px' }}>
                <div>
                  <label style={S.lbl}>Rider insurer</label>
                  <select style={S.inp} value={rec.rider?.insurer || ''}
                    onChange={e => onChange({ ...rec, rider: { ...rec.rider, insurer: e.target.value, productName: '' } })}>
                    <option value="">Select insurer…</option>
                    {medicalCompanies.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>Rider product</label>
                  <select style={S.inp} value={rec.rider?.productName || ''}
                    onChange={e => updRider('productName', e.target.value)}
                    disabled={!rec.rider?.insurer}>
                    <option value="">{rec.rider?.insurer ? 'Select product…' : 'Select insurer first'}</option>
                    {riderProducts.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>Rider annual premium (S$)</label>
                  <input type="number" style={S.inp} value={rec.rider?.annualPremium || ''} placeholder="0"
                    onChange={e => updRider('annualPremium', Number(e.target.value))} />
                </div>
              </div>
              {/* Rider brief coverage */}
              <div style={{ marginTop: 10 }}>
                <label style={S.lbl}>Rider coverage</label>
                <select style={S.inp} value={rec.briefCoverage === '' || !BRIEF_COVERAGE_RIDER.includes(rec.briefCoverage) ? '' : rec.briefCoverage}
                  onChange={e => onChange({ ...rec, briefCoverage: e.target.value, briefCoverageOther: e.target.value !== 'Other' ? '' : rec.briefCoverageOther })}>
                  <option value="">Select rider coverage…</option>
                  {BRIEF_COVERAGE_RIDER.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                {rec.briefCoverage === 'Other' && (
                  <input style={{ ...S.inp, marginTop: 8 }} value={rec.briefCoverageOther}
                    onChange={e => upd('briefCoverageOther', e.target.value)} placeholder="Describe rider coverage…" />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Benefits / Limitations */}
        <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={S.lbl}>Benefits</label>
            <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 68, fontFamily: 'Inter', lineHeight: 1.5 }}
              value={rec.benefits} onChange={e => upd('benefits', e.target.value)} placeholder="Key benefits…" />
          </div>
          <div>
            <label style={S.lbl}>Limitations</label>
            <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 68, fontFamily: 'Inter', lineHeight: 1.5 }}
              value={rec.limitations} onChange={e => upd('limitations', e.target.value)} placeholder="Limitations or trade-offs…" />
          </div>
        </div>

        {/* Replacement */}
        {rec.mode === 'replacement' && (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
              <div style={{ ...S.lbl, marginBottom: 10 }}>Replacing existing policies</div>
              {existingPolicies.length === 0 && (
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>No existing policies found.</div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {existingPolicies.map(pol => {
                  const selected = !!rec.replacedPolicies.find(p => p.policyId === pol.id)
                  return (
                    <button key={pol.id} onClick={() => togglePolicy(pol)} style={{
                      fontSize: 12, padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: 'Inter',
                      border: `1px solid ${selected ? '#2D5A4E' : 'var(--cream3)'}`,
                      background: selected ? '#D1FAE5' : '#fff', color: selected ? '#1E4D35' : 'var(--ink2)',
                      fontWeight: selected ? 600 : 400,
                    }}>
                      {selected ? '✓ ' : ''}{pol.policyName || pol.companyName}
                    </button>
                  )
                })}
              </div>
              {rec.replacedPolicies.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <CompareTable
                    replaced={rec.replacedPolicies}
                    newPremium={totalMainPremium + (hasRider ? (rec.rider?.annualPremium || 0) : 0)}
                    newSA={0}
                    newCoverageType={COVERAGE_MODE_LABELS[rec.coverageMode]}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--cream3)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {rec.isChosen ? (
            <>
              <button onClick={() => setShowImpact(true)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: '1px solid #2D5A4E', background: 'transparent', color: '#2D5A4E', fontWeight: 600 }}>View impact</button>
              <button onClick={onChoose} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: '1px solid var(--cream3)', background: 'transparent', color: 'var(--ink2)' }}>Unmark as chosen</button>
            </>
          ) : (
            <button onClick={onChoose} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: 'none', background: 'var(--charcoal)', color: 'var(--cream)', fontWeight: 600 }}>Mark as chosen</button>
          )}
          <button onClick={onDelete} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: '1px solid var(--cream3)', background: 'transparent', color: '#9B1C1C', marginLeft: 'auto' }}>Remove</button>
        </div>
      </div>

      {showImpact && (
        <ProtImpactModal
          rec={{
            ...rec,
            sumAssured: 0,
            coverageType: COVERAGE_MODE_LABELS[rec.coverageMode],
            policyTerm: 'Lifetime renewable',
            annualPremium: totalMainPremium + (hasRider ? (rec.rider?.annualPremium || 0) : 0),
          }}
          monthlyIncome={monthlyIncome}
          monthlyExpenses={monthlyExpenses}
          onClose={() => setShowImpact(false)}
        />
      )}
    </>
  )
}

// ─── PROTECTION CARD ──────────────────────────────────────────────────────────

function ProtCard({ rec, category, onChange, onDelete, onChoose,
  existingPolicies, insurers, coverageTypes, monthlyIncome, monthlyExpenses }: {
  rec: ProtRec
  category: ProtCategory
  onChange: (r: ProtRec) => void
  onDelete: () => void
  onChoose: () => void
  existingPolicies: { id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number }[]
  insurers: string[]
  coverageTypes: string[]
  monthlyIncome: number
  monthlyExpenses: number
}) {
  const [showImpact, setShowImpact] = useState(false)
  function upd<K extends keyof ProtRec>(k: K, v: ProtRec[K]) { onChange({ ...rec, [k]: v }) }

  function togglePolicy(pol: typeof existingPolicies[0]) {
    const exists = rec.replacedPolicies.find(p => p.policyId === pol.id)
    if (exists) upd('replacedPolicies', rec.replacedPolicies.filter(p => p.policyId !== pol.id))
    else upd('replacedPolicies', [...rec.replacedPolicies, { policyId: pol.id, policyName: pol.policyName, companyName: pol.companyName, annualPremium: pol.annualPremium, currentCashValue: pol.currentCashValue }])
  }

  function updateReplacedField(policyId: string, field: 'annualPremium' | 'currentCashValue', val: number) {
    upd('replacedPolicies', rec.replacedPolicies.map(p => p.policyId === policyId ? { ...p, [field]: val } : p))
  }

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
            <label style={S.lbl}>Product name</label>
            <input style={S.inp} value={rec.productName} onChange={e => upd('productName', e.target.value)} placeholder="e.g. MultiPay CI Advantage" />
          </div>
          <div>
            <label style={S.lbl}>Insurer</label>
            <select style={S.inp} value={rec.insurer} onChange={e => upd('insurer', e.target.value)}>
              <option value="">Select insurer…</option>
              {insurers.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Coverage type</label>
            <select style={S.inp} value={rec.coverageType} onChange={e => upd('coverageType', e.target.value)}>
              <option value="">Select type…</option>
              {coverageTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Sum assured (S$)</label>
            <input type="number" style={S.inp} value={rec.sumAssured || ''} onChange={e => upd('sumAssured', Number(e.target.value))} placeholder="0" />
          </div>
          <div>
            <label style={S.lbl}>Annual premium (S$)</label>
            <input type="number" style={S.inp} value={rec.annualPremium || ''} onChange={e => upd('annualPremium', Number(e.target.value))} placeholder="0" />
          </div>
          <div>
            <label style={S.lbl}>Premium term / Policy term</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={S.inp} value={rec.premiumTerm} onChange={e => upd('premiumTerm', e.target.value)} placeholder="e.g. 20 yrs" />
              <input style={S.inp} value={rec.policyTerm} onChange={e => upd('policyTerm', e.target.value)} placeholder="e.g. Life" />
            </div>
          </div>
          <div style={{ gridColumn: '1/3' }}>
            <label style={S.lbl}>Benefits</label>
            <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 68, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.benefits} onChange={e => upd('benefits', e.target.value)} placeholder="Key benefits…" />
          </div>
          <div>
            <label style={S.lbl}>Limitations</label>
            <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 68, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.limitations} onChange={e => upd('limitations', e.target.value)} placeholder="Limitations or trade-offs…" />
          </div>
        </div>

        {/* Replacement section */}
        {rec.mode === 'replacement' && (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
              <div style={{ ...S.lbl, marginBottom: 10 }}>Replacing existing policies</div>
              {existingPolicies.length === 0 && (
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>No existing policies found — add them in the Protection Portfolio tab first.</div>
              )}
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
              {rec.replacedPolicies.length > 0 && (
                <div>
                  {rec.replacedPolicies.map(p => (
                    <div key={p.policyId} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'end', marginBottom: 8 }}>
                      <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink2)', paddingBottom: 6 }}>{p.policyName || p.companyName}</div>
                      <div>
                        <label style={S.lbl}>Annual premium</label>
                        <input type="number" style={{ ...S.inp, width: 120 }} value={p.annualPremium || ''} onChange={e => updateReplacedField(p.policyId, 'annualPremium', Number(e.target.value))} />
                      </div>
                      <div>
                        <label style={S.lbl}>Cash value</label>
                        <input type="number" style={{ ...S.inp, width: 120 }} value={p.currentCashValue || ''} onChange={e => updateReplacedField(p.policyId, 'currentCashValue', Number(e.target.value))} />
                      </div>
                    </div>
                  ))}
                  <CompareTable replaced={rec.replacedPolicies} newPremium={rec.annualPremium} newSA={rec.sumAssured} newCoverageType={rec.coverageType} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--cream3)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {rec.isChosen ? (
            <>
              <button onClick={() => setShowImpact(true)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: '1px solid #2D5A4E', background: 'transparent', color: '#2D5A4E', fontWeight: 600 }}>View impact</button>
              <button onClick={onChoose} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: '1px solid var(--cream3)', background: 'transparent', color: 'var(--ink2)' }}>Unmark as chosen</button>
            </>
          ) : (
            <button onClick={onChoose} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: 'none', background: 'var(--charcoal)', color: 'var(--cream)', fontWeight: 600 }}>Mark as chosen</button>
          )}
          <button onClick={onDelete} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: '1px solid var(--cream3)', background: 'transparent', color: '#9B1C1C', marginLeft: 'auto' }}>Remove</button>
        </div>
      </div>

      {showImpact && <ProtImpactModal rec={rec} monthlyIncome={monthlyIncome} monthlyExpenses={monthlyExpenses} onClose={() => setShowImpact(false)} />}
    </>
  )
}

// ─── ACCUMULATION CARD ────────────────────────────────────────────────────────

function AccCard({ rec, onChange, onDelete, onChoose, goals, existingPortfolioValue, existingPolicies, monthlyIncome, monthlyExpenses }: {
  rec: AccRec; onChange: (r: AccRec) => void; onDelete: () => void; onChoose: () => void
  goals: GoalItem[]; existingPortfolioValue: number
  existingPolicies: { id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number }[]
  monthlyIncome: number; monthlyExpenses: number
}) {
  const [showImpact, setShowImpact] = useState(false)
  function upd<K extends keyof AccRec>(k: K, v: AccRec[K]) { onChange({ ...rec, [k]: v }) }

  const totalInvested = calcTotalInvested(rec)
  const projValue     = calcProjectedValue(rec)
  const gain          = projValue - totalInvested
  const irr           = calcIRR(totalInvested, projValue, rec.projMethod === 'illustration' ? rec.illusTerm : rec.rateYears)
  const borderStyle   = rec.isChosen ? '2px solid #2D5A4E' : '1px solid var(--cream3)'

  return (
    <>
      <div style={{ ...S.card, border: borderStyle }}>
        <div style={{ background: 'var(--cream)', padding: '12px 16px', borderBottom: '1px solid var(--cream3)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <RankBadge rank={rec.rank} />
          {rec.isChosen && <ChosenBadge />}
          <ModeToggle mode={rec.mode} onChange={m => upd('mode', m)} />
        </div>

        {/* Core fields */}
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px' }}>
          <div><label style={S.lbl}>Product / Type</label><input style={S.inp} value={rec.productType} onChange={e => upd('productType', e.target.value)} placeholder="e.g. Gro Capital Ease II" /></div>
          <div><label style={S.lbl}>Company</label><input style={S.inp} value={rec.company} onChange={e => upd('company', e.target.value)} placeholder="e.g. NTUC Income" /></div>
          <div>
            <label style={S.lbl}>Plan</label>
            <select style={S.inp} value={rec.planType} onChange={e => upd('planType', e.target.value)}>
              <option value="">Select…</option>
              {PLAN_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* Contribution */}
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
            <div style={{ ...S.lbl, marginBottom: 10 }}>Contribution structure</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={rec.hasLumpSum} onChange={e => upd('hasLumpSum', e.target.checked)} style={{ accentColor: '#2D5A4E', width: 15, height: 15 }} />
              <span style={{ fontFamily: 'Inter', fontSize: 13 }}>Lump sum</span>
            </label>
            {rec.hasLumpSum && (
              <div style={{ marginLeft: 23, marginBottom: 12 }}>
                <label style={S.lbl}>Amount (S$)</label>
                <input type="number" style={{ ...S.inp, width: 200 }} value={rec.lumpSumAmount || ''} onChange={e => upd('lumpSumAmount', Number(e.target.value))} placeholder="0" />
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={rec.hasRegular} onChange={e => upd('hasRegular', e.target.checked)} style={{ accentColor: '#2D5A4E', width: 15, height: 15 }} />
              <span style={{ fontFamily: 'Inter', fontSize: 13 }}>Regular contribution / top-up</span>
            </label>
            {rec.hasRegular && (
              <div style={{ marginLeft: 23, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 12px' }}>
                <div>
                  <label style={S.lbl}>Frequency</label>
                  <select style={S.inp} value={rec.regularFreq} onChange={e => upd('regularFreq', e.target.value as ContribFreq)}>
                    {(['Monthly', 'Annual', 'Quarterly'] as ContribFreq[]).map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div><label style={S.lbl}>Amount (S$)</label><input type="number" style={S.inp} value={rec.regularAmount || ''} onChange={e => upd('regularAmount', Number(e.target.value))} placeholder="0" /></div>
                <div><label style={S.lbl}>For how many years</label><input type="number" style={S.inp} value={rec.regularYears || ''} onChange={e => upd('regularYears', Number(e.target.value))} placeholder="yrs" /></div>
              </div>
            )}
          </div>
        </div>

        {/* Projection */}
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
            <div style={{ ...S.lbl, marginBottom: 8 }}>Projected value at maturity</div>
            <div style={{ display: 'flex', border: '1px solid var(--cream3)', borderRadius: 6, overflow: 'hidden', width: 'fit-content', marginBottom: 14 }}>
              {(['illustration', 'rate'] as ProjMethod[]).map(m => (
                <button key={m} onClick={() => upd('projMethod', m)} style={{
                  fontSize: 12, padding: '5px 14px', border: 'none', cursor: 'pointer', fontFamily: 'Inter',
                  background: rec.projMethod === m ? 'var(--cream2)' : 'transparent',
                  color: rec.projMethod === m ? 'var(--ink)' : 'var(--ink3)',
                  fontWeight: rec.projMethod === m ? 600 : 400,
                }}>{m === 'illustration' ? 'From illustration' : 'By projected rate'}</button>
              ))}
            </div>
            {rec.projMethod === 'illustration' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 12px' }}>
                <div><label style={S.lbl}>Policy / maturity term (yrs)</label><input type="number" style={S.inp} value={rec.illusTerm || ''} onChange={e => upd('illusTerm', Number(e.target.value))} placeholder="yrs" /></div>
                <div><label style={S.lbl}>Guaranteed value (S$)</label><input type="number" style={S.inp} value={rec.illusGuaranteed || ''} onChange={e => upd('illusGuaranteed', Number(e.target.value))} placeholder="0" /></div>
                <div><label style={S.lbl}>Non-guaranteed value (S$)</label><input type="number" style={S.inp} value={rec.illusNonGuaranteed || ''} onChange={e => upd('illusNonGuaranteed', Number(e.target.value))} placeholder="0 (uses guaranteed if blank)" /></div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                <div><label style={S.lbl}>Investment horizon (yrs)</label><input type="number" style={S.inp} value={rec.rateYears || ''} onChange={e => upd('rateYears', Number(e.target.value))} placeholder="yrs" /></div>
                <div><label style={S.lbl}>Projected annual return (% p.a.)</label><input type="number" step="0.1" style={S.inp} value={rec.rateReturn || ''} onChange={e => upd('rateReturn', Number(e.target.value))} placeholder="e.g. 6" /></div>
              </div>
            )}
          </div>
        </div>

        {/* Replacement */}
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
                      if (exists) upd('replacedPolicies', rec.replacedPolicies.filter(p => p.policyId !== pol.id))
                      else upd('replacedPolicies', [...rec.replacedPolicies, { policyId: pol.id, policyName: pol.policyName, companyName: pol.companyName, annualPremium: pol.annualPremium, currentCashValue: pol.currentCashValue }])
                    }} style={{
                      fontSize: 12, padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: 'Inter',
                      border: `1px solid ${selected ? '#2D5A4E' : 'var(--cream3)'}`,
                      background: selected ? '#D1FAE5' : '#fff', color: selected ? '#1E4D35' : 'var(--ink2)',
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
          <div><label style={S.lbl}>Benefits</label><textarea style={{ ...S.inp, resize: 'vertical', minHeight: 68, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.benefits} onChange={e => upd('benefits', e.target.value)} placeholder="Key benefits…" /></div>
          <div><label style={S.lbl}>Limitations</label><textarea style={{ ...S.inp, resize: 'vertical', minHeight: 68, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.limitations} onChange={e => upd('limitations', e.target.value)} placeholder="Limitations or trade-offs…" /></div>
        </div>

        {/* Summary bar */}
        {(totalInvested > 0 || projValue > 0) && (
          <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { label: 'Total invested',   val: fmt(totalInvested), color: '#854F0B' },
              { label: 'Projected value',  val: fmt(projValue),     color: '#1E4D35' },
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
              <button onClick={() => setShowImpact(true)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: '1px solid #2D5A4E', background: 'transparent', color: '#2D5A4E', fontWeight: 600 }}>View impact</button>
              <button onClick={onChoose} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: '1px solid var(--cream3)', background: 'transparent', color: 'var(--ink2)' }}>Unmark as chosen</button>
            </>
          ) : (
            <button onClick={onChoose} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: 'none', background: 'var(--charcoal)', color: 'var(--cream)', fontWeight: 600 }}>Mark as chosen</button>
          )}
          <button onClick={onDelete} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: '1px solid var(--cream3)', background: 'transparent', color: '#9B1C1C', marginLeft: 'auto' }}>Remove</button>
        </div>
      </div>

      {showImpact && <AccImpactModal rec={rec} goals={goals} existingPortfolioValue={existingPortfolioValue} monthlyIncome={monthlyIncome} monthlyExpenses={monthlyExpenses} onClose={() => setShowImpact(false)} />}
    </>
  )
}

// ─── PROTECTION SECTION ───────────────────────────────────────────────────────

function ProtSection({ cat, recs, onAdd, onUpdate, onDelete, onChoose,
  existingPolicies, insurers, coverageTypes, monthlyIncome, monthlyExpenses }: {
  cat: typeof PROT_CATEGORIES[0]
  recs: ProtRec[]
  onAdd: () => void; onUpdate: (id: string, r: ProtRec) => void
  onDelete: (id: string) => void; onChoose: (id: string) => void
  existingPolicies: { id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number }[]
  insurers: string[]; coverageTypes: string[]
  monthlyIncome: number; monthlyExpenses: number
}) {
  const canAdd = recs.length < 3
  return (
    <div style={{ marginBottom: 28 }}>
      {/* Section header — matches Protection Portfolio style */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${cat.color}33` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 2, height: 14, background: cat.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', letterSpacing: '0.04em' }}>{cat.label}</span>
          <span style={{ fontSize: 10, color: 'var(--ink3)', borderLeft: '1px solid var(--cream3)', paddingLeft: 10 }}>{cat.hint}</span>
        </div>
        <button onClick={onAdd} disabled={!canAdd} style={{
          background: canAdd ? 'var(--charcoal)' : 'var(--cream3)', color: canAdd ? 'var(--cream)' : 'var(--ink3)',
          border: 'none', borderRadius: 6, padding: '5px 12px', fontFamily: 'Inter', fontSize: 11,
          cursor: canAdd ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
          {canAdd ? 'Add option' : 'Max 3'}
        </button>
      </div>
      {recs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', fontStyle: 'italic' }}>
          No {cat.label.toLowerCase()} recommendations yet
        </div>
      ) : (
        recs.map((rec, idx) => (
          <ProtCard
            key={rec.id} rec={rec} category={cat.key}
            onChange={r => onUpdate(rec.id, r)}
            onDelete={() => onDelete(rec.id)}
            onChoose={() => onChoose(rec.id)}
            existingPolicies={existingPolicies}
            insurers={insurers} coverageTypes={coverageTypes}
            monthlyIncome={monthlyIncome} monthlyExpenses={monthlyExpenses}
          />
        ))
      )}
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function RecommendationsPage() {
  const supabase = createClient()
  const [clientId, setClientId]   = useState<string | null>(null)
  const [clientName, setClientName] = useState('Client')
  const [data, setData]           = useState<RecPageData>(EMPTY)
  const [saving, setSaving]       = useState(false)
  const [saveOk, setSaveOk]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reference data
  const [insurers, setInsurers]   = useState<string[]>([])
  const [companies, setCompanies] = useState<{ id: number; name: string }[]>([])
  const [medicalCompanies, setMedicalCompanies] = useState<{ id: number; name: string }[]>([])
  const [products, setProducts]   = useState<InsProduct[]>([])
  const [coverageMap, setCoverageMap] = useState<Record<ProtCategory, string[]>>(COVERAGE_BY_CATEGORY)

  // Person tabs
  const [activePerson, setActivePerson] = useState<string>('client')
  const [personTabs, setPersonTabs] = useState<{ key: string; label: string; age: number }[]>([
    { key: 'client', label: 'Client', age: 35 }
  ])

  // Existing policies from protection_portfolio
  const [existingPolicies, setExistingPolicies] = useState<{
    id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number
  }[]>([])

  // Cash flow from Financial Profile
  const [monthlyIncome, setMonthlyIncome]     = useState(0)
  const [monthlyExpenses, setMonthlyExpenses] = useState(0)

  // Goals for accumulation waterfall
  const [goals, setGoals]                         = useState<GoalItem[]>([])
  const [existingPortfolioValue, setExistingPortfolioValue] = useState(0)

  useEffect(() => {
    const id = localStorage.getItem('selectedClientId')
    if (id) setClientId(id)
  }, [])

  useEffect(() => { if (clientId) loadAll(clientId) }, [clientId])

  async function loadAll(id: string) {
    try {
      setError(null)
      const [
        { data: ffRows },
        { data: cats },
        { data: policyTypes },
        { data: companiesRaw },
        { data: productsRaw },
        { data: familyRows },
      ] = await Promise.all([
        supabase.from('fact_finding').select('section,data').eq('client_id', id)
          .in('section', ['financials', 'protection_portfolio', 'capital_mandate', 'retirement', 'education', 'strategic_recommendations_v2']),
        supabase.from('ins_categories').select('*').order('sort_order'),
        supabase.from('ins_policy_types').select('*').order('sort_order'),
        supabase.from('ins_companies').select('*').eq('active', true).order('sort_order'),
        supabase.from('ins_products').select('*').eq('active', true).order('sort_order'),
        supabase.from('family_members').select('*').eq('client_id', id),
      ])

      // Reference data
      const companiesList = (companiesRaw || []).map((c: any) => ({ id: c.id, category_id: c.category_id, name: c.name }))
      setCompanies(companiesList)
      setInsurers(companiesList.map(c => c.name))
      setProducts((productsRaw || []).map((p: any) => ({ id: p.id, company_id: p.company_id, category_id: p.category_id, name: p.name })))
      // Medical-only insurers: filter by ins_categories code='medical'
      const medCat = (cats || []).find((c: any) => c.code === 'medical')
      if (medCat) {
        setMedicalCompanies(companiesList.filter((c: any) => c.category_id === medCat.id))
      } else {
        setMedicalCompanies(companiesList)
      }


      // Coverage types per category — map from ins_policy_types filtered by ins_categories
      if (cats && policyTypes) {
        const newMap = { ...COVERAGE_BY_CATEGORY }
        PROT_CATEGORIES.forEach(protCat => {
          const dbCat = cats.find((c: any) => c.code === protCat.dbCode)
          if (dbCat) {
            const types = policyTypes
              .filter((pt: any) => pt.category_id === dbCat.id)
              .map((pt: any) => pt.name)
            if (types.length > 0) newMap[protCat.key] = types
          }
        })
        setCoverageMap(newMap)
      }

      const by: Record<string, any> = {}
      if (ffRows) ffRows.forEach((r: any) => { by[r.section] = r.data })

      // Person tabs from family_members
      const currentYear = new Date().getFullYear()
      const fin2 = by['financials'] ?? {}
      const clientFirstName = fin2?.client?.firstName || fin2?.person1?.firstName || 'Client'
      const clientAge2 = fin2?.client?.dob ? currentYear - Number(String(fin2.client.dob).slice(0,4))
        : fin2?.person1?.dob ? currentYear - Number(String(fin2.person1.dob).slice(0,4)) : 35
      const tabs: { key: string; label: string; age: number }[] = [
        { key: 'client', label: clientFirstName, age: clientAge2 }
      ]
      const spouse = (familyRows || []).find((m: any) => m.relationship?.toLowerCase() === 'spouse')
      if (spouse) {
        const spouseAge2 = spouse.age ? Number(spouse.age)
          : spouse.dob ? currentYear - Number(String(spouse.dob).slice(0,4)) : 35
        tabs.push({ key: 'spouse', label: spouse.name || 'Spouse', age: spouseAge2 })
      }
      const kids = (familyRows || []).filter((m: any) => m.relationship?.toLowerCase() !== 'spouse')
      kids.forEach((k: any) => {
        const kAge = k.age ? Number(k.age) : k.dob ? currentYear - Number(String(k.dob).slice(0,4)) : 0
        tabs.push({ key: `child_${k.id || k.name}`, label: k.name || 'Dependent', age: kAge })
      })
      setPersonTabs(tabs)

      // Client name
      const fin = by['financials'] ?? {}
      setClientName(fin?.client?.firstName
        ? `${fin.client.firstName} ${fin.client.lastName || ''}`.trim()
        : 'Client')

      // Cash flow from Financial Profile
      const p1 = fin?.person1 || {}
      const p2 = fin?.person2 || {}
      const isCouple = fin?.mode === 'couple'
      const p1Gross = p1.gross_monthly || 0
      const p2Gross = isCouple ? (p2.gross_monthly || 0) : 0
      const p1Other = (p1.other_incomes || []).reduce((s: number, i: any) => s + (i.amount || 0), 0)
      const p2Other = isCouple ? (p2.other_incomes || []).reduce((s: number, i: any) => s + (i.amount || 0), 0) : 0
      const totalMonthlyIncome = p1Gross + p2Gross + p1Other + p2Other
      setMonthlyIncome(totalMonthlyIncome)

      // Monthly expenses: annual_surplus stored, or re-derive from expense keys
      if (fin?.annual_surplus != null) {
        const annualExpenses = totalMonthlyIncome * 12 - (fin.annual_surplus || 0)
        setMonthlyExpenses(Math.max(0, annualExpenses / 12))
      } else {
        // Fallback: sum known simple expense keys
        const EXP_KEYS = ['s_financial','s_healthcare','s_lifestyle','s_household','s_personal','s_children','s_parents']
        const EXP_KEYS2 = ['s2_financial','s2_healthcare','s2_lifestyle','s2_household','s2_personal','s2_children','s2_parents']
        let annExp = 0
        EXP_KEYS.forEach(k => { annExp += Number(fin[k] || 0) })
        if (isCouple) EXP_KEYS2.forEach(k => { annExp += Number(fin[k] || 0) })
        setMonthlyExpenses(annExp / 12)
      }

      // Existing policies
      const pPort = by['protection_portfolio'] ?? {}
      const policies: any[] = pPort?.risk_management?.policies ?? []
      const ACTIVE = ['In-Force', 'Premium Holiday', 'Paid-up']
      setExistingPolicies(
        policies.filter((p: any) => ACTIVE.includes(p.status)).map((p: any) => {
          const freq = p.frequency || p.premiumMode || 'Annual'
          const annualPrem = freq === 'Monthly' ? (p.premiumCash || 0) * 12 : freq === 'Quarterly' ? (p.premiumCash || 0) * 4 : (p.premiumCash || 0)
          return { id: p.id, policyName: p.productName || p.briefDescription || '', companyName: p.companyName || '', annualPremium: annualPrem, currentCashValue: p.currentCashValue || 0 }
        })
      )

      // Goals
      const cm  = by['capital_mandate'] ?? {}
      const ret = by['retirement'] ?? {}
      const edu = by['education'] ?? {}
      const clientAge = fin?.client?.dob
        ? new Date().getFullYear() - Number(String(fin.client.dob).slice(0, 4))
        : 35
      const builtGoals: GoalItem[] = []
      const retCorpus = ret?.corpusNeeded || 0
      const retAge    = ret?.ret?.client?.retirementAge || ret?.retirementAge || 65
      if (retCorpus > 0) builtGoals.push({ id: 'retirement', label: 'Retirement', icon: '🌅', targetCorpus: retCorpus, targetAge: retAge })
      ;(edu?.edu?.children || []).forEach((c: any) => {
        if ((c.corpus || 0) > 0) builtGoals.push({ id: `edu_${c.childId || c.name}`, label: `${c.name}'s Education`, icon: '🎓', targetCorpus: c.corpus, targetAge: clientAge + (c.yearsAway || 18) })
      })
      ;(cm?.customGoals || []).forEach((g: any) => {
        if ((g.targetCorpus || 0) > 0) builtGoals.push({ id: g.id || `g_${g.label}`, label: g.label, icon: g.icon || '✦', targetCorpus: g.targetCorpus, targetAge: g.targetAge || 0 })
      })
      builtGoals.sort((a, b) => a.targetAge - b.targetAge)
      setGoals(builtGoals)

      const portValue = cm?.retirementShortfall != null ? Math.max(0, (cm?.settings?.retirementCorpus || 0) - (cm?.retirementShortfall || 0)) : 0
      setExistingPortfolioValue(portValue)

      // Load saved
      const saved = by['strategic_recommendations_v2']
      if (saved) {
        setData({
          medicalByPerson: saved.medicalByPerson || (saved.medical ? { client: saved.medical } : {}),
          ltc:          saved.ltc          || [],
          expense:      saved.expense      || [],
          general:      saved.general      || [],
          accumulation: saved.accumulation || [],
        })
      } else {
        setData(EMPTY)
      }
    } catch (e: any) { setError('Failed to load: ' + e.message) }
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
      setSaveOk(true); setTimeout(() => setSaveOk(false), 2000)
    } catch (e) { console.error('Save failed', e) }
    setSaving(false)
  }

  function handleChange(d: RecPageData) { setData(d); schedSave(d) }

  // ── Medical helpers (per person) ────────────────────────────────────────────
  function getMedical(person: string): MedicalRec[] { return data.medicalByPerson[person] || [] }
  function addMedical(person: string) {
    const recs = getMedical(person)
    if (recs.length >= 3) return
    const rec: MedicalRec = {
      id: newId(), rank: RANK_LABELS[recs.length], mode: 'new',
      insurer: '', productName: '', coverageMode: 'main_only',
      briefCoverage: '', briefCoverageOther: '',
      premiumMedisave: 0, premiumCash: 0, premiumTerm: 'Annual',
      rider: { insurer: '', productName: '', annualPremium: 0 },
      benefits: '', limitations: '', replacedPolicies: [], isChosen: false,
    }
    handleChange({ ...data, medicalByPerson: { ...data.medicalByPerson, [person]: [...recs, rec] } })
  }
  function updateMedical(person: string, id: string, r: MedicalRec) {
    handleChange({ ...data, medicalByPerson: { ...data.medicalByPerson, [person]: getMedical(person).map(x => x.id === id ? r : x) } })
  }
  function deleteMedical(person: string, id: string) {
    const next = getMedical(person).filter(x => x.id !== id).map((r, i) => ({ ...r, rank: RANK_LABELS[i] }))
    handleChange({ ...data, medicalByPerson: { ...data.medicalByPerson, [person]: next } })
  }
  function chooseMedical(person: string, id: string) {
    handleChange({ ...data, medicalByPerson: { ...data.medicalByPerson, [person]: getMedical(person).map(r => ({ ...r, isChosen: r.id === id ? !r.isChosen : false })) } })
  }

  // ── Per-category prot helpers (ltc / expense / general) ──────────────────
  function addProt(cat: ProtCategory) {
    if (cat === 'medical') return // medical handled separately
    const recs = data[cat as 'ltc' | 'expense' | 'general']
    if (recs.length >= 3) return
    const rec: ProtRec = {
      id: newId(), rank: RANK_LABELS[recs.length], mode: 'new',
      productName: '', insurer: '', coverageType: '', sumAssured: 0, annualPremium: 0,
      premiumTerm: '', policyTerm: '', benefits: '', limitations: '', replacedPolicies: [], isChosen: false,
    }
    handleChange({ ...data, [cat]: [...recs, rec] })
  }
  function updateProt(cat: ProtCategory, id: string, r: ProtRec) {
    handleChange({ ...data, [cat]: (data[cat as 'ltc'|'expense'|'general'] as ProtRec[]).map(x => x.id === id ? r : x) })
  }
  function deleteProt(cat: ProtCategory, id: string) {
    const next = (data[cat as 'ltc'|'expense'|'general'] as ProtRec[]).filter(x => x.id !== id).map((r, i) => ({ ...r, rank: RANK_LABELS[i] }))
    handleChange({ ...data, [cat]: next })
  }
  function chooseProt(cat: ProtCategory, id: string) {
    handleChange({ ...data, [cat]: (data[cat as 'ltc'|'expense'|'general'] as ProtRec[]).map(r => ({ ...r, isChosen: r.id === id ? !r.isChosen : false })) })
  }

  // ── Accumulation helpers ────────────────────────────────────────────────────
  function addAcc() {
    if (data.accumulation.length >= 3) return
    const rec: AccRec = {
      id: newId(), rank: RANK_LABELS[data.accumulation.length], mode: 'new',
      productType: '', company: '', planType: '',
      hasLumpSum: false, lumpSumAmount: 0, hasRegular: true,
      regularFreq: 'Monthly', regularAmount: 0, regularYears: 0,
      projMethod: 'illustration', illusTerm: 0, illusGuaranteed: 0, illusNonGuaranteed: 0,
      rateYears: 0, rateReturn: 0, replacedPolicies: [], benefits: '', limitations: '',
      allocatedGoalIds: [], isChosen: false,
    }
    handleChange({ ...data, accumulation: [...data.accumulation, rec] })
  }
  function updateAcc(id: string, r: AccRec) { handleChange({ ...data, accumulation: data.accumulation.map(x => x.id === id ? r : x) }) }
  function deleteAcc(id: string) {
    const next = data.accumulation.filter(x => x.id !== id).map((r, i) => ({ ...r, rank: RANK_LABELS[i] }))
    handleChange({ ...data, accumulation: next })
  }
  function chooseAcc(id: string) { handleChange({ ...data, accumulation: data.accumulation.map(r => ({ ...r, isChosen: r.id === id ? !r.isChosen : false })) }) }

  const [showPicker, setShowPicker] = useState(false)

  // Sections are derived purely from card count — appear on first card, disappear on last deletion
  const medicalHasCards = Object.values(data.medicalByPerson).some(recs => recs.length > 0)
  const activeSections = [
    ...(medicalHasCards ? ['medical' as ProtCategory | 'accumulation'] : []),
    ...PROT_CATEGORIES.filter(cat => cat.key !== 'medical' && (data[cat.key as 'ltc'|'expense'|'general'] as ProtRec[]).length > 0).map(cat => cat.key as ProtCategory | 'accumulation'),
    ...(data.accumulation.length > 0 ? ['accumulation' as const] : []),
  ]

  const ALL_OPTIONS: { key: ProtCategory | 'accumulation'; label: string; sub: string; color: string }[] = [
    ...PROT_CATEGORIES.map(c => ({ key: c.key as ProtCategory | 'accumulation', label: c.label, sub: 'Wealth Protection', color: c.color })),
    { key: 'accumulation', label: 'Wealth Accumulation', sub: 'Investments & savings', color: '#2D5A4E' },
  ]

  // Picker adds first card immediately so section appears
  function activateSection(key: ProtCategory | 'accumulation') {
    setShowPicker(false)
    if (key === 'accumulation') addAcc()
    else if (key === 'medical') addMedical('client')
    else addProt(key)
  }

  const availableOptions = ALL_OPTIONS.filter(o => !activeSections.includes(o.key))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Hero */}
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div style={{ paddingTop: 32, paddingBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9A9690', marginBottom: 6 }}>Advisory Summary</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 30, fontWeight: 300, color: '#F0EDE8', lineHeight: 1.1 }}>Strategic Recommendations</div>
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
          <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontFamily: 'Inter', fontSize: 13, color: '#9B1C1C' }}>{error}</div>
        )}

        {/* Empty state */}
        {activeSections.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 24px', border: '1px dashed var(--cream3)', borderRadius: 12, marginBottom: 24 }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'var(--ink2)', marginBottom: 8 }}>No recommendations yet</div>
            <div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', marginBottom: 24 }}>
              Add a recommendation section to get started
            </div>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button onClick={() => setShowPicker(v => !v)} style={{
                background: 'var(--charcoal)', color: 'var(--cream)', border: 'none',
                borderRadius: 8, padding: '10px 24px', fontFamily: 'Inter', fontSize: 13,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add recommendation
              </button>
              {showPicker && (
                <>
                  <div onClick={() => setShowPicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', zIndex: 100,
                    background: '#fff', border: '1px solid var(--cream3)', borderRadius: 10,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.10)', padding: 8, minWidth: 280,
                  }}>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', padding: '6px 10px 8px' }}>
                      Choose a section to add
                    </div>
                    {availableOptions.map(opt => (
                      <button key={opt.key} onClick={() => activateSection(opt.key)} style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                        background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 7, textAlign: 'left',
                      }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--cream)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ width: 10, height: 10, borderRadius: 3, background: opt.color, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{opt.label}</div>
                          <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>{opt.sub}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Medical Insurance — with person tabs */}
        {medicalHasCards && (() => {
          const cat = PROT_CATEGORIES.find(c => c.key === 'medical')!
          const currentPerson = personTabs.find(t => t.key === activePerson) || personTabs[0]
          const personRecs = getMedical(activePerson)
          const canAdd = personRecs.length < 3
          return (
            <div style={{ marginBottom: 28 }}>
              {/* Section header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${cat.color}33` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 2, height: 14, background: cat.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', letterSpacing: '0.04em' }}>{cat.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--ink3)', borderLeft: '1px solid var(--cream3)', paddingLeft: 10 }}>{cat.hint}</span>
                </div>
                <button onClick={() => addMedical(activePerson)} disabled={!canAdd} style={{
                  background: canAdd ? 'var(--charcoal)' : 'var(--cream3)', color: canAdd ? 'var(--cream)' : 'var(--ink3)',
                  border: 'none', borderRadius: 6, padding: '5px 12px', fontFamily: 'Inter', fontSize: 11,
                  cursor: canAdd ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>{canAdd ? 'Add option' : 'Max 3'}
                </button>
              </div>

              {/* Person tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--cream3)', paddingBottom: 0 }}>
                {personTabs.map(tab => (
                  <button key={tab.key} onClick={() => setActivePerson(tab.key)} style={{
                    fontSize: 12, padding: '7px 16px', border: 'none', cursor: 'pointer', fontFamily: 'Inter',
                    borderBottom: activePerson === tab.key ? `2px solid ${cat.color}` : '2px solid transparent',
                    background: 'transparent', color: activePerson === tab.key ? 'var(--ink)' : 'var(--ink3)',
                    fontWeight: activePerson === tab.key ? 600 : 400, marginBottom: -1,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {tab.label}
                    {getMedical(tab.key).length > 0 && (
                      <span style={{ fontSize: 10, background: cat.color, color: '#fff', borderRadius: 10, padding: '1px 6px', fontWeight: 600 }}>
                        {getMedical(tab.key).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Cards for active person */}
              {personRecs.length === 0 ? (
                <div style={{ padding: '20px 0 8px', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>
                  No medical recommendations for {currentPerson?.label} yet
                </div>
              ) : (
                personRecs.map(rec => (
                  <MedicalCard
                    key={rec.id}
                    rec={rec}
                    personAge={currentPerson?.age || 35}
                    onChange={r => updateMedical(activePerson, rec.id, r)}
                    onDelete={() => deleteMedical(activePerson, rec.id)}
                    onChoose={() => chooseMedical(activePerson, rec.id)}
                    existingPolicies={existingPolicies}
                    medicalCompanies={medicalCompanies}
                    products={products}
                    monthlyIncome={monthlyIncome}
                    monthlyExpenses={monthlyExpenses}
                  />
                ))
              )}
            </div>
          )
        })()}

        {/* Active non-medical protection sections */}
        {PROT_CATEGORIES.filter(cat => cat.key !== 'medical' && activeSections.includes(cat.key)).map(cat => (
          <ProtSection
            key={cat.key}
            cat={cat}
            recs={data[cat.key as 'ltc'|'expense'|'general'] as ProtRec[]}
            onAdd={() => addProt(cat.key)}
            onUpdate={(id, r) => updateProt(cat.key, id, r)}
            onDelete={id => deleteProt(cat.key, id)}
            onChoose={id => chooseProt(cat.key, id)}
            existingPolicies={existingPolicies}
            insurers={insurers}
            coverageTypes={coverageMap[cat.key]}
            monthlyIncome={monthlyIncome}
            monthlyExpenses={monthlyExpenses}
          />
        ))}

        {/* Active accumulation section */}
        {activeSections.includes('accumulation') && (
          <div style={S.sectionWrap}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--cream3)' }}>
              <div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.1 }}>Wealth Accumulation</div>
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', marginTop: 3 }}>Investment & savings recommendations (max 3 options)</div>
              </div>
              <button onClick={addAcc} disabled={data.accumulation.length >= 3} style={{
                background: data.accumulation.length < 3 ? 'var(--charcoal)' : 'var(--cream3)',
                color: data.accumulation.length < 3 ? 'var(--cream)' : 'var(--ink3)',
                border: 'none', borderRadius: 6, padding: '7px 14px', fontFamily: 'Inter', fontSize: 12,
                cursor: data.accumulation.length < 3 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
                {data.accumulation.length < 3 ? 'Add option' : 'Max 3'}
              </button>
            </div>
            {data.accumulation.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', fontStyle: 'italic' }}>No accumulation recommendations yet — click Add option above</div>
            ) : (
              data.accumulation.map(rec => (
                <AccCard
                  key={rec.id} rec={rec}
                  onChange={r => updateAcc(rec.id, r)}
                  onDelete={() => deleteAcc(rec.id)}
                  onChoose={() => chooseAcc(rec.id)}
                  goals={goals} existingPortfolioValue={existingPortfolioValue}
                  existingPolicies={existingPolicies}
                  monthlyIncome={monthlyIncome} monthlyExpenses={monthlyExpenses}
                />
              ))
            )}
          </div>
        )}

        {/* Add recommendation button — shown when at least 1 section is active and more are available */}
        {activeSections.length > 0 && availableOptions.length > 0 && (
          <div style={{ marginTop: 8, position: 'relative', display: 'inline-block' }}>
            <button onClick={() => setShowPicker(v => !v)} style={{
              background: 'transparent', color: 'var(--ink2)', border: '1px dashed var(--cream3)',
              borderRadius: 8, padding: '9px 20px', fontFamily: 'Inter', fontSize: 13,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add recommendation section
            </button>

            {/* Picker dropdown */}
            {showPicker && (
              <>
                <div onClick={() => setShowPicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 100,
                  background: '#fff', border: '1px solid var(--cream3)', borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.10)', padding: 8, minWidth: 280,
                }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', padding: '6px 10px 8px' }}>
                    Choose a section to add
                  </div>
                  {availableOptions.map(opt => (
                    <button key={opt.key} onClick={() => activateSection(opt.key)} style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                      background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 7,
                      textAlign: 'left',
                    }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--cream)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{ width: 10, height: 10, borderRadius: 3, background: opt.color, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{opt.label}</div>
                        <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>{opt.sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
