'use client'

import { useState } from 'react'

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
  // Direct income mode
  desiredMonthlyIncome: number
  desiredAnnualHolidays: number
  // CPF LIFE
  includeCPF: boolean
  cpfRaPlan: CPFPlanType
  cpfRaBalanceOverride: number   // manual RA balance override; 0 = use pulled data
  cpfLifeOverride: number        // monthly payout override when plan === 'override'
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
// Source: CPF Board (cpf.gov.sg), DBS, OCBC — Standard Plan, payout starts age 65
// BRS $106,500 → ~$900/mo | FRS $213,000 → ~$1,600/mo | ERS $426,000 → ~$3,300/mo

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
      { key: 'd_mortgage_cpf',       label: 'Mortgage Loan (CPF OA)',       simpleKey: 's_cpf_oa',   detailedKey: 'd_mortgage_cpf' },
      { key: 'd_mortgage_cash',      label: 'Mortgage Loan (Cash)',         simpleKey: 's_mortgage', detailedKey: 'd_mortgage_cash' },
      { key: 'd_vehicle_repay',      label: 'Motor Vehicle Repayment',      detailedKey: 'd_vehicle_repay' },
      { key: 'd_personal_loan_repay',label: 'Personal Loan Repayment',      detailedKey: 'd_personal_loan_repay' },
      { key: 'd_rental_expense',     label: 'Rental Expenses',              detailedKey: 'd_rental_expense' },
      { key: 'd_income_tax',         label: 'Income Tax',                   simpleKey: 's_financial', detailedKey: 'd_income_tax' },
      { key: 'd_insurance',          label: 'Insurance Payments',           simpleKey: 's_financial', detailedKey: 'd_insurance' },
      { key: 'd_regular_savings',    label: 'Regular Savings / Investments',simpleKey: 's_financial', detailedKey: 'd_regular_savings' },
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
      { key: 'd_personal_food', label: 'Personal Food & Dining',      simpleKey: 's_personal', detailedKey: 'd_personal_food' },
      { key: 'd_transport',     label: 'Public Transport',            simpleKey: 's_personal', detailedKey: 'd_transport' },
      { key: 'd_car_petrol',    label: 'Car Petrol / Parking / Tax',  simpleKey: 's_personal', detailedKey: 'd_car_petrol' },
      { key: 'd_car_insurance', label: 'Car Insurance',               simpleKey: 's_personal', detailedKey: 'd_car_insurance' },
    ],
  },
  {
    id: 'children',
    label: 'Children Expenses',
    color: '#2D5A4E',
    items: [
      { key: 'd_childcare',          label: 'Childcare / DayCare',        simpleKey: 's_children', detailedKey: 'd_childcare' },
      { key: 'd_school_fees',        label: 'School & Tuition Fees',      simpleKey: 's_children', detailedKey: 'd_school_fees' },
      { key: 'd_school_transport',   label: 'School Transport',           simpleKey: 's_children', detailedKey: 'd_school_transport' },
      { key: 'd_allowance_children', label: 'Allowance / Pocket Money',   simpleKey: 's_children', detailedKey: 'd_allowance_children' },
      { key: 'd_other_children',     label: 'Other Children Expenses',    simpleKey: 's_children', detailedKey: 'd_other_children' },
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

// ─── CALC ENGINE ──────────────────────────────────────────────────────────────

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

function calcRetirement(
  person: RetirementPersonData,
  currentAge: number,
  inflationRate: number,
  postReturnRate: number,
  preReturnRate: number,
  passiveItems: PassiveIncomeItem[],
  who: 'client' | 'spouse',
  liquidAssets: number,
  monthlyNeed: number,
  annualHolidays: number,
): RetirementCalcResult {
  const g = inflationRate / 100
  const r = postReturnRate / 100
  const rPre = preReturnRate / 100
  const yearsToRetirement = Math.max(0.5, person.retirementAge - currentAge)
  const retirementYears = Math.max(1, person.lifeExpectancy - person.retirementAge)

  const monthlyNeedAtRetirement = monthlyNeed * Math.pow(1 + g, yearsToRetirement)
  const annualHolidaysAtRetirement = annualHolidays * Math.pow(1 + g, yearsToRetirement)
  const totalAnnualNeedAtRetirement = monthlyNeedAtRetirement * 12 + annualHolidaysAtRetirement

  const cpfLifeMonthly = person.includeCPF
    ? getCPFPlanPayout(person.cpfRaPlan, person.cpfRaBalanceOverride, person.cpfLifeOverride)
    : 0
  const cpfLifeAnnual = cpfLifeMonthly * 12

  const passiveAnnual = passiveItems
    .filter(p => {
      const ownerMatch = p.owner === who || p.owner === 'joint'
      const active = p.startAge <= person.retirementAge && (p.endAge === 0 || p.endAge > person.retirementAge)
      return ownerMatch && active
    })
    .reduce((s, p) => s + (p.owner === 'joint' ? p.monthlyAmount * 6 : p.monthlyAmount * 12), 0)

  const netAnnualGap = Math.max(0, totalAnnualNeedAtRetirement - cpfLifeAnnual - passiveAnnual)

  // Corpus = PV of growing annuity
  let corpusNeeded = 0
  if (netAnnualGap > 0 && retirementYears > 0) {
    if (Math.abs(r - g) < 0.0001) {
      corpusNeeded = netAnnualGap * retirementYears / (1 + r)
    } else {
      corpusNeeded = netAnnualGap * (1 - Math.pow((1 + g) / (1 + r), retirementYears)) / (r - g)
    }
  }

  const existingAssetsFV = liquidAssets * Math.pow(1 + rPre, yearsToRetirement)
  const savingsGap = Math.max(0, corpusNeeded - existingAssetsFV)

  const rPreM = rPre / 12
  const preMo = yearsToRetirement * 12
  let monthlySavingsRequired = 0
  if (savingsGap > 0 && preMo > 0) {
    if (rPreM === 0) {
      monthlySavingsRequired = savingsGap / preMo
    } else {
      monthlySavingsRequired = savingsGap * rPreM / ((Math.pow(1 + rPreM, preMo) - 1) * (1 + rPreM))
    }
  }

  return {
    monthlyNeedAtRetirement, annualHolidaysAtRetirement, totalAnnualNeedAtRetirement,
    cpfLifeMonthly, cpfLifeAnnual, passiveAnnual, netAnnualGap,
    corpusNeeded, existingAssetsFV, savingsGap, monthlySavingsRequired,
    yearsToRetirement, retirementYears,
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmtSGD(n: number) {
  if (!n || isNaN(n)) return 'SGD 0'
  return `SGD ${Math.round(n).toLocaleString('en-SG')}`
}
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
  // Simplified mode mapping
  const simpleMap: Record<string, string> = {
    's_financial': 'd_income_tax',
    's_cpf_oa': 'd_mortgage_cpf',
    's_mortgage': 'd_mortgage_cash',
    's_household': 'd_conservancy',
    's_personal': 'd_personal_food',
    's_children': 'd_childcare',
    's_lifestyle': 'd_holidays',
  }
  const base = item.simpleKey
  if (base) {
    const key = who === 'spouse' ? base.replace('s_', 's2_') : base
    const val = (ff[key] as number) || 0
    
    const mappedDetailedKey = simpleMap[base]
    if (mappedDetailedKey && item.detailedKey === mappedDetailedKey) {
      return val
    }
    return 0
  }
  return 0
}

function sumSelectedExpenses(ff: Record<string, unknown>, selectedKeys: Record<string, boolean>, expenseMode: 'simple' | 'detailed', who: 'client' | 'spouse'): number {
  let total = 0
  for (const group of RETIREMENT_EXPENSE_GROUPS) {
    // Check if category is selected
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
    includeCPF: true, cpfRaPlan: 'frs', cpfRaBalanceOverride: 0, cpfLifeOverride: 0,
  },
  spouse: {
    retirementAge: 65, lifeExpectancy: 85,
    desiredMonthlyIncome: 0, desiredAnnualHolidays: 0,
    includeCPF: true, cpfRaPlan: 'frs', cpfRaBalanceOverride: 0, cpfLifeOverride: 0,
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

function PillSelect<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', background: 'white', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          style={{ flex: 1, padding: '9px 4px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', transition: 'all 0.15s',
            background: value === opt.value ? 'var(--ink)' : 'white',
            color: value === opt.value ? 'white' : 'var(--ink3)',
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ─── EXPENSE PICKER ───────────────────────────────────────────────────────────

function ExpensePicker({ ff, expenseMode, selectedKeys, onChange, showSpouse, clientName, spouseName, clientTotalSelected, spouseTotalSelected }: {
  ff: Record<string, unknown>; expenseMode: 'simple' | 'detailed'
  selectedKeys: Record<string, boolean>; onChange: (keys: Record<string, boolean>) => void
  showSpouse: boolean; clientName: string; spouseName: string
  clientTotalSelected: number; spouseTotalSelected: number
}) {
  const cats = selectedKeys
  
  function toggleCat(cat: string) {
    // Toggle all items in this category
    const newKeys = { ...selectedKeys }
    const group = RETIREMENT_EXPENSE_GROUPS.find(g => g.id === cat)
    if (group) {
      const newValue = !cats[cat]
      group.items.forEach(item => {
        newKeys[item.key] = newValue
      })
      newKeys[cat] = newValue
    }
    onChange(newKeys)
  }

  // Calculate category totals
  const getCategoryTotal = (groupId: string, who: 'client' | 'spouse') => {
    const group = RETIREMENT_EXPENSE_GROUPS.find(g => g.id === groupId)
    if (!group) return 0
    return group.items.reduce((sum, item) => {
      return sum + readExpenseValue(ff, item, expenseMode, who)
    }, 0)
  }

  return (
    <div>
      <p style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', marginBottom: 16, lineHeight: 1.6 }}>
        Select which expense categories to include in retirement planning.
      </p>

      {/* Column headers for couple mode */}
      {showSpouse && (
        <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 110px 110px 80px', gap: 8, padding: '0 12px 6px', alignItems: 'center' }}>
          <div />
          <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Category</div>
          <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>{clientName}</div>
          <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>{spouseName}</div>
          <div />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {RETIREMENT_EXPENSE_GROUPS.map(group => {
          const clientAmt = getCategoryTotal(group.id, 'client')
          const spouseAmt = showSpouse ? getCategoryTotal(group.id, 'spouse') : 0
          const catTotal = clientAmt + spouseAmt
          const clientPct = catTotal > 0 ? Math.round(clientAmt / catTotal * 100) : 0
          const spousePct = catTotal > 0 ? Math.round(spouseAmt / catTotal * 100) : 0
          const isSelected = cats[group.id] !== false

          return (
            <div key={group.id}
              style={{ 
                display: 'grid',
                gridTemplateColumns: showSpouse ? '24px 1fr 110px 110px 80px' : '24px 1fr 100px 80px',
                gap: 8, 
                padding: '9px 12px', 
                alignItems: 'center',
                background: isSelected ? '#F5F0E8' : 'transparent',
                borderRadius: 4, 
                cursor: 'pointer', 
                transition: 'background 0.12s',
              }}
              onClick={() => toggleCat(group.id)}
            >
              {/* Checkbox */}
              <div style={{ 
                width: 16, 
                height: 16, 
                borderRadius: 3, 
                flexShrink: 0,
                background: isSelected ? group.color : 'transparent',
                border: `1.5px solid ${isSelected ? group.color : '#ccc'}`,
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center' 
              }}>
                {isSelected && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
              </div>
              
              {/* Label */}
              <span style={{ fontSize: 13, fontFamily: 'Inter', color: '#1C1A17' }}>{group.label}</span>
              
              {/* Client amount + % */}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#1C1A17' }}>{fmt(clientAmt)}</div>
                {showSpouse && catTotal > 0 && (
                  <div style={{ fontSize: 10, color: group.color, fontFamily: 'Inter' }}>{clientPct}%</div>
                )}
              </div>
              
              {/* Spouse amount + % */}
              {showSpouse && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#1C1A17' }}>{fmt(spouseAmt)}</div>
                  {catTotal > 0 && (
                    <div style={{ fontSize: 10, color: '#2D5A4E', fontFamily: 'Inter' }}>{spousePct}%</div>
                  )}
                </div>
              )}
              
              {/* Edit button - placeholder for future modal */}
              <div style={{ textAlign: 'right' }}>
                {/* Can add Edit modal later if needed */}
              </div>
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

      {/* Totals */}
      <div style={{ background: 'var(--ink)', borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>Selected Annual Expenses</span>
          {showSpouse ? (
            <div style={{ display: 'flex', gap: 24 }}>
              {[{ label: clientName, val: clientTotalSelected }, { label: spouseName, val: spouseTotalSelected }].map(({ label, val }) => (
                <div key={label} style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#F5F0E8' }}>{fmt(val)}/yr</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: 'var(--gold)' }}>{fmt(val / 12)}/mo</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#F5F0E8' }}>{fmt(clientTotalSelected)}/yr</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--gold)' }}>{fmt(clientTotalSelected / 12)}/mo</div>
            </div>
          )}
        </div>
      </div>

// ─── EXPECTATION COMPARISON ───────────────────────────────────────────────────

function ExpectationComparison({ currentAnnual, wishAnnual, personName, color }: {
  currentAnnual: number; wishAnnual: number; personName: string; color: string
}) {
  if (!currentAnnual || !wishAnnual) return null
  const ratio = wishAnnual / currentAnnual
  const pctDiff = Math.round((ratio - 1) * 100)

  let statusColor: string, icon: string, message: string
  if (ratio < 0.7) {
    statusColor = '#C0392B'; icon = '⚠'
    message = `Retirement wish is ${Math.abs(pctDiff)}% below current spending (only ${Math.round(ratio * 100)}% of today's lifestyle). Worth discussing whether this is intentional.`
  } else if (ratio <= 1.15) {
    statusColor = '#2D5A4E'; icon = '✓'
    message = `Retirement wish aligns closely with current spending (${pctDiff >= 0 ? '+' : ''}${pctDiff}%). Realistic and well-calibrated.`
  } else {
    statusColor = '#A8834A'; icon = '↑'
    message = `Retirement wish is ${pctDiff}% above current spending. Ensure sufficient corpus is planned to support this lifestyle.`
  }

  const barMax = Math.max(currentAnnual, wishAnnual)

  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--cream)' }}>
        <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--ink3)' }}>Expectation Check · {personName}</span>
        <span style={{ fontFamily: 'Inter', fontSize: 11, color: statusColor, fontWeight: 700 }}>{icon} {pctDiff >= 0 ? '+' : ''}{pctDiff}% vs current spending</span>
      </div>
      <div style={{ padding: '16px' }}>
        {[
          { label: 'Current spending (selected items)', value: currentAnnual, col: 'var(--ink3)' },
          { label: 'Retirement wish (stated)', value: wishAnnual, col: color },
        ].map((row, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>{row.label}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: row.col, fontWeight: 600 }}>{fmt(row.value)}/yr · {fmt(row.value / 12)}/mo</span>
            </div>
            <div style={{ height: 8, background: 'var(--cream)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--line)' }}>
              <div style={{ height: '100%', width: `${(row.value / barMax) * 100}%`, background: row.col, borderRadius: 4, transition: 'width 0.4s' }} />
            </div>
          </div>
        ))}
        <div style={{ padding: '10px 12px', background: ratio < 0.7 ? '#FEF3F2' : ratio > 1.15 ? '#FDF8F0' : '#EFF7F3', borderRadius: 8, borderLeft: `3px solid ${statusColor}` }}>
          <p style={{ fontFamily: 'Inter', fontSize: 11, color: statusColor, margin: 0, lineHeight: 1.5 }}>{message}</p>
        </div>
      </div>
    </div>
  )
}

// ─── PERSON PANEL ─────────────────────────────────────────────────────────────

function PersonPanel({ person, onChange, name, color, currentAge, cpfOA, cpfSA, cpfRA }: {
  person: RetirementPersonData; onChange: (c: Partial<RetirementPersonData>) => void
  name: string; color: string; currentAge: number
  cpfOA: number; cpfSA: number; cpfRA: number
}) {
  const inp: React.CSSProperties = {
    background: 'white', border: '1px solid var(--line)', borderRadius: 8,
    padding: '9px 12px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)',
    outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  }

  const projectedRA = person.cpfRaBalanceOverride > 0
    ? person.cpfRaBalanceOverride
    : cpfRA > 0 ? cpfRA : Math.min(cpfOA + cpfSA, CPF_LIFE_2025.FRS.balance)

  const estimatedPayout = estimateCPFLifePayout(projectedRA)
  const displayedPayout = person.includeCPF
    ? getCPFPlanPayout(person.cpfRaPlan, projectedRA, person.cpfLifeOverride)
    : 0

  const CPF_PLANS = [
    { key: 'brs' as CPFPlanType, label: 'BRS',     payout: CPF_LIFE_2025.BRS.monthly, balance: CPF_LIFE_2025.BRS.balance },
    { key: 'frs' as CPFPlanType, label: 'FRS',     payout: CPF_LIFE_2025.FRS.monthly, balance: CPF_LIFE_2025.FRS.balance },
    { key: 'ers' as CPFPlanType, label: 'ERS',     payout: CPF_LIFE_2025.ERS.monthly, balance: CPF_LIFE_2025.ERS.balance },
    { key: 'override' as CPFPlanType, label: 'Override', payout: person.cpfLifeOverride, balance: 0 },
  ]

  const AgeButtons = ({ current, options, onSet }: { current: number; options: number[]; onSet: (v: number) => void }) => (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
      {options.map(age => (
        <button key={age} onClick={() => onSet(age)}
          style={{ padding: '5px 9px', fontFamily: 'DM Mono, monospace', fontSize: 11, border: 'none', borderRadius: 5, cursor: 'pointer', transition: 'all 0.12s',
            background: current === age ? 'var(--ink)' : 'var(--cream)',
            color: current === age ? 'white' : 'var(--ink3)',
            outline: current === age ? 'none' : '1px solid var(--line)',
          }}>
          {age}
        </button>
      ))}
      <input type="number" value={current} onChange={e => onSet(parseInt(e.target.value) || current)}
        style={{ ...inp, width: 58, padding: '5px 8px', fontSize: 12, textAlign: 'center' }} />
    </div>
  )

  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--cream)' }}>
        <div style={{ width: 4, height: 20, background: color, borderRadius: 2 }} />
        <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>{name}</span>
        <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>· Age {currentAge}</span>
      </div>

      <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Retirement & life expectancy */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
          <div>
            <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 7 }}>Retirement Age</div>
            <AgeButtons current={person.retirementAge} options={[55, 60, 62, 65, 67]} onSet={v => onChange({ retirementAge: v })} />
          </div>
          <div>
            <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 7 }}>Life Expectancy</div>
            <AgeButtons current={person.lifeExpectancy} options={[80, 85, 90, 95]} onSet={v => onChange({ lifeExpectancy: v })} />
          </div>
        </div>

        {/* CPF LIFE */}
        <div style={{ background: 'var(--cream)', borderRadius: 10, padding: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--ink3)' }}>CPF LIFE</span>
              <a href="https://www.cpf.gov.sg/member/retirement-income/monthly-payouts/cpf-life" target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--gold)', textDecoration: 'none', padding: '2px 7px', border: '1px solid var(--gold)', borderRadius: 4 }}>
                CPF Estimator ↗
              </a>
              <span style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)' }}>Data: {CPF_LIFE_2025.dataYear}</span>
            </div>
            {/* Include toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>Include</span>
              <div onClick={() => onChange({ includeCPF: !person.includeCPF })}
                style={{ width: 34, height: 19, borderRadius: 10, cursor: 'pointer', transition: 'background 0.15s', background: person.includeCPF ? 'var(--gold)' : '#ccc', position: 'relative', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 2, left: person.includeCPF ? 17 : 2, width: 15, height: 15, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </div>
            </div>
          </div>

          {person.includeCPF && (
            <>
              {/* CPF balance display */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 12, padding: '10px', background: 'white', borderRadius: 8, border: '1px solid var(--line)' }}>
                {[
                  { label: 'OA', val: cpfOA },
                  { label: cpfSA > 0 ? 'SA' : 'RA', val: cpfSA > 0 ? cpfSA : cpfRA },
                  { label: 'Proj. RA', val: projectedRA },
                ].map((item, i) => (
                  <div key={i} style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink3)', marginBottom: 3 }}>{item.label}</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--ink)' }}>{fmt(item.val)}</div>
                  </div>
                ))}
              </div>

              {/* Estimated from balance */}
              <div style={{ marginBottom: 12, padding: '7px 12px', background: '#EEF6F1', borderRadius: 6, border: '1px solid #d0e8da', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--emerald)' }}>Estimated from RA balance</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 600, color: 'var(--emerald)' }}>{fmt(estimatedPayout)}/mo</span>
              </div>

              {/* Plan selector */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, marginBottom: 12 }}>
                {CPF_PLANS.map(plan => (
                  <button key={plan.key} onClick={() => onChange({ cpfRaPlan: plan.key })}
                    style={{ padding: '7px 4px', border: 'none', borderRadius: 7, cursor: 'pointer', textAlign: 'center', transition: 'all 0.12s',
                      background: person.cpfRaPlan === plan.key ? 'var(--ink)' : 'white',
                      color: person.cpfRaPlan === plan.key ? 'white' : 'var(--ink3)',
                      outline: person.cpfRaPlan === plan.key ? 'none' : '1px solid var(--line)',
                    }}>
                    <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600 }}>{plan.label}</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, marginTop: 1, color: person.cpfRaPlan === plan.key ? 'rgba(255,255,255,0.65)' : 'var(--ink3)' }}>
                      {plan.key !== 'override' ? `${fmt(plan.payout)}/mo` : '—'}
                    </div>
                    {plan.balance > 0 && (
                      <div style={{ fontFamily: 'Inter', fontSize: 9, marginTop: 1, color: person.cpfRaPlan === plan.key ? 'rgba(255,255,255,0.4)' : 'var(--ink3)' }}>
                        {fmt(plan.balance)}
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* Override / RA balance input */}
              {person.cpfRaPlan === 'override' ? (
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 5 }}>Monthly Payout Override (SGD)</div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>$</span>
                    <input type="number" min={0} value={person.cpfLifeOverride || ''}
                      onChange={e => onChange({ cpfLifeOverride: parseFloat(e.target.value) || 0 })}
                      placeholder="Enter from CPF estimator" style={{ ...inp, paddingLeft: 28 }} />
                  </div>
                  <p style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 4 }}>
                    Get the exact amount from the <a href="https://www.cpf.gov.sg/payoutestimator" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>CPF LIFE Estimator ↗</a>
                  </p>
                </div>
              ) : (
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 5 }}>Override RA Balance (optional)</div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>$</span>
                    <input type="number" min={0} value={person.cpfRaBalanceOverride || ''}
                      onChange={e => onChange({ cpfRaBalanceOverride: parseFloat(e.target.value) || 0 })}
                      placeholder={`Auto-projected: ${fmt(projectedRA)}`} style={{ ...inp, paddingLeft: 28 }} />
                  </div>
                </div>
              )}

              {/* Final payout callout */}
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 13px', background: 'var(--gold-l)', border: '1px solid #e8d9be', borderRadius: 8 }}>
                <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--gold-tag)', fontWeight: 600 }}>CPF LIFE Payout Used</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 700, color: 'var(--gold-tag)' }}>{fmt(displayedPayout)}/mo</span>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── KPI STRIP ────────────────────────────────────────────────────────────────

