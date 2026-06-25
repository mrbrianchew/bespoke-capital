import { fv, ageYearOnly, amortisedOutstanding } from './calc'

export interface PersonProtectionBreakdown {
  familyDependency: number
  mortgageDebtClearance: number
  tertiaryFunding: number
  maxCapitalRequired: number
  assetMitigation: number
  existingCoverage: number
  shortfall: number
  status: 'covered' | 'shortfall'
}

export interface PersonCIBreakdown {
  familyDependency: number
  mortgageDebtClearance: number
  tertiaryFunding: number
  medicalBuffer: number
  recoveryBuffer: number
  maxCapitalRequired: number
  assetMitigation: number
  existingCoverage: number
  shortfall: number
  status: 'covered' | 'shortfall'
  runwayYears: number
}

export interface LifePolicyLineItem {
  id: string
  companyName: string
  productName: string
  isUSD: boolean
  fxRate: number
  deathSA: number
  tpdSA: number
  ciSA: number
  eciSA: number
  coverAge: string
}

export interface ProtectionFrameworkStatus {
  medicalCovered: boolean
  accidentCovered: boolean
}

export interface FamilyRunway {
  fundedYears: number
  targetYears: number
  status: 'covered' | 'shortfall'
}

export interface PersonProtectionProfile {
  dtpd: PersonProtectionBreakdown
  ci: PersonCIBreakdown
  framework: ProtectionFrameworkStatus
  lifePolicies: LifePolicyLineItem[]
  runway: FamilyRunway
}

export interface ProtectionSnapshot {
  client: PersonProtectionProfile
  spouse: PersonProtectionProfile | null
}

// University cost defaults — mirrors UNI_COST_DEFAULTS fallback shape used on
// the Objectives page. If a client has custom uni cost settings saved elsewhere
// this won't pick them up; flagged as a known simplification.
const UNI_COST_DEFAULTS: Record<string, { annual_tuition: number; annual_living: number; default_duration: number }> = {
  sg_local: { annual_tuition: 12000, annual_living: 6000, default_duration: 4 },
  sg_private: { annual_tuition: 25000, annual_living: 8000, default_duration: 3 },
  overseas: { annual_tuition: 45000, annual_living: 20000, default_duration: 4 },
}

const DETAILED_EXPENSE_MAP: Record<string, string[]> = {
  financial: ['d_rental_expense', 'd_income_tax', 'd_regular_savings', 'd_insurance'],
  household: ['d_conservancy', 'd_utilities', 'd_family_food', 'd_maid', 'd_other_household'],
  personal: ['d_personal_food', 'd_transport', 'd_car_petrol', 'd_car_insurance'],
  children: ['d_childcare', 'd_school_fees', 'd_school_transport', 'd_allowance_children', 'd_other_children'],
  lifestyle: ['d_holidays', 'd_hobbies', 'd_allowance_parents', 'd_others_lifestyle'],
}

function getDetailedCategoryTotal(ff: Record<string, any>, category: string, prefix: 'client' | 'spouse', subItems: Record<string, boolean>): number {
  const sp = prefix === 'spouse' ? 'd2_' : 'd_'
  const perPersonKey = prefix === 'spouse' ? '_s' : '_c'
  const keys = DETAILED_EXPENSE_MAP[category] || []
  return keys.reduce((sum, k) => {
    const personKey = k + perPersonKey
    if (personKey in subItems) {
      if (subItems[personKey] === false) return sum
    } else {
      if (subItems[k] === false) return sum
    }
    return sum + ((ff[k.replace('d_', sp)] as number) ?? 0)
  }, 0)
}

function getDetailedTotal(ff: Record<string, any>, categories: Record<string, boolean>, subItems: Record<string, boolean>, prefix: 'client' | 'spouse'): number {
  return Object.entries(categories).reduce((total, [cat, enabled]) => {
    if (!enabled) return total
    return total + getDetailedCategoryTotal(ff, cat, prefix, subItems)
  }, 0)
}

