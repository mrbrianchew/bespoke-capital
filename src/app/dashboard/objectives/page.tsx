'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClientData {
  id: string
  full_name: string
  date_of_birth?: string
  advisor_id: string
}

interface FamilyMember {
  id: string
  client_id: string
  name: string
  relationship: string
  date_of_birth?: string
  age?: number
}

interface ProtectionData {
  monthlyIncomeClient?: number
  monthlyIncomeSpouse?: number
  monthlyHouseholdExpenses?: number
  monthlyMortgageRent?: number
  outstandingMortgage?: number
  otherLoans?: number
  yearsToClearMortgage?: number
  incomeReplacementClient?: number
  incomeReplacementSpouse?: number
  yearsOfCoverage?: number
  ciRecoveryPeriod?: string
  lifeCoverClient?: number
  lifeCoverSpouse?: number
  ciCoverClient?: number
  ciCoverSpouse?: number
  disabilityIncomeClient?: number
  disabilityIncomeSpouse?: number
  advisorNotes?: string
}

interface AccumulationData {
  monthlySurplus?: number
  lumpSumAvailable?: number
  currentInvestments?: number
  riskAppetite?: string
  investmentTimeHorizon?: string
  expectedReturnRate?: number
  financialGoals?: string[]
  advisorNotes?: string
}

interface RetirementData {
  retirementAgeClient?: number
  retirementAgeSpouse?: number
  lifeExpectancyClient?: number
  lifeExpectancySpouse?: number
  monthlyRetirementIncomeClient?: number
  monthlyRetirementIncomeSpouse?: number
  inflationRate?: number
  postRetirementReturn?: number
  leaveALegacy?: string
  legacyAmountTarget?: number
  continueCpfInRetirement?: string
  advisorNotes?: string
}

interface ChildEducation {
  childId: string
  name: string
  currentAge: number
  studyDestination?: string
  courseDuration?: number
  estimatedTotalCost?: number
  currentSavings?: number
  monthlySavings?: number
  protectionOnFund?: string
}

interface EducationData {
  children?: ChildEducation[]
  advisorNotes?: string
}

interface EstateData {
  willClient?: string
  willSpouse?: string
  willLastUpdatedClient?: string
  willLastUpdatedSpouse?: string
  preferredGuardian?: string
  trustSetUp?: string
  trustPurposeNotes?: string
  policyNominationsClient?: string
  policyNominationsSpouse?: string
  cpfNominationClient?: string
  cpfNominationSpouse?: string
  lpaClient?: string
  lpaSpouse?: string
  doneeClient?: string
  doneeSpouse?: string
  advisorNotes?: string
}

