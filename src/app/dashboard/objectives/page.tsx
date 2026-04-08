'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// TODO: Uncomment these two imports when moving code back to your Next.js project
// import { createClient } from '@/lib/supabase'
// import { useUniCosts, UNI_COST_DEFAULTS as UNI_COST_FALLBACK } from '@/hooks/useUniCosts'

// --- TEMPORARY CANVAS MOCKS (DELETE WHEN COPYING TO YOUR PROJECT) ---
// These mocks are only here so the isolated preview environment can compile the code without crashing due to missing local files.
const createClient = () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'canvas-mock-user' } } }) },
  from: (table: string) => ({
    select: (cols?: string) => ({
      order: (col: string, opts: any) => ({
        limit: async (n: number) => ({ data: [{ id: 'mock-client-1' }] })
      }),
      eq: (col: string, val: string) => {
        const promise = Promise.resolve({ data: [] }) as any;
        promise.single = async () => ({ data: null });
        return promise;
      }
    }),
    upsert: async () => ({ error: null })
  })
});
const UNI_COST_FALLBACK: Record<string, any> = {
  sg_local: { label: 'SG Local (NUS / NTU / SMU)', annual_tuition: 10000, annual_living: 6000, default_duration: 4, annual_fees_living: 16000 },
  sg_private: { label: 'SG Private University', annual_tuition: 15000, annual_living: 6000, default_duration: 3, annual_fees_living: 21000 },
  overseas_uk: { label: 'Overseas (UK)', annual_tuition: 35000, annual_living: 15000, default_duration: 3, annual_fees_living: 50000 },
  overseas_us: { label: 'Overseas (US)', annual_tuition: 45000, annual_living: 20000, default_duration: 4, annual_fees_living: 65000 },
  overseas_au: { label: 'Overseas (Australia)', annual_tuition: 30000, annual_living: 18000, default_duration: 3, annual_fees_living: 48000 },
};
const useUniCosts = () => ({ uniCosts: UNI_COST_FALLBACK });
// --------------------------------------------------------------------

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
      <div className="flex items-center justify-center h-full" style={{ background: 'transparent' }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'transparent', fontFamily: 'Inter, sans-serif' }}>
      
      {/* HERO BAND */}
      <div style={{ 
        background: 'rgba(30, 28, 25, 0.75)', 
        backdropFilter: 'blur(30px) saturate(150%)', 
        WebkitBackdropFilter: 'blur(30px) saturate(150%)',
        padding: '40px 48px 32px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        zIndex: 10,
        position: 'relative'
      }}>
        <div>
          <p style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '8px', color: '#B99B6A', fontWeight: 600 }}>Strategic Objectives</p>
          <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '36px', fontWeight: 400, color: '#FFFFFF', margin: 0, letterSpacing: '0.02em' }}>
            Needs Discovery
            <span style={{ color: '#B99B6A', margin: '0 16px' }}>—</span>
            <span>{isCouple ? `${safeClientName} & ${safeSpouseName}` : safeClientName}</span>
          </h1>
        </div>
      </div>

      {/* SECTION TABS */}
      <div style={{ 
        background: 'rgba(255, 255, 255, 0.65)', 
        backdropFilter: 'blur(40px) saturate(150%)', 
        WebkitBackdropFilter: 'blur(40px) saturate(150%)',
        borderBottom: '1px solid rgba(255,255,255,0.8)', 
        padding: '0 48px', 
        display: 'flex', 
        gap: '32px',
        position: 'relative',
        zIndex: 9
      }}>
        {['WEALTH PROTECTION', 'WEALTH ACCUMULATION', 'RETIREMENT', 'EDUCATION PLANNING', 'ESTATE PLANNING'].map((s, i) => (
          <button
            key={s}
            onClick={() => setActiveSection(i)}
            style={{
              padding: '16px 0', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase',
              fontFamily: 'Inter', fontWeight: 600,
              color: activeSection === i ? '#1A1A1A' : 'rgba(0,0,0,0.4)', background: 'none', border: 'none',
              borderBottom: activeSection === i ? '2px solid #B99B6A' : '2px solid transparent',
              cursor: 'pointer', transition: 'all 0.2s',
            } as React.CSSProperties}
          >
            {s}
          </button>
        ))}
      </div>

      {/* MAIN LAYOUT */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', flex: 1, position: 'relative', zIndex: 1 }}>

        {/* LEFT: CONTENT */}
        <div style={{ padding: '40px 48px', borderRight: '1px solid rgba(0,0,0,0.06)' }}>
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
              <div style={{ padding: '32px 48px', background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(20px)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.7)' }}>
                <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 14, fontFamily: 'Inter', margin: 0, letterSpacing: '0.05em', fontWeight: 500 }}>
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
            <p style={{ fontSize: '11px', textTransform: 'uppercase', marginBottom: '16px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', letterSpacing: '0.15em', fontWeight: 600 }}>EXISTING COVERAGE</p>
            <ExistingCoverInputs p={p} updateP={updateP} isCouple={isCouple} clientName={safeClientName} spouseName={safeSpouseName} />
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
          <div style={{ width: '3px', height: '20px', background: '#B99B6A', borderRadius: '2px' }} />
          <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '24px', fontWeight: 400, color: '#1A1A1A', margin: 0 }}>
            Wealth Protection
          </h2>
        </div>
        
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
          
          {/* Individual / Couple toggle (Segmented Control - macOS Glass style) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', fontWeight: 600 }}>PLANNING FOR</div>
            <div style={{ position: 'relative', display: 'flex', background: 'rgba(0, 0, 0, 0.05)', backdropFilter: 'blur(10px)', borderRadius: '8px', padding: '2px', boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.05)', width: '140px' }}>
              <div style={{
                position: 'absolute', top: 2, bottom: 2, left: 2, width: 'calc(50% - 2px)',
                transform: p.planType === 'couple' ? 'translateX(100%)' : 'translateX(0)',
                background: '#FFFFFF', borderRadius: '6px',
                transition: 'transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)', pointerEvents: 'none'
              }} />
              {(['individual', 'couple'] as const).map(t => (
                <button key={t} onClick={() => updateP({ planType: t })}
                  style={{ flex: 1, padding: '4px 0', fontSize: '11px', fontFamily: 'Inter', fontWeight: 600,
                    background: 'transparent',
                    color: p.planType === t ? '#1A1A1A' : 'rgba(0,0,0,0.5)',
                    position: 'relative', zIndex: 1,
                    border: 'none', borderRadius: '6px', cursor: 'pointer', transition: 'color 0.2s', textTransform: 'capitalize' }}>
                  {t === 'individual' ? 'Client' : 'Couple'}
                </button>
              ))}
            </div>
          </div>

          {/* Simple / Detailed toggle (Segmented Control - macOS Glass style) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', fontWeight: 600 }}>EXPENSE DATA</div>
            <div style={{ position: 'relative', display: 'flex', background: 'rgba(0, 0, 0, 0.05)', backdropFilter: 'blur(10px)', borderRadius: '8px', padding: '2px', boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.05)', width: '130px' }}>
               <div style={{
                position: 'absolute', top: 2, bottom: 2, left: 2, width: 'calc(50% - 2px)',
                transform: (p.expenseMode ?? ff.expense_mode ?? 'simple') === 'detailed' ? 'translateX(100%)' : 'translateX(0)',
                background: '#FFFFFF', borderRadius: '6px',
                transition: 'transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)', pointerEvents: 'none'
              }} />
              {(['simple', 'detailed'] as const).map(t => (
                <button key={t} onClick={() => updateP({ expenseMode: t })}
                  style={{ flex: 1, padding: '4px 0', fontSize: '11px', fontFamily: 'Inter', fontWeight: 600,
                    background: 'transparent',
                    color: (p.expenseMode ?? ff.expense_mode ?? 'simple') === t ? '#1A1A1A' : 'rgba(0,0,0,0.5)',
                    position: 'relative', zIndex: 1,
                    border: 'none', borderRadius: '6px', cursor: 'pointer', transition: 'color 0.2s', textTransform: 'capitalize' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Inflation Slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '200px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', fontWeight: 600 }}>INFLATION RATE</div>
            <input type="range" min={0} max={8} step={0.5}
              value={p.inflationRate ?? 3}
              onChange={e => updateP({ inflationRate: parseFloat(e.target.value) })}
              style={{ flex: 1, accentColor: '#B99B6A', height: '4px' }} />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: '#1A1A1A', fontWeight: 600 }}>
              {(p.inflationRate ?? 3).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div style={{ display: 'flex', gap: '24px', marginBottom: '32px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        {WP_TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => updateP({ wpSubTab: i })}
            style={{
              padding: '12px 0', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase',
              fontFamily: 'Inter', fontWeight: 600,
              color: wpTab === i ? '#347A5A' : 'rgba(0,0,0,0.4)',
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
      <div style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', padding: '32px', border: '1px solid rgba(255,255,255,0.8)', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
        <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 16px', fontWeight: 600 }}>Expense Categories</h3>
        {isCouple && (
          <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 120px 120px 80px', gap: '12px', padding: '0 16px 8px', borderBottom: '1px solid rgba(0,0,0,0.06)', marginBottom: '8px' }}>
            <div />
            <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Category</div>
            <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right', fontWeight: 600 }}>{clientName}</div>
            <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right', fontWeight: 600 }}>{spouseName}</div>
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
                  borderBottom: '1px solid rgba(0,0,0,0.04)',
                  cursor: 'pointer', transition: 'background 0.2s',
                  background: cats[key] ? 'rgba(255, 255, 255, 0.5)' : 'transparent',
                  borderRadius: cats[key] ? '12px' : '0'
                }}
                onClick={() => toggleCat(key)}
              >
                <div style={{ width: '18px', height: '18px', borderRadius: '4px', flexShrink: 0,
                  background: cats[key] ? '#B99B6A' : 'rgba(255,255,255,0.8)',
                  border: `1px solid ${cats[key] ? '#B99B6A' : 'rgba(0,0,0,0.1)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: cats[key] ? '0 2px 4px rgba(185, 155, 106, 0.4)' : 'inset 0 1px 3px rgba(0,0,0,0.05)' }}>
                  {cats[key] && <span style={{ color: '#fff', fontSize: '12px', fontWeight: 800 }}>✓</span>}
                </div>
                <span style={{ fontSize: '13px', fontFamily: 'Inter', color: '#1A1A1A', fontWeight: 500 }}>{label}</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(clientAmt)}</div>
                  {isCouple && catTotal > 0 && <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', marginTop: '2px', fontWeight: 500 }}>{clientPct}%</div>}
                </div>
                {isCouple && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(spouseAmt)}</div>
                    {catTotal > 0 && <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', marginTop: '2px', fontWeight: 500 }}>{spousePct}%</div>}
                  </div>
                )}
                <div style={{ textAlign: 'right' }}>
                  {isDetailed && cats[key] && (
                    <button onClick={e => { e.stopPropagation(); setEditModal({ open: true, category: key }) }}
                      style={{ fontSize: '10px', color: '#1A1A1A', background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.1)',
                        borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontFamily: 'Inter', fontWeight: 600, boxShadow: '0 2px 4px rgba(0,0,0,0.04)' }}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: '24px', padding: '20px 24px', background: 'rgba(255, 255, 255, 0.4)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.8)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>Selected Annual Expenses</span>
          {isCouple ? (
            <div style={{ display: 'flex', gap: '32px' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', marginBottom: '4px', fontWeight: 600 }}>{clientName}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(annExpClient)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', marginBottom: '4px', fontWeight: 600 }}>{spouseName}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(annExpSpouse)}</div>
              </div>
            </div>
          ) : (
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(annExpClient)}</span>
          )}
        </div>
      </div>

      {isCouple && (
        <div style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', padding: '32px', border: '1px solid rgba(255,255,255,0.8)', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
          <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 24px', fontWeight: 600 }}>Coverage Percentage</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
            <PersonSlider label={clientName} value={p.expenseCoverPctClient ?? defaultClientPct} onChange={v => updateP({ expenseCoverPctClient: v })} color="#B99B6A" />
            <PersonSlider label={spouseName} value={p.expenseCoverPctSpouse ?? defaultSpousePct} onChange={v => updateP({ expenseCoverPctSpouse: v })} color="#347A5A" />
          </div>
        </div>
      )}

      <div style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', padding: '32px', border: '1px solid rgba(255,255,255,0.8)', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
        <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 16px', fontWeight: 600 }}>Coverage Duration</h3>
        {youngestAge !== null ? (
          <div>
            <p style={{ fontSize: '12px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', marginBottom: '20px' }}>
              Coverage term auto-calculated based on youngest child reaching university graduation (age 26).
            </p>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {children.map((c: FamilyMember) => {
                const age = c.age ?? getAge(c.date_of_birth)
                const uniGrad = Math.max(0, 26 - age)
                return (
                  <div key={c.id} style={{ padding: '16px 20px', background: 'rgba(255, 255, 255, 0.7)', borderRadius: '16px', border: '1px solid rgba(255,255,255,1)', borderLeft: '4px solid #B99B6A', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                    <div style={{ fontSize: '11px', color: '#1A1A1A', fontFamily: 'Inter', fontWeight: 600, marginBottom: '4px' }}>
                      {c.name || c.relationship}
                    </div>
                    <div style={{ fontSize: '12px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter' }}>
                      Age {age} • Grad in {uniGrad} yrs
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: '24px', display: 'inline-flex', alignItems: 'center', gap: '12px', background: 'rgba(255, 255, 255, 0.5)', padding: '12px 20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.8)' }}>
              <span style={{ fontSize: '12px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', fontWeight: 500 }}>Final Coverage Term:</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', color: '#1A1A1A', fontWeight: 600 }}>{coverageTerm} years</span>
            </div>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '12px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', marginBottom: '20px' }}>
              Select coverage duration (no children detected).
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[5, 10, 15, 20, 25, 30].map(yr => (
                <button
                  key={yr}
                  onClick={() => updateP({ coverageTermOverride: yr })}
                  style={{
                    padding: '10px 20px', fontFamily: 'Inter', fontSize: '13px', fontWeight: 500,
                    background: (p.coverageTermOverride ?? 20) === yr ? '#1A1A1A' : 'rgba(255, 255, 255, 0.5)',
                    color: (p.coverageTermOverride ?? 20) === yr ? '#FFFFFF' : '#1A1A1A',
                    border: (p.coverageTermOverride ?? 20) === yr ? '1px solid #1A1A1A' : '1px solid rgba(255,255,255,0.8)',
                    borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
                  }}
                >
                  {yr} yr
                </button>
              ))}
            </div>
            <div style={{ marginTop: '24px', display: 'inline-flex', alignItems: 'center', gap: '12px', background: 'rgba(255, 255, 255, 0.5)', padding: '12px 20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.8)' }}>
              <span style={{ fontSize: '12px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', fontWeight: 500 }}>Coverage Term: </span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', color: '#1A1A1A', fontWeight: 600 }}>{coverageTerm} years</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', padding: '0', border: '1px solid rgba(255,255,255,0.8)', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
        <NeedTable
          isCouple={isCouple} clientName={clientName} spouseName={spouseName}
          clientData={dtpdFDOnly(annExpClient, p.expenseCoverPctClient ?? defaultClientPct, p.inflationRate ?? 3, coverageTerm)}
          spouseData={dtpdFDOnly(annExpSpouse, p.expenseCoverPctSpouse ?? defaultSpousePct, p.inflationRate ?? 3, coverageTerm)}
          label="D/TPD Family Dependency Need"
        />
      </div>

      <div style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', padding: '32px', border: '1px solid rgba(255,255,255,0.8)', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
        <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 16px', fontWeight: 600 }}>Advisor Notes</h3>
        <textarea
          value={p.advisorNotes ?? ''}
          onChange={e => updateP({ advisorNotes: e.target.value })}
          placeholder="Document observations, client preferences, or planning considerations..."
          rows={4}
          style={{
            width: '100%', resize: 'vertical', fontFamily: 'Inter', fontSize: '13px',
            color: '#1A1A1A', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.9)',
            borderRadius: '12px', padding: '16px', outline: 'none', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
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
      <div style={{ textAlign: 'center', padding: '60px 0', background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(10px)', borderRadius: '20px', border: '1px dashed rgba(0,0,0,0.1)' }}>
        <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: '13px', fontFamily: 'Inter' }}>No mortgages found. Add properties in the Financials tab.</p>
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
          <div key={m.id} style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.8)', padding: '32px', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
              <div>
                <div style={{ fontSize: '16px', fontFamily: 'Inter', fontWeight: 600, color: '#1A1A1A', marginBottom: '6px' }}>{m.label}</div>
                <div style={{ fontSize: '12px', color: 'rgba(0,0,0,0.5)', fontFamily: 'DM Mono, monospace', fontWeight: 500 }}>
                  Outstanding: {fmt(m.outstanding)} <span style={{ color: 'rgba(0,0,0,0.2)', margin: '0 8px' }}>|</span> {m.interestRate}% <span style={{ color: 'rgba(0,0,0,0.2)', margin: '0 8px' }}>|</span> {m.remainingTenure} yrs remaining
                </div>
              </div>
            </div>
            
            {isCouple ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', background: 'rgba(255,255,255,0.5)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(255,255,255,0.8)' }}>
                <PersonSlider label={`${clientName} covers`} value={clientPct} onChange={updateClientPct} color="#B99B6A" unit="%" />
                <PersonSlider label={`${spouseName} covers`} value={spousePct} onChange={updateSpousePct} color="#347A5A" unit="%" />
              </div>
            ) : (
              <div style={{ background: 'rgba(255,255,255,0.5)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(255,255,255,0.8)' }}>
                <PersonSlider label="Coverage %" value={clientPct} onChange={updateClientPct} color="#B99B6A" unit="%" />
              </div>
            )}
            
            <div style={{ marginTop: '24px', display: 'flex', gap: '24px', justifyContent: 'flex-end', padding: '16px 20px', background: 'rgba(255,255,255,0.4)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.6)' }}>
              {isCouple ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '11px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{clientName}:</span> <strong style={{ color: '#1A1A1A', fontFamily: 'DM Mono, monospace', fontSize: '14px' }}>{fmt(m.outstanding * clientPct / 100)}</strong></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '11px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{spouseName}:</span> <strong style={{ color: '#1A1A1A', fontFamily: 'DM Mono, monospace', fontSize: '14px' }}>{fmt(m.outstanding * spousePct / 100)}</strong></div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '11px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Coverage:</span> <strong style={{ color: '#1A1A1A', fontFamily: 'DM Mono, monospace', fontSize: '14px' }}>{fmt(m.outstanding * clientPct / 100)}</strong></div>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '24px', background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.8)', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
        <Toggle value={p.provideEducationFund ?? false} onChange={v => updateP({ provideEducationFund: v })} />
        <div>
          <div style={{ fontSize: '15px', fontFamily: 'Inter', fontWeight: 600, color: '#1A1A1A' }}>Provide Education Fund</div>
          <div style={{ fontSize: '12px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', marginTop: '4px', fontWeight: 500 }}>Calculate inflation-adjusted university cost projections per child</div>
        </div>
      </div>

      {p.provideEducationFund && (
        <>
          {children.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', background: 'rgba(255,255,255,0.4)', borderRadius: '20px', border: '1px dashed rgba(0,0,0,0.1)' }}>
              <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: '13px', fontFamily: 'Inter', fontWeight: 500 }}>No children found. Add children in the Client Profile.</p>
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
              <div key={child.id} style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.8)', padding: '32px', borderLeft: '4px solid #347A5A', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
                  <div>
                    <div style={{ fontSize: '18px', fontFamily: 'Inter', fontWeight: 600, color: '#1A1A1A' }}>{child.name || child.relationship}</div>
                    <div style={{ fontSize: '13px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', marginTop: '6px', fontWeight: 500 }}>
                      Age {childAge} <span style={{ color: 'rgba(0,0,0,0.2)', margin: '0 6px' }}>|</span> {child.gender || 'Gender not set'} <span style={{ color: 'rgba(0,0,0,0.2)', margin: '0 6px' }}>|</span> {yearsToUni > 0 ? `${yearsToUni} yrs to university` : 'University age'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', fontWeight: 700 }}>TOTAL FUND NEEDED</div>
                    <div style={{ fontFamily: 'Inter', fontSize: '28px', color: '#347A5A', fontWeight: 700, letterSpacing: '-0.02em' }}>{fmt(totalFund)}</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '28px', background: 'rgba(255,255,255,0.5)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.9)', padding: '20px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', fontWeight: 600 }}>FV TUITION (5%)</div>
                    <div style={{ fontFamily: 'Inter', fontSize: '15px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(fvTuition)}</div>
                  </div>
                  <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(0,0,0,0.06)', borderRight: '1px solid rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', fontWeight: 600 }}>FV LIVING ({(inflation * 100).toFixed(1)}%)</div>
                    <div style={{ fontFamily: 'Inter', fontSize: '15px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(fvLiving)}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', fontWeight: 600 }}>DURATION</div>
                    <div style={{ fontFamily: 'Inter', fontSize: '15px', color: '#1A1A1A', fontWeight: 600 }}>{dur} yrs</div>
                  </div>
                </div>

                <div style={{ marginBottom: '24px' }}>
                  <label style={labelStyle}>UNIVERSITY TYPE</label>
                  <select
                    value={ec.uniType ?? 'sg_local'}
                    onChange={e => {
                      const uni = e.target.value
                      const info = UNI_COST_DEFAULTS[uni]
                      updateChild(child.id, { uniType: uni, annualTuition: info.annual_tuition, annualLiving: info.annual_living, courseDuration: info.default_duration })
                    }}
                    style={{ width: '100%', padding: '14px 16px', fontFamily: 'Inter', fontSize: '14px', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,1)', borderRadius: '12px', color: '#1A1A1A', outline: 'none', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)', fontWeight: 500 }}
                  >
                    {Object.entries(UNI_COST_DEFAULTS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label} — {fmt(v.annual_tuition + v.annual_living)}/yr</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
                  <div>
                    <label style={labelStyle}>UNIVERSITY ENTRY AGE</label>
                    <input type="number" min={15} max={25} step={1} value={uniEntryAge} onChange={e => updateChild(child.id, { uniEntryAge: parseInt(e.target.value) })} style={inputStyle} />
                    <div style={{ fontSize: '11px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', marginTop: '6px', fontWeight: 500 }}>Default: {defaultEntryAge} ({child.gender === 'Female' ? 'Female' : 'Male'})</div>
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
                      <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#1A1A1A', fontFamily: 'Inter', fontSize: '14px', fontWeight: 500 }}>$</span>
                      <input type="number" min={0} step={500} value={baseTuition} onChange={e => updateChild(child.id, { annualTuition: parseInt(e.target.value) })} style={{ ...inputStyle, paddingLeft: '32px' }} />
                    </div>
                    <div style={{ fontSize: '11px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', marginTop: '6px', fontWeight: 500 }}>Inflated at 5% p.a.</div>
                  </div>
                  <div>
                    <label style={labelStyle}>ANNUAL LIVING (TODAY'S $)</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#1A1A1A', fontFamily: 'Inter', fontSize: '14px', fontWeight: 500 }}>$</span>
                      <input type="number" min={0} step={500} value={baseLiving} onChange={e => updateChild(child.id, { annualLiving: parseInt(e.target.value) })} style={{ ...inputStyle, paddingLeft: '32px' }} />
                    </div>
                    <div style={{ fontSize: '11px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', marginTop: '6px', fontWeight: 500 }}>Inflated at {(inflation * 100).toFixed(1)}% p.a.</div>
                  </div>
                </div>

                {isCouple && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', paddingTop: '28px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
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
      <div style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', padding: '32px', border: '1px solid rgba(255,255,255,0.8)', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
        <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 20px', fontWeight: 600 }}>Critical Illness Stage</h3>
        <div style={{ position: 'relative', display: 'flex', width: '360px', background: 'rgba(0, 0, 0, 0.05)', backdropFilter: 'blur(10px)', borderRadius: '12px', padding: '4px', marginBottom: '20px', boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.05)' }}>
          {/* Sliding Pill */}
          <div style={{
            position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc(50% - 4px)',
            transform: p.ciStage === 'late_only' ? 'translateX(100%)' : 'translateX(0)',
            background: '#FFFFFF', borderRadius: '8px',
            transition: 'transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.06)', pointerEvents: 'none'
          }} />
          {([
            { key: 'early_late', label: 'Early & Late Stage' },
            { key: 'late_only', label: 'Late Stage Only' },
          ] as const).map(opt => (
            <button
              key={opt.key}
              onClick={() => updateP({ ciStage: opt.key })}
              style={{
                flex: 1, padding: '10px 0', fontFamily: 'Inter', fontSize: '12px', fontWeight: 600,
                background: 'transparent',
                color: p.ciStage === opt.key ? '#1A1A1A' : 'rgba(0,0,0,0.5)',
                position: 'relative', zIndex: 1,
                border: 'none', borderRadius: '8px', cursor: 'pointer', transition: 'color 0.2s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: '13px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', margin: 0, fontWeight: 500, lineHeight: 1.5 }}>
          {p.ciStage === 'early_late' ? 'Calculates coverage need for both early and late stage critical illnesses.' : 'Calculates coverage need for late stage critical illnesses only.'}
        </p>
      </div>

      <div style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', padding: '32px', border: '1px solid rgba(255,255,255,0.8)', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
        <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 16px', fontWeight: 600 }}>CI Coverage Window</h3>
        <p style={{ fontSize: '13px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', marginBottom: '24px', fontWeight: 500 }}>
          How many years of income replacement / expenses should be provided during a critical illness recovery event?
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', background: 'rgba(255,255,255,0.5)', borderRadius: '16px', padding: '20px 24px', border: '1px solid rgba(255,255,255,0.9)' }}>
          <input type="range" min={1} max={10} step={1} value={p.ciYears ?? 5} onChange={e => updateP({ ciYears: parseInt(e.target.value) })} style={{ flex: 1, accentColor: '#B99B6A', height: '4px' }} />
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#1A1A1A', minWidth: '80px', fontWeight: 600 }}>
            {p.ciYears ?? 5} years
          </span>
        </div>
      </div>

      {mortgages.length > 0 && (
        <div style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', padding: '32px', border: '1px solid rgba(255,255,255,0.8)', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
          <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: '0 0 16px', fontWeight: 600 }}>Mortgage During CI</h3>
          <p style={{ fontSize: '13px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', marginBottom: '24px', fontWeight: 500 }}>
            What percentage of the monthly mortgage repayments should be covered during the CI recovery window?
          </p>
          {isCouple ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', background: 'rgba(255,255,255,0.5)', padding: '24px 32px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.9)' }}>
              <PersonSlider label={clientName} value={p.ciMortgagePctClient ?? 100} onChange={v => updateP({ ciMortgagePctClient: v })} color="#B99B6A" unit="%" />
              <PersonSlider label={spouseName} value={p.ciMortgagePctSpouse ?? 100} onChange={v => updateP({ ciMortgagePctSpouse: v })} color="#B99B6A" unit="%" />
            </div>
          ) : (
            <div style={{ background: 'rgba(255,255,255,0.5)', padding: '24px 32px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.9)' }}>
              <PersonSlider label="Coverage %" value={p.ciMortgagePctClient ?? 100} onChange={v => updateP({ ciMortgagePctClient: v })} color="#B99B6A" unit="%" />
            </div>
          )}
        </div>
      )}

      {p.provideEducationFund && children.length > 0 && (
        <div style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', padding: '24px', border: '1px solid rgba(255,255,255,0.8)', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <Toggle value={p.includeEduInCI ?? false} onChange={v => updateP({ includeEduInCI: v })} />
            <span style={{ fontSize: '14px', fontFamily: 'Inter', color: '#1A1A1A', fontWeight: 600 }}>Include education fund targets in CI gap calculation</span>
          </div>
        </div>
      )}

      <div style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', padding: '0', border: '1px solid rgba(255,255,255,0.8)', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <span style={{ flex: 1, fontSize: '14px', fontFamily: 'Inter', color: '#1A1A1A', fontWeight: 500 }}>{label}</span>
        {isCouple ? (
          <>
            <span style={{ width: '140px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: '14px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(clientVal)}</span>
            <span style={{ width: '140px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: '14px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(spouseVal)}</span>
          </>
        ) : (
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(clientVal)}</span>
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
    <span style={{ width: '140px', textAlign: 'right', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', fontWeight: 700 }}>{name}</span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <p style={{ fontSize: '14px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
        Assets are automatically offset against coverage needs. D/TPD offsets include CPF and investment properties. CI offsets use only liquid assets.
      </p>

      <div style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.8)', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
        <div style={{ padding: '28px 24px 16px' }}>
          <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: 0, fontWeight: 600 }}>Asset Values</h3>
        </div>
        {isCouple && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 0, marginBottom: '12px', padding: '0 24px' }}>
            {colHeader(clientName)}
            {colHeader(spouseName)}
          </div>
        )}
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <AssetRow label="Cash & Liquid Investments" clientVal={clientLiquid} spouseVal={spouseLiquid} />
          <AssetRow label="CPF (OA + SA + MA + RA)" clientVal={clientCPF} spouseVal={spouseCPF} />
          <AssetRow label="Investment Properties" clientVal={clientInvProp} spouseVal={spouseInvProp} />
          
          <div style={{ display: 'flex', alignItems: 'center', padding: '20px 24px', background: 'rgba(245, 240, 232, 0.6)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <span style={{ flex: 1, fontSize: '12px', fontFamily: 'Inter', fontWeight: 600, color: '#1A1A1A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>D/TPD Offset (all assets)</span>
            {isCouple ? (
              <>
                <span style={{ width: '140px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: '15px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(clientLiquid + clientCPF + clientInvProp)}</span>
                <span style={{ width: '140px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: '15px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(spouseLiquid + spouseCPF + spouseInvProp)}</span>
              </>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '15px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(clientLiquid + clientCPF + clientInvProp)}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', padding: '20px 24px', background: 'rgba(255, 255, 255, 0.4)' }}>
            <span style={{ flex: 1, fontSize: '12px', fontFamily: 'Inter', fontWeight: 600, color: '#1A1A1A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>CI Offset (liquid only)</span>
            {isCouple ? (
              <>
                <span style={{ width: '140px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: '15px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(clientLiquid)}</span>
                <span style={{ width: '140px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: '15px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(spouseLiquid)}</span>
              </>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '15px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(clientLiquid)}</span>
            )}
          </div>
        </div>
      </div>

      <div style={{ background: 'rgba(255, 255, 255, 0.65)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.8)', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
        <div style={{ padding: '28px 24px 16px' }}>
          <h3 style={{ fontSize: '14px', color: '#1A1A1A', fontFamily: 'Inter', margin: 0, fontWeight: 600 }}>Net Need After Offset</h3>
        </div>
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          {[
            { label: 'D/TPD Net Need', clientNet: dtpdClient.net, spouseNet: dtpdSpouse.net },
            { label: 'CI Net Need', clientNet: ciClient.net, spouseNet: ciSpouse.net },
          ].map((row, i) => (
            <div key={row.label} style={{ display: 'flex', alignItems: 'center', padding: '24px', borderBottom: i === 0 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
              <span style={{ flex: 1, fontSize: '12px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>{row.label}</span>
              {isCouple ? (
                <>
                  <div style={{ textAlign: 'right', minWidth: '140px' }}>
                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.4)', fontFamily: 'Inter', marginBottom: '6px', letterSpacing: '0.05em', fontWeight: 600 }}>{clientName}</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '20px', color: '#D32F2F', fontWeight: 600 }}>{fmt(row.clientNet)}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: '140px' }}>
                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.4)', fontFamily: 'Inter', marginBottom: '6px', letterSpacing: '0.05em', fontWeight: 600 }}>{spouseName}</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '20px', color: '#D32F2F', fontWeight: 600 }}>{fmt(row.spouseNet)}</div>
                  </div>
                </>
              ) : (
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '20px', color: '#D32F2F', fontWeight: 600 }}>{fmt(row.clientNet)}</span>
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
      <div style={{ background: 'rgba(255, 255, 255, 0.75)', backdropFilter: 'blur(40px) saturate(150%)', WebkitBackdropFilter: 'blur(40px) saturate(150%)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.9)', padding: '28px', marginBottom: '24px', boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#B99B6A', fontFamily: 'Inter', marginBottom: '20px', fontWeight: 700 }}>{name}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <SidebarRow label="D/TPD Need" value={dtpd.net} />
          <SidebarRow label="CI Need" value={ci.net} />
          
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '12px', marginTop: '4px' }}>
            <SidebarRow label="Existing Life" value={existLife} color="#347A5A" />
            <SidebarRow label="Existing CI" value={existCI} color="#347A5A" />
          </div>
          
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '12px', marginTop: '4px' }}>
            <SidebarRow label="Life Gap" value={lifeGap} color={lifeGap > 0 ? '#D32F2F' : '#347A5A'} />
            <SidebarRow label="CI Gap" value={ciGap} color={ciGap > 0 ? '#D32F2F' : '#347A5A'} />
          </div>
          
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '20px', marginTop: '8px', display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
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
      <span style={{ fontSize: '12px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', fontWeight: 500 }}>{label}</span>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: color ?? '#1A1A1A', fontWeight: 600 }}>{fmt(value)}</span>
    </div>
  )
}

function MiniBreakdown({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '9px', color: 'rgba(0,0,0,0.4)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: '#1A1A1A', marginTop: '6px', fontWeight: 600 }}>{fmt(value)}</div>
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
          <label style={{ display: 'block', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', marginBottom: '8px', fontWeight: 700 }}>{f.label}</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#1A1A1A', fontFamily: 'Inter', fontSize: '14px', fontWeight: 500 }}>$</span>
            <input
              type="number" min={0}
              value={(p[f.key as keyof ProtectionData] as number) ?? 0}
              onChange={e => updateP({ [f.key]: parseInt(e.target.value) || 0 })}
              style={{ ...inputStyle, paddingLeft: '32px', width: '100%', background: 'rgba(255,255,255,0.7)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.02)' }}
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(32, 30, 27, 0.4)', backdropFilter: 'blur(16px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(40px) saturate(150%)', borderRadius: '32px', padding: '48px', minWidth: '560px', maxWidth: '680px', border: '1px solid rgba(255,255,255,0.9)', boxShadow: '0 24px 80px rgba(0,0,0,0.15)', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '28px', fontWeight: 400, color: '#1A1A1A', margin: 0 }}>
            {EXPENSE_CATEGORY_LABELS[category]}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '32px', color: 'rgba(0,0,0,0.4)', lineHeight: 1, padding: '0 8px', transition: 'color 0.2s' }}>×</button>
        </div>
        <p style={{ fontSize: '13px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', marginBottom: '36px', fontWeight: 500 }}>
          {isCouple ? 'Tick under each person to include that expense in their protection calculation.' : 'Select which line items to include in the protection calculation.'}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 120px 120px' : '1fr 32px 120px', gap: '12px', padding: '0 16px 12px', borderBottom: '1px solid rgba(0,0,0,0.06)', marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.4)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Item</div>
          <div style={{ fontSize: '10px', color: '#A8834A', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', fontWeight: 700 }}>{clientName}</div>
          {isCouple && <div style={{ fontSize: '10px', color: '#2D5A4E', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', fontWeight: 700 }}>{spouseName}</div>}
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
                  gap: '12px', padding: '16px', borderRadius: '16px',
                  background: rowActive ? 'rgba(255, 255, 255, 0.7)' : 'transparent', alignItems: 'center',
                  border: rowActive ? '1px solid rgba(255,255,255,0.9)' : '1px solid transparent', transition: 'all 0.2s',
                  boxShadow: rowActive ? '0 4px 16px rgba(0,0,0,0.03)' : 'none' }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontFamily: 'Inter', color: '#1A1A1A', marginBottom: '6px', fontWeight: 500 }}>{DETAILED_EXPENSE_LABELS[key]}</div>
                  {total > 0 && (
                    <div style={{ fontSize: '12px', color: 'rgba(0,0,0,0.5)', fontFamily: 'DM Mono, monospace' }}>
                      {isCouple
                        ? `${fmt(clientVal)} (${clientPct}%) · ${fmt(spouseVal)} (${spousePct}%)`
                        : `${fmt(clientVal)}/yr`}
                    </div>
                  )}
                </div>

                {isCouple ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }} onClick={() => toggleClient(key)}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '6px', cursor: 'pointer',
                      background: clientOn ? '#B99B6A' : 'rgba(255,255,255,0.8)',
                      border: `1px solid ${clientOn ? '#B99B6A' : 'rgba(0,0,0,0.1)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                      boxShadow: clientOn ? '0 2px 6px rgba(185, 155, 106, 0.3)' : 'inset 0 1px 3px rgba(0,0,0,0.05)' }}>
                      {clientOn && <span style={{ color: '#fff', fontSize: '14px', lineHeight: 1, fontWeight: 800 }}>✓</span>}
                    </div>
                    {clientVal > 0 && <div style={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', color: '#A8834A', fontWeight: 600 }}>{fmt(clientVal)}</div>}
                  </div>
                ) : (
                  <div style={{ width: '24px', height: '24px', borderRadius: '6px', cursor: 'pointer', margin: '0 auto',
                    background: clientOn ? '#B99B6A' : 'rgba(255,255,255,0.8)',
                    border: `1px solid ${clientOn ? '#B99B6A' : 'rgba(0,0,0,0.1)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                    boxShadow: clientOn ? '0 2px 6px rgba(185, 155, 106, 0.3)' : 'inset 0 1px 3px rgba(0,0,0,0.05)' }}
                    onClick={() => toggleItem(key)}>
                    {clientOn && <span style={{ color: '#fff', fontSize: '14px', lineHeight: 1, fontWeight: 800 }}>✓</span>}
                  </div>
                )}

                {isCouple && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }} onClick={() => toggleSpouse(key)}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '6px', cursor: 'pointer',
                      background: spouseOn ? '#347A5A' : 'rgba(255,255,255,0.8)',
                      border: `1px solid ${spouseOn ? '#347A5A' : 'rgba(0,0,0,0.1)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                      boxShadow: spouseOn ? '0 2px 6px rgba(52, 122, 90, 0.3)' : 'inset 0 1px 3px rgba(0,0,0,0.05)' }}>
                      {spouseOn && <span style={{ color: '#fff', fontSize: '14px', lineHeight: 1, fontWeight: 800 }}>✓</span>}
                    </div>
                    {spouseVal > 0 && <div style={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', color: '#2D5A4E', fontWeight: 600 }}>{fmt(spouseVal)}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: '32px', padding: '24px 28px', background: 'rgba(255, 255, 255, 0.7)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.9)', boxShadow: '0 8px 24px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'rgba(0,0,0,0.6)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Selected Total</span>
            {isCouple ? (
              <div style={{ display: 'flex', gap: '40px' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: '#A8834A', fontFamily: 'Inter', marginBottom: '6px', fontWeight: 700 }}>{clientName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(selectedClientTotal)}/yr</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: '#2D5A4E', fontFamily: 'Inter', marginBottom: '6px', fontWeight: 700 }}>{spouseName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(selectedSpouseTotal)}/yr</div>
                </div>
              </div>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '20px', color: '#1A1A1A', fontWeight: 600 }}>{fmt(selectedClientTotal)}/yr</span>
            )}
          </div>
        </div>

        <div style={{ marginTop: '40px', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '16px 40px', background: '#1A1A1A', color: '#FFFFFF', border: 'none', borderRadius: '12px', cursor: 'pointer', fontFamily: 'Inter', fontSize: '15px', fontWeight: 500, transition: 'background 0.2s', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
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
        <div style={{ width: '3px', height: '18px', background: color, borderRadius: '2px' }} />
        <span style={{ fontSize: '12px', letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: 'Inter', fontWeight: 600, color: 'rgba(0,0,0,0.6)' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function PersonSlider({ label, value, onChange, color, unit = '%' }: { label: string; value: number; onChange: (v: number) => void; color: string; unit?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', fontWeight: 700 }}>{label}</span>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '15px', color, fontWeight: 700 }}>
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
        width: '52px', height: '28px', borderRadius: '16px', cursor: 'pointer', transition: 'background 0.3s ease',
        background: value ? '#B99B6A' : 'rgba(0,0,0,0.08)', position: 'relative', flexShrink: 0,
        boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.05)'
      }}
    >
      <div style={{
        position: 'absolute', top: '3px', left: value ? '27px' : '3px', width: '22px', height: '22px',
        borderRadius: '50%', background: '#FFFFFF', transition: 'left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        boxShadow: '0 2px 6px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.1)',
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
      <div style={{ display: 'flex', padding: '24px 32px', background: 'transparent', borderBottom: breakdown ? '1px solid rgba(0,0,0,0.06)' : 'none', alignItems: 'center' }}>
        <span style={{ flex: 1, fontSize: '15px', color: '#1A1A1A', fontFamily: 'Inter', fontWeight: 600 }}>{label}</span>
        {isCouple ? (
          <>
            <div style={{ textAlign: 'right', minWidth: '150px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', marginBottom: '8px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>{clientName}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '24px', color: '#1A1A1A', fontWeight: 600, letterSpacing: '-0.02em' }}>{fmt(clientData)}</div>
            </div>
            <div style={{ textAlign: 'right', minWidth: '150px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', marginBottom: '8px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>{spouseName}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '24px', color: '#1A1A1A', fontWeight: 600, letterSpacing: '-0.02em' }}>{fmt(spouseData)}</div>
            </div>
          </>
        ) : (
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '24px', color: '#1A1A1A', fontWeight: 600, letterSpacing: '-0.02em' }}>{fmt(clientData)}</span>
        )}
      </div>
      {breakdown && (
        <div style={{ display: 'flex', gap: 0, background: 'rgba(255, 255, 255, 0.5)' }}>
          {(['fd', 'mort', 'edu'] as const).map((key, i) => {
            const labels = { fd: 'Family Dep.', mort: 'Mortgage', edu: 'Education' }
            return (
              <div key={key} style={{ flex: 1, padding: '20px 32px', borderRight: i !== 2 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
                <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', fontWeight: 700 }}>{labels[key]}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '15px', color: '#1A1A1A', fontWeight: 500 }}>{fmt(breakdown.client[key])}</div>
                {isCouple && <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '15px', color: 'rgba(0,0,0,0.6)', marginTop: '6px', fontWeight: 500 }}>{fmt(breakdown.spouse[key])}</div>}
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
  color: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', marginBottom: '12px', fontWeight: 700
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '14px 16px', fontFamily: 'Inter', fontSize: '14px',
  color: '#1A1A1A', background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(255,255,255,0.9)',
  borderRadius: '12px', outline: 'none', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)', fontWeight: 500,
  transition: 'all 0.2s'
}
