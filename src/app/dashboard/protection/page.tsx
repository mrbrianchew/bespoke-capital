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
  coverageType?: 'term' | 'whole_life' | 'ilp'
  termYears?: number
  monthlyBenefit?: number
  deferredPeriod?: string
  riderIncluded?: boolean
  person: 'client' | 'spouse' | string  // string allows child IDs
  notes: string
}

interface RiskMgmtData {
  policies: Policy[]
  advisorNotes: string
}

const EMPTY_DATA: RiskMgmtData = { policies: [], advisorNotes: '' }

const POLICY_TYPES = [
  { value: 'life',            label: 'Life / Term / Whole Life', short: 'Life' },
  { value: 'ci',              label: 'Critical Illness (CI)',     short: 'CI' },
  { value: 'tpd',             label: 'Total & Perm. Disability',  short: 'TPD' },
  { value: 'early_ci',        label: 'Early / Multi-pay CI',      short: 'Early CI' },
  { value: 'di',              label: 'Disability Income (DI)',     short: 'DI' },
  { value: 'hospitalisation', label: 'Hospitalisation / Shield',  short: 'Hosp.' },
]

const TYPE_COLORS: Record<string, string> = {
  life:            '#c8a96e',
  ci:              '#7B9E87',
  tpd:             '#8B7BA8',
  early_ci:        '#C67B5C',
  di:              '#5C8BC6',
  hospitalisation: '#7A9CBF',
}

function fmt(n: number | null | undefined) {
  if (!n || n === 0) return '—'
  return '$' + Math.round(n).toLocaleString()
}

function gapStatus(need: number, have: number) {
  if (need <= 0) return { label: 'N/A',     color: '#555',    bg: '#F0EEE9' }
  if (have >= need) return { label: 'Covered', color: '#2D6A4F', bg: '#E8F5E9' }
  if (have > 0)  return { label: 'Partial',  color: '#854F0B', bg: '#FEF3C7' }
  return              { label: 'Gap',      color: '#9B1C1C', bg: '#FEE2E2' }
}

