'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────
interface OtherIncomeItem { label: string; amount: number }
interface CustomAssetItem { label: string; amount: number }

interface PersonData {
  // Employment
  occupation?: string
  employer?: string
  employment_type?: string
  citizenship?: string        // 'SC' | 'PR' | 'Foreigner'
  pr_year?: string            // '1' | '2' | '3+'
  // Income
  gross_monthly?: number
  gross_bonus?: number
  other_incomes?: OtherIncomeItem[]
  // Risk
  risk_profile?: string
  investment_experience?: string
  investment_horizon?: string
  // Health
  smoker?: boolean
  pre_existing?: string
}

interface FactFinding {
  client_id: string
  mode?: 'single' | 'couple'  // single or couple view
  person1?: PersonData
  person2?: PersonData
  // Expenses (shared or per person)
  expense_mode?: 'simple' | 'detailed'
  expense_view?: 'combined' | 'split'
  // Simple expenses
  s_financial?: number
  s_mortgage?: number
  s_household?: number
  s_personal?: number
  s_children?: number
  s_lifestyle?: number
  // P2 simple expenses (if split)
  s2_financial?: number
  s2_mortgage?: number
  s2_household?: number
  s2_personal?: number
  s2_children?: number
  s2_lifestyle?: number
  // Detailed expenses (combined)
  d_mortgage_cpf?: number; d_mortgage_cash?: number; d_vehicle_repay?: number
  d_personal_loan_repay?: number; d_rental_expense?: number; d_income_tax?: number
  d_insurance?: number; d_regular_savings?: number
  d_conservancy?: number; d_utilities?: number; d_family_food?: number
  d_maid?: number; d_other_household?: number
  d_personal_food?: number; d_transport?: number; d_car_petrol?: number; d_car_insurance?: number
  d_childcare?: number; d_school_fees?: number; d_school_transport?: number
  d_allowance_children?: number; d_other_children?: number
  d_holidays?: number; d_hobbies?: number; d_allowance_parents?: number; d_others_lifestyle?: number
  // Assets - standard
  a_savings?: number; a_fixed_deposit?: number
  a_cpf_oa?: number; a_cpf_sa?: number; a_cpf_ma?: number; a_cpf_ra?: number
  a_srs?: number; a_shares?: number; a_etf?: number; a_unit_trust?: number
  a_bonds?: number; a_alternatives?: number
  a_inv_property_res?: number; a_inv_property_com?: number; a_business?: number
  a_residential?: number; a_vehicles?: number; a_club?: number
  // Assets - custom rows per category
  a_cash_custom?: CustomAssetItem[]
  a_invested_custom?: CustomAssetItem[]
  a_personal_custom?: CustomAssetItem[]
  // Liabilities
  l_credit_card?: number; l_business_loan?: number; l_renovation_st?: number
  l_mortgage_residing?: number; l_mortgage_investment?: number; l_car_loan?: number
  l_study_loan?: number; l_personal_loan?: number; l_renovation_lt?: number
  l_lt_custom?: CustomAssetItem[]
  l_st_custom?: CustomAssetItem[]
  // Notes
  advisor_notes?: string
}

interface Client { id: string; name: string; age?: number; citizenship?: string; dob?: string }
interface FamilyMember { id: string; name: string; relationship: string; age?: number }
interface CpfTier { max_age: number; employee: number; employer: number; oa: number; sa: number; ma: number }
interface CpfConfig { ow_ceiling: number; annual_ceiling: number; effective_date: string; sc_rates: CpfTier[] }

// ─── CPF Config (Jan 2026 rates) ──────────────────────────────────────────────
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

