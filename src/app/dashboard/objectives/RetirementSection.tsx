'use client'

import { useState, useEffect } from 'react'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type CPFPlanType = 'brs' | 'frs' | 'ers' | 'override'
export type IncomeInputMode = 'direct' | 'expense_based'
export type CoupleIncomeMode = 'combined' | 'separate'

export interface PassiveIncomeItem {
  id: string
  label: string
  type: 'rental' | 'dividend' | 'annuity' | 'other'
  monthlyAmount: number
  startAge: number
  endAge: number   // 0 = lifelong
  owner: 'client' | 'spouse' | 'joint'
}

export interface RetirementPersonData {
  retirementAge: number
  lifeExpectancy: number
  desiredMonthlyIncome: number
  desiredAnnualHolidays: number
  includeCPF: boolean
  cpfRaPlan: CPFPlanType
  cpfRaBalanceOverride: number
  cpfLifeOverride: number
}

export interface RetirementExpenseSelections {
  mode: IncomeInputMode
  coupleIncomeMode: CoupleIncomeMode
  selectedExpenseKeys: Record<string, boolean>
  combinedDesiredMonthly: number
  combinedDesiredHolidays: number
}

export interface RetirementData {
  inflationRate: number
  postReturnRate: number
  preReturnRate: number
  expenseSelections: RetirementExpenseSelections
  client: RetirementPersonData
  spouse: RetirementPersonData
  passiveIncome: PassiveIncomeItem[]
  advisorNotes: string
}

export interface RetirementProps {
  data: RetirementData
  onChange: (updated: RetirementData) => void
  isCouple: boolean
  clientName?: string
  spouseName?: string
  clientAge?: number
  spouseAge?: number
  clientCPF_OA?: number
  clientCPF_SA?: number
  clientCPF_RA?: number
  spouseCPF_OA?: number
  spouseCPF_SA?: number
  spouseCPF_RA?: number
  clientLiquid?: number
  spouseLiquid?: number
  factFinding?: Record<string, unknown>
  expenseMode?: 'simple' | 'detailed'
  annualSurplus?: number
}

// ─── CPF LIFE 2025 LOOKUP TABLE ──────────────────────────────────────────────

const CPF_LIFE_2025 = {
  BRS: { balance: 106500, monthly: 900 },
  FRS: { balance: 213000, monthly: 1600 },
  ERS: { balance: 426000, monthly: 3300 },
  dataYear: 2025,
}

function estimateCPFLifePayout(raBalance: number): number {
  if (raBalance <= 0) return 0
  const { BRS, FRS, ERS } = CPF_LIFE_2025
  if (raBalance <= BRS.balance) {
    return Math.round((raBalance / BRS.balance) * BRS.monthly)
  } else if (raBalance <= FRS.balance) {
    const t = (raBalance - BRS.balance) / (FRS.balance - BRS.balance)
    return Math.round(BRS.monthly + t * (FRS.monthly - BRS.monthly))
  } else if (raBalance <= ERS.balance) {
    const t = (raBalance - FRS.balance) / (ERS.balance - FRS.balance)
    return Math.round(FRS.monthly + t * (ERS.monthly - FRS.monthly))
  } else {
    const t = (raBalance - ERS.balance) / ERS.balance
    return Math.round(ERS.monthly * (1 + t * 0.5))
  }
}

function getCPFPlanPayout(plan: CPFPlanType, raBalance: number, override: number): number {
  if (plan === 'override') return override
  if (plan === 'brs') return CPF_LIFE_2025.BRS.monthly
  if (plan === 'frs') return CPF_LIFE_2025.FRS.monthly
  if (plan === 'ers') return CPF_LIFE_2025.ERS.monthly
  return estimateCPFLifePayout(raBalance)
}

// ─── CALC ENGINE (runs in background, feeds onCalculated) ────────────────────

export interface RetirementCalcResult {
  monthlyNeedAtRetirement: number
  annualHolidaysAtRetirement: number
  totalAnnualNeedAtRetirement: number
  cpfLifeMonthly: number
  cpfLifeAnnual: number
  passiveAnnual: number
  netAnnualGap: number
  corpusNeeded: number
  existingAssetsFV: number
  savingsGap: number
  monthlySavingsRequired: number
  yearsToRetirement: number
  retirementYears: number
}

export interface PhasedRetirementResult {
  clientRetirementAge: number
  yearsToClientRetirement: number
  spouseRetirementAge: number
  yearsToSpouseRetirement: number
  gapYears: number
  monthlyNeedAtClientRetirement: number
  spouseMonthlyIncome: number
  gapMonthlyShortfall: number
  gapMonthlySurplus: number
  gapFundNeeded: number
  fullRetirementCorpusAtSpouseRetirement: number
  fullRetirementCorpusPV: number
  totalCorpusNeeded: number
  corpusNeeded: number
  yearsToRetirement: number
  retirementYears: number
}

