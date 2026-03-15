'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────
interface OtherIncomeItem { label: string; amount: number }

interface FactFinding {
  client_id: string
  // Employment
  occupation?: string
  employer?: string
  employment_type?: string
  citizenship?: string
  // Income
  gross_monthly?: number
  gross_bonus?: number
  other_incomes?: OtherIncomeItem[]
  // Expenses
  expense_mode?: 'simple' | 'detailed'
  // Simple
  simple_living?: number
  simple_commitments?: number
  simple_savings?: number
  // Detailed – Financial Obligations
  d_mortgage_cpf?: number
  d_mortgage_cash?: number
  d_vehicle_repay?: number
  d_personal_loan_repay?: number
  d_rental_expense?: number
  d_income_tax?: number
  d_insurance?: number
  d_regular_savings?: number
  // Detailed – Household
  d_conservancy?: number
  d_utilities?: number
  d_family_food?: number
  d_maid?: number
  d_other_household?: number
  // Detailed – Personal
  d_personal_food?: number
  d_transport?: number
  d_car_petrol?: number
  d_car_insurance?: number
  // Detailed – Children
  d_childcare?: number
  d_school_fees?: number
  d_school_transport?: number
  d_allowance_children?: number
  d_other_children?: number
  // Detailed – Lifestyle
  d_holidays?: number
  d_hobbies?: number
  d_allowance_parents?: number
  d_others_lifestyle?: number
  // Assets – Cash
  a_savings?: number
  a_fixed_deposit?: number
  // Assets – Invested
  a_cpf_oa?: number
  a_cpf_sa?: number
  a_cpf_ma?: number
  a_cpf_ra?: number
  a_srs?: number
  a_shares?: number
  a_etf?: number
  a_unit_trust?: number
  a_bonds?: number
  a_alternatives?: number
  a_inv_property_res?: number
  a_inv_property_com?: number
  a_business?: number
  // Assets – Personal Use
  a_residential?: number
  a_vehicles?: number
  a_club?: number
  // Liabilities – Short Term
  l_credit_card?: number
  l_business_loan?: number
  l_renovation_loan?: number
  // Liabilities – Long Term
  l_mortgage_residing?: number
  l_mortgage_investment?: number
  l_car_loan?: number
  l_study_loan?: number
  l_personal_loan?: number
  l_renovation_lt?: number
  // Risk
  risk_profile?: string
  investment_experience?: string
  investment_horizon?: string
  // Health
  smoker?: boolean
  pre_existing?: string
  // Notes
  advisor_notes?: string
}

interface Client { id: string; name: string; age?: number; citizenship?: string }
interface CpfTier { max_age: number; employee: number; employer: number; oa: number; sa: number; ma: number }
interface CpfConfig { ow_ceiling: number; annual_ceiling: number; effective_date: string; sc_rates: CpfTier[] }

// ─── CPF Config (Jan 2026) ────────────────────────────────────────────────────
// OA/SA/MA allocation from CPF Board rates (% of wage)
const DEFAULT_CPF_CONFIG: CpfConfig = {
  ow_ceiling: 8000, annual_ceiling: 102000, effective_date: '2026-01-01',
  sc_rates: [
    { max_age: 35,  employee: 20,   employer: 17,   oa: 23,   sa: 6,   ma: 8   },
    { max_age: 45,  employee: 20,   employer: 17,   oa: 21,   sa: 7,   ma: 9   },
    { max_age: 50,  employee: 20,   employer: 17,   oa: 19,   sa: 8,   ma: 10  },
    { max_age: 55,  employee: 20,   employer: 17,   oa: 15,   sa: 11.5, ma: 10.5 },
    { max_age: 60,  employee: 18,   employer: 16,   oa: 12,   sa: 3.5, ma: 10.5 },
    { max_age: 65,  employee: 14.5, employer: 15.5, oa: 3.5,  sa: 0.5, ma: 10.5 },
    { max_age: 70,  employee: 7.5,  employer: 9,    oa: 1,    sa: 0,   ma: 7.5  },
    { max_age: 999, employee: 5,    employer: 7.5,  oa: 1,    sa: 0,   ma: 6.5  },
  ],
}

function getCpfTier(age: number, config: CpfConfig) {
  return config.sc_rates.find(t => age <= t.max_age) || config.sc_rates[config.sc_rates.length - 1]
}

function calcCpf(gross: number, bonus: number, age: number, citizenship: string, config: CpfConfig) {
  if (!['SC', 'PR'].includes(citizenship)) return { employee: 0, employer: 0, takeHome: gross, annualTakeHome: gross * 12 + bonus, owBase: 0, tier: null, oa: 0, sa: 0, ma: 0 }
  const tier = getCpfTier(age, config)
  const owBase = Math.min(gross, config.ow_ceiling)
  const employee = Math.floor(owBase * tier.employee / 100)
  const employer = Math.round(owBase * tier.employer / 100)
  const total = employee + employer
  const oa = Math.round(owBase * tier.oa / 100)
  const sa = Math.round(owBase * tier.sa / 100)
  const ma = total - oa - sa
  const takeHome = gross - employee
  // Annual: 12 months OW + bonus (bonus CPF also applies)
  const bonusCpfEmp = Math.floor(bonus * tier.employee / 100)
  const annualTakeHome = (takeHome * 12) + (bonus - bonusCpfEmp)
  return { employee, employer, takeHome, annualTakeHome, owBase, tier, oa, sa, ma }
}

const fmt = (n: number) => 'S$' + Math.round(n).toLocaleString()
const fmtA = (n: number) => 'S$' + Math.round(n).toLocaleString() // same, for clarity

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

