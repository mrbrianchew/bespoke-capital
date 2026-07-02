'use client'
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

type RecMode    = 'new' | 'replacement' | 'topup'
type ContribFreq = 'Monthly' | 'Annual' | 'Quarterly'
type ProjMethod  = 'illustration' | 'rate'
type RankLabel   = 'Recommended' | 'Alternative 1' | 'Alternative 2'
type ProtCategory = 'medical' | 'ltc' | 'expense' | 'general'

const RANK_LABELS: RankLabel[] = ['Recommended', 'Alternative 1', 'Alternative 2']

// Protection categories — maps to ins_categories codes
const PROT_CATEGORIES: { key: ProtCategory; label: string; hint: string; color: string; dbCode: string }[] = [
  { key: 'medical',  label: 'Medical Insurance',             hint: 'Medical & hospitalisation coverage',  color: '#7A9CBF', dbCode: 'medical' },
  { key: 'ltc',      label: 'Long Term Care Protection',     hint: 'LTC / disability income protection',  color: '#9B7BAA', dbCode: 'ltc' },
  { key: 'expense',  label: 'Core Protection',               hint: 'Life, CI, ECI, Term, Whole Life',     color: '#c8a96e', dbCode: 'life' },
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

// Cycled per chosen accumulation product in the Combined Goal Progress view —
// existing portfolio always uses a fixed, darker neutral (distinct from both
// the light track background and the product palette below) so it reads
// clearly rather than blending into the unfilled portion of the bar; products
// are
// assigned these in the order they appear so colors stay stable as long as
// the advisor doesn't reorder/delete products.
const PRODUCT_COLOR_PALETTE = ['#2D5A4E', '#A8834A', '#7A9CBF', '#9B7BAA', '#8A9A7E', '#C97B63']

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ReplacedPolicy {
  policyId: string
  policyName: string
  companyName: string
  annualPremium: number
  premiumMedisave: number
  currentCashValue: number
  monthlyBenefit: number
  benefitTerm: string
  deathBenefit: number
  tpdBenefit: number
  advCiBenefit: number
  earlyCiBenefit: number
  inceptionDate: string
  premiumMaturity: string
}

interface ProtRec {
  id: string
  rank: RankLabel
  mode: RecMode
  productName: string
  insurer: string
  coverageType: string
  sumAssured: number
  // LTC-specific
  monthlyBenefit: number
  benefitPaymentPeriod: string
  benefitTerm: string           // ADLs or occupation class (was benefitTerm)
  premiumMedisave: number       // auto-derived: min(annualPremium, 600)
  premiumCash: number           // auto-derived: max(annualPremium - 600, 0)
  annualPremium: number
  premiumTerm: string
  policyTerm: string
  benefits: string
  limitations: string
  rationale: string
  replacedPolicies: ReplacedPolicy[]
  isChosen: boolean
  // Expense / Core Protection specific
  baseDeathBenefit: number
  baseTpdBenefit: number
  baseAdvCiBenefit: number
  baseEarlyCiBenefit: number
  coverageMultiplier: number
  multiplierEnd: string
  deathBenefit: number
  tpdBenefit: number
  advCiBenefit: number
  earlyCiBenefit: number
  interestRate: string
  premiumWaiver: string
  isUsdPolicy: boolean
  // General Insurance specific
  accidentalDeathBenefit: number
  accidentalDisabilityBenefit: number
  medicalExpenseBenefit: number
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
  topupOf: { policyId: string; policyName: string; previousAnnualAmount: number } | null
  benefits: string
  limitations: string
  rationale: string
  allocatedGoalIds: string[]
  accountType: 'individual' | 'joint'
  // Contribution split for joint accounts — % of the contribution attributed
  // to the client; spouse's share is (100 - this). Only meaningful when
  // accountType === 'joint'. Defaults to 50 (even split).
  jointSplitClientPct: number
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
  rationale: string
  // Replacement
  replacedPolicies: ReplacedPolicy[]
  isChosen: boolean
}

interface RecPageData {
  // keyed by person tab: 'client' | 'spouse' | child id
  medicalByPerson: Record<string, MedicalRec[]>
  ltcByPerson: Record<string, ProtRec[]>
  expenseByPerson: Record<string, ProtRec[]>
  generalByPerson: Record<string, ProtRec[]>
  accumulationByPerson: Record<string, AccRec[]>
}

const EMPTY: RecPageData = { medicalByPerson: {}, ltcByPerson: {}, expenseByPerson: {}, generalByPerson: {}, accumulationByPerson: {} }

interface MedisaveBand { age_from: number; age_to: number | null; annual_limit: number }

function medisaveLimitFromBands(age: number, bands: MedisaveBand[]): number {
  for (const band of bands) {
    if (age >= band.age_from && (band.age_to === null || age <= band.age_to)) return band.annual_limit
  }
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
  // Cash flow impact should only reflect recurring outflow. A lump sum is a
  // one-time investment, not an annual/monthly contribution — amortizing it
  // here was overstating ongoing cash flow impact for lump-sum-only recs.
  const perYear = rec.regularFreq === 'Monthly' ? 12 : rec.regularFreq === 'Quarterly' ? 4 : 1
  return rec.hasRegular ? (rec.regularAmount || 0) * perYear : 0
}

// Backfills fields added after older records were saved (rationale,
// jointSplitClientPct) so existing clients' data doesn't break controlled
// inputs or silently miscompute cash-flow splits. Safe to run on every load.
function normalizeRecPageData(d: RecPageData): RecPageData {
  const withRationale = <T extends { rationale?: string }>(r: T): T => ({ ...r, rationale: r.rationale || '' })
  const normByPerson = <T extends { rationale?: string }>(byPerson: Record<string, T[]>): Record<string, T[]> => {
    const out: Record<string, T[]> = {}
    for (const key of Object.keys(byPerson || {})) out[key] = (byPerson[key] || []).map(withRationale)
    return out
  }
  const accByPerson: Record<string, AccRec[]> = {}
  for (const key of Object.keys(d.accumulationByPerson || {})) {
    accByPerson[key] = (d.accumulationByPerson[key] || []).map(r => ({
      ...r,
      rationale: r.rationale || '',
      jointSplitClientPct: r.jointSplitClientPct ?? 50,
    }))
  }
  return {
    medicalByPerson: normByPerson(d.medicalByPerson),
    ltcByPerson: normByPerson(d.ltcByPerson),
    expenseByPerson: normByPerson(d.expenseByPerson),
    generalByPerson: normByPerson(d.generalByPerson),
    accumulationByPerson: accByPerson,
  }
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

function RationaleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ background: '#FBF6EA', border: '1px solid var(--gold-tag, #E4D4AC)', borderRadius: 8, padding: 14 }}>
      <label style={{ ...S.lbl, color: '#8A6A2F' }}>Purpose / Rationale</label>
      <textarea
        style={{ ...S.inp, background: '#fff', resize: 'vertical', minHeight: 56, fontFamily: 'Inter', lineHeight: 1.5 }}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Why is this recommended for the client?"
      />
    </div>
  )
}

function JointSplitSlider({ clientPct, onChange, clientLabel, spouseLabel }: {
  clientPct: number
  onChange: (pct: number) => void
  clientLabel: string
  spouseLabel: string
}) {
  const pct = clientPct ?? 50
  return (
    <div style={{ background: '#fff', borderRadius: 6, padding: '10px 12px', border: '1px solid var(--cream3)', minWidth: 260 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink2)' }}>{clientLabel} <strong>{pct}%</strong></span>
        <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink2)' }}>{spouseLabel} <strong>{100 - pct}%</strong></span>
      </div>
      <input
        type="range" min={0} max={100} step={5} value={pct}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#2D5A4E', cursor: 'pointer' }}
      />
    </div>
  )
}

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

const MODE_LABELS: Record<RecMode, string> = { new: 'New addition', replacement: 'Replacement', topup: 'Top-up' }

function ModeToggle({ mode, onChange, modes }: { mode: RecMode; onChange: (m: RecMode) => void; modes?: RecMode[] }) {
  const options = modes || ['new', 'replacement']
  return (
    <div style={{
      display: 'flex', border: '1px solid var(--cream3)', borderRadius: 6,
      overflow: 'hidden', marginLeft: 'auto', flexShrink: 0,
    }}>
      {options.map(m => (
        <button key={m} onClick={() => onChange(m)} style={{
          fontSize: 12, padding: '4px 12px', border: 'none', cursor: 'pointer', fontFamily: 'Inter',
          background: mode === m ? 'var(--cream2)' : 'transparent',
          color: mode === m ? 'var(--ink)' : 'var(--ink3)',
          fontWeight: mode === m ? 600 : 400,
        }}>{MODE_LABELS[m]}</button>
      ))}
    </div>
  )
}

// ─── COMPARE TABLE ────────────────────────────────────────────────────────────

