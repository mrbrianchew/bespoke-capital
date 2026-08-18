import { ageYearOnly, fv } from './calc'

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
  // Recovery window selected on Strategic Objectives > Critical Illness tab
  // (protection.ciYears, same default fallback used to build maxCapitalRequired
  // there) — carried through so the report can show "covers N of ciYears years"
  // alongside the funded %, not just the % on its own.
  ciYears: number
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
  // 100% of the family's TOTAL protection need — family dependency (combined
  // household expenses, capitalised over the coverage term) + the full,
  // unmitigated mortgage/debt payoff + the full education fund. All three
  // component figures below are the objective 100% amounts, independent of
  // any coverPct/mortgageCoverPcts/fdMode election — same for both the
  // client's and spouse's runway card (it's the whole family's exposure,
  // not "my share" of it).
  fullNeed: number
  fullNeedFD: number
  fullNeedMort: number
  fullNeedEdu: number
  // Capital required for what THIS person has actually chosen to cover
  // (fdMode + coverage %, mortgageCoverPcts, per-child coverPct) — same
  // figures as dtpd.familyDependency / .mortgageDebtClearance / .tertiaryFunding.
  targetNeed: number
  targetFD: number
  targetMort: number
  targetEdu: number
  // What's currently in place to fund it: existing life (death) cover plus
  // the asset offset already used against the D/TPD need.
  currentProvision: number
  currentInsurance: number
  currentAssets: number
  // Live Asset Offset toggle state (Strategic Objectives > Asset Offset tab)
  // — surfaced so the report can label whether currentProvision includes
  // assets or is insurance-only.
  assetOffsetEnabled: boolean
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
  // CI sibling of dtpdTimeline — same empty-when-no-DOB behavior.
  ciTimeline: CoverageTimeline
}

export interface ProtectionSnapshot {
  client: PersonProtectionProfile
  spouse: PersonProtectionProfile | null
}

const DETAILED_EXPENSE_MAP: Record<string, string[]> = {
  financial: ['d_vehicle_repay', 'd_personal_loan_repay', 'd_rental_expense', 'd_income_tax', 'd_regular_savings', 'd_insurance'],
  household: ['d_conservancy', 'd_utilities', 'd_family_food', 'd_maid', 'd_other_household'],
  personal: ['d_personal_food', 'd_transport', 'd_car_petrol', 'd_car_insurance'],
  children: ['d_childcare', 'd_school_fees', 'd_school_transport', 'd_allowance_children', 'd_other_children'],
  lifestyle: ['d_holidays', 'd_hobbies', 'd_allowance_parents', 'd_others_lifestyle'],
}

// Custom "+Add Row" line items (Financial Profile, Detailed mode) live in separate arrays,
// not as fixed fields — DETAILED_EXPENSE_MAP above can't see them. No per-item sub-toggle
// exists for these (unlike fixed keys) — they're always included when the category is on.
const DETAILED_EXPENSE_CUSTOM_KEY: Record<string, string> = {
  financial: 'd_custom_financial',
  household: 'd_custom_household',
  personal: 'd_custom_personal',
  children: 'd_custom_children',
  lifestyle: 'd_custom_lifestyle',
}

// Household bills that are one real-world shared cost, not two independent
// per-person figures — conservancy, utilities, family food & groceries, maid,
// other household. Split 50/50 between client and spouse regardless of which
// column an advisor happened to enter the figure into, instead of crediting
// the whole bill to one person and zero to the other. (Originally family_food
// was left out of this list on the assumption that two different non-zero
// values meant it was deliberately independent — but the Financials UI groups
// it under "Household & Living" with the identical per-person entry pattern
// as the other four, so it belongs here too.)
const SHARED_HOUSEHOLD_KEYS = ['d_conservancy', 'd_utilities', 'd_family_food', 'd_maid', 'd_other_household']