function calcPhasedRetirement(
  clientAge: number,
  clientRetirementAge: number,
  clientLifeExpectancy: number,
  spouseAge: number | undefined,
  spouseRetirementAge: number | undefined,
  spouseLifeExpectancy: number | undefined,
  spouseMonthlyIncome: number,
  combinedMonthlyNeed: number,
  inflationRate: number,
  postReturnRate: number,
): PhasedRetirementResult {
  const g = inflationRate / 100
  const r = postReturnRate / 100

  const yearsToClientRetirement = Math.max(0.5, clientRetirementAge - clientAge)

  // ── Single person ─────────────────────────────────────────────────────────
  if (!spouseAge || !spouseRetirementAge || !spouseLifeExpectancy) {
    const monthlyNeedAtRetirement = combinedMonthlyNeed * Math.pow(1 + g, yearsToClientRetirement)
    const retirementYears = clientLifeExpectancy - clientRetirementAge
    const totalAnnualNeed = monthlyNeedAtRetirement * 12

    let corpusNeeded = 0
    if (Math.abs(r - g) < 0.0001) {
      corpusNeeded = totalAnnualNeed * retirementYears / (1 + r)
    } else {
      corpusNeeded = totalAnnualNeed * (1 - Math.pow((1 + g) / (1 + r), retirementYears)) / (r - g)
    }

    return {
      clientRetirementAge,
      yearsToClientRetirement,
      spouseRetirementAge: 0,
      yearsToSpouseRetirement: 0,
      gapYears: 0,
      monthlyNeedAtClientRetirement: monthlyNeedAtRetirement,
      spouseMonthlyIncome: 0,
      gapMonthlyShortfall: 0,
      gapMonthlySurplus: 0,
      gapFundNeeded: 0,
      fullRetirementCorpusAtSpouseRetirement: corpusNeeded,
      fullRetirementCorpusPV: corpusNeeded,
      totalCorpusNeeded: corpusNeeded,
      corpusNeeded,
      yearsToRetirement: yearsToClientRetirement,
      retirementYears,
    }
  }

  // ── Couple ────────────────────────────────────────────────────────────────
  const yearsToSpouseRetirement = Math.max(0.5, spouseRetirementAge - spouseAge)
  const gapYears = Math.max(0, yearsToSpouseRetirement - yearsToClientRetirement)

  const monthlyNeedAtClientRetirement = combinedMonthlyNeed * Math.pow(1 + g, yearsToClientRetirement)
  const annualNeedAtClientRetirement = monthlyNeedAtClientRetirement * 12

  const spouseMonthlyIncomeAtRetirement = spouseMonthlyIncome
  const spouseAnnualIncomeAtRetirement = spouseMonthlyIncomeAtRetirement * 12

  const annualShortfall = Math.max(0, annualNeedAtClientRetirement - spouseAnnualIncomeAtRetirement)
  const annualSurplusIncome = Math.max(0, spouseAnnualIncomeAtRetirement - annualNeedAtClientRetirement)

  // PV of gap shortfalls (discount only — no re-inflation)
  let gapFundNeeded = 0
  if (gapYears > 0 && annualShortfall > 0) {
    if (r === 0) {
      gapFundNeeded = annualShortfall * gapYears
    } else {
      gapFundNeeded = annualShortfall * (1 - Math.pow(1 / (1 + r), gapYears)) / r
    }
  }

  // FV of gap surplus (no re-inflation)
  let gapSurplusFV = 0
  if (gapYears > 0 && annualSurplusIncome > 0) {
    if (r === 0) {
      gapSurplusFV = annualSurplusIncome * gapYears
    } else {
      gapSurplusFV = annualSurplusIncome * (Math.pow(1 + r, gapYears) - 1) / r
    }
  }

  const monthlyNeedAtSpouseRetirement = combinedMonthlyNeed * Math.pow(1 + g, yearsToSpouseRetirement)
  const retirementYears = spouseLifeExpectancy - spouseRetirementAge
  const totalAnnualNeedAtSpouseRetirement = monthlyNeedAtSpouseRetirement * 12

  let fullRetirementCorpusAtSpouseRetirement = 0
  if (Math.abs(r - g) < 0.0001) {
    fullRetirementCorpusAtSpouseRetirement = totalAnnualNeedAtSpouseRetirement * retirementYears / (1 + r)
  } else {
    fullRetirementCorpusAtSpouseRetirement = totalAnnualNeedAtSpouseRetirement *
      (1 - Math.pow((1 + g) / (1 + r), retirementYears)) / (r - g)
  }

  const fullRetirementCorpusPV = fullRetirementCorpusAtSpouseRetirement / Math.pow(1 + r, gapYears)
  const gapSurplusPV = gapSurplusFV / Math.pow(1 + r, gapYears)
  const totalCorpusNeeded = Math.max(0, gapFundNeeded + fullRetirementCorpusPV - gapSurplusPV)

  return {
    clientRetirementAge,
    yearsToClientRetirement,
    spouseRetirementAge,
    yearsToSpouseRetirement,
    gapYears,
    monthlyNeedAtClientRetirement,
    spouseMonthlyIncome: spouseMonthlyIncomeAtRetirement,
    gapMonthlyShortfall: annualShortfall / 12,
    gapMonthlySurplus: annualSurplusIncome / 12,
    gapFundNeeded,
    fullRetirementCorpusAtSpouseRetirement,
    fullRetirementCorpusPV,
    totalCorpusNeeded,
    corpusNeeded: totalCorpusNeeded,
    yearsToRetirement: yearsToClientRetirement,
    retirementYears,
  }
}

// ─── EXPENSE CATALOGUE ───────────────────────────────────────────────────────

interface ExpenseItem {
  key: string
  label: string
  simpleKey?: string
  detailedKey?: string
}

interface ExpenseGroup {
  id: string
  label: string
  color: string
  items: ExpenseItem[]
}

