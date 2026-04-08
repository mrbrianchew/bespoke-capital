'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useUniCosts, UNI_COST_DEFAULTS as UNI_COST_FALLBACK } from '@/hooks/useUniCosts'

// Module-level fallback so sub-components can access defaults before hook loads
let UNI_COST_DEFAULTS = UNI_COST_FALLBACK

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
  gender?: string
  date_of_birth?: string
  age?: number
}

type CalcResult = { gross: number; assets: number; net: number; fd: number; mort: number; edu: number }

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
  d_rental_expense?: number; d_income_tax?: number; d_insurance?: number; d_regular_savings?: number
  d_conservancy?: number; d_utilities?: number; d_family_food?: number
  d_maid?: number; d_other_household?: number; d_personal_food?: number
  d_transport?: number; d_car_petrol?: number; d_car_insurance?: number
  d_childcare?: number; d_school_fees?: number; d_school_transport?: number
  d_allowance_children?: number; d_other_children?: number
  d_holidays?: number; d_hobbies?: number; d_allowance_parents?: number
  d_others_lifestyle?: number; d_mortgage_cpf?: number; d_mortgage_cash?: number
  // Detailed expenses spouse
  d2_rental_expense?: number; d2_income_tax?: number; d2_insurance?: number; d2_regular_savings?: number
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
  expenseMode?: 'simple' | 'detailed'
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
  educationChildren?: { childId: string; uniType?: string; courseDuration?: number; annualTuition?: number; annualLiving?: number; uniEntryAge?: number; coverPctClient?: number; coverPctSpouse?: number }[]
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

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  financial: 'Financial Commitments',
  household: 'Household Expenses',
  personal:  'Personal Expenses',
  children:  'Children Expenses',
  lifestyle: 'Lifestyle & Others',
}

const DETAILED_EXPENSE_MAP: Record<string, string[]> = {
  financial: ['d_rental_expense','d_income_tax','d_regular_savings','d_insurance'],
  household: ['d_conservancy','d_utilities','d_family_food','d_maid','d_other_household'],
  personal:  ['d_personal_food','d_transport','d_car_petrol','d_car_insurance'],
  children:  ['d_childcare','d_school_fees','d_school_transport','d_allowance_children','d_other_children'],
  lifestyle: ['d_holidays','d_hobbies','d_allowance_parents','d_others_lifestyle'],
}

