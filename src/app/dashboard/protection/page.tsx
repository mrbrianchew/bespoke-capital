'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Policy {
  id: string
  type: 'life' | 'ci' | 'tpd' | 'early_ci' | 'di' | 'hospitalisation'
  insurer: string
  planName: string
  sumAssured: number
  annualPremium: number
  // type-specific
  coverageType?: 'term' | 'whole_life' | 'ilp'   // life
  termYears?: number                               // term life
  monthlyBenefit?: number                          // DI
  deferredPeriod?: string                          // DI
  riderIncluded?: boolean                          // hospitalisation
  planType?: string                                // hospitalisation: integrated, rider
  person: 'client' | 'spouse'
  notes: string
}

interface RiskMgmtData {
  policies: Policy[]
  advisorNotes: string
}

const EMPTY_DATA: RiskMgmtData = { policies: [], advisorNotes: '' }

const POLICY_TYPES = [
  { value: 'life',           label: 'Life / Term / Whole Life', short: 'Life' },
  { value: 'ci',             label: 'Critical Illness (CI)',     short: 'CI' },
  { value: 'tpd',            label: 'Total & Perm. Disability',  short: 'TPD' },
  { value: 'early_ci',       label: 'Early / Multi-pay CI',      short: 'Early CI' },
  { value: 'di',             label: 'Disability Income (DI)',     short: 'DI' },
  { value: 'hospitalisation',label: 'Hospitalisation / Shield',   short: 'Hosp.' },
]

const TYPE_COLORS: Record<string, string> = {
  life:            '#c8a96e',
  ci:              '#7B9E87',
  tpd:             '#8B7BA8',
  early_ci:        '#C67B5C',
  di:              '#5C8BC6',
  hospitalisation: '#7A9CBF',
}

function fmtS(n: number | undefined | null) {
  if (!n || n === 0) return '—'
  return '$' + Math.round(n).toLocaleString()
}
function fmtGap(need: number, have: number) {
  const gap = need - have
  if (gap <= 0) return { label: 'Covered', color: '#2D6A4F', bg: '#E8F5E9' }
  if (have > 0) return { label: 'Partial', color: '#854F0B', bg: '#FEF3C7' }
  return { label: 'Gap', color: '#9B1C1C', bg: '#FEE2E2' }
}