const RETIREMENT_EXPENSE_GROUPS: ExpenseGroup[] = [
  {
    id: 'financial',
    label: 'Financial Obligations',
    color: '#E08080',
    items: [
      { key: 'd_mortgage_cpf',        label: 'Mortgage Loan (CPF OA)',        simpleKey: 's_cpf_oa',   detailedKey: 'd_mortgage_cpf' },
      { key: 'd_mortgage_cash',       label: 'Mortgage Loan (Cash)',          simpleKey: 's_mortgage', detailedKey: 'd_mortgage_cash' },
      { key: 'd_vehicle_repay',       label: 'Motor Vehicle Repayment',       detailedKey: 'd_vehicle_repay' },
      { key: 'd_personal_loan_repay', label: 'Personal Loan Repayment',       detailedKey: 'd_personal_loan_repay' },
      { key: 'd_rental_expense',      label: 'Rental Expenses',               detailedKey: 'd_rental_expense' },
      { key: 'd_income_tax',          label: 'Income Tax',                    simpleKey: 's_financial', detailedKey: 'd_income_tax' },
      { key: 'd_insurance',           label: 'Insurance Payments',            simpleKey: 's_financial', detailedKey: 'd_insurance' },
      { key: 'd_regular_savings',     label: 'Regular Savings / Investments', simpleKey: 's_financial', detailedKey: 'd_regular_savings' },
    ],
  },
  {
    id: 'household',
    label: 'Household & Living',
    color: '#4A7C9E',
    items: [
      { key: 'd_conservancy',     label: 'Conservancy / MCST / Property Tax', simpleKey: 's_household', detailedKey: 'd_conservancy' },
      { key: 'd_utilities',       label: 'Utilities & Bills',                  simpleKey: 's_household', detailedKey: 'd_utilities' },
      { key: 'd_family_food',     label: 'Family Food & Groceries',            simpleKey: 's_household', detailedKey: 'd_family_food' },
      { key: 'd_maid',            label: 'Maid Services (incl. Levy)',         simpleKey: 's_household', detailedKey: 'd_maid' },
      { key: 'd_other_household', label: 'Other Household Expenses',           simpleKey: 's_household', detailedKey: 'd_other_household' },
    ],
  },
  {
    id: 'personal',
    label: 'Personal Expenses',
    color: '#7A6AAA',
    items: [
      { key: 'd_personal_food', label: 'Personal Food & Dining',     simpleKey: 's_personal', detailedKey: 'd_personal_food' },
      { key: 'd_transport',     label: 'Public Transport',           simpleKey: 's_personal', detailedKey: 'd_transport' },
      { key: 'd_car_petrol',    label: 'Car Petrol / Parking / Tax', simpleKey: 's_personal', detailedKey: 'd_car_petrol' },
      { key: 'd_car_insurance', label: 'Car Insurance',              simpleKey: 's_personal', detailedKey: 'd_car_insurance' },
    ],
  },
  {
    id: 'children',
    label: 'Children Expenses',
    color: '#2D5A4E',
    items: [
      { key: 'd_childcare',          label: 'Childcare / DayCare',      simpleKey: 's_children', detailedKey: 'd_childcare' },
      { key: 'd_school_fees',        label: 'School & Tuition Fees',    simpleKey: 's_children', detailedKey: 'd_school_fees' },
      { key: 'd_school_transport',   label: 'School Transport',         simpleKey: 's_children', detailedKey: 'd_school_transport' },
      { key: 'd_allowance_children', label: 'Allowance / Pocket Money', simpleKey: 's_children', detailedKey: 'd_allowance_children' },
      { key: 'd_other_children',     label: 'Other Children Expenses',  simpleKey: 's_children', detailedKey: 'd_other_children' },
    ],
  },
  {
    id: 'lifestyle',
    label: 'Lifestyle & Miscellaneous',
    color: '#9A7C5A',
    items: [
      { key: 'd_holidays',          label: 'Holidays / Travel',         simpleKey: 's_lifestyle', detailedKey: 'd_holidays' },
      { key: 'd_hobbies',           label: 'Hobbies / Recreation',      simpleKey: 's_lifestyle', detailedKey: 'd_hobbies' },
      { key: 'd_allowance_parents', label: 'Allowance to Parents',      simpleKey: 's_lifestyle', detailedKey: 'd_allowance_parents' },
      { key: 'd_others_lifestyle',  label: 'Others (Shopping, Tithes)', simpleKey: 's_lifestyle', detailedKey: 'd_others_lifestyle' },
    ],
  },
]

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (!n || isNaN(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-SG')
}

function newId() { return 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5) }

function readExpenseValue(ff: Record<string, unknown>, item: ExpenseItem, expenseMode: 'simple' | 'detailed', who: 'client' | 'spouse'): number {
  if (expenseMode === 'detailed') {
    const base = item.detailedKey
    if (base) {
      const key = who === 'spouse' ? base.replace('d_', 'd2_') : base
      return (ff[key] as number) || 0
    }
  }
  const simpleMap: Record<string, string> = {
    's_financial': 'd_income_tax',
    's_cpf_oa':    'd_mortgage_cpf',
    's_mortgage':  'd_mortgage_cash',
    's_household': 'd_conservancy',
    's_personal':  'd_personal_food',
    's_children':  'd_childcare',
    's_lifestyle': 'd_holidays',
  }
  const base = item.simpleKey
  if (base) {
    const key = who === 'spouse' ? base.replace('s_', 's2_') : base
    const val = (ff[key] as number) || 0
    const mappedDetailedKey = simpleMap[base]
    if (mappedDetailedKey && item.detailedKey === mappedDetailedKey) return val
    return 0
  }
  return 0
}

function sumSelectedExpenses(ff: Record<string, unknown>, selectedKeys: Record<string, boolean>, expenseMode: 'simple' | 'detailed', who: 'client' | 'spouse'): number {
  let total = 0
  for (const group of RETIREMENT_EXPENSE_GROUPS) {
    if (selectedKeys[group.id] === false) continue
    for (const item of group.items) {
      total += readExpenseValue(ff, item, expenseMode, who)
    }
  }
  return total
}

// ─── DEFAULTS ─────────────────────────────────────────────────────────────────

