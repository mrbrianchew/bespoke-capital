import { getCpfEmpRate, CPF_OW_CEILING, amortisedOutstanding, ageYearOnly } from './calc'

export interface OverviewSnapshot {
  client: { name: string; age: number }
  spouse: { name: string; age: number } | null
  dependents: { name: string; age: number }[]
  netWorth: number
  annualInflow: number
  annualSurplus: number
  assetBreakdown: { label: string; value: number }[]
  liabilities: { label: string; value: number }[]
  expenseBreakdown: { label: string; value: number }[]
  expenseBenchmark: { label: string; actualValue: number; actualPct: number; benchmarkPct: number }[]
  generatedAt: string
}

// Industry guideline percentages — confirmed by Brian, sums to 100%.
// Only meaningful against the full 8-category detailed breakdown.
const BENCHMARK_PCT: Record<string, number> = {
  'Financial Obligations': 12,
  Mortgage: 25,
  'Household & Living': 15,
  Personal: 7,
  Children: 8,
  Lifestyle: 5,
  Insurance: 8,
  Savings: 20,
}

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

export function buildOverviewSnapshot(input: {
  client: { name: string; dob: string }
  familyMembers: { name: string; relationship: string; dob?: string }[]
  fin: Record<string, any>
  estateData: Record<string, any>
  nonMortgageDebts: { amount?: number }[]
}): OverviewSnapshot {
  const { client, familyMembers, fin, estateData, nonMortgageDebts } = input

  const spouseMember = familyMembers.find(f => f.relationship === 'Spouse') || null
  const dependents = familyMembers.filter(f => ['Son', 'Daughter', 'Child'].includes(f.relationship))
  const isCouple = !!spouseMember

  const clientAge = ageYearOnly(client.dob)
  const spouseAge = spouseMember?.dob ? ageYearOnly(spouseMember.dob) : 0

  // ── ASSETS ──────────────────────────────────────────────────────────────
  const cashReserves = (fin.a_savings ?? 0) + (fin.a_fixed_deposit ?? 0) +
    (isCouple ? (fin.a2_savings ?? 0) + (fin.a2_fixed_deposit ?? 0) : 0)

  const cpfBalances = (fin.a_cpf_oa ?? 0) + (fin.a_cpf_sa ?? 0) + (fin.a_cpf_ma ?? 0) + (fin.a_cpf_ra ?? 0) +
    (isCouple ? (fin.a2_cpf_oa ?? 0) + (fin.a2_cpf_sa ?? 0) + (fin.a2_cpf_ma ?? 0) + (fin.a2_cpf_ra ?? 0) : 0)

  const investmentPortfolio = (fin.a_shares ?? 0) + (fin.a_etf ?? 0) + (fin.a_bonds ?? 0) + (fin.a_alternatives ?? 0) +
    ((fin.a_invested_custom as any[]) ?? []).reduce((s: number, i: any) => s + (i.amount ?? 0) + (isCouple ? (i.amount2 ?? 0) : 0), 0) +
    (isCouple ? (fin.a2_shares ?? 0) + (fin.a2_etf ?? 0) + (fin.a2_bonds ?? 0) + (fin.a2_alternatives ?? 0) : 0)

  const managedPortfolios = (fin.a_srs ?? 0) + (fin.a_unit_trust ?? 0) +
    (isCouple ? (fin.a2_srs ?? 0) + (fin.a2_unit_trust ?? 0) : 0)

  const properties = (fin.properties ?? []) as any[]
  const realEstateGross = properties.reduce((s: number, p: any) => s + (p.propertyValue ?? p.purchasePrice ?? 0), 0)
  const mortgageOutstanding = properties.reduce((s: number, p: any) => s + amortisedOutstanding(p), 0)

  const otherDebts = (nonMortgageDebts ?? []).reduce((s: number, d: any) => s + (d.amount ?? 0), 0)

  const totalAssets = cashReserves + cpfBalances + investmentPortfolio + managedPortfolios + realEstateGross
  const totalLiabilities = mortgageOutstanding + otherDebts

  const savedNetEstate = estateData?.netEstate
  const netWorth = (typeof savedNetEstate === 'number' && savedNetEstate > 0)
    ? savedNetEstate
    : Math.max(0, totalAssets - totalLiabilities)

  // ── INCOME ──────────────────────────────────────────────────────────────
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

  const annualInflow = (p1Gross * 12 + p1Bonus) + (isCouple ? (p2Gross * 12 + p2Bonus) : 0)

  const p1EmpRate = getCpfEmpRate(clientAge, p1Cit, p1PrYear) / 100
  const p1MonthlyCpf = Math.floor(Math.min(p1Gross, CPF_OW_CEILING) * p1EmpRate)
  const p1BonusCpf = Math.floor(p1Bonus * p1EmpRate)
  const p1TakeHome = (p1Gross - p1MonthlyCpf) * 12 + (p1Bonus - p1BonusCpf)

  const p2EmpRate = isCouple ? getCpfEmpRate(spouseAge, p2Cit, p2PrYear) / 100 : 0
  const p2MonthlyCpf = isCouple ? Math.floor(Math.min(p2Gross, CPF_OW_CEILING) * p2EmpRate) : 0
  const p2BonusCpf = isCouple ? Math.floor(p2Bonus * p2EmpRate) : 0
  const p2TakeHome = isCouple ? (p2Gross - p2MonthlyCpf) * 12 + (p2Bonus - p2BonusCpf) : 0

  const totalTakeHome = p1TakeHome + p2TakeHome

  // ── EXPENSES (real 6-category model, mode-aware, mortgage combined) ─────
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
      p1Total = 0 // no simple-mode equivalent exists for this category (e.g. insurance, savings)
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

  // CPF-OA mortgage is excluded from cash-relevant outflows — it's paid from CPF,
  // not cash, so it doesn't reduce deployable surplus. Matches the existing
  // dashboard logic exactly (annExpClient excludes s_cpf_oa for the same reason).
  // Insurance and savings are split out for display (detailed mode only) but
  // still count toward the same total as before — splitting doesn't change the sum.
  const totalExpenses = financialObligations + insuranceExpense + savingsExpense + mortgageCashOnly + householdExpense + personalExpense + childrenExpense + lifestyleExpense

  const annualSurplus = totalTakeHome - totalExpenses

  return {
    client: { name: client.name, age: clientAge },
    spouse: isCouple ? { name: spouseMember!.name, age: spouseAge } : null,
    dependents: dependents.map(d => ({ name: d.name, age: ageYearOnly(d.dob) })),
    netWorth: Math.round(netWorth),
    annualInflow: Math.round(annualInflow),
    annualSurplus: Math.round(annualSurplus),
    assetBreakdown: [
      { label: 'Cash Reserves', value: Math.round(cashReserves) },
      { label: 'CPF Statutory Balances', value: Math.round(cpfBalances) },
      { label: 'Investment Portfolio', value: Math.round(investmentPortfolio) },
      { label: 'Managed Investment Portfolios', value: Math.round(managedPortfolios) },
      { label: 'Real Estate Portfolio', value: Math.round(realEstateGross) },
    ],
    liabilities: [
      { label: 'Mortgage Liability', value: Math.round(mortgageOutstanding) },
      { label: 'Other Debts', value: Math.round(otherDebts) },
    ],
    expenseBreakdown: expMode === 'detailed'
      ? [
          { label: 'Financial Obligations', value: Math.round(financialObligations) },
          { label: 'Mortgage', value: Math.round(mortgageDisplay) },
          { label: 'Household & Living', value: Math.round(householdExpense) },
          { label: 'Personal', value: Math.round(personalExpense) },
          { label: 'Children', value: Math.round(childrenExpense) },
          { label: 'Lifestyle', value: Math.round(lifestyleExpense) },
          { label: 'Insurance', value: Math.round(insuranceExpense) },
          { label: 'Savings', value: Math.round(savingsExpense) },
        ]
      : [
          { label: 'Financial Obligations', value: Math.round(financialObligations) },
          { label: 'Mortgage', value: Math.round(mortgageDisplay) },
          { label: 'Household & Living', value: Math.round(householdExpense) },
          { label: 'Personal', value: Math.round(personalExpense) },
          { label: 'Children', value: Math.round(childrenExpense) },
          { label: 'Lifestyle', value: Math.round(lifestyleExpense) },
        ],
    expenseBenchmark: expMode === 'detailed'
      ? (() => {
          const cats = [
            { label: 'Financial Obligations', value: financialObligations },
            { label: 'Mortgage', value: mortgageDisplay },
            { label: 'Household & Living', value: householdExpense },
            { label: 'Personal', value: personalExpense },
            { label: 'Children', value: childrenExpense },
            { label: 'Lifestyle', value: lifestyleExpense },
            { label: 'Insurance', value: insuranceExpense },
            { label: 'Savings', value: savingsExpense },
          ]
          const total = cats.reduce((s, c) => s + c.value, 0)
          return cats.map(c => ({
            label: c.label,
            actualValue: Math.round(c.value),
            actualPct: total > 0 ? Math.round((c.value / total) * 100) : 0,
            benchmarkPct: BENCHMARK_PCT[c.label] ?? 0,
          }))
        })()
      : [],
    generatedAt: new Date().toISOString(),
  }
}
