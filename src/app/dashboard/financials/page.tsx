'use client'

import React, { useEffect, useState, useCallback, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface OtherIncomeItem { label: string; amount: number }
interface CustomAssetItem { label: string; amount: number; amount2?: number; notes?: string }
interface CustomExpenseItem { label: string; amount: number; amount2?: number; notes?: string }
interface MortgageProperty {
  id: string; label: string; owner?: string
  bank?: string; outstanding?: number
  interestRate?: number; loanType?: 'Fixed' | 'Floating' | 'Split'
  lockInYears?: number; lockInExpiry?: string
  monthlyRepayment?: number; tenure?: number; notes?: string
}

type PropertyType = 'HDB' | 'Private Condo' | 'Landed' | 'Commercial' | 'Industrial' | 'Overseas'
type OwnershipType = 'Client Only' | 'Spouse Only' | 'Joint Tenancy' | 'Tenancy-in-Common'

interface PropertyItem {
  id: string
  label: string
  propertyType?: PropertyType
  isPrimaryResidence?: boolean
  ownershipType?: OwnershipType
  ownershipSplit?: string  // e.g. "60/40"
  propertyValue?: number   // current market value; if blank, purchasePrice is used
  purchasePrice?: number   // fallback when propertyValue is not known
  // Mortgage — Original Loan (for amortization calc)
  initialLoanAmount?: number  // original loan amount
  initialTenure?: number      // original tenure in years
  // Mortgage — shared
  bank?: string
  interestRate?: number
  loanType?: 'Fixed' | 'Floating' | 'Split'
  loanStartDate?: string  // mm/yyyy
  lockInYears?: number  // years
  lockInExpiry?: string  // mm/yyyy  stored as YYYY-MM for date comparison
  // Mortgage — Current Position (overrides amortization if filled)
  outstanding?: number
  remainingTenure?: number  // years
  monthlyRepayment?: number  // auto-calculated via PMT
  notes?: string
}

interface PersonData {
  occupation?: string; employer?: string; employment_type?: string
  citizenship?: string; pr_year?: string
  gross_monthly?: number; gross_bonus?: number; other_incomes?: OtherIncomeItem[]
  risk_profile?: string; investment_experience?: string; investment_horizon?: string
  smoker?: boolean; pre_existing?: string
}

interface FactFinding {
  client_id: string; mode?: 'single' | 'couple'; person1?: PersonData; person2?: PersonData
  expense_mode?: 'simple' | 'detailed'
  s_financial?: number; s2_financial?: number
  s_cpf_oa?: number;   s2_cpf_oa?: number
  s_mortgage?: number; s2_mortgage?: number
  s_household?: number; s2_household?: number
  s_personal?: number; s2_personal?: number
  s_children?: number; s2_children?: number
  s_lifestyle?: number; s2_lifestyle?: number
  d_mortgage_cpf?: number; d_mortgage_cash?: number; d_vehicle_repay?: number
  d_personal_loan_repay?: number; d_rental_expense?: number; d_income_tax?: number
  d_insurance?: number; d_regular_savings?: number
  d_conservancy?: number; d_utilities?: number; d_family_food?: number
  d_maid?: number; d_other_household?: number
  d_personal_food?: number; d_transport?: number; d_car_petrol?: number; d_car_insurance?: number
  d_childcare?: number; d_school_fees?: number; d_school_transport?: number
  d_allowance_children?: number; d_other_children?: number
  d_holidays?: number; d_hobbies?: number; d_allowance_parents?: number; d_others_lifestyle?: number
  d2_mortgage_cpf?: number; d2_mortgage_cash?: number; d2_vehicle_repay?: number
  d2_personal_loan_repay?: number; d2_rental_expense?: number; d2_income_tax?: number
  d2_insurance?: number; d2_regular_savings?: number
  d2_conservancy?: number; d2_utilities?: number; d2_family_food?: number
  d2_maid?: number; d2_other_household?: number
  d2_personal_food?: number; d2_transport?: number; d2_car_petrol?: number; d2_car_insurance?: number
  d2_childcare?: number; d2_school_fees?: number; d2_school_transport?: number
  d2_allowance_children?: number; d2_other_children?: number
  d2_holidays?: number; d2_hobbies?: number; d2_allowance_parents?: number; d2_others_lifestyle?: number
  d_custom_financial?: CustomExpenseItem[]; d_custom_household?: CustomExpenseItem[]
  d_custom_personal?: CustomExpenseItem[]; d_custom_children?: CustomExpenseItem[]
  d_custom_lifestyle?: CustomExpenseItem[]
  a_savings?: number; a_fixed_deposit?: number
  a2_savings?: number; a2_fixed_deposit?: number
  a_cpf_oa?: number; a_cpf_sa?: number; a_cpf_ma?: number; a_cpf_ra?: number
  a2_cpf_oa?: number; a2_cpf_sa?: number; a2_cpf_ma?: number; a2_cpf_ra?: number
  a_srs?: number; a_shares?: number; a_etf?: number; a_unit_trust?: number
  a2_srs?: number; a2_shares?: number; a2_etf?: number; a2_unit_trust?: number
  a_bonds?: number; a_alternatives?: number
  a2_bonds?: number; a2_alternatives?: number
  a_inv_property_res?: number; a_inv_property_com?: number; a_business?: number
  a2_inv_property_res?: number; a2_inv_property_com?: number; a2_business?: number
  a_residential?: number; a_vehicles?: number; a_club?: number
  a2_residential?: number; a2_vehicles?: number; a2_club?: number
  a_cash_custom?: CustomAssetItem[]; a_invested_custom?: CustomAssetItem[]; a_personal_custom?: CustomAssetItem[]
  l_credit_card?: number; l_business_loan?: number; l_renovation_st?: number
  l2_credit_card?: number; l2_business_loan?: number; l2_renovation_st?: number
  l_mortgage_residing?: number; l_mortgage_investment?: number; l_car_loan?: number
  l2_mortgage_residing?: number; l2_mortgage_investment?: number; l2_car_loan?: number
  l_study_loan?: number; l_personal_loan?: number; l_renovation_lt?: number
  l2_study_loan?: number; l2_personal_loan?: number; l2_renovation_lt?: number
  l_lt_custom?: CustomAssetItem[]; l_st_custom?: CustomAssetItem[]
  mortgages?: MortgageProperty[]
  properties?: PropertyItem[]
  advisor_notes?: string
  retirement_age?: number
  retirement_age2?: number
}

interface Client { id: string; name: string; age?: number; citizenship?: string; dob?: string }
interface FamilyMember { id: string; name: string; relationship: string; age?: number }
interface CpfTier { max_age: number; employee: number; employer: number; oa: number; sa: number; ma: number }
interface CpfConfig { ow_ceiling: number; annual_ceiling: number; effective_date: string; sc_rates: CpfTier[] }

const DEFAULT_CPF_CONFIG: CpfConfig = {
  ow_ceiling: 8000, annual_ceiling: 102000, effective_date: '2026-01-01',
  sc_rates: [
    { max_age: 35,  employee: 20,   employer: 17,   oa: 23,   sa: 6,    ma: 8    },
    { max_age: 45,  employee: 20,   employer: 17,   oa: 21,   sa: 7,    ma: 9    },
    { max_age: 50,  employee: 20,   employer: 17,   oa: 19,   sa: 8,    ma: 10   },
    { max_age: 55,  employee: 20,   employer: 17,   oa: 15,   sa: 11.5, ma: 10.5 },
    { max_age: 60,  employee: 18,   employer: 16,   oa: 12,   sa: 3.5,  ma: 10.5 },
    { max_age: 65,  employee: 14.5, employer: 15.5, oa: 3.5,  sa: 0.5,  ma: 10.5 },
    { max_age: 70,  employee: 7.5,  employer: 9,    oa: 1,    sa: 0,    ma: 7.5  },
    { max_age: 999, employee: 5,    employer: 7.5,  oa: 1,    sa: 0,    ma: 6.5  },
  ],
}

const PR_YEAR1_RATES: CpfTier[] = [
  { max_age: 35,  employee: 5,   employer: 4,   oa: 3.5, sa: 1,   ma: 4.5 },
  { max_age: 45,  employee: 5,   employer: 4,   oa: 3.5, sa: 1,   ma: 4.5 },
  { max_age: 50,  employee: 5,   employer: 4,   oa: 3.5, sa: 1,   ma: 4.5 },
  { max_age: 55,  employee: 5,   employer: 4,   oa: 3.5, sa: 1,   ma: 4.5 },
  { max_age: 60,  employee: 5,   employer: 4,   oa: 2.5, sa: 0,   ma: 6.5 },
  { max_age: 65,  employee: 5,   employer: 4,   oa: 1,   sa: 0,   ma: 8   },
  { max_age: 70,  employee: 5,   employer: 4,   oa: 1,   sa: 0,   ma: 8   },
  { max_age: 999, employee: 5,   employer: 4,   oa: 1,   sa: 0,   ma: 8   },
]

const PR_YEAR2_RATES: CpfTier[] = [
  { max_age: 35,  employee: 15,  employer: 9,   oa: 12.5, sa: 3.5, ma: 8    },
  { max_age: 45,  employee: 15,  employer: 9,   oa: 11,   sa: 4,   ma: 9    },
  { max_age: 50,  employee: 15,  employer: 9,   oa: 9.5,  sa: 4.5, ma: 10   },
  { max_age: 55,  employee: 15,  employer: 9,   oa: 8.5,  sa: 6,   ma: 9.5  },
  { max_age: 60,  employee: 12,  employer: 7,   oa: 6.5,  sa: 2,   ma: 10.5 },
  { max_age: 65,  employee: 9.5, employer: 8.5, oa: 2,    sa: 0.5, ma: 9.5  },
  { max_age: 70,  employee: 5,   employer: 6.5, oa: 1,    sa: 0,   ma: 6.5  },
  { max_age: 999, employee: 5,   employer: 6,   oa: 1,    sa: 0,   ma: 6    },
]

function getCpfTier(age: number, citizenship: string, prYear: string, config: CpfConfig): CpfTier | null {
  if (!['SC','PR'].includes(citizenship)) return null
  let tiers = config.sc_rates
  if (citizenship === 'PR') {
    if (prYear === '1') tiers = PR_YEAR1_RATES
    else if (prYear === '2') tiers = PR_YEAR2_RATES
  }
  return tiers.find(t => age <= t.max_age) || tiers[tiers.length - 1]
}

function calcCpf(gross: number, bonus: number, age: number, citizenship: string, prYear: string, config: CpfConfig) {
  const tier = getCpfTier(age, citizenship, prYear, config)
  if (!tier) return { employee: 0, employer: 0, takeHome: gross, annualTakeHome: gross * 12 + bonus, owBase: 0, tier: null, oa: 0, sa: 0, ma: 0 }
  const owBase = Math.min(gross, config.ow_ceiling)
  const employee = Math.floor(owBase * tier.employee / 100)
  const employer = Math.round(owBase * tier.employer / 100)
  const total = employee + employer
  const oa = Math.round(owBase * tier.oa / 100)
  const sa = Math.round(owBase * tier.sa / 100)
  const ma = Math.max(total - oa - sa, 0)
  const takeHome = gross - employee
  const bonusCpfEmp = Math.floor(bonus * tier.employee / 100)
  const annualTakeHome = takeHome * 12 + (bonus - bonusCpfEmp)
  return { employee, employer, takeHome, annualTakeHome, owBase, tier, oa, sa, ma }
}

// Singapore benchmarks as % of gross income (DOS HES)
const BENCHMARKS_PCT: Record<string, number> = {
  financial: 18, cpf_oa: 12, mortgage: 10, household: 14, personal: 7, children: 5, lifestyle: 4,
}

const fmt = (n: number) => {
  if (n === undefined || n === null || isNaN(n) || !isFinite(n)) return 'S$0'
  return 'S$' + Math.round(n).toLocaleString()
}
const pct = (n: number, t: number) => t > 0 ? Math.round((n / t) * 100) : 0

// Mortgage PMT formula: monthly repayment given outstanding, annual rate %, tenure years
function calcPMT(outstanding: number, annualRate: number, tenureYears: number): number {
  if (!outstanding || !tenureYears) return 0
  if (!annualRate) return Math.round(outstanding / (tenureYears * 12))
  const r = annualRate / 100 / 12
  const n = tenureYears * 12
  return Math.round(outstanding * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1))
}

// Compute amortized outstanding balance as of today given original loan terms
function calcOutstandingBalance(initialLoan: number, annualRate: number, tenureYears: number, startMmYyyy: string): number {
  const startDate = parseMonthYear(startMmYyyy)
  if (!startDate || !initialLoan || !tenureYears) return 0
  const today = new Date()
  const monthsElapsed = (today.getFullYear() - startDate.getFullYear()) * 12 + (today.getMonth() - startDate.getMonth())
  if (monthsElapsed <= 0) return initialLoan
  const n = tenureYears * 12
  if (monthsElapsed >= n) return 0
  if (!annualRate) return Math.round(initialLoan * (1 - monthsElapsed / n))
  const r = annualRate / 100 / 12
  const pmt = initialLoan * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
  return Math.max(0, Math.round(initialLoan * Math.pow(1 + r, monthsElapsed) - pmt * (Math.pow(1 + r, monthsElapsed) - 1) / r))
}

// Compute remaining tenure in years from original tenure and start date
function calcRemainingTenureYears(tenureYears: number, startMmYyyy: string): number {
  const startDate = parseMonthYear(startMmYyyy)
  if (!startDate || !tenureYears) return 0
  const today = new Date()
  const monthsElapsed = (today.getFullYear() - startDate.getFullYear()) * 12 + (today.getMonth() - startDate.getMonth())
  return Math.max(0, Math.round((tenureYears * 12 - monthsElapsed) / 12 * 10) / 10)
}

// Parse mm/yyyy string to a Date (first day of that month)
function parseMonthYear(mmyyyy: string): Date | null {
  if (!mmyyyy) return null
  const parts = mmyyyy.split('/')
  if (parts.length !== 2) return null
  const mm = parseInt(parts[0], 10); const yyyy = parseInt(parts[1], 10)
  if (isNaN(mm) || isNaN(yyyy)) return null
  return new Date(yyyy, mm - 1, 1)
}

const EXP_CATEGORIES = [
  { id: 'financial', label: 'Financial Obligations',   color: '#E08080', hint: 'Income tax, insurance premiums, regular investments/savings', key: 's_financial' as const, key2: 's2_financial' as const },
  { id: 'cpf_oa',   label: 'Mortgage (CPF OA)',        color: '#5A8A6A', hint: 'Home loan repayment via CPF Ordinary Account',              key: 's_cpf_oa'   as const, key2: 's2_cpf_oa'   as const },
  { id: 'mortgage', label: 'Mortgage / Rent (Cash)',   color: '#C4A464', hint: 'Cash home loan repayment, rental payments',                 key: 's_mortgage' as const, key2: 's2_mortgage' as const },
  { id: 'household',label: 'Household & Living',       color: '#4A7C9E', hint: 'Conservancy fees, utilities, groceries, maid salary',       key: 's_household'as const, key2: 's2_household'as const },
  { id: 'personal', label: 'Personal Expenses',        color: '#7A6AAA', hint: 'Personal food & dining, transport, car expenses',           key: 's_personal' as const, key2: 's2_personal' as const },
  { id: 'children', label: 'Children Expenses',        color: 'var(--emerald)', hint: 'Childcare, school & tuition fees, transport, pocket money', key: 's_children' as const, key2: 's2_children' as const },
  { id: 'lifestyle',label: 'Lifestyle & Miscellaneous',color: '#9A7C5A', hint: 'Holidays, hobbies, allowance to parents, donations, shopping', key: 's_lifestyle'as const, key2: 's2_lifestyle'as const },
]

const SECTIONS = [
  { id: 'income',      label: 'Income',      icon: '◈' },
  { id: 'expenses',    label: 'Expenses',    icon: '◉' },
  { id: 'assets',      label: 'Assets',      icon: '◲' },
  { id: 'properties',  label: 'Properties',  icon: '◫' },
  { id: 'liabilities', label: 'Liabilities', icon: '◇' },
  { id: 'risk',        label: 'Risk Profile',icon: '◎' },
  { id: 'health',      label: 'Health',      icon: '⊞' },
  { id: 'notes',       label: 'Notes',       icon: '⊡' },
]

