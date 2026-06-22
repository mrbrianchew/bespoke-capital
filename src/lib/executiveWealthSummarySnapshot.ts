import { getCpfEmpRate, CPF_OW_CEILING, amortisedOutstanding, ageYearOnly } from './calc'

export interface EWSLineItem {
  label: string
  sublabel?: string
  value: number
}

export interface ExecutiveWealthSummarySnapshot {
  client: { name: string }
  spouse: { name: string } | null
  netWorth: number
  takeaway: string
  assetBreakdown: EWSLineItem[]
  totalAssets: number
  liabilities: EWSLineItem[]
  totalLiabilities: number
  perPersonInflow: { name: string; takeHome: number }[]
  totalInflow: number
  expenseBreakdown: EWSLineItem[]
  totalOutflow: number
  annualSurplus: number
  generatedAt: string
}

// Net-worth tier captions — confirmed by Brian. Auto-selected by total net worth,
// not by asset mix (intentionally simpler than category-driven phrasing).
const NET_WORTH_TIERS: { max: number; caption: string }[] = [
  { max: 500_000, caption: 'A foundation in its early stages, with room to build.' },
  { max: 1_000_000, caption: 'A solid foundation, positioned for continued growth.' },
  { max: 2_500_000, caption: 'A robust foundation, well-diversified across asset classes.' },
  { max: 5_000_000, caption: 'A substantial foundation, reflecting disciplined wealth accumulation.' },
  { max: Infinity, caption: "An exceptional foundation, placing the household among Singapore's high-net-worth segment." },
]

function takeawayForNetWorth(netWorth: number): string {
  return (NET_WORTH_TIERS.find(t => netWorth <= t.max) ?? NET_WORTH_TIERS[NET_WORTH_TIERS.length - 1]).caption
}

// Same detailed/simple expense-mode handling as financialPlanSnapshot.ts's OverviewSnapshot,
// duplicated here deliberately rather than imported/shared — keeps this page isolated from
// any changes made to the confirmed-working Overview snapshot.
const DETAILED_KEYS_BY_CAT: Record<string, { keys: string[]; keys2: string[]; customKey: string }> = {
  financial: { keys: ['d_vehicle_repay', 'd_personal_loan_repay', 'd_rental_expense', 'd_income_tax'], keys2: ['d2_vehicle_repay', 'd2_personal_loan_repay', 'd2_rental_expense', 'd2_income_tax'], customKey: 'd_custom_financial' },
  insurance: { keys: ['d_insurance'], keys2: ['d2_insurance'], customKey: '' },
  savings: { keys: ['d_regular_savings'], keys2: ['d2_regular_savings'], customKey: '' },
  cpf_oa: { keys: ['d_mortgage_cpf'], keys2: ['d2_mortgage_cpf'], customKey: 'd_custom_financial' },
  mortgage: { keys: ['d_mortgage_cash'], keys2: ['d2_mortgage_cash'], customKey: 'd_custom_financial' },
  household: { keys: ['d_conservancy', 'd_utilities', 'd_family_food', 'd_maid', 'd_other_household'], keys2: ['d2_conservancy', 'd2_utilities', 'd2_family_food', 'd2_maid', 'd2_other_household'], customKey: 'd_custom_household' },
  personal: { keys: ['d_personal_food', 'd_transport', 'd_car_petrol', 'd_car_insurance'], keys2: ['d2_personal_food', 'd2_transport', 'd2_car_petrol', 'd2_car_insurance'], customKey: 'd_custom_personal' },
  children: { keys: ['d_childcare', 'd_school_fees', 'd_school_transport', 'd_allowance_children', 'd_other_children'], keys2: ['d2_childcare', 'd2_school_fees', 'd2_school_transport', 'd2_allowance_children', 'd2_other_children'], customKey: 'd_custom_children' },
  lifestyle: { keys: ['d_holidays', 'd_hobbies', 'd_allowance_parents', 'd_others_lifestyle'], keys2: ['d2_holidays', 'd2_hobbies', 'd2_allowance_parents', 'd2_others_lifestyle'], customKey: 'd_custom_lifestyle' },
}

const SIMPLE_KEYS_BY_CAT: Record<string, { key: string; key2: string }> = {
  financial: { key: 's_financial', key2: 's2_financial' },
  cpf_oa: { key: 's_cpf_oa', key2: 's2_cpf_oa' },
  mortgage: { key: 's_mortgage', key2: 's2_mortgage' },
  household: { key: 's_household', key2: 's2_household' },
  personal: { key: 's_personal', key2: 's2_personal' },
  children: { key: 's_children', key2: 's2_children' },
  lifestyle: { key: 's_lifestyle', key2: 's2_lifestyle' },
}

export function buildExecutiveWealthSummarySnapshot(input: {
  client: { name: string; dob: string }
  familyMembers: { name: string; relationship: string; dob?: string }[]
  fin: Record<string, any>
  estateData: Record<string, any>
}): ExecutiveWealthSummarySnapshot {
  const { client, familyMembers, fin, estateData } = input

  const spouseMember = familyMembers.find(f => f.relationship === 'Spouse') || null
  const isCouple = !!spouseMember
  const clientAge = ageYearOnly(client.dob)
  const spouseAge = spouseMember?.dob ? ageYearOnly(spouseMember.dob) : 0

  // ── ASSETS ──────────────────────────────────────────────────────────────
  const cashReserves = (fin.a_savings ?? 0) + (fin.a_fixed_deposit ?? 0) +
    (isCouple ? (fin.a2_savings ?? 0) + (fin.a2_fixed_deposit ?? 0) : 0)

  const cpfOA = (fin.a_cpf_oa ?? 0) + (isCouple ? (fin.a2_cpf_oa ?? 0) : 0)
  const cpfSA = (fin.a_cpf_sa ?? 0) + (isCouple ? (fin.a2_cpf_sa ?? 0) : 0)
  const cpfRA = (fin.a_cpf_ra ?? 0) + (isCouple ? (fin.a2_cpf_ra ?? 0) : 0)
  const cpfMA = (fin.a_cpf_ma ?? 0) + (isCouple ? (fin.a2_cpf_ma ?? 0) : 0)
  const cpfSAorRA = cpfSA + cpfRA
  // SA and RA are mutually exclusive by age (SA converts to RA at 55) — combined into
  // one line. Label follows whichever is actually populated; "SA / RA" if genuinely mixed
  // (e.g. couple straddling 55), defaults to "SA" if both are zero.
  const cpfSAorRALabel = cpfRA > 0 && cpfSA === 0 ? 'CPF RA Savings' : cpfRA > 0 && cpfSA > 0 ? 'CPF SA / RA Savings' : 'CPF SA Savings'

  const investedCustom = ((fin.a_invested_custom as any[]) ?? []).reduce((s: number, i: any) => s + (i.amount ?? 0) + (isCouple ? (i.amount2 ?? 0) : 0), 0)
  // Bonds folded in here per Brian's confirmation — no standalone Bonds line.
  const investments = (fin.a_srs ?? 0) + (fin.a_shares ?? 0) + (fin.a_etf ?? 0) + (fin.a_bonds ?? 0) + investedCustom +
    (isCouple ? (fin.a2_srs ?? 0) + (fin.a2_shares ?? 0) + (fin.a2_etf ?? 0) + (fin.a2_bonds ?? 0) : 0)

  const managedFunds = (fin.a_unit_trust ?? 0) + (isCouple ? (fin.a2_unit_trust ?? 0) : 0)

  const properties = (fin.properties ?? []) as any[]
  const realEstateGross = properties.reduce((s: number, p: any) => s + (p.propertyValue ?? p.purchasePrice ?? 0), 0)
  const mortgageOutstanding = properties.reduce((s: number, p: any) => s + amortisedOutstanding(p), 0)

  const alternativeInvestments = (fin.a_alternatives ?? 0) + (isCouple ? (fin.a2_alternatives ?? 0) : 0)
  const businessVentures = (fin.a_business ?? 0) + (isCouple ? (fin.a2_business ?? 0) : 0)

  const personalUseCustom = ((fin.a_personal_custom as any[]) ?? []).reduce((s: number, i: any) => s + (i.amount ?? 0) + (isCouple ? (i.amount2 ?? 0) : 0), 0)
  const personalUseAssets = (fin.a_vehicles ?? 0) + (fin.a_club ?? 0) + personalUseCustom +
    (isCouple ? (fin.a2_vehicles ?? 0) + (fin.a2_club ?? 0) : 0)

  const totalAssets = cashReserves + cpfOA + cpfSAorRA + cpfMA + investments + managedFunds +
    realEstateGross + alternativeInvestments + businessVentures + personalUseAssets

  // ── LIABILITIES (Financials-tab fields, per Brian's confirmation) ────────
  const stCustom = ((fin.l_st_custom as any[]) ?? []).reduce((s: number, i: any) => s + (i.amount ?? 0) + (isCouple ? (i.amount2 ?? 0) : 0), 0)
  const ltCustom = ((fin.l_lt_custom as any[]) ?? []).reduce((s: number, i: any) => s + (i.amount ?? 0) + (isCouple ? (i.amount2 ?? 0) : 0), 0)

  const carLoan = (fin.l_car_loan ?? 0) + (isCouple ? (fin.l2_car_loan ?? 0) : 0)
  const shortTermDebts = (fin.l_credit_card ?? 0) + (fin.l_business_loan ?? 0) + (fin.l_renovation_st ?? 0) + stCustom +
    (isCouple ? (fin.l2_credit_card ?? 0) + (fin.l2_business_loan ?? 0) + (fin.l2_renovation_st ?? 0) : 0)
  // Car/Motor Loan broken out on its own line — excluded here even though it's
  // normally bucketed with long-term debts on the Financials tab itself.
  const longTermDebts = (fin.l_study_loan ?? 0) + (fin.l_personal_loan ?? 0) + (fin.l_renovation_lt ?? 0) + ltCustom +
    (isCouple ? (fin.l2_study_loan ?? 0) + (fin.l2_personal_loan ?? 0) + (fin.l2_renovation_lt ?? 0) : 0)

  const totalLiabilities = mortgageOutstanding + carLoan + shortTermDebts + longTermDebts

  // Net worth priority logic mirrors Overview's: saved estate.netEstate wins if present.
  const savedNetEstate = estateData?.netEstate
  const netWorth = (typeof savedNetEstate === 'number' && savedNetEstate > 0)
    ? savedNetEstate
    : Math.max(0, totalAssets - totalLiabilities)

  // ── CASHFLOW ──────────────────────────────────────────────────────────────
  const p1 = fin.person1 ?? {}
  const p2 = isCouple ? (fin.person2 ?? {}) : {}
  const p1Gross = p1.gross_monthly ?? 0
  const p1Bonus = p1.gross_bonus ?? 0
  const p1Cit = p1.citizenship ?? 'SC'
  const p1PrYear = p1.pr_year ?? '3+'
  const p2Gross = isCouple ? (p2.gross_monthly ?? 0) : 0
  const p2Bonus = isCouple ? (p2.gross_bonus ?? 0) : 0
  const p2Cit = isCouple ? (p2.citizenship ?? 'SC') : 'SC'
  const p2PrYear = isCouple ? (p2.pr_year ?? '3+') : '3+'

  const p1EmpRate = getCpfEmpRate(clientAge, p1Cit, p1PrYear) / 100
  const p1MonthlyCpf = Math.floor(Math.min(p1Gross, CPF_OW_CEILING) * p1EmpRate)
  const p1BonusCpf = Math.floor(p1Bonus * p1EmpRate)
  const p1TakeHome = (p1Gross - p1MonthlyCpf) * 12 + (p1Bonus - p1BonusCpf)

  const p2EmpRate = isCouple ? getCpfEmpRate(spouseAge, p2Cit, p2PrYear) / 100 : 0
  const p2MonthlyCpf = isCouple ? Math.floor(Math.min(p2Gross, CPF_OW_CEILING) * p2EmpRate) : 0
  const p2BonusCpf = isCouple ? Math.floor(p2Bonus * p2EmpRate) : 0
  const p2TakeHome = isCouple ? (p2Gross - p2MonthlyCpf) * 12 + (p2Bonus - p2BonusCpf) : 0

  const totalInflow = p1TakeHome + p2TakeHome

  const expMode = fin.expense_mode ?? 'simple'

  function detailedSum(keys: string[], customKey: string, isSpouse: boolean): number {
    const std = keys.reduce((s, k) => s + ((fin[k] as number) ?? 0), 0)
    if (!customKey) return std
    const custom = ((fin[customKey] as any[]) ?? []).reduce((s, i) => s + ((isSpouse ? i.amount2 : i.amount) ?? 0), 0)
    return std + custom
  }

  function catTotal(catId: string): number {
    const simple = SIMPLE_KEYS_BY_CAT[catId]
    const detailed = DETAILED_KEYS_BY_CAT[catId]
    let p1Total: number
    let p2Total = 0
    if (expMode === 'detailed' && detailed.keys.length > 0) {
      p1Total = detailedSum(detailed.keys, detailed.customKey, false)
    } else if (simple) {
      p1Total = (fin[simple.key] as number) ?? 0
    } else {
      p1Total = 0
    }
    if (isCouple) {
      if (expMode === 'detailed' && detailed.keys2.length > 0) {
        p2Total = detailedSum(detailed.keys2, detailed.customKey, true)
      } else if (simple) {
        p2Total = (fin[simple.key2] as number) ?? 0
      } else {
        p2Total = 0
      }
    }
    return p1Total + p2Total
  }

  const financialObligations = catTotal('financial')
  const insuranceExpense = catTotal('insurance')
  const savingsExpense = catTotal('savings')
  const mortgageCashOnly = catTotal('mortgage')
  const mortgageCpfOa = catTotal('cpf_oa')
  const mortgageDisplay = mortgageCashOnly + mortgageCpfOa
  const householdExpense = catTotal('household')
  const personalExpense = catTotal('personal')
  const childrenExpense = catTotal('children')
  const lifestyleExpense = catTotal('lifestyle')

  // Total Outflow is cash-only — CPF-OA mortgage is excluded since it's paid from CPF,
  // not cash (matches annualSurplus logic elsewhere in the app). The displayed
  // "Mortgage Repayments" line below still shows the full cash+CPF amount for transparency.
  const totalOutflow = financialObligations + insuranceExpense + savingsExpense + mortgageCashOnly +
    householdExpense + personalExpense + childrenExpense + lifestyleExpense

  const annualSurplus = totalInflow - totalOutflow

  return {
    client: { name: client.name },
    spouse: isCouple ? { name: spouseMember!.name } : null,
    netWorth: Math.round(netWorth),
    takeaway: takeawayForNetWorth(netWorth),
    assetBreakdown: [
      { label: 'Cash & Liquid Equivalents', sublabel: 'Savings/Fixed Deposits', value: Math.round(cashReserves) },
      { label: 'CPF OA Savings', value: Math.round(cpfOA) },
      { label: cpfSAorRALabel, value: Math.round(cpfSAorRA) },
      { label: 'CPF MA Savings', value: Math.round(cpfMA) },
      { label: 'Investments', sublabel: 'SRS, Shares, ETFs', value: Math.round(investments) },
      { label: 'Managed Funds', sublabel: 'Unit Trust/ILPs', value: Math.round(managedFunds) },
      { label: 'Real Estate', sublabel: 'Residential & Commercial', value: Math.round(realEstateGross) },
      { label: 'Alternative Investments', value: Math.round(alternativeInvestments) },
      { label: 'Business Venture(s)', value: Math.round(businessVentures) },
      { label: 'Personal Use Asset(s)', sublabel: 'Residential, Motor, Club etc', value: Math.round(personalUseAssets) },
    ],
    totalAssets: Math.round(totalAssets),
    liabilities: [
      { label: 'Residential Mortgage', value: Math.round(mortgageOutstanding) },
      { label: 'Car/Motor Loan', value: Math.round(carLoan) },
      { label: 'Short Term Debts', sublabel: 'Credit Card, Renovation, Business', value: Math.round(shortTermDebts) },
      { label: 'Long Term Debts', sublabel: 'Study, Personal, Renovation', value: Math.round(longTermDebts) },
    ],
    totalLiabilities: Math.round(totalLiabilities),
    perPersonInflow: [
      { name: client.name, takeHome: Math.round(p1TakeHome) },
      ...(isCouple ? [{ name: spouseMember!.name, takeHome: Math.round(p2TakeHome) }] : []),
    ],
    totalInflow: Math.round(totalInflow),
    expenseBreakdown: [
      { label: 'Financial Obligations', value: Math.round(financialObligations) },
      { label: 'Mortgage Repayments', value: Math.round(mortgageDisplay) },
      { label: 'Household & Living', value: Math.round(householdExpense) },
      { label: 'Personal Expenses', value: Math.round(personalExpense) },
      { label: 'Children Expenses', value: Math.round(childrenExpense) },
      { label: 'Lifestyle Expenses', value: Math.round(lifestyleExpense) },
      { label: 'Insurance Payments', value: Math.round(insuranceExpense) },
      { label: 'Savings & Investments', value: Math.round(savingsExpense) },
    ],
    totalOutflow: Math.round(totalOutflow),
    annualSurplus: Math.round(annualSurplus),
    generatedAt: new Date().toISOString(),
  }
}
