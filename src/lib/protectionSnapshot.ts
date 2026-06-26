import { ageYearOnly } from './calc'

export interface PersonProtectionBreakdown {
  familyDependency: number
  mortgageDebtClearance: number
  tertiaryFunding: number
  maxCapitalRequired: number
  assetMitigation: number
  // Cash (savings+CPF) vs property split of assetMitigation — raw saved
  // values, not yet reconciled against assetMitigation. Both 0 for clients
  // whose Strategic Objectives were saved before this split existed; the
  // display layer anchors them against assetMitigation rather than trusting
  // their sum, the same way Active/Lifetime coverage is handled.
  assetMitigationCash: number
  assetMitigationProperty: number
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

// One point on the Death & TPD coverage-timeline chart — the capital need
// (net of assets, same figure the rest of the page calls "shortfall" against)
// and the existing insurance portfolio, both projected forward by age.
export interface CoveragePoint {
  age: number
  need: number
  have: number
}

export type CoverageMilestoneType = 'education' | 'mortgage' | 'retirement'

export interface CoverageMilestone {
  age: number
  label: string
  type: CoverageMilestoneType
}

export interface CoverageTimeline {
  points: CoveragePoint[]
  milestones: CoverageMilestone[]
}

export interface PersonProtectionProfile {
  dtpd: PersonProtectionBreakdown
  ci: PersonCIBreakdown
  framework: ProtectionFrameworkStatus
  lifePolicies: LifePolicyLineItem[]
  runway: FamilyRunway
  // Empty points/milestones when the person's DOB isn't on file yet — the age
  // axis has nothing to anchor to. Existing callers don't need to change.
  dtpdTimeline: CoverageTimeline
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
  children: { id: string; name?: string; dob?: string; gender?: string }[]
  isCouple: boolean
  // Needed only for the Death & TPD coverage-timeline chart's age axis — every
  // other figure on this page (breakdowns, runway, framework) is age-agnostic
  // and works exactly as before if these are omitted.
  clientDob?: string
  spouseDob?: string
}): ProtectionSnapshot {
  const { ff, protection: p, policies, isCouple } = input
  const children = input.children.map(c => ({ id: c.id, name: c.name || 'Child', gender: c.gender, age: c.dob ? ageYearOnly(c.dob) : 10 }))
  const clientAge = input.clientDob ? ageYearOnly(input.clientDob) : null
  const spouseAge = input.spouseDob ? ageYearOnly(input.spouseDob) : null

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

  // ── Coverage timeline (Death & TPD chart) ───────────────────────────────────
  // Everything below this point is ported from the live Risk Management page's
  // CoverageChart / chartData / milestoneAges (ProtectionOverview.tsx) so the
  // report shows the same curve, not a re-derivation. The frozen snapshot
  // stores the full age-by-age array instead of recomputing it live.

  function fvAnnuity(annual: number, r: number, y: number): number {
    if (y <= 0) return 0
    if (r === 0) return annual * y
    return annual * ((Math.pow(1 + r, y) - 1) / r)
  }

  function mortBalanceAtAge(atAge: number, currentAge: number, properties: any[]): number {
    const allMortgages = (properties || []).flatMap((pr: any) => pr.mortgages || [])
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
      const monthlyPmt = outstanding * monthlyRate / (1 - Math.pow(1 + monthlyRate, -totalMonths))
      const monthsLeft = yearsLeft * 12
      return total + monthlyPmt * (1 - Math.pow(1 + monthlyRate, -monthsLeft)) / monthlyRate
    }, 0)
  }

  function policyActiveAtAge(pol: any, age: number, currentAge: number): boolean {
    const mat = pol.coverageMaturity
    if (!mat || mat === 'Lifetime' || mat === 'Renewable') return true
    if (typeof mat === 'string' && mat.startsWith('Age ')) {
      return age <= parseInt(mat.replace('Age ', ''))
    }
    if (typeof mat === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(mat)) {
      const matYear = new Date(mat).getFullYear()
      const birthYear = new Date().getFullYear() - currentAge
      return age <= matYear - birthYear
    }
    return true
  }

  function effectiveMultiplierAtAge(pol: any, age: number): number {
    const mult = pol.multiplier > 1 ? pol.multiplier : 1
    const multEnd = pol.multiplierEnd || 999
    if (age <= multEnd) return mult
    if (pol.coverStep && pol.stepDownPct && age > multEnd) {
      const yearsIntoStep = Math.min(age - multEnd, pol.coverStep)
      const stepFactor = Math.max(0, 1 - yearsIntoStep * ((pol.stepDownPct || 0) / 100))
      return Math.max(1, mult * stepFactor)
    }
    return 1
  }

  // D/TPD "have" at a given age — mirrors getDTPDHaveAtAge() on the live page.
  function getDTPDHaveAtAge(age: number, who: 'client' | 'spouse', currentAge: number): number {
    return policies
      .filter((pol: any) => ACTIVE_STATUSES.includes(pol.status) && pol.person === who && pol.categoryCode === 'life')
      .reduce((sum: number, pol: any) => {
        if (!policyActiveAtAge(pol, age, currentAge)) return sum
        const mult = effectiveMultiplierAtAge(pol, age)
        const toSGD = (v: number) => (pol.isUSD ? v * (pol.fxRate || 1.35) : v)
        const death = toSGD((pol.baseDeath || 0) * mult)
        const tpd = toSGD((pol.baseTPD || 0) * mult)
        return sum + Math.max(death, tpd)
      }, 0)
  }

  // Floor — mirrors getFloor() on the live page: higher of $300K or basic
  // household+personal expenses inflated across the last ciYears of life.
  function getFloor(who: 'client' | 'spouse', currentAge: number): number {
    const lifeExp = Number(who === 'client' ? ff.client?.lifeExpectancy : ff.spouse?.lifeExpectancy) || 85
    const ciWindow = Number(p.ciYears) || 5
    const p1RetirementExp = isDetailed
      ? (Number(ff.d_conservancy) || 0) + (Number(ff.d_utilities) || 0) + (Number(ff.d_family_food) || 0) + (Number(ff.d_maid) || 0) + (Number(ff.d_other_household) || 0)
        + (Number(ff.d_personal_food) || 0) + (Number(ff.d_transport) || 0) + (Number(ff.d_car_petrol) || 0) + (Number(ff.d_car_insurance) || 0)
      : (Number(ff.s_household) || 0) + (Number(ff.s_personal) || 0)
    const p2RetirementExp = isDetailed
      ? (Number(ff.d2_conservancy) || 0) + (Number(ff.d2_utilities) || 0) + (Number(ff.d2_family_food) || 0) + (Number(ff.d2_maid) || 0) + (Number(ff.d2_other_household) || 0)
        + (Number(ff.d2_personal_food) || 0) + (Number(ff.d2_transport) || 0) + (Number(ff.d2_car_petrol) || 0) + (Number(ff.d2_car_insurance) || 0)
      : (Number(ff.s2_household) || 0) + (Number(ff.s2_personal) || 0)
    const annExp = who === 'client' ? annExpClient : annExpSpouse
    const effectiveExp = who === 'client'
      ? (p1RetirementExp > 0 ? p1RetirementExp : annExp)
      : (p2RetirementExp > 0 ? p2RetirementExp : annExp)
    const windowStart = lifeExp - ciWindow
    let floorFromExpenses = 0
    for (let age = windowStart; age < lifeExp; age++) {
      const yearsFromNow = Math.max(0, age - currentAge)
      floorFromExpenses += effectiveExp * Math.pow(1 + inflation, yearsFromNow)
    }
    return Math.max(300000, floorFromExpenses)
  }

  // Per-child education fund (future-valued tuition + living, same defaults as
  // the live page) — independent of which person's age axis is being built.
  const eduKidsRaw = p.educationChildren ?? []
  const provideEduFund = p.provideEducationFund === true
  const tuitionInflation = 0.05
  const perChildFund: Record<string, number> = {}
  if (provideEduFund) {
    children.forEach(c => {
      const ec = eduKidsRaw.find((e: any) => e.childId === c.id)
      const defaultUniAge = c.gender === 'Female' ? 19 : 21
      const uniEntryAge = ec?.uniEntryAge ?? defaultUniAge
      const courseDuration = ec?.courseDuration ?? 4
      const annualTuition = ec?.annualTuition ?? 10750
      const annualLiving = ec?.annualLiving ?? 12500
      const yearsToUni = Math.max(0, uniEntryAge - c.age)
      const fvTuition = annualTuition * Math.pow(1 + tuitionInflation, yearsToUni) * courseDuration
      const fvLiving = annualLiving * Math.pow(1 + inflation, yearsToUni) * courseDuration
      perChildFund[c.id] = fvTuition + fvLiving
    })
  }

  // Per-child university-entry age translated onto a specific person's age axis
  // (client and spouse have different current ages, so the same child's uni
  // year lands on a different milestone age for each).
  function uniMilestonesForAge(currentAge: number): { childId: string; name: string; parentAgeAtUni: number }[] {
    if (!provideEduFund) return []
    return children.map(c => {
      const ec = eduKidsRaw.find((e: any) => e.childId === c.id)
      const defaultUniAge = c.gender === 'Female' ? 19 : 21
      const uniEntryAge = ec?.uniEntryAge ?? defaultUniAge
      return { childId: c.id, name: c.name, parentAgeAtUni: currentAge + (uniEntryAge - c.age) }
    })
  }

  function getMortEndAge(currentAge: number): number | null {
    const allMortgages = (ff.properties || []).flatMap((pr: any) => pr.mortgages || [])
    if (allMortgages.length === 0) return null
    const maxTenure = Math.max(...allMortgages.map((m: any) => Number(m.tenure || m.remainingTenure || 0)))
    return maxTenure > 0 ? Math.round(currentAge + maxTenure) : null
  }

  // Builds the full age-46-to-100-style array (actually currentAge-to-100) for
  // one person, scaled so it anchors exactly to the net-of-assets figure
  // buildDTPD() already computed — same approach the live chart uses to stay
  // consistent with the saved Strategic Objectives value.
  function buildDTPDTimeline(who: 'client' | 'spouse', currentAgeOrNull: number | null, netOfAssetsAtCurrent: number): CoverageTimeline {
    if (currentAgeOrNull === null) return { points: [], milestones: [] }
    const currentAge: number = currentAgeOrNull

    const annExp = who === 'client' ? annExpClient : annExpSpouse
    const uniMeta = uniMilestonesForAge(currentAge)

    function rawNeedAtAge(age: number): number {
      const yLeft = Math.max(0, (currentAge + coverageTerm) - age)
      const ageFD = fvAnnuity(annExp, inflation, yLeft)
      const ageMort = mortBalanceAtAge(age, currentAge, ff.properties || [])
      let eduRemaining = 0
      if (children.length > 0) {
        eduRemaining = children.reduce((s: number, c) => {
          const meta = uniMeta.find(u => u.childId === c.id)
          if (!meta) return s
          if (age < meta.parentAgeAtUni) return s + (perChildFund[c.id] || 0)
          return s
        }, 0)
      }
      return ageFD + ageMort + eduRemaining
    }

    const floor = getFloor(who, currentAge)
    const rawAtCurrent = rawNeedAtAge(currentAge)
    const scale = rawAtCurrent > 0 ? netOfAssetsAtCurrent / rawAtCurrent : 1

    const points: CoveragePoint[] = []
    for (let age = currentAge; age <= 100; age++) {
      const need = Math.max(floor, rawNeedAtAge(age) * scale)
      const have = getDTPDHaveAtAge(age, who, currentAge)
      points.push({ age, need: Math.round(need), have: Math.round(have) })
    }

    const milestones: CoverageMilestone[] = []
    uniMeta.forEach(u => {
      if (u.parentAgeAtUni > currentAge && u.parentAgeAtUni < 100) {
        milestones.push({ age: Math.round(u.parentAgeAtUni), label: u.name, type: 'education' })
      }
    })
    const mortEndAge = getMortEndAge(currentAge)
    if (mortEndAge && mortEndAge > currentAge && mortEndAge < 100) {
      milestones.push({ age: mortEndAge, label: 'Mortgage paid', type: 'mortgage' })
    }
    const retireAge = Math.round(Number(who === 'client' ? ff.client?.retirementAge : ff.spouse?.retirementAge) || (who === 'client' ? 65 : 62))
    if (retireAge > currentAge && retireAge < 100) {
      milestones.push({ age: retireAge, label: 'Retirement', type: 'retirement' })
    }

    return { points, milestones }
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
    const assetMitigationCash = Math.max(0, Math.round(p[`${prefix}_dtpd_assets_cash`] || 0))
    const assetMitigationProperty = Math.max(0, Math.round(p[`${prefix}_dtpd_assets_property`] || 0))
    const netOfAssets = Math.max(0, maxCapitalRequired - assetMitigation)
    const existingCoverage = Math.round(calcExistingLifeCover(policies, who))
    const shortfall = Math.max(0, netOfAssets - existingCoverage)

    return {
      familyDependency,
      mortgageDebtClearance,
      tertiaryFunding,
      maxCapitalRequired,
      assetMitigation,
      assetMitigationCash,
      assetMitigationProperty,
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
    const dtpd = buildDTPD(who)
    const currentAge = who === 'client' ? clientAge : spouseAge
    const netOfAssets = Math.max(0, dtpd.maxCapitalRequired - dtpd.assetMitigation)
    return {
      dtpd,
      ci: buildCI(who),
      framework: buildFramework(who),
      lifePolicies: buildLifePolicies(policies, who),
      runway: buildRunway(who),
      dtpdTimeline: buildDTPDTimeline(who, currentAge, netOfAssets),
    }
  }

  return {
    client: buildPerson('client'),
    spouse: isCouple ? buildPerson('spouse') : null,
  }
}