function newPolicy(person: string): Policy {
  return { id: crypto.randomUUID(), type: 'life', insurer: '', planName: '', sumAssured: 0, annualPremium: 0, person, notes: '' }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ProtectionPage() {
  const supabase = createClient()
  const [clientId, setClientId]   = useState<string | null>(null)
  const [clientName, setClientName] = useState('Client')
  const [clientAge, setClientAge]   = useState(40)
  const [spouseName, setSpouseName] = useState('Spouse')
  const [spouseAge, setSpouseAge]   = useState(38)
  const [isCouple, setIsCouple]     = useState(false)
  const [children, setChildren]     = useState<any[]>([])
  const [ffData, setFfData]         = useState<any>(null)
  const [rmData, setRmData]         = useState<RiskMgmtData>(EMPTY_DATA)
  const [saving, setSaving]         = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [activeTab, setActiveTab]         = useState<'overview' | 'portfolio'>('overview')
  const [overviewPerson, setOverviewPerson] = useState<'client' | 'spouse'>('client')
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null)
  const [showModal, setShowModal]         = useState(false)
  const [modalPerson, setModalPerson]     = useState<string>('client')

  useEffect(() => {
    const id = localStorage.getItem('selectedClientId')
    if (id) setClientId(id)
  }, [])

  useEffect(() => { if (clientId) loadData(clientId) }, [clientId])

  async function loadData(id: string) {
    const { data: client } = await supabase.from('clients').select('name, age, dob').eq('id', id).maybeSingle()
    if (client) {
      setClientName(client.name)
      // Derive age from dob or use stored age
      if (client.dob) {
        const age = Math.floor((Date.now() - new Date(client.dob).getTime()) / (365.25 * 24 * 3600 * 1000))
        setClientAge(age)
      } else if (client.age) {
        setClientAge(Number(client.age))
      }
    }

    const { data: rows } = await supabase.from('fact_finding').select('data').eq('client_id', id)
    // Merge all rows into one flat object (same pattern as other pages)
    const merged: any = {}
    if (rows && rows.length > 0) {
      rows.forEach((r: any) => { if (r.data) Object.assign(merged, r.data) })
    }

    if (Object.keys(merged).length > 0) {
      setFfData(merged)
      const p2 = merged.person2
      if (p2?.name) {
        setSpouseName(p2.name)
        setIsCouple(true)
        if (p2.age) setSpouseAge(Number(p2.age))
        else if (p2.dob) {
          const age = Math.floor((Date.now() - new Date(p2.dob).getTime()) / (365.25 * 24 * 3600 * 1000))
          setSpouseAge(age)
        }
      } else if (merged.mode === 'couple') {
        setIsCouple(true)
      }
      const kids = merged.children || []
      setChildren(kids)
      const rm = merged.risk_management
      if (rm) setRmData({ ...EMPTY_DATA, ...rm })
    }
  }

  async function saveData(data: RiskMgmtData) {
    if (!clientId) return
    setSaving(true)
    // Read first row to merge cleanly
    const { data: rows } = await supabase.from('fact_finding').select('data').eq('client_id', clientId)
    const existing = (rows && rows.length > 0) ? (rows[0].data || {}) : {}
    const merged = { ...existing, risk_management: data }
    await supabase.from('fact_finding').upsert({ client_id: clientId, data: merged }, { onConflict: 'client_id' })
    setSaving(false)
  }

  function updateRmData(next: RiskMgmtData) {
    setRmData(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveData(next), 1000)
  }

  // ── Calculations ─────────────────────────────────────────────────────────
  const ff = ffData || {}
  const inflationRate = (Number(ff.inflation_rate) || 3) / 100

  const p1MonthlyIncome = Number(ff.monthly_income || ff.monthlyIncomeClient || 0)
  const p2MonthlyIncome = Number(ff.person2?.monthly_income || 0)
  const p1AnnualIncome  = p1MonthlyIncome * 12
  const p2AnnualIncome  = p2MonthlyIncome * 12

  // Annual expenses
  const expCats = ['financial_commitments','household','personal','children','lifestyle']
  const p1AnnualExp = expCats.reduce((s, c) => s + Number(ff[`d_${c}`] || 0), 0) ||
    Number(ff.d_annual_expenses || 0) || (p1AnnualIncome * 0.7)
  const p2AnnualExp = expCats.reduce((s, c) => s + Number(ff[`d2_${c}`] || 0), 0) ||
    Number(ff.d2_annual_expenses || 0) || (p2AnnualIncome * 0.7)

  // Coverage term — until youngest child is 26
  let coverageTerm = 25
  if (children.length > 0) {
    const minAge = Math.min(...children.map((c: any) => Number(c.age || 0)))
    coverageTerm = Math.max(5, 26 - minAge)
  }

  function fvAnnuity(annual: number, rate: number, years: number) {
    if (rate === 0 || years <= 0) return annual * Math.max(0, years)
    return annual * ((Math.pow(1 + rate, years) - 1) / rate)
  }

  const p1FD = fvAnnuity(p1AnnualExp, inflationRate, coverageTerm)
  const p2FD = fvAnnuity(p2AnnualExp, inflationRate, coverageTerm)

  const mortgageNeed  = Number(ff.l_mortgage_residing || 0) + Number(ff.l2_mortgage_residing || 0) + Number(ff.d_mortgage_cpf || 0)
  const educationNeed = Number(ff.strategic_objectives?.ed_total || 0)

  // Assets
  const p1CPF      = Number(ff.a_cpf_oa || 0) + Number(ff.a_cpf_sa || 0) + Number(ff.a_cpf_ma || 0)
  const p2CPF      = Number(ff.a2_cpf_oa || 0) + Number(ff.a2_cpf_sa || 0) + Number(ff.a2_cpf_ma || 0)
  const properties: any[] = ff.properties || []
  const p1PropVal  = properties.filter((p: any) => p.owner === 'client' || p.owner === 'joint')
    .reduce((s: number, p: any) => s + Number(p.current_value || 0) * (p.owner === 'joint' ? 0.5 : 1), 0)
  const p2PropVal  = properties.filter((p: any) => p.owner === 'spouse' || p.owner === 'joint')
    .reduce((s: number, p: any) => s + Number(p.current_value || 0) * (p.owner === 'joint' ? 0.5 : 1), 0)
  const p1Liquid   = Number(ff.a_savings || 0) + Number(ff.a_alternatives || 0)
  const p2Liquid   = Number(ff.a2_savings || 0) + Number(ff.a2_alternatives || 0)

  const p1DTPDOffset = p1CPF + p1PropVal
  const p2DTPDOffset = p2CPF + p2PropVal

  const clientDTPDNeed = Math.max(0, p1FD + mortgageNeed + educationNeed - p1DTPDOffset)
  const clientCINeed   = Math.max(0, p1AnnualIncome * 2 - p1Liquid)
  const spouseDTPDNeed = isCouple ? Math.max(0, p2FD + mortgageNeed - p2DTPDOffset) : 0
  const spouseCINeed   = isCouple ? Math.max(0, p2AnnualIncome * 2 - p2Liquid) : 0

  // Policy totals from portfolio
  function polTotal(person: string, ...types: string[]) {
    return rmData.policies
      .filter(p => p.person === person && types.includes(p.type))
      .reduce((s, p) => s + (p.sumAssured || 0), 0)
  }
  function premTotal(person: string) {
    return rmData.policies.filter(p => p.person === person).reduce((s, p) => s + (p.annualPremium || 0), 0)
  }

  const clientLifeHave  = polTotal('client', 'life', 'tpd')
  const clientCIHave    = polTotal('client', 'ci', 'early_ci')
  const spouseLifeHave  = polTotal('spouse', 'life', 'tpd')
  const spouseCIHave    = polTotal('spouse', 'ci', 'early_ci')
  const totalPremium    = rmData.policies.reduce((s, p) => s + (p.annualPremium || 0), 0)

  // ── Chart data — need curve by age ────────────────────────────────────────
  function buildChartData(
    currentAge: number, annualExp: number, fd: number,
    dtpdNeed: number, ciNeed: number,
    lifeHave: number, ciHave: number
  ) {
    const maxAge = 99
    const points: { age: number; dtpdNeed: number; ciNeed: number }[] = []
    for (let age = currentAge; age <= maxAge; age++) {
      const yearsLeft = Math.max(0, (currentAge + coverageTerm) - age)
      const remainingDTPD = yearsLeft > 0 ? Math.max(0, fvAnnuity(annualExp, inflationRate, yearsLeft) + (age < currentAge + coverageTerm ? mortgageNeed * (yearsLeft / coverageTerm) : 0) - (age <= currentAge ? p1DTPDOffset : 0)) : (age < 65 ? 200000 : 100000)
      // CI need — stays roughly constant then drops at 65 (kids grown, lower expenses)
      const remainingCI = age < 65 ? ciNeed * (1 - (age - currentAge) * 0.008) : ciNeed * 0.6 * (1 - (age - 65) * 0.02)
      points.push({ age, dtpdNeed: Math.max(0, remainingDTPD), ciNeed: Math.max(0, remainingCI) })
    }
    return points
  }

  const activePerson = overviewPerson === 'client' ? 'client' : 'spouse'
  const activeAge    = overviewPerson === 'client' ? clientAge : spouseAge
  const activeDTPD   = overviewPerson === 'client' ? clientDTPDNeed : spouseDTPDNeed
  const activeCI     = overviewPerson === 'client' ? clientCINeed   : spouseCINeed
  const activeLife   = overviewPerson === 'client' ? clientLifeHave : spouseLifeHave
  const activeCIHave = overviewPerson === 'client' ? clientCIHave   : spouseCIHave
  const activeAnnExp = overviewPerson === 'client' ? p1AnnualExp    : p2AnnualExp
  const activeName   = overviewPerson === 'client' ? clientName     : spouseName

  const chartData = buildChartData(activeAge, activeAnnExp, activeDTPD, activeDTPD, activeCI, activeLife, activeCIHave)

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function openNew(person: string) { setEditingPolicy(newPolicy(person)); setModalPerson(person); setShowModal(true) }
  function openEdit(p: Policy) { setEditingPolicy({ ...p }); setModalPerson(p.person); setShowModal(true) }
  function savePolicy(p: Policy) {
    const exists = rmData.policies.find(x => x.id === p.id)
    const next = exists
      ? { ...rmData, policies: rmData.policies.map(x => x.id === p.id ? p : x) }
      : { ...rmData, policies: [...rmData.policies, p] }
    updateRmData(next)
    setShowModal(false)
    setEditingPolicy(null)
  }
  function delPolicy(id: string) { updateRmData({ ...rmData, policies: rmData.policies.filter(p => p.id !== id) }) }

  // Portfolio sections: client, spouse (if couple), each child
  const portfolioSections: { key: string; label: string; isDependent?: boolean }[] = [
    { key: 'client', label: clientName },
    ...(isCouple ? [{ key: 'spouse', label: spouseName }] : []),
    ...children.map((c: any) => ({ key: `child_${c.name || c.id}`, label: c.name || 'Child', isDependent: true })),
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', display: 'flex', flexDirection: 'column' }}>
      {/* ── Hero ── */}
      <div style={{ background: '#1C1A17', padding: '0 48px' }}>
        <div style={{ paddingTop: 32, paddingBottom: 28, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(200,169,110,0.8)', marginBottom: 6 }}>Risk Management</div>
            <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 32, fontWeight: 300, color: '#F0EDE8' }}>
              Wealth Protection — {clientName}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', paddingBottom: 4 }}>
            {saving && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Saving…</span>}
            <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: 3 }}>
              {(['overview', 'portfolio'] as const).map(t => (
                <button key={t} onClick={() => setActiveTab(t)}
                  style={{ padding: '6px 18px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500, background: activeTab === t ? 'rgba(200,169,110,0.2)' : 'transparent', color: activeTab === t ? '#c8a96e' : 'rgba(255,255,255,0.45)', transition: 'all 0.15s' }}>
                  {t === 'overview' ? 'Overview' : 'Portfolio'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <div style={{ padding: '36px 48px', flex: 1 }}>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 32 }}>
            {[
              { label: 'Total Policies', value: String(rmData.policies.length), sub: 'all insured persons' },
              { label: 'Annual Premium', value: fmt(totalPremium), sub: 'combined portfolio' },
              { label: `${clientName} — D/TPD Gap`, value: fmt(Math.max(0, clientDTPDNeed - clientLifeHave)), sub: clientDTPDNeed > 0 ? `Need ${fmt(clientDTPDNeed)}` : 'Complete profile first' },
              { label: `${clientName} — CI Gap`, value: fmt(Math.max(0, clientCINeed - clientCIHave)), sub: clientCINeed > 0 ? `Need ${fmt(clientCINeed)}` : 'Complete profile first' },
            ].map(c => (
              <div key={c.label} style={{ background: 'white', border: '0.5px solid var(--line)', padding: '18px 22px' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>{c.label}</div>
                <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 26, color: 'var(--ink)', fontWeight: 300 }}>{c.value}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Person toggle for gap analysis */}
          {isCouple && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
              {(['client', 'spouse'] as const).map(p => (
                <button key={p} onClick={() => setOverviewPerson(p)}
                  style={{ padding: '7px 20px', border: `1px solid ${overviewPerson === p ? '#c8a96e' : 'var(--line)'}`, background: overviewPerson === p ? '#FDF6EC' : 'white', color: overviewPerson === p ? '#A8834A' : 'var(--ink3)', cursor: 'pointer', fontSize: 12, fontWeight: overviewPerson === p ? 600 : 400, letterSpacing: '0.05em' }}>
                  {p === 'client' ? clientName : spouseName}
                </button>
              ))}
            </div>
          )}

          {/* Gap table */}
          <GapSection
            title={`${activeName} — Coverage Gap Analysis`}
            dtpdNeed={activeDTPD} ciNeed={activeCI}
            lifeHave={activeLife} ciHave={activeCIHave}
            mortgageNeed={mortgageNeed} educationNeed={educationNeed}
            annualPremium={premTotal(activePerson)}
          />

          {/* Charts */}
          {activeDTPD > 0 && (
            <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <CoverageChart
                title="Death / TPD Coverage Needs Analysis"
                needLabel="Required Family Protection Capital"
                haveLabel="Existing Family Protection"
                data={chartData.map(d => ({ age: d.age, need: d.dtpdNeed, have: activeLife }))}
                color="#00BCD4"
              />
              <CoverageChart
                title="Critical Illness Coverage Needs Analysis"
                needLabel="Required Critical Illness Protection"
                haveLabel="Existing Critical Illness Protection"
                data={chartData.map(d => ({ age: d.age, need: d.ciNeed, have: activeCIHave }))}
                color="#00BCD4"
              />
            </div>
          )}

          {activeDTPD === 0 && (
            <div style={{ marginTop: 20, padding: '24px', background: 'white', border: '0.5px solid var(--line)', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--ink3)' }}>Complete the Financial Profile (income, expenses, assets) to generate coverage need charts.</div>
            </div>
          )}

          {/* Advisor notes */}
          <div style={{ marginTop: 28, background: 'white', border: '0.5px solid var(--line)', padding: 26 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 12 }}>Advisor Notes</div>
            <textarea
              value={rmData.advisorNotes}
              onChange={e => updateRmData({ ...rmData, advisorNotes: e.target.value })}
              placeholder="Record observations, client concerns, agreed priorities, follow-up actions…"
              rows={4}
              style={{ width: '100%', resize: 'vertical', border: 'none', outline: 'none', background: '#1C1A17', color: '#c8a96e', fontFamily: 'DM Mono, monospace', fontSize: 13, padding: '14px 16px', borderRadius: 4, boxSizing: 'border-box', lineHeight: 1.7 }}
            />
          </div>
        </div>
      )}

      {/* ── PORTFOLIO TAB ── */}
      {activeTab === 'portfolio' && (
        <div style={{ padding: '36px 48px', flex: 1 }}>

          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }} className="no-print">
            <div>
              <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 22, color: 'var(--ink)' }}>Wealth Protection Portfolio</div>
              <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>
                {rmData.policies.length} {rmData.policies.length === 1 ? 'policy' : 'policies'} · Total annual premium {fmt(totalPremium)}
              </div>
            </div>
            <button onClick={() => window.print()}
              style={{ padding: '8px 18px', background: '#c8a96e', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, letterSpacing: '0.06em' }}>
              Print / PDF
            </button>
          </div>

          {/* Sections per person */}
          {portfolioSections.map(({ key, label, isDependent }) => {
            const policies = rmData.policies.filter(p => p.person === key)
            const personPremium = policies.reduce((s, p) => s + (p.annualPremium || 0), 0)
            return (
              <div key={key} style={{ marginBottom: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 3, height: 18, background: isDependent ? '#7B9E87' : '#c8a96e' }} />
                    <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, color: 'var(--ink)' }}>{label}</div>
                    {isDependent && <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', padding: '2px 7px', border: '1px solid var(--line)', marginLeft: 4 }}>Dependent</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }} className="no-print">
                    {personPremium > 0 && <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Premium: <strong style={{ color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{fmt(personPremium)}</strong></span>}
                    <button onClick={() => openNew(key)}
                      style={{ padding: '6px 14px', background: isDependent ? '#F5FAF6' : 'var(--ink)', color: isDependent ? '#2D6A4F' : 'white', border: isDependent ? '1px solid #7B9E87' : 'none', cursor: 'pointer', fontSize: 12 }}>
                      + Add Policy
                    </button>
                  </div>
                </div>

                {policies.length === 0 ? (
                  <div style={{ background: 'white', border: '0.5px dashed var(--line)', padding: '28px 24px', textAlign: 'center' }}>
                    <div style={{ fontSize: 13, color: 'var(--ink3)' }}>No policies recorded for {label}</div>
                  </div>
                ) : (
                  <PolicyTable policies={policies} onEdit={openEdit} onDelete={delPolicy} />
                )}
              </div>
            )
          })}

          {/* Portfolio summary */}
          {rmData.policies.length > 0 && (
            <div style={{ background: '#1C1A17', padding: '26px 32px', marginTop: 8 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(200,169,110,0.7)', marginBottom: 16 }}>Portfolio Summary</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
                {[
                  { label: 'Total Policies', val: String(rmData.policies.length) },
                  { label: 'Total Annual Premium', val: fmt(totalPremium) },
                  { label: `${clientName} — Life+TPD`, val: fmt(clientLifeHave) },
                  ...(isCouple ? [{ label: `${spouseName} — Life+TPD`, val: fmt(spouseLifeHave) }] : [{ label: 'CI Coverage', val: fmt(clientCIHave) }]),
                ].map(item => (
                  <div key={item.label}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>{item.label}</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 22, color: '#F0EDE8', fontWeight: 300 }}>{item.val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && editingPolicy && (
        <PolicyModal
          policy={editingPolicy}
          personName={portfolioSections.find(s => s.key === modalPerson)?.label || modalPerson}
          onSave={savePolicy}
          onClose={() => { setShowModal(false); setEditingPolicy(null) }}
        />
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          aside, nav { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  )
}

// ─── Coverage Chart ───────────────────────────────────────────────────────────

function CoverageChart({ title, needLabel, haveLabel, data, color }: {
  title: string
  needLabel: string
  haveLabel: string
  data: { age: number; need: number; have: number }[]
  color: string
}) {
  const W = 520, H = 240, PAD = { top: 20, right: 16, bottom: 36, left: 72 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  if (!data.length) return null
  const maxVal = Math.max(...data.map(d => d.need), ...data.map(d => d.have), 1)
  const minAge = data[0].age
  const maxAge = data[data.length - 1].age
  const ageRange = maxAge - minAge || 1

  function xPct(age: number) { return ((age - minAge) / ageRange) * innerW }
  function yPct(val: number) { return innerH - (val / maxVal) * innerH }

  // Need line path
  const needPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${PAD.left + xPct(d.age).toFixed(1)},${PAD.top + yPct(d.need).toFixed(1)}`).join(' ')

  // Y axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ val: maxVal * f, y: PAD.top + innerH - f * innerH }))

  // X axis — show every 4 ages
  const xTicks = data.filter((d, i) => i % 4 === 0)

  // Bar width
  const barW = Math.max(2, innerW / data.length - 1)

  function fmtAxis(n: number) {
    if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`
    return `$${n.toFixed(0)}`
  }

  return (
    <div style={{ background: 'white', border: '0.5px solid var(--line)', padding: '20px 24px' }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginBottom: 10 }}>{title}</div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 24, height: 10, background: '#4A90BF', opacity: 0.7 }} />
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{haveLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="24" height="10"><path d={`M0,5 L24,5`} stroke={color} strokeWidth="2" fill="none" /></svg>
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{needLabel}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: 'visible' }}>
        {/* Grid lines */}
        {yTicks.map(t => (
          <g key={t.val}>
            <line x1={PAD.left} y1={t.y} x2={PAD.left + innerW} y2={t.y} stroke="#E5E3DF" strokeWidth="0.5" />
            <text x={PAD.left - 6} y={t.y + 4} fontSize="9" fill="#999" textAnchor="end">{fmtAxis(t.val)}</text>
          </g>
        ))}

        {/* Have bars */}
        {data.map(d => (
          <rect key={d.age}
            x={PAD.left + xPct(d.age) - barW / 2}
            y={PAD.top + yPct(d.have)}
            width={barW}
            height={Math.max(0, innerH - yPct(d.have))}
            fill="#4A90BF" opacity={0.65}
          />
        ))}

        {/* Need line */}
        <path d={needPath} stroke={color} strokeWidth="2" fill="none" strokeLinejoin="round" />

        {/* X axis */}
        <line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH} stroke="#CCC" strokeWidth="0.5" />
        {xTicks.map(d => (
          <text key={d.age} x={PAD.left + xPct(d.age)} y={PAD.top + innerH + 14} fontSize="9" fill="#999" textAnchor="middle">{d.age}</text>
        ))}
      </svg>
    </div>
  )
}

// ─── Gap Section ──────────────────────────────────────────────────────────────

function GapSection({ title, dtpdNeed, ciNeed, lifeHave, ciHave, mortgageNeed, educationNeed, annualPremium }: {
  title: string
  dtpdNeed: number; ciNeed: number; lifeHave: number; ciHave: number
  mortgageNeed: number; educationNeed: number; annualPremium: number
}) {
  const hasData = dtpdNeed > 0 || ciNeed > 0
  const rows = [
    { label: 'Life / Death & TPD', need: dtpdNeed, have: lifeHave },
    { label: 'Critical Illness', need: ciNeed, have: ciHave },
    ...(mortgageNeed > 0 ? [{ label: 'Mortgage Clearance', need: mortgageNeed, have: 0 }] : []),
    ...(educationNeed > 0 ? [{ label: "Children's Education", need: educationNeed, have: 0 }] : []),
  ]

  return (
    <div style={{ background: 'white', border: '0.5px solid var(--line)' }}>
      <div style={{ padding: '16px 24px', borderBottom: '0.5px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 3, height: 16, background: '#c8a96e' }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{title}</span>
        </div>
        {annualPremium > 0 && <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Portfolio premium: <strong style={{ color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{fmt(annualPremium)}/yr</strong></span>}
      </div>

      {!hasData ? (
        <div style={{ padding: '28px', textAlign: 'center', fontSize: 13, color: 'var(--ink3)' }}>
          Complete the Financial Profile to see gap analysis.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 140px 140px 100px', padding: '10px 24px', background: '#FAFAF8', borderBottom: '0.5px solid var(--line)' }}>
            {['COVERAGE AREA', 'NEED', 'HAVE', 'GAP', 'STATUS'].map(h => (
              <div key={h} style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>{h}</div>
            ))}
          </div>
          {rows.map((row, i) => {
            const gap = row.need - row.have
            const st = gapStatus(row.need, row.have)
            return (
              <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 140px 140px 100px', padding: '13px 24px', alignItems: 'center', borderBottom: i < rows.length - 1 ? '0.5px solid var(--line)' : 'none', background: i % 2 === 0 ? 'white' : '#FAFAF8' }}>
                <span style={{ fontSize: 13, color: 'var(--ink)' }}>{row.label}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)' }}>{fmt(row.need)}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: row.have > 0 ? '#2D6A4F' : 'var(--ink3)' }}>{row.have > 0 ? fmt(row.have) : '—'}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: gap > 0 ? '#9B1C1C' : '#2D6A4F', fontWeight: gap > 0 ? 600 : 400 }}>{gap > 0 ? fmt(gap) : '✓ Covered'}</span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 3, background: st.bg, color: st.color }}>{st.label}</span>
              </div>
            )
          })}
          {/* Coverage bars */}
          <div style={{ padding: '16px 24px', borderTop: '0.5px solid var(--line)', background: '#FAFAF8', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {[{ label: 'Life / D&TPD', need: dtpdNeed, have: lifeHave }, { label: 'Critical Illness', need: ciNeed, have: ciHave }].map(b => {
              const pct = b.need > 0 ? Math.min(100, (b.have / b.need) * 100) : 0
              return (
                <div key={b.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{b.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{Math.round(pct)}% covered</span>
                  </div>
                  <div style={{ height: 5, background: '#E5E3DF', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: pct >= 100 ? '#2D6A4F' : pct > 50 ? '#c8a96e' : '#C0392B', transition: 'width 0.4s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Policy Table ─────────────────────────────────────────────────────────────

function PolicyTable({ policies, onEdit, onDelete }: { policies: Policy[]; onEdit: (p: Policy) => void; onDelete: (id: string) => void }) {
  const subtotal = policies.reduce((s, p) => s + (p.annualPremium || 0), 0)
  return (
    <div style={{ background: 'white', border: '0.5px solid var(--line)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr 130px 130px 70px', padding: '9px 20px', borderBottom: '1px solid var(--line)', background: '#FAFAF8' }}>
        {['TYPE', 'INSURER / PLAN', 'NOTES', 'SUM ASSURED', 'ANN. PREMIUM', ''].map(h => (
          <div key={h} style={{ fontSize: 10, letterSpacing: '0.11em', textTransform: 'uppercase', color: 'var(--ink3)' }}>{h}</div>
        ))}
      </div>
      {policies.map((p, i) => {
        const ti = POLICY_TYPES.find(t => t.value === p.type)
        const col = TYPE_COLORS[p.type] || '#999'
        return (
          <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr 130px 130px 70px', padding: '13px 20px', alignItems: 'center', borderBottom: i < policies.length - 1 ? '0.5px solid var(--line)' : 'none', background: i % 2 === 0 ? 'white' : '#FAFAF8' }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 600, color: col, padding: '2px 7px', background: col + '18', borderRadius: 3 }}>{ti?.short}</span>
              {p.coverageType && <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 3 }}>{p.coverageType === 'term' ? `Term ${p.termYears ? p.termYears + 'yr' : ''}` : p.coverageType === 'whole_life' ? 'Whole Life' : 'ILP'}</div>}
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{p.insurer || <span style={{ color: 'var(--ink3)' }}>—</span>}</div>
              <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 1 }}>{p.planName}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', paddingRight: 8 }}>
              {p.type === 'di' && p.monthlyBenefit ? `$${p.monthlyBenefit.toLocaleString()}/mo · ${p.deferredPeriod || ''}` : (p.notes || '—')}
            </div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)' }}>
              {p.type === 'di' ? '—' : fmt(p.sumAssured)}
            </div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)' }}>{fmt(p.annualPremium)}</div>
            <div style={{ display: 'flex', gap: 6 }} className="no-print">
              <button onClick={() => onEdit(p)} style={{ fontSize: 11, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
              <button onClick={() => onDelete(p.id)} style={{ fontSize: 11, color: '#C0392B', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
            </div>
          </div>
        )
      })}
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr 130px 130px 70px', padding: '11px 20px', borderTop: '1px solid var(--line)', background: '#F8F7F4' }}>
        <div style={{ gridColumn: '1 / 5', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Subtotal</div>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{fmt(subtotal)}</div>
        <div />
      </div>
    </div>
  )
}

// ─── Policy Modal ─────────────────────────────────────────────────────────────

function PolicyModal({ policy, personName, onSave, onClose }: { policy: Policy; personName: string; onSave: (p: Policy) => void; onClose: () => void }) {
  const [form, setForm] = useState<Policy>({ ...policy })
  const f = (k: keyof Policy, v: any) => setForm(prev => ({ ...prev, [k]: v }))
  const isNew = !policy.insurer && !policy.planName

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.65)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'white', width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 20, color: 'var(--ink)' }}>{isNew ? 'Add Policy' : 'Edit Policy'}</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>{personName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ink3)' }}>✕</button>
        </div>

        <div style={{ padding: '22px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Type */}
          <div>
            <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Policy Type</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {POLICY_TYPES.map(t => (
                <button key={t.value} onClick={() => f('type', t.value as Policy['type'])}
                  style={{ padding: '8px', border: `1px solid ${form.type === t.value ? '#c8a96e' : 'var(--line)'}`, background: form.type === t.value ? '#FDF6EC' : 'white', color: form.type === t.value ? '#A8834A' : 'var(--ink3)', cursor: 'pointer', fontSize: 11, fontWeight: form.type === t.value ? 600 : 400 }}>
                  {t.short}
                </button>
              ))}
            </div>
          </div>

          {/* Life sub-type */}
          {form.type === 'life' && (
            <div>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Coverage Type</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[['term','Term'],['whole_life','Whole Life'],['ilp','ILP']].map(([v,l]) => (
                  <button key={v} onClick={() => f('coverageType', v)}
                    style={{ padding: '7px 14px', border: `1px solid ${form.coverageType === v ? '#c8a96e' : 'var(--line)'}`, background: form.coverageType === v ? '#FDF6EC' : 'white', color: form.coverageType === v ? '#A8834A' : 'var(--ink3)', cursor: 'pointer', fontSize: 12 }}>
                    {l}
                  </button>
                ))}
              </div>
              {form.coverageType === 'term' && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Term (years)</label>
                  <input type="number" value={form.termYears || ''} onChange={e => f('termYears', +e.target.value)} style={{ display: 'block', marginTop: 5, width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              )}
            </div>
          )}

          {/* Insurer + Plan */}
          {[{ key: 'insurer' as keyof Policy, label: 'Insurer', ph: 'e.g. Prudential, AIA, Great Eastern' }, { key: 'planName' as keyof Policy, label: 'Plan Name', ph: 'e.g. PRULife, AIA Pro Achiever' }].map(field => (
            <div key={field.key as string}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>{field.label}</label>
              <input type="text" value={(form[field.key] as string) || ''} onChange={e => f(field.key, e.target.value)} placeholder={field.ph}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          ))}

          {/* DI or sum assured */}
          {form.type === 'di' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Monthly Benefit ($)</label>
                <input type="number" value={form.monthlyBenefit || ''} onChange={e => f('monthlyBenefit', +e.target.value)} style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Deferred Period</label>
                <select value={form.deferredPeriod || ''} onChange={e => f('deferredPeriod', e.target.value)} style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none' }}>
                  <option value="">Select…</option>
                  {['30 days','60 days','90 days','180 days','1 year','2 years'].map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Sum Assured ($)</label>
              <input type="number" value={form.sumAssured || ''} onChange={e => f('sumAssured', +e.target.value)} placeholder="0" style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          )}

          {/* Annual premium */}
          <div>
            <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Annual Premium ($)</label>
            <input type="number" value={form.annualPremium || ''} onChange={e => f('annualPremium', +e.target.value)} placeholder="0" style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
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
            <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Notes</label>
            <input type="text" value={form.notes || ''} onChange={e => f('notes', e.target.value)} placeholder="Optional — policy number, expiry, remarks" style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>

        <div style={{ padding: '14px 28px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '9px 18px', background: 'none', border: '1px solid var(--line)', color: 'var(--ink3)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={() => onSave(form)} style={{ padding: '9px 18px', background: '#1C1A17', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
            {isNew ? 'Add Policy' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