function Field({ label, value, onChange, type = 'text', prefix, placeholder, hint, annual }: {
  label: string; value: string | number | undefined; onChange: (v: string) => void
  type?: string; prefix?: string; placeholder?: string; hint?: string; annual?: boolean
}) {
  return (
    <div>
      <Lbl>{label}{annual && <span className="ml-1 normal-case" style={{ color: 'var(--gold-tag)', fontSize: 9 }}>ANNUAL</span>}</Lbl>
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

function Row({ label, mo, an, highlight, dim, neg }: { label: string; mo: number; an: number; highlight?: boolean; dim?: boolean; neg?: boolean }) {
  const color = highlight ? 'var(--gold)' : neg ? 'var(--rouge)' : 'var(--ink)'
  return (
    <div className="flex items-center py-2 text-xs" style={{ borderBottom: '1px solid var(--line)', opacity: dim ? 0.4 : 1 }}>
      <div className="flex-1" style={{ color: highlight ? 'var(--ink)' : 'var(--ink2)', fontWeight: highlight ? 600 : 400 }}>{label}</div>
      <div className="w-28 text-right" style={{ color, fontWeight: highlight ? 700 : 500 }}>{neg ? `− ${fmt(mo)}` : fmt(mo)}</div>
      <div className="w-32 text-right" style={{ color, fontWeight: highlight ? 700 : 500 }}>{neg ? `− ${fmt(an)}` : fmt(an)}</div>
    </div>
  )
}

function ExpRow({ label, value, onChange, mo }: { label: string; value: number | undefined; onChange: (v: string) => void; mo: number }) {
  return (
    <div className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="flex-1 text-xs" style={{ color: 'var(--ink2)' }}>{label}</div>
      <div className="relative" style={{ width: 120 }}>
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
        <input type="number" value={value || ''} onChange={e => onChange(e.target.value)} placeholder="0"
          className="w-full text-xs outline-none py-1.5 text-right pr-2"
          style={{ paddingLeft: 18, border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
      </div>
      <div className="text-xs text-right w-24" style={{ color: 'var(--ink3)' }}>
        {mo > 0 ? <span style={{ color: 'var(--ink2)' }}>{fmt(mo * 12)}/yr</span> : <span>—</span>}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FactFindingPage() {
  const [client, setClient] = useState<Client | null>(null)
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
    const { data: rows } = await supabase.from('fact_finding').select('*').eq('client_id', c.id)
    if (rows && rows.length > 0) {
      const merged: FactFinding = { client_id: c.id }
      for (const row of rows) Object.assign(merged, row.data || {})
      setFf(merged)
    } else {
      setFf({ client_id: c.id, other_incomes: [], expense_mode: 'simple' })
    }
    setLoading(false)
  }

  const upd = useCallback((key: keyof FactFinding, val: unknown) => {
    setFf(prev => prev ? { ...prev, [key]: val } : prev)
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

  // ── Computed ──────────────────────────────────────────────────────────────
  const age = client.age || 35
  const cit = ff.citizenship || 'SC'
  const gross = ff.gross_monthly || 0
  const bonus = ff.gross_bonus || 0
  const otherIncomes = ff.other_incomes || []
  const totalOther = otherIncomes.reduce((s, i) => s + (i.amount || 0), 0)
  const cpf = calcCpf(gross, bonus, age, cit, cpfConfig)
  const isCpf = ['SC', 'PR'].includes(cit)

  // Monthly
  const moGross = gross
  const moEmployee = cpf.employee
  const moTakeHome = cpf.takeHome
  const moIncome = moTakeHome + totalOther

  // Annual
  const anGross = gross * 12 + bonus
  const anEmployee = moEmployee * 12 + (isCpf && cpf.tier ? Math.floor(bonus * cpf.tier.employee / 100) : 0)
  const anTakeHome = anGross - anEmployee
  const anIncome = anTakeHome + (totalOther * 12)

  // Expenses
  const expMode = ff.expense_mode || 'simple'
  let moExp = 0, anExp = 0
  if (expMode === 'simple') {
    moExp = (ff.simple_living || 0) + (ff.simple_commitments || 0) + (ff.simple_savings || 0)
    anExp = moExp * 12
  } else {
    const dkeys: (keyof FactFinding)[] = [
            'd_mortgage_cpf', 'd_mortgage_cash', 'd_vehicle_repay', 'd_personal_loan_repay',
            'd_rental_expense', 'd_income_tax', 'd_insurance', 'd_regular_savings',
            'd_conservancy', 'd_utilities', 'd_family_food', 'd_maid', 'd_other_household',
            'd_personal_food', 'd_transport', 'd_car_petrol', 'd_car_insurance',
            'd_childcare', 'd_school_fees', 'd_school_transport', 'd_allowance_children', 'd_other_children',
            'd_holidays', 'd_hobbies', 'd_allowance_parents', 'd_others_lifestyle',
          ]
          moExp = dkeys.reduce((s, k) => s + ((ff[k] as number) || 0), 0))
    anExp = moExp * 12
  }

  // Assets
  const cashAssets = (ff.a_savings || 0) + (ff.a_fixed_deposit || 0)
  const investedAssets = (ff.a_cpf_oa || 0) + (ff.a_cpf_sa || 0) + (ff.a_cpf_ma || 0) + (ff.a_cpf_ra || 0) +
    (ff.a_srs || 0) + (ff.a_shares || 0) + (ff.a_etf || 0) + (ff.a_unit_trust || 0) +
    (ff.a_bonds || 0) + (ff.a_alternatives || 0) + (ff.a_inv_property_res || 0) + (ff.a_inv_property_com || 0) + (ff.a_business || 0)
  const personalAssets = (ff.a_residential || 0) + (ff.a_vehicles || 0) + (ff.a_club || 0)
  const totalAssets = cashAssets + investedAssets + personalAssets

  // Liabilities
  const stLiab = (ff.l_credit_card || 0) + (ff.l_business_loan || 0) + (ff.l_renovation_loan || 0)
  const ltLiab = (ff.l_mortgage_residing || 0) + (ff.l_mortgage_investment || 0) + (ff.l_car_loan || 0) +
    (ff.l_study_loan || 0) + (ff.l_personal_loan || 0) + (ff.l_renovation_lt || 0)
  const totalLiab = stLiab + ltLiab
  const netWorth = totalAssets - totalLiab

  const RISK_COLORS: Record<string, string> = { Conservative: 'var(--emerald)', Moderate: '#C4A464', Balanced: '#4A7C9E', Growth: '#7A6AAA', Aggressive: 'var(--rouge)' }

  const assetInput = (label: string, key: keyof FactFinding) => (
    <div className="flex items-center py-2 text-xs gap-3" style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="flex-1" style={{ color: 'var(--ink2)' }}>{label}</div>
      <div className="relative" style={{ width: 130 }}>
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
        <input type="number" value={(ff[key] as number) || ''} onChange={e => upd(key, n(e.target.value))} placeholder="0"
          className="w-full text-xs outline-none py-1.5 text-right pr-2"
          style={{ paddingLeft: 18, border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
      </div>
    </div>
  )

  return (
    <div className="flex flex-col min-h-full">
      {/* Hero Band */}
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div className="flex items-center gap-4 py-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'rgba(255,255,255,0.28)' }}>Fact Finding</div>
            <div className="font-serif text-2xl font-light" style={{ color: '#F0EDE8' }}>{client.name}</div>
          </div>
          <div className="ml-auto flex items-center gap-5">
            {[
              { label: isCpf ? 'Take-Home/mo' : 'Income/mo', val: fmt(moTakeHome), color: '#C4A464' },
              { label: 'Total Income/mo', val: fmt(moIncome), color: '#80C4A0' },
              { label: 'Total Income/yr', val: fmt(anIncome), color: '#A0C4D4' },
              { label: 'Net Worth', val: netWorth !== 0 ? fmt(netWorth) : '—', color: netWorth >= 0 ? '#80C4A0' : '#E08080' },
            ].map(s => (
              <div key={s.label} className="text-right">
                <div className="text-xs tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.28)', fontSize: 9 }}>{s.label}</div>
                <div className="font-serif text-base mt-0.5" style={{ color: s.color }}>{s.val}</div>
              </div>
            ))}
            <button onClick={save} disabled={saving} className="ml-3 px-5 py-2 text-sm font-medium"
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

        {/* ═══ INCOME ═══════════════════════════════════════════════════ */}
        {activeSection === 'income' && (
          <div className="space-y-5">
            {/* Row 1: Employment + Salary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <Card title="Employment">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Occupation" value={ff.occupation} onChange={v => upd('occupation', v)} placeholder="e.g. Engineer" />
                  <Field label="Employer" value={ff.employer} onChange={v => upd('employer', v)} placeholder="e.g. DBS Bank" />
                  <Sel label="Employment Type" value={ff.employment_type} onChange={v => upd('employment_type', v)}
                    options={['Employed', 'Self-Employed', 'Business Owner', 'Commission-Based', 'Retired', 'Student', 'Homemaker']} />
                  <Sel label="Citizenship" value={ff.citizenship} onChange={v => upd('citizenship', v)} options={['SC', 'PR', 'Foreigner']} />
                </div>
              </Card>
              <Card title="Gross Salary" subtitle="Before CPF deductions">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Gross Monthly" value={ff.gross_monthly} onChange={v => upd('gross_monthly', n(v))} type="number" prefix="$" placeholder="0" />
                  <Field label="Gross Annual Bonus" value={ff.gross_bonus} onChange={v => upd('gross_bonus', n(v))} type="number" prefix="$" placeholder="0" annual />
                </div>
                {gross > 0 && (
                  <div className="mt-3 pt-3 text-xs grid grid-cols-2 gap-2" style={{ borderTop: '1px solid var(--line)' }}>
                    <div><span style={{ color: 'var(--ink3)' }}>Gross Monthly </span><span style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmt(gross)}</span></div>
                    <div><span style={{ color: 'var(--ink3)' }}>Gross Annual </span><span style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmt(gross * 12 + bonus)}</span></div>
                  </div>
                )}
              </Card>
            </div>

            {/* Row 2: Other Incomes */}
            <Card title="Other Income" subtitle="Rental, dividends, commissions, side income, etc.">
              <div className="space-y-2">
                {otherIncomes.map((item, i) => (
                  <div key={i} className="flex gap-2">
                    <input type="text" value={item.label} placeholder={`Source ${i + 1} (e.g. Rental)`}
                      onChange={e => { const u = [...otherIncomes]; u[i] = { ...u[i], label: e.target.value }; upd('other_incomes', u) }}
                      className="flex-1 px-3 py-2 text-sm outline-none"
                      style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                      onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                      onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                    <div className="relative" style={{ width: 140 }}>
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
                      <input type="number" value={item.amount || ''} placeholder="0/mo"
                        onChange={e => { const u = [...otherIncomes]; u[i] = { ...u[i], amount: n(e.target.value) }; upd('other_incomes', u) }}
                        className="w-full px-3 py-2 text-sm outline-none"
                        style={{ paddingLeft: 22, border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                    </div>
                    <button onClick={() => upd('other_incomes', otherIncomes.filter((_, j) => j !== i))}
                      className="w-9 h-9 flex items-center justify-center text-lg flex-shrink-0"
                      style={{ color: 'var(--ink3)', border: '1px solid var(--line)', background: 'white' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--rouge)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink3)')}>×</button>
                  </div>
                ))}
                <button onClick={() => upd('other_incomes', [...otherIncomes, { label: '', amount: 0 }])}
                  className="text-xs px-3 py-2" style={{ color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.3)', background: 'var(--gold-l)' }}>
                  + Add Income Source
                </button>
              </div>
            </Card>

            {/* Row 3: Income Summary + CPF Breakdown side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Income Summary table */}
              <div style={{ background: 'white', border: '1px solid var(--line)' }}>
                <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div className="font-serif text-lg" style={{ color: 'var(--ink)' }}>Income Summary</div>
                </div>
                <div className="px-6 py-4">
                  {/* Header */}
                  <div className="flex items-center pb-2 text-xs" style={{ borderBottom: '2px solid var(--line2)' }}>
                    <div className="flex-1" style={{ color: 'var(--ink3)' }}></div>
                    <div className="w-28 text-right font-medium tracking-widest uppercase text-xs" style={{ color: 'var(--ink3)', fontSize: 9 }}>Monthly</div>
                    <div className="w-32 text-right font-medium tracking-widest uppercase text-xs" style={{ color: 'var(--ink3)', fontSize: 9 }}>Annual</div>
                  </div>
                  <Row label="Gross Salary" mo={moGross} an={anGross} />
                  {isCpf && <Row label={`Employee CPF (${cpf.tier?.employee ?? 0}%)`} mo={moEmployee} an={anEmployee} neg />}
                  <Row label={isCpf ? 'Take-Home Pay' : 'Salary'} mo={moTakeHome} an={anTakeHome} highlight />
                  {totalOther > 0 && <Row label="Other Income" mo={totalOther} an={totalOther * 12} />}
                  <div className="flex items-center pt-3 mt-1 text-sm font-semibold" style={{ borderTop: '2px solid var(--gold)', color: 'var(--gold)' }}>
                    <div className="flex-1">Total Spendable Income</div>
                    <div className="w-28 text-right">{fmt(moIncome)}</div>
                    <div className="w-32 text-right">{fmt(anIncome)}</div>
                  </div>
                </div>
              </div>

              {/* CPF Breakdown */}
              <div style={{ background: 'white', border: '1px solid var(--line)' }}>
                <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div className="font-serif text-lg" style={{ color: 'var(--ink)' }}>CPF Breakdown</div>
                  {isCpf && cpf.tier && (
                    <div className="text-xs px-2 py-1" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)' }}>
                      Age {age} · {cpf.tier.employee}% / {cpf.tier.employer}%
                    </div>
                  )}
                </div>
                <div className="px-6 py-4">
                  {!isCpf ? (
                    <div className="text-sm py-4 text-center" style={{ color: 'var(--ink3)' }}>CPF not applicable for Foreigners</div>
                  ) : (
                    <>
                      {gross > cpfConfig.ow_ceiling && (
                        <div className="text-xs px-3 py-2 mb-3" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.2)' }}>
                          OW capped at {fmt(cpfConfig.ow_ceiling)}
                        </div>
                      )}
                      {/* Header */}
                      <div className="flex items-center pb-2 text-xs" style={{ borderBottom: '2px solid var(--line2)' }}>
                        <div className="flex-1" style={{ color: 'var(--ink3)' }}></div>
                        <div className="w-24 text-right" style={{ color: 'var(--ink3)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>Monthly</div>
                        <div className="w-28 text-right" style={{ color: 'var(--ink3)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>Annual</div>
                      </div>
                      {/* Employee */}
                      <div className="py-2 text-xs font-medium mt-1" style={{ color: 'var(--ink3)', borderBottom: '1px solid var(--line)' }}>Employee Contribution ({cpf.tier?.employee}%)</div>
                      {[
                        { label: 'Ordinary Account (OA)', mo: cpf.oa, color: 'var(--emerald)' },
                        { label: 'Special Account (SA)', mo: Math.round(cpf.owBase * (cpf.tier?.sa || 0) / 100), color: '#4A7C9E' },
                        { label: 'MediSave (MA)', mo: cpf.ma - Math.round(cpf.owBase * (cpf.tier?.sa || 0) / 100) + Math.round(cpf.owBase * (cpf.tier?.sa || 0) / 100), color: '#7A6AAA' },
                      ].map((r, i, arr) => {
                        const saAmt = Math.round(cpf.owBase * (cpf.tier?.sa || 0) / 100)
                        const oaAmt = cpf.oa
                        const maAmt = cpf.employee - oaAmt - saAmt
                        const amounts = [oaAmt, saAmt, maAmt]
                        return (
                          <div key={r.label} className="flex items-center py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                            <div className="flex-1 flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }}></div>
                              <span style={{ color: 'var(--ink2)' }}>{r.label}</span>
                            </div>
                            <div className="w-24 text-right" style={{ color: r.color, fontWeight: 500 }}>{fmt(amounts[i])}</div>
                            <div className="w-28 text-right" style={{ color: r.color, fontWeight: 500 }}>{fmt(amounts[i] * 12)}</div>
                          </div>
                        )
                      })}
                      <div className="flex items-center py-1.5 text-xs font-medium" style={{ borderBottom: '1px solid var(--line2)' }}>
                        <div className="flex-1" style={{ color: 'var(--ink)' }}>Total Employee</div>
                        <div className="w-24 text-right" style={{ color: 'var(--rouge)' }}>− {fmt(cpf.employee)}</div>
                        <div className="w-28 text-right" style={{ color: 'var(--rouge)' }}>− {fmt(anEmployee)}</div>
                      </div>
                      {/* Employer */}
                      <div className="py-2 text-xs font-medium mt-1" style={{ color: 'var(--ink3)', borderBottom: '1px solid var(--line)' }}>Employer Contribution ({cpf.tier?.employer}%)</div>
                      <div className="flex items-center py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                        <div className="flex-1" style={{ color: 'var(--ink2)' }}>Total Employer CPF</div>
                        <div className="w-24 text-right" style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(cpf.employer)}</div>
                        <div className="w-28 text-right" style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(cpf.employer * 12)}</div>
                      </div>
                      <div className="flex items-center justify-between pt-3 mt-1">
                        <div className="text-xs" style={{ color: 'var(--ink3)' }}>Take-Home Pay</div>
                        <div className="font-serif text-xl" style={{ color: 'var(--emerald)' }}>{fmt(moTakeHome)}/mo</div>
                      </div>
                      {bonus > 0 && (
                        <div className="mt-2 pt-2 text-xs" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink3)' }}>
                          Bonus CPF: Employee {fmt(Math.floor(bonus * (cpf.tier?.employee || 0) / 100))} · Employer {fmt(Math.round(bonus * (cpf.tier?.employer || 0) / 100))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ EXPENSES ═════════════════════════════════════════════════ */}
        {activeSection === 'expenses' && (
          <div className="space-y-5">
            {/* Mode Toggle */}
            <div style={{ background: 'white', border: '1px solid var(--line)', padding: '16px 24px' }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Cashflow Detail Level</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>Choose based on how much detail your client wants to capture</div>
                </div>
                <div className="flex gap-2">
                  {[
                    { id: 'simple', label: '⚡ Simplified', desc: '3 categories, quick' },
                    { id: 'detailed', label: '📋 Detailed', desc: 'Full cashflow breakdown' },
                  ].map(m => (
                    <button key={m.id} onClick={() => upd('expense_mode', m.id as 'simple' | 'detailed')}
                      className="px-4 py-2 text-sm text-left"
                      style={{ border: expMode === m.id ? '1.5px solid var(--gold)' : '1px solid var(--line)', background: expMode === m.id ? 'var(--gold-l)' : 'white', color: expMode === m.id ? 'var(--gold-tag)' : 'var(--ink2)', minWidth: 150 }}>
                      <div className="font-medium">{m.label}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {expMode === 'simple' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>
                <Card title="Monthly Outflow" subtitle="Simplified — 3 main buckets">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                    <Field label="Living Expenses" value={ff.simple_living} onChange={v => upd('simple_living', n(v))} type="number" prefix="$" placeholder="0" hint="Food, transport, utilities, lifestyle" />
                    <Field label="Commitments" value={ff.simple_commitments} onChange={v => upd('simple_commitments', n(v))} type="number" prefix="$" placeholder="0" hint="Loans, insurance premiums" />
                    <Field label="Savings / Investments" value={ff.simple_savings} onChange={v => upd('simple_savings', n(v))} type="number" prefix="$" placeholder="0" />
                  </div>
                  <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--line)' }}>
                    <span className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Total Monthly</span>
                    <div className="flex gap-6">
                      <span className="font-serif text-lg" style={{ color: 'var(--rouge)' }}>{fmt(moExp)}/mo</span>
                      <span className="font-serif text-lg" style={{ color: 'var(--ink2)' }}>{fmt(anExp)}/yr</span>
                    </div>
                  </div>
                </Card>
                {/* Cash flow mini card */}
                <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                  <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Cash Flow</div>
                  {[
                    { label: 'Total Income/mo', val: moIncome, color: 'var(--emerald)' },
                    { label: 'Total Expenses/mo', val: moExp, color: 'var(--rouge)' },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                      <span style={{ color: 'var(--ink3)' }}>{r.label}</span>
                      <span style={{ color: r.color, fontWeight: 500 }}>{fmt(r.val)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-xs" style={{ color: 'var(--ink2)' }}>Net Surplus/mo</span>
                    <span className="font-serif text-xl" style={{ color: moIncome - moExp >= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
                      {moIncome - moExp >= 0 ? '+' : '−'}{fmt(Math.abs(moIncome - moExp))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 pb-1">
                    <span className="text-xs" style={{ color: 'var(--ink2)' }}>Net Surplus/yr</span>
                    <span className="font-serif text-lg" style={{ color: anIncome - anExp >= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
                      {anIncome - anExp >= 0 ? '+' : '−'}{fmt(Math.abs(anIncome - anExp))}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              /* DETAILED CASHFLOW */
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
                <div className="space-y-4">
                  {[
                    {
                      title: 'Financial Obligations', color: 'var(--rouge)',
                      items: [
                        ['Mortgage Loan Repayment (CPF OA)', 'd_mortgage_cpf'],
                        ['Mortgage Loan Repayment (Cash)', 'd_mortgage_cash'],
                        ['Motor Vehicle Repayment', 'd_vehicle_repay'],
                        ['Personal Loan Repayment', 'd_personal_loan_repay'],
                        ['Rental Expenses', 'd_rental_expense'],
                        ['Income Tax', 'd_income_tax'],
                        ['Insurance Payment', 'd_insurance'],
                        ['Regular Savings / Investments', 'd_regular_savings'],
                      ]
                    },
                    {
                      title: 'Household & Living Expenses', color: '#4A7C9E',
                      items: [
                        ['Conservancy / MCST Fees / Property Tax', 'd_conservancy'],
                        ['Utilities & Bills (Mobile, Internet etc.)', 'd_utilities'],
                        ['Family Food & Groceries', 'd_family_food'],
                        ['Maid Services (Salary incl. Levy)', 'd_maid'],
                        ['Other Household & Living Expenses', 'd_other_household'],
                      ]
                    },
                    {
                      title: 'Personal Expenses', color: '#7A6AAA',
                      items: [
                        ['Personal Food & Groceries', 'd_personal_food'],
                        ['Public Transport', 'd_transport'],
                        ['Car Petrol, Parking, Maintenance, Road Tax', 'd_car_petrol'],
                        ['Car Insurance', 'd_car_insurance'],
                      ]
                    },
                    {
                      title: 'Children Expenses', color: 'var(--emerald)',
                      items: [
                        ['Childcare / DayCare / Babysitter', 'd_childcare'],
                        ['School & Tuition Fees', 'd_school_fees'],
                        ['School Transport', 'd_school_transport'],
                        ['Allowance / Pocket Money', 'd_allowance_children'],
                        ['Other Children Expenses', 'd_other_children'],
                      ]
                    },
                    {
                      title: 'Lifestyle & Miscellaneous', color: '#C4A464',
                      items: [
                        ['Holidays / Tours', 'd_holidays'],
                        ['Hobbies / Recreation', 'd_hobbies'],
                        ['Allowance (Parents)', 'd_allowance_parents'],
                        ['Others (Shopping, Tithes, Donations etc.)', 'd_others_lifestyle'],
                      ]
                    },
                  ].map(group => {
                    const groupTotal = group.items.reduce((s, [, k]) => s + ((ff[k as keyof FactFinding] as number) || 0), 0)
                    return (
                      <div key={group.title} style={{ background: 'white', border: '1px solid var(--line)' }}>
                        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)', borderLeft: `3px solid ${group.color}` }}>
                          <div className="text-sm font-medium" style={{ color: group.color }}>{group.title}</div>
                          <div className="text-xs" style={{ color: 'var(--ink3)' }}>Sub-total: <span style={{ color: group.color, fontWeight: 600 }}>{fmt(groupTotal)}/mo</span></div>
                        </div>
                        <div className="px-5 py-2">
                          <div className="flex items-center pb-1 text-xs" style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink3)' }}>
                            <div className="flex-1">Item</div>
                            <div style={{ width: 120, textAlign: 'right' }}>Monthly</div>
                            <div style={{ width: 100, textAlign: 'right' }}>Annual</div>
                          </div>
                          {group.items.map(([label, key]) => (
                            <ExpRow key={key} label={label} value={(ff[key as keyof FactFinding] as number)} onChange={v => upd(key as keyof FactFinding, n(v))} mo={(ff[key as keyof FactFinding] as number) || 0} />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Summary sidebar */}
                <div className="space-y-4" style={{ position: 'sticky', top: 24 }}>
                  <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                    <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Annual Cash Expenses</div>
                    {[
                      { label: 'Financial Obligations', val: ['d_mortgage_cpf','d_mortgage_cash','d_vehicle_repay','d_personal_loan_repay','d_rental_expense','d_income_tax','d_insurance','d_regular_savings'].reduce((s,k)=>s+((ff[k as keyof FactFinding] as number)||0),0), color: 'var(--rouge)' },
                      { label: 'Household & Living', val: ['d_conservancy','d_utilities','d_family_food','d_maid','d_other_household'].reduce((s,k)=>s+((ff[k as keyof FactFinding] as number)||0),0), color: '#4A7C9E' },
                      { label: 'Personal', val: ['d_personal_food','d_transport','d_car_petrol','d_car_insurance'].reduce((s,k)=>s+((ff[k as keyof FactFinding] as number)||0),0), color: '#7A6AAA' },
                      { label: 'Children', val: ['d_childcare','d_school_fees','d_school_transport','d_allowance_children','d_other_children'].reduce((s,k)=>s+((ff[k as keyof FactFinding] as number)||0),0), color: 'var(--emerald)' },
                      { label: 'Lifestyle & Misc', val: ['d_holidays','d_hobbies','d_allowance_parents','d_others_lifestyle'].reduce((s,k)=>s+((ff[k as keyof FactFinding] as number)||0),0), color: '#C4A464' },
                    ].map(r => (
                      <div key={r.label} className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                        <span style={{ color: 'var(--ink2)' }}>{r.label}</span>
                        <span style={{ color: r.color, fontWeight: 500 }}>{fmt(r.val * 12)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-3 font-semibold text-sm" style={{ borderTop: '2px solid var(--line2)' }}>
                      <span style={{ color: 'var(--ink)' }}>Total Annual</span>
                      <span style={{ color: 'var(--rouge)' }}>{fmt(anExp)}</span>
                    </div>
                  </div>
                  <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                    <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Annual Cash Flow</div>
                    {[
                      { label: 'Total Annual Income', val: anIncome, color: 'var(--emerald)' },
                      { label: 'Total Annual Expenses', val: anExp, color: 'var(--rouge)' },
                    ].map(r => (
                      <div key={r.label} className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                        <span style={{ color: 'var(--ink3)' }}>{r.label}</span>
                        <span style={{ color: r.color, fontWeight: 500 }}>{fmt(r.val)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-3">
                      <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>Net Annual Cash Flow</span>
                      <span className="font-serif text-xl" style={{ color: anIncome - anExp >= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
                        {anIncome - anExp >= 0 ? '+' : '−'}{fmt(Math.abs(anIncome - anExp))}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ ASSETS ═══════════════════════════════════════════════════ */}
        {activeSection === 'assets' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
            <div className="space-y-4">
              {/* Cash */}
              <div style={{ background: 'white', border: '1px solid var(--line)' }}>
                <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--line)', borderLeft: '3px solid var(--emerald)' }}>
                  <span className="text-sm font-medium" style={{ color: 'var(--emerald)' }}>CASH / NEAR CASH</span>
                </div>
                <div className="px-5 py-2">
                  {assetInput('Savings / Current Account(s)', 'a_savings')}
                  {assetInput('Fixed Deposit(s)', 'a_fixed_deposit')}
                </div>
              </div>

              {/* Invested */}
              <div style={{ background: 'white', border: '1px solid var(--line)' }}>
                <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--line)', borderLeft: '3px solid #4A7C9E' }}>
                  <span className="text-sm font-medium" style={{ color: '#4A7C9E' }}>INVESTED ASSET(S)</span>
                </div>
                <div className="px-5 py-2">
                  {assetInput('CPF Ordinary Account (OA)', 'a_cpf_oa')}
                  {assetInput('CPF Special Account (SA)', 'a_cpf_sa')}
                  {assetInput('CPF Medisave Account (MA)', 'a_cpf_ma')}
                  {assetInput('CPF Retirement Account (RA)', 'a_cpf_ra')}
                  {assetInput('SRS', 'a_srs')}
                  {assetInput('Shares', 'a_shares')}
                  {assetInput('ETF(s)', 'a_etf')}
                  {assetInput('Unit Trust(s)', 'a_unit_trust')}
                  {assetInput('Bonds / Treasury Bills', 'a_bonds')}
                  {assetInput('Alternative Investments (Hedge Funds, Gold, Options etc.)', 'a_alternatives')}
                  {assetInput('Investment Property (Residential)', 'a_inv_property_res')}
                  {assetInput('Investment Property (Commercial)', 'a_inv_property_com')}
                  {assetInput('Business Venture(s)', 'a_business')}
                </div>
              </div>

              {/* Personal Use */}
              <div style={{ background: 'white', border: '1px solid var(--line)' }}>
                <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--line)', borderLeft: '3px solid #C4A464' }}>
                  <span className="text-sm font-medium" style={{ color: '#C4A464' }}>PERSONAL USE ASSET(S)</span>
                </div>
                <div className="px-5 py-2">
                  {assetInput('Residential Property', 'a_residential')}
                  {assetInput('Motor Vehicles (Cars, Bikes, Boats etc.)', 'a_vehicles')}
                  {assetInput('Club Membership', 'a_club')}
                </div>
              </div>
            </div>

            {/* Assets Summary */}
            <div className="space-y-4" style={{ position: 'sticky', top: 24 }}>
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Total Assets</div>
                {[
                  { label: 'Cash / Near Cash', val: cashAssets, color: 'var(--emerald)' },
                  { label: 'Invested Assets', val: investedAssets, color: '#4A7C9E' },
                  { label: 'Personal Use Assets', val: personalAssets, color: '#C4A464' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                    <span style={{ color: 'var(--ink2)' }}>{r.label}</span>
                    <span style={{ color: r.color, fontWeight: 500 }}>{fmt(r.val)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-3 font-semibold text-sm" style={{ color: 'var(--emerald)' }}>
                  <span>Total Assets</span><span>{fmt(totalAssets)}</span>
                </div>
              </div>
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Net Worth</div>
                <div className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--ink2)' }}>Total Assets</span><span style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(totalAssets)}</span>
                </div>
                <div className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--ink2)' }}>Total Liabilities</span><span style={{ color: 'var(--rouge)', fontWeight: 500 }}>{fmt(totalLiab)}</span>
                </div>
                <div className="flex justify-between pt-3 font-semibold text-xl font-serif" style={{ color: netWorth >= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
                  <span className="text-sm font-sans font-medium" style={{ color: 'var(--ink)' }}>Net Worth</span>
                  <span>{netWorth >= 0 ? '' : '−'}{fmt(Math.abs(netWorth))}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ LIABILITIES ══════════════════════════════════════════════ */}
        {activeSection === 'liabilities' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
            <div className="space-y-4">
              {/* Short Term */}
              <div style={{ background: 'white', border: '1px solid var(--line)' }}>
                <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--line)', borderLeft: '3px solid var(--rouge)' }}>
                  <div className="text-sm font-medium" style={{ color: 'var(--rouge)' }}>SHORT TERM (&lt;5 years)</div>
                </div>
                <div className="px-5 py-2">
                  {assetInput('Credit Card / Credit Line', 'l_credit_card')}
                  {assetInput('Business Loan', 'l_business_loan')}
                  {assetInput('Renovation Loan', 'l_renovation_loan')}
                </div>
              </div>
              {/* Long Term */}
              <div style={{ background: 'white', border: '1px solid var(--line)' }}>
                <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--line)', borderLeft: '3px solid #8A5E3A' }}>
                  <div className="text-sm font-medium" style={{ color: '#8A5E3A' }}>LONG TERM (&gt;5 years)</div>
                </div>
                <div className="px-5 py-2">
                  {assetInput('Mortgage Loan – Residing', 'l_mortgage_residing')}
                  {assetInput('Mortgage Loan – Investment', 'l_mortgage_investment')}
                  {assetInput('Car / Motor Vehicle Loan', 'l_car_loan')}
                  {assetInput('Study Loan', 'l_study_loan')}
                  {assetInput('Personal Loan', 'l_personal_loan')}
                  {assetInput('Renovation Loan', 'l_renovation_lt')}
                </div>
              </div>
            </div>
            {/* Liabilities Summary */}
            <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px', position: 'sticky', top: 24 }}>
              <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Total Liabilities</div>
              {[
                { label: 'Short Term (<5 yr)', val: stLiab, color: 'var(--rouge)' },
                { label: 'Long Term (>5 yr)', val: ltLiab, color: '#8A5E3A' },
              ].map(r => (
                <div key={r.label} className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--ink2)' }}>{r.label}</span>
                  <span style={{ color: r.color, fontWeight: 500 }}>{fmt(r.val)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-3 font-semibold text-sm mb-4" style={{ color: 'var(--rouge)', borderBottom: '2px solid var(--line2)', paddingBottom: 12 }}>
                <span>Total Liabilities</span><span>{fmt(totalLiab)}</span>
              </div>
              <div className="text-xs tracking-widest uppercase mb-2 mt-2" style={{ color: 'var(--ink3)' }}>Net Worth</div>
              <div className="flex justify-between text-xs py-1"><span style={{ color: 'var(--ink2)' }}>Total Assets</span><span style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(totalAssets)}</span></div>
              <div className="flex justify-between text-xs py-1"><span style={{ color: 'var(--ink2)' }}>Total Liabilities</span><span style={{ color: 'var(--rouge)', fontWeight: 500 }}>{fmt(totalLiab)}</span></div>
              <div className="flex justify-between pt-3 font-serif text-xl" style={{ color: netWorth >= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
                <span className="text-sm font-sans font-medium" style={{ color: 'var(--ink)' }}>Net Worth</span>
                <span>{netWorth >= 0 ? '' : '−'}{fmt(Math.abs(netWorth))}</span>
              </div>
            </div>
          </div>
        )}

        {/* ═══ RISK ═════════════════════════════════════════════════════ */}
        {activeSection === 'risk' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>
            <div className="space-y-5">
              <Card title="Risk Tolerance">
                <Lbl>Risk Profile</Lbl>
                <div className="flex gap-2 mt-1">
                  {['Conservative', 'Moderate', 'Balanced', 'Growth', 'Aggressive'].map(r => (
                    <button key={r} onClick={() => upd('risk_profile', r)} className="flex-1 py-2.5 text-xs font-medium"
                      style={{ border: ff.risk_profile === r ? `1.5px solid ${RISK_COLORS[r]}` : '1px solid var(--line)', background: ff.risk_profile === r ? RISK_COLORS[r] + '18' : 'white', color: ff.risk_profile === r ? RISK_COLORS[r] : 'var(--ink3)' }}>
                      {r}
                    </button>
                  ))}
                </div>
              </Card>
              <Card title="Investment Experience">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Sel label="Experience Level" value={ff.investment_experience} onChange={v => upd('investment_experience', v)}
                    options={['None', 'Beginner (< 2 years)', 'Intermediate (2–5 years)', 'Experienced (5–10 years)', 'Advanced (10+ years)']} />
                  <Sel label="Investment Horizon" value={ff.investment_horizon} onChange={v => upd('investment_horizon', v)}
                    options={['Short-term (< 3 years)', 'Medium-term (3–7 years)', 'Long-term (7–15 years)', 'Very long-term (15+ years)']} />
                </div>
              </Card>
            </div>
            {ff.risk_profile && (
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Profile</div>
                <div className="font-serif text-2xl mb-2" style={{ color: RISK_COLORS[ff.risk_profile] || 'var(--ink)' }}>{ff.risk_profile}</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--ink2)' }}>
                  {ff.risk_profile === 'Conservative' && 'Preserves capital. Bonds, money markets, fixed deposits.'}
                  {ff.risk_profile === 'Moderate' && 'Accepts modest fluctuations. Balanced bonds and blue-chips.'}
                  {ff.risk_profile === 'Balanced' && 'Medium-term volatility okay. Diversified equities and fixed income.'}
                  {ff.risk_profile === 'Growth' && 'Capital appreciation focus. Higher equity allocation.'}
                  {ff.risk_profile === 'Aggressive' && 'Maximum growth. Predominantly equities incl. emerging markets.'}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ HEALTH ═══════════════════════════════════════════════════ */}
        {activeSection === 'health' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>
            <Card title="Health Declarations">
              <div className="space-y-5">
                <div>
                  <Lbl>Smoking Status</Lbl>
                  <div className="flex gap-3 mt-1">
                    {[{ label: 'Non-Smoker', val: false }, { label: 'Smoker', val: true }].map(opt => (
                      <button key={opt.label} onClick={() => upd('smoker', opt.val)} className="px-5 py-2.5 text-sm"
                        style={{ border: ff.smoker === opt.val ? '1.5px solid var(--gold)' : '1px solid var(--line)', background: ff.smoker === opt.val ? 'var(--gold-l)' : 'white', color: ff.smoker === opt.val ? 'var(--gold-tag)' : 'var(--ink3)' }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {ff.smoker && <div className="mt-2 text-xs px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>Smoker loadings ~25–50% on life and CI premiums.</div>}
                </div>
                <div>
                  <Lbl>Pre-existing Conditions / Medical History</Lbl>
                  <textarea value={ff.pre_existing ?? ''} onChange={e => upd('pre_existing', e.target.value)} rows={5} placeholder="Conditions, surgeries, medications, family history…"
                    className="w-full px-3 py-2.5 text-sm outline-none resize-none"
                    style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                </div>
              </div>
            </Card>
            <div style={{ background: 'var(--gold-l)', border: '1px solid rgba(168,131,74,0.2)', padding: '16px 20px' }}>
              <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--gold-tag)' }}>Disclosure Reminder</div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--ink2)' }}>Clients are under duty of disclosure. Non-disclosure may result in policy avoidance. If in doubt, declare.</div>
            </div>
          </div>
        )}

        {/* ═══ NOTES ════════════════════════════════════════════════════ */}
        {activeSection === 'notes' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>
            <Card title="Advisor Notes" subtitle="Private — not shared with client">
              <textarea value={ff.advisor_notes ?? ''} onChange={e => upd('advisor_notes', e.target.value)} rows={14} placeholder="Observations, priorities, follow-up items…"
                className="w-full px-3 py-2.5 text-sm outline-none resize-none"
                style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
            </Card>
            <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
              <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Summary</div>
              {[
                { label: 'Gross Monthly', val: gross > 0 ? fmt(gross) : '—' },
                { label: isCpf ? 'Take-Home/mo' : 'Income/mo', val: moTakeHome > 0 ? fmt(moTakeHome) : '—' },
                { label: 'Total Income/yr', val: anIncome > 0 ? fmt(anIncome) : '—' },
                { label: 'Total Expenses/yr', val: anExp > 0 ? fmt(anExp) : '—' },
                { label: 'Net Cash Flow/yr', val: anIncome > 0 || anExp > 0 ? fmt(anIncome - anExp) : '—' },
                { label: 'Total Assets', val: totalAssets > 0 ? fmt(totalAssets) : '—' },
                { label: 'Total Liabilities', val: totalLiab > 0 ? fmt(totalLiab) : '—' },
                { label: 'Net Worth', val: (totalAssets + totalLiab) > 0 ? fmt(netWorth) : '—' },
                { label: 'Risk Profile', val: ff.risk_profile || '—' },
                { label: 'Smoker', val: ff.smoker === true ? 'Yes' : ff.smoker === false ? 'No' : '—' },
              ].map(r => (
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