function Lbl({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>{children}</label>
}

function Field({ label, value, onChange, type = 'text', prefix, placeholder, hint }: {
  label: string; value: string | number | undefined; onChange: (v: string) => void
  type?: string; prefix?: string; placeholder?: string; hint?: string
}) {
  return (
    <div>
      <Lbl>{label}</Lbl>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'var(--ink3)' }}>{prefix}</span>}
        <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full px-3 py-2.5 text-sm outline-none"
          style={{ paddingLeft: prefix ? 28 : 12, border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
      </div>
      {hint && <div className="text-xs mt-1" style={{ color: 'var(--ink3)' }}>{hint}</div>}
    </div>
  )
}

function Sel({ label, value, onChange, options }: { label: string; value: string | undefined; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <Lbl>{label}</Lbl>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none"
        style={{ border: '1px solid var(--line)', background: 'white', color: value ? 'var(--ink)' : 'var(--ink3)' }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')}>
        <option value="">— Select —</option>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  )
}

function Card({ title, subtitle, children, right }: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ background: 'white', border: '1px solid var(--line)' }}>
      <div className="px-6 py-4 flex items-start justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="font-serif text-lg" style={{ color: 'var(--ink)' }}>{title}</div>
          {subtitle && <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>{subtitle}</div>}
        </div>
        {right}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

