'use client'
import React, { useState, useMemo, useRef, useEffect } from 'react'
import { ProtectionSnapshot, PersonProtectionBreakdown, PersonCIBreakdown, CoverageTimeline, CoverageMilestoneType } from '@/lib/protectionSnapshot'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Policy {
  id: string
  // Classification
  categoryCode: string
  policyTypeCode: string
  companyName: string
  productName: string
  // People
  policyholder: string
  lifeAssured: string
  // Policy details
  policyNo: string
  briefDescription: string
  // Sums
  baseDeath: number
  baseTPD: number
  baseAdvCI: number
  baseEarlyCI: number
  sumAssured: number
  monthlyBenefit: number
  deferredPeriod: string
  benefitTerm?: string
  payoutTerm?: string
  multiplier: number
  multiplierEnd?: number
  coverStep: number
  stepDownPct?: number
  currentCashValue: number
  // Endowment benefit input modes
  endowDeathMode?: '%' | '$'
  endowTPDMode?: '%' | '$'
  // Premiums
  premiumMedisave: number
  premiumCash: number
  premiumMode: string
  frequency: string
  // Dates
  inceptionDate: string
  premiumMaturity: string
  coverageMaturity: string
  // Status
  status: string
  remarks: string
  // Section
  person: string
  // USD policy flag
  isUSD?: boolean
  fxRate?: number
}

interface RiskMgmtData {
  policies: Policy[]
  advisorNotes: string
}

interface ProtectionOverviewProps {
  clientName: string
  clientAge: number
  spouseName: string
  spouseAge: number
  isCouple: boolean
  children: any[]
  ffData: any
  clientDTPD: number
  clientCI: number
  spouseDTPD: number
  spouseCI: number
  activePolicies: Policy[]
  rmData: RiskMgmtData
  updateRm: (data: RiskMgmtData) => void
  inflation: number
  educationChildren?: any[]  // From Objectives page - contains uniEntryAge per child
  // Richer per-category breakdown, built by the same protectionSnapshot.ts
  // used on the Financial Report — powers the redesigned scenario cards below.
  // Optional/nullable because it loads asynchronously; cards fall back to a
  // loading state until it's ready rather than reading undefined fields.
  protectionSnapshot?: ProtectionSnapshot | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (!n || n === 0) return '—'
  return '$' + Math.round(n).toLocaleString()
}

function fmtShort(n: number): string {
  if (!n || n === 0) return '$0'
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1000) return `$${Math.round(n / 1000)}K`
  return `$${Math.round(n).toLocaleString()}`
}