function CompareTable({ replaced, newPremium, newSA, newCoverageType, medicalMode, newCashPremium, ltcMode, newProductName, newMedisavePremium, newCashOnlyPremium, newBenefitTerm, expenseMode, newDeathBenefit, newTpdBenefit, newAdvCiBenefit, newEarlyCiBenefit }: {
  replaced: ReplacedPolicy[]; newPremium: number; newSA: number; newCoverageType: string
  medicalMode?: boolean; newCashPremium?: number
  ltcMode?: boolean; newProductName?: string; newMedisavePremium?: number; newCashOnlyPremium?: number
  newBenefitTerm?: string
  expenseMode?: boolean; newDeathBenefit?: number; newTpdBenefit?: number; newAdvCiBenefit?: number; newEarlyCiBenefit?: number
}) {
  const oldTotal        = replaced.reduce((s, p) => s + p.annualPremium, 0)
  const oldMedisaveTotal = replaced.reduce((s, p) => s + (p.premiumMedisave || 0), 0)
  const oldCashTotal    = replaced.reduce((s, p) => s + (p.annualPremium - (p.premiumMedisave || 0)), 0)
  const oldMonthlyBenefit = replaced.reduce((s, p) => s + (p.monthlyBenefit || 0), 0)
  const oldBenefitTerms  = Array.from(new Set(replaced.map(p => p.benefitTerm).filter(Boolean))).join(', ')
  const existingNames   = replaced.map(p => p.policyName || p.companyName).filter(Boolean).join(', ')
  const oldDeathTotal   = replaced.reduce((s, p) => s + (p.deathBenefit || 0), 0)
  const oldTpdTotal     = replaced.reduce((s, p) => s + (p.tpdBenefit || 0), 0)
  const oldAdvCiTotal   = replaced.reduce((s, p) => s + (p.advCiBenefit || 0), 0)
  const oldEarlyCiTotal = replaced.reduce((s, p) => s + (p.earlyCiBenefit || 0), 0)

  // For non-LTC/medical comparison
  const compareNew = medicalMode ? (newCashPremium ?? newPremium) : newPremium
  const compareOld = medicalMode ? oldCashTotal : oldTotal
  const delta      = compareNew - compareOld

  // LTC deltas
  const ltcMedisaveNew = newMedisavePremium ?? 0
  const ltcCashNew     = newCashOnlyPremium ?? 0
  const ltcMedisaveDelta = ltcMedisaveNew - oldMedisaveTotal
  const ltcCashDelta   = ltcCashNew - oldCashTotal

  const td: React.CSSProperties = { padding: '6px 10px', fontFamily: 'Inter', fontSize: 12, borderBottom: '1px solid var(--cream3)' }
  const th: React.CSSProperties = { ...td, fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink3)', background: 'var(--cream2)', fontWeight: 600 }
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ ...S.lbl, marginBottom: 6 }}>Side-by-side comparison</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--cream3)', borderRadius: 6, overflow: 'hidden' }}>
        <thead><tr><th style={th}></th><th style={th}>Existing (combined)</th><th style={th}>New product</th><th style={th}>Change</th></tr></thead>
        <tbody>
          <tr>
            <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>Plan(s)</td>
            <td style={{ ...td, color: '#9B1C1C' }}>{existingNames || '—'}</td>
            <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{newProductName || newCoverageType || '—'}</td>
            <td style={td}>—</td>
          </tr>
          {ltcMode ? (
            <>
              <tr>
                <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>Medisave / yr</td>
                <td style={{ ...td, color: '#9B1C1C' }}>{fmt(oldMedisaveTotal)}</td>
                <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{fmt(ltcMedisaveNew)}</td>
                <td style={{ ...td, color: ltcMedisaveDelta > 0 ? '#9B1C1C' : '#1E4D35', fontWeight: 600 }}>
                  {ltcMedisaveDelta > 0 ? '+' : ''}{fmt(ltcMedisaveDelta)} / yr
                </td>
              </tr>
              <tr>
                <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>Cash premium / yr</td>
                <td style={{ ...td, color: '#9B1C1C' }}>{fmt(oldCashTotal)}</td>
                <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{fmt(ltcCashNew)}</td>
                <td style={{ ...td, color: ltcCashDelta > 0 ? '#9B1C1C' : '#1E4D35', fontWeight: 600 }}>
                  {ltcCashDelta > 0 ? '+' : ''}{fmt(ltcCashDelta)} / yr
                </td>
              </tr>
            </>
          ) : medicalMode ? (
            <>
              <tr>
                <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>Medisave / yr</td>
                <td style={{ ...td, color: '#9B1C1C' }}>{fmt(oldMedisaveTotal)}</td>
                <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{fmt(newPremium - (newCashPremium ?? 0))}</td>
                <td style={{ ...td, color: (newPremium - (newCashPremium ?? 0)) - oldMedisaveTotal > 0 ? '#9B1C1C' : '#1E4D35', fontWeight: 600 }}>
                  {(() => { const d = (newPremium - (newCashPremium ?? 0)) - oldMedisaveTotal; return (d > 0 ? '+' : '') + fmt(d) + ' / yr' })()}
                </td>
              </tr>
              <tr>
                <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>Cash premium / yr</td>
                <td style={{ ...td, color: '#9B1C1C' }}>{fmt(oldCashTotal)}</td>
                <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{fmt(newCashPremium ?? 0)}</td>
                <td style={{ ...td, color: delta > 0 ? '#9B1C1C' : '#1E4D35', fontWeight: 600 }}>
                  {delta > 0 ? '+' : ''}{fmt(delta)} / yr
                </td>
              </tr>
            </>
          ) : (
            <tr>
              <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>Annual premium</td>
              <td style={{ ...td, color: '#9B1C1C' }}>{fmt(compareOld)}</td>
              <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{fmt(compareNew)}</td>
              <td style={{ ...td, color: delta > 0 ? '#9B1C1C' : '#1E4D35', fontWeight: 600 }}>
                {delta > 0 ? '+' : ''}{fmt(delta)} / yr
              </td>
            </tr>
          )}
          {ltcMode && newSA > 0 && (
            <tr>
              <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>Monthly benefit</td>
              <td style={{ ...td, color: '#9B1C1C' }}>{oldMonthlyBenefit > 0 ? fmt(oldMonthlyBenefit) : '—'}</td>
              <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{fmt(newSA)}</td>
              <td style={{ ...td, color: newSA > oldMonthlyBenefit ? '#1E4D35' : '#9B1C1C', fontWeight: 600 }}>
                {oldMonthlyBenefit > 0 ? ((newSA - oldMonthlyBenefit) > 0 ? '+' : '') + fmt(newSA - oldMonthlyBenefit) + ' / mo' : '—'}
              </td>
            </tr>
          )}
          {expenseMode ? (
            <>
              {[
                { label: 'Death Benefit', oldVal: oldDeathTotal, newVal: newDeathBenefit || 0 },
                { label: 'TPD Benefit',   oldVal: oldTpdTotal,   newVal: newTpdBenefit || 0 },
                { label: 'Adv CI',        oldVal: oldAdvCiTotal, newVal: newAdvCiBenefit || 0 },
                { label: 'Early CI',      oldVal: oldEarlyCiTotal, newVal: newEarlyCiBenefit || 0 },
              ].map(({ label, oldVal, newVal }) => {
                const d = newVal - oldVal
                return (
                  <tr key={label}>
                    <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>{label}</td>
                    <td style={{ ...td, color: '#9B1C1C' }}>{oldVal > 0 ? fmt(oldVal) : '—'}</td>
                    <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{newVal > 0 ? fmt(newVal) : '—'}</td>
                    <td style={{ ...td, color: d > 0 ? '#1E4D35' : d < 0 ? '#9B1C1C' : 'var(--ink3)', fontWeight: 600 }}>
                      {(oldVal > 0 || newVal > 0) ? (d > 0 ? '+' : '') + fmt(d) : '—'}
                    </td>
                  </tr>
                )
              })}
            </>
          ) : (!ltcMode && newSA > 0 && (
            <tr>
              <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>Sum assured</td>
              <td style={{ ...td, color: '#9B1C1C' }}>—</td>
              <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{fmt(newSA)}</td>
              <td style={td}>—</td>
            </tr>
          ))}
          {ltcMode && newBenefitTerm && (
            <tr>
              <td style={{ ...td, color: 'var(--ink3)', fontSize: 11 }}>Benefit terms</td>
              <td style={{ ...td, color: '#9B1C1C' }}>{oldBenefitTerms || '—'}</td>
              <td style={{ ...td, color: '#1E4D35', fontWeight: 600 }}>{newBenefitTerm}</td>
              <td style={td}>—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── PROTECTION IMPACT MODAL ──────────────────────────────────────────────────

function ProtImpactModal({ rec, monthlyIncome, monthlyExpenses, annualSurplusOverride, onClose, medicalMode, medicalCashPremium, medicalOldCashPremium, ltcMode, expenseMode, lifeExpectancy, clientAge }: {
  rec: ProtRec
  monthlyIncome: number
  monthlyExpenses: number
  annualSurplusOverride?: number
  onClose: () => void
  medicalMode?: boolean
  medicalCashPremium?: number
  medicalOldCashPremium?: number
  ltcMode?: boolean
  expenseMode?: boolean
  lifeExpectancy?: number
  clientAge?: number
}) {
  // Helper: compute remaining premium years for an existing replaced policy
  function remainingPremYears(p: ReplacedPolicy): number {
    const pm = p.premiumMaturity || ''
    const currentYear = new Date().getFullYear()
    if (!pm || pm === 'Renewable') return 0
    if (pm === 'Lifetime') return Math.max(0, (lifeExpectancy || 85) - (clientAge || 35))
    // Age X format e.g. "Age 65" — can't resolve without DOB, treat as lifetime
    if (/^Age\s+\d+$/i.test(pm)) return 0
    // YYYY-MM-DD date
    const matYear = new Date(pm).getFullYear()
    if (!isNaN(matYear)) return Math.max(0, matYear - currentYear)
    return 0
  }

  // Helper: parse new product premium term as years
  function newPremTermYears(): number {
    const pt = rec.premiumTerm || ''
    if (!pt) return 20
    const num = parseInt(pt)
    if (!isNaN(num) && num > 0) return num
    // "ILP" or "Whole Life" style — use policyTerm or fallback
    const pol = parseInt(rec.policyTerm || '')
    if (!isNaN(pol) && pol > 0) return pol
    return 20
  }
  const [cvValues, setCvValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    rec.replacedPolicies.forEach(p => { init[p.policyId] = p.currentCashValue || 0 })
    return init
  })

  const isReplacement = rec.mode === 'replacement'
  const oldPremium    = rec.replacedPolicies.reduce((s, p) => s + p.annualPremium, 0)
  const oldMedisave   = rec.replacedPolicies.reduce((s, p) => s + (p.premiumMedisave || 0), 0)
  const oldCash       = rec.replacedPolicies.reduce((s, p) => s + (p.annualPremium - (p.premiumMedisave || 0)), 0)

  // LTC: auto-split at $600 cap
  const ltcMedisave   = ltcMode ? Math.min(rec.annualPremium, 600) : 0
  const ltcCash       = ltcMode ? Math.max(rec.annualPremium - 600, 0) : 0

  // For medical: compare cash portions only
  const displayNewPremium = medicalMode ? (medicalCashPremium ?? rec.annualPremium) : ltcMode ? ltcCash : rec.annualPremium
  const displayOldPremium = medicalMode ? (medicalOldCashPremium ?? oldPremium) : ltcMode ? oldCash : oldPremium
  const netAnnual     = displayNewPremium - displayOldPremium
  const netMonthly    = netAnnual / 12

  const totalCV       = Object.values(cvValues).reduce((s, v) => s + v, 0)
  const policyTermYrs = parseInt(rec.policyTerm) || 20

  // Expense replacement: per-policy old cost over remaining years, capped at new term
  const newTermYrs    = expenseMode ? newPremTermYears() : policyTermYrs
  const oldTotalCost  = expenseMode
    ? rec.replacedPolicies.reduce((s, p) => {
        return s + p.annualPremium * remainingPremYears(p)
      }, 0)
    : displayOldPremium * newTermYrs
  const newTotalCost  = expenseMode ? displayNewPremium * newTermYrs : Math.max(0, netAnnual) * policyTermYrs
  const totalNetOutcomeExpense = (oldTotalCost - newTotalCost) + totalCV  // positive = saved

  const yearsCV       = netAnnual > 0 ? Math.floor(totalCV / netAnnual) : 999

  // Cash flow: use cash-only portion for LTC
  const annualSurplus         = annualSurplusOverride ?? (monthlyIncome - monthlyExpenses) * 12
  const cashOutflow           = ltcMode ? ltcCash : displayNewPremium
  const newAdditionAnnual     = !isReplacement ? cashOutflow : 0
  const surplusAfterAnnual    = isReplacement
    ? annualSurplus - netAnnual
    : annualSurplus - newAdditionAnnual
  const surplusAfterMonthly   = surplusAfterAnnual / 12

  const totalNetOutcome = expenseMode ? totalNetOutcomeExpense : totalCV - Math.max(0, netAnnual) * policyTermYrs

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
        {ltcMode ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              {metCard('New annual premium (Medisave)', fmt(ltcMedisave) + ' / yr', 'Medisave portion (max S$600/yr)', '#7A9CBF')}
              {isReplacement
                ? metCard('Old premium (Medisave)', fmt(oldMedisave) + ' / yr', `${rec.replacedPolicies.length} polic${rec.replacedPolicies.length === 1 ? 'y' : 'ies'} cancelled`, '#1E4D35')
                : metCard('Monthly benefit', fmt(rec.monthlyBenefit), rec.benefitPaymentPeriod || 'Benefit period', '#1E4D35')
              }
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              {metCard('Annual premium (Cash)', fmt(ltcCash) + ' / yr', 'Cash portion above S$600/yr cap', '#854F0B')}
              {isReplacement
                ? metCard('Old premium (Cash)', fmt(oldCash) + ' / yr', 'Cash portion of replaced policies', '#854F0B')
                : null
              }
            </div>
            {isReplacement && (
              <div style={{ marginBottom: 16 }}>
                {metCard(
                  'Net annual change (Cash)',
                  (netAnnual > 0 ? '+' : '') + fmt(netAnnual) + ' / yr',
                  netAnnual > 0 ? 'Additional cash outflow' : 'Annual cash savings',
                  netAnnual > 0 ? '#9B1C1C' : '#1E4D35'
                )}
              </div>
            )}
            {/* Monthly benefit change + coverage term */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              {metCard('Monthly benefit change', fmt(rec.monthlyBenefit), rec.coverageType || 'Monthly benefit', '#1E4D35')}
              {rec.benefitTerm && metCard('Benefit terms', rec.benefitTerm, rec.benefitPaymentPeriod || '', '#9B7BAA')}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              <div style={!isReplacement ? { gridColumn: '1 / -1' } : undefined}>
                {metCard(
                  medicalMode ? 'New cash premium' : 'New annual premium',
                  fmt(displayNewPremium) + ' / yr',
                  medicalMode ? 'Cash portion only (excl. Medisave)' : (rec.premiumTerm ? `${rec.premiumTerm} payment term` : ''),
                  '#854F0B'
                )}
              </div>
              {isReplacement &&
                metCard(
                  medicalMode ? 'Old cash premiums freed up' : 'Old premiums freed up',
                  fmt(displayOldPremium) + ' / yr',
                  `${rec.replacedPolicies.length} polic${rec.replacedPolicies.length === 1 ? 'y' : 'ies'} cancelled`,
                  '#1E4D35'
                )
              }
            </div>
            {isReplacement && (
              <div style={{ marginBottom: 20 }}>
                {metCard(
                  'Net annual change (cash)',
                  (netAnnual > 0 ? '+' : '') + fmt(netAnnual) + ' / yr',
                  netAnnual > 0 ? 'Additional cash outflow' : 'Annual cash savings',
                  netAnnual > 0 ? '#9B1C1C' : '#1E4D35'
                )}
              </div>
            )}

          </>
        )}

        {/* Cash flow impact */}
        <div style={{ borderTop: '1px solid var(--cream3)', paddingTop: 16, marginBottom: 20 }}>
          <div style={{ ...S.lbl, marginBottom: 10 }}>Cash flow impact</div>
          {monthlyIncome === 0 && monthlyExpenses === 0 ? (
            <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>
              Cash flow data not available — please complete the Financial Profile first.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {metCard(
                'Annual surplus (before)',
                fmt(annualSurplus) + ' / yr',
                'Income minus expenses',
                'var(--ink2)'
              )}
              {metCard(
                'Annual surplus (after)',
                fmt(surplusAfterAnnual) + ' / yr',
                surplusAfterAnnual >= 0 ? 'Positive cashflow' : 'Cashflow deficit',
                surplusAfterAnnual >= 0 ? '#1E4D35' : '#9B1C1C'
              )}
            </div>
          )}
        </div>

        {/* Cash value section — replacements only, not for medical or LTC */}
        {isReplacement && rec.replacedPolicies.length > 0 && !medicalMode && !ltcMode && (
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
            {!medicalMode && (<>
              {expenseMode && isReplacement && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    {metCard('Old cost (remaining yrs)', fmt(oldTotalCost), `${rec.replacedPolicies.map(p => { const r = remainingPremYears(p); return (r >= (lifeExpectancy || 85) ? '~' + r : r) + ' yrs' }).join(', ')} remaining`, '#9B1C1C')}
                    {metCard(`New cost (${newTermYrs}-yr term)`, fmt(newTotalCost), `${fmt(displayNewPremium)} / yr × ${newTermYrs} yrs`, '#854F0B')}
                  </div>
                </div>
              )}
              <div style={{
                background: totalNetOutcome >= 0 ? '#D1FAE5' : '#FEE2E2',
                borderRadius: 8, padding: '12px 16px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12,
              }}>
                <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  Total net outcome over {expenseMode ? newTermYrs : policyTermYrs}-year premium term
                </span>
                <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: totalNetOutcome >= 0 ? '#1E4D35' : '#9B1C1C' }}>
                  {totalNetOutcome >= 0 ? '' : '-'}{fmt(Math.abs(totalNetOutcome))} {totalNetOutcome >= 0 ? 'saved' : 'increase'}
                </span>
              </div>
            </>)}
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

  // Waterfall — run twice over the same goal order: once against the existing
  // portfolio alone, once against existing + this product. The difference per
  // goal (which can only be >= 0, since the pool only grows) is exactly how
  // much of that goal's coverage this specific product is responsible for —
  // used below to split the bar into an "existing" segment and a "this
  // product" segment instead of one undifferentiated color.
  function runWaterfall(pool: number) {
    let remaining = pool
    return orderedGoals.map(g => {
      const funded = Math.min(remaining, g.targetCorpus)
      remaining = Math.max(0, remaining - g.targetCorpus)
      const shortfall = Math.max(0, g.targetCorpus - funded)
      const pct = g.targetCorpus > 0 ? Math.min(100, Math.round((funded / g.targetCorpus) * 100)) : 100
      return { ...g, funded, shortfall, pct }
    })
  }
  const existingResults = runWaterfall(existingPortfolioValue)
  const withResults = runWaterfall(existingPortfolioValue + projValue)
  const goalResults = (view === 'with' ? withResults : existingResults).map((g, idx) => ({
    ...g,
    existingFunded: existingResults[idx].funded,
    productFunded: view === 'with' ? Math.max(0, withResults[idx].funded - existingResults[idx].funded) : 0,
  }))

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
            {view === 'with' && (
              <div style={{ display: 'flex', gap: 14, marginBottom: 12, fontFamily: 'Inter', fontSize: 11, color: 'var(--ink2)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: '#7A9CBF', display: 'inline-block' }} />
                  Existing portfolio
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: '#2D5A4E', display: 'inline-block' }} />
                  This product
                </span>
              </div>
            )}
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
                  <div style={{ height: 8, background: 'var(--cream3)', borderRadius: 4, overflow: 'hidden', marginBottom: 4, display: 'flex' }}>
                    <div style={{ width: `${g.targetCorpus > 0 ? Math.min(100, (g.existingFunded / g.targetCorpus) * 100) : 0}%`, height: '100%', background: '#7A9CBF', transition: 'width 0.4s' }} />
                    {g.productFunded > 0 && (
                      <div style={{ width: `${g.targetCorpus > 0 ? Math.min(100, (g.productFunded / g.targetCorpus) * 100) : 0}%`, height: '100%', background: '#2D5A4E', borderLeft: '1px solid #fff', transition: 'width 0.4s' }} />
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'Inter', fontSize: 11 }}>
                    <span style={{ color: statusColor(g.pct) }}>{fmt(g.funded)} covered</span>
                    {g.shortfall > 0 && <span style={{ color: '#9B1C1C' }}>{fmt(g.shortfall)} short</span>}
                  </div>
                  {g.productFunded > 0 && (
                    <div style={{ display: 'flex', gap: 12, marginTop: 3, fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: '#7A9CBF', display: 'inline-block' }} />
                        Existing {fmt(g.existingFunded)}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#2D5A4E', fontWeight: 600 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: '#2D5A4E', display: 'inline-block' }} />
                        This product +{fmt(g.productFunded)}
                      </span>
                    </div>
                  )}
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

// ─── COMBINED GOAL IMPACT MODAL ───────────────────────────────────────────────

interface FundingSource { key: string; label: string; amount: number; color: string }

// Waterfall across ALL chosen accumulation products together (not just one).
// Sources drain in a fixed order — existing portfolio first, then products in
// the order they're passed in — against goals in target-age order. Nothing is
// earmarked to a goal, so this is an allocation convention, not a guarantee:
// it shows one coherent way the money could stack up, consistent with how the
// single-product "View impact" waterfall already works.
function runCombinedWaterfall(sources: FundingSource[], sortedGoals: GoalItem[]) {
  const remaining = sources.map(s => s.amount)
  return sortedGoals.map(goal => {
    let need = goal.targetCorpus
    const contributions: { source: FundingSource; amount: number }[] = []
    for (let i = 0; i < sources.length && need > 0.5; i++) {
      if (remaining[i] <= 0) continue
      const take = Math.min(remaining[i], need)
      if (take > 0) {
        contributions.push({ source: sources[i], amount: take })
        remaining[i] -= take
        need -= take
      }
    }
    const funded = goal.targetCorpus - need
    const shortfall = Math.max(0, need)
    const pct = goal.targetCorpus > 0 ? Math.min(100, Math.round((funded / goal.targetCorpus) * 100)) : 100
    return { goal, contributions, funded, shortfall, pct }
  })
}

function CombinedGoalImpactModal({ data, goals, existingPortfolioValue, personTabs, onClose }: {
  data: RecPageData
  goals: GoalItem[]
  existingPortfolioValue: number
  personTabs: { key: string; label: string }[]
  onClose: () => void
}) {
  const personLabel = (key: string) => key === 'joint' ? 'Joint' : (personTabs.find(t => t.key === key)?.label || key)

  const chosenProducts = Object.keys(data.accumulationByPerson || {}).flatMap(personKey =>
    (data.accumulationByPerson[personKey] || [])
      .filter(r => r.isChosen)
      .map(r => ({ rec: r, personKey, label: `${r.company || r.planType || 'Accumulation plan'} (${personLabel(personKey)})`, projValue: calcProjectedValue(r) }))
  )

  const sources: FundingSource[] = [
    { key: 'existing', label: 'Existing portfolio', amount: existingPortfolioValue, color: '#9A9690' },
    ...chosenProducts.map((p, i) => ({ key: p.rec.id, label: p.label, amount: p.projValue, color: PRODUCT_COLOR_PALETTE[i % PRODUCT_COLOR_PALETTE.length] })),
  ]

  const sortedGoals = [...goals].sort((a, b) => a.targetAge - b.targetAge)
  const results = runCombinedWaterfall(sources, sortedGoals)

  const statusBg    = (p: number) => p >= 100 ? '#D1FAE5' : p >= 60 ? '#FEF3C7' : '#FEE2E2'
  const statusColor = (p: number) => p >= 100 ? '#1E4D35' : p >= 60 ? '#854F0B' : '#9B1C1C'
  const statusLabel = (p: number) => p >= 100 ? 'Fully funded' : p >= 60 ? 'Partially funded' : 'Shortfall'

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }
  const modal:   React.CSSProperties = { background: '#fff', borderRadius: 12, border: '1px solid var(--cream3)', width: 640, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', padding: '28px' }

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={modal}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>Combined Goal Progress</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', marginBottom: 20 }}>
          All chosen Wealth Accumulation products, funded against goals in target-age order.
        </div>

        {sortedGoals.length === 0 ? (
          <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>No goals set up yet.</div>
        ) : (
          <>
            {/* Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', background: 'var(--cream)', border: '1px solid var(--cream3)', borderRadius: 8, padding: '12px 14px', marginBottom: 20 }}>
              {sources.filter(s => s.amount > 0).map(s => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Inter', fontSize: 12, color: 'var(--ink2)' }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                  {s.label}
                </div>
              ))}
              {sources.filter(s => s.amount > 0).length === 0 && (
                <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>No existing portfolio value or chosen products yet.</span>
              )}
            </div>

            <div style={{ ...S.lbl, marginBottom: 10 }}>Goal progress</div>
            {results.map(({ goal, contributions, funded, shortfall, pct }, idx) => (
              <div key={goal.id} style={{ padding: '14px 0', borderBottom: idx < results.length - 1 ? '1px solid var(--cream3)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, background: statusBg(pct) }}>
                    {goal.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                      <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{goal.label}</div>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, fontFamily: 'Inter', background: statusBg(pct), color: statusColor(pct) }}>
                        {statusLabel(pct)}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginBottom: 8 }}>Target age {goal.targetAge} · Need {fmt(goal.targetCorpus)}</div>
                    <div style={{ height: 8, background: 'var(--cream3)', borderRadius: 4, overflow: 'hidden', display: 'flex', marginBottom: 6 }}>
                      {contributions.map(c => (
                        <div key={c.source.key} style={{ width: `${Math.min(100, (c.amount / goal.targetCorpus) * 100)}%`, height: '100%', background: c.source.color }} />
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontFamily: 'Inter', fontSize: 11, color: 'var(--ink2)' }}>
                      {contributions.length === 0 ? (
                        <span>S$0 covered</span>
                      ) : contributions.map(c => (
                        <span key={c.source.key}>{c.source.label} <span style={{ fontFamily: 'DM Mono, monospace' }}>{fmt(c.amount)}</span></span>
                      ))}
                    </div>
                    {shortfall > 0 && (
                      <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#9B1C1C', marginTop: 4 }}>{fmt(shortfall)} short</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </>
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

function MedicalCard({ rec, personAge, personName, medisaveBands, onChange, onDelete, onChoose,
  existingPolicies, medicalCompanies, products, monthlyIncome, monthlyExpenses, annualSurplusOverride }: {
  rec: MedicalRec
  personAge: number
  personName: string
  medisaveBands: MedisaveBand[]
  onChange: (r: MedicalRec) => void
  onDelete: () => void
  onChoose: () => void
  existingPolicies: { id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number; lifeAssured: string; categoryCode: string }[]
  medicalCompanies: { id: number; name: string }[]
  products: InsProduct[]
  monthlyIncome: number
  monthlyExpenses: number
  annualSurplusOverride?: number
}) {
  const [showImpact, setShowImpact] = useState(false)
  function upd<K extends keyof MedicalRec>(k: K, v: MedicalRec[K]) { onChange({ ...rec, [k]: v }) }
  function updRider<K extends keyof MedicalRider>(k: K, v: MedicalRider[K]) { onChange({ ...rec, rider: { ...rec.rider, [k]: v } }) }

  const msLimit = medisaveLimitFromBands(personAge, medisaveBands)
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
  // Only show medical policies for this person in replacement picker
  // lifeAssured may be stored as first name only ("Andy Au") while personName is full name ("Au Chi Hoi")
  // Match if any word in lifeAssured appears in personName, or personName contains lifeAssured, or vice versa
  function personMatch(lifeAssured: string, tabName: string): boolean {
    if (!lifeAssured) return true  // if no lifeAssured stored, show for all
    const la = lifeAssured.toLowerCase().trim()
    const tn = tabName.toLowerCase().trim()
    if (la === tn) return true
    // Check if any word in lifeAssured matches any word in tabName
    const laWords = la.split(/\s+/)
    const tnWords = tn.split(/\s+/)
    return laWords.some(w => w.length > 1 && tnWords.includes(w))
  }
  const personMedicalPolicies = existingPolicies.filter(p =>
    p.categoryCode === 'medical' && personMatch(p.lifeAssured, personName)
  )

  const filteredProducts = selComp ? products.filter(p => p.company_id === selComp.id) : []

  // Rider products filtered by rider insurer
  const riderComp = medicalCompanies.find(c => c.name === (rec.rider?.insurer || ''))
  const riderProducts = riderComp ? products.filter(p => p.company_id === riderComp.id) : []

  function togglePolicy(pol: typeof existingPolicies[0]) {
    const exists = rec.replacedPolicies.find(p => p.policyId === pol.id)
    if (exists) upd('replacedPolicies', rec.replacedPolicies.filter(p => p.policyId !== pol.id))
    else upd('replacedPolicies', [...rec.replacedPolicies, { policyId: pol.id, policyName: pol.policyName, companyName: pol.companyName, annualPremium: pol.annualPremium, premiumMedisave: (pol as any).premiumMedisave || 0, currentCashValue: pol.currentCashValue, monthlyBenefit: 0, benefitTerm: '', deathBenefit: 0, tpdBenefit: 0, advCiBenefit: 0, earlyCiBenefit: 0, inceptionDate: '', premiumMaturity: '' }])
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

        <div style={{ padding: '16px 16px 0' }}>
          <RationaleField value={rec.rationale} onChange={v => upd('rationale', v)} />
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

        </div>

        {/* Main plan premium — single input, auto-splits into Medisave + Cash */}
        {(hasMain || isIntl) && (() => {
          const totalPrem = totalMainPremium
          const autoMedisave = isIntl ? 0 : Math.min(totalPrem, msLimit)
          const autoCash     = Math.max(0, totalPrem - autoMedisave)
          return (
            <div style={{ padding: '0 16px 16px' }}>
              <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={S.lbl}>Main plan premium</div>
                  {!isIntl && (
                    <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>
                      Medisave limit age {personAge}: <strong style={{ color: '#7A9CBF' }}>S${msLimit}/yr</strong>
                    </div>
                  )}
                </div>
                {/* Single annual premium input */}
                <div style={{ marginBottom: 12 }}>
                  <label style={S.lbl}>Annual premium (S$/yr)</label>
                  <input
                    type="number"
                    style={S.inp}
                    value={totalPrem || ''}
                    placeholder="0"
                    onChange={e => {
                      const total = Number(e.target.value) || 0
                      const ms = isIntl ? 0 : Math.min(total, msLimit)
                      onChange({ ...rec, premiumMedisave: ms, premiumCash: Math.max(0, total - ms) })
                    }}
                  />
                </div>
                {/* Auto-split breakdown — read only */}
                {!isIntl && totalPrem > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                    <div>
                      <label style={S.lbl}>Medisave (auto)</label>
                      <div style={{ ...S.inp, background: 'var(--cream3)', color: autoMedisave >= msLimit ? '#854F0B' : '#1E4D35', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                        S${autoMedisave.toLocaleString('en-SG')}
                        {autoMedisave >= msLimit && <span style={{ fontSize: 10, marginLeft: 6, fontWeight: 400, color: '#854F0B' }}>(at limit)</span>}
                      </div>
                    </div>
                    <div>
                      <label style={S.lbl}>Cash (auto)</label>
                      <div style={{ ...S.inp, background: 'var(--cream3)', color: autoCash > 0 ? '#9B1C1C' : 'var(--ink3)', fontWeight: autoCash > 0 ? 600 : 400, display: 'flex', alignItems: 'center' }}>
                        {autoCash > 0 ? `S$${autoCash.toLocaleString('en-SG')}` : '—'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

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
              {personMedicalPolicies.length === 0 && (
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic', marginBottom: 8 }}>
                  No active medical policies found for {personName}.
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {personMedicalPolicies.map(pol => {
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
                    newCoverageType={rec.productName || COVERAGE_MODE_LABELS[rec.coverageMode]}
                    medicalMode={true}
                    newCashPremium={rec.premiumCash + (hasRider ? (rec.rider?.annualPremium || 0) : 0)}
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
            monthlyBenefit: 0,
            benefitPaymentPeriod: '',
            benefitTerm: '',
            premiumMedisave: 0,
            premiumCash: 0,
            coverageType: COVERAGE_MODE_LABELS[rec.coverageMode],
            policyTerm: 'Lifetime renewable',
            annualPremium: totalMainPremium + (hasRider ? (rec.rider?.annualPremium || 0) : 0),
            baseDeathBenefit: 0, baseTpdBenefit: 0, baseAdvCiBenefit: 0, baseEarlyCiBenefit: 0,
            coverageMultiplier: 1, multiplierEnd: '', deathBenefit: 0, tpdBenefit: 0, advCiBenefit: 0, earlyCiBenefit: 0,
            interestRate: '', premiumWaiver: 'Nil', isUsdPolicy: false,
            accidentalDeathBenefit: 0, accidentalDisabilityBenefit: 0, medicalExpenseBenefit: 0,
          }}
          monthlyIncome={monthlyIncome}
          monthlyExpenses={monthlyExpenses}
          medicalMode={true}
          medicalCashPremium={rec.premiumCash + (hasRider ? (rec.rider?.annualPremium || 0) : 0)}
          medicalOldCashPremium={rec.replacedPolicies.reduce((s, p) => s + (p.annualPremium - (p.premiumMedisave || 0)), 0)}
          annualSurplusOverride={annualSurplusOverride}
          onClose={() => setShowImpact(false)}
        />
      )}
    </>
  )
}

// ─── PROTECTION CARD ──────────────────────────────────────────────────────────

// ─── LTC CARD ─────────────────────────────────────────────────────────────────

const LTC_COVERAGE_TYPES = ['LTC Supplement', 'Disability Income']
const BENEFIT_PAYMENT_PERIODS = ['To Age 55', 'To Age 60', 'To Age 65', 'To Age 70', 'Lifetime']
const LTC_BENEFIT_TERMS: Record<string, string[]> = {
  'ltc supplement': ['1/6 ADLs', '2/6 ADLs', '3/6 ADLs'],
  'disability income': ['Own Occupation', 'Modified Own Occupation', 'Any Occupation'],
}
function getLtcBenefitTerms(coverageType: string): string[] {
  const ct = coverageType.toLowerCase().trim()
  if (ct.includes('disability') || ct.includes('income')) {
    return ['Own Occupation', 'Modified Own Occupation', 'Any Occupation']
  }
  if (ct.includes('ltc') || ct.includes('careshield') || ct.includes('supplement') || ct.includes('supp')) {
    return ['1/6 ADLs', '2/6 ADLs', '3/6 ADLs']
  }
  return []
}

function LtcCard({ rec, onChange, onDelete, onChoose,
  existingPolicies, ltcCompanies, products, coverageTypes, personName, monthlyIncome, monthlyExpenses, annualSurplusOverride }: {
  rec: ProtRec
  onChange: (r: ProtRec) => void
  onDelete: () => void
  onChoose: () => void
  existingPolicies: { id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number; lifeAssured: string; categoryCode: string; monthlyBenefit: number; benefitTerm: string; premiumMedisave: number }[]
  ltcCompanies: { id: number; name: string }[]
  products: InsProduct[]
  coverageTypes: string[]
  personName: string
  monthlyIncome: number
  monthlyExpenses: number
  annualSurplusOverride?: number
}) {
  const [showImpact, setShowImpact] = useState(false)
  function upd<K extends keyof ProtRec>(k: K, v: ProtRec[K]) { onChange({ ...rec, [k]: v }) }

  // Auto-split premium at $600 Medisave cap
  function handlePremiumChange(total: number) {
    const ms   = Math.min(total, 600)
    const cash = Math.max(total - 600, 0)
    onChange({ ...rec, annualPremium: total, premiumMedisave: ms, premiumCash: cash })
  }

  // Products filtered by selected insurer
  const selComp = ltcCompanies.find(c => c.name === rec.insurer)
  const filteredProducts = selComp ? products.filter(p => p.company_id === selComp.id) : []

  // Coverage term options depend on coverage type
  const benefitTermOptions = getLtcBenefitTerms(rec.coverageType)

  // Replacement picker: LTC category + person name match
  function personMatch(lifeAssured: string, tabName: string): boolean {
    if (!lifeAssured) return true
    const la = lifeAssured.toLowerCase().trim()
    const tn = tabName.toLowerCase().trim()
    if (la === tn) return true
    const laWords = la.split(/\s+/)
    const tnWords = tn.split(/\s+/)
    return laWords.some(w => w.length > 1 && tnWords.includes(w))
  }
  const ltcPolicies = existingPolicies.filter(p =>
    p.categoryCode === 'ltc' && personMatch(p.lifeAssured, personName)
  )

  function togglePolicy(pol: typeof ltcPolicies[0]) {
    const exists = rec.replacedPolicies.find(p => p.policyId === pol.id)
    if (exists) upd('replacedPolicies', rec.replacedPolicies.filter(p => p.policyId !== pol.id))
    else upd('replacedPolicies', [...rec.replacedPolicies, { policyId: pol.id, policyName: pol.policyName, companyName: pol.companyName, annualPremium: pol.annualPremium, premiumMedisave: pol.premiumMedisave || 0, currentCashValue: 0, monthlyBenefit: pol.monthlyBenefit || 0, benefitTerm: pol.benefitTerm || '', deathBenefit: 0, tpdBenefit: 0, advCiBenefit: 0, earlyCiBenefit: 0, inceptionDate: '', premiumMaturity: '' }])
  }

  const borderStyle = rec.isChosen ? '2px solid #2D5A4E' : '1px solid var(--cream3)'
  const effectiveCoverageTypes = coverageTypes.length > 0 ? coverageTypes : LTC_COVERAGE_TYPES
  const ltcMedisave = Math.min(rec.annualPremium || 0, 600)
  const ltcCash     = Math.max((rec.annualPremium || 0) - 600, 0)

  return (
    <>
      <div style={{ ...S.card, border: borderStyle }}>
        {/* Top bar */}
        <div style={{ background: 'var(--cream)', padding: '12px 16px', borderBottom: '1px solid var(--cream3)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <RankBadge rank={rec.rank} />
          {rec.isChosen && <ChosenBadge />}
          <ModeToggle mode={rec.mode} onChange={m => upd('mode', m)} />
        </div>

        <div style={{ padding: '16px 16px 0' }}>
          <RationaleField value={rec.rationale} onChange={v => upd('rationale', v)} />
        </div>

        {/* Core fields — row 1: Coverage Type / Insurer / Product */}
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px' }}>
          <div>
            <label style={S.lbl}>Coverage type</label>
            <select style={S.inp} value={rec.coverageType}
              onChange={e => onChange({ ...rec, coverageType: e.target.value, benefitTerm: '' })}>
              <option value="">Select type…</option>
              {effectiveCoverageTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Insurer</label>
            <select style={S.inp} value={rec.insurer}
              onChange={e => onChange({ ...rec, insurer: e.target.value, productName: '' })}>
              <option value="">Select insurer…</option>
              {ltcCompanies.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Product name</label>
            <select style={S.inp} value={rec.productName} onChange={e => upd('productName', e.target.value)}
              disabled={!rec.insurer}>
              <option value="">{rec.insurer ? 'Select product…' : 'Select insurer first'}</option>
              {filteredProducts.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>

          {/* Row 2: Monthly Benefit / Benefit Payment Period / Benefit Terms */}
          <div>
            <label style={S.lbl}>Monthly benefit (S$)</label>
            <input type="number" style={S.inp} value={rec.monthlyBenefit || ''} onChange={e => upd('monthlyBenefit', Number(e.target.value))} placeholder="0" />
          </div>
          <div>
            <label style={S.lbl}>Benefit payment period</label>
            <select style={S.inp} value={rec.benefitPaymentPeriod} onChange={e => upd('benefitPaymentPeriod', e.target.value)}>
              <option value="">Select period…</option>
              {BENEFIT_PAYMENT_PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Benefit terms</label>
            <select style={S.inp} value={rec.benefitTerm} onChange={e => upd('benefitTerm', e.target.value)}
              disabled={benefitTermOptions.length === 0}>
              <option value="">{benefitTermOptions.length === 0 ? 'Select coverage type first' : 'Select term…'}</option>
              {benefitTermOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Row 3: Premium / Policy term */}
          <div>
            <label style={S.lbl}>Premium term / Policy term</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={S.inp} value={rec.premiumTerm} onChange={e => upd('premiumTerm', e.target.value)} placeholder="e.g. 20 yrs" />
              <input style={S.inp} value={rec.policyTerm} onChange={e => upd('policyTerm', e.target.value)} placeholder="e.g. Life" />
            </div>
          </div>

          {/* Row 4: Benefits + Limitations side by side */}
          <div style={{ gridColumn: '1/4', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={S.lbl}>Benefits</label>
              <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 68, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.benefits} onChange={e => upd('benefits', e.target.value)} placeholder="Key benefits…" />
            </div>
            <div>
              <label style={S.lbl}>Limitations</label>
              <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 68, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.limitations} onChange={e => upd('limitations', e.target.value)} placeholder="Limitations or trade-offs…" />
            </div>
          </div>
        </div>

        {/* Annual premium panel — Medical card style */}
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={S.lbl}>Annual premium</div>
              <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>
                Medisave cap: <strong style={{ color: '#7A9CBF' }}>S$600/yr</strong>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={S.lbl}>Annual premium (S$/yr)</label>
              <input type="number" style={S.inp} value={rec.annualPremium || ''} placeholder="0" onChange={e => handlePremiumChange(Number(e.target.value))} />
            </div>
            {(rec.annualPremium || 0) > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                <div>
                  <label style={S.lbl}>Medisave (auto)</label>
                  <div style={{ ...S.inp, background: 'var(--cream3)', color: ltcMedisave >= 600 ? '#854F0B' : '#1E4D35', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                    S${ltcMedisave.toLocaleString('en-SG')}
                    {ltcMedisave >= 600 && <span style={{ fontSize: 10, marginLeft: 6, fontWeight: 400, color: '#854F0B' }}>(at limit)</span>}
                  </div>
                </div>
                <div>
                  <label style={S.lbl}>Cash (auto)</label>
                  <div style={{ ...S.inp, background: 'var(--cream3)', color: ltcCash > 0 ? '#9B1C1C' : 'var(--ink3)', fontWeight: ltcCash > 0 ? 600 : 400, display: 'flex', alignItems: 'center' }}>
                    {ltcCash > 0 ? `S$${ltcCash.toLocaleString('en-SG')}` : '—'}
                  </div>
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
              {ltcPolicies.length === 0 && (
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>No existing LTC policies found for this person — add them in the Protection Portfolio tab first.</div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {ltcPolicies.map(pol => {
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
                <CompareTable
                  replaced={rec.replacedPolicies}
                  newPremium={rec.annualPremium}
                  newSA={rec.monthlyBenefit}
                  newCoverageType={rec.coverageType}
                  ltcMode={true}
                  newProductName={rec.productName || rec.coverageType}
                  newMedisavePremium={ltcMedisave}
                  newCashOnlyPremium={ltcCash}
                  newBenefitTerm={rec.benefitTerm}
                />
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

      {showImpact && <ProtImpactModal rec={rec} monthlyIncome={monthlyIncome} monthlyExpenses={monthlyExpenses} annualSurplusOverride={annualSurplusOverride} ltcMode={true} onClose={() => setShowImpact(false)} />}
    </>
  )
}


// ─── COVERAGE TYPE CONSTANTS ──────────────────────────────────────────────────

const EXPENSE_COVERAGE_TYPES = [
  { code: 'WL',       label: 'WL - Whole Life' },
  { code: 'LWL',      label: 'LWL - Limited Premium Whole Life' },
  { code: 'L.Term',   label: 'L.Term - Level Term' },
  { code: 'D.Term',   label: 'D.Term - Decreasing Term / MRTA' },
  { code: 'ILP',      label: 'ILP - Investment Linked Plan' },
  { code: 'UL',       label: 'UL - Universal Life' },
  { code: 'IUL',      label: 'IUL - Indexed Universal Life' },
  { code: 'VUL',      label: 'VUL - Variable Universal Life' },
  { code: 'Grp Term', label: 'Grp Term - Group Term' },
]

const COVERAGE_MULTIPLIERS = Array.from({ length: 20 }, (_, i) => parseFloat(((i + 1) * 0.5).toFixed(1)))
const MULTIPLIER_ENDS = ['Age 55', 'Age 60', 'Age 65', 'Age 70', 'Age 75', 'Age 76', 'Age 80', 'Age 81', 'Age 85', 'Age 90']
const PREMIUM_WAIVER_OPTIONS = ['CI Waiver Benefit', 'Early CI Waiver Benefit', 'Payor Waiver Benefit', 'Nil']
const USD_COVERAGE_TYPES = ['UL', 'IUL', 'VUL']

const GENERAL_COVERAGE_TYPES = [
  { code: 'PA',    label: 'Personal Accident' },
  { code: 'Travel', label: 'Travel Insurance' },
  { code: 'Home',  label: 'Home Insurance' },
  { code: 'Motor', label: 'Motor Insurance' },
  { code: 'FDW',   label: 'Foreign Domestic Worker' },
]

// ─── GENERAL CARD ─────────────────────────────────────────────────────────────

function GeneralCard({ rec, onChange, onDelete, onChoose, generalCompanies, monthlyIncome, monthlyExpenses, annualSurplusOverride }: {
  rec: ProtRec
  onChange: (r: ProtRec) => void
  onDelete: () => void
  onChoose: () => void
  generalCompanies: { id: number; name: string }[]
  monthlyIncome: number
  monthlyExpenses: number
  annualSurplusOverride?: number
}) {
  function upd<K extends keyof ProtRec>(k: K, v: ProtRec[K]) { onChange({ ...rec, [k]: v }) }

  const borderStyle = rec.isChosen ? '2px solid #2D5A4E' : '1px solid var(--cream3)'

  return (
    <div style={{ ...S.card, border: borderStyle, marginBottom: 16 }}>
      {/* Top bar */}
      <div style={{ background: 'var(--cream)', padding: '12px 16px', borderBottom: '1px solid var(--cream3)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <RankBadge rank={rec.rank} />
        {rec.isChosen && <ChosenBadge />}
        <ModeToggle mode={rec.mode} onChange={m => upd('mode', m)} />
      </div>

      <div style={{ padding: '16px 16px 0' }}>
        <RationaleField value={rec.rationale} onChange={v => upd('rationale', v)} />
      </div>

      <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px' }}>
        {/* Row 1: Coverage Type → Insurer → Product Name */}
        <div>
          <label style={S.lbl}>Coverage type</label>
          <select style={S.inp} value={rec.coverageType} onChange={e => upd('coverageType', e.target.value)}>
            <option value="">Select type…</option>
            {GENERAL_COVERAGE_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={S.lbl}>Insurer</label>
          <select style={S.inp} value={rec.insurer} onChange={e => upd('insurer', e.target.value)}>
            <option value="">Select insurer…</option>
            {generalCompanies.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={S.lbl}>Product name</label>
          <input style={S.inp} value={rec.productName} onChange={e => upd('productName', e.target.value)} placeholder="e.g. PA Protector Plus" />
        </div>

        {rec.coverageType && (<>
          {/* Benefit fields */}
          <div>
            <label style={S.lbl}>Accidental Death Benefit (S$)</label>
            <input type="number" style={S.inp} value={rec.accidentalDeathBenefit || ''} onChange={e => upd('accidentalDeathBenefit', Number(e.target.value))} placeholder="0" />
          </div>
          <div>
            <label style={S.lbl}>Accidental Disability Benefit (S$)</label>
            <input type="number" style={S.inp} value={rec.accidentalDisabilityBenefit || ''} onChange={e => upd('accidentalDisabilityBenefit', Number(e.target.value))} placeholder="0" />
          </div>
          <div>
            <label style={S.lbl}>Medical Expense Benefit (S$)</label>
            <input type="number" style={S.inp} value={rec.medicalExpenseBenefit || ''} onChange={e => upd('medicalExpenseBenefit', Number(e.target.value))} placeholder="0" />
          </div>

          {/* Premium Term / Policy Term (default Renewable) */}
          <div>
            <label style={S.lbl}>Premium term</label>
            <input style={S.inp} value={rec.premiumTerm || 'Renewable'} onChange={e => upd('premiumTerm', e.target.value)} placeholder="Renewable" />
          </div>
          <div>
            <label style={S.lbl}>Policy term</label>
            <input style={S.inp} value={rec.policyTerm || 'Renewable'} onChange={e => upd('policyTerm', e.target.value)} placeholder="Renewable" />
          </div>
          <div>
            <label style={S.lbl}>Annual premium (S$)</label>
            <input type="number" style={S.inp} value={rec.annualPremium || ''} onChange={e => upd('annualPremium', Number(e.target.value))} placeholder="0" />
          </div>

          {/* Benefits / Limitations */}
          <div style={{ gridColumn: '1/3' }}>
            <label style={S.lbl}>Benefits</label>
            <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 68, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.benefits} onChange={e => upd('benefits', e.target.value)} placeholder="Key benefits…" />
          </div>
          <div>
            <label style={S.lbl}>Limitations</label>
            <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 68, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.limitations} onChange={e => upd('limitations', e.target.value)} placeholder="Limitations or trade-offs…" />
          </div>
        </>)}
      </div>

      {/* Actions */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--cream3)', display: 'flex', alignItems: 'center', gap: 8 }}>
        {rec.isChosen ? (
          <button onClick={onChoose} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: '1px solid var(--cream3)', background: 'transparent', color: 'var(--ink2)' }}>Unmark as chosen</button>
        ) : (
          <button onClick={onChoose} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: 'none', background: 'var(--charcoal)', color: 'var(--cream)', fontWeight: 600 }}>Mark as chosen</button>
        )}
        <button onClick={onDelete} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', border: '1px solid var(--cream3)', background: 'transparent', color: '#9B1C1C', marginLeft: 'auto' }}>Remove</button>
      </div>
    </div>
  )
}

// ─── EXPENSE CARD (CORE PROTECTION) ───────────────────────────────────────────

function ExpenseCard({ rec, onChange, onDelete, onChoose,
  existingPolicies, lifeCompanies, personName, monthlyIncome, monthlyExpenses, annualSurplusOverride, usdRate, lifeExpectancy, clientAge }: {
  rec: ProtRec
  onChange: (r: ProtRec) => void
  onDelete: () => void
  onChoose: () => void
  existingPolicies: { id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number; lifeAssured: string; categoryCode: string; deathBenefit: number; tpdBenefit: number; advCiBenefit: number; earlyCiBenefit: number; inceptionDate: string; premiumMaturity: string }[]
  lifeCompanies: { id: number; name: string }[]
  personName: string
  monthlyIncome: number
  monthlyExpenses: number
  annualSurplusOverride?: number
  usdRate: number
  lifeExpectancy: number
  clientAge: number
}) {
  const [showImpact, setShowImpact] = useState(false)
  function upd<K extends keyof ProtRec>(k: K, v: ProtRec[K]) { onChange({ ...rec, [k]: v }) }

  const ct = rec.coverageType
  const isWL  = ct === 'WL' || ct === 'LWL'
  const isTerm   = ct === 'L.Term'
  const isDTerm  = ct === 'D.Term'
  const isILP    = ct === 'ILP'
  const isUL     = ct === 'UL' || ct === 'IUL' || ct === 'VUL'
  const isGrp    = ct === 'Grp Term'
  const isUsd    = USD_COVERAGE_TYPES.includes(ct)
  const currLabel = isUsd ? 'USD' : 'S$'

  // Annualised premium in SGD for cashflow (UL/IUL/VUL convert via usdRate)
  const annualPremSGD = isUsd ? rec.annualPremium * usdRate : rec.annualPremium

  // WL/LWL computed benefits = base × multiplier
  const mult = rec.coverageMultiplier || 1
  const compDeath  = isWL ? Math.round(rec.baseDeathBenefit * mult) : rec.deathBenefit
  const compTpd    = isWL ? Math.round(rec.baseTpdBenefit   * mult) : rec.tpdBenefit
  const compAdvCi  = isWL ? Math.round(rec.baseAdvCiBenefit * mult) : rec.advCiBenefit
  const compEarlyCI = isWL ? Math.round(rec.baseEarlyCiBenefit * mult) : rec.earlyCiBenefit

  function personMatch(lifeAssured: string, tabName: string): boolean {
    if (!lifeAssured) return true
    const la = lifeAssured.toLowerCase().trim()
    const tn = tabName.toLowerCase().trim()
    if (la === tn || tn.includes(la) || la.includes(tn)) return true
    const laWords = la.split(/\s+/)
    const tnWords = tn.split(/\s+/)
    return laWords.some(w => w.length > 1 && tnWords.includes(w))
  }

  const lifePolicies = existingPolicies.filter(p =>
    p.categoryCode === 'life' && personMatch(p.lifeAssured, personName)
  )

  function togglePolicy(pol: typeof existingPolicies[0]) {
    const exists = rec.replacedPolicies.find(p => p.policyId === pol.id)
    if (exists) upd('replacedPolicies', rec.replacedPolicies.filter(p => p.policyId !== pol.id))
    else upd('replacedPolicies', [...rec.replacedPolicies, { policyId: pol.id, policyName: pol.policyName, companyName: pol.companyName, annualPremium: pol.annualPremium, premiumMedisave: 0, currentCashValue: pol.currentCashValue, monthlyBenefit: 0, benefitTerm: '', deathBenefit: pol.deathBenefit || 0, tpdBenefit: pol.tpdBenefit || 0, advCiBenefit: pol.advCiBenefit || 0, earlyCiBenefit: pol.earlyCiBenefit || 0, inceptionDate: pol.inceptionDate || '', premiumMaturity: pol.premiumMaturity || '' }])
  }

  function updateReplacedField(policyId: string, field: 'annualPremium' | 'currentCashValue', val: number) {
    upd('replacedPolicies', rec.replacedPolicies.map(p => p.policyId === policyId ? { ...p, [field]: val } : p))
  }

  const fmt = (n: number) => n ? n.toLocaleString('en-SG', { maximumFractionDigits: 0 }) : '—'
  const borderStyle = rec.isChosen ? '2px solid #2D5A4E' : '1px solid var(--cream3)'

  return (
    <>
      <div style={{ ...S.card, border: borderStyle, marginBottom: 16 }}>
        {/* Top bar */}
        <div style={{ background: 'var(--cream)', padding: '12px 16px', borderBottom: '1px solid var(--cream3)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <RankBadge rank={rec.rank} />
          {rec.isChosen && <ChosenBadge />}
          {isUsd && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A', fontFamily: 'Inter' }}>
              USD Policy — Premiums &amp; benefits in USD
            </span>
          )}
          <ModeToggle mode={rec.mode} onChange={m => upd('mode', m)} />
        </div>

        <div style={{ padding: '16px 16px 0' }}>
          <RationaleField value={rec.rationale} onChange={v => upd('rationale', v)} />
        </div>

        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px' }}>
          {/* Row 1: Coverage Type → Insurer → Product Name */}
          <div>
            <label style={S.lbl}>Coverage type</label>
            <select style={S.inp} value={rec.coverageType}
              onChange={e => onChange({ ...rec, coverageType: e.target.value, isUsdPolicy: USD_COVERAGE_TYPES.includes(e.target.value) })}>
              <option value="">Select type…</option>
              {EXPENSE_COVERAGE_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Insurer</label>
            <select style={S.inp} value={rec.insurer} onChange={e => upd('insurer', e.target.value)}>
              <option value="">Select insurer…</option>
              {lifeCompanies.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Product name</label>
            <input style={S.inp} value={rec.productName} onChange={e => upd('productName', e.target.value)} placeholder="e.g. MultiPay CI Advantage" />
          </div>

          {/* ── WL / LWL fields ── */}
          {isWL && (<>
            <div>
              <label style={S.lbl}>Base Death Benefit ({currLabel})</label>
              <input type="number" style={S.inp} value={rec.baseDeathBenefit || ''} onChange={e => upd('baseDeathBenefit', Number(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label style={S.lbl}>Base TPD Benefit ({currLabel})</label>
              <input type="number" style={S.inp} value={rec.baseTpdBenefit || ''} onChange={e => upd('baseTpdBenefit', Number(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label style={S.lbl}>Base Adv CI Benefit ({currLabel})</label>
              <input type="number" style={S.inp} value={rec.baseAdvCiBenefit || ''} onChange={e => upd('baseAdvCiBenefit', Number(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label style={S.lbl}>Base Early CI Benefit ({currLabel})</label>
              <input type="number" style={S.inp} value={rec.baseEarlyCiBenefit || ''} onChange={e => upd('baseEarlyCiBenefit', Number(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label style={S.lbl}>Coverage Multiplier</label>
              <select style={S.inp} value={rec.coverageMultiplier || 1} onChange={e => upd('coverageMultiplier', parseFloat(e.target.value))}>
                {COVERAGE_MULTIPLIERS.map(m => <option key={m} value={m}>{m}×</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>Multiplier End</label>
              <select style={S.inp} value={rec.multiplierEnd} onChange={e => upd('multiplierEnd', e.target.value)}>
                <option value="">Select age…</option>
                {MULTIPLIER_ENDS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            {/* Computed benefits read-only panel */}
            {(rec.baseDeathBenefit > 0 || rec.baseTpdBenefit > 0 || rec.baseAdvCiBenefit > 0 || rec.baseEarlyCiBenefit > 0) && (
              <div style={{ gridColumn: '1 / -1', background: 'var(--cream)', border: '1px solid var(--cream3)', borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ ...S.lbl, marginBottom: 10 }}>Effective benefits at {mult}× multiplier{rec.multiplierEnd ? ` (until ${rec.multiplierEnd})` : ''}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  {[
                    { label: 'Death', val: compDeath },
                    { label: 'TPD', val: compTpd },
                    { label: 'Adv CI', val: compAdvCi },
                    { label: 'Early CI', val: compEarlyCI },
                  ].map(({ label, val }) => (
                    <div key={label} style={{ background: '#fff', borderRadius: 6, padding: '8px 12px', border: '1px solid var(--cream3)' }}>
                      <div style={{ fontSize: 10, color: 'var(--ink3)', fontFamily: 'Inter', marginBottom: 3 }}>{label}</div>
                      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 600, color: 'var(--charcoal)' }}>
                        {currLabel} {fmt(val)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>)}

          {/* ── L.Term / D.Term / ILP / Grp Term fields ── */}
          {(isTerm || isDTerm || isILP || isGrp) && (<>
            <div>
              <label style={S.lbl}>Death Benefit ({currLabel})</label>
              <input type="number" style={S.inp} value={rec.deathBenefit || ''} onChange={e => upd('deathBenefit', Number(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label style={S.lbl}>TPD Benefit ({currLabel})</label>
              <input type="number" style={S.inp} value={rec.tpdBenefit || ''} onChange={e => upd('tpdBenefit', Number(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label style={S.lbl}>Adv CI Benefit ({currLabel})</label>
              <input type="number" style={S.inp} value={rec.advCiBenefit || ''} onChange={e => upd('advCiBenefit', Number(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label style={S.lbl}>Early CI Benefit ({currLabel})</label>
              <input type="number" style={S.inp} value={rec.earlyCiBenefit || ''} onChange={e => upd('earlyCiBenefit', Number(e.target.value))} placeholder="0" />
            </div>
            {isDTerm && (
              <div>
                <label style={S.lbl}>Interest Rate</label>
                <input style={S.inp} value={rec.interestRate} onChange={e => upd('interestRate', e.target.value)} placeholder="e.g. 4.5%" />
              </div>
            )}
          </>)}

          {/* ── UL / IUL / VUL fields ── */}
          {isUL && (<>
            <div>
              <label style={S.lbl}>Death Benefit (USD)</label>
              <input type="number" style={S.inp} value={rec.deathBenefit || ''} onChange={e => upd('deathBenefit', Number(e.target.value))} placeholder="0" />
            </div>
          </>)}

          {/* ── Shared: Premium Waiver (all except WL/LWL) ── */}
          {!isWL && ct && (
            <div>
              <label style={S.lbl}>Premium Waiver</label>
              <select style={S.inp} value={rec.premiumWaiver || 'Nil'} onChange={e => upd('premiumWaiver', e.target.value)}>
                {PREMIUM_WAIVER_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}

          {/* ── Shared: Premium Term / Coverage Term ── */}
          {ct && (<>
            <div>
              <label style={S.lbl}>Premium term</label>
              <input style={S.inp} value={rec.premiumTerm} onChange={e => upd('premiumTerm', e.target.value)} placeholder="e.g. 20 yrs / ILP" />
            </div>
            <div>
              <label style={S.lbl}>Coverage term</label>
              <input style={S.inp} value={rec.policyTerm} onChange={e => upd('policyTerm', e.target.value)} placeholder="e.g. Life / Age 70" />
            </div>
            <div>
              <label style={S.lbl}>Annual premium ({currLabel})</label>
              <div style={{ position: 'relative' }}>
                <input type="number" style={S.inp} value={rec.annualPremium || ''} onChange={e => upd('annualPremium', Number(e.target.value))} placeholder="0" />
                {isUsd && rec.annualPremium > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--ink3)', fontFamily: 'Inter', marginTop: 2 }}>
                    ≈ S$ {Math.round(rec.annualPremium * usdRate).toLocaleString('en-SG')} SGD
                  </div>
                )}
              </div>
            </div>
          </>)}

          {/* ── Benefits / Limitations ── */}
          {ct && (<>
            <div style={{ gridColumn: isUL ? '1/3' : '1/3' }}>
              <label style={S.lbl}>Benefits</label>
              <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 68, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.benefits} onChange={e => upd('benefits', e.target.value)} placeholder="Key benefits…" />
            </div>
            {!isDTerm && (
              <div>
                <label style={S.lbl}>Limitations</label>
                <textarea style={{ ...S.inp, resize: 'vertical', minHeight: 68, fontFamily: 'Inter', lineHeight: 1.5 }} value={rec.limitations} onChange={e => upd('limitations', e.target.value)} placeholder="Limitations or trade-offs…" />
              </div>
            )}
          </>)}
        </div>

        {/* Replacement section — Core Protection policies */}
        {rec.mode === 'replacement' && (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
              <div style={{ ...S.lbl, marginBottom: 10 }}>Replacing existing Core Protection policies</div>
              {lifePolicies.length === 0 && (
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>No Core Protection policies found — add them in the Protection Portfolio tab first.</div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {lifePolicies.map(pol => {
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
                  <CompareTable replaced={rec.replacedPolicies} newPremium={annualPremSGD} newSA={0} newCoverageType={ct} newProductName={rec.productName || ct} expenseMode={true} newDeathBenefit={compDeath} newTpdBenefit={compTpd} newAdvCiBenefit={compAdvCi} newEarlyCiBenefit={compEarlyCI} />
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

      {showImpact && <ProtImpactModal rec={rec} monthlyIncome={monthlyIncome} monthlyExpenses={monthlyExpenses} annualSurplusOverride={annualSurplusOverride} expenseMode={true} lifeExpectancy={lifeExpectancy} clientAge={clientAge} onClose={() => setShowImpact(false)} />}
    </>
  )
}

// ─── PROT CARD ────────────────────────────────────────────────────────────────

function ProtCard({ rec, category, onChange, onDelete, onChoose,
  existingPolicies, insurers, coverageTypes, monthlyIncome, monthlyExpenses, annualSurplusOverride }: {
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
  annualSurplusOverride?: number
}) {
  const [showImpact, setShowImpact] = useState(false)
  function upd<K extends keyof ProtRec>(k: K, v: ProtRec[K]) { onChange({ ...rec, [k]: v }) }

  function togglePolicy(pol: typeof existingPolicies[0]) {
    const exists = rec.replacedPolicies.find(p => p.policyId === pol.id)
    if (exists) upd('replacedPolicies', rec.replacedPolicies.filter(p => p.policyId !== pol.id))
    else upd('replacedPolicies', [...rec.replacedPolicies, { policyId: pol.id, policyName: pol.policyName, companyName: pol.companyName, annualPremium: pol.annualPremium, premiumMedisave: (pol as any).premiumMedisave || 0, currentCashValue: pol.currentCashValue, monthlyBenefit: 0, benefitTerm: '', deathBenefit: 0, tpdBenefit: 0, advCiBenefit: 0, earlyCiBenefit: 0, inceptionDate: '', premiumMaturity: '' }])
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

        <div style={{ padding: '16px 16px 0' }}>
          <RationaleField value={rec.rationale} onChange={v => upd('rationale', v)} />
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

      {showImpact && <ProtImpactModal rec={rec} monthlyIncome={monthlyIncome} monthlyExpenses={monthlyExpenses} annualSurplusOverride={annualSurplusOverride} onClose={() => setShowImpact(false)} />}
    </>
  )
}

// ─── ACCUMULATION CARD ────────────────────────────────────────────────────────

function AccCard({ rec, onChange, onDelete, onChoose, goals, existingPortfolioValue, existingPolicies, monthlyIncome, monthlyExpenses, accumulationCompanies, clientLabel, spouseLabel }: {
  rec: AccRec; onChange: (r: AccRec) => void; onDelete: () => void; onChoose: () => void
  goals: GoalItem[]; existingPortfolioValue: number
  existingPolicies: { id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number; categoryCode?: string }[]
  monthlyIncome: number; monthlyExpenses: number
  accumulationCompanies: { id: number; name: string }[]
  clientLabel: string; spouseLabel: string
}) {
  const [showImpact, setShowImpact] = useState(false)
  function upd<K extends keyof AccRec>(k: K, v: AccRec[K]) { onChange({ ...rec, [k]: v }) }

  // Only existing Wealth Accumulation Portfolio policies (categoryCode
  // 'endowment') belong here — replacing/topping up an investment product
  // with a medical or life policy from the wider Protection Portfolio list
  // doesn't make sense, so this scopes the picker to the same category.
  const accumulationPolicies = existingPolicies.filter(p => p.categoryCode === 'endowment')

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
          <ModeToggle mode={rec.mode} onChange={m => upd('mode', m)} modes={['new', 'replacement', 'topup']} />
          <div style={{ display: 'flex', border: '1px solid var(--cream3)', borderRadius: 6, overflow: 'hidden', marginLeft: 8 }}>
            {(['individual', 'joint'] as const).map(t => (
              <button key={t} onClick={() => upd('accountType', t)} style={{
                fontSize: 11, padding: '4px 12px', border: 'none', cursor: 'pointer', fontFamily: 'Inter',
                background: (rec.accountType || 'individual') === t ? 'var(--cream2)' : 'transparent',
                color: (rec.accountType || 'individual') === t ? 'var(--ink)' : 'var(--ink3)',
                fontWeight: (rec.accountType || 'individual') === t ? 600 : 400, textTransform: 'capitalize',
              }}>{t}</button>
            ))}
          </div>
          {(rec.accountType === 'joint') && (
            <span style={{ fontSize: 11, color: '#2D5A4E', fontFamily: 'Inter', fontStyle: 'italic' }}>Visible to all</span>
          )}
        </div>

        {rec.accountType === 'joint' && (
          <div style={{ padding: '16px 16px 0' }}>
            <div style={{ ...S.lbl, marginBottom: 6 }}>Contribution split</div>
            <JointSplitSlider
              clientPct={rec.jointSplitClientPct ?? 50}
              onChange={pct => upd('jointSplitClientPct', pct)}
              clientLabel={clientLabel}
              spouseLabel={spouseLabel}
            />
          </div>
        )}

        <div style={{ padding: '16px 16px 0' }}>
          <RationaleField value={rec.rationale} onChange={v => upd('rationale', v)} />
        </div>

        {/* Core fields */}
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px' }}>
          <div>
            <label style={S.lbl}>Product Type</label>
            <select style={S.inp} value={rec.planType} onChange={e => upd('planType', e.target.value)}>
              <option value="">Select…</option>
              {PLAN_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Company</label>
            <select style={S.inp} value={rec.company} onChange={e => upd('company', e.target.value)}>
              <option value="">Select insurer…</option>
              {accumulationCompanies.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div><label style={S.lbl}>Product Name / Account</label><input style={S.inp} value={rec.productType} onChange={e => upd('productType', e.target.value)} placeholder="e.g. Gro Capital Ease II" /></div>
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
              {accumulationPolicies.length === 0 && (
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic', marginBottom: 8 }}>
                  No existing Wealth Accumulation products found — add them in the Protection Portfolio tab first.
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {accumulationPolicies.map(pol => {
                  const selected = !!rec.replacedPolicies.find(p => p.policyId === pol.id)
                  return (
                    <button key={pol.id} onClick={() => {
                      const exists = rec.replacedPolicies.find(p => p.policyId === pol.id)
                      if (exists) upd('replacedPolicies', rec.replacedPolicies.filter(p => p.policyId !== pol.id))
                      else upd('replacedPolicies', [...rec.replacedPolicies, { policyId: pol.id, policyName: pol.policyName, companyName: pol.companyName, annualPremium: pol.annualPremium, premiumMedisave: (pol as any).premiumMedisave || 0, currentCashValue: pol.currentCashValue, monthlyBenefit: 0, benefitTerm: '', deathBenefit: 0, tpdBenefit: 0, advCiBenefit: 0, earlyCiBenefit: 0, inceptionDate: '', premiumMaturity: '' }])
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

        {/* Top-up */}
        {rec.mode === 'topup' && (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ background: 'var(--cream)', borderRadius: 8, padding: 14, border: '1px solid var(--cream3)' }}>
              <div style={{ ...S.lbl, marginBottom: 10 }}>Topping up existing product</div>
              {accumulationPolicies.length === 0 && (
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic', marginBottom: 8 }}>
                  No existing Wealth Accumulation products found — add them in the Protection Portfolio tab first.
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: rec.topupOf ? 12 : 0 }}>
                {accumulationPolicies.map(pol => {
                  const selected = rec.topupOf?.policyId === pol.id
                  return (
                    <button key={pol.id} onClick={() => {
                      if (selected) upd('topupOf', null)
                      else upd('topupOf', { policyId: pol.id, policyName: pol.policyName || pol.companyName, previousAnnualAmount: pol.annualPremium || 0 })
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
              {rec.topupOf && (
                <div style={{ maxWidth: 220 }}>
                  <label style={S.lbl}>Previous annual amount (S$)</label>
                  <input
                    type="number" style={S.inp}
                    value={rec.topupOf.previousAnnualAmount || ''}
                    onChange={e => upd('topupOf', { ...rec.topupOf!, previousAnnualAmount: Number(e.target.value) })}
                    placeholder="0"
                  />
                  <div style={{ marginTop: 10, fontSize: 12, fontFamily: 'Inter', color: 'var(--ink2)' }}>
                    Contribution above is <strong>added on top</strong> of the previous amount — new total: {' '}
                    <span style={{ fontFamily: 'DM Mono, monospace', color: '#1E4D35', fontWeight: 600 }}>
                      {fmt(rec.topupOf.previousAnnualAmount + calcAnnualContrib(rec))}/yr
                    </span>
                  </div>
                </div>
              )}
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
  existingPolicies, insurers, coverageTypes, monthlyIncome, monthlyExpenses, annualSurplusOverride }: {
  cat: typeof PROT_CATEGORIES[0]
  recs: ProtRec[]
  onAdd: () => void; onUpdate: (id: string, r: ProtRec) => void
  onDelete: (id: string) => void; onChoose: (id: string) => void
  existingPolicies: { id: string; policyName: string; companyName: string; annualPremium: number; currentCashValue: number }[]
  insurers: string[]; coverageTypes: string[]
  monthlyIncome: number; monthlyExpenses: number; annualSurplusOverride?: number
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
            annualSurplusOverride={annualSurplusOverride}
          />
        ))
      )}
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

// ─── CASHFLOW SIDEBAR ─────────────────────────────────────────────────────────

function CashflowSidebar({ open, onClose, data, activePerson, annualSurplus, personTabs }: {
  open: boolean
  onClose: () => void
  data: RecPageData
  activePerson: string
  annualSurplus: number
  personTabs: { key: string; label: string }[]
}) {
  const personLabel = personTabs.find(t => t.key === activePerson)?.label || 'Client'

  // ── derive cash impact for each chosen card ───────────────────────────────
  type ImpactRow = { label: string; section: string; cashDelta: number; mode: RecMode }
  const rows: ImpactRow[] = []

  // Medical — cash only (exclude Medisave)
  const medRecs = (data.medicalByPerson[activePerson] || []).filter(r => r.isChosen)
  medRecs.forEach(r => {
    const newCash = r.premiumCash + (r.rider?.annualPremium || 0)
    if (r.mode === 'replacement') {
      const oldCash = r.replacedPolicies.reduce((s, p) => s + (p.annualPremium - (p.premiumMedisave || 0)), 0)
      rows.push({ label: r.productName || r.briefCoverage || 'Medical plan', section: 'Medical Insurance', cashDelta: newCash - oldCash, mode: r.mode })
    } else {
      rows.push({ label: r.productName || r.briefCoverage || 'Medical plan', section: 'Medical Insurance', cashDelta: newCash, mode: r.mode })
    }
  })

  // LTC — cash only (above $600 cap)
  const ltcRecs = (data.ltcByPerson[activePerson] || []).filter(r => r.isChosen)
  ltcRecs.forEach(r => {
    const newCash = Math.max(r.annualPremium - 600, 0)
    if (r.mode === 'replacement') {
      const oldCash = r.replacedPolicies.reduce((s, p) => s + (p.annualPremium - (p.premiumMedisave || 0)), 0)
      rows.push({ label: r.productName || r.coverageType || 'LTC plan', section: 'LTC Protection', cashDelta: newCash - oldCash, mode: r.mode })
    } else {
      rows.push({ label: r.productName || r.coverageType || 'LTC plan', section: 'LTC Protection', cashDelta: newCash, mode: r.mode })
    }
  })

  // Expense / General — full premium (no Medisave)
  const expenseRecs = (data.expenseByPerson[activePerson] || []).filter(r => r.isChosen)
  expenseRecs.forEach(r => {
    if (r.mode === 'replacement') {
      const oldPrem = r.replacedPolicies.reduce((s, p) => s + p.annualPremium, 0)
      rows.push({ label: r.productName || r.coverageType || 'Expense plan', section: 'Core Protection', cashDelta: r.annualPremium - oldPrem, mode: r.mode })
    } else {
      rows.push({ label: r.productName || r.coverageType || 'Expense plan', section: 'Core Protection', cashDelta: r.annualPremium, mode: r.mode })
    }
  })

  const generalRecs = (data.generalByPerson[activePerson] || []).filter(r => r.isChosen)
  generalRecs.forEach(r => {
    if (r.mode === 'replacement') {
      const oldPrem = r.replacedPolicies.reduce((s, p) => s + p.annualPremium, 0)
      rows.push({ label: r.productName || r.coverageType || 'General plan', section: 'General Insurance', cashDelta: r.annualPremium - oldPrem, mode: r.mode })
    } else {
      rows.push({ label: r.productName || r.coverageType || 'General plan', section: 'General Insurance', cashDelta: r.annualPremium, mode: r.mode })
    }
  })

  // Accumulation — regular contributions only (cash outflow). For top-ups, the
  // amount the advisor enters is the ADDITIONAL contribution being added on top
  // of the existing premium (not a new total to net against) — so it's already
  // the correct incremental cash-flow figure, same as a new addition.
  const accRecs = (data.accumulationByPerson[activePerson] || []).filter(r => r.isChosen)
  accRecs.forEach(r => {
    const freqMult = r.regularFreq === 'Monthly' ? 12 : r.regularFreq === 'Quarterly' ? 4 : 1
    const annualContrib = r.hasRegular ? (r.regularAmount || 0) * freqMult : 0
    if (annualContrib > 0 || r.hasLumpSum) {
      const label = r.company || r.planType || 'Accumulation plan'
      rows.push({ label, section: 'Wealth Accumulation', cashDelta: annualContrib, mode: r.mode })
    }
  })

  // Joint accumulation — attribute each person's share of the contribution
  // using the advisor-set split (defaults to 50/50), same split used in the
  // Financial Report snapshot.
  if (activePerson === 'client' || activePerson === 'spouse') {
    const jointAccRecs = (data.accumulationByPerson['joint'] || []).filter(r => r.isChosen)
    jointAccRecs.forEach(r => {
      const freqMult = r.regularFreq === 'Monthly' ? 12 : r.regularFreq === 'Quarterly' ? 4 : 1
      const annualContrib = r.hasRegular ? (r.regularAmount || 0) * freqMult : 0
      const clientPct = r.jointSplitClientPct ?? 50
      const pct = activePerson === 'client' ? clientPct : (100 - clientPct)
      const share = annualContrib * pct / 100
      if (share > 0 || r.hasLumpSum) {
        const label = `${r.company || r.planType || 'Accumulation plan'} (joint, ${pct}%)`
        rows.push({ label, section: 'Wealth Accumulation', cashDelta: share, mode: r.mode })
      }
    })
  }

  const additions    = rows.filter(r => r.mode === 'new')
  const topups       = rows.filter(r => r.mode === 'topup')
  const replacements = rows.filter(r => r.mode === 'replacement')
  const totalAdditions    = additions.reduce((s, r) => s + r.cashDelta, 0)
  const totalTopups       = topups.reduce((s, r) => s + r.cashDelta, 0)
  const totalReplacements = replacements.reduce((s, r) => s + r.cashDelta, 0)
  const netAnnualCash     = totalAdditions + totalTopups + totalReplacements
  const surplusAfter      = annualSurplus - netAnnualCash
  const chosenCount       = rows.length

  const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--cream3)' }
  const labelStyle: React.CSSProperties = { fontFamily: 'Inter', fontSize: 12, color: 'var(--ink2)' }
  const sectionLabelStyle: React.CSSProperties = { fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink3)', marginTop: 14, marginBottom: 4 }
  const valStyle = (n: number): React.CSSProperties => ({
    fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 600,
    color: n > 0 ? '#9B1C1C' : n < 0 ? '#1E4D35' : 'var(--ink3)'
  })

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.3)', zIndex: 998 }} />
      )}

      {/* Floating trigger button */}
      <button
        onClick={onClose}
        style={{
          position: 'fixed', right: open ? 364 : 0, top: '50%', transform: 'translateY(-50%)',
          zIndex: 1000, background: 'var(--charcoal)', color: 'var(--cream)',
          border: 'none', borderRadius: '8px 0 0 8px', padding: '14px 10px',
          cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          transition: 'right 0.3s ease', boxShadow: '-2px 0 12px rgba(0,0,0,0.15)',
          fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.06em',
        }}
      >
        <span style={{ fontSize: 16 }}>{open ? '→' : '←'}</span>
        <span style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Cashflow
        </span>
        {chosenCount > 0 && (
          <span style={{ background: '#A8834A', color: '#fff', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
            {chosenCount}
          </span>
        )}
      </button>

      {/* Slide-in panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, height: '100vh', width: 360,
        background: 'var(--cream)', borderLeft: '1px solid var(--cream3)',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.12)', zIndex: 999,
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s ease',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--cream3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--cream)', zIndex: 1 }}>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 600, color: 'var(--charcoal)' }}>Cashflow Impact</div>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{personLabel} · chosen recommendations</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--ink3)', padding: 4 }}>✕</button>
        </div>

        {chosenCount === 0 ? (
          <div style={{ padding: 24, fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', fontStyle: 'italic', textAlign: 'center', marginTop: 40 }}>
            No chosen recommendations yet.<br />Mark cards as chosen to see cashflow impact.
          </div>
        ) : (
          <div style={{ padding: '16px 20px', flex: 1 }}>

            {/* New Additions */}
            {additions.length > 0 && (
              <>
                <div style={sectionLabelStyle}>New additions</div>
                {additions.map((r, i) => (
                  <div key={i} style={rowStyle}>
                    <div>
                      <div style={labelStyle}>{r.label}</div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>{r.section}</div>
                    </div>
                    <div style={valStyle(r.cashDelta)}>+{fmt(r.cashDelta)} / yr</div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginBottom: 4 }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Total additions</div>
                  <div style={valStyle(totalAdditions)}>+{fmt(totalAdditions)} / yr</div>
                </div>
              </>
            )}

            {/* Top-ups */}
            {topups.length > 0 && (
              <>
                <div style={{ ...sectionLabelStyle, marginTop: additions.length > 0 ? 20 : 14 }}>Top-ups (net change)</div>
                {topups.map((r, i) => (
                  <div key={i} style={rowStyle}>
                    <div>
                      <div style={labelStyle}>{r.label}</div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>{r.section}</div>
                    </div>
                    <div style={valStyle(r.cashDelta)}>
                      {r.cashDelta > 0 ? '+' : ''}{fmt(r.cashDelta)} / yr
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginBottom: 4 }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Net top-up change</div>
                  <div style={valStyle(totalTopups)}>
                    {totalTopups > 0 ? '+' : ''}{fmt(totalTopups)} / yr
                  </div>
                </div>
              </>
            )}

            {/* Replacements */}
            {replacements.length > 0 && (
              <>
                <div style={{ ...sectionLabelStyle, marginTop: (additions.length > 0 || topups.length > 0) ? 20 : 14 }}>Replacements (net change)</div>
                {replacements.map((r, i) => (
                  <div key={i} style={rowStyle}>
                    <div>
                      <div style={labelStyle}>{r.label}</div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>{r.section}</div>
                    </div>
                    <div style={valStyle(r.cashDelta)}>
                      {r.cashDelta > 0 ? '+' : ''}{fmt(r.cashDelta)} / yr
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginBottom: 4 }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Net replacement change</div>
                  <div style={valStyle(totalReplacements)}>
                    {totalReplacements > 0 ? '+' : ''}{fmt(totalReplacements)} / yr
                  </div>
                </div>
              </>
            )}

            {/* Divider */}
            <div style={{ borderTop: '2px solid var(--charcoal)', margin: '20px 0 12px' }} />

            {/* Combined net */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 700, color: 'var(--charcoal)' }}>Net annual cash impact</div>
              <div style={{ ...valStyle(netAnnualCash), fontSize: 16 }}>
                {netAnnualCash > 0 ? '+' : ''}{fmt(netAnnualCash)} / yr
              </div>
            </div>

            {/* Surplus section */}
            {annualSurplus > 0 && (
              <div style={{ background: 'var(--cream2)', border: '1px solid var(--cream3)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ ...sectionLabelStyle, marginTop: 0 }}>Annual surplus</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={labelStyle}>Current surplus</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#1E4D35', fontWeight: 600 }}>{fmt(annualSurplus)} / yr</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={labelStyle}>All chosen premiums</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#9B1C1C', fontWeight: 600 }}>−{fmt(Math.abs(netAnnualCash))} / yr</span>
                </div>
                <div style={{ borderTop: '1px solid var(--cream3)', paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 700, color: 'var(--charcoal)' }}>Surplus remaining</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, fontWeight: 700, color: surplusAfter >= 0 ? '#1E4D35' : '#9B1C1C' }}>
                    {fmt(surplusAfter)} / yr
                  </span>
                </div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 6 }}>
                  ≈ {fmt(surplusAfter / 12)} / mo
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

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
  const [ltcCompanies, setLtcCompanies] = useState<{ id: number; name: string }[]>([])
  const [lifeCompanies, setLifeCompanies] = useState<{ id: number; name: string }[]>([])
  const [generalCompanies, setGeneralCompanies] = useState<{ id: number; name: string }[]>([])
  const [accumulationCompanies, setAccumulationCompanies] = useState<{ id: number; name: string }[]>([])
  const [usdRate, setUsdRate] = useState<number>(1.35)  // SGD per USD fallback
  const [clientLifeExpectancy, setClientLifeExpectancy] = useState<number>(85)
  const [clientGender, setClientGender] = useState<string>('')
  const [clientAgeState, setClientAgeState] = useState<number>(35)
  const [medisaveBands, setMedisaveBands] = useState<MedisaveBand[]>([])
  const [products, setProducts]   = useState<InsProduct[]>([])
  const [coverageMap, setCoverageMap] = useState<Record<ProtCategory, string[]>>(COVERAGE_BY_CATEGORY)

  // Person tabs
  const [activePerson, setActivePerson] = useState<string>('client')
  const [showSidebar, setShowSidebar]   = useState(false)
  const [personTabs, setPersonTabs] = useState<{ key: string; label: string; age: number }[]>([
    { key: 'client', label: 'Client', age: 35 }
  ])

  // Existing policies from protection_portfolio (includes person + category for filtering)
  const [existingPolicies, setExistingPolicies] = useState<{
    id: string; policyName: string; companyName: string; annualPremium: number
    premiumMedisave: number; currentCashValue: number; lifeAssured: string; categoryCode: string
    monthlyBenefit: number; benefitTerm: string
    deathBenefit: number; tpdBenefit: number; advCiBenefit: number; earlyCiBenefit: number
    inceptionDate: string; premiumMaturity: string
  }[]>([])

  // Cash flow from Financial Profile
  const [monthlyIncome, setMonthlyIncome]     = useState(0)
  const [monthlyExpenses, setMonthlyExpenses] = useState(0)
  const [annualSurplus, setAnnualSurplus]     = useState(0)

  // Goals for accumulation waterfall
  const [goals, setGoals]                         = useState<GoalItem[]>([])
  const [existingPortfolioValue, setExistingPortfolioValue] = useState(0)
  const [showCombinedImpact, setShowCombinedImpact] = useState(false)

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
        { data: medisaveBandsRaw },
        { data: clientRow },
      ] = await Promise.all([
        supabase.from('fact_finding').select('section,data').eq('client_id', id)
          .in('section', ['financials', 'protection_portfolio', 'capital_mandate', 'retirement', 'education', 'strategic_recommendations_v2']),
        supabase.from('ins_categories').select('*').order('sort_order'),
        supabase.from('ins_policy_types').select('*').order('sort_order'),
        supabase.from('ins_companies').select('*').eq('active', true).order('sort_order'),
        supabase.from('ins_products').select('*').eq('active', true).order('sort_order'),
        supabase.from('family_members').select('*').eq('client_id', id),
        supabase.from('medisave_withdrawal_limits').select('*').order('sort_order', { ascending: true }),
        supabase.from('clients').select('id,name,dob,gender').eq('id', id).maybeSingle(),
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
      // LTC-only insurers: filter by ins_categories code='ltc'
      const ltcCat = (cats || []).find((c: any) => c.code === 'ltc')
      if (ltcCat) {
        setLtcCompanies(companiesList.filter((c: any) => c.category_id === ltcCat.id))
      } else {
        setLtcCompanies(companiesList)
      }
      // Life insurers: filter by ins_categories code='life'
      const lifeCat = (cats || []).find((c: any) => c.code === 'life')
      if (lifeCat) {
        setLifeCompanies(companiesList.filter((c: any) => c.category_id === lifeCat.id))
      } else {
        setLifeCompanies(companiesList)
      }
      // General insurers: filter by ins_categories code='general'
      const generalCat = (cats || []).find((c: any) => c.code === 'general')
      if (generalCat) {
        setGeneralCompanies(companiesList.filter((c: any) => c.category_id === generalCat.id))
      } else {
        setGeneralCompanies(companiesList)
      }
      // Accumulation / Endowment companies: filter by ins_categories code='endowment'
      const endowmentCat = (cats || []).find((c: any) => c.code === 'endowment')
      if (endowmentCat) {
        setAccumulationCompanies(companiesList.filter((c: any) => c.category_id === endowmentCat.id))
      } else {
        setAccumulationCompanies(companiesList)
      }
      // Fetch live USD→SGD rate
      try {
        const fxRes = await fetch('https://api.frankfurter.app/latest?from=USD&to=SGD')
        const fxData = await fxRes.json()
        if (fxData?.rates?.SGD) setUsdRate(fxData.rates.SGD)
      } catch { /* keep fallback */ }


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

      // Medisave withdrawal limits
      if (medisaveBandsRaw && medisaveBandsRaw.length > 0) {
        setMedisaveBands(medisaveBandsRaw.map((b: any) => ({ age_from: b.age_from, age_to: b.age_to, annual_limit: b.annual_limit })))
      }

      // Person tabs from family_members
      const currentYear = new Date().getFullYear()
      const fin2 = by['financials'] ?? {}
      // Client name: prefer clients table, fallback to financials
      const clientFirstName = clientRow?.name
        || fin2?.person1?.firstName || fin2?.client?.firstName || 'Client'
      // Client age: prefer clients.dob (year-only subtraction), fallback to financials
      const clientDob = clientRow?.dob || fin2?.person1?.dob || fin2?.client?.dob
      const clientAge2 = clientDob
        ? currentYear - Number(String(clientDob).slice(0, 4))
        : 35
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
      setClientName(
        clientRow?.name
          || (fin?.person1?.firstName ? `${fin.person1.firstName} ${fin.person1.lastName || ''}`.trim() : '')
          || (fin?.client?.firstName  ? `${fin.client.firstName} ${fin.client.lastName || ''}`.trim()   : '')
          || 'Client'
      )

      // Cash flow — mirror financials page logic exactly
      {
        const isCpl = fin?.mode === 'couple'
        const p1f = fin?.person1 || {}
        const p2f = fin?.person2 || {}
        const expMode = fin?.expense_mode || 'simple'

        if (fin?.annual_surplus != null) {
          // Prefer saved value
          const grossMonthly = (p1f.gross_monthly||0) + (isCpl ? (p2f.gross_monthly||0) : 0)
          setAnnualSurplus(fin.annual_surplus)
          setMonthlyIncome(grossMonthly)
          setMonthlyExpenses(Math.max(0, grossMonthly*12 - fin.annual_surplus) / 12)
        } else {
          // Detailed expense keys (mirrors DETAILED_KEYS_BY_CAT in financials page, excluding cpf_oa)
          const DKEYS = {
            financial: { k: ['d_vehicle_repay','d_personal_loan_repay','d_rental_expense','d_income_tax','d_insurance','d_regular_savings'], k2: ['d2_vehicle_repay','d2_personal_loan_repay','d2_rental_expense','d2_income_tax','d2_insurance','d2_regular_savings'], ck: 'd_custom_financial' },
            mortgage:  { k: ['d_mortgage_cash'], k2: ['d2_mortgage_cash'], ck: 'd_custom_financial' },
            household: { k: ['d_conservancy','d_utilities','d_family_food','d_maid','d_other_household'], k2: ['d2_conservancy','d2_utilities','d2_family_food','d2_maid','d2_other_household'], ck: 'd_custom_household' },
            personal:  { k: ['d_personal_food','d_transport','d_car_petrol','d_car_insurance'], k2: ['d2_personal_food','d2_transport','d2_car_petrol','d2_car_insurance'], ck: 'd_custom_personal' },
            children:  { k: ['d_childcare','d_school_fees','d_school_transport','d_allowance_children','d_other_children'], k2: ['d2_childcare','d2_school_fees','d2_school_transport','d2_allowance_children','d2_other_children'], ck: 'd_custom_children' },
            lifestyle: { k: ['d_holidays','d_hobbies','d_allowance_parents','d_others_lifestyle'], k2: ['d2_holidays','d2_hobbies','d2_allowance_parents','d2_others_lifestyle'], ck: 'd_custom_lifestyle' },
          }
          const sk = (keys: string[]) => keys.reduce((s,k)=>s+Number((fin as any)?.[k]||0),0)
          const sc = (ck: string) => ((fin as any)?.[ck]||[]).reduce((s:number,i:any)=>s+(i.amount||0),0)
          const sc2 = (ck: string) => ((fin as any)?.[ck]||[]).reduce((s:number,i:any)=>s+(i.amount2||0),0)
          let annExpNoCpf = 0
          if (expMode === 'detailed') {
            Object.values(DKEYS).forEach(cat => {
              annExpNoCpf += sk(cat.k) + sc(cat.ck)
              if (isCpl) annExpNoCpf += sk(cat.k2) + sc2(cat.ck)
            })
          } else {
            const SK = ['s_financial','s_mortgage','s_household','s_personal','s_children','s_lifestyle']
            const SK2 = ['s2_financial','s2_mortgage','s2_household','s2_personal','s2_children','s2_lifestyle']
            annExpNoCpf = sk(SK) + (isCpl ? sk(SK2) : 0)
          }
          // Income: take-home after CPF (approx employee CPF rate by age)
          const cpfEmpRate = (age: number) => age < 55 ? 0.20 : age < 60 ? 0.13 : age < 65 ? 0.075 : 0.05
          const ann1 = ((p1f.gross_monthly||0)*12 + (p1f.gross_bonus||0)) * (1-cpfEmpRate(clientAge2||35))
            + (p1f.other_incomes||[]).reduce((s:number,i:any)=>s+(i.amount||0),0)*12
          const spouseAge = tabs.find((t: any)=>t.key==='spouse')?.age || 35
          const ann2 = isCpl ? (((p2f.gross_monthly||0)*12+(p2f.gross_bonus||0))*(1-cpfEmpRate(spouseAge))
            + (p2f.other_incomes||[]).reduce((s:number,i:any)=>s+(i.amount||0),0)*12) : 0
          setAnnualSurplus(ann1+ann2-annExpNoCpf)
          setMonthlyIncome((ann1+ann2)/12)
          setMonthlyExpenses(annExpNoCpf/12)
        }
      }

      // Existing policies
      const pPort = by['protection_portfolio'] ?? {}
      const policies: any[] = pPort?.risk_management?.policies ?? []
      const ACTIVE = ['In-Force', 'Premium Holiday', 'Paid-up']
      setExistingPolicies(
        policies.filter((p: any) => ACTIVE.includes(p.status)).map((p: any) => {
          const freq = p.frequency || p.premiumMode || 'Annual'
          const mult = freq === 'Monthly' ? 12 : freq === 'Quarterly' ? 4 : freq === 'Semi-Annual' ? 2 : 1
          let msAnnual   = (p.premiumMedisave || 0) * mult
          let cashAnnual = (p.premiumCash || 0) * mult
          // LTC: if advisor entered total in cash field with no Medisave split, auto-apply $600 cap
          if (p.categoryCode === 'ltc' && msAnnual === 0 && cashAnnual > 0) {
            msAnnual   = Math.min(cashAnnual, 600)
            cashAnnual = Math.max(cashAnnual - 600, 0)
          }
          const annualPrem = msAnnual + cashAnnual
          const mult2 = p.multiplier > 1 ? p.multiplier : 1
          return { id: p.id, policyName: p.productName || p.briefDescription || '', companyName: p.companyName || '', annualPremium: annualPrem, premiumMedisave: msAnnual, currentCashValue: p.currentCashValue || 0, lifeAssured: p.lifeAssured || '', categoryCode: p.categoryCode || '', monthlyBenefit: p.monthlyBenefit || 0, benefitTerm: p.benefitTerm || p.payoutTerm || '', deathBenefit: Math.round((p.baseDeath || 0) * mult2), tpdBenefit: Math.round((p.baseTPD || 0) * mult2), advCiBenefit: Math.round((p.baseAdvCI || 0) * mult2), earlyCiBenefit: Math.round((p.baseEarlyCI || 0) * mult2), inceptionDate: p.inceptionDate || '', premiumMaturity: p.premiumMaturity || '' }
        })
      )

      // Goals
      const cm  = by['capital_mandate'] ?? {}
      const ret = by['retirement'] ?? {}
      const edu = by['education'] ?? {}
      // Life expectancy: from retirement section, else gender-based default
      const retLifeExp = ret?.ret?.client?.lifeExpectancy || ret?.client?.lifeExpectancy || 0
      const genderStr  = clientRow?.gender || ''
      setClientGender(genderStr)
      setClientLifeExpectancy(retLifeExp || (genderStr === 'Female' ? 88 : 86))
      const clientAge = fin?.client?.dob
        ? new Date().getFullYear() - Number(String(fin.client.dob).slice(0, 4))
        : 35
      setClientAgeState(clientAge2 || clientAge)
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

      // "Covered" = the same retirement corpus used for the goal itself,
      // minus the shortfall Capital Mandate already computed — mirrors
      // capitalFundSnapshot.ts's retirementCorpus/shortfall pattern. (Was
      // previously reading cm?.settings?.retirementCorpus, a field Capital
      // Mandate never saves, which silently always came back S$0.)
      const portValue = cm?.retirementShortfall != null ? Math.max(0, retCorpus - (cm?.retirementShortfall || 0)) : 0
      setExistingPortfolioValue(portValue)

      // Load saved
      const saved = by['strategic_recommendations_v2']
      if (saved) {
        setData(normalizeRecPageData({
          medicalByPerson:  saved.medicalByPerson  || (saved.medical  ? { client: saved.medical  } : {}),
          ltcByPerson:      saved.ltcByPerson      || (saved.ltc     ? { client: saved.ltc     } : {}),
          expenseByPerson:  saved.expenseByPerson  || (saved.expense ? { client: saved.expense } : {}),
          generalByPerson:  saved.generalByPerson  || (saved.general ? { client: saved.general } : {}),
          accumulationByPerson: saved.accumulationByPerson || (saved.accumulation ? { client: saved.accumulation } : {}),
        }))
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
      benefits: '', limitations: '', rationale: '', replacedPolicies: [], isChosen: false,
    }
    handleChange({ ...data, medicalByPerson: { ...data.medicalByPerson, [person]: [...recs, rec] } })
  }
  function updateMedical(person: string, id: string, r: MedicalRec) {
    setData(prev => {
      const next = { ...prev, medicalByPerson: { ...prev.medicalByPerson, [person]: (prev.medicalByPerson[person] || []).map(x => x.id === id ? r : x) } }
      schedSave(next)
      return next
    })
  }
  function deleteMedical(person: string, id: string) {
    const next = getMedical(person).filter(x => x.id !== id).map((r, i) => ({ ...r, rank: RANK_LABELS[i] }))
    handleChange({ ...data, medicalByPerson: { ...data.medicalByPerson, [person]: next } })
  }
  function chooseMedical(person: string, id: string) {
    handleChange({ ...data, medicalByPerson: { ...data.medicalByPerson, [person]: getMedical(person).map(r => r.id === id ? { ...r, isChosen: !r.isChosen } : r) } })
  }

  // ── Per-category prot helpers (ltc / expense / general) — per person ───────
  type ProtCatKey = 'ltcByPerson' | 'expenseByPerson' | 'generalByPerson'
  function catKey(cat: ProtCategory): ProtCatKey { return `${cat}ByPerson` as ProtCatKey }
  function getProtRecs(cat: ProtCategory, person: string): ProtRec[] { return data[catKey(cat)][person] || [] }

  function addProtPerson(cat: ProtCategory, person: string) {
    if (cat === 'medical') return
    const recs = getProtRecs(cat, person)
    if (recs.length >= 3) return
    const rec: ProtRec = {
      id: newId(), rank: RANK_LABELS[recs.length], mode: 'new',
      productName: '', insurer: '', coverageType: '', sumAssured: 0, monthlyBenefit: 0, benefitPaymentPeriod: '', benefitTerm: '', premiumMedisave: 0, premiumCash: 0, annualPremium: 0,
      premiumTerm: '', policyTerm: '', benefits: '', limitations: '', rationale: '', replacedPolicies: [], isChosen: false,
      baseDeathBenefit: 0, baseTpdBenefit: 0, baseAdvCiBenefit: 0, baseEarlyCiBenefit: 0,
      coverageMultiplier: 1, multiplierEnd: '', deathBenefit: 0, tpdBenefit: 0, advCiBenefit: 0, earlyCiBenefit: 0,
      interestRate: '', premiumWaiver: 'Nil', isUsdPolicy: false,
      accidentalDeathBenefit: 0, accidentalDisabilityBenefit: 0, medicalExpenseBenefit: 0,
    }
    const byPerson = { ...data[catKey(cat)], [person]: [...recs, rec] }
    handleChange({ ...data, [catKey(cat)]: byPerson })
  }
  function addProt(cat: ProtCategory) { addProtPerson(cat, activePerson) }
  function updateProt(cat: ProtCategory, id: string, r: ProtRec) {
    setData(prev => {
      const byPerson = { ...prev[catKey(cat)], [activePerson]: (prev[catKey(cat)][activePerson] || []).map(x => x.id === id ? r : x) }
      const next = { ...prev, [catKey(cat)]: byPerson }
      schedSave(next)
      return next
    })
  }
  function deleteProt(cat: ProtCategory, id: string) {
    const recs = getProtRecs(cat, activePerson)
    const next = recs.filter(x => x.id !== id).map((r, i) => ({ ...r, rank: RANK_LABELS[i] }))
    handleChange({ ...data, [catKey(cat)]: { ...data[catKey(cat)], [activePerson]: next } })
  }
  function chooseProt(cat: ProtCategory, id: string) {
    const recs = getProtRecs(cat, activePerson)
    handleChange({ ...data, [catKey(cat)]: { ...data[catKey(cat)], [activePerson]: recs.map(r => r.id === id ? { ...r, isChosen: !r.isChosen } : r) } })
  }

  // ── Accumulation helpers ────────────────────────────────────────────────────
  function getAccVisible(person: string): AccRec[] {
    const personal = data.accumulationByPerson[person] || []
    const joint = data.accumulationByPerson['joint'] || []
    return person === 'joint' ? joint : [...personal, ...joint]
  }
  function addAccForPerson(person: string) {
    const visible = getAccVisible(person)
    if (visible.length >= 3) return
    const ownRecs = data.accumulationByPerson[person] || []
    const rec: AccRec = {
      id: newId(), rank: RANK_LABELS[visible.length], mode: 'new',
      productType: '', company: '', planType: '',
      hasLumpSum: false, lumpSumAmount: 0, hasRegular: true,
      regularFreq: 'Monthly', regularAmount: 0, regularYears: 0,
      projMethod: 'illustration', illusTerm: 0, illusGuaranteed: 0, illusNonGuaranteed: 0,
      rateYears: 0, rateReturn: 0, replacedPolicies: [], topupOf: null, benefits: '', limitations: '', rationale: '',
      allocatedGoalIds: [], accountType: 'individual', jointSplitClientPct: 50, isChosen: false,
    }
    handleChange({ ...data, accumulationByPerson: { ...data.accumulationByPerson, [person]: [...ownRecs, rec] } })
  }
  function updateAcc(id: string, r: AccRec) {
    setData(prev => {
      const newByPerson = { ...prev.accumulationByPerson }
      for (const person of Object.keys(newByPerson)) {
        if ((newByPerson[person] || []).some((x: AccRec) => x.id === id)) {
          const targetBucket = r.accountType === 'joint' ? 'joint' : (person === 'joint' ? activePerson : person)
          if (targetBucket !== person) {
            newByPerson[person] = (newByPerson[person] || []).filter((x: AccRec) => x.id !== id)
            newByPerson[targetBucket] = [...(newByPerson[targetBucket] || []), r]
          } else {
            newByPerson[person] = (newByPerson[person] || []).map((x: AccRec) => x.id === id ? r : x)
          }
          break
        }
      }
      const next = { ...prev, accumulationByPerson: newByPerson }
      schedSave(next)
      return next
    })
  }
  function deleteAcc(id: string) {
    const newByPerson = { ...data.accumulationByPerson }
    for (const person of Object.keys(newByPerson)) {
      if ((newByPerson[person] || []).some((x: AccRec) => x.id === id)) {
        newByPerson[person] = (newByPerson[person] || []).filter((x: AccRec) => x.id !== id).map((r: AccRec, i: number) => ({ ...r, rank: RANK_LABELS[i] }))
        break
      }
    }
    handleChange({ ...data, accumulationByPerson: newByPerson })
  }
  function chooseAcc(id: string) {
    const newByPerson = { ...data.accumulationByPerson }
    for (const person of Object.keys(newByPerson)) {
      if ((newByPerson[person] || []).some((x: AccRec) => x.id === id)) {
        newByPerson[person] = (newByPerson[person] || []).map((r: AccRec) => r.id === id ? { ...r, isChosen: !r.isChosen } : r)
        break
      }
    }
    handleChange({ ...data, accumulationByPerson: newByPerson })
  }

  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showPicker) return
    function handleOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [showPicker])

  // Sections are derived purely from card count — appear on first card, disappear on last deletion
  const medicalHasCards = Object.values(data.medicalByPerson).some(recs => recs.length > 0)
  const activeSections = [
    ...(medicalHasCards ? ['medical' as ProtCategory | 'accumulation'] : []),
    ...PROT_CATEGORIES.filter(cat => cat.key !== 'medical' && Object.values(data[`${cat.key}ByPerson` as 'ltcByPerson'|'expenseByPerson'|'generalByPerson']).some(recs => recs.length > 0)).map(cat => cat.key as ProtCategory | 'accumulation'),
    ...(Object.values(data.accumulationByPerson).some(r => r.length > 0) ? ['accumulation' as const] : []),
  ]

  const ALL_OPTIONS: { key: ProtCategory | 'accumulation'; label: string; sub: string; color: string }[] = [
    ...PROT_CATEGORIES.map(c => ({ key: c.key as ProtCategory | 'accumulation', label: c.label, sub: 'Wealth Protection', color: c.color })),
    { key: 'accumulation', label: 'Wealth Accumulation', sub: 'Investments & savings', color: '#2D5A4E' },
  ]

  // Picker adds first card immediately so section appears
  function activateSection(key: ProtCategory | 'accumulation') {
    setShowPicker(false)
    if (key === 'accumulation') addAccForPerson('client')
    else if (key === 'medical') addMedical('client')
    else addProtPerson(key, 'client')
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

        {/* Top-level person tabs */}
        {personTabs.length > 1 && (
          <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--cream3)' }}>
            {personTabs.map(tab => {
              const total =
                (data.medicalByPerson[tab.key] || []).length +
                (data.ltcByPerson[tab.key] || []).length +
                (data.expenseByPerson[tab.key] || []).length +
                (data.generalByPerson[tab.key] || []).length +
                (data.accumulationByPerson[tab.key] || []).length
              return (
                <button key={tab.key} onClick={() => setActivePerson(tab.key)} style={{
                  fontSize: 13, padding: '10px 22px', border: 'none', cursor: 'pointer', fontFamily: 'Inter',
                  borderBottom: activePerson === tab.key ? '2px solid var(--charcoal)' : '2px solid transparent',
                  marginBottom: -2, background: 'transparent',
                  color: activePerson === tab.key ? 'var(--ink)' : 'var(--ink3)',
                  fontWeight: activePerson === tab.key ? 600 : 400,
                  display: 'flex', alignItems: 'center', gap: 7,
                }}>
                  {tab.label}
                  {total > 0 && (
                    <span style={{ fontSize: 10, background: 'var(--charcoal)', color: 'var(--cream)', borderRadius: 10, padding: '1px 6px', fontWeight: 600 }}>{total}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Empty state */}
        {activeSections.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 24px', border: '1px dashed var(--cream3)', borderRadius: 12, marginBottom: 24 }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'var(--ink2)', marginBottom: 8 }}>No recommendations yet</div>
            <div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', marginBottom: 24 }}>
              Add a recommendation section to get started
            </div>
            <div ref={pickerRef} style={{ position: 'relative', display: 'inline-block' }}>
              <button onClick={() => setShowPicker(v => !v)} style={{
                background: 'var(--charcoal)', color: 'var(--cream)', border: 'none',
                borderRadius: 8, padding: '10px 24px', fontFamily: 'Inter', fontSize: 13,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add recommendation
              </button>
              {showPicker && (
                <>
  
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
                    personName={currentPerson?.label || ''}
                    medisaveBands={medisaveBands}
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

        {/* Active non-medical protection sections — per person tabs */}
        {PROT_CATEGORIES.filter(cat => cat.key !== 'medical' && activeSections.includes(cat.key)).map(cat => {
          const catK = `${cat.key}ByPerson` as 'ltcByPerson'|'expenseByPerson'|'generalByPerson'
          const personRecs = data[catK][activePerson] || []
          const canAddProt = personRecs.length < 3
          return (
            <div key={cat.key} style={{ marginBottom: 28 }}>
              {/* Section header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${cat.color}33` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 2, height: 14, background: cat.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', letterSpacing: '0.04em' }}>{cat.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--ink3)', borderLeft: '1px solid var(--cream3)', paddingLeft: 10 }}>{cat.hint}</span>
                </div>
                <button onClick={() => addProtPerson(cat.key, activePerson)} disabled={!canAddProt} style={{
                  background: canAddProt ? 'var(--charcoal)' : 'var(--cream3)', color: canAddProt ? 'var(--cream)' : 'var(--ink3)',
                  border: 'none', borderRadius: 6, padding: '5px 12px', fontFamily: 'Inter', fontSize: 11,
                  cursor: canAddProt ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>{canAddProt ? 'Add option' : 'Max 3'}
                </button>
              </div>

              {/* Cards for active person */}
              {personRecs.length === 0 ? (
                <div style={{ padding: '20px 0 8px', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>
                  No {cat.label.toLowerCase()} recommendations for {personTabs.find(t => t.key === activePerson)?.label || activePerson} yet
                </div>
              ) : (
                personRecs.map(rec => (
                  cat.key === 'ltc' ? (
                    <LtcCard
                      key={rec.id} rec={rec}
                      onChange={r => updateProt(cat.key, rec.id, r)}
                      onDelete={() => deleteProt(cat.key, rec.id)}
                      onChoose={() => chooseProt(cat.key, rec.id)}
                      existingPolicies={existingPolicies}
                      ltcCompanies={ltcCompanies} products={products}
                      coverageTypes={coverageMap[cat.key]}
                      personName={personTabs.find(t => t.key === activePerson)?.label || ''}
                      monthlyIncome={monthlyIncome} monthlyExpenses={monthlyExpenses}
                      annualSurplusOverride={annualSurplus}
                    />
                  ) : cat.key === 'expense' ? (
                    <ExpenseCard
                      key={rec.id} rec={rec}
                      onChange={r => updateProt(cat.key, rec.id, r)}
                      onDelete={() => deleteProt(cat.key, rec.id)}
                      onChoose={() => chooseProt(cat.key, rec.id)}
                      existingPolicies={existingPolicies}
                      lifeCompanies={lifeCompanies}
                      personName={personTabs.find(t => t.key === activePerson)?.label || ''}
                      monthlyIncome={monthlyIncome} monthlyExpenses={monthlyExpenses}
                      annualSurplusOverride={annualSurplus}
                      usdRate={usdRate}
                      lifeExpectancy={clientLifeExpectancy}
                      clientAge={clientAgeState}
                    />
                  ) : cat.key === 'general' ? (
                    <GeneralCard
                      key={rec.id} rec={rec}
                      onChange={r => updateProt(cat.key, rec.id, r)}
                      onDelete={() => deleteProt(cat.key, rec.id)}
                      onChoose={() => chooseProt(cat.key, rec.id)}
                      generalCompanies={generalCompanies}
                      monthlyIncome={monthlyIncome} monthlyExpenses={monthlyExpenses}
                      annualSurplusOverride={annualSurplus}
                    />
                  ) : (
                  <ProtCard
                    key={rec.id} rec={rec} category={cat.key}
                    onChange={r => updateProt(cat.key, rec.id, r)}
                    onDelete={() => deleteProt(cat.key, rec.id)}
                    onChoose={() => chooseProt(cat.key, rec.id)}
                    existingPolicies={existingPolicies}
                    insurers={insurers} coverageTypes={coverageMap[cat.key]}
                    monthlyIncome={monthlyIncome} monthlyExpenses={monthlyExpenses}
                    annualSurplusOverride={annualSurplus}
                  />
                  )
                ))
              )}
            </div>
          )
        })}

        {/* Active accumulation section */}
        {activeSections.includes('accumulation') && (() => {
          const visibleRecs = getAccVisible(activePerson)
          const canAddAcc = visibleRecs.length < 3
          const currentLabel = personTabs.find(t => t.key === activePerson)?.label || activePerson
          const anyChosenAcc = Object.values(data.accumulationByPerson).some(list => (list || []).some(r => r.isChosen))
          return (
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #2D5A4E33' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 2, height: 14, background: '#2D5A4E', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', letterSpacing: '0.04em' }}>Wealth Accumulation</span>
                  <span style={{ fontSize: 10, color: 'var(--ink3)', borderLeft: '1px solid var(--cream3)', paddingLeft: 10 }}>Investments & savings</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {anyChosenAcc && (
                    <button onClick={() => setShowCombinedImpact(true)} style={{
                      background: 'transparent', color: '#2D5A4E', border: '1px solid #2D5A4E',
                      borderRadius: 6, padding: '5px 12px', fontFamily: 'Inter', fontSize: 11,
                      cursor: 'pointer', fontWeight: 600,
                    }}>View combined impact</button>
                  )}
                  <button onClick={() => addAccForPerson(activePerson)} disabled={!canAddAcc} style={{
                    background: canAddAcc ? 'var(--charcoal)' : 'var(--cream3)', color: canAddAcc ? 'var(--cream)' : 'var(--ink3)',
                    border: 'none', borderRadius: 6, padding: '5px 12px', fontFamily: 'Inter', fontSize: 11,
                    cursor: canAddAcc ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>{canAddAcc ? 'Add option' : 'Max 3'}
                  </button>
                </div>
              </div>
              {visibleRecs.length === 0 ? (
                <div style={{ padding: '20px 0 8px', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>
                  No accumulation recommendations for {currentLabel} yet
                </div>
              ) : (
                visibleRecs.map(rec => (
                  <AccCard
                    key={rec.id} rec={rec}
                    onChange={r => updateAcc(rec.id, r)}
                    onDelete={() => deleteAcc(rec.id)}
                    onChoose={() => chooseAcc(rec.id)}
                    goals={goals} existingPortfolioValue={existingPortfolioValue}
                    existingPolicies={existingPolicies}
                    monthlyIncome={monthlyIncome} monthlyExpenses={monthlyExpenses}
                    accumulationCompanies={accumulationCompanies}
                    clientLabel={personTabs.find(t => t.key === 'client')?.label || 'Client'}
                    spouseLabel={personTabs.find(t => t.key === 'spouse')?.label || 'Spouse'}
                  />
                ))
              )}
              {(data.accumulationByPerson['joint'] || []).length > 0 && activePerson !== 'joint' && (
                <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginTop: 8, fontStyle: 'italic' }}>
                  ↑ Joint accounts are shared across all family members
                </div>
              )}
              {showCombinedImpact && (
                <CombinedGoalImpactModal
                  data={data} goals={goals} existingPortfolioValue={existingPortfolioValue}
                  personTabs={personTabs} onClose={() => setShowCombinedImpact(false)}
                />
              )}
            </div>
          )
        })()}

        {/* Add recommendation button — shown when at least 1 section is active and more are available */}
        {activeSections.length > 0 && availableOptions.length > 0 && (
          <div ref={pickerRef} style={{ marginTop: 8, position: 'relative', display: 'inline-block' }}>
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
      <CashflowSidebar
        open={showSidebar}
        onClose={() => setShowSidebar(s => !s)}
        data={data}
        activePerson={activePerson}
        annualSurplus={annualSurplus}
        personTabs={personTabs}
      />
      </div>
    </div>
  )
}