function LiabilityDonut({ items }: { items: { label: string; val: number; color: string }[] }) {
  const total = items.reduce((s, i) => s + i.val, 0)
  if (total === 0) return <div className="text-xs text-center py-4" style={{ color: 'var(--ink3)' }}>No liabilities entered</div>
  let cumPct = 0
  const segments = items.filter(i => i.val > 0).map(i => {
    const p = (i.val / total) * 100; const start = cumPct; cumPct += p
    return { ...i, pct: p, start }
  })
  const r = 40, cx = 50, cy = 50, stroke = 22, circ = 2 * Math.PI * r
  return (
    <div>
      <div className="flex justify-center mb-3">
        <svg viewBox="0 0 100 100" width={120} height={120}>
          {segments.map((s, i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${(s.pct / 100) * circ} ${circ}`}
              strokeDashoffset={-((s.start / 100) * circ)}
              style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }} />
          ))}
          <text x="50" y="54" textAnchor="middle" fontSize="9" fill="var(--ink3)">Total</text>
          <text x="50" y="45" textAnchor="middle" fontSize="7" fill="var(--ink2)">{fmt(total)}</text>
        </svg>
      </div>
      <div className="space-y-1">
        {segments.map(s => (
          <div key={s.label} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }}></div>
              <span style={{ color: 'var(--ink2)' }}>{s.label}</span>
            </div>
            <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmt(s.val)} <span style={{ color: 'var(--ink3)' }}>({Math.round(s.pct)}%)</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CpfCard({ p, age, config, label }: { p: PersonData; age: number; config: CpfConfig; label?: string }) {
  const cit = p.citizenship || 'SC'; const prY = p.pr_year || '3+'
  const gross = p.gross_monthly || 0; const bonus = p.gross_bonus || 0
  const cpf = calcCpf(gross, bonus, age, cit, prY, config)
  const isCpf = ['SC', 'PR'].includes(cit)
  const anEmployee = cpf.employee * 12 + (isCpf && cpf.tier ? Math.floor(bonus * cpf.tier.employee / 100) : 0)
  const anEmployer = cpf.employer * 12 + (isCpf && cpf.tier ? Math.round(bonus * cpf.tier.employer / 100) : 0)
  if (!isCpf) return (
    <div style={{ background: 'white', border: '1px solid var(--line)', padding: '16px 20px' }}>
      {label && <div className="text-xs font-medium mb-2" style={{ color: 'var(--gold-tag)' }}>{label}</div>}
      <div className="text-xs" style={{ color: 'var(--ink3)' }}>CPF not applicable for Foreigners</div>
    </div>
  )
  const prLabel = cit === 'PR' && prY !== '3+' ? ` · PR Yr ${prY}` : ''
  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>{label ? label + ' — ' : ''}CPF Breakdown</div>
        <div className="text-xs px-2 py-1" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)' }}>Age {age}{prLabel} · {cpf.tier?.employee}% / {cpf.tier?.employer}%</div>
      </div>
      {gross > config.ow_ceiling && (
        <div className="text-xs px-3 py-2 mb-3" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.2)' }}>OW capped at {fmt(config.ow_ceiling)}</div>
      )}
      <div className="flex pb-2 text-xs" style={{ borderBottom: '2px solid var(--line2)', color: 'var(--ink3)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>
        <div className="flex-1"></div><div className="w-24 text-right">Monthly</div><div className="w-28 text-right">Annual</div>
      </div>
      <div className="py-1.5 text-xs font-medium mt-1" style={{ color: 'var(--ink3)', borderBottom: '1px solid var(--line)' }}>Employee ({cpf.tier?.employee}%)</div>
      {[{ label: '→ Ordinary (OA)', mo: cpf.oa, color: 'var(--emerald)' }, { label: '→ Special (SA)', mo: cpf.sa, color: '#4A7C9E' }, { label: '→ MediSave (MA)', mo: cpf.ma, color: '#7A6AAA' }].map(r => (
        <div key={r.label} className="flex items-center py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex-1 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }}></div><span style={{ color: 'var(--ink2)' }}>{r.label}</span></div>
          <div className="w-24 text-right" style={{ color: r.color, fontWeight: 500 }}>{fmt(r.mo)}</div>
          <div className="w-28 text-right" style={{ color: r.color, fontWeight: 500 }}>{fmt(r.mo * 12)}</div>
        </div>
      ))}
      <div className="flex items-center py-1.5 text-xs font-medium" style={{ borderBottom: '1px solid var(--line2)' }}>
        <div className="flex-1" style={{ color: 'var(--ink)' }}>Total Employee (deducted)</div>
        <div className="w-24 text-right" style={{ color: 'var(--rouge)' }}>− {fmt(cpf.employee)}</div>
        <div className="w-28 text-right" style={{ color: 'var(--rouge)' }}>− {fmt(anEmployee)}</div>
      </div>
      <div className="py-1.5 text-xs font-medium mt-1" style={{ color: 'var(--ink3)', borderBottom: '1px solid var(--line)' }}>Employer ({cpf.tier?.employer}%) — added to CPF</div>
      <div className="flex items-center py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex-1" style={{ color: 'var(--ink2)' }}>Total Employer CPF</div>
        <div className="w-24 text-right" style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(cpf.employer)}</div>
        <div className="w-28 text-right" style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(anEmployer)}</div>
      </div>
      <div className="py-1.5 text-xs font-medium mt-1" style={{ color: 'var(--ink3)', borderBottom: '1px solid var(--line)' }}>Total credited to CPF (Emp + Employer/yr)</div>
      {[{ label: 'OA', mo: cpf.oa, color: 'var(--emerald)' }, { label: 'SA', mo: cpf.sa, color: '#4A7C9E' }, { label: 'MA', mo: cpf.ma, color: '#7A6AAA' }].map(r => (
        <div key={r.label} className="flex items-center py-1 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex-1 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }}></div><span style={{ color: 'var(--ink2)' }}>{r.label} (annual)</span></div>
          <div className="w-28 text-right" style={{ color: r.color, fontWeight: 600 }}>{fmt(r.mo * 12)}</div>
        </div>
      ))}
      <div className="flex items-center justify-between pt-3">
        <div className="text-xs" style={{ color: 'var(--ink3)' }}>Take-Home Pay</div>
        <div className="font-serif text-xl" style={{ color: 'var(--emerald)' }}>{fmt(cpf.takeHome)}/mo</div>
      </div>
      {bonus > 0 && cpf.tier && (
        <div className="mt-2 pt-2 text-xs" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink3)' }}>
          Bonus CPF: Employee {fmt(Math.floor(bonus * cpf.tier.employee / 100))} · Employer {fmt(Math.round(bonus * cpf.tier.employer / 100))}
        </div>
      )}
    </div>
  )
}

function SumRow({ label, mo, an, highlight, neg, dim }: { label: string; mo: number; an: number; highlight?: boolean; neg?: boolean; dim?: boolean }) {
  const c = highlight ? 'var(--gold)' : neg ? 'var(--rouge)' : 'var(--ink)'
  return (
    <div className="flex items-center py-2 text-xs" style={{ borderBottom: '1px solid var(--line)', opacity: dim ? 0.4 : 1 }}>
      <div className="flex-1" style={{ color: 'var(--ink2)', fontWeight: highlight ? 600 : 400 }}>{label}</div>
      <div className="w-28 text-right" style={{ color: c, fontWeight: highlight ? 700 : 500 }}>{neg ? `− ${fmt(mo)}` : fmt(mo)}</div>
      <div className="w-32 text-right" style={{ color: c, fontWeight: highlight ? 700 : 500 }}>{neg ? `− ${fmt(an)}` : fmt(an)}</div>
    </div>
  )
}

function CustomRows({ items, onChange, placeholder, isCouple }: { items: CustomAssetItem[]; onChange: (items: CustomAssetItem[]) => void; placeholder?: string; isCouple?: boolean }) {
  const n = (v: string) => v === '' ? 0 : parseFloat(v) || 0
  return (
    <div>
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 py-1.5 items-center" style={{ borderBottom: '1px solid var(--line)' }}>
          <input type="text" value={item.label} placeholder={placeholder || 'Custom item'}
            onChange={e => { const u = [...items]; u[i] = { ...u[i], label: e.target.value }; onChange(u) }}
            className="flex-1 px-2 py-1.5 text-xs outline-none"
            style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
          <div className="relative" style={{ width: 120 }}>
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
            <input type="number" value={item.amount || ''} placeholder="0"
              onChange={e => { const u = [...items]; u[i] = { ...u[i], amount: n(e.target.value) }; onChange(u) }}
              className="w-full text-xs outline-none py-1.5 text-right pr-2"
              style={{ paddingLeft: 18, border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
          </div>
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="w-7 h-7 flex items-center justify-center text-sm flex-shrink-0"
            style={{ color: 'var(--ink3)', border: '1px solid var(--line)', background: 'white' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--rouge)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink3)')}>×</button>
        </div>
      ))}
      <button onClick={() => onChange([...items, { label: '', amount: 0 }])} className="mt-2 text-xs px-3 py-1.5"
        style={{ color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.3)', background: 'var(--gold-l)' }}>+ Add Row</button>
    </div>
  )
}


function MortgageBlock({ mortgages, onChange, isCouple, clientName, spouseName }: {
  mortgages: MortgageProperty[]; onChange: (m: MortgageProperty[]) => void
  isCouple?: boolean; clientName?: string; spouseName?: string
}) {
  const today = new Date()
  const sixMonths = new Date(today); sixMonths.setMonth(sixMonths.getMonth() + 6)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const upd = (id: string, key: keyof MortgageProperty, val: unknown) =>
    onChange(mortgages.map(m => m.id === id ? { ...m, [key]: val } : m))
  const remove = (id: string) => onChange(mortgages.filter(m => m.id !== id))
  const addMortgage = () => {
    const id = Math.random().toString(36).slice(2)
    onChange([...mortgages, { id, label: 'Property ' + (mortgages.length + 1) }])
    setExpanded(e => ({ ...e, [id]: true }))
  }
  return (
    <div style={{ background: 'white', border: '1px solid var(--line)' }}>
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)', borderLeft: '3px solid #4A7C9E' }}>
        <div><span className="text-sm font-medium" style={{ color: '#4A7C9E' }}>MORTGAGE DETAIL</span><span className="text-xs ml-2" style={{ color: 'var(--ink3)' }}>Refinancing tracker</span></div>
        <button onClick={addMortgage} className="text-xs px-3 py-1.5" style={{ color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.3)', background: 'var(--gold-l)' }}>+ Add Property</button>
      </div>
      {mortgages.length === 0 && <div className="px-5 py-6 text-xs text-center" style={{ color: 'var(--ink3)' }}>No mortgages added. Click &quot;+ Add Property&quot; to track mortgage details.</div>}
      {mortgages.map(m => {
        const expiry = m.lockInExpiry ? new Date(m.lockInExpiry) : null
        const isExpiringSoon = expiry ? expiry <= sixMonths && expiry >= today : false
        const isExpired = expiry ? expiry < today : false
        const isOpen = expanded[m.id] ?? false
        return (
          <div key={m.id} style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="px-5 py-3 flex items-center gap-3 cursor-pointer" style={{ background: isExpiringSoon || isExpired ? 'rgba(138,40,40,0.04)' : 'transparent' }} onClick={() => setExpanded(e => ({ ...e, [m.id]: !isOpen }))}>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>{m.label || 'Unnamed Property'}</span>
                  {m.bank && <span className="text-xs" style={{ color: 'var(--ink3)' }}>· {m.bank}</span>}
                  {isExpired && <span className="text-xs px-1.5 py-0.5" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)', fontWeight: 600 }}>LOCK-IN EXPIRED</span>}
                  {isExpiringSoon && !isExpired && <span className="text-xs px-1.5 py-0.5" style={{ background: 'rgba(196,164,100,0.15)', color: '#8A6C3A', fontWeight: 600 }}>⚠ EXPIRING SOON</span>}
                </div>
                {m.outstanding ? <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>Outstanding: {fmt(m.outstanding)}{m.interestRate ? ' · ' + m.interestRate + '% ' + (m.loanType||'') : ''}</div> : null}
              </div>
              <span className="text-xs" style={{ color: 'var(--ink3)' }}>{isOpen ? '▲' : '▼'}</span>
              <button onClick={e => { e.stopPropagation(); remove(m.id) }} className="w-6 h-6 flex items-center justify-center text-sm" style={{ color: 'var(--ink3)', border: '1px solid var(--line)', background: 'white' }} onMouseEnter={e => (e.currentTarget.style.color='var(--rouge)')} onMouseLeave={e => (e.currentTarget.style.color='var(--ink3)')}>×</button>
            </div>
            {isOpen && (
              <div className="px-5 py-4 space-y-3" style={{ background: 'var(--cream)', borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div><div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Property Label</div><input value={m.label||''} onChange={e=>upd(m.id,'label',e.target.value)} placeholder="e.g. HDB Residing" className="w-full text-xs px-2 py-1.5 outline-none" style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }} onFocus={e=>(e.currentTarget.style.borderColor='var(--gold)')} onBlur={e=>(e.currentTarget.style.borderColor='var(--line)')} /></div>
                  {isCouple && <div><div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Owner</div><select value={m.owner||'Joint'} onChange={e=>upd(m.id,'owner',e.target.value)} className="w-full text-xs px-2 py-1.5 outline-none" style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}><option>Joint</option><option>{clientName}</option><option>{spouseName}</option></select></div>}
                  <div><div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Bank / Lender</div><input value={m.bank||''} onChange={e=>upd(m.id,'bank',e.target.value)} placeholder="e.g. DBS, OCBC, UOB" className="w-full text-xs px-2 py-1.5 outline-none" style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }} onFocus={e=>(e.currentTarget.style.borderColor='var(--gold)')} onBlur={e=>(e.currentTarget.style.borderColor='var(--line)')} /></div>
                  <div><div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Loan Type</div><select value={m.loanType||''} onChange={e=>upd(m.id,'loanType',e.target.value as MortgageProperty['loanType'])} className="w-full text-xs px-2 py-1.5 outline-none" style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}><option value="">Select...</option><option>Fixed</option><option>Floating</option><option>Split</option></select></div>
                  <div><div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Outstanding Loan ($)</div><input type="number" value={m.outstanding||''} onChange={e=>upd(m.id,'outstanding',parseFloat(e.target.value)||0)} placeholder="0" className="w-full text-xs px-2 py-1.5 outline-none text-right" style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }} onFocus={e=>(e.currentTarget.style.borderColor='var(--gold)')} onBlur={e=>(e.currentTarget.style.borderColor='var(--line)')} /></div>
                  <div><div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Monthly Repayment ($)</div><input type="number" value={m.monthlyRepayment||''} onChange={e=>upd(m.id,'monthlyRepayment',parseFloat(e.target.value)||0)} placeholder="0" className="w-full text-xs px-2 py-1.5 outline-none text-right" style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }} onFocus={e=>(e.currentTarget.style.borderColor='var(--gold)')} onBlur={e=>(e.currentTarget.style.borderColor='var(--line)')} /></div>
                  <div><div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Interest Rate (%)</div><input type="number" step="0.01" value={m.interestRate||''} onChange={e=>upd(m.id,'interestRate',parseFloat(e.target.value)||0)} placeholder="0.00" className="w-full text-xs px-2 py-1.5 outline-none text-right" style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }} onFocus={e=>(e.currentTarget.style.borderColor='var(--gold)')} onBlur={e=>(e.currentTarget.style.borderColor='var(--line)')} /></div>
                  <div><div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Remaining Tenure (yrs)</div><input type="number" value={m.tenure||''} onChange={e=>upd(m.id,'tenure',parseFloat(e.target.value)||0)} placeholder="0" className="w-full text-xs px-2 py-1.5 outline-none text-right" style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }} onFocus={e=>(e.currentTarget.style.borderColor='var(--gold)')} onBlur={e=>(e.currentTarget.style.borderColor='var(--line)')} /></div>
                  <div><div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Lock-in Period (yrs)</div><input type="number" value={m.lockInYears||''} onChange={e=>upd(m.id,'lockInYears',parseFloat(e.target.value)||0)} placeholder="0" className="w-full text-xs px-2 py-1.5 outline-none text-right" style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }} onFocus={e=>(e.currentTarget.style.borderColor='var(--gold)')} onBlur={e=>(e.currentTarget.style.borderColor='var(--line)')} /></div>
                  <div><div className="text-xs mb-1" style={{ color: isExpiringSoon||isExpired?'var(--rouge)':'var(--ink3)' }}>Lock-in Expiry {(isExpiringSoon||isExpired)?'⚠':''}</div><input type="date" value={m.lockInExpiry||''} onChange={e=>upd(m.id,'lockInExpiry',e.target.value)} className="w-full text-xs px-2 py-1.5 outline-none" style={{ border: `1px solid ${isExpiringSoon||isExpired?'var(--rouge)':'var(--line)'}`, background: 'white', color: 'var(--ink)' }} /></div>
                </div>
                <div><div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Advisor Notes</div><textarea value={m.notes||''} onChange={e=>upd(m.id,'notes',e.target.value)} placeholder="Refinancing strategy, bank offers, client preferences..." rows={2} className="w-full text-xs px-2 py-1.5 outline-none resize-none" style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }} onFocus={e=>(e.currentTarget.style.borderColor='var(--gold)')} onBlur={e=>(e.currentTarget.style.borderColor='var(--line)')} /></div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PropertyPortfolioBlock({
  properties, onChange, isCouple, clientName, spouseName, clientAge, spouseAge
}: {
  properties: PropertyItem[]
  onChange: (p: PropertyItem[]) => void
  isCouple?: boolean
  clientName?: string
  spouseName?: string
  clientAge?: number
  spouseAge?: number
}) {
  const today = new Date()
  const sixMonths = new Date(today); sixMonths.setMonth(sixMonths.getMonth() + 6)
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})

  const upd = (id: string, key: keyof PropertyItem, val: unknown) =>
    onChange(properties.map(p => p.id === id ? { ...p, [key]: val } : p))

  const remove = (id: string) => onChange(properties.filter(p => p.id !== id))

  const addProperty = () => {
    const id = Math.random().toString(36).slice(2)
    onChange([...properties, { id, label: 'Property ' + (properties.length + 1) }])
    setExpanded(e => ({ ...e, [id]: true }))
  }

  return (
    <div style={{ background: 'white', border: '1px solid var(--line)' }}>
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)', borderLeft: '3px solid var(--gold)' }}>
        <div>
          <span className="text-sm font-medium" style={{ color: 'var(--gold-tag)' }}>PROPERTY PORTFOLIO</span>
          <span className="text-xs ml-2" style={{ color: 'var(--ink3)' }}>Ownership & mortgage tracker</span>
        </div>
        <button onClick={addProperty} className="text-xs px-3 py-1.5" style={{ color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.3)', background: 'var(--gold-l)' }}>+ Add Property</button>
      </div>
      {properties.length === 0 && (
        <div className="px-5 py-8 text-xs text-center" style={{ color: 'var(--ink3)' }}>
          No properties added. Click &quot;+ Add Property&quot; to begin.
        </div>
      )}
      {properties.map(prop => {
        const expiryDate = parseMonthYear(prop.lockInExpiry || '')
        const isExpired = expiryDate ? expiryDate < today : false
        const isExpiringSoon = expiryDate ? expiryDate <= sixMonths && expiryDate >= today : false
        const isOpen = expanded[prop.id] ?? false
        const effectivePropertyValue = prop.propertyValue || prop.purchasePrice || 0
        const amortizedBalance = (!prop.outstanding && prop.initialLoanAmount && prop.initialTenure && prop.loanStartDate)
          ? calcOutstandingBalance(prop.initialLoanAmount, prop.interestRate || 0, prop.initialTenure, prop.loanStartDate)
          : null
        const effectiveOutstanding = prop.outstanding || amortizedBalance || 0
        const amortizedRemainingTenure = (!prop.remainingTenure && prop.initialTenure && prop.loanStartDate)
          ? calcRemainingTenureYears(prop.initialTenure, prop.loanStartDate)
          : null
        const effectiveRemainingTenure = prop.remainingTenure || amortizedRemainingTenure || 0
        const pmtCalc = (effectiveOutstanding && effectiveRemainingTenure)
          ? calcPMT(effectiveOutstanding, prop.interestRate || 0, effectiveRemainingTenure)
          : null
        const loanEndYear = prop.loanStartDate && prop.initialTenure
          ? parseInt(prop.loanStartDate.split('/')[1]) + prop.initialTenure
          : effectiveRemainingTenure ? new Date().getFullYear() + Math.ceil(effectiveRemainingTenure) : null
        const mortgageEndAge = clientAge && effectiveRemainingTenure ? Math.round(clientAge + effectiveRemainingTenure) : null
        const mortgageEndAge2 = spouseAge && effectiveRemainingTenure ? Math.round(spouseAge + effectiveRemainingTenure) : null
        const origPmt = (prop.initialLoanAmount && prop.initialTenure && prop.interestRate)
          ? calcPMT(prop.initialLoanAmount, prop.interestRate, prop.initialTenure)
          : null

        return (
          <div key={prop.id} style={{ borderBottom: '1px solid var(--line)' }}>
            {/* Card header */}
            <div
              className="px-5 py-3 flex items-center gap-3 cursor-pointer"
              style={{ background: prop.isPrimaryResidence ? 'rgba(168,131,74,0.04)' : isExpired || isExpiringSoon ? 'rgba(138,40,40,0.04)' : 'transparent' }}
              onClick={() => setExpanded(e => ({ ...e, [prop.id]: !isOpen }))}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>{prop.label || 'Unnamed Property'}</span>
                  {prop.propertyType && (
                    <span className="text-xs px-1.5 py-0.5" style={{ background: 'var(--cream2)', color: 'var(--ink2)', border: '1px solid var(--line)' }}>{prop.propertyType}</span>
                  )}
                  {prop.isPrimaryResidence && (
                    <span className="text-xs px-1.5 py-0.5 font-medium" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.3)' }}>PRIMARY RESIDENCE</span>
                  )}
                  {isExpired && <span className="text-xs px-1.5 py-0.5 font-semibold" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>LOCK-IN EXPIRED</span>}
                  {isExpiringSoon && !isExpired && <span className="text-xs px-1.5 py-0.5 font-semibold" style={{ background: 'rgba(196,164,100,0.15)', color: '#8A6C3A' }}>⚠ EXPIRING SOON</span>}
                </div>
                <div className="flex gap-4 mt-0.5">
                  {effectivePropertyValue ? <span className="text-xs" style={{ color: 'var(--ink3)' }}>Value: {fmt(effectivePropertyValue)}</span> : null}
                  {effectiveOutstanding ? <span className="text-xs" style={{ color: 'var(--ink3)' }}>Loan: {fmt(effectiveOutstanding)}{amortizedBalance ? ' (est.)' : ''}{prop.interestRate ? ' · ' + prop.interestRate + '% ' + (prop.loanType || '') : ''}</span> : null}
                  {loanEndYear ? <span className="text-xs" style={{ color: 'var(--ink3)' }}>Ends {loanEndYear}{mortgageEndAge ? ` · Age ${mortgageEndAge}${mortgageEndAge2 ? `/${mortgageEndAge2}` : ''}` : ''}</span> : null}
                  {prop.ownershipType && <span className="text-xs" style={{ color: 'var(--ink3)' }}>{prop.ownershipType}{prop.ownershipType === 'Tenancy-in-Common' && prop.ownershipSplit ? ' ' + prop.ownershipSplit : ''}</span>}
                </div>
              </div>
              <span className="text-xs" style={{ color: 'var(--ink3)' }}>{isOpen ? '▲' : '▼'}</span>
              <button onClick={e => { e.stopPropagation(); remove(prop.id) }}
                className="w-6 h-6 flex items-center justify-center text-sm"
                style={{ color: 'var(--ink3)', border: '1px solid var(--line)', background: 'white' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--rouge)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink3)')}>×</button>
            </div>

            {isOpen && (
              <div className="px-5 py-5 space-y-5" style={{ background: 'var(--cream)', borderTop: '1px solid var(--line)' }}>
                {/* Row 1: Identity */}
                <div>
                  <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--gold-tag)' }}>Property Details</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Property Label</div>
                      <input value={prop.label || ''} onChange={e => upd(prop.id, 'label', e.target.value)}
                        placeholder="e.g. Bishan HDB" className="w-full text-xs px-2 py-1.5 outline-none"
                        style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                    </div>
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Property Type</div>
                      <select value={prop.propertyType || ''} onChange={e => upd(prop.id, 'propertyType', e.target.value)}
                        className="w-full text-xs px-2 py-1.5 outline-none"
                        style={{ border: '1px solid var(--line)', background: 'white', color: prop.propertyType ? 'var(--ink)' : 'var(--ink3)' }}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')}>
                        <option value="">Select type…</option>
                        {(['HDB','Private Condo','Landed','Commercial','Industrial','Overseas'] as PropertyType[]).map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Current Market Value (S$)</div>
                      <input type="number" value={prop.propertyValue || ''} onChange={e => upd(prop.id, 'propertyValue', parseFloat(e.target.value) || 0)}
                        placeholder="0" className="w-full text-xs px-2 py-1.5 outline-none text-right"
                        style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                    </div>
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Purchase Price (S$) <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>· fallback if no current value</span></div>
                      <input type="number" value={prop.purchasePrice || ''} onChange={e => upd(prop.id, 'purchasePrice', parseFloat(e.target.value) || 0)}
                        placeholder="0" className="w-full text-xs px-2 py-1.5 outline-none text-right"
                        style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                    </div>
                  </div>
                </div>

                {/* Primary Residence Toggle */}
                <div className="flex items-center justify-between px-4 py-3" style={{ background: prop.isPrimaryResidence ? 'var(--gold-l)' : 'white', border: `1px solid ${prop.isPrimaryResidence ? 'rgba(168,131,74,0.4)' : 'var(--line)'}` }}>
                  <div>
                    <div className="text-xs font-medium" style={{ color: prop.isPrimaryResidence ? 'var(--gold-tag)' : 'var(--ink2)' }}>Primary Residence</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>Excluded from investable wealth & retirement calculations</div>
                  </div>
                  <button
                    onClick={() => upd(prop.id, 'isPrimaryResidence', !prop.isPrimaryResidence)}
                    className="relative flex-shrink-0"
                    style={{ width: 40, height: 22, borderRadius: 11, background: prop.isPrimaryResidence ? 'var(--gold)' : 'var(--line2)', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }}>
                    <div style={{ position: 'absolute', top: 3, left: prop.isPrimaryResidence ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
                  </button>
                </div>

                {/* Ownership */}
                <div>
                  <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Ownership</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Ownership Type</div>
                      <select value={prop.ownershipType || ''} onChange={e => upd(prop.id, 'ownershipType', e.target.value)}
                        className="w-full text-xs px-2 py-1.5 outline-none"
                        style={{ border: '1px solid var(--line)', background: 'white', color: prop.ownershipType ? 'var(--ink)' : 'var(--ink3)' }}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')}>
                        <option value="">Select…</option>
                        {(['Client Only','Spouse Only','Joint Tenancy','Tenancy-in-Common'] as OwnershipType[]).map(o => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </div>
                    {prop.ownershipType === 'Tenancy-in-Common' && (
                      <div>
                        <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Ownership Split (e.g. 60/40)</div>
                        <input value={prop.ownershipSplit || ''} onChange={e => upd(prop.id, 'ownershipSplit', e.target.value)}
                          placeholder="60/40" className="w-full text-xs px-2 py-1.5 outline-none"
                          style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Mortgage */}
                <div>
                  <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Mortgage Details</div>
                  {/* Shared: Bank/Lender and Loan Type */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Bank / Lender</div>
                      <input value={prop.bank || ''} onChange={e => upd(prop.id, 'bank', e.target.value)}
                        placeholder="e.g. DBS, OCBC, UOB" className="w-full text-xs px-2 py-1.5 outline-none"
                        style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                    </div>
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Loan Type</div>
                      <select value={prop.loanType || ''} onChange={e => upd(prop.id, 'loanType', e.target.value as PropertyItem['loanType'])}
                        className="w-full text-xs px-2 py-1.5 outline-none"
                        style={{ border: '1px solid var(--line)', background: 'white', color: prop.loanType ? 'var(--ink)' : 'var(--ink3)' }}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')}>
                        <option value="">Select…</option>
                        <option>Fixed</option><option>Floating</option><option>Split</option>
                      </select>
                    </div>
                  </div>
                  {/* Original Loan */}
                  <div className="px-4 py-3 mb-3" style={{ background: 'rgba(74,124,158,0.04)', border: '1px solid rgba(74,124,158,0.18)' }}>
                    <div className="text-xs mb-3" style={{ color: '#4A7C9E', fontWeight: 500 }}>Original Loan <span style={{ fontWeight: 400, color: 'var(--ink3)' }}>· fill if client doesn&apos;t know current balance</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                      <div>
                        <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Initial Loan Amount (S$)</div>
                        <input type="number" value={prop.initialLoanAmount || ''} onChange={e => upd(prop.id, 'initialLoanAmount', parseFloat(e.target.value) || 0)}
                          placeholder="0" className="w-full text-xs px-2 py-1.5 outline-none text-right"
                          style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                      </div>
                      <div>
                        <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Initial Tenure (yrs)</div>
                        <input type="number" value={prop.initialTenure || ''} onChange={e => upd(prop.id, 'initialTenure', parseFloat(e.target.value) || 0)}
                          placeholder="0" className="w-full text-xs px-2 py-1.5 outline-none text-right"
                          style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                      </div>
                      <div>
                        <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Start Date (mm/yyyy)</div>
                        <input value={prop.loanStartDate || ''} onChange={e => upd(prop.id, 'loanStartDate', e.target.value)}
                          placeholder="01/2011" className="w-full text-xs px-2 py-1.5 outline-none"
                          style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                      </div>
                      <div>
                        <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Interest Rate (%)</div>
                        <input type="number" step="0.01" value={prop.interestRate || ''} onChange={e => upd(prop.id, 'interestRate', parseFloat(e.target.value) || 0)}
                          placeholder="0.00" className="w-full text-xs px-2 py-1.5 outline-none text-right"
                          style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                      </div>
                    </div>
                    {origPmt !== null && (
                      <div className="mt-3 px-3 py-2 text-xs flex items-center justify-between" style={{ background: 'rgba(74,124,158,0.08)', borderLeft: '2px solid #4A7C9E' }}>
                        <span style={{ color: 'var(--ink3)' }}>Original monthly repayment</span>
                        <strong style={{ color: '#4A7C9E' }}>{fmt(origPmt)}/mo</strong>
                      </div>
                    )}
                    {amortizedBalance !== null && (
                      <div className="mt-2 px-3 py-2 text-xs flex items-center justify-between" style={{ background: 'rgba(74,124,158,0.05)', borderLeft: '2px solid rgba(74,124,158,0.4)' }}>
                        <span style={{ color: 'var(--ink3)' }}>Estimated balance today · {amortizedRemainingTenure} yrs remaining</span>
                        <strong style={{ color: '#4A7C9E' }}>{fmt(amortizedBalance)}</strong>
                      </div>
                    )}
                  </div>
                  {/* Current Position — overrides amortization if filled */}
                  <div className="px-4 py-3" style={{ background: 'white', border: '1px solid var(--line)' }}>
                    <div className="text-xs mb-3" style={{ color: 'var(--ink2)', fontWeight: 500 }}>Current Position <span style={{ fontWeight: 400, color: 'var(--ink3)' }}>· overrides original loan if filled</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Outstanding Balance (S$)</div>
                        <input type="number" value={prop.outstanding || ''} onChange={e => upd(prop.id, 'outstanding', parseFloat(e.target.value) || 0)}
                          placeholder={amortizedBalance ? String(amortizedBalance) : '0'}
                          className="w-full text-xs px-2 py-1.5 outline-none text-right"
                          style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                      </div>
                      <div>
                        <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Remaining Tenure (yrs)</div>
                        <input type="number" value={prop.remainingTenure || ''} onChange={e => upd(prop.id, 'remainingTenure', parseFloat(e.target.value) || 0)}
                          placeholder={amortizedRemainingTenure ? String(amortizedRemainingTenure) : '0'}
                          className="w-full text-xs px-2 py-1.5 outline-none text-right"
                          style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                      </div>
                      <div>
                        <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Lock-in Period (yrs)</div>
                        <input type="number" value={prop.lockInYears || ''} onChange={e => upd(prop.id, 'lockInYears', parseFloat(e.target.value) || 0)}
                          placeholder="0" className="w-full text-xs px-2 py-1.5 outline-none text-right"
                          style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                      </div>
                      <div>
                        <div className="text-xs mb-1" style={{ color: isExpired ? 'var(--rouge)' : isExpiringSoon ? '#8A6C3A' : 'var(--ink3)' }}>
                          Lock-in Expiry (mm/yyyy) {isExpired ? '🔴' : isExpiringSoon ? '⚠' : ''}
                        </div>
                        <input value={prop.lockInExpiry || ''} onChange={e => upd(prop.id, 'lockInExpiry', e.target.value)}
                          placeholder="06/2026" className="w-full text-xs px-2 py-1.5 outline-none"
                          style={{ border: `1px solid ${isExpired ? 'var(--rouge)' : isExpiringSoon ? '#C4A464' : 'var(--line)'}`, background: 'white', color: 'var(--ink)' }}
                          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                          onBlur={e => (e.currentTarget.style.borderColor = isExpired ? 'var(--rouge)' : isExpiringSoon ? '#C4A464' : 'var(--line)')} />
                      </div>
                    </div>
                    {/* Monthly repayment — auto-calculated from effective values */}
                    <div>
                      <div className="text-xs mb-1 flex items-center gap-1.5" style={{ color: 'var(--ink3)' }}>
                        Monthly Repayment (S$)
                        {pmtCalc !== null && (
                          <span className="px-1 py-0.5 text-xs" style={{ background: 'var(--emerald-l)', color: 'var(--emerald)', fontSize: 9 }}>AUTO</span>
                        )}
                      </div>
                      <input type="number" value={prop.monthlyRepayment || pmtCalc || ''}
                        onChange={e => upd(prop.id, 'monthlyRepayment', parseFloat(e.target.value) || 0)}
                        placeholder={pmtCalc ? String(pmtCalc) : '0'}
                        className="w-full text-xs px-2 py-1.5 outline-none text-right"
                        style={{ border: '1px solid var(--line)', background: pmtCalc && !prop.monthlyRepayment ? 'var(--emerald-l)' : 'white', color: 'var(--ink)' }}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                      {pmtCalc !== null && (
                        <div className="text-xs mt-0.5" style={{ color: 'var(--emerald)' }}>
                          PMT calc: {fmt(pmtCalc)}/mo
                          {prop.monthlyRepayment && prop.monthlyRepayment !== pmtCalc
                            ? <button className="ml-2 underline" style={{ color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10 }} onClick={() => upd(prop.id, 'monthlyRepayment', 0)}>use calc</button>
                            : null}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Advisor Notes */}
                <div>
                  <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Advisor Notes</div>
                  <textarea value={prop.notes || ''} onChange={e => upd(prop.id, 'notes', e.target.value)}
                    placeholder="Refinancing plans, rental income, upcoming sale, client intentions…"
                    rows={2} className="w-full text-xs px-2 py-1.5 outline-none resize-none"
                    style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AssetRow({ label, value, value2, onChange, onChange2, isCouple }: {
  label: string; value: number | undefined; value2?: number | undefined
  onChange: (v: string) => void; onChange2?: (v: string) => void
  isCouple?: boolean
}) {
  const combined = (value || 0) + (value2 || 0)
  return (
    <div className="flex items-center py-2 text-xs gap-2" style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="flex-1" style={{ color: 'var(--ink2)' }}>{label}</div>
      <div className="relative" style={{ width: 118 }}>
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
        <input type="number" value={value || ''} onChange={e => onChange(e.target.value)} placeholder="0"
          className="w-full text-xs outline-none py-1.5 text-right pr-2"
          style={{ paddingLeft: 18, border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
      </div>
      {isCouple && (
        <div className="relative" style={{ width: 118 }}>
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
          <input type="number" value={value2 || ''} onChange={e => onChange2?.(e.target.value)} placeholder="0"
            className="w-full text-xs outline-none py-1.5 text-right pr-2"
            style={{ paddingLeft: 18, border: '1px solid var(--line)', background: 'var(--cream)', color: '#4A7C9E' }}
            onFocus={e => (e.currentTarget.style.borderColor = '#4A7C9E')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
        </div>
      )}
      {isCouple && (
        <div className="text-xs text-right font-medium" style={{ width: 90, color: combined > 0 ? 'var(--ink)' : 'var(--ink3)' }}>
          {combined > 0 ? fmt(combined) : '—'}
        </div>
      )}
    </div>
  )
}

function AssetBlock({ title, color, total, children, isCouple, clientName, spouseName }: {
  title: string; color: string; total: number; children: React.ReactNode
  isCouple?: boolean; clientName?: string; spouseName?: string
}) {
  return (
    <div style={{ background: 'white', border: '1px solid var(--line)' }}>
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)', borderLeft: `3px solid ${color}` }}>
        <span className="text-sm font-medium" style={{ color }}>{title}</span>
        <span className="text-xs" style={{ color: 'var(--ink3)' }}>Sub-total: <span style={{ color, fontWeight: 600 }}>{fmt(total)}</span></span>
      </div>
      <div className="px-5 py-2">
        {isCouple && (
          <div className="flex items-center gap-2 py-2 mb-1" style={{ borderBottom: '2px solid var(--line2)' }}>
            <div className="flex-1 text-xs" style={{ color: 'var(--ink3)' }}></div>
            <div className="text-xs font-medium text-center" style={{ width: 118, color: 'var(--gold-tag)' }}>{clientName}</div>
            <div className="text-xs font-medium text-center" style={{ width: 118, color: '#4A7C9E' }}>{spouseName}</div>
            <div className="text-xs font-medium text-center" style={{ width: 90, color: 'var(--ink2)' }}>Combined</div>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

function PersonIncomePanel({ p, onChange, age, config, label }: { p: PersonData; onChange: (key: keyof PersonData, val: unknown) => void; age: number; config: CpfConfig; label: string }) {
  const n = (v: string) => v === '' ? 0 : parseFloat(v) || 0
  const gross = p.gross_monthly || 0; const bonus = p.gross_bonus || 0
  const otherIncomes = p.other_incomes || []
  const totalOther = otherIncomes.reduce((s, i) => s + (i.amount || 0), 0)
  const cpf = calcCpf(gross, bonus, age, p.citizenship || 'SC', p.pr_year || '3+', config)
  const isCpf = ['SC', 'PR'].includes(p.citizenship || 'SC')
  const moEmployee = cpf.employee
  const moTakeHome = cpf.takeHome
  const moIncome = moTakeHome + totalOther
  const anEmployee = moEmployee * 12 + (isCpf && cpf.tier ? Math.floor(bonus * cpf.tier.employee / 100) : 0)
  const anTakeHome = cpf.annualTakeHome
  const anIncome = anTakeHome + (totalOther * 12)
  return (
    <div className="space-y-4">
      <div className="px-4 py-2 font-medium text-sm" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.2)' }}>{label}</div>
      <Card title="Employment">
        <div className="space-y-3">
          <Field label="Occupation" value={p.occupation} onChange={v => onChange('occupation', v)} placeholder="e.g. Engineer" />
          <Field label="Employer" value={p.employer} onChange={v => onChange('employer', v)} placeholder="e.g. DBS Bank" />
          <Sel label="Employment Type" value={p.employment_type} onChange={v => onChange('employment_type', v)} options={['Employed','Self-Employed','Business Owner','Commission-Based','Retired','Student','Homemaker']} />
          <Sel label="Citizenship" value={p.citizenship} onChange={v => onChange('citizenship', v)} options={['SC','PR','Foreigner']} />
         {p.citizenship === 'PR' && (
            <div>
              <Sel label="PR Status Year" value={p.pr_year} onChange={v => onChange('pr_year', v)} options={['1', '2', '3+']} />
              <div className="mt-1.5 px-3 py-2 text-xs" style={{ background: 'var(--gold-l)', border: '1px solid rgba(168,131,74,0.2)', color: 'var(--gold-tag)', lineHeight: 1.6 }}>
                {(!p.pr_year || p.pr_year === '1') && <span>Year 1 — Employee 5% / Employer 4% (reduced rates)</span>}
                {p.pr_year === '2' && <span>Year 2 — Employee 15% / Employer 9% (graduated rates)</span>}
                {p.pr_year === '3+' && <span>Year 3+ — Full SC rates: Employee 20% / Employer 17%</span>}
              </div>
            </div>
          )}
        </div>
      </Card>
      <Card title="Gross Salary" subtitle="Before CPF deductions">
        <div className="space-y-3">
          <Field label="Gross Monthly" value={p.gross_monthly} onChange={v => onChange('gross_monthly', n(v))} type="number" prefix="$" placeholder="0" />
          <Field label="Gross Annual Bonus" value={p.gross_bonus} onChange={v => onChange('gross_bonus', n(v))} type="number" prefix="$" placeholder="0" hint="Total bonus/yr (AWS + variable)" />
        </div>
      </Card>
      <Card title="Other Income" subtitle="Rental, dividends, commissions, etc.">
        <div className="space-y-2">
          {otherIncomes.map((item, i) => (
            <div key={i} className="flex gap-2">
              <input type="text" value={item.label} placeholder="Source (e.g. Rental)"
                onChange={e => { const u = [...otherIncomes]; u[i] = { ...u[i], label: e.target.value }; onChange('other_incomes', u) }}
                className="flex-1 px-3 py-2 text-sm outline-none"
                style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
              <div className="relative" style={{ width: 130 }}>
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
                <input type="number" value={item.amount || ''} placeholder="0/mo"
                  onChange={e => { const u = [...otherIncomes]; u[i] = { ...u[i], amount: n(e.target.value) }; onChange('other_incomes', u) }}
                  className="w-full px-3 py-2 text-sm outline-none"
                  style={{ paddingLeft: 22, border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
              </div>
              <button onClick={() => onChange('other_incomes', otherIncomes.filter((_, j) => j !== i))}
                className="w-9 h-9 flex items-center justify-center text-lg flex-shrink-0"
                style={{ color: 'var(--ink3)', border: '1px solid var(--line)', background: 'white' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--rouge)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink3)')}>×</button>
            </div>
          ))}
          <button onClick={() => onChange('other_incomes', [...otherIncomes, { label: '', amount: 0 }])}
            className="text-xs px-3 py-1.5" style={{ color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.3)', background: 'var(--gold-l)' }}>+ Add Source</button>
        </div>
      </Card>
      <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
        <div className="text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Summary</div>
        <div className="flex text-xs pb-2" style={{ borderBottom: '2px solid var(--line2)', color: 'var(--ink3)', fontSize: 9, textTransform: 'uppercase' }}>
          <div className="flex-1"></div><div className="w-28 text-right">Monthly</div><div className="w-32 text-right">Annual</div>
        </div>
        <SumRow label="Gross Salary" mo={gross} an={gross * 12 + bonus} />
        {isCpf && <SumRow label={`Employee CPF (${cpf.tier?.employee || 0}%)`} mo={moEmployee} an={anEmployee} neg />}
        <SumRow label={isCpf ? 'Take-Home Pay' : 'Salary'} mo={moTakeHome} an={anTakeHome} highlight />
        {totalOther > 0 && <SumRow label="Other Income" mo={totalOther} an={totalOther * 12} />}
        <div className="flex items-center justify-between pt-3 mt-1" style={{ borderTop: '2px solid var(--gold)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Total Spendable</span>
          <div className="flex gap-4">
            <span className="font-serif text-base" style={{ color: 'var(--gold)' }}>{fmt(moIncome)}/mo</span>
            <span className="font-serif text-base" style={{ color: 'var(--gold)' }}>{fmt(anIncome)}/yr</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function AnnInput({ value, onChange, accentColor }: { value: number | undefined; onChange: (v: string) => void; accentColor?: string }) {
  return (
    <div className="relative" style={{ width: '100%' }}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
      <input type="number" value={value || ''} placeholder="0" onChange={e => onChange(e.target.value)}
        className="w-full text-sm outline-none py-2 text-right pr-3"
        style={{ paddingLeft: 28, border: '1px solid var(--line)', background: 'var(--cream)', color: accentColor || 'var(--ink)' }}
        onFocus={e => { e.currentTarget.style.borderColor = accentColor || 'var(--gold)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--line)' }} />
    </div>
  )
}

function DetInput({ value, onChange, accentColor }: { value: number | undefined; onChange: (v: string) => void; accentColor?: string }) {
  return (
    <div className="relative" style={{ width: 118 }}>
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
      <input type="number" value={value || ''} placeholder="0" onChange={e => onChange(e.target.value)}
        className="w-full text-xs outline-none py-1.5 text-right pr-2"
        style={{ paddingLeft: 18, border: '1px solid var(--line)', background: 'var(--cream)', color: accentColor || 'var(--ink)' }}
        onFocus={e => { e.currentTarget.style.borderColor = accentColor || 'var(--gold)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--line)' }} />
    </div>
  )
}


export default function FactFindingPageWrapper() {
  return (
    <Suspense>
      <FactFindingPage />
    </Suspense>
  )
}

function FactFindingPage() {
  const [client, setClient] = useState<Client | null>(null)
  const [spouse, setSpouse] = useState<FamilyMember | null>(null)
  const [ff, setFf] = useState<FactFinding | null>(null)
  const [cpfConfig, setCpfConfig] = useState<CpfConfig>(DEFAULT_CPF_CONFIG)
  const [activeSection, setActiveSection] = useState('income')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab) setActiveSection(tab)
  }, [searchParams])

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    const { data: cfgRow } = await supabase.from('config').select('value').eq('key', 'cpf_rates').maybeSingle()
    if (cfgRow?.value) setCpfConfig(cfgRow.value as CpfConfig)
    const { data: clients } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
    if (!clients || clients.length === 0) { setLoading(false); return }
    const c = clients.find((x: any) => x.id === localStorage.getItem('selectedClientId')) || clients.find((x: any) => x.id === localStorage.getItem('selectedClientId')) || clients[0]; setClient(c)
    const { data: fam } = await supabase.from('family_members').select('*').eq('client_id', c.id)
    const sp = fam?.find((f: FamilyMember) => f.relationship === 'Spouse')
    if (sp) setSpouse(sp)
 // Only load the 'financials' section data
const { data: financialsRow } = await supabase
  .from('fact_finding')
  .select('data')
  .eq('client_id', c.id)
  .eq('section', 'financials')
  .maybeSingle()

if (financialsRow?.data) {
  setFf({ ...financialsRow.data, client_id: c.id })
} else {
  setFf({
    client_id: c.id, mode: 'single', expense_mode: 'simple',
    person1: { citizenship: 'SC', pr_year: '3+', other_incomes: [] },
    person2: { citizenship: 'SC', pr_year: '3+', other_incomes: [] },
    a_cash_custom: [], a_invested_custom: [], a_personal_custom: [],
    l_st_custom: [], l_lt_custom: [],
    d_custom_financial: [], d_custom_household: [], d_custom_personal: [], d_custom_children: [], d_custom_lifestyle: [],
  })
}
setLoading(false)
  }
const upd = useCallback((key: keyof FactFinding, val: unknown) => {
  setFf(prev => {
    if (!prev) return prev
    const next = { ...prev, [key]: val }
    scheduleSave()
    return next
  })
  setSaved(false)
}, [scheduleSave])

  const updP = useCallback((person: 'person1' | 'person2', key: keyof PersonData, val: unknown) => {
  setFf(prev => {
    if (!prev) return prev
    const next = { ...prev, [person]: { ...prev[person], [key]: val } }
    scheduleSave()
    return next
  })
  setSaved(false)
}, [scheduleSave])

  const n = (v: string): number => v === '' ? 0 : parseFloat(v) || 0

// Auto-save function (debounced)
const scheduleSave = useCallback(() => {
  if (!ff || !client) return
  
  if (saveTimer.current) clearTimeout(saveTimer.current)
  
  saveTimer.current = setTimeout(async () => {
    setSaving(true)
    
    const { client_id, ...data } = ff
    
    // Check if financials row exists
    const { data: existing } = await supabase
      .from('fact_finding')
      .select('id')
      .eq('client_id', client.id)
      .eq('section', 'financials')
      .maybeSingle()
    
    let error = null
    
    if (existing) {
      const { error: updateError } = await supabase
        .from('fact_finding')
        .update({ 
          data: data, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', existing.id)
      error = updateError
    } else {
      const { error: insertError } = await supabase
        .from('fact_finding')
        .insert({ 
          client_id: client.id, 
          section: 'financials', 
          data: data, 
          updated_at: new Date().toISOString() 
        })
      error = insertError
    }
    
    setSaving(false)
    
    if (error) {
      console.error('Save error:', error)
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }, 800)
}, [ff, client, supabase])

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-sm" style={{ color: 'var(--ink3)' }}>Loading…</div></div>
  if (!client) return <div className="flex flex-col items-center justify-center h-full gap-4"><div className="font-serif text-2xl" style={{ color: 'var(--ink)' }}>No Client Selected</div></div>
  if (!ff) return null

  const mode = ff.mode || 'single'; const isCouple = mode === 'couple'
  const p1 = ff.person1 || {}; const p2 = ff.person2 || {}
  const age1 = client.age || 35; const age2 = spouse?.age || 35
  const cpf1 = calcCpf(p1.gross_monthly || 0, p1.gross_bonus || 0, age1, p1.citizenship || 'SC', p1.pr_year || '3+', cpfConfig)
  const cpf2 = isCouple ? calcCpf(p2.gross_monthly || 0, p2.gross_bonus || 0, age2, p2.citizenship || 'SC', p2.pr_year || '3+', cpfConfig) : null
  const other1 = (p1.other_incomes || []).reduce((s, i) => s + (i.amount || 0), 0)
  const other2 = isCouple ? (p2.other_incomes || []).reduce((s, i) => s + (i.amount || 0), 0) : 0
  const mo1 = cpf1.takeHome + other1; const mo2 = cpf2 ? cpf2.takeHome + other2 : 0; const moTotal = mo1 + mo2
  const an1 = cpf1.annualTakeHome + other1 * 12; const an2 = cpf2 ? cpf2.annualTakeHome + other2 * 12 : 0; const anTotal = an1 + an2

  const expMode = ff.expense_mode || 'simple'

// Detailed mode subtotals per category
const detailedSum = (keys: string[], customKey: keyof FactFinding) => {
  const std = keys.reduce((s, k) => s + ((ff[k as keyof FactFinding] as number) || 0), 0)
  const custom = ((ff[customKey] as CustomExpenseItem[]) || []).reduce((s, i) => s + (i.amount || 0), 0)
  return std + custom
}
const detailedSum2 = (keys: string[], customKey: keyof FactFinding) => {
  if (!isCouple) return 0
  const std = keys.reduce((s, k) => s + ((ff[k as keyof FactFinding] as number) || 0), 0)
  const custom = ((ff[customKey] as CustomExpenseItem[]) || []).reduce((s, i) => s + (i.amount2 || 0), 0)
  return std + custom
}

const DETAILED_KEYS_BY_CAT: Record<string, { keys: string[], keys2: string[], customKey: keyof FactFinding }> = {
  financial: { keys: ['d_vehicle_repay','d_personal_loan_repay','d_rental_expense','d_income_tax','d_insurance','d_regular_savings'], keys2: ['d2_vehicle_repay','d2_personal_loan_repay','d2_rental_expense','d2_income_tax','d2_insurance','d2_regular_savings'], customKey: 'd_custom_financial' },
  cpf_oa:    { keys: ['d_mortgage_cpf'], keys2: ['d2_mortgage_cpf'], customKey: 'd_custom_financial' },
  mortgage:  { keys: ['d_mortgage_cash'], keys2: ['d2_mortgage_cash'], customKey: 'd_custom_financial' },
  household: { keys: ['d_conservancy','d_utilities','d_family_food','d_maid','d_other_household'], keys2: ['d2_conservancy','d2_utilities','d2_family_food','d2_maid','d2_other_household'], customKey: 'd_custom_household' },
  personal:  { keys: ['d_personal_food','d_transport','d_car_petrol','d_car_insurance'], keys2: ['d2_personal_food','d2_transport','d2_car_petrol','d2_car_insurance'], customKey: 'd_custom_personal' },
  children:  { keys: ['d_childcare','d_school_fees','d_school_transport','d_allowance_children','d_other_children'], keys2: ['d2_childcare','d2_school_fees','d2_school_transport','d2_allowance_children','d2_other_children'], customKey: 'd_custom_children' },
  lifestyle: { keys: ['d_holidays','d_hobbies','d_allowance_parents','d_others_lifestyle'], keys2: ['d2_holidays','d2_hobbies','d2_allowance_parents','d2_others_lifestyle'], customKey: 'd_custom_lifestyle' },
}

const getAnn1 = (cat: typeof EXP_CATEGORIES[0]) => {
  if (expMode === 'detailed' && DETAILED_KEYS_BY_CAT[cat.id]?.keys.length > 0) {
    return detailedSum(DETAILED_KEYS_BY_CAT[cat.id].keys, DETAILED_KEYS_BY_CAT[cat.id].customKey)
  }
  return (ff[cat.key] as number) || 0
}
const getAnn2 = (cat: typeof EXP_CATEGORIES[0]) => {
  if (!isCouple) return 0
  if (expMode === 'detailed' && DETAILED_KEYS_BY_CAT[cat.id]?.keys2.length > 0) {
    return detailedSum2(DETAILED_KEYS_BY_CAT[cat.id].keys2, DETAILED_KEYS_BY_CAT[cat.id].customKey)
  }
  return (ff[cat.key2] as number) || 0
}
const getAnnSum = (cat: typeof EXP_CATEGORIES[0]) => getAnn1(cat) + getAnn2(cat)
  const cpfOaCat = EXP_CATEGORIES.find(c => c.id === 'cpf_oa')!
  const annCpfOaTotal = getAnnSum(cpfOaCat)
  const nonCpfCats = EXP_CATEGORIES.filter(c => c.id !== 'cpf_oa')
  const annExpNoCpf = nonCpfCats.reduce((s, cat) => s + getAnnSum(cat), 0)
  const moExpNoCpf = annExpNoCpf / 12
  const annExpAll = EXP_CATEGORIES.reduce((s, cat) => s + getAnnSum(cat), 0)
  const annGross1 = (p1.gross_monthly || 0) * 12 + (p1.gross_bonus || 0)
  const annGross2 = isCouple ? (p2.gross_monthly || 0) * 12 + (p2.gross_bonus || 0) : 0
  const moGrossTotal = (annGross1 + annGross2) / 12

  const DETAILED_GROUPS = [
    { id: 'financial', title: 'Financial Obligations', color: '#E08080', hint: 'Income tax, insurance, regular savings/investments',
      keys: ['d_mortgage_cpf','d_mortgage_cash','d_vehicle_repay','d_personal_loan_repay','d_rental_expense','d_income_tax','d_insurance','d_regular_savings'],
      keys2: ['d2_mortgage_cpf','d2_mortgage_cash','d2_vehicle_repay','d2_personal_loan_repay','d2_rental_expense','d2_income_tax','d2_insurance','d2_regular_savings'],
      labels: ['Mortgage Loan (CPF OA)','Mortgage Loan (Cash)','Motor Vehicle Repayment','Personal Loan Repayment','Rental Expenses','Income Tax','Insurance Payments','Regular Savings / Investments'],
      customKey: 'd_custom_financial' as keyof FactFinding },
    { id: 'household', title: 'Household & Living', color: '#4A7C9E', hint: 'Conservancy, utilities, food, maid',
      keys: ['d_conservancy','d_utilities','d_family_food','d_maid','d_other_household'],
      keys2: ['d2_conservancy','d2_utilities','d2_family_food','d2_maid','d2_other_household'],
      labels: ['Conservancy / MCST / Property Tax','Utilities & Bills','Family Food & Groceries','Maid Services (incl. Levy)','Other Household Expenses'],
      customKey: 'd_custom_household' as keyof FactFinding },
    { id: 'personal', title: 'Personal Expenses', color: '#7A6AAA', hint: 'Personal dining, transport, car',
      keys: ['d_personal_food','d_transport','d_car_petrol','d_car_insurance'],
      keys2: ['d2_personal_food','d2_transport','d2_car_petrol','d2_car_insurance'],
      labels: ['Personal Food & Groceries','Public Transport','Car Petrol / Parking / Road Tax','Car Insurance'],
      customKey: 'd_custom_personal' as keyof FactFinding },
    { id: 'children', title: 'Children Expenses', color: 'var(--emerald)', hint: 'Childcare, school, transport, pocket money',
      keys: ['d_childcare','d_school_fees','d_school_transport','d_allowance_children','d_other_children'],
      keys2: ['d2_childcare','d2_school_fees','d2_school_transport','d2_allowance_children','d2_other_children'],
      labels: ['Childcare / DayCare','School & Tuition Fees','School Transport','Allowance / Pocket Money','Other Children Expenses'],
      customKey: 'd_custom_children' as keyof FactFinding },
    { id: 'lifestyle', title: 'Lifestyle & Miscellaneous', color: '#9A7C5A', hint: 'Holidays, hobbies, parents allowance, donations',
      keys: ['d_holidays','d_hobbies','d_allowance_parents','d_others_lifestyle'],
      keys2: ['d2_holidays','d2_hobbies','d2_allowance_parents','d2_others_lifestyle'],
      labels: ['Holidays / Tours','Hobbies / Recreation','Allowance to Parents','Others (Shopping, Tithes, Donations)'],
      customKey: 'd_custom_lifestyle' as keyof FactFinding },
  ]

  const cashCustom = (ff.a_cash_custom || []).reduce((s, i) => s + (i.amount || 0) + (isCouple ? (i.amount2 || 0) : 0), 0)
  const cashTotal = (ff.a_savings||0)+(ff.a_fixed_deposit||0)+cashCustom+(isCouple?((ff.a2_savings||0)+(ff.a2_fixed_deposit||0)):0)
  const cpfItems = [ff.a_cpf_oa||0,ff.a_cpf_sa||0,ff.a_cpf_ma||0,ff.a_cpf_ra||0]
  const cpfItems2 = isCouple ? [ff.a2_cpf_oa||0,ff.a2_cpf_sa||0,ff.a2_cpf_ma||0,ff.a2_cpf_ra||0] : []
  const investedStd = [ff.a_srs||0,ff.a_shares||0,ff.a_etf||0,ff.a_unit_trust||0,ff.a_bonds||0,ff.a_alternatives||0,ff.a_business||0]
  const investedStd2 = isCouple ? [ff.a2_srs||0,ff.a2_shares||0,ff.a2_etf||0,ff.a2_unit_trust||0,ff.a2_bonds||0,ff.a2_alternatives||0,ff.a2_business||0] : []
  const investedCustom = (ff.a_invested_custom || []).reduce((s, i) => s + (i.amount || 0) + (isCouple ? (i.amount2 || 0) : 0), 0)
  // investmentPropTotal comes from properties tab (computed below after allProperties)
  const investedTotal = [...cpfItems,...cpfItems2,...investedStd,...investedStd2].reduce((s,v)=>s+v,0)+investedCustom
  const personalCustom = (ff.a_personal_custom || []).reduce((s, i) => s + (i.amount || 0) + (isCouple ? (i.amount2 || 0) : 0), 0)
  const personalTotal = (ff.a_vehicles||0)+(ff.a_club||0)+personalCustom+(isCouple?((ff.a2_vehicles||0)+(ff.a2_club||0)):0)
  // Property portfolio derived values
  const allProperties = ff.properties || []
  const primaryResProps = allProperties.filter(p => p.isPrimaryResidence)
  const investmentProps = allProperties.filter(p => !p.isPrimaryResidence)
  const primaryResTotal = primaryResProps.reduce((s, p) => s + (p.propertyValue || p.purchasePrice || 0), 0)
  const investmentPropTotal = investmentProps.reduce((s, p) => s + (p.propertyValue || p.purchasePrice || 0), 0)
  const mortgageLiabTotal = allProperties.reduce((s, p) => {
    const eff = p.outstanding || (p.initialLoanAmount && p.initialTenure && p.loanStartDate
      ? calcOutstandingBalance(p.initialLoanAmount, p.interestRate || 0, p.initialTenure, p.loanStartDate)
      : 0)
    return s + (eff || 0)
  }, 0)
  const totalPropertyValue = primaryResTotal + investmentPropTotal
  const totalPropertyEquity = totalPropertyValue - mortgageLiabTotal
  const totalMonthlyPayment = allProperties.reduce((s, p) => {
    const effOut = p.outstanding || (p.initialLoanAmount && p.initialTenure && p.loanStartDate
      ? calcOutstandingBalance(p.initialLoanAmount, p.interestRate || 0, p.initialTenure, p.loanStartDate) : 0)
    const effTenure = p.remainingTenure || (p.initialTenure && p.loanStartDate
      ? calcRemainingTenureYears(p.initialTenure, p.loanStartDate) : 0)
    return s + ((effOut && effTenure) ? calcPMT(effOut, p.interestRate || 0, effTenure) : (p.monthlyRepayment || 0))
  }, 0)
  const latestMortgageEndAge = (() => {
    const ages = allProperties.map(p => {
      const effTenure = p.remainingTenure || (p.initialTenure && p.loanStartDate
        ? calcRemainingTenureYears(p.initialTenure, p.loanStartDate) : 0)
      return effTenure ? Math.round(age1 + effTenure) : 0
    }).filter(a => a > 0)
    return ages.length > 0 ? Math.max(...ages) : null
  })()
  const latestMortgageEndAge2 = isCouple ? (() => {
    const ages = allProperties.map(p => {
      const effTenure = p.remainingTenure || (p.initialTenure && p.loanStartDate
        ? calcRemainingTenureYears(p.initialTenure, p.loanStartDate) : 0)
      return effTenure ? Math.round(age2 + effTenure) : 0
    }).filter(a => a > 0)
    return ages.length > 0 ? Math.max(...ages) : null
  })() : null
  const totalAssets = cashTotal + investedTotal + personalTotal + investmentPropTotal + primaryResTotal
  const stCustom = (ff.l_st_custom || []).reduce((s, i) => s + (i.amount || 0) + (isCouple ? (i.amount2 || 0) : 0), 0)
  const stTotal = (ff.l_credit_card||0)+(ff.l_business_loan||0)+(ff.l_renovation_st||0)+stCustom+(isCouple?((ff.l2_credit_card||0)+(ff.l2_business_loan||0)+(ff.l2_renovation_st||0)):0)
  const ltCustom = (ff.l_lt_custom || []).reduce((s, i) => s + (i.amount || 0) + (isCouple ? (i.amount2 || 0) : 0), 0)
  const ltTotal = (ff.l_car_loan||0)+(ff.l_study_loan||0)+(ff.l_personal_loan||0)+(ff.l_renovation_lt||0)+ltCustom+(isCouple?((ff.l2_car_loan||0)+(ff.l2_study_loan||0)+(ff.l2_personal_loan||0)+(ff.l2_renovation_lt||0)):0)
  const totalLiab = stTotal + ltTotal + mortgageLiabTotal; const netWorth = totalAssets - totalLiab
  const RISK_COLORS: Record<string, string> = { Conservative: 'var(--emerald)', Moderate: '#C4A464', Balanced: '#4A7C9E', Growth: '#7A6AAA', Aggressive: 'var(--rouge)' }
  const assetRow = (label: string, key: keyof FactFinding, key2?: keyof FactFinding) => <AssetRow key={label} label={label} value={ff[key] as number} onChange={v => upd(key, n(v))} value2={key2 ? ff[key2] as number : undefined} onChange2={key2 ? v => upd(key2, n(v)) : undefined} isCouple={isCouple} />
  const clientName = client.name; const spouseName = spouse?.name || 'Spouse'

  return (
    <div className="flex flex-col min-h-full">
      <div style={{ background: 'var(--charcoal)', padding: '0 48px', position: 'sticky', top: 0, zIndex: 40 }}>
        <div className="flex items-center gap-4 py-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'rgba(255,255,255,0.28)' }}>Fact Finding</div>
            <div className="font-serif text-2xl font-light" style={{ color: '#F0EDE8' }}>{clientName}{isCouple && spouse ? ` & ${spouseName}` : ''}</div>
          </div>
          <div className="flex gap-1 ml-4">
            {[{ id: 'single', label: '👤 Single' }, { id: 'couple', label: '👫 Couple' }].map(m => (
              <button key={m.id} onClick={() => upd('mode', m.id)} className="px-3 py-1.5 text-xs transition-all"
                style={{ border: mode === m.id ? '1.5px solid rgba(168,131,74,0.8)' : '1px solid rgba(255,255,255,0.15)', background: mode === m.id ? 'rgba(168,131,74,0.25)' : 'transparent', color: mode === m.id ? '#C4A464' : 'rgba(255,255,255,0.45)' }}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center">
            <div className="flex items-stretch" style={{ borderRight: '1px solid rgba(255,255,255,0.08)', marginRight: 16 }}>
              {[
                { label: isCouple ? 'Combined/mo' : 'Income/mo', val: fmt(moTotal), color: '#C4A464' },
                { label: 'Annual', val: fmt(anTotal), color: '#80C4A0' },
                { label: 'Net Worth', val: netWorth !== 0 ? fmt(netWorth) : '—', color: netWorth >= 0 ? '#80C4A0' : '#E08080' },
              ].map((s, idx, arr) => (
                <div key={s.label} className="flex flex-col items-end justify-center"
                  style={{ padding: '8px 22px', borderRight: idx < arr.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                  <div style={{ fontSize: 9, letterSpacing: '0.11em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)', marginBottom: 5 }}>{s.label}</div>
                  <div className="font-serif" style={{ fontSize: 22, fontWeight: 300, lineHeight: 1, color: s.color, letterSpacing: '-0.01em' }}>{s.val}</div>
                </div>
              ))}
            </div>
            <div className="px-5 py-2 text-sm font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
  {saved ? '✓ Saved' : saving ? 'Saving…' : ''}
</div>
          </div>
        </div>
        <div className="flex">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)} className="flex items-center gap-2 px-4 py-3 text-xs tracking-wide"
              style={{ color: activeSection === s.id ? '#C4A464' : 'rgba(255,255,255,0.35)', borderBottom: activeSection === s.id ? '1px solid #C4A464' : '1px solid transparent', background: 'transparent' }}>
              <span>{s.icon}</span>{s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '32px 48px', flex: 1 }}>

        {activeSection === 'income' && (
          isCouple ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
                <div className="space-y-4">
                  <PersonIncomePanel p={p1} onChange={(k,v)=>updP('person1',k,v)} age={age1} config={cpfConfig} label={`${clientName} (Client)`} />
                  <CpfCard p={p1} age={age1} config={cpfConfig} label={clientName} />
                </div>
                <div className="space-y-4">
                  <PersonIncomePanel p={p2} onChange={(k,v)=>updP('person2',k,v)} age={age2} config={cpfConfig} label={spouseName} />
                  <CpfCard p={p2} age={age2} config={cpfConfig} label={spouseName} />
                </div>
              </div>
              <div style={{ background: 'white', border: '2px solid var(--gold)', padding: '20px 24px', marginTop: 24 }}>
                <div className="text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--gold-tag)' }}>Combined Income Summary</div>
                <div className="flex text-xs pb-2" style={{ borderBottom: '2px solid var(--line2)', color: 'var(--ink3)', fontSize: 9, textTransform: 'uppercase' }}>
                  <div className="flex-1"></div><div className="w-28 text-right">Monthly</div><div className="w-32 text-right">Annual</div>
                </div>
                <SumRow label={clientName} mo={mo1} an={an1} />
                <SumRow label={spouseName} mo={mo2} an={an2} />
                <div className="flex items-center justify-between pt-3 mt-1" style={{ borderTop: '2px solid var(--gold)' }}>
                  <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Total Combined</span>
                  <div className="flex gap-4">
                    <span className="font-serif text-lg" style={{ color: 'var(--gold)' }}>{fmt(moTotal)}/mo</span>
                    <span className="font-serif text-lg" style={{ color: 'var(--gold)' }}>{fmt(anTotal)}/yr</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
              <PersonIncomePanel p={p1} onChange={(k,v)=>updP('person1',k,v)} age={age1} config={cpfConfig} label={clientName} />
              <CpfCard p={p1} age={age1} config={cpfConfig} />
            </div>
          )
        )}


        {activeSection === 'expenses' && (
          <div className="space-y-5">
            <div style={{ background: 'white', border: '1px solid var(--line)', padding: '16px 24px' }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Cashflow Detail</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>Choose how much detail to capture</div>
                </div>
                <div className="flex gap-2">
                  {[{ id: 'simple', label: '⚡ Simplified' }, { id: 'detailed', label: '📋 Detailed' }].map(m => (
                    <button key={m.id} onClick={() => upd('expense_mode', m.id)}
                      className="px-4 py-2 text-sm" style={{ border: expMode === m.id ? '1.5px solid var(--gold)' : '1px solid var(--line)', background: expMode === m.id ? 'var(--gold-l)' : 'white', color: expMode === m.id ? 'var(--gold-tag)' : 'var(--ink2)', minWidth: 130 }}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>
              <div className="space-y-4">

                {expMode === 'simple' && (
                  <div style={{ background: 'white', border: '1px solid var(--line)' }}>
                    <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                      <div className="font-serif text-lg" style={{ color: 'var(--ink)' }}>Annual Expenses</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>Enter annual amounts — monthly auto-calculated</div>
                    </div>
                    {isCouple && (
                      <div className="px-6 pt-4">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 145px 145px 130px', gap: 8 }}>
                          <div />
                          <div className="text-xs font-medium text-center py-1.5" style={{ background: 'rgba(168,131,74,0.08)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.2)' }}>{clientName}</div>
                          <div className="text-xs font-medium text-center py-1.5" style={{ background: 'rgba(74,124,158,0.08)', color: '#4A7C9E', border: '1px solid rgba(74,124,158,0.2)' }}>{spouseName}</div>
                          <div className="text-xs font-medium text-center py-1.5" style={{ background: 'var(--cream2)', color: 'var(--ink2)', border: '1px solid var(--line2)' }}>Combined/yr</div>
                        </div>
                      </div>
                    )}
                    <div className="px-6 py-2">
                      {EXP_CATEGORIES.map(cat => {
                        const ann1 = getAnn1(cat); const ann2 = getAnn2(cat); const annSum = ann1 + ann2
                        const isCpfOa = cat.id === 'cpf_oa'
                        return (
                          <div key={cat.id} className="py-3" style={{ borderBottom: '1px solid var(--line)' }}>
                            <div className="flex items-center gap-3">
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: cat.color }}></div>
                                  <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{cat.label}</span>
                                  {isCpfOa && <span className="text-xs px-1.5 py-0.5 flex-shrink-0" style={{ background: '#5A8A6A18', color: '#5A8A6A', border: '1px solid #5A8A6A30' }}>CPF</span>}
                                </div>
                                <div className="text-xs mt-0.5 ml-4" style={{ color: 'var(--ink3)' }}>{cat.hint}</div>
                              </div>
                              {isCouple ? (
                                <div style={{ display: 'grid', gridTemplateColumns: '145px 145px 130px', gap: 8, flexShrink: 0 }}>
                                  <AnnInput value={ann1 || undefined} onChange={v => upd(cat.key, n(v))} />
                                  <AnnInput value={ann2 || undefined} onChange={v => upd(cat.key2, n(v))} accentColor="#4A7C9E" />
                                  <div className="flex items-center justify-end px-3 text-sm font-medium"
                                    style={{ background: annSum > 0 ? 'var(--cream2)' : 'var(--cream)', border: '1px solid var(--line2)', color: annSum > 0 ? 'var(--ink)' : 'var(--ink3)', minHeight: 38 }}>
                                    {annSum > 0 ? fmt(annSum) : '—'}
                                  </div>
                                </div>
                              ) : (
                                <div style={{ width: 150, flexShrink: 0 }}>
                                  <AnnInput value={ann1 || undefined} onChange={v => upd(cat.key, n(v))} />
                                </div>
                              )}
                            </div>
                            {annSum > 0 && (
                              <div className="flex items-center gap-3 mt-1.5 ml-4">
                                <span className="text-xs" style={{ color: 'var(--ink3)' }}>{fmt(annSum / 12)}<span style={{ opacity: 0.6 }}>/mo</span></span>
                                <span style={{ color: 'var(--line2)', fontSize: 10 }}>·</span>
                                <span className="text-xs" style={{ color: 'var(--ink3)' }}>{fmt(annSum)}<span style={{ opacity: 0.6 }}>/yr</span></span>
                                {isCpfOa && <span className="text-xs" style={{ color: '#5A8A6A' }}>not included in cash expenses</span>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      <div className="pt-4 pb-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Total Annually</span>
                          <div className="flex gap-6 items-end">
                            <div className="text-right">
                              <div className="text-xs mb-0.5" style={{ color: 'var(--ink3)' }}>Monthly</div>
                              <div className="font-serif text-lg" style={{ color: 'var(--rouge)' }}>{fmt(moExpNoCpf)}/mo</div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs mb-0.5" style={{ color: 'var(--ink3)' }}>Annual</div>
                              <div className="font-serif text-lg" style={{ color: 'var(--ink2)' }}>{fmt(annExpNoCpf)}/yr</div>
                            </div>
                          </div>
                        </div>
                        {annCpfOaTotal > 0 && (
                          <div className="text-xs mt-1" style={{ color: '#5A8A6A' }}>
                            * Excludes CPF OA mortgage ({fmt(annCpfOaTotal / 12)}/mo · {fmt(annCpfOaTotal)}/yr)
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {expMode === 'detailed' && (
                  <div className="space-y-4">
                    {DETAILED_GROUPS.map(group => {
                      const customItems = (ff[group.customKey] as CustomExpenseItem[]) || []
                      const g1 = group.keys.reduce((s,k)=>s+((ff[k as keyof FactFinding] as number)||0),0)+customItems.reduce((s,i)=>s+(i.amount||0),0)
                      const g2 = isCouple ? group.keys2.reduce((s,k)=>s+((ff[k as keyof FactFinding] as number)||0),0)+customItems.reduce((s,i)=>s+(i.amount2||0),0) : 0
                      const gSum = g1 + g2
                      return (
                        <div key={group.id} style={{ background: 'white', border: '1px solid var(--line)' }}>
                          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)', borderLeft: `3px solid ${group.color}` }}>
                            <div>
                              <div className="text-sm font-medium" style={{ color: group.color }}>{group.title}</div>
                              <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>{group.hint}</div>
                            </div>
                            <div className="text-xs" style={{ color: 'var(--ink3)' }}>Sub-total: <span style={{ color: group.color, fontWeight: 600 }}>{fmt(gSum)}/yr</span></div>
                          </div>
                          <div className="px-5 py-2">
                            {isCouple && (
                              <div className="flex items-center gap-2 py-2 mb-1" style={{ borderBottom: '2px solid var(--line2)' }}>
                                <div className="flex-1 text-xs" style={{ color: 'var(--ink3)' }}>Item</div>
                                <div className="text-xs font-medium text-center" style={{ width: 118, color: 'var(--gold-tag)' }}>{clientName}</div>
                                <div className="text-xs font-medium text-center" style={{ width: 118, color: '#4A7C9E' }}>{spouseName}</div>
                                <div className="text-xs font-medium text-center" style={{ width: 90, color: 'var(--ink2)' }}>Combined/yr</div>
                                <div style={{ width: 28 }}></div>
                              </div>
                            )}
                            {group.keys.map((k, i) => {
                              const k2 = group.keys2[i]
                              const v1 = (ff[k as keyof FactFinding] as number) || 0
                              const v2 = isCouple ? ((ff[k2 as keyof FactFinding] as number) || 0) : 0
                              const vSum = v1 + v2
                              return (
                                <div key={k} className="flex items-center py-2 gap-2" style={{ borderBottom: '1px solid var(--line)' }}>
                                  <div className="flex-1 text-xs" style={{ color: 'var(--ink2)' }}>{group.labels[i]}</div>
                                  <DetInput value={v1||undefined} onChange={v=>upd(k as keyof FactFinding,n(v))} />
                                  {isCouple && <DetInput value={v2||undefined} onChange={v=>upd(k2 as keyof FactFinding,n(v))} accentColor="#4A7C9E" />}
                                  {isCouple
                                    ? <div className="text-xs text-right font-medium" style={{ width: 90, color: vSum>0?'var(--ink)':'var(--ink3)' }}>{vSum>0?fmt(vSum):'—'}</div>
                                    : <div className="text-xs text-right" style={{ width: 80, color: 'var(--ink3)' }}>{v1>0?fmt(v1)+'/yr':'—'}</div>}
                                  {isCouple && <div style={{ width: 28 }}></div>}
                                </div>
                              )
                            })}
                            {customItems.map((item, i) => {
                              const v2 = isCouple ? (item.amount2||0) : 0
                              const vSum = (item.amount||0) + v2
                              return (
                                <div key={`cx-${i}`} className="flex items-center py-2 gap-2" style={{ borderBottom: '1px solid var(--line)' }}>
                                  <input type="text" value={item.label} placeholder="Custom expense"
                                    onChange={e=>{const u=[...customItems];u[i]={...u[i],label:e.target.value};upd(group.customKey,u)}}
                                    className="flex-1 px-2 py-1.5 text-xs outline-none"
                                    style={{ border:'1px solid var(--line)',background:'white',color:'var(--ink)' }}
                                    onFocus={e=>(e.currentTarget.style.borderColor='var(--gold)')}
                                    onBlur={e=>(e.currentTarget.style.borderColor='var(--line)')} />
                                  <DetInput value={item.amount||undefined} onChange={v=>{const u=[...customItems];u[i]={...u[i],amount:n(v)};upd(group.customKey,u)}} />
                                  {isCouple && <DetInput value={item.amount2||undefined} onChange={v=>{const u=[...customItems];u[i]={...u[i],amount2:n(v)};upd(group.customKey,u)}} accentColor="#4A7C9E" />}
                                  {isCouple
                                    ? <div className="text-xs text-right font-medium" style={{ width:90,color:vSum>0?'var(--ink)':'var(--ink3)' }}>{vSum>0?fmt(vSum):'—'}</div>
                                    : <div className="text-xs text-right" style={{ width:80,color:'var(--ink3)' }}>{(item.amount||0)>0?fmt((item.amount||0)*12)+'/yr':'—'}</div>}
                                  <button onClick={()=>upd(group.customKey,customItems.filter((_,j)=>j!==i))}
                                    className="flex items-center justify-center text-sm flex-shrink-0"
                                    style={{ width:28,height:28,color:'var(--ink3)',border:'1px solid var(--line)',background:'white' }}
                                    onMouseEnter={e=>(e.currentTarget.style.color='var(--rouge)')}
                                    onMouseLeave={e=>(e.currentTarget.style.color='var(--ink3)')}>×</button>
                                </div>
                              )
                            })}
                            <div className="pt-2 pb-1">
                              <button onClick={()=>upd(group.customKey,[...customItems,{label:'',amount:0,amount2:0}])}
                                className="text-xs px-3 py-1.5"
                                style={{ color:'var(--gold-tag)',border:'1px solid rgba(168,131,74,0.3)',background:'var(--gold-l)' }}>
                                + Add Row
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                  <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Cash Flow</div>
                  <div className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                    <span style={{ color: 'var(--ink3)' }}>Total Income/mo</span>
                    <span style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(moTotal)}</span>
                  </div>
                  <div className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                    <span style={{ color: 'var(--ink3)' }}>Total Expenses/mo</span>
                    <span style={{ color: 'var(--rouge)', fontWeight: 500 }}>{fmt(moExpNoCpf)}</span>
                  </div>
                  {annCpfOaTotal > 0 && (<>
                    <div className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                      <span style={{ color: '#5A8A6A' }}>CPF OA Outflow/mo</span>
                      <span style={{ color: '#5A8A6A', fontWeight: 500 }}>−{fmt(annCpfOaTotal/12)}</span>
                    </div>
                    <div className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                      <span style={{ color: '#5A8A6A' }}>CPF OA Inflow/mo</span>
                      <span style={{ color: '#5A8A6A', fontWeight: 500 }}>+{fmt(cpf1.oa+(cpf2?.oa||0))}</span>
                    </div>
                  </>)}
                  <div className="flex items-center justify-between pt-3 mb-2">
                    <span className="text-xs" style={{ color: 'var(--ink2)' }}>Surplus / Deficit</span>
                    <span className="font-serif text-xl" style={{ color: moTotal-moExpNoCpf>=0?'var(--emerald)':'var(--rouge)' }}>
                      {moTotal-moExpNoCpf>=0?'+':'−'}{fmt(Math.abs(moTotal-moExpNoCpf))}/mo
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--ink2)' }}>Annual surplus</span>
                    <span className="font-serif text-base" style={{ color: anTotal-annExpNoCpf>=0?'var(--emerald)':'var(--rouge)' }}>
                      {anTotal-annExpNoCpf>=0?'+':'−'}{fmt(Math.abs(anTotal-annExpNoCpf))}/yr
                    </span>
                  </div>
                  {moTotal > 0 && (
                    <div className="mt-3">
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
                        <div className="h-full rounded-full" style={{ width:`${Math.min((moExpNoCpf/moTotal)*100,100)}%`, background: moExpNoCpf/moTotal>0.9?'var(--rouge)':moExpNoCpf/moTotal>0.7?'#C4A464':'var(--emerald)' }} />
                      </div>
                      <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--ink3)' }}>
                        <span>Expense ratio</span><span>{pct(moExpNoCpf,moTotal)}%</span>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                  <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>vs Singapore Average</div>
                  <div className="text-xs mb-4" style={{ color: 'var(--ink3)' }}>% of gross income (DOS HES benchmark)</div>
                  {EXP_CATEGORIES.map(cat => {
                    const moAmt = getAnnSum(cat) / 12
                    const actualPct = moGrossTotal > 0 ? (moAmt / moGrossTotal) * 100 : 0
                    const benchPct = BENCHMARKS_PCT[cat.id] ?? 5
                    const over = actualPct > benchPct
                    const barW = Math.min((actualPct / (benchPct * 2)) * 100, 100)
                    return (
                      <div key={cat.id} className="mb-4">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-xs" style={{ color: 'var(--ink2)' }}>{cat.label}</div>
                          <div className="flex items-center gap-2 text-xs">
                            <span style={{ color: over?'var(--rouge)':'var(--emerald)', fontWeight: 500 }}>{actualPct.toFixed(1)}%</span>
                            <span style={{ color: 'var(--ink3)' }}>vs {benchPct}%</span>
                            {over && <span style={{ color: 'var(--rouge)', fontSize: 9 }}>▲ HIGH</span>}
                          </div>
                        </div>
                        <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
                          <div className="absolute top-0 bottom-0 w-px z-10" style={{ left: '50%', background: 'rgba(0,0,0,0.18)' }} />
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barW}%`, background: cat.color }} />
                        </div>
                        <div className="flex justify-between mt-0.5" style={{ fontSize: 9, color: 'var(--ink3)' }}>
                          <span>0%</span><span>{benchPct}% avg</span><span>{benchPct * 2}%</span>
                        </div>
                      </div>
                    )
                  })}
                  <div className="pt-2 text-xs" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink3)' }}>▲ HIGH = above Singapore income benchmark</div>
                </div>

                <div style={{ background: 'white', border: '1px solid var(--line)', padding: '16px 20px' }}>
                  <div className="text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Annual Breakdown</div>
                  {EXP_CATEGORIES.map(cat => {
                    const annAmt = getAnnSum(cat); if (!annAmt) return null
                    const isCpfOa = cat.id === 'cpf_oa'
                    return (
                      <div key={cat.id} className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ background: cat.color }}></div>
                          <span style={{ color: isCpfOa?'#5A8A6A':'var(--ink2)' }}>{cat.label}</span>
                          {isCpfOa && <span style={{ color: '#5A8A6A', fontSize: 9 }}>CPF</span>}
                        </div>
                        <span style={{ color: isCpfOa?'#5A8A6A':'var(--ink)', fontWeight: 500 }}>{fmt(annAmt)}</span>
                      </div>
                    )
                  })}
                  <div className="flex justify-between pt-2 text-xs" style={{ borderTop: '1px solid var(--line)', marginTop: 4 }}>
                    <span style={{ color: 'var(--ink3)' }}>Cash Expenses</span>
                    <span style={{ color: 'var(--rouge)', fontWeight: 600 }}>{fmt(annExpNoCpf)}</span>
                  </div>
                  {annCpfOaTotal > 0 && (
                    <div className="flex justify-between pt-1 text-xs">
                      <span style={{ color: '#5A8A6A' }}>+ CPF OA</span>
                      <span style={{ color: '#5A8A6A', fontWeight: 600 }}>{fmt(annCpfOaTotal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 font-semibold text-sm" style={{ borderTop: '1px solid var(--line)', marginTop: 4, color: 'var(--ink)' }}>
                    <span>Total Annual</span><span>{fmt(annExpAll)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}


        {activeSection === 'assets' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
            <div className="space-y-4">
              <AssetBlock title="CASH / NEAR CASH" color="var(--emerald)" total={cashTotal} isCouple={isCouple} clientName={clientName} spouseName={spouseName}>
                {assetRow('Savings / Current Account(s)', 'a_savings', 'a2_savings')}
                {assetRow('Fixed Deposit(s)', 'a_fixed_deposit', 'a2_fixed_deposit')}
                <CustomRows items={ff.a_cash_custom || []} onChange={v => upd('a_cash_custom', v)} placeholder="e.g. Singapore Savings Bonds" isCouple={isCouple} />
              </AssetBlock>
              <AssetBlock title="INVESTED ASSET(S)" color="#4A7C9E" total={investedTotal} isCouple={isCouple} clientName={clientName} spouseName={spouseName}>
                {assetRow('CPF Ordinary Account (OA)', 'a_cpf_oa', 'a2_cpf_oa')}
                {assetRow('CPF Special Account (SA)', 'a_cpf_sa', 'a2_cpf_sa')}
                {assetRow('CPF Medisave Account (MA)', 'a_cpf_ma', 'a2_cpf_ma')}
                {assetRow('CPF Retirement Account (RA)', 'a_cpf_ra', 'a2_cpf_ra')}
                {assetRow('SRS', 'a_srs', 'a2_srs')}
                {assetRow('Shares', 'a_shares', 'a2_shares')}
                {assetRow('ETF(s)', 'a_etf', 'a2_etf')}
                {assetRow('Unit Trust(s)', 'a_unit_trust', 'a2_unit_trust')}
                {assetRow('Bonds / Treasury Bills', 'a_bonds', 'a2_bonds')}
                {assetRow('Alternative Investments (Hedge Funds, Gold, etc.)', 'a_alternatives', 'a2_alternatives')}
                {assetRow('Business Venture(s)', 'a_business', 'a2_business')}
                <CustomRows items={ff.a_invested_custom || []} onChange={v => upd('a_invested_custom', v)} placeholder="e.g. Crypto, Wine Collection" isCouple={isCouple} />
              </AssetBlock>
              <AssetBlock title="PERSONAL USE ASSET(S)" color="#C4A464" total={personalTotal} isCouple={isCouple} clientName={clientName} spouseName={spouseName}>
                {assetRow('Motor Vehicles (Cars, Bikes, Boats)', 'a_vehicles', 'a2_vehicles')}
                {assetRow('Club Membership', 'a_club', 'a2_club')}
                <CustomRows items={ff.a_personal_custom || []} onChange={v => upd('a_personal_custom', v)} placeholder="e.g. Jewellery, Art" isCouple={isCouple} />
              </AssetBlock>
              {/* Properties summary — read-only pull from Properties tab */}
              <div style={{ background: 'white', border: '1px solid var(--line)' }}>
                <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)', borderLeft: '3px solid var(--gold)' }}>
                  <span className="text-sm font-medium" style={{ color: 'var(--gold-tag)' }}>PROPERTIES</span>
                  <span className="text-xs" style={{ color: 'var(--ink3)' }}>From Properties tab · read-only</span>
                </div>
                <div className="px-5 py-2">
                  {allProperties.length === 0 ? (
                    <div className="py-4 text-xs text-center" style={{ color: 'var(--ink3)' }}>No properties recorded — add them in the Properties tab.</div>
                  ) : (
                    <>
                      {primaryResProps.length > 0 && (
                        <div className="py-2" style={{ borderBottom: '1px solid var(--line)' }}>
                          <div className="text-xs mb-1.5" style={{ color: 'var(--ink3)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Primary Residence (excluded from investable)</div>
                          {primaryResProps.map(p => (
                            <div key={p.id} className="flex items-center justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                              <div style={{ color: 'var(--ink2)' }}>{p.label || 'Unnamed'}{p.propertyType ? ` · ${p.propertyType}` : ''}</div>
                              <div style={{ color: 'var(--gold-tag)', fontWeight: 500 }}>{p.propertyValue ? fmt(p.propertyValue) : '—'}</div>
                            </div>
                          ))}
                          <div className="flex justify-between py-1.5 text-xs font-medium" style={{ color: 'var(--gold-tag)' }}>
                            <span>Primary Residence Sub-total</span><span>{fmt(primaryResTotal)}</span>
                          </div>
                        </div>
                      )}
                      {investmentProps.length > 0 && (
                        <div className="py-2">
                          <div className="text-xs mb-1.5" style={{ color: 'var(--ink3)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Investment Properties (included in investable)</div>
                          {investmentProps.map(p => (
                            <div key={p.id} className="flex items-center justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                              <div style={{ color: 'var(--ink2)' }}>{p.label || 'Unnamed'}{p.propertyType ? ` · ${p.propertyType}` : ''}</div>
                              <div style={{ color: '#4A7C9E', fontWeight: 500 }}>{p.propertyValue ? fmt(p.propertyValue) : '—'}</div>
                            </div>
                          ))}
                          <div className="flex justify-between py-1.5 text-xs font-medium" style={{ color: '#4A7C9E' }}>
                            <span>Investment Properties Sub-total</span><span>{fmt(investmentPropTotal)}</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-4" style={{ position: 'sticky', top: 24 }}>
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Total Assets</div>
                {[
                  {label:'Cash / Near Cash',val:cashTotal,color:'var(--emerald)'},
                  {label:'Invested Assets',val:investedTotal,color:'#4A7C9E'},
                  {label:'Investment Properties',val:investmentPropTotal,color:'var(--gold-tag)'},
                  {label:'Primary Residence',val:primaryResTotal,color:'#9A7C5A'},
                  {label:'Personal Use',val:personalTotal,color:'#C4A464'},
                ].filter(r=>r.val>0).map(r=>(
                  <div key={r.label} className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ background: r.color }}></div><span style={{ color: 'var(--ink2)' }}>{r.label}</span></div>
                    <span style={{ color: r.color, fontWeight: 500 }}>{fmt(r.val)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-3 font-semibold text-sm" style={{ color: 'var(--emerald)' }}><span>Total Assets</span><span>{fmt(totalAssets)}</span></div>
              </div>
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Net Worth</div>
                <div className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}><span style={{ color: 'var(--ink2)' }}>Total Assets</span><span style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(totalAssets)}</span></div>
                <div className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}><span style={{ color: 'var(--ink2)' }}>Total Liabilities</span><span style={{ color: 'var(--rouge)', fontWeight: 500 }}>{fmt(totalLiab)}</span></div>
                <div className="flex justify-between pt-3 font-serif text-2xl" style={{ color: netWorth>=0?'var(--emerald)':'var(--rouge)' }}>
                  <span className="text-sm font-sans font-medium" style={{ color: 'var(--ink)' }}>Net Worth</span>
                  <span>{netWorth>=0?'':'−'}{fmt(Math.abs(netWorth))}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'properties' && (
          <div>
            {/* KPI summary row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
              {[
                { label: 'Total Property Value', val: fmt(totalPropertyValue), color: 'var(--gold-tag)', sub: `${allProperties.length} propert${allProperties.length === 1 ? 'y' : 'ies'}` },
                { label: 'Total Mortgage Outstanding', val: fmt(mortgageLiabTotal), color: 'var(--rouge)', sub: totalMonthlyPayment ? `${fmt(totalMonthlyPayment)}/mo repayment` : 'No active loans' },
                { label: 'Total Property Equity', val: fmt(totalPropertyEquity), color: totalPropertyEquity >= 0 ? 'var(--emerald)' : 'var(--rouge)', sub: totalPropertyValue > 0 ? `${Math.round((totalPropertyEquity / totalPropertyValue) * 100)}% equity ratio` : '' },
                { label: 'Monthly Mortgage Payment', val: totalMonthlyPayment ? fmt(totalMonthlyPayment) : '—', color: '#4A7C9E', sub: totalMonthlyPayment ? `${fmt(totalMonthlyPayment * 12)}/yr` : 'No payments' },
              ].map(k => (
                <div key={k.label} style={{ background: 'white', border: '1px solid var(--line)', padding: '18px 20px' }}>
                  <div className="text-xs mb-3" style={{ color: 'var(--ink3)', letterSpacing: '0.04em' }}>{k.label}</div>
                  <div className="font-serif" style={{ fontSize: 26, fontWeight: 300, color: k.color, lineHeight: 1, letterSpacing: '-0.01em' }}>{k.val}</div>
                  {k.sub && <div className="text-xs mt-2" style={{ color: 'var(--ink3)' }}>{k.sub}</div>}
                </div>
              ))}
            </div>
            {/* Main content */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
              <div className="space-y-4">
                <PropertyPortfolioBlock
                  properties={ff.properties || []}
                  onChange={v => upd('properties', v)}
                  isCouple={isCouple}
                  clientName={clientName}
                  spouseName={spouseName}
                  clientAge={age1}
                  spouseAge={isCouple ? age2 : undefined}
                />
              </div>
              <div className="space-y-4" style={{ position: 'sticky', top: 24 }}>
                {/* Portfolio summary */}
                <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                  <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Portfolio Summary</div>
                  {allProperties.length === 0 ? (
                    <div className="text-xs py-4 text-center" style={{ color: 'var(--ink3)' }}>No properties added yet.</div>
                  ) : (
                    <>
                      <div className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                        <span style={{ color: 'var(--ink2)' }}>Total Properties</span>
                        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{allProperties.length}</span>
                      </div>
                      <div className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                        <span style={{ color: 'var(--ink2)' }}>Primary Residence</span>
                        <span style={{ color: 'var(--gold-tag)', fontWeight: 500 }}>{fmt(primaryResTotal)}</span>
                      </div>
                      <div className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                        <span style={{ color: 'var(--ink2)' }}>Investment Properties</span>
                        <span style={{ color: '#4A7C9E', fontWeight: 500 }}>{fmt(investmentPropTotal)}</span>
                      </div>
                      <div className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                        <span style={{ color: 'var(--ink2)' }}>Total Property Value</span>
                        <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>{fmt(totalPropertyValue)}</span>
                      </div>
                      <div className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                        <span style={{ color: 'var(--ink2)' }}>Mortgage Liabilities</span>
                        <span style={{ color: 'var(--rouge)', fontWeight: 500 }}>{fmt(mortgageLiabTotal)}</span>
                      </div>
                      <div className="flex justify-between pt-3 text-sm font-semibold" style={{ color: totalPropertyEquity >= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
                        <span className="text-xs font-sans font-medium" style={{ color: 'var(--ink)' }}>Net Property Equity</span>
                        <span>{fmt(totalPropertyEquity)}</span>
                      </div>
                    </>
                  )}
                </div>
                {/* Retirement Alignment */}
                <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                  <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Retirement Alignment</div>
                  {([
                    { label: clientName, endAge: latestMortgageEndAge, retireKey: 'retirement_age' as keyof FactFinding, retireVal: ff.retirement_age },
                    ...(isCouple ? [{ label: spouseName, endAge: latestMortgageEndAge2, retireKey: 'retirement_age2' as keyof FactFinding, retireVal: ff.retirement_age2 }] : [])
                  ]).map((person, i, arr) => {
                    const diff = person.endAge && person.retireVal ? person.retireVal - person.endAge : null
                    const ok = diff !== null && diff >= 0
                    return (
                      <div key={person.label} style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none', paddingBottom: i < arr.length - 1 ? 12 : 0, marginBottom: i < arr.length - 1 ? 12 : 0 }}>
                        {isCouple && <div className="text-xs font-medium mb-2" style={{ color: 'var(--gold-tag)' }}>{person.label}</div>}
                        <div className="flex justify-between items-center py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                          <span style={{ color: 'var(--ink2)' }}>Mortgage End Age</span>
                          <span style={{ color: 'var(--ink)', fontWeight: 600, fontSize: 14 }}>{person.endAge ?? '—'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1.5 text-xs">
                          <span style={{ color: 'var(--ink2)' }}>Planned Retirement Age</span>
                          <input
                            type="number"
                            value={person.retireVal || ''}
                            onChange={e => upd(person.retireKey, parseInt(e.target.value) || undefined)}
                            placeholder="65"
                            className="text-xs text-right outline-none px-1"
                            style={{ width: 48, border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontWeight: 600, fontSize: 14 }}
                            onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                            onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')}
                          />
                        </div>
                        {diff !== null ? (
                          <div className="mt-2 px-2.5 py-2 text-xs font-medium text-center"
                            style={{
                              background: ok ? 'rgba(80,160,120,0.1)' : 'rgba(200,80,80,0.08)',
                              color: ok ? 'var(--emerald)' : 'var(--rouge)',
                              border: `1px solid ${ok ? 'rgba(80,160,120,0.3)' : 'rgba(200,80,80,0.2)'}`,
                            }}>
                            {ok
                              ? `✓ Paid off ${diff} yr${diff === 1 ? '' : 's'} before retirement`
                              : `✗ Outlasts retirement by ${Math.abs(diff)} yr${Math.abs(diff) === 1 ? '' : 's'}`}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-center" style={{ color: 'var(--ink3)' }}>
                            {allProperties.length === 0 ? 'Add properties first.' : 'Enter retirement age above.'}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {/* Lock-in alerts */}
                {allProperties.some(p => {
                  const d = parseMonthYear(p.lockInExpiry || '')
                  return d && d < new Date(new Date().setMonth(new Date().getMonth() + 6))
                }) && (
                  <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                    <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--rouge)' }}>Lock-in Alerts</div>
                    {allProperties.filter(p => {
                      const d = parseMonthYear(p.lockInExpiry || '')
                      return d && d < new Date(new Date().setMonth(new Date().getMonth() + 6))
                    }).map(p => {
                      const d = parseMonthYear(p.lockInExpiry || '')!
                      const expired = d < new Date()
                      return (
                        <div key={p.id} className="flex items-start gap-2 py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                          <span style={{ color: expired ? 'var(--rouge)' : '#8A6C3A' }}>{expired ? '🔴' : '⚠'}</span>
                          <div>
                            <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{p.label || 'Unnamed'}</div>
                            <div style={{ color: expired ? 'var(--rouge)' : '#8A6C3A' }}>
                              {expired ? 'Lock-in expired' : 'Expiring'} {p.lockInExpiry}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeSection === 'liabilities' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
            <div className="space-y-4">
              <AssetBlock title="SHORT TERM (<5 years)" color="var(--rouge)" total={stTotal} isCouple={isCouple} clientName={clientName} spouseName={spouseName}>
                {assetRow('Credit Card / Credit Line', 'l_credit_card', 'l2_credit_card')}
                {assetRow('Business Loan', 'l_business_loan', 'l2_business_loan')}
                {assetRow('Renovation Loan', 'l_renovation_st', 'l2_renovation_st')}
                <CustomRows items={ff.l_st_custom || []} onChange={v => upd('l_st_custom', v)} placeholder="e.g. Personal Line of Credit" isCouple={isCouple} />
              </AssetBlock>
              <AssetBlock title="LONG TERM (>5 years)" color="#8A5E3A" total={ltTotal} isCouple={isCouple} clientName={clientName} spouseName={spouseName}>
                {assetRow('Car / Motor Vehicle Loan', 'l_car_loan', 'l2_car_loan')}
                {assetRow('Study Loan', 'l_study_loan', 'l2_study_loan')}
                {assetRow('Personal Loan', 'l_personal_loan', 'l2_personal_loan')}
                {assetRow('Renovation Loan', 'l_renovation_lt', 'l2_renovation_lt')}
                <CustomRows items={ff.l_lt_custom || []} onChange={v => upd('l_lt_custom', v)} placeholder="e.g. BNPL, Other Loan" isCouple={isCouple} />
              </AssetBlock>
              {/* Mortgage Liabilities — pulled from Properties tab */}
              <div style={{ background: 'white', border: '1px solid var(--line)' }}>
                <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)', borderLeft: '3px solid var(--rouge)' }}>
                  <span className="text-sm font-medium" style={{ color: 'var(--rouge)' }}>MORTGAGE LIABILITIES</span>
                  <span className="text-xs" style={{ color: 'var(--ink3)' }}>From Properties tab · read-only</span>
                </div>
                <div className="px-5 py-2">
                  {allProperties.length === 0 ? (
                    <div className="py-4 text-xs text-center" style={{ color: 'var(--ink3)' }}>No mortgages recorded — add properties in the Properties tab.</div>
                  ) : (
                    allProperties.filter(p => p.outstanding).map(p => (
                      <div key={p.id} className="flex items-center justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                        <div>
                          <div style={{ color: 'var(--ink2)' }}>{p.label || 'Unnamed'}</div>
                          <div style={{ color: 'var(--ink3)' }}>{p.bank || ''}{p.interestRate ? ` · ${p.interestRate}% ${p.loanType || ''}` : ''}</div>
                        </div>
                        <span style={{ color: 'var(--rouge)', fontWeight: 500 }}>{fmt(p.outstanding || 0)}</span>
                      </div>
                    ))
                  )}
                  {mortgageLiabTotal > 0 && (
                    <div className="flex justify-between py-2 text-xs font-semibold" style={{ color: 'var(--rouge)' }}>
                      <span>Total Mortgage Liabilities</span><span>{fmt(mortgageLiabTotal)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-4" style={{ position: 'sticky', top: 24 }}>
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Liability Breakdown</div>
                <LiabilityDonut items={[
                  { label: 'Mortgages', val: mortgageLiabTotal, color: '#E08080' },
                  { label: 'Car Loan', val: ff.l_car_loan||0, color: '#C4A464' },
                  { label: 'Credit Card', val: ff.l_credit_card||0, color: '#7A6AAA' },
                  { label: 'Personal Loan', val: ff.l_personal_loan||0, color: '#4A7C9E' },
                  { label: 'Study Loan', val: ff.l_study_loan||0, color: 'var(--emerald)' },
                  { label: 'Others', val: (ff.l_business_loan||0)+(ff.l_renovation_st||0)+(ff.l_renovation_lt||0)+ltCustom+stCustom, color: '#9A9690' },
                ]} />
              </div>
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Summary</div>
                {[{label:'Short Term (<5yr)',val:stTotal,color:'var(--rouge)'},{label:'Long Term (>5yr)',val:ltTotal,color:'#8A5E3A'}].map(r=>(
                  <div key={r.label} className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                    <span style={{ color: 'var(--ink2)' }}>{r.label}</span><span style={{ color: r.color, fontWeight: 500 }}>{fmt(r.val)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-3 font-semibold text-sm mb-4" style={{ color: 'var(--rouge)', borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
                  <span>Total Liabilities</span><span>{fmt(totalLiab)}</span>
                </div>
                {totalAssets > 0 && (<>
                  <div className="text-xs mb-2" style={{ color: 'var(--ink3)' }}>Debt-to-Asset Ratio</div>
                  <div className="h-2.5 rounded-full overflow-hidden mb-1" style={{ background: 'var(--line)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width:`${Math.min(pct(totalLiab,totalAssets),100)}%`, background: totalLiab/totalAssets>0.5?'var(--rouge)':totalLiab/totalAssets>0.3?'#C4A464':'var(--emerald)' }} />
                  </div>
                  <div className="flex justify-between text-xs" style={{ color: 'var(--ink3)' }}>
                    <span>{pct(totalLiab,totalAssets)}% of assets</span>
                    <span style={{ color: totalLiab/totalAssets>0.5?'var(--rouge)':totalLiab/totalAssets>0.3?'#C4A464':'var(--emerald)' }}>
                      {totalLiab/totalAssets>0.5?'High':totalLiab/totalAssets>0.3?'Moderate':'Healthy'}
                    </span>
                  </div>
                  <div className="flex justify-between pt-3 font-serif text-xl mt-3" style={{ color: netWorth>=0?'var(--emerald)':'var(--rouge)', borderTop: '1px solid var(--line)' }}>
                    <span className="text-sm font-sans font-medium" style={{ color: 'var(--ink)' }}>Net Worth</span>
                    <span>{netWorth>=0?'':'−'}{fmt(Math.abs(netWorth))}</span>
                  </div>
                </>)}
              </div>
            </div>
          </div>
        )}

        {activeSection === 'risk' && (
          <div style={{ display: 'grid', gridTemplateColumns: isCouple?'1fr 1fr':'1fr 340px', gap: 20, alignItems: 'start' }}>
            <div className="space-y-5">
              {isCouple && <div className="text-sm font-medium px-4 py-2" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.2)' }}>{clientName}</div>}
              <Card title="Risk Tolerance">
                <Lbl>Risk Profile</Lbl>
                <div className="flex gap-2 mt-1">
                  {['Conservative','Moderate','Balanced','Growth','Aggressive'].map(r=>(
                    <button key={r} onClick={()=>updP('person1','risk_profile',r)} className="flex-1 py-2.5 text-xs font-medium"
                      style={{ border:p1.risk_profile===r?`1.5px solid ${RISK_COLORS[r]}`:'1px solid var(--line)', background:p1.risk_profile===r?RISK_COLORS[r]+'18':'white', color:p1.risk_profile===r?RISK_COLORS[r]:'var(--ink3)' }}>{r}</button>
                  ))}
                </div>
              </Card>
              <Card title="Investment Experience">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Sel label="Experience" value={p1.investment_experience} onChange={v=>updP('person1','investment_experience',v)} options={['None','Beginner (<2yr)','Intermediate (2-5yr)','Experienced (5-10yr)','Advanced (10+yr)']} />
                  <Sel label="Horizon" value={p1.investment_horizon} onChange={v=>updP('person1','investment_horizon',v)} options={['Short (<3yr)','Medium (3-7yr)','Long (7-15yr)','Very Long (15+yr)']} />
                </div>
              </Card>
            </div>
            {isCouple ? (
              <div className="space-y-5">
                <div className="text-sm font-medium px-4 py-2" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.2)' }}>{spouseName}</div>
                <Card title="Risk Tolerance">
                  <Lbl>Risk Profile</Lbl>
                  <div className="flex gap-2 mt-1">
                    {['Conservative','Moderate','Balanced','Growth','Aggressive'].map(r=>(
                      <button key={r} onClick={()=>updP('person2','risk_profile',r)} className="flex-1 py-2.5 text-xs font-medium"
                        style={{ border:p2.risk_profile===r?`1.5px solid ${RISK_COLORS[r]}`:'1px solid var(--line)', background:p2.risk_profile===r?RISK_COLORS[r]+'18':'white', color:p2.risk_profile===r?RISK_COLORS[r]:'var(--ink3)' }}>{r}</button>
                    ))}
                  </div>
                </Card>
                <Card title="Investment Experience">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <Sel label="Experience" value={p2.investment_experience} onChange={v=>updP('person2','investment_experience',v)} options={['None','Beginner (<2yr)','Intermediate (2-5yr)','Experienced (5-10yr)','Advanced (10+yr)']} />
                    <Sel label="Horizon" value={p2.investment_horizon} onChange={v=>updP('person2','investment_horizon',v)} options={['Short (<3yr)','Medium (3-7yr)','Long (7-15yr)','Very Long (15+yr)']} />
                  </div>
                </Card>
              </div>
            ) : (
              p1.risk_profile && (
                <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                  <div className="text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Profile</div>
                  <div className="font-serif text-2xl mb-2" style={{ color: RISK_COLORS[p1.risk_profile]||'var(--ink)' }}>{p1.risk_profile}</div>
                  <div className="text-xs leading-relaxed" style={{ color: 'var(--ink2)' }}>
                    {p1.risk_profile==='Conservative'&&'Preserves capital. Bonds, money markets, fixed deposits.'}
                    {p1.risk_profile==='Moderate'&&'Accepts modest fluctuations. Balanced mix of bonds and equities.'}
                    {p1.risk_profile==='Balanced'&&'Comfortable with medium-term volatility. Diversified portfolio.'}
                    {p1.risk_profile==='Growth'&&'Capital appreciation focus. Higher equity allocation.'}
                    {p1.risk_profile==='Aggressive'&&'Maximum growth. Predominantly equities incl. emerging markets.'}
                  </div>
                  {p1.investment_horizon&&<div className="mt-3 pt-3 text-xs" style={{ borderTop:'1px solid var(--line)',color:'var(--ink3)' }}>Horizon: <span style={{ color:'var(--ink2)',fontWeight:500 }}>{p1.investment_horizon}</span></div>}
                </div>
              )
            )}
          </div>
        )}

        {activeSection === 'health' && (
          <div style={{ display: 'grid', gridTemplateColumns: isCouple?'1fr 1fr':'1fr 340px', gap: 20, alignItems: 'start' }}>
            {[{person:'person1' as const,p:p1,name:clientName},...(isCouple?[{person:'person2' as const,p:p2,name:spouseName}]:[])].map(({person,p,name})=>(
              <Card key={person} title="Health Declarations" subtitle={isCouple?name:undefined}>
                <div className="space-y-5">
                  <div>
                    <Lbl>Smoking Status</Lbl>
                    <div className="flex gap-3 mt-1">
                      {[{label:'Non-Smoker',val:false},{label:'Smoker',val:true}].map(opt=>(
                        <button key={opt.label} onClick={()=>updP(person,'smoker',opt.val)} className="px-5 py-2.5 text-sm"
                          style={{ border:p.smoker===opt.val?'1.5px solid var(--gold)':'1px solid var(--line)', background:p.smoker===opt.val?'var(--gold-l)':'white', color:p.smoker===opt.val?'var(--gold-tag)':'var(--ink3)' }}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {p.smoker&&<div className="mt-2 text-xs px-3 py-2" style={{ background:'var(--rouge-l)',color:'var(--rouge)' }}>Smoker loadings ~25–50% on life and CI premiums.</div>}
                  </div>
                  <div>
                    <Lbl>Pre-existing Conditions</Lbl>
                    <textarea value={p.pre_existing??''} onChange={e=>updP(person,'pre_existing',e.target.value)} rows={4}
                      placeholder="Conditions, surgeries, medications, family history…"
                      className="w-full px-3 py-2.5 text-sm outline-none resize-none"
                      style={{ border:'1px solid var(--line)',background:'white',color:'var(--ink)' }}
                      onFocus={e=>(e.currentTarget.style.borderColor='var(--gold)')}
                      onBlur={e=>(e.currentTarget.style.borderColor='var(--line)')} />
                  </div>
                </div>
              </Card>
            ))}
            {!isCouple&&(
              <div style={{ background:'var(--gold-l)',border:'1px solid rgba(168,131,74,0.2)',padding:'16px 20px' }}>
                <div className="text-xs tracking-widest uppercase mb-1" style={{ color:'var(--gold-tag)' }}>Disclosure Reminder</div>
                <div className="text-xs leading-relaxed" style={{ color:'var(--ink2)' }}>Clients are under duty of disclosure. Non-disclosure may result in policy avoidance. If in doubt, declare.</div>
              </div>
            )}
          </div>
        )}

        {activeSection === 'notes' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
            <Card title="Advisor Notes" subtitle="Private — not shared with client">
              <textarea value={ff.advisor_notes??''} onChange={e=>upd('advisor_notes',e.target.value)} rows={14}
                placeholder="Observations, priorities, follow-up items, next steps…"
                className="w-full px-3 py-2.5 text-sm outline-none resize-none"
                style={{ border:'1px solid var(--line)',background:'white',color:'var(--ink)' }}
                onFocus={e=>(e.currentTarget.style.borderColor='var(--gold)')}
                onBlur={e=>(e.currentTarget.style.borderColor='var(--line)')} />
            </Card>
            <div style={{ background:'white',border:'1px solid var(--line)',padding:'20px 24px' }}>
              <div className="text-xs tracking-widest uppercase mb-3" style={{ color:'var(--ink3)' }}>Summary</div>
              {[
                { label:'Mode', val:isCouple?'Couple':'Single' },
                { label:'Client Gross/mo', val:p1.gross_monthly?fmt(p1.gross_monthly):'—' },
                { label:isCouple?'Spouse Gross/mo':'', val:isCouple&&p2.gross_monthly?fmt(p2.gross_monthly):'' },
                { label:'Combined Income/mo', val:moTotal>0?fmt(moTotal):'—' },
                { label:'Combined Income/yr', val:anTotal>0?fmt(anTotal):'—' },
                { label:'Total Expenses/mo', val:moExpNoCpf>0?fmt(moExpNoCpf):'—' },
                { label:'Net Surplus/yr', val:anTotal>0||annExpNoCpf>0?fmt(anTotal-annExpNoCpf):'—' },
                { label:'Total Assets', val:totalAssets>0?fmt(totalAssets):'—' },
                { label:'Total Liabilities', val:totalLiab>0?fmt(totalLiab):'—' },
                { label:'Net Worth', val:(totalAssets+totalLiab)>0?fmt(netWorth):'—' },
                { label:'Risk (Client)', val:p1.risk_profile||'—' },
                { label:isCouple?'Risk (Spouse)':'', val:isCouple?(p2.risk_profile||'—'):'' },
              ].filter(r=>r.label).map(r=>(
                <div key={r.label} className="flex justify-between py-2 text-xs" style={{ borderBottom:'1px solid var(--line)' }}>
                  <span style={{ color:'var(--ink3)' }}>{r.label}</span>
                  <span style={{ color:'var(--ink)',fontWeight:500 }}>{r.val}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
