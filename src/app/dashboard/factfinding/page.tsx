'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────
interface OtherIncomeItem { label: string; amount: number }

interface FactFinding {
  client_id: string
  occupation?: string
  employer?: string
  employment_type?: string
  citizenship?: string
  gross_monthly?: number
  gross_bonus?: number
  other_incomes?: OtherIncomeItem[]
  monthly_expenses?: number
  monthly_commitments?: number
  rent_mortgage?: number
  cash_savings?: number
  cpf_ordinary?: number
  cpf_special?: number
  cpf_medisave?: number
  property_value?: number
  other_assets?: number
  mortgage_outstanding?: number
  car_loan?: number
  personal_loan?: number
  credit_card_debt?: number
  other_liabilities?: number
  risk_profile?: string
  investment_experience?: string
  investment_horizon?: string
  smoker?: boolean
  pre_existing?: string
  advisor_notes?: string
}

interface Client {
  id: string; name: string; age?: number; gender?: string; dob?: string; citizenship?: string
}

interface CpfTier { max_age: number; employee: number; employer: number }
interface CpfConfig {
  ow_ceiling: number; annual_ceiling: number; effective_date: string; sc_rates: CpfTier[]
}

// ─── Default CPF Config (Jan 2026 rates) ─────────────────────────────────────
const DEFAULT_CPF_CONFIG: CpfConfig = {
  ow_ceiling: 8000,
  annual_ceiling: 102000,
  effective_date: '2026-01-01',
  sc_rates: [
    { max_age: 55,  employee: 20,   employer: 17  },
    { max_age: 60,  employee: 18,   employer: 16  },
    { max_age: 65,  employee: 14.5, employer: 15.5 },
    { max_age: 70,  employee: 7.5,  employer: 9   },
    { max_age: 999, employee: 5,    employer: 7.5 },
  ],
}

// ─── CPF Helpers ─────────────────────────────────────────────────────────────
function getCpfTier(age: number, config: CpfConfig): CpfTier {
  return config.sc_rates.find(t => age <= t.max_age) || config.sc_rates[config.sc_rates.length - 1]
}

function calcCpf(gross: number, age: number, citizenship: string, config: CpfConfig) {
  if (!['SC', 'PR'].includes(citizenship)) {
    return { employee: 0, employer: 0, takeHome: gross, owBase: 0, tier: null }
  }
  const tier = getCpfTier(age, config)
  const owBase = Math.min(gross, config.ow_ceiling)
  const employee = Math.floor(owBase * tier.employee / 100)
  const employer = Math.round(owBase * tier.employer / 100)
  return { employee, employer, takeHome: gross - employee, owBase, tier }
}

// ─── Formatting ───────────────────────────────────────────────────────────────
const fmt = (n: number) => 'S$' + Math.round(n).toLocaleString()

// ─── Section nav ─────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'income',      label: 'Income',      icon: '◈' },
  { id: 'expenses',    label: 'Expenses',    icon: '◉' },
  { id: 'assets',      label: 'Assets',      icon: '◲' },
  { id: 'liabilities', label: 'Liabilities', icon: '◇' },
  { id: 'risk',        label: 'Risk Profile',icon: '◎' },
  { id: 'health',      label: 'Health',      icon: '⊞' },
  { id: 'notes',       label: 'Notes',       icon: '⊡' },
]

// ─── Shared UI components ─────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>
      {children}
    </label>
  )
}

function Field({ label, value, onChange, type = 'text', prefix, placeholder, hint }: {
  label: string; value: string | number | undefined
  onChange: (v: string) => void; type?: string; prefix?: string; placeholder?: string; hint?: string
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'var(--ink3)' }}>
            {prefix}
          </span>
        )}
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