const DETAILED_EXPENSE_LABELS: Record<string, string> = {
  d_rental_expense: 'Rental / Housing Expense',
  d_income_tax: 'Income Tax',
  d_regular_savings: 'Regular Savings / Investments',
  d_insurance: 'Insurance Premium',
  d_conservancy: 'Conservancy & S&CC Fees',
  d_utilities: 'Utilities (Water, Gas, Electricity)',
  d_family_food: 'Groceries & Family Food',
  d_maid: 'Domestic Helper / Maid Levy',
  d_other_household: 'Other Household Expenses',
  d_personal_food: 'Personal Meals & Dining',
  d_transport: 'Public Transport',
  d_car_petrol: 'Car Petrol',
  d_car_insurance: 'Car Insurance & Road Tax',
  d_childcare: 'Childcare / Infant Care',
  d_school_fees: 'School Fees & Tuition',
  d_school_transport: 'School Transport',
  d_allowance_children: 'Allowance for Children',
  d_other_children: 'Other Children Expenses',
  d_holidays: 'Holidays & Travel',
  d_hobbies: 'Hobbies & Leisure',
  d_allowance_parents: 'Allowance for Parents',
  d_others_lifestyle: 'Other Lifestyle Expenses',
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fv(rate: number, nper: number, pmt: number): number {
  if (nper <= 0) return 0
  if (rate === 0) return pmt * nper
  return pmt * ((Math.pow(1 + rate, nper) - 1) / rate) * (1 + rate)
}

function fmt(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
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

function getDetailedCategoryTotal(ff: FactFinding, category: string, prefix: 'client' | 'spouse', subItems?: Record<string, boolean>): number {
  const sp = prefix === 'spouse' ? 'd2_' : 'd_'
  const perPersonKey = prefix === 'spouse' ? '_s' : '_c'
  const keys = DETAILED_EXPENSE_MAP[category] || []
  return keys.reduce((sum, k) => {
    if (subItems) {
      const personKey = k + perPersonKey
      if (personKey in subItems) {
        if (subItems[personKey] === false) return sum
      } else {
        if (subItems[k] === false) return sum
      }
    }
    return sum + (ff[k.replace('d_', sp)] as number || 0)
  }, 0)
}

function getDetailedTotal(ff: FactFinding, categories: Record<string, boolean>, subItems: Record<string, boolean>, prefix: 'client' | 'spouse'): number {
  const sp = prefix === 'spouse' ? 'd2_' : 'd_'
  const perPersonKey = prefix === 'spouse' ? '_s' : '_c'
  let total = 0
  Object.entries(categories).forEach(([cat, enabled]) => {
    if (!enabled) return
    DETAILED_EXPENSE_MAP[cat]?.forEach(key => {
      const personKey = key + perPersonKey
      if (personKey in subItems) {
        if (subItems[personKey] === false) return
      } else {
        if (subItems[key] === false) return
      }
      total += (ff[key.replace('d_', sp)] as number || 0)
    })
  })
  return total
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
  return total
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
  const { uniCosts: _uniCosts } = useUniCosts()
  UNI_COST_DEFAULTS = _uniCosts
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState('Client')
  const [spouseName, setSpouseName] = useState('Spouse')
  const [ff, setFf] = useState<FactFinding>({})
  const [p, setP] = useState<ProtectionData>({
    planType: 'couple',
    expenseMode: 'simple',
    inflationRate: 3,
    wpSubTab: 2, // Default to Education Fund as per screenshot
    expenseCategories: { financial: true, household: true, personal: true, children: true, lifestyle: true },
    expenseSubItems: {},
    expenseCoverPctClient: 100,
    expenseCoverPctSpouse: 100,
    coverageTermOverride: 20,
    mortgageCoverPcts: [],
    mortgageCoverPctsClient: [],
    mortgageCoverPctsSpouse: [],
    provideEducationFund: true,
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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── LOAD DATA ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const id = localStorage.getItem('selectedClientId')
    if (id) {
      setClientId(id)
      loadData(id)
    } else {
      loadDataFromAuth()
    }
  }, [])

  async function loadDataFromAuth() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data: clients } = await supabase
      .from('clients')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
    if (clients && clients.length > 0) {
      const id = clients[0].id
      setClientId(id)
      localStorage.setItem('selectedClientId', id)
      loadData(id)
    } else {
      setLoading(false)
    }
  }

  async function loadData(id: string) {
    setLoading(true)
    const { data: ffRows } = await supabase
      .from('fact_finding')
      .select('*')
      .eq('client_id', id)
    if (ffRows && ffRows.length > 0) {
      const merged: FactFinding = { client_id: id }
      for (const row of ffRows) Object.assign(merged, row.data || {})
      const protRow = ffRows.find((r: any) => r.section === 'protection' || r.data?.protection)
      const protData = protRow?.data?.protection
      if (protData) {
        setP(prev => ({ ...prev, ...protData }))
      }
      setFf(merged)
    }
    const { data: clientData } = await supabase
      .from('clients')
      .select('full_name')
      .eq('id', id)
      .single()
    if (clientData) {
      setClientName(clientData.full_name || 'Client')
    }
    const { data: familyData } = await supabase
      .from('family_members')
      .select('*')
      .eq('client_id', id)
    if (familyData) {
      const spouse = familyData.find((f: any) => f.relationship === 'Spouse')
      if (spouse) setSpouseName(spouse.name || 'Spouse')
      const kids = familyData.filter((f: any) => ['Daughter','Son','Child'].includes(f.relationship))
      setChildren(kids)
    }
    setLoading(false)
  }

  // ─── AUTO-SAVE ─────────────────────────────────────────────────────────────

  const scheduleSave = useCallback((updated: ProtectionData) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      if (!clientId) return
      setSaving(true)
      await supabase
        .from('fact_finding')
        .upsert(
          { client_id: clientId, section: 'protection', data: { protection: updated }, updated_at: new Date().toISOString() },
          { onConflict: 'client_id,section' }
        )
      setSaving(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
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
  const isDetailed = (p.expenseMode ?? ff.expense_mode ?? 'simple') === 'detailed'

  function getAnnualExpense(who: 'client' | 'spouse'): number {
    if (isDetailed) return getDetailedTotal(ff, cats, subItems, who)
    return getSimpleCategoryTotal(ff, cats, who)
  }

  const annExpClient = getAnnualExpense('client')
  const annExpSpouse = getAnnualExpense('spouse')
  const annExpTotal = annExpClient + annExpSpouse

  const childAges = children.map(c => c.age ?? getAge(c.date_of_birth))
  const youngestAge = childAges.length > 0 ? Math.min(...childAges) : null
  const coverageTerm = youngestAge !== null
    ? Math.max(0, (22 + 4) - youngestAge)
    : (p.coverageTermOverride ?? 20)

  const defaultClientPct = annExpTotal > 0 ? (annExpClient / annExpTotal * 100) : 100
  const defaultSpousePct = annExpTotal > 0 ? (annExpSpouse / annExpTotal * 100) : 100

  const clientCoverPct = (p.expenseCoverPctClient ?? defaultClientPct) / 100
  const spouseCoverPct = (p.expenseCoverPctSpouse ?? defaultSpousePct) / 100

  function calcFamilyDep(annExp: number, coverPct: number, years: number): number {
    return fv(inflation, years, annExp * coverPct)
  }

  function calcMortgageForPerson(who: 'client' | 'spouse'): number {
    const mortgages = ff.mortgages ?? []
    return mortgages.reduce((sum, m, i) => {
      const pcts = who === 'client' ? (p.mortgageCoverPctsClient ?? []) : (p.mortgageCoverPctsSpouse ?? [])
      const pct = (pcts[i] ?? 100) / 100
      return sum + m.outstanding * pct
    }, 0)
  }

  function calcEducationForPerson(who: 'client' | 'spouse'): number {
    if (!p.provideEducationFund) return 0
    const eduKids = p.educationChildren ?? []
    const livingInflation = inflation
    return children.reduce((sum, child) => {
      const ec = eduKids.find(e => e.childId === child.id)
      if (!ec) return sum
      const childAge = child.age ?? getAge(child.date_of_birth)
      const defaultEntryAge = child.gender === 'Male' ? 20 : 18
      const uniEntryAge = ec.uniEntryAge ?? defaultEntryAge
      const yearsToUni = Math.max(0, uniEntryAge - childAge)
      const uniInfo = UNI_COST_DEFAULTS[ec.uniType ?? 'sg_local']
      const baseTuition = ec.annualTuition ?? uniInfo.annual_tuition
      const baseLiving = ec.annualLiving ?? uniInfo.annual_living
      const dur = ec.courseDuration ?? uniInfo.default_duration ?? 4
      const fvTuition = baseTuition * Math.pow(1.05, yearsToUni) * dur
      const fvLiving = baseLiving * Math.pow(1 + livingInflation, yearsToUni) * dur
      const defaultPct = isCouple ? 50 : 100
      const pct = (who === 'client' ? (ec.coverPctClient ?? defaultPct) : (ec.coverPctSpouse ?? defaultPct)) / 100
      return sum + (fvTuition + fvLiving) * pct
    }, 0)
  }

  function calcCIFamilyDep(annExp: number, coverPct: number): number {
    return fv(inflation, p.ciYears ?? 5, annExp * coverPct)
  }

  function calcCIMortgage(who: 'client' | 'spouse'): number {
    const mortgages = ff.mortgages ?? []
    const ciYrs = p.ciYears ?? 5
    const pct = (who === 'client' ? (p.ciMortgagePctClient ?? 100) : (p.ciMortgagePctSpouse ?? 100)) / 100
    return mortgages.reduce((sum, m) => sum + m.monthlyRepayment * 12 * ciYrs * pct, 0)
  }

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

  const existingLifeClient = p.existingLifeCoverClient ?? 0
  const existingLifeSpouse = p.existingLifeCoverSpouse ?? 0
  const existingCIClient = p.existingCICoverClient ?? 0
  const existingCISpouse = p.existingCICoverSpouse ?? 0

  const lifeGapClient = Math.max(0, dtpdClient.net - existingLifeClient)
  const lifeGapSpouse = Math.max(0, dtpdSpouse.net - existingLifeSpouse)
  const ciGapClient = Math.max(0, ciClient.net - existingCIClient)
  const ciGapSpouse = Math.max(0, ciSpouse.net - existingCISpouse)

  // ─── EFFECT INIT ───────────────────────────────────────────────

  useEffect(() => {
    if (children.length > 0 && (p.educationChildren?.length ?? 0) === 0) {
      const eduKids = children.map(c => ({
        childId: c.id,
        uniType: 'sg_local',
        courseDuration: 4,
        annualCost: UNI_COST_DEFAULTS.sg_local.annual_fees_living,
        coverPctClient: isCouple ? 50 : 100,
        coverPctSpouse: 50,
      }))
      updateP({ educationChildren: eduKids })
    }
  }, [children])

  useEffect(() => {
    const mortgages = ff.mortgages ?? []
    if (mortgages.length > 0) {
      const clientPcts = p.mortgageCoverPctsClient ?? []
      const spousePcts = p.mortgageCoverPctsSpouse ?? []
      if (clientPcts.length !== mortgages.length || spousePcts.length !== mortgages.length) {
        updateP({
          mortgageCoverPctsClient: mortgages.map(() => 50),
          mortgageCoverPctsSpouse: mortgages.map(() => 50),
          mortgageCoverPcts: mortgages.map(() => 100),
        })
      }
    }
  }, [ff.mortgages])

  const WP_TABS = ['FAMILY DEPENDENCY', 'MORTGAGE & DEBT', 'EDUCATION FUND', 'CRITICAL ILLNESS', 'ASSET OFFSET']

  // ─── RENDER ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: '#F9F8F4' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#B99B6A', borderTopColor: 'transparent' }} />
          <p className="text-xs tracking-widest uppercase" style={{ color: '#B99B6A', fontFamily: 'Inter, sans-serif' }}>Loading</p>
        </div>
      </div>
    )
  }

  // Ensure visual fallback handles missing client id
  const safeClientName = clientName || 'Client'
  const safeSpouseName = spouseName || 'Spouse'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F9F8F4', fontFamily: 'Inter, sans-serif' }}>
      
      {/* ─── SIMULATED LEFT SIDEBAR ─── */}
      <div style={{ width: '240px', background: '#FFFFFF', borderRight: '1px solid #E6E4DD', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '32px 24px' }}>
          <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '20px', color: '#1A1A1A', margin: 0, fontWeight: 500 }}>Bespoke Capital</h2>
          <p style={{ fontSize: '10px', color: '#737373', letterSpacing: '0.1em', marginTop: '4px', textTransform: 'uppercase', fontWeight: 600 }}>Financial Plan</p>
        </div>
        
        <div style={{ padding: '0 24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#F9F8F4', padding: '12px', borderRadius: '8px', border: '1px solid #E6E4DD' }}>
            <div style={{ width: '32px', height: '32px', background: '#D1BE9C', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontSize: '12px', fontWeight: 600 }}>AA</div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1A1A1A' }}>Andy ACH</div>
              <div style={{ fontSize: '11px', color: '#737373' }}>Age 45 • Since 2014</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {[
            { label: 'Executive Summary', active: false },
            { label: 'Financial Profile', active: false },
            { label: 'Strategic Objectives', active: true },
            { label: 'Risk Management', active: false },
            { label: 'Capital Mandate', active: false },
            { label: 'Strategic Recommendations', active: false },
            { label: 'Financial Report', active: false },
          ].map((item, idx) => (
            <div key={idx} style={{ 
              padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px',
              background: item.active ? '#F0EBE1' : 'transparent',
              borderRadius: '8px', cursor: 'pointer'
            }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: item.active ? '#B99B6A' : '#D4D4D4' }} />
              <span style={{ fontSize: '13px', color: item.active ? '#B99B6A' : '#737373', fontWeight: item.active ? 600 : 500 }}>{item.label}</span>
            </div>
          ))}
        </nav>

        <div style={{ padding: '24px', borderTop: '1px solid #E6E4DD' }}>
          <p style={{ fontSize: '10px', color: '#A3A3A3', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '16px', fontWeight: 600 }}>Admin</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ width: '12px', height: '12px', border: '2px solid #D4D4D4', borderRadius: '2px' }} />
            <span style={{ fontSize: '13px', color: '#737373', fontWeight: 500 }}>Admin Hub</span>
          </div>
          <div style={{ fontSize: '12px', color: '#A3A3A3', marginBottom: '8px' }}>Brian Chew</div>
          <div style={{ fontSize: '12px', color: '#A3A3A3', cursor: 'pointer' }}>Sign out</div>
        </div>
      </div>

      {/* ─── MAIN CONTENT ─── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        
        {/* HERO BAND */}
        <div style={{ background: '#201E1B', padding: '40px 48px 32px' }}>
          <div>
            <p style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '8px', color: '#B99B6A', fontWeight: 600 }}>Strategic Objectives</p>
            <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '36px', fontWeight: 400, color: '#FFFFFF', margin: 0 }}>
              Needs Discovery
              <span style={{ color: '#B99B6A', margin: '0 16px' }}>—</span>
              <span>{isCouple ? `${safeClientName} & ${safeSpouseName}` : safeClientName}</span>
            </h1>
          </div>
        </div>

        {/* SECTION TABS */}
        <div style={{ background: '#FFFFFF', borderBottom: '1px solid #E6E4DD', padding: '0 48px', display: 'flex', gap: '32px' }}>
          {['WEALTH PROTECTION', 'WEALTH ACCUMULATION', 'RETIREMENT', 'EDUCATION PLANNING', 'ESTATE PLANNING'].map((s, i) => (
            <button
              key={s}
              onClick={() => setActiveSection(i)}
              style={{
                padding: '16px 0', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase',
                fontFamily: 'Inter', fontWeight: 600,
                color: activeSection === i ? '#1A1A1A' : '#A3A3A3', background: 'none', border: 'none',
                borderBottom: activeSection === i ? '2px solid #B99B6A' : '2px solid transparent',
                cursor: 'pointer', transition: 'all 0.2s',
              } as React.CSSProperties}
            >
              {s}
            </button>
          ))}
        </div>

        {/* MAIN LAYOUT */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', flex: 1 }}>

          {/* LEFT: CONTENT */}
          <div style={{ padding: '40px 48px', borderRight: '1px solid #E6E4DD' }}>
            {activeSection === 0 && (
              <WealthProtectionSection
                ff={ff} p={p} updateP={updateP} children={children} isCouple={isCouple}
                clientName={safeClientName} spouseName={safeSpouseName} annExpClient={annExpClient} annExpSpouse={annExpSpouse}
                coverageTerm={coverageTerm} youngestAge={youngestAge} dtpdClient={dtpdClient} dtpdSpouse={dtpdSpouse}
                ciClient={ciClient} ciSpouse={ciSpouse} editModal={editModal} setEditModal={setEditModal}
                WP_TABS={WP_TABS} inflation={inflation} defaultClientPct={defaultClientPct} defaultSpousePct={defaultSpousePct}
              />
            )}
            {activeSection !== 0 && (
              <div className="flex items-center justify-center" style={{ minHeight: 400 }}>
                <div style={{ padding: '32px 48px' }}>
                  <p style={{ color: '#888', fontSize: 14, fontFamily: 'Inter', margin: 0, letterSpacing: '0.05em' }}>
                    {['','Wealth Accumulation','Retirement','Education Planning','Estate Planning'][activeSection]} module is currently in development.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: SIDEBAR */}
          <div style={{ padding: '40px 32px' }}>
            <p style={{ fontSize: '11px', textTransform: 'uppercase', marginBottom: '24px', color: '#B99B6A', fontFamily: 'Inter', letterSpacing: '0.15em', fontWeight: 600 }}>
              COVERAGE SUMMARY
            </p>

            <SidebarSummary
              isCouple={isCouple} clientName={safeClientName} spouseName={safeSpouseName}
              dtpdClient={dtpdClient} dtpdSpouse={dtpdSpouse} ciClient={ciClient} ciSpouse={ciSpouse}
              existingLifeClient={existingLifeClient} existingLifeSpouse={existingLifeSpouse}
              existingCIClient={existingCIClient} existingCISpouse={existingCISpouse}
              lifeGapClient={lifeGapClient} lifeGapSpouse={lifeGapSpouse} ciGapClient={ciGapClient} ciGapSpouse={ciGapSpouse}
            />

            <div style={{ marginTop: '40px' }}>
              <p style={{ fontSize: '11px', textTransform: 'uppercase', marginBottom: '16px', color: '#737373', fontFamily: 'Inter', letterSpacing: '0.15em', fontWeight: 600 }}>EXISTING COVERAGE</p>
              <ExistingCoverInputs p={p} updateP={updateP} isCouple={isCouple} clientName={safeClientName} spouseName={safeSpouseName} />
            </div>
          </div>

        </div>
      </div>

      {/* EDIT MODAL */}
      {editModal.open && (
        <EditSubItemsModal
          category={editModal.category} ff={ff} p={p} updateP={updateP}
          onClose={() => setEditModal({ open: false, category: '' })}
          isCouple={isCouple} clientName={safeClientName} spouseName={safeSpouseName}
        />
      )}
    </div>
  )
}

// ─── WEALTH PROTECTION SECTION ───────────────────────────────────────────────

interface WPProps {
  ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  children: FamilyMember[]; isCouple: boolean; clientName: string; spouseName: string
  annExpClient: number; annExpSpouse: number; coverageTerm: number; youngestAge: number | null
  dtpdClient: CalcResult; dtpdSpouse: CalcResult; ciClient: CalcResult; ciSpouse: CalcResult
  editModal: { open: boolean; category: string }; setEditModal: (v: { open: boolean; category: string }) => void
  WP_TABS: string[]; inflation: number; defaultClientPct: number; defaultSpousePct: number
}

function WealthProtectionSection({ ff, p, updateP, children, isCouple, clientName, spouseName, annExpClient, annExpSpouse, coverageTerm, youngestAge, dtpdClient, dtpdSpouse, ciClient, ciSpouse, editModal, setEditModal, WP_TABS, inflation, defaultClientPct, defaultSpousePct }: WPProps) {
  const wpTab = p.wpSubTab ?? 2 // Defaulting to Education Fund for visual matching
  const cats = p.expenseCategories ?? { financial: true, household: true, personal: true, children: true, lifestyle: true }
  const isDetailed = (p.expenseMode ?? ff.expense_mode ?? 'simple') === 'detailed'
  const mortgages = ff.mortgages ?? []

  return (
    <div>
      {/* Top Header & Toggles */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px', flexWrap: 'wrap', gap: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '2px', height: '20px', background: '#B99B6A' }} />
          <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '24px', fontWeight: 400, color: '#1A1A1A', margin: 0 }}>
            Wealth Protection
          </h2>
        </div>
        
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
          
          {/* Individual / Couple toggle (Segmented Control) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A3A3A3', fontFamily: 'Inter', fontWeight: 600 }}>PLANNING FOR</div>
            <div style={{ display: 'flex', background: '#E6E4DD', borderRadius: '4px', padding: '2px' }}>
              {(['individual', 'couple'] as const).map(t => (
                <button key={t} onClick={() => updateP({ planType: t })}
                  style={{ padding: '4px 12px', fontSize: '11px', fontFamily: 'Inter', fontWeight: 600,
                    background: p.planType === t ? '#1A1A1A' : 'transparent',
                    color: p.planType === t ? '#FFFFFF' : '#737373',
                    border: 'none', borderRadius: '3px', cursor: 'pointer', transition: 'all 0.2s', textTransform: 'capitalize' }}>
                  {t === 'individual' ? 'Client' : 'Couple'}
                </button>
              ))}
            </div>
          </div>

          {/* Simple / Detailed toggle (Segmented Control) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A3A3A3', fontFamily: 'Inter', fontWeight: 600 }}>EXPENSE DATA</div>
            <div style={{ display: 'flex', background: '#E6E4DD', borderRadius: '4px', padding: '2px' }}>
              {(['simple', 'detailed'] as const).map(t => (
                <button key={t} onClick={() => updateP({ expenseMode: t })}
                  style={{ padding: '4px 12px', fontSize: '11px', fontFamily: 'Inter', fontWeight: 600,
                    background: (p.expenseMode ?? ff.expense_mode ?? 'simple') === t ? '#1A1A1A' : 'transparent',
                    color: (p.expenseMode ?? ff.expense_mode ?? 'simple') === t ? '#FFFFFF' : '#737373',
                    border: 'none', borderRadius: '3px', cursor: 'pointer', transition: 'all 0.2s', textTransform: 'capitalize' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Inflation Slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '200px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A3A3A3', fontFamily: 'Inter', fontWeight: 600 }}>INFLATION RATE</div>
            <input type="range" min={0} max={8} step={0.5}
              value={p.inflationRate ?? 3}
              onChange={e => updateP({ inflationRate: parseFloat(e.target.value) })}
              style={{ flex: 1, accentColor: '#B99B6A', height: '4px' }} />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: '#1A1A1A', fontWeight: 600 }}>
              {(p.inflationRate ?? 3).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div style={{ display: 'flex', gap: '24px', marginBottom: '32px', borderBottom: '1px solid #E6E4DD' }}>
        {WP_TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => updateP({ wpSubTab: i })}
            style={{
              padding: '12px 0', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase',
              fontFamily: 'Inter', fontWeight: 600,
              color: wpTab === i ? '#347A5A' : '#A3A3A3',
              background: 'none', border: 'none',
              borderBottom: wpTab === i ? '2px solid #347A5A' : '2px solid transparent',
              cursor: 'pointer', transition: 'all 0.2s',
              whiteSpace: 'nowrap',
            } as React.CSSProperties}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {wpTab === 0 && <FamilyDependencyTab ff={ff} p={p} updateP={updateP} isCouple={isCouple} clientName={clientName} spouseName={spouseName} annExpClient={annExpClient} annExpSpouse={annExpSpouse} coverageTerm={coverageTerm} youngestAge={youngestAge} children={children} isDetailed={isDetailed} cats={cats} editModal={editModal} setEditModal={setEditModal} inflation={inflation} defaultClientPct={defaultClientPct} defaultSpousePct={defaultSpousePct} />}
        {wpTab === 1 && <MortgageDebtTab ff={ff} p={p} updateP={updateP} isCouple={isCouple} clientName={clientName} spouseName={spouseName} mortgages={mortgages} />}
        {wpTab === 2 && <EducationFundTab p={p} updateP={updateP} isCouple={isCouple} clientName={clientName} spouseName={spouseName} children={children} inflation={inflation} />}
        {wpTab === 3 && <CriticalIllnessTab ff={ff} p={p} updateP={updateP} isCouple={isCouple} clientName={clientName} spouseName={spouseName} mortgages={mortgages} ciClient={ciClient} ciSpouse={ciSpouse} children={children} />}
        {wpTab === 4 && <AssetOffsetTab ff={ff} p={p} isCouple={isCouple} clientName={clientName} spouseName={spouseName} dtpdClient={dtpdClient} dtpdSpouse={dtpdSpouse} ciClient={ciClient} ciSpouse={ciSpouse} />}
      </div>
    </div>
  )
}

// ─── FAMILY DEPENDENCY TAB ───────────────────────────────────────────────────

interface FDTProps {
  ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void;
  isCouple: boolean; clientName: string; spouseName: string;
  annExpClient: number; annExpSpouse: number; coverageTerm: number; youngestAge: number | null;
  children: FamilyMember[]; isDetailed: boolean; cats: Record<string, boolean>;
  editModal: { open: boolean; category: string }; setEditModal: (v: { open: boolean; category: string }) => void;
  inflation: number; defaultClientPct: number; defaultSpousePct: number;
}

function FamilyDependencyTab({ ff, p, updateP, isCouple, clientName, spouseName, annExpClient, annExpSpouse, coverageTerm, youngestAge, children, isDetailed, cats, editModal, setEditModal, inflation, defaultClientPct, defaultSpousePct }: FDTProps) {
  const annExpTotal = annExpClient + annExpSpouse

  function toggleCat(cat: string) {
    updateP({ expenseCategories: { ...cats, [cat]: !cats[cat] } })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '32px', border: '1px solid #E6E4DD' }}>
        <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 16px', fontWeight: 600 }}>Expense Categories</h3>
        {isCouple && (
          <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 120px 120px 80px', gap: '12px', padding: '0 16px 8px', borderBottom: '1px solid #F0F0F0', marginBottom: '8px' }}>
            <div />
            <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Category</div>
            <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right', fontWeight: 600 }}>{clientName}</div>
            <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right', fontWeight: 600 }}>{spouseName}</div>
            <div />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {Object.entries(EXPENSE_CATEGORY_LABELS).map(([key, label]) => {
            const simpleMap: Record<string, string[]> = {
              financial: ['s_income_tax','s_insurance','s_regular_savings'],
              household: ['s_housing','s_utilities','s_family_food'],
              personal:  ['s_transport'],
              children:  ['s_children'],
              lifestyle: ['s_lifestyle','s_others'],
            }
            let clientAmt = 0, spouseAmt = 0
            if (isDetailed) {
              clientAmt = getDetailedCategoryTotal(ff, key, 'client', p.expenseSubItems ?? {})
              spouseAmt = getDetailedCategoryTotal(ff, key, 'spouse', p.expenseSubItems ?? {})
            } else {
              clientAmt = (simpleMap[key] ?? []).reduce((s, k) => s + (ff[k] as number || 0), 0)
              spouseAmt = (simpleMap[key] ?? []).map(k => k.replace('s_','s2_')).reduce((s, k) => s + (ff[k] as number || 0), 0)
            }
            const catTotal = clientAmt + spouseAmt
            const clientPct = catTotal > 0 ? Math.round(clientAmt / catTotal * 100) : 0
            const spousePct = catTotal > 0 ? Math.round(spouseAmt / catTotal * 100) : 0

            return (
              <div key={key}
                style={{ display: 'grid',
                  gridTemplateColumns: isCouple ? '24px 1fr 120px 120px 80px' : '24px 1fr 120px 80px',
                  gap: '12px', padding: '16px', alignItems: 'center',
                  borderBottom: '1px solid #F0F0F0',
                  cursor: 'pointer', transition: 'background 0.2s',
                  background: cats[key] ? '#FAFAF9' : 'transparent'
                }}
                onClick={() => toggleCat(key)}
              >
                <div style={{ width: '18px', height: '18px', borderRadius: '4px', flexShrink: 0,
                  background: cats[key] ? '#B99B6A' : '#FFFFFF',
                  border: `1px solid ${cats[key] ? '#B99B6A' : '#D4D4D4'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {cats[key] && <span style={{ color: '#fff', fontSize: '12px', fontWeight: 800 }}>✓</span>}
                </div>
                <span style={{ fontSize: '13px', fontFamily: 'Inter', color: '#1A1A1A', fontWeight: 500 }}>{label}</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: '#1A1A1A' }}>{fmt(clientAmt)}</div>
                  {isCouple && catTotal > 0 && <div style={{ fontSize: '10px', color: '#737373', fontFamily: 'Inter', marginTop: '2px' }}>{clientPct}%</div>}
                </div>
                {isCouple && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: '#1A1A1A' }}>{fmt(spouseAmt)}</div>
                    {catTotal > 0 && <div style={{ fontSize: '10px', color: '#737373', fontFamily: 'Inter', marginTop: '2px' }}>{spousePct}%</div>}
                  </div>
                )}
                <div style={{ textAlign: 'right' }}>
                  {isDetailed && cats[key] && (
                    <button onClick={e => { e.stopPropagation(); setEditModal({ open: true, category: key }) }}
                      style={{ fontSize: '10px', color: '#1A1A1A', background: '#FFFFFF', border: '1px solid #E6E4DD',
                        borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontFamily: 'Inter', fontWeight: 500 }}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: '24px', padding: '20px 24px', background: '#FAFAF9', borderRadius: '8px', border: '1px solid #E6E4DD', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: '#737373', fontFamily: 'Inter', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>Selected Annual Expenses</span>
          {isCouple ? (
            <div style={{ display: 'flex', gap: '32px' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', marginBottom: '4px', fontWeight: 600 }}>{clientName}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(annExpClient)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', marginBottom: '4px', fontWeight: 600 }}>{spouseName}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(annExpSpouse)}</div>
              </div>
            </div>
          ) : (
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(annExpClient)}</span>
          )}
        </div>
      </div>

      {isCouple && (
        <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '32px', border: '1px solid #E6E4DD' }}>
          <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 24px', fontWeight: 600 }}>Coverage Percentage</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
            <PersonSlider label={clientName} value={p.expenseCoverPctClient ?? defaultClientPct} onChange={v => updateP({ expenseCoverPctClient: v })} color="#B99B6A" />
            <PersonSlider label={spouseName} value={p.expenseCoverPctSpouse ?? defaultSpousePct} onChange={v => updateP({ expenseCoverPctSpouse: v })} color="#347A5A" />
          </div>
        </div>
      )}

      <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '32px', border: '1px solid #E6E4DD' }}>
        <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 16px', fontWeight: 600 }}>Coverage Duration</h3>
        {youngestAge !== null ? (
          <div>
            <p style={{ fontSize: '12px', color: '#737373', fontFamily: 'Inter', marginBottom: '20px' }}>
              Coverage term auto-calculated based on youngest child reaching university graduation (age 26).
            </p>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {children.map((c: FamilyMember) => {
                const age = c.age ?? getAge(c.date_of_birth)
                const uniGrad = Math.max(0, 26 - age)
                return (
                  <div key={c.id} style={{ padding: '16px', background: '#FAFAF9', borderRadius: '8px', border: '1px solid #E6E4DD' }}>
                    <div style={{ fontSize: '11px', color: '#1A1A1A', fontFamily: 'Inter', fontWeight: 600, marginBottom: '4px' }}>
                      {c.name || c.relationship}
                    </div>
                    <div style={{ fontSize: '12px', color: '#737373', fontFamily: 'Inter' }}>
                      Age {age} • Grad in {uniGrad} yrs
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: '24px', display: 'inline-flex', alignItems: 'center', gap: '12px', background: '#FAFAF9', padding: '12px 20px', borderRadius: '8px', border: '1px solid #E6E4DD' }}>
              <span style={{ fontSize: '12px', color: '#737373', fontFamily: 'Inter', fontWeight: 500 }}>Final Coverage Term:</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', color: '#1A1A1A', fontWeight: 600 }}>{coverageTerm} years</span>
            </div>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '12px', color: '#737373', fontFamily: 'Inter', marginBottom: '20px' }}>
              Select coverage duration (no children detected).
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[5, 10, 15, 20, 25, 30].map(yr => (
                <button
                  key={yr}
                  onClick={() => updateP({ coverageTermOverride: yr })}
                  style={{
                    padding: '8px 16px', fontFamily: 'Inter', fontSize: '13px', fontWeight: 500,
                    background: (p.coverageTermOverride ?? 20) === yr ? '#1A1A1A' : '#FFFFFF',
                    color: (p.coverageTermOverride ?? 20) === yr ? '#FFFFFF' : '#1A1A1A',
                    border: (p.coverageTermOverride ?? 20) === yr ? '1px solid #1A1A1A' : '1px solid #E6E4DD',
                    borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s'
                  }}
                >
                  {yr} yr
                </button>
              ))}
            </div>
            <div style={{ marginTop: '24px', display: 'inline-flex', alignItems: 'center', gap: '12px', background: '#FAFAF9', padding: '12px 20px', borderRadius: '8px', border: '1px solid #E6E4DD' }}>
              <span style={{ fontSize: '12px', color: '#737373', fontFamily: 'Inter', fontWeight: 500 }}>Coverage Term: </span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', color: '#1A1A1A', fontWeight: 600 }}>{coverageTerm} years</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '0', border: '1px solid #E6E4DD', overflow: 'hidden' }}>
        <NeedTable
          isCouple={isCouple} clientName={clientName} spouseName={spouseName}
          clientData={dtpdFDOnly(annExpClient, p.expenseCoverPctClient ?? defaultClientPct, p.inflationRate ?? 3, coverageTerm)}
          spouseData={dtpdFDOnly(annExpSpouse, p.expenseCoverPctSpouse ?? defaultSpousePct, p.inflationRate ?? 3, coverageTerm)}
          label="D/TPD Family Dependency Need"
        />
      </div>

      <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '32px', border: '1px solid #E6E4DD' }}>
        <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 16px', fontWeight: 600 }}>Advisor Notes</h3>
        <textarea
          value={p.advisorNotes ?? ''}
          onChange={e => updateP({ advisorNotes: e.target.value })}
          placeholder="Document observations, client preferences, or planning considerations..."
          rows={4}
          style={{
            width: '100%', resize: 'vertical', fontFamily: 'Inter', fontSize: '13px',
            color: '#1A1A1A', background: '#FAFAF9', border: '1px solid #E6E4DD',
            borderRadius: '8px', padding: '16px', outline: 'none'
          }}
        />
      </div>
    </div>
  )
}

function dtpdFDOnly(annExp: number, coverPctRaw: number, inflationRaw: number, term: number): number {
  const rate = inflationRaw / 100
  const pct = coverPctRaw / 100
  return fv(rate, term, annExp * pct)
}

// ─── MORTGAGE & DEBT TAB ─────────────────────────────────────────────────────

interface MDProps {
  ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void;
  isCouple: boolean; clientName: string; spouseName: string; mortgages: MortgageProperty[];
}

function MortgageDebtTab({ ff, p, updateP, isCouple, clientName, spouseName, mortgages }: MDProps) {
  if (mortgages.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', background: '#FFFFFF', borderRadius: '12px', border: '1px dashed #D4D4D4' }}>
        <p style={{ color: '#737373', fontSize: '13px', fontFamily: 'Inter' }}>No mortgages found. Add properties in the Financials tab.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {mortgages.map((m: MortgageProperty, i: number) => {
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
          <div key={m.id} style={{ background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E6E4DD', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
              <div>
                <div style={{ fontSize: '16px', fontFamily: 'Inter', fontWeight: 600, color: '#1A1A1A', marginBottom: '6px' }}>{m.label}</div>
                <div style={{ fontSize: '12px', color: '#737373', fontFamily: 'DM Mono, monospace' }}>
                  Outstanding: {fmt(m.outstanding)} <span style={{ color: '#E6E4DD', margin: '0 8px' }}>|</span> {m.interestRate}% <span style={{ color: '#E6E4DD', margin: '0 8px' }}>|</span> {m.remainingTenure} yrs remaining
                </div>
              </div>
            </div>
            
            {isCouple ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', background: '#FAFAF9', borderRadius: '8px', padding: '24px', border: '1px solid #E6E4DD' }}>
                <PersonSlider label={`${clientName} covers`} value={clientPct} onChange={updateClientPct} color="#B99B6A" unit="%" />
                <PersonSlider label={`${spouseName} covers`} value={spousePct} onChange={updateSpousePct} color="#347A5A" unit="%" />
              </div>
            ) : (
              <div style={{ background: '#FAFAF9', borderRadius: '8px', padding: '24px', border: '1px solid #E6E4DD' }}>
                <PersonSlider label="Coverage %" value={clientPct} onChange={updateClientPct} color="#B99B6A" unit="%" />
              </div>
            )}
            
            <div style={{ marginTop: '24px', display: 'flex', gap: '24px', justifyContent: 'flex-end', padding: '16px 20px', background: '#FAFAF9', borderRadius: '8px', border: '1px solid #E6E4DD' }}>
              {isCouple ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '11px', color: '#737373', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{clientName}:</span> <strong style={{ color: '#1A1A1A', fontFamily: 'DM Mono, monospace', fontSize: '14px' }}>{fmt(m.outstanding * clientPct / 100)}</strong></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '11px', color: '#737373', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{spouseName}:</span> <strong style={{ color: '#1A1A1A', fontFamily: 'DM Mono, monospace', fontSize: '14px' }}>{fmt(m.outstanding * spousePct / 100)}</strong></div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '11px', color: '#737373', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Coverage:</span> <strong style={{ color: '#1A1A1A', fontFamily: 'DM Mono, monospace', fontSize: '14px' }}>{fmt(m.outstanding * clientPct / 100)}</strong></div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── EDUCATION FUND TAB ───────────────────────────────────────────────────────

interface EFProps {
  p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void;
  isCouple: boolean; clientName: string; spouseName: string; children: FamilyMember[]; inflation: number;
}

function EducationFundTab({ p, updateP, isCouple, clientName, spouseName, children, inflation }: EFProps) {
  function updateChild(childId: string, changes: any) {
    const arr = [...(p.educationChildren ?? [])]
    const idx = arr.findIndex((e: any) => e.childId === childId)
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], ...changes }
    } else {
      arr.push({ childId, ...changes })
    }
    updateP({ educationChildren: arr })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '24px', background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E6E4DD' }}>
        <Toggle value={p.provideEducationFund ?? false} onChange={v => updateP({ provideEducationFund: v })} />
        <div>
          <div style={{ fontSize: '14px', fontFamily: 'Inter', fontWeight: 600, color: '#1A1A1A' }}>Provide Education Fund</div>
          <div style={{ fontSize: '12px', color: '#737373', fontFamily: 'Inter', marginTop: '4px' }}>Inflation-adjusted university cost projection per child</div>
        </div>
      </div>

      {p.provideEducationFund && (
        <>
          {children.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', background: '#FFFFFF', borderRadius: '12px', border: '1px dashed #D4D4D4' }}>
              <p style={{ color: '#737373', fontSize: '13px', fontFamily: 'Inter' }}>No children found. Add children in the Client Profile.</p>
            </div>
          )}
          {children.map((child: FamilyMember) => {
            const ec = (p.educationChildren ?? []).find((e: any) => e.childId === child.id) ?? { childId: child.id }
            const childAge = child.age ?? getAge(child.date_of_birth)
            const defaultEntryAge = child.gender === 'Male' ? 20 : 18
            const uniEntryAge = ec.uniEntryAge ?? defaultEntryAge
            const yearsToUni = Math.max(0, uniEntryAge - childAge)
            const uniInfo = UNI_COST_DEFAULTS[ec.uniType ?? 'sg_local']
            const baseTuition = ec.annualTuition ?? uniInfo.annual_tuition
            const baseLiving = ec.annualLiving ?? uniInfo.annual_living
            const dur = ec.courseDuration ?? uniInfo.default_duration ?? 4
            const fvTuition = baseTuition * Math.pow(1.05, yearsToUni) * dur
            const fvLiving = baseLiving * Math.pow(1 + inflation, yearsToUni) * dur
            const totalFund = fvTuition + fvLiving

            return (
              <div key={child.id} style={{ background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E6E4DD', padding: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                  <div>
                    <div style={{ fontSize: '16px', fontFamily: 'Inter', fontWeight: 600, color: '#1A1A1A' }}>{child.name || child.relationship}</div>
                    <div style={{ fontSize: '12px', color: '#737373', fontFamily: 'Inter', marginTop: '6px' }}>
                      Age {childAge} - {child.gender || 'Gender not set'} - {yearsToUni > 0 ? `${yearsToUni} yrs to university` : 'University age'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', fontWeight: 600 }}>TOTAL FUND NEEDED</div>
                    <div style={{ fontFamily: 'Inter', fontSize: '24px', color: '#347A5A', fontWeight: 700 }}>{fmt(totalFund)}</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', marginBottom: '24px', borderTop: '1px solid #E6E4DD', borderBottom: '1px solid #E6E4DD', padding: '16px 0' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '9px', color: '#A3A3A3', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', fontWeight: 600 }}>FV TUITION (5%)</div>
                    <div style={{ fontFamily: 'Inter', fontSize: '14px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(fvTuition)}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '9px', color: '#A3A3A3', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', fontWeight: 600 }}>FV LIVING ({(inflation * 100).toFixed(1)}%)</div>
                    <div style={{ fontFamily: 'Inter', fontSize: '14px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(fvLiving)}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '9px', color: '#A3A3A3', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', fontWeight: 600 }}>DURATION</div>
                    <div style={{ fontFamily: 'Inter', fontSize: '14px', color: '#1A1A1A', fontWeight: 600 }}>{dur} yrs</div>
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={labelStyle}>UNIVERSITY TYPE</label>
                  <select
                    value={ec.uniType ?? 'sg_local'}
                    onChange={e => {
                      const uni = e.target.value
                      const info = UNI_COST_DEFAULTS[uni]
                      updateChild(child.id, { uniType: uni, annualTuition: info.annual_tuition, annualLiving: info.annual_living, courseDuration: info.default_duration })
                    }}
                    style={{ width: '100%', padding: '12px 16px', fontFamily: 'Inter', fontSize: '13px', background: '#FFFFFF', border: '1px solid #E6E4DD', borderRadius: '8px', color: '#1A1A1A', outline: 'none' }}
                  >
                    {Object.entries(UNI_COST_DEFAULTS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label} — {fmt(v.annual_tuition + v.annual_living)}/yr</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '20px' }}>
                  <div>
                    <label style={labelStyle}>UNIVERSITY ENTRY AGE</label>
                    <input type="number" min={15} max={25} step={1} value={uniEntryAge} onChange={e => updateChild(child.id, { uniEntryAge: parseInt(e.target.value) })} style={inputStyle} />
                    <div style={{ fontSize: '11px', color: '#A3A3A3', fontFamily: 'Inter', marginTop: '6px' }}>Default: {defaultEntryAge} ({child.gender === 'Female' ? 'Female' : 'Male'})</div>
                  </div>
                  <div>
                    <label style={labelStyle}>COURSE DURATION (YEARS)</label>
                    <input type="number" min={1} max={6} step={1} value={dur} onChange={e => updateChild(child.id, { courseDuration: parseInt(e.target.value) })} style={inputStyle} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: isCouple ? '32px' : 0 }}>
                  <div>
                    <label style={labelStyle}>ANNUAL TUITION (TODAY'S $)</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#1A1A1A', fontFamily: 'Inter', fontSize: '13px', fontWeight: 500 }}>$</span>
                      <input type="number" min={0} step={500} value={baseTuition} onChange={e => updateChild(child.id, { annualTuition: parseInt(e.target.value) })} style={{ ...inputStyle, paddingLeft: '32px' }} />
                    </div>
                    <div style={{ fontSize: '11px', color: '#A3A3A3', fontFamily: 'Inter', marginTop: '6px' }}>Inflated at 5% p.a.</div>
                  </div>
                  <div>
                    <label style={labelStyle}>ANNUAL LIVING (TODAY'S $)</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#1A1A1A', fontFamily: 'Inter', fontSize: '13px', fontWeight: 500 }}>$</span>
                      <input type="number" min={0} step={500} value={baseLiving} onChange={e => updateChild(child.id, { annualLiving: parseInt(e.target.value) })} style={{ ...inputStyle, paddingLeft: '32px' }} />
                    </div>
                    <div style={{ fontSize: '11px', color: '#A3A3A3', fontFamily: 'Inter', marginTop: '6px' }}>Inflated at {(inflation * 100).toFixed(1)}% p.a.</div>
                  </div>
                </div>

                {isCouple && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', paddingTop: '24px', borderTop: '2px solid #347A5A' }}>
                    <PersonSlider label={`${clientName} COVERS`} value={ec.coverPctClient ?? 50} onChange={v => updateChild(child.id, { coverPctClient: v })} color="#347A5A" unit="%" />
                    <PersonSlider label={`${spouseName} COVERS`} value={ec.coverPctSpouse ?? 50} onChange={v => updateChild(child.id, { coverPctSpouse: v })} color="#347A5A" unit="%" />
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

interface CIProps {
  ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void;
  isCouple: boolean; clientName: string; spouseName: string; mortgages: MortgageProperty[];
  ciClient: CalcResult; ciSpouse: CalcResult; children: FamilyMember[];
}

function CriticalIllnessTab({ ff, p, updateP, isCouple, clientName, spouseName, mortgages, ciClient, ciSpouse, children }: CIProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '32px', border: '1px solid #E6E4DD' }}>
        <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 16px', fontWeight: 600 }}>Critical Illness Stage</h3>
        <div style={{ display: 'flex', background: '#E6E4DD', borderRadius: '6px', padding: '3px', width: 'fit-content', marginBottom: '16px' }}>
          {([
            { key: 'early_late', label: 'Early & Late Stage' },
            { key: 'late_only', label: 'Late Stage Only' },
          ] as const).map(opt => (
            <button
              key={opt.key}
              onClick={() => updateP({ ciStage: opt.key })}
              style={{
                padding: '8px 16px', fontFamily: 'Inter', fontSize: '12px', fontWeight: 600,
                background: p.ciStage === opt.key ? '#1A1A1A' : 'transparent',
                color: p.ciStage === opt.key ? '#FFFFFF' : '#737373',
                border: 'none', borderRadius: '4px', cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: '12px', color: '#737373', fontFamily: 'Inter', margin: 0 }}>
          {p.ciStage === 'early_late' ? 'Calculates coverage need for both early and late stage critical illnesses.' : 'Calculates coverage need for late stage critical illnesses only.'}
        </p>
      </div>

      <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '32px', border: '1px solid #E6E4DD' }}>
        <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 16px', fontWeight: 600 }}>CI Coverage Window</h3>
        <p style={{ fontSize: '12px', color: '#737373', fontFamily: 'Inter', marginBottom: '24px' }}>
          How many years of income replacement / expenses should be provided during a critical illness recovery event?
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', background: '#FAFAF9', padding: '16px 24px', borderRadius: '8px', border: '1px solid #E6E4DD' }}>
          <input type="range" min={1} max={10} step={1} value={p.ciYears ?? 5} onChange={e => updateP({ ciYears: parseInt(e.target.value) })} style={{ flex: 1, accentColor: '#B99B6A' }} />
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', color: '#1A1A1A', minWidth: '80px', fontWeight: 600 }}>
            {p.ciYears ?? 5} years
          </span>
        </div>
      </div>

      {mortgages.length > 0 && (
        <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '32px', border: '1px solid #E6E4DD' }}>
          <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 16px', fontWeight: 600 }}>Mortgage During CI</h3>
          <p style={{ fontSize: '12px', color: '#737373', fontFamily: 'Inter', marginBottom: '24px' }}>
            What percentage of the monthly mortgage repayments should be covered during the CI recovery window?
          </p>
          {isCouple ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', background: '#FAFAF9', padding: '24px 32px', borderRadius: '8px', border: '1px solid #E6E4DD' }}>
              <PersonSlider label={clientName} value={p.ciMortgagePctClient ?? 100} onChange={v => updateP({ ciMortgagePctClient: v })} color="#B99B6A" unit="%" />
              <PersonSlider label={spouseName} value={p.ciMortgagePctSpouse ?? 100} onChange={v => updateP({ ciMortgagePctSpouse: v })} color="#B99B6A" unit="%" />
            </div>
          ) : (
            <div style={{ background: '#FAFAF9', padding: '24px 32px', borderRadius: '8px', border: '1px solid #E6E4DD' }}>
              <PersonSlider label="Coverage %" value={p.ciMortgagePctClient ?? 100} onChange={v => updateP({ ciMortgagePctClient: v })} color="#B99B6A" unit="%" />
            </div>
          )}
        </div>
      )}

      {p.provideEducationFund && children.length > 0 && (
        <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '24px', border: '1px solid #E6E4DD' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <Toggle value={p.includeEduInCI ?? false} onChange={v => updateP({ includeEduInCI: v })} />
            <span style={{ fontSize: '13px', fontFamily: 'Inter', color: '#1A1A1A', fontWeight: 500 }}>Include education fund targets in CI gap calculation</span>
          </div>
        </div>
      )}

      <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '0', border: '1px solid #E6E4DD', overflow: 'hidden' }}>
        <NeedTable
          isCouple={isCouple} clientName={clientName} spouseName={spouseName}
          clientData={ciClient.gross} spouseData={ciSpouse.gross}
          label="CI Cover Needed" breakdown={{
            client: { fd: ciClient.fd, mort: ciClient.mort, edu: ciClient.edu },
            spouse: { fd: ciSpouse.fd, mort: ciSpouse.mort, edu: ciSpouse.edu },
          }}
        />
      </div>
    </div>
  )
}

// ─── ASSET OFFSET TAB ────────────────────────────────────────────────────────

interface AOProps {
  ff: FactFinding; p: ProtectionData; isCouple: boolean; clientName: string; spouseName: string;
  dtpdClient: CalcResult; dtpdSpouse: CalcResult; ciClient: CalcResult; ciSpouse: CalcResult;
}

function AssetOffsetTab({ ff, p, isCouple, clientName, spouseName, dtpdClient, dtpdSpouse, ciClient, ciSpouse }: AOProps) {
  function AssetRow({ label, clientVal, spouseVal }: { label: string; clientVal: number; spouseVal: number }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #F0F0F0' }}>
        <span style={{ flex: 1, fontSize: '13px', fontFamily: 'Inter', color: '#1A1A1A', fontWeight: 500 }}>{label}</span>
        {isCouple ? (
          <>
            <span style={{ width: '140px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: '13px', color: '#1A1A1A' }}>{fmt(clientVal)}</span>
            <span style={{ width: '140px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: '13px', color: '#1A1A1A' }}>{fmt(spouseVal)}</span>
          </>
        ) : (
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: '#1A1A1A' }}>{fmt(clientVal)}</span>
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
    <span style={{ width: '140px', textAlign: 'right', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A3A3A3', fontFamily: 'Inter', fontWeight: 600 }}>{name}</span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <p style={{ fontSize: '13px', color: '#737373', fontFamily: 'Inter', lineHeight: 1.5, margin: 0 }}>
        Assets are automatically offset against coverage needs. D/TPD offsets include CPF and investment properties. CI offsets use only liquid assets.
      </p>

      <div style={{ background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E6E4DD', overflow: 'hidden' }}>
        <div style={{ padding: '24px 24px 16px' }}>
          <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: 0, fontWeight: 600 }}>Asset Values</h3>
        </div>
        {isCouple && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 0, marginBottom: '8px', padding: '0 24px' }}>
            {colHeader(clientName)}
            {colHeader(spouseName)}
          </div>
        )}
        <div style={{ borderTop: '1px solid #F0F0F0' }}>
          <AssetRow label="Cash & Liquid Investments" clientVal={clientLiquid} spouseVal={spouseLiquid} />
          <AssetRow label="CPF (OA + SA + MA + RA)" clientVal={clientCPF} spouseVal={spouseCPF} />
          <AssetRow label="Investment Properties" clientVal={clientInvProp} spouseVal={spouseInvProp} />
          
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 24px', background: '#FAFAF9', borderBottom: '1px solid #F0F0F0' }}>
            <span style={{ flex: 1, fontSize: '12px', fontFamily: 'Inter', fontWeight: 600, color: '#1A1A1A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>D/TPD Offset (all assets)</span>
            {isCouple ? (
              <>
                <span style={{ width: '140px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: '14px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(clientLiquid + clientCPF + clientInvProp)}</span>
                <span style={{ width: '140px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: '14px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(spouseLiquid + spouseCPF + spouseInvProp)}</span>
              </>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(clientLiquid + clientCPF + clientInvProp)}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 24px', background: '#FAFAF9' }}>
            <span style={{ flex: 1, fontSize: '12px', fontFamily: 'Inter', fontWeight: 600, color: '#1A1A1A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>CI Offset (liquid only)</span>
            {isCouple ? (
              <>
                <span style={{ width: '140px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: '14px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(clientLiquid)}</span>
                <span style={{ width: '140px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: '14px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(spouseLiquid)}</span>
              </>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(clientLiquid)}</span>
            )}
          </div>
        </div>
      </div>

      <div style={{ background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E6E4DD', overflow: 'hidden' }}>
        <div style={{ padding: '24px 24px 16px' }}>
          <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: 0, fontWeight: 600 }}>Net Need After Offset</h3>
        </div>
        <div style={{ borderTop: '1px solid #F0F0F0' }}>
          {[
            { label: 'D/TPD Net Need', clientNet: dtpdClient.net, spouseNet: dtpdSpouse.net },
            { label: 'CI Net Need', clientNet: ciClient.net, spouseNet: ciSpouse.net },
          ].map((row, i) => (
            <div key={row.label} style={{ display: 'flex', alignItems: 'center', padding: '24px', borderBottom: i === 0 ? '1px solid #F0F0F0' : 'none' }}>
              <span style={{ flex: 1, fontSize: '12px', color: '#737373', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>{row.label}</span>
              {isCouple ? (
                <>
                  <div style={{ textAlign: 'right', minWidth: '140px' }}>
                    <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', marginBottom: '6px', letterSpacing: '0.05em', fontWeight: 600 }}>{clientName}</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#D32F2F', fontWeight: 600 }}>{fmt(row.clientNet)}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: '140px' }}>
                    <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', marginBottom: '6px', letterSpacing: '0.05em', fontWeight: 600 }}>{spouseName}</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#D32F2F', fontWeight: 600 }}>{fmt(row.spouseNet)}</div>
                  </div>
                </>
              ) : (
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#D32F2F', fontWeight: 600 }}>{fmt(row.clientNet)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── SIDEBAR SUMMARY ─────────────────────────────────────────────────────────

interface SidebarProps {
  isCouple: boolean; clientName: string; spouseName: string;
  dtpdClient: CalcResult; dtpdSpouse: CalcResult; ciClient: CalcResult; ciSpouse: CalcResult;
  existingLifeClient: number; existingLifeSpouse: number; existingCIClient: number; existingCISpouse: number;
  lifeGapClient: number; lifeGapSpouse: number; ciGapClient: number; ciGapSpouse: number;
}

function SidebarSummary({ isCouple, clientName, spouseName, dtpdClient, dtpdSpouse, ciClient, ciSpouse, existingLifeClient, existingLifeSpouse, existingCIClient, existingCISpouse, lifeGapClient, lifeGapSpouse, ciGapClient, ciGapSpouse }: SidebarProps) {
  function PersonBlock({ name, dtpd, ci, existLife, existCI, lifeGap, ciGap }: { name: string; dtpd: CalcResult; ci: CalcResult; existLife: number; existCI: number; lifeGap: number; ciGap: number }) {
    return (
      <div style={{ background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E6E4DD', padding: '24px', marginBottom: '24px' }}>
        <div style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#B99B6A', fontFamily: 'Inter', marginBottom: '20px', fontWeight: 600 }}>{name}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <SidebarRow label="D/TPD Need" value={dtpd.net} />
          <SidebarRow label="CI Need" value={ci.net} />
          
          <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: '12px', marginTop: '4px' }}>
            <SidebarRow label="Existing Life" value={existLife} color="#347A5A" />
            <SidebarRow label="Existing CI" value={existCI} color="#347A5A" />
          </div>
          
          <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: '12px', marginTop: '4px' }}>
            <SidebarRow label="Life Gap" value={lifeGap} color={lifeGap > 0 ? '#D32F2F' : '#347A5A'} />
            <SidebarRow label="CI Gap" value={ciGap} color={ciGap > 0 ? '#D32F2F' : '#347A5A'} />
          </div>
          
          <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: '16px', marginTop: '8px', display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
            <MiniBreakdown label="FD" value={dtpd.fd} />
            <MiniBreakdown label="MORT" value={dtpd.mort} />
            <MiniBreakdown label="EDU" value={dtpd.edu} />
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
      <span style={{ fontSize: '12px', color: '#737373', fontFamily: 'Inter', fontWeight: 500 }}>{label}</span>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: color ?? '#1A1A1A', fontWeight: 600 }}>{fmt(value)}</span>
    </div>
  )
}

function MiniBreakdown({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '9px', color: '#A3A3A3', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: '#1A1A1A', marginTop: '6px', fontWeight: 500 }}>{fmt(value)}</div>
    </div>
  )
}

// ─── EXISTING COVER INPUTS ───────────────────────────────────────────────────

interface ExistingCoverProps {
  p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void; isCouple: boolean; clientName: string; spouseName: string;
}

function ExistingCoverInputs({ p, updateP, isCouple, clientName, spouseName }: ExistingCoverProps) {
  const fields = [
    { key: 'existingLifeCoverClient', label: `${clientName} — Life`, person: 'client' },
    { key: 'existingCICoverClient', label: `${clientName} — CI`, person: 'client' },
    ...(isCouple ? [
      { key: 'existingLifeCoverSpouse', label: `${spouseName} — Life`, person: 'spouse' },
      { key: 'existingCICoverSpouse', label: `${spouseName} — CI`, person: 'spouse' },
    ] : []),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {fields.map(f => (
        <div key={f.key}>
          <label style={{ display: 'block', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#A3A3A3', fontFamily: 'Inter', marginBottom: '8px', fontWeight: 600 }}>{f.label}</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#1A1A1A', fontFamily: 'Inter', fontSize: '13px', fontWeight: 500 }}>$</span>
            <input
              type="number" min={0}
              value={(p[f.key as keyof ProtectionData] as number) ?? 0}
              onChange={e => updateP({ [f.key]: parseInt(e.target.value) || 0 })}
              style={{ ...inputStyle, paddingLeft: '32px', width: '100%', background: '#F9F8F4' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── EDIT SUB-ITEMS MODAL ────────────────────────────────────────────────────

interface EditSubProps {
  category: string; ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void;
  onClose: () => void; isCouple: boolean; clientName: string; spouseName: string;
}

function EditSubItemsModal({ category, ff, p, updateP, onClose, isCouple, clientName, spouseName }: EditSubProps) {
  const subItems = p.expenseSubItems ?? {}
  const keys = DETAILED_EXPENSE_MAP[category] ?? []

  function isClientIncluded(key: string) { return subItems[key+'_c'] !== false }
  function isSpouseIncluded(key: string) { return subItems[key+'_s'] !== false }
  function toggleClient(key: string) { updateP({ expenseSubItems: { ...subItems, [key+'_c']: !isClientIncluded(key) } }) }
  function toggleSpouse(key: string) { updateP({ expenseSubItems: { ...subItems, [key+'_s']: !isSpouseIncluded(key) } }) }
  function toggleItem(key: string) {
    const cur = subItems[key] !== false
    updateP({ expenseSubItems: { ...subItems, [key]: !cur } })
  }

  const selectedClientTotal = keys.filter(k => isCouple ? isClientIncluded(k) : subItems[k] !== false).reduce((s, k) => s + (ff[k] as number || 0), 0)
  const selectedSpouseTotal = keys.filter(k => isSpouseIncluded(k)).reduce((s, k) => s + (ff[k.replace('d_','d2_')] as number || 0), 0)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(32, 30, 27, 0.6)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '40px', minWidth: '520px', maxWidth: '640px', border: '1px solid #E6E4DD', boxShadow: '0 24px 80px rgba(0,0,0,0.1)', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '24px', fontWeight: 400, color: '#1A1A1A', margin: 0 }}>
            {EXPENSE_CATEGORY_LABELS[category]}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '28px', color: '#A3A3A3', lineHeight: 1, padding: '0 8px' }}>×</button>
        </div>
        <p style={{ fontSize: '13px', color: '#737373', fontFamily: 'Inter', marginBottom: '32px' }}>
          {isCouple ? 'Tick under each person to include that expense in their protection calculation.' : 'Select which line items to include in the protection calculation.'}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 120px 120px' : '1fr 32px 120px', gap: '12px', padding: '0 16px 12px', borderBottom: '1px solid #E6E4DD', marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Item</div>
          <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', fontWeight: 600 }}>{clientName}</div>
          {isCouple && <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', fontWeight: 600 }}>{spouseName}</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {keys.map(key => {
            const clientVal = (ff[key] as number || 0)
            const spouseKey = key.replace('d_', 'd2_')
            const spouseVal = (ff[spouseKey] as number || 0)
            const total = clientVal + spouseVal
            const clientPct = total > 0 ? Math.round(clientVal / total * 100) : 0
            const spousePct = total > 0 ? Math.round(spouseVal / total * 100) : 0
            const clientOn = isCouple ? isClientIncluded(key) : subItems[key] !== false
            const spouseOn = isSpouseIncluded(key)
            const rowActive = isCouple ? (clientOn || spouseOn) : clientOn

            return (
              <div key={key}
                style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 120px 120px' : '1fr 32px 120px',
                  gap: '12px', padding: '16px', borderRadius: '8px',
                  background: rowActive ? '#FAFAF9' : 'transparent', alignItems: 'center',
                  borderBottom: '1px solid #F0F0F0', transition: 'all 0.2s' }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontFamily: 'Inter', color: '#1A1A1A', marginBottom: '6px', fontWeight: 500 }}>{DETAILED_EXPENSE_LABELS[key]}</div>
                  {total > 0 && (
                    <div style={{ fontSize: '12px', color: '#737373', fontFamily: 'DM Mono, monospace' }}>
                      {isCouple
                        ? `${fmt(clientVal)} (${clientPct}%) · ${fmt(spouseVal)} (${spousePct}%)`
                        : `${fmt(clientVal)}/yr`}
                    </div>
                  )}
                </div>

                {isCouple ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }} onClick={() => toggleClient(key)}>
                    <div style={{ width: '20px', height: '20px', borderRadius: '4px', cursor: 'pointer',
                      background: clientOn ? '#B99B6A' : '#FFFFFF',
                      border: `1px solid ${clientOn ? '#B99B6A' : '#D4D4D4'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                      {clientOn && <span style={{ color: '#fff', fontSize: '12px', lineHeight: 1, fontWeight: 800 }}>✓</span>}
                    </div>
                    {clientVal > 0 && <div style={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', color: '#1A1A1A', fontWeight: 500 }}>{fmt(clientVal)}</div>}
                  </div>
                ) : (
                  <div style={{ width: '20px', height: '20px', borderRadius: '4px', cursor: 'pointer', margin: '0 auto',
                    background: clientOn ? '#B99B6A' : '#FFFFFF',
                    border: `1px solid ${clientOn ? '#B99B6A' : '#D4D4D4'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                    onClick={() => toggleItem(key)}>
                    {clientOn && <span style={{ color: '#fff', fontSize: '12px', lineHeight: 1, fontWeight: 800 }}>✓</span>}
                  </div>
                )}

                {isCouple && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }} onClick={() => toggleSpouse(key)}>
                    <div style={{ width: '20px', height: '20px', borderRadius: '4px', cursor: 'pointer',
                      background: spouseOn ? '#347A5A' : '#FFFFFF',
                      border: `1px solid ${spouseOn ? '#347A5A' : '#D4D4D4'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                      {spouseOn && <span style={{ color: '#fff', fontSize: '12px', lineHeight: 1, fontWeight: 800 }}>✓</span>}
                    </div>
                    {spouseVal > 0 && <div style={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', color: '#1A1A1A', fontWeight: 500 }}>{fmt(spouseVal)}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: '32px', padding: '24px', background: '#FAFAF9', borderRadius: '8px', border: '1px solid #E6E4DD' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#737373', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Selected Total</span>
            {isCouple ? (
              <div style={{ display: 'flex', gap: '32px' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', marginBottom: '4px', fontWeight: 600 }}>{clientName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(selectedClientTotal)}/yr</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', marginBottom: '4px', fontWeight: 600 }}>{spouseName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(selectedSpouseTotal)}/yr</div>
                </div>
              </div>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(selectedClientTotal)}/yr</span>
            )}
          </div>
        </div>

        <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '12px 32px', background: '#1A1A1A', color: '#FFFFFF', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'Inter', fontSize: '14px', fontWeight: 500 }}>
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
    <div style={{ marginBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <div style={{ width: '2px', height: '16px', background: color }} />
        <span style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: 'Inter', fontWeight: 600, color: '#A3A3A3' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function PersonSlider({ label, value, onChange, color, unit = '%' }: { label: string; value: number; onChange: (v: number) => void; color: string; unit?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A3A3A3', fontFamily: 'Inter', fontWeight: 600 }}>{label}</span>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: '#1A1A1A', fontWeight: 600 }}>
          {Math.round(value)}{unit}
        </span>
      </div>
      <input
        type="range" min={0} max={100} step={5} value={value} onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: color, height: '4px' }}
      />
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div onClick={() => onChange(!value)}
      style={{
        width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer', transition: 'background 0.2s',
        background: value ? '#B99B6A' : '#D4D4D4', position: 'relative', flexShrink: 0
      }}
    >
      <div style={{
        position: 'absolute', top: '2px', left: value ? '22px' : '2px', width: '20px', height: '20px',
        borderRadius: '50%', background: '#FFFFFF', transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }} />
    </div>
  )
}

interface NeedTableProps {
  isCouple: boolean; clientName: string; spouseName: string; clientData: number; spouseData: number; label: string;
  breakdown?: { client: { fd: number; mort: number; edu: number }; spouse: { fd: number; mort: number; edu: number } }
}

function NeedTable({ isCouple, clientName, spouseName, clientData, spouseData, label, breakdown }: NeedTableProps) {
  return (
    <div>
      <div style={{ display: 'flex', padding: '24px 32px', background: '#FFFFFF', borderBottom: breakdown ? '1px solid #E6E4DD' : 'none', alignItems: 'center' }}>
        <span style={{ flex: 1, fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', fontWeight: 600 }}>{label}</span>
        {isCouple ? (
          <>
            <div style={{ textAlign: 'right', minWidth: '140px' }}>
              <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', marginBottom: '6px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>{clientName}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '20px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(clientData)}</div>
            </div>
            <div style={{ textAlign: 'right', minWidth: '140px' }}>
              <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', marginBottom: '6px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>{spouseName}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '20px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(spouseData)}</div>
            </div>
          </>
        ) : (
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '20px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(clientData)}</span>
        )}
      </div>
      {breakdown && (
        <div style={{ display: 'flex', gap: 0, background: '#FAFAF9' }}>
          {(['fd', 'mort', 'edu'] as const).map((key, i) => {
            const labels = { fd: 'Family Dep.', mort: 'Mortgage', edu: 'Education' }
            return (
              <div key={key} style={{ flex: 1, padding: '16px 32px', borderRight: i !== 2 ? '1px solid #E6E4DD' : 'none' }}>
                <div style={{ fontSize: '10px', color: '#A3A3A3', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', fontWeight: 600 }}>{labels[key]}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(breakdown.client[key])}</div>
                {isCouple && <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: '#737373', marginTop: '6px' }}>{fmt(breakdown.spouse[key])}</div>}
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
  display: 'block', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase',
  color: '#A3A3A3', fontFamily: 'Inter', marginBottom: '12px', fontWeight: 600
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px', fontFamily: 'Inter', fontSize: '13px',
  color: '#1A1A1A', background: '#FFFFFF', border: '1px solid #E6E4DD',
  borderRadius: '8px', outline: 'none'
}