// PR graduated rates (no changes in 2026)
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
  if (!['SC', 'PR'].includes(citizenship)) return null
  let tiers = config.sc_rates
  if (citizenship === 'PR') {
    if (prYear === '1') tiers = PR_YEAR1_RATES
    else if (prYear === '2') tiers = PR_YEAR2_RATES
    // 3+ uses sc_rates same as SC
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

// ─── Expense benchmarks (Singapore DOS avg household, per month) ──────────────
const BENCHMARKS: Record<string, number> = {
  financial: 2200,   // financial obligations
  mortgage: 1500,    // mortgage/rent
  household: 1800,   // household & living
  personal: 800,     // personal expenses
  children: 600,     // children
  lifestyle: 500,    // lifestyle & misc
}

// ─── Formatting ───────────────────────────────────────────────────────────────
const fmt = (n: number) => {
  if (n === undefined || n === null || isNaN(n) || !isFinite(n)) return 'S$0'
  return 'S$' + Math.round(n).toLocaleString()
}
const pct = (n: number, t: number) => t > 0 ? Math.round((n / t) * 100) : 0

const EXP_CATEGORIES = [
  {
    id: 'financial', label: 'Financial Obligations', color: '#E08080',
    hint: 'Income tax, insurance premiums, regular investments/savings',
    key: 's_financial' as const,
  },
  {
    id: 'mortgage', label: 'Mortgage / Rent', color: '#C4A464',
    hint: 'Home loan repayment (CPF + cash), rental payments',
    key: 's_mortgage' as const,
  },
  {
    id: 'household', label: 'Household & Living', color: '#4A7C9E',
    hint: 'Conservancy fees, utilities, groceries, maid salary',
    key: 's_household' as const,
  },
  {
    id: 'personal', label: 'Personal Expenses', color: '#7A6AAA',
    hint: 'Personal food & dining, transport, car expenses',
    key: 's_personal' as const,
  },
  {
    id: 'children', label: 'Children Expenses', color: 'var(--emerald)',
    hint: 'Childcare, school & tuition fees, transport, pocket money',
    key: 's_children' as const,
  },
  {
    id: 'lifestyle', label: 'Lifestyle & Miscellaneous', color: '#9A7C5A',
    hint: 'Holidays, hobbies, allowance to parents, donations, shopping',
    key: 's_lifestyle' as const,
  },
]

const SECTIONS = [
  { id: 'income',      label: 'Income',      icon: '◈' },
  { id: 'expenses',    label: 'Expenses',    icon: '◉' },
  { id: 'assets',      label: 'Assets',      icon: '◲' },
  { id: 'liabilities', label: 'Liabilities', icon: '◇' },
  { id: 'risk',        label: 'Risk Profile',icon: '◎' },
  { id: 'health',      label: 'Health',      icon: '⊞' },
  { id: 'notes',       label: 'Notes',       icon: '⊡' },
]

// ─── UI Atoms ─────────────────────────────────────────────────────────────────
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

// Mini bar chart for expenses
function ExpenseBar({ label, amount, benchmark, color, total }: { label: string; amount: number; benchmark: number; color: string; total: number }) {
  const amtPct = total > 0 ? Math.min((amount / total) * 100, 100) : 0
  const overBenchmark = amount > benchmark
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs" style={{ color: 'var(--ink2)' }}>{label}</div>
        <div className="flex items-center gap-2 text-xs">
          <span style={{ color: overBenchmark ? 'var(--rouge)' : 'var(--emerald)', fontWeight: 500 }}>{fmt(amount)}</span>
          <span style={{ color: 'var(--ink3)' }}>vs {fmt(benchmark)} avg</span>
          {overBenchmark && <span style={{ color: 'var(--rouge)', fontSize: 9 }}>▲ HIGH</span>}
        </div>
      </div>
      <div className="h-2 rounded-full overflow-hidden relative" style={{ background: 'var(--line)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${amtPct}%`, background: color }} />
      </div>
    </div>
  )
}

// Donut-style pie for liabilities
function LiabilityDonut({ items }: { items: { label: string; val: number; color: string }[] }) {
  const total = items.reduce((s, i) => s + i.val, 0)
  if (total === 0) return <div className="text-xs text-center py-4" style={{ color: 'var(--ink3)' }}>No liabilities entered</div>
  let cumPct = 0
  const segments = items.filter(i => i.val > 0).map(i => {
    const p = (i.val / total) * 100
    const start = cumPct; cumPct += p
    return { ...i, pct: p, start }
  })
  // SVG donut
  const r = 40, cx = 50, cy = 50, stroke = 22
  const circ = 2 * Math.PI * r
  return (
    <div>
      <div className="flex justify-center mb-3">
        <svg viewBox="0 0 100 100" width={120} height={120}>
          {segments.map((s, i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color}
              strokeWidth={stroke}
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
            <div style={{ color: 'var(--ink)', fontWeight: 500 }}>
              {fmt(s.val)} <span style={{ color: 'var(--ink3)' }}>({Math.round(s.pct)}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── CPF Card Component ───────────────────────────────────────────────────────
function CpfCard({ p, age, config, label }: { p: PersonData; age: number; config: CpfConfig; label?: string }) {
  const cit = p.citizenship || 'SC'
  const prY = p.pr_year || '3+'
  const gross = p.gross_monthly || 0
  const bonus = p.gross_bonus || 0
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
        <div>
          <div className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>
            {label ? label + ' — ' : ''}CPF Breakdown
          </div>
        </div>
        <div className="text-xs px-2 py-1" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)' }}>
          Age {age}{prLabel} · {cpf.tier?.employee}% / {cpf.tier?.employer}%
        </div>
      </div>
      {gross > config.ow_ceiling && (
        <div className="text-xs px-3 py-2 mb-3" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.2)' }}>
          OW capped at {fmt(config.ow_ceiling)}
        </div>
      )}
      {/* Header */}
      <div className="flex pb-2 text-xs" style={{ borderBottom: '2px solid var(--line2)', color: 'var(--ink3)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>
        <div className="flex-1"></div>
        <div className="w-24 text-right">Monthly</div>
        <div className="w-28 text-right">Annual</div>
      </div>
      {/* Employee deduction */}
      <div className="py-1.5 text-xs font-medium mt-1" style={{ color: 'var(--ink3)', borderBottom: '1px solid var(--line)' }}>
        Employee ({cpf.tier?.employee}%)
      </div>
      {[
        { label: '→ Ordinary (OA)', mo: cpf.oa, color: 'var(--emerald)' },
        { label: '→ Special (SA)', mo: cpf.sa, color: '#4A7C9E' },
        { label: '→ MediSave (MA)', mo: cpf.ma, color: '#7A6AAA' },
      ].map(r => (
        <div key={r.label} className="flex items-center py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex-1 flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }}></div>
            <span style={{ color: 'var(--ink2)' }}>{r.label}</span>
          </div>
          <div className="w-24 text-right" style={{ color: r.color, fontWeight: 500 }}>{fmt(r.mo)}</div>
          <div className="w-28 text-right" style={{ color: r.color, fontWeight: 500 }}>{fmt(r.mo * 12)}</div>
        </div>
      ))}
      <div className="flex items-center py-1.5 text-xs font-medium" style={{ borderBottom: '1px solid var(--line2)' }}>
        <div className="flex-1" style={{ color: 'var(--ink)' }}>Total Employee (deducted)</div>
        <div className="w-24 text-right" style={{ color: 'var(--rouge)' }}>− {fmt(cpf.employee)}</div>
        <div className="w-28 text-right" style={{ color: 'var(--rouge)' }}>− {fmt(anEmployee)}</div>
      </div>
      {/* Employer contribution */}
      <div className="py-1.5 text-xs font-medium mt-1" style={{ color: 'var(--ink3)', borderBottom: '1px solid var(--line)' }}>
        Employer ({cpf.tier?.employer}%) — added to CPF
      </div>
      <div className="flex items-center py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex-1" style={{ color: 'var(--ink2)' }}>Total Employer CPF</div>
        <div className="w-24 text-right" style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(cpf.employer)}</div>
        <div className="w-28 text-right" style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(anEmployer)}</div>
      </div>
      {/* Total annual CPF OA/SA/MA */}
      <div className="py-1.5 text-xs font-medium mt-1" style={{ color: 'var(--ink3)', borderBottom: '1px solid var(--line)' }}>
        Total credited to CPF (Emp + Employer/yr)
      </div>
      {[
        { label: 'OA', mo: cpf.oa, color: 'var(--emerald)' },
        { label: 'SA', mo: cpf.sa, color: '#4A7C9E' },
        { label: 'MA', mo: cpf.ma, color: '#7A6AAA' },
      ].map(r => (
        <div key={r.label} className="flex items-center py-1 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex-1 flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }}></div>
            <span style={{ color: 'var(--ink2)' }}>{r.label} (annual)</span>
          </div>
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

// ─── Income Summary Row ───────────────────────────────────────────────────────
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

// ─── Custom Asset/Liability Row Manager ──────────────────────────────────────
function CustomRows({ items, onChange, placeholder }: {
  items: CustomAssetItem[]; onChange: (items: CustomAssetItem[]) => void; placeholder?: string
}) {
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
      <button onClick={() => onChange([...items, { label: '', amount: 0 }])}
        className="mt-2 text-xs px-3 py-1.5"
        style={{ color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.3)', background: 'var(--gold-l)' }}>
        + Add Row
      </button>
    </div>
  )
}

// ─── Standard asset input row ─────────────────────────────────────────────────
function AssetRow({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center py-2 text-xs gap-3" style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="flex-1" style={{ color: 'var(--ink2)' }}>{label}</div>
      <div className="relative" style={{ width: 140 }}>
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
        <input type="number" value={value || ''} onChange={e => onChange(e.target.value)} placeholder="0"
          className="w-full text-xs outline-none py-1.5 text-right pr-2"
          style={{ paddingLeft: 18, border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
      </div>
    </div>
  )
}

// ─── Asset category block ─────────────────────────────────────────────────────
function AssetBlock({ title, color, total, children }: { title: string; color: string; total: number; children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', border: '1px solid var(--line)' }}>
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)', borderLeft: `3px solid ${color}` }}>
        <span className="text-sm font-medium" style={{ color }}>{title}</span>
        <span className="text-xs" style={{ color: 'var(--ink3)' }}>Sub-total: <span style={{ color, fontWeight: 600 }}>{fmt(total)}</span></span>
      </div>
      <div className="px-5 py-3">{children}</div>
    </div>
  )
}

// ─── Person Income Panel ──────────────────────────────────────────────────────
function PersonIncomePanel({ p, onChange, age, config, label }: {
  p: PersonData; onChange: (key: keyof PersonData, val: unknown) => void
  age: number; config: CpfConfig; label: string
}) {
  const n = (v: string) => v === '' ? 0 : parseFloat(v) || 0
  const gross = p.gross_monthly || 0
  const bonus = p.gross_bonus || 0
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
      <div className="px-4 py-2 font-medium text-sm" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.2)' }}>
        {label}
      </div>
      {/* Employment */}
      <Card title="Employment">
        <div className="space-y-3">
          <Field label="Occupation" value={p.occupation} onChange={v => onChange('occupation', v)} placeholder="e.g. Engineer" />
          <Field label="Employer" value={p.employer} onChange={v => onChange('employer', v)} placeholder="e.g. DBS Bank" />
          <Sel label="Employment Type" value={p.employment_type} onChange={v => onChange('employment_type', v)}
            options={['Employed', 'Self-Employed', 'Business Owner', 'Commission-Based', 'Retired', 'Student', 'Homemaker']} />
          <Sel label="Citizenship" value={p.citizenship} onChange={v => onChange('citizenship', v)} options={['SC', 'PR', 'Foreigner']} />
          {p.citizenship === 'PR' && (
            <Sel label="PR Status Year" value={p.pr_year} onChange={v => onChange('pr_year', v)} options={['1', '2', '3+']} />
          )}
        </div>
      </Card>
      {/* Salary */}
      <Card title="Gross Salary" subtitle="Before CPF deductions">
        <div className="space-y-3">
          <Field label="Gross Monthly" value={p.gross_monthly} onChange={v => onChange('gross_monthly', n(v))} type="number" prefix="$" placeholder="0" />
          <Field label="Gross Annual Bonus" value={p.gross_bonus} onChange={v => onChange('gross_bonus', n(v))} type="number" prefix="$" placeholder="0" hint="Total bonus/yr (AWS + variable)" />
        </div>
      </Card>
      {/* Other Income */}
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
            className="text-xs px-3 py-1.5" style={{ color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.3)', background: 'var(--gold-l)' }}>
            + Add Source
          </button>
        </div>
      </Card>
      {/* Income Summary */}
      <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
        <div className="text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Summary</div>
        <div className="flex text-xs pb-2" style={{ borderBottom: '2px solid var(--line2)', color: 'var(--ink3)', fontSize: 9, textTransform: 'uppercase' }}>
          <div className="flex-1"></div>
          <div className="w-28 text-right">Monthly</div>
          <div className="w-32 text-right">Annual</div>
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FactFindingPage() {
  const [client, setClient] = useState<Client | null>(null)
  const [spouse, setSpouse] = useState<FamilyMember | null>(null)
  const [ff, setFf] = useState<FactFinding | null>(null)
  const [cpfConfig, setCpfConfig] = useState<CpfConfig>(DEFAULT_CPF_CONFIG)
  const [activeSection, setActiveSection] = useState('income')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    const { data: cfgRow } = await supabase.from('config').select('value').eq('key', 'cpf_rates').maybeSingle()
    if (cfgRow?.value) setCpfConfig(cfgRow.value as CpfConfig)
    const { data: clients } = await supabase.from('clients').select('*').order('created_at', { ascending: false }).limit(1)
    if (!clients || clients.length === 0) { setLoading(false); return }
    const c = clients[0]; setClient(c)
    // Find spouse from family_members
    const { data: fam } = await supabase.from('family_members').select('*').eq('client_id', c.id)
    const sp = fam?.find((f: FamilyMember) => f.relationship === 'Spouse')
    if (sp) setSpouse(sp)
    const { data: rows } = await supabase.from('fact_finding').select('*').eq('client_id', c.id)
    if (rows && rows.length > 0) {
      const merged: FactFinding = { client_id: c.id }
      for (const row of rows) Object.assign(merged, row.data || {})
      setFf(merged)
    } else {
      setFf({
        client_id: c.id, mode: 'single', expense_mode: 'simple',
        person1: { citizenship: 'SC', pr_year: '3+', other_incomes: [] },
        person2: { citizenship: 'SC', pr_year: '3+', other_incomes: [] },
        a_cash_custom: [], a_invested_custom: [], a_personal_custom: [],
        l_st_custom: [], l_lt_custom: [],
      })
    }
    setLoading(false)
  }

  const upd = useCallback((key: keyof FactFinding, val: unknown) => {
    setFf(prev => prev ? { ...prev, [key]: val } : prev)
    setSaved(false)
  }, [])

  const updP = useCallback((person: 'person1' | 'person2', key: keyof PersonData, val: unknown) => {
    setFf(prev => {
      if (!prev) return prev
      return { ...prev, [person]: { ...prev[person], [key]: val } }
    })
    setSaved(false)
  }, [])

  const n = (v: string): number => v === '' ? 0 : parseFloat(v) || 0

  async function save() {
    if (!ff || !client) return
    setSaving(true)
    const { client_id, ...data } = ff
    await supabase.from('fact_finding').upsert(
      { client_id: client.id, section: 'all', data, updated_at: new Date().toISOString() },
      { onConflict: 'client_id,section' }
    )
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-sm" style={{ color: 'var(--ink3)' }}>Loading…</div></div>
  if (!client) return <div className="flex flex-col items-center justify-center h-full gap-4"><div className="font-serif text-2xl" style={{ color: 'var(--ink)' }}>No Client Selected</div></div>
  if (!ff) return null

  const mode = ff.mode || 'single'
  const isCouple = mode === 'couple'
  const p1 = ff.person1 || {}
  const p2 = ff.person2 || {}
  const age1 = client.age || 35
  const age2 = spouse?.age || 35
  const cpf1 = calcCpf(p1.gross_monthly || 0, p1.gross_bonus || 0, age1, p1.citizenship || 'SC', p1.pr_year || '3+', cpfConfig)
  const cpf2 = isCouple ? calcCpf(p2.gross_monthly || 0, p2.gross_bonus || 0, age2, p2.citizenship || 'SC', p2.pr_year || '3+', cpfConfig) : null
  const other1 = (p1.other_incomes || []).reduce((s, i) => s + (i.amount || 0), 0)
  const other2 = isCouple ? (p2.other_incomes || []).reduce((s, i) => s + (i.amount || 0), 0) : 0
  const mo1 = cpf1.takeHome + other1
  const mo2 = cpf2 ? cpf2.takeHome + other2 : 0
  const moTotal = mo1 + mo2
  const an1 = cpf1.annualTakeHome + other1 * 12
  const an2 = cpf2 ? cpf2.annualTakeHome + other2 * 12 : 0
  const anTotal = an1 + an2

  // Expenses
  const expMode = ff.expense_mode || 'simple'
  const catVals1 = EXP_CATEGORIES.map(c => (ff[c.key] as number) || 0)
  const catVals2 = EXP_CATEGORIES.map(c => {
    const k2 = c.key.replace('s_', 's2_') as keyof FactFinding
    return isCouple ? ((ff[k2] as number) || 0) : 0
  })
  const catTotals = catVals1.map((v, i) => v + catVals2[i])
  const moExp = catTotals.reduce((s, v) => s + v, 0)
  const anExp = moExp * 12

  // Assets
  const cashItems = [ff.a_savings || 0, ff.a_fixed_deposit || 0]
  const cashCustom = (ff.a_cash_custom || []).reduce((s, i) => s + (i.amount || 0), 0)
  const cashTotal = cashItems.reduce((s, v) => s + v, 0) + cashCustom
  const cpfItems = [ff.a_cpf_oa || 0, ff.a_cpf_sa || 0, ff.a_cpf_ma || 0, ff.a_cpf_ra || 0]
  const investedStd = [ff.a_srs || 0, ff.a_shares || 0, ff.a_etf || 0, ff.a_unit_trust || 0, ff.a_bonds || 0, ff.a_alternatives || 0, ff.a_inv_property_res || 0, ff.a_inv_property_com || 0, ff.a_business || 0]
  const investedCustom = (ff.a_invested_custom || []).reduce((s, i) => s + (i.amount || 0), 0)
  const investedTotal = [...cpfItems, ...investedStd].reduce((s, v) => s + v, 0) + investedCustom
  const personalStd = [ff.a_residential || 0, ff.a_vehicles || 0, ff.a_club || 0]
  const personalCustom = (ff.a_personal_custom || []).reduce((s, i) => s + (i.amount || 0), 0)
  const personalTotal = personalStd.reduce((s, v) => s + v, 0) + personalCustom
  const totalAssets = cashTotal + investedTotal + personalTotal
  // Liabilities
  const stItems = [ff.l_credit_card || 0, ff.l_business_loan || 0, ff.l_renovation_st || 0]
  const stCustom = (ff.l_st_custom || []).reduce((s, i) => s + (i.amount || 0), 0)
  const stTotal = stItems.reduce((s, v) => s + v, 0) + stCustom
  const ltItems = [ff.l_mortgage_residing || 0, ff.l_mortgage_investment || 0, ff.l_car_loan || 0, ff.l_study_loan || 0, ff.l_personal_loan || 0, ff.l_renovation_lt || 0]
  const ltCustom = (ff.l_lt_custom || []).reduce((s, i) => s + (i.amount || 0), 0)
  const ltTotal = ltItems.reduce((s, v) => s + v, 0) + ltCustom
  const totalLiab = stTotal + ltTotal
  const netWorth = totalAssets - totalLiab

  const RISK_COLORS: Record<string, string> = { Conservative: 'var(--emerald)', Moderate: '#C4A464', Balanced: '#4A7C9E', Growth: '#7A6AAA', Aggressive: 'var(--rouge)' }

  const assetRow = (label: string, key: keyof FactFinding) => (
    <AssetRow key={label} label={label} value={ff[key] as number} onChange={v => upd(key, n(v))} />
  )

  return (
    <div className="flex flex-col min-h-full">
      {/* ── Hero Band ─────────────────────────────────────────────── */}
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div className="flex items-center gap-4 py-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'rgba(255,255,255,0.28)' }}>Fact Finding</div>
            <div className="font-serif text-2xl font-light" style={{ color: '#F0EDE8' }}>
              {client.name}{isCouple && spouse ? ` & ${spouse.name}` : ''}
            </div>
          </div>
          {/* Mode toggle */}
          <div className="flex gap-1 ml-4">
            {[{ id: 'single', label: '👤 Single' }, { id: 'couple', label: '👫 Couple' }].map(m => (
              <button key={m.id} onClick={() => upd('mode', m.id)}
                className="px-3 py-1.5 text-xs transition-all"
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
                  <div style={{ fontSize: 9, letterSpacing: '0.11em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)', marginBottom: 5 }}>
                    {s.label}
                  </div>
                  <div className="font-serif" style={{ fontSize: 22, fontWeight: 300, lineHeight: 1, color: s.color, letterSpacing: '-0.01em' }}>
                    {s.val}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={save} disabled={saving} className="px-5 py-2 text-sm font-medium"
              style={{ background: saved ? 'var(--emerald)' : saving ? 'rgba(255,255,255,0.1)' : 'rgba(168,131,74,0.9)', color: 'white', border: 'none' }}>
              {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <div className="flex">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className="flex items-center gap-2 px-4 py-3 text-xs tracking-wide"
              style={{ color: activeSection === s.id ? '#C4A464' : 'rgba(255,255,255,0.35)', borderBottom: activeSection === s.id ? '1px solid #C4A464' : '1px solid transparent', background: 'transparent' }}>
              <span>{s.icon}</span>{s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '32px 48px', flex: 1 }}>

        {/* ═══ INCOME ════════════════════════════════════════════════ */}
        {activeSection === 'income' && (
          isCouple ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
                <div className="space-y-4">
                  <PersonIncomePanel p={p1} onChange={(k, v) => updP('person1', k, v)} age={age1} config={cpfConfig} label={`${client.name} (Client)`} />
                  <CpfCard p={p1} age={age1} config={cpfConfig} label={client.name} />
                </div>
                <div className="space-y-4">
                  <PersonIncomePanel p={p2} onChange={(k, v) => updP('person2', k, v)} age={age2} config={cpfConfig} label={spouse?.name || 'Spouse'} />
                  <CpfCard p={p2} age={age2} config={cpfConfig} label={spouse?.name || 'Spouse'} />
                </div>
              </div>
              <div style={{ background: 'white', border: '2px solid var(--gold)', padding: '20px 24px', marginTop: 24 }}>
                <div className="text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--gold-tag)' }}>Combined Income Summary</div>
                <div className="flex text-xs pb-2" style={{ borderBottom: '2px solid var(--line2)', color: 'var(--ink3)', fontSize: 9, textTransform: 'uppercase' }}>
                  <div className="flex-1"></div>
                  <div className="w-28 text-right">Monthly</div>
                  <div className="w-32 text-right">Annual</div>
                </div>
                <SumRow label={client.name} mo={mo1} an={an1} />
                <SumRow label={spouse?.name || 'Spouse'} mo={mo2} an={an2} />
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
              <PersonIncomePanel p={p1} onChange={(k, v) => updP('person1', k, v)} age={age1} config={cpfConfig} label={client.name} />
              <CpfCard p={p1} age={age1} config={cpfConfig} />
            </div>
          )
        )}

        {/* ═══ EXPENSES ══════════════════════════════════════════════ */}
        {activeSection === 'expenses' && (
          <div className="space-y-5">
            {/* Mode + view toggle */}
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
                {expMode === 'simple' ? (
                  <div style={{ background: 'white', border: '1px solid var(--line)' }}>
                    <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                      <div className="font-serif text-lg" style={{ color: 'var(--ink)' }}>Monthly Expenses</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>Enter combined household expenses</div>
                    </div>
                    <div className="px-6 py-5 space-y-0">
                      {EXP_CATEGORIES.map(cat => (
                        <div key={cat.id} className="py-3" style={{ borderBottom: '1px solid var(--line)' }}>
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5" style={{ background: cat.color }}></div>
                                {cat.label}
                              </div>
                              <div className="text-xs mt-0.5 ml-4" style={{ color: 'var(--ink3)' }}>{cat.hint}</div>
                            </div>
                            <div className="relative" style={{ width: 140 }}>
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
                              <input type="number" value={(ff[cat.key] as number) || ''} placeholder="0"
                                onChange={e => upd(cat.key, n(e.target.value))}
                                className="w-full text-sm outline-none py-2 text-right pr-3"
                                style={{ paddingLeft: 28, border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
                                onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                            </div>
                          </div>
                          {isCouple && (
                            <div className="flex items-center justify-end gap-2 mt-1">
                              <div className="text-xs" style={{ color: 'var(--ink3)' }}>
                                Split: {client.name} $
                              </div>
                              <input type="number" value={(ff[cat.key] as number) || ''} placeholder="0"
                                onChange={e => upd(cat.key, n(e.target.value))}
                                className="text-xs outline-none py-1 text-right"
                                style={{ width: 80, border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', paddingRight: 8 }}
                                onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                              <div className="text-xs" style={{ color: 'var(--ink3)' }}>{spouse?.name || 'Spouse'} $</div>
                              <input type="number" value={(ff[cat.key.replace('s_', 's2_') as keyof FactFinding] as number) || ''}
                                placeholder="0" onChange={e => upd(cat.key.replace('s_', 's2_') as keyof FactFinding, n(e.target.value))}
                                className="text-xs outline-none py-1 text-right"
                                style={{ width: 80, border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', paddingRight: 8 }}
                                onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="flex items-center justify-between pt-4">
                        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Total Monthly</span>
                        <div className="flex gap-4">
                          <span className="font-serif text-lg" style={{ color: 'var(--rouge)' }}>{fmt(moExp)}/mo</span>
                          <span className="font-serif text-lg" style={{ color: 'var(--ink2)' }}>{fmt(anExp)}/yr</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* DETAILED */
                  <div className="space-y-4">
                    {[
                      { title: 'Financial Obligations', color: '#E08080', hint: 'Income tax, insurance, regular savings/investments', keys: ['d_mortgage_cpf','d_mortgage_cash','d_vehicle_repay','d_personal_loan_repay','d_rental_expense','d_income_tax','d_insurance','d_regular_savings'], labels: ['Mortgage Loan (CPF OA)','Mortgage Loan (Cash)','Motor Vehicle Repayment','Personal Loan Repayment','Rental Expenses','Income Tax','Insurance Payments','Regular Savings / Investments'] },
                      { title: 'Household & Living', color: '#4A7C9E', hint: 'Conservancy, utilities, food, maid', keys: ['d_conservancy','d_utilities','d_family_food','d_maid','d_other_household'], labels: ['Conservancy / MCST / Property Tax','Utilities & Bills','Family Food & Groceries','Maid Services (incl. Levy)','Other Household Expenses'] },
                      { title: 'Personal Expenses', color: '#7A6AAA', hint: 'Personal dining, transport, car', keys: ['d_personal_food','d_transport','d_car_petrol','d_car_insurance'], labels: ['Personal Food & Groceries','Public Transport','Car Petrol / Parking / Road Tax','Car Insurance'] },
                      { title: 'Children Expenses', color: 'var(--emerald)', hint: 'Childcare, school, transport, pocket money', keys: ['d_childcare','d_school_fees','d_school_transport','d_allowance_children','d_other_children'], labels: ['Childcare / DayCare','School & Tuition Fees','School Transport','Allowance / Pocket Money','Other Children Expenses'] },
                      { title: 'Lifestyle & Miscellaneous', color: '#9A7C5A', hint: 'Holidays, hobbies, parents allowance, donations', keys: ['d_holidays','d_hobbies','d_allowance_parents','d_others_lifestyle'], labels: ['Holidays / Tours','Hobbies / Recreation','Allowance to Parents','Others (Shopping, Tithes, Donations)'] },
                    ].map(group => {
                      const groupTotal = group.keys.reduce((s, k) => s + ((ff[k as keyof FactFinding] as number) || 0), 0)
                      return (
                        <div key={group.title} style={{ background: 'white', border: '1px solid var(--line)' }}>
                          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)', borderLeft: `3px solid ${group.color}` }}>
                            <div>
                              <div className="text-sm font-medium" style={{ color: group.color }}>{group.title}</div>
                              <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>{group.hint}</div>
                            </div>
                            <div className="text-xs" style={{ color: 'var(--ink3)' }}>Sub-total: <span style={{ color: group.color, fontWeight: 600 }}>{fmt(groupTotal)}/mo</span></div>
                          </div>
                          <div className="px-5 py-2">
                            {group.keys.map((k, i) => (
                              <div key={k} className="flex items-center py-2 gap-3" style={{ borderBottom: '1px solid var(--line)' }}>
                                <div className="flex-1 text-xs" style={{ color: 'var(--ink2)' }}>{group.labels[i]}</div>
                                <div className="relative" style={{ width: 130 }}>
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
                                  <input type="number" value={(ff[k as keyof FactFinding] as number) || ''} placeholder="0"
                                    onChange={e => upd(k as keyof FactFinding, n(e.target.value))}
                                    className="w-full text-xs outline-none py-1.5 text-right pr-2"
                                    style={{ paddingLeft: 18, border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
                                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                                </div>
                                <div className="text-xs w-20 text-right" style={{ color: 'var(--ink3)' }}>
                                  {(ff[k as keyof FactFinding] as number) > 0 ? fmt(((ff[k as keyof FactFinding] as number) || 0) * 12) + '/yr' : '—'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Right sidebar — cash flow + benchmark chart */}
              <div className="space-y-4">
                {/* Cash Flow */}
                <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                  <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Cash Flow</div>
                  {[
                    { label: 'Total Income/mo', val: moTotal, color: 'var(--emerald)' },
                    { label: 'Total Expenses/mo', val: moExp, color: 'var(--rouge)' },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                      <span style={{ color: 'var(--ink3)' }}>{r.label}</span>
                      <span style={{ color: r.color, fontWeight: 500 }}>{fmt(r.val)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-3 mb-2">
                    <span className="text-xs" style={{ color: 'var(--ink2)' }}>Surplus / Deficit</span>
                    <span className="font-serif text-xl" style={{ color: moTotal - moExp >= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
                      {moTotal - moExp >= 0 ? '+' : '−'}{fmt(Math.abs(moTotal - moExp))}/mo
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--ink2)' }}>Annual surplus</span>
                    <span className="font-serif text-base" style={{ color: anTotal - anExp >= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
                      {anTotal - anExp >= 0 ? '+' : '−'}{fmt(Math.abs(anTotal - anExp))}/yr
                    </span>
                  </div>
                  {moTotal > 0 && (
                    <div className="mt-3">
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min((moExp / moTotal) * 100, 100)}%`, background: moExp / moTotal > 0.9 ? 'var(--rouge)' : moExp / moTotal > 0.7 ? '#C4A464' : 'var(--emerald)' }} />
                      </div>
                      <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--ink3)' }}>
                        <span>Expense ratio</span>
                        <span>{pct(moExp, moTotal)}%</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Benchmark Chart */}
                <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                  <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>vs Singapore Average</div>
                  <div className="text-xs mb-4" style={{ color: 'var(--ink3)' }}>Based on DOS household expenditure survey</div>
                  {EXP_CATEGORIES.map((cat, i) => (
                    <ExpenseBar key={cat.id} label={cat.label} amount={catTotals[i]} benchmark={BENCHMARKS[cat.id]} color={cat.color} total={moExp || 1} />
                  ))}
                  <div className="mt-2 pt-2 text-xs" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink3)' }}>
                    ▲ HIGH = above Singapore household average
                  </div>
                </div>

                {/* Annual breakdown */}
                <div style={{ background: 'white', border: '1px solid var(--line)', padding: '16px 20px' }}>
                  <div className="text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Annual Breakdown</div>
                  {EXP_CATEGORIES.map((cat, i) => catTotals[i] > 0 && (
                    <div key={cat.id} className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: cat.color }}></div>
                        <span style={{ color: 'var(--ink2)' }}>{cat.label}</span>
                      </div>
                      <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmt(catTotals[i] * 12)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-2 font-semibold text-sm" style={{ color: 'var(--rouge)' }}>
                    <span>Total Annual</span><span>{fmt(anExp)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ ASSETS ════════════════════════════════════════════════ */}
        {activeSection === 'assets' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
            <div className="space-y-4">
              <AssetBlock title="CASH / NEAR CASH" color="var(--emerald)" total={cashTotal}>
                {assetRow('Savings / Current Account(s)', 'a_savings')}
                {assetRow('Fixed Deposit(s)', 'a_fixed_deposit')}
                <CustomRows items={ff.a_cash_custom || []} onChange={v => upd('a_cash_custom', v)} placeholder="e.g. Singapore Savings Bonds" />
              </AssetBlock>
              <AssetBlock title="INVESTED ASSET(S)" color="#4A7C9E" total={investedTotal}>
                {assetRow('CPF Ordinary Account (OA)', 'a_cpf_oa')}
                {assetRow('CPF Special Account (SA)', 'a_cpf_sa')}
                {assetRow('CPF Medisave Account (MA)', 'a_cpf_ma')}
                {assetRow('CPF Retirement Account (RA)', 'a_cpf_ra')}
                {assetRow('SRS', 'a_srs')}
                {assetRow('Shares', 'a_shares')}
                {assetRow('ETF(s)', 'a_etf')}
                {assetRow('Unit Trust(s)', 'a_unit_trust')}
                {assetRow('Bonds / Treasury Bills', 'a_bonds')}
                {assetRow('Alternative Investments (Hedge Funds, Gold, etc.)', 'a_alternatives')}
                {assetRow('Investment Property (Residential)', 'a_inv_property_res')}
                {assetRow('Investment Property (Commercial)', 'a_inv_property_com')}
                {assetRow('Business Venture(s)', 'a_business')}
                <CustomRows items={ff.a_invested_custom || []} onChange={v => upd('a_invested_custom', v)} placeholder="e.g. Crypto, Wine Collection" />
              </AssetBlock>
              <AssetBlock title="PERSONAL USE ASSET(S)" color="#C4A464" total={personalTotal}>
                {assetRow('Residential Property', 'a_residential')}
                {assetRow('Motor Vehicles (Cars, Bikes, Boats)', 'a_vehicles')}
                {assetRow('Club Membership', 'a_club')}
                <CustomRows items={ff.a_personal_custom || []} onChange={v => upd('a_personal_custom', v)} placeholder="e.g. Jewellery, Art" />
              </AssetBlock>
            </div>
            {/* Assets Summary */}
            <div className="space-y-4" style={{ position: 'sticky', top: 24 }}>
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Total Assets</div>
                {[{ label: 'Cash / Near Cash', val: cashTotal, color: 'var(--emerald)' }, { label: 'Invested Assets', val: investedTotal, color: '#4A7C9E' }, { label: 'Personal Use', val: personalTotal, color: '#C4A464' }].map(r => (
                  <div key={r.label} className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ background: r.color }}></div><span style={{ color: 'var(--ink2)' }}>{r.label}</span></div>
                    <span style={{ color: r.color, fontWeight: 500 }}>{fmt(r.val)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-3 font-semibold text-sm" style={{ color: 'var(--emerald)' }}>
                  <span>Total Assets</span><span>{fmt(totalAssets)}</span>
                </div>
              </div>
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Net Worth</div>
                <div className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}><span style={{ color: 'var(--ink2)' }}>Total Assets</span><span style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(totalAssets)}</span></div>
                <div className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}><span style={{ color: 'var(--ink2)' }}>Total Liabilities</span><span style={{ color: 'var(--rouge)', fontWeight: 500 }}>{fmt(totalLiab)}</span></div>
                <div className="flex justify-between pt-3 font-serif text-2xl" style={{ color: netWorth >= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
                  <span className="text-sm font-sans font-medium" style={{ color: 'var(--ink)' }}>Net Worth</span>
                  <span>{netWorth >= 0 ? '' : '−'}{fmt(Math.abs(netWorth))}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ LIABILITIES ═══════════════════════════════════════════ */}
        {activeSection === 'liabilities' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
            <div className="space-y-4">
              <AssetBlock title="SHORT TERM (<5 years)" color="var(--rouge)" total={stTotal}>
                {assetRow('Credit Card / Credit Line', 'l_credit_card')}
                {assetRow('Business Loan', 'l_business_loan')}
                {assetRow('Renovation Loan', 'l_renovation_st')}
                <CustomRows items={ff.l_st_custom || []} onChange={v => upd('l_st_custom', v)} placeholder="e.g. Personal Line of Credit" />
              </AssetBlock>
              <AssetBlock title="LONG TERM (>5 years)" color="#8A5E3A" total={ltTotal}>
                {assetRow('Mortgage Loan – Residing', 'l_mortgage_residing')}
                {assetRow('Mortgage Loan – Investment', 'l_mortgage_investment')}
                {assetRow('Car / Motor Vehicle Loan', 'l_car_loan')}
                {assetRow('Study Loan', 'l_study_loan')}
                {assetRow('Personal Loan', 'l_personal_loan')}
                {assetRow('Renovation Loan', 'l_renovation_lt')}
                <CustomRows items={ff.l_lt_custom || []} onChange={v => upd('l_lt_custom', v)} placeholder="e.g. BNPL, Other Loan" />
              </AssetBlock>
            </div>
            {/* Liabilities Summary + Chart */}
            <div className="space-y-4" style={{ position: 'sticky', top: 24 }}>
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Liability Breakdown</div>
                <LiabilityDonut items={[
                  { label: 'Mortgage (Residing)', val: ff.l_mortgage_residing || 0, color: '#E08080' },
                  { label: 'Mortgage (Investment)', val: ff.l_mortgage_investment || 0, color: '#C47070' },
                  { label: 'Car Loan', val: ff.l_car_loan || 0, color: '#C4A464' },
                  { label: 'Credit Card', val: ff.l_credit_card || 0, color: '#7A6AAA' },
                  { label: 'Personal Loan', val: ff.l_personal_loan || 0, color: '#4A7C9E' },
                  { label: 'Study Loan', val: ff.l_study_loan || 0, color: 'var(--emerald)' },
                  { label: 'Others', val: (ff.l_business_loan || 0) + (ff.l_renovation_st || 0) + (ff.l_renovation_lt || 0) + ltCustom + stCustom, color: '#9A9690' },
                ]} />
              </div>
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Summary</div>
                {[{ label: 'Short Term (<5yr)', val: stTotal, color: 'var(--rouge)' }, { label: 'Long Term (>5yr)', val: ltTotal, color: '#8A5E3A' }].map(r => (
                  <div key={r.label} className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                    <span style={{ color: 'var(--ink2)' }}>{r.label}</span><span style={{ color: r.color, fontWeight: 500 }}>{fmt(r.val)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-3 font-semibold text-sm mb-4" style={{ color: 'var(--rouge)', borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
                  <span>Total Liabilities</span><span>{fmt(totalLiab)}</span>
                </div>
                {totalAssets > 0 && (
                  <>
                    <div className="text-xs mb-2" style={{ color: 'var(--ink3)' }}>Debt-to-Asset Ratio</div>
                    <div className="h-2.5 rounded-full overflow-hidden mb-1" style={{ background: 'var(--line)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct(totalLiab, totalAssets), 100)}%`, background: totalLiab / totalAssets > 0.5 ? 'var(--rouge)' : totalLiab / totalAssets > 0.3 ? '#C4A464' : 'var(--emerald)' }} />
                    </div>
                    <div className="flex justify-between text-xs" style={{ color: 'var(--ink3)' }}>
                      <span>{pct(totalLiab, totalAssets)}% of assets</span>
                      <span style={{ color: totalLiab / totalAssets > 0.5 ? 'var(--rouge)' : totalLiab / totalAssets > 0.3 ? '#C4A464' : 'var(--emerald)' }}>
                        {totalLiab / totalAssets > 0.5 ? 'High' : totalLiab / totalAssets > 0.3 ? 'Moderate' : 'Healthy'}
                      </span>
                    </div>
                    <div className="flex justify-between pt-3 font-serif text-xl mt-3 pt-3" style={{ color: netWorth >= 0 ? 'var(--emerald)' : 'var(--rouge)', borderTop: '1px solid var(--line)' }}>
                      <span className="text-sm font-sans font-medium" style={{ color: 'var(--ink)' }}>Net Worth</span>
                      <span>{netWorth >= 0 ? '' : '−'}{fmt(Math.abs(netWorth))}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ RISK ══════════════════════════════════════════════════ */}
        {activeSection === 'risk' && (
          <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr 340px', gap: 20, alignItems: 'start' }}>
            {/* P1 Risk */}
            <div className="space-y-5">
              {isCouple && <div className="text-sm font-medium px-4 py-2" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.2)' }}>{client.name}</div>}
              <Card title="Risk Tolerance">
                <Lbl>Risk Profile</Lbl>
                <div className="flex gap-2 mt-1">
                  {['Conservative', 'Moderate', 'Balanced', 'Growth', 'Aggressive'].map(r => (
                    <button key={r} onClick={() => updP('person1', 'risk_profile', r)} className="flex-1 py-2.5 text-xs font-medium"
                      style={{ border: p1.risk_profile === r ? `1.5px solid ${RISK_COLORS[r]}` : '1px solid var(--line)', background: p1.risk_profile === r ? RISK_COLORS[r] + '18' : 'white', color: p1.risk_profile === r ? RISK_COLORS[r] : 'var(--ink3)' }}>
                      {r}
                    </button>
                  ))}
                </div>
              </Card>
              <Card title="Investment Experience">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Sel label="Experience" value={p1.investment_experience} onChange={v => updP('person1', 'investment_experience', v)} options={['None', 'Beginner (<2yr)', 'Intermediate (2-5yr)', 'Experienced (5-10yr)', 'Advanced (10+yr)']} />
                  <Sel label="Horizon" value={p1.investment_horizon} onChange={v => updP('person1', 'investment_horizon', v)} options={['Short (<3yr)', 'Medium (3-7yr)', 'Long (7-15yr)', 'Very Long (15+yr)']} />
                </div>
              </Card>
            </div>
            {/* P2 Risk or summary */}
            {isCouple ? (
              <div className="space-y-5">
                <div className="text-sm font-medium px-4 py-2" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.2)' }}>{spouse?.name || 'Spouse'}</div>
                <Card title="Risk Tolerance">
                  <Lbl>Risk Profile</Lbl>
                  <div className="flex gap-2 mt-1">
                    {['Conservative', 'Moderate', 'Balanced', 'Growth', 'Aggressive'].map(r => (
                      <button key={r} onClick={() => updP('person2', 'risk_profile', r)} className="flex-1 py-2.5 text-xs font-medium"
                        style={{ border: p2.risk_profile === r ? `1.5px solid ${RISK_COLORS[r]}` : '1px solid var(--line)', background: p2.risk_profile === r ? RISK_COLORS[r] + '18' : 'white', color: p2.risk_profile === r ? RISK_COLORS[r] : 'var(--ink3)' }}>
                        {r}
                      </button>
                    ))}
                  </div>
                </Card>
                <Card title="Investment Experience">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <Sel label="Experience" value={p2.investment_experience} onChange={v => updP('person2', 'investment_experience', v)} options={['None', 'Beginner (<2yr)', 'Intermediate (2-5yr)', 'Experienced (5-10yr)', 'Advanced (10+yr)']} />
                    <Sel label="Horizon" value={p2.investment_horizon} onChange={v => updP('person2', 'investment_horizon', v)} options={['Short (<3yr)', 'Medium (3-7yr)', 'Long (7-15yr)', 'Very Long (15+yr)']} />
                  </div>
                </Card>
              </div>
            ) : (
              p1.risk_profile && (
                <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                  <div className="text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Profile</div>
                  <div className="font-serif text-2xl mb-2" style={{ color: RISK_COLORS[p1.risk_profile] || 'var(--ink)' }}>{p1.risk_profile}</div>
                  <div className="text-xs leading-relaxed" style={{ color: 'var(--ink2)' }}>
                    {p1.risk_profile === 'Conservative' && 'Preserves capital. Bonds, money markets, fixed deposits.'}
                    {p1.risk_profile === 'Moderate' && 'Accepts modest fluctuations. Balanced mix of bonds and equities.'}
                    {p1.risk_profile === 'Balanced' && 'Comfortable with medium-term volatility. Diversified portfolio.'}
                    {p1.risk_profile === 'Growth' && 'Capital appreciation focus. Higher equity allocation.'}
                    {p1.risk_profile === 'Aggressive' && 'Maximum growth. Predominantly equities incl. emerging markets.'}
                  </div>
                  {p1.investment_horizon && <div className="mt-3 pt-3 text-xs" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink3)' }}>Horizon: <span style={{ color: 'var(--ink2)', fontWeight: 500 }}>{p1.investment_horizon}</span></div>}
                </div>
              )
            )}
          </div>
        )}

        {/* ═══ HEALTH ════════════════════════════════════════════════ */}
        {activeSection === 'health' && (
          <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr 340px', gap: 20, alignItems: 'start' }}>
            {[{ person: 'person1' as const, p: p1, name: client.name, age: age1 }, ...(isCouple ? [{ person: 'person2' as const, p: p2, name: spouse?.name || 'Spouse', age: age2 }] : [])].map(({ person, p, name }) => (
              <Card key={person} title="Health Declarations" subtitle={isCouple ? name : undefined}>
                <div className="space-y-5">
                  <div>
                    <Lbl>Smoking Status</Lbl>
                    <div className="flex gap-3 mt-1">
                      {[{ label: 'Non-Smoker', val: false }, { label: 'Smoker', val: true }].map(opt => (
                        <button key={opt.label} onClick={() => updP(person, 'smoker', opt.val)} className="px-5 py-2.5 text-sm"
                          style={{ border: p.smoker === opt.val ? '1.5px solid var(--gold)' : '1px solid var(--line)', background: p.smoker === opt.val ? 'var(--gold-l)' : 'white', color: p.smoker === opt.val ? 'var(--gold-tag)' : 'var(--ink3)' }}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {p.smoker && <div className="mt-2 text-xs px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>Smoker loadings ~25–50% on life and CI premiums.</div>}
                  </div>
                  <div>
                    <Lbl>Pre-existing Conditions</Lbl>
                    <textarea value={p.pre_existing ?? ''} onChange={e => updP(person, 'pre_existing', e.target.value)} rows={4}
                      placeholder="Conditions, surgeries, medications, family history…"
                      className="w-full px-3 py-2.5 text-sm outline-none resize-none"
                      style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                      onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                      onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                  </div>
                </div>
              </Card>
            ))}
            {!isCouple && (
              <div style={{ background: 'var(--gold-l)', border: '1px solid rgba(168,131,74,0.2)', padding: '16px 20px' }}>
                <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--gold-tag)' }}>Disclosure Reminder</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--ink2)' }}>Clients are under duty of disclosure. Non-disclosure may result in policy avoidance. If in doubt, declare.</div>
              </div>
            )}
          </div>
        )}

        {/* ═══ NOTES ═════════════════════════════════════════════════ */}
        {activeSection === 'notes' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
            <Card title="Advisor Notes" subtitle="Private — not shared with client">
              <textarea value={ff.advisor_notes ?? ''} onChange={e => upd('advisor_notes', e.target.value)} rows={14}
                placeholder="Observations, priorities, follow-up items, next steps…"
                className="w-full px-3 py-2.5 text-sm outline-none resize-none"
                style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
            </Card>
            <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
              <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Summary</div>
              {[
                { label: 'Mode', val: isCouple ? 'Couple' : 'Single' },
                { label: 'Client Gross/mo', val: p1.gross_monthly ? fmt(p1.gross_monthly) : '—' },
                { label: isCouple ? 'Spouse Gross/mo' : '', val: isCouple && p2.gross_monthly ? fmt(p2.gross_monthly) : '' },
                { label: 'Combined Income/mo', val: moTotal > 0 ? fmt(moTotal) : '—' },
                { label: 'Combined Income/yr', val: anTotal > 0 ? fmt(anTotal) : '—' },
                { label: 'Total Expenses/mo', val: moExp > 0 ? fmt(moExp) : '—' },
                { label: 'Net Surplus/yr', val: anTotal > 0 || anExp > 0 ? fmt(anTotal - anExp) : '—' },
                { label: 'Total Assets', val: totalAssets > 0 ? fmt(totalAssets) : '—' },
                { label: 'Total Liabilities', val: totalLiab > 0 ? fmt(totalLiab) : '—' },
                { label: 'Net Worth', val: (totalAssets + totalLiab) > 0 ? fmt(netWorth) : '—' },
                { label: 'Risk (Client)', val: p1.risk_profile || '—' },
                { label: isCouple ? 'Risk (Spouse)' : '', val: isCouple ? (p2.risk_profile || '—') : '' },
              ].filter(r => r.label).map(r => (
                <div key={r.label} className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--ink3)' }}>{r.label}</span>
                  <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{r.val}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