export const DEFAULT_RETIREMENT_DATA: RetirementData = {
  inflationRate: 3,
  postReturnRate: 4,
  preReturnRate: 5,
  expenseSelections: {
    mode: 'expense_based',
    coupleIncomeMode: 'combined',
    selectedExpenseKeys: {
      financial: true,
      household: true,
      personal: true,
      children: true,
      lifestyle: true,
    },
    combinedDesiredMonthly: 0,
    combinedDesiredHolidays: 0,
  },
  client: {
    retirementAge: 65, lifeExpectancy: 85,
    desiredMonthlyIncome: 0, desiredAnnualHolidays: 0,
    includeCPF: false, cpfRaPlan: 'frs', cpfRaBalanceOverride: 0, cpfLifeOverride: 0,
  },
  spouse: {
    retirementAge: 65, lifeExpectancy: 85,
    desiredMonthlyIncome: 0, desiredAnnualHolidays: 0,
    includeCPF: false, cpfRaPlan: 'frs', cpfRaBalanceOverride: 0, cpfLifeOverride: 0,
  },
  passiveIncome: [],
  advisorNotes: '',
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function SubLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 28 }}>
      <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600, color: color ?? 'var(--ink3)' }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  )
}

function RateSlider({ label, value, onChange, min = 0, max = 15, step = 0.25, color = 'var(--gold)' }: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; color?: string
}) {
  return (
    <div>
      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: color, height: 2, cursor: 'pointer' }} />
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 500, color: 'var(--ink)', background: 'var(--cream)', borderRadius: 6, padding: '4px 10px', minWidth: 52, textAlign: 'center', border: '1px solid var(--line)' }}>
          {value.toFixed(2)}%
        </div>
      </div>
    </div>
  )
}

// ─── SECTION 1: RETIREMENT AGE & LONGEVITY ───────────────────────────────────

