import { ageYearOnly, fv } from './calc'
import { buildOverviewSnapshot } from './financialPlanSnapshot'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface CapitalFundObjective {
  id: string
  label: string
  purpose: string
  amount: number
  accentColor: 'gold' | 'emerald'
}

export interface CapitalFundChartPoint {
  age: number
  value: number
}

// Full lifecycle chart series, persisted by the live Capital Mandate tool
// (investments/page.tsx) at save time and read here as-is — this report
// never re-derives the accumulation/drawdown/survivor-timing engine itself,
// so the report and the live tool can't disagree on what the chart shows.
export interface CapitalFundFullSeries {
  ages: number[]
  requiredLine: number[]
  projectedLine: number[]
  legacyLine: (number | null)[] | null
  milestones: { age: number; label: string; amount: number }[]
  retireIdx: number
  retirementAge: number
  finalDeathAge: number
  goldAnnualBase: number
  guaranteedMonthlyRetirement: number
  planMode: 'couple' | 'individual'
  clientAge: number
  spouseAge: number
}

export interface CapitalFundVehicle {
  platform: string
  monthlyContribution: number
  currentValue: number
  startDateDisplay: string
  isRegular: boolean
}

export interface CapitalFundSnapshot {
  currentAge: number
  retirementAge: number
  expectedReturn: number
  inflationRate: number
  yearsToRetirement: number

  heroAnnualIncomeTarget: number

  chart: {
    target: CapitalFundChartPoint[]
    projection: CapitalFundChartPoint[]
    realReturns: CapitalFundChartPoint[]
  }
  fullChartSeries: CapitalFundFullSeries | null

  objectives: CapitalFundObjective[]
  totalCapitalRequired: number

  assetAllocation: { label: string; value: number; pct: number }[]
  illiquidPct: number

  vehicles: CapitalFundVehicle[]
  assetGrowthRatePct: number | null

  capacityAudit: {
    currentInvestmentAnnual: number
    availableCashflowAnnual: number
    requiredAnnual: number
    investedShareOfCapacityPct: number
    capacityBeyondMandate: number
  }

  shortfall: number
  strategy: {
    pureMonthlyAnnual: number
    pureLumpSum: number
    lumpSumFraction: number
  } | null

  generatedAt: string
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// Same annuity-due "monthly payment to reach a target corpus" formula used by
// the live Capital Mandate tool (calcMonthlyRequired in investments/page.tsx).
// Kept local/self-contained rather than imported — that tool is a page
// component, not a lib export, and this is the only place outside it that
// needs the formula.
function monthlyRequiredFor(corpus: number, yearsLeft: number, annualReturnPct: number): number {
  if (corpus <= 0 || yearsLeft <= 0) return 0
  const r = annualReturnPct / 100
  const rm = r / 12
  const nm = yearsLeft * 12
  return rm > 0 ? (corpus * rm) / ((Math.pow(1 + rm, nm) - 1) * (1 + rm)) : corpus / nm
}

function formatStartDate(p: any): string {
  if (p.startMonth) {
    const [yr, mo] = String(p.startMonth).split('-').map(Number)
    if (yr && mo) return new Date(yr, mo - 1, 1).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  if (p.startYear) return `Jan ${p.startYear}`
  return '—'
}

// ─── BUILDER ─────────────────────────────────────────────────────────────────

export function buildCapitalFundSnapshot(input: {
  client: { name: string; dob: string }
  familyMembers: { id: string; name: string; relationship: string; dob?: string }[]
  fin: Record<string, any>
  retData: Record<string, any>
  accData: Record<string, any>
  eduData: Record<string, any>
  cmData: Record<string, any>
}): CapitalFundSnapshot {
  const { client, familyMembers, fin, retData, accData, eduData, cmData } = input

  const clientAge = ageYearOnly(client.dob)
  const isCouple = familyMembers.some(f => f.relationship === 'Spouse')
  const children = familyMembers.filter(f => ['Son', 'Daughter', 'Child'].includes(f.relationship))

  // ── Retirement assumptions (mirrors investments/page.tsx load()) ─────────
  const retNested = retData?.ret || retData || {}
  const retClientData = retNested?.client || {}
  const retExpSel = retNested?.expenseSelections || {}
  const retirementAge = retClientData?.retirementAge || retData?.retirementAge || 65
  const inflationRate = retNested?.inflationRate ?? retNested?.assumptions?.inflation ?? retData?.inflation ?? 3
  const desiredMonthlyIncome = isCouple
    ? (retExpSel?.combinedDesiredMonthly || retClientData?.desiredMonthlyIncome || 0)
    : (retClientData?.desiredMonthlyIncome || 0)
  const desiredAnnualHolidays = isCouple
    ? (retExpSel?.combinedDesiredHolidays || retClientData?.desiredAnnualHolidays || 0)
    : (retClientData?.desiredAnnualHolidays || 0)
  const currentExpenses = fin?.client?.monthlyExpenses || fin?.client?.expenses || 0

  // ── Capital Mandate settings + portfolio (capital_mandate section) ───────
  const settings = cmData?.settings || { expectedReturn: 6, legacyAmount: 0, incomeSource: 'desired' }
  const expectedReturn = settings.expectedReturn ?? 6
  const portfolio: any[] = cmData?.portfolio || []

  // Full lifecycle chart series — persisted by the live tool, read as-is.
  const fullChartSeries: CapitalFundFullSeries | null = cmData?.chartSeries || null

  // incomeSource: 'desired' uses the Retirement tab's target; 'current' falls
  // back to today's expenses. A third, deeper fallback exists in the live
  // tool (deriving from the Retirement page's own withdrawal model) that
  // isn't replicated here — if neither desired income nor current expenses
  // are on file, this returns 0 rather than guessing at that chain.
  const effectiveRetirementIncome = settings.incomeSource === 'desired' && desiredMonthlyIncome > 0
    ? desiredMonthlyIncome
    : currentExpenses
  const effectiveAnnualHolidays = settings.incomeSource === 'desired' ? desiredAnnualHolidays : 0

  const yearsToRetirement = Math.max(0, retirementAge - clientAge)
  const inflFactor = Math.pow(1 + inflationRate / 100, yearsToRetirement)
  const heroAnnualIncomeTarget = effectiveRetirementIncome * inflFactor * 12 + effectiveAnnualHolidays * inflFactor

  // ── Funding objectives: retirement + education + wealth goals ────────────
  const objectives: CapitalFundObjective[] = []

  // Retirement corpus — same growing-annuity-due PV used by the Retirement
  // tab; read here from the saved 'retirement' section rather than
  // recalculated independently (consistent with how Protection's DTPD/CI
  // figures are read, not re-derived, elsewhere in this app).
  const retirementCorpus = retData?.corpusNeeded || 0
  if (retirementCorpus > 0) {
    objectives.push({
      id: 'retirement',
      label: isCouple ? `${client.name} & Spouse — Retirement` : `${client.name} — Retirement`,
      purpose: `So the years after ${retirementAge} are chosen, not constrained.`,
      amount: Math.round(retirementCorpus),
      accentColor: 'gold',
    })
  }

  // Education goals — DOB-derived child ages, matching the live tool's
  // pattern (never the stale stored `age` column).
  const edu = eduData?.edu || eduData || {}
  const eduTuitionInf = (edu?.tuitionInflation ?? 5) / 100
  const eduLivingInf = (edu?.livingInflation ?? 3) / 100
  const eduReturnRate = edu?.returnRate ?? expectedReturn
  ;(edu?.children || []).forEach((child: any) => {
    const childId = child.childId || child.id
    const liveChild = children.find(c => c.id === childId)
    if (childId && !liveChild) return
    if (!child.name) return
    const liveAge = liveChild?.dob ? ageYearOnly(liveChild.dob) : (child.age || 0)
    const yearsUntilUni = Math.max(1, (child.uniEntryAge || 18) - liveAge)
    const duration = child.courseDuration || 4
    const fvTuition = (child.annualTuition || 0) * Math.pow(1 + eduTuitionInf, yearsUntilUni) * duration
    const fvLiving = (child.annualLiving || 0) * Math.pow(1 + eduLivingInf, yearsUntilUni) * duration
    const corpus = Math.max(0, fvTuition + fvLiving - (child.existingSavings || 0) * Math.pow(1 + eduReturnRate / 100, yearsUntilUni))
    if (!corpus) return
    const firstName = String(child.name).split(' ')[0]
    objectives.push({
      id: 'edu_' + (childId || child.name),
      label: `${child.name}'s Education`,
      purpose: `So ${firstName} starts university without a loan attached to it.`,
      amount: Math.round(corpus),
      accentColor: 'emerald',
    })
  })

  // Wealth / custom goals
  const acc = accData?.acc || accData || {}
  ;(acc?.goals || []).forEach((g: any) => {
    if (!g.targetAmount) return
    const yearsLeft = Math.max(1, g.yearsToGoal || 10)
    const corpus = g.amountType === 'pv' ? g.targetAmount * Math.pow(1 + inflationRate / 100, yearsLeft) : g.targetAmount
    objectives.push({
      id: 'wealth_' + g.id,
      label: g.label || 'Wealth Goal',
      purpose: 'Building toward this goal, on its own timeline.',
      amount: Math.round(corpus),
      accentColor: 'emerald',
    })
  })

  const totalCapitalRequired = objectives.reduce((s, o) => s + o.amount, 0)

  // ── Chart: target build-up, real portfolio projection, actual-to-date ────
  // Target line — FV of the monthly contribution required to reach the
  // retirement corpus exactly at retirementAge, sampled across the years
  // between today and retirement.
  const retMonthlyRequired = monthlyRequiredFor(retirementCorpus, yearsToRetirement, expectedReturn)
  const monthlyRate = expectedReturn / 100 / 12
  const target: CapitalFundChartPoint[] = []
  const projection: CapitalFundChartPoint[] = []
  const startingPortfolioValue = portfolio.reduce((s, p) => s + (p.currentValue || 0), 0)
  const totalMonthlyContribution = portfolio.reduce((s, p) => s + (p.mode === 'Lump Sum' ? 0 : (p.monthlyContribution || 0)), 0)
  for (let a = clientAge; a <= retirementAge; a++) {
    const months = (a - clientAge) * 12
    target.push({ age: a, value: Math.round(fv(monthlyRate, months, retMonthlyRequired)) })
    const projVal = startingPortfolioValue * Math.pow(1 + expectedReturn / 100, a - clientAge) + fv(monthlyRate, months, totalMonthlyContribution)
    projection.push({ age: a, value: Math.round(projVal) })
  }

  // "Real returns" — a simple cumulative actual-capital-deployed series from
  // each vehicle's own start date to today. This is a simplification: it's
  // money actually put in, not a true historical mark-to-market return — an
  // honest stand-in given we don't keep year-by-year valuation history per
  // vehicle. Flagged for Brian to confirm this reads the way he wants.
  const thisYear = new Date().getFullYear()
  const realReturns: CapitalFundChartPoint[] = []
  {
    let a = clientAge
    while (a <= retirementAge) {
      const yearCalendar = thisYear - (clientAge - a)
      if (yearCalendar > thisYear) break
      const deployed = portfolio.reduce((s, p) => {
        const startYr = p.startYear || yearCalendar
        if (yearCalendar < startYr) return s
        if (p.mode === 'Lump Sum') return s + (p.currentValue || 0)
        const monthsActive = Math.max(0, (yearCalendar - startYr) * 12 + 12)
        return s + monthsActive * (p.monthlyContribution || 0)
      }, 0)
      realReturns.push({ age: a, value: Math.round(deployed) })
      a++
    }
  }

  // ── Asset allocation + available cashflow — reuse Overview's existing,
  // already-consistent calc rather than re-deriving asset categorisation. ──
  const overview = buildOverviewSnapshot({ client, familyMembers, fin })
  const totalAssetsForPct = overview.assetBreakdown.reduce((s, a) => s + a.value, 0)
  const assetAllocation = overview.assetBreakdown.map(a => ({
    label: a.label,
    value: a.value,
    pct: totalAssetsForPct > 0 ? Math.round((a.value / totalAssetsForPct) * 100) : 0,
  }))
  const illiquidPct = assetAllocation
    .filter(a => a.label === 'Real Estate Portfolio' || a.label === 'CPF Statutory Balances')
    .reduce((s, a) => s + a.pct, 0)

  // ── Investment vehicles table + asset growth rate ─────────────────────────
  const vehicles: CapitalFundVehicle[] = portfolio.map((p: any) => ({
    platform: p.name || 'Unnamed Vehicle',
    monthlyContribution: p.mode === 'Lump Sum' ? 0 : (p.monthlyContribution || 0),
    currentValue: p.currentValue || 0,
    startDateDisplay: formatStartDate(p),
    isRegular: p.mode !== 'Lump Sum',
  }))

  // Asset Growth Rate reads the Capital Mandate tool's own persisted
  // portfolioXIRR — a proper value-weighted, cash-flow-based XIRR across the
  // whole portfolio — rather than computing a per-vehicle average here.
  // An unweighted average of independent per-vehicle IRRs gives a tiny,
  // short-tenure, volatile vehicle the same weight as a large, long-running
  // one, which produces a number that doesn't reflect the actual blended
  // portfolio performance at all.
  const assetGrowthRatePct: number | null = typeof cmData?.portfolioXIRR === 'number' && isFinite(cmData.portfolioXIRR)
    ? Math.round(cmData.portfolioXIRR * 10) / 10
    : null

  // ── Capacity audit ────────────────────────────────────────────────────────
  const currentInvestmentAnnual = Math.round(totalMonthlyContribution * 12)
  const availableCashflowAnnual = Math.max(0, Math.round(overview.annualSurplus))
  const identifiableCapacity = currentInvestmentAnnual + availableCashflowAnnual

  // ── Shortfall + strategy split — read the live tool's own persisted
  // solver output rather than re-deriving the underlying corpus PV engine
  // (CPF Life / annuity / rental / SRS handling, legacy adjustments, etc.)
  // a second time. ──
  const shortfall = Math.max(0, cmData?.retirementShortfall || 0)
  const shortfallSolution = cmData?.shortfallSolution || null
  const requiredAnnual = shortfallSolution ? Math.round((shortfallSolution.pureMonthly || 0) * 12) : 0
  const capacityBeyondMandate = identifiableCapacity - requiredAnnual

  return {
    currentAge: clientAge,
    retirementAge,
    expectedReturn,
    inflationRate,
    yearsToRetirement,

    heroAnnualIncomeTarget: Math.round(heroAnnualIncomeTarget),

    chart: { target, projection, realReturns },
    fullChartSeries,

    objectives,
    totalCapitalRequired,

    assetAllocation,
    illiquidPct,

    vehicles,
    assetGrowthRatePct,

    capacityAudit: {
      currentInvestmentAnnual,
      availableCashflowAnnual,
      requiredAnnual,
      investedShareOfCapacityPct: identifiableCapacity > 0 ? Math.round((currentInvestmentAnnual / identifiableCapacity) * 100) : 0,
      capacityBeyondMandate,
    },

    shortfall: Math.round(shortfall),
    strategy: shortfallSolution
      ? {
          pureMonthlyAnnual: Math.round((shortfallSolution.pureMonthly || 0) * 12),
          pureLumpSum: Math.round(shortfallSolution.pureLump || 0),
          lumpSumFraction: shortfallSolution.lumpSumFraction ?? 0,
        }
      : null,

    generatedAt: new Date().toISOString(),
  }
}
