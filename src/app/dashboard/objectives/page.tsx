'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useUniCosts, UNI_COST_DEFAULTS as UNI_COST_FALLBACK } from '@/hooks/useUniCosts'
import WealthAccumulationSection, { AccumulationData, WealthGoal } from './WealthAccumulation'
import RetirementSection, { RetirementData, DEFAULT_RETIREMENT_DATA } from './RetirementSection'
import EducationSection, { EducationData, DEFAULT_EDUCATION_DATA } from './EducationSection'
import EstateSection, { EstateData, DEFAULT_ESTATE_DATA } from './EstateSection'

// Module-level fallback so sub-components can access defaults before hook loads
let UNI_COST_DEFAULTS = UNI_COST_FALLBACK

// ─── INTERFACES ─────────────────────────────────────────────────────────────

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
  dob?: string
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
  properties?: any[]
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
  fdModeClient?: 'own' | 'combined'
  fdModeSpouse?: 'own' | 'combined'
  coverageTermOverride?: number
  mortgageCoverPcts?: number[]
  mortgageCoverPctsClient?: number[]
  mortgageCoverPctsSpouse?: number[]
  nonMortgageDebts?: { id: string; debtType: string; label: string; amount: number; interestRate: number; tenureLeft: number; owner: 'client' | 'spouse' | 'joint' }[]
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
  // Medical & Disability tab entries (keyed by personId: 'client' | 'spouse' | family_member id)
  medicalEntries?: Record<string, MedDisEntry[]>
  ltcEntries?: Record<string, MedDisEntry[]>
  // General tab entries
  paEntries?: Record<string, MedDisEntry[]>
  groupEntries?: Array<{
    id: string; person: string; employerName: string
    coverageTypes: string[]; // 'GTL' | 'GH' | 'GPA' | 'GCI'
    sumAssuredGTL?: number; sumAssuredGCI?: number
    annualBenefitGH?: number; sumAssuredGPA?: number
    notes?: string
  }>
  otherProtectionPerson?: 'client' | 'spouse'
  // ── CHANGE 1: Asset offset controls ──────────────────────────────────────
  assetOffsetEnabled?: boolean
  assetOffsetItems?: {
    liquid?: boolean
    cpf?: boolean
    property?: boolean
  }
  ciCalcMode?: 'expenses' | 'income' | 'capital' | 'custom'
  ciCustomAmountClient?: number; ciCustomAmountSpouse?: number
  // Income Replacement mode
  ciIncomePctClient?: number; ciIncomePctSpouse?: number
  ciIncludeMortgageInIncome?: boolean
  ciIncludeEduInIncome?: boolean
  // Legacy — kept for backward compat but no longer used in UI
  ciIncludeIncomeReplacement?: boolean
  ciIncomeMonthsClient?: number; ciIncomeMonthsSpouse?: number
  ciIncludeMedicalBuffer?: boolean
  ciMedicalBufferClient?: number; ciMedicalBufferSpouse?: number
  ciIncludeRecoveryBuffer?: boolean
  ciRecoveryBufferClient?: number; ciRecoveryBufferSpouse?: number
}

interface MedDisEntry {
  id: string
  companyName: string
  companyId?: number
  productName: string
  productId?: number
  policyTypeCode?: string   // 'main' | 'rider' for medical; unused for LTC/PA
  wardClass?: string        // medical main only
  hasRider?: boolean        // medical main only
  briefDescription?: string
  sumAssured?: number       // PA
  monthlyBenefit?: number   // LTC
  benefitPeriod?: string    // LTC
  premiumCash?: number
  premiumMedisave?: number
  portfolioId?: string      // set after "Add to Portfolio" — the UUID of the created policy
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
  return Math.max(0, new Date().getFullYear() - birth.getFullYear())
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

// ── CHANGE 2: getAssetOffset respects master switch + per-category toggles ──
function getAssetOffset(ff: FactFinding, prefix: 'client' | 'spouse', type: 'dtpd' | 'ci', p?: ProtectionData): number {
  // Master switch — if disabled, offset is zero
  if (p?.assetOffsetEnabled === false) return 0

  const items = p?.assetOffsetItems ?? {}
  const liquidEnabled = items.liquid !== false
  const cpfEnabled = items.cpf !== false
  const propertyEnabled = items.property !== false

  const ap = prefix === 'spouse' ? 'a2_' : 'a_'

  const liquid = liquidEnabled
    ? (ff[`${ap}savings`] as number || 0) +
      (ff[`${ap}fixed_deposit`] as number || 0) +
      (ff[`${ap}srs`] as number || 0) +
      (ff[`${ap}shares`] as number || 0) +
      (ff[`${ap}etf`] as number || 0) +
      (ff[`${ap}unit_trust`] as number || 0) +
      (ff[`${ap}bonds`] as number || 0) +
      (ff[`${ap}alternatives`] as number || 0)
    : 0

  if (type === 'ci') return liquid

  const cpf = cpfEnabled
    ? (ff[`${ap}cpf_oa`] as number || 0) +
      (ff[`${ap}cpf_sa`] as number || 0) +
      (ff[`${ap}cpf_ma`] as number || 0) +
      (ff[`${ap}cpf_ra`] as number || 0)
    : 0

  if (!propertyEnabled) return liquid + cpf

  // All properties: full property value × mortgage slider pct for this person
  const properties = (ff.properties ?? []) as any[]
  const mortgageProps = properties.filter((prop: any) => prop.initialLoanAmount || prop.outstanding || prop.monthlyRepayment)
  const propertyValue = properties.reduce((sum: number, prop: any) => {
    const val = prop.propertyValue ?? prop.purchasePrice ?? 0
    const mortgageIdx = mortgageProps.findIndex((m: any) => m.id === prop.id)
    if (mortgageIdx === -1) {
      const ot = prop.ownershipType ?? ''
      let pct = 1
      if (ot === 'Spouse Only') pct = prefix === 'spouse' ? 1 : 0
      else if (ot === 'Joint Tenancy') pct = 0.5
      else if (ot === 'Tenancy-in-Common') {
        const parts = (prop.ownershipSplit ?? '50/50').split('/')
        pct = prefix === 'client' ? (parseFloat(parts[0]) / 100 || 0.5) : (parseFloat(parts[1]) / 100 || 0.5)
      } else pct = prefix === 'client' ? 1 : 0
      return sum + val * pct
    }
    const pcts = prefix === 'client' ? (p?.mortgageCoverPctsClient ?? []) : (p?.mortgageCoverPctsSpouse ?? [])
    const pct = (pcts[mortgageIdx] ?? 100) / 100
    return sum + val * pct
  }, 0)

  return liquid + cpf + propertyValue
}

function calcAmortizedBalance(initialLoan: number, annualRate: number, tenureYears: number, startMmYyyy: string): number {
  if (!initialLoan || !tenureYears) return 0
  const parts = startMmYyyy.split('/')
  if (parts.length !== 2) return initialLoan
  const startDate = new Date(parseInt(parts[1]), parseInt(parts[0]) - 1, 1)
  const today = new Date()
  const monthsElapsed = (today.getFullYear() - startDate.getFullYear()) * 12 + (today.getMonth() - startDate.getMonth())
  if (monthsElapsed <= 0) return initialLoan
  const n = tenureYears * 12
  if (monthsElapsed >= n) return 0
  if (!annualRate) return Math.round(initialLoan * (1 - monthsElapsed / n))
  const r = annualRate / 100 / 12
  const pmt = initialLoan * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
  return Math.max(0, Math.round(initialLoan * Math.pow(1 + r, monthsElapsed) - pmt * (Math.pow(1 + r, monthsElapsed) - 1) / r))
}
// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

function ObjectivesPageInner() {
  const supabase = createClient()
  const { uniCosts: _uniCosts } = useUniCosts()
  UNI_COST_DEFAULTS = _uniCosts
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState('Client')
  const [spouseName, setSpouseName] = useState('Spouse')
  const [clientDOB, setClientDOB] = useState<string | undefined>()
  const [spouseDOB, setSpouseDOB] = useState<string | undefined>()
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
    // ── CHANGE 3: default both flags to true so existing clients are unaffected ──
    assetOffsetEnabled: true,
    assetOffsetItems: { liquid: true, cpf: true, property: true },
    ciCalcMode: 'expenses',
    ciCustomAmountClient: 0, ciCustomAmountSpouse: 0,
    ciIncomePctClient: 100, ciIncomePctSpouse: 100,
    ciIncludeMortgageInIncome: true,
    ciIncludeEduInIncome: false,
    ciIncludeIncomeReplacement: false,
    ciIncomeMonthsClient: 24, ciIncomeMonthsSpouse: 24,
    ciIncludeMedicalBuffer: false,
    ciMedicalBufferClient: 50000, ciMedicalBufferSpouse: 50000,
    ciIncludeRecoveryBuffer: false,
    ciRecoveryBufferClient: 30000, ciRecoveryBufferSpouse: 30000,
  })
  const [children, setChildren] = useState<FamilyMember[]>([])
  const [allFamilyMembers, setAllFamilyMembers] = useState<FamilyMember[]>([])
  const searchParams = useSearchParams()
  const [activeSection, setActiveSection] = useState(() => {
    const t = searchParams.get('tab')
    const n = t !== null ? parseInt(t, 10) : 0
    return isNaN(n) ? 0 : Math.min(Math.max(n, 0), 4)
  })
  const [acc, setAcc] = useState<AccumulationData>({
    inflationRate: 3,
    returnRate: 5,
    emergencyTargetMonths: 6,
    goals: [],
    advisorNotes: '',
  })
  const accSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ret, setRet] = useState<RetirementData>(DEFAULT_RETIREMENT_DATA)
  const retSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