function getSimpleCategoryTotal(ff: Record<string, any>, categories: Record<string, boolean>, prefix: 'client' | 'spouse'): number {
  const p = prefix === 'spouse' ? 's2_' : 's_'
  const catMap: Record<string, string[]> = {
    financial: [`${p}income_tax`, `${p}insurance`, `${p}regular_savings`],
    household: [`${p}housing`, `${p}utilities`, `${p}family_food`],
    personal: [`${p}transport`],
    children: [`${p}children`],
    lifestyle: [`${p}lifestyle`, `${p}others`],
  }
  return Object.entries(categories).reduce((total, [cat, enabled]) => {
    if (!enabled) return total
    return total + (catMap[cat] ?? []).reduce((s, k) => s + ((ff[k] as number) ?? 0), 0)
  }, 0)
}

function getAssetOffset(ff: Record<string, any>, prefix: 'client' | 'spouse', protection: Record<string, any>): number {
  if (protection.assetOffsetEnabled === false) return 0
  const items = protection.assetOffsetItems ?? {}
  const liquidEnabled = items.liquid !== false
  const cpfEnabled = items.cpf !== false
  const propertyEnabled = items.property !== false
  const ap = prefix === 'spouse' ? 'a2_' : 'a_'

  const liquid = liquidEnabled
    ? (ff[`${ap}savings`] ?? 0) + (ff[`${ap}fixed_deposit`] ?? 0) + (ff[`${ap}srs`] ?? 0) +
      (ff[`${ap}shares`] ?? 0) + (ff[`${ap}etf`] ?? 0) + (ff[`${ap}unit_trust`] ?? 0) +
      (ff[`${ap}bonds`] ?? 0) + (ff[`${ap}alternatives`] ?? 0)
    : 0

  const cpf = cpfEnabled
    ? (ff[`${ap}cpf_oa`] ?? 0) + (ff[`${ap}cpf_sa`] ?? 0) + (ff[`${ap}cpf_ma`] ?? 0) + (ff[`${ap}cpf_ra`] ?? 0)
    : 0

  if (!propertyEnabled) return liquid + cpf

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
    const pcts = prefix === 'client' ? (protection.mortgageCoverPctsClient ?? []) : (protection.mortgageCoverPctsSpouse ?? [])
    const pct = (pcts[mortgageIdx] ?? 100) / 100
    return sum + val * pct
  }, 0)

  return liquid + cpf + propertyValue
}

function calcMortgageForPerson(ff: Record<string, any>, protection: Record<string, any>, who: 'client' | 'spouse', isCouple: boolean): number {
  const properties = (ff.properties ?? []) as any[]
  const mortgages = properties.filter((prop: any) => prop.initialLoanAmount || prop.outstanding || prop.monthlyRepayment)

  const mortgageTotal = mortgages.reduce((sum: number, prop: any, i: number) => {
    const outstanding = prop.outstanding ?? amortisedOutstanding(prop)
    const pcts = who === 'client' ? (protection.mortgageCoverPctsClient ?? []) : (protection.mortgageCoverPctsSpouse ?? [])
    const pct = !isCouple ? 1 : (pcts[i] ?? 100) / 100
    return sum + outstanding * pct
  }, 0)

  const debtTotal = ((protection.nonMortgageDebts ?? []) as any[]).reduce((sum: number, d: any) => {
    const owner = d.owner ?? 'client'
    if (!isCouple) return sum + (d.amount ?? 0)
    if (owner === 'joint') return sum + (d.amount ?? 0) * 0.5
    if (owner === who) return sum + (d.amount ?? 0)
    return sum
  }, 0)

  return mortgageTotal + debtTotal
}

