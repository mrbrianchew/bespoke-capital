'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClientData {
  id: string
  full_name: string
  date_of_birth?: string
  age?: number
}

interface FamilyMember {
  id: string
  client_id: string
  name: string
  relationship: string
  date_of_birth?: string
  age?: number
}

interface PersonData {
  gross_monthly?: number
  gross_bonus?: number
  citizenship?: string
  pr_year?: string
}

interface PropertyItem {
  id: string
  label?: string
  outstanding?: number
  initialLoanAmount?: number
  initialTenure?: number
  loanStartDate?: string
  interestRate?: number
}

interface FactFinding {
  client_id?: string
  mode?: string
  person1?: PersonData
  person2?: PersonData
  s_mortgage?: number
  s_children?: number
  properties?: PropertyItem[]
  [key: string]: unknown
}

interface ChildInfo {
  name?: string
  age?: number
  targetUniversityAge?: number
  educationCost?: number
}

interface ProtectionNeeds {
  // Family Dependency
  fd_monthly_expenses?: number
  fd_years_coverage?: number
  fd_inflation_rate?: number
  fd_existing_life?: number
  fd_existing_tpd?: number
  fd_existing_ci?: number
  fd_ci_window?: number
  fd_notes?: string

  // Mortgage & Debt
  md_outstanding_mortgage?: number
  md_other_loans?: number
  md_existing_life_mortgage?: number
  md_existing_tpd_mortgage?: number
  md_notes?: string

  // Children's Education
  ed_children?: ChildInfo[]
  ed_existing_savings?: number
  ed_notes?: string

  // Retirement
  ret_target_age?: number
  ret_monthly_income?: number
  ret_life_expectancy?: number
  ret_inflation?: number
  ret_existing_cpf?: number
  ret_existing_investments?: number
  ret_notes?: string

  // Estate Planning
  ep_legacy_amount?: number
  ep_liabilities_covered?: boolean
  ep_will_done?: boolean
  ep_notes?: string

  // Advisor global notes
  advisor_notes?: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TABS = [
  { id: 'family', label: 'Family Dependency' },
  { id: 'mortgage', label: 'Mortgage & Debt' },
  { id: 'education', label: "Children's Education" },
  { id: 'retirement', label: 'Retirement' },
  { id: 'estate', label: 'Estate Planning' },
]

const DEFAULT_INFLATION = 3
const DEFAULT_CI_WINDOW = 5
const DEFAULT_LIFE_EXP = 85

// ─── Calculation Helpers ─────────────────────────────────────────────────────

// FV annuity-due: sum of inflation-adjusted annual expenses over N years
// Base shifts forward each year (FV annuity-due formula)
function calcFamilyDependencyNeed(
  monthlyExpenses: number,
  yearsOfCoverage: number,
  inflationRate: number
): number {
  if (!monthlyExpenses || !yearsOfCoverage) return 0
  const annualExp = monthlyExpenses * 12
  const r = (inflationRate || DEFAULT_INFLATION) / 100
  if (r === 0) return annualExp * yearsOfCoverage
  // FV annuity-due: PV = annual * [(1 - (1+r)^-n) / r] * (1+r)
  const pv = annualExp * ((1 - Math.pow(1 + r, -yearsOfCoverage)) / r) * (1 + r)
  return Math.round(pv)
}

// CI Family Dependency: fixed-window FV anchored to today
function calcCIFamilyNeed(
  monthlyExpenses: number,
  ciWindow: number,
  inflationRate: number
): number {
  if (!monthlyExpenses || !ciWindow) return 0
  const annualExp = monthlyExpenses * 12
  const r = (inflationRate || DEFAULT_INFLATION) / 100
  if (r === 0) return annualExp * ciWindow
  const pv = annualExp * ((1 - Math.pow(1 + r, -ciWindow)) / r) * (1 + r)
  return Math.round(pv)
}

// Mortgage: outstanding balance is the need (already known)
function calcMortgageNeed(outstanding: number, otherLoans: number): number {
  return (outstanding || 0) + (otherLoans || 0)
}

// CI Mortgage: annual PMT × CI window years
function calcCIMortgageNeed(monthlyMortgage: number, ciWindow: number): number {
  return Math.round((monthlyMortgage || 0) * 12 * (ciWindow || DEFAULT_CI_WINDOW))
}

// Education: flat lump sum (no inflation adj per Brian's methodology)
function calcEducationNeed(children: ChildInfo[]): number {
  return (children || []).reduce((sum, c) => sum + (c.educationCost || 0), 0)
}

// Retirement: PV of inflation-adjusted income stream from retirement to life expectancy
function calcRetirementNeed(
  monthlyIncome: number,
  retAge: number,
  lifeExpectancy: number,
  inflationRate: number,
  currentAge: number
): number {
  if (!monthlyIncome || !retAge || !lifeExpectancy) return 0
  const yearsInRetirement = Math.max(0, lifeExpectancy - retAge)
  const annualIncome = monthlyIncome * 12
  const r = (inflationRate || DEFAULT_INFLATION) / 100
  if (r === 0) return annualIncome * yearsInRetirement
  const pv = annualIncome * ((1 - Math.pow(1 + r, -yearsInRetirement)) / r) * (1 + r)
  return Math.round(pv)
}

// ─── Formatters ──────────────────────────────────────────────────────────────

const fmt = (n: number | undefined) =>
  n ? '$' + Math.round(n).toLocaleString('en-SG') : '—'

const fmtK = (n: number | undefined) => {
  if (!n) return '—'
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return '$' + Math.round(n / 1000) + 'K'
  return '$' + Math.round(n)
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PulledDataPill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      background: 'white', border: '1px solid var(--line)',
      borderRadius: '4px', padding: '4px 10px',
    }}>
      <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif' }}>{label}</span>
      <span style={{ fontSize: '12px', color: 'var(--gold)', fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', marginBottom: '6px' }}>
      {children}
    </div>
  )
}