const [edu, setEdu] = useState<EducationData>(DEFAULT_EDUCATION_DATA)
const eduSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
const [estate, setEstate] = useState<EstateData>(DEFAULT_ESTATE_DATA)
const estateSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState<{ open: boolean; category: string }>({ open: false, category: '' })
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [insCompanies, setInsCompanies] = useState<{id: number; name: string; category_id: number}[]>([])
  const [insProducts, setInsProducts] = useState<{id: number; name: string; company_id: number; category_id: number}[]>([])
  const [insCategories, setInsCategories] = useState<{id: number; code: string}[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const needsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── LOAD DATA ─────────────────────────────────────────────────────────────

  useEffect(() => {
    // Try localStorage first, fall back to auth-based lookup
    const id = localStorage.getItem('selectedClientId')
    if (id) {
      setClientId(id)
      loadData(id)
    } else {
      // Fall back: get most recent client for this advisor
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
  console.log('🚀 loadData started for client ID:', id)
  setLoading(true)
  // Load BOTH financials and protection_needs data
  const { data: ffRows } = await supabase
    .from('fact_finding')
    .select('*')
    .eq('client_id', id)
  .in('section', ['financials', 'protection_needs', 'protection_portfolio', 'accumulation', 'retirement', 'education', 'estate'])
    
  if (ffRows && ffRows.length > 0) {
  const merged: FactFinding = { client_id: id }
  
  // Log each row to see what data we have
  console.log('=== LOADING DATA ===')
  for (const row of ffRows) {
    console.log(`Section: ${row.section}`, row.data)
    Object.assign(merged, row.data || {})
  }
  
  console.log('=== MERGED DATA ===', merged)
  console.log('s_financial:', merged.s_financial)
  console.log('s_mortgage:', merged.s_mortgage)
  console.log('s_household:', merged.s_household)

   // Load accumulation data
    const accRow = ffRows.find((r: any) => r.section === 'accumulation')
    if (accRow?.data?.acc) {
      setAcc((prev: AccumulationData) => ({ ...prev, ...accRow.data.acc }))
    }
    const retRow = ffRows.find((r: any) => r.section === 'retirement')
if (retRow?.data?.ret) setRet((prev: RetirementData) => ({ ...prev, ...retRow.data.ret }))

const eduRow = ffRows.find((r: any) => r.section === 'education')
if (eduRow?.data?.edu) setEdu((prev: EducationData) => ({ ...prev, ...eduRow.data.edu }))

const estateRow = ffRows.find((r: any) => r.section === 'estate')
if (estateRow?.data?.estate) setEstate((prev: EstateData) => ({ ...prev, ...estateRow.data.estate }))

    // ── CHANGE 4: load saved assetOffsetEnabled/assetOffsetItems with safe defaults ──
    const protRow = ffRows.find((r: any) => r.section === 'protection_needs')
    const protData = protRow?.data?.protection
    if (protData) {
      setP(prev => ({
        ...prev,
        ...protData,
        assetOffsetEnabled: protData.assetOffsetEnabled !== undefined ? protData.assetOffsetEnabled : true,
        assetOffsetItems: protData.assetOffsetItems ?? { liquid: true, cpf: true, property: true },
        ciCalcMode: ((protData.ciCalcMode === 'calculate' ? 'expenses' : protData.ciCalcMode) ?? 'expenses') as 'expenses' | 'income' | 'capital' | 'custom',
        ciCustomAmountClient: protData.ciCustomAmountClient ?? 0,
        ciCustomAmountSpouse: protData.ciCustomAmountSpouse ?? 0,
        ciIncomePctClient: protData.ciIncomePctClient ?? 100,
        ciIncomePctSpouse: protData.ciIncomePctSpouse ?? 100,
        ciIncludeMortgageInIncome: protData.ciIncludeMortgageInIncome !== undefined ? protData.ciIncludeMortgageInIncome : true,
        ciIncludeEduInIncome: protData.ciIncludeEduInIncome ?? false,
        ciIncludeIncomeReplacement: protData.ciIncludeIncomeReplacement ?? false,
        ciIncomeMonthsClient: protData.ciIncomeMonthsClient ?? 24,
        ciIncomeMonthsSpouse: protData.ciIncomeMonthsSpouse ?? 24,
        ciIncludeMedicalBuffer: protData.ciIncludeMedicalBuffer ?? false,
        ciMedicalBufferClient: protData.ciMedicalBufferClient ?? 50000,
        ciMedicalBufferSpouse: protData.ciMedicalBufferSpouse ?? 50000,
        ciIncludeRecoveryBuffer: protData.ciIncludeRecoveryBuffer ?? false,
        ciRecoveryBufferClient: protData.ciRecoveryBufferClient ?? 30000,
        ciRecoveryBufferSpouse: protData.ciRecoveryBufferSpouse ?? 30000,
      }))
    }
    setFf(merged)
    const portfolioRow = ffRows.find((r: any) => r.section === 'protection_portfolio')
const allPolicies: any[] = portfolioRow?.data?.risk_management?.policies ?? []
const activePols = allPolicies.filter((pol: any) => ['In-Force', 'Premium Holiday', 'Paid-up'].includes(pol.status))
const toSGDVal = (val: number, pol: any) => pol.isUSD ? val * (pol.fxRate || 1.35) : val
const calcLifeHave = (person: string) => activePols
  .filter((pol: any) => pol.person === person && pol.categoryCode === 'life')
  .reduce((s: number, pol: any) => {
    const mult = (pol.multiplier || 1)
    return s + toSGDVal(Math.max((pol.baseDeath || 0) * mult, pol.sumAssured || 0), pol)
  }, 0)
const calcCIHave = (person: string) => activePols
  .filter((pol: any) => pol.person === person && pol.categoryCode === 'life')
  .reduce((s: number, pol: any) => {
    const mult = (pol.multiplier || 1)
    return s + toSGDVal(Math.max((pol.baseAdvCI || 0) * mult, (pol.baseEarlyCI || 0) * mult), pol)
  }, 0)
setP(prev => ({
  ...prev,
  existingLifeCoverClient: calcLifeHave('client'),
  existingLifeCoverSpouse: calcLifeHave('spouse'),
  existingCICoverClient: calcCIHave('client'),
  existingCICoverSpouse: calcCIHave('spouse'),
}))
  }
    // Load client name and DOB
const { data: clientData } = await supabase
  .from('clients')
  .select('name, dob')
  .eq('id', id)
  .single()
if (clientData) {
  setClientName(clientData.name || 'Client')
  setClientDOB(clientData.dob)
}
    // Load family members - spouse name + children
   const { data: familyData } = await supabase
  .from('family_members')
  .select('*')
  .eq('client_id', id)
    if (familyData) {
  const spouse = familyData.find((f: any) => f.relationship === 'Spouse')
  if (spouse) {
  setSpouseName(spouse.name || 'Spouse')
  setSpouseDOB(spouse.dob)
}
  const kids = familyData.filter((f: any) => ['Daughter','Son','Child'].includes(f.relationship))
  setChildren(kids)
  // All non-spouse family members as dependents
  const deps = familyData.filter((f: any) => f.relationship !== 'Spouse')
  setAllFamilyMembers(deps)
}

    // Load insurance reference data
    const [{ data: comps }, { data: prods }, { data: cats }] = await Promise.all([
      supabase.from('ins_companies').select('*').eq('active', true).order('sort_order'),
      supabase.from('ins_products').select('*').eq('active', true).order('sort_order'),
      supabase.from('ins_categories').select('id, code').order('sort_order'),
    ])
    if (comps) setInsCompanies(comps)
    if (prods) setInsProducts(prods)
    if (cats)  setInsCategories(cats)
 setLoading(false)
  }

  // ─── ACCUMULATION SAVE ─────────────────────────────────────────────────────

 function scheduleAccSave(updated: AccumulationData) {
    if (accSaveTimer.current) clearTimeout(accSaveTimer.current)
    accSaveTimer.current = setTimeout(async () => {
      if (!clientId) return
      await supabase
        .from('fact_finding')
        .upsert(
          { client_id: clientId, section: 'accumulation', data: { acc: updated }, updated_at: new Date().toISOString() },
          { onConflict: 'client_id,section' }
        )
    }, 800)
  }
  function scheduleRetSave(updated: RetirementData, computedValues?: { corpus: number; gap: number; monthly: number }) {
  if (retSaveTimer.current) clearTimeout(retSaveTimer.current)
  retSaveTimer.current = setTimeout(async () => {
    if (!clientId) return
    
    const dataToSave: any = { ret: updated }
    
    if (computedValues) {
      dataToSave.corpusNeeded = computedValues.corpus
      dataToSave.retirementGap = computedValues.gap
      dataToSave.monthlySavingsNeeded = computedValues.monthly
    }
    
    await supabase
      .from('fact_finding')
      .upsert(
        { 
          client_id: clientId, 
          section: 'retirement', 
          data: dataToSave,
          updated_at: new Date().toISOString() 
        },
        { onConflict: 'client_id,section' }
      )
  }, 800)
}
  function scheduleEduSave(updated: EducationData) {
    if (eduSaveTimer.current) clearTimeout(eduSaveTimer.current)
    eduSaveTimer.current = setTimeout(async () => {
      if (!clientId) return
      await supabase
        .from('fact_finding')
        .upsert(
          { client_id: clientId, section: 'education', data: { edu: updated }, updated_at: new Date().toISOString() },
          { onConflict: 'client_id,section' }
        )
    }, 800)
  }

  function scheduleEstateSave(updated: EstateData, netEstate?: number) {
  if (estateSaveTimer.current) clearTimeout(estateSaveTimer.current)
  estateSaveTimer.current = setTimeout(async () => {
    if (!clientId) return
    
    const dataToSave: any = { estate: updated }
    
    if (netEstate !== undefined) {
      dataToSave.netEstate = netEstate
    }
    
    await supabase
      .from('fact_finding')
      .upsert(
        { client_id: clientId, section: 'estate', data: dataToSave, updated_at: new Date().toISOString() },
        { onConflict: 'client_id,section' }
      )
  }, 800)
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
          { client_id: clientId, section: 'protection_needs', data: { protection: updated }, updated_at: new Date().toISOString() },
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

  async function addToPortfolio(policy: Partial<{
    categoryCode: string; policyTypeCode: string; companyName: string; productName: string
    briefDescription: string; sumAssured: number; monthlyBenefit: number
    premiumCash: number; premiumMedisave: number; frequency: string
    premiumMaturity: string; coverageMaturity: string; status: string
    person: string; benefitTerm: string
  }>) {
    if (!clientId) return
    // Load current portfolio
    const { data: rows } = await supabase
      .from('fact_finding')
      .select('data')
      .eq('client_id', clientId)
      .eq('section', 'protection_portfolio')
      .order('updated_at', { ascending: false })
      .limit(1)
    const existing = rows?.[0]?.data ?? {}
    const existingPolicies: any[] = existing?.risk_management?.policies ?? []
    const resolvedPerson = (() => {
      const raw = policy.person ?? 'client'
      if (raw === 'client' || raw === 'spouse') return raw
      const dep = allFamilyMembers.find(f => f.id === raw)
      return dep ? `child_${dep.id || dep.name}` : raw
    })()
    const { person: _personRaw, ...policyRest } = policy
    const newPolicy = {
      id: crypto.randomUUID(),
      categoryCode: '', policyTypeCode: '', companyName: '', productName: '',
      policyholder: '', lifeAssured: '',
      policyNo: '', briefDescription: '',
      baseDeath: 0, baseTPD: 0, baseAdvCI: 0, baseEarlyCI: 0,
      sumAssured: 0, monthlyBenefit: 0, deferredPeriod: '',
      benefitTerm: '', payoutTerm: '', multiplier: 0, multiplierEnd: 0,
      coverStep: 0, stepDownPct: 0, currentCashValue: 0,
      endowDeathMode: '$', endowTPDMode: '$',
      premiumMedisave: 0, premiumCash: 0,
      premiumMode: policy.premiumMedisave ? 'Medisave' : 'Cash',
      frequency: 'Annual',
      inceptionDate: '', premiumMaturity: 'Renewable', coverageMaturity: 'Renewable',
      status: 'In-Force', remarks: '',
      isUSD: false, fxRate: 1.35,
      ...policyRest,
      person: resolvedPerson,
    }
    const updatedPolicies = [...existingPolicies, newPolicy]
    await supabase.from('fact_finding').upsert(
      { client_id: clientId, section: 'protection_portfolio', data: { ...existing, risk_management: { ...(existing.risk_management ?? {}), policies: updatedPolicies } }, updated_at: new Date().toISOString() },
      { onConflict: 'client_id,section' }
    )
    return newPolicy.id
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

  // Coverage term
  const childAges = children.map(c => c.age ?? getAge(c.date_of_birth))
  const youngestAge = childAges.length > 0 ? Math.min(...childAges) : null
const coverageTerm = (() => {
  if (youngestAge === null) return p.coverageTermOverride ?? 20
  const eduKids = p.educationChildren ?? []
  const terms = children.map(c => {
    const ec = eduKids.find(e => e.childId === c.id)
    const childAge = c.age ?? getAge(c.date_of_birth)
    const defaultEntry = c.gender === 'Male' ? 21 : 19
    const entryAge = ec?.uniEntryAge ?? defaultEntry
    const duration = ec?.courseDuration ?? 4
    const gradAge = entryAge + duration
    return Math.max(0, gradAge - childAge)
  })
  return terms.length > 0 ? Math.max(...terms) : (p.coverageTermOverride ?? 20)
})()

  // Default cover pcts based on expense share
  const defaultClientPct = annExpTotal > 0 ? (annExpClient / annExpTotal * 100) : 100
  const defaultSpousePct = annExpTotal > 0 ? (annExpSpouse / annExpTotal * 100) : 100

  const clientCoverPct = !isCouple ? 1 : (p.expenseCoverPctClient ?? defaultClientPct) / 100
  const spouseCoverPct = (p.expenseCoverPctSpouse ?? defaultSpousePct) / 100

  // Family dependency
  function calcFamilyDep(annExp: number, coverPct: number, years: number): number {
    return fv(inflation, years, annExp * coverPct)
  }

  // Mortgage coverage
  function calcMortgageForPerson(who: 'client' | 'spouse'): number {
    const mortgages: MortgageProperty[] = (ff.properties ?? [])
    .filter((prop: any) => prop.initialLoanAmount || prop.outstanding || prop.monthlyRepayment)
    .map((prop: any) => {
      const startDate = prop.loanStartDate ?? ''
      const initialTenure = prop.initialTenure ?? 25
      const interestRate = prop.interestRate ?? 0
      const initialLoan = prop.initialLoanAmount ?? prop.outstanding ?? 0
      // PMT calc for monthly repayment if not stored
      function pmtCalc(principal: number, annRate: number, years: number): number {
        if (years <= 0 || principal <= 0) return 0
        if (annRate === 0) return principal / (years * 12)
        const r = annRate / 100 / 12; const n = years * 12
        return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
      }
      // Calculate remaining tenure from start date if not overridden
      let remainingTenure = prop.remainingTenure ?? initialTenure
      if (!prop.remainingTenure && startDate) {
        const [mm, yyyy] = startDate.split('/')
        if (mm && yyyy) {
          const start = new Date(parseInt(yyyy), parseInt(mm)-1)
          const now = new Date()
          const elapsedYears = (now.getTime() - start.getTime()) / (1000*60*60*24*365.25)
          remainingTenure = Math.max(0, Math.round(initialTenure - elapsedYears))
        }
      }
      const outstanding = prop.outstanding ?? calcAmortizedBalance(initialLoan, interestRate, initialTenure, startDate)
      const monthlyRepayment = prop.monthlyRepayment ?? pmtCalc(initialLoan, interestRate, initialTenure)
      return {
        id: prop.id,
        label: prop.label || 'Property',
        outstanding: outstanding,
        interestRate: interestRate,
        monthlyRepayment: monthlyRepayment,
        tenure: initialTenure,
        initialLoanAmount: initialLoan,
        initialTenure: initialTenure,
        loanStartDate: startDate,
        remainingTenure: remainingTenure,
      }
    })
    const mortgageTotal = mortgages.reduce((sum, m, i) => {
      const pcts = who === 'client' ? (p.mortgageCoverPctsClient ?? []) : (p.mortgageCoverPctsSpouse ?? [])
      const pct = !isCouple ? 1 : (pcts[i] ?? 100) / 100
      return sum + m.outstanding * pct
    }, 0)
    // Add non-mortgage debts (outstanding balance for D/TPD)
    const debtTotal = (p.nonMortgageDebts ?? []).reduce((sum, d) => {
      const owner = (d as any).owner ?? 'client'
      if (!isCouple) return sum + d.amount
      if (owner === 'joint') return sum + d.amount * 0.5
      if (owner === who) return sum + d.amount
      return sum
    }, 0)
    return mortgageTotal + debtTotal
  }

  // Education fund — FV-based calculation
  function calcEducationForPerson(who: 'client' | 'spouse', ciMode = false): number {
    if (!p.provideEducationFund) return 0
    const eduKids = p.educationChildren ?? []
    const livingInflation = inflation
    return children.reduce((sum, child) => {
      const ec = eduKids.find(e => e.childId === child.id)
      if (!ec) return sum
      const childAge = child.age ?? getAge(child.date_of_birth)
      const defaultEntryAge = child.gender === 'Male' ? 21 : 19
      const uniEntryAge = ec.uniEntryAge ?? defaultEntryAge
      if (ciMode && childAge >= uniEntryAge) return sum
      const yearsToUni = Math.max(0, uniEntryAge - childAge)
      const uniInfo = UNI_COST_DEFAULTS[ec.uniType ?? 'sg_local']
      const baseTuition = ec.annualTuition ?? uniInfo.annual_tuition
      const baseLiving = ec.annualLiving ?? uniInfo.annual_living
      const dur = ec.courseDuration ?? uniInfo.default_duration ?? 4
      const fvTuition = baseTuition * Math.pow(1.05, yearsToUni) * dur
      const fvLiving = baseLiving * Math.pow(1 + livingInflation, yearsToUni) * dur
      const pct = !isCouple ? 1 : (who === 'client' ? (ec.coverPctClient ?? 50) : (ec.coverPctSpouse ?? 50)) / 100
      return sum + (fvTuition + fvLiving) * pct
    }, 0)
  }

  // CI calcs
  function calcCIFamilyDep(annExp: number, coverPct: number): number {
    return fv(inflation, p.ciYears ?? 5, annExp * coverPct)
  }

  function calcCIMortgage(who: 'client' | 'spouse'): number {
    const mortgages: MortgageProperty[] = (ff.properties ?? [])
    .filter((prop: any) => prop.initialLoanAmount || prop.outstanding || prop.monthlyRepayment)
        .map((prop: any) => {
      const startDate = prop.loanStartDate ?? ''
      const initialTenure = prop.initialTenure ?? 25
      const interestRate = prop.interestRate ?? 0
      const initialLoan = prop.initialLoanAmount ?? prop.outstanding ?? 0
      const outstanding = prop.outstanding ?? calcAmortizedBalance(initialLoan, interestRate, initialTenure, startDate)
      
      let monthlyRepayment = prop.monthlyRepayment
      if (!monthlyRepayment && initialLoan > 0 && initialTenure > 0) {
        if (interestRate === 0) {
          monthlyRepayment = initialLoan / (initialTenure * 12)
        } else {
          const r = interestRate / 100 / 12
          const n = initialTenure * 12
          monthlyRepayment = initialLoan * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1)
        }
      }
      
      let remainingTenure = prop.remainingTenure ?? initialTenure
      if (!prop.remainingTenure && startDate) {
        const [mm, yyyy] = startDate.split('/')
        if (mm && yyyy) {
          const start = new Date(parseInt(yyyy), parseInt(mm)-1)
          const now = new Date()
          const elapsedYears = (now.getTime() - start.getTime()) / (1000*60*60*24*365.25)
          remainingTenure = Math.max(0, Math.round(initialTenure - elapsedYears))
        }
      }
      
      return {
        id: prop.id,
        label: prop.label || 'Property',
        outstanding: outstanding,
        interestRate: interestRate,
        monthlyRepayment: monthlyRepayment || 0,
        tenure: initialTenure,
        initialLoanAmount: initialLoan,
        initialTenure: initialTenure,
        loanStartDate: startDate,
        remainingTenure: remainingTenure,
      }
    })
    const ciYrs = p.ciYears ?? 5
    const mortgageCI = mortgages.reduce((sum, m, i) => {
      const pcts = who === 'client' ? (p.mortgageCoverPctsClient ?? []) : (p.mortgageCoverPctsSpouse ?? [])
      const pct = !isCouple ? 1 : (pcts[i] ?? 100) / 100
      return sum + m.monthlyRepayment * 12 * ciYrs * pct
    }, 0)
    const debtCI = (p.nonMortgageDebts ?? []).reduce((sum, d) => {
      const owner = (d as any).owner ?? 'client'
      let applies = false
      if (!isCouple) applies = true
      else if (owner === 'joint') applies = true
      else if (owner === who) applies = true
      if (!applies) return sum
      const monthlyPmt = calcDebtPMT(d.amount, d.interestRate, d.tenureLeft)
      const coverYears = Math.min(d.tenureLeft, ciYrs)
      const split = (!isCouple || owner !== 'joint') ? 1 : 0.5
      return sum + monthlyPmt * 12 * coverYears * split
    }, 0)
    return mortgageCI + debtCI
  }

  function calcDebtPMT(amount: number, annualRate: number, years: number): number {
    if (years <= 0 || amount <= 0) return 0
    if (annualRate === 0) return amount / (years * 12)
    const r = annualRate / 100 / 12
    const n = years * 12
    return amount * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
  }

  // Full needs
  function calcDTPDNeed(who: 'client' | 'spouse'): { gross: number; assets: number; net: number; fd: number; mort: number; edu: number } {
    const fdMode = who === 'client' ? (p.fdModeClient ?? 'combined') : (p.fdModeSpouse ?? 'combined')
    const coverPct = who === 'client' ? clientCoverPct : spouseCoverPct
    const fdBase = fdMode === 'own'
      ? (who === 'client' ? annExpClient : annExpSpouse)
      : annExpTotal * coverPct
    const fd = fv(inflation, coverageTerm, fdBase)
    const mort = calcMortgageForPerson(who)
    const edu = calcEducationForPerson(who)
    const gross = fd + mort + edu
    const assets = getAssetOffset(ff, who, 'dtpd', p)
    return { gross, assets, net: Math.max(0, gross - assets), fd, mort, edu }
  }

  function calcCINeed(who: 'client' | 'spouse'): CalcResult {
    const ciMode = p.ciCalcMode ?? 'expenses'
    const ciYrs = p.ciYears ?? 5

    // ── Custom Amount ────────────────────────────────────────────────────────
    if (ciMode === 'custom') {
      const customAmount = who === 'client' ? (p.ciCustomAmountClient ?? 0) : (p.ciCustomAmountSpouse ?? 0)
      return { gross: customAmount, assets: 0, net: customAmount, fd: 0, mort: 0, edu: 0, incomeReplacement: 0, medicalBuffer: 0, recoveryBuffer: 0 }
    }

    // ── Capital Fund — placeholder ───────────────────────────────────────────
    if (ciMode === 'capital') {
      return { gross: 0, assets: 0, net: 0, fd: 0, mort: 0, edu: 0, incomeReplacement: 0, medicalBuffer: 0, recoveryBuffer: 0 }
    }

    // ── Income Replacement ───────────────────────────────────────────────────
    if (ciMode === 'income') {
      const grossMonthly = who === 'client'
        ? ((ff.person1 as any)?.gross_monthly ?? 0)
        : ((ff.person2 as any)?.gross_monthly ?? 0)
      const replacePct = who === 'client' ? ((p.ciIncomePctClient ?? 100) / 100) : ((p.ciIncomePctSpouse ?? 100) / 100)
      // Inflation-adjusted: annual income need × growing-annuity PV over ciYears
      const annualIncome = grossMonthly * 12 * replacePct
      // PV of growing annuity (annuity-due): sum of inflation-adjusted cash flows
      // = annualIncome × ((1 - ((1+g)/(1+r))^n) / (r-g)) × (1+r)  when r≠g
      // degenerate: annualIncome × n  when r=g
      const r = inflation
      const g = inflation // income grows with inflation during recovery period
      // Since r===g here, use simple sum: n × annual (purchasing power preserved)
      // But for professional output we use FV of lump-sum needed: PV of n equal real-value payments
      // = annualIncome × n  (real terms, since g=r cancels out)
      const incomeReplacement = annualIncome * ciYrs

      const mort = p.ciIncludeMortgageInIncome ? calcCIMortgage(who) : 0
      const edu = (p.ciIncludeEduInIncome && p.provideEducationFund) ? calcEducationForPerson(who, true) : 0

      const medicalBuffer = p.ciIncludeMedicalBuffer
        ? (who === 'client' ? (p.ciMedicalBufferClient ?? 50000) : (p.ciMedicalBufferSpouse ?? 50000)) : 0
      const recoveryBuffer = p.ciIncludeRecoveryBuffer
        ? (who === 'client' ? (p.ciRecoveryBufferClient ?? 30000) : (p.ciRecoveryBufferSpouse ?? 30000)) : 0

      const gross = incomeReplacement + mort + edu + medicalBuffer + recoveryBuffer
      const assets = getAssetOffset(ff, who, 'ci', p)
      return { gross, assets, net: Math.max(0, gross - assets), fd: 0, mort, edu, incomeReplacement, medicalBuffer, recoveryBuffer }
    }

    // ── Expenses Replacement (default) ───────────────────────────────────────
    const fdMode = who === 'client' ? (p.fdModeClient ?? 'combined') : (p.fdModeSpouse ?? 'combined')
    const coverPct = who === 'client' ? clientCoverPct : spouseCoverPct
    const fdBase = fdMode === 'own'
      ? (who === 'client' ? annExpClient : annExpSpouse)
      : annExpTotal * coverPct
    const fd = fv(inflation, ciYrs, fdBase)
    const mort = calcCIMortgage(who)
    const edu = p.provideEducationFund ? calcEducationForPerson(who, true) : 0
    const medicalBuffer = p.ciIncludeMedicalBuffer
      ? (who === 'client' ? (p.ciMedicalBufferClient ?? 50000) : (p.ciMedicalBufferSpouse ?? 50000)) : 0
    const recoveryBuffer = p.ciIncludeRecoveryBuffer
      ? (who === 'client' ? (p.ciRecoveryBufferClient ?? 30000) : (p.ciRecoveryBufferSpouse ?? 30000)) : 0
    const gross = fd + mort + edu + medicalBuffer + recoveryBuffer
    const assets = getAssetOffset(ff, who, 'ci', p)
    return { gross, assets, net: Math.max(0, gross - assets), fd, mort, edu, incomeReplacement: 0, medicalBuffer, recoveryBuffer }
  }

  const dtpdClient = calcDTPDNeed('client')
  const dtpdSpouse = calcDTPDNeed('spouse')
  const ciClient = calcCINeed('client')
  const ciSpouse = calcCINeed('spouse')
  // Save calculated needs to database
async function saveNeedsToDatabase() {
  if (!clientId) return
  
  const needs: any = {
    p1_dtpd_need: dtpdClient.net,
    p1_ci_need: ciClient.net,
    planType: p.planType ?? 'individual',
  }

  if (isCouple) {
    needs.p2_dtpd_need = dtpdSpouse.net
    needs.p2_ci_need = ciSpouse.net
  }
  
  const { data: existing } = await supabase
    .from('fact_finding')
    .select('data')
    .eq('client_id', clientId)
    .eq('section', 'protection_needs')
    .maybeSingle()
  
  const existingData = existing?.data || {}
  
  await supabase
    .from('fact_finding')
    .upsert({
      client_id: clientId,
      section: 'protection_needs',
      data: { ...existingData, protection: { ...existingData.protection, ...needs } },
      updated_at: new Date().toISOString()
    }, { onConflict: 'client_id,section' })
}
  // Auto-save needs whenever they change
useEffect(() => {
  if (clientId && (dtpdClient.net > 0 || ciClient.net > 0)) {
    if (needsSaveTimer.current) clearTimeout(needsSaveTimer.current)
    needsSaveTimer.current = setTimeout(() => {
      saveNeedsToDatabase()
    }, 2000)
  }
}, [clientId, dtpdClient.net, ciClient.net, dtpdSpouse?.net, ciSpouse?.net])

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
        annualCost: UNI_COST_DEFAULTS.sg_local.annual_fees_living,
        coverPctClient: isCouple ? 50 : 100,
        coverPctSpouse: 50,
      }))
      updateP({ educationChildren: eduKids })
    }
  }, [children])

  // ─── MORTGAGE INIT ─────────────────────────────────────────────────────────

  useEffect(() => {
    const mortgages: MortgageProperty[] = (ff.properties ?? [])
    .filter((prop: any) => prop.initialLoanAmount || prop.outstanding || prop.monthlyRepayment)
    .map((prop: any) => {
      const startDate = prop.loanStartDate ?? ''
      const initialTenure = prop.initialTenure ?? 25
      const interestRate = prop.interestRate ?? 0
      const initialLoan = prop.initialLoanAmount ?? prop.outstanding ?? 0
      function pmtCalc(principal: number, annRate: number, years: number): number {
        if (years <= 0 || principal <= 0) return 0
        if (annRate === 0) return principal / (years * 12)
        const r = annRate / 100 / 12; const n = years * 12
        return principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1)
      }
      let remainingTenure = prop.remainingTenure ?? initialTenure
      if (!prop.remainingTenure && startDate) {
        const [mm, yyyy] = startDate.split('/')
        if (mm && yyyy) {
          const start = new Date(parseInt(yyyy), parseInt(mm)-1)
          const now = new Date()
          const elapsedYears = (now.getTime() - start.getTime()) / (1000*60*60*24*365.25)
          remainingTenure = Math.max(0, Math.round(initialTenure - elapsedYears))
        }
      }
      const outstanding = prop.outstanding ?? calcAmortizedBalance(initialLoan, interestRate, initialTenure, startDate)
      const monthlyRepayment = prop.monthlyRepayment ?? pmtCalc(initialLoan, interestRate, initialTenure)
      return {
        id: prop.id,
        label: prop.label || 'Property',
        outstanding: outstanding,
        interestRate: interestRate,
        monthlyRepayment: monthlyRepayment,
        tenure: initialTenure,
        initialLoanAmount: initialLoan,
        initialTenure: initialTenure,
        loanStartDate: startDate,
        remainingTenure: remainingTenure,
      }
    })
    if (mortgages.length > 0) {
      const clientPcts = p.mortgageCoverPctsClient ?? []
      const spousePcts = p.mortgageCoverPctsSpouse ?? []
      if (clientPcts.length !== mortgages.length || spousePcts.length !== mortgages.length) {
        const totalMortgageClient = mortgages.reduce((s, m) => {
          const cpf = ff.d_mortgage_cpf ?? 0; const cash = ff.d_mortgage_cash ?? 0
          return s + (cpf + cash)
        }, 0)
        updateP({
          mortgageCoverPctsClient: mortgages.map(() => 100),
          mortgageCoverPctsSpouse: mortgages.map(() => 100),
          mortgageCoverPcts: mortgages.map(() => 100),
        })
      }
    }
  }, [ff.properties])

  // ─── SUB-COMPONENTS ────────────────────────────────────────────────────────

  const WP_TABS = ['Medical & Disability', 'Family Dependency', 'Mortgage & Debt', 'Education Fund', 'Critical Illness', 'General', 'Asset Offset']

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

  if (!clientId) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: '#EEEADE' }}>
        <div className="text-center">
          <p style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: '#1C1A17', marginBottom: 8 }}>No Client Selected</p>
          <p className="text-xs tracking-widest uppercase" style={{ color: '#A8834A', fontFamily: 'Inter, sans-serif' }}>Please select a client from the dashboard</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#EEEADE', fontFamily: 'Inter, sans-serif' }}>

      {/* HERO BAND */}
      <div style={{ background: '#1C1A17', padding: '28px 40px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p className="text-xs tracking-widest uppercase mb-1" style={{ color: '#A8834A', fontFamily: 'Inter' }}>Strategic Objectives</p>
            <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 32, fontWeight: 300, color: '#F5F0E8', letterSpacing: 1 }}>
              Needs Discovery
              <span style={{ color: '#A8834A', marginLeft: 16 }}>—</span>
              <span style={{ marginLeft: 16 }}>{isCouple ? `${clientName} & ${spouseName}` : clientName}</span>
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8 }}>
            {saving && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter' }}>Saving…</span>}
            {saved && !saving && <span style={{ fontSize: 11, color: '#A8834A', fontFamily: 'Inter' }}>✓ Saved</span>}
          </div>
        </div>
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
      <div style={{ display: 'grid', gridTemplateColumns: sidebarOpen ? '1fr 260px' : '1fr 20px', gap: 0, minHeight: 'calc(100vh - 140px)', transition: 'grid-template-columns 0.25s ease' }}>

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
              clientId={clientId ?? ''}
              allFamilyMembers={allFamilyMembers}
              insCompanies={insCompanies}
              insProducts={insProducts}
              insCategories={insCategories}
              addToPortfolio={addToPortfolio}
            />
          )}
         {activeSection === 1 && (
            <WealthAccumulationSection
              data={acc}
              onChange={(updated) => {
                setAcc(updated)
                scheduleAccSave(updated)
              }}
              clientSavings={ff.a_savings ?? 0}
              clientFD={ff.a_fixed_deposit ?? 0}
              spouseSavings={ff.a2_savings ?? 0}
              spouseFD={ff.a2_fixed_deposit ?? 0}
              monthlyExpenses={(annExpClient + (isCouple ? annExpSpouse : 0)) / 12}
             monthlySurplus={(() => {
  const p1Gross = (ff.person1 as any)?.gross_monthly || 0
  const p2Gross = isCouple ? ((ff.person2 as any)?.gross_monthly || 0) : 0
  const takeHome = (p1Gross + p2Gross) * 0.8
  const monthlyExp = (annExpClient + (isCouple ? annExpSpouse : 0)) / 12
  return takeHome - monthlyExp
})()}
                            annualSurplus={(() => {
  const p1 = ff.person1 as any || {}
  const p2 = ff.person2 as any || {}
  const p1AnnualTakeHome = p1.annualTakeHome || ((p1.gross_monthly || 0) * 12)
  const p2AnnualTakeHome = isCouple ? (p2.annualTakeHome || ((p2.gross_monthly || 0) * 12)) : 0
  const totalAnnualTakeHome = p1AnnualTakeHome + p2AnnualTakeHome
  const totalAnnualExpenses = annExpClient + (isCouple ? annExpSpouse : 0)
  console.log('🔵 ANNUAL SURPLUS DEBUG:')
  console.log('p1.annualTakeHome:', p1.annualTakeHome)
  console.log('p2.annualTakeHome:', p2.annualTakeHome)
  console.log('totalAnnualTakeHome:', totalAnnualTakeHome)
  console.log('annExpClient:', annExpClient)
  console.log('annExpSpouse:', annExpSpouse)
  console.log('totalAnnualExpenses:', totalAnnualExpenses)
  console.log('SURPLUS:', totalAnnualTakeHome - totalAnnualExpenses)
  return totalAnnualTakeHome - totalAnnualExpenses
})()}
              isCouple={isCouple}
              clientName={clientName}
              spouseName={spouseName}
            />
          )}
          {activeSection === 2 && (
  <RetirementSection
    data={ret}
    onChange={(updated) => { setRet(updated) }}
    onCalculated={(corpus, gap, monthly) => {
      scheduleRetSave(ret, { corpus, gap, monthly })
    }}
    isCouple={isCouple}
    clientName={clientName}
    spouseName={spouseName}
    clientAge={clientDOB ? getAge(clientDOB) : 0}
    spouseAge={spouseDOB ? getAge(spouseDOB) : 0}
    clientCPF_OA={ff.a_cpf_oa as number ?? 0}
    clientCPF_SA={ff.a_cpf_sa as number ?? 0}
    clientCPF_RA={ff.a_cpf_ra as number ?? 0}
    spouseCPF_OA={ff.a2_cpf_oa as number ?? 0}
    spouseCPF_SA={ff.a2_cpf_sa as number ?? 0}
    spouseCPF_RA={ff.a2_cpf_ra as number ?? 0}
    clientLiquid={(ff.a_savings as number ?? 0) + (ff.a_fixed_deposit as number ?? 0) + (ff.a_srs as number ?? 0) + (ff.a_shares as number ?? 0) + (ff.a_etf as number ?? 0) + (ff.a_unit_trust as number ?? 0) + (ff.a_bonds as number ?? 0) + (ff.a_alternatives as number ?? 0)}
    spouseLiquid={(ff.a2_savings as number ?? 0) + (ff.a2_fixed_deposit as number ?? 0) + (ff.a2_srs as number ?? 0) + (ff.a2_shares as number ?? 0) + (ff.a2_etf as number ?? 0) + (ff.a2_unit_trust as number ?? 0) + (ff.a2_bonds as number ?? 0) + (ff.a2_alternatives as number ?? 0)}
    factFinding={ff as Record<string, unknown>}
    expenseMode={(ff.expense_mode as 'simple' | 'detailed') ?? 'simple'}
  />
)}
{activeSection === 3 && (
  <EducationSection
    data={edu}
    onChange={(updated) => { setEdu(updated); scheduleEduSave(updated) }}
    isCouple={isCouple}
    clientName={clientName}
    spouseName={spouseName}
    clientAge={clientDOB ? getAge(clientDOB) : 35}
    clientLiquid={(ff.a_savings as number ?? 0) + (ff.a_fixed_deposit as number ?? 0)}
    spouseLiquid={(ff.a2_savings as number ?? 0) + (ff.a2_fixed_deposit as number ?? 0)}
    familyMembers={children.map(c => ({
      ...c,
      age: c.dob ? getAge(c.dob) : (c.date_of_birth ? getAge(c.date_of_birth) : c.age)
    }))}
    uniCostDefaults={_uniCosts}
  />
)}
{activeSection === 4 && (
  <EstateSection
    data={estate}
    onChange={(updated) => { setEstate(updated) }}
    onCalculated={(netEstate) => {
      scheduleEstateSave(estate, netEstate)
    }}
    isCouple={isCouple}
    clientName={clientName}
    spouseName={spouseName}
    clientLiquid={(ff.a_savings as number ?? 0) + (ff.a_fixed_deposit as number ?? 0) + (ff.a_srs as number ?? 0) + (ff.a_shares as number ?? 0) + (ff.a_etf as number ?? 0) + (ff.a_unit_trust as number ?? 0) + (ff.a_bonds as number ?? 0) + (ff.a_alternatives as number ?? 0)}
    spouseLiquid={(ff.a2_savings as number ?? 0) + (ff.a2_fixed_deposit as number ?? 0) + (ff.a2_srs as number ?? 0) + (ff.a2_shares as number ?? 0) + (ff.a2_etf as number ?? 0) + (ff.a2_unit_trust as number ?? 0) + (ff.a2_bonds as number ?? 0) + (ff.a2_alternatives as number ?? 0)}
    clientCPF={(ff.a_cpf_oa as number ?? 0) + (ff.a_cpf_sa as number ?? 0) + (ff.a_cpf_ma as number ?? 0) + (ff.a_cpf_ra as number ?? 0)}
    spouseCPF={(ff.a2_cpf_oa as number ?? 0) + (ff.a2_cpf_sa as number ?? 0) + (ff.a2_cpf_ma as number ?? 0) + (ff.a2_cpf_ra as number ?? 0)}
    clientBusiness={(ff.a_business as number ?? 0)}
    spouseBusiness={(ff.a2_business as number ?? 0)}
    clientPersonalUse={(ff.a_vehicles as number ?? 0) + (ff.a_club as number ?? 0) + ((ff.a_personal_custom as any[]) ?? []).reduce((s: number, i: any) => s + (i.amount ?? 0), 0)}
    spousePersonalUse={(ff.a2_vehicles as number ?? 0) + (ff.a2_club as number ?? 0) + ((ff.a_personal_custom as any[]) ?? []).reduce((s: number, i: any) => s + (i.amount2 ?? 0), 0)}
    properties={(ff.properties ?? []) as any[]}
    nonMortgageDebts={p.nonMortgageDebts ?? []}
    familyMembers={[...children]}
  />
)}
        </div>

        {/* RIGHT: SIDEBAR — collapsible */}
        <div style={{ position: 'relative', background: sidebarOpen ? '#fff' : 'transparent', borderLeft: sidebarOpen ? '1px solid #E8E4DC' : 'none' }}>
          {/* Toggle button — always visible, fixed to left edge */}
          <button
            onClick={() => setSidebarOpen(v => !v)}
            style={{ position: 'absolute', top: 32, left: -14, zIndex: 20,
              width: 28, height: 28, borderRadius: '50%', background: '#fff', border: '1px solid #E8E4DC',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, color: '#A8834A', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              flexShrink: 0 }}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {sidebarOpen ? '›' : '‹'}
          </button>

          {sidebarOpen && (
            <div style={{ padding: '32px 24px', width: 260, overflowY: 'auto' }}>
              <p className="text-xs tracking-widest uppercase mb-4" style={{ color: '#A8834A', fontFamily: 'Inter', letterSpacing: '0.12em' }}>
                Coverage Summary
              </p>

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
          )}
        </div>

      </div>

      {/* EDIT MODAL */}
      {editModal.open && (
        <EditSubItemsModal
          category={editModal.category}
          ff={ff} p={p} updateP={updateP}
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
  clientId: string
  allFamilyMembers: FamilyMember[]
  insCompanies: {id: number; name: string; category_id: number}[]
  insProducts: {id: number; name: string; company_id: number; category_id: number}[]
  insCategories: {id: number; code: string}[]
  addToPortfolio: (policy: any) => Promise<string | undefined>
}

// Type helper for return shape
type CalcResult = { gross: number; assets: number; net: number; fd: number; mort: number; edu: number; incomeReplacement?: number; medicalBuffer?: number; recoveryBuffer?: number }


function WealthProtectionSection({ ff, p, updateP, children, isCouple, clientName, spouseName, annExpClient, annExpSpouse, coverageTerm, youngestAge, dtpdClient, dtpdSpouse, ciClient, ciSpouse, editModal, setEditModal, WP_TABS, inflation, defaultClientPct, defaultSpousePct, clientId, allFamilyMembers, insCompanies, insProducts, insCategories, addToPortfolio }: WPProps) {
  const wpTab = p.wpSubTab ?? 0
  const cats = p.expenseCategories ?? { financial: true, household: true, personal: true, children: true, lifestyle: true }
  const isDetailed = (p.expenseMode ?? ff.expense_mode ?? 'simple') === 'detailed'
  const mortgages: MortgageProperty[] = (ff.properties ?? [])
    .filter((prop: any) => prop.initialLoanAmount || prop.outstanding || prop.monthlyRepayment)
        .map((prop: any) => {
      const startDate = prop.loanStartDate ?? ''
      const initialTenure = prop.initialTenure ?? 25
      const interestRate = prop.interestRate ?? 0
      const initialLoan = prop.initialLoanAmount ?? prop.outstanding ?? 0
      const outstanding = prop.outstanding ?? calcAmortizedBalance(initialLoan, interestRate, initialTenure, startDate)
      
      let monthlyRepayment = prop.monthlyRepayment
      if (!monthlyRepayment && initialLoan > 0 && initialTenure > 0) {
        if (interestRate === 0) {
          monthlyRepayment = initialLoan / (initialTenure * 12)
        } else {
          const r = interestRate / 100 / 12
          const n = initialTenure * 12
          monthlyRepayment = initialLoan * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1)
        }
      }
      
      let remainingTenure = prop.remainingTenure ?? initialTenure
      if (!prop.remainingTenure && startDate) {
        const [mm, yyyy] = startDate.split('/')
        if (mm && yyyy) {
          const start = new Date(parseInt(yyyy), parseInt(mm)-1)
          const now = new Date()
          const elapsedYears = (now.getTime() - start.getTime()) / (1000*60*60*24*365.25)
          remainingTenure = Math.max(0, Math.round(initialTenure - elapsedYears))
        }
      }
      
      return {
        id: prop.id,
        label: prop.label || 'Property',
        outstanding: outstanding,
        interestRate: interestRate,
        monthlyRepayment: monthlyRepayment || 0,
        tenure: initialTenure,
        initialLoanAmount: initialLoan,
        initialTenure: initialTenure,
        loanStartDate: startDate,
        remainingTenure: remainingTenure,
      }
    })

  return (
    <div>
      {/* Section header + global controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 3, height: 24, background: '#A8834A', borderRadius: 2 }} />
          <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 400, color: '#1C1A17', margin: 0 }}>
            Wealth Protection
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Individual / Couple toggle */}
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888', fontFamily: 'Inter', marginBottom: 5 }}>Planning For</div>
            <div style={{ display: 'flex', background: '#F5F0E8', borderRadius: 5, padding: 2 }}>
              {(['individual', 'couple'] as const).map(t => (
                <button key={t} onClick={() => updateP({ planType: t })}
                  style={{ padding: '5px 14px', fontSize: 11, fontFamily: 'Inter', fontWeight: 500,
                    background: p.planType === t ? '#1C1A17' : 'transparent',
                    color: p.planType === t ? '#fff' : '#888',
                    border: 'none', borderRadius: 4, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {t === 'individual' ? clientName : 'Couple'}
                </button>
              ))}
            </div>
          </div>
          {/* Simple / Detailed toggle */}
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888', fontFamily: 'Inter', marginBottom: 5 }}>Expense Data</div>
            <div style={{ display: 'flex', background: '#F5F0E8', borderRadius: 5, padding: 2 }}>
              {(['simple', 'detailed'] as const).map(t => (
                <button key={t} onClick={() => updateP({ expenseMode: t })}
                  style={{ padding: '5px 14px', fontSize: 11, fontFamily: 'Inter', fontWeight: 500,
                    background: (p.expenseMode ?? ff.expense_mode ?? 'simple') === t ? '#1C1A17' : 'transparent',
                    color: (p.expenseMode ?? ff.expense_mode ?? 'simple') === t ? '#fff' : '#888',
                    border: 'none', borderRadius: 4, cursor: 'pointer', transition: 'all 0.15s',
                    textTransform: 'capitalize' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {/* Inflation */}
          <div style={{ minWidth: 180 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888', fontFamily: 'Inter', marginBottom: 5 }}>Inflation Rate</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={0} max={8} step={0.5}
                value={p.inflationRate ?? 3}
                onChange={e => updateP({ inflationRate: parseFloat(e.target.value) })}
                style={{ flex: 1, accentColor: '#A8834A' }} />
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#1C1A17', minWidth: 36 }}>
                {(p.inflationRate ?? 3).toFixed(1)}%
              </span>
            </div>
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
          <MedicalDisabilityTab
            p={p} updateP={updateP}
            isCouple={isCouple} clientName={clientName} spouseName={spouseName}
            allFamilyMembers={allFamilyMembers}
            insCompanies={insCompanies} insProducts={insProducts}
            insCategories={insCategories}
            addToPortfolio={addToPortfolio}
          />
        )}
        {wpTab === 1 && (
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
        {wpTab === 2 && (
          <MortgageDebtTab
            ff={ff} p={p} updateP={updateP}
            isCouple={isCouple} clientName={clientName} spouseName={spouseName}
            mortgages={mortgages} clientId={clientId ?? ''}
          />
        )}
        {wpTab === 3 && (
          <EducationFundTab
            p={p} updateP={updateP}
            isCouple={isCouple} clientName={clientName} spouseName={spouseName}
            children={children} inflation={inflation}
          />
        )}
        {wpTab === 4 && (
          <CriticalIllnessTab
            ff={ff} p={p} updateP={updateP}
            isCouple={isCouple} clientName={clientName} spouseName={spouseName}
            mortgages={mortgages}
            ciClient={ciClient} ciSpouse={ciSpouse}
            children={children}
          />
        )}
        {wpTab === 5 && (
          <GeneralTab
            p={p} updateP={updateP}
            isCouple={isCouple} clientName={clientName} spouseName={spouseName}
            allFamilyMembers={allFamilyMembers}
            insCompanies={insCompanies} insProducts={insProducts}
            insCategories={insCategories}
            addToPortfolio={addToPortfolio}
          />
        )}
        {/* ── CHANGE 5: pass updateP into AssetOffsetTab ── */}
        {wpTab === 6 && (
          <AssetOffsetTab
            ff={ff} p={p} updateP={updateP}
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
        {/* Column headers for couple mode */}
        {isCouple && (
          <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 110px 110px 80px', gap: 8, padding: '0 12px 6px', alignItems: 'center' }}>
            <div />
            <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Category</div>
            <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>{clientName}</div>
            <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>{spouseName}</div>
            <div />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                  gridTemplateColumns: isCouple ? '24px 1fr 110px 110px 80px' : '24px 1fr 100px 80px',
                  gap: 8, padding: '9px 12px', alignItems: 'center',
                  background: cats[key] ? '#F5F0E8' : 'transparent',
                  borderRadius: 4, cursor: 'pointer', transition: 'background 0.12s',
                }}
                onClick={() => toggleCat(key)}
              >
                {/* Checkbox */}
                <div style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                  background: cats[key] ? '#A8834A' : 'transparent',
                  border: `1.5px solid ${cats[key] ? '#A8834A' : '#ccc'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {cats[key] && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                </div>
                {/* Label */}
                <span style={{ fontSize: 13, fontFamily: 'Inter', color: '#1C1A17' }}>{label}</span>
                {/* Client amount + % */}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#1C1A17' }}>{fmt(clientAmt)}</div>
                  {isCouple && catTotal > 0 && <div style={{ fontSize: 10, color: '#A8834A', fontFamily: 'Inter' }}>{clientPct}%</div>}
                </div>
                {/* Spouse amount + % (couple only) */}
                {isCouple && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#1C1A17' }}>{fmt(spouseAmt)}</div>
                    {catTotal > 0 && <div style={{ fontSize: 10, color: '#2D5A4E', fontFamily: 'Inter' }}>{spousePct}%</div>}
                  </div>
                )}
                {/* Edit button (detailed only) */}
                <div style={{ textAlign: 'right' }}>
                  {isDetailed && cats[key] && (
                    <button onClick={e => { e.stopPropagation(); setEditModal({ open: true, category: key }) }}
                      style={{ fontSize: 10, color: '#A8834A', background: 'none', border: '1px solid #A8834A',
                        borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontFamily: 'Inter' }}>
                      Edit
                    </button>
                  )}
                </div>
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
        <SectionBlock title="Family Dependency Coverage" color="#A8834A">
          <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 16 }}>
            If this person passes away, what expenses need to be covered for the surviving family?
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {([
              { who: 'client' as const, name: clientName, modeKey: 'fdModeClient' as const, pctKey: 'expenseCoverPctClient' as const, defaultPct: defaultClientPct },
              { who: 'spouse' as const, name: spouseName, modeKey: 'fdModeSpouse' as const, pctKey: 'expenseCoverPctSpouse' as const, defaultPct: defaultSpousePct },
            ]).map(({ who, name, modeKey, pctKey, defaultPct }) => {
              const mode = p[modeKey] ?? 'combined'
              const pctVal = p[pctKey] ?? defaultPct
              return (
                <div key={who} style={{ padding: '16px', background: '#F5F0E8', borderRadius: 6 }}>
                  <div style={{ fontSize: 12, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17', marginBottom: 12 }}>{name}</div>
                  {/* Mode toggle */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    {([
                      { key: 'own', label: 'Own Expenses Only' },
                      { key: 'combined', label: 'Combined Expenses' },
                    ] as const).map(opt => (
                      <button key={opt.key} onClick={() => updateP({ [modeKey]: opt.key })}
                        style={{ padding: '6px 14px', fontFamily: 'Inter', fontSize: 12,
                          background: mode === opt.key ? '#1C1A17' : '#fff',
                          color: mode === opt.key ? '#fff' : '#1C1A17',
                          border: '1px solid #E8E4DC', borderRadius: 4, cursor: 'pointer' }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {/* Description + slider */}
                  {mode === 'own' ? (
                    <div style={{ fontSize: 12, color: '#888', fontFamily: 'Inter' }}>
                      Covers <span style={{ fontFamily: 'DM Mono, monospace', color: '#1C1A17' }}>{fmt(who === 'client' ? annExpClient : annExpSpouse)}/yr</span> — {name}'s own expenses only.
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter', marginBottom: 8 }}>
                        % of combined household expenses (<span style={{ fontFamily: 'DM Mono, monospace', color: '#1C1A17' }}>{fmt(annExpClient + annExpSpouse)}/yr</span>) to cover:
                      </div>
                      <PersonSlider
                        label={`${pctVal.toFixed(0)}% = ${fmt((annExpClient + annExpSpouse) * pctVal / 100)}/yr`}
                        value={pctVal}
                        onChange={v => updateP({ [pctKey]: v })}
                        color="#A8834A"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </SectionBlock>
      )}

      {/* Coverage Duration */}
      <SectionBlock title="Coverage Duration" color="#A8834A">
        {youngestAge !== null ? (
          <div>
            <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 16 }}>
             Coverage term auto-calculated based on the child with the most years to graduation.
            </p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {children.map(c => {
                const age = c.age ?? getAge(c.date_of_birth)
const ec = (p.educationChildren ?? []).find(e => e.childId === c.id)
const defaultEntry = c.gender === 'Male' ? 21 : 19
const entryAge = ec?.uniEntryAge ?? defaultEntry
const duration = ec?.courseDuration ?? 4
const gradAge = entryAge + duration
const uniGrad = Math.max(0, gradAge - age)
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

function MortgageDebtTab({ ff, p, updateP, isCouple, clientName, spouseName, mortgages, clientId }: {
  ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  isCouple: boolean; clientName: string; spouseName: string
  mortgages: MortgageProperty[]; clientId: string
}) {
  type NonMortgageDebt = { id: string; debtType: string; label: string; amount: number; interestRate: number; tenureLeft: number; owner: 'client' | 'spouse' | 'joint' }

  const DEBT_TYPES = ['Personal Loan', 'Car Loan', 'Business Loan', 'Credit Line', 'Student Loan', 'Other']

  function addDebt() {
    const newDebt: NonMortgageDebt = {
      id: Date.now().toString(),
      debtType: 'Personal Loan',
      label: '',
      amount: 0,
      interestRate: 3,
      tenureLeft: 5,
      owner: 'client',
    }
    updateP({ nonMortgageDebts: [...(p.nonMortgageDebts ?? []), newDebt] })
  }

  function updateDebt(id: string, changes: Partial<NonMortgageDebt>) {
    const arr = (p.nonMortgageDebts ?? []).map(d => d.id === id ? { ...d, ...changes } : d)
    updateP({ nonMortgageDebts: arr })
  }

  function removeDebt(id: string) {
    updateP({ nonMortgageDebts: (p.nonMortgageDebts ?? []).filter(d => d.id !== id) })
  }

  function calcDebtPMT(amount: number, annualRate: number, years: number): number {
    if (years <= 0 || amount <= 0) return 0
    if (annualRate === 0) return amount / (years * 12)
    const r = annualRate / 100 / 12
    const n = years * 12
    return amount * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
  }

  const nonMortgageDebts = p.nonMortgageDebts ?? []
  const financialsUrl = `/dashboard/financials?tab=properties`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── MORTGAGE SECTION ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontFamily: 'Inter', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#A8834A' }}>Mortgage Loans</div>
          <a
            href={financialsUrl}
            style={{ fontSize: 11, fontFamily: 'Inter', color: '#A8834A', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '1px solid #A8834A', borderRadius: 4 }}
          >
            + Add in Financial Profile
          </a>
        </div>

        {mortgages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', background: '#F5F0E8', borderRadius: 8, color: '#aaa', fontSize: 13, fontFamily: 'Inter' }}>
            No mortgages found. Add properties in Financial Profile → Properties.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {mortgages.map((m, i) => {
              const clientPct = (p.mortgageCoverPctsClient ?? [])[i] ?? 100
              const spousePct = (p.mortgageCoverPctsSpouse ?? [])[i] ?? 100

              function updateClientPct(val: number) {
                const arr = [...(p.mortgageCoverPctsClient ?? mortgages.map(() => 100))]
                arr[i] = val
                updateP({ mortgageCoverPctsClient: arr })
              }
              function updateSpousePct(val: number) {
                const arr = [...(p.mortgageCoverPctsSpouse ?? mortgages.map(() => 100))]
                arr[i] = val
                updateP({ mortgageCoverPctsSpouse: arr })
              }

              return (
                <div key={m.id} style={{ background: '#F5F0E8', borderRadius: 8, padding: '18px 20px', borderLeft: '3px solid #A8834A' }}>
                  {/* Title + outstanding */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 14, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17' }}>{m.label}</div>
                      <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter', marginTop: 2 }}>Mortgage Loan</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Outstanding</div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 17, color: '#A8834A', fontWeight: 600 }}>{fmt(m.outstanding)}</div>
                    </div>
                  </div>

                  {/* Read-only details */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16, padding: '10px 12px', background: '#fff', borderRadius: 6, border: '1px solid #E8E4DC' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Loan Amount</div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#1C1A17' }}>{fmt(m.initialLoanAmount)}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Monthly Repayment</div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#1C1A17' }}>{fmt(m.monthlyRepayment)}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Remaining Tenure</div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#1C1A17' }}>{m.remainingTenure} yrs @ {m.interestRate}%</div>
                    </div>
                  </div>

                  {/* Coverage sliders */}
                  {isCouple ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                      <PersonSlider label={`${clientName} covers`} value={clientPct} onChange={updateClientPct} color="#A8834A" unit="%" />
                      <PersonSlider label={`${spouseName} covers`} value={spousePct} onChange={updateSpousePct} color="#A8834A" unit="%" />
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#888', fontFamily: 'Inter' }}>Coverage: <span style={{ fontFamily: 'DM Mono, monospace', color: '#1C1A17' }}>100% — {fmt(m.outstanding)}</span></div>
                  )}

                  {/* D/TPD vs CI breakdown */}
                  {isCouple && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                      <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter' }}>
                        {clientName} D/TPD: <span style={{ fontFamily: 'DM Mono, monospace', color: '#1C1A17' }}>{fmt(m.outstanding * clientPct / 100)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter' }}>
                        {spouseName} D/TPD: <span style={{ fontFamily: 'DM Mono, monospace', color: '#1C1A17' }}>{fmt(m.outstanding * spousePct / 100)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── NON-MORTGAGE DEBTS SECTION ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontFamily: 'Inter', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#A8834A' }}>Non-Mortgage Debts</div>
          <button
            onClick={addDebt}
            style={{ fontSize: 11, fontFamily: 'Inter', color: '#A8834A', background: 'transparent', border: '1px solid #A8834A', borderRadius: 4, padding: '5px 10px', cursor: 'pointer' }}
          >
            + Add Debt
          </button>
        </div>

        {nonMortgageDebts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', background: '#F5F0E8', borderRadius: 8, color: '#aaa', fontSize: 13, fontFamily: 'Inter' }}>
            No non-mortgage debts added.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {nonMortgageDebts.map(d => {
              const monthlyPmt = calcDebtPMT(d.amount, d.interestRate, d.tenureLeft)
              return (
                <div key={d.id} style={{ background: '#F5F0E8', borderRadius: 8, padding: '18px 20px', borderLeft: '3px solid #6B7C93' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: '#6B7C93', fontFamily: 'Inter', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{d.debtType || 'Debt'}</div>
                    <button
                      onClick={() => removeDebt(d.id)}
                      style={{ fontSize: 11, color: '#ccc', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter' }}
                    >
                      Remove
                    </button>
                  </div>

                  {/* Inputs row 1: Type + Label */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={labelStyle}>Type of Debt</label>
                      <select
                        value={d.debtType}
                        onChange={e => updateDebt(d.id, { debtType: e.target.value })}
                        style={{ width: '100%', padding: '8px 10px', fontFamily: 'Inter', fontSize: 13, background: '#fff', border: '1px solid #E8E4DC', borderRadius: 4, color: '#1C1A17', outline: 'none' }}
                      >
                        {DEBT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Description</label>
                      <input
                        type="text"
                        placeholder="e.g. DBS Personal Loan"
                        value={d.label}
                        onChange={e => updateDebt(d.id, { label: e.target.value })}
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  {/* Inputs row 2: Amount + Interest + Tenure */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={labelStyle}>Outstanding Amount</label>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#888', fontFamily: 'DM Mono, monospace', fontSize: 13 }}>$</span>
                        <input
                          type="number" min={0} step={1000}
                          value={d.amount || ''}
                          onChange={e => updateDebt(d.id, { amount: parseInt(e.target.value) || 0 })}
                          style={{ ...inputStyle, paddingLeft: 24 }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={labelStyle}>Interest Rate (%)</label>
                      <input
                        type="number" min={0} max={30} step={0.1}
                        value={d.interestRate || ''}
                        onChange={e => updateDebt(d.id, { interestRate: parseFloat(e.target.value) || 0 })}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Tenure Left (yrs)</label>
                      <input
                        type="number" min={1} max={30} step={1}
                        value={d.tenureLeft || ''}
                        onChange={e => updateDebt(d.id, { tenureLeft: parseInt(e.target.value) || 1 })}
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  {/* Calculated monthly PMT + CI preview */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '10px 12px', background: '#fff', borderRadius: 6, border: '1px solid #E8E4DC', marginBottom: isCouple ? 14 : 0 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Est. Monthly Repayment</div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#1C1A17' }}>{fmt(monthlyPmt)}/mo</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>D/TPD Coverage</div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#6B7C93' }}>{fmt(d.amount)}</div>
                    </div>
                  </div>

                  {/* Owner selector */}
                  <div style={{ marginTop: 12 }}>
                    <label style={labelStyle}>Whose Debt</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {([
                        { key: 'client', label: clientName },
                        ...(isCouple ? [{ key: 'spouse', label: spouseName }, { key: 'joint', label: 'Joint' }] : []),
                      ] as { key: 'client'|'spouse'|'joint'; label: string }[]).map(opt => (
                        <button
                          key={opt.key}
                          onClick={() => updateDebt(d.id, { owner: opt.key })}
                          style={{
                            padding: '6px 14px', fontFamily: 'Inter', fontSize: 12,
                            background: (d.owner ?? 'client') === opt.key ? '#1C1A17' : '#fff',
                            color: (d.owner ?? 'client') === opt.key ? '#fff' : '#1C1A17',
                            border: '1px solid #E8E4DC', borderRadius: 4, cursor: 'pointer',
                          }}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}

// ─── EDUCATION FUND TAB ───────────────────────────────────────────────────────

function EducationFundTab({ p, updateP, isCouple, clientName, spouseName, children, inflation }: {
  p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  isCouple: boolean; clientName: string; spouseName: string
  children: FamilyMember[]; inflation: number
}) {
  type EduChild = {
    childId: string; uniType?: string; courseDuration?: number
    annualTuition?: number; annualLiving?: number
    uniEntryAge?: number; coverPctClient?: number; coverPctSpouse?: number
  }

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

  function calcChildFund(child: FamilyMember, ec: EduChild, who: 'client' | 'spouse' | 'total'): number {
    const childAge = child.age ?? getAge(child.date_of_birth)
    const defaultEntryAge = child.gender === 'Male' ? 21 : 19
    const uniEntryAge = ec.uniEntryAge ?? defaultEntryAge
    const yearsToUni = Math.max(0, uniEntryAge - childAge)
    const uniInfo = UNI_COST_DEFAULTS[ec.uniType ?? 'sg_local']
    const baseTuition = ec.annualTuition ?? uniInfo.annual_tuition
    const baseLiving = ec.annualLiving ?? uniInfo.annual_living
    const dur = ec.courseDuration ?? uniInfo.default_duration ?? 4
    const fvTuition = baseTuition * Math.pow(1.05, yearsToUni) * dur
    const fvLiving = baseLiving * Math.pow(1 + inflation, yearsToUni) * dur
    const total = fvTuition + fvLiving
    if (who === 'total') return total
    const pct = !isCouple ? 1 : (who === 'client' ? (ec.coverPctClient ?? 50) : (ec.coverPctSpouse ?? 50)) / 100
    return total * pct
  }

  return (
    <div>
      {/* Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, padding: '14px 16px', background: '#F5F0E8', borderRadius: 6 }}>
        <Toggle value={p.provideEducationFund ?? false} onChange={v => updateP({ provideEducationFund: v })} />
        <div>
          <div style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 500, color: '#1C1A17' }}>Provide Education Fund</div>
          <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter' }}>Inflation-adjusted university cost projection per child</div>
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
            const ec = (p.educationChildren ?? []).find(e => e.childId === child.id) ?? { childId: child.id }
            const childAge = child.age ?? getAge(child.date_of_birth)
            const defaultEntryAge = child.gender === 'Male' ? 21 : 19
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
              <div key={child.id} style={{ background: '#F5F0E8', borderRadius: 8, padding: '20px 24px', marginBottom: 16, borderLeft: '3px solid #2D5A4E' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 14, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17' }}>{child.name || child.relationship}</div>
                    <div style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginTop: 2 }}>
                      Age {childAge} · {child.gender || 'Gender not set'} · {yearsToUni > 0 ? `${yearsToUni} yrs to university` : 'University age'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Total Fund Needed</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 20, color: '#2D5A4E', fontWeight: 600 }}>{fmt(totalFund)}</div>
                  </div>
                </div>

                {/* FV Breakdown strip */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16, padding: '10px 12px', background: '#fff', borderRadius: 6, border: '1px solid #E8E4DC' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>FV Tuition (5%)</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#1C1A17' }}>{fmt(fvTuition)}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>FV Living ({(inflation * 100).toFixed(1)}%)</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#1C1A17' }}>{fmt(fvLiving)}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Duration</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#1C1A17' }}>{dur} yrs</div>
                  </div>
                </div>

                {/* Uni type */}
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>University Type</label>
                  <select
                    value={ec.uniType ?? 'sg_local'}
                    onChange={e => {
                      const uni = e.target.value
                      const info = UNI_COST_DEFAULTS[uni]
                      updateChild(child.id, {
                        uniType: uni,
                        annualTuition: info.annual_tuition,
                        annualLiving: info.annual_living,
                        courseDuration: info.default_duration,
                      })
                    }}
                    style={{ width: '100%', padding: '8px 10px', fontFamily: 'Inter', fontSize: 13, background: '#fff', border: '1px solid #E8E4DC', borderRadius: 4, color: '#1C1A17', outline: 'none' }}
                  >
                    {Object.entries(UNI_COST_DEFAULTS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label} — {fmt(v.annual_tuition + v.annual_living)}/yr</option>
                    ))}
                  </select>
                </div>

                {/* Row: Uni Entry Age + Duration */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={labelStyle}>University Entry Age</label>
                    <input
                      type="number" min={15} max={25} step={1}
                      value={uniEntryAge}
                      onChange={e => updateChild(child.id, { uniEntryAge: parseInt(e.target.value) })}
                      style={inputStyle}
                    />
                    <div style={{ fontSize: 10, color: '#aaa', fontFamily: 'Inter', marginTop: 3 }}>
                      Default: {defaultEntryAge} ({child.gender === 'Male' ? 'Male — NS offset' : 'Female'})
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Course Duration (years)</label>
                    <input
                      type="number" min={1} max={6} step={1}
                      value={dur}
                      onChange={e => updateChild(child.id, { courseDuration: parseInt(e.target.value) })}
                      style={inputStyle}
                    />
                  </div>
                </div>

                {/* Row: Annual Tuition + Annual Living */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: isCouple ? 16 : 0 }}>
                  <div>
                    <label style={labelStyle}>Annual Tuition (Today's $)</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#888', fontFamily: 'DM Mono, monospace', fontSize: 13 }}>$</span>
                      <input
                        type="number" min={0} step={500}
                        value={baseTuition}
                        onChange={e => updateChild(child.id, { annualTuition: parseInt(e.target.value) })}
                        style={{ ...inputStyle, paddingLeft: 24 }}
                      />
                    </div>
                    <div style={{ fontSize: 10, color: '#aaa', fontFamily: 'Inter', marginTop: 3 }}>Inflated at 5% p.a.</div>
                  </div>
                  <div>
                    <label style={labelStyle}>Annual Living (Today's $)</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#888', fontFamily: 'DM Mono, monospace', fontSize: 13 }}>$</span>
                      <input
                        type="number" min={0} step={500}
                        value={baseLiving}
                        onChange={e => updateChild(child.id, { annualLiving: parseInt(e.target.value) })}
                        style={{ ...inputStyle, paddingLeft: 24 }}
                      />
                    </div>
                    <div style={{ fontSize: 10, color: '#aaa', fontFamily: 'Inter', marginTop: 3 }}>Inflated at {(inflation * 100).toFixed(1)}% p.a.</div>
                  </div>
                </div>

                {/* Coverage split */}
                {isCouple && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <PersonSlider label={`${clientName} covers`} value={ec.coverPctClient ?? (isCouple ? 50 : 100)} onChange={v => updateChild(child.id, { coverPctClient: v })} color="#2D5A4E" unit="%" />
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

// ─── CI TAB MODULE-LEVEL SUB-COMPONENTS ──────────────────────────────────────
// Must be defined outside CriticalIllnessTab to avoid remount-on-render focus loss.

function CIPreviewRow({ isCouple, clientName, spouseName, clientVal, spouseVal, color }: {
  isCouple: boolean; clientName: string; spouseName: string
  clientVal: number; spouseVal: number; color: string
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr', gap: 8, padding: '8px 10px', background: '#fff', borderRadius: 6, border: '1px solid #E8E4DC', marginTop: 8 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{clientName}</div>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color }}>{fmt(clientVal)}</div>
      </div>
      {isCouple && <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{spouseName}</div>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color }}>{fmt(spouseVal)}</div>
      </div>}
    </div>
  )
}

function CICoverageWindowSlider({ ciYears, label, description, onUpdate }: {
  ciYears: number; label: string; description: string; onUpdate: (v: number) => void
}) {
  return (
    <div style={{ background: '#F5F0E8', borderRadius: 8, padding: '16px 20px', marginBottom: 12, borderLeft: '3px solid #A8834A' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17', marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter' }}>{description}</div>
        </div>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#A8834A', fontWeight: 600, marginLeft: 16, whiteSpace: 'nowrap' }}>{ciYears.toFixed(1)} yrs</span>
      </div>
      <input type="range" min={0.5} max={10} step={0.5} value={ciYears}
        onChange={e => onUpdate(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#A8834A' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#bbb', fontFamily: 'Inter', marginTop: 3 }}>
        <span>0.5 yr</span><span>5 yrs</span><span>10 yrs</span>
      </div>
    </div>
  )
}

function CIMedicalBufferCard({ p, updateP, isCouple, clientName, spouseName }: {
  p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  isCouple: boolean; clientName: string; spouseName: string
}) {
  return (
    <div style={{ background: '#F5F0E8', borderRadius: 8, padding: '16px 20px', marginBottom: 12, borderLeft: `3px solid ${p.ciIncludeMedicalBuffer ? '#7B6EA0' : '#E8E4DC'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: p.ciIncludeMedicalBuffer ? 14 : 0 }}>
        <div onClick={() => updateP({ ciIncludeMedicalBuffer: !p.ciIncludeMedicalBuffer })}
          style={{ width: 20, height: 20, borderRadius: 4, cursor: 'pointer', flexShrink: 0, background: p.ciIncludeMedicalBuffer ? '#7B6EA0' : 'transparent', border: `1.5px solid ${p.ciIncludeMedicalBuffer ? '#7B6EA0' : '#ccc'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {p.ciIncludeMedicalBuffer && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 600, color: p.ciIncludeMedicalBuffer ? '#1C1A17' : '#aaa' }}>Medical & Treatment Buffer</div>
          <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'Inter' }}>Out-of-pocket costs beyond medical insurance (specialist, co-pays, overseas treatment)</div>
        </div>
      </div>
      {p.ciIncludeMedicalBuffer && (
        <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr', gap: 16 }}>
          <CIAmountInput label={isCouple ? `${clientName} buffer` : 'Medical buffer'} value={p.ciMedicalBufferClient ?? 50000} onChange={v => updateP({ ciMedicalBufferClient: v })} note="Default $50,000" />
          {isCouple && <CIAmountInput label={`${spouseName} buffer`} value={p.ciMedicalBufferSpouse ?? 50000} onChange={v => updateP({ ciMedicalBufferSpouse: v })} note="Default $50,000" />}
        </div>
      )}
    </div>
  )
}

function CIRecoveryBufferCard({ p, updateP, isCouple, clientName, spouseName }: {
  p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  isCouple: boolean; clientName: string; spouseName: string
}) {
  return (
    <div style={{ background: '#F5F0E8', borderRadius: 8, padding: '16px 20px', marginBottom: 12, borderLeft: `3px solid ${p.ciIncludeRecoveryBuffer ? '#8A9A7E' : '#E8E4DC'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: p.ciIncludeRecoveryBuffer ? 14 : 0 }}>
        <div onClick={() => updateP({ ciIncludeRecoveryBuffer: !p.ciIncludeRecoveryBuffer })}
          style={{ width: 20, height: 20, borderRadius: 4, cursor: 'pointer', flexShrink: 0, background: p.ciIncludeRecoveryBuffer ? '#8A9A7E' : 'transparent', border: `1.5px solid ${p.ciIncludeRecoveryBuffer ? '#8A9A7E' : '#ccc'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {p.ciIncludeRecoveryBuffer && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 600, color: p.ciIncludeRecoveryBuffer ? '#1C1A17' : '#aaa' }}>Recovery & Lifestyle Adjustment</div>
          <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'Inter' }}>Home modifications, caregiver costs, rehabilitation, career change buffer</div>
        </div>
      </div>
      {p.ciIncludeRecoveryBuffer && (
        <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr', gap: 16 }}>
          <CIAmountInput label={isCouple ? `${clientName} buffer` : 'Recovery buffer'} value={p.ciRecoveryBufferClient ?? 30000} onChange={v => updateP({ ciRecoveryBufferClient: v })} note="Default $30,000" />
          {isCouple && <CIAmountInput label={`${spouseName} buffer`} value={p.ciRecoveryBufferSpouse ?? 30000} onChange={v => updateP({ ciRecoveryBufferSpouse: v })} note="Default $30,000" />}
        </div>
      )}
    </div>
  )
}

function CIAmountInput({ label, value, onChange, note }: { label: string; value: number; onChange: (v: number) => void; note?: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#888', fontFamily: 'DM Mono, monospace', fontSize: 13 }}>$</span>
        <input type="number" min={0} step={5000} value={value || ''}
          onChange={e => onChange(parseInt(e.target.value) || 0)}
          style={{ ...inputStyle, paddingLeft: 24 }} />
      </div>
      {note && <div style={{ fontSize: 10, color: '#aaa', fontFamily: 'Inter', marginTop: 3 }}>{note}</div>}
    </div>
  )
}

function CriticalIllnessTab({ ff, p, updateP, isCouple, clientName, spouseName, mortgages, ciClient, ciSpouse, children }: {
  ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  isCouple: boolean; clientName: string; spouseName: string
  mortgages: MortgageProperty[]
  ciClient: CalcResult; ciSpouse: CalcResult
  children: FamilyMember[]
}) {
  const ciMode = p.ciCalcMode ?? 'expenses'
  const ciYears = p.ciYears ?? 5
  const clientGrossMonthly = (ff.person1 as any)?.gross_monthly ?? 0
  const spouseGrossMonthly = (ff.person2 as any)?.gross_monthly ?? 0

  const MODES = [
    { key: 'expenses', label: 'Expense Replacement' },
    { key: 'income',   label: 'Income Replacement' },
    { key: 'capital',  label: 'Capital Fund' },
    { key: 'custom',   label: 'Custom Amount' },
  ] as const

  return (
    <div>
      {/* CI Stage */}
      <SectionBlock title="Critical Illness Stage" color="#A8834A">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {([{ key: 'early_late', label: 'Early & Late Stage' }, { key: 'late_only', label: 'Late Stage Only' }] as const).map(opt => (
            <button key={opt.key} onClick={() => updateP({ ciStage: opt.key })}
              style={{ padding: '8px 16px', fontFamily: 'Inter', fontSize: 12, background: p.ciStage === opt.key ? '#1C1A17' : '#F5F0E8', color: p.ciStage === opt.key ? '#fff' : '#1C1A17', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              {opt.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 11, color: '#888', fontFamily: 'Inter' }}>
          {p.ciStage === 'early_late' ? 'Covers both early and late stage critical illnesses.' : 'Covers late stage critical illnesses only.'}
        </p>
      </SectionBlock>

      {/* Calculation Method — 4-way selector */}
      <SectionBlock title="Calculation Method" color="#A8834A">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
          {MODES.map(opt => {
            const active = ciMode === opt.key
            return (
              <button key={opt.key} onClick={() => updateP({ ciCalcMode: opt.key })}
                style={{
                  padding: '10px 8px', fontFamily: 'Inter', fontSize: 11, fontWeight: 600,
                  textAlign: 'center', lineHeight: 1.35,
                  background: active ? '#1C1A17' : '#F5F0E8',
                  color: active ? '#F5F0E8' : '#888',
                  border: active ? '1.5px solid #1C1A17' : '1.5px solid #E8E4DC',
                  borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
                }}>
                {opt.label}
              </button>
            )
          })}
        </div>

        {/* ── MODE: Expenses Replacement ───────────────────────────────────── */}
        {ciMode === 'expenses' && (
          <div>
            <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 20 }}>
              CI fund to replace household expenses during recovery — drawn from Family Dependency settings. Toggle optional add-ons below.
            </p>

            {/* Living Expenses — always on */}
            <div style={{ background: '#F5F0E8', borderRadius: 8, padding: '16px 20px', marginBottom: 12, borderLeft: '3px solid #A8834A' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 20, height: 20, borderRadius: 4, background: '#A8834A', border: '1.5px solid #A8834A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17' }}>Living Expenses</div>
                  <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter' }}>Inflation-adjusted annual expenses over the recovery window</div>
                </div>
              </div>
              <CICoverageWindowSlider ciYears={ciYears} label="Recovery Window" description="Number of years expenses need to be covered" onUpdate={v => updateP({ ciYears: v })} />
              <CIPreviewRow isCouple={isCouple} clientName={clientName} spouseName={spouseName} clientVal={ciClient.fd} spouseVal={ciSpouse.fd} color="#A8834A" />
            </div>

            {/* Mortgage — shown if mortgages exist */}
            {mortgages.length > 0 && (
              <div style={{ background: '#F5F0E8', borderRadius: 8, padding: '16px 20px', marginBottom: 12, borderLeft: '3px solid #A8834A' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 4, background: '#A8834A', border: '1.5px solid #A8834A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17' }}>Mortgage Repayments</div>
                    <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter' }}>Monthly repayments × recovery window</div>
                  </div>
                </div>
                {isCouple ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 8 }}>
                    <PersonSlider label={clientName} value={p.ciMortgagePctClient ?? 100} onChange={v => updateP({ ciMortgagePctClient: v })} color="#A8834A" unit="%" />
                    <PersonSlider label={spouseName} value={p.ciMortgagePctSpouse ?? 100} onChange={v => updateP({ ciMortgagePctSpouse: v })} color="#A8834A" unit="%" />
                  </div>
                ) : (
                  <PersonSlider label="Coverage %" value={p.ciMortgagePctClient ?? 100} onChange={v => updateP({ ciMortgagePctClient: v })} color="#A8834A" unit="%" />
                )}
                <CIPreviewRow isCouple={isCouple} clientName={clientName} spouseName={spouseName} clientVal={ciClient.mort} spouseVal={ciSpouse.mort} color="#A8834A" />
              </div>
            )}

            {/* Education fund — shown if enabled */}
            {p.provideEducationFund && children.length > 0 && (
              <div style={{ background: '#F5F0E8', borderRadius: 8, padding: '16px 20px', marginBottom: 12, borderLeft: '3px solid #2D5A4E' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 4, background: '#2D5A4E', border: '1.5px solid #2D5A4E', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17' }}>Education Fund</div>
                    <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter' }}>Children who have not yet reached university age</div>
                  </div>
                </div>
                <CIPreviewRow isCouple={isCouple} clientName={clientName} spouseName={spouseName} clientVal={ciClient.edu} spouseVal={ciSpouse.edu} color="#2D5A4E" />
              </div>
            )}

            <CIMedicalBufferCard p={p} updateP={updateP} isCouple={isCouple} clientName={clientName} spouseName={spouseName} />
            <CIRecoveryBufferCard p={p} updateP={updateP} isCouple={isCouple} clientName={clientName} spouseName={spouseName} />
          </div>
        )}

        {/* ── MODE: Income Replacement ─────────────────────────────────────── */}
        {ciMode === 'income' && (
          <div>
            <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 20 }}>
              CI fund sized to replace lost income during recovery. Gross monthly income is drawn from the Financial Profile and inflated over the recovery window.
            </p>

            {/* Income inputs per person */}
            <div style={{ background: '#F5F0E8', borderRadius: 8, padding: '16px 20px', marginBottom: 12, borderLeft: '3px solid #6B7C93' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ width: 20, height: 20, borderRadius: 4, background: '#6B7C93', border: '1.5px solid #6B7C93', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17' }}>Income Replacement</div>
                  <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter' }}>Inflation-adjusted income replacement over the recovery window</div>
                </div>
              </div>

              {/* Recovery window */}
              <CICoverageWindowSlider ciYears={ciYears} label="Recovery Window" description="Number of years income needs to be replaced" onUpdate={v => updateP({ ciYears: v })} />

              {/* Per-person income % slider */}
              <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr', gap: 20, marginTop: 12 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={labelStyle}>{clientName} — income to replace</label>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#6B7C93' }}>{p.ciIncomePctClient ?? 100}%</span>
                  </div>
                  <input type="range" min={10} max={100} step={1}
                    value={p.ciIncomePctClient ?? 100}
                    onChange={e => updateP({ ciIncomePctClient: parseInt(e.target.value) })}
                    style={{ width: '100%', accentColor: '#6B7C93' }} />
                  <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter', marginTop: 4 }}>
                    {clientGrossMonthly > 0
                      ? `${fmt(clientGrossMonthly)}/mo × ${(p.ciIncomePctClient ?? 100)}% × 12 × ${ciYears.toFixed(1)} yrs`
                      : 'No gross monthly income recorded in Financial Profile'}
                  </div>
                </div>
                {isCouple && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <label style={labelStyle}>{spouseName} — income to replace</label>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#6B7C93' }}>{p.ciIncomePctSpouse ?? 100}%</span>
                    </div>
                    <input type="range" min={10} max={100} step={1}
                      value={p.ciIncomePctSpouse ?? 100}
                      onChange={e => updateP({ ciIncomePctSpouse: parseInt(e.target.value) })}
                      style={{ width: '100%', accentColor: '#6B7C93' }} />
                    <div style={{ fontSize: 11, color: '#888', fontFamily: 'Inter', marginTop: 4 }}>
                      {spouseGrossMonthly > 0
                        ? `${fmt(spouseGrossMonthly)}/mo × ${(p.ciIncomePctSpouse ?? 100)}% × 12 × ${ciYears.toFixed(1)} yrs`
                        : 'No gross monthly income recorded in Financial Profile'}
                    </div>
                  </div>
                )}
              </div>

              <CIPreviewRow isCouple={isCouple} clientName={clientName} spouseName={spouseName} clientVal={ciClient.incomeReplacement ?? 0} spouseVal={ciSpouse.incomeReplacement ?? 0} color="#6B7C93" />
            </div>

            {/* Optional: Mortgage */}
            {mortgages.length > 0 && (
              <div style={{ background: '#F5F0E8', borderRadius: 8, padding: '16px 20px', marginBottom: 12, borderLeft: `3px solid ${p.ciIncludeMortgageInIncome ? '#A8834A' : '#E8E4DC'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: p.ciIncludeMortgageInIncome ? 12 : 0 }}>
                  <div onClick={() => updateP({ ciIncludeMortgageInIncome: !p.ciIncludeMortgageInIncome })}
                    style={{ width: 20, height: 20, borderRadius: 4, cursor: 'pointer', flexShrink: 0, background: p.ciIncludeMortgageInIncome ? '#A8834A' : 'transparent', border: `1.5px solid ${p.ciIncludeMortgageInIncome ? '#A8834A' : '#ccc'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {p.ciIncludeMortgageInIncome && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 600, color: p.ciIncludeMortgageInIncome ? '#1C1A17' : '#aaa' }}>Mortgage Repayments</div>
                    <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'Inter' }}>Monthly repayments continue during illness — add on top of income replacement</div>
                  </div>
                </div>
                {p.ciIncludeMortgageInIncome && (
                  <>
                    {isCouple ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 8 }}>
                        <PersonSlider label={clientName} value={p.ciMortgagePctClient ?? 100} onChange={v => updateP({ ciMortgagePctClient: v })} color="#A8834A" unit="%" />
                        <PersonSlider label={spouseName} value={p.ciMortgagePctSpouse ?? 100} onChange={v => updateP({ ciMortgagePctSpouse: v })} color="#A8834A" unit="%" />
                      </div>
                    ) : (
                      <PersonSlider label="Coverage %" value={p.ciMortgagePctClient ?? 100} onChange={v => updateP({ ciMortgagePctClient: v })} color="#A8834A" unit="%" />
                    )}
                    <CIPreviewRow isCouple={isCouple} clientName={clientName} spouseName={spouseName} clientVal={ciClient.mort} spouseVal={ciSpouse.mort} color="#A8834A" />
                  </>
                )}
              </div>
            )}

            {/* Optional: Education */}
            {children.length > 0 && (
              <div style={{ background: '#F5F0E8', borderRadius: 8, padding: '16px 20px', marginBottom: 12, borderLeft: `3px solid ${p.ciIncludeEduInIncome ? '#2D5A4E' : '#E8E4DC'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div onClick={() => updateP({ ciIncludeEduInIncome: !p.ciIncludeEduInIncome })}
                    style={{ width: 20, height: 20, borderRadius: 4, cursor: 'pointer', flexShrink: 0, background: p.ciIncludeEduInIncome ? '#2D5A4E' : 'transparent', border: `1.5px solid ${p.ciIncludeEduInIncome ? '#2D5A4E' : '#ccc'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {p.ciIncludeEduInIncome && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 600, color: p.ciIncludeEduInIncome ? '#1C1A17' : '#aaa' }}>Education Fund</div>
                    <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'Inter' }}>Children's education costs from Education Fund tab</div>
                  </div>
                  {p.ciIncludeEduInIncome && (
                    <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr', gap: 8, minWidth: isCouple ? 200 : 100 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{clientName}</div>
                        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#2D5A4E' }}>{fmt(ciClient.edu)}</div>
                      </div>
                      {isCouple && <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{spouseName}</div>
                        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#2D5A4E' }}>{fmt(ciSpouse.edu)}</div>
                      </div>}
                    </div>
                  )}
                </div>
              </div>
            )}

            <CIMedicalBufferCard p={p} updateP={updateP} isCouple={isCouple} clientName={clientName} spouseName={spouseName} />
            <CIRecoveryBufferCard p={p} updateP={updateP} isCouple={isCouple} clientName={clientName} spouseName={spouseName} />
          </div>
        )}

        {/* ── MODE: Capital Fund ───────────────────────────────────────────── */}
        {ciMode === 'capital' && (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#F5F0E8', border: '2px dashed #D4C4A8', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <span style={{ fontSize: 20 }}>🔧</span>
            </div>
            <div style={{ fontSize: 14, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17', marginBottom: 8 }}>Capital Fund — Building in Progress</div>
            <div style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', maxWidth: 380, margin: '0 auto', lineHeight: 1.6 }}>
              This method will size a lump-sum investment fund large enough to generate passive income that replaces the client's expenses or income indefinitely — without drawing down the principal.
            </div>
          </div>
        )}

        {/* ── MODE: Custom Amount ──────────────────────────────────────────── */}
        {ciMode === 'custom' && (
          <div>
            <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 16 }}>Enter the CI coverage amount the client wants directly.</p>
            {isCouple ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <CIAmountInput label={clientName} value={p.ciCustomAmountClient ?? 0} onChange={v => updateP({ ciCustomAmountClient: v })} />
                <CIAmountInput label={spouseName} value={p.ciCustomAmountSpouse ?? 0} onChange={v => updateP({ ciCustomAmountSpouse: v })} />
              </div>
            ) : (
              <CIAmountInput label="CI Amount" value={p.ciCustomAmountClient ?? 0} onChange={v => updateP({ ciCustomAmountClient: v })} />
            )}
          </div>
        )}
      </SectionBlock>

      {/* CI Need Summary */}
      <SectionBlock title="Critical Illness Need Summary" color="#2D5A4E">
        {ciMode === 'custom' || ciMode === 'capital' ? (
          <div style={{ display: 'flex', padding: '12px 16px', background: '#1C1A17', borderRadius: 6, alignItems: 'center' }}>
            <span style={{ flex: 1, fontSize: 12, color: '#c8a96e', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              CI Cover Needed{ciMode === 'custom' ? ' (Custom)' : ciMode === 'capital' ? ' (Capital Fund)' : ''}
            </span>
            {isCouple ? (
              <>
                <div style={{ textAlign: 'right', minWidth: 130 }}>
                  <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter' }}>{clientName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: '#F5F0E8' }}>{fmt(ciClient.gross)}</div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 130 }}>
                  <div style={{ fontSize: 10, color: '#888', fontFamily: 'Inter' }}>{spouseName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: '#F5F0E8' }}>{fmt(ciSpouse.gross)}</div>
                </div>
              </>
            ) : <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, color: '#F5F0E8' }}>{fmt(ciClient.gross)}</span>}
          </div>
        ) : (
          <NeedTable
            isCouple={isCouple} clientName={clientName} spouseName={spouseName}
            clientData={ciClient.gross} spouseData={ciSpouse.gross}
            label="CI Cover Needed"
            ciMode={ciMode}
            breakdown={{
              client: { fd: ciClient.fd, mort: ciClient.mort, edu: ciClient.edu, incomeReplacement: ciClient.incomeReplacement, medicalBuffer: ciClient.medicalBuffer, recoveryBuffer: ciClient.recoveryBuffer },
              spouse: { fd: ciSpouse.fd, mort: ciSpouse.mort, edu: ciSpouse.edu, incomeReplacement: ciSpouse.incomeReplacement, medicalBuffer: ciSpouse.medicalBuffer, recoveryBuffer: ciSpouse.recoveryBuffer },
            }}
          />
        )}
      </SectionBlock>
    </div>
  )
}

// ─── SHARED TYPES FOR MED/DIS & GENERAL TABS ────────────────────────────────
interface TabSharedProps {
  p: ProtectionData; updateP: (patch: Partial<ProtectionData>) => void
  isCouple: boolean; clientName: string; spouseName: string
  allFamilyMembers: FamilyMember[]
  insCompanies: {id: number; name: string; category_id: number}[]
  insProducts: {id: number; name: string; company_id: number; category_id: number}[]
  insCategories: {id: number; code: string}[]
  addToPortfolio: (policy: any) => Promise<string | undefined>
}

// ─── SHARED UTILS ────────────────────────────────────────────────────────────

function newEntry(): MedDisEntry {
  return { id: crypto.randomUUID(), companyName: '', productName: '' }
}

const INP: React.CSSProperties = {
  width: '100%', padding: '8px 12px', fontSize: 13, fontFamily: 'Inter, sans-serif',
  border: '1px solid #E8E4DC', borderRadius: 6, background: '#FAFAF8',
  color: '#1C1A17', outline: 'none', boxSizing: 'border-box',
}
const SEL: React.CSSProperties = { ...INP, cursor: 'pointer' }
const LBL: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
  color: '#888', fontFamily: 'Inter', marginBottom: 5, display: 'block',
}
const PILL_TABS: React.CSSProperties = {
  display: 'flex', gap: 0, borderBottom: '1px solid #E8E4DC', marginBottom: 24,
}
function pillBtn(active: boolean, accent = '#A8834A'): React.CSSProperties {
  return {
    padding: '9px 20px', fontSize: 11, letterSpacing: '0.08em',
    textTransform: 'uppercase' as const, fontFamily: 'Inter', fontWeight: 500,
    background: 'none', border: 'none', cursor: 'pointer',
    color: active ? accent : '#999',
    borderBottom: active ? `2px solid ${accent}` : '2px solid transparent',
    transition: 'all 0.15s',
  }
}

// ─── PERSON TOGGLE ───────────────────────────────────────────────────────────

function PersonToggle({ activePerson, setActivePerson, isCouple, clientName, spouseName, allFamilyMembers }: {
  activePerson: string; setActivePerson: (v: string) => void
  isCouple: boolean; clientName: string; spouseName: string
  allFamilyMembers: FamilyMember[]
}) {
  const persons: {id: string; label: string}[] = [
    { id: 'client', label: clientName },
    ...(isCouple ? [{ id: 'spouse', label: spouseName }] : []),
    ...allFamilyMembers.map(f => ({ id: f.id, label: f.name || f.relationship })),
  ]
  return (
    <div style={PILL_TABS}>
      {persons.map(p => (
        <button key={p.id} style={pillBtn(activePerson === p.id)} onClick={() => setActivePerson(p.id)}>
          {p.label}
        </button>
      ))}
    </div>
  )
}

// ─── ENTRY CARD ──────────────────────────────────────────────────────────────

function EntryCard({ entry, categoryId, policyTypeOptions, insCompanies, insProducts, onUpdate, onDelete, onAddToPortfolio, showWard, showSumAssured, showMonthlyBenefit, showBenefitPeriod, addedToPortfolio }: {
  entry: MedDisEntry
  categoryId: number
  policyTypeOptions?: {value: string; label: string}[]
  insCompanies: {id: number; name: string; category_id: number}[]
  insProducts: {id: number; name: string; company_id: number; category_id: number}[]
  onUpdate: (patch: Partial<MedDisEntry>) => void
  onDelete: () => void
  onAddToPortfolio: () => void
  showWard?: boolean
  showSumAssured?: boolean
  showMonthlyBenefit?: boolean
  showBenefitPeriod?: boolean
  addedToPortfolio?: boolean
}) {
  const [adding, setAdding] = useState(false)

  const filteredCompanies = insCompanies.filter(c => c.category_id === categoryId)
  const selectedCompany = filteredCompanies.find(c => c.name === entry.companyName)
  const filteredProducts = selectedCompany
    ? insProducts.filter(p => p.company_id === selectedCompany.id && p.category_id === categoryId)
    : []

  const isMain = entry.policyTypeCode === 'main'

  async function handleAdd() {
    setAdding(true)
    await onAddToPortfolio()
    setAdding(false)
  }

  return (
    <div style={{
      background: '#FAFAF8', borderRadius: 12, padding: '18px 20px',
      border: '1px solid #E8E4DC', marginBottom: 12,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>

        {/* Company */}
        <div>
          <span style={LBL}>Insurance company</span>
          <select style={SEL} value={entry.companyName}
            onChange={e => onUpdate({ companyName: e.target.value, companyId: filteredCompanies.find(c => c.name === e.target.value)?.id, productName: '', productId: undefined })}>
            <option value="">Select company</option>
            {filteredCompanies.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            <option value="__other__">Other (type below)</option>
          </select>
          {entry.companyName === '__other__' && (
            <input style={{ ...INP, marginTop: 6 }} placeholder="Company name"
              onChange={e => onUpdate({ companyName: e.target.value })} />
          )}
        </div>

        {/* Policy type — only if options provided */}
        {policyTypeOptions && (
          <div>
            <span style={LBL}>Policy type</span>
            <select style={SEL} value={entry.policyTypeCode ?? ''}
              onChange={e => onUpdate({ policyTypeCode: e.target.value, wardClass: undefined, hasRider: undefined })}>
              <option value="">Select type</option>
              {policyTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        {/* Product */}
        <div style={policyTypeOptions ? { gridColumn: '1 / -1' } : {}}>
          <span style={LBL}>Product name</span>
          {filteredProducts.length > 0 ? (
            <>
              <select style={SEL} value={entry.productName}
                onChange={e => onUpdate({ productName: e.target.value, productId: filteredProducts.find(p => p.name === e.target.value)?.id, briefDescription: e.target.value })}>
                <option value="">Select product</option>
                {filteredProducts.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                <option value="__other__">Other (type below)</option>
              </select>
              {entry.productName === '__other__' && (
                <input style={{ ...INP, marginTop: 6 }} placeholder="Product name"
                  onChange={e => onUpdate({ productName: e.target.value, briefDescription: e.target.value })} />
              )}
            </>
          ) : (
            <input style={INP} placeholder="Type product name"
              value={entry.productName} onChange={e => onUpdate({ productName: e.target.value, briefDescription: e.target.value })} />
          )}
        </div>

        {/* Ward class — medical main only */}
        {showWard && isMain && (
          <div>
            <span style={LBL}>Ward class</span>
            <select style={SEL} value={entry.wardClass ?? ''}
              onChange={e => onUpdate({ wardClass: e.target.value })}>
              <option value="">Select</option>
              <option value="B1">B1 Ward</option>
              <option value="A">A Ward</option>
              <option value="Private">Private Hospital</option>
              <option value="International">International</option>
            </select>
          </div>
        )}

        {/* Sum Assured */}
        {showSumAssured && (
          <div>
            <span style={LBL}>Sum assured (SGD)</span>
            <input type="number" style={INP} placeholder="e.g. 500000"
              value={entry.sumAssured || ''} onChange={e => onUpdate({ sumAssured: Number(e.target.value) })} />
          </div>
        )}

        {/* Monthly benefit */}
        {showMonthlyBenefit && (
          <div>
            <span style={LBL}>Monthly benefit (SGD)</span>
            <input type="number" style={INP} placeholder="e.g. 3000"
              value={entry.monthlyBenefit || ''} onChange={e => onUpdate({ monthlyBenefit: Number(e.target.value) })} />
          </div>
        )}

        {/* Benefit period */}
        {showBenefitPeriod && (
          <div>
            <span style={LBL}>Benefit period</span>
            <select style={SEL} value={entry.benefitPeriod ?? ''}
              onChange={e => onUpdate({ benefitPeriod: e.target.value })}>
              <option value="">Select</option>
              <option value="Lifetime">Lifetime</option>
              <option value="10 years">10 years</option>
              <option value="5 years">5 years</option>
              <option value="3 years">3 years</option>
            </select>
          </div>
        )}

      </div>

      {/* Footer actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid #EEE' }}>
        <button onClick={onDelete} style={{
          fontSize: 11, fontFamily: 'Inter', color: '#C0392B', background: 'none',
          border: 'none', cursor: 'pointer', padding: '4px 0',
        }}>
          Remove
        </button>
        {addedToPortfolio ? (
          <span style={{ fontSize: 11, fontFamily: 'Inter', color: '#2D5A4E' }}>✓ Added to portfolio</span>
        ) : (
          <button onClick={handleAdd} disabled={adding || !entry.companyName || !entry.productName} style={{
            fontSize: 12, fontFamily: 'Inter', fontWeight: 500,
            padding: '6px 16px', borderRadius: 6, cursor: 'pointer',
            background: (!entry.companyName || !entry.productName) ? '#F0EDE8' : '#1C1A17',
            color: (!entry.companyName || !entry.productName) ? '#aaa' : 'white',
            border: 'none', transition: 'all 0.15s',
          }}>
            {adding ? 'Adding…' : 'Add to Portfolio →'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── MEDICAL & DISABILITY TAB ────────────────────────────────────────────────

function MedicalDisabilityTab({ p, updateP, isCouple, clientName, spouseName, allFamilyMembers, insCompanies, insProducts, insCategories, addToPortfolio }: TabSharedProps) {
  const [activePerson, setActivePerson] = useState('client')

  const medCatId = insCategories.find(c => c.code === 'medical')?.id ?? 0
  const ltcCatId = insCategories.find(c => c.code === 'ltc')?.id ?? 0

  function getEntries(key: 'medicalEntries' | 'ltcEntries'): MedDisEntry[] {
    return (p[key] ?? {})[activePerson] ?? []
  }

  function setEntries(key: 'medicalEntries' | 'ltcEntries', entries: MedDisEntry[]) {
    updateP({ [key]: { ...(p[key] ?? {}), [activePerson]: entries } })
  }

  function updateEntry(key: 'medicalEntries' | 'ltcEntries', id: string, patch: Partial<MedDisEntry>) {
    setEntries(key, getEntries(key).map(e => e.id === id ? { ...e, ...patch } : e))
  }

  function removeEntry(key: 'medicalEntries' | 'ltcEntries', id: string) {
    setEntries(key, getEntries(key).filter(e => e.id !== id))
  }

  async function handleAddToPortfolio(key: 'medicalEntries' | 'ltcEntries', entry: MedDisEntry, categoryCode: string) {
    const portfolioId = await addToPortfolio({
      categoryCode,
      policyTypeCode: entry.policyTypeCode ?? '',
      companyName: entry.companyName,
      productName: entry.productName,
      briefDescription: entry.briefDescription ?? entry.productName,
      monthlyBenefit: entry.monthlyBenefit ?? 0,
      premiumCash: entry.premiumCash ?? 0,
      premiumMedisave: entry.premiumMedisave ?? 0,
      person: activePerson === 'client' ? 'client' : activePerson === 'spouse' ? 'spouse' : activePerson,
      benefitTerm: entry.benefitPeriod ?? '',
      sumAssured: entry.sumAssured ?? 0,
      status: 'In-Force',
    })
    if (portfolioId) updateEntry(key, entry.id, { portfolioId })
  }

  const medEntries = getEntries('medicalEntries')
  const ltcEntries = getEntries('ltcEntries')

  // LTC not shown for child dependents
  const dep = allFamilyMembers.find(f => f.id === activePerson)
  const isChild = dep ? ['Daughter', 'Son', 'Child'].includes(dep.relationship) : false

  return (
    <div>
      <PersonToggle
        activePerson={activePerson} setActivePerson={setActivePerson}
        isCouple={isCouple} clientName={clientName} spouseName={spouseName}
        allFamilyMembers={allFamilyMembers}
      />

      {/* Medical Insurance */}
      <SectionBlock title="Medical Insurance" color="#A8834A">
        <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 16, lineHeight: 1.6 }}>
          Record hospitalisation and surgical coverage. ISP = Integrated Shield Plan (MediShield Life top-up). Add each policy as a separate entry.
        </p>
        {medEntries.map(entry => (
          <EntryCard key={entry.id} entry={entry}
            categoryId={medCatId}
            policyTypeOptions={[{ value: 'main', label: 'Main Plan' }, { value: 'rider', label: 'Rider' }]}
            insCompanies={insCompanies} insProducts={insProducts}
            showWard
            addedToPortfolio={!!entry.portfolioId}
            onUpdate={patch => updateEntry('medicalEntries', entry.id, patch)}
            onDelete={() => removeEntry('medicalEntries', entry.id)}
            onAddToPortfolio={() => handleAddToPortfolio('medicalEntries', entry, 'medical')}
          />
        ))}
        <button onClick={() => setEntries('medicalEntries', [...medEntries, newEntry()])} style={{
          fontSize: 12, fontFamily: 'Inter', fontWeight: 500, color: '#A8834A',
          background: 'none', border: '1px dashed #A8834A', borderRadius: 8,
          padding: '8px 18px', cursor: 'pointer', width: '100%', marginTop: 4,
        }}>
          + Add Medical Policy
        </button>
      </SectionBlock>

      {/* Long Term Care — adults only */}
      {!isChild && (
        <SectionBlock title="Long Term Care Insurance" color="#7B6EA0">
          <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 16, lineHeight: 1.6 }}>
            CareShield Life is Singapore's mandatory scheme from age 30. Private supplements provide higher monthly payouts. Record each policy separately.
          </p>
          {ltcEntries.map(entry => (
            <EntryCard key={entry.id} entry={entry}
              categoryId={ltcCatId}
              insCompanies={insCompanies} insProducts={insProducts}
              showMonthlyBenefit showBenefitPeriod
              addedToPortfolio={!!entry.portfolioId}
              onUpdate={patch => updateEntry('ltcEntries', entry.id, patch)}
              onDelete={() => removeEntry('ltcEntries', entry.id)}
              onAddToPortfolio={() => handleAddToPortfolio('ltcEntries', entry, 'ltc')}
            />
          ))}
          <button onClick={() => setEntries('ltcEntries', [...ltcEntries, newEntry()])} style={{
            fontSize: 12, fontFamily: 'Inter', fontWeight: 500, color: '#7B6EA0',
            background: 'none', border: '1px dashed #7B6EA0', borderRadius: 8,
            padding: '8px 18px', cursor: 'pointer', width: '100%', marginTop: 4,
          }}>
            + Add LTC Policy
          </button>
        </SectionBlock>
      )}
    </div>
  )
}

// ─── GENERAL TAB ─────────────────────────────────────────────────────────────

function GeneralTab({ p, updateP, isCouple, clientName, spouseName, allFamilyMembers, insCompanies, insProducts, insCategories, addToPortfolio }: TabSharedProps) {
  const [activePerson, setActivePerson] = useState('client')

  const generalCatId = insCategories.find(c => c.code === 'general')?.id ?? 0

  function getPAEntries(): MedDisEntry[] {
    return (p.paEntries ?? {})[activePerson] ?? []
  }

  function setPAEntries(entries: MedDisEntry[]) {
    updateP({ paEntries: { ...(p.paEntries ?? {}), [activePerson]: entries } })
  }

  function updatePAEntry(id: string, patch: Partial<MedDisEntry>) {
    setPAEntries(getPAEntries().map(e => e.id === id ? { ...e, ...patch } : e))
  }

  async function handleAddPAToPortfolio(entry: MedDisEntry) {
    const portfolioId = await addToPortfolio({
      categoryCode: 'general',
      policyTypeCode: 'PA',
      companyName: entry.companyName,
      productName: entry.productName,
      briefDescription: entry.briefDescription ?? entry.productName,
      sumAssured: entry.sumAssured ?? 0,
      premiumCash: entry.premiumCash ?? 0,
      person: activePerson === 'client' ? 'client' : activePerson === 'spouse' ? 'spouse' : activePerson,
      status: 'In-Force',
    })
    if (portfolioId) updatePAEntry(entry.id, { portfolioId })
  }

  const groupEntries = (p.groupEntries ?? []).filter(e => e.person === activePerson)
  const isDependent = activePerson !== 'client' && activePerson !== 'spouse'

  function addGroupEntry() {
    const newGroup = {
      id: crypto.randomUUID(), person: activePerson,
      employerName: '', coverageTypes: [],
    }
    updateP({ groupEntries: [...(p.groupEntries ?? []), newGroup] })
  }

  function updateGroupEntry(id: string, patch: object) {
    updateP({ groupEntries: (p.groupEntries ?? []).map(e => e.id === id ? { ...e, ...patch } : e) })
  }

  function removeGroupEntry(id: string) {
    updateP({ groupEntries: (p.groupEntries ?? []).filter(e => e.id !== id) })
  }

  function toggleCoverageType(entryId: string, type: string, current: string[]) {
    const next = current.includes(type) ? current.filter(t => t !== type) : [...current, type]
    updateGroupEntry(entryId, { coverageTypes: next })
  }

  const paEntries = getPAEntries()

  return (
    <div>
      <PersonToggle
        activePerson={activePerson} setActivePerson={setActivePerson}
        isCouple={isCouple} clientName={clientName} spouseName={spouseName}
        allFamilyMembers={allFamilyMembers}
      />

      {/* Personal Accident */}
      <SectionBlock title="Personal Accident Insurance" color="#6B7B8D">
        <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 16, lineHeight: 1.6 }}>
          Covers accidental death, permanent disability, and medical expenses from accidents. Add each PA policy as a separate entry.
        </p>
        {paEntries.map(entry => (
          <EntryCard key={entry.id} entry={entry}
            categoryId={generalCatId}
            insCompanies={insCompanies} insProducts={insProducts}
            showSumAssured
            addedToPortfolio={!!entry.portfolioId}
            onUpdate={patch => updatePAEntry(entry.id, patch)}
            onDelete={() => setPAEntries(paEntries.filter(e => e.id !== entry.id))}
            onAddToPortfolio={() => handleAddPAToPortfolio(entry)}
          />
        ))}
        <button onClick={() => setPAEntries([...paEntries, newEntry()])} style={{
          fontSize: 12, fontFamily: 'Inter', fontWeight: 500, color: '#6B7B8D',
          background: 'none', border: '1px dashed #6B7B8D', borderRadius: 8,
          padding: '8px 18px', cursor: 'pointer', width: '100%', marginTop: 4,
        }}>
          + Add PA Policy
        </button>
      </SectionBlock>

      {/* Company / Group Insurance — client & spouse only */}
      {!isDependent && (
        <SectionBlock title="Company / Group Insurance" color="#8A9A7E">
          <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 16, lineHeight: 1.6 }}>
            Record employer-provided group coverage. This is for reference only — add policies to the portfolio manually if you want them included in coverage calculations.
          </p>
          {groupEntries.map(entry => (
            <div key={entry.id} style={{
              background: '#FAFAF8', borderRadius: 12, padding: '18px 20px',
              border: '1px solid #E8E4DC', marginBottom: 12,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={LBL}>Employer / Group name</span>
                  <input style={INP} placeholder="e.g. ABC Corporation"
                    value={entry.employerName} onChange={e => updateGroupEntry(entry.id, { employerName: e.target.value })} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={LBL}>Coverage types</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                    {[
                      { code: 'GTL', label: 'Group Term Life' },
                      { code: 'GH',  label: 'Group Medical' },
                      { code: 'GPA', label: 'Group PA' },
                      { code: 'GCI', label: 'Group CI' },
                    ].map(opt => {
                      const active = entry.coverageTypes.includes(opt.code)
                      return (
                        <button key={opt.code} onClick={() => toggleCoverageType(entry.id, opt.code, entry.coverageTypes)} style={{
                          padding: '6px 14px', fontSize: 11, fontFamily: 'Inter', fontWeight: 500,
                          border: '1px solid ' + (active ? '#8A9A7E' : '#E8E4DC'),
                          borderRadius: 6, cursor: 'pointer',
                          background: active ? '#8A9A7E' : 'white',
                          color: active ? 'white' : '#555',
                        }}>
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {entry.coverageTypes.includes('GTL') && (
                  <div>
                    <span style={LBL}>GTL sum assured (SGD)</span>
                    <input type="number" style={INP} placeholder="e.g. 200000"
                      value={entry.sumAssuredGTL || ''} onChange={e => updateGroupEntry(entry.id, { sumAssuredGTL: Number(e.target.value) })} />
                  </div>
                )}
                {entry.coverageTypes.includes('GCI') && (
                  <div>
                    <span style={LBL}>GCI sum assured (SGD)</span>
                    <input type="number" style={INP} placeholder="e.g. 100000"
                      value={entry.sumAssuredGCI || ''} onChange={e => updateGroupEntry(entry.id, { sumAssuredGCI: Number(e.target.value) })} />
                  </div>
                )}
                {entry.coverageTypes.includes('GH') && (
                  <div>
                    <span style={LBL}>Group medical annual benefit (SGD)</span>
                    <input type="number" style={INP} placeholder="e.g. 50000"
                      value={entry.annualBenefitGH || ''} onChange={e => updateGroupEntry(entry.id, { annualBenefitGH: Number(e.target.value) })} />
                  </div>
                )}
                {entry.coverageTypes.includes('GPA') && (
                  <div>
                    <span style={LBL}>GPA sum assured (SGD)</span>
                    <input type="number" style={INP} placeholder="e.g. 100000"
                      value={entry.sumAssuredGPA || ''} onChange={e => updateGroupEntry(entry.id, { sumAssuredGPA: Number(e.target.value) })} />
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={LBL}>Notes</span>
                  <textarea style={{ ...INP, resize: 'vertical' as const }} rows={2}
                    placeholder="Coverage limits, dependants included, renewal terms…"
                    value={entry.notes ?? ''} onChange={e => updateGroupEntry(entry.id, { notes: e.target.value })} />
                </div>
              </div>
              <div style={{ paddingTop: 10, borderTop: '1px solid #EEE' }}>
                <button onClick={() => removeGroupEntry(entry.id)} style={{
                  fontSize: 11, fontFamily: 'Inter', color: '#C0392B',
                  background: 'none', border: 'none', cursor: 'pointer',
                }}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button onClick={addGroupEntry} style={{
            fontSize: 12, fontFamily: 'Inter', fontWeight: 500, color: '#8A9A7E',
            background: 'none', border: '1px dashed #8A9A7E', borderRadius: 8,
            padding: '8px 18px', cursor: 'pointer', width: '100%', marginTop: 4,
          }}>
            + Add Group Insurance
          </button>
        </SectionBlock>
      )}
    </div>
  )
}


// ─── ASSET OFFSET TAB ────────────────────────────────────────────────────────
// ── CHANGE 6: Full rewrite of AssetOffsetTab with master switch + per-row toggles ──

function AssetOffsetTab({ ff, p, updateP, isCouple, clientName, spouseName, dtpdClient, dtpdSpouse, ciClient, ciSpouse }: {
  ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void
  isCouple: boolean; clientName: string; spouseName: string
  dtpdClient: CalcResult; dtpdSpouse: CalcResult
  ciClient: CalcResult; ciSpouse: CalcResult
}) {
  const masterEnabled = p.assetOffsetEnabled !== false
  const items = p.assetOffsetItems ?? {}
  const liquidEnabled = items.liquid !== false
  const cpfEnabled = items.cpf !== false
  const propertyEnabled = items.property !== false

  function toggleMaster() {
    updateP({ assetOffsetEnabled: !masterEnabled })
  }

  function toggleItem(key: 'liquid' | 'cpf' | 'property') {
    updateP({ assetOffsetItems: { ...items, [key]: !(items[key] !== false) } })
  }

  const clientLiquid = (ff.a_savings ?? 0) + (ff.a_fixed_deposit ?? 0) + (ff.a_srs ?? 0) + (ff.a_shares ?? 0) + (ff.a_etf ?? 0) + (ff.a_unit_trust ?? 0) + (ff.a_bonds ?? 0) + (ff.a_alternatives ?? 0)
  const spouseLiquid = (ff.a2_savings ?? 0) + (ff.a2_fixed_deposit ?? 0) + (ff.a2_srs ?? 0) + (ff.a2_shares ?? 0) + (ff.a2_etf ?? 0) + (ff.a2_unit_trust ?? 0) + (ff.a2_bonds ?? 0) + (ff.a2_alternatives ?? 0)
  const clientCPF = (ff.a_cpf_oa ?? 0) + (ff.a_cpf_sa ?? 0) + (ff.a_cpf_ma ?? 0) + (ff.a_cpf_ra ?? 0)
  const spouseCPF = (ff.a2_cpf_oa ?? 0) + (ff.a2_cpf_sa ?? 0) + (ff.a2_cpf_ma ?? 0) + (ff.a2_cpf_ra ?? 0)

  const properties = (ff.properties ?? []) as any[]
  const mortgageProps = properties.filter((prop: any) => prop.initialLoanAmount || prop.outstanding || prop.monthlyRepayment)
  function getPropPct(prop: any, who: 'client' | 'spouse'): number {
    const mortgageIdx = mortgageProps.findIndex((m: any) => m.id === prop.id)
    if (mortgageIdx === -1) {
      const ot = prop.ownershipType ?? ''
      if (ot === 'Spouse Only') return who === 'spouse' ? 1 : 0
      if (ot === 'Joint Tenancy') return 0.5
      if (ot === 'Tenancy-in-Common') {
        const parts = (prop.ownershipSplit ?? '50/50').split('/')
        return who === 'client' ? (parseFloat(parts[0]) / 100 || 0.5) : (parseFloat(parts[1]) / 100 || 0.5)
      }
      return who === 'client' ? 1 : 0
    }
    const pcts = who === 'client' ? (p.mortgageCoverPctsClient ?? []) : (p.mortgageCoverPctsSpouse ?? [])
    return (pcts[mortgageIdx] ?? 100) / 100
  }
  const clientPropEquity = properties.reduce((sum: number, prop: any) => {
    return sum + (prop.propertyValue ?? prop.purchasePrice ?? 0) * getPropPct(prop, 'client')
  }, 0)
  const spousePropEquity = properties.reduce((sum: number, prop: any) => {
    return sum + (prop.propertyValue ?? prop.purchasePrice ?? 0) * getPropPct(prop, 'spouse')
  }, 0)

  // Effective totals respecting per-category toggles
  const effectiveClientDTPD = (liquidEnabled ? clientLiquid : 0) + (cpfEnabled ? clientCPF : 0) + (propertyEnabled ? clientPropEquity : 0)
  const effectiveSpouseDTPD = (liquidEnabled ? spouseLiquid : 0) + (cpfEnabled ? spouseCPF : 0) + (propertyEnabled ? spousePropEquity : 0)
  const effectiveClientCI = liquidEnabled ? clientLiquid : 0
  const effectiveSpouseCI = liquidEnabled ? spouseLiquid : 0

  const colHeader = (name: string) => (
    <span style={{ width: 120, textAlign: 'right', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', fontFamily: 'Inter' }}>{name}</span>
  )

  return (
    <div>
      {/* ── Master switch ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px', marginBottom: 24,
        background: masterEnabled ? '#F5F0E8' : '#FAF8F5',
        border: `1px solid ${masterEnabled ? '#A8834A' : '#E8E4DC'}`,
        borderRadius: 8, transition: 'all 0.2s',
      }}>
        <div>
          <div style={{ fontSize: 14, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17' }}>Asset Offset</div>
          <div style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginTop: 3 }}>
            {masterEnabled
              ? 'Assets are being deducted from gross coverage needs.'
              : 'Asset offset is disabled — gross needs are used as coverage targets.'}
          </div>
        </div>
        <Toggle value={masterEnabled} onChange={toggleMaster} />
      </div>

      {/* ── Content dims when master is off ── */}
      <div style={{ opacity: masterEnabled ? 1 : 0.4, pointerEvents: masterEnabled ? 'auto' : 'none', transition: 'opacity 0.2s' }}>
        <p style={{ fontSize: 12, color: '#888', fontFamily: 'Inter', marginBottom: 20 }}>
          D/TPD offsets include CPF and property values (by ownership %). CI offsets use liquid assets only. Toggle individual categories to include or exclude them.
        </p>

        <SectionBlock title="Asset Values" color="#2D5A4E">
          {isCouple && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 0, marginBottom: 4 }}>
              {colHeader(clientName)}
              {colHeader(spouseName)}
            </div>
          )}

          {/* Per-category toggle rows */}
          {[
            { key: 'liquid' as const, label: 'Cash & Liquid Investments', clientVal: clientLiquid, spouseVal: spouseLiquid, enabled: liquidEnabled, note: 'D/TPD + CI' },
            { key: 'cpf' as const, label: 'CPF (OA + SA + MA + RA)', clientVal: clientCPF, spouseVal: spouseCPF, enabled: cpfEnabled, note: 'D/TPD only' },
            { key: 'property' as const, label: 'Property Value (by ownership %)', clientVal: clientPropEquity, spouseVal: spousePropEquity, enabled: propertyEnabled, note: 'D/TPD only' },
          ].map(row => (
            <div key={row.key} style={{
              display: 'flex', alignItems: 'center', padding: '10px 12px',
              borderBottom: '1px solid #E8E4DC', gap: 10,
              background: row.enabled ? 'transparent' : '#FAF8F5',
              transition: 'background 0.15s',
            }}>
              {/* Checkbox toggle */}
              <div
                onClick={() => toggleItem(row.key)}
                style={{
                  width: 20, height: 20, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
                  background: row.enabled ? '#2D5A4E' : 'transparent',
                  border: `1.5px solid ${row.enabled ? '#2D5A4E' : '#ccc'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {row.enabled && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
              </div>
              {/* Label + note */}
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontFamily: 'Inter', color: row.enabled ? '#1C1A17' : '#aaa' }}>{row.label}</span>
                <span style={{ fontSize: 10, color: '#bbb', fontFamily: 'Inter', marginLeft: 8 }}>{row.note}</span>
              </div>
              {/* Values */}
              {isCouple ? (
                <>
                  <span style={{ width: 120, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 13, color: row.enabled ? '#2D5A4E' : '#ccc' }}>{fmt(row.clientVal)}</span>
                  <span style={{ width: 120, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 13, color: row.enabled ? '#2D5A4E' : '#ccc' }}>{fmt(row.spouseVal)}</span>
                </>
              ) : (
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: row.enabled ? '#2D5A4E' : '#ccc' }}>{fmt(row.clientVal)}</span>
              )}
            </div>
          ))}

          {/* D/TPD Offset total */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: '#F5F0E8' }}>
            <span style={{ flex: 1, fontSize: 12, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17', textTransform: 'uppercase', letterSpacing: '0.06em' }}>D/TPD Offset (all assets)</span>
            {isCouple ? (
              <>
                <span style={{ width: 120, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 600 }}>{fmt(effectiveClientDTPD)}</span>
                <span style={{ width: 120, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 600 }}>{fmt(effectiveSpouseDTPD)}</span>
              </>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 600 }}>{fmt(effectiveClientDTPD)}</span>
            )}
          </div>

          {/* CI Offset total */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: '#E8F0ED', borderRadius: '0 0 4px 4px' }}>
            <span style={{ flex: 1, fontSize: 12, fontFamily: 'Inter', fontWeight: 600, color: '#2D5A4E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>CI Offset (liquid only)</span>
            {isCouple ? (
              <>
                <span style={{ width: 120, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 600 }}>{fmt(effectiveClientCI)}</span>
                <span style={{ width: 120, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 600 }}>{fmt(effectiveSpouseCI)}</span>
              </>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#2D5A4E', fontWeight: 600 }}>{fmt(effectiveClientCI)}</span>
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
            <SidebarRow label="Existing D/TPD" value={existLife} color="#2D5A4E" />
            <SidebarRow label="Existing CI" value={existCI} color="#2D5A4E" />
          </div>
          <div style={{ borderTop: '1px solid #E8E4DC', paddingTop: 8, marginTop: 2 }}>
            <SidebarRow label="D/TPD Gap" value={lifeGap} color={lifeGap > 0 ? '#C0392B' : '#2D5A4E'} />
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
  function PersonCard({ name, dtpdKey, ciKey }: { name: string; dtpdKey: keyof ProtectionData; ciKey: keyof ProtectionData }) {
    const dtpdVal = (p[dtpdKey] as number) ?? 0
    const ciVal = (p[ciKey] as number) ?? 0
    return (
      <div style={{ background: '#F5F0E8', borderRadius: 6, padding: '12px 14px', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontFamily: 'Inter', fontWeight: 600, color: '#1C1A17', marginBottom: 10 }}>{name}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { label: 'D/TPD', val: dtpdVal },
            { label: 'CI', val: ciVal },
          ].map(({ label, val }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: '#888', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: val > 0 ? '#2D5A4E' : '#bbb' }}>
                {val > 0 ? fmt(val) : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <a
        href="/dashboard/protection?tab=portfolio"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 12px', marginBottom: 12,
          background: 'transparent', border: '1px solid #A8834A', borderRadius: 4, color: '#A8834A',
          fontSize: 11, fontFamily: 'Inter', textDecoration: 'none', letterSpacing: '0.05em' }}
      >
        → Wealth Protection Portfolio
      </a>
      <div style={{ fontSize: 10, color: '#aaa', fontFamily: 'Inter', marginBottom: 10, textAlign: 'center', fontStyle: 'italic' }}>
        Values pulled from Wealth Protection Portfolio
      </div>
      <PersonCard name={clientName} dtpdKey="existingLifeCoverClient" ciKey="existingCICoverClient" />
      {isCouple && (
        <PersonCard name={spouseName} dtpdKey="existingLifeCoverSpouse" ciKey="existingCICoverSpouse" />
      )}
    </div>
  )
}

// ─── EDIT SUB-ITEMS MODAL ────────────────────────────────────────────────────

function EditSubItemsModal({ category, ff, p, updateP, onClose, isCouple, clientName, spouseName }: {
  category: string; ff: FactFinding; p: ProtectionData; updateP: (c: Partial<ProtectionData>) => void; onClose: () => void
  isCouple: boolean; clientName: string; spouseName: string
}) {
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

  const selectedClientTotal = keys.filter(k => isCouple ? isClientIncluded(k) : subItems[k] !== false)
    .reduce((s, k) => s + (ff[k] as number || 0), 0)
  const selectedSpouseTotal = keys.filter(k => isSpouseIncluded(k))
    .reduce((s, k) => s + (ff[k.replace('d_','d2_')] as number || 0), 0)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: '28px 32px', minWidth: 480, maxWidth: 580, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '82vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 400, color: '#1C1A17', margin: 0 }}>
            {EXPENSE_CATEGORY_LABELS[category]}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#888' }}>×</button>
        </div>
        <p style={{ fontSize: 11, color: '#888', fontFamily: 'Inter', marginBottom: 16 }}>
          {isCouple ? 'Tick under each person to include that expense in their protection calculation.' : 'Select which line items to include in the protection calculation.'}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 110px 110px' : '1fr 24px 110px', gap: 8, padding: '0 10px 8px', borderBottom: '1px solid #E8E4DC', marginBottom: 4 }}>
          <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Item</div>
          <div style={{ fontSize: 9, color: '#A8834A', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center' }}>{clientName}</div>
          {isCouple && <div style={{ fontSize: 9, color: '#2D5A4E', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center' }}>{spouseName}</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
                style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 110px 110px' : '1fr 24px 110px',
                  gap: 8, padding: '10px 10px', borderRadius: 6,
                  background: rowActive ? '#F5F0E8' : 'transparent', alignItems: 'center',
                  borderBottom: '1px solid #F0EDE8' }}
              >
                <div>
                  <div style={{ fontSize: 13, fontFamily: 'Inter', color: '#1C1A17', marginBottom: 2 }}>{DETAILED_EXPENSE_LABELS[key]}</div>
                  {total > 0 && (
                    <div style={{ fontSize: 10, color: '#888', fontFamily: 'DM Mono, monospace' }}>
                      {isCouple
                        ? `${fmt(clientVal)} (${clientPct}%) · ${fmt(spouseVal)} (${spousePct}%)`
                        : `${fmt(clientVal)}/yr`}
                    </div>
                  )}
                </div>

                {isCouple ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
                    onClick={() => toggleClient(key)}>
                    <div style={{ width: 20, height: 20, borderRadius: 4, cursor: 'pointer',
                      background: clientOn ? '#A8834A' : 'transparent',
                      border: `2px solid ${clientOn ? '#A8834A' : '#ccc'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {clientOn && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                    </div>
                    {clientVal > 0 && <div style={{ fontSize: 10, fontFamily: 'DM Mono, monospace', color: '#A8834A' }}>{fmt(clientVal)}</div>}
                  </div>
                ) : (
                  <div style={{ width: 20, height: 20, borderRadius: 4, cursor: 'pointer', margin: '0 auto',
                    background: clientOn ? '#A8834A' : 'transparent',
                    border: `2px solid ${clientOn ? '#A8834A' : '#ccc'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => toggleItem(key)}>
                    {clientOn && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                  </div>
                )}

                {isCouple && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
                    onClick={() => toggleSpouse(key)}>
                    <div style={{ width: 20, height: 20, borderRadius: 4, cursor: 'pointer',
                      background: spouseOn ? '#2D5A4E' : 'transparent',
                      border: `2px solid ${spouseOn ? '#2D5A4E' : '#ccc'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {spouseOn && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                    </div>
                    {spouseVal > 0 && <div style={{ fontSize: 10, fontFamily: 'DM Mono, monospace', color: '#2D5A4E' }}>{fmt(spouseVal)}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 16, padding: '12px 14px', background: '#1C1A17', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#c8a96e', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Selected Total</span>
            {isCouple ? (
              <div style={{ display: 'flex', gap: 20 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: '#A8834A', fontFamily: 'Inter', marginBottom: 2 }}>{clientName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#F5F0E8' }}>{fmt(selectedClientTotal)}/yr</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: '#2D5A4E', fontFamily: 'Inter', marginBottom: 2 }}>{spouseName}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: '#F5F0E8' }}>{fmt(selectedSpouseTotal)}/yr</div>
                </div>
              </div>
            ) : (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: '#F5F0E8' }}>{fmt(selectedClientTotal)}/yr</span>
            )}
          </div>
        </div>

        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '9px 24px', background: '#1C1A17', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'Inter', fontSize: 13, letterSpacing: '0.06em' }}>
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

function NeedTable({ isCouple, clientName, spouseName, clientData, spouseData, label, breakdown, ciMode }: {
  isCouple: boolean; clientName: string; spouseName: string
  clientData: number; spouseData: number; label: string
  ciMode?: string
  breakdown?: {
    client: { fd: number; mort: number; edu: number; incomeReplacement?: number; medicalBuffer?: number; recoveryBuffer?: number }
    spouse: { fd: number; mort: number; edu: number; incomeReplacement?: number; medicalBuffer?: number; recoveryBuffer?: number }
  }
}) {
  const primaryLabel = ciMode === 'income' ? 'Income' : 'Expenses'
  const primaryKey = ciMode === 'income' ? 'incomeReplacement' : 'fd'

  const allRows = breakdown ? [
    { key: primaryKey, label: primaryLabel },
    { key: 'mort', label: 'Mortgage' },
    { key: 'edu', label: 'Education' },
    { key: 'medicalBuffer', label: 'Medical' },
    { key: 'recoveryBuffer', label: 'Recovery' },
  ].filter(r => (breakdown.client as any)[r.key] > 0 || (breakdown.spouse as any)[r.key] > 0) : []

  const baseRows = allRows

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
          {baseRows.map((row, idx) => (
            <div key={row.key} style={{ flex: 1, padding: '8px 6px', borderRight: idx < baseRows.length - 1 ? '1px solid #E8E4DC' : 'none' }}>
              <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{row.label}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#1C1A17' }}>{fmt((breakdown.client as any)[row.key] ?? 0)}</div>
              {isCouple && <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#888', marginTop: 2 }}>{fmt((breakdown.spouse as any)[row.key] ?? 0)}</div>}
            </div>
          ))}
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

export default function ObjectivesPage() {
  return (
    <Suspense fallback={null}>
      <ObjectivesPageInner />
    </Suspense>
  )
}
