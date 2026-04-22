'use client'
import React, { useState, useMemo, useRef, useEffect } from 'react'

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

// Mortgage balance remaining at a future age
function mortBalanceAtAge(
  atAge: number,
  currentAge: number,
  properties: any[]
): number {
  const allMortgages = (properties || []).flatMap((p: any) => p.mortgages || [])
  return allMortgages.reduce((total: number, m: any) => {
    const outstanding = Number(m.outstanding || 0)
    const rate = Number(m.interestRate || 0) / 100
    const tenure = Number(m.tenure || m.remainingTenure || 25)
    if (outstanding <= 0) return total
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
}: ProtectionOverviewProps) {
  const [activePerson, setActivePerson] = useState<'client' | 'spouse'>('client')
 const ff = ffData || {}
const properties: any[] = ff.properties || []
const savedPlanType = ff.protection?.planType ?? ff.planType ?? null
const effectiveIsCouple = savedPlanType ? savedPlanType === 'couple' : isCouple

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
   // Use total annual expenses (same as rest of chart — p1AnnExp/p2AnnExp)
    const effectiveExp = person === 'client' ? p1AnnExp : p2AnnExp
    // Window = last ciWindow years of life: from (lifeExp - ciWindow) to (lifeExp - 1)
    // Sum of annual expenses inflated to each of those years
    const windowStart = lifeExp - ciWindow  // age at start of window
    let floorFromExpenses = 0
    for (let age = windowStart; age < lifeExp; age++) {
      const yearsFromNow = Math.max(0, age - currentAge)
      floorFromExpenses += effectiveExp * Math.pow(1 + inflation, yearsFromNow)
    }
    return Math.max(300000, floorFromExpenses)
  }

  const clientFloor = useMemo(() => getFloor('client'), [clientAge, inflation, ff, p1AnnExp, ff.client?.lifeExpectancy])
  const spouseFloor = useMemo(() => getFloor('spouse'), [spouseAge, inflation, ff, p2AnnExp, ff.spouse?.lifeExpectancy])

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

  // Income window component (60-month window from today, declines as children independent)
  const yLeft = Math.max(0, (currentAge + coverTerm) - age)
  const incomeWindow = Math.max(0, monthlyInc * 60 - liqAssets)

  // Family dependency — step down annExp as each child enters uni
  const ageFD = fvAnnuity(annExp, inflation, yLeft)

    const incomeComponent = incomeWindow

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
  const savedDTPD = activePerson === 'client' ? clientDTPD : spouseDTPD
  const savedCI = activePerson === 'client' ? clientCI : spouseCI

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
      ciNeed: Math.max(personFloor, rawCI * ciScale),
      ciHave,
    })
  }
  
  return result
}, [activePerson, clientAge, spouseAge, activePolicies, clientFloor, spouseFloor,
    p1AnnExp, p2AnnExp, inflation, properties, children, edu, coverTerm, childUniEntryAges,
    clientDTPD, spouseDTPD, clientCI, spouseCI])
  
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
  accentColor,
  currentAge,
  milestones,
  personName,
}: {
  data: typeof chartData
  type: 'dtpd' | 'ci'
  floor: number
  accentColor: string
  currentAge: number
  milestones: { uniAges: { age: number; label: string }[]; mortEndAge: number | null; retireAge: number }
  personName: string
}) {
  const [hovered, setHovered] = useState<{
    age: number
    need: number
    have: number
    x: number
    yNeed: number
    yHave: number
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
  const haveKey = type === 'dtpd' ? 'dtpdHave' : 'ciHave'

  // Find max value for Y-axis scaling
 const maxV = Math.max(
    ...data.map(d => Math.max((d as any)[needKey], (d as any)[haveKey])),
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

  // Build need line path
  const needPoints = data.map(d => ({
    x: xP(d.age),
    y: yP((d as any)[needKey])
  }))
  const needPath = needPoints.map((p, i) => 
    `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
  ).join(' ')

  // Build have line path
  const havePoints = data.map(d => ({
    x: xP(d.age),
    y: yP((d as any)[haveKey])
  }))
  const havePath = havePoints.map((p, i) => 
    `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
  ).join(' ')

  // Build shortfall fill areas (where need > have)
  const shortfallSegments: string[] = []
  let segStart = -1
  
  for (let i = 0; i < data.length; i++) {
    const need = (data[i] as any)[needKey]
    const have = (data[i] as any)[haveKey]
    const isShortfall = need > have
    
    if (isShortfall && segStart === -1) {
      segStart = i
    } else if (!isShortfall && segStart !== -1) {
      // End of a shortfall segment
      const seg = data.slice(segStart, i)
      const topPts = seg.map(d => `${xP(d.age).toFixed(1)},${yP((d as any)[needKey]).toFixed(1)}`)
      const botPts = [...seg].reverse().map(d => `${xP(d.age).toFixed(1)},${yP((d as any)[haveKey]).toFixed(1)}`)
      shortfallSegments.push(`M ${topPts.join(' L ')} L ${botPts.join(' L ')} Z`)
      segStart = -1
    }
  }
  
  // Handle segment that goes to the end
  if (segStart !== -1) {
    const seg = data.slice(segStart)
    const topPts = seg.map(d => `${xP(d.age).toFixed(1)},${yP((d as any)[needKey]).toFixed(1)}`)
    const botPts = [...seg].reverse().map(d => `${xP(d.age).toFixed(1)},${yP((d as any)[haveKey]).toFixed(1)}`)
    shortfallSegments.push(`M ${topPts.join(' L ')} L ${botPts.join(' L ')} Z`)
  }

  // Age labels (every 5 years)
  const ageLabels = data.filter(d => d.age % 5 === 0 || d.age === currentAge || d.age === 100)

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
      setHovered({
        age: closest.age,
        need: (closest as any)[needKey],
        have: (closest as any)[haveKey],
        x: xP(closest.age),
        yNeed: yP((closest as any)[needKey]),
        yHave: yP((closest as any)[haveKey]),
      })
    } else {
      setHovered(null)
    }
  }

 // Build milestone markers with tier assignment to prevent overlap
const allMilestonesRaw: { age: number; label: string; color: string }[] = []

milestones.uniAges.forEach((m) => {
  allMilestonesRaw.push({ age: m.age, label: m.label, color: '#2D6A4F' })
})
if (milestones.mortEndAge) {
  allMilestonesRaw.push({ age: milestones.mortEndAge, label: 'Mortgage paid', color: '#A8834A' })
}
if (milestones.retireAge) {
  allMilestonesRaw.push({ age: milestones.retireAge, label: 'Retirement', color: '#6B7B8D' })
}

// Sort by age, then assign tiers based on proximity
const MIN_GAP = 7 // ages within 7 years get staggered
allMilestonesRaw.sort((a, b) => a.age - b.age)
const allMilestones: { age: number; label: string; color: string; tier: number }[] = []
allMilestonesRaw.forEach((m, i) => {
  if (i === 0) {
    allMilestones.push({ ...m, tier: 0 })
  } else {
    const prev = allMilestonesRaw[i - 1]
    const prevTier = allMilestones[i - 1].tier
    const gap = m.age - prev.age
    allMilestones.push({ ...m, tier: gap < MIN_GAP ? (prevTier + 1) % 3 : 0 })
  }
})

  return (
    <div style={{ position: 'relative', overflow: 'visible' }}>
      {/* Chart header */}
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9A9896' }}>
          {personName} · Age {currentAge} to 100
        </div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 16, height: 2, background: accentColor }} />
            <span style={{ fontSize: 10, color: '#9A9896' }}>Coverage Needed</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 8, background: accentColor, opacity: 0.25, borderRadius: 2 }} />
            <span style={{ fontSize: 10, color: '#9A9896' }}>Existing Portfolio</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 8, background: '#C0392B', opacity: 0.15, borderRadius: 2 }} />
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

        {/* Shortfall fill (red shading) */}
        {shortfallSegments.map((d, i) => (
          <path key={`sf-${i}`} d={d} fill="rgba(192, 57, 43, 0.12)" stroke="none" />
        ))}

        {/* Have bars (existing portfolio) */}
{data.map(d => {
  const have = (d as any)[haveKey]
  
  // Only render if there's actual coverage
  if (have <= 0) return null
  
  const bx = xP(d.age)
  const haveY = yP(have)
  const barH = Math.max(2, PT + iH - haveY)
  const barW = Math.max(3, (iW / data.length) * 0.8)
  
  return (
    <rect
      key={`bar-${d.age}`}
      x={bx - barW / 2}
      y={haveY}
      width={barW}
      height={barH}
      fill={accentColor}
      opacity="0.35"
      rx="2"
    />
  )
})}

        {/* Need line */}
        <path d={needPath} stroke={accentColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {/* Have line (optional, subtle) */}
        <path d={havePath} stroke={accentColor} strokeWidth="0.8" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />

        {/* Milestone markers - tiered to prevent label overlap */}
{allMilestones.map((m, i) => {
  const mx = xP(m.age)
  if (mx < PL || mx > PL + iW) return null
  // tier 0 = closest to chart, tier 1 = 22px higher, tier 2 = 44px higher
  const tierOffset = m.tier * 22
  const labelY = PT - 24 + tierOffset
  const ageY   = PT - 13 + tierOffset
  const dotY   = PT - 6  + tierOffset
  return (
    <g key={`ms-${i}`}>
      {/* Vertical line from top of chart down */}
      <line x1={mx} y1={PT} x2={mx} y2={PT + iH} stroke={m.color} strokeWidth="0.5" strokeDasharray="2,4" opacity="0.25" />
      {/* Connector from dot up to chart top */}
      <line x1={mx} y1={dotY + 3} x2={mx} y2={PT} stroke={m.color} strokeWidth="0.5" opacity="0.2" />
      <circle cx={mx} cy={dotY} r="2.5" fill={m.color} opacity="0.6" />
      <text x={mx} y={labelY} fontSize="8.5" fill={m.color} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="500">
        {m.label}
      </text>
      <text x={mx} y={ageY} fontSize="7.5" fill="#9A9896" textAnchor="middle" fontFamily="Inter, sans-serif">
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

        {/* Hover dot on need line */}
        {hovered && (
          <circle cx={hovered.x} cy={hovered.yNeed} r="4" fill={accentColor} stroke="#FDFCFA" strokeWidth="2" />
        )}

        {/* Hover dot on have line */}
        {hovered && hovered.have > 0 && (
          <circle cx={hovered.x} cy={hovered.yHave} r="3" fill={accentColor} stroke="#FDFCFA" strokeWidth="1.5" opacity="0.6" />
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
          <div style={{ marginBottom: 12, color: accentColor, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Age {hovered.age}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 32 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Coverage Needed</span>
              <span style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 300 }}>{fmt(hovered.need)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 32 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Existing Portfolio</span>
              <span style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 300, color: accentColor }}>{fmt(hovered.have)}</span>
            </div>
            <div style={{ paddingTop: 10, borderTop: '0.5px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', gap: 32 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {hovered.need > hovered.have ? 'Shortfall' : 'Surplus'}
              </span>
              <span style={{
                fontFamily: 'Georgia, serif',
                fontSize: 18,
                fontWeight: 300,
                color: hovered.need > hovered.have ? '#FF8A80' : '#A0D0B8',
              }}>
                {hovered.need > hovered.have ? fmt(hovered.need - hovered.have) : fmt(hovered.have - hovered.need)}
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

  // ── Coverage cell ────────────────────────────────────────────────────────────
  function CoverageCell({
    personLabel,
    initials,
    initialsColor,
    initialsBg,
    age,
    income,
    have,
    need,
    shortfall,
    pct,
    accentColor,
    type,
    runwayMonths,
    belowFloor,
    floor,
  }: {
    personLabel: string
    initials: string
    initialsColor: string
    initialsBg: string
    age: number
    income: number
    have: number
    need: number
    shortfall: number
    pct: number
    accentColor: string
    type: 'dtpd' | 'ci'
    runwayMonths?: number
    belowFloor?: boolean
    floor?: number
  }) {
    return (
      <div style={{
        background: '#1C1A17',
        borderRadius: 14,
        padding: '20px 22px',
        border: type === 'ci' ? '1px solid rgba(45,106,79,0.25)' : 'none',
      }}>
        {/* Person header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: initialsBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 500, color: initialsColor, flexShrink: 0,
          }}>{initials}</div>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: initialsColor }}>
            {personLabel}, {age}
          </div>
          {income > 0 && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginLeft: 4 }}>
              · {fmt(income)}/mo
            </div>
          )}
        </div>

        {/* Have */}
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 300, color: accentColor, lineHeight: 1 }}>
          {fmt(have)}
        </div>

        {/* Need */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 5 }}>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>of</span>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 300, color: '#F0EDE8' }}>{fmt(need)}</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>needed</span>
        </div>

        {/* Shortfall box */}
        <div style={{
          marginTop: 14,
          padding: '10px 14px',
          borderRadius: 10,
          background: shortfall > 0 ? 'rgba(192,57,43,0.2)' : 'rgba(45,106,79,0.2)',
          border: `1px solid ${shortfall > 0 ? 'rgba(232,160,160,0.3)' : 'rgba(144,198,144,0.3)'}`,
        }}>
          <div style={{
            fontFamily: 'Georgia, serif', fontSize: 32, fontWeight: 300,
            color: shortfall > 0 ? '#FF8A80' : '#90C890',
            lineHeight: 1,
          }}>
            {shortfall > 0 ? fmt(shortfall) : '✓ Covered'}
          </div>
          <div style={{
            fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const,
            color: shortfall > 0 ? 'rgba(255,138,128,0.7)' : 'rgba(144,200,144,0.7)',
            marginTop: 4,
          }}>
            {shortfall > 0 ? `shortfall · ${pct}% covered` : `fully covered`}
            {type === 'ci' && runwayMonths !== undefined && runwayMonths > 0 && ` · ${runwayMonths} months runway`}
          </div>
        </div>

        {/* Below floor warning */}
        {type === 'ci' && belowFloor && floor && shortfall > 0 && (
          <div style={{
            marginTop: 8,
            padding: '7px 12px',
            borderRadius: 8,
            background: 'rgba(192,57,43,0.12)',
            border: '1px solid rgba(232,160,160,0.2)',
          }}>
            <div style={{ fontSize: 10, color: 'rgba(255,138,128,0.85)', fontWeight: 500 }}>
              Below {fmt(floor)} survival floor
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>
              CI protection is needed for life — not just working years
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 99, marginTop: 12 }}>
          <div style={{
            width: `${Math.min(pct, 100)}%`, height: '100%',
            background: pct >= 100 ? '#2D6A4F' : accentColor,
            borderRadius: 99,
          }} />
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>
          {pct}% covered
        </div>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '32px 48px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ① D/TPD SCENARIO PANEL */}
      <div style={{ background: '#1C1A17', borderRadius: 20, overflow: 'hidden' }}>
        {/* Narrative */}
        <div style={{ padding: '28px 32px 20px' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(200,169,110,0.5)', marginBottom: 12 }}>
            Death &amp; total permanent disability
          </div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 300, color: '#F0EDE8', lineHeight: 1.45, marginBottom: 8 }}>
            {effectiveIsCouple ? (
              <>If <span style={{ color: '#c8a96e', fontSize: 30 }}>{clientName}</span> or <span style={{ color: '#c8a96e', fontSize: 30 }}>{spouseName}</span> were gone tomorrow —</>
            ) : (
              <>If <span style={{ color: '#c8a96e', fontSize: 30 }}>{clientName}</span> were gone tomorrow —</>
            )}
          </div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 300, color: 'rgba(240,237,232,0.45)', lineHeight: 1.7, maxWidth: 600 }}>
            {children.length > 0
              ? `${effectiveIsCouple ? 'The surviving spouse' : 'Your family'} would be left to raise ${children.map((c: any) => c.name || 'your child').join(' and ')} alone. The mortgage, school fees, and daily life continue — but the income that makes it possible would not.`
              : `${effectiveIsCouple ? 'The surviving spouse' : 'Your family'} would face an immediate income gap. The mortgage and daily expenses continue — but without your income to fund them.`
            }
          </div>
        </div>

        {/* Coverage cells */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: effectiveIsCouple ? '1fr 1fr' : '1fr',
          gap: 12,
          padding: '0 28px 28px',
        }}>
          <CoverageCell
            personLabel={clientName}
            initials={clientName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            initialsColor="#c8a96e"
            initialsBg="rgba(200,169,110,0.15)"
            age={clientAge}
            income={p1MonthlyInc}
            have={clientDTPDHave}
            need={clientDTPD}
            shortfall={clientDTPDShortfall}
            pct={clientDTPDPct}
            accentColor="#c8a96e"
            type="dtpd"
          />
          {effectiveIsCouple && (
            <CoverageCell
              personLabel={spouseName}
              initials={spouseName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              initialsColor="#7FC47F"
              initialsBg="rgba(127,196,127,0.12)"
              age={spouseAge}
              income={p2MonthlyInc}
              have={spouseDTPDHave}
              need={spouseDTPD}
              shortfall={spouseDTPDShortfall}
              pct={spouseDTPDPct}
              accentColor="#7FC47F"
              type="dtpd"
            />
          )}
        </div>
      </div>

      {/* ② CI SCENARIO PANEL */}
      <div style={{ background: '#1C1A17', borderRadius: 20, overflow: 'hidden' }}>
        <div style={{ padding: '28px 32px 20px' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(45,106,79,0.7)', marginBottom: 12 }}>
            Critical illness
          </div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 300, color: '#F0EDE8', lineHeight: 1.45, marginBottom: 8 }}>
            {effectiveIsCouple ? (
              <>If <span style={{ color: '#7FC47F', fontSize: 30 }}>{clientName}</span> or <span style={{ color: '#7FC47F', fontSize: 30 }}>{spouseName}</span> received a critical illness diagnosis —</>
            ) : (
              <>If <span style={{ color: '#7FC47F', fontSize: 30 }}>{clientName}</span> received a critical illness diagnosis —</>
            )}
          </div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 300, color: 'rgba(240,237,232,0.45)', lineHeight: 1.7, maxWidth: 600 }}>
            Life would not end — but income would pause. Recovery takes years, not months. And CI coverage is not just for working years. Even at retirement, a diagnosis without a payout is still a crisis.
          </div>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: effectiveIsCouple ? '1fr 1fr' : '1fr',
          gap: 12,
          padding: '0 28px 28px',
        }}>
          <CoverageCell
            personLabel={clientName}
            initials={clientName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            initialsColor="#c8a96e"
            initialsBg="rgba(200,169,110,0.15)"
            age={clientAge}
            income={p1MonthlyInc}
            have={clientCIHave}
            need={clientCI}
            shortfall={clientCIShortfall}
            pct={clientCIPct}
            accentColor="#2D6A4F"
            type="ci"
            runwayMonths={clientRunwayMonths}
            belowFloor={clientCIBelowFloor}
            floor={clientFloor}
          />
          {effectiveIsCouple && (
            <CoverageCell
              personLabel={spouseName}
              initials={spouseName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              initialsColor="#7FC47F"
              initialsBg="rgba(127,196,127,0.12)"
              age={spouseAge}
              income={p2MonthlyInc}
              have={spouseCIHave}
              need={spouseCI}
              shortfall={spouseCIShortfall}
              pct={spouseCIPct}
              accentColor="#2D6A4F"
              type="ci"
              runwayMonths={spouseRunwayMonths}
              belowFloor={spouseCIBelowFloor}
              floor={spouseFloor}
            />
          )}
        </div>
      </div>

      {/* ③ FAMILY JOURNEY + CHARTS with person toggle */}
      <div style={{ background: 'white', borderRadius: 20, padding: '26px 30px' }}>
        {/* Header + toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#A8834A', marginBottom: 4 }}>
              Coverage needs analysis
            </div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 300, color: '#1C1A17' }}>
              {aName}'s protection journey — age {aAge} to 100
            </div>
          </div>
          {effectiveIsCouple && (
            <div style={{ display: 'flex', gap: 4, background: '#F5F3EE', padding: 4, borderRadius: 10 }}>
              {(['client', 'spouse'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setActivePerson(p)}
                  style={{
                    padding: '8px 22px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontFamily: 'Inter, sans-serif',
                    borderRadius: 8,
                    background: activePerson === p ? '#1C1A17' : 'transparent',
                    color: activePerson === p ? '#c8a96e' : '#888',
                    fontWeight: activePerson === p ? 500 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  {p === 'client' ? clientName : spouseName}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* D/TPD Chart */}
        <div style={{ borderTop: '0.5px solid #F0EDE8', paddingTop: 20, marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#A8834A', marginBottom: 2 }}>
                Death / TPD coverage need — {aName}
              </div>
              <div style={{ fontSize: 11, color: '#bbb' }}>
                Required capital vs portfolio · sharp drops at uni · mortgage slope · permanent floor
              </div>
            </div>
          </div>
          <CoverageChart
  data={chartData}
  type="dtpd"
  floor={aFloor}
  accentColor="#C4A464"
  currentAge={aAge}
  milestones={milestoneAges}
  personName={aName} 
/>
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 4, fontStyle: 'italic' }}>
            Floor = higher of inflated basic living expenses or $300,000 — permanent regardless of age.
          </div>
        </div>

        {/* CI Chart */}
        <div style={{ borderTop: '0.5px solid #F0EDE8', paddingTop: 20, marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2D6A4F', marginBottom: 2 }}>
                Critical illness coverage need — {aName}
              </div>
              <div style={{ fontSize: 11, color: '#bbb' }}>
                Income window · sharp drops at uni · mortgage slope · survival floor forever
              </div>
            </div>
          </div>
          <CoverageChart
  data={chartData}
  type="ci"
  floor={aFloor}
  accentColor="#2D6A4F"
  currentAge={aAge}
  milestones={milestoneAges}
  personName={aName}
/>
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 4, fontStyle: 'italic' }}>
            Even at age 100 — no mortgage, no dependants — a CI diagnosis without the survival floor is still a crisis.
          </div>
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
