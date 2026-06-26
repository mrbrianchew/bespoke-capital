import { ageYearOnly } from './calc'

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

export type FrameworkRowKey = 'medical' | 'ci' | 'dtpd' | 'accident'
export type FrameworkRowStatus = 'covered' | 'needs_attention'

export interface ProtectionFrameworkStatus {
  medicalCovered: boolean
  accidentCovered: boolean
  // Advisor-set overrides for what's *displayed* on the framework ladder —
  // e.g. the system sees an active medical policy and would show "Covered",
  // but the advisor knows it's a main plan with no rider and wants the row
  // to read "Needs attention" instead. Purely cosmetic: doesn't change any
  // of the underlying shortfall/coverage figures used elsewhere on the page.
  // Set on the live report before saving; once a snapshot is saved this is
  // frozen along with everything else.
  overrides?: Partial<Record<FrameworkRowKey, FrameworkRowStatus>>
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

  // DTPD breakdown reuses the components already computed and saved on the
  // Strategic Objectives page (protection.p1_dtpd_fd / p1_dtpd_mort / etc.) —
  // this snapshot does not re-derive family dependency, mortgage clearance, or
  // education funding, so the report always matches what's shown on Strategic
  // Objectives. Mirrors the same approach already used for buildCI below.
  //
  // Known limitation: clients whose needs were last saved before this
  // breakdown was added will only have the legacy net figure (p1_dtpd_need)
  // persisted, not the granular components — the breakdown will show as
  // zero until the advisor revisits and re-saves the Death & TPD tab on
  // Strategic Objectives.
  function buildDTPD(who: 'client' | 'spouse'): PersonProtectionBreakdown {
    const prefix = who === 'client' ? 'p1' : 'p2'

    const familyDependency = Math.max(0, Math.round(p[`${prefix}_dtpd_fd`] || 0))
    const mortgageDebtClearance = Math.max(0, Math.round(p[`${prefix}_dtpd_mort`] || 0))
    const tertiaryFunding = Math.max(0, Math.round(p[`${prefix}_dtpd_edu`] || 0))
    const maxCapitalRequired = Math.max(0, Math.round(p[`${prefix}_dtpd_gross`] || 0))
    const assetMitigation = Math.max(0, Math.round(p[`${prefix}_dtpd_assets`] || 0))
    const netOfAssets = Math.max(0, maxCapitalRequired - assetMitigation)
    const existingCoverage = Math.round(calcExistingLifeCover(policies, who))
    const shortfall = Math.max(0, netOfAssets - existingCoverage)

    return {
      familyDependency,
      mortgageDebtClearance,
      tertiaryFunding,
      maxCapitalRequired,
      assetMitigation,
      existingCoverage,
      shortfall,
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