function SelectField({ label, value, onChange, options }: {
  label: string; value: string | undefined; onChange: (v: string) => void; options: string[]
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2.5 text-sm outline-none"
        style={{ border: '1px solid var(--line)', background: 'white', color: value ? 'var(--ink)' : 'var(--ink3)' }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')}>
        <option value="">— Select —</option>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', border: '1px solid var(--line)' }}>
      <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="font-serif text-lg" style={{ color: 'var(--ink)' }}>{title}</div>
        {subtitle && <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>{subtitle}</div>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

function NetWorthBar({ assets, liabilities }: { assets: number; liabilities: number }) {
  const net = assets - liabilities
  const max = Math.max(assets, liabilities, 1)
  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Net Worth</div>
          <div className="font-serif text-2xl mt-0.5" style={{ color: net >= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
            {net >= 0 ? '' : '−'}{fmt(Math.abs(net))}
          </div>
        </div>
        <div className="text-right text-xs" style={{ color: 'var(--ink3)' }}>
          <div>Assets <span style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(assets)}</span></div>
          <div className="mt-0.5">Liabilities <span style={{ color: 'var(--rouge)', fontWeight: 500 }}>{fmt(liabilities)}</span></div>
        </div>
      </div>
      {[{ label: 'Assets', val: assets, color: 'var(--emerald)' }, { label: 'Liabilities', val: liabilities, color: 'var(--rouge)' }].map(r => (
        <div key={r.label} className="flex items-center gap-2 mb-1.5">
          <div className="text-xs w-16 text-right" style={{ color: 'var(--ink3)' }}>{r.label}</div>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min((r.val / max) * 100, 100)}%`, background: r.color }} />
          </div>
        </div>
      ))}
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

    // Load CPF rates from config table (falls back to hardcoded default if not set up)
    const { data: cfgRow } = await supabase
      .from('config').select('value').eq('key', 'cpf_rates').maybeSingle()
    if (cfgRow?.value) setCpfConfig(cfgRow.value as CpfConfig)

    const { data: clients } = await supabase
      .from('clients').select('*').order('created_at', { ascending: false }).limit(1)
    if (!clients || clients.length === 0) { setLoading(false); return }

    const c = clients[0]
    setClient(c)

    const { data: rows } = await supabase
      .from('fact_finding').select('*').eq('client_id', c.id)

    if (rows && rows.length > 0) {
      const merged: FactFinding = { client_id: c.id }
      for (const row of rows) Object.assign(merged, row.data || {})
      setFf(merged)
    } else {
      setFf({ client_id: c.id, other_incomes: [] })
    }
    setLoading(false)
  }

  const update = useCallback((key: keyof FactFinding, val: unknown) => {
    setFf(prev => prev ? { ...prev, [key]: val } : prev)
    setSaved(false)
  }, [])

  const num = (v: string): number => v === '' ? 0 : parseFloat(v) || 0

  async function save() {
    if (!ff || !client) return
    setSaving(true)
    const { client_id, ...data } = ff
    await supabase.from('fact_finding').upsert(
      { client_id: client.id, section: 'all', data, updated_at: new Date().toISOString() },
      { onConflict: 'client_id,section' }
    )
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-sm" style={{ color: 'var(--ink3)' }}>Loading…</div>
    </div>
  )
  if (!client) return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="font-serif text-2xl" style={{ color: 'var(--ink)' }}>No Client Selected</div>
      <p className="text-sm" style={{ color: 'var(--ink3)' }}>Add a client from the sidebar to begin.</p>
    </div>
  )
  if (!ff) return null

  // ── Computed ─────────────────────────────────────────────────────────────────
  const age = client.age || 35
  const citizenship = ff.citizenship || 'SC'
  const gross = ff.gross_monthly || 0
  const bonus = ff.gross_bonus || 0
  const otherIncomes = ff.other_incomes || []
  const totalOtherIncome = otherIncomes.reduce((s, i) => s + (i.amount || 0), 0)
  const cpf = calcCpf(gross, age, citizenship, cpfConfig)
  const takeHome = cpf.takeHome
  const totalMonthlyIncome = takeHome + totalOtherIncome
  const totalExpenses = (ff.monthly_expenses || 0) + (ff.monthly_commitments || 0) + (ff.rent_mortgage || 0)
  const totalAssets = (ff.cash_savings || 0) + (ff.cpf_ordinary || 0) + (ff.cpf_special || 0) + (ff.cpf_medisave || 0) + (ff.property_value || 0) + (ff.other_assets || 0)
  const totalLiabilities = (ff.mortgage_outstanding || 0) + (ff.car_loan || 0) + (ff.personal_loan || 0) + (ff.credit_card_debt || 0) + (ff.other_liabilities || 0)
  const surplus = totalMonthlyIncome - totalExpenses
  const surplusPct = totalMonthlyIncome > 0 ? Math.min((totalExpenses / totalMonthlyIncome) * 100, 100) : 0
  const isCpfApplicable = ['SC', 'PR'].includes(citizenship)

  const RISK_COLORS: Record<string, string> = {
    Conservative: 'var(--emerald)', Moderate: '#C4A464', Balanced: '#4A7C9E',
    Growth: '#7A6AAA', Aggressive: 'var(--rouge)',
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Hero Band */}
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div className="flex items-center gap-4 py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'rgba(255,255,255,0.28)' }}>Fact Finding</div>
            <div className="font-serif text-2xl font-light" style={{ color: '#F0EDE8' }}>{client.name}</div>
          </div>
          <div className="ml-auto flex items-center gap-6">
            {[
              { label: isCpfApplicable ? 'Take-Home Pay' : 'Monthly Income', val: (isCpfApplicable ? takeHome : gross) > 0 ? fmt(isCpfApplicable ? takeHome : gross) : '—', color: '#C4A464' },
              { label: 'Total Income', val: totalMonthlyIncome > 0 ? fmt(totalMonthlyIncome) : '—', color: '#80C4A0' },
              { label: 'Net Worth', val: (totalAssets + totalLiabilities) > 0 ? fmt(totalAssets - totalLiabilities) : '—', color: (totalAssets - totalLiabilities) >= 0 ? '#80C4A0' : '#E08080' },
              { label: 'Risk Profile', val: ff.risk_profile || '—', color: ff.risk_profile ? (RISK_COLORS[ff.risk_profile] || '#F0EDE8') : 'rgba(255,255,255,0.4)' },
            ].map(s => (
              <div key={s.label} className="text-right">
                <div className="text-xs tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.28)' }}>{s.label}</div>
                <div className="font-serif text-lg mt-0.5" style={{ color: s.color }}>{s.val}</div>
              </div>
            ))}
            <button onClick={save} disabled={saving} className="ml-4 px-5 py-2 text-sm font-medium"
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <div className="space-y-5">

              {/* Employment */}
              <Card title="Employment" subtitle="Current employment details">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Occupation" value={ff.occupation} onChange={v => update('occupation', v)} placeholder="e.g. Software Engineer" />
                  <Field label="Employer" value={ff.employer} onChange={v => update('employer', v)} placeholder="e.g. DBS Bank" />
                  <SelectField label="Employment Type" value={ff.employment_type} onChange={v => update('employment_type', v)}
                    options={['Employed', 'Self-Employed', 'Business Owner', 'Commission-Based', 'Retired', 'Student', 'Homemaker']} />
                  <SelectField label="Citizenship" value={ff.citizenship} onChange={v => update('citizenship', v)}
                    options={['SC', 'PR', 'Foreigner']} />
                </div>
              </Card>

              {/* Gross Salary */}
              <Card title="Gross Salary" subtitle="Before CPF deductions">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Gross Monthly Salary" value={ff.gross_monthly} onChange={v => update('gross_monthly', num(v))}
                    type="number" prefix="$" placeholder="0" hint="Full salary before any deductions" />
                  <Field label="Gross Annual Bonus" value={ff.gross_bonus} onChange={v => update('gross_bonus', num(v))}
                    type="number" prefix="$" placeholder="0" hint="Total bonus per year (AWS + variable)" />
                </div>
                {bonus > 0 && (
                  <div className="mt-3 pt-3 text-xs" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink3)' }}>
                    Monthly equiv. incl. bonus: <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmt(gross + bonus / 12)}</span>
                  </div>
                )}
              </Card>

              {/* Other Incomes — dynamic rows */}
              <Card title="Other Income" subtitle="Rental, dividends, commissions, side income, etc.">
                <div className="space-y-2">
                  {otherIncomes.map((item, i) => (
                    <div key={i} className="flex gap-2">
                      <input type="text" value={item.label} placeholder={`Source ${i + 1} (e.g. Rental)`}
                        onChange={e => {
                          const u = [...otherIncomes]; u[i] = { ...u[i], label: e.target.value }; update('other_incomes', u)
                        }}
                        className="flex-1 px-3 py-2.5 text-sm outline-none"
                        style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                      <div className="relative" style={{ width: 130 }}>
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'var(--ink3)' }}>$</span>
                        <input type="number" value={item.amount || ''} placeholder="0"
                          onChange={e => {
                            const u = [...otherIncomes]; u[i] = { ...u[i], amount: num(e.target.value) }; update('other_incomes', u)
                          }}
                          className="w-full px-3 py-2.5 text-sm outline-none"
                          style={{ paddingLeft: 28, border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                      </div>
                      <button onClick={() => update('other_incomes', otherIncomes.filter((_, j) => j !== i))}
                        className="w-9 h-10 flex items-center justify-center text-lg flex-shrink-0"
                        style={{ color: 'var(--ink3)', border: '1px solid var(--line)', background: 'white' }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--rouge)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink3)')}>×</button>
                    </div>
                  ))}
                  <button onClick={() => update('other_incomes', [...otherIncomes, { label: '', amount: 0 }])}
                    className="text-xs px-3 py-2"
                    style={{ color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.3)', background: 'var(--gold-l)' }}>
                    + Add Income Source
                  </button>
                  {totalOtherIncome > 0 && (
                    <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--line)' }}>
                      <span className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Total Other Income</span>
                      <span className="font-serif text-lg" style={{ color: 'var(--gold)' }}>{fmt(totalOtherIncome)}</span>
                    </div>
                  )}
                </div>
              </Card>

              {/* Income Summary */}
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Monthly Income Summary</div>
                {[
                  { label: 'Gross Monthly Salary', val: gross, neg: false, dim: false },
                  isCpfApplicable
                    ? { label: `Employee CPF (${cpf.tier?.employee ?? 0}% of ${fmt(cpf.owBase)})`, val: cpf.employee, neg: true, dim: false }
                    : { label: 'CPF (not applicable)', val: 0, neg: false, dim: true },
                  { label: isCpfApplicable ? 'Take-Home Pay' : 'Monthly Salary', val: takeHome, neg: false, dim: false, bold: true, color: 'var(--emerald)' },
                  { label: 'Other Income', val: totalOtherIncome, neg: false, dim: totalOtherIncome === 0 },
                ].map((r, i) => (
                  <div key={i} className="flex items-center justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)', opacity: r.dim ? 0.4 : 1 }}>
                    <span style={{ color: 'var(--ink2)' }}>{r.label}</span>
                    <span style={{ color: (r as any).color || (r.neg ? 'var(--rouge)' : 'var(--ink)'), fontWeight: (r as any).bold ? 600 : 500 }}>
                      {r.neg ? `− ${fmt(r.val)}` : fmt(r.val)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-3">
                  <span className="text-xs font-medium" style={{ color: 'var(--ink2)' }}>Total Spendable Income</span>
                  <span className="font-serif text-xl" style={{ color: 'var(--gold)' }}>{fmt(totalMonthlyIncome)}</span>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* CPF Breakdown card */}
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>CPF Breakdown</div>
                  {isCpfApplicable && cpf.tier && (
                    <div className="text-xs px-2 py-0.5" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)' }}>
                      {cpf.tier.employee}% / {cpf.tier.employer}% · Age {age}
                    </div>
                  )}
                </div>
                {!isCpfApplicable ? (
                  <div className="text-xs py-2" style={{ color: 'var(--ink3)' }}>Not applicable — CPF is for SC and PR only.</div>
                ) : (
                  <>
                    {gross > cpfConfig.ow_ceiling && (
                      <div className="text-xs px-3 py-2 mb-3" style={{ background: 'var(--gold-l)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.2)' }}>
                        OW capped at {fmt(cpfConfig.ow_ceiling)} (salary exceeds ceiling)
                      </div>
                    )}
                    {[
                      { label: 'Gross Monthly', val: fmt(gross), color: 'var(--ink)' },
                      { label: `Employee CPF (${cpf.tier?.employee}% of ${fmt(cpf.owBase)})`, val: `− ${fmt(cpf.employee)}`, color: 'var(--rouge)' },
                      { label: `Employer CPF (${cpf.tier?.employer}% of ${fmt(cpf.owBase)})`, val: fmt(cpf.employer), color: 'var(--ink3)', note: true },
                    ].map(r => (
                      <div key={r.label} className="flex justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)', opacity: r.note ? 0.6 : 1 }}>
                        <span style={{ color: 'var(--ink2)' }}>{r.label}</span>
                        <span style={{ color: r.color, fontWeight: 500 }}>{r.val}</span>
                      </div>
                    ))}
                    <div className="flex items-end justify-between pt-3">
                      <div>
                        <div className="text-xs" style={{ color: 'var(--ink3)' }}>Take-Home Pay</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>
                          Rates from {new Date(cpfConfig.effective_date).toLocaleDateString('en-SG', { month: 'short', year: 'numeric' })}
                        </div>
                      </div>
                      <div className="font-serif text-2xl" style={{ color: 'var(--emerald)' }}>{fmt(takeHome)}</div>
                    </div>
                    {bonus > 0 && (
                      <div className="mt-3 pt-3 text-xs" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink3)' }}>
                        Bonus CPF: Employee {fmt(Math.floor(bonus * (cpf.tier?.employee || 0) / 100))} · Employer {fmt(Math.round(bonus * (cpf.tier?.employer || 0) / 100))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={{ background: 'var(--gold-l)', border: '1px solid rgba(168,131,74,0.2)', padding: '16px 20px' }}>
                <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--gold-tag)' }}>About CPF Rates</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--ink2)' }}>
                  OW ceiling {fmt(cpfConfig.ow_ceiling)}/mo. Rates are auto-updated from the platform config table — no code changes needed when MOM updates rates.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ EXPENSES ═════════════════════════════════════════════════ */}
        {activeSection === 'expenses' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <Card title="Monthly Expenditure" subtitle="Regular outgoings and commitments">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Living Expenses" value={ff.monthly_expenses} onChange={v => update('monthly_expenses', num(v))} type="number" prefix="$" placeholder="0" hint="Food, transport, utilities, lifestyle" />
                <Field label="Loan / Insurance Commitments" value={ff.monthly_commitments} onChange={v => update('monthly_commitments', num(v))} type="number" prefix="$" placeholder="0" hint="Existing premiums and loan repayments" />
                <Field label="Rent / Mortgage" value={ff.rent_mortgage} onChange={v => update('rent_mortgage', num(v))} type="number" prefix="$" placeholder="0" />
              </div>
              <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--line)' }}>
                <span className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Total Monthly Expenses</span>
                <span className="font-serif text-xl" style={{ color: 'var(--rouge)' }}>{fmt(totalExpenses)}</span>
              </div>
            </Card>
            <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
              <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Monthly Cash Flow</div>
              <div className="font-serif text-2xl mb-3" style={{ color: surplus >= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
                {surplus >= 0 ? '+' : '−'}{fmt(Math.abs(surplus))}/mo
              </div>
              <div className="h-2 rounded-full overflow-hidden mb-1" style={{ background: 'var(--line)' }}>
                <div className="h-full rounded-full" style={{ width: `${surplusPct}%`, background: surplusPct > 90 ? 'var(--rouge)' : surplusPct > 70 ? '#C4A464' : 'var(--emerald)' }} />
              </div>
              <div className="flex justify-between text-xs mb-3" style={{ color: 'var(--ink3)' }}>
                <span>Expense ratio</span><span>{Math.round(surplusPct)}%</span>
              </div>
              <div className="text-xs space-y-1" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <div className="flex justify-between"><span style={{ color: 'var(--ink3)' }}>Spendable income</span><span style={{ color: 'var(--emerald)' }}>{fmt(totalMonthlyIncome)}</span></div>
                <div className="flex justify-between"><span style={{ color: 'var(--ink3)' }}>Total expenses</span><span style={{ color: 'var(--rouge)' }}>{fmt(totalExpenses)}</span></div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ ASSETS ═══════════════════════════════════════════════════ */}
        {activeSection === 'assets' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <div className="space-y-5">
              <Card title="CPF Accounts" subtitle="Central Provident Fund balances">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <Field label="Ordinary Account" value={ff.cpf_ordinary} onChange={v => update('cpf_ordinary', num(v))} type="number" prefix="$" placeholder="0" />
                  <Field label="Special Account" value={ff.cpf_special} onChange={v => update('cpf_special', num(v))} type="number" prefix="$" placeholder="0" />
                  <Field label="Medisave" value={ff.cpf_medisave} onChange={v => update('cpf_medisave', num(v))} type="number" prefix="$" placeholder="0" />
                </div>
              </Card>
              <Card title="Other Assets" subtitle="Cash, property, and other holdings">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Cash & Savings" value={ff.cash_savings} onChange={v => update('cash_savings', num(v))} type="number" prefix="$" placeholder="0" hint="Bank accounts, FDs, SSBs" />
                  <Field label="Property Value" value={ff.property_value} onChange={v => update('property_value', num(v))} type="number" prefix="$" placeholder="0" hint="Current market value" />
                  <Field label="Other Assets" value={ff.other_assets} onChange={v => update('other_assets', num(v))} type="number" prefix="$" placeholder="0" hint="Shares, bonds, SRS, business, etc." />
                </div>
              </Card>
            </div>
            <div className="space-y-4">
              <NetWorthBar assets={totalAssets} liabilities={totalLiabilities} />
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '16px 20px' }}>
                <div className="text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Asset Breakdown</div>
                {[
                  { label: 'CPF Total', val: (ff.cpf_ordinary || 0) + (ff.cpf_special || 0) + (ff.cpf_medisave || 0) },
                  { label: 'Cash & Savings', val: ff.cash_savings || 0 },
                  { label: 'Property', val: ff.property_value || 0 },
                  { label: 'Other', val: ff.other_assets || 0 },
                ].map(r => (
                  <div key={r.label} className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                    <span style={{ color: 'var(--ink2)' }}>{r.label}</span>
                    <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmt(r.val)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 text-xs font-medium" style={{ color: 'var(--emerald)' }}>
                  <span>Total</span><span>{fmt(totalAssets)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ LIABILITIES ══════════════════════════════════════════════ */}
        {activeSection === 'liabilities' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <Card title="Outstanding Liabilities" subtitle="All debts and obligations">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Mortgage Outstanding" value={ff.mortgage_outstanding} onChange={v => update('mortgage_outstanding', num(v))} type="number" prefix="$" placeholder="0" />
                <Field label="Car Loan" value={ff.car_loan} onChange={v => update('car_loan', num(v))} type="number" prefix="$" placeholder="0" />
                <Field label="Personal Loan" value={ff.personal_loan} onChange={v => update('personal_loan', num(v))} type="number" prefix="$" placeholder="0" />
                <Field label="Credit Card Debt" value={ff.credit_card_debt} onChange={v => update('credit_card_debt', num(v))} type="number" prefix="$" placeholder="0" />
                <Field label="Other Liabilities" value={ff.other_liabilities} onChange={v => update('other_liabilities', num(v))} type="number" prefix="$" placeholder="0" />
              </div>
              <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--line)' }}>
                <span className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Total Liabilities</span>
                <span className="font-serif text-xl" style={{ color: 'var(--rouge)' }}>{fmt(totalLiabilities)}</span>
              </div>
            </Card>
            <NetWorthBar assets={totalAssets} liabilities={totalLiabilities} />
          </div>
        )}

        {/* ═══ RISK PROFILE ═════════════════════════════════════════════ */}
        {activeSection === 'risk' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <div className="space-y-5">
              <Card title="Risk Tolerance" subtitle="Client's appetite for investment volatility">
                <Label>Risk Profile</Label>
                <div className="flex gap-2 mt-1">
                  {['Conservative', 'Moderate', 'Balanced', 'Growth', 'Aggressive'].map(r => (
                    <button key={r} onClick={() => update('risk_profile', r)} className="flex-1 py-2.5 text-xs font-medium"
                      style={{ border: ff.risk_profile === r ? `1.5px solid ${RISK_COLORS[r]}` : '1px solid var(--line)', background: ff.risk_profile === r ? RISK_COLORS[r] + '18' : 'white', color: ff.risk_profile === r ? RISK_COLORS[r] : 'var(--ink3)' }}>
                      {r}
                    </button>
                  ))}
                </div>
              </Card>
              <Card title="Investment Experience" subtitle="Client's background with markets">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <SelectField label="Experience Level" value={ff.investment_experience} onChange={v => update('investment_experience', v)}
                    options={['None', 'Beginner (< 2 years)', 'Intermediate (2–5 years)', 'Experienced (5–10 years)', 'Advanced (10+ years)']} />
                  <SelectField label="Investment Horizon" value={ff.investment_horizon} onChange={v => update('investment_horizon', v)}
                    options={['Short-term (< 3 years)', 'Medium-term (3–7 years)', 'Long-term (7–15 years)', 'Very long-term (15+ years)']} />
                </div>
              </Card>
            </div>
            {ff.risk_profile && (
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Profile Summary</div>
                <div className="font-serif text-2xl mb-2" style={{ color: RISK_COLORS[ff.risk_profile] || 'var(--ink)' }}>{ff.risk_profile}</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--ink2)' }}>
                  {ff.risk_profile === 'Conservative' && 'Prioritises capital preservation. Suited to bonds, money markets, and fixed deposits.'}
                  {ff.risk_profile === 'Moderate' && 'Accepts modest fluctuations. Balanced mix of bonds and blue-chip equities.'}
                  {ff.risk_profile === 'Balanced' && 'Comfortable with medium-term volatility. Diversified across equities and fixed income.'}
                  {ff.risk_profile === 'Growth' && 'Capital appreciation focus over 7+ years. Higher equity allocation, accepts drawdowns.'}
                  {ff.risk_profile === 'Aggressive' && 'Maximises long-term growth. Predominantly equities including emerging markets.'}
                </div>
                {ff.investment_horizon && (
                  <div className="mt-3 pt-3 text-xs" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink3)' }}>
                    Horizon: <span style={{ color: 'var(--ink2)', fontWeight: 500 }}>{ff.investment_horizon}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ HEALTH ═══════════════════════════════════════════════════ */}
        {activeSection === 'health' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <Card title="Health Declarations" subtitle="For insurance underwriting purposes">
              <div className="space-y-5">
                <div>
                  <Label>Smoking Status</Label>
                  <div className="flex gap-3 mt-1">
                    {[{ label: 'Non-Smoker', val: false }, { label: 'Smoker', val: true }].map(opt => (
                      <button key={opt.label} onClick={() => update('smoker', opt.val)} className="px-5 py-2.5 text-sm"
                        style={{ border: ff.smoker === opt.val ? '1.5px solid var(--gold)' : '1px solid var(--line)', background: ff.smoker === opt.val ? 'var(--gold-l)' : 'white', color: ff.smoker === opt.val ? 'var(--gold-tag)' : 'var(--ink3)' }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {ff.smoker && (
                    <div className="mt-2 text-xs px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)', border: '1px solid rgba(138,40,40,0.15)' }}>
                      Smoker loadings typically add ~25–50% to life and CI premiums.
                    </div>
                  )}
                </div>
                <div>
                  <Label>Pre-existing Conditions / Medical History</Label>
                  <textarea value={ff.pre_existing ?? ''} onChange={e => update('pre_existing', e.target.value)} rows={5}
                    placeholder="Note conditions, past surgeries, medications, or family history relevant to underwriting…"
                    className="w-full px-3 py-2.5 text-sm outline-none resize-none"
                    style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
                </div>
              </div>
            </Card>
            <div style={{ background: 'var(--gold-l)', border: '1px solid rgba(168,131,74,0.2)', padding: '16px 20px' }}>
              <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--gold-tag)' }}>Disclosure Reminder</div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--ink2)' }}>
                Clients are under duty of disclosure. Non-disclosure of material facts may result in policy avoidance. If in doubt, declare.
              </div>
            </div>
          </div>
        )}

        {/* ═══ NOTES ════════════════════════════════════════════════════ */}
        {activeSection === 'notes' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <Card title="Advisor Notes" subtitle="Private — not shared with client">
              <textarea value={ff.advisor_notes ?? ''} onChange={e => update('advisor_notes', e.target.value)} rows={12}
                placeholder="Observations, priorities, follow-up items, next steps…"
                className="w-full px-3 py-2.5 text-sm outline-none resize-none"
                style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
            </Card>
            <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
              <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Summary</div>
              {[
                { label: 'Occupation', val: ff.occupation || '—' },
                { label: 'Employment', val: ff.employment_type || '—' },
                { label: 'Citizenship', val: ff.citizenship || '—' },
                { label: 'Gross Monthly', val: gross > 0 ? fmt(gross) : '—' },
                { label: isCpfApplicable ? 'Take-Home Pay' : 'Monthly Pay', val: (isCpfApplicable ? takeHome : gross) > 0 ? fmt(isCpfApplicable ? takeHome : gross) : '—' },
                { label: 'Total Income', val: totalMonthlyIncome > 0 ? fmt(totalMonthlyIncome) : '—' },
                { label: 'Total Assets', val: totalAssets > 0 ? fmt(totalAssets) : '—' },
                { label: 'Net Worth', val: (totalAssets + totalLiabilities) > 0 ? fmt(totalAssets - totalLiabilities) : '—' },
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