export function getDetailedCategoryTotal(ff: Record<string, any>, category: string, prefix: 'client' | 'spouse', subItems: Record<string, boolean>): number {
  const sp = prefix === 'spouse' ? 'd2_' : 'd_'
  const perPersonKey = prefix === 'spouse' ? '_s' : '_c'
  const keys = DETAILED_EXPENSE_MAP[category] || []
  let sum = keys.reduce((sum, k) => {
    const personKey = k + perPersonKey
    if (personKey in subItems) {
      if (subItems[personKey] === false) return sum
    } else {
      if (subItems[k] === false) return sum
    }
    if (SHARED_HOUSEHOLD_KEYS.includes(k)) {
      const clientVal = (ff[k] as number) ?? 0
      const spouseVal = (ff[k.replace('d_', 'd2_')] as number) ?? 0
      return sum + (clientVal + spouseVal) / 2
    }
    return sum + ((ff[k.replace('d_', sp)] as number) ?? 0)
  }, 0)
  const customKey = DETAILED_EXPENSE_CUSTOM_KEY[category]
  if (customKey) {
    const items = (ff[customKey] as any[]) ?? []
    sum += items.reduce((s, i) => s + ((prefix === 'spouse' ? i.amount2 : i.amount) ?? 0), 0)
  }
  return sum
}

// Exported so ProtectionOverview's chart-shape calculation can reuse the
// exact same expense figure that feeds maxCapitalRequired here — previously
// it had its own simple-mode-only approximation that silently fell back to
// income×0.7 for detailed-mode clients, badly distorting the chart's
// scale-anchor factor.
export function getDetailedTotal(ff: Record<string, any>, categories: Record<string, boolean>, subItems: Record<string, boolean>, prefix: 'client' | 'spouse'): number {
  return Object.entries(categories).reduce((total, [cat, enabled]) => {
    if (!enabled) return total
    return total + getDetailedCategoryTotal(ff, cat, prefix, subItems)
  }, 0)
}