function newPolicy(person: 'client' | 'spouse'): Policy {
  return {
    id: crypto.randomUUID(),
    type: 'life',
    insurer: '',
    planName: '',
    sumAssured: 0,
    annualPremium: 0,
    person,
    notes: '',
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ProtectionPage() {
  const supabase = createClient()
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState('Client')
  const [spouseName, setSpouseName] = useState('Spouse')
  const [isCouple, setIsCouple] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'portfolio'>('overview')

  // Strategic objectives data (read-only, from objectives page)
  const [soData, setSoData] = useState<any>(null)
  // Raw fact-finding for income etc.
  const [ffData, setFfData] = useState<any>(null)

  // Risk management data (read/write)
  const [rmData, setRmData] = useState<RiskMgmtData>(EMPTY_DATA)
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Policy modal
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [modalPerson, setModalPerson] = useState<'client' | 'spouse'>('client')

  useEffect(() => {
    const id = localStorage.getItem('selectedClientId')
    if (id) setClientId(id)
  }, [])

  useEffect(() => {
    if (clientId) loadData(clientId)
  }, [clientId])

  async function loadData(id: string) {
    const { data: client } = await supabase
      .from('clients').select('name').eq('id', id).single()
    if (client) setClientName(client.name)

    const { data: row } = await supabase
      .from('fact_finding').select('data').eq('client_id', id).single()
    if (row?.data) {
      setFfData(row.data)
      const p2 = row.data.person2
      if (p2?.name) { setSpouseName(p2.name); setIsCouple(true) }
      else if (row.data.mode === 'couple') setIsCouple(true)

      const so = row.data.strategic_objectives
      if (so) setSoData(so)

      const rm = row.data.risk_management
      if (rm) setRmData({ ...EMPTY_DATA, ...rm })
    }
  }

  async function saveData(data: RiskMgmtData) {
    if (!clientId) return
    setSaving(true)
    const { data: existing } = await supabase
      .from('fact_finding').select('data').eq('client_id', clientId).single()
    const merged = { ...(existing?.data || {}), risk_management: data }
    await supabase.from('fact_finding')
      .upsert({ client_id: clientId, data: merged }, { onConflict: 'client_id' })
    setSaving(false)
  }

  function updateRmData(next: RiskMgmtData) {
    setRmData(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveData(next), 1000)
  }

  // ── Derived gap figures — re-calculated from raw fact_finding (same logic as objectives page) ──
  const ff = ffData || {}
  const inflationRate = (ff.inflation_rate ?? 3) / 100
  const expenseMode   = ff.expense_mode || 'simplified'

  // Monthly incomes
  const p1MonthlyIncome = Number(ff.monthly_income || ff.monthlyIncomeClient || 0)
  const p2MonthlyIncome = Number(ff.person2?.monthly_income || 0)

  // Annual expenses — simplified vs detailed
  function annualExpenses(prefix: string) {
    if (expenseMode === 'simplified') {
      return Number(ff[`${prefix}annual_expenses`] || ff[`${prefix}monthly_expenses`] && ff[`${prefix}monthly_expenses`] * 12 || 0)
    }
    const cats = ['financial_commitments','household','personal','children','lifestyle']
    return cats.reduce((s: number, c: string) => s + Number(ff[`${prefix}${c}`] || 0), 0)
  }

  const p1AnnualExp = annualExpenses('d_') || annualExpenses('') || (p1MonthlyIncome * 12 * 0.7)
  const p2AnnualExp = annualExpenses('d2_') || (p2MonthlyIncome * 12 * 0.7)

  // Coverage term — youngest child graduates at 26
  const children: any[] = ff.children || []
  let coverageTerm = 20
  if (children.length > 0) {
    const minAge = Math.min(...children.map((c: any) => Number(c.age || 0)))
    coverageTerm = Math.max(1, 26 - minAge)
  }

  // FV of annual expenses over coverage term (income replacement)
  function fvAnnuity(annual: number, rate: number, years: number) {
    if (rate === 0) return annual * years
    return annual * ((Math.pow(1 + rate, years) - 1) / rate)
  }

  const p1FamilyDep = fvAnnuity(p1AnnualExp, inflationRate, coverageTerm)
  const p2FamilyDep = fvAnnuity(p2AnnualExp, inflationRate, coverageTerm)

  // Mortgage outstanding
  const mortgageNeed = Number(ff.l_mortgage_residing || ff.l2_mortgage_residing || 0) +
    Number(ff.d_mortgage_cpf || 0)

  // Education need
  const educationNeed = Number(soData?.ed_total || 0)

  // CI recovery (2 years income)
  const p1CIRecovery = p1MonthlyIncome * 24
  const p2CIRecovery = p2MonthlyIncome * 24

  // Retirement shortfall from SO
  const retirementNeed = 0  // Complex calc — shown on retirement tab; skip in overview for now
  const estateNeed = 0

  // Assets for offset
  const p1CPF  = Number(ff.a_cpf_oa || 0) + Number(ff.a_cpf_sa || 0) + Number(ff.a_cpf_ma || 0)
  const p2CPF  = Number(ff.a2_cpf_oa || 0) + Number(ff.a2_cpf_sa || 0) + Number(ff.a2_cpf_ma || 0)
  const properties: any[] = ff.properties || []
  const p1PropValue = properties.filter((p: any) => p.owner === 'client' || p.owner === 'joint').reduce((s: number, p: any) => s + Number(p.current_value || 0) * (p.owner === 'joint' ? 0.5 : 1), 0)
  const p2PropValue = properties.filter((p: any) => p.owner === 'spouse' || p.owner === 'joint').reduce((s: number, p: any) => s + Number(p.current_value || 0) * (p.owner === 'joint' ? 0.5 : 1), 0)
  const p1Liquid = Number(ff.a_savings || 0) + Number(ff.a_alternatives || 0)
  const p2Liquid = Number(ff.a2_savings || 0) + Number(ff.a2_alternatives || 0)

  const p1DTPDOffset = p1CPF + p1PropValue
  const p2DTPDOffset = p2CPF + p2PropValue
  const p1CIOffset   = p1Liquid
  const p2CIOffset   = p2Liquid

  const clientDTPDNeed = Math.max(0, p1FamilyDep + mortgageNeed + educationNeed - p1DTPDOffset)
  const clientCINeed   = Math.max(0, p1CIRecovery - p1CIOffset)
  const spouseDTPDNeed = isCouple ? Math.max(0, p2FamilyDep + mortgageNeed - p2DTPDOffset) : 0
  const spouseCINeed   = isCouple ? Math.max(0, p2CIRecovery - p2CIOffset) : 0
  const ciRecoveryNeed = p1CIRecovery

  // Compute policy totals per person per type from portfolio
  function policyTotal(person: 'client' | 'spouse', type: 'life' | 'ci' | 'tpd' | 'early_ci' | 'di' | 'hospitalisation') {
    return rmData.policies
      .filter(p => p.person === person && p.type === type)
      .reduce((s, p) => s + (p.sumAssured || 0), 0)
  }
  function policyPremiumTotal(person: 'client' | 'spouse') {
    return rmData.policies
      .filter(p => p.person === person)
      .reduce((s, p) => s + (p.annualPremium || 0), 0)
  }

  const clientLifePortfolio = policyTotal('client', 'life') + policyTotal('client', 'tpd')
  const clientCIPortfolio   = policyTotal('client', 'ci')   + policyTotal('client', 'early_ci')
  const spouseLifePortfolio = policyTotal('spouse', 'life') + policyTotal('spouse', 'tpd')
  const spouseCIPortfolio   = policyTotal('spouse', 'ci')   + policyTotal('spouse', 'early_ci')

  // Portfolio IS the source of truth for "have" figures
  const clientLifeEffective = clientLifePortfolio
  const clientCIEffective   = clientCIPortfolio
  const spouseLifeEffective = spouseLifePortfolio
  const spouseCIEffective   = spouseCIPortfolio

  // ── Modal helpers ──────────────────────────────────────────────────────────
  function openNewPolicy(person: 'client' | 'spouse') {
    setEditingPolicy(newPolicy(person))
    setModalPerson(person)
    setShowModal(true)
  }
  function openEditPolicy(p: Policy) {
    setEditingPolicy({ ...p })
    setModalPerson(p.person)
    setShowModal(true)
  }
  function savePolicy(p: Policy) {
    const existing = rmData.policies.find(x => x.id === p.id)
    const next = existing
      ? { ...rmData, policies: rmData.policies.map(x => x.id === p.id ? p : x) }
      : { ...rmData, policies: [...rmData.policies, p] }
    updateRmData(next)
    setShowModal(false)
    setEditingPolicy(null)
  }
  function deletePolicy(id: string) {
    updateRmData({ ...rmData, policies: rmData.policies.filter(p => p.id !== id) })
  }

  // ── Print ──────────────────────────────────────────────────────────────────
  function printPortfolio() {
    window.print()
  }

  const totalAnnualPremium = rmData.policies.reduce((s, p) => s + (p.annualPremium || 0), 0)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', display: 'flex', flexDirection: 'column' }}>
      {/* Hero band */}
      <div style={{ background: '#1C1A17', padding: '0 48px' }}>
        <div style={{ paddingTop: 32, paddingBottom: 28, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(200,169,110,0.8)', marginBottom: 6 }}>
              Risk Management
            </div>
            <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 32, fontWeight: 300, color: '#F0EDE8' }}>
              Wealth Protection — {clientName}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', paddingBottom: 4 }}>
            {saving && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Saving…</span>}
            <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: 3 }}>
              {(['overview', 'portfolio'] as const).map(t => (
                <button key={t} onClick={() => setActiveTab(t)}
                  style={{
                    padding: '6px 16px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12,
                    letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500,
                    background: activeTab === t ? 'rgba(200,169,110,0.2)' : 'transparent',
                    color: activeTab === t ? '#c8a96e' : 'rgba(255,255,255,0.45)',
                    transition: 'all 0.15s',
                  }}>
                  {t === 'overview' ? 'Overview' : 'Portfolio'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <div style={{ padding: '40px 48px', flex: 1 }}>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 36 }}>
            {[
              { label: 'Total Policies', value: rmData.policies.length, unit: 'policies' },
              { label: 'Annual Premium', value: fmtS(totalAnnualPremium), unit: 'per year' },
              { label: 'Coverage Areas', value: soData ? 'Active' : 'Pending', unit: 'from objectives' },
            ].map(c => (
              <div key={c.label} style={{ background: 'white', border: '0.5px solid var(--line)', padding: '20px 24px' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>{c.label}</div>
                <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 28, color: 'var(--ink)', fontWeight: 300 }}>{c.value}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{c.unit}</div>
              </div>
            ))}
          </div>

          {/* Gap analysis — client */}
          <GapSection
            title={`${clientName} — Coverage Gap Analysis`}
            dtpdNeed={clientDTPDNeed}
            ciNeed={clientCINeed}
            lifeHave={clientLifeEffective}
            ciHave={clientCIEffective}
            mortgageNeed={mortgageNeed}
            educationNeed={educationNeed}
            ciRecoveryNeed={ciRecoveryNeed}
            retirementNeed={retirementNeed}
            estateNeed={estateNeed}
            annualPremium={policyPremiumTotal('client')}
          />

          {isCouple && (
            <div style={{ marginTop: 24 }}>
              <GapSection
                title={`${spouseName} — Coverage Gap Analysis`}
                dtpdNeed={spouseDTPDNeed}
                ciNeed={spouseCINeed}
                lifeHave={spouseLifeEffective}
                ciHave={spouseCIEffective}
                mortgageNeed={0}
                educationNeed={0}
                ciRecoveryNeed={0}
                retirementNeed={0}
                estateNeed={0}
                annualPremium={policyPremiumTotal('spouse')}
              />
            </div>
          )}

          {/* Advisor notes */}
          <div style={{ marginTop: 32, background: 'white', border: '0.5px solid var(--line)', padding: 28 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 12 }}>Advisor Notes</div>
            <textarea
              value={rmData.advisorNotes}
              onChange={e => updateRmData({ ...rmData, advisorNotes: e.target.value })}
              placeholder="Record observations, client concerns, agreed priorities, follow-up actions…"
              rows={5}
              style={{
                width: '100%', resize: 'vertical', border: 'none', outline: 'none', background: '#1C1A17',
                color: '#c8a96e', fontFamily: 'DM Mono, monospace', fontSize: 13, padding: '14px 16px',
                borderRadius: 4, boxSizing: 'border-box', lineHeight: 1.7,
              }}
            />
          </div>
        </div>
      )}

      {/* ── PORTFOLIO TAB ── */}
      {activeTab === 'portfolio' && (
        <div style={{ padding: '40px 48px', flex: 1 }} className="print-area">

          {/* Print header (hidden on screen) */}
          <div className="print-only" style={{ display: 'none', marginBottom: 32 }}>
            <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 26, color: '#1C1A17' }}>
              Wealth Protection Portfolio
            </div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              {clientName} · Prepared by Bespoke Capital · {new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <hr style={{ borderTop: '1px solid #ddd', margin: '16px 0' }} />
          </div>

          {/* Portfolio actions bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }} className="no-print">
            <div>
              <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 22, color: 'var(--ink)', fontWeight: 400 }}>
                Wealth Protection Portfolio
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>
                {rmData.policies.length} {rmData.policies.length === 1 ? 'policy' : 'policies'} · Total annual premium {fmtS(totalAnnualPremium)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => openNewPolicy('client')}
                style={{ padding: '8px 16px', background: 'var(--ink)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, letterSpacing: '0.06em' }}>
                + Add Policy ({clientName})
              </button>
              {isCouple && (
                <button onClick={() => openNewPolicy('spouse')}
                  style={{ padding: '8px 16px', background: 'var(--cream)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontSize: 12, letterSpacing: '0.06em' }}>
                  + Add Policy ({spouseName})
                </button>
              )}
              <button onClick={printPortfolio}
                style={{ padding: '8px 16px', background: '#c8a96e', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, letterSpacing: '0.06em' }}>
                Print / PDF
              </button>
            </div>
          </div>

          {/* Policy tables per person */}
          {(['client', 'spouse'] as const).filter(p => p === 'client' || isCouple).map(person => {
            const name = person === 'client' ? clientName : spouseName
            const policies = rmData.policies.filter(p => p.person === person)
            const personPremium = policies.reduce((s, p) => s + (p.annualPremium || 0), 0)
            return (
              <div key={person} style={{ marginBottom: 36 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 3, height: 20, background: '#c8a96e' }} />
                    <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, color: 'var(--ink)' }}>
                      {name}
                    </div>
                  </div>
                  {personPremium > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
                      Annual premium: <strong style={{ color: 'var(--ink)' }}>{fmtS(personPremium)}</strong>
                    </div>
                  )}
                </div>

                {policies.length === 0 ? (
                  <div style={{ background: 'white', border: '0.5px dashed var(--line)', padding: '32px 24px', textAlign: 'center' }}>
                    <div style={{ fontSize: 13, color: 'var(--ink3)' }}>No policies recorded for {name}</div>
                    <button onClick={() => openNewPolicy(person)} className="no-print"
                      style={{ marginTop: 12, padding: '6px 14px', background: 'none', border: '1px solid var(--line)', cursor: 'pointer', fontSize: 12, color: 'var(--ink3)' }}>
                      + Add first policy
                    </button>
                  </div>
                ) : (
                  <div style={{ background: 'white', border: '0.5px solid var(--line)' }}>
                    {/* Table header */}
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 120px 120px 80px', gap: 0, borderBottom: '1px solid var(--line)', padding: '10px 20px' }}>
                      {['TYPE', 'INSURER / PLAN', 'NOTES', 'SUM ASSURED', 'ANN. PREMIUM', ''].map(h => (
                        <div key={h} style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', fontWeight: 500 }}>{h}</div>
                      ))}
                    </div>
                    {policies.map((policy, idx) => {
                      const typeInfo = POLICY_TYPES.find(t => t.value === policy.type)
                      const color = TYPE_COLORS[policy.type] || '#999'
                      return (
                        <div key={policy.id} style={{
                          display: 'grid', gridTemplateColumns: '120px 1fr 1fr 120px 120px 80px',
                          gap: 0, padding: '14px 20px', alignItems: 'center',
                          borderBottom: idx < policies.length - 1 ? '0.5px solid var(--line)' : 'none',
                          background: idx % 2 === 0 ? 'white' : '#FAFAF8',
                        }}>
                          <div>
                            <span style={{ fontSize: 11, fontWeight: 600, color, padding: '2px 8px', background: color + '18', borderRadius: 3 }}>
                              {typeInfo?.short}
                            </span>
                            {policy.coverageType && (
                              <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 3 }}>
                                {policy.coverageType === 'term' ? `Term ${policy.termYears ? policy.termYears + 'yr' : ''}` :
                                 policy.coverageType === 'whole_life' ? 'Whole Life' : 'ILP'}
                              </div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                              {policy.insurer || <span style={{ color: 'var(--ink3)' }}>—</span>}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 1 }}>
                              {policy.planName || ''}
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink3)', paddingRight: 8 }}>
                            {policy.type === 'di'
                              ? policy.monthlyBenefit ? `$${policy.monthlyBenefit.toLocaleString()}/mo · ${policy.deferredPeriod || ''} deferred` : '—'
                              : policy.notes || '—'}
                          </div>
                          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)' }}>
                            {policy.type === 'di' ? '—' : fmtS(policy.sumAssured)}
                          </div>
                          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)' }}>
                            {fmtS(policy.annualPremium)}
                          </div>
                          <div style={{ display: 'flex', gap: 8 }} className="no-print">
                            <button onClick={() => openEditPolicy(policy)}
                              style={{ fontSize: 11, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
                              Edit
                            </button>
                            <button onClick={() => deletePolicy(policy.id)}
                              style={{ fontSize: 11, color: '#C0392B', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
                              ✕
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    {/* Subtotal */}
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 120px 120px 80px', gap: 0, padding: '12px 20px', borderTop: '1px solid var(--line)', background: '#F8F7F4' }}>
                      <div style={{ gridColumn: '1 / 5', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Subtotal</div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{fmtS(personPremium)}</div>
                      <div />
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Portfolio summary box */}
          {rmData.policies.length > 0 && (
            <div style={{ background: '#1C1A17', padding: '28px 32px', marginTop: 8 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(200,169,110,0.7)', marginBottom: 16 }}>
                Portfolio Summary
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isCouple ? 'repeat(4,1fr)' : 'repeat(3,1fr)', gap: 24 }}>
                {[
                  { label: 'Total Policies', val: rmData.policies.length },
                  { label: 'Total Annual Premium', val: fmtS(totalAnnualPremium) },
                  { label: `${clientName} — Life + TPD`, val: fmtS(clientLifePortfolio) },
                  ...(isCouple ? [{ label: `${spouseName} — Life + TPD`, val: fmtS(spouseLifePortfolio) }] : []),
                ].map(item => (
                  <div key={item.label}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>{item.label}</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 22, color: '#F0EDE8', fontWeight: 300 }}>{item.val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Coverage crosscheck (print-friendly) */}
          {soData && rmData.policies.length > 0 && (
            <div style={{ marginTop: 28, background: 'white', border: '0.5px solid var(--line)', padding: '24px 28px' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 16 }}>
                Coverage vs Need — Quick Reference
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr', gap: 24 }}>
                {([['client', clientName], ...(isCouple ? [['spouse', spouseName]] : [])] as [string, string][]).map(([person, name]) => {
                  const lifeHave  = person === 'client' ? clientLifeEffective : spouseLifeEffective
                  const ciHave    = person === 'client' ? clientCIEffective   : spouseCIEffective
                  const lifeNeed  = person === 'client' ? clientDTPDNeed      : spouseDTPDNeed
                  const ciNeed    = person === 'client' ? clientCINeed        : spouseCINeed
                  const lifeStatus = fmtGap(lifeNeed, lifeHave)
                  const ciStatus   = fmtGap(ciNeed,   ciHave)
                  return (
                    <div key={person}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 10 }}>{name}</div>
                      {[
                        { label: 'Life / D&TPD', need: lifeNeed, have: lifeHave, status: lifeStatus },
                        { label: 'Critical Illness', need: ciNeed, have: ciHave, status: ciStatus },
                      ].map(row => (
                        <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '0.5px solid var(--line)' }}>
                          <span style={{ fontSize: 12, color: 'var(--ink)' }}>{row.label}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Need {fmtS(row.need)}</span>
                            <span style={{ fontSize: 12, color: 'var(--ink)' }}>Have {fmtS(row.have)}</span>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 3, background: row.status.bg, color: row.status.color }}>
                              {row.status.label}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── POLICY MODAL ── */}
      {showModal && editingPolicy && (
        <PolicyModal
          policy={editingPolicy}
          personName={modalPerson === 'client' ? clientName : spouseName}
          onSave={savePolicy}
          onClose={() => { setShowModal(false); setEditingPolicy(null) }}
        />
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          aside, nav { display: none !important; }
          body { background: white !important; }
          .print-area { padding: 0 !important; }
        }
        @media screen {
          .print-only { display: none !important; }
        }
      `}</style>
    </div>
  )
}

// ─── Gap Section Component ────────────────────────────────────────────────────

function GapSection({ title, dtpdNeed, ciNeed, lifeHave, ciHave, mortgageNeed, educationNeed, ciRecoveryNeed, retirementNeed, estateNeed, annualPremium }: {
  title: string
  dtpdNeed: number; ciNeed: number; lifeHave: number; ciHave: number
  mortgageNeed: number; educationNeed: number; ciRecoveryNeed: number; retirementNeed: number; estateNeed: number
  annualPremium: number
}) {
  const lifeGapStatus = fmtGap(dtpdNeed, lifeHave)
  const ciGapStatus   = fmtGap(ciNeed, ciHave)
  const lifeGap = dtpdNeed - lifeHave
  const ciGap   = ciNeed   - ciHave

  const rows = [
    { label: 'Life / D & TPD', need: dtpdNeed, have: lifeHave, gap: lifeGap, status: lifeGapStatus },
    { label: 'Critical Illness', need: ciNeed, have: ciHave, gap: ciGap, status: ciGapStatus },
    ...(mortgageNeed > 0 ? [{ label: 'Mortgage Clearance', need: mortgageNeed, have: 0, gap: mortgageNeed, status: fmtGap(mortgageNeed, 0) }] : []),
    ...(educationNeed > 0 ? [{ label: "Children's Education", need: educationNeed, have: 0, gap: educationNeed, status: fmtGap(educationNeed, 0) }] : []),
    ...(ciRecoveryNeed > 0 ? [{ label: 'CI Recovery Fund', need: ciRecoveryNeed, have: ciHave, gap: ciRecoveryNeed - ciHave, status: fmtGap(ciRecoveryNeed, ciHave) }] : []),
    ...(retirementNeed > 0 ? [{ label: 'Retirement Shortfall', need: retirementNeed, have: 0, gap: retirementNeed, status: fmtGap(retirementNeed, 0) }] : []),
    ...(estateNeed > 0 ? [{ label: 'Estate Expenses', need: estateNeed, have: 0, gap: estateNeed, status: fmtGap(estateNeed, 0) }] : []),
  ]

  const hasData = dtpdNeed > 0 || ciNeed > 0

  return (
    <div style={{ background: 'white', border: '0.5px solid var(--line)' }}>
      {/* Section header */}
      <div style={{ padding: '18px 24px', borderBottom: '0.5px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 3, height: 18, background: '#c8a96e' }} />
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{title}</div>
        </div>
        {annualPremium > 0 && (
          <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
            Portfolio premium: <strong style={{ color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{fmtS(annualPremium)}/yr</strong>
          </div>
        )}
      </div>

      {!hasData ? (
        <div style={{ padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--ink3)' }}>
            Complete the Wealth Protection section in Strategic Objectives to see gap analysis here.
          </div>
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 140px 140px 100px', gap: 0, padding: '10px 24px', background: '#FAFAF8', borderBottom: '0.5px solid var(--line)' }}>
            {['COVERAGE AREA', 'NEED', 'HAVE', 'GAP', 'STATUS'].map(h => (
              <div key={h} style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>{h}</div>
            ))}
          </div>

          {rows.map((row, i) => (
            <div key={row.label} style={{
              display: 'grid', gridTemplateColumns: '1fr 140px 140px 140px 100px',
              padding: '14px 24px', alignItems: 'center',
              borderBottom: i < rows.length - 1 ? '0.5px solid var(--line)' : 'none',
              background: i % 2 === 0 ? 'white' : '#FAFAF8',
            }}>
              <div style={{ fontSize: 13, color: 'var(--ink)' }}>{row.label}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)' }}>{fmtS(row.need)}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: row.have > 0 ? '#2D6A4F' : 'var(--ink3)' }}>
                {row.have > 0 ? fmtS(row.have) : '—'}
              </div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: row.gap > 0 ? '#9B1C1C' : '#2D6A4F', fontWeight: row.gap > 0 ? 600 : 400 }}>
                {row.gap > 0 ? fmtS(row.gap) : '✓ Covered'}
              </div>
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 3, background: row.status.bg, color: row.status.color }}>
                  {row.status.label}
                </span>
              </div>
            </div>
          ))}

          {/* Bar visualisation for Life and CI */}
          {(dtpdNeed > 0 || ciNeed > 0) && (
            <div style={{ padding: '20px 24px', borderTop: '0.5px solid var(--line)', background: '#FAFAF8' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {[
                  { label: 'Life / D&TPD', need: dtpdNeed, have: lifeHave },
                  { label: 'Critical Illness', need: ciNeed, have: ciHave },
                ].map(bar => {
                  const pct = bar.need > 0 ? Math.min(100, (bar.have / bar.need) * 100) : 0
                  return (
                    <div key={bar.label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{bar.label}</span>
                        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{Math.round(pct)}% covered</span>
                      </div>
                      <div style={{ height: 6, background: '#E5E3DF', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 3,
                          width: `${pct}%`,
                          background: pct >= 100 ? '#2D6A4F' : pct > 50 ? '#c8a96e' : '#C0392B',
                          transition: 'width 0.4s ease',
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Policy Modal ─────────────────────────────────────────────────────────────

function PolicyModal({ policy, personName, onSave, onClose }: {
  policy: Policy
  personName: string
  onSave: (p: Policy) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<Policy>({ ...policy })
  const f = (k: keyof Policy, v: any) => setForm(prev => ({ ...prev, [k]: v }))

  const isNew = !policy.insurer && !policy.planName

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.65)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'white', width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
        {/* Modal header */}
        <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 20, color: 'var(--ink)' }}>
              {isNew ? 'Add Policy' : 'Edit Policy'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>{personName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ink3)', padding: '4px 8px' }}>✕</button>
        </div>

        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Type */}
          <div>
            <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Policy Type</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {POLICY_TYPES.map(t => (
                <button key={t.value} onClick={() => f('type', t.value as Policy['type'])}
                  style={{
                    padding: '8px 10px', border: `1px solid ${form.type === t.value ? '#c8a96e' : 'var(--line)'}`,
                    background: form.type === t.value ? '#FDF6EC' : 'white',
                    color: form.type === t.value ? '#A8834A' : 'var(--ink3)',
                    cursor: 'pointer', fontSize: 11, fontWeight: form.type === t.value ? 600 : 400,
                    textAlign: 'center',
                  }}>
                  {t.short}
                </button>
              ))}
            </div>
          </div>

          {/* Life sub-type */}
          {form.type === 'life' && (
            <div>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Coverage Type</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[['term', 'Term'], ['whole_life', 'Whole Life'], ['ilp', 'ILP']].map(([v, l]) => (
                  <button key={v} onClick={() => f('coverageType', v)}
                    style={{ padding: '7px 14px', border: `1px solid ${form.coverageType === v ? '#c8a96e' : 'var(--line)'}`, background: form.coverageType === v ? '#FDF6EC' : 'white', color: form.coverageType === v ? '#A8834A' : 'var(--ink3)', cursor: 'pointer', fontSize: 12 }}>
                    {l}
                  </button>
                ))}
              </div>
              {form.coverageType === 'term' && (
                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Term (years)</label>
                  <input type="number" value={form.termYears || ''} onChange={e => f('termYears', +e.target.value)}
                    style={{ display: 'block', marginTop: 6, width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              )}
            </div>
          )}

          {/* Insurer + Plan */}
          {[
            { key: 'insurer' as keyof Policy, label: 'Insurer', ph: 'e.g. Prudential, AIA, Great Eastern' },
            { key: 'planName' as keyof Policy, label: 'Plan Name', ph: 'e.g. PRULife, AIA Pro Achiever' },
          ].map(field => (
            <div key={field.key}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>{field.label}</label>
              <input type="text" value={(form[field.key] as string) || ''} onChange={e => f(field.key, e.target.value)} placeholder={field.ph}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          ))}

          {/* DI specific */}
          {form.type === 'di' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Monthly Benefit ($)</label>
                <input type="number" value={form.monthlyBenefit || ''} onChange={e => f('monthlyBenefit', +e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Deferred Period</label>
                <select value={form.deferredPeriod || ''} onChange={e => f('deferredPeriod', e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none' }}>
                  <option value="">Select…</option>
                  {['30 days', '60 days', '90 days', '180 days', '1 year', '2 years'].map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Sum Assured ($)</label>
              <input type="number" value={form.sumAssured || ''} onChange={e => f('sumAssured', +e.target.value)} placeholder="0"
                style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          )}

          {/* Annual Premium */}
          <div>
            <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Annual Premium ($)</label>
            <input type="number" value={form.annualPremium || ''} onChange={e => f('annualPremium', +e.target.value)} placeholder="0"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* Hospitalisation rider */}
          {form.type === 'hospitalisation' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="rider" checked={form.riderIncluded || false} onChange={e => f('riderIncluded', e.target.checked)} style={{ width: 16, height: 16 }} />
              <label htmlFor="rider" style={{ fontSize: 13, color: 'var(--ink)' }}>Rider / top-up plan included</label>
            </div>
          )}

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Notes</label>
            <input type="text" value={form.notes || ''} onChange={e => f('notes', e.target.value)} placeholder="Optional — e.g. policy number, expiry, remarks"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* Modal footer */}
        <div style={{ padding: '16px 28px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '9px 20px', background: 'none', border: '1px solid var(--line)', color: 'var(--ink3)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={() => onSave(form)} style={{ padding: '9px 20px', background: '#1C1A17', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
            {isNew ? 'Add Policy' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
