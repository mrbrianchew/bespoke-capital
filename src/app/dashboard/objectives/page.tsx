'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'

// ─── INTERFACES ──────────────────────────────────────────────────────────────

interface MortgageProperty {
  id: string
  label: string
  outstanding: number
  interestRate: number
  monthlyRepayment: number
  tenure: number
  initialLoanAmount: number
  initialTenure: number
  loanStartDate: string
  remainingTenure: number
}

interface FamilyMember {
  id: string
  name: string
  relationship: string
  date_of_birth?: string
  age?: number
}

interface FactFinding {
  // Expense mode
  expense_mode?: 'simple' | 'detailed'
  // Simplified expenses client
  s_income_tax?: number; s_insurance?: number; s_regular_savings?: number
  s_housing?: number; s_utilities?: number; s_family_food?: number
  s_transport?: number; s_children?: number; s_lifestyle?: number; s_others?: number
  // Simplified expenses spouse
  s2_income_tax?: number; s2_insurance?: number; s2_regular_savings?: number
  s2_housing?: number; s2_utilities?: number; s2_family_food?: number
  s2_transport?: number; s2_children?: number; s2_lifestyle?: number; s2_others?: number
  // Detailed expenses client
  d_income_tax?: number; d_insurance?: number; d_regular_savings?: number
  d_conservancy?: number; d_utilities?: number; d_family_food?: number
  d_maid?: number; d_other_household?: number; d_personal_food?: number
  d_transport?: number; d_car_petrol?: number; d_car_insurance?: number
  d_childcare?: number; d_school_fees?: number; d_school_transport?: number
  d_allowance_children?: number; d_other_children?: number
  d_holidays?: number; d_hobbies?: number; d_allowance_parents?: number
  d_others_lifestyle?: number; d_mortgage_cpf?: number; d_mortgage_cash?: number
  // Detailed expenses spouse
  d2_income_tax?: number; d2_insurance?: number; d2_regular_savings?: number
  d2_conservancy?: number; d2_utilities?: number; d2_family_food?: number
  d2_maid?: number; d2_other_household?: number; d2_personal_food?: number
  d2_transport?: number; d2_car_petrol?: number; d2_car_insurance?: number
  d2_childcare?: number; d2_school_fees?: number; d2_school_transport?: number
  d2_allowance_children?: number; d2_other_children?: number
  d2_holidays?: number; d2_hobbies?: number; d2_allowance_parents?: number
  d2_others_lifestyle?: number; d2_mortgage_cpf?: number; d2_mortgage_cash?: number
  // Assets client
  a_savings?: number; a_fixed_deposit?: number; a_srs?: number
  a_shares?: number; a_etf?: number; a_unit_trust?: number; a_bonds?: number
  a_alternatives?: number; a_cpf_oa?: number; a_cpf_sa?: number
  a_cpf_ma?: number; a_cpf_ra?: number; a_inv_property_res?: number; a_inv_property_com?: number
  // Assets spouse
  a2_savings?: number; a2_fixed_deposit?: number; a2_srs?: number
  a2_shares?: number; a2_etf?: number; a2_unit_trust?: number; a2_bonds?: number
  a2_alternatives?: number; a2_cpf_oa?: number; a2_cpf_sa?: number
  a2_cpf_ma?: number; a2_cpf_ra?: number; a2_inv_property_res?: number; a2_inv_property_com?: number
  // Mortgages
  mortgages?: MortgageProperty[]
  // Other
  strategic_objectives?: Record<string, unknown>
  protection?: ProtectionData
  [key: string]: unknown
}

interface ProtectionData {
  planType?: 'individual' | 'couple'
  inflationRate?: number
  wpSubTab?: number
  expenseCategories?: { financial?: boolean; household?: boolean; personal?: boolean; children?: boolean; lifestyle?: boolean }
  expenseSubItems?: Record<string, boolean>
  expenseCoverPctClient?: number
  expenseCoverPctSpouse?: number
  coverageTermOverride?: number
  mortgageCoverPcts?: number[]
  mortgageCoverPctsClient?: number[]
  mortgageCoverPctsSpouse?: number[]
  provideEducationFund?: boolean
  educationFundPct?: number
  educationChildren?: { childId: string; uniType?: string; courseDuration?: number; annualCost?: number; coverPctClient?: number; coverPctSpouse?: number }[]
  ciStage?: 'early_late' | 'late_only'
  ciYears?: number
  ciMortgagePctClient?: number
  ciMortgagePctSpouse?: number
  includeEduInCI?: boolean
  existingLifeCoverClient?: number; existingLifeCoverSpouse?: number
  existingCICoverClient?: number; existingCICoverSpouse?: number
  disabilityIncomeClient?: number; disabilityIncomeSpouse?: number
  advisorNotes?: string
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const UNI_COST_DEFAULTS: Record<string, { label: string; annual: number }> = {
  sg_local:     { label: 'SG Local (NUS/NTU/SMU)', annual: 34000 },
  sg_private:   { label: 'SG Private University',  annual: 42000 },
  overseas_avg: { label: 'Overseas — Average',      annual: 55000 },
  overseas_uk:  { label: 'Overseas — UK',           annual: 72000 },
  overseas_aus: { label: 'Overseas — Australia',    annual: 65000 },
  overseas_us:  { label: 'Overseas — USA',          annual: 85000 },
}

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  financial: 'Financial Commitments',
  household: 'Household Expenses',
  personal:  'Personal Expenses',
  children:  'Children Expenses',
  lifestyle: 'Lifestyle & Others',
}

const DETAILED_EXPENSE_MAP: Record<string, string[]> = {
  financial: ['d_income_tax','d_insurance','d_regular_savings'],
  household: ['d_conservancy','d_utilities','d_family_food','d_maid','d_other_household'],
  personal:  ['d_personal_food','d_transport','d_car_petrol','d_car_insurance'],
  children:  ['d_childcare','d_school_fees','d_school_transport','d_allowance_children','d_other_children'],
  lifestyle: ['d_holidays','d_hobbies','d_allowance_parents','d_others_lifestyle'],
}