export function getSimpleCategoryTotal(ff: Record<string, any>, categories: Record<string, boolean>, prefix: 'client' | 'spouse'): number {
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

export interface CIFloorDetail {
  result: number
  effectiveExp: number
  windowStart: number
  windowEnd: number
  lifeExp: number
  floorYears: number
  isExpenseBinding: boolean
  isOverride: boolean
}

// The CI survival floor: permanent minimum coverage for a late-life diagnosis
// with no other assets — higher of $300K or basic household+personal expenses
// inflated across the last floorYears of life expectancy. This used to be
// duplicated three times (ProtectionOverview.tsx's own copy, and a third
// inline version inside buildProtectionSnapshot below feeding the Report /
// Action Plan pages) with no way to configure which expenses count. Now the
// only copy, and reads floorSubItems/floorYears/floorOverride so an advisor
// can adjust it per client from the Objectives page.
export function getCIFloor(
  ff: Record<string, any>,
  p: Record<string, any>,
  prefix: 'client' | 'spouse',
  currentAge: number,
  inflation: number,
  fallbackAnnExp: number,
): CIFloorDetail {
  const lifeExp = Number(prefix === 'client' ? ff.client?.lifeExpectancy : ff.spouse?.lifeExpectancy) || 85
  const floorYears = Number(p.floorYears) || Number(p.ciYears) || 5
  const isDetailed = (p.expenseMode ?? ff.expense_mode ?? 'simple') === 'detailed'
  const override = prefix === 'client' ? p.floorOverrideClient : p.floorOverrideSpouse
  const hasOverride = override != null && override > 0
  const subItems = p.floorSubItems ?? {}

  let effectiveExp: number
  if (hasOverride) {
    effectiveExp = Number(override)
  } else if (isDetailed) {
    const raw = getDetailedCategoryTotal(ff, 'household', prefix, subItems) + getDetailedCategoryTotal(ff, 'personal', prefix, subItems)
    effectiveExp = raw > 0 ? raw : fallbackAnnExp
  } else {
    const sp = prefix === 'spouse' ? 's2_' : 's_'
    const raw = (Number(ff[`${sp}household`]) || 0) + (Number(ff[`${sp}personal`]) || 0)
    effectiveExp = raw > 0 ? raw : fallbackAnnExp
  }

  const windowStart = lifeExp - floorYears
  let floorFromExpenses = 0
  for (let age = windowStart; age < lifeExp; age++) {
    const yearsFromNow = Math.max(0, age - currentAge)
    floorFromExpenses += effectiveExp * Math.pow(1 + inflation, yearsFromNow)
  }
  const result = Math.max(300000, floorFromExpenses)
  return {
    result,
    effectiveExp,
    windowStart,
    windowEnd: lifeExp - 1,
    lifeExp,
    floorYears,
    isExpenseBinding: floorFromExpenses > 300000,
    isOverride: hasOverride,
  }
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

  // Mortgage data lives directly on each PropertyItem (outstanding,
  // initialLoanAmount, initialTenure, remainingTenure, loanStartDate) — there
  // is no nested `property.mortgages[]` array in the schema. Mirrors the same
  // field resolution as calcMortgageForPerson() on the Objectives page so the
  // Risk Management timeline agrees with the saved need figure.
  // Amortized-balance fallback — mirrors calcAmortizedBalance() on the
  // Objectives page exactly (same PMT-based declining-balance formula) so
  // that when a property has no explicit `outstanding` saved, this snapshot
  // computes the same figure calcMortgageForPerson() would, instead of
  // falling back to the raw initialLoanAmount (which used to silently
  // overstate the balance for any loan that had been running a while).
  function calcAmortizedBalanceLocal(initialLoan: number, annualRatePct: number, tenureYears: number, startMmYyyy: string): number {
    if (!initialLoan || !tenureYears) return 0
    const parts = String(startMmYyyy || '').split('/')
    if (parts.length !== 2) return initialLoan
    const startDate = new Date(parseInt(parts[1]), parseInt(parts[0]) - 1, 1)
    const today = new Date()
    const monthsElapsed = (today.getFullYear() - startDate.getFullYear()) * 12 + (today.getMonth() - startDate.getMonth())
    if (monthsElapsed <= 0) return initialLoan
    const n = tenureYears * 12
    if (monthsElapsed >= n) return 0
    if (!annualRatePct) return Math.round(initialLoan * (1 - monthsElapsed / n))
    const r = annualRatePct / 100 / 12
    const pmt = initialLoan * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
    return Math.max(0, Math.round(initialLoan * Math.pow(1 + r, monthsElapsed) - pmt * (Math.pow(1 + r, monthsElapsed) - 1) / r))
  }

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
    const outstanding = Number(
      pr.outstanding ?? calcAmortizedBalanceLocal(initialLoan, Number(pr.interestRate || 0), initialTenure, String(pr.loanStartDate || ''))
    )
    return { outstanding, rate, tenure: Number(remainingTenure) || 0 }
  }

  function mortBalanceAtAge(atAge: number, currentAge: number, properties: any[]): number {
    const resolved = (properties || []).map(resolveMortgageFields).filter((m): m is { outstanding: number; rate: number; tenure: number } => m !== null)
    return resolved.reduce((total: number, m) => {
      const { outstanding, rate, tenure } = m
      if (outstanding <= 0 || tenure <= 0) return total
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

  // CI's mortgage component — instalments due during the recovery window
  // only, not the full outstanding balance. Mirrors ProtectionOverview.tsx's
  // identical fix exactly (same live-page bug existed here too): using the
  // full balance made CI's need decline smoothly for years in a way
  // unrelated to when the mortgage is actually paid off, instead of the
  // flat-then-drop character the rest of the CI curve has.
  function mortInstalmentsAtAge(atAge: number, currentAge: number, properties: any[], windowYears: number): number {
    const resolved = (properties || []).map(resolveMortgageFields).filter((m): m is { outstanding: number; rate: number; tenure: number } => m !== null)
    return resolved.reduce((total: number, m) => {
      const { outstanding, rate, tenure } = m
      if (outstanding <= 0 || tenure <= 0) return total
      const yearsElapsed = atAge - currentAge
      const yearsLeftFull = Math.max(0, tenure - yearsElapsed)
      const yearsLeft = Math.min(windowYears, yearsLeftFull)
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

  // CI "have" at a given age — mirrors getCIHaveAtAge() on the live page.
  function getCIHaveAtAge(age: number, who: 'client' | 'spouse', currentAge: number): number {
    return policies
      .filter((pol: any) => ACTIVE_STATUSES.includes(pol.status) && pol.person === who && pol.categoryCode === 'life')
      .reduce((sum: number, pol: any) => {
        if (!policyActiveAtAge(pol, age, currentAge)) return sum
        const mult = effectiveMultiplierAtAge(pol, age)
        const toSGD = (v: number) => (pol.isUSD ? v * (pol.fxRate || 1.35) : v)
        const advCI = toSGD((pol.baseAdvCI || 0) * mult)
        const earlyCI = toSGD((pol.baseEarlyCI || 0) * mult)
        return sum + Math.max(advCI, earlyCI)
      }, 0)
  }

  // Floor — delegates to the shared getCIFloor() (src/lib/protectionSnapshot.ts),
  // which is also what the live Protection page and Objectives page's floor
  // settings use. This used to be its own third copy of the floor math with
  // no way to configure it — now there's exactly one implementation.
  function getFloor(who: 'client' | 'spouse', currentAge: number): number {
    const annExp = who === 'client' ? annExpClient : annExpSpouse
    return getCIFloor(ff, p, who, currentAge, inflation, annExp).result
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
    const resolved: { outstanding: number; rate: number; tenure: number }[] = (ff.properties || [])
      .map((pr: any) => resolveMortgageFields(pr))
      .filter((m: { outstanding: number; rate: number; tenure: number } | null): m is { outstanding: number; rate: number; tenure: number } => m !== null && m.outstanding > 0)
    if (resolved.length === 0) return null
    const maxTenure = Math.max(...resolved.map((m: { outstanding: number; rate: number; tenure: number }) => m.tenure))
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

  // CI sibling of buildDTPDTimeline() above — same porting approach, mirroring
  // getCINeedAtAge()/getCIHaveAtAge() on the live Risk Management page, anchored
  // to the net CI figure buildCI() already computed so the curve stays
  // consistent with the saved Strategic Objectives value. The CI "need" curve
  // uses a rolling ciYears-window income-replacement annuity instead of D/TPD's
  // full-coverage-term annuity — same difference the live chart's
  // getCINeedAtAge() has from getDTPDNeedAtAge().
  //
  // Deliberately NOT mirroring the live page's `rawCI <= personFloor ? personFloor
  // : Math.max(personFloor, rawCI * ciScale)` here. That compares the *unscaled*
  // raw value against the *absolute* floor before the scale factor is applied —
  // dimensionally inconsistent, and confirmed (via a standalone test harness
  // run against Au Chi Hoi's real children/mortgage/life-expectancy figures) to
  // cause the curve to collapse straight to the floor the moment the first
  // child's education milestone hits, silently swallowing every milestone
  // after it whenever the scale factor drifts from 1 — which is most of the
  // time, since the scale factor exists specifically to reconcile this formula
  // with whatever was actually saved on Strategic Objectives. Using D/TPD's
  // simpler, scale-first `Math.max(floor, raw * scale)` produces the correct
  // multi-step curve instead.
  function buildCITimeline(who: 'client' | 'spouse', currentAgeOrNull: number | null, netOfAssetsAtCurrent: number): CoverageTimeline {
    if (currentAgeOrNull === null) return { points: [], milestones: [] }
    const currentAge: number = currentAgeOrNull

    const annExp = who === 'client' ? annExpClient : annExpSpouse
    const ciWindow = Number(p.ciYears) || 5
    const uniMeta = uniMilestonesForAge(currentAge)

    function rawNeedAtAge(age: number): number {
      const yLeft = Math.max(0, (currentAge + coverageTerm) - age)
      const fdYears = Math.min(ciWindow, yLeft)
      const ageFD = fvAnnuity(annExp, inflation, fdYears)
      // Windowed to the recovery period only — see mortInstalmentsAtAge.
      const ageMort = mortInstalmentsAtAge(age, currentAge, ff.properties || [], ciWindow)
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
      const raw = rawNeedAtAge(age)
      const need = Math.max(floor, raw * scale)
      const have = getCIHaveAtAge(age, who, currentAge)
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

  // Full (100%, unmitigated) mortgage/debt and education totals — the whole
  // family's exposure, not any one person's chosen share of it. Computed
  // once, reused for both the client's and spouse's runway card.
  //
  // Mortgage: sums resolveMortgageFields().outstanding across every property
  // at its true balance (ignores mortgageCoverPcts, which is a coverage
  // election, not part of the actual debt) + every non-mortgage debt at its
  // full amount (ignores the owner-based joint/50% split used for
  // calcMortgageForPerson's chosen figure — from the family's perspective
  // the whole debt needs to be cleared regardless of whose name it's under).
  const fullNeedMortTotal = (() => {
    const props = ff.properties ?? []
    const mortOutstanding = props.reduce((sum: number, pr: any) => {
      const resolved = resolveMortgageFields(pr)
      return sum + (resolved ? resolved.outstanding : 0)
    }, 0)
    const debtTotal = (p.nonMortgageDebts ?? []).reduce((sum: number, d: any) => sum + (Number(d.amount) || 0), 0)
    return mortOutstanding + debtTotal
  })()

  // Education: sums perChildFund (already the 100% tuition+living figure
  // per child, computed above with no coverPct applied) across every child
  // with education provided.
  const fullNeedEduTotal = provideEduFund
    ? Object.values(perChildFund).reduce((sum, v) => sum + v, 0)
    : 0

  // Family Financial Runway — three capital figures, each broken into its
  // family-dependency / mortgage / education components: the objective 100%
  // family need (independent of any coverage election), what this person
  // has actually chosen to cover (dtpd.familyDependency/.mortgageDebtClearance/
  // .tertiaryFunding — already election-aware), and what's currently in
  // place to fund it (existing life cover + the asset offset, if switched on).
  //
  // dtpd.assetMitigation is normally already 0 when the toggle is off
  // (getAssetOffset on Strategic Objectives returns 0 in that case before
  // it's ever saved as p1/p2_dtpd_assets) — but that only holds if the
  // objectives page was re-saved after the toggle was last changed. Rather
  // than trust the frozen saved figure, gate on the live assetOffsetEnabled
  // flag here too, the same convention used elsewhere (masterEnabled on
  // Strategic Objectives' Asset Offset tab).
  function buildRunway(who: 'client' | 'spouse', dtpd: PersonProtectionBreakdown): FamilyRunway {
    const fullNeedFD = Math.max(0, Math.round(fv(inflation, coverageTerm, annExpTotal)))
    const fullNeedMort = Math.max(0, Math.round(fullNeedMortTotal))
    const fullNeedEdu = Math.max(0, Math.round(fullNeedEduTotal))
    const fullNeed = fullNeedFD + fullNeedMort + fullNeedEdu

    const targetFD = dtpd.familyDependency
    const targetMort = dtpd.mortgageDebtClearance
    const targetEdu = dtpd.tertiaryFunding
    const targetNeed = targetFD + targetMort + targetEdu

    const assetOffsetEnabled = p.assetOffsetEnabled !== false
    const currentInsurance = dtpd.existingCoverage
    const currentAssets = assetOffsetEnabled ? dtpd.assetMitigation : 0
    const currentProvision = currentInsurance + currentAssets

    return {
      fullNeed, fullNeedFD, fullNeedMort, fullNeedEdu,
      targetNeed, targetFD, targetMort, targetEdu,
      currentProvision, currentInsurance, currentAssets,
      assetOffsetEnabled,
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
    // Same recovery-window fallback used on Strategic Objectives > Critical Illness
    // when maxCapitalRequired was originally calculated (see ciWindow above).
    const ciYears = Number(p.ciYears) || 5

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
      ciYears,
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
    const ci = buildCI(who)
    const currentAge = who === 'client' ? clientAge : spouseAge
    const netOfAssetsDTPD = Math.max(0, dtpd.maxCapitalRequired - dtpd.assetMitigation)
    const netOfAssetsCI = Math.max(0, ci.maxCapitalRequired - ci.assetMitigation)
    return {
      dtpd,
      ci,
      framework: buildFramework(who),
      lifePolicies: buildLifePolicies(policies, who),
      runway: buildRunway(who, dtpd),
      dtpdTimeline: buildDTPDTimeline(who, currentAge, netOfAssetsDTPD),
      ciTimeline: buildCITimeline(who, currentAge, netOfAssetsCI),
    }
  }

  return {
    client: buildPerson('client'),
    spouse: isCouple ? buildPerson('spouse') : null,
  }
}