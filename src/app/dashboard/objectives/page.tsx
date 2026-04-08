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
      // Check per-person toggle first (key_c or key_s), fall back to shared toggle (key)
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
    planType: 'individual',
    expenseMode: 'simple',
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

  const WP_TABS = ['Family Dependency', 'Mortgage & Debt', 'Education Fund', 'Critical Illness', 'Asset Offset']

  // ─── RENDER ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'linear-gradient(135deg, #F8F6F0 0%, #EAE5D9 100%)' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#A8834A', borderTopColor: 'transparent' }} />
          <p className="text-xs tracking-widest uppercase" style={{ color: '#A8834A', fontFamily: 'Inter, sans-serif' }}>Loading</p>
        </div>
      </div>
    )
  }

  if (!clientId) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'linear-gradient(135deg, #F8F6F0 0%, #EAE5D9 100%)' }}>
        <div className="text-center">
          <p style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: '#1C1A17', marginBottom: 8 }}>No Client Selected</p>
          <p className="text-xs tracking-widest uppercase" style={{ color: '#A8834A', fontFamily: 'Inter, sans-serif' }}>Please select a client from the dashboard</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #F8F6F0 0%, #EAE5D9 100%)', fontFamily: 'Inter, sans-serif' }}>

      {/* HERO BAND */}
      <div style={{ background: 'rgba(28, 26, 23, 0.85)', backdropFilter: 'blur(24px)', padding: '36px 48px 32px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#c8a96e', fontFamily: 'Inter', fontWeight: 500 }}>Strategic Objectives</p>
            <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 36, fontWeight: 300, color: '#F5F0E8', letterSpacing: '0.02em', margin: 0 }}>
              Needs Discovery
              <span style={{ color: '#A8834A', margin: '0 16px' }}>—</span>
              <span>{isCouple ? `${clientName} & ${spouseName}` : clientName}</span>
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12 }}>
            {saving && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: 'Inter' }}>Saving changes…</span>}
            {saved && !saving && <span style={{ fontSize: 12, color: '#A8834A', fontFamily: 'Inter' }}>✓ All saved</span>}
          </div>
        </div>
      </div>

      {/* SECTION TABS */}
      <div style={{ background: 'rgba(255, 255, 255, 0.6)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.8)', padding: '0 40px', display: 'flex', gap: 8, boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
        {['Wealth Protection', 'Wealth Accumulation', 'Retirement', 'Education Planning', 'Estate Planning'].map((s, i) => (
          <button
            key={s}
            onClick={() => setActiveSection(i)}
            style={{
              padding: '16px 20px', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
              fontFamily: 'Inter', fontWeight: 600,
              color: activeSection === i ? '#1C1A17' : '#888', background: 'none', border: 'none',
              borderBottom: activeSection === i ? '2px solid #A8834A' : '2px solid transparent',
              cursor: 'pointer', transition: 'all 0.2s',
            } as React.CSSProperties}
          >
            {s}
          </button>
        ))}
      </div>

      {/* MAIN LAYOUT */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 0, minHeight: 'calc(100vh - 160px)' }}>

        {/* LEFT: CONTENT */}
        <div style={{ padding: '40px 48px', borderRight: '1px solid rgba(255, 255, 255, 0.5)' }}>
          {activeSection === 0 && (
            <WealthProtectionSection
              ff={ff} p={p} updateP={updateP} children={children} isCouple={isCouple}
              clientName={clientName} spouseName={spouseName} annExpClient={annExpClient} annExpSpouse={annExpSpouse}
              coverageTerm={coverageTerm} youngestAge={youngestAge} dtpdClient={dtpdClient} dtpdSpouse={dtpdSpouse}
              ciClient={ciClient} ciSpouse={ciSpouse} editModal={editModal} setEditModal={setEditModal}
              WP_TABS={WP_TABS} inflation={inflation} defaultClientPct={defaultClientPct} defaultSpousePct={defaultSpousePct}
            />
          )}
          {activeSection !== 0 && (
            <div className="flex items-center justify-center" style={{ minHeight: 400 }}>
              <div style={{ padding: '32px 48px', background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(16px)', borderRadius: 24, border: '1px solid rgba(255,255,255,0.8)' }}>
                <p style={{ color: '#888', fontSize: 14, fontFamily: 'Inter', margin: 0, letterSpacing: '0.05em' }}>
                  {['','Wealth Accumulation','Retirement','Education Planning','Estate Planning'][activeSection]} module is currently in development.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: SIDEBAR */}
        <div style={{ padding: '40px 32px', background: 'rgba(255, 255, 255, 0.4)', backdropFilter: 'blur(32px)' }}>
          <p className="text-xs tracking-widest uppercase mb-6" style={{ color: '#A8834A', fontFamily: 'Inter', letterSpacing: '0.15em', fontWeight: 600 }}>
            Coverage Summary
          </p>

          <SidebarSummary
            isCouple={isCouple} clientName={clientName} spouseName={spouseName}
            dtpdClient={dtpdClient} dtpdSpouse={dtpdSpouse} ciClient={ciClient} ciSpouse={ciSpouse}
            existingLifeClient={existingLifeClient} existingLifeSpouse={existingLifeSpouse}
            existingCIClient={existingCIClient} existingCISpouse={existingCISpouse}
            lifeGapClient={lifeGapClient} lifeGapSpouse={lifeGapSpouse} ciGapClient={ciGapClient} ciGapSpouse={ciGapSpouse}
          />

          <div style={{ marginTop: 32 }}>
            <p className="text-xs tracking-widest uppercase mb-4" style={{ color: '#888', fontFamily: 'Inter', letterSpacing: '0.15em', fontWeight: 600 }}>Existing Coverage</p>
            <ExistingCoverInputs p={p} updateP={updateP} isCouple={isCouple} clientName={clientName} spouseName={spouseName} />
          </div>
        </div>

      </div>

      {/* EDIT MODAL */}
      {editModal.open && (
        <EditSubItemsModal
          category={editModal.category} ff={ff} p={p} updateP={updateP}
          onClose={() => setEditModal({ open: false, category: '' })}
          isCouple={isCouple} clientName={clientName} spouseName={spouseName}
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

type CalcResult = { gross: number; assets: number; net: number; fd: number; mort: number; edu: number }

function WealthProtectionSection({ ff, p, updateP, children, isCouple, clientName, spouseName, annExpClient, annExpSpouse, coverageTerm, youngestAge, dtpdClient, dtpdSpouse, ciClient, ciSpouse, editModal, setEditModal, WP_TABS, inflation, defaultClientPct, defaultSpousePct }: WPProps) {
  const wpTab = p.wpSubTab ?? 0
  const cats = p.expenseCategories ?? { financial: true, household: true, personal: true, children: true, lifestyle: true }
  const isDetailed = (p.expenseMode ?? ff.expense_mode ?? 'simple') === 'detailed'
  const mortgages = ff.mortgages ?? []

  return (
    <div>
      {/* Top Header & Toggles */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32, flexWrap: 'wrap', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 4, height: 28, background: '#A8834A', borderRadius: 4 }} />
          <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 26, fontWeight: 400, color: '#1C1A17', margin: 0 }}>
            Wealth Protection
          </h2>
        </div>
        
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          
          {/* Individual / Couple toggle (Segmented Control) */}
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#888', fontFamily: 'Inter', marginBottom: 8, fontWeight: 500 }}>Planning For</div>
            <div style={{ position: 'relative', display: 'flex', width: 220, background: 'rgba(0, 0, 0, 0.04)', backdropFilter: 'blur(12px)', borderRadius: 20, padding: 4, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.05)' }}>
              {/* Sliding Pill */}
              <div style={{
                position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc(50% - 4px)',
                transform: p.planType === 'couple' ? 'translateX(100%)' : 'translateX(0)',
                background: '#1C1A17', borderRadius: 16,
                transition: 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)', pointerEvents: 'none'
              }} />
              {(['individual', 'couple'] as const).map(t => (
                <button key={t} onClick={() => updateP({ planType: t })}
                  style={{ flex: 1, padding: '8px 12px', fontSize: 12, fontFamily: 'Inter', fontWeight: 500,
                    background: 'transparent', color: p.planType === t ? '#fff' : '#666',
                    position: 'relative', zIndex: 1, border: 'none', borderRadius: 16, cursor: 'pointer',
                    transition: 'color 0.3s ease', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t === 'individual' ? clientName : 'Couple'}
                </button>
              ))}
            </div>
          </div>

          {/* Simple / Detailed toggle (Segmented Control) */}
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#888', fontFamily: 'Inter', marginBottom: 8, fontWeight: 500 }}>Expense Data</div>
            <div style={{ position: 'relative', display: 'flex', width: 160, background: 'rgba(0, 0, 0, 0.04)', backdropFilter: 'blur(12px)', borderRadius: 20, padding: 4, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.05)' }}>
              {/* Sliding Pill */}
              <div style={{
                position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc(50% - 4px)',
                transform: (p.expenseMode ?? ff.expense_mode ?? 'simple') === 'detailed' ? 'translateX(100%)' : 'translateX(0)',
                background: '#1C1A17', borderRadius: 16,
                transition: 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)', pointerEvents: 'none'
              }} />
              {(['simple', 'detailed'] as const).map(t => (
                <button key={t} onClick={() => updateP({ expenseMode: t })}
                  style={{ flex: 1, padding: '8px 0', fontSize: 12, fontFamily: 'Inter', fontWeight: 500,
                    background: 'transparent', color: (p.expenseMode ?? ff.expense_mode ?? 'simple') === t ? '#fff' : '#666',
                    position: 'relative', zIndex: 1, border: 'none', borderRadius: 16, cursor: 'pointer',
                    transition: 'color 0.3s ease', textTransform: 'capitalize' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Inflation Slider */}
          <div style={{ minWidth: 180 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#888', fontFamily: 'Inter', marginBottom: 8, fontWeight: 500 }}>Inflation Rate</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={0} max={8} step={0.5}
                value={p.inflationRate ?? 3}
                onChange={e => updateP({ inflationRate: parseFloat(e.target.value) })}
                style={{ flex: 1, accentColor: '#A8834A' }} />
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#1C1A17', minWidth: 40, fontWeight: 500 }}>
                {(p.inflationRate ?? 3).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 32, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        {WP_TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => updateP({ wpSubTab: i })}
            style={{
              padding: '12px 20px', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
              fontFamily: 'Inter', fontWeight: 600,
              color: wpTab === i ? '#2D5A4E' : '#888',
              background: 'none', border: 'none',
              borderBottom: wpTab === i ? '3px solid #2D5A4E' : '3px solid transparent',
              cursor: 'pointer', transition: 'all 0.2s ease',
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

function FamilyDependencyTab({ ff, p, updateP, isCouple, clientName, spouseName, annExpClient, annExpSpouse, coverageTerm, youngestAge, children, isDetailed, cats, editModal, setEditModal, inflation, defaultClientPct, defaultSpousePct }: any) {
  const annExpTotal = annExpClient + annExpSpouse

  function toggleCat(cat: string) {
    updateP({ expenseCategories: { ...cats, [cat]: !cats[cat] } })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <SectionBlock title="Expense Categories" color="#A8834A">
        <p style={{ fontSize: 13, color: '#666', fontFamily: 'Inter', marginBottom: 20 }}>
          Select which expense categories to include in the family dependency calculation.
        </p>
        {isCouple && (
          <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 120px 120px 80px', gap: 12, padding: '0 16px 8px', alignItems: 'center' }}>
            <div />
            <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Category</div>
            <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right', fontWeight: 600 }}>{clientName}</div>
            <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right', fontWeight: 600 }}>{spouseName}</div>
            <div />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                  gridTemplateColumns: isCouple ? '28px 1fr 120px 120px 80px' : '28px 1fr 120px 80px',
                  gap: 12, padding: '16px 20px', alignItems: 'center',
                  background: cats[key] ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.3)',
                  backdropFilter: 'blur(20px)',
                  border: cats[key] ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(255,255,255,0.4)',
                  borderRadius: 20, cursor: 'pointer', transition: 'all 0.3s ease',
                  boxShadow: cats[key] ? '0 8px 24px rgba(0,0,0,0.04)' : 'none',
                }}
                onClick={() => toggleCat(key)}
              >
                <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                  background: cats[key] ? '#A8834A' : 'rgba(0,0,0,0.05)',
                  border: `1px solid ${cats[key] ? '#A8834A' : 'rgba(0,0,0,0.1)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: cats[key] ? '0 2px 6px rgba(168, 131, 74, 0.3)' : 'inset 0 1px 3px rgba(0,0,0,0.05)' }}>
                  {cats[key] && <span style={{ color: '#fff', fontSize: 12, fontWeight: 800 }}>✓</span>}
                </div>
                <span style={{ fontSize: 14, fontFamily: 'Inter', color: '#1C1A17', fontWeight: 500 }}>{label}</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#1C1A17', fontWeight: 500 }}>{fmt(clientAmt)}</div>
                  {isCouple && catTotal > 0 && <div style={{ fontSize: 11, color: '#A8834A', fontFamily: 'Inter', fontWeight: 500 }}>{clientPct}%</div>}
                </div>
                {isCouple && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#1C1A17', fontWeight: 500 }}>{fmt(spouseAmt)}</div>
                    {catTotal > 0 && <div style={{ fontSize: 11, color: '#2D5A4E', fontFamily: 'Inter', fontWeight: 500 }}>{spousePct}%</div>}
                  </div>
                )}
                <div style={{ textAlign: 'right' }}>
                  {isDetailed && cats[key] && (
                    <button onClick={e => { e.stopPropagation(); setEditModal({ open: true, category: key }) }}
                      style={{ fontSize: 11, color: '#1C1A17', background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.1)',
                        borderRadius: 10, padding: '6px 14px', cursor: 'pointer', fontFamily: 'Inter', fontWeight: 500, boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 24, padding: '24px 28px', background: 'rgba(28, 26, 23, 0.9)', backdropFilter: 'blur(24px)', borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 12px 32px rgba(0,0,0,0.1)' }}>
          <span style={{ fontSize: 13, color: '#c8a96e', fontFamily: 'Inter', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>Selected Annual Expenses</span>
          {isCouple ? (
            <div style={{ display: 'flex', gap: 32 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter', marginBottom: 4, letterSpacing: '0.05em' }}>{clientName}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#F5F0E8', fontWeight: 500 }}>{fmt(annExpClient)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter', marginBottom: 4, letterSpacing: '0.05em' }}>{spouseName}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#F5F0E8', fontWeight: 500 }}>{fmt(annExpSpouse)}</div>
              </div>
            </div>
          ) : (
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 20, color: '#F5F0E8', fontWeight: 500 }}>{fmt(annExpClient)}</span>
          )}
        </div>
      </SectionBlock>

      {isCouple && (
        <SectionBlock title="Coverage Percentage" color="#A8834A">
          <p style={{ fontSize: 13, color: '#666', fontFamily: 'Inter', marginBottom: 24 }}>
            What portion of combined expenses does each person need to cover if the other passes away?
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(20px)', borderRadius: 24, padding: '24px 32px', border: '1px solid rgba(255,255,255,0.8)' }}>
            <PersonSlider label={clientName} value={p.expenseCoverPctClient ?? defaultClientPct} onChange={v => updateP({ expenseCoverPctClient: v })} color="#A8834A" />
            <PersonSlider label={spouseName} value={p.expenseCoverPctSpouse ?? defaultSpousePct} onChange={v => updateP({ expenseCoverPctSpouse: v })} color="#2D5A4E" />
          </div>
        </SectionBlock>
      )}

      <SectionBlock title="Coverage Duration" color="#A8834A">
        {youngestAge !== null ? (
          <div>
            <p style={{ fontSize: 13, color: '#666', fontFamily: 'Inter', marginBottom: 20 }}>
              Coverage term auto-calculated based on youngest child reaching university graduation (age 26).
            </p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {children.map(c => {
                const age = c.age ?? getAge(c.date_of_birth)
                const uniGrad = Math.max(0, 26 - age)
                return (
                  <div key={c.id} style={{ padding: '16px 20px', background: 'rgba(255, 255, 255, 0.6)', backdropFilter: 'blur(20px)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.9)', borderLeft: '4px solid #A8834A', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                    <div style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontWeight: 600 }}>
                      {c.name || c.relationship}
                    </div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#1C1A17', fontWeight: 500 }}>
                      Age {age} <span style={{ color: '#ccc', margin: '0 4px' }}>|</span> Grad in {uniGrad} yrs
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.4)', padding: '12px 20px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.6)' }}>
              <span style={{ fontSize: 13, color: '#666', fontFamily: 'Inter', fontWeight: 500 }}>Final Coverage Term:</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#A8834A', fontWeight: 600 }}>{coverageTerm} years</span>
            </div>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 13, color: '#666', fontFamily: 'Inter', marginBottom: 20 }}>
              Select coverage duration (no children detected).
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[5, 10, 15, 20, 25, 30].map(yr => (
                <button
                  key={yr}
                  onClick={() => updateP({ coverageTermOverride: yr })}
                  style={{
                    padding: '10px 20px', fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 500,
                    background: (p.coverageTermOverride ?? 20) === yr ? 'rgba(28, 26, 23, 0.9)' : 'rgba(255, 255, 255, 0.6)',
                    backdropFilter: 'blur(16px)',
                    color: (p.coverageTermOverride ?? 20) === yr ? '#F5F0E8' : '#1C1A17',
                    border: (p.coverageTermOverride ?? 20) === yr ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(255,255,255,0.8)',
                    borderRadius: 16, cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
                  }}
                >
                  {yr} yr
                </button>
              ))}
            </div>
            <div style={{ marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.4)', padding: '12px 20px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.6)' }}>
              <span style={{ fontSize: 13, color: '#666', fontFamily: 'Inter', fontWeight: 500 }}>Coverage Term: </span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#A8834A', fontWeight: 600 }}>{coverageTerm} years</span>
            </div>
          </div>
        )}
      </SectionBlock>

      <SectionBlock title="Family Dependency Need" color="#2D5A4E">
        <NeedTable
          isCouple={isCouple} clientName={clientName} spouseName={spouseName}
          clientData={dtpdFDOnly(annExpClient, p.expenseCoverPctClient ?? defaultClientPct, p.inflationRate ?? 3, coverageTerm)}
          spouseData={dtpdFDOnly(annExpSpouse, p.expenseCoverPctSpouse ?? defaultSpousePct, p.inflationRate ?? 3, coverageTerm)}
          label="D/TPD Family Dependency"
        />
      </SectionBlock>

      <SectionBlock title="Advisor Notes" color="#888">
        <textarea
          value={p.advisorNotes ?? ''}
          onChange={e => updateP({ advisorNotes: e.target.value })}
          placeholder="Document observations, client preferences, or planning considerations..."
          rows={4}
          style={{
            width: '100%', resize: 'vertical', fontFamily: 'Inter', fontSize: 14,
            color: '#1C1A17', background: 'rgba(255, 255, 255, 0.6)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.9)',
            borderRadius: 20, padding: '16px 20px', outline: 'none', transition: 'all 0.2s',
            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
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

function MortgageDebtTab({ ff, p, updateP, isCouple, clientName, spouseName, mortgages }: any) {
  if (mortgages.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', background: 'rgba(255,255,255,0.4)', borderRadius: 24, border: '1px dashed rgba(0,0,0,0.1)' }}>
        <p style={{ color: '#888', fontSize: 14, fontFamily: 'Inter' }}>No mortgages found. Add properties in the Financials tab.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {mortgages.map((m: any, i: number) => {
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
          <div key={m.id} style={{ background: 'rgba(255, 255, 255, 0.6)', backdropFilter: 'blur(20px)', borderRadius: 24, border: '1px solid rgba(255,255,255,0.9)', padding: '32px', borderLeft: '4px solid #A8834A', boxShadow: '0 8px 32px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
              <div>
                <div style={{ fontSize: 18, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17', marginBottom: 6 }}>{m.label}</div>
                <div style={{ fontSize: 13, color: '#666', fontFamily: 'DM Mono, monospace' }}>
                  Outstanding: {fmt(m.outstanding)} <span style={{ color: '#ccc', margin: '0 4px' }}>|</span> {m.interestRate}% <span style={{ color: '#ccc', margin: '0 4px' }}>|</span> {m.remainingTenure} yrs remaining
                </div>
              </div>
            </div>
            
            {isCouple ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, background: 'rgba(255,255,255,0.4)', borderRadius: 20, padding: '24px', border: '1px solid rgba(255,255,255,0.6)' }}>
                <PersonSlider label={`${clientName} covers`} value={clientPct} onChange={updateClientPct} color="#A8834A" unit="%" />
                <PersonSlider label={`${spouseName} covers`} value={spousePct} onChange={updateSpousePct} color="#2D5A4E" unit="%" />
              </div>
            ) : (
              <div style={{ background: 'rgba(255,255,255,0.4)', borderRadius: 20, padding: '24px', border: '1px solid rgba(255,255,255,0.6)' }}>
                <PersonSlider label="Coverage %" value={clientPct} onChange={updateClientPct} color="#A8834A" unit="%" />
              </div>
            )}
            
            <div style={{ marginTop: 24, display: 'flex', gap: 24, justifyContent: 'flex-end', padding: '16px 20px', background: 'rgba(0,0,0,0.02)', borderRadius: 16 }}>
              {isCouple ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{clientName}:</span> <strong style={{ color: '#1C1A17', fontFamily: 'DM Mono, monospace', fontSize: 16 }}>{fmt(m.outstanding * clientPct / 100)}</strong></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{spouseName}:</span> <strong style={{ color: '#1C1A17', fontFamily: 'DM Mono, monospace', fontSize: 16 }}>{fmt(m.outstanding * spousePct / 100)}</strong></div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Coverage:</span> <strong style={{ color: '#1C1A17', fontFamily: 'DM Mono, monospace', fontSize: 16 }}>{fmt(m.outstanding * clientPct / 100)}</strong></div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── EDUCATION FUND TAB ───────────────────────────────────────────────────────

function EducationFundTab({ p, updateP, isCouple, clientName, spouseName, children, inflation }: any) {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '20px 24px', background: 'rgba(255, 255, 255, 0.6)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.9)', borderRadius: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
        <Toggle value={p.provideEducationFund ?? false} onChange={v => updateP({ provideEducationFund: v })} />
        <div>
          <div style={{ fontSize: 15, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17' }}>Provide Education Fund</div>
          <div style={{ fontSize: 13, color: '#666', fontFamily: 'Inter', marginTop: 4 }}>Calculate inflation-adjusted university cost projections per child</div>
        </div>
      </div>

      {p.provideEducationFund && (
        <>
          {children.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', background: 'rgba(255,255,255,0.4)', borderRadius: 24, border: '1px dashed rgba(0,0,0,0.1)' }}>
              <p style={{ color: '#888', fontSize: 14, fontFamily: 'Inter' }}>No children found. Add children in the Client Profile.</p>
            </div>
          )}
          {children.map((child: any) => {
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
              <div key={child.id} style={{ background: 'rgba(255, 255, 255, 0.6)', backdropFilter: 'blur(20px)', borderRadius: 24, border: '1px solid rgba(255,255,255,0.9)', padding: '32px', borderLeft: '4px solid #2D5A4E', boxShadow: '0 8px 32px rgba(0,0,0,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
                  <div>
                    <div style={{ fontSize: 18, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17' }}>{child.name || child.relationship}</div>
                    <div style={{ fontSize: 13, color: '#666', fontFamily: 'Inter', marginTop: 6 }}>
                      Age {childAge} <span style={{ color: '#ccc', margin: '0 4px' }}>|</span> {child.gender || 'Gender not set'} <span style={{ color: '#ccc', margin: '0 4px' }}>|</span> {yearsToUni > 0 ? `${yearsToUni} yrs to university` : 'University age'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, fontWeight: 600 }}>Total Fund Needed</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 26, color: '#2D5A4E', fontWeight: 600 }}>{fmt(totalFund)}</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24, padding: '16px', background: 'rgba(255,255,255,0.6)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.8)' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontWeight: 600 }}>FV Tuition (5%)</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#1C1A17', fontWeight: 500 }}>{fmt(fvTuition)}</div>
                  </div>
                  <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(0,0,0,0.06)', borderRight: '1px solid rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontWeight: 600 }}>FV Living ({(inflation * 100).toFixed(1)}%)</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#1C1A17', fontWeight: 500 }}>{fmt(fvLiving)}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontWeight: 600 }}>Duration</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#1C1A17', fontWeight: 500 }}>{dur} yrs</div>
                  </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>University Type</label>
                  <select
                    value={ec.uniType ?? 'sg_local'}
                    onChange={e => {
                      const uni = e.target.value
                      const info = UNI_COST_DEFAULTS[uni]
                      updateChild(child.id, { uniType: uni, annualTuition: info.annual_tuition, annualLiving: info.annual_living, courseDuration: info.default_duration })
                    }}
                    style={{ width: '100%', padding: '14px 16px', fontFamily: 'Inter', fontSize: 14, background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.9)', borderRadius: 16, color: '#1C1A17', outline: 'none', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.02)' }}
                  >
                    {Object.entries(UNI_COST_DEFAULTS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label} — {fmt(v.annual_tuition + v.annual_living)}/yr</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 20 }}>
                  <div>
                    <label style={labelStyle}>University Entry Age</label>
                    <input type="number" min={15} max={25} step={1} value={uniEntryAge} onChange={e => updateChild(child.id, { uniEntryAge: parseInt(e.target.value) })} style={inputStyle} />
                    <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter', marginTop: 6 }}>Default: {defaultEntryAge}</div>
                  </div>
                  <div>
                    <label style={labelStyle}>Course Duration (years)</label>
                    <input type="number" min={1} max={6} step={1} value={dur} onChange={e => updateChild(child.id, { courseDuration: parseInt(e.target.value) })} style={inputStyle} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: isCouple ? 24 : 0 }}>
                  <div>
                    <label style={labelStyle}>Annual Tuition (Today's $)</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#888', fontFamily: 'DM Mono, monospace', fontSize: 14 }}>$</span>
                      <input type="number" min={0} step={500} value={baseTuition} onChange={e => updateChild(child.id, { annualTuition: parseInt(e.target.value) })} style={{ ...inputStyle, paddingLeft: 32 }} />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Annual Living (Today's $)</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#888', fontFamily: 'DM Mono, monospace', fontSize: 14 }}>$</span>
                      <input type="number" min={0} step={500} value={baseLiving} onChange={e => updateChild(child.id, { annualLiving: parseInt(e.target.value) })} style={{ ...inputStyle, paddingLeft: 32 }} />
                    </div>
                  </div>
                </div>

                {isCouple && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, paddingTop: 24, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
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

function CriticalIllnessTab({ ff, p, updateP, isCouple, clientName, spouseName, mortgages, ciClient, ciSpouse, children }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <SectionBlock title="Critical Illness Stage" color="#A8834A">
        {/* Segmented Control for CI Stage */}
        <div style={{ position: 'relative', display: 'flex', width: 320, background: 'rgba(0, 0, 0, 0.04)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: 20, padding: 4, marginBottom: 16, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.05)' }}>
          {/* Sliding Pill */}
          <div style={{
            position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc(50% - 4px)',
            transform: p.ciStage === 'late_only' ? 'translateX(100%)' : 'translateX(0)',
            background: '#1C1A17', borderRadius: 16,
            transition: 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)', pointerEvents: 'none'
          }} />
          {([
            { key: 'early_late', label: 'Early & Late Stage' },
            { key: 'late_only', label: 'Late Stage Only' },
          ] as const).map(opt => (
            <button
              key={opt.key}
              onClick={() => updateP({ ciStage: opt.key })}
              style={{
                flex: 1, padding: '10px 0', fontFamily: 'Inter', fontSize: 12, fontWeight: 500,
                background: 'transparent',
                color: p.ciStage === opt.key ? '#fff' : '#666',
                position: 'relative', zIndex: 1,
                border: 'none', borderRadius: 16, cursor: 'pointer', transition: 'color 0.3s ease',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 13, color: '#666', fontFamily: 'Inter' }}>
          {p.ciStage === 'early_late' ? 'Calculates coverage need for both early and late stage critical illnesses.' : 'Calculates coverage need for late stage critical illnesses only.'}
        </p>
      </SectionBlock>

      <SectionBlock title="CI Coverage Window" color="#A8834A">
        <p style={{ fontSize: 13, color: '#666', fontFamily: 'Inter', marginBottom: 20 }}>
          How many years of income replacement / expenses should be provided during a critical illness recovery event?
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(12px)', padding: '16px 24px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.8)' }}>
          <input type="range" min={1} max={10} step={1} value={p.ciYears ?? 5} onChange={e => updateP({ ciYears: parseInt(e.target.value) })} style={{ flex: 1, accentColor: '#A8834A' }} />
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#A8834A', minWidth: 80, fontWeight: 600 }}>
            {p.ciYears ?? 5} years
          </span>
        </div>
      </SectionBlock>

      {mortgages.length > 0 && (
        <SectionBlock title="Mortgage During CI" color="#A8834A">
          <p style={{ fontSize: 13, color: '#666', fontFamily: 'Inter', marginBottom: 20 }}>
            What percentage of the monthly mortgage repayments should be covered during the CI recovery window?
          </p>
          {isCouple ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(12px)', padding: '24px 32px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.8)' }}>
              <PersonSlider label={clientName} value={p.ciMortgagePctClient ?? 100} onChange={v => updateP({ ciMortgagePctClient: v })} color="#A8834A" unit="%" />
              <PersonSlider label={spouseName} value={p.ciMortgagePctSpouse ?? 100} onChange={v => updateP({ ciMortgagePctSpouse: v })} color="#A8834A" unit="%" />
            </div>
          ) : (
            <div style={{ background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(12px)', padding: '24px 32px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.8)' }}>
              <PersonSlider label="Coverage %" value={p.ciMortgagePctClient ?? 100} onChange={v => updateP({ ciMortgagePctClient: v })} color="#A8834A" unit="%" />
            </div>
          )}
        </SectionBlock>
      )}

      {p.provideEducationFund && children.length > 0 && (
        <SectionBlock title="Education Fund Protection" color="#2D5A4E">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', background: 'rgba(255, 255, 255, 0.6)', backdropFilter: 'blur(12px)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.9)' }}>
            <Toggle value={p.includeEduInCI ?? false} onChange={v => updateP({ includeEduInCI: v })} />
            <span style={{ fontSize: 14, fontFamily: 'Inter', color: '#1C1A17', fontWeight: 500 }}>Include education fund targets in CI gap calculation</span>
          </div>
        </SectionBlock>
      )}

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

function AssetOffsetTab({ ff, p, isCouple, clientName, spouseName, dtpdClient, dtpdSpouse, ciClient, ciSpouse }: any) {
  function AssetRow({ label, clientVal, spouseVal }: any) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <span style={{ flex: 1, fontSize: 14, fontFamily: 'Inter', color: '#1C1A17', fontWeight: 500 }}>{label}</span>
        {isCouple ? (
          <>
            <span style={{ width: 140, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 500 }}>{fmt(clientVal)}</span>
            <span style={{ width: 140, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 500 }}>{fmt(spouseVal)}</span>
          </>
        ) : (
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 500 }}>{fmt(clientVal)}</span>
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
    <span style={{ width: 140, textAlign: 'right', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888', fontFamily: 'Inter', fontWeight: 600 }}>{name}</span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <p style={{ fontSize: 14, color: '#666', fontFamily: 'Inter', lineHeight: 1.5 }}>
        Assets are automatically offset against coverage needs. D/TPD offsets include CPF and investment properties. CI offsets use only liquid assets.
      </p>

      <SectionBlock title="Asset Values" color="#2D5A4E">
        {isCouple && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 0, marginBottom: 12, padding: '0 20px' }}>
            {colHeader(clientName)}
            {colHeader(spouseName)}
          </div>
        )}
        <div style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(20px)', borderRadius: 24, border: '1px solid rgba(255,255,255,0.9)', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.03)' }}>
          <AssetRow label="Cash & Liquid Investments" clientVal={clientLiquid} spouseVal={spouseLiquid} />
          <AssetRow label="CPF (OA + SA + MA + RA)" clientVal={clientCPF} spouseVal={spouseCPF} />
          <AssetRow label="Investment Properties" clientVal={clientInvProp} spouseVal={spouseInvProp} />
          
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', background: 'rgba(245, 240, 232, 0.8)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
            <span style={{ flex: 1, fontSize: 13, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17', textTransform: 'uppercase', letterSpacing: '0.08em' }}>D/TPD Offset (all assets)</span>
            {isCouple ? (
              <>
                <span style={{ width: 140, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#2D5A4E', fontWeight: 600 }}>{fmt(clientLiquid + clientCPF + clientInvProp)}</span>
                <span style={{ width: 140, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#2D5A4E', fontWeight: 600 }}>{fmt(spouseLiquid + spouseCPF + spouseInvProp)}</span>
              </>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#2D5A4E', fontWeight: 600 }}>{fmt(clientLiquid + clientCPF + clientInvProp)}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', background: 'rgba(226, 237, 232, 0.7)' }}>
            <span style={{ flex: 1, fontSize: 13, fontFamily: 'Inter', fontWeight: 600, color: '#2D5A4E', textTransform: 'uppercase', letterSpacing: '0.08em' }}>CI Offset (liquid only)</span>
            {isCouple ? (
              <>
                <span style={{ width: 140, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#2D5A4E', fontWeight: 600 }}>{fmt(clientLiquid)}</span>
                <span style={{ width: 140, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#2D5A4E', fontWeight: 600 }}>{fmt(spouseLiquid)}</span>
              </>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#2D5A4E', fontWeight: 600 }}>{fmt(clientLiquid)}</span>
            )}
          </div>
        </div>
      </SectionBlock>

      <SectionBlock title="Net Need After Offset" color="#1C1A17">
        {[
          { label: 'D/TPD Net Need', clientNet: dtpdClient.net, spouseNet: dtpdSpouse.net },
          { label: 'CI Net Need', clientNet: ciClient.net, spouseNet: ciSpouse.net },
        ].map((row, i) => (
          <div key={row.label} style={{ display: 'flex', alignItems: 'center', padding: '20px 24px', marginBottom: i === 0 ? 12 : 0, background: 'rgba(28, 26, 23, 0.9)', backdropFilter: 'blur(20px)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
            <span style={{ flex: 1, fontSize: 13, color: '#c8a96e', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>{row.label}</span>
            {isCouple ? (
              <>
                <div style={{ textAlign: 'right', minWidth: 140 }}>
                  <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'Inter', marginBottom: 4, letterSpacing: '0.05em' }}>{clientName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#F5F0E8', fontWeight: 500 }}>{fmt(row.clientNet)}</div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 140 }}>
                  <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'Inter', marginBottom: 4, letterSpacing: '0.05em' }}>{spouseName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#F5F0E8', fontWeight: 500 }}>{fmt(row.spouseNet)}</div>
                </div>
              </>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, color: '#F5F0E8', fontWeight: 500 }}>{fmt(row.clientNet)}</span>
            )}
          </div>
        ))}
      </SectionBlock>
    </div>
  )
}

// ─── SIDEBAR SUMMARY ─────────────────────────────────────────────────────────

function SidebarSummary({ isCouple, clientName, spouseName, dtpdClient, dtpdSpouse, ciClient, ciSpouse, existingLifeClient, existingLifeSpouse, existingCIClient, existingCISpouse, lifeGapClient, lifeGapSpouse, ciGapClient, ciGapSpouse }: any) {
  function PersonBlock({ name, dtpd, ci, existLife, existCI, lifeGap, ciGap }: any) {
    return (
      <div style={{ background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(24px)', borderRadius: 24, border: '1px solid rgba(255,255,255,0.9)', padding: '24px', marginBottom: 20, boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#A8834A', fontFamily: 'Inter', marginBottom: 16, fontWeight: 600 }}>{name}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SidebarRow label="D/TPD Need" value={dtpd.net} />
          <SidebarRow label="CI Need" value={ci.net} />
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12, marginTop: 4 }}>
            <SidebarRow label="Existing Life" value={existLife} color="#2D5A4E" />
            <SidebarRow label="Existing CI" value={existCI} color="#2D5A4E" />
          </div>
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12, marginTop: 4 }}>
            <SidebarRow label="Life Gap" value={lifeGap} color={lifeGap > 0 ? '#C0392B' : '#2D5A4E'} />
            <SidebarRow label="CI Gap" value={ciGap} color={ciGap > 0 ? '#C0392B' : '#2D5A4E'} />
          </div>
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 16, marginTop: 4, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
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
      <span style={{ fontSize: 12, color: '#666', fontFamily: 'Inter', fontWeight: 500 }}>{label}</span>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: color ?? '#1C1A17', fontWeight: 600 }}>{fmt(value)}</span>
    </div>
  )
}

function MiniBreakdown({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#1C1A17', marginTop: 4, fontWeight: 500 }}>{fmt(value)}</div>
    </div>
  )
}

// ─── EXISTING COVER INPUTS ───────────────────────────────────────────────────

function ExistingCoverInputs({ p, updateP, isCouple, clientName, spouseName }: any) {
  const fields = [
    { key: 'existingLifeCoverClient', label: `${clientName} — Life`, person: 'client' },
    { key: 'existingCICoverClient', label: `${clientName} — CI`, person: 'client' },
    ...(isCouple ? [
      { key: 'existingLifeCoverSpouse', label: `${spouseName} — Life`, person: 'spouse' },
      { key: 'existingCICoverSpouse', label: `${spouseName} — CI`, person: 'spouse' },
    ] : []),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {fields.map(f => (
        <div key={f.key}>
          <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#666', fontFamily: 'Inter', marginBottom: 8, fontWeight: 600 }}>{f.label}</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#888', fontFamily: 'DM Mono, monospace', fontSize: 14 }}>$</span>
            <input
              type="number" min={0}
              value={(p[f.key as keyof ProtectionData] as number) ?? 0}
              onChange={e => updateP({ [f.key]: parseInt(e.target.value) || 0 })}
              style={{ ...inputStyle, paddingLeft: 32, width: '100%', background: 'rgba(255,255,255,0.7)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.02)' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── EDIT SUB-ITEMS MODAL ────────────────────────────────────────────────────

function EditSubItemsModal({ category, ff, p, updateP, onClose, isCouple, clientName, spouseName }: any) {
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.6)', backdropFilter: 'blur(12px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(32px)', borderRadius: 32, padding: '40px', minWidth: 520, maxWidth: 640, border: '1px solid rgba(255,255,255,1)', boxShadow: '0 24px 80px rgba(0,0,0,0.2)', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 26, fontWeight: 400, color: '#1C1A17', margin: 0 }}>
            {EXPENSE_CATEGORY_LABELS[category]}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 28, color: '#888', lineHeight: 1, padding: '0 8px' }}>×</button>
        </div>
        <p style={{ fontSize: 13, color: '#666', fontFamily: 'Inter', marginBottom: 28 }}>
          {isCouple ? 'Tick under each person to include that expense in their protection calculation.' : 'Select which line items to include in the protection calculation.'}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 120px 120px' : '1fr 32px 120px', gap: 12, padding: '0 16px 12px', borderBottom: '1px solid rgba(0,0,0,0.06)', marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Item</div>
          <div style={{ fontSize: 10, color: '#A8834A', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', fontWeight: 600 }}>{clientName}</div>
          {isCouple && <div style={{ fontSize: 10, color: '#2D5A4E', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', fontWeight: 600 }}>{spouseName}</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                  gap: 12, padding: '16px', borderRadius: 16,
                  background: rowActive ? 'rgba(245, 240, 232, 0.8)' : 'transparent', alignItems: 'center',
                  border: rowActive ? '1px solid rgba(255,255,255,0.8)' : '1px solid transparent', transition: 'all 0.2s',
                  boxShadow: rowActive ? '0 4px 12px rgba(0,0,0,0.02)' : 'none' }}
              >
                <div>
                  <div style={{ fontSize: 14, fontFamily: 'Inter', color: '#1C1A17', marginBottom: 6, fontWeight: 500 }}>{DETAILED_EXPENSE_LABELS[key]}</div>
                  {total > 0 && (
                    <div style={{ fontSize: 12, color: '#888', fontFamily: 'DM Mono, monospace' }}>
                      {isCouple
                        ? `${fmt(clientVal)} (${clientPct}%) · ${fmt(spouseVal)} (${spousePct}%)`
                        : `${fmt(clientVal)}/yr`}
                    </div>
                  )}
                </div>

                {isCouple ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }} onClick={() => toggleClient(key)}>
                    <div style={{ width: 24, height: 24, borderRadius: 8, cursor: 'pointer',
                      background: clientOn ? '#A8834A' : 'rgba(255,255,255,0.8)',
                      border: `1px solid ${clientOn ? '#A8834A' : 'rgba(0,0,0,0.1)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                      boxShadow: clientOn ? '0 2px 6px rgba(168, 131, 74, 0.3)' : 'inset 0 1px 3px rgba(0,0,0,0.05)' }}>
                      {clientOn && <span style={{ color: '#fff', fontSize: 14, lineHeight: 1, fontWeight: 800 }}>✓</span>}
                    </div>
                    {clientVal > 0 && <div style={{ fontSize: 11, fontFamily: 'DM Mono, monospace', color: '#A8834A', fontWeight: 500 }}>{fmt(clientVal)}</div>}
                  </div>
                ) : (
                  <div style={{ width: 24, height: 24, borderRadius: 8, cursor: 'pointer', margin: '0 auto',
                    background: clientOn ? '#A8834A' : 'rgba(255,255,255,0.8)',
                    border: `1px solid ${clientOn ? '#A8834A' : 'rgba(0,0,0,0.1)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                    boxShadow: clientOn ? '0 2px 6px rgba(168, 131, 74, 0.3)' : 'inset 0 1px 3px rgba(0,0,0,0.05)' }}
                    onClick={() => toggleItem(key)}>
                    {clientOn && <span style={{ color: '#fff', fontSize: 14, lineHeight: 1, fontWeight: 800 }}>✓</span>}
                  </div>
                )}

                {isCouple && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }} onClick={() => toggleSpouse(key)}>
                    <div style={{ width: 24, height: 24, borderRadius: 8, cursor: 'pointer',
                      background: spouseOn ? '#2D5A4E' : 'rgba(255,255,255,0.8)',
                      border: `1px solid ${spouseOn ? '#2D5A4E' : 'rgba(0,0,0,0.1)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                      boxShadow: spouseOn ? '0 2px 6px rgba(45, 90, 78, 0.3)' : 'inset 0 1px 3px rgba(0,0,0,0.05)' }}>
                      {spouseOn && <span style={{ color: '#fff', fontSize: 14, lineHeight: 1, fontWeight: 800 }}>✓</span>}
                    </div>
                    {spouseVal > 0 && <div style={{ fontSize: 11, fontFamily: 'DM Mono, monospace', color: '#2D5A4E', fontWeight: 500 }}>{fmt(spouseVal)}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 32, padding: '20px 24px', background: 'rgba(28, 26, 23, 0.9)', backdropFilter: 'blur(20px)', borderRadius: 20, boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#c8a96e', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Selected Total</span>
            {isCouple ? (
              <div style={{ display: 'flex', gap: 32 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: '#A8834A', fontFamily: 'Inter', marginBottom: 4, fontWeight: 600 }}>{clientName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: '#F5F0E8', fontWeight: 500 }}>{fmt(selectedClientTotal)}/yr</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: '#2D5A4E', fontFamily: 'Inter', marginBottom: 4, fontWeight: 600 }}>{spouseName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: '#F5F0E8', fontWeight: 500 }}>{fmt(selectedSpouseTotal)}/yr</div>
                </div>
              </div>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#F5F0E8', fontWeight: 500 }}>{fmt(selectedClientTotal)}/yr</span>
            )}
          </div>
        </div>

        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '14px 32px', background: '#1C1A17', color: '#fff', border: 'none', borderRadius: 16, cursor: 'pointer', fontFamily: 'Inter', fontSize: 14, letterSpacing: '0.05em', fontWeight: 500, transition: 'background 0.2s', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
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
    <div style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ width: 4, height: 18, background: color, borderRadius: 4, flexShrink: 0 }} />
        <span style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function PersonSlider({ label, value, onChange, color, unit = '%' }: { label: string; value: number; onChange: (v: number) => void; color: string; unit?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#666', fontFamily: 'Inter', fontWeight: 600 }}>{label}</span>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color, fontWeight: 600 }}>
          {Math.round(value)}{unit}
        </span>
      </div>
      <input
        type="range" min={0} max={100} step={5} value={value} onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: color }}
      />
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div onClick={() => onChange(!value)}
      style={{
        width: 48, height: 26, borderRadius: 24, cursor: 'pointer', transition: 'background 0.3s ease',
        background: value ? '#A8834A' : 'rgba(0,0,0,0.1)', position: 'relative', flexShrink: 0,
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)'
      }}
    >
      <div style={{
        position: 'absolute', top: 3, left: value ? 25 : 3, width: 20, height: 20,
        borderRadius: '50%', background: '#fff', transition: 'left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
      }} />
    </div>
  )
}

function NeedTable({ isCouple, clientName, spouseName, clientData, spouseData, label, breakdown }: any) {
  return (
    <div>
      <div style={{ display: 'flex', padding: '20px 24px', background: 'rgba(28, 26, 23, 0.9)', backdropFilter: 'blur(20px)', borderRadius: breakdown ? '20px 20px 0 0' : 20, alignItems: 'center', border: '1px solid rgba(255,255,255,0.1)', boxShadow: breakdown ? 'none' : '0 8px 24px rgba(0,0,0,0.08)' }}>
        <span style={{ flex: 1, fontSize: 13, color: '#c8a96e', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>{label}</span>
        {isCouple ? (
          <>
            <div style={{ textAlign: 'right', minWidth: 130 }}>
              <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'Inter', marginBottom: 4, letterSpacing: '0.05em' }}>{clientName}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#F5F0E8', fontWeight: 500 }}>{fmt(clientData)}</div>
            </div>
            <div style={{ textAlign: 'right', minWidth: 130 }}>
              <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'Inter', marginBottom: 4, letterSpacing: '0.05em' }}>{spouseName}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#F5F0E8', fontWeight: 500 }}>{fmt(spouseData)}</div>
            </div>
          </>
        ) : (
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 20, color: '#F5F0E8', fontWeight: 500 }}>{fmt(clientData)}</span>
        )}
      </div>
      {breakdown && (
        <div style={{ display: 'flex', gap: 0, background: 'rgba(245, 240, 232, 0.8)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.6)', borderTop: 'none', borderRadius: '0 0 20px 20px', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.04)' }}>
          {(['fd', 'mort', 'edu'] as const).map(key => {
            const labels = { fd: 'Family Dep.', mort: 'Mortgage', edu: 'Education' }
            return (
              <div key={key} style={{ flex: 1, padding: '12px 16px', borderRight: key !== 'edu' ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
                <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontWeight: 600 }}>{labels[key]}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#1C1A17', fontWeight: 500 }}>{fmt(breakdown.client[key])}</div>
                {isCouple && <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#666', marginTop: 4 }}>{fmt(breakdown.spouse[key])}</div>}
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
  display: 'block', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase',
  color: '#666', fontFamily: 'Inter', marginBottom: 10, fontWeight: 600
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '14px 16px', fontFamily: 'DM Mono, monospace', fontSize: 14,
  color: '#1C1A17', background: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.9)',
  borderRadius: 16, outline: 'none', transition: 'all 0.2s', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.02)'
}