interface AllSections {
  protection: ProtectionData
  accumulation: AccumulationData
  retirement: RetirementData
  education: EducationData
  estate: EstateData
  planningMode?: 'individual' | 'couple'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcAge(dob?: string): number {
  if (!dob) return 0
  const birth = new Date(dob)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
  return age
}

function fmtCurrency(val?: number): string {
  if (!val) return '—'
  return `S$${val.toLocaleString('en-SG')}`
}

function sectionCompletion(section: string, data: AllSections): number {
  const d = data as Record<string, Record<string, unknown>>
  const s = d[section]
  if (!s) return 0
  const vals = Object.values(s).filter(v => v !== undefined && v !== '' && v !== null)
  const total = Object.keys(s).length || 1
  return Math.round((vals.length / total) * 100)
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ObjectivesPage() {
  const supabase = createClient()
  const [userId, setUserId] = useState<string | null>(null)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [client, setClient] = useState<ClientData | null>(null)
  const [spouse, setSpouse] = useState<FamilyMember | null>(null)
  const [children, setChildren] = useState<FamilyMember[]>([])
  const [planningMode, setPlanningMode] = useState<'individual' | 'couple'>('individual')
  const [activeSection, setActiveSection] = useState<number>(0)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [data, setData] = useState<AllSections>({
    protection: {},
    accumulation: {},
    retirement: {},
    education: {},
    estate: {},
    planningMode: 'individual',
  })

  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // ─── Auth & client ───────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  }, [])

  useEffect(() => {
    if (!userId) return
    const stored = localStorage.getItem('selectedClientId')
    if (stored) setSelectedClientId(stored)
  }, [userId])

  useEffect(() => {
    if (!selectedClientId || !userId) return
    loadAll()
  }, [selectedClientId, userId])

  // ─── Load data ───────────────────────────────────────────────────────────

  async function loadAll() {
    if (!selectedClientId) return
    setLoading(true)

    const [clientRes, familyRes, factRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', selectedClientId).single(),
      supabase.from('family_members').select('*').eq('client_id', selectedClientId),
      supabase.from('fact_finding').select('*').eq('client_id', selectedClientId),
    ])

    if (clientRes.data) setClient(clientRes.data)

    if (familyRes.data) {
      const spouseRec = familyRes.data.find(m => m.relationship === 'Spouse')
      const childRecs = familyRes.data.filter(m => m.relationship === 'Daughter' || m.relationship === 'Son')
      setSpouse(spouseRec || null)
      setChildren(childRecs)

      // Auto-detect planning mode from DB
      if (spouseRec) setPlanningMode('couple')
    }

    if (factRes.data && factRes.data.length > 0) {
      const newData: AllSections = {
        protection: {},
        accumulation: {},
        retirement: {},
        education: { children: [] },
        estate: {},
      }

      factRes.data.forEach(row => {
        const section = row.section as keyof AllSections
        if (section && row.data) {
          if (section === 'planningMode') {
            // planningMode saved as a meta section
          } else {
            (newData as Record<string, unknown>)[section] = row.data
          }
          // Restore planning mode if stored
          if (row.data?.planningMode) {
            setPlanningMode(row.data.planningMode)
          }
        }
      })

      // Pre-populate education children from family_members if not already set
      if (!newData.education?.children?.length && familyRes.data) {
        const childRecs = familyRes.data.filter(m => m.relationship === 'Daughter' || m.relationship === 'Son')
        newData.education.children = childRecs.map(c => ({
          childId: c.id,
          name: c.name,
          currentAge: c.age ?? calcAge(c.date_of_birth),
        }))
      }

      setData(newData)
    } else {
      // Pre-populate education from family_members
      if (familyRes.data) {
        const childRecs = familyRes.data.filter(m => m.relationship === 'Daughter' || m.relationship === 'Son')
        setData(prev => ({
          ...prev,
          education: {
            children: childRecs.map(c => ({
              childId: c.id,
              name: c.name,
              currentAge: c.age ?? calcAge(c.date_of_birth),
            }))
          }
        }))
      }
    }

    setLoading(false)
  }

  // ─── Save ────────────────────────────────────────────────────────────────

  const saveSection = useCallback(async (
    section: keyof AllSections,
    sectionData: Record<string, unknown>,
    mode?: 'individual' | 'couple'
  ) => {
    if (!selectedClientId) return
    setSaveStatus('saving')

    const payload = mode ? { ...sectionData, planningMode: mode } : sectionData

    await supabase.from('fact_finding').upsert(
      { client_id: selectedClientId, section, data: payload, updated_at: new Date().toISOString() },
      { onConflict: 'client_id,section' }
    )

    setSaveStatus('saved')
    setLastSaved(new Date())
    setTimeout(() => setSaveStatus('idle'), 2000)
  }, [selectedClientId])

  function updateSection<T extends keyof AllSections>(
    section: T,
    field: string,
    value: unknown
  ) {
    setData(prev => {
      const updated = { ...prev[section] as Record<string, unknown>, [field]: value }
      const updatedAll = { ...prev, [section]: updated }

      if (debounceRef.current[section]) clearTimeout(debounceRef.current[section])
      debounceRef.current[section] = setTimeout(() => {
        saveSection(section, updated)
      }, 800)

      return updatedAll
    })
  }

  function updatePlanningMode(mode: 'individual' | 'couple') {
    setPlanningMode(mode)
    // Save mode alongside protection section
    if (debounceRef.current['mode']) clearTimeout(debounceRef.current['mode'])
    debounceRef.current['mode'] = setTimeout(() => {
      saveSection('protection', { ...(data.protection as Record<string, unknown>), planningMode: mode })
    }, 800)
  }

  async function saveAll() {
    if (!selectedClientId) return
    setSaveStatus('saving')

    const sections: Array<keyof AllSections> = ['protection', 'accumulation', 'retirement', 'education', 'estate']
    await Promise.all(sections.map(s =>
      supabase.from('fact_finding').upsert(
        {
          client_id: selectedClientId,
          section: s,
          data: { ...(data[s] as Record<string, unknown>), planningMode: s === 'protection' ? planningMode : undefined },
          updated_at: new Date().toISOString()
        },
        { onConflict: 'client_id,section' }
      )
    ))

    setSaveStatus('saved')
    setLastSaved(new Date())
    showToast('Discovery saved — Risk Management and Capital Mandate tabs have been updated.')
    setTimeout(() => setSaveStatus('idle'), 2000)
  }

  function showToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 4000)
  }

  // ─── Calculated previews ─────────────────────────────────────────────────

  const p = data.protection
  const a = data.accumulation
  const r = data.retirement
  const edu = data.education
  const clientAge = calcAge(client?.date_of_birth)

  const lifeCoverNeeded = ((p.monthlyIncomeClient || 0) * 12 * (p.yearsOfCoverage || 10))
  const ciCoverNeeded = ((p.monthlyIncomeClient || 0) * 12 * 5)
  const yearsToRetirement = Math.max(0, (r.retirementAgeClient || 65) - clientAge)
  const retirementYears = Math.max(0, (r.lifeExpectancyClient || 85) - (r.retirementAgeClient || 65))
  const monthlyIncome = r.monthlyRetirementIncomeClient || 0
  const postReturn = (r.postRetirementReturn || 4) / 100
  const inflation = (r.inflationRate || 3) / 100
  const realReturn = postReturn - inflation
  const retirementCorpus = retirementYears > 0 && realReturn > 0
    ? monthlyIncome * 12 * ((1 - Math.pow(1 + realReturn, -retirementYears)) / realReturn)
    : monthlyIncome * 12 * retirementYears

  const eduFundNeeded = edu.children?.reduce((sum, c) => sum + (c.estimatedTotalCost || 0), 0) || 0

  // ─── Section completion ──────────────────────────────────────────────────

  const sections = ['protection', 'accumulation', 'retirement', 'education', 'estate']
  const sectionLabels = ['Wealth Protection', 'Wealth Accumulation', 'Retirement', 'Education Planning', 'Estate Planning']

  function getSectionPct(i: number): number {
    return sectionCompletion(sections[i], data)
  }

  const completedCount = sections.filter((_, i) => getSectionPct(i) > 80).length

  // ─── Estate flags ────────────────────────────────────────────────────────

  const estate = data.estate
  const estateFlags: string[] = []
  if (!estate.willClient || estate.willClient === 'No' || estate.willClient === 'Outdated')
    estateFlags.push(`Will (Client)${estate.willClient === 'Outdated' ? ' — Outdated' : ' — Not done'}`)
  if (planningMode === 'couple' && (!estate.willSpouse || estate.willSpouse === 'No' || estate.willSpouse === 'Outdated'))
    estateFlags.push(`Will (Spouse)${estate.willSpouse === 'Outdated' ? ' — Outdated' : ' — Not done'}`)
  if (estate.cpfNominationClient === 'Not done' || !estate.cpfNominationClient)
    estateFlags.push('CPF Nomination (Client) — Not done')
  if (planningMode === 'couple' && estate.cpfNominationSpouse === 'Not done')
    estateFlags.push('CPF Nomination (Spouse) — Not done')
  if (!estate.lpaClient || estate.lpaClient === 'Not done')
    estateFlags.push('LPA (Client) — Not done')
  if (planningMode === 'couple' && (!estate.lpaSpouse || estate.lpaSpouse === 'Not done'))
    estateFlags.push('LPA (Spouse) — Not done')

  // ─── Render guards ───────────────────────────────────────────────────────

  if (!userId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--cream)' }}>
        <p style={{ fontFamily: 'var(--font-serif)', color: 'var(--ink3)', fontSize: '1.1rem' }}>Loading session…</p>
      </div>
    )
  }

  if (!selectedClientId || !client) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--cream)' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.4rem', color: 'var(--ink2)', marginBottom: '0.5rem' }}>No client selected</p>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', color: 'var(--ink3)' }}>Select a client from the sidebar to begin discovery.</p>
        </div>
      </div>
    )
  }

  const spouseName = spouse?.name || 'Spouse'

  // ─── Input helpers ───────────────────────────────────────────────────────

  function CurrencyInput({ section, field, label, placeholder = '0' }: {
    section: keyof AllSections, field: string, label: string, placeholder?: string
  }) {
    const val = ((data[section] as Record<string, unknown>)?.[field] as number) || ''
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={styles.label}>{label}</label>
        <div style={styles.currencyWrap}>
          <span style={styles.currencyPrefix}>SGD $</span>
          <input
            type="number"
            placeholder={placeholder}
            value={val}
            onChange={e => updateSection(section, field, e.target.value ? Number(e.target.value) : undefined)}
            style={styles.currencyInput}
            onFocus={e => { e.target.style.borderBottomColor = 'var(--gold)' }}
            onBlur={e => { e.target.style.borderBottomColor = 'var(--line2)' }}
          />
        </div>
      </div>
    )
  }

  function NumInput({ section, field, label, suffix = '', placeholder = '0' }: {
    section: keyof AllSections, field: string, label: string, suffix?: string, placeholder?: string
  }) {
    const val = ((data[section] as Record<string, unknown>)?.[field] as number) || ''
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={styles.label}>{label}</label>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <input
            type="number"
            placeholder={placeholder}
            value={val}
            onChange={e => updateSection(section, field, e.target.value ? Number(e.target.value) : undefined)}
            style={{ ...styles.input, width: suffix ? '70px' : '100%' }}
            onFocus={e => { e.target.style.borderBottomColor = 'var(--gold)' }}
            onBlur={e => { e.target.style.borderBottomColor = 'var(--line2)' }}
          />
          {suffix && <span style={{ fontSize: '11px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif' }}>{suffix}</span>}
        </div>
      </div>
    )
  }

  function SelectInput({ section, field, label, options }: {
    section: keyof AllSections, field: string, label: string, options: string[]
  }) {
    const val = ((data[section] as Record<string, unknown>)?.[field] as string) || ''
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={styles.label}>{label}</label>
        <select
          value={val}
          onChange={e => updateSection(section, field, e.target.value)}
          style={styles.select}
          onFocus={e => { e.target.style.borderBottomColor = 'var(--gold)' }}
          onBlur={e => { e.target.style.borderBottomColor = 'var(--line2)' }}
        >
          <option value="">Select…</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    )
  }

  function TextInput({ section, field, label, placeholder = '' }: {
    section: keyof AllSections, field: string, label: string, placeholder?: string
  }) {
    const val = ((data[section] as Record<string, unknown>)?.[field] as string) || ''
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={styles.label}>{label}</label>
        <input
          type="text"
          placeholder={placeholder}
          value={val}
          onChange={e => updateSection(section, field, e.target.value)}
          style={styles.input}
          onFocus={e => { e.target.style.borderBottomColor = 'var(--gold)' }}
          onBlur={e => { e.target.style.borderBottomColor = 'var(--line2)' }}
        />
      </div>
    )
  }

  function NotesTextarea({ section, placeholder }: { section: keyof AllSections, placeholder: string }) {
    const val = ((data[section] as Record<string, unknown>)?.advisorNotes as string) || ''
    return (
      <div style={styles.notesBar}>
        <div style={{ fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: '8px', fontFamily: 'Inter, sans-serif' }}>
          Advisor Notes
        </div>
        <textarea
          placeholder={placeholder}
          value={val}
          onChange={e => updateSection(section, 'advisorNotes', e.target.value)}
          rows={3}
          style={styles.notesInput}
          onFocus={e => { e.target.style.borderBottomColor = 'rgba(168,131,74,0.6)' }}
          onBlur={e => { e.target.style.borderBottomColor = 'rgba(255,255,255,0.15)' }}
        />
      </div>
    )
  }

  function SubSectionTitle({ label, color = 'var(--gold)' }: { label: string, color?: string }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', marginTop: '24px' }}>
        <div style={{ width: '3px', height: '14px', background: color, borderRadius: '2px' }} />
        <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink2)', fontFamily: 'Inter, sans-serif' }}>{label}</span>
      </div>
    )
  }

  function PersonHeader() {
    if (planningMode === 'individual') return null
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
        {[
          { name: client?.full_name || 'Client', age: clientAge, label: 'Client' },
          { name: spouseName, age: spouse ? calcAge(spouse.date_of_birth) : null, label: 'Spouse' }
        ].map((p, i) => (
          <div key={i} style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '6px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: i === 0 ? 'var(--gold-l)' : 'var(--emerald-l)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600, color: i === 0 ? 'var(--gold-tag)' : 'var(--emerald)', fontFamily: 'Inter, sans-serif' }}>
              {p.name.charAt(0)}
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)', fontFamily: 'Inter, sans-serif' }}>{p.name}</div>
              <div style={{ fontSize: '10px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif' }}>{p.label}{p.age ? ` · Age ${p.age}` : ''}</div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  function TwoCol({ children }: { children: React.ReactNode }) {
    return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>{children}</div>
  }

  function SectionIntro({ eyebrow, title, subtitle }: { eyebrow: string, title: string, subtitle: string }) {
    return (
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gold)', fontFamily: 'Inter, sans-serif', marginBottom: '8px' }}>{eyebrow}</div>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.7rem', fontWeight: 300, color: 'var(--ink)', margin: '0 0 8px' }}>{title}</h2>
        <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: '0.95rem', color: 'var(--ink3)', lineHeight: 1.6, margin: 0 }}>{subtitle}</p>
      </div>
    )
  }

  // ─── SECTIONS ────────────────────────────────────────────────────────────

  function Section1() {
    return (
      <div>
        <SectionIntro
          eyebrow="Section 1 · Wealth Protection"
          title="Protection Needs"
          subtitle="Understanding what needs to be protected — income, debts, family obligations — if either of you were unable to work."
        />
        <PersonHeader />

        <SubSectionTitle label="Monthly Income & Expenses" />
        <div style={{ display: 'grid', gridTemplateColumns: planningMode === 'couple' ? '1fr 1fr' : '1fr 1fr', gap: '20px' }}>
          <CurrencyInput section="protection" field="monthlyIncomeClient" label={planningMode === 'couple' ? `Monthly Income — ${client?.full_name?.split(' ')[0]}` : 'Monthly Income'} />
          {planningMode === 'couple' && <CurrencyInput section="protection" field="monthlyIncomeSpouse" label={`Monthly Income — ${spouseName.split(' ')[0]}`} />}
          <CurrencyInput section="protection" field="monthlyHouseholdExpenses" label="Monthly Household Expenses" />
          <CurrencyInput section="protection" field="monthlyMortgageRent" label="Monthly Mortgage / Rent" />
        </div>

        <SubSectionTitle label="Liabilities & Debts" color="var(--ink3)" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
          <CurrencyInput section="protection" field="outstandingMortgage" label="Outstanding Mortgage" />
          <CurrencyInput section="protection" field="otherLoans" label="Other Loans / Debts" />
          <NumInput section="protection" field="yearsToClearMortgage" label="Years to Clear Mortgage" suffix="yrs" />
        </div>

        <SubSectionTitle label="Income Replacement Needs" color="var(--emerald)" />
        <div style={{ display: 'grid', gridTemplateColumns: planningMode === 'couple' ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: '20px' }}>
          <CurrencyInput section="protection" field="incomeReplacementClient" label={planningMode === 'couple' ? `Replacement Needed — ${client?.full_name?.split(' ')[0]}` : 'Income Replacement Needed'} />
          {planningMode === 'couple' && <CurrencyInput section="protection" field="incomeReplacementSpouse" label={`Replacement Needed — ${spouseName.split(' ')[0]}`} />}
          <NumInput section="protection" field="yearsOfCoverage" label="Years of Coverage Needed" suffix="yrs" />
          <SelectInput section="protection" field="ciRecoveryPeriod" label="CI Recovery Period" options={['3 years', '5 years', 'Until retirement']} />
        </div>

        <SubSectionTitle label="Existing Coverage" color="var(--gold-tag)" />
        <div style={{ display: 'grid', gridTemplateColumns: planningMode === 'couple' ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: '20px' }}>
          <CurrencyInput section="protection" field="lifeCoverClient" label={`Life Cover — ${planningMode === 'couple' ? client?.full_name?.split(' ')[0] : 'Client'}`} />
          {planningMode === 'couple' && <CurrencyInput section="protection" field="lifeCoverSpouse" label={`Life Cover — ${spouseName.split(' ')[0]}`} />}
          <CurrencyInput section="protection" field="ciCoverClient" label={`CI Cover — ${planningMode === 'couple' ? client?.full_name?.split(' ')[0] : 'Client'}`} />
          {planningMode === 'couple' && <CurrencyInput section="protection" field="ciCoverSpouse" label={`CI Cover — ${spouseName.split(' ')[0]}`} />}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: planningMode === 'couple' ? '1fr 1fr' : '1fr 1fr', gap: '20px', marginTop: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={styles.label}>{`Disability Income — ${planningMode === 'couple' ? client?.full_name?.split(' ')[0] : 'Client'}`}</label>
            <div style={styles.currencyWrap}>
              <span style={styles.currencyPrefix}>SGD $</span>
              <input
                type="number"
                placeholder="0"
                value={(data.protection.disabilityIncomeClient as number) || ''}
                onChange={e => updateSection('protection', 'disabilityIncomeClient', e.target.value ? Number(e.target.value) : undefined)}
                style={{ ...styles.currencyInput, flex: 1 }}
                onFocus={e => { e.target.style.borderBottomColor = 'var(--gold)' }}
                onBlur={e => { e.target.style.borderBottomColor = 'var(--line2)' }}
              />
              <span style={{ fontSize: '10px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', paddingBottom: '2px' }}>/mo</span>
            </div>
          </div>
          {planningMode === 'couple' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={styles.label}>{`Disability Income — ${spouseName.split(' ')[0]}`}</label>
              <div style={styles.currencyWrap}>
                <span style={styles.currencyPrefix}>SGD $</span>
                <input
                  type="number"
                  placeholder="0"
                  value={(data.protection.disabilityIncomeSpouse as number) || ''}
                  onChange={e => updateSection('protection', 'disabilityIncomeSpouse', e.target.value ? Number(e.target.value) : undefined)}
                  style={{ ...styles.currencyInput, flex: 1 }}
                  onFocus={e => { e.target.style.borderBottomColor = 'var(--gold)' }}
                  onBlur={e => { e.target.style.borderBottomColor = 'var(--line2)' }}
                />
                <span style={{ fontSize: '10px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', paddingBottom: '2px' }}>/mo</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: '32px' }}>
          <NotesTextarea section="protection" placeholder="Record any context, client concerns, or details discussed during this section…" />
        </div>
      </div>
    )
  }

  function Section2() {
    const goals: string[] = data.accumulation.financialGoals || []
    const goalChips = ['Retirement', "Children's education", 'Pay off mortgage', 'Second property', 'Passive income', 'Leave a legacy', 'Business', 'Travel fund']

    function toggleGoal(g: string) {
      const current = data.accumulation.financialGoals || []
      const updated = current.includes(g) ? current.filter(x => x !== g) : [...current, g]
      updateSection('accumulation', 'financialGoals', updated)
    }

    return (
      <div>
        <SectionIntro
          eyebrow="Section 2 · Wealth Accumulation"
          title="Savings & Investment Needs"
          subtitle="Understanding the client's savings capacity, risk appetite, and investment goals."
        />

        <SubSectionTitle label="Savings Capacity" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
          <CurrencyInput section="accumulation" field="monthlySurplus" label="Monthly Surplus Available" />
          <CurrencyInput section="accumulation" field="lumpSumAvailable" label="Lump Sum Available Now" />
          <CurrencyInput section="accumulation" field="currentInvestments" label="Current Total Investments" />
        </div>

        <SubSectionTitle label="Risk Profile" color="var(--emerald)" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
          <SelectInput section="accumulation" field="riskAppetite" label="Risk Appetite" options={['Very Conservative (1)', 'Conservative (2)', 'Balanced (3)', 'Growth (4)', 'Aggressive (5)']} />
          <SelectInput section="accumulation" field="investmentTimeHorizon" label="Investment Time Horizon" options={['Under 5 years', '5–10 years', '10–20 years', '20+ years']} />
          <NumInput section="accumulation" field="expectedReturnRate" label="Expected Return Rate" suffix="% p.a." placeholder="6" />
        </div>

        <SubSectionTitle label="Financial Goals" color="var(--ink3)" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '24px' }}>
          {goalChips.map(g => (
            <button
              key={g}
              onClick={() => toggleGoal(g)}
              style={{
                padding: '6px 14px',
                borderRadius: '20px',
                border: goals.includes(g) ? '1.5px solid var(--gold)' : '1.5px solid var(--line2)',
                background: goals.includes(g) ? 'var(--gold-l)' : 'transparent',
                color: goals.includes(g) ? 'var(--gold-tag)' : 'var(--ink3)',
                fontSize: '12px',
                fontFamily: 'Inter, sans-serif',
                fontWeight: goals.includes(g) ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {g}
            </button>
          ))}
        </div>

        <NotesTextarea section="accumulation" placeholder="Investment preferences, constraints, prior experience, concerns discussed…" />
      </div>
    )
  }

  function Section3() {
    const legacyVal = data.retirement.leaveALegacy || ''
    return (
      <div>
        <SectionIntro
          eyebrow="Section 3 · Retirement Planning"
          title="Retirement Needs"
          subtitle="Planning the income and capital required to sustain your desired lifestyle from retirement through to end of life."
        />
        <PersonHeader />

        <SubSectionTitle label="Retirement Parameters" />
        <div style={{ display: 'grid', gridTemplateColumns: planningMode === 'couple' ? '1fr 1fr 1fr 1fr' : '1fr 1fr', gap: '20px' }}>
          <NumInput section="retirement" field="retirementAgeClient" label={`Retirement Age — ${planningMode === 'couple' ? client?.full_name?.split(' ')[0] : 'Client'}`} suffix="yrs" placeholder="65" />
          {planningMode === 'couple' && <NumInput section="retirement" field="retirementAgeSpouse" label={`Retirement Age — ${spouseName.split(' ')[0]}`} suffix="yrs" placeholder="65" />}
          <NumInput section="retirement" field="lifeExpectancyClient" label={`Life Expectancy — ${planningMode === 'couple' ? client?.full_name?.split(' ')[0] : 'Client'}`} suffix="yrs" placeholder="85" />
          {planningMode === 'couple' && <NumInput section="retirement" field="lifeExpectancySpouse" label={`Life Expectancy — ${spouseName.split(' ')[0]}`} suffix="yrs" placeholder="85" />}
        </div>

        <SubSectionTitle label="Retirement Income Desired (Today's $)" color="var(--emerald)" />
        <div style={{ display: 'grid', gridTemplateColumns: planningMode === 'couple' ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: '20px' }}>
          <CurrencyInput section="retirement" field="monthlyRetirementIncomeClient" label={`Monthly Income — ${planningMode === 'couple' ? client?.full_name?.split(' ')[0] : 'Client'}`} />
          {planningMode === 'couple' && <CurrencyInput section="retirement" field="monthlyRetirementIncomeSpouse" label={`Monthly Income — ${spouseName.split(' ')[0]}`} />}
          <NumInput section="retirement" field="inflationRate" label="Inflation Rate" suffix="%" placeholder="3" />
          <NumInput section="retirement" field="postRetirementReturn" label="Post-Retirement Return Rate" suffix="%" placeholder="4" />
        </div>

        <SubSectionTitle label="Legacy" color="var(--gold-tag)" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
          <SelectInput section="retirement" field="leaveALegacy" label="Leave a Legacy?" options={['No', 'Yes — specific amount', 'Nice to have']} />
          {legacyVal === 'Yes — specific amount' && <CurrencyInput section="retirement" field="legacyAmountTarget" label="Legacy Amount Target" />}
          <SelectInput section="retirement" field="continueCpfInRetirement" label="Continue Investing CPF in Retirement?" options={['Yes', 'No']} />
        </div>

        <div style={{ marginTop: '32px' }}>
          <NotesTextarea section="retirement" placeholder="Retirement lifestyle aspirations, travel plans, healthcare concerns, family obligations…" />
        </div>
      </div>
    )
  }

  function Section4() {
    const eduChildren: ChildEducation[] = data.education.children || []

    function updateChild(idx: number, field: string, value: unknown) {
      const updated = [...eduChildren]
      updated[idx] = { ...updated[idx], [field]: value }
      setData(prev => {
        const updatedData = { ...prev, education: { ...prev.education, children: updated } }
        if (debounceRef.current['education']) clearTimeout(debounceRef.current['education'])
        debounceRef.current['education'] = setTimeout(() => {
          saveSection('education', { children: updated, advisorNotes: prev.education.advisorNotes })
        }, 800)
        return updatedData
      })
    }

    function addChild() {
      const newChild: ChildEducation = { childId: `new-${Date.now()}`, name: '', currentAge: 0 }
      const updated = [...eduChildren, newChild]
      setData(prev => ({
        ...prev,
        education: { ...prev.education, children: updated }
      }))
    }

    const studyOptions = ['Singapore — Local', 'Singapore — Private', 'Australia', 'UK', 'US', 'Other']

    return (
      <div>
        <SectionIntro
          eyebrow="Section 4 · Education Planning"
          title="University Education Fund"
          subtitle="Planning the savings required to fund each child's tertiary education — both accumulation and protection."
        />

        {eduChildren.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', border: '1.5px dashed var(--line2)', borderRadius: '8px', marginBottom: '24px' }}>
            <p style={{ fontFamily: 'var(--font-serif)', color: 'var(--ink3)', marginBottom: '16px' }}>No children found in the client profile.</p>
            <button onClick={addChild} style={styles.addChildBtn}>+ Add Child</button>
          </div>
        ) : (
          <>
            {eduChildren.map((child, idx) => (
              <div key={child.childId} style={{ border: '1px solid var(--line)', borderRadius: '8px', padding: '20px 24px', marginBottom: '16px', background: 'white' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--emerald-l)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 600, color: 'var(--emerald)', fontFamily: 'Inter, sans-serif' }}>
                    {(child.name || '?').charAt(0)}
                  </div>
                  <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink2)', fontFamily: 'Inter, sans-serif' }}>
                    Child {idx + 1} {child.name ? `— ${child.name}` : ''}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={styles.label}>Child's Name</label>
                    <input type="text" value={child.name} onChange={e => updateChild(idx, 'name', e.target.value)} style={styles.input} onFocus={e => { e.target.style.borderBottomColor = 'var(--gold)' }} onBlur={e => { e.target.style.borderBottomColor = 'var(--line2)' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={styles.label}>Current Age</label>
                    <input type="number" value={child.currentAge || ''} onChange={e => updateChild(idx, 'currentAge', Number(e.target.value))} style={{ ...styles.input, width: '60px' }} onFocus={e => { e.target.style.borderBottomColor = 'var(--gold)' }} onBlur={e => { e.target.style.borderBottomColor = 'var(--line2)' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={styles.label}>Study Destination</label>
                    <select value={child.studyDestination || ''} onChange={e => updateChild(idx, 'studyDestination', e.target.value)} style={styles.select} onFocus={e => { e.target.style.borderBottomColor = 'var(--gold)' }} onBlur={e => { e.target.style.borderBottomColor = 'var(--line2)' }}>
                      <option value="">Select…</option>
                      {studyOptions.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={styles.label}>Course Duration</label>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <input type="number" value={child.courseDuration || ''} onChange={e => updateChild(idx, 'courseDuration', Number(e.target.value))} style={{ ...styles.input, width: '50px' }} onFocus={e => { e.target.style.borderBottomColor = 'var(--gold)' }} onBlur={e => { e.target.style.borderBottomColor = 'var(--line2)' }} />
                      <span style={{ fontSize: '11px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif' }}>yrs</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '16px' }}>
                  {[
                    { field: 'estimatedTotalCost', label: 'Estimated Total Cost' },
                    { field: 'currentSavings', label: 'Current Savings for Child' },
                    { field: 'monthlySavings', label: 'Monthly Savings Available' },
                  ].map(({ field, label }) => (
                    <div key={field} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={styles.label}>{label}</label>
                      <div style={styles.currencyWrap}>
                        <span style={styles.currencyPrefix}>SGD $</span>
                        <input type="number" value={(child as Record<string, unknown>)[field] as number || ''} onChange={e => updateChild(idx, field, e.target.value ? Number(e.target.value) : undefined)} style={styles.currencyInput} onFocus={e => { e.target.style.borderBottomColor = 'var(--gold)' }} onBlur={e => { e.target.style.borderBottomColor = 'var(--line2)' }} />
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={styles.label}>Protection on Fund?</label>
                    <select value={child.protectionOnFund || ''} onChange={e => updateChild(idx, 'protectionOnFund', e.target.value)} style={styles.select} onFocus={e => { e.target.style.borderBottomColor = 'var(--gold)' }} onBlur={e => { e.target.style.borderBottomColor = 'var(--line2)' }}>
                      <option value="">Select…</option>
                      <option>Yes — waiver of premium</option>
                      <option>No</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addChild} style={styles.addChildBtn}>+ Add another child</button>
          </>
        )}

        <div style={{ marginTop: '24px' }}>
          <NotesTextarea section="education" placeholder="Education preferences, overseas vs local, scholarship plans, existing savings vehicles…" />
        </div>
      </div>
    )
  }

  function Section5() {
    const willClientVal = estate.willClient || ''
    const willSpouseVal = estate.willSpouse || ''

    return (
      <div>
        <SectionIntro
          eyebrow="Section 5 · Estate Planning"
          title="Estate & Legacy"
          subtitle="Ensuring assets are protected, distributed as intended, and the right people are empowered to act on your behalf."
        />
        <PersonHeader />

        {/* Urgent flags */}
        {estateFlags.length > 0 && (
          <div style={{ background: 'var(--rouge-l)', border: '3px solid var(--rouge)', borderRadius: '8px', padding: '16px 20px', marginBottom: '28px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--rouge)', fontFamily: 'Inter, sans-serif', marginBottom: '8px' }}>
              ⚠ Urgent Estate Gaps
            </div>
            {estateFlags.map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--rouge)', flexShrink: 0 }} />
                <span style={{ fontSize: '12px', color: 'var(--rouge)', fontFamily: 'Inter, sans-serif' }}>{f}</span>
              </div>
            ))}
          </div>
        )}

        <SubSectionTitle label="Will" />
        <div style={{ display: 'grid', gridTemplateColumns: planningMode === 'couple' ? '1fr 1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: '20px' }}>
          <SelectInput section="estate" field="willClient" label={`Will Written — ${planningMode === 'couple' ? client?.full_name?.split(' ')[0] : 'Client'}`} options={['No', 'Yes', 'Outdated']} />
          {planningMode === 'couple' && <SelectInput section="estate" field="willSpouse" label={`Will Written — ${spouseName.split(' ')[0]}`} options={['No', 'Yes', 'Outdated']} />}
          <TextInput section="estate" field="willLastUpdatedClient" label={`Last Updated — ${planningMode === 'couple' ? client?.full_name?.split(' ')[0] : 'Client'}`} placeholder="e.g. Jan 2020" />
          {planningMode === 'couple' && <TextInput section="estate" field="willLastUpdatedSpouse" label={`Last Updated — ${spouseName.split(' ')[0]}`} placeholder="e.g. Jan 2020" />}
          <TextInput section="estate" field="preferredGuardian" label="Preferred Guardian for Children" placeholder="Full name" />
        </div>

        <SubSectionTitle label="Trust" color="var(--emerald)" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
          <SelectInput section="estate" field="trustSetUp" label="Trust Set Up?" options={['No', 'Yes — testamentary', 'Yes — living trust', 'Interested to explore']} />
          <TextInput section="estate" field="trustPurposeNotes" label="Trust Purpose / Notes" placeholder="Describe the trust purpose or intentions" />
        </div>

        <SubSectionTitle label="Insurance Nominations & CPF" color="var(--gold-tag)" />
        <div style={{ display: 'grid', gridTemplateColumns: planningMode === 'couple' ? '1fr 1fr 1fr 1fr' : '1fr 1fr', gap: '20px' }}>
          <SelectInput section="estate" field="policyNominationsClient" label={`Policy Nominations — ${planningMode === 'couple' ? client?.full_name?.split(' ')[0] : 'Client'}`} options={['Not done', 'Done', 'Partially done']} />
          {planningMode === 'couple' && <SelectInput section="estate" field="policyNominationsSpouse" label={`Policy Nominations — ${spouseName.split(' ')[0]}`} options={['Not done', 'Done', 'Partially done']} />}
          <SelectInput section="estate" field="cpfNominationClient" label={`CPF Nomination — ${planningMode === 'couple' ? client?.full_name?.split(' ')[0] : 'Client'}`} options={['Not done', 'Done']} />
          {planningMode === 'couple' && <SelectInput section="estate" field="cpfNominationSpouse" label={`CPF Nomination — ${spouseName.split(' ')[0]}`} options={['Not done', 'Done']} />}
        </div>

        <SubSectionTitle label="Lasting Power of Attorney (LPA)" color="var(--ink3)" />
        <div style={{ display: 'grid', gridTemplateColumns: planningMode === 'couple' ? '1fr 1fr 1fr 1fr' : '1fr 1fr', gap: '20px' }}>
          <SelectInput section="estate" field="lpaClient" label={`LPA — ${planningMode === 'couple' ? client?.full_name?.split(' ')[0] : 'Client'}`} options={['Not done', 'Done', 'In progress']} />
          {planningMode === 'couple' && <SelectInput section="estate" field="lpaSpouse" label={`LPA — ${spouseName.split(' ')[0]}`} options={['Not done', 'Done', 'In progress']} />}
          <TextInput section="estate" field="doneeClient" label={`Donee (LPA) — ${planningMode === 'couple' ? client?.full_name?.split(' ')[0] : 'Client'}`} placeholder="Name of donee" />
          {planningMode === 'couple' && <TextInput section="estate" field="doneeSpouse" label={`Donee (LPA) — ${spouseName.split(' ')[0]}`} placeholder="Name of donee" />}
        </div>

        <div style={{ marginTop: '32px' }}>
          <NotesTextarea section="estate" placeholder="Family dynamics, beneficiary preferences, business succession needs, special considerations…" />
        </div>
      </div>
    )
  }

  const sectionComponents = [<Section1 />, <Section2 />, <Section3 />, <Section4 />, <Section5 />]

  // ─── Main render ─────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', display: 'flex', flexDirection: 'column' }}>

      {/* Toast */}
      {toastMsg && (
        <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 9999, background: 'var(--charcoal)', color: 'white', padding: '12px 20px', borderRadius: '8px', fontFamily: 'Inter, sans-serif', fontSize: '13px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', maxWidth: '360px' }}>
          {toastMsg}
        </div>
      )}

      {/* Hero band */}
      <div style={{ background: 'var(--charcoal)', padding: '28px 40px 0', color: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '2.2rem', fontWeight: 300, margin: '0 0 4px', letterSpacing: '0.01em' }}>Strategic Objectives</h1>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
              {client?.full_name} · {planningMode === 'couple' ? 'Joint Planning' : 'Individual Planning'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '2.2rem', color: 'var(--gold)', lineHeight: 1 }}>
                {Math.round((completedCount / 5) * 100)}%
              </div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Complete</div>
            </div>
            <button onClick={saveAll} style={{ padding: '10px 20px', background: 'transparent', border: '1.5px solid rgba(168,131,74,0.5)', color: 'var(--gold)', borderRadius: '6px', fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: 500, cursor: 'pointer', letterSpacing: '0.05em' }}>
              Save Draft
            </button>
          </div>
        </div>

        {/* Hero stats */}
        <div style={{ display: 'flex', gap: '24px', marginBottom: '20px' }}>
          {[
            { label: 'Client', value: client?.full_name || '—' },
            ...(planningMode === 'couple' ? [{ label: 'Spouse', value: spouseName }] : []),
            { label: 'Children', value: String(children.length) },
            { label: 'Sections Complete', value: `${completedCount} / 5` },
            { label: 'Last Saved', value: lastSaved ? lastSaved.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' }) : '—' },
          ].map((stat, i) => (
            <div key={i} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.06)', borderRadius: '6px', minWidth: '100px' }}>
              <div style={{ fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', fontFamily: 'Inter, sans-serif', marginBottom: '4px' }}>{stat.label}</div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'white', fontFamily: 'Inter, sans-serif' }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Planning mode toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '0', marginBottom: '0' }}>
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontFamily: 'Inter, sans-serif' }}>Planning for:</span>
          {(['individual', 'couple'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => updatePlanningMode(mode)}
              style={{
                padding: '6px 16px',
                borderRadius: '4px 4px 0 0',
                border: 'none',
                background: planningMode === mode ? 'rgba(168,131,74,0.15)' : 'transparent',
                color: planningMode === mode ? 'var(--gold)' : 'rgba(255,255,255,0.4)',
                fontSize: '12px',
                fontFamily: 'Inter, sans-serif',
                fontWeight: planningMode === mode ? 600 : 400,
                cursor: 'pointer',
                borderBottom: planningMode === mode ? '2px solid var(--gold)' : '2px solid transparent',
                letterSpacing: '0.02em',
              }}
            >
              {mode === 'individual' ? 'Individual' : 'Couple / Family'}
            </button>
          ))}
        </div>

        {/* Section nav */}
        <div style={{ display: 'flex', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '0', paddingTop: '0' }}>
          {sectionLabels.map((label, i) => {
            const pct = getSectionPct(i)
            const isActive = activeSection === i
            const isDone = pct > 80
            const isStarted = pct > 0
            return (
              <button
                key={i}
                onClick={() => setActiveSection(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '14px 20px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: isActive ? '2px solid white' : '2px solid transparent',
                  color: isActive ? 'white' : 'rgba(255,255,255,0.45)',
                  cursor: 'pointer',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '12px',
                  fontWeight: isActive ? 500 : 400,
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s',
                  marginBottom: '-1px',
                }}
              >
                <div style={{
                  width: '18px', height: '18px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700, flexShrink: 0,
                  background: isDone ? 'var(--emerald)' : isStarted ? 'var(--gold)' : 'rgba(255,255,255,0.12)',
                  color: isDone || isStarted ? 'white' : 'rgba(255,255,255,0.4)',
                }}>
                  {isDone ? '✓' : i + 1}
                </div>
                {label}
              </button>
            )
          })}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 20px', color: 'rgba(255,255,255,0.35)', fontSize: '11px', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>
            <div style={{ width: '80px', height: '3px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(completedCount / 5) * 100}%`, background: 'var(--gold)', borderRadius: '2px', transition: 'width 0.4s ease' }} />
            </div>
            {completedCount} of 5
          </div>
        </div>
      </div>

      {/* Main body */}
      <div style={{ flex: 1, display: 'flex', gap: '0', maxWidth: '100%' }}>

        {/* Left: form */}
        <div style={{ flex: 1, padding: '40px', overflowY: 'auto', minWidth: 0 }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
              <p style={{ fontFamily: 'var(--font-serif)', color: 'var(--ink3)' }}>Loading discovery data…</p>
            </div>
          ) : sectionComponents[activeSection]}
        </div>

        {/* Right sidebar */}
        <div style={{ width: '260px', flexShrink: 0, background: 'white', borderLeft: '1px solid var(--line)', padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* Save status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: saveStatus === 'saving' ? 'var(--gold)' : saveStatus === 'saved' ? 'var(--emerald)' : 'var(--line2)' }} />
            <span style={{ fontSize: '11px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif' }}>
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : lastSaved ? `Saved ${lastSaved.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}` : 'Auto-saves on every change'}
            </span>
          </div>

          {/* Progress */}
          <div>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', marginBottom: '12px' }}>Discovery Progress</div>
            {sectionLabels.map((label, i) => {
              const pct = getSectionPct(i)
              const status = pct > 80 ? 'Complete' : pct > 0 ? 'In progress' : 'Not started'
              return (
                <div key={i} style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: pct > 80 ? 'var(--emerald)' : pct > 0 ? 'var(--gold-tag)' : 'var(--ink3)', fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>{label}</span>
                    <span style={{ fontSize: '10px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif' }}>{pct}%</span>
                  </div>
                  <div style={{ height: '3px', background: 'var(--cream2)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: pct > 80 ? 'var(--emerald)' : 'var(--gold)', borderRadius: '2px', transition: 'width 0.4s ease' }} />
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', marginTop: '2px' }}>{status}</div>
                </div>
              )
            })}
          </div>

          {/* Feeds into */}
          <div>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', marginBottom: '10px' }}>Feeds Into</div>
            <div style={{ borderLeft: '3px solid var(--gold)', paddingLeft: '12px', marginBottom: '10px', paddingTop: '4px', paddingBottom: '4px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ink)', fontFamily: 'Inter, sans-serif', marginBottom: '2px' }}>Risk Management Tab</div>
              <div style={{ fontSize: '10px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', lineHeight: 1.4 }}>Protection needs, coverage gap, human life value</div>
            </div>
            <div style={{ borderLeft: '3px solid #4A7FA5', paddingLeft: '12px', paddingTop: '4px', paddingBottom: '4px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ink)', fontFamily: 'Inter, sans-serif', marginBottom: '2px' }}>Capital Mandate Tab</div>
              <div style={{ fontSize: '10px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', lineHeight: 1.4 }}>Retirement corpus, education targets, investment gap</div>
            </div>
          </div>

          {/* Live preview */}
          <div style={{ background: 'var(--charcoal)', borderRadius: '8px', padding: '16px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif', marginBottom: '12px' }}>Live Preview</div>
            {[
              { label: 'Life Cover Needed', value: fmtCurrency(lifeCoverNeeded || undefined) },
              { label: 'CI Cover Needed', value: fmtCurrency(ciCoverNeeded || undefined) },
              { label: 'Retirement Corpus', value: fmtCurrency(retirementCorpus || undefined) },
              { label: 'Education Fund', value: fmtCurrency(eduFundNeeded || undefined) },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)', fontFamily: 'Inter, sans-serif' }}>{label}</span>
                <span style={{ fontSize: '13px', fontFamily: 'DM Mono, monospace', color: value === '—' ? 'rgba(255,255,255,0.2)' : 'var(--gold)', fontWeight: 500 }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Estate flags */}
          {estateFlags.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--rouge)', fontFamily: 'Inter, sans-serif', marginBottom: '8px' }}>Estate Flags</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {estateFlags.map(f => (
                  <div key={f} style={{ background: 'var(--rouge-l)', padding: '6px 10px', borderRadius: '4px', fontSize: '10px', color: 'var(--rouge)', fontFamily: 'Inter, sans-serif', lineHeight: 1.3 }}>
                    {f}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Footer */}
      <div style={{ background: 'white', borderTop: '1px solid var(--line)', padding: '16px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: saveStatus === 'saving' ? 'var(--gold)' : 'var(--emerald)' }} />
          <span style={{ fontSize: '12px', color: 'var(--ink3)', fontFamily: 'Inter, sans-serif' }}>
            {saveStatus === 'saving' ? 'Saving…' : `Auto-saved · ${completedCount} of 5 sections complete`}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => showToast('Coming soon')}
            style={{ padding: '10px 20px', background: 'transparent', border: '1.5px solid var(--line2)', borderRadius: '6px', color: 'var(--ink2)', fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}
          >
            Review Annual History
          </button>
          <button
            onClick={saveAll}
            style={{ padding: '10px 24px', background: 'var(--charcoal)', border: 'none', borderRadius: '6px', color: 'white', fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: 500, cursor: 'pointer', letterSpacing: '0.02em' }}
          >
            Complete & Push to Plan →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  label: {
    fontSize: '8px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: 'var(--ink3)',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 500,
  },
  input: {
    width: '100%',
    border: 'none',
    borderBottom: '1px solid var(--line2)',
    background: 'transparent',
    padding: '6px 0',
    fontSize: '13px',
    color: 'var(--ink)',
    fontFamily: 'Inter, sans-serif',
    outline: 'none',
    transition: 'border-bottom-color 0.15s',
    boxSizing: 'border-box' as const,
  },
  select: {
    width: '100%',
    border: 'none',
    borderBottom: '1px solid var(--line2)',
    background: 'transparent',
    padding: '6px 0',
    fontSize: '13px',
    color: 'var(--ink)',
    fontFamily: 'Inter, sans-serif',
    outline: 'none',
    transition: 'border-bottom-color 0.15s',
    cursor: 'pointer',
    appearance: 'none' as const,
    boxSizing: 'border-box' as const,
  },
  currencyWrap: {
    display: 'flex',
    alignItems: 'baseline',
    borderBottom: '1px solid var(--line2)',
    transition: 'border-bottom-color 0.15s',
    gap: '4px',
  },
  currencyPrefix: {
    fontSize: '11px',
    color: 'var(--ink3)',
    fontFamily: 'Inter, sans-serif',
    flexShrink: 0,
    paddingBottom: '6px',
  },
  currencyInput: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    padding: '6px 0',
    fontSize: '13px',
    color: 'var(--ink)',
    fontFamily: 'Inter, sans-serif',
    outline: 'none',
    width: '100%',
  },
  notesBar: {
    background: 'var(--charcoal)',
    borderRadius: '6px',
    padding: '16px 20px',
  },
  notesInput: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.15)',
    color: 'white',
    fontFamily: 'var(--font-serif)',
    fontStyle: 'italic',
    fontSize: '14px',
    lineHeight: 1.6,
    outline: 'none',
    resize: 'none' as const,
    padding: '4px 0',
    boxSizing: 'border-box' as const,
    transition: 'border-bottom-color 0.15s',
  },
  addChildBtn: {
    background: 'transparent',
    border: '1.5px dashed var(--line2)',
    borderRadius: '6px',
    padding: '10px 20px',
    color: 'var(--ink3)',
    fontFamily: 'Inter, sans-serif',
    fontSize: '12px',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'center' as const,
  },
}