const DETAILED_EXPENSE_LABELS: Record<string, string> = {
  d_income_tax: 'Income Tax', d_insurance: 'Insurance', d_regular_savings: 'Regular Savings',
  d_conservancy: 'Conservancy', d_utilities: 'Utilities', d_family_food: 'Family Food',
  d_maid: 'Maid', d_other_household: 'Other Household', d_personal_food: 'Personal Food',
  d_transport: 'Transport', d_car_petrol: 'Car Petrol', d_car_insurance: 'Car Insurance',
  d_childcare: 'Childcare', d_school_fees: 'School Fees', d_school_transport: 'School Transport',
  d_allowance_children: 'Allowance (Children)', d_other_children: 'Other Children',
  d_holidays: 'Holidays', d_hobbies: 'Hobbies', d_allowance_parents: 'Allowance (Parents)', d_others_lifestyle: 'Others',
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fv(rate: number, nper: number, pmt: number): number {
  if (nper <= 0) return 0
  if (rate === 0) return pmt * nper
  return pmt * ((Math.pow(1 + rate, nper) - 1) / rate) * (1 + rate)
}

function fmt(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-SG')
}

function getAge(dob?: string): number {
  if (!dob) return 10
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--
  return Math.max(0, age)
}

function getSimpleTotal(ff: FactFinding, prefix: 'client' | 'spouse'): number {
  const p = prefix === 'spouse' ? 's2_' : 's_'
  return (
    (ff[`${p}income_tax`] as number || 0) +
    (ff[`${p}insurance`] as number || 0) +
    (ff[`${p}regular_savings`] as number || 0) +
    (ff[`${p}housing`] as number || 0) +
    (ff[`${p}utilities`] as number || 0) +
    (ff[`${p}family_food`] as number || 0) +
    (ff[`${p}transport`] as number || 0) +
    (ff[`${p}children`] as number || 0) +
    (ff[`${p}lifestyle`] as number || 0) +
    (ff[`${p}others`] as number || 0)
  )
}

function getDetailedCategoryTotal(ff: FactFinding, category: string, prefix: 'client' | 'spouse'): number {
  const sp = prefix === 'spouse' ? 'd2_' : 'd_'
  const keys = DETAILED_EXPENSE_MAP[category] || []
  return keys.reduce((sum, k) => sum + (ff[k.replace('d_', sp)] as number || 0), 0)
}

function getDetailedTotal(ff: FactFinding, categories: Record<string, boolean>, subItems: Record<string, boolean>, prefix: 'client' | 'spouse'): number {
  const sp = prefix === 'spouse' ? 'd2_' : 'd_'
  let total = 0
  Object.entries(categories).forEach(([cat, enabled]) => {
    if (!enabled) return
    DETAILED_EXPENSE_MAP[cat]?.forEach(key => {
      const subKey = key
      if (subItems[subKey] === false) return
      total += (ff[key.replace('d_', sp)] as number || 0)
    })
  })
  return total * 12
}

function getSimpleCategoryTotal(ff: FactFinding, categories: Record<string, boolean>, prefix: 'client' | 'spouse'): number {
  const p = prefix === 'spouse' ? 's2_' : 's_'
  let total = 0
  const catMap: Record<string, string[]> = {
    financial: [`${p}income_tax`, `${p}insurance`, `${p}regular_savings`],
    household: [`${p}housing`, `${p}utilities`, `${p}family_food`],
    personal:  [`${p}transport`],
    children:  [`${p}children`],
    lifestyle: [`${p}lifestyle`, `${p}others`],
  }
  Object.entries(categories).forEach(([cat, enabled]) => {
    if (!enabled) return
    catMap[cat]?.forEach(k => { total += (ff[k] as number || 0) })
  })
  return total * 12
}

function getAssetOffset(ff: FactFinding, prefix: 'client' | 'spouse', type: 'dtpd' | 'ci'): number {
  const p = prefix === 'spouse' ? 'a2_' : 'a_'
  const liquid =
    (ff[`${p}savings`] as number || 0) +
    (ff[`${p}fixed_deposit`] as number || 0) +
    (ff[`${p}srs`] as number || 0) +
    (ff[`${p}shares`] as number || 0) +
    (ff[`${p}etf`] as number || 0) +
    (ff[`${p}unit_trust`] as number || 0) +
    (ff[`${p}bonds`] as number || 0) +
    (ff[`${p}alternatives`] as number || 0)
  if (type === 'ci') return liquid
  const cpf =
    (ff[`${p}cpf_oa`] as number || 0) +
    (ff[`${p}cpf_sa`] as number || 0) +
    (ff[`${p}cpf_ma`] as number || 0) +
    (ff[`${p}cpf_ra`] as number || 0)
  const invProp =
    (ff[`${p}inv_property_res`] as number || 0) +
    (ff[`${p}inv_property_com`] as number || 0)
  return liquid + cpf + invProp
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function ObjectivesPage() {
  const supabase = createClient()
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState('Client')
  const [spouseName, setSpouseName] = useState('Spouse')
  const [ff, setFf] = useState<FactFinding>({})
  const [p, setP] = useState<ProtectionData>({
    planType: 'individual',
    inflationRate: 3,
    wpSubTab: 0,
    expenseCategories: { financial: true, household: true, personal: true, children: true, lifestyle: true },
    expenseSubItems: {},
    expenseCoverPctClient: 100,
    expenseCoverPctSpouse: 100,
    coverageTermOverride: 20,
    mortgageCoverPcts: [],
    mortgageCoverPctsClient: [],
    mortgageCoverPctsSpouse: [],
    provideEducationFund: false,
    educationFundPct: 100,
    educationChildren: [],
    ciStage: 'early_late',
    ciYears: 5,
    ciMortgagePctClient: 100,
    ciMortgagePctSpouse: 100,
    includeEduInCI: false,
    existingLifeCoverClient: 0, existingLifeCoverSpouse: 0,
    existingCICoverClient: 0, existingCICoverSpouse: 0,
    disabilityIncomeClient: 0, disabilityIncomeSpouse: 0,
    advisorNotes: '',
  })
  const [children, setChildren] = useState<FamilyMember[]>([])
  const [activeSection, setActiveSection] = useState(0)
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState<{ open: boolean; category: string }>({ open: false, category: '' })
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── LOAD DATA ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const id = localStorage.getItem('selectedClientId')
    setClientId(id)
    if (id) loadData(id)
  }, [])

  async function loadData(id: string) {
    setLoading(true)
    // Load fact_finding
    const { data: ffData } = await supabase
      .from('fact_finding')
      .select('*')
      .eq('client_id', id)
      .single()
    if (ffData) {
      setFf(ffData)
      if (ffData.protection) {
        setP(prev => ({ ...prev, ...ffData.protection }))
      }
    }
    // Load client name
    const { data: clientData } = await supabase
      .from('clients')
      .select('full_name, spouse_name')
      .eq('id', id)
      .single()
    if (clientData) {
      setClientName(clientData.full_name || 'Client')
      setSpouseName(clientData.spouse_name || 'Spouse')
    }
    // Load children
    const { data: familyData } = await supabase
      .from('family_members')
      .select('*')
      .eq('client_id', id)
      .in('relationship', ['Daughter', 'Son', 'Child'])
    if (familyData) setChildren(familyData)
    setLoading(false)
  }

  // ─── AUTO-SAVE ─────────────────────────────────────────────────────────────

  const scheduleSave = useCallback((updated: ProtectionData) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      if (!clientId) return
      await supabase
        .from('fact_finding')
        .update({ protection: updated })
        .eq('client_id', clientId)
    }, 800)
  }, [clientId, supabase])

  function updateP(changes: Partial<ProtectionData>) {
    setP(prev => {
      const next = { ...prev, ...changes }
      scheduleSave(next)
      return next
    })
  }

  // ─── CALCULATIONS ──────────────────────────────────────────────────────────

  const isCouple = p.planType === 'couple'
  const inflation = (p.inflationRate ?? 3) / 100
  const cats = p.expenseCategories ?? { financial: true, household: true, personal: true, children: true, lifestyle: true }
  const subItems = p.expenseSubItems ?? {}
  const isDetailed = ff.expense_mode === 'detailed'

  function getAnnualExpense(who: 'client' | 'spouse'): number {
    if (isDetailed) return getDetailedTotal(ff, cats, subItems, who)
    return getSimpleCategoryTotal(ff, cats, who)
  }

  const annExpClient = getAnnualExpense('client')
  const annExpSpouse = getAnnualExpense('spouse')
  const annExpTotal = annExpClient + annExpSpouse

  // Coverage term
  const childAges = children.map(c => c.age ?? getAge(c.date_of_birth))
  const youngestAge = childAges.length > 0 ? Math.min(...childAges) : null
  const coverageTerm = youngestAge !== null
    ? Math.max(0, (22 + 4) - youngestAge)
    : (p.coverageTermOverride ?? 20)

  // Default cover pcts based on expense share
  const defaultClientPct = annExpTotal > 0 ? (annExpClient / annExpTotal * 100) : 100
  const defaultSpousePct = annExpTotal > 0 ? (annExpSpouse / annExpTotal * 100) : 100

  const clientCoverPct = (p.expenseCoverPctClient ?? defaultClientPct) / 100
  const spouseCoverPct = (p.expenseCoverPctSpouse ?? defaultSpousePct) / 100

  // Family dependency
  function calcFamilyDep(annExp: number, coverPct: number, years: number): number {
    return fv(inflation, years, annExp * coverPct)
  }

  // Mortgage coverage
  function calcMortgageForPerson(who: 'client' | 'spouse'): number {
    const mortgages = ff.mortgages ?? []
    return mortgages.reduce((sum, m, i) => {
      const pcts = who === 'client' ? (p.mortgageCoverPctsClient ?? []) : (p.mortgageCoverPctsSpouse ?? [])
      const pct = (pcts[i] ?? 100) / 100
      return sum + m.outstanding * pct
    }, 0)
  }

  // Education fund
  function calcEducationForPerson(who: 'client' | 'spouse'): number {
    if (!p.provideEducationFund) return 0
    const eduKids = p.educationChildren ?? []
    return children.reduce((sum, child) => {
      const ec = eduKids.find(e => e.childId === child.id)
      if (!ec) return sum
      const annual = ec.annualCost ?? UNI_COST_DEFAULTS.sg_local.annual
      const dur = ec.courseDuration ?? 4
      const pct = (who === 'client' ? (ec.coverPctClient ?? 50) : (ec.coverPctSpouse ?? 50)) / 100
      return sum + annual * dur * pct
    }, 0)
  }

  // CI calcs
  function calcCIFamilyDep(annExp: number, coverPct: number): number {
    return fv(inflation, p.ciYears ?? 5, annExp * coverPct)
  }

  function calcCIMortgage(who: 'client' | 'spouse'): number {
    const mortgages = ff.mortgages ?? []
    const ciYrs = p.ciYears ?? 5
    const pct = (who === 'client' ? (p.ciMortgagePctClient ?? 100) : (p.ciMortgagePctSpouse ?? 100)) / 100
    return mortgages.reduce((sum, m) => sum + m.monthlyRepayment * 12 * ciYrs * pct, 0)
  }

  // Full needs
  function calcDTPDNeed(who: 'client' | 'spouse'): { gross: number; assets: number; net: number; fd: number; mort: number; edu: number } {
    const annExp = who === 'client' ? annExpClient : annExpSpouse
    const coverPct = who === 'client' ? clientCoverPct : spouseCoverPct
    const fd = calcFamilyDep(annExp, coverPct, coverageTerm)
    const mort = calcMortgageForPerson(who)
    const edu = calcEducationForPerson(who)
    const gross = fd + mort + edu
    const assets = getAssetOffset(ff, who, 'dtpd')
    return { gross, assets, net: Math.max(0, gross - assets), fd, mort, edu }
  }

  function calcCINeed(who: 'client' | 'spouse'): { gross: number; assets: number; net: number; fd: number; mort: number; edu: number } {
    const annExp = who === 'client' ? annExpClient : annExpSpouse
    const coverPct = who === 'client' ? clientCoverPct : spouseCoverPct
    const fd = calcCIFamilyDep(annExp, coverPct)
    const mort = calcCIMortgage(who)
    const edu = p.includeEduInCI ? calcEducationForPerson(who) : 0
    const gross = fd + mort + edu
    const assets = getAssetOffset(ff, who, 'ci')
    return { gross, assets, net: Math.max(0, gross - assets), fd, mort, edu }
  }

  const dtpdClient = calcDTPDNeed('client')
  const dtpdSpouse = calcDTPDNeed('spouse')
  const ciClient = calcCINeed('client')
  const ciSpouse = calcCINeed('spouse')

  // Gaps
  const existingLifeClient = p.existingLifeCoverClient ?? 0
  const existingLifeSpouse = p.existingLifeCoverSpouse ?? 0
  const existingCIClient = p.existingCICoverClient ?? 0
  const existingCISpouse = p.existingCICoverSpouse ?? 0

  const lifeGapClient = Math.max(0, dtpdClient.net - existingLifeClient)
  const lifeGapSpouse = Math.max(0, dtpdSpouse.net - existingLifeSpouse)
  const ciGapClient = Math.max(0, ciClient.net - existingCIClient)
  const ciGapSpouse = Math.max(0, ciSpouse.net - existingCISpouse)

  // ─── EDUCATION CHILDREN INIT ───────────────────────────────────────────────

  useEffect(() => {
    if (children.length > 0 && (p.educationChildren?.length ?? 0) === 0) {
      const eduKids = children.map(c => ({
        childId: c.id,
        uniType: 'sg_local',
        courseDuration: 4,
        annualCost: UNI_COST_DEFAULTS.sg_local.annual,
        coverPctClient: 50,
        coverPctSpouse: 50,
      }))
      updateP({ educationChildren: eduKids })
    }
  }, [children])

  // ─── MORTGAGE INIT ─────────────────────────────────────────────────────────

  useEffect(() => {
    const mortgages = ff.mortgages ?? []
    if (mortgages.length > 0) {
      const clientPcts = p.mortgageCoverPctsClient ?? []
      const spousePcts = p.mortgageCoverPctsSpouse ?? []
      if (clientPcts.length !== mortgages.length || spousePcts.length !== mortgages.length) {
        const totalMortgageClient = mortgages.reduce((s, m) => {
          const cpf = ff.d_mortgage_cpf ?? 0; const cash = ff.d_mortgage_cash ?? 0
          return s + (cpf + cash)
        }, 0)
        updateP({
          mortgageCoverPctsClient: mortgages.map(() => 50),
          mortgageCoverPctsSpouse: mortgages.map(() => 50),
          mortgageCoverPcts: mortgages.map(() => 100),
        })
      }
    }
  }, [ff.mortgages])

  // ─── SUB-COMPONENTS ────────────────────────────────────────────────────────

  const WP_TABS = ['Family Dependency', 'Mortgage & Debt', 'Education Fund', 'Critical Illness', 'Asset Offset']

  // ─── RENDER ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: '#EEEADE' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#A8834A', borderTopColor: 'transparent' }} />
          <p className="text-xs tracking-widest uppercase" style={{ color: '#A8834A', fontFamily: 'Inter, sans-serif' }}>Loading</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#EEEADE', fontFamily: 'Inter, sans-serif' }}>

      {/* HERO BAND */}
      <div style={{ background: '#1C1A17', padding: '28px 40px 24px' }}>
        <p className="text-xs tracking-widest uppercase mb-1" style={{ color: '#A8834A', fontFamily: 'Inter' }}>Strategic Objectives</p>
        <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 32, fontWeight: 300, color: '#F5F0E8', letterSpacing: 1 }}>
          Needs Discovery
        </h1>
      </div>

      {/* SECTION TABS */}
      <div style={{ background: '#fff', borderBottom: '1px solid #E8E4DC', padding: '0 40px', display: 'flex', gap: 0 }}>
        {['Wealth Protection', 'Wealth Accumulation', 'Retirement', 'Education Planning', 'Estate Planning'].map((s, i) => (
          <button
            key={s}
            onClick={() => setActiveSection(i)}
            style={{
              padding: '14px 20px',
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontFamily: 'Inter',
              fontWeight: 500,
              color: activeSection === i ? '#1C1A17' : '#888',
              background: 'none',
              border: 'none',
              borderBottom: activeSection === i ? '2px solid #A8834A' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s',
            } as React.CSSProperties}
          >
            {s}
          </button>
        ))}
      </div>

      {/* MAIN LAYOUT */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0, minHeight: 'calc(100vh - 140px)' }}>

        {/* LEFT: CONTENT */}
        <div style={{ padding: '32px 40px', borderRight: '1px solid #E8E4DC' }}>
          {activeSection === 0 && (
            <WealthProtectionSection
              ff={ff} p={p} updateP={updateP}
              children={children} isCouple={isCouple}
              clientName={clientName} spouseName={spouseName}
              annExpClient={annExpClient} annExpSpouse={annExpSpouse}
              coverageTerm={coverageTerm} youngestAge={youngestAge}
              dtpdClient={dtpdClient} dtpdSpouse={dtpdSpouse}
              ciClient={ciClient} ciSpouse={ciSpouse}
              editModal={editModal} setEditModal={setEditModal}
              WP_TABS={WP_TABS} inflation={inflation}
              defaultClientPct={defaultClientPct} defaultSpousePct={defaultSpousePct}
            />
          )}
          {activeSection !== 0 && (
            <div className="flex items-center justify-center" style={{ minHeight: 300 }}>
              <p style={{ color: '#aaa', fontSize: 13, fontFamily: 'Inter' }}>
                {['','Wealth Accumulation','Retirement','Education Planning','Estate Planning'][activeSection]} — coming soon
              </p>
            </div>
          )}
        </div>

        {/* RIGHT: SIDEBAR */}
        <div style={{ padding: '32px 24px', background: '#fff' }}>
          <p className="text-xs tracking-widest uppercase mb-4" style={{ color: '#A8834A', fontFamily: 'Inter', letterSpacing: '0.12em' }}>
            Coverage Summary
          </p>

          {/* Plan type toggle */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 24, background: '#F5F0E8', borderRadius: 6, padding: 3 }}>
            {(['individual', 'couple'] as const).map(t => (
              <button
                key={t}
                onClick={() => updateP({ planType: t })}
                style={{
                  flex: 1, padding: '7px 0', fontSize: 11, letterSpacing: '0.08em',
                  textTransform: 'capitalize', fontFamily: 'Inter', fontWeight: 500,
                  background: p.planType === t ? '#1C1A17' : 'transparent',
                  color: p.planType === t ? '#fff' : '#888',
                  border: 'none', borderRadius: 4, cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* Summary blocks */}
          <SidebarSummary
            isCouple={isCouple}
            clientName={clientName} spouseName={spouseName}
            dtpdClient={dtpdClient} dtpdSpouse={dtpdSpouse}
            ciClient={ciClient} ciSpouse={ciSpouse}
            existingLifeClient={existingLifeClient} existingLifeSpouse={existingLifeSpouse}
            existingCIClient={existingCIClient} existingCISpouse={existingCISpouse}
            lifeGapClient={lifeGapClient} lifeGapSpouse={lifeGapSpouse}
            ciGapClient={ciGapClient} ciGapSpouse={ciGapSpouse}
          />

          {/* Existing cover inputs */}
          <div style={{ marginTop: 24 }}>
            <p className="text-xs tracking-widest uppercase mb-3" style={{ color: '#888', fontFamily: 'Inter', letterSpacing: '0.1em' }}>Existing Coverage</p>
            <ExistingCoverInputs
              p={p} updateP={updateP} isCouple={isCouple}
              clientName={clientName} spouseName={spouseName}
            />
          </div>
        </div>

      </div>

      {/* EDIT MODAL */}
      {editModal.open && (
        <EditSubItemsModal
          category={editModal.category}
          ff={ff} p={p} updateP={updateP}
          onClose={() => setEditModal({ open: false, category: '' })}
        />
      )}
    </div>
  )
}

// ─── WEALTH PROTECTION SECTION ───────────────────────────────────────────────

interface WPProps {
  ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  children: FamilyMember[]; isCouple: boolean
  clientName: string; spouseName: string
  annExpClient: number; annExpSpouse: number
  coverageTerm: number; youngestAge: number | null
  dtpdClient: CalcResult
  dtpdSpouse: CalcResult
  ciClient: CalcResult
  ciSpouse: CalcResult
  editModal: { open: boolean; category: string }
  setEditModal: (v: { open: boolean; category: string }) => void
  WP_TABS: string[]
  inflation: number
  defaultClientPct: number; defaultSpousePct: number
}

// Type helper for return shape
type CalcResult = { gross: number; assets: number; net: number; fd: number; mort: number; edu: number }


function WealthProtectionSection({ ff, p, updateP, children, isCouple, clientName, spouseName, annExpClient, annExpSpouse, coverageTerm, youngestAge, dtpdClient, dtpdSpouse, ciClient, ciSpouse, editModal, setEditModal, WP_TABS, inflation, defaultClientPct, defaultSpousePct }: WPProps) {
  const wpTab = p.wpSubTab ?? 0
  const cats = p.expenseCategories ?? { financial: true, household: true, personal: true, children: true, lifestyle: true }
  const isDetailed = ff.expense_mode === 'detailed'
  const mortgages = ff.mortgages ?? []

  return (
    <div>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <div style={{ width: 3, height: 24, background: '#A8834A', borderRadius: 2 }} />
        <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 400, color: '#1C1A17', margin: 0 }}>
          Wealth Protection
        </h2>
      </div>

      {/* Global settings row */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 28, flexWrap: 'wrap' }}>
        {/* Inflation slider */}
        <div style={{ flex: '0 0 220px' }}>
          <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#888', fontFamily: 'Inter', marginBottom: 8 }}>
            Inflation Rate
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range" min={0} max={8} step={0.5}
              value={p.inflationRate ?? 3}
              onChange={e => updateP({ inflationRate: parseFloat(e.target.value) })}
              style={{ flex: 1, accentColor: '#A8834A' }}
            />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#1C1A17', minWidth: 40, textAlign: 'right' }}>
              {(p.inflationRate ?? 3).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {/* WP Sub-tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 0, borderBottom: '1px solid #E8E4DC' }}>
        {WP_TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => updateP({ wpSubTab: i })}
            style={{
              padding: '10px 16px', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
              fontFamily: 'Inter', fontWeight: 500,
              color: wpTab === i ? '#2D5A4E' : '#999',
              background: 'none', border: 'none',
              borderBottom: wpTab === i ? '2px solid #2D5A4E' : '2px solid transparent',
              cursor: 'pointer', transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            } as React.CSSProperties}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ padding: '28px 0' }}>
        {wpTab === 0 && (
          <FamilyDependencyTab
            ff={ff} p={p} updateP={updateP}
            isCouple={isCouple} clientName={clientName} spouseName={spouseName}
            annExpClient={annExpClient} annExpSpouse={annExpSpouse}
            coverageTerm={coverageTerm} youngestAge={youngestAge}
            children={children} isDetailed={isDetailed}
            cats={cats} editModal={editModal} setEditModal={setEditModal}
            inflation={inflation} defaultClientPct={defaultClientPct} defaultSpousePct={defaultSpousePct}
          />
        )}
        {wpTab === 1 && (
          <MortgageDebtTab
            ff={ff} p={p} updateP={updateP}
            isCouple={isCouple} clientName={clientName} spouseName={spouseName}
            mortgages={mortgages}
          />
        )}
        {wpTab === 2 && (
          <EducationFundTab
            p={p} updateP={updateP}
            isCouple={isCouple} clientName={clientName} spouseName={spouseName}
            children={children}
          />
        )}
        {wpTab === 3 && (
          <CriticalIllnessTab
            ff={ff} p={p} updateP={updateP}
            isCouple={isCouple} clientName={clientName} spouseName={spouseName}
            mortgages={mortgages}
            ciClient={ciClient} ciSpouse={ciSpouse}
            children={children}
          />
        )}
        {wpTab === 4 && (
          <AssetOffsetTab
            ff={ff} p={p}
            isCouple={isCouple} clientName={clientName} spouseName={spouseName}
            dtpdClient={dtpdClient} dtpdSpouse={dtpdSpouse}
            ciClient={ciClient} ciSpouse={ciSpouse}
          />
        )}
      </div>
    </div>
  )
}

// ─── FAMILY DEPENDENCY TAB ───────────────────────────────────────────────────

function FamilyDependencyTab({ ff, p, updateP, isCouple, clientName, spouseName, annExpClient, annExpSpouse, coverageTerm, youngestAge, children, isDetailed, cats, editModal, setEditModal, inflation, defaultClientPct, defaultSpousePct }: {
  ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  isCouple: boolean; clientName: string; spouseName: string
  annExpClient: number; annExpSpouse: number
  coverageTerm: number; youngestAge: number | null
  children: FamilyMember[]; isDetailed: boolean
  cats: Record<string, boolean>
  editModal: { open: boolean; category: string }
  setEditModal: (v: { open: boolean; category: string }) => void
  inflation: number; defaultClientPct: number; defaultSpousePct: number
}) {
  const annExpTotal = annExpClient + annExpSpouse

  function toggleCat(cat: string) {
    updateP({ expenseCategories: { ...cats, [cat]: !cats[cat] } })
  }

  return (
    <div>
      {/* Expense Categories */}
      <SectionBlock title="Expense Categories" color="#A8834A">
        <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 16 }}>
          Select which expense categories to include in the family dependency calculation.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {Object.entries(EXPENSE_CATEGORY_LABELS).map(([key, label]) => {
            let catTotal = 0
            if (isDetailed) {
              catTotal = getDetailedCategoryTotal(ff, key, 'client') + getDetailedCategoryTotal(ff, key, 'spouse')
              catTotal *= 12
            } else {
              // simplified
              const simpleMap: Record<string, string[]> = {
                financial: ['s_income_tax','s_insurance','s_regular_savings'],
                household: ['s_housing','s_utilities','s_family_food'],
                personal:  ['s_transport'],
                children:  ['s_children'],
                lifestyle: ['s_lifestyle','s_others'],
              }
              const s1 = (simpleMap[key] ?? []).reduce((s, k) => s + (ff[k] as number || 0), 0)
              const s2Keys = (simpleMap[key] ?? []).map(k => k.replace('s_','s2_'))
              const s2 = s2Keys.reduce((s, k) => s + (ff[k] as number || 0), 0)
              catTotal = (s1 + s2) * 12
            }

            return (
              <div
                key={key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  background: cats[key] ? '#F5F0E8' : 'transparent',
                  borderRadius: 4, cursor: 'pointer', transition: 'background 0.12s',
                }}
                onClick={() => toggleCat(key)}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                  background: cats[key] ? '#A8834A' : 'transparent',
                  border: `1.5px solid ${cats[key] ? '#A8834A' : '#ccc'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {cats[key] && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                </div>
                <span style={{ flex: 1, fontSize: 13, fontFamily: 'Inter', color: '#1C1A17' }}>{label}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#888' }}>
                  {fmt(catTotal)}/yr
                </span>
                {isDetailed && cats[key] && (
                  <button
                    onClick={e => { e.stopPropagation(); setEditModal({ open: true, category: key }) }}
                    style={{ fontSize: 11, color: '#A8834A', background: 'none', border: '1px solid #A8834A', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontFamily: 'Inter' }}
                  >
                    Edit
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Totals row */}
        <div style={{ marginTop: 16, padding: '12px 16px', background: '#1C1A17', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#c8a96e', fontFamily: 'Inter', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Selected Annual Expenses</span>
          {isCouple ? (
            <div style={{ display: 'flex', gap: 24 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', marginBottom: 2 }}>{clientName}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#F5F0E8' }}>{fmt(annExpClient)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', marginBottom: 2 }}>{spouseName}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#F5F0E8' }}>{fmt(annExpSpouse)}</div>
              </div>
            </div>
          ) : (
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#F5F0E8' }}>{fmt(annExpClient)}</span>
          )}
        </div>
      </SectionBlock>

      {/* Coverage Percentage */}
      {isCouple && (
        <SectionBlock title="Coverage Percentage" color="#A8834A">
          <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 16 }}>
            What portion of combined expenses does each person need to cover if the other passes away?
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <PersonSlider
              label={clientName} value={p.expenseCoverPctClient ?? defaultClientPct}
              onChange={v => updateP({ expenseCoverPctClient: v })}
              color="#A8834A"
            />
            <PersonSlider
              label={spouseName} value={p.expenseCoverPctSpouse ?? defaultSpousePct}
              onChange={v => updateP({ expenseCoverPctSpouse: v })}
              color="#A8834A"
            />
          </div>
        </SectionBlock>
      )}

      {/* Coverage Duration */}
      <SectionBlock title="Coverage Duration" color="#A8834A">
        {youngestAge !== null ? (
          <div>
            <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 16 }}>
              Coverage term auto-calculated based on youngest child reaching university graduation (age 26).
            </p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {children.map(c => {
                const age = c.age ?? getAge(c.date_of_birth)
                const uniGrad = Math.max(0, 26 - age)
                return (
                  <div key={c.id} style={{ padding: '10px 16px', background: '#F5F0E8', borderRadius: 6, borderLeft: '3px solid #A8834A' }}>
                    <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                      {c.name || c.relationship}
                    </div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#1C1A17' }}>
                      Age {age} · Grad in {uniGrad} yrs
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#888', fontFamily: 'Inter' }}>Coverage Term:</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: '#A8834A', fontWeight: 600 }}>{coverageTerm} years</span>
            </div>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 16 }}>
              Select coverage duration (no children detected).
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[5, 10, 15, 20, 25, 30].map(yr => (
                <button
                  key={yr}
                  onClick={() => updateP({ coverageTermOverride: yr })}
                  style={{
                    padding: '8px 16px', fontFamily: 'DM Mono, monospace', fontSize: 13,
                    background: (p.coverageTermOverride ?? 20) === yr ? '#1C1A17' : '#F5F0E8',
                    color: (p.coverageTermOverride ?? 20) === yr ? '#F5F0E8' : '#1C1A17',
                    border: 'none', borderRadius: 4, cursor: 'pointer', transition: 'all 0.12s',
                  }}
                >
                  {yr}yr
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, color: '#888', fontFamily: 'Inter' }}>Coverage Term: </span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: '#A8834A', fontWeight: 600 }}>{coverageTerm} years</span>
            </div>
          </div>
        )}
      </SectionBlock>

      {/* Family Dependency Summary */}
      <SectionBlock title="Family Dependency Need" color="#2D5A4E">
        <NeedTable
          isCouple={isCouple} clientName={clientName} spouseName={spouseName}
          clientData={dtpdFDOnly(annExpClient, p.expenseCoverPctClient ?? defaultClientPct, p.inflationRate ?? 3, coverageTerm)}
          spouseData={dtpdFDOnly(annExpSpouse, p.expenseCoverPctSpouse ?? defaultSpousePct, p.inflationRate ?? 3, coverageTerm)}
          label="D/TPD Family Dependency"
        />
      </SectionBlock>

      {/* Advisor Notes */}
      <SectionBlock title="Advisor Notes" color="#888">
        <textarea
          value={p.advisorNotes ?? ''}
          onChange={e => updateP({ advisorNotes: e.target.value })}
          placeholder="Document observations, client preferences, or planning considerations..."
          rows={4}
          style={{
            width: '100%', resize: 'vertical', fontFamily: 'Inter', fontSize: 13,
            color: '#1C1A17', background: '#F5F0E8', border: '1px solid #E8E4DC',
            borderRadius: 4, padding: '10px 12px', outline: 'none',
          }}
        />
      </SectionBlock>
    </div>
  )
}

function dtpdFDOnly(annExp: number, coverPctRaw: number, inflationRaw: number, term: number): number {
  const rate = inflationRaw / 100
  const pct = coverPctRaw / 100
  return fv(rate, term, annExp * pct)
}

// ─── MORTGAGE & DEBT TAB ─────────────────────────────────────────────────────

function MortgageDebtTab({ ff, p, updateP, isCouple, clientName, spouseName, mortgages }: {
  ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  isCouple: boolean; clientName: string; spouseName: string
  mortgages: MortgageProperty[]
}) {
  if (mortgages.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#aaa', fontSize: 13, fontFamily: 'Inter' }}>
        No mortgages found. Add properties in the Financials tab.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {mortgages.map((m, i) => {
        const clientPct = (p.mortgageCoverPctsClient ?? [])[i] ?? 50
        const spousePct = (p.mortgageCoverPctsSpouse ?? [])[i] ?? 50

        function updateClientPct(val: number) {
          const arr = [...(p.mortgageCoverPctsClient ?? mortgages.map(() => 50))]
          arr[i] = val
          updateP({ mortgageCoverPctsClient: arr })
        }
        function updateSpousePct(val: number) {
          const arr = [...(p.mortgageCoverPctsSpouse ?? mortgages.map(() => 50))]
          arr[i] = val
          updateP({ mortgageCoverPctsSpouse: arr })
        }

        return (
          <div key={m.id} style={{ background: '#F5F0E8', borderRadius: 8, padding: '20px 24px', borderLeft: '3px solid #A8834A' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17', marginBottom: 2 }}>{m.label}</div>
                <div style={{ fontSize: 12, color: '#888', fontFamily: 'DM Mono, monospace' }}>
                  Outstanding: {fmt(m.outstanding)} · {m.interestRate}% · {m.remainingTenure} yrs remaining
                </div>
              </div>
            </div>
            {isCouple ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <PersonSlider label={`${clientName} covers`} value={clientPct} onChange={updateClientPct} color="#A8834A" unit="%" />
                <PersonSlider label={`${spouseName} covers`} value={spousePct} onChange={updateSpousePct} color="#A8834A" unit="%" />
              </div>
            ) : (
              <PersonSlider label="Coverage %" value={clientPct} onChange={updateClientPct} color="#A8834A" unit="%" />
            )}
            <div style={{ marginTop: 12, display: 'flex', gap: 16, justifyContent: 'flex-end' }}>
              {isCouple ? (
                <>
                  <span style={{ fontSize: 12, color: '#888', fontFamily: 'Inter' }}>{clientName}: <strong style={{ color: '#1C1A17', fontFamily: 'DM Mono, monospace' }}>{fmt(m.outstanding * clientPct / 100)}</strong></span>
                  <span style={{ fontSize: 12, color: '#888', fontFamily: 'Inter' }}>{spouseName}: <strong style={{ color: '#1C1A17', fontFamily: 'DM Mono, monospace' }}>{fmt(m.outstanding * spousePct / 100)}</strong></span>
                </>
              ) : (
                <span style={{ fontSize: 12, color: '#888', fontFamily: 'Inter' }}>Coverage: <strong style={{ color: '#1C1A17', fontFamily: 'DM Mono, monospace' }}>{fmt(m.outstanding * clientPct / 100)}</strong></span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── EDUCATION FUND TAB ───────────────────────────────────────────────────────

function EducationFundTab({ p, updateP, isCouple, clientName, spouseName, children }: {
  p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  isCouple: boolean; clientName: string; spouseName: string
  children: FamilyMember[]
}) {
  type EduChild = { childId: string; uniType?: string; courseDuration?: number; annualCost?: number; coverPctClient?: number; coverPctSpouse?: number }

  function updateChild(childId: string, changes: Partial<EduChild>) {
    const arr: EduChild[] = [...(p.educationChildren ?? [])]
    const idx = arr.findIndex(e => e.childId === childId)
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], ...changes }
    } else {
      arr.push({ childId, ...changes })
    }
    updateP({ educationChildren: arr })
  }

  return (
    <div>
      {/* Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, padding: '14px 16px', background: '#F5F0E8', borderRadius: 6 }}>
        <Toggle value={p.provideEducationFund ?? false} onChange={v => updateP({ provideEducationFund: v })} />
        <div>
          <div style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 500, color: '#1C1A17' }}>Provide Education Fund</div>
          <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter' }}>Include children's university education in coverage needs</div>
        </div>
      </div>

      {p.provideEducationFund && (
        <>
          {children.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#aaa', fontSize: 13 }}>
              No children found. Add children in the Client Profile.
            </div>
          )}
          {children.map(child => {
            const ec = (p.educationChildren ?? []).find(e => e.childId === child.id) ?? { childId: child.id, uniType: 'sg_local', courseDuration: 4, annualCost: 34000, coverPctClient: 50, coverPctSpouse: 50 }
            const age = child.age ?? getAge(child.date_of_birth)
            const uniInfo = UNI_COST_DEFAULTS[ec.uniType ?? 'sg_local']
            const total = (ec.annualCost ?? uniInfo.annual) * (ec.courseDuration ?? 4)

            return (
              <div key={child.id} style={{ background: '#F5F0E8', borderRadius: 8, padding: '20px 24px', marginBottom: 16, borderLeft: '3px solid #2D5A4E' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17' }}>{child.name || `${child.relationship}`}</div>
                    <div style={{ fontSize: 12, color: '#888', fontFamily: 'Inter' }}>Age {age}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Total Fund</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#2D5A4E', fontWeight: 600 }}>{fmt(total)}</div>
                  </div>
                </div>

                {/* Uni type */}
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>University Type</label>
                  <select
                    value={ec.uniType ?? 'sg_local'}
                    onChange={e => {
                      const uni = e.target.value
                      updateChild(child.id, { uniType: uni, annualCost: UNI_COST_DEFAULTS[uni].annual })
                    }}
                    style={{ width: '100%', padding: '8px 10px', fontFamily: 'Inter', fontSize: 13, background: '#fff', border: '1px solid #E8E4DC', borderRadius: 4, color: '#1C1A17', outline: 'none' }}
                  >
                    {Object.entries(UNI_COST_DEFAULTS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label} — {fmt(v.annual)}/yr</option>
                    ))}
                  </select>
                </div>

                {/* Course duration + annual cost */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                  <div>
                    <label style={labelStyle}>Course Duration (years)</label>
                    <input
                      type="number" min={1} max={6} step={1}
                      value={ec.courseDuration ?? 4}
                      onChange={e => updateChild(child.id, { courseDuration: parseInt(e.target.value) })}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Annual Cost (SGD)</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#888', fontFamily: 'DM Mono, monospace', fontSize: 13 }}>$</span>
                      <input
                        type="number" min={0}
                        value={ec.annualCost ?? uniInfo.annual}
                        onChange={e => updateChild(child.id, { annualCost: parseInt(e.target.value) })}
                        style={{ ...inputStyle, paddingLeft: 24 }}
                      />
                    </div>
                  </div>
                </div>

                {/* Coverage split */}
                {isCouple && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <PersonSlider label={`${clientName} covers`} value={ec.coverPctClient ?? 50} onChange={v => updateChild(child.id, { coverPctClient: v })} color="#2D5A4E" unit="%" />
                    <PersonSlider label={`${spouseName} covers`} value={ec.coverPctSpouse ?? 50} onChange={v => updateChild(child.id, { coverPctSpouse: v })} color="#2D5A4E" unit="%" />
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// ─── CRITICAL ILLNESS TAB ─────────────────────────────────────────────────────

function CriticalIllnessTab({ ff, p, updateP, isCouple, clientName, spouseName, mortgages, ciClient, ciSpouse, children }: {
  ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  isCouple: boolean; clientName: string; spouseName: string
  mortgages: MortgageProperty[]
  ciClient: CalcResult; ciSpouse: CalcResult
  children: FamilyMember[]
}) {
  return (
    <div>
      {/* CI Stage */}
      <SectionBlock title="Critical Illness Stage" color="#A8834A">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {([
            { key: 'early_late', label: 'Early & Late Stage' },
            { key: 'late_only', label: 'Late Stage Only' },
          ] as const).map(opt => (
            <button
              key={opt.key}
              onClick={() => updateP({ ciStage: opt.key })}
              style={{
                padding: '8px 16px', fontFamily: 'Inter', fontSize: 12,
                background: p.ciStage === opt.key ? '#1C1A17' : '#F5F0E8',
                color: p.ciStage === opt.key ? '#fff' : '#1C1A17',
                border: 'none', borderRadius: 4, cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 11, color: '#888', fontFamily: 'Inter' }}>
          {p.ciStage === 'early_late' ? 'Covers both early and late stage critical illnesses.' : 'Covers late stage critical illnesses only.'}
        </p>
      </SectionBlock>

      {/* CI Window */}
      <SectionBlock title="CI Coverage Window" color="#A8834A">
        <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 12 }}>
          How many years of expenses to cover during a critical illness event?
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range" min={1} max={10} step={1}
            value={p.ciYears ?? 5}
            onChange={e => updateP({ ciYears: parseInt(e.target.value) })}
            style={{ flex: 1, accentColor: '#A8834A' }}
          />
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: '#A8834A', minWidth: 60 }}>
            {p.ciYears ?? 5} years
          </span>
        </div>
      </SectionBlock>

      {/* CI Mortgage */}
      {mortgages.length > 0 && (
        <SectionBlock title="Mortgage During CI" color="#A8834A">
          <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 12 }}>
            What % of monthly mortgage repayments to cover during CI event?
          </p>
          {isCouple ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <PersonSlider label={clientName} value={p.ciMortgagePctClient ?? 100} onChange={v => updateP({ ciMortgagePctClient: v })} color="#A8834A" unit="%" />
              <PersonSlider label={spouseName} value={p.ciMortgagePctSpouse ?? 100} onChange={v => updateP({ ciMortgagePctSpouse: v })} color="#A8834A" unit="%" />
            </div>
          ) : (
            <PersonSlider label="Coverage %" value={p.ciMortgagePctClient ?? 100} onChange={v => updateP({ ciMortgagePctClient: v })} color="#A8834A" unit="%" />
          )}
        </SectionBlock>
      )}

      {/* Include education */}
      {p.provideEducationFund && children.length > 0 && (
        <SectionBlock title="Education Fund" color="#2D5A4E">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle value={p.includeEduInCI ?? false} onChange={v => updateP({ includeEduInCI: v })} />
            <span style={{ fontSize: 13, fontFamily: 'Inter', color: '#1C1A17' }}>Include education fund in CI calculation</span>
          </div>
        </SectionBlock>
      )}

      {/* CI Need Summary */}
      <SectionBlock title="Critical Illness Need Summary" color="#2D5A4E">
        <NeedTable
          isCouple={isCouple} clientName={clientName} spouseName={spouseName}
          clientData={ciClient.gross} spouseData={ciSpouse.gross}
          label="CI Cover Needed" breakdown={{
            client: { fd: ciClient.fd, mort: ciClient.mort, edu: ciClient.edu },
            spouse: { fd: ciSpouse.fd, mort: ciSpouse.mort, edu: ciSpouse.edu },
          }}
        />
      </SectionBlock>
    </div>
  )
}

// ─── ASSET OFFSET TAB ────────────────────────────────────────────────────────

function AssetOffsetTab({ ff, p, isCouple, clientName, spouseName, dtpdClient, dtpdSpouse, ciClient, ciSpouse }: {
  ff: FactFinding; p: ProtectionData
  isCouple: boolean; clientName: string; spouseName: string
  dtpdClient: CalcResult; dtpdSpouse: CalcResult
  ciClient: CalcResult; ciSpouse: CalcResult
}) {
  function AssetRow({ label, clientVal, spouseVal }: { label: string; clientVal: number; spouseVal: number }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #E8E4DC' }}>
        <span style={{ flex: 1, fontSize: 13, fontFamily: 'Inter', color: '#1C1A17' }}>{label}</span>
        {isCouple ? (
          <>
            <span style={{ width: 120, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#2D5A4E' }}>{fmt(clientVal)}</span>
            <span style={{ width: 120, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#2D5A4E' }}>{fmt(spouseVal)}</span>
          </>
        ) : (
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#2D5A4E' }}>{fmt(clientVal)}</span>
        )}
      </div>
    )
  }

  const clientLiquid = (ff.a_savings ?? 0) + (ff.a_fixed_deposit ?? 0) + (ff.a_srs ?? 0) + (ff.a_shares ?? 0) + (ff.a_etf ?? 0) + (ff.a_unit_trust ?? 0) + (ff.a_bonds ?? 0) + (ff.a_alternatives ?? 0)
  const spouseLiquid = (ff.a2_savings ?? 0) + (ff.a2_fixed_deposit ?? 0) + (ff.a2_srs ?? 0) + (ff.a2_shares ?? 0) + (ff.a2_etf ?? 0) + (ff.a2_unit_trust ?? 0) + (ff.a2_bonds ?? 0) + (ff.a2_alternatives ?? 0)
  const clientCPF = (ff.a_cpf_oa ?? 0) + (ff.a_cpf_sa ?? 0) + (ff.a_cpf_ma ?? 0) + (ff.a_cpf_ra ?? 0)
  const spouseCPF = (ff.a2_cpf_oa ?? 0) + (ff.a2_cpf_sa ?? 0) + (ff.a2_cpf_ma ?? 0) + (ff.a2_cpf_ra ?? 0)
  const clientInvProp = (ff.a_inv_property_res ?? 0) + (ff.a_inv_property_com ?? 0)
  const spouseInvProp = (ff.a2_inv_property_res ?? 0) + (ff.a2_inv_property_com ?? 0)

  const colHeader = (name: string) => (
    <span style={{ width: 120, textAlign: 'right', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', fontFamily: 'Inter' }}>{name}</span>
  )

  return (
    <div>
      <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 20 }}>
        Assets are automatically offset against coverage needs. D/TPD offsets include CPF and investment property. CI offsets use liquid assets only.
      </p>

      <SectionBlock title="Asset Values" color="#2D5A4E">
        {isCouple && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 0, marginBottom: 4 }}>
            {colHeader(clientName)}
            {colHeader(spouseName)}
          </div>
        )}
        <AssetRow label="Cash & Liquid Investments" clientVal={clientLiquid} spouseVal={spouseLiquid} />
        <AssetRow label="CPF (OA + SA + MA + RA)" clientVal={clientCPF} spouseVal={spouseCPF} />
        <AssetRow label="Investment Properties" clientVal={clientInvProp} spouseVal={spouseInvProp} />
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: '#F5F0E8', borderRadius: '0 0 4px 4px' }}>
          <span style={{ flex: 1, fontSize: 12, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17', textTransform: 'uppercase', letterSpacing: '0.06em' }}>D/TPD Offset (all assets)</span>
          {isCouple ? (
            <>
              <span style={{ width: 120, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 600 }}>{fmt(clientLiquid + clientCPF + clientInvProp)}</span>
              <span style={{ width: 120, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 600 }}>{fmt(spouseLiquid + spouseCPF + spouseInvProp)}</span>
            </>
          ) : (
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 600 }}>{fmt(clientLiquid + clientCPF + clientInvProp)}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: '#E8F0ED' }}>
          <span style={{ flex: 1, fontSize: 12, fontFamily: 'Inter', fontWeight: 600, color: '#2D5A4E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>CI Offset (liquid only)</span>
          {isCouple ? (
            <>
              <span style={{ width: 120, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 600 }}>{fmt(clientLiquid)}</span>
              <span style={{ width: 120, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 600 }}>{fmt(spouseLiquid)}</span>
            </>
          ) : (
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 600 }}>{fmt(clientLiquid)}</span>
          )}
        </div>
      </SectionBlock>

      {/* Net Need Summary */}
      <SectionBlock title="Net Need After Offset" color="#1C1A17">
        {[
          { label: 'D/TPD Net Need', clientNet: dtpdClient.net, spouseNet: dtpdSpouse.net },
          { label: 'CI Net Need', clientNet: ciClient.net, spouseNet: ciSpouse.net },
        ].map(row => (
          <div key={row.label} style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', marginBottom: 4, background: '#1C1A17', borderRadius: 6 }}>
            <span style={{ flex: 1, fontSize: 12, color: '#c8a96e', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{row.label}</span>
            {isCouple ? (
              <>
                <div style={{ textAlign: 'right', minWidth: 130 }}>
                  <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter' }}>{clientName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: '#F5F0E8' }}>{fmt(row.clientNet)}</div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 130 }}>
                  <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter' }}>{spouseName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: '#F5F0E8' }}>{fmt(row.spouseNet)}</div>
                </div>
              </>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#F5F0E8' }}>{fmt(row.clientNet)}</span>
            )}
          </div>
        ))}
      </SectionBlock>
    </div>
  )
}

// ─── SIDEBAR SUMMARY ─────────────────────────────────────────────────────────

function SidebarSummary({ isCouple, clientName, spouseName, dtpdClient, dtpdSpouse, ciClient, ciSpouse, existingLifeClient, existingLifeSpouse, existingCIClient, existingCISpouse, lifeGapClient, lifeGapSpouse, ciGapClient, ciGapSpouse }: {
  isCouple: boolean; clientName: string; spouseName: string
  dtpdClient: CalcResult; dtpdSpouse: CalcResult
  ciClient: CalcResult; ciSpouse: CalcResult
  existingLifeClient: number; existingLifeSpouse: number
  existingCIClient: number; existingCISpouse: number
  lifeGapClient: number; lifeGapSpouse: number
  ciGapClient: number; ciGapSpouse: number
}) {
  function PersonBlock({ name, dtpd, ci, existLife, existCI, lifeGap, ciGap }: {
    name: string; dtpd: CalcResult; ci: CalcResult
    existLife: number; existCI: number; lifeGap: number; ciGap: number
  }) {
    return (
      <div style={{ background: '#F5F0E8', borderRadius: 8, padding: '16px', marginBottom: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A8834A', fontFamily: 'Inter', marginBottom: 10 }}>{name}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SidebarRow label="D/TPD Need" value={dtpd.net} />
          <SidebarRow label="CI Need" value={ci.net} />
          <div style={{ borderTop: '1px solid #E8E4DC', paddingTop: 8, marginTop: 2 }}>
            <SidebarRow label="Existing Life" value={existLife} color="#2D5A4E" />
            <SidebarRow label="Existing CI" value={existCI} color="#2D5A4E" />
          </div>
          <div style={{ borderTop: '1px solid #E8E4DC', paddingTop: 8, marginTop: 2 }}>
            <SidebarRow label="Life Gap" value={lifeGap} color={lifeGap > 0 ? '#C0392B' : '#2D5A4E'} />
            <SidebarRow label="CI Gap" value={ciGap} color={ciGap > 0 ? '#C0392B' : '#2D5A4E'} />
          </div>
          <div style={{ borderTop: '1px solid #E8E4DC', paddingTop: 6, marginTop: 2, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <MiniBreakdown label="FD" value={dtpd.fd} />
            <MiniBreakdown label="Mort" value={dtpd.mort} />
            <MiniBreakdown label="Edu" value={dtpd.edu} />
          </div>
        </div>
      </div>
    )
  }

  if (isCouple) {
    return (
      <>
        <PersonBlock name={clientName} dtpd={dtpdClient} ci={ciClient} existLife={existingLifeClient} existCI={existingCIClient} lifeGap={lifeGapClient} ciGap={ciGapClient} />
        <PersonBlock name={spouseName} dtpd={dtpdSpouse} ci={ciSpouse} existLife={existingLifeSpouse} existCI={existingCISpouse} lifeGap={lifeGapSpouse} ciGap={ciGapSpouse} />
      </>
    )
  }

  return <PersonBlock name={clientName} dtpd={dtpdClient} ci={ciClient} existLife={existingLifeClient} existCI={existingCIClient} lifeGap={lifeGapClient} ciGap={ciGapClient} />
}

function SidebarRow({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: '#888', fontFamily: 'Inter' }}>{label}</span>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: color ?? '#1C1A17' }}>{fmt(value)}</span>
    </div>
  )
}

function MiniBreakdown({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#1C1A17' }}>{fmt(value)}</div>
    </div>
  )
}

// ─── EXISTING COVER INPUTS ───────────────────────────────────────────────────

function ExistingCoverInputs({ p, updateP, isCouple, clientName, spouseName }: {
  p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  isCouple: boolean; clientName: string; spouseName: string
}) {
  const fields: { key: keyof ProtectionData; label: string; person: 'client' | 'spouse' }[] = [
    { key: 'existingLifeCoverClient', label: `${clientName} — Life`, person: 'client' },
    { key: 'existingCICoverClient', label: `${clientName} — CI`, person: 'client' },
    ...(isCouple ? [
      { key: 'existingLifeCoverSpouse' as keyof ProtectionData, label: `${spouseName} — Life`, person: 'spouse' as const },
      { key: 'existingCICoverSpouse' as keyof ProtectionData, label: `${spouseName} — CI`, person: 'spouse' as const },
    ] : []),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {fields.map(f => (
        <div key={f.key}>
          <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', fontFamily: 'Inter', marginBottom: 4 }}>{f.label}</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#888', fontFamily: 'DM Mono, monospace', fontSize: 12 }}>$</span>
            <input
              type="number" min={0}
              value={(p[f.key] as number) ?? 0}
              onChange={e => updateP({ [f.key]: parseInt(e.target.value) || 0 })}
              style={{ ...inputStyle, paddingLeft: 20, width: '100%', background: '#F5F0E8' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── EDIT SUB-ITEMS MODAL ────────────────────────────────────────────────────

function EditSubItemsModal({ category, ff, p, updateP, onClose }: {
  category: string; ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void; onClose: () => void
}) {
  const subItems = p.expenseSubItems ?? {}
  const keys = DETAILED_EXPENSE_MAP[category] ?? []

  function toggleItem(key: string) {
    updateP({ expenseSubItems: { ...subItems, [key]: !(subItems[key] !== false) } })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: '28px 32px', minWidth: 380, maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 400, color: '#1C1A17', margin: 0 }}>
            {EXPENSE_CATEGORY_LABELS[category]}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#888' }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {keys.map(key => {
            const val = ff[key] as number || 0
            const included = subItems[key] !== false
            return (
              <div
                key={key}
                onClick={() => toggleItem(key)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 4, cursor: 'pointer', background: included ? '#F5F0E8' : 'transparent' }}
              >
                <div style={{ width: 16, height: 16, borderRadius: 3, background: included ? '#A8834A' : 'transparent', border: `1.5px solid ${included ? '#A8834A' : '#ccc'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {included && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                </div>
                <span style={{ flex: 1, fontSize: 13, fontFamily: 'Inter', color: '#1C1A17' }}>{DETAILED_EXPENSE_LABELS[key]}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#888' }}>{fmt(val * 12)}/yr</span>
              </div>
            )
          })}
        </div>
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '9px 24px', background: '#1C1A17', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'Inter', fontSize: 13, letterSpacing: '0.06em' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SHARED UI PRIMITIVES ────────────────────────────────────────────────────

function SectionBlock({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ width: 3, height: 16, background: color, borderRadius: 2, flexShrink: 0 }} />
        <span style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function PersonSlider({ label, value, onChange, color, unit = '%' }: {
  label: string; value: number; onChange: (v: number) => void; color: string; unit?: string
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', fontFamily: 'Inter' }}>{label}</span>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color }}>
          {Math.round(value)}{unit}
        </span>
      </div>
      <input
        type="range" min={0} max={100} step={5}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: color }}
      />
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 40, height: 22, borderRadius: 11, cursor: 'pointer', transition: 'background 0.15s',
        background: value ? '#A8834A' : '#ccc', position: 'relative', flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: 3, left: value ? 21 : 3, width: 16, height: 16,
        borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  )
}