function KPIStrip({ result, name }: { result: RetirementCalcResult; name: string }) {
  const hasGap = result.savingsGap > 0
  const kpis = [
    { label: 'Monthly Need at Retirement', value: fmtSGD(result.monthlyNeedAtRetirement), sub: 'Inflation-adjusted FV', hi: false, alert: false },
    { label: 'Corpus Needed', value: fmtSGD(result.corpusNeeded), sub: `${Math.round(result.retirementYears)}y retirement`, hi: true, alert: false },
    { label: 'Savings Gap', value: hasGap ? fmtSGD(result.savingsGap) : '✓ On Track', sub: hasGap ? 'Additional corpus required' : `Surplus ${fmtSGD(result.existingAssetsFV - result.corpusNeeded)}`, hi: false, alert: hasGap },
    { label: 'Monthly Savings Required', value: result.monthlySavingsRequired > 0 ? fmtSGD(result.monthlySavingsRequired) : '—', sub: `Over ${Math.round(result.yearsToRetirement)}y pre-retirement`, hi: false, alert: false },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
      {kpis.map((kpi, i) => (
        <div key={i} style={{ padding: '14px 16px', borderRight: i < 3 ? '1px solid var(--line)' : 'none', background: kpi.alert ? '#FEF3F2' : kpi.hi ? 'var(--gold-l)' : 'white' }}>
          <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>{kpi.label}</div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 600, marginBottom: 2, color: kpi.alert ? 'var(--rouge)' : kpi.hi ? 'var(--gold-tag)' : 'var(--ink)' }}>{kpi.value}</div>
          <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>{kpi.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ─── RETIREMENT CHART ─────────────────────────────────────────────────────────

function RetirementChart({ result, personName, currentAge, color }: {
  result: RetirementCalcResult; personName: string; currentAge: number; color: string
}) {
  const retirementAge = Math.round(currentAge + result.yearsToRetirement)
  const lifeExpectancy = Math.round(retirementAge + result.retirementYears)
  const totalYears = result.yearsToRetirement + result.retirementYears
  const workPct = totalYears > 0 ? (result.yearsToRetirement / totalYears) * 100 : 60
  const hasGap = result.savingsGap > 0
  const barMax = Math.max(result.corpusNeeded, result.existingAssetsFV, 1)

  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--cream)' }}>
        <span style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink)' }}>{personName}</span>
        <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>
          {Math.round(result.yearsToRetirement)}y to retire · {Math.round(result.retirementYears)}y in retirement
        </span>
      </div>
      <div style={{ padding: '16px' }}>

        {/* Timeline bar */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Life Timeline</div>
          <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line)' }}>
            <div style={{ width: `${workPct}%`, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, color: 'white', padding: '0 8px', whiteSpace: 'nowrap' }}>Working · {Math.round(result.yearsToRetirement)}y</span>
            </div>
            <div style={{ flex: 1, background: hasGap ? '#FEF3F2' : '#EFF7F3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, color: hasGap ? 'var(--rouge)' : 'var(--emerald)', padding: '0 8px', whiteSpace: 'nowrap' }}>Retirement · {Math.round(result.retirementYears)}y</span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>Now ({currentAge})</span>
            <span style={{ fontFamily: 'Inter', fontSize: 10, color, fontWeight: 600 }}>Retire ({retirementAge})</span>
            <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>{lifeExpectancy}</span>
          </div>
        </div>

        {/* Corpus bars */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Corpus vs Investable Assets (FV at Retirement)</div>
          {[
            { label: 'Corpus Needed', val: result.corpusNeeded, col: hasGap ? 'var(--rouge)' : 'var(--emerald)' },
            { label: 'Investable Assets (FV)', val: result.existingAssetsFV, col: color },
          ].map((row, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>{row.label}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: row.col, fontWeight: 600 }}>{fmtSGD(row.val)}</span>
              </div>
              <div style={{ height: 9, background: 'var(--cream)', borderRadius: 5, overflow: 'hidden', border: '1px solid var(--line)' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (row.val / barMax) * 100)}%`, background: row.col, borderRadius: 5 }} />
              </div>
            </div>
          ))}
        </div>

        {/* Income waterfall at retirement */}
        <div style={{ background: 'var(--cream)', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Monthly Income at Retirement (Inflated)</div>
          {[
            { label: 'Monthly Need', val: result.monthlyNeedAtRetirement, col: 'var(--ink)', show: true },
            { label: '+ Holidays (÷12)', val: result.annualHolidaysAtRetirement / 12, col: 'var(--ink3)', show: result.annualHolidaysAtRetirement > 0 },
            { label: '− CPF LIFE', val: result.cpfLifeMonthly, col: 'var(--emerald)', neg: true, show: result.cpfLifeMonthly > 0 },
            { label: '− Passive Income (÷12)', val: result.passiveAnnual / 12, col: 'var(--emerald)', neg: true, show: result.passiveAnnual > 0 },
          ].filter(r => r.show).map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>{row.label}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: row.col }}>{fmt(row.val)}/mo</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 6, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>Net Monthly Drawdown Gap</span>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color: result.netAnnualGap > 0 ? 'var(--rouge)' : 'var(--emerald)' }}>
              {fmt(result.netAnnualGap / 12)}/mo
            </span>
          </div>
        </div>

        {/* Gap indicator */}
        {hasGap ? (
          <div style={{ background: '#FEF3F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--rouge)', fontWeight: 500 }}>Savings Gap</span>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: 'var(--rouge)', fontWeight: 700 }}>{fmtSGD(result.savingsGap)}</span>
          </div>
        ) : (
          <div style={{ background: 'var(--emerald-l)', border: '1px solid #d0e8da', borderRadius: 8, padding: '10px 14px' }}>
            <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--emerald)', fontWeight: 500 }}>
              ✓ On track — surplus {fmtSGD(result.existingAssetsFV - result.corpusNeeded)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PASSIVE INCOME ───────────────────────────────────────────────────────────

function PassiveIncomeSection({ items, onChange, isCouple, clientName, spouseName }: {
  items: PassiveIncomeItem[]; onChange: (items: PassiveIncomeItem[]) => void
  isCouple: boolean; clientName: string; spouseName: string
}) {
  const inp: React.CSSProperties = {
    background: 'white', border: '1px solid var(--line)', borderRadius: 6,
    padding: '7px 10px', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink)',
    outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  }

  const TYPES: { key: PassiveIncomeItem['type']; label: string }[] = [
    { key: 'rental', label: 'Rental Income' },
    { key: 'dividend', label: 'Dividend / Investment' },
    { key: 'annuity', label: 'Annuity / Endowment' },
    { key: 'other', label: 'Other' },
  ]
  const TYPE_COLORS: Record<string, string> = { rental: 'var(--gold)', dividend: 'var(--emerald)', annuity: '#6B5B8B', other: 'var(--ink3)' }

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
        <button onClick={add} style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--gold)', background: 'transparent', border: '1px solid var(--gold)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: 12 }}>
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
                <button onClick={() => remove(item.id)} style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
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
                  <input type="number" min={50} max={100} value={item.startAge} onChange={e => update(item.id, { startAge: parseInt(e.target.value) || 65 })} style={inp} />
                </div>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink3)', marginBottom: 4 }}>End Age (0=lifelong)</div>
                  <input type="number" min={0} max={120} value={item.endAge} onChange={e => update(item.id, { endAge: parseInt(e.target.value) || 0 })} style={inp} />
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
                          color: item.owner === opt.v ? 'white' : 'var(--ink3)',
                        }}>
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
}: RetirementProps) {

  function upd(c: Partial<RetirementData>) { onChange({ ...data, ...c }) }
  function updClient(c: Partial<RetirementPersonData>) { upd({ client: { ...data.client, ...c } }) }
  function updSpouse(c: Partial<RetirementPersonData>) { upd({ spouse: { ...data.spouse, ...c } }) }
  function updExp(c: Partial<RetirementExpenseSelections>) { upd({ expenseSelections: { ...data.expenseSelections, ...c } }) }

  const es = data.expenseSelections
  const mode = es.mode
  const coupleMode = es.coupleIncomeMode

  // ── Resolve income needs per person ─────────────────────────────────────

  const clientExpAnnual = sumSelectedExpenses(factFinding, es.selectedExpenseKeys, expenseMode, 'client')
  const spouseExpAnnual = isCouple ? sumSelectedExpenses(factFinding, es.selectedExpenseKeys, expenseMode, 'spouse') : 0
  const combinedExpAnnual = clientExpAnnual + spouseExpAnnual

  let clientMonthly = 0, clientHolidays = 0, spouseMonthly = 0, spouseHolidays = 0

  if (mode === 'expense_based') {
    if (!isCouple || coupleMode === 'separate') {
      clientMonthly = clientExpAnnual / 12
      spouseMonthly = spouseExpAnnual / 12
    } else {
      clientMonthly = combinedExpAnnual / 2 / 12
      spouseMonthly = combinedExpAnnual / 2 / 12
    }
  } else {
    if (!isCouple || coupleMode === 'separate') {
      clientMonthly = data.client.desiredMonthlyIncome
      clientHolidays = data.client.desiredAnnualHolidays
      spouseMonthly = data.spouse.desiredMonthlyIncome
      spouseHolidays = data.spouse.desiredAnnualHolidays
    } else {
      clientMonthly = es.combinedDesiredMonthly / 2
      clientHolidays = es.combinedDesiredHolidays / 2
      spouseMonthly = es.combinedDesiredMonthly / 2
      spouseHolidays = es.combinedDesiredHolidays / 2
    }
  }

  const clientResult = calcRetirement(data.client, clientAge, data.inflationRate, data.postReturnRate, data.preReturnRate, data.passiveIncome, 'client', clientLiquid, clientMonthly, clientHolidays)
  const spouseResult = calcRetirement(data.spouse, spouseAge, data.inflationRate, data.postReturnRate, data.preReturnRate, data.passiveIncome, 'spouse', spouseLiquid, spouseMonthly, spouseHolidays)

  // Expectation comparison (only meaningful in direct mode when we also have expense data)
  const clientWishAnnual = data.client.desiredMonthlyIncome * 12 + data.client.desiredAnnualHolidays
  const spouseWishAnnual = data.spouse.desiredMonthlyIncome * 12 + data.spouse.desiredAnnualHolidays
  const combinedWishAnnual = es.combinedDesiredMonthly * 12 + es.combinedDesiredHolidays
  const showExpectationCheck = mode === 'direct' && combinedExpAnnual > 0

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
          How much will your client need to retire comfortably? Let's work out the corpus, identify the gap, and determine the monthly savings required.
        </p>
      </div>

      {/* ── ASSUMPTIONS ── */}
      <SubLabel color="var(--gold)">Global Assumptions</SubLabel>
      <div style={{ background: 'var(--gold-l)', border: '1px solid #e8d9be', borderRadius: 12, padding: '20px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 28 }}>
          <RateSlider label="Retirement Inflation Rate" value={data.inflationRate} onChange={v => upd({ inflationRate: v })} min={0} max={8} step={0.25} color="var(--gold)" />
          <RateSlider label="Post-Retirement Return Rate" value={data.postReturnRate} onChange={v => upd({ postReturnRate: v })} min={0} max={10} step={0.25} color="var(--emerald)" />
          <RateSlider label="Pre-Retirement Return Rate" value={data.preReturnRate} onChange={v => upd({ preReturnRate: v })} min={0} max={15} step={0.25} color="var(--ink3)" />
        </div>
        <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--gold-tag)', marginTop: 12 }}>
          Pre-retirement: used to grow existing investable assets to retirement date. Post-retirement: drawdown return on the corpus.
        </p>
      </div>

      {/* ── INCOME NEED INPUT ── */}
      <SubLabel color="var(--ink)">Retirement Income Need</SubLabel>
      <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>

        {/* Mode tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)' }}>
          {([
            { key: 'expense_based' as IncomeInputMode, label: '✦  Pick from Current Expenses', desc: "Select which current expenses the client wants to maintain in retirement" },
            { key: 'direct' as IncomeInputMode, label: '⟶  State a Desired Amount', desc: 'Client states a specific monthly income and holiday budget' },
          ]).map(opt => (
            <button key={opt.key} onClick={() => updExp({ mode: opt.key })}
              style={{ flex: 1, padding: '15px 20px', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                background: mode === opt.key ? 'var(--ink)' : 'white',
              }}>
              <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, marginBottom: 3, color: mode === opt.key ? 'var(--gold)' : 'var(--ink)' }}>{opt.label}</div>
              <div style={{ fontFamily: 'Inter', fontSize: 11, color: mode === opt.key ? 'rgba(255,255,255,0.45)' : 'var(--ink3)' }}>{opt.desc}</div>
            </button>
          ))}
        </div>

        <div style={{ padding: '22px 24px' }}>

          {/* Couple input mode selector */}
          {isCouple && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Input as</div>
              <PillSelect<CoupleIncomeMode>
                options={[
                  { value: 'combined', label: 'Combined as a Couple' },
                  { value: 'separate', label: 'Separate per Person' },
                ]}
                value={coupleMode}
                onChange={v => updExp({ coupleIncomeMode: v })}
              />
            </div>
          )}

          {/* ── EXPENSE-BASED ── */}
          {mode === 'expense_based' && (
            <ExpensePicker
              ff={factFinding} expenseMode={expenseMode}
              selectedKeys={es.selectedExpenseKeys}
              onChange={keys => updExp({ selectedExpenseKeys: keys })}
              showSpouse={isCouple && coupleMode === 'separate'}
              clientName={clientName} spouseName={spouseName}
              clientTotalSelected={clientExpAnnual} spouseTotalSelected={spouseExpAnnual}
            />
          )}

          {/* ── DIRECT INPUT ── */}
          {mode === 'direct' && (
            <>
              {(!isCouple || coupleMode === 'combined') ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>
                      {isCouple ? "Combined Monthly Income" : "Desired Monthly Income"} <span style={{ color: 'var(--ink3)', fontSize: 9 }}>(today's $)</span>
                    </div>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>SGD</span>
                      <input type="number" min={0} value={isCouple ? es.combinedDesiredMonthly || '' : data.client.desiredMonthlyIncome || ''}
                        onChange={e => isCouple ? updExp({ combinedDesiredMonthly: parseFloat(e.target.value) || 0 }) : updClient({ desiredMonthlyIncome: parseFloat(e.target.value) || 0 })}
                        placeholder="e.g. 6000" style={{ ...inp, paddingLeft: 48 }} />
                    </div>
                    <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>Today's dollars — will be inflated to retirement age.</p>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>
                      {isCouple ? "Combined Annual Holidays" : "Annual Holiday Budget"} <span style={{ color: 'var(--ink3)', fontSize: 9 }}>(today's $)</span>
                    </div>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>SGD</span>
                      <input type="number" min={0} value={isCouple ? es.combinedDesiredHolidays || '' : data.client.desiredAnnualHolidays || ''}
                        onChange={e => isCouple ? updExp({ combinedDesiredHolidays: parseFloat(e.target.value) || 0 }) : updClient({ desiredAnnualHolidays: parseFloat(e.target.value) || 0 })}
                        placeholder="e.g. 10000" style={{ ...inp, paddingLeft: 48 }} />
                    </div>
                  </div>
                </div>
              ) : (
                /* Separate per person */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[
                    { label: clientName, pd: data.client, updFn: updClient, col: 'var(--gold)' },
                    { label: spouseName, pd: data.spouse, updFn: updSpouse, col: '#6B5B8B' },
                  ].map(({ label, pd, updFn, col }) => (
                    <div key={label} style={{ background: 'var(--cream)', borderRadius: 10, padding: '16px', borderLeft: `3px solid ${col}` }}>
                      <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>{label}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 5 }}>Monthly Income (today's $)</div>
                          <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>SGD</span>
                            <input type="number" min={0} value={pd.desiredMonthlyIncome || ''}
                              onChange={e => updFn({ desiredMonthlyIncome: parseFloat(e.target.value) || 0 })}
                              placeholder="e.g. 3000" style={{ ...inp, paddingLeft: 48 }} />
                          </div>
                        </div>
                        <div>
                          <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 5 }}>Annual Holidays (today's $)</div>
                          <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>SGD</span>
                            <input type="number" min={0} value={pd.desiredAnnualHolidays || ''}
                              onChange={e => updFn({ desiredAnnualHolidays: parseFloat(e.target.value) || 0 })}
                              placeholder="e.g. 8000" style={{ ...inp, paddingLeft: 48 }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

        </div>
      </div>

      {/* ── EXPECTATION CHECK (direct mode only, when FF expense data exists) ── */}
      {showExpectationCheck && (
        <>
          <SubLabel color="var(--ink3)">Expectation Check</SubLabel>
          <p style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', marginBottom: 12, lineHeight: 1.6 }}>
            Comparing retirement wish against current spending from Financial Profile — helps anchor the conversation.
          </p>
          {(!isCouple || coupleMode === 'combined') && combinedWishAnnual > 0 && combinedExpAnnual > 0 && (
            <ExpectationComparison
              currentAnnual={combinedExpAnnual}
              wishAnnual={combinedWishAnnual}
              personName={isCouple ? `${clientName} & ${spouseName}` : clientName}
              color="var(--gold)"
            />
          )}
          {isCouple && coupleMode === 'separate' && (
            <>
              {clientWishAnnual > 0 && clientExpAnnual > 0 && <ExpectationComparison currentAnnual={clientExpAnnual} wishAnnual={clientWishAnnual} personName={clientName} color="var(--gold)" />}
              {spouseWishAnnual > 0 && spouseExpAnnual > 0 && <ExpectationComparison currentAnnual={spouseExpAnnual} wishAnnual={spouseWishAnnual} personName={spouseName} color="#6B5B8B" />}
            </>
          )}
        </>
      )}

      {/* ── RETIREMENT PARAMETERS (ages + CPF) ── */}
      <SubLabel color="var(--gold)">Retirement Parameters</SubLabel>
      <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 20 }}>
        <PersonPanel person={data.client} onChange={updClient} name={clientName} color="var(--gold)" currentAge={clientAge} cpfOA={clientCPF_OA} cpfSA={clientCPF_SA} cpfRA={clientCPF_RA} />
        {isCouple && <PersonPanel person={data.spouse} onChange={updSpouse} name={spouseName} color="#6B5B8B" currentAge={spouseAge} cpfOA={spouseCPF_OA} cpfSA={spouseCPF_SA} cpfRA={spouseCPF_RA} />}
      </div>

      {/* ── KPI RESULTS ── */}
      <SubLabel color="var(--gold)">Results — {clientName}</SubLabel>
      <KPIStrip result={clientResult} name={clientName} />

      {isCouple && (
        <>
          <SubLabel color="#6B5B8B">Results — {spouseName}</SubLabel>
          <KPIStrip result={spouseResult} name={spouseName} />
        </>
      )}

      {/* ── TIMELINE CHARTS ── */}
      <SubLabel>Retirement Timeline</SubLabel>
      <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr', gap: 16 }}>
        <RetirementChart result={clientResult} personName={clientName} currentAge={clientAge} color="var(--gold)" />
        {isCouple && <RetirementChart result={spouseResult} personName={spouseName} currentAge={spouseAge} color="#6B5B8B" />}
      </div>

      {/* ── PASSIVE INCOME ── */}
      <SubLabel color="var(--emerald)">Passive Income at Retirement</SubLabel>
      <PassiveIncomeSection items={data.passiveIncome} onChange={items => upd({ passiveIncome: items })} isCouple={isCouple} clientName={clientName} spouseName={spouseName} />

      {/* ── COMBINED SUMMARY (couple only) ── */}
      {isCouple && (
        <>
          <SubLabel color="var(--ink)">Combined Retirement Summary</SubLabel>
          <div style={{ background: 'var(--ink)', borderRadius: 16, padding: '28px 32px' }}>
            <p style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 20 }}>
              {clientName} & {spouseName} · {data.inflationRate}% inflation · {data.postReturnRate}% post-ret. return
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, marginBottom: 24 }}>
              {[
                { label: 'Total Corpus Needed', value: fmtSGD(clientResult.corpusNeeded + spouseResult.corpusNeeded), sub: 'At respective retirement ages', col: 'var(--gold)' },
                { label: 'Total Savings Gap', value: fmtSGD(clientResult.savingsGap + spouseResult.savingsGap), sub: 'Additional corpus required', col: (clientResult.savingsGap + spouseResult.savingsGap) > 0 ? '#f0a0a0' : '#86efac' },
                { label: 'Combined Monthly Savings', value: fmtSGD(clientResult.monthlySavingsRequired + spouseResult.monthlySavingsRequired), sub: 'To close the gap', col: 'white' },
              ].map((kpi, i) => (
                <div key={i} style={{ paddingRight: i < 2 ? 24 : 0, borderRight: i < 2 ? '1px solid rgba(255,255,255,0.1)' : 'none', paddingLeft: i > 0 ? 24 : 0 }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>{kpi.label}</div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: kpi.col, marginBottom: 4 }}>{kpi.value}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{kpi.sub}</div>
                </div>
              ))}
            </div>
            {/* Per-person row */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 20 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 12 }}>Per Person</div>
              {[
                { name: clientName, result: clientResult, col: 'var(--gold)' },
                { name: spouseName, result: spouseResult, col: '#C4A6E8' },
              ].map(({ name, result: r, col }) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'rgba(255,255,255,0.7)', minWidth: 100 }}>{name}</span>
                  <div style={{ display: 'flex', gap: 28 }}>
                    {[
                      { lbl: 'Corpus', val: fmtSGD(r.corpusNeeded), c: col },
                      { lbl: 'Gap', val: fmtSGD(r.savingsGap), c: r.savingsGap > 0 ? '#f0a0a0' : '#86efac' },
                      { lbl: 'Monthly Savings', val: `${fmtSGD(r.monthlySavingsRequired)}/mo`, c: 'rgba(255,255,255,0.7)' },
                    ].map(({ lbl, val, c }) => (
                      <div key={lbl} style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'Inter' }}>{lbl}</div>
                        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: c }}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── ADVISOR NOTES ── */}
      <SubLabel>Advisor Notes</SubLabel>
      <textarea rows={3} value={data.advisorNotes} onChange={e => upd({ advisorNotes: e.target.value })}
        placeholder="Document key assumptions, client preferences, or discussion points from this session…"
        style={{ width: '100%', background: 'white', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', resize: 'vertical', lineHeight: 1.6, outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  )
}
