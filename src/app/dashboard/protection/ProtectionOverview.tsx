'use client'
import React, { useState, useMemo, useRef } from 'react'

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
}: ProtectionOverviewProps) {
  const [activePerson, setActivePerson] = useState<'client' | 'spouse'>('client')
  const ff = ffData || {}
  const properties: any[] = ff.properties || []

  // ── Expenses ────────────────────────────────────────────────────────────────
  const p1AnnExp = useMemo(() => {
    const exp =
      (Number(ff.s_financial) || 0) +
      (Number(ff.s_household) || 0) +
      (Number(ff.s_personal) || 0) +
      (Number(ff.s_children) || 0) +
      (Number(ff.s_lifestyle) || 0) +
      (Number(ff.s_mortgage) || 0)
    const income = Number(ff.person1?.gross_monthly || ff.monthly_income || 0) * 12
    return exp > 0 ? exp : income * 0.7
  }, [ff])

  const p2AnnExp = useMemo(() => {
    const exp =
      (Number(ff.s2_financial) || 0) +
      (Number(ff.s2_household) || 0) +
      (Number(ff.s2_personal) || 0) +
      (Number(ff.s2_children) || 0) +
      (Number(ff.s2_lifestyle) || 0) +
      (Number(ff.s2_mortgage) || 0)
    const income = Number(ff.person2?.gross_monthly || ff.monthly_income_spouse || 0) * 12
    return exp > 0 ? exp : income * 0.7
  }, [ff])

  const p1MonthlyInc = Number(ff.person1?.gross_monthly || ff.monthly_income || 0)
  const p2MonthlyInc = Number(ff.person2?.gross_monthly || ff.monthly_income_spouse || 0)
  const p1RetireAge = Number(ff.retirement_age || ff.person1?.retirement_age || 65)
  const p2RetireAge = Number(ff.retirement_age_spouse || ff.person2?.retirement_age || 62)

  // ── Cover term (until youngest child independent) ───────────────────────────
  const coverTerm = useMemo(() => {
    if (children.length === 0) return 25
    const minChildAge = Math.min(...children.map((c: any) => Number(c.age || 0)))
    return Math.max(5, 26 - minChildAge)
  }, [children])

  // ── Uni entry ages per child (for sharp drops) ──────────────────────────────
  const childUniEntryAges = useMemo(() => {
    return children.map((c: any) => {
      const childAge = Number(c.age || 0)
      const gender = c.gender || ''
      const uniAge = gender === 'Female' ? 19 : 21
      return { childAge, uniAge }
    })
  }, [children])

  // ── Floor calculation ───────────────────────────────────────────────────────
  // Floor = higher of ($300K) or (basic living expenses inflated to retirement/last milestone)
  function getFloor(person: 'client' | 'spouse'): number {
    const annExp = person === 'client' ? p1AnnExp : p2AnnExp
    const currentAge = person === 'client' ? clientAge : spouseAge
    const retireAge = person === 'client' ? p1RetireAge : p2RetireAge
    // Last milestone = later of retirement age or youngest child independent
    const lastMilestoneAge = Math.max(retireAge, currentAge + coverTerm)
    const yearsToFloor = Math.max(0, lastMilestoneAge - currentAge)
    // Basic living = household + personal only (no mortgage, no children)
    const basicExp =
      (Number(ff.s_household) || 0) +
      (Number(ff.s_personal) || 0) +
      (Number(ff.s_financial) || 0)
    const basicExpForPerson = person === 'client'
      ? basicExp > 0 ? basicExp : annExp * 0.5
      : (Number(ff.s2_household) || 0) + (Number(ff.s2_personal) || 0) > 0
        ? (Number(ff.s2_household) || 0) + (Number(ff.s2_personal) || 0)
        : annExp * 0.5
    const inflatedExp = basicExpForPerson * Math.pow(1 + inflation, yearsToFloor)
    return Math.max(300000, inflatedExp)
  }

  const clientFloor = useMemo(() => getFloor('client'), [p1AnnExp, clientAge, p1RetireAge, inflation, ff, coverTerm])
  const spouseFloor = useMemo(() => getFloor('spouse'), [p2AnnExp, spouseAge, p2RetireAge, inflation, ff, coverTerm])

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

  const edu = Number(ff.strategic_objectives?.ed_total || 0)

  // ── D/TPD need at age ───────────────────────────────────────────────────────
  function getDTPDNeedAtAge(age: number, person: 'client' | 'spouse'): number {
    const currentAge = person === 'client' ? clientAge : spouseAge
    const annExp = person === 'client' ? p1AnnExp : p2AnnExp
    const offset = person === 'client' ? p1CPF + p1Prop : p2CPF + p2Prop
    const floor = person === 'client' ? clientFloor : spouseFloor

    // Years left of dependency
    const yLeft = Math.max(0, (currentAge + coverTerm) - age)

    // Family dependency — FV annuity
    const ageFD = fvAnnuity(annExp, inflation, yLeft)

    // Mortgage amortising balance
    const ageMort = mortBalanceAtAge(age, currentAge, properties)

    // Education — step down sharply as each child enters uni
    let eduRemaining = edu
    if (children.length > 0) {
      const childrenNotYetAtUni = childUniEntryAges.filter(({ childAge, uniAge }) => {
        const yearsUntilUni = uniAge - childAge
        return (age - currentAge) < yearsUntilUni
      }).length
      const eduFraction = childrenNotYetAtUni / children.length
      eduRemaining = edu * eduFraction
    } else {
      eduRemaining = yLeft > 0 ? edu : 0
    }

    const raw = ageFD + ageMort + eduRemaining - offset
    return Math.max(floor, raw)
  }

  // ── CI need at age ──────────────────────────────────────────────────────────
  function getCINeedAtAge(age: number, person: 'client' | 'spouse'): number {
    const currentAge = person === 'client' ? clientAge : spouseAge
    const annExp = person === 'client' ? p1AnnExp : p2AnnExp
    const monthlyInc = person === 'client' ? p1MonthlyInc : p2MonthlyInc
    const liqAssets = person === 'client' ? p1Liq : p2Liq
    const floor = person === 'client' ? clientFloor : spouseFloor

    // Income window component (60-month window from today, declines as children independent)
    const yLeft = Math.max(0, (currentAge + coverTerm) - age)
    const incomeWindow = Math.max(0, monthlyInc * 60 - liqAssets)

    // Fraction remaining based on children still dependent
    let incomeFraction = 1.0
    if (children.length > 0) {
      const childrenNotYetAtUni = childUniEntryAges.filter(({ childAge, uniAge }) => {
        const yearsUntilUni = uniAge - childAge
        return (age - currentAge) < yearsUntilUni
      }).length
      // Sharp drop when last child enters uni
      if (yLeft <= 0) {
        incomeFraction = 0
      } else {
        incomeFraction = childrenNotYetAtUni / children.length
      }
    } else {
      incomeFraction = yLeft > 0 ? 1.0 : 0
    }

    const incomeComponent = incomeWindow * incomeFraction

    // Mortgage component (gradual slope)
    const mortComponent = mortBalanceAtAge(age, currentAge, properties)

    // Education component (sharp drops at each child's uni entry)
    let eduComponent = 0
    if (children.length > 0) {
      const childrenNotYetAtUni = childUniEntryAges.filter(({ childAge, uniAge }) => {
        const yearsUntilUni = uniAge - childAge
        return (age - currentAge) < yearsUntilUni
      }).length
      eduComponent = edu * (childrenNotYetAtUni / children.length)
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
    const result = []
    for (let age = currentAge; age <= 100; age++) {
      if (age === 75) console.log('HAVE at 75:', getDTPDHaveAtAge(75, personKey, currentAge, activePolicies), 'NEED at 75:', getDTPDNeedAtAge(75, personKey))
      result.push({
        age,
        dtpdNeed: getDTPDNeedAtAge(age, personKey),
        dtpdHave: getDTPDHaveAtAge(age, personKey, currentAge, activePolicies),
        ciNeed: getCINeedAtAge(age, personKey),
        ciHave: getCIHaveAtAge(age, personKey, currentAge, activePolicies),
      })
    }
    return result
  }, [activePerson, clientAge, spouseAge, JSON.stringify(activePolicies), clientFloor, spouseFloor,
      p1AnnExp, p2AnnExp, inflation, properties, children, edu, coverTerm])
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
  const spouseDTPDHave = isCouple ? getDTPDHaveAtAge(spouseAge, 'spouse', spouseAge, activePolicies) : 0
  const spouseCIHave = isCouple ? getCIHaveAtAge(spouseAge, 'spouse', spouseAge, activePolicies) : 0

  const aDTPDHave = activePerson === 'client' ? clientDTPDHave : spouseDTPDHave
  const aCIHave = activePerson === 'client' ? clientCIHave : spouseCIHave

  const clientDTPDShortfall = Math.max(0, clientDTPD - clientDTPDHave)
  const clientCIShortfall = Math.max(0, clientCI - clientCIHave)
  const spouseDTPDShortfall = isCouple ? Math.max(0, spouseDTPD - spouseDTPDHave) : 0
  const spouseCIShortfall = isCouple ? Math.max(0, spouseCI - spouseCIHave) : 0

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
    const uniAges = childUniEntryAges
      .map(({ childAge, uniAge }) => currentAge + Math.max(0, uniAge - childAge))
      .filter(a => a > currentAge)
      .sort((a, b) => a - b)

    const mortEndAge = (() => {
      const allMortgages = properties.flatMap((p: any) => p.mortgages || [])
      if (allMortgages.length === 0) return null
      const maxTenure = Math.max(...allMortgages.map((m: any) => Number(m.tenure || m.remainingTenure || 0)))
      return maxTenure > 0 ? Math.round(currentAge + maxTenure) : null
    })()

    const retireAge = activePerson === 'client' ? p1RetireAge : p2RetireAge
    return { uniAges, mortEndAge, retireAge }
  }, [activePerson, clientAge, spouseAge, childUniEntryAges, properties, p1RetireAge, p2RetireAge])

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
        ...(isCouple ? [{
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
      clientFloor, spouseFloor, clientRunwayMonths, spouseRunwayMonths, isCouple])

  // ── Chart rendering ──────────────────────────────────────────────────────────
  function CoverageChart({
    data,
    type,
    floor,
    accentColor,
    currentAge,
    milestones,
  }: {
    data: typeof chartData
    type: 'dtpd' | 'ci'
    floor: number
    accentColor: string
    currentAge: number
    milestones: { uniAges: number[]; mortEndAge: number | null; retireAge: number }
  }) {
    const [hovered, setHovered] = useState<{
      age: number; need: number; have: number; x: number
    } | null>(null)

    if (!data.length) return null

    const W = 900, H = 220, PL = 72, PR = 48, PT = 24, PB = 40
    const iW = W - PL - PR
    const iH = H - PT - PB

    const needKey = type === 'dtpd' ? 'dtpdNeed' : 'ciNeed'
    const haveKey = type === 'dtpd' ? 'dtpdHave' : 'ciHave'

    const maxV = Math.max(
      ...data.map(d => Math.max((d as any)[needKey], (d as any)[haveKey])),
      floor,
      1
    )

    const minA = data[0].age
    const aRange = data[data.length - 1].age - minA || 1

    const xP = (age: number) => ((age - minA) / aRange) * iW
    const yP = (v: number) => iH - Math.min(1, v / maxV) * iH

    const fmtAx = (n: number) => {
      if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
      if (n >= 1e3) return `$${Math.round(n / 1000)}K`
      return `$${Math.round(n)}`
    }

    const ticks = [0, 0.25, 0.5, 0.75, 1]
    const floorY = PT + yP(floor)

    // Build need path (with sharp drops for CI)
    function buildNeedPath(): string {
      const pts: { x: number; y: number }[] = []
      data.forEach((d, i) => {
        const prev = i > 0 ? data[i - 1] : null
        const curr = (d as any)[needKey]
        const px = PL + xP(d.age)
        const py = PT + yP(curr)
        if (prev) {
          const prevV = (prev as any)[needKey]
          // Sharp drop = large decrease in one year
          if (prevV - curr > prevV * 0.1) {
            // Draw vertical line first
            pts.push({ x: PL + xP(prev.age), y: PT + yP(curr) })
          }
        }
        pts.push({ x: px, y: py })
      })
      return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
    }

    const needPath = buildNeedPath()

    // Have path (stepped based on policy maturities)
    const havePts = data.map(d => ({
      x: PL + xP(d.age),
      y: PT + yP((d as any)[haveKey]),
    }))
    const havePath = havePts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

    // Shortfall fill (where need > have)
    const shortfallSegments: string[] = []
    let segStart = -1
    for (let i = 0; i < data.length; i++) {
      const need = (data[i] as any)[needKey]
      const have = (data[i] as any)[haveKey]
      const isShortfall = need > have
      if (isShortfall && segStart === -1) segStart = i
      else if (!isShortfall && segStart !== -1) {
        const seg = data.slice(segStart, i)
        const topPts = seg.map((d: any) => `${PL + xP(d.age).toFixed(1)},${(PT + yP(d[needKey])).toFixed(1)}`)
        const botPts = [...seg].reverse().map((d: any) => `${PL + xP(d.age).toFixed(1)},${(PT + yP(d[haveKey])).toFixed(1)}`)
        shortfallSegments.push(`M ${topPts.join(' L ')} L ${botPts.join(' L ')} Z`)
        segStart = -1
      }
    }
    if (segStart !== -1) {
      const seg = data.slice(segStart)
      const topPts = seg.map((d: any) => `${(PL + xP(d.age)).toFixed(1)},${(PT + yP(d[needKey])).toFixed(1)}`)
      const botPts = [...seg].reverse().map((d: any) => `${(PL + xP(d.age)).toFixed(1)},${(PT + yP(d[haveKey])).toFixed(1)}`)
      shortfallSegments.push(`M ${topPts.join(' L ')} L ${botPts.join(' L ')} Z`)
    }

    // Surplus fill (where have > need)
    const surplusSegments: string[] = []
    let surpStart = -1
    for (let i = 0; i < data.length; i++) {
      const need = (data[i] as any)[needKey]
      const have = (data[i] as any)[haveKey]
      const isSurplus = have > need
      if (isSurplus && surpStart === -1) surpStart = i
      else if (!isSurplus && surpStart !== -1) {
        const seg = data.slice(surpStart, i)
        const topPts = seg.map((d: any) => `${(PL + xP(d.age)).toFixed(1)},${(PT + yP(d[haveKey])).toFixed(1)}`)
        const botPts = [...seg].reverse().map((d: any) => `${(PL + xP(d.age)).toFixed(1)},${(PT + yP(d[needKey])).toFixed(1)}`)
        surplusSegments.push(`M ${topPts.join(' L ')} L ${botPts.join(' L ')} Z`)
        surpStart = -1
      }
    }

    // Age labels
    const ageLabels = data.filter((_, i) => i % 5 === 0 || i === data.length - 1)

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
          x: PL + xP(closest.age),
        })
      } else {
        setHovered(null)
      }
    }

    const CREAM = '#FDFCFA'
    const AXIS_TEXT = '#9A9896'

    return (
      <div style={{ position: 'relative', overflow: 'visible' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: 'block', overflow: 'visible' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Grid */}
          {ticks.map(f => {
            const y = PT + iH - f * iH
            return (
              <g key={f}>
                <line x1={PL} y1={y} x2={PL + iW} y2={y} stroke="#F0EDE8" strokeWidth="0.5" />
                {f > 0 && (
                  <text x={PL - 10} y={y + 3.5} fontSize="9" fill={AXIS_TEXT}
                    textAnchor="end" fontFamily="Inter, sans-serif" fontWeight="300">
                    {fmtAx(maxV * f)}
                  </text>
                )}
              </g>
            )
          })}

          {/* Axes */}
          <line x1={PL} y1={PT} x2={PL} y2={PT + iH} stroke="#E8E5E0" strokeWidth="0.5" />
          <line x1={PL} y1={PT + iH} x2={PL + iW} y2={PT + iH} stroke="#E8E5E0" strokeWidth="0.5" />

          {/* Floor band */}
          <rect x={PL} y={floorY - 1} width={iW} height={2} fill={accentColor} opacity="0.08" />
          <line x1={PL} y1={floorY} x2={PL + iW} y2={floorY}
            stroke={accentColor} strokeWidth="1.2" strokeDasharray="6,4" opacity="0.5" />
          <rect x={PL + iW - 90} y={floorY - 11} width={88} height={14} rx="4" fill="#FDFCFA" />
          <text x={PL + iW - 46} y={floorY - 1} textAnchor="middle" fontSize="9"
            fill={accentColor} fontFamily="Inter, sans-serif" fontWeight="500" opacity="0.8">
            Floor · {fmtShort(floor)}
          </text>

          {/* Shortfall fills (red) */}
          {shortfallSegments.map((d, i) => (
            <path key={`sf-${i}`} d={d} fill="rgba(192,57,43,0.07)" stroke="rgba(192,57,43,0.15)" strokeWidth="0.5" />
          ))}

          {/* Surplus fills (green) */}
          {surplusSegments.map((d, i) => (
            <path key={`sp-${i}`} d={d} fill="rgba(45,106,79,0.06)" stroke="rgba(45,106,79,0.15)" strokeWidth="0.5" />
          ))}

          {/* Have bars */}
          {data.map(d => {
            const have = (d as any)[haveKey]
            const bx = PL + xP(d.age)
            const barH = Math.max(0, iH - yP(have))
            const barW = Math.max(2, (iW / data.length) * 0.6)
            return (
              <rect key={`bar-${d.age}`}
                x={bx - barW / 2} y={PT + yP(have)}
                width={barW} height={barH}
                fill={accentColor} opacity="0.22" rx="1.5"
              />
            )
          })}

          {/* Milestone verticals */}
          {milestones.uniAges.map((a, i) => {
            const mx = PL + xP(a)
            if (mx < PL || mx > PL + iW) return null
            return (
              <g key={`uni-${i}`}>
                <line x1={mx} y1={PT} x2={mx} y2={PT + iH}
                  stroke="#2D6A4F" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.25" />
                <text x={mx} y={PT - 4} textAnchor="middle" fontSize="8"
                  fill="#2D6A4F" fontFamily="Inter, sans-serif" opacity="0.7">
                  {`Child ${i + 1} uni`}
                </text>
              </g>
            )
          })}
          {milestones.mortEndAge && (() => {
            const mx = PL + xP(milestones.mortEndAge!)
            if (mx < PL || mx > PL + iW) return null
            return (
              <g key="mort">
                <line x1={mx} y1={PT} x2={mx} y2={PT + iH}
                  stroke="#A8834A" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.25" />
                <text x={mx} y={PT + iH + 22} textAnchor="middle" fontSize="8"
                  fill="#A8834A" fontFamily="Inter, sans-serif" opacity="0.7">
                  Mortgage end
                </text>
              </g>
            )
          })()}
          {(() => {
            const mx = PL + xP(milestones.retireAge)
            if (mx < PL || mx > PL + iW) return null
            return (
              <g key="retire">
                <line x1={mx} y1={PT} x2={mx} y2={PT + iH}
                  stroke="#555" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.2" />
                <text x={mx} y={PT - 4} textAnchor="middle" fontSize="8"
                  fill="#555" fontFamily="Inter, sans-serif" opacity="0.6">
                  Retirement
                </text>
              </g>
            )
          })()}

          {/* Need curve */}
          <path d={needPath} stroke={accentColor} strokeWidth="2" fill="none"
            strokeLinecap="round" strokeLinejoin="round" />

          {/* Have curve */}
          <path d={havePath} stroke={accentColor} strokeWidth="1.2" fill="none"
            strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4,3" opacity="0.6" />

          {/* Crosshair */}
          {hovered && (
            <line x1={hovered.x} y1={PT} x2={hovered.x} y2={PT + iH}
              stroke="#1C1A17" strokeWidth="0.5" strokeDasharray="2,4" opacity="0.15" />
          )}

          {/* Hover dot on need */}
          {hovered && (
            <circle cx={hovered.x} cy={PT + yP(hovered.need)} r="3"
              fill={accentColor} stroke={CREAM} strokeWidth="1.5" />
          )}

          {/* Hover dot on have */}
          {hovered && (
            <circle cx={hovered.x} cy={PT + yP(hovered.have)} r="2.5"
              fill={accentColor} stroke={CREAM} strokeWidth="1.5" opacity="0.6" />
          )}

          {/* Age labels */}
          {ageLabels.map(d => (
            <text key={d.age} x={PL + xP(d.age)} y={PT + iH + 14}
              fontSize="9" fill={AXIS_TEXT} textAnchor="middle"
              fontFamily="Inter, sans-serif" fontWeight="300">
              {d.age}
            </text>
          ))}
        </svg>

        {/* Tooltip */}
        {hovered && (() => {
          const gap = hovered.need - hovered.have
          const isOver = hovered.have > hovered.need
          const leftPct = ((hovered.x - PL) / iW) * 100
          return (
            <div style={{
              position: 'absolute',
              left: `${Math.min(Math.max(leftPct, 10), 85)}%`,
              top: '10px',
              transform: 'translateX(-50%)',
              background: '#1C1A17',
              color: '#F0EDE8',
              padding: '14px 18px',
              borderRadius: 10,
              fontSize: 11,
              pointerEvents: 'none',
              zIndex: 10,
              whiteSpace: 'nowrap' as const,
              minWidth: 190,
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            }}>
              <div style={{ marginBottom: 10, color: accentColor, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase' as const }}>
                Age {hovered.age}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Need</span>
                  <span style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 300 }}>{fmt(hovered.need)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Have</span>
                  <span style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 300, color: accentColor }}>{fmt(hovered.have)}</span>
                </div>
                <div style={{ paddingTop: 8, borderTop: '0.5px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', gap: 24 }}>
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
                    {gap > 0 ? 'Shortfall' : isOver ? 'Surplus' : 'Covered'}
                  </span>
                  <span style={{
                    fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 300,
                    color: gap > 0 ? '#FF8A80' : isOver ? '#A0D0B8' : '#F0EDE8',
                  }}>
                    {gap > 0 ? fmt(gap) : isOver ? fmt(-gap) : '✓'}
                  </span>
                </div>
              </div>
            </div>
          )
        })()}
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
            {isCouple ? (
              <>If <span style={{ color: '#c8a96e', fontSize: 30 }}>{clientName}</span> or <span style={{ color: '#c8a96e', fontSize: 30 }}>{spouseName}</span> were gone tomorrow —</>
            ) : (
              <>If <span style={{ color: '#c8a96e', fontSize: 30 }}>{clientName}</span> were gone tomorrow —</>
            )}
          </div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 300, color: 'rgba(240,237,232,0.45)', lineHeight: 1.7, maxWidth: 600 }}>
            {children.length > 0
              ? `${isCouple ? 'The surviving spouse' : 'Your family'} would be left to raise ${children.map((c: any) => c.name || 'your child').join(' and ')} alone. The mortgage, school fees, and daily life continue — but the income that makes it possible would not.`
              : `${isCouple ? 'The surviving spouse' : 'Your family'} would face an immediate income gap. The mortgage and daily expenses continue — but without your income to fund them.`
            }
          </div>
        </div>

        {/* Coverage cells */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr',
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
          {isCouple && (
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
            {isCouple ? (
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
          gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr',
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
          {isCouple && (
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
          {isCouple && (
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

        {/* Life milestone timeline */}
        <div style={{ marginBottom: 8 }}>
          <svg width="100%" viewBox="0 0 680 118" style={{ display: 'block', overflow: 'visible' }}>
            {/* Covered zone */}
            {milestoneAges.uniAges.length > 0 && milestoneAges.uniAges[0] > aAge && (() => {
              const endX = 40 + ((milestoneAges.uniAges[0] - aAge) / (100 - aAge)) * 600
              return <rect x="40" y="52" width={endX - 40} height="17" rx="8" fill="#E8F5E9" stroke="#2D6A4F" strokeWidth="0.5" />
            })()}
            {/* Gap zone */}
            {milestoneAges.uniAges.length > 0 && (() => {
              const startX = 40 + ((milestoneAges.uniAges[0] - aAge) / (100 - aAge)) * 600
              const retX = 40 + ((milestoneAges.retireAge - aAge) / (100 - aAge)) * 600
              return <rect x={startX} y="46" width={Math.max(0, retX - startX)} height="29" rx="10" fill="#FEE2E2" stroke="#E8A0A0" strokeWidth="0.5" strokeDasharray="5,3" />
            })()}
            {/* Post retirement zone */}
            {(() => {
              const retX = 40 + ((milestoneAges.retireAge - aAge) / (100 - aAge)) * 600
              return <rect x={retX} y="52" width={640 - retX} height="17" rx="8" fill="#F5F3EE" />
            })()}
            {/* Main line */}
            <line x1="40" y1="60" x2="640" y2="60" stroke="#D8D5D0" strokeWidth="1.5" />
            {/* Today */}
            <circle cx="40" cy="60" r="5" fill="#1C1A17" />
            <text x="40" y="84" textAnchor="middle" fontSize="10" fill="#888" fontFamily="Inter,sans-serif">Today</text>
            <text x="40" y="96" textAnchor="middle" fontSize="9" fill="#bbb" fontFamily="Inter,sans-serif">Age {aAge}</text>
            {/* Uni markers */}
            {milestoneAges.uniAges.slice(0, 2).map((uAge, i) => {
              const cx = 40 + ((uAge - aAge) / (100 - aAge)) * 600
              return (
                <g key={`uni-tl-${i}`}>
                  <circle cx={cx} cy="60" r="4" fill="#2D6A4F" />
                  <line x1={cx} y1="40" x2={cx} y2="55" stroke="#2D6A4F" strokeWidth="0.5" strokeDasharray="2,2" />
                  <text x={cx} y="34" textAnchor="middle" fontSize="10" fill="#2D6A4F" fontFamily="Inter,sans-serif" fontWeight="500">
                    {children[i]?.name || `Child ${i + 1}`} uni
                  </text>
                  <text x={cx} y="24" textAnchor="middle" fontSize="9" fill="#aaa" fontFamily="Inter,sans-serif">
                    age {uAge}
                  </text>
                </g>
              )
            })}
            {/* Mortgage end */}
            {milestoneAges.mortEndAge && (() => {
              const cx = 40 + ((milestoneAges.mortEndAge! - aAge) / (100 - aAge)) * 600
              return (
                <g>
                  <circle cx={cx} cy="60" r="4" fill="#A8834A" />
                  <line x1={cx} y1="76" x2={cx} y2="66" stroke="#A8834A" strokeWidth="0.5" strokeDasharray="2,2" />
                  <text x={cx} y="90" textAnchor="middle" fontSize="10" fill="#A8834A" fontFamily="Inter,sans-serif" fontWeight="500">
                    Mortgage repaid
                  </text>
                  <text x={cx} y="102" textAnchor="middle" fontSize="9" fill="#bbb" fontFamily="Inter,sans-serif">
                    age {milestoneAges.mortEndAge}
                  </text>
                </g>
              )
            })()}
            {/* Retirement */}
            {(() => {
              const cx = 40 + ((milestoneAges.retireAge - aAge) / (100 - aAge)) * 600
              return (
                <g>
                  <circle cx={cx} cy="60" r="5" fill="#1C1A17" />
                  <line x1={cx} y1="40" x2={cx} y2="55" stroke="#555" strokeWidth="0.5" strokeDasharray="2,2" />
                  <text x={cx} y="34" textAnchor="middle" fontSize="10" fill="#555" fontFamily="Inter,sans-serif" fontWeight="500">Retirement</text>
                  <text x={cx} y="24" textAnchor="middle" fontSize="9" fill="#bbb" fontFamily="Inter,sans-serif">age {milestoneAges.retireAge}</text>
                </g>
              )
            })()}
            {/* End */}
            <circle cx="640" cy="60" r="3" fill="#ccc" />
            <text x="640" y="84" textAnchor="middle" fontSize="9" fill="#bbb" fontFamily="Inter,sans-serif">Age 100</text>
            {/* Legend */}
            <rect x="40" y="108" width="10" height="6" rx="3" fill="#E8F5E9" stroke="#2D6A4F" strokeWidth="0.5" />
            <text x="56" y="114" fontSize="9" fill="#888" fontFamily="Inter,sans-serif">Protected</text>
            <rect x="118" y="108" width="10" height="6" rx="3" fill="#FEE2E2" stroke="#E8A0A0" strokeWidth="0.5" />
            <text x="134" y="114" fontSize="9" fill="#888" fontFamily="Inter,sans-serif">Gap period</text>
          </svg>
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
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 18, height: 2, background: '#C4A464' }} />
                <span style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Need</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 14, height: 7, background: '#C4A464', opacity: 0.28, borderRadius: 2 }} />
                <span style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Portfolio</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 14, height: 2, background: '#C0392B', opacity: 0.5 }} />
                <span style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Shortfall</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 14, height: 2, background: '#2D6A4F', opacity: 0.5 }} />
                <span style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Surplus</span>
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
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 18, height: 2, background: '#2D6A4F' }} />
                <span style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Need</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 14, height: 7, background: '#2D6A4F', opacity: 0.22, borderRadius: 2 }} />
                <span style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Portfolio</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 14, height: 2, background: '#C0392B', opacity: 0.5 }} />
                <span style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Shortfall</span>
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
          {aName}'s intention is for {activePerson === 'client' && isCouple ? `${spouseName} and the family` : 'the family'} to never have to compromise.
          Today, <span style={{ color: '#C0392B' }}>{fmt(aTotalShortfall)}</span> of that intention — across D/TPD and CI — remains unprotected.
          {aTotalShortfall > 0 && ' This is entirely addressable.'}
        </div>
        {isCouple && (
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