function NeedTable({ isCouple, clientName, spouseName, clientData, spouseData, label, breakdown }: {
  isCouple: boolean; clientName: string; spouseName: string
  clientData: number; spouseData: number; label: string
  breakdown?: { client: { fd: number; mort: number; edu: number }; spouse: { fd: number; mort: number; edu: number } }
}) {
  return (
    <div>
      <div style={{ display: 'flex', padding: '12px 16px', background: '#1C1A17', borderRadius: 6, alignItems: 'center', marginBottom: breakdown ? 8 : 0 }}>
        <span style={{ flex: 1, fontSize: 12, color: '#c8a96e', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
        {isCouple ? (
          <>
            <div style={{ textAlign: 'right', minWidth: 120 }}>
              <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter' }}>{clientName}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: '#F5F0E8' }}>{fmt(clientData)}</div>
            </div>
            <div style={{ textAlign: 'right', minWidth: 120 }}>
              <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter' }}>{spouseName}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: '#F5F0E8' }}>{fmt(spouseData)}</div>
            </div>
          </>
        ) : (
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#F5F0E8' }}>{fmt(clientData)}</span>
        )}
      </div>
      {breakdown && (
        <div style={{ display: 'flex', gap: 0, background: '#F5F0E8', borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
          {(['fd', 'mort', 'edu'] as const).map(key => {
            const labels = { fd: 'Family Dep.', mort: 'Mortgage', edu: 'Education' }
            return (
              <div key={key} style={{ flex: 1, padding: '8px 10px', borderRight: key !== 'edu' ? '1px solid #E8E4DC' : 'none' }}>
                <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{labels[key]}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#1C1A17' }}>{fmt(breakdown.client[key])}</div>
                {isCouple && <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#888', marginTop: 2 }}>{fmt(breakdown.spouse[key])}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── STYLE CONSTANTS ─────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
  color: '#888', fontFamily: 'Inter', marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontFamily: 'DM Mono, monospace', fontSize: 13,
  color: '#1C1A17', background: '#fff', border: '1px solid #E8E4DC',
  borderRadius: 4, outline: 'none',
}