function InputRow({
  label, value, onChange, prefix = '$', suffix, type = 'number', placeholder = '0', hint
}: {
  label: string
  value?: number | string
  onChange: (v: number | string) => void
  prefix?: string
  suffix?: string
  type?: string
  placeholder?: string
  hint?: string
}) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <SectionLabel>{label}</SectionLabel>
      {hint && <div style={{ fontSize: '11px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', marginBottom: '4px' }}>{hint}</div>}
      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: '4px', background: 'white', overflow: 'hidden' }}>
        {prefix && <span style={{ padding: '0 8px', fontSize: '11px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', borderRight: '1px solid var(--line)', background: 'var(--cream)' }}>{prefix}</span>}
        <input
          type={type}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={e => onChange(type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)}
          style={{ flex: 1, border: 'none', outline: 'none', padding: '7px 10px', fontSize: '13px', color: 'var(--ink)', fontFamily: 'Inter, sans-serif', background: 'transparent' }}
        />
        {suffix && <span style={{ padding: '0 8px', fontSize: '11px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', borderLeft: '1px solid var(--line)', background: 'var(--cream)' }}>{suffix}</span>}
      </div>
    </div>
  )
}

function GapRow({ label, need, existing, gap }: { label: string; need: number; existing: number; gap: number }) {
  const isShortfall = gap > 0
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '6px' }}>
      <div style={{ fontSize: '10px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', paddingTop: '3px' }}>{label}</div>
      <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{fmtK(need)}</div>
      <div style={{ textAlign: 'right', fontSize: '12px', fontFamily: 'DM Mono, monospace', fontWeight: 600, color: isShortfall ? '#C0392B' : '#27AE60' }}>
        {gap === 0 ? '✓ Met' : isShortfall ? `–${fmtK(gap)}` : `+${fmtK(Math.abs(gap))}`}
      </div>
    </div>
  )
}