// Milestone icons — lucide path data (GraduationCap / Home / Palmtree), drawn
// as raw SVG paths so the chart's SVG coordinate space needs no lucide import.
// Same three icons ProtectionDisplay uses. Names now live in the hover
// tooltip; these render as small markers along the top of the chart.
const MILESTONE_ICON_PATHS: Record<string, string[]> = {
  grad: ['M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z', 'M22 10v6', 'M6 12.5V16a6 3 0 0 0 12 0v-3.5'],
  home: ['m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  palm: ['M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4', 'M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3', 'M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35', 'M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14'],
}

// Icon centered at the origin, sized `size` px, for placement via a translate()
// wrapper inside the chart SVG. Stroke units are pre-scale (lucide draws at 24px).
function MilestoneIconAtOrigin({ icon, size, color }: { icon: string; size: number; color: string }) {
  const s = size / 24
  return (
    <g transform={`translate(${-size / 2},${-size / 2}) scale(${s})`} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {(MILESTONE_ICON_PATHS[icon] || []).map((d, i) => <path key={i} d={d} />)}
    </g>
  )
}

// Inline 15px icon for the tooltip milestone banner.
function MilestoneIconInline({ icon, color }: { icon: string; color: string }) {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 15px' }}>
      {(MILESTONE_ICON_PATHS[icon] || []).map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

function toSGD(val: number, p: Policy): number {
  return p.isUSD ? val * (p.fxRate || 1.35) : val
}

function fvAnnuity(annual: number, r: number, y: number): number {
  if (y <= 0) return 0
  if (r === 0) return annual * y
  return annual * ((Math.pow(1 + r, y) - 1) / r)
}

function pvMortgage(outstanding: number, rate: number, tenure: number): number {
  if (outstanding <= 0) return 0
  if (rate === 0) return outstanding
  return outstanding
}

// Mortgage data lives directly on each PropertyItem (outstanding,
// initialLoanAmount, initialTenure, remainingTenure, loanStartDate) — there
// is no nested `property.mortgages[]` array in the schema. Mirrors
// calcMortgageForPerson() on the Objectives page so this page's mortgage
// slope agrees with the saved need figure and the Risk Management timeline.
function resolveMortgageFields(pr: any): { outstanding: number; rate: number; tenure: number } | null {
  const hasLoan = pr.initialLoanAmount || pr.outstanding || pr.monthlyRepayment
  if (!hasLoan) return null
  const initialTenure = Number(pr.initialTenure) || 25
  const initialLoan = Number(pr.initialLoanAmount ?? pr.outstanding ?? 0)
  const rate = Number(pr.interestRate || 0) / 100
  let remainingTenure = pr.remainingTenure ?? initialTenure
  if (!pr.remainingTenure && pr.loanStartDate) {
    const [mm, yyyy] = String(pr.loanStartDate).split('/')
    if (mm && yyyy) {
      const start = new Date(parseInt(yyyy), parseInt(mm) - 1)
      const elapsedYears = (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
      remainingTenure = Math.max(0, Math.round(initialTenure - elapsedYears))
    }
  }
  const outstanding = Number(pr.outstanding ?? initialLoan)
  return { outstanding, rate, tenure: Number(remainingTenure) || 0 }
}

// Mortgage balance remaining at a future age
function mortBalanceAtAge(
  atAge: number,
  currentAge: number,
  properties: any[]
): number {
  const resolved = (properties || [])
    .map(resolveMortgageFields)
    .filter((m): m is { outstanding: number; rate: number; tenure: number } => m !== null)
  return resolved.reduce((total: number, m) => {
    const { outstanding, rate, tenure } = m
    if (outstanding <= 0 || tenure <= 0) return total
    const yearsElapsed = atAge - currentAge
    const yearsLeft = Math.max(0, tenure - yearsElapsed)
    if (yearsLeft <= 0) return total
    if (rate === 0) return total + outstanding * (yearsLeft / tenure)
    const monthlyRate = rate / 12
    const totalMonths = tenure * 12
    const monthlyPmt =
      outstanding * monthlyRate / (1 - Math.pow(1 + monthlyRate, -totalMonths))
    const monthsLeft = yearsLeft * 12
    return total + monthlyPmt * (1 - Math.pow(1 + monthlyRate, -monthsLeft)) / monthlyRate
  }, 0)
}

// Coverage maturity check — returns true if policy is still active at given age
function policyActiveAtAge(p: Policy, age: number, currentAge: number): boolean {
  const mat = p.coverageMaturity
  if (!mat || mat === 'Lifetime' || mat === 'Renewable') return true
  if (mat.startsWith('Age ')) {
    return age <= parseInt(mat.replace('Age ', ''))
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(mat)) {
    const matYear = new Date(mat).getFullYear()
    const birthYear = new Date().getFullYear() - currentAge
    return age <= matYear - birthYear
  }
  return true
}

// Effective multiplier at a given age
function effectiveMultiplierAtAge(p: Policy, age: number): number {
  const mult = p.multiplier > 1 ? p.multiplier : 1
  const multEnd = p.multiplierEnd || 999
  if (age <= multEnd) return mult
  // After multiplierEnd — apply step-down
  if (p.coverStep && p.stepDownPct && age > multEnd) {
    const yearsIntoStep = Math.min(age - multEnd, p.coverStep)
    const stepFactor = Math.max(0, 1 - yearsIntoStep * ((p.stepDownPct || 0) / 100))
    return Math.max(1, mult * stepFactor)
  }
  return 1
}

// D/TPD have at a given age for a person
function getDTPDHaveAtAge(
  age: number,
  person: string,
  currentAge: number,
  activePolicies: Policy[]
): number {
  return activePolicies
    .filter(p => p.person === person && p.categoryCode === 'life')
    .reduce((sum, p) => {
      if (!policyActiveAtAge(p, age, currentAge)) return sum
      const mult = effectiveMultiplierAtAge(p, age)
      const death = toSGD((p.baseDeath || 0) * mult, p)
      const tpd = toSGD((p.baseTPD || 0) * mult, p)
      return sum + Math.max(death, tpd)
    }, 0)
}

// CI have at a given age for a person
function getCIHaveAtAge(
  age: number,
  person: string,
  currentAge: number,
  activePolicies: Policy[]
): number {
  return activePolicies
    .filter(p => p.person === person && p.categoryCode === 'life')
    .reduce((sum, p) => {
      if (!policyActiveAtAge(p, age, currentAge)) return sum
      const mult = effectiveMultiplierAtAge(p, age)
      const advCI = toSGD((p.baseAdvCI || 0) * mult, p)
      const earlyCI = toSGD((p.baseEarlyCI || 0) * mult, p)
      return sum + Math.max(advCI, earlyCI)
    }, 0)
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ProtectionOverview({
  clientName,
  clientAge,
  spouseName,
  spouseAge,
  isCouple,
  children,
  ffData,
  clientDTPD,
  clientCI,
  spouseDTPD,
  spouseCI,
  activePolicies,
  rmData,
  updateRm,
  inflation,
  educationChildren = [],
  protectionSnapshot,
}: ProtectionOverviewProps) {
  const [activePerson, setActivePerson] = useState<'client' | 'spouse'>('client')
 const ff = ffData || {}
const properties: any[] = ff.properties || []
const savedPlanType = ff.protection?.planType ?? ff.planType ?? null
// Mirrors the isIndividualMode check in protection/page.tsx: an explicit
// 'individual' planType forces individual mode, but the default/unset value
// ('individual' is the Objectives page's initial state before a client is
// ever configured) must NOT silently hide a real spouse — trust the isCouple
// prop (already derived from actual person2 presence) unless planType is
// explicitly 'individual'.
const effectiveIsCouple = savedPlanType === 'individual' ? false : isCouple

// Refs to stabilize memoization
const policiesRef = useRef(activePolicies)
const propertiesRef = useRef(properties)

useEffect(() => {
  policiesRef.current = activePolicies
  propertiesRef.current = properties
}, [activePolicies, properties])

  // ── Expenses ────────────────────────────────────────────────────────────────
  const p1AnnExp = useMemo(() => {
    const exp =
      (Number(ff.s_financial) || 0) +
      (Number(ff.s_household) || 0) +
      (Number(ff.s_personal) || 0) +
      (Number(ff.s_children) || 0) +
      (Number(ff.s_lifestyle) || 0)
    // s_mortgage excluded — mortgage is handled separately via mortBalanceAtAge
    const income = Number(ff.person1?.gross_monthly || ff.monthly_income || 0) * 12
    return exp > 0 ? exp : income * 0.7
  }, [ff])

  const p2AnnExp = useMemo(() => {
    const exp =
      (Number(ff.s2_financial) || 0) +
      (Number(ff.s2_household) || 0) +
      (Number(ff.s2_personal) || 0) +
      (Number(ff.s2_children) || 0) +
      (Number(ff.s2_lifestyle) || 0)
    // s2_mortgage excluded — mortgage is handled separately via mortBalanceAtAge
    const income = Number(ff.person2?.gross_monthly || ff.monthly_income_spouse || 0) * 12
    return exp > 0 ? exp : income * 0.7
  }, [ff])

  const p1MonthlyInc = Number(ff.person1?.gross_monthly || ff.monthly_income || 0)
  const p2MonthlyInc = Number(ff.person2?.gross_monthly || ff.monthly_income_spouse || 0)
  const p1RetireAge = Number(ff.retirement_age || ff.person1?.retirement_age || ff.client?.retirementAge || 65)
const p2RetireAge = Number(ff.retirement_age_spouse || ff.person2?.retirement_age || ff.spouse?.retirementAge || 62)

  // ── Cover term (until youngest child independent) ───────────────────────────
  const coverTerm = useMemo(() => {
    if (children.length === 0) return 25
    const minChildAge = Math.min(...children.map((c: any) => Number(c.age || 0)))
    return Math.max(5, 26 - minChildAge)
  }, [children])

  // ── Uni entry ages per child (for sharp drops) ──────────────────────────────
  const childUniEntryAges = useMemo(() => {
  const baseAge = activePerson === 'spouse' ? spouseAge : clientAge
  return children.map((c: any) => {
    const childAge = Number(c.age || 0)
    const gender = c.gender || ''
    const eduChild = educationChildren?.find((ec: any) => ec.childId === c.id)
    const uniEntryAge = eduChild?.uniEntryAge ?? (gender === 'Female' ? 19 : 21)
    const parentAgeAtUni = baseAge + (uniEntryAge - childAge)
    return { childAge, uniEntryAge, parentAgeAtUni, name: c.name || 'Child' }
  }).sort((a, b) => a.parentAgeAtUni - b.parentAgeAtUni)
}, [children, clientAge, spouseAge, activePerson, educationChildren])

  // ── Floor calculation ───────────────────────────────────────────────────────
  // Floor = higher of ($300K) or (basic living expenses inflated to retirement/last milestone)
  function getFloor(person: 'client' | 'spouse'): number {
    const currentAge = person === 'client' ? clientAge : spouseAge
    const lifeExp = Number(
      person === 'client'
        ? ff.client?.lifeExpectancy
        : ff.spouse?.lifeExpectancy
    ) || 85
    const ciWindow = Number(ff.protection?.ciYears) || 5
  // Floor expenses = Household & Living + Personal only
    // (Financial obligations, children, lifestyle excluded — bare minimum during CI in retirement)
    const p1RetirementExp = ff.expense_mode === 'detailed'
      ? (Number(ff.d_conservancy)||0)+(Number(ff.d_utilities)||0)+(Number(ff.d_family_food)||0)+(Number(ff.d_maid)||0)+(Number(ff.d_other_household)||0)
        +(Number(ff.d_personal_food)||0)+(Number(ff.d_transport)||0)+(Number(ff.d_car_petrol)||0)+(Number(ff.d_car_insurance)||0)
      : (Number(ff.s_household)||0)+(Number(ff.s_personal)||0)
    const p2RetirementExp = ff.expense_mode === 'detailed'
      ? (Number(ff.d2_conservancy)||0)+(Number(ff.d2_utilities)||0)+(Number(ff.d2_family_food)||0)+(Number(ff.d2_maid)||0)+(Number(ff.d2_other_household)||0)
        +(Number(ff.d2_personal_food)||0)+(Number(ff.d2_transport)||0)+(Number(ff.d2_car_petrol)||0)+(Number(ff.d2_car_insurance)||0)
      : (Number(ff.s2_household)||0)+(Number(ff.s2_personal)||0)
    const effectiveExp = person === 'client'
      ? (p1RetirementExp > 0 ? p1RetirementExp : p1AnnExp)
      : (p2RetirementExp > 0 ? p2RetirementExp : p2AnnExp)
    // Window = last ciWindow years of life: from (lifeExp - ciWindow) to (lifeExp - 1)
    // Sum of annual expenses inflated to each of those years
    const windowStart = lifeExp - ciWindow  // age at start of window
    let floorFromExpenses = 0
    for (let age = windowStart; age < lifeExp; age++) {
      const yearsFromNow = Math.max(0, age - currentAge)
      floorFromExpenses += effectiveExp * Math.pow(1 + inflation, yearsFromNow)
    }
   console.log('[FLOOR] ' + JSON.stringify({ person, lifeExp, ciWindow, effectiveExp, windowStart, floorFromExpenses, result: Math.max(300000, floorFromExpenses) }))
    return Math.max(300000, floorFromExpenses)
  }

  const p1LifeExp = Number(ff.client?.lifeExpectancy) || 85
  const p2LifeExp = Number(ff.spouse?.lifeExpectancy) || 85
  const clientFloor = useMemo(() => getFloor('client'), [clientAge, inflation, p1AnnExp, p1LifeExp, ff.protection?.ciYears, ff.expense_mode, ff.d_conservancy, ff.d_utilities, ff.d_family_food, ff.d_maid, ff.d_other_household, ff.d_personal_food, ff.d_transport, ff.d_car_petrol, ff.d_car_insurance, ff.s_household, ff.s_personal])
  const spouseFloor = useMemo(() => getFloor('spouse'), [spouseAge, inflation, p2AnnExp, p2LifeExp, ff.protection?.ciYears, ff.expense_mode, ff.d2_conservancy, ff.d2_utilities, ff.d2_family_food, ff.d2_maid, ff.d2_other_household, ff.d2_personal_food, ff.d2_transport, ff.d2_car_petrol, ff.d2_car_insurance, ff.s2_household, ff.s2_personal])

  // ── CPF and liquid assets ───────────────────────────────────────────────────
  const p1CPF = (Number(ff.a_cpf_oa) || 0) + (Number(ff.a_cpf_sa) || 0) + (Number(ff.a_cpf_ma) || 0)
  const p2CPF = (Number(ff.a2_cpf_oa) || 0) + (Number(ff.a2_cpf_sa) || 0) + (Number(ff.a2_cpf_ma) || 0)
  const p1Prop = properties
    .filter((p: any) => p.owner === 'client' || p.owner === 'joint')
    .reduce((s: number, p: any) => s + Number(p.current_value || 0) * (p.owner === 'joint' ? 0.5 : 1), 0)
  const p2Prop = properties
    .filter((p: any) => p.owner === 'spouse' || p.owner === 'joint')
    .reduce((s: number, p: any) => s + Number(p.current_value || 0) * (p.owner === 'joint' ? 0.5 : 1), 0)
  const p1Liq = (Number(ff.a_savings) || 0) + (Number(ff.a_alternatives) || 0)
  const p2Liq = (Number(ff.a2_savings) || 0) + (Number(ff.a2_alternatives) || 0)

  // Per-child education fund from Education Planning section
  // edu.children is array of EducationChild with uniEntryAge, annualTuition, annualLiving, courseDuration
  // Read education children from Wealth Protection > Education Fund tab
  // Saved under protection_needs section as protection.educationChildren
  const wpEduChildren: any[] = ff.protection?.educationChildren || []
  const provideEduFund: boolean = ff.protection?.provideEducationFund === true
  const tuitionInflation = 0.05  // WP Education Fund always uses 5% tuition inflation
  const livingInflationEdu = inflation  // Uses the same inflation rate as the rest

  // Build per-child fund map from Wealth Protection > Education Fund data
  const perChildFund: Record<string, number> = {}
  if (provideEduFund) {
    // Include all children — use saved data if available, otherwise use defaults
    const allChildIds = children.map((c: any) => c.id)
    const savedChildIds = wpEduChildren.map((ec: any) => ec.childId)
    const missingChildren = children.filter((c: any) => !savedChildIds.includes(c.id))

    // Add default entries for missing children
    const allEduChildren = [
      ...wpEduChildren,
      ...missingChildren.map((c: any) => ({
        childId: c.id,
        uniEntryAge: (c.gender || '') === 'Female' ? 19 : 21,
        annualTuition: 10750,
        annualLiving: 12500,
        courseDuration: 4,
      }))
    ]

    allEduChildren.forEach((ec: any) => {
      const child = children.find((c: any) => c.id === ec.childId)
      if (!child) return
      const childAge = Number(child.age || 0)
      const defaultUniAge = (child.gender || '') === 'Female' ? 19 : 21
      const uniEntryAge = ec.uniEntryAge ?? defaultUniAge
      const yearsToUni = Math.max(0, uniEntryAge - childAge)
      const annualTuition = ec.annualTuition ?? 10750
      const annualLiving = ec.annualLiving ?? 12500
      const courseDuration = ec.courseDuration ?? 4
      const fvTuition = annualTuition * Math.pow(1 + tuitionInflation, yearsToUni) * courseDuration
      const fvLiving  = annualLiving  * Math.pow(1 + livingInflationEdu, yearsToUni) * courseDuration
      perChildFund[ec.childId] = fvTuition + fvLiving
    })
  }

  const edu = Object.values(perChildFund).reduce((s, v) => s + v, 0)

  // ── D/TPD need at age ───────────────────────────────────────────────────────
  function getDTPDNeedAtAge(age: number, person: 'client' | 'spouse', props: any[]): number {
    const currentAge = person === 'client' ? clientAge : spouseAge
    const annExp = person === 'client' ? p1AnnExp : p2AnnExp
    const floor = person === 'client' ? clientFloor : spouseFloor
    const yLeft = Math.max(0, (currentAge + coverTerm) - age)

    const ageFD = fvAnnuity(annExp, inflation, yLeft)

    const ageMort = mortBalanceAtAge(age, currentAge, props)

    let eduRemaining = 0
    if (children.length > 0) {
      eduRemaining = children.reduce((s: number, c: any) => {
        const uniEntry = childUniEntryAges.find(u => u.name === (c.name || 'Child'))
        if (!uniEntry) return s
        if (age < uniEntry.parentAgeAtUni) return s + (perChildFund[c.id] || 0)
        return s
      }, 0)
    } else {
      eduRemaining = yLeft > 0 ? edu : 0
    }

    const assetOffset = person === 'client' ? p1CPF + p1Prop : p2CPF + p2Prop
    const raw = ageFD + ageMort + eduRemaining - assetOffset
    return Math.max(floor, raw)
  }
  // ── CI need at age ──────────────────────────────────────────────────────────
  function getCINeedAtAge(age: number, person: 'client' | 'spouse', props: any[]): number {
  const currentAge = person === 'client' ? clientAge : spouseAge
  const annExp = person === 'client' ? p1AnnExp : p2AnnExp
  const monthlyInc = person === 'client' ? p1MonthlyInc : p2MonthlyInc
  const liqAssets = person === 'client' ? p1Liq : p2Liq
  const floor = person === 'client' ? clientFloor : spouseFloor

  const ciWindow = Number(ff.protection?.ciYears) || 5
  const yLeft = Math.max(0, (currentAge + coverTerm) - age)
  // Family dependency — CI uses a rolling ciWindow-year annuity of expenses (same as Strategic Objectives)
  const fdYears = Math.min(ciWindow, yLeft)
  const ageFD = fvAnnuity(annExp, inflation, fdYears)

    const incomeComponent = ageFD

    // Mortgage component (gradual slope)
    const mortComponent = mortBalanceAtAge(age, currentAge, props)

   // Education component — sharp drop per child at their uni entry age
  let eduComponent = 0
  if (children.length > 0) {
    eduComponent = children.reduce((s: number, c: any) => {
      const uniEntry = childUniEntryAges.find(u => u.name === (c.name || 'Child'))
      if (!uniEntry) return s
      if (age < uniEntry.parentAgeAtUni) {
        return s + (perChildFund[c.id] || 0)
      }
      return s
    }, 0)
  } else {
    eduComponent = yLeft > 0 ? edu : 0
  }

    const raw = incomeComponent + mortComponent + eduComponent
    return Math.max(floor, raw)
  }

// ── Build chart data (age arrays) ───────────────────────────────────────────
  const chartData = useMemo(() => {
  const currentAge = activePerson === 'client' ? clientAge : spouseAge
  const personKey = activePerson
  // Anchor to the same protectionSnapshot totals the frosted scenario card
  // above displays (profile.dtpd/ci.maxCapitalRequired). clientDTPD/clientCI
  // (page-level props, sourced from ff.p1_dtpd_gross with a separate local
  // fallback formula) is a DIFFERENT number from the snapshot's — using it
  // here is why the chart's starting Needs figure didn't match the card's
  // Total Need. Falls back to the old props only while the snapshot hasn't
  // loaded yet.
  const profile = protectionSnapshot
    ? (activePerson === 'spouse' ? protectionSnapshot.spouse : protectionSnapshot.client)
    : null
  const savedDTPD = profile
    ? profile.dtpd.maxCapitalRequired
    : (activePerson === 'client' ? clientDTPD : spouseDTPD)
  const savedCI = profile
    ? profile.ci.maxCapitalRequired
    : (activePerson === 'client' ? clientCI : spouseCI)

  // Compute raw need at current age as scaling baseline
  const rawDTPDAtCurrent = getDTPDNeedAtAge(currentAge, personKey, properties)
  const rawCIAtCurrent = getCINeedAtAge(currentAge, personKey, properties)

  const result = []
  for (let age = currentAge; age <= 100; age++) {
    const dtpdHave = getDTPDHaveAtAge(age, personKey, currentAge, activePolicies)
    const ciHave = getCIHaveAtAge(age, personKey, currentAge, activePolicies)

    // Scale chart curve so it anchors to saved Strategic Objectives value at current age
    const rawDTPD = getDTPDNeedAtAge(age, personKey, properties)
    const rawCI = getCINeedAtAge(age, personKey, properties)

    const dtpdScale = rawDTPDAtCurrent > 0 ? savedDTPD / rawDTPDAtCurrent : 1
    const ciScale = rawCIAtCurrent > 0 ? savedCI / rawCIAtCurrent : 1

    const personFloor = activePerson === 'client' ? clientFloor : spouseFloor
    result.push({
      age,
      dtpdNeed: Math.max(personFloor, rawDTPD * dtpdScale),
      dtpdHave,
      ciNeed: rawCI <= personFloor ? personFloor : Math.max(personFloor, rawCI * ciScale),
      ciHave,
    })
  }
  
  return result
}, [activePerson, clientAge, spouseAge, activePolicies, clientFloor, spouseFloor,
    p1AnnExp, p2AnnExp, inflation, properties, children, edu, coverTerm, childUniEntryAges,
    clientDTPD, spouseDTPD, clientCI, spouseCI, protectionSnapshot])
  
  // ── Current values ──────────────────────────────────────────────────────────
  const aName = activePerson === 'client' ? clientName : spouseName
  const aAge = activePerson === 'client' ? clientAge : spouseAge
  const aRetireAge = activePerson === 'client' ? p1RetireAge : p2RetireAge
  const aFloor = activePerson === 'client' ? clientFloor : spouseFloor
  const aDTPDNeed = activePerson === 'client' ? clientDTPD : spouseDTPD
  const aCINeed = activePerson === 'client' ? clientCI : spouseCI

  // Current have values (at current age)
  const clientDTPDHave = getDTPDHaveAtAge(clientAge, 'client', clientAge, activePolicies)
  const clientCIHave = getCIHaveAtAge(clientAge, 'client', clientAge, activePolicies)
  const spouseDTPDHave = effectiveIsCouple ? getDTPDHaveAtAge(spouseAge, 'spouse', spouseAge, activePolicies) : 0
  const spouseCIHave = effectiveIsCouple ? getCIHaveAtAge(spouseAge, 'spouse', spouseAge, activePolicies) : 0

  const aDTPDHave = activePerson === 'client' ? clientDTPDHave : spouseDTPDHave
  const aCIHave = activePerson === 'client' ? clientCIHave : spouseCIHave

  const clientDTPDShortfall = Math.max(0, clientDTPD - clientDTPDHave)
  const clientCIShortfall = Math.max(0, clientCI - clientCIHave)
  const spouseDTPDShortfall = effectiveIsCouple ? Math.max(0, spouseDTPD - spouseDTPDHave) : 0
  const spouseCIShortfall = effectiveIsCouple ? Math.max(0, spouseCI - spouseCIHave) : 0

  const clientDTPDPct = clientDTPD > 0 ? Math.round(Math.min(clientDTPDHave, clientDTPD) / clientDTPD * 100) : 0
  const clientCIPct = clientCI > 0 ? Math.round(Math.min(clientCIHave, clientCI) / clientCI * 100) : 0
  const spouseDTPDPct = spouseDTPD > 0 ? Math.round(Math.min(spouseDTPDHave, spouseDTPD) / spouseDTPD * 100) : 0
  const spouseCIPct = spouseCI > 0 ? Math.round(Math.min(spouseCIHave, spouseCI) / spouseCI * 100) : 0

  const aTotalShortfall = (activePerson === 'client' ? clientDTPDShortfall + clientCIShortfall : spouseDTPDShortfall + spouseCIShortfall)
  const combinedShortfall = clientDTPDShortfall + clientCIShortfall + spouseDTPDShortfall + spouseCIShortfall

  // Monthly income & expenses for runway calculation
  const clientMonthlyExp = p1AnnExp / 12
  const spouseMonthlyExp = p2AnnExp / 12
  const clientRunwayMonths = clientCIHave > 0 && clientMonthlyExp > 0
    ? Math.round(clientCIHave / clientMonthlyExp) : 0
  const spouseRunwayMonths = spouseCIHave > 0 && spouseMonthlyExp > 0
    ? Math.round(spouseCIHave / spouseMonthlyExp) : 0

  // Below floor check
  const clientCIBelowFloor = clientCIHave < clientFloor
  const spouseCIBelowFloor = spouseCIHave < spouseFloor

  // ── Milestone ages (for chart annotations) ──────────────────────────────────
  const milestoneAges = useMemo(() => {
  const currentAge = activePerson === 'client' ? clientAge : spouseAge
  
  // University milestones with child names
  const uniAges = childUniEntryAges
    .map((item, i) => ({
      age: item.parentAgeAtUni,
      label: item.name,
    }))
    .filter(a => a.age > currentAge && a.age < 100)
    .sort((a, b) => a.age - b.age)

  const mortEndAge = (() => {
    const allMortgages = properties.flatMap((p: any) => p.mortgages || [])
    if (allMortgages.length === 0) return null
    const maxTenure = Math.max(...allMortgages.map((m: any) => Number(m.tenure || m.remainingTenure || 0)))
    return maxTenure > 0 ? Math.round(currentAge + maxTenure) : null
  })()

  const retireAge = activePerson === 'client' ? p1RetireAge : p2RetireAge
  
  return { uniAges, mortEndAge, retireAge }
}, [activePerson, clientAge, spouseAge, childUniEntryAges, children, properties, p1RetireAge, p2RetireAge])

  // ── Priority actions (dynamically ranked) ───────────────────────────────────
  const priorityActions = useMemo(() => {
    if (activePerson === 'client') {
      const actions = [
        {
          gap: clientDTPDShortfall,
          n: 1,
          bg: '#FEE2E2',
          c: '#C0392B',
          title: `Close ${clientName}'s D/TPD gap`,
          body: `${fmt(aDTPDNeed)} needed for your family. ${fmt(clientDTPDHave)} secured today.`,
          badge: `${fmt(clientDTPDShortfall)} shortfall`,
          badgeBg: '#FEE2E2',
          badgeC: '#9B1C1C',
        },
        {
          gap: clientCIShortfall,
          n: 2,
          bg: '#FEF3C7',
          c: '#854F0B',
          title: `Bring ${clientName}'s CI above the survival floor`,
          body: `${fmt(clientCIHave)} CI coverage${clientCIBelowFloor ? ' — below the $300K minimum floor' : ''}. A diagnosis at any age without adequate CI is a financial crisis.`,
          badge: `${fmt(clientCIShortfall)} shortfall${clientCIBelowFloor ? ' · below floor' : ''}`,
          badgeBg: '#FEF3C7',
          badgeC: '#854F0B',
        },
        ...(effectiveIsCouple ? [{
          gap: spouseDTPDShortfall + spouseCIShortfall,
          n: 3,
          bg: '#F5F3EE',
          c: '#888',
          title: `Address ${spouseName}'s protection`,
          body: `${spouseName}'s ${fmt(spouseDTPDShortfall)} D/TPD and ${fmt(spouseCIShortfall)} CI gaps are often the most overlooked in a couple plan.`,
          badge: `${fmt(spouseDTPDShortfall + spouseCIShortfall)} combined`,
          badgeBg: '#F5F3EE',
          badgeC: '#5F5E5A',
        }] : []),
      ]
      return actions.sort((a, b) => b.gap - a.gap).map((a, i) => ({ ...a, n: i + 1 }))
    } else {
      const actions = [
        {
          gap: spouseDTPDShortfall,
          n: 1,
          bg: '#FEE2E2',
          c: '#C0392B',
          title: `Close ${spouseName}'s D/TPD gap`,
          body: `${fmt(spouseDTPD)} needed. Only ${fmt(spouseDTPDHave)} secured today. Often the most overlooked gap.`,
          badge: `${fmt(spouseDTPDShortfall)} shortfall`,
          badgeBg: '#FEE2E2',
          badgeC: '#9B1C1C',
        },
        {
          gap: spouseCIShortfall,
          n: 2,
          bg: '#FEF3C7',
          c: '#854F0B',
          title: `Bring ${spouseName}'s CI above the survival floor`,
          body: `${fmt(spouseCIHave)} CI coverage${spouseCIBelowFloor ? ' — below the $300K minimum floor' : ''}. Only ${spouseRunwayMonths} months of family runway.`,
          badge: `${fmt(spouseCIShortfall)} shortfall${spouseCIBelowFloor ? ' · below floor' : ''}`,
          badgeBg: '#FEF3C7',
          badgeC: '#854F0B',
        },
        {
          gap: clientCIShortfall,
          n: 3,
          bg: '#F5F3EE',
          c: '#888',
          title: `Also review ${clientName}'s CI coverage`,
          body: `${clientName}'s CI of ${fmt(clientCIHave)}${clientCIBelowFloor ? ' also sits below the floor' : ''}. Addressing both together is more efficient.`,
          badge: `${fmt(clientCIShortfall)} · ${clientCIBelowFloor ? 'below floor' : 'review recommended'}`,
          badgeBg: '#F5F3EE',
          badgeC: '#5F5E5A',
        },
      ]
      return actions.sort((a, b) => b.gap - a.gap).map((a, i) => ({ ...a, n: i + 1 }))
    }
  }, [activePerson, clientName, spouseName, clientDTPDShortfall, clientCIShortfall,
      spouseDTPDShortfall, spouseCIShortfall, clientDTPDHave, clientCIHave,
      spouseDTPDHave, spouseCIHave, clientCIBelowFloor, spouseCIBelowFloor,
      clientFloor, spouseFloor, clientRunwayMonths, spouseRunwayMonths, effectiveIsCouple])

  // ── Chart rendering ──────────────────────────────────────────────────────────
function CoverageChart({
  data,
  type,
  floor,
  assetMitigation,
  accentColor,
  currentAge,
  milestones,
  personName,
}: {
  data: typeof chartData
  type: 'dtpd' | 'ci'
  floor: number
  assetMitigation: number
  accentColor: string
  currentAge: number
  milestones: { uniAges: { age: number; label: string }[]; mortEndAge: number | null; retireAge: number }
  personName: string
}) {
  const [hovered, setHovered] = useState<{
    age: number
    needAfter: number
    insurance: number
    shortfall: number
    x: number
    yDot: number
    milestone: { label: string; icon: string; color: string } | null
  } | null>(null)

  if (!data.length) return null

  // Chart dimensions
  const W = 900
  const H = 280
  const PL = 70
  const PR = 40
  const PT = 80
  const PB = 50
  const iW = W - PL - PR
  const iH = H - PT - PB

  const needKey = type === 'dtpd' ? 'dtpdNeed' : 'ciNeed'
  const insuranceKey = type === 'dtpd' ? 'dtpdHave' : 'ciHave'

  // Plotted quantity = the gross need net of Asset Mitigation, floored. The
  // gross need (needKey) already declines with age and is anchored to the
  // Strategic-Objectives maxCapitalRequired. Asset Mitigation is a flat
  // today-snapshot figure (same one the frosted dial shows); subtracting it
  // and re-flooring means the curve falls with age but pins at the survival
  // floor once (gross need − assets) would drop below it — never to zero.
  const needAfterAt = (d: any) => Math.max(floor, ((d as any)[needKey] || 0) - assetMitigation)
  const insAt = (d: any) => (d as any)[insuranceKey] || 0

  // Find max value for Y-axis scaling — scale to the plotted (floored,
  // net-of-assets) need and existing insurance, not the gross need, so the
  // curve uses the full chart height.
  const maxV = Math.max(
    ...data.map(d => Math.max(needAfterAt(d), insAt(d))),
    floor,
    100000
  )

  const minA = data[0].age
  const aRange = data[data.length - 1].age - minA || 1

  const xP = (age: number) => PL + ((age - minA) / aRange) * iW
  const yP = (v: number) => PT + iH - Math.min(1, v / maxV) * iH

  // Format Y-axis labels
  const fmtY = (n: number) => {
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
    if (n >= 1e3) return `$${Math.round(n / 1000)}K`
    return `$${Math.round(n)}`
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const floorY = yP(floor)

  function linePath(points: { x: number; y: number }[]) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  }
  function areaPath(topPts: { x: number; y: number }[], botPts: { x: number; y: number }[]) {
    const top = linePath(topPts)
    const bot = [...botPts].reverse().map(p => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
    return `${top} ${bot} Z`
  }

  // Need-after-assets line — the floored, net-of-assets need at every age.
  const needPoints = data.map(d => ({ x: xP(d.age), y: yP(needAfterAt(d)) }))
  const needLinePath = linePath(needPoints)

  // Shortfall band — the red fill between the need-after-assets line (top) and
  // existing insurance (bottom), only where the need exceeds insurance. Using
  // min(insurance, needAfter) as the bottom collapses the band to zero height
  // in years insurance fully covers the (floored) need, so no red shows there.
  const shortBottomPoints = data.map(d => ({ x: xP(d.age), y: yP(Math.min(insAt(d), needAfterAt(d))) }))
  const shortfallAreaPath = areaPath(needPoints, shortBottomPoints)

  // Age labels (every 5 years)
  const ageLabels = data.filter(d => d.age % 5 === 0 || d.age === currentAge || d.age === 100)

  // Milestone markers — icons only; names moved to the hover tooltip. Build the
  // raw list (used for the tooltip banner lookup), then position and nudge the
  // icons apart so they never collide along the top edge.
  const milestoneRaw: { age: number; label: string; color: string; icon: string }[] = []
  milestones.uniAges.forEach((m) => { milestoneRaw.push({ age: m.age, label: m.label, color: '#2D6A4F', icon: 'grad' }) })
  if (milestones.mortEndAge) milestoneRaw.push({ age: milestones.mortEndAge, label: 'Mortgage paid', color: '#A8834A', icon: 'home' })
  if (milestones.retireAge) milestoneRaw.push({ age: milestones.retireAge, label: 'Retirement', color: '#6B7B8D', icon: 'palm' })
  milestoneRaw.sort((a, b) => a.age - b.age)

  const MS_GAP = 26
  const milestoneMarkers = milestoneRaw
    .map(m => ({ ...m, x: xP(m.age) }))
    .filter(m => m.x >= PL && m.x <= PL + iW)
    .sort((a, b) => a.x - b.x)
  for (let i = 1; i < milestoneMarkers.length; i++) {
    if (milestoneMarkers[i].x < milestoneMarkers[i - 1].x + MS_GAP) {
      milestoneMarkers[i].x = Math.min(PL + iW, milestoneMarkers[i - 1].x + MS_GAP)
    }
  }

  // Mouse interaction
  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (W / rect.width)

    if (mx >= PL && mx <= PL + iW) {
      const rel = (mx - PL) / iW
      const targetAge = minA + rel * aRange
      const closest = data.reduce((prev, curr) =>
        Math.abs(curr.age - targetAge) < Math.abs(prev.age - targetAge) ? curr : prev
      )
      const nAfter = needAfterAt(closest)
      const ins = insAt(closest)
      const ms = milestoneRaw.find(m => m.age === closest.age)
      setHovered({
        age: closest.age,
        needAfter: nAfter,
        insurance: ins,
        shortfall: Math.max(0, nAfter - ins),
        x: xP(closest.age),
        yDot: yP(nAfter),
        milestone: ms ? { label: ms.label, icon: ms.icon, color: ms.color } : null,
      })
    } else {
      setHovered(null)
    }
  }

  const needColor = '#2D5A4E'
  const insuranceColor = '#c8a96e'
  const shortfallColor = '#C0392B'

  return (
    <div style={{ position: 'relative', overflow: 'visible' }}>
      {/* Chart header */}
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9A9896' }}>
          {personName} · Age {currentAge} to 100
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 16, height: 2, background: needColor, borderRadius: 2 }} />
            <span style={{ fontSize: 10, color: '#9A9896' }}>Need after assets</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 8, background: insuranceColor, opacity: 0.55, borderRadius: 2 }} />
            <span style={{ fontSize: 10, color: '#9A9896' }}>Insurance</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 8, background: shortfallColor, opacity: 0.45, borderRadius: 2 }} />
            <span style={{ fontSize: 10, color: '#9A9896' }}>Shortfall</span>
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: 'block', overflow: 'visible', background: '#FDFCFA', borderRadius: 8 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Grid lines */}
        {ticks.map((f) => {
          const y = PT + iH - f * iH
          return (
            <g key={f}>
              <line x1={PL} y1={y} x2={PL + iW} y2={y} stroke="#F0EDE8" strokeWidth="0.5" />
              {f > 0 && (
                <text x={PL - 10} y={y + 4} fontSize="10" fill="#9A9896" textAnchor="end" fontFamily="Inter, sans-serif">
                  {fmtY(maxV * f)}
                </text>
              )}
            </g>
          )
        })}

        {/* Floor line */}
        <line x1={PL} y1={floorY} x2={PL + iW} y2={floorY} stroke={accentColor} strokeWidth="1" strokeDasharray="4,4" opacity="0.4" />
        <text x={PL + iW - 10} y={floorY - 6} fontSize="9" fill={accentColor} textAnchor="end" fontFamily="Inter, sans-serif" opacity="0.7">
          Floor {fmtShort(floor)}
        </text>

        {/* Axes */}
        <line x1={PL} y1={PT} x2={PL} y2={PT + iH} stroke="#E8E5E0" strokeWidth="0.5" />
        <line x1={PL} y1={PT + iH} x2={PL + iW} y2={PT + iH} stroke="#E8E5E0" strokeWidth="0.5" />

        {/* Insurance coverage bars — one per age. Assets no longer stack on
            top here; shown only as a today snapshot on the scenario card. */}
        {data.map(d => {
          const insurance = (d as any)[insuranceKey] || 0
          if (insurance <= 0) return null
          const bx = xP(d.age)
          const barW = Math.max(3, (iW / data.length) * 0.8)
          const baseY = PT + iH
          const insTopY = yP(insurance)
          return (
            <rect key={`bar-${d.age}`} x={bx - barW / 2} y={insTopY} width={barW} height={Math.max(0, baseY - insTopY)} fill={insuranceColor} opacity="0.5" rx="1.5" />
          )
        })}

        {/* Shortfall band — red fill between the need-after-assets line and the
            existing insurance, only where the (floored, net-of-assets) need
            exceeds insurance. Collapses to zero height wherever insurance
            covers the need, so no red shows there. */}
        <path d={shortfallAreaPath} fill="rgba(192, 57, 43, 0.14)" stroke="none" />

        {/* Need-after-assets line — the gross need minus Asset Mitigation,
            floored so it never falls below the survival floor (never zero).
            Its height IS the capital to insure at that age; the gap down to
            the insurance bars is the shortfall shaded above. */}
        <path d={needLinePath} stroke="#FDFCFA" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
        <path d={needLinePath} stroke={needColor} strokeWidth="2.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />


        {/* Milestone markers — icon + age only. Names surface in the hover
            tooltip. Guide line drops from the true age; if the icon was nudged
            to avoid a collision, a short connector links it back to the line. */}
        {milestoneMarkers.map((m, i) => {
          const gx = xP(m.age)
          return (
            <g key={`ms-${i}`}>
              <line x1={gx} y1={PT} x2={gx} y2={PT + iH} stroke={m.color} strokeWidth="0.5" strokeDasharray="2,4" opacity="0.22" />
              {Math.abs(m.x - gx) > 0.5 && (
                <line x1={m.x} y1={PT - 12} x2={gx} y2={PT} stroke={m.color} strokeWidth="0.5" opacity="0.2" />
              )}
              <circle cx={m.x} cy={PT - 24} r="12" fill="#FDFCFA" stroke={m.color} strokeWidth="1" opacity="0.95" />
              <g transform={`translate(${m.x},${PT - 24})`}>
                <MilestoneIconAtOrigin icon={m.icon} size={14} color={m.color} />
              </g>
              <text x={m.x} y={PT - 4} fontSize="8" fill={m.color} textAnchor="middle" fontFamily="Inter, sans-serif" opacity="0.85">
                age {m.age}
              </text>
            </g>
          )
        })}

        {/* Age labels */}
        {ageLabels.map(d => (
          <text
            key={d.age}
            x={xP(d.age)}
            y={PT + iH + 20}
            fontSize="9"
            fill="#9A9896"
            textAnchor="middle"
            fontFamily="Inter, sans-serif"
          >
            {d.age}
          </text>
        ))}

        {/* Hover vertical line */}
        {hovered && (
          <line
            x1={hovered.x}
            y1={PT}
            x2={hovered.x}
            y2={PT + iH}
            stroke="#1C1A17"
            strokeWidth="0.5"
            strokeDasharray="2,4"
            opacity="0.2"
          />
        )}

        {/* Hover dot on the need-after-assets line */}
        {hovered && (
          <circle cx={hovered.x} cy={hovered.yDot} r="4" fill="#1C1A17" stroke="#FDFCFA" strokeWidth="2" />
        )}
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(Math.max(((hovered.x - PL) / iW) * 100, 10), 90) + '%',
            top: '20px',
            transform: 'translateX(-50%)',
            background: '#1C1A17',
            color: '#F0EDE8',
            padding: '16px 20px',
            borderRadius: 12,
            fontSize: 11,
            pointerEvents: 'none',
            zIndex: 10,
            whiteSpace: 'nowrap',
            boxShadow: '0 12px 32px rgba(0,0,0,0.2)',
          }}
        >
          {hovered.milestone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 10, borderBottom: '0.5px solid rgba(255,255,255,0.14)' }}>
              <MilestoneIconInline icon={hovered.milestone.icon} color={hovered.milestone.color} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{hovered.milestone.label}</span>
            </div>
          )}
          <div style={{ marginBottom: 12, color: accentColor, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Age {hovered.age}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 32 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {hovered.milestone ? 'Amount needed' : 'Need after assets'}
              </span>
              <span style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, fontWeight: 300 }}>{fmt(hovered.needAfter)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 32 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Insurance</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 400, color: insuranceColor }}>{fmt(hovered.insurance)}</span>
            </div>
            <div style={{ paddingTop: 10, borderTop: '0.5px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', gap: 32 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {hovered.shortfall > 0 ? 'Shortfall' : 'Covered'}
              </span>
              <span style={{
                fontFamily: 'Cormorant Garamond, Georgia, serif',
                fontSize: 18,
                fontWeight: 300,
                color: hovered.shortfall > 0 ? '#FF8A80' : '#A0D0B8',
              }}>
                {hovered.shortfall > 0 ? fmt(hovered.shortfall) : '—'}
              </span>
            </div>
          </div>
          <div style={{
            position: 'absolute',
            bottom: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid #1C1A17',
          }} />
        </div>
      )}
    </div>
  )
}


  // ── Scenario dial cell (matches reference screenshot) ────────────────────────
  // Two-column layout: dial + shortfall + legend on the left, need-composition
  // rows (each with its own proportional bar and duration caption) on the
  // right. Colors match this page's existing inline palette (gold #c8a96e,
  // sage #7FC47F, shortfall red #FF8A80) rather than the Financial Report's
  // CSS variables, since this file doesn't use those custom properties.
  interface DialBreakdown {
    existingCoverage: number
    assetMitigation: number
    shortfall: number
    maxCapitalRequired: number
    status: 'covered' | 'shortfall'
  }

  function RadialDial({ breakdown, size = 128 }: { breakdown: DialBreakdown; size?: number }) {
    const strokeW = 10
    const r = size / 2 - strokeW
    const c = size / 2
    const circumference = 2 * Math.PI * r
    const total = breakdown.maxCapitalRequired > 0 ? breakdown.maxCapitalRequired : 1

    const goldLen = circumference * Math.min(1, breakdown.existingCoverage / total)
    const sageLen = circumference * Math.max(0, Math.min(1 - breakdown.existingCoverage / total, breakdown.assetMitigation / total))
    const shortfallLen = breakdown.status === 'shortfall' ? Math.max(0, circumference - goldLen - sageLen) : 0

    const pct = breakdown.maxCapitalRequired > 0
      ? Math.min(100, Math.round(((breakdown.existingCoverage + breakdown.assetMitigation) / breakdown.maxCapitalRequired) * 100))
      : 100

    return (
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {/* Neutral base track underneath every segment */}
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={strokeW} />
        {shortfallLen > 0 && (
          <circle cx={c} cy={c} r={r} fill="none" stroke="#E8544A" strokeWidth={strokeW} strokeLinecap="round"
            strokeDasharray={`${shortfallLen} ${circumference}`} strokeDashoffset={-(goldLen + sageLen)} transform={`rotate(-90 ${c} ${c})`} />
        )}
        {sageLen > 0 && (
          <circle cx={c} cy={c} r={r} fill="none" stroke="#7FC47F" strokeWidth={strokeW} strokeLinecap="round"
            strokeDasharray={`${sageLen} ${circumference}`} strokeDashoffset={-goldLen} transform={`rotate(-90 ${c} ${c})`} />
        )}
        {goldLen > 0 && (
          <circle cx={c} cy={c} r={r} fill="none" stroke="#c8a96e" strokeWidth={strokeW} strokeLinecap="round"
            strokeDasharray={`${goldLen} ${circumference}`} transform={`rotate(-90 ${c} ${c})`} />
        )}
        <text x={c} y={c - 3} textAnchor="middle" fontFamily="Georgia, serif" fontWeight={400} fontSize={size * 0.19} fill="#F0EDE8">
          {pct}%
        </text>
        <text x={c} y={c + 16} textAnchor="middle" fontSize={size * 0.075} letterSpacing="0.1em" fill="rgba(255,255,255,0.4)">
          PROTECTED
        </text>
      </svg>
    )
  }

  function LegendRow({ swatch, label, value }: { swatch: string; label: string; value: number }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: swatch, flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', flex: 1 }}>{label}</span>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#F0EDE8' }}>{fmt(value)}</span>
      </div>
    )
  }

  // Distinct per-category colors so "Family living", "Mortgage", "Education"
  // etc. read as different lines at a glance, consistent across both the
  // D/TPD and CI cards (same category = same color in both). Falls back to
  // brand gold for any unrecognized label.
  const CATEGORY_COLORS: Record<string, { swatch: string; gradient: string }> = {
    'Family living':   { swatch: '#c8a96e', gradient: 'linear-gradient(180deg, #ddbb80 0%, #c8a96e 55%, #a3813f 100%)' },
    'Mortgage':        { swatch: '#5B92BE', gradient: 'linear-gradient(180deg, #8fb8dc 0%, #5B92BE 55%, #3f6a8f 100%)' },
    'Education':       { swatch: '#8B78B0', gradient: 'linear-gradient(180deg, #b3a3d1 0%, #8B78B0 55%, #665783 100%)' },
    'Medical buffer':  { swatch: '#C97B5D', gradient: 'linear-gradient(180deg, #e3a487 0%, #C97B5D 55%, #9a5940 100%)' },
    'Recovery buffer': { swatch: '#4F9A82', gradient: 'linear-gradient(180deg, #7fc4ab 0%, #4F9A82 55%, #366b5a 100%)' },
  }
  const DEFAULT_CATEGORY_COLOR = { swatch: '#c8a96e', gradient: 'linear-gradient(180deg, #ddbb80 0%, #c8a96e 55%, #a3813f 100%)' }

  // Category row with its own proportional bar (scaled against the largest
  // row in the group, so the three bars read as a relative comparison) and
  // duration caption underneath, matching the reference screenshot.
  function ScenarioBreakdownRow({ label, value, maxValue, durationYears }: { label: string; value: number; maxValue: number; durationYears?: number | null }) {
    const barPct = maxValue > 0 ? Math.max(2, Math.round((value / maxValue) * 100)) : 0
    const { swatch } = CATEGORY_COLORS[label] || DEFAULT_CATEGORY_COLOR
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: swatch, flexShrink: 0, display: 'inline-block' }} />
            {label}
          </span>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#F0EDE8', whiteSpace: 'nowrap', marginLeft: 10 }}>{fmt(value)}</span>
        </div>
        <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 99 }}>
          <div style={{ width: `${barPct}%`, height: '100%', background: swatch, borderRadius: 99 }} />
        </div>
        {durationYears != null && durationYears > 0 && (
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)', marginTop: 5 }}>{durationYears} yrs</div>
        )}
      </div>
    )
  }

  // "Years until milestone" for a category row, reusing the same
  // CoverageTimeline milestones the report's chart plots — see the
  // equivalent helper in ProtectionDisplay.tsx for the full rationale.
  // Family living uses the retirement milestone as its duration proxy, since
  // income-replacement need runs until retirement rather than a fixed term.
  function getScenarioDuration(timeline: CoverageTimeline, type: CoverageMilestoneType): number | null {
    const currentAge = timeline.points.length > 0 ? timeline.points[0].age : null
    if (currentAge === null) return null
    const matches = timeline.milestones.filter(m => m.type === type)
    if (matches.length === 0) return null
    return Math.max(0, Math.round(Math.max(...matches.map(m => m.age)) - currentAge))
  }

  function ScenarioDialCell({
    personLabel, initials, initialsColor, initialsBg, age, income,
    breakdown, rows, timeline, type, recoveryWindowYears, belowFloor, floor,
  }: {
    personLabel: string
    initials: string
    initialsColor: string
    initialsBg: string
    age: number
    income: number
    breakdown: DialBreakdown
    rows: { label: string; value: number; milestoneType?: CoverageMilestoneType }[]
    timeline: CoverageTimeline
    type: 'dtpd' | 'ci'
    recoveryWindowYears?: number
    belowFloor?: boolean
    floor?: number
  }) {
    const hasNeed = breakdown.maxCapitalRequired > 0
    const visibleRows = rows.filter(r => r.value > 0)
    const maxRowValue = Math.max(0, ...visibleRows.map(r => r.value))
    const fundedPct = hasNeed
      ? Math.min(100, Math.round(((breakdown.existingCoverage + breakdown.assetMitigation) / breakdown.maxCapitalRequired) * 100))
      : 100

    return (
      <div>
        {/* Person header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 24 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', background: initialsBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 500, color: initialsColor, flexShrink: 0,
          }}>{initials}</div>
          <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: initialsColor, fontWeight: 500 }}>
            {personLabel}, {age}
          </div>
          {income > 0 && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginLeft: 2 }}>
              · {fmt(income)}/mo
            </div>
          )}
        </div>

        {!hasNeed ? (
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 14, color: 'rgba(255,255,255,0.35)' }}>
            No need identified yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 36, alignItems: 'start' }}>
            {/* Left: dial + shortfall + legend */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
                <RadialDial breakdown={breakdown} />
              </div>
              {breakdown.status === 'shortfall' && (
                <div style={{ textAlign: 'center', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 24, color: '#FF8A80', marginBottom: 4 }}>
                  {fmt(breakdown.shortfall)}
                </div>
              )}
              {breakdown.status === 'shortfall' && (
                <div style={{ textAlign: 'center', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,138,128,0.65)', marginBottom: 18 }}>
                  Shortfall
                </div>
              )}

              {type === 'ci' && belowFloor && floor && breakdown.shortfall > 0 && (
                <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: 'rgba(192,57,43,0.14)', border: '1px solid rgba(232,160,160,0.22)' }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,138,128,0.9)', fontWeight: 600, marginBottom: 3 }}>Below {fmt(floor)} survival floor</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>CI protection is needed for life — not just working years</div>
                </div>
              )}

              <div style={{ marginTop: 12, paddingTop: 8, width: '100%', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <LegendRow swatch="#c8a96e" label="Insurance" value={breakdown.existingCoverage} />
                <LegendRow swatch="#7FC47F" label="Assets" value={breakdown.assetMitigation} />
              </div>
            </div>

            {/* Right: need composition */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 20, fontWeight: 500 }}>
                Need composition
              </div>
              <div>
                {visibleRows.map((r, i) => (
                  <ScenarioBreakdownRow
                    key={i}
                    label={r.label}
                    value={r.value}
                    maxValue={maxRowValue}
                    durationYears={r.milestoneType ? getScenarioDuration(timeline, r.milestoneType) : null}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 14, marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.09)', fontSize: 14, fontWeight: 600, color: '#F0EDE8' }}>
                <span>Total need</span>
                <span style={{ fontFamily: 'DM Mono, monospace' }}>{fmt(breakdown.maxCapitalRequired)}</span>
              </div>
              {type === 'ci' && recoveryWindowYears != null && (
                <>
                  <div style={{
                    marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: 10,
                    background: 'rgba(127,196,127,0.10)', border: '1px solid rgba(127,196,127,0.22)',
                  }}>
                    <span style={{ fontSize: 11, color: 'rgba(160,220,160,0.9)', fontWeight: 500 }}>Recovery window</span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#F0EDE8' }}>{recoveryWindowYears} years</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)', marginTop: 7, lineHeight: 1.55 }}>
                    Funded {fundedPct}% of a {recoveryWindowYears}-year income-replacement window — CI planning covers the recovery period after diagnosis, not a permanent loss like D/TPD.
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  // Resolved once here so both scenario panels below (and the existing chart
  // section, unchanged) read off the same activePerson toggle instead of
  // showing both people side-by-side — a single control point for the page.
  const activeName = activePerson === 'client' ? clientName : spouseName
  const activeAge = activePerson === 'client' ? clientAge : spouseAge
  const activeIncome = activePerson === 'client' ? p1MonthlyInc : p2MonthlyInc
  const activeInitialsColor = activePerson === 'client' ? '#c8a96e' : '#7FC47F'
  const activeInitialsBg = activePerson === 'client' ? 'rgba(200,169,110,0.15)' : 'rgba(127,196,127,0.12)'
  const activeProfile = protectionSnapshot
    ? (activePerson === 'spouse' ? protectionSnapshot.spouse : protectionSnapshot.client)
    : null
  const activeCIBelowFloor = activePerson === 'client' ? clientCIBelowFloor : spouseCIBelowFloor
  const activeFloor = activePerson === 'client' ? clientFloor : spouseFloor

  return (
    <div style={{ padding: '32px 48px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Person toggle — controls both scenario panels below and the chart section.
          Sits on the cream page background, so unselected state uses charcoal-based
          colors for contrast — not the white-based tones used inside the dark cards. */}
      {effectiveIsCouple && (
        <div style={{ display: 'flex', gap: 10 }}>
          {(['client', 'spouse'] as const).map(p => (
            <button
              key={p}
              onClick={() => setActivePerson(p)}
              style={{
                padding: '9px 20px',
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: 'Inter, sans-serif',
                borderRadius: 999,
                border: activePerson === p ? '1px solid rgba(200,169,110,0.5)' : '1px solid rgba(28,26,23,0.16)',
                background: activePerson === p ? 'rgba(200,169,110,0.12)' : '#FFFFFF',
                color: activePerson === p ? '#c8a96e' : 'rgba(28,26,23,0.55)',
                fontWeight: activePerson === p ? 500 : 400,
                boxShadow: activePerson === p ? 'none' : '0 1px 2px rgba(28,26,23,0.04)',
                transition: 'all 0.15s',
              }}
            >
              {p === 'client' ? clientName : spouseName}
            </button>
          ))}
        </div>
      )}

      {/* ① D/TPD SCENARIO PANEL — single frosted card, no nested boxes */}
      <div style={{
        position: 'relative', borderRadius: 22, overflow: 'hidden',
        background: 'linear-gradient(180deg, #221F1A 0%, #17150F 100%)',
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: '0 24px 60px -20px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(circle at 15% 8%, rgba(200,169,110,0.10), transparent 45%), radial-gradient(circle at 90% 95%, rgba(127,196,127,0.09), transparent 50%)',
        }} />
        {/* Narrative */}
        <div style={{ position: 'relative', padding: '34px 36px 20px' }}>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 21, letterSpacing: '0.01em', color: 'rgba(200,169,110,0.9)', marginBottom: 14 }}>
            Death &amp; total permanent disability
          </div>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 27, fontWeight: 300, color: '#F0EDE8', lineHeight: 1.45, marginBottom: 8 }}>
            <>If <span style={{ color: '#c8a96e', fontSize: 31 }}>{activeName}</span> were gone tomorrow —</>
          </div>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 19, fontWeight: 300, color: 'rgba(240,237,232,0.7)', lineHeight: 1.65 }}>
            {children.length > 0
              ? `${effectiveIsCouple ? 'The surviving spouse' : 'Your family'} would be left to raise ${children.map((c: any) => c.name || 'your child').join(' and ')} alone. The mortgage, school fees, and daily life continue — but the income that makes it possible would not.`
              : `${effectiveIsCouple ? 'The surviving spouse' : 'Your family'} would face an immediate income gap. The mortgage and daily expenses continue — but without your income to fund them.`
            }
          </div>
        </div>

        <div style={{ position: 'relative', margin: '0 36px', borderTop: '1px solid rgba(255,255,255,0.08)' }} />

        {/* Coverage cells */}
        {!protectionSnapshot ? (
          <div style={{ position: 'relative', padding: '24px 36px 34px', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Loading coverage breakdown…</div>
        ) : !activeProfile ? (
          <div style={{ position: 'relative', padding: '24px 36px 34px', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>No data for {activeName} yet.</div>
        ) : (
          <div style={{ position: 'relative', padding: '24px 36px 34px' }}>
            <ScenarioDialCell
              personLabel={activeName}
              initials={activeName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              initialsColor={activeInitialsColor}
              initialsBg={activeInitialsBg}
              age={activeAge}
              income={activeIncome}
              breakdown={activeProfile.dtpd}
              rows={[
                { label: 'Family living', value: activeProfile.dtpd.familyDependency, milestoneType: 'retirement' },
                { label: 'Mortgage', value: activeProfile.dtpd.mortgageDebtClearance, milestoneType: 'mortgage' },
                { label: 'Education', value: activeProfile.dtpd.tertiaryFunding, milestoneType: 'education' },
              ]}
              timeline={activeProfile.dtpdTimeline}
              type="dtpd"
            />
          </div>
        )}
      </div>

      {/* D/TPD CHART — sits directly under the D/TPD scenario card above */}
      <div style={{ background: 'white', borderRadius: 20, padding: '26px 30px' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#A8834A', marginBottom: 4 }}>
            Coverage needs analysis
          </div>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 20, fontWeight: 400, color: '#1C1A17' }}>
            Death / TPD coverage need — {aName}
          </div>
          <div style={{ fontSize: 11, color: '#bbb', marginTop: 3 }}>
            Required capital vs portfolio · sharp drops at uni · mortgage slope · permanent floor
          </div>
        </div>
        <CoverageChart
  data={chartData}
  type="dtpd"
  floor={aFloor}
  assetMitigation={activeProfile?.dtpd.assetMitigation || 0}
  accentColor="#C4A464"
  currentAge={aAge}
  milestones={milestoneAges}
  personName={aName} 
/>
        <div style={{ fontSize: 10, color: '#bbb', marginTop: 4, fontStyle: 'italic' }}>
          Floor = higher of inflated basic living expenses or $300,000 — permanent regardless of age.
        </div>
      </div>

      {/* ② CI SCENARIO PANEL — single frosted card, no nested boxes */}
      <div style={{
        position: 'relative', borderRadius: 22, overflow: 'hidden',
        background: 'linear-gradient(180deg, #221F1A 0%, #17150F 100%)',
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: '0 24px 60px -20px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(circle at 15% 8%, rgba(200,169,110,0.10), transparent 45%), radial-gradient(circle at 90% 95%, rgba(127,196,127,0.09), transparent 50%)',
        }} />
        <div style={{ position: 'relative', padding: '34px 36px 20px' }}>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 21, letterSpacing: '0.01em', color: 'rgba(127,196,127,0.9)', marginBottom: 14 }}>
            Critical illness
          </div>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 27, fontWeight: 300, color: '#F0EDE8', lineHeight: 1.45, marginBottom: 8 }}>
            <>If <span style={{ color: '#7FC47F', fontSize: 31 }}>{activeName}</span> received a critical illness diagnosis —</>
          </div>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 19, fontWeight: 300, color: 'rgba(240,237,232,0.7)', lineHeight: 1.65 }}>
            Life would not end — but income would pause. Recovery takes years, not months. And CI coverage is not just for working years. Even at retirement, a diagnosis without a payout is still a crisis.
          </div>
        </div>

        <div style={{ position: 'relative', margin: '0 36px', borderTop: '1px solid rgba(255,255,255,0.08)' }} />

        {!protectionSnapshot ? (
          <div style={{ position: 'relative', padding: '24px 36px 34px', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Loading coverage breakdown…</div>
        ) : !activeProfile ? (
          <div style={{ position: 'relative', padding: '24px 36px 34px', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>No data for {activeName} yet.</div>
        ) : (
          <div style={{ position: 'relative', padding: '24px 36px 34px' }}>
            <ScenarioDialCell
              personLabel={activeName}
              initials={activeName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              initialsColor={activeInitialsColor}
              initialsBg={activeInitialsBg}
              age={activeAge}
              income={activeIncome}
              breakdown={activeProfile.ci}
              rows={[
                { label: 'Family living', value: activeProfile.ci.familyDependency },
                { label: 'Mortgage', value: activeProfile.ci.mortgageDebtClearance, milestoneType: 'mortgage' },
                { label: 'Education', value: activeProfile.ci.tertiaryFunding, milestoneType: 'education' },
                { label: 'Medical buffer', value: activeProfile.ci.medicalBuffer },
                { label: 'Recovery buffer', value: activeProfile.ci.recoveryBuffer },
              ]}
              timeline={activeProfile.ciTimeline}
              type="ci"
              recoveryWindowYears={activeProfile.ci.ciYears}
              belowFloor={activeCIBelowFloor}
              floor={activeFloor}
            />
          </div>
        )}
      </div>

      {/* CI CHART — sits directly under the CI scenario card above */}
      <div style={{ background: 'white', borderRadius: 20, padding: '26px 30px' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#2D6A4F', marginBottom: 4 }}>
            Coverage needs analysis
          </div>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 20, fontWeight: 400, color: '#1C1A17' }}>
            Critical illness coverage need — {aName}
          </div>
          <div style={{ fontSize: 11, color: '#bbb', marginTop: 3 }}>
            Income window · sharp drops at uni · mortgage slope · survival floor forever
          </div>
        </div>
        <CoverageChart
  data={chartData}
  type="ci"
  floor={aFloor}
  assetMitigation={activeProfile?.ci.assetMitigation || 0}
  accentColor="#2D6A4F"
  currentAge={aAge}
  milestones={milestoneAges}
  personName={aName}
/>
        <div style={{ fontSize: 10, color: '#bbb', marginTop: 4, fontStyle: 'italic' }}>
          Even at age 100 — no mortgage, no dependants — a CI diagnosis without the survival floor is still a crisis.
        </div>
      </div>

      {/* ④ INTENTION GAP */}
      <div style={{ background: 'white', borderRadius: 20, padding: '24px 30px', borderLeft: '4px solid #c8a96e' }}>
        <div style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#A8834A', marginBottom: 10 }}>
          The intention gap
        </div>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 300, color: '#1C1A17', lineHeight: 1.65 }}>
          {aName}'s intention is for {activePerson === 'client' && effectiveIsCouple ? `${spouseName} and the family` : 'the family'} to never have to compromise.
          Today, <span style={{ color: '#C0392B' }}>{fmt(aTotalShortfall)}</span> of that intention — across D/TPD and CI — remains unprotected.
          {aTotalShortfall > 0 && ' This is entirely addressable.'}
        </div>
        {effectiveIsCouple && (
          <div style={{ marginTop: 10, fontSize: 13, color: '#888' }}>
            Combined household shortfall: <strong style={{ color: '#1C1A17', fontFamily: 'DM Mono, monospace' }}>{fmt(combinedShortfall)}</strong>
          </div>
        )}
      </div>

      {/* ⑤ PRIORITY ACTIONS */}
      <div style={{ background: 'white', borderRadius: 20, overflow: 'hidden', border: '0.5px solid #EAE7E2' }}>
        <div style={{ padding: '18px 26px 14px', borderBottom: '0.5px solid #F0EDE8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 19, fontWeight: 300, color: '#1C1A17' }}>
              Priority actions — {aName}
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 3 }}>
              In order of importance · ranked by gap size
            </div>
          </div>
        </div>
        <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {priorityActions.map((a, idx) => (
            <div key={idx} style={{
              padding: '14px',
              borderRadius: 12,
              background: idx === 1 ? '#FAFAF8' : 'white',
              display: 'grid',
              gridTemplateColumns: '46px 1fr',
              gap: 14,
              alignItems: 'start',
            }}>
              <div style={{
                width: 46, height: 46, borderRadius: 12,
                background: a.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 300, color: a.c }}>
                  {a.n}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, color: '#1C1A17' }}>
                  {a.title}
                </div>
                <div style={{ fontSize: 13, color: '#666', lineHeight: 1.65, marginBottom: 8 }}>
                  {a.body}
                </div>
                <div style={{
                  display: 'inline-block',
                  padding: '2px 12px',
                  background: a.badgeBg,
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 500,
                  color: a.badgeC,
                }}>
                  {a.badge}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ⑥ ADVISOR NOTES */}
      <div style={{ background: 'white', borderRadius: 20, border: '0.5px solid #EAE7E2', padding: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#aaa', marginBottom: 12 }}>
          Advisor notes
        </div>
        <textarea
          value={rmData.advisorNotes}
          onChange={e => updateRm({ ...rmData, advisorNotes: e.target.value })}
          placeholder="Record observations, client concerns, agreed priorities, follow-up actions…"
          rows={4}
          style={{
            width: '100%',
            resize: 'vertical',
            border: '1px solid #E8E5E0',
            outline: 'none',
            background: '#FAFAF8',
            color: '#1C1A17',
            fontFamily: 'DM Mono, monospace',
            fontSize: 13,
            padding: '14px 16px',
            borderRadius: 10,
            boxSizing: 'border-box',
            lineHeight: 1.7,
          }}
        />
      </div>

      {/* CLOSING */}
      <div style={{ background: '#1C1A17', borderRadius: 20, padding: '28px 34px' }}>
        <div style={{
          fontFamily: 'Georgia, serif',
          fontSize: 16,
          fontWeight: 300,
          color: 'rgba(240,237,232,0.38)',
          lineHeight: 1.85,
          maxWidth: 540,
        }}>
          The detailed portfolio that follows shows every policy in place today. The decision, at its heart, is simple — not about products, but about what you want to be true for the people who depend on you.
        </div>
      </div>

    </div>
  )
}