function AgePanel({ person, onChange, name, color, currentAge }: {
  person: RetirementPersonData
  onChange: (c: Partial<RetirementPersonData>) => void
  name: string
  color: string
  currentAge: number
}) {
  const yearsToRetirement = Math.max(0, person.retirementAge - currentAge)
  const retirementYears = Math.max(0, person.lifeExpectancy - person.retirementAge)

  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 4, height: 20, background: color, borderRadius: 2 }} />
          <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>{name}</span>
          <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>· Age {currentAge}</span>
        </div>
        {/* Summary pills */}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ background: color + '18', border: `1px solid ${color}40`, borderRadius: 20, padding: '3px 12px' }}>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: color, fontWeight: 600 }}>
              Retire {person.retirementAge}
            </span>
          </div>
          <div style={{ background: 'var(--cream)', border: '1px solid var(--line)', borderRadius: 20, padding: '3px 12px' }}>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--ink3)' }}>
              {retirementYears}y in retirement
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* Retirement Age */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
              Retirement Age
            </span>
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: color }}>
              {person.retirementAge}
              <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginLeft: 6 }}>
                ({yearsToRetirement}y away)
              </span>
            </span>
          </div>
          <input type="range" min={50} max={75} step={1} value={person.retirementAge}
            onChange={e => onChange({ retirementAge: parseInt(e.target.value) })}
            style={{ width: '100%', accentColor: color, cursor: 'pointer' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>50</span>
            <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>75</span>
          </div>
        </div>

        {/* Life Expectancy */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
              Life Expectancy
            </span>
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>
              {person.lifeExpectancy}
            </span>
          </div>
          <input type="range" min={75} max={100} step={1} value={person.lifeExpectancy}
            onChange={e => onChange({ lifeExpectancy: parseInt(e.target.value) })}
            style={{ width: '100%', accentColor: 'var(--ink3)', cursor: 'pointer' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>75</span>
            <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>100</span>
          </div>
        </div>

        {/* Visual timeline bar */}
        <div>
          <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>
            Life Timeline
          </div>
          <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line)' }}>
            <div style={{
              width: `${(yearsToRetirement / (person.lifeExpectancy - currentAge)) * 100}%`,
              background: color,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, color: 'white', whiteSpace: 'nowrap', padding: '0 6px' }}>
                Working · {yearsToRetirement}y
              </span>
            </div>
            <div style={{
              flex: 1,
              background: 'var(--cream)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', whiteSpace: 'nowrap', padding: '0 6px' }}>
                Retirement · {retirementYears}y
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>Now ({currentAge})</span>
            <span style={{ fontFamily: 'Inter', fontSize: 10, color, fontWeight: 600 }}>Retire ({person.retirementAge})</span>
            <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>{person.lifeExpectancy}</span>
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── SECTION 2: EXPENSE PICKER ────────────────────────────────────────────────

function ExpensePicker({ ff, expenseMode, selectedKeys, onChange, showSpouse, clientName, spouseName, clientTotalSelected, spouseTotalSelected }: {
  ff: Record<string, unknown>
  expenseMode: 'simple' | 'detailed'
  selectedKeys: Record<string, boolean>
  onChange: (keys: Record<string, boolean>) => void
  showSpouse: boolean
  clientName: string
  spouseName: string
  clientTotalSelected: number
  spouseTotalSelected: number
}) {
  function toggleCat(cat: string) {
    const newKeys = { ...selectedKeys }
    const group = RETIREMENT_EXPENSE_GROUPS.find(g => g.id === cat)
    if (group) {
      const newValue = !(selectedKeys[cat] !== false)
      group.items.forEach(item => { newKeys[item.key] = newValue })
      newKeys[cat] = newValue
    }
    onChange(newKeys)
  }

  const getCategoryTotal = (groupId: string, who: 'client' | 'spouse') => {
    const group = RETIREMENT_EXPENSE_GROUPS.find(g => g.id === groupId)
    if (!group) return 0
    return group.items.reduce((sum, item) => sum + readExpenseValue(ff, item, expenseMode, who), 0)
  }

  return (
    <div>
      <p style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', marginBottom: 16, lineHeight: 1.6 }}>
        Select which current expense categories to carry into retirement.
      </p>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: showSpouse ? '24px 1fr 110px 110px' : '24px 1fr 110px',
        gap: 8, padding: '0 12px 6px'
      }}>
        <div />
        <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Category</div>
        <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>{clientName}</div>
        {showSpouse && <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>{spouseName}</div>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {RETIREMENT_EXPENSE_GROUPS.map(group => {
          const clientAmt = getCategoryTotal(group.id, 'client')
          const spouseAmt = showSpouse ? getCategoryTotal(group.id, 'spouse') : 0
          const isSelected = selectedKeys[group.id] !== false

          return (
            <div key={group.id}
              onClick={() => toggleCat(group.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: showSpouse ? '24px 1fr 110px 110px' : '24px 1fr 110px',
                gap: 8, padding: '10px 12px', alignItems: 'center',
                background: isSelected ? '#F5F0E8' : 'transparent',
                borderRadius: 4, cursor: 'pointer', transition: 'background 0.12s',
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                background: isSelected ? group.color : 'transparent',
                border: `1.5px solid ${isSelected ? group.color : '#ccc'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                {isSelected && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
              </div>
              <span style={{ fontSize: 13, fontFamily: 'Inter', color: '#1C1A17' }}>{group.label}</span>
              <div style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#1C1A17' }}>
                {fmt(clientAmt)}
              </div>
              {showSpouse && (
                <div style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#1C1A17' }}>
                  {fmt(spouseAmt)}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Totals row */}
      <div style={{ marginTop: 16, padding: '12px 16px', background: '#1C1A17', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#c8a96e', fontFamily: 'Inter', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Selected Annual Expenses</span>
        {showSpouse ? (
          <div style={{ display: 'flex', gap: 24 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', marginBottom: 2 }}>{clientName}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#F5F0E8' }}>{fmt(clientTotalSelected)}/yr</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--gold)' }}>{fmt(clientTotalSelected / 12)}/mo</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', marginBottom: 2 }}>{spouseName}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#F5F0E8' }}>{fmt(spouseTotalSelected)}/yr</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--gold)' }}>{fmt(spouseTotalSelected / 12)}/mo</div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#F5F0E8' }}>{fmt(clientTotalSelected)}/yr</div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--gold)' }}>{fmt(clientTotalSelected / 12)}/mo</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── SECTION 3: CPF LIFE PANEL ────────────────────────────────────────────────

function CPFPanel({ person, onChange, name, color, cpfOA, cpfSA, cpfRA }: {
  person: RetirementPersonData
  onChange: (c: Partial<RetirementPersonData>) => void
  name: string
  color: string
  cpfOA: number
  cpfSA: number
  cpfRA: number
}) {
  const projectedRA = person.cpfRaBalanceOverride > 0
    ? person.cpfRaBalanceOverride
    : cpfRA > 0 ? cpfRA : Math.min(cpfOA + cpfSA, CPF_LIFE_2025.FRS.balance)

  const displayedPayout = person.includeCPF
    ? getCPFPlanPayout(person.cpfRaPlan, projectedRA, person.cpfLifeOverride)
    : 0

  const CPF_PLANS = [
    { key: 'brs' as CPFPlanType, label: 'BRS',      payout: CPF_LIFE_2025.BRS.monthly },
    { key: 'frs' as CPFPlanType, label: 'FRS',      payout: CPF_LIFE_2025.FRS.monthly },
    { key: 'ers' as CPFPlanType, label: 'ERS',      payout: CPF_LIFE_2025.ERS.monthly },
    { key: 'override' as CPFPlanType, label: 'Manual', payout: person.cpfLifeOverride },
  ]

  const inp: React.CSSProperties = {
    background: 'white', border: '1px solid var(--line)', borderRadius: 8,
    padding: '9px 12px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)',
    outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  }

  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header with toggle */}
      <div style={{ padding: '13px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--cream)', borderBottom: person.includeCPF ? '1px solid var(--line)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 4, height: 18, background: color, borderRadius: 2 }} />
          <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {person.includeCPF && displayedPayout > 0 && (
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--emerald)', fontWeight: 600 }}>
              ${displayedPayout.toLocaleString('en-SG')}/mo
            </span>
          )}
          {/* Toggle */}
          <div onClick={() => onChange({ includeCPF: !person.includeCPF })}
            style={{ width: 40, height: 22, borderRadius: 11, cursor: 'pointer', transition: 'background 0.2s', position: 'relative',
              background: person.includeCPF ? 'var(--emerald)' : '#ccc' }}>
            <div style={{ position: 'absolute', top: 3, left: person.includeCPF ? 21 : 3, width: 16, height: 16, borderRadius: 8, background: 'white', transition: 'left 0.2s' }} />
          </div>
        </div>
      </div>

      {/* Expanded content */}
      {person.includeCPF && (
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Plan selector */}
          <div>
            <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>CPF LIFE Plan</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {CPF_PLANS.map(plan => (
                <button key={plan.key} onClick={() => onChange({ cpfRaPlan: plan.key })}
                  style={{ padding: '8px 4px', border: `1px solid ${person.cpfRaPlan === plan.key ? color : 'var(--line)'}`, borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s', textAlign: 'center',
                    background: person.cpfRaPlan === plan.key ? color + '15' : 'white' }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: person.cpfRaPlan === plan.key ? color : 'var(--ink)' }}>{plan.label}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>
                    {plan.key !== 'override' ? `$${plan.payout.toLocaleString()}/mo` : 'Custom'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Manual override */}
          {person.cpfRaPlan === 'override' && (
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Monthly Payout Override (SGD)</div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>$</span>
                <input type="number" min={0} value={person.cpfLifeOverride || ''}
                  onChange={e => onChange({ cpfLifeOverride: parseFloat(e.target.value) || 0 })}
                  placeholder="e.g. 1200" style={{ ...inp, paddingLeft: 28 }} />
              </div>
            </div>
          )}

          {/* RA balance note */}
          <div style={{ background: 'var(--cream)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>CPF Balances on File</div>
            <div style={{ display: 'flex', gap: 20 }}>
              {[{ l: 'OA', v: cpfOA }, { l: 'SA', v: cpfSA }, { l: 'RA', v: cpfRA }].map(b => (
                <div key={b.l}>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)' }}>{b.l}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--ink)' }}>{fmt(b.v)}</div>
                </div>
              ))}
            </div>
            {cpfOA === 0 && cpfSA === 0 && cpfRA === 0 && (
              <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginTop: 6, marginBottom: 0 }}>
                No CPF data found — enter figures in Financial Profile first.
              </p>
            )}
          </div>

        </div>
      )}
    </div>
  )
}

// ─── SECTION 3: PASSIVE INCOME ────────────────────────────────────────────────

function PassiveIncomeSection({ items, onChange, isCouple, clientName, spouseName }: {
  items: PassiveIncomeItem[]
  onChange: (items: PassiveIncomeItem[]) => void
  isCouple: boolean
  clientName: string
  spouseName: string
}) {
  const inp: React.CSSProperties = {
    background: 'white', border: '1px solid var(--line)', borderRadius: 6,
    padding: '7px 10px', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink)',
    outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  }

  const TYPES: { key: PassiveIncomeItem['type']; label: string }[] = [
    { key: 'rental',   label: 'Rental Income' },
    { key: 'dividend', label: 'Dividend / Investment' },
    { key: 'annuity',  label: 'Annuity / Endowment' },
    { key: 'other',    label: 'Other' },
  ]
  const TYPE_COLORS: Record<string, string> = {
    rental: 'var(--gold)', dividend: 'var(--emerald)', annuity: '#6B5B8B', other: 'var(--ink3)'
  }

  function add() {
    onChange([...items, { id: newId(), label: '', type: 'rental', monthlyAmount: 0, startAge: 65, endAge: 0, owner: 'client' }])
  }
  function update(id: string, c: Partial<PassiveIncomeItem>) { onChange(items.map(i => i.id === id ? { ...i, ...c } : i)) }
  function remove(id: string) { onChange(items.filter(i => i.id !== id)) }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <p style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', margin: 0 }}>
          Income streams active during retirement — rental, dividends, annuity payouts, etc.
        </p>
        <button onClick={add}
          style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--gold)', background: 'transparent', border: '1px solid var(--gold)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: 12 }}>
          + Add Income
        </button>
      </div>

      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px', background: 'white', border: '2px dashed var(--line)', borderRadius: 10, color: 'var(--ink3)', fontFamily: 'Inter', fontSize: 12 }}>
          No passive income streams added yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map(item => (
            <div key={item.id} style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px', borderLeft: `3px solid ${TYPE_COLORS[item.type]}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <select value={item.type} onChange={e => update(item.id, { type: e.target.value as PassiveIncomeItem['type'] })}
                  style={{ border: 'none', background: 'transparent', fontFamily: 'Inter', fontSize: 11, fontWeight: 600, color: TYPE_COLORS[item.type], cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em', outline: 'none' }}>
                  {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <button onClick={() => remove(item.id)}
                  style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  Remove
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink3)', marginBottom: 4 }}>Description</div>
                  <input type="text" value={item.label} onChange={e => update(item.id, { label: e.target.value })}
                    placeholder="e.g. Rental — Toa Payoh HDB" style={inp} />
                </div>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink3)', marginBottom: 4 }}>Monthly (SGD)</div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>$</span>
                    <input type="number" min={0} value={item.monthlyAmount || ''}
                      onChange={e => update(item.id, { monthlyAmount: parseFloat(e.target.value) || 0 })}
                      style={{ ...inp, paddingLeft: 22 }} />
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink3)', marginBottom: 4 }}>Start Age</div>
                  <input type="number" min={50} max={100} value={item.startAge}
                    onChange={e => update(item.id, { startAge: parseInt(e.target.value) || 65 })} style={inp} />
                </div>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink3)', marginBottom: 4 }}>End Age (0 = lifelong)</div>
                  <input type="number" min={0} max={120} value={item.endAge}
                    onChange={e => update(item.id, { endAge: parseInt(e.target.value) || 0 })} style={inp} />
                </div>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink3)', marginBottom: 4 }}>Owner</div>
                  <div style={{ display: 'flex', background: 'white', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
                    {([
                      { v: 'client' as const, l: clientName },
                      ...(isCouple ? [{ v: 'joint' as const, l: 'Joint' }, { v: 'spouse' as const, l: spouseName }] : []),
                    ]).map(opt => (
                      <button key={opt.v} onClick={() => update(item.id, { owner: opt.v })}
                        style={{ flex: 1, padding: '7px 2px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, transition: 'all 0.12s',
                          background: item.owner === opt.v ? 'var(--ink)' : 'white',
                          color: item.owner === opt.v ? 'white' : 'var(--ink3)' }}>
                        {opt.l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export default function RetirementSection({
  data, onChange, isCouple,
  clientName = 'Client', spouseName = 'Spouse',
  clientAge = 35, spouseAge = 33,
  clientCPF_OA = 0, clientCPF_SA = 0, clientCPF_RA = 0,
  spouseCPF_OA = 0, spouseCPF_SA = 0, spouseCPF_RA = 0,
  clientLiquid = 0, spouseLiquid = 0,
  factFinding = {}, expenseMode = 'simple',
  onCalculated,
}: RetirementProps & { onCalculated?: (corpus: number, gap: number, monthly: number) => void }) {

  function upd(c: Partial<RetirementData>) { onChange({ ...data, ...c }) }
  function updClient(c: Partial<RetirementPersonData>) { upd({ client: { ...data.client, ...c } }) }
  function updSpouse(c: Partial<RetirementPersonData>) { upd({ spouse: { ...data.spouse, ...c } }) }
  function updExp(c: Partial<RetirementExpenseSelections>) { upd({ expenseSelections: { ...data.expenseSelections, ...c } }) }

  const es = data.expenseSelections
  const mode = es.mode

  // ── Expense totals ─────────────────────────────────────────────────────────
  const clientExpAnnual  = sumSelectedExpenses(factFinding, es.selectedExpenseKeys, expenseMode, 'client')
  const spouseExpAnnual  = isCouple ? sumSelectedExpenses(factFinding, es.selectedExpenseKeys, expenseMode, 'spouse') : 0
  const combinedExpAnnual = clientExpAnnual + spouseExpAnnual

  // ── Background calculation (feeds Capital Mandate via onCalculated) ────────
  const combinedMonthlyNeedToday = mode === 'direct'
  ? (isCouple ? es.combinedDesiredMonthly : data.client.desiredMonthlyIncome)
  : combinedExpAnnual / 12

  const phasedResult = calcPhasedRetirement(
    clientAge,
    data.client.retirementAge,
    data.client.lifeExpectancy,
    isCouple ? spouseAge : undefined,
    isCouple ? data.spouse.retirementAge : undefined,
    isCouple ? data.spouse.lifeExpectancy : undefined,
    0,
    combinedMonthlyNeedToday,
    data.inflationRate,
    data.postReturnRate,
  )

  useEffect(() => {
    if (!onCalculated) return
    const corpus = phasedResult.totalCorpusNeeded
    if (corpus <= 0) return
    const existingFV = clientLiquid * Math.pow(1 + data.preReturnRate / 100, phasedResult.yearsToClientRetirement)
    const gap = Math.max(0, corpus - existingFV)
    const rMo = data.preReturnRate / 100 / 12
    const preMo = phasedResult.yearsToClientRetirement * 12
    let monthly = 0
    if (gap > 0 && preMo > 0) {
      monthly = rMo === 0
        ? gap / preMo
        : gap * rMo / ((Math.pow(1 + rMo, preMo) - 1) * (1 + rMo))
    }
    onCalculated(corpus, gap, monthly)
  }, [phasedResult.totalCorpusNeeded, data.preReturnRate, phasedResult.yearsToClientRetirement, clientLiquid, onCalculated])

  const inp: React.CSSProperties = {
    background: 'white', border: '1px solid var(--line)', borderRadius: 8,
    padding: '9px 12px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)',
    outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  }

  return (
    <div>

      {/* Intro */}
      <div style={{ marginBottom: 32 }}>
        <p style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 8, fontWeight: 500 }}>Section 3 · Retirement Planning</p>
        <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 400, color: 'var(--ink)', marginBottom: 8 }}>Planning for Retirement</h2>
        <p style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6 }}>
          Capture the client's retirement intentions — age, lifestyle, and income offsets. Projections and gap analysis are shown in Capital Mandate.
        </p>
      </div>

      {/* ── SECTION 1: AGES ── */}
      <SubLabel color="var(--gold)">Retirement Age & Longevity</SubLabel>
      <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 8 }}>
        <AgePanel person={data.client} onChange={updClient} name={clientName} color="var(--gold)" currentAge={clientAge} />
        {isCouple && <AgePanel person={data.spouse} onChange={updSpouse} name={spouseName} color="#6B5B8B" currentAge={spouseAge} />}
      </div>

      {/* ── SECTION 2: RETIREMENT LIFESTYLE ── */}
      <SubLabel color="var(--ink)">Retirement Lifestyle</SubLabel>
      <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>

        {/* Mode tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)' }}>
          {([
            { key: 'expense_based' as IncomeInputMode, label: '✦  Pick from Current Expenses', desc: 'Select which current expenses to carry into retirement' },
            { key: 'direct' as IncomeInputMode,        label: '⟶  State a Desired Amount',    desc: 'Client states a specific monthly income and holiday budget' },
          ]).map(opt => (
            <button key={opt.key} onClick={() => updExp({ mode: opt.key })}
              style={{ flex: 1, padding: '15px 20px', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                background: mode === opt.key ? 'var(--ink)' : 'white' }}>
              <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, marginBottom: 3, color: mode === opt.key ? 'var(--gold)' : 'var(--ink)' }}>{opt.label}</div>
              <div style={{ fontFamily: 'Inter', fontSize: 11, color: mode === opt.key ? 'rgba(255,255,255,0.45)' : 'var(--ink3)' }}>{opt.desc}</div>
            </button>
          ))}
        </div>

        <div style={{ padding: '22px 24px' }}>

          {/* Expense-based */}
          {mode === 'expense_based' && (
            <ExpensePicker
              ff={factFinding} expenseMode={expenseMode}
              selectedKeys={es.selectedExpenseKeys}
              onChange={keys => updExp({ selectedExpenseKeys: keys })}
              showSpouse={isCouple}
              clientName={clientName} spouseName={spouseName}
              clientTotalSelected={clientExpAnnual} spouseTotalSelected={spouseExpAnnual}
            />
          )}

          {/* Direct input */}
          {mode === 'direct' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>
                  {isCouple ? 'Combined Monthly Income' : 'Desired Monthly Income'}
                  <span style={{ color: 'var(--ink3)', fontSize: 9, marginLeft: 4 }}>(today's $)</span>
                </div>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>SGD</span>
                  <input type="number" min={0}
                    value={isCouple ? es.combinedDesiredMonthly || '' : data.client.desiredMonthlyIncome || ''}
                    onChange={e => isCouple
                      ? updExp({ combinedDesiredMonthly: parseFloat(e.target.value) || 0 })
                      : updClient({ desiredMonthlyIncome: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g. 6000" style={{ ...inp, paddingLeft: 48 }} />
                </div>
                <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
                  Today's dollars — will be inflated to retirement date.
                </p>
              </div>
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>
                  {isCouple ? 'Combined Annual Holidays' : 'Annual Holiday Budget'}
                  <span style={{ color: 'var(--ink3)', fontSize: 9, marginLeft: 4 }}>(today's $)</span>
                </div>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>SGD</span>
                  <input type="number" min={0}
                    value={isCouple ? es.combinedDesiredHolidays || '' : data.client.desiredAnnualHolidays || ''}
                    onChange={e => isCouple
                      ? updExp({ combinedDesiredHolidays: parseFloat(e.target.value) || 0 })
                      : updClient({ desiredAnnualHolidays: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g. 10000" style={{ ...inp, paddingLeft: 48 }} />
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── SECTION 3: ASSUMPTIONS ── */}
      <SubLabel color="var(--gold)">Planning Assumptions</SubLabel>
      <div style={{ background: 'var(--gold-l)', border: '1px solid #e8d9be', borderRadius: 12, padding: '20px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 28 }}>
          <RateSlider label="Inflation Rate" value={data.inflationRate} onChange={v => upd({ inflationRate: v })} min={0} max={8} step={0.25} color="var(--gold)" />
          <RateSlider label="Post-Retirement Return" value={data.postReturnRate} onChange={v => upd({ postReturnRate: v })} min={0} max={10} step={0.25} color="var(--emerald)" />
          <RateSlider label="Pre-Retirement Return" value={data.preReturnRate} onChange={v => upd({ preReturnRate: v })} min={0} max={15} step={0.25} color="var(--ink3)" />
        </div>
        <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--gold-tag)', marginTop: 12, marginBottom: 0 }}>
          Pre-retirement return is used to grow existing investable assets to retirement date. Post-retirement return is the drawdown rate on the corpus.
        </p>
      </div>

      {/* ── SECTION 3B: AT RETIREMENT & CORPUS ── */}
      {combinedMonthlyNeedToday > 0 && (
        <>
          <SubLabel color="var(--ink)">Retirement Projections</SubLabel>

          {/* Card 1 — At Retirement */}
          <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ padding: '13px 20px', borderBottom: '1px solid var(--line)', background: 'var(--cream)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 4, height: 18, background: 'var(--gold)', borderRadius: 2 }} />
              <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--ink)' }}>
                Expenses at Retirement
              </span>
              <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginLeft: 4 }}>
                · inflated {Math.round(phasedResult.yearsToClientRetirement)}y at {data.inflationRate}%
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '20px 24px', gap: 0 }}>
              <div style={{ paddingRight: 24, borderRight: '1px solid var(--line)' }}>
                <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Monthly</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 32, fontWeight: 600, color: 'var(--gold)', lineHeight: 1 }}>
                  ${Math.round(phasedResult.monthlyNeedAtClientRetirement).toLocaleString('en-SG')}
                </div>
                <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>
                  per month at age {data.client.retirementAge}
                </div>
              </div>
              <div style={{ paddingLeft: 24 }}>
                <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Annual</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 32, fontWeight: 600, color: 'var(--ink)', lineHeight: 1 }}>
                  ${Math.round(phasedResult.monthlyNeedAtClientRetirement * 12).toLocaleString('en-SG')}
                </div>
                <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>
                  per year · today's equivalent {fmt(combinedMonthlyNeedToday)}/mo
                </div>
              </div>
            </div>
          </div>

          {/* Card 2 — Corpus Required */}
          <div style={{ background: '#1C1A17', borderRadius: 14, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ padding: '13px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 4, height: 18, background: '#c8a96e', borderRadius: 2 }} />
              <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, color: '#c8a96e' }}>
                Retirement Fund Required
              </span>
            </div>
            <div style={{ padding: '24px 24px 20px' }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 42, fontWeight: 600, color: '#F5F3EE', lineHeight: 1, marginBottom: 10 }}>
                ${Math.round(phasedResult.totalCorpusNeeded).toLocaleString('en-SG')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {[
                  { label: 'Retirement years', value: `${Math.round(phasedResult.retirementYears)}y` },
                  { label: 'Post-retirement return', value: `${data.postReturnRate}%` },
                  { label: 'Inflation', value: `${data.inflationRate}%` },
                ].map(pill => (
                  <div key={pill.label} style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 20, padding: '4px 12px', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{pill.label}</span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#c8a96e' }}>{pill.value}</span>
                  </div>
                ))}
              </div>
              {isCouple && phasedResult.gapYears > 0 && (
                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '10px 14px', borderLeft: '3px solid #c8a96e' }}>
                  <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                    Includes {phasedResult.gapYears}-year gap period — {clientName} retires at {phasedResult.clientRetirementAge}, {spouseName} at {phasedResult.spouseRetirementAge}
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      
      {/* ── SECTION 4: INCOME OFFSETS ── */}
      <SubLabel color="var(--emerald)">Income Offsets at Retirement</SubLabel>
      <p style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', marginBottom: 16, lineHeight: 1.6 }}>
        Passive income streams that reduce the corpus needed — rental, dividends, annuity payouts, etc.
      </p>

      {/* Passive Income */}
      <div style={{ marginTop: 0 }}>
        <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Passive Income</div>
        <PassiveIncomeSection
          items={data.passiveIncome}
          onChange={items => upd({ passiveIncome: items })}
          isCouple={isCouple}
          clientName={clientName}
          spouseName={spouseName}
        />
      </div>

      {/* ── SECTION 5: ADVISOR NOTES ── */}
      <SubLabel>Advisor Notes</SubLabel>
      <textarea rows={3} value={data.advisorNotes} onChange={e => upd({ advisorNotes: e.target.value })}
        placeholder="Document key assumptions, client preferences, or discussion points from this session…"
        style={{ width: '100%', background: 'white', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', resize: 'vertical', lineHeight: 1.6, outline: 'none', boxSizing: 'border-box' }}
      />

    </div>
  )
}