function NotesBar({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginTop: '20px', background: 'var(--charcoal)', borderRadius: '6px', padding: '12px 16px' }}>
      <SectionLabel><span style={{ color: 'rgba(255,255,255,0.5)' }}>Advisor Notes</span></SectionLabel>
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder="Record client responses, concerns, or observations..."
        rows={2}
        style={{
          width: '100%', background: 'transparent', border: 'none',
          borderBottom: '1px solid rgba(255,255,255,0.15)', color: 'white',
          fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: '13px',
          lineHeight: 1.6, outline: 'none', resize: 'none',
          padding: '4px 0', boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ObjectivesPage() {
  const supabase = createClient()
  const [client, setClient] = useState<ClientData | null>(null)
  const [ff, setFf] = useState<FactFinding | null>(null)
  const [needs, setNeeds] = useState<ProtectionNeeds>({})
  const [activeTab, setActiveTab] = useState('family')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

   const { data: clients } = await supabase.from('clients').select('*').order('created_at', { ascending: false }).limit(1)
    if (!clients || clients.length === 0) { setLoading(false); return }
    const c = clients[0]
    const dob = c.date_of_birth
    const age = dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)) : undefined
    setClient({ ...c, age })

    const { data: rows } = await supabase.from('fact_finding').select('*').eq('client_id', c.id)
    if (rows && rows.length > 0) {
      const merged: FactFinding = { client_id: selectedClientId }
      for (const row of rows) Object.assign(merged, row.data || {})
      setFf(merged)
      if (merged.strategic_objectives) {
        setNeeds(merged.strategic_objectives as ProtectionNeeds)
      }
    }
    setLoading(false)
  }

  // ── Auto-save ─────────────────────────────────────────────────────────────

  const upd = useCallback((patch: Partial<ProtectionNeeds>) => {
    setNeeds(prev => {
      const next = { ...prev, ...patch }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => autoSave(next), 1000)
      return next
    })
    setSaved(false)
  }, [ff, client])

  async function autoSave(data: ProtectionNeeds) {
    if (!client) return
    setSaving(true)
    const { data: existing } = await supabase.from('fact_finding').select('data').eq('client_id', client.id).eq('section', 'all').maybeSingle()
    const currentData = (existing?.data as Record<string, unknown>) || {}
    await supabase.from('fact_finding').upsert(
      { client_id: client.id, section: 'all', data: { ...currentData, strategic_objectives: data }, updated_at: new Date().toISOString() },
      { onConflict: 'client_id,section' }
    )
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2500)
  }

  // ── Derived values from financials ────────────────────────────────────────

  const grossMonthly = ff?.person1?.gross_monthly || 0
  const sMortgage = ff?.s_mortgage || 0
  const sChildren = ff?.s_children || 0

  // Sum outstanding mortgage from properties
  const totalOutstandingMortgage = (ff?.properties || []).reduce((sum: number, p: PropertyItem) => {
    const amortized = (!p.outstanding && p.initialLoanAmount && p.initialTenure && p.loanStartDate)
      ? (() => {
          const months = (Date.now() - new Date(p.loanStartDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
          const r = (p.interestRate || 0) / 100 / 12
          const n = (p.initialTenure || 0) * 12
          const pmt = r > 0 ? p.initialLoanAmount * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : p.initialLoanAmount / n
          const elapsed = Math.min(Math.round(months), n)
          if (r === 0) return p.initialLoanAmount - pmt * elapsed
          return p.initialLoanAmount * Math.pow(1 + r, elapsed) - pmt * (Math.pow(1 + r, elapsed) - 1) / r
        })()
      : 0
    return sum + (p.outstanding || amortized || 0)
  }, 0)

  // ── Gap calculations ──────────────────────────────────────────────────────

  const fdNeed = calcFamilyDependencyNeed(
    needs.fd_monthly_expenses || 0,
    needs.fd_years_coverage || 0,
    needs.fd_inflation_rate || DEFAULT_INFLATION
  )
  const ciNeed = calcCIFamilyNeed(
    needs.fd_monthly_expenses || 0,
    needs.fd_ci_window || DEFAULT_CI_WINDOW,
    needs.fd_inflation_rate || DEFAULT_INFLATION
  )
  const lifeGap = Math.max(0, fdNeed - (needs.fd_existing_life || 0))
  const tpdGap = Math.max(0, fdNeed - (needs.fd_existing_tpd || 0))
  const ciFdGap = Math.max(0, ciNeed - (needs.fd_existing_ci || 0))

  const mdNeed = calcMortgageNeed(
    needs.md_outstanding_mortgage !== undefined ? needs.md_outstanding_mortgage : totalOutstandingMortgage,
    needs.md_other_loans || 0
  )
  const ciMdNeed = calcCIMortgageNeed(sMortgage, needs.fd_ci_window || DEFAULT_CI_WINDOW)
  const mdLifeGap = Math.max(0, mdNeed - (needs.md_existing_life_mortgage || 0))
  const mdTpdGap = Math.max(0, mdNeed - (needs.md_existing_tpd_mortgage || 0))

  const totalLifeNeed = fdNeed + mdNeed
  const totalTpdNeed = fdNeed + mdNeed
  const totalCiNeed = ciNeed + ciMdNeed
  const totalLifeExisting = (needs.fd_existing_life || 0) + (needs.md_existing_life_mortgage || 0)
  const totalTpdExisting = (needs.fd_existing_tpd || 0) + (needs.md_existing_tpd_mortgage || 0)
  const totalCiExisting = needs.fd_existing_ci || 0
  const totalLifeGap = Math.max(0, totalLifeNeed - totalLifeExisting)
  const totalTpdGap = Math.max(0, totalTpdNeed - totalTpdExisting)
  const totalCiGap = Math.max(0, totalCiNeed - totalCiExisting)

  const edNeed = calcEducationNeed(needs.ed_children || [])
  const edGap = Math.max(0, edNeed - (needs.ed_existing_savings || 0))

  const retNeed = calcRetirementNeed(
    needs.ret_monthly_income || 0,
    needs.ret_target_age || 65,
    needs.ret_life_expectancy || DEFAULT_LIFE_EXP,
    needs.ret_inflation || DEFAULT_INFLATION,
    client?.age || 40
  )
  const retExisting = (needs.ret_existing_cpf || 0) + (needs.ret_existing_investments || 0)
  const retGap = Math.max(0, retNeed - retExisting)

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', fontFamily: 'Inter, sans-serif', fontSize: '13px', color: 'var(--ink3)' }}>
      Loading...
    </div>
  )

  if (!client) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', fontFamily: 'Inter, sans-serif', fontSize: '13px', color: 'var(--ink3)' }}>
      No client selected. Please select a client from the dashboard.
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', fontFamily: 'Inter, sans-serif' }}>

      {/* ── Hero band ── */}
      <div style={{ background: '#1C1A17', padding: '28px 32px 24px' }}>
        <div style={{ fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>Strategic Objectives</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '26px', color: 'white', fontWeight: 400, margin: 0, lineHeight: 1.2 }}>
              Wealth Protection
            </h1>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>{client.full_name}{client.age ? ` · Age ${client.age}` : ''}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {saving && <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>Saving…</span>}
            {saved && !saving && <span style={{ fontSize: '11px', color: 'var(--gold)' }}>✓ Saved</span>}
          </div>
        </div>

        {/* Pulled data pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '16px' }}>
          <PulledDataPill label="Monthly Income" value={fmt(grossMonthly)} />
          <PulledDataPill label="Mortgage Repayment" value={fmt(sMortgage) + '/mo'} />
          <PulledDataPill label="Outstanding Mortgage" value={fmt(totalOutstandingMortgage)} />
          <PulledDataPill label="Children" value={sChildren ? String(sChildren) : '0'} />
        </div>
      </div>

      {/* ── Tab nav ── */}
      <div style={{ background: 'white', borderBottom: '1px solid var(--line)', padding: '0 32px', display: 'flex', gap: '0' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '12px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: '11px', fontFamily: 'Inter, sans-serif', letterSpacing: '0.05em',
              color: activeTab === t.id ? 'var(--ink)' : 'var(--ink3)',
              borderBottom: activeTab === t.id ? '2px solid var(--gold)' : '2px solid transparent',
              fontWeight: activeTab === t.id ? 600 : 400,
              transition: 'color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content + Sidebar ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '0', maxWidth: '100%' }}>

        {/* ── Main panel ── */}
        <div style={{ padding: '28px 32px', borderRight: '1px solid var(--line)' }}>

          {/* ════ FAMILY DEPENDENCY ════ */}
          {activeTab === 'family' && (
            <div>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 400, color: 'var(--ink)', marginBottom: '4px' }}>Family Dependency</h2>
              <p style={{ fontSize: '12px', color: 'var(--ink3)', marginBottom: '24px', lineHeight: 1.5 }}>
                If the client were to pass away or become totally disabled, how much would the family need to maintain their lifestyle?
              </p>

              <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px', marginBottom: '20px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, marginBottom: '16px' }}>Coverage Parameters</div>

                <InputRow
                  label="Monthly Household Expenses"
                  hint="How much does the family spend monthly to maintain their current lifestyle?"
                  value={needs.fd_monthly_expenses}
                  onChange={v => upd({ fd_monthly_expenses: v as number })}
                />
                <InputRow
                  label="Years of Coverage Needed"
                  hint="Until the youngest child is financially independent, or spouse's working years"
                  value={needs.fd_years_coverage}
                  prefix="yrs"
                  onChange={v => upd({ fd_years_coverage: v as number })}
                />
                <InputRow
                  label="CI Recovery Window"
                  hint="How many years of expenses to cover during critical illness recovery? (default: 5)"
                  value={needs.fd_ci_window || DEFAULT_CI_WINDOW}
                  prefix="yrs"
                  onChange={v => upd({ fd_ci_window: v as number })}
                />
                <InputRow
                  label="Inflation Assumption"
                  hint="Annual inflation rate for expense growth (default: 3%)"
                  value={needs.fd_inflation_rate || DEFAULT_INFLATION}
                  prefix="%"
                  onChange={v => upd({ fd_inflation_rate: v as number })}
                />
              </div>

              <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px', marginBottom: '20px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, marginBottom: '16px' }}>Existing Coverage</div>

                <InputRow label="Existing Life Cover" value={needs.fd_existing_life} onChange={v => upd({ fd_existing_life: v as number })} />
                <InputRow label="Existing TPD Cover" value={needs.fd_existing_tpd} onChange={v => upd({ fd_existing_tpd: v as number })} />
                <InputRow label="Existing CI Cover" value={needs.fd_existing_ci} onChange={v => upd({ fd_existing_ci: v as number })} />
              </div>

              {/* Gap summary */}
              {needs.fd_monthly_expenses ? (
                <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px' }}>
                  <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, marginBottom: '12px' }}>Gap Analysis</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ fontSize: '9px', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cover Type</div>
                    <div style={{ fontSize: '9px', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>Need</div>
                    <div style={{ fontSize: '9px', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>Gap</div>
                  </div>
                  <GapRow label="Life (D)" need={fdNeed} existing={needs.fd_existing_life || 0} gap={lifeGap} />
                  <GapRow label="TPD" need={fdNeed} existing={needs.fd_existing_tpd || 0} gap={tpdGap} />
                  <GapRow label="CI (family)" need={ciNeed} existing={needs.fd_existing_ci || 0} gap={ciFdGap} />
                </div>
              ) : null}

              <NotesBar value={needs.fd_notes} onChange={v => upd({ fd_notes: v })} />
            </div>
          )}

          {/* ════ MORTGAGE & DEBT ════ */}
          {activeTab === 'mortgage' && (
            <div>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 400, color: 'var(--ink)', marginBottom: '4px' }}>Mortgage & Debt</h2>
              <p style={{ fontSize: '12px', color: 'var(--ink3)', marginBottom: '24px', lineHeight: 1.5 }}>
                Ensure all outstanding debts can be fully cleared in the event of death, TPD, or critical illness.
              </p>

              <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px', marginBottom: '20px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, marginBottom: '4px' }}>Outstanding Liabilities</div>
                <div style={{ fontSize: '11px', color: 'var(--ink3)', marginBottom: '16px' }}>Pre-filled from Financials tab. Override if needed.</div>

                <InputRow
                  label="Outstanding Mortgage"
                  hint="Total outstanding home loan balance"
                  value={needs.md_outstanding_mortgage !== undefined ? needs.md_outstanding_mortgage : totalOutstandingMortgage}
                  onChange={v => upd({ md_outstanding_mortgage: v as number })}
                />
                <InputRow
                  label="Other Loans / Debts"
                  hint="Personal loans, car loans, credit card balances"
                  value={needs.md_other_loans}
                  onChange={v => upd({ md_other_loans: v as number })}
                />
              </div>

              <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px', marginBottom: '20px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, marginBottom: '16px' }}>Existing Coverage for Debt</div>
                <InputRow label="Life Cover assigned to Mortgage" value={needs.md_existing_life_mortgage} onChange={v => upd({ md_existing_life_mortgage: v as number })} />
                <InputRow label="TPD Cover assigned to Mortgage" value={needs.md_existing_tpd_mortgage} onChange={v => upd({ md_existing_tpd_mortgage: v as number })} />
              </div>

              {mdNeed > 0 && (
                <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px' }}>
                  <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, marginBottom: '12px' }}>Gap Analysis</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ fontSize: '9px', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cover Type</div>
                    <div style={{ fontSize: '9px', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>Need</div>
                    <div style={{ fontSize: '9px', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>Gap</div>
                  </div>
                  <GapRow label="Life (D)" need={mdNeed} existing={needs.md_existing_life_mortgage || 0} gap={mdLifeGap} />
                  <GapRow label="TPD" need={mdNeed} existing={needs.md_existing_tpd_mortgage || 0} gap={mdTpdGap} />
                  <GapRow label="CI (mortgage)" need={ciMdNeed} existing={0} gap={ciMdNeed} />
                </div>
              )}

              <NotesBar value={needs.md_notes} onChange={v => upd({ md_notes: v })} />
            </div>
          )}

          {/* ════ CHILDREN'S EDUCATION ════ */}
          {activeTab === 'education' && (
            <div>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 400, color: 'var(--ink)', marginBottom: '4px' }}>Children's Education</h2>
              <p style={{ fontSize: '12px', color: 'var(--ink3)', marginBottom: '24px', lineHeight: 1.5 }}>
                Lump sum needed for each child's university education. No inflation adjustment applied (per CFP methodology).
              </p>

              {/* Child cards */}
              {(needs.ed_children || []).map((child, i) => (
                <div key={i} style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600 }}>Child {i + 1}</div>
                    <button
                      onClick={() => {
                        const updated = [...(needs.ed_children || [])]
                        updated.splice(i, 1)
                        upd({ ed_children: updated })
                      }}
                      style={{ fontSize: '10px', color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                    >
                      Remove
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <SectionLabel>Child's Name (optional)</SectionLabel>
                      <input
                        type="text"
                        value={child.name || ''}
                        placeholder="e.g. Emma"
                        onChange={e => {
                          const updated = [...(needs.ed_children || [])]
                          updated[i] = { ...updated[i], name: e.target.value }
                          upd({ ed_children: updated })
                        }}
                        style={{ width: '100%', border: '1px solid var(--line)', borderRadius: '4px', padding: '7px 10px', fontSize: '13px', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box', fontFamily: 'Inter, sans-serif' }}
                      />
                    </div>
                    <div>
                      <SectionLabel>Current Age</SectionLabel>
                      <input
                        type="number"
                        value={child.age || ''}
                        placeholder="0"
                        onChange={e => {
                          const updated = [...(needs.ed_children || [])]
                          updated[i] = { ...updated[i], age: parseFloat(e.target.value) || 0 }
                          upd({ ed_children: updated })
                        }}
                        style={{ width: '100%', border: '1px solid var(--line)', borderRadius: '4px', padding: '7px 10px', fontSize: '13px', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box', fontFamily: 'Inter, sans-serif' }}
                      />
                    </div>
                    <div>
                      <SectionLabel>Estimated Education Cost ($)</SectionLabel>
                      <input
                        type="number"
                        value={child.educationCost || ''}
                        placeholder="e.g. 150000"
                        onChange={e => {
                          const updated = [...(needs.ed_children || [])]
                          updated[i] = { ...updated[i], educationCost: parseFloat(e.target.value) || 0 }
                          upd({ ed_children: updated })
                        }}
                        style={{ width: '100%', border: '1px solid var(--line)', borderRadius: '4px', padding: '7px 10px', fontSize: '13px', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box', fontFamily: 'Inter, sans-serif' }}
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={() => upd({ ed_children: [...(needs.ed_children || []), {}] })}
                style={{
                  background: 'transparent', border: '1.5px dashed var(--line)',
                  borderRadius: '6px', padding: '10px 20px', color: 'var(--ink3)',
                  fontFamily: 'Inter, sans-serif', fontSize: '12px', cursor: 'pointer',
                  width: '100%', textAlign: 'center', marginBottom: '20px',
                }}
              >
                + Add Child
              </button>

              <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px', marginBottom: '20px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, marginBottom: '16px' }}>Existing Education Savings</div>
                <InputRow label="Education Fund / Savings" value={needs.ed_existing_savings} onChange={v => upd({ ed_existing_savings: v as number })} />
              </div>

              {edNeed > 0 && (
                <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px' }}>
                  <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, marginBottom: '12px' }}>Gap Analysis</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ fontSize: '9px', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cover Type</div>
                    <div style={{ fontSize: '9px', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>Need</div>
                    <div style={{ fontSize: '9px', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>Gap</div>
                  </div>
                  <GapRow label="Education Fund" need={edNeed} existing={needs.ed_existing_savings || 0} gap={edGap} />
                </div>
              )}

              <NotesBar value={needs.ed_notes} onChange={v => upd({ ed_notes: v })} />
            </div>
          )}

          {/* ════ RETIREMENT ════ */}
          {activeTab === 'retirement' && (
            <div>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 400, color: 'var(--ink)', marginBottom: '4px' }}>Retirement Planning</h2>
              <p style={{ fontSize: '12px', color: 'var(--ink3)', marginBottom: '24px', lineHeight: 1.5 }}>
                Estimate the lump sum needed at retirement to sustain the client's desired lifestyle.
              </p>

              <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px', marginBottom: '20px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, marginBottom: '16px' }}>Retirement Parameters</div>

                <InputRow label="Target Retirement Age" prefix="age" value={needs.ret_target_age || 65} onChange={v => upd({ ret_target_age: v as number })} />
                <InputRow label="Life Expectancy" prefix="age" value={needs.ret_life_expectancy || DEFAULT_LIFE_EXP} onChange={v => upd({ ret_life_expectancy: v as number })} />
                <InputRow label="Monthly Income in Retirement" hint="In today's dollars" value={needs.ret_monthly_income} onChange={v => upd({ ret_monthly_income: v as number })} />
                <InputRow label="Inflation Rate" prefix="%" value={needs.ret_inflation || DEFAULT_INFLATION} onChange={v => upd({ ret_inflation: v as number })} />
              </div>

              <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px', marginBottom: '20px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, marginBottom: '16px' }}>Existing Retirement Assets</div>
                <InputRow label="Projected CPF at Retirement" value={needs.ret_existing_cpf} onChange={v => upd({ ret_existing_cpf: v as number })} />
                <InputRow label="Investments / Savings" value={needs.ret_existing_investments} onChange={v => upd({ ret_existing_investments: v as number })} />
              </div>

              {retNeed > 0 && (
                <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px' }}>
                  <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, marginBottom: '12px' }}>Gap Analysis</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ fontSize: '9px', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cover Type</div>
                    <div style={{ fontSize: '9px', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>Need</div>
                    <div style={{ fontSize: '9px', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>Gap</div>
                  </div>
                  <GapRow label="Retirement Fund" need={retNeed} existing={retExisting} gap={retGap} />
                </div>
              )}

              <NotesBar value={needs.ret_notes} onChange={v => upd({ ret_notes: v })} />
            </div>
          )}

          {/* ════ ESTATE PLANNING ════ */}
          {activeTab === 'estate' && (
            <div>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 400, color: 'var(--ink)', marginBottom: '4px' }}>Estate Planning</h2>
              <p style={{ fontSize: '12px', color: 'var(--ink3)', marginBottom: '24px', lineHeight: 1.5 }}>
                Capture the client's wishes for wealth distribution and legacy creation.
              </p>

              <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px', marginBottom: '20px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, marginBottom: '16px' }}>Legacy Objectives</div>

                <InputRow
                  label="Legacy / Estate Amount"
                  hint="How much would the client like to leave behind?"
                  value={needs.ep_legacy_amount}
                  onChange={v => upd({ ep_legacy_amount: v as number })}
                />

                <div style={{ marginBottom: '14px' }}>
                  <SectionLabel>Will in Place?</SectionLabel>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {['Yes', 'No', 'In Progress'].map(opt => (
                      <button
                        key={opt}
                        onClick={() => upd({ ep_will_done: opt === 'Yes' })}
                        style={{
                          padding: '6px 14px', border: '1px solid var(--line)', borderRadius: '4px', cursor: 'pointer',
                          fontSize: '11px', fontFamily: 'Inter, sans-serif',
                          background: (opt === 'Yes' && needs.ep_will_done === true) || (opt === 'No' && needs.ep_will_done === false) ? 'var(--charcoal)' : 'white',
                          color: (opt === 'Yes' && needs.ep_will_done === true) || (opt === 'No' && needs.ep_will_done === false) ? 'white' : 'var(--ink)',
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <SectionLabel>Liabilities to be covered by estate?</SectionLabel>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {['Yes', 'No'].map(opt => (
                      <button
                        key={opt}
                        onClick={() => upd({ ep_liabilities_covered: opt === 'Yes' })}
                        style={{
                          padding: '6px 14px', border: '1px solid var(--line)', borderRadius: '4px', cursor: 'pointer',
                          fontSize: '11px', fontFamily: 'Inter, sans-serif',
                          background: (opt === 'Yes' && needs.ep_liabilities_covered === true) || (opt === 'No' && needs.ep_liabilities_covered === false) ? 'var(--charcoal)' : 'white',
                          color: (opt === 'Yes' && needs.ep_liabilities_covered === true) || (opt === 'No' && needs.ep_liabilities_covered === false) ? 'white' : 'var(--ink)',
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <NotesBar value={needs.ep_notes} onChange={v => upd({ ep_notes: v })} />
            </div>
          )}

        </div>

        {/* ── Right sidebar ── */}
        <div style={{ padding: '24px 20px', background: 'white' }}>
          <div style={{ fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: '16px', fontWeight: 600 }}>Protection Summary</div>

          {/* Total needs summary */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: '10px' }}>Total Need vs Gap</div>

            {[
              { label: 'Life / D', need: totalLifeNeed, gap: totalLifeGap },
              { label: 'TPD', need: totalTpdNeed, gap: totalTpdGap },
              { label: 'Critical Illness', need: totalCiNeed, gap: totalCiGap },
              { label: 'Education', need: edNeed, gap: edGap },
              { label: 'Retirement', need: retNeed, gap: retGap },
            ].map(item => (
              <div key={item.label} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '10px', marginBottom: '10px' }}>
                <div style={{ fontSize: '10px', color: 'var(--ink3)', marginBottom: '4px' }}>{item.label}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '13px', color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{item.need ? fmtK(item.need) : '—'}</span>
                  {item.need > 0 && (
                    <span style={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', fontWeight: 600, color: item.gap > 0 ? '#C0392B' : '#27AE60' }}>
                      {item.gap > 0 ? `–${fmtK(item.gap)}` : '✓ Met'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Advisor global notes */}
          <div>
            <div style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: '8px' }}>Session Notes</div>
            <textarea
              value={needs.advisor_notes || ''}
              onChange={e => upd({ advisor_notes: e.target.value })}
              placeholder="Overall session observations..."
              rows={4}
              style={{
                width: '100%', border: '1px solid var(--line)', borderRadius: '4px',
                padding: '8px 10px', fontSize: '12px', color: 'var(--ink)',
                fontFamily: 'Inter, sans-serif', outline: 'none', resize: 'vertical',
                background: 'var(--cream)', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

      </div>
    </div>
  )
}