'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────
interface FactFinding {
  id?: string
  client_id: string
  // Personal
  occupation?: string
  employer?: string
  monthly_income?: number
  other_income?: number
  employment_type?: string
  // Expenses
  monthly_expenses?: number
  monthly_commitments?: number
  rent_mortgage?: number
  // Assets
  cash_savings?: number
  cpf_ordinary?: number
  cpf_special?: number
  cpf_medisave?: number
  property_value?: number
  other_assets?: number
  // Liabilitie
  mortgage_outstanding?: number
  car_loan?: number
  personal_loan?: number
  credit_card_debt?: number
  other_liabilities?: number
  // Risk
  risk_profile?: string
  investment_experience?: string
  investment_horizon?: string
  // Health
  smoker?: boolean
  pre_existing?: string
  // Notes
  advisor_notes?: string
  updated_at?: string
}

interface Client {
  id: string
  name: string
  age?: number
  gender?: string
  dob?: string
  occupation?: string
  employer?: string
  monthly_income?: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n === 0 ? 'S$0' : 'S$' + Math.round(n).toLocaleString()

const SECTIONS = [
  { id: 'income',      label: 'Income',       icon: '◈' },
  { id: 'expenses',    label: 'Expenses',      icon: '◉' },
  { id: 'assets',      label: 'Assets',        icon: '◲' },
  { id: 'liabilities', label: 'Liabilities',   icon: '◇' },
  { id: 'risk',        label: 'Risk Profile',  icon: '◎' },
  { id: 'health',      label: 'Health',        icon: '⊞' },
  { id: 'notes',       label: 'Notes',         icon: '⊡' },
]

// ─── Sub-components ───────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>
      {children}
    </label>
  )
}

function Field({
  label, value, onChange, type = 'text', prefix, placeholder, hint,
}: {
  label: string; value: string | number | boolean | null | undefined; onChange: (v: string) => void
  type?: string; prefix?: string; placeholder?: string; hint?: string
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
        <input
          type={type}
          value={value === null || value === undefined || value === false ? '' : String(value)}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2.5 text-sm outline-none transition-colors"
          style={{
            paddingLeft: prefix ? 28 : 12,
            border: '1px solid var(--line)',
            background: 'white',
            color: 'var(--ink)',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')}
        />
      </div>
      {hint && <div className="text-xs mt-1" style={{ color: 'var(--ink3)' }}>{hint}</div>}
    </div>
  )
}

function SelectField({
  label, value, onChange, options,
}: {
  label: string; value: string | undefined; onChange: (v: string) => void; options: string[]
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2.5 text-sm outline-none transition-colors"
        style={{ border: '1px solid var(--line)', background: 'white', color: value ? 'var(--ink)' : 'var(--ink3)' }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
        onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')}
      >
        <option value="">— Select —</option>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  )
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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
  const assetPct = Math.min((assets / max) * 100, 100)
  const liabPct = Math.min((liabilities / max) * 100, 100)
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
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="text-xs w-16 text-right" style={{ color: 'var(--ink3)' }}>Assets</div>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${assetPct}%`, background: 'var(--emerald)' }} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs w-16 text-right" style={{ color: 'var(--ink3)' }}>Liabilities</div>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${liabPct}%`, background: 'var(--rouge)' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function SurplusBar({ income, expenses }: { income: number; expenses: number }) {
  const surplus = income - expenses
  const pct = income > 0 ? Math.min((expenses / income) * 100, 100) : 0
  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Monthly Cash Flow</div>
          <div className="font-serif text-2xl mt-0.5" style={{ color: surplus >= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
            {surplus >= 0 ? '+' : '−'}{fmt(Math.abs(surplus))}/mo
          </div>
        </div>
        <div className="text-right text-xs" style={{ color: 'var(--ink3)' }}>
          <div>Income <span style={{ color: 'var(--emerald)', fontWeight: 500 }}>{fmt(income)}</span></div>
          <div className="mt-0.5">Expenses <span style={{ color: 'var(--rouge)', fontWeight: 500 }}>{fmt(expenses)}</span></div>
        </div>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: pct > 90 ? 'var(--rouge)' : pct > 70 ? '#C4A464' : 'var(--emerald)' }} />
      </div>
      <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--ink3)' }}>
        <span>Expense ratio</span>
        <span>{income > 0 ? Math.round(pct) : 0}%</span>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FactFindingPage() {
  const [client, setClient] = useState<Client | null>(null)
  const [ff, setFf] = useState<FactFinding | null>(null)
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

    const { data: clients } = await supabase
      .from('clients').select('*').order('created_at', { ascending: false }).limit(1)
    if (!clients || clients.length === 0) { setLoading(false); return }

    const c = clients[0]
    setClient(c)

    const { data: existing } = await supabase
      .from('fact_finding').select('*').eq('client_id', c.id).single()

    if (existing) {
      setFf(existing)
    } else {
      setFf({ client_id: c.id })
    }
    setLoading(false)
  }

  const update = useCallback((key: keyof FactFinding, val: string | number | boolean | null) => {
    setFf(prev => prev ? { ...prev, [key]: val } : prev)
    setSaved(false)
  }, [])

  const num = (v: string): number => v === '' ? 0 : parseFloat(v) || 0

  async function save() {
    if (!ff || !client) return
    setSaving(true)
    const payload = { ...ff, updated_at: new Date().toISOString() }

    if (ff.id) {
      await supabase.from('fact_finding').update(payload).eq('id', ff.id)
    } else {
      const { data } = await supabase.from('fact_finding').insert(payload).select().single()
      if (data) setFf(data)
    }
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
      <p className="text-sm" style={{ color: 'var(--ink3)' }}>Add a client from the sidebar to begin fact finding.</p>
    </div>
  )

  if (!ff) return null

  // Computed
  const totalIncome = (ff.monthly_income || 0) + (ff.other_income || 0)
  const totalExpenses = (ff.monthly_expenses || 0) + (ff.monthly_commitments || 0) + (ff.rent_mortgage || 0)
  const totalAssets = (ff.cash_savings || 0) + (ff.cpf_ordinary || 0) + (ff.cpf_special || 0) + (ff.cpf_medisave || 0) + (ff.property_value || 0) + (ff.other_assets || 0)
  const totalLiabilities = (ff.mortgage_outstanding || 0) + (ff.car_loan || 0) + (ff.personal_loan || 0) + (ff.credit_card_debt || 0) + (ff.other_liabilities || 0)

  const RISK_COLORS: Record<string, string> = {
    'Conservative': 'var(--emerald)',
    'Moderate': '#C4A464',
    'Balanced': '#4A7C9E',
    'Growth': '#7A6AAA',
    'Aggressive': 'var(--rouge)',
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Hero band */}
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div className="flex items-center gap-4 py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'rgba(255,255,255,0.28)' }}>Fact Finding</div>
            <div className="font-serif text-2xl font-light" style={{ color: '#F0EDE8' }}>{client.name}</div>
          </div>

          {/* Quick stats */}
          <div className="ml-auto flex items-center gap-6">
            {[
              { label: 'Monthly Income', val: totalIncome > 0 ? fmt(totalIncome) : '—', color: '#C4A464' },
              { label: 'Net Worth', val: (totalAssets - totalLiabilities) !== 0 ? fmt(totalAssets - totalLiabilities) : '—', color: (totalAssets - totalLiabilities) >= 0 ? '#80C4A0' : '#E08080' },
              { label: 'Risk Profile', val: ff.risk_profile || '—', color: ff.risk_profile ? RISK_COLORS[ff.risk_profile] || '#F0EDE8' : 'rgba(255,255,255,0.4)' },
            ].map(s => (
              <div key={s.label} className="text-right">
                <div className="text-xs tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.28)' }}>{s.label}</div>
                <div className="font-serif text-lg mt-0.5" style={{ color: s.color }}>{s.val}</div>
              </div>
            ))}

            <button
              onClick={save}
              disabled={saving}
              className="ml-4 px-5 py-2 text-sm font-medium transition-all"
              style={{
                background: saved ? 'var(--emerald)' : saving ? 'rgba(255,255,255,0.1)' : 'rgba(168,131,74,0.9)',
                color: 'white',
                border: 'none',
              }}
            >
              {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex gap-0">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className="flex items-center gap-2 px-4 py-3 text-xs tracking-wide transition-all"
              style={{
                color: activeSection === s.id ? '#C4A464' : 'rgba(255,255,255,0.35)',
                borderBottom: activeSection === s.id ? '1px solid #C4A464' : '1px solid transparent',
                background: 'transparent',
              }}
            >
              <span>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '32px 48px', flex: 1 }}>

        {/* ── Income ─────────────────────────────────────────────────── */}
        {activeSection === 'income' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <div className="space-y-5">
              <SectionCard title="Employment" subtitle="Current employment details">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Occupation" value={ff.occupation} onChange={v => update('occupation', v)} placeholder="e.g. Software Engineer" />
                  <Field label="Employer" value={ff.employer} onChange={v => update('employer', v)} placeholder="e.g. DBS Bank" />
                  <SelectField
                    label="Employment Type"
                    value={ff.employment_type}
                    onChange={v => update('employment_type', v)}
                    options={['Employed', 'Self-Employed', 'Business Owner', 'Commission-Based', 'Retired', 'Student', 'Homemaker']}
                  />
                </div>
              </SectionCard>

              <SectionCard title="Monthly Income" subtitle="All income sources per month">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Employment Income" value={ff.monthly_income} onChange={v => update('monthly_income', num(v))} type="number" prefix="$" placeholder="0" />
                  <Field label="Other Income" value={ff.other_income} onChange={v => update('other_income', num(v))} type="number" prefix="$" placeholder="0" hint="Rental, dividends, side income, etc." />
                </div>
                <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--line)' }}>
                  <div className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Total Monthly Income</div>
                  <div className="font-serif text-xl" style={{ color: 'var(--gold)' }}>{fmt(totalIncome)}</div>
                </div>
              </SectionCard>
            </div>

            <div className="space-y-4">
              <SurplusBar income={totalIncome} expenses={totalExpenses} />
              <div style={{ background: 'var(--gold-l)', border: '1px solid rgba(168,131,74,0.2)', padding: '16px 20px' }}>
                <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--gold-tag)' }}>Advisor Tip</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--ink2)' }}>
                  Document all income sources. Commission-based earners may need to average 12 months. CPF contributions affect take-home differently across employment types.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Expenses ───────────────────────────────────────────────── */}
        {activeSection === 'expenses' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <SectionCard title="Monthly Expenditure" subtitle="Regular outgoings and financial commitments">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Living Expenses" value={ff.monthly_expenses} onChange={v => update('monthly_expenses', num(v))} type="number" prefix="$" placeholder="0" hint="Food, transport, utilities, lifestyle" />
                <Field label="Loan / Insurance Commitments" value={ff.monthly_commitments} onChange={v => update('monthly_commitments', num(v))} type="number" prefix="$" placeholder="0" hint="Existing insurance premiums and loan repayments" />
                <Field label="Rent / Mortgage" value={ff.rent_mortgage} onChange={v => update('rent_mortgage', num(v))} type="number" prefix="$" placeholder="0" />
              </div>
              <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--line)' }}>
                <div className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Total Monthly Expenses</div>
                <div className="font-serif text-xl" style={{ color: 'var(--rouge)' }}>{fmt(totalExpenses)}</div>
              </div>
            </SectionCard>

            <SurplusBar income={totalIncome} expenses={totalExpenses} />
          </div>
        )}

        {/* ── Assets ─────────────────────────────────────────────────── */}
        {activeSection === 'assets' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <div className="space-y-5">
              <SectionCard title="CPF Accounts" subtitle="Central Provident Fund balances">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <Field label="Ordinary Account" value={ff.cpf_ordinary} onChange={v => update('cpf_ordinary', num(v))} type="number" prefix="$" placeholder="0" />
                  <Field label="Special Account" value={ff.cpf_special} onChange={v => update('cpf_special', num(v))} type="number" prefix="$" placeholder="0" />
                  <Field label="Medisave" value={ff.cpf_medisave} onChange={v => update('cpf_medisave', num(v))} type="number" prefix="$" placeholder="0" />
                </div>
              </SectionCard>

              <SectionCard title="Other Assets" subtitle="Cash, property, and other holdings">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Cash & Savings" value={ff.cash_savings} onChange={v => update('cash_savings', num(v))} type="number" prefix="$" placeholder="0" hint="Bank accounts, FDs, SSBs" />
                  <Field label="Property Value" value={ff.property_value} onChange={v => update('property_value', num(v))} type="number" prefix="$" placeholder="0" hint="Current market value" />
                  <Field label="Other Assets" value={ff.other_assets} onChange={v => update('other_assets', num(v))} type="number" prefix="$" placeholder="0" hint="Shares, bonds, SRS, business, etc." />
                </div>
              </SectionCard>
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
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                    <span style={{ color: 'var(--ink2)' }}>{row.label}</span>
                    <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmt(row.val)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 text-xs font-medium" style={{ color: 'var(--emerald)' }}>
                  <span>Total Assets</span>
                  <span>{fmt(totalAssets)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Liabilities ────────────────────────────────────────────── */}
        {activeSection === 'liabilities' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <SectionCard title="Outstanding Liabilities" subtitle="All debts and financial obligations">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Mortgage Outstanding" value={ff.mortgage_outstanding} onChange={v => update('mortgage_outstanding', num(v))} type="number" prefix="$" placeholder="0" />
                <Field label="Car Loan" value={ff.car_loan} onChange={v => update('car_loan', num(v))} type="number" prefix="$" placeholder="0" />
                <Field label="Personal Loan" value={ff.personal_loan} onChange={v => update('personal_loan', num(v))} type="number" prefix="$" placeholder="0" />
                <Field label="Credit Card Debt" value={ff.credit_card_debt} onChange={v => update('credit_card_debt', num(v))} type="number" prefix="$" placeholder="0" />
                <Field label="Other Liabilities" value={ff.other_liabilities} onChange={v => update('other_liabilities', num(v))} type="number" prefix="$" placeholder="0" />
              </div>
              <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--line)' }}>
                <div className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Total Liabilities</div>
                <div className="font-serif text-xl" style={{ color: 'var(--rouge)' }}>{fmt(totalLiabilities)}</div>
              </div>
            </SectionCard>

            <NetWorthBar assets={totalAssets} liabilities={totalLiabilities} />
          </div>
        )}

        {/* ── Risk Profile ────────────────────────────────────────────── */}
        {activeSection === 'risk' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <div className="space-y-5">
              <SectionCard title="Risk Tolerance" subtitle="Client's appetite for investment volatility">
                <div className="space-y-3">
                  <Label>Risk Profile</Label>
                  <div className="flex gap-2">
                    {['Conservative', 'Moderate', 'Balanced', 'Growth', 'Aggressive'].map(r => (
                      <button
                        key={r}
                        onClick={() => update('risk_profile', r)}
                        className="flex-1 py-2.5 text-xs font-medium transition-all"
                        style={{
                          border: ff.risk_profile === r ? `1.5px solid ${RISK_COLORS[r]}` : '1px solid var(--line)',
                          background: ff.risk_profile === r ? RISK_COLORS[r] + '18' : 'white',
                          color: ff.risk_profile === r ? RISK_COLORS[r] : 'var(--ink3)',
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Investment Experience" subtitle="Client's background and comfort with markets">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <SelectField
                    label="Experience Level"
                    value={ff.investment_experience}
                    onChange={v => update('investment_experience', v)}
                    options={['None', 'Beginner (< 2 years)', 'Intermediate (2–5 years)', 'Experienced (5–10 years)', 'Advanced (10+ years)']}
                  />
                  <SelectField
                    label="Investment Horizon"
                    value={ff.investment_horizon}
                    onChange={v => update('investment_horizon', v)}
                    options={['Short-term (< 3 years)', 'Medium-term (3–7 years)', 'Long-term (7–15 years)', 'Very long-term (15+ years)']}
                  />
                </div>
              </SectionCard>
            </div>

            {ff.risk_profile && (
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Profile Summary</div>
                <div className="font-serif text-2xl mb-2" style={{ color: RISK_COLORS[ff.risk_profile] || 'var(--ink)' }}>{ff.risk_profile}</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--ink2)' }}>
                  {ff.risk_profile === 'Conservative' && 'Prioritises capital preservation. Suited to short-term bonds, money markets, and fixed deposits. Expects minimal volatility.'}
                  {ff.risk_profile === 'Moderate' && 'Accepts modest fluctuations for slightly higher returns. Balanced mix of bonds and blue-chip equities.'}
                  {ff.risk_profile === 'Balanced' && 'Comfortable with medium-term ups and downs. Diversified portfolio across equities and fixed income.'}
                  {ff.risk_profile === 'Growth' && 'Focused on capital appreciation over 7+ years. Higher equity allocation, accepts meaningful drawdowns.'}
                  {ff.risk_profile === 'Aggressive' && 'Maximises long-term growth. Predominantly equities including emerging markets. Accepts high volatility.'}
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

        {/* ── Health ─────────────────────────────────────────────────── */}
        {activeSection === 'health' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <SectionCard title="Health Declarations" subtitle="Relevant health information for insurance planning">
              <div className="space-y-5">
                <div>
                  <Label>Smoking Status</Label>
                  <div className="flex gap-3 mt-1">
                    {[{ label: 'Non-Smoker', val: false }, { label: 'Smoker', val: true }].map(opt => (
                      <button
                        key={opt.label}
                        onClick={() => update('smoker', opt.val)}
                        className="px-5 py-2.5 text-sm transition-all"
                        style={{
                          border: ff.smoker === opt.val ? '1.5px solid var(--gold)' : '1px solid var(--line)',
                          background: ff.smoker === opt.val ? 'var(--gold-l)' : 'white',
                          color: ff.smoker === opt.val ? 'var(--gold-tag)' : 'var(--ink3)',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {ff.smoker && (
                    <div className="mt-2 text-xs px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)', border: '1px solid rgba(138,40,40,0.15)' }}>
                      Smoker loadings typically apply to life and CI coverage. Factor ~25–50% premium increase.
                    </div>
                  )}
                </div>

                <div>
                  <Label>Pre-existing Conditions / Medical History</Label>
                  <textarea
                    value={ff.pre_existing ?? ''}
                    onChange={e => update('pre_existing', e.target.value)}
                    placeholder="Note any pre-existing medical conditions, past surgeries, medications, or family medical history relevant to underwriting…"
                    rows={5}
                    className="w-full px-3 py-2.5 text-sm outline-none resize-none transition-colors"
                    style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')}
                  />
                </div>
              </div>
            </SectionCard>

            <div style={{ background: 'var(--gold-l)', border: '1px solid rgba(168,131,74,0.2)', padding: '16px 20px' }}>
              <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--gold-tag)' }}>Disclosure Reminder</div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--ink2)' }}>
                Clients are under duty of disclosure. Non-disclosure of material facts may result in policy avoidance. Ensure all conditions are accurately declared. If in doubt, declare.
              </div>
            </div>
          </div>
        )}

        {/* ── Notes ──────────────────────────────────────────────────── */}
        {activeSection === 'notes' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <SectionCard title="Advisor Notes" subtitle="Private notes for your reference — not shared with client">
              <textarea
                value={ff.advisor_notes ?? ''}
                onChange={e => update('advisor_notes', e.target.value)}
                placeholder="Record observations, client priorities, follow-up items, next steps, or any context useful for planning…"
                rows={12}
                className="w-full px-3 py-2.5 text-sm outline-none resize-none transition-colors"
                style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')}
              />
              <div className="mt-2 text-xs" style={{ color: 'var(--ink3)' }}>
                {ff.updated_at && `Last saved ${new Date(ff.updated_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
              </div>
            </SectionCard>

            {/* Summary card */}
            <div className="space-y-3">
              <div style={{ background: 'white', border: '1px solid var(--line)', padding: '20px 24px' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--ink3)' }}>Fact Find Summary</div>
                {[
                  { label: 'Occupation', val: ff.occupation || '—' },
                  { label: 'Employment', val: ff.employment_type || '—' },
                  { label: 'Monthly Income', val: totalIncome > 0 ? fmt(totalIncome) : '—' },
                  { label: 'Monthly Expenses', val: totalExpenses > 0 ? fmt(totalExpenses) : '—' },
                  { label: 'Total Assets', val: totalAssets > 0 ? fmt(totalAssets) : '—' },
                  { label: 'Total Liabilities', val: totalLiabilities > 0 ? fmt(totalLiabilities) : '—' },
                  { label: 'Net Worth', val: (totalAssets > 0 || totalLiabilities > 0) ? fmt(totalAssets - totalLiabilities) : '—' },
                  { label: 'Risk Profile', val: ff.risk_profile || '—' },
                  { label: 'Smoker', val: ff.smoker === true ? 'Yes' : ff.smoker === false ? 'No' : '—' },
                ].map(row => (
                  <div key={row.label} className="flex items-start justify-between py-2 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                    <span style={{ color: 'var(--ink3)' }}>{row.label}</span>
                    <span className="text-right ml-4" style={{ color: 'var(--ink)', fontWeight: 500, maxWidth: 160 }}>{row.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