function calcEducationForPerson(
  protection: Record<string, any>,
  children: { id: string; age: number; gender?: string }[],
  who: 'client' | 'spouse',
  isCouple: boolean,
): number {
  if (!protection.provideEducationFund) return 0
  const eduKids = protection.educationChildren ?? []
  const livingInflation = (protection.inflationRate ?? 3) / 100

  return children.reduce((sum, child) => {
    const ec = eduKids.find((e: any) => e.childId === child.id)
    if (!ec) return sum
    const defaultEntryAge = child.gender === 'Male' ? 21 : 19
    const uniEntryAge = ec.uniEntryAge ?? defaultEntryAge
    const yearsToUni = Math.max(0, uniEntryAge - child.age)
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

function calcExistingLifeCover(policies: any[], who: 'client' | 'spouse'): number {
  const activePols = policies.filter((pol: any) => ACTIVE_STATUSES.includes(pol.status))
  const toSGD = (val: number, pol: any) => (pol.isUSD ? val * (pol.fxRate || 1.35) : val)
  return activePols
    .filter((pol: any) => pol.person === who && pol.categoryCode === 'life')
    .reduce((s: number, pol: any) => {
      const mult = pol.multiplier || 1
      return s + toSGD(Math.max((pol.baseDeath || 0) * mult, pol.sumAssured || 0), pol)
    }, 0)
}

const ACTIVE_STATUSES = ['In-Force', 'Premium Holiday', 'Paid-up']

function calcExistingCICover(policies: any[], who: 'client' | 'spouse'): number {
  const activePols = policies.filter((pol: any) => ACTIVE_STATUSES.includes(pol.status))
  const toSGD = (val: number, pol: any) => (pol.isUSD ? val * (pol.fxRate || 1.35) : val)
  return activePols
    .filter((pol: any) => pol.person === who && pol.categoryCode === 'life')
    .reduce((s: number, pol: any) => {
      const mult = pol.multiplier || 1
      return s + toSGD(Math.max(pol.baseAdvCI || 0, pol.baseEarlyCI || 0) * mult, pol)
    }, 0)
}

function hasActiveCategoryCoverage(policies: any[], who: 'client' | 'spouse', categoryCode: string): boolean {
  return policies.some((pol: any) => ACTIVE_STATUSES.includes(pol.status) && pol.person === who && pol.categoryCode === categoryCode)
}

// Mirrors getMultipliedBenefit() on the Risk Management page — base sum x multiplier,
// no sumAssured fallback — so the figures shown here always match what's on that page.
function buildLifePolicies(policies: any[], who: 'client' | 'spouse'): LifePolicyLineItem[] {
  return policies
    .filter((pol: any) => ACTIVE_STATUSES.includes(pol.status) && pol.person === who && pol.categoryCode === 'life')
    .map((pol: any) => {
      const mult = pol.multiplier || 1
      return {
        id: pol.id,
        companyName: pol.companyName || '',
        productName: pol.productName || '',
        isUSD: !!pol.isUSD,
        fxRate: pol.fxRate || 1.35,
        deathSA: (pol.baseDeath || 0) * mult,
        tpdSA: (pol.baseTPD || 0) * mult,
        ciSA: (pol.baseAdvCI || 0) * mult,
        eciSA: (pol.baseEarlyCI || 0) * mult,
        coverAge: pol.coverageMaturity || '',
      }
    })
}

export function buildProtectionSnapshot(input: {
  ff: Record<string, any>
  protection: Record<string, any>
  policies: any[]
  children: { id: string; dob?: string; gender?: string }[]
  isCouple: boolean
}): ProtectionSnapshot {
  const { ff, protection: p, policies, isCouple } = input
  const children = input.children.map(c => ({ id: c.id, gender: c.gender, age: c.dob ? ageYearOnly(c.dob) : 10 }))

  const isDetailed = (p.expenseMode ?? ff.expense_mode ?? 'simple') === 'detailed'
  const cats = p.expenseCategories ?? { financial: true, household: true, personal: true, children: true, lifestyle: true }
  const subItems = p.expenseSubItems ?? {}
  const inflation = (p.inflationRate ?? 3) / 100

  function getAnnualExpense(who: 'client' | 'spouse'): number {
    if (isDetailed) return getDetailedTotal(ff, cats, subItems, who)
    return getSimpleCategoryTotal(ff, cats, who)
  }

  const annExpClient = getAnnualExpense('client')
  const annExpSpouse = isCouple ? getAnnualExpense('spouse') : 0
  const annExpTotal = annExpClient + annExpSpouse

  // Coverage term — auto-calculated from the child with the most years to graduation
  const childAges = children.map(c => c.age)
  const youngestAge = childAges.length > 0 ? Math.min(...childAges) : null
  const coverageTerm = (() => {
    if (youngestAge === null) return p.coverageTermOverride ?? 20
    const eduKids = p.educationChildren ?? []
    const terms = children.map(c => {
      const ec = eduKids.find((e: any) => e.childId === c.id)
      const defaultEntry = c.gender === 'Male' ? 21 : 19
      const entryAge = ec?.uniEntryAge ?? defaultEntry
      const duration = ec?.courseDuration ?? 4
      const gradAge = entryAge + duration
      return Math.max(0, gradAge - c.age)
    })
    return terms.length > 0 ? Math.max(...terms) : (p.coverageTermOverride ?? 20)
  })()

  const defaultClientPct = annExpTotal > 0 ? (annExpClient / annExpTotal * 100) : 100
  const defaultSpousePct = annExpTotal > 0 ? (annExpSpouse / annExpTotal * 100) : 100
  const clientCoverPct = !isCouple ? 1 : (p.expenseCoverPctClient ?? defaultClientPct) / 100
  const spouseCoverPct = (p.expenseCoverPctSpouse ?? defaultSpousePct) / 100

  function getFdBase(who: 'client' | 'spouse'): number {
    const annExp = who === 'client' ? annExpClient : annExpSpouse
    const coverPct = who === 'client' ? clientCoverPct : spouseCoverPct
    return (p[who === 'client' ? 'fdModeClient' : 'fdModeSpouse'] ?? 'combined') === 'own'
      ? annExp
      : annExpTotal * coverPct
  }

  function buildDTPD(who: 'client' | 'spouse'): PersonProtectionBreakdown {
    const fdBase = getFdBase(who)

    const familyDependency = fv(inflation, coverageTerm, fdBase)
    const mortgageDebtClearance = calcMortgageForPerson(ff, p, who, isCouple)
    const tertiaryFunding = calcEducationForPerson(p, children, who, isCouple)
    const maxCapitalRequired = familyDependency + mortgageDebtClearance + tertiaryFunding
    const assetMitigation = getAssetOffset(ff, who, p)
    const netOfAssets = Math.max(0, maxCapitalRequired - assetMitigation)
    const existingCoverage = calcExistingLifeCover(policies, who)
    const shortfall = Math.max(0, netOfAssets - existingCoverage)

    return {
      familyDependency: Math.round(familyDependency),
      mortgageDebtClearance: Math.round(mortgageDebtClearance),
      tertiaryFunding: Math.round(tertiaryFunding),
      maxCapitalRequired: Math.round(maxCapitalRequired),
      assetMitigation: Math.round(assetMitigation),
      existingCoverage: Math.round(existingCoverage),
      shortfall: Math.round(shortfall),
      status: shortfall > 0 ? 'shortfall' : 'covered',
    }
  }

  // Family Financial Runway — how long the existing death benefit payout alone
  // (no other assets) would sustain the family's current lifestyle, with that
  // need inflating each year, versus the years actually needed (coverageTerm —
  // same "until youngest child graduates" horizon used above). No investment
  // growth is assumed on the payout itself, only inflation on the withdrawal —
  // deliberately conservative, same spirit as the Emergency Cash Runway figure
  // on the Wealth Summary tab.
  function buildRunway(who: 'client' | 'spouse'): FamilyRunway {
    const fdBase = getFdBase(who)
    const existingCoverage = calcExistingLifeCover(policies, who)
    const targetYears = coverageTerm

    let fundedYears: number
    if (fdBase <= 0) {
      fundedYears = existingCoverage > 0 ? targetYears : 0
    } else if (existingCoverage <= 0) {
      fundedYears = 0
    } else {
      let remaining = existingCoverage
      const maxIterations = Math.max(targetYears * 3, 100)
      let depletedAt = maxIterations
      for (let year = 0; year < maxIterations; year++) {
        const needThisYear = fdBase * Math.pow(1 + inflation, year)
        if (remaining >= needThisYear) {
          remaining -= needThisYear
        } else {
          depletedAt = year + remaining / needThisYear
          break
        }
      }
      fundedYears = depletedAt
    }

    return {
      fundedYears: Math.round(fundedYears * 10) / 10,
      targetYears,
      status: fundedYears >= targetYears ? 'covered' : 'shortfall',
    }
  }

  // CI breakdown reuses the components already computed and saved on the
  // Strategic Objectives page (protection.p1_ci_fd / p1_ci_mort / etc.),
  // under whichever calculation method (expenses / income / capital / custom)
  // was chosen there — this snapshot does not re-derive that calculation, so
  // the report always matches what's shown on Strategic Objectives.
  //
  // Known limitation: clients whose needs were last saved before this
  // breakdown was added will only have the legacy net figure (p1_ci_need)
  // persisted, not the granular components — the breakdown will show as
  // zero until the advisor revisits and re-saves Strategic Objectives.
  function buildCI(who: 'client' | 'spouse'): PersonCIBreakdown {
    const annExp = who === 'client' ? annExpClient : annExpSpouse
    const prefix = who === 'client' ? 'p1' : 'p2'

    const familyDependency = Math.max(0, Math.round(p[`${prefix}_ci_fd`] || 0))
    const mortgageDebtClearance = Math.max(0, Math.round(p[`${prefix}_ci_mort`] || 0))
    const tertiaryFunding = Math.max(0, Math.round(p[`${prefix}_ci_edu`] || 0))
    const medicalBuffer = Math.max(0, Math.round(p[`${prefix}_ci_medical_buffer`] || 0))
    const recoveryBuffer = Math.max(0, Math.round(p[`${prefix}_ci_recovery_buffer`] || 0))
    const maxCapitalRequired = Math.max(0, Math.round(p[`${prefix}_ci_gross`] || 0))
    const assetMitigation = Math.max(0, Math.round(p[`${prefix}_ci_assets`] || 0))
    const netOfAssets = Math.max(0, maxCapitalRequired - assetMitigation)
    const existingCoverage = Math.round(calcExistingCICover(policies, who))
    const shortfall = Math.max(0, netOfAssets - existingCoverage)
    const runwayYears = annExp > 0 ? Math.round((existingCoverage / annExp) * 10) / 10 : 0

    return {
      familyDependency,
      mortgageDebtClearance,
      tertiaryFunding,
      medicalBuffer,
      recoveryBuffer,
      maxCapitalRequired,
      assetMitigation,
      existingCoverage,
      shortfall,
      status: shortfall > 0 ? 'shortfall' : 'covered',
      runwayYears,
    }
  }

  function buildFramework(who: 'client' | 'spouse'): ProtectionFrameworkStatus {
    return {
      medicalCovered: hasActiveCategoryCoverage(policies, who, 'medical'),
      accidentCovered: hasActiveCategoryCoverage(policies, who, 'general'),
    }
  }

  function buildPerson(who: 'client' | 'spouse'): PersonProtectionProfile {
    return {
      dtpd: buildDTPD(who),
      ci: buildCI(who),
      framework: buildFramework(who),
      lifePolicies: buildLifePolicies(policies, who),
      runway: buildRunway(who),
    }
  }

  return {
    client: buildPerson('client'),
    spouse: isCouple ? buildPerson('spouse') : null,
  }
}
