// Review insights: what changed since the last saved review, worked out from the
// client's own two sets of figures (the last saved record and the live plan).
//
// Pure functions, no database or screen code. Reads data only.
//
//   free cashflow = income (take-home after CPF) - the WHOLE expenses table
//                   (includes loans, insurance, income tax and regular savings)
//   savings rate  = (income - expenses NOT counting regular savings) / income
//                   (same meaning as "savings" in growth.ts)
//   bank share    = free cashflow / income; products share = regular savings / income
//
// Expected cash = last cash + average free cashflow (last and now) x years between.
// It is an estimate from two snapshots. It never claims to explain the gap: it shows
// the other balance changes beside it so the advisor can ask.

import { growthPoint, outstandingAt, type GrowthInput } from './growth'

type Rec = Record<string, unknown>
const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : [])

// Cash expenses only: CPF-OA mortgage is left out (it does not leave the bank), as growth.ts does.
const LINES: [string, string, string][] = [
  ['d_mortgage_cash', 'd2_mortgage_cash', 'Mortgage (cash)'],
  ['d_vehicle_repay', 'd2_vehicle_repay', 'Motor vehicle repayment'],
  ['d_personal_loan_repay', 'd2_personal_loan_repay', 'Personal loan repayment'],
  ['d_rental_expense', 'd2_rental_expense', 'Rental'],
  ['d_income_tax', 'd2_income_tax', 'Income tax'],
  ['d_insurance', 'd2_insurance', 'Insurance'],
  ['d_regular_savings', 'd2_regular_savings', 'Regular savings and investments'],
  ['d_conservancy', 'd2_conservancy', 'Conservancy and property tax'],
  ['d_utilities', 'd2_utilities', 'Utilities'],
  ['d_family_food', 'd2_family_food', 'Family food'],
  ['d_maid', 'd2_maid', 'Maid'],
  ['d_other_household', 'd2_other_household', 'Other household'],
  ['d_personal_food', 'd2_personal_food', 'Personal food'],
  ['d_transport', 'd2_transport', 'Public transport'],
  ['d_car_petrol', 'd2_car_petrol', 'Car petrol and parking'],
  ['d_car_insurance', 'd2_car_insurance', 'Car insurance'],
  ['d_childcare', 'd2_childcare', 'Childcare'],
  ['d_school_fees', 'd2_school_fees', 'School and tuition'],
  ['d_school_transport', 'd2_school_transport', 'School transport'],
  ['d_allowance_children', 'd2_allowance_children', 'Children allowance'],
  ['d_other_children', 'd2_other_children', 'Other children'],
  ['d_holidays', 'd2_holidays', 'Holidays'],
  ['d_hobbies', 'd2_hobbies', 'Hobbies'],
  ['d_allowance_parents', 'd2_allowance_parents', 'Allowance to parents'],
  ['d_others_lifestyle', 'd2_others_lifestyle', 'Shopping and donations'],
]
const CUSTOM = ['d_custom_financial', 'd_custom_household', 'd_custom_personal', 'd_custom_children', 'd_custom_lifestyle']
const SIMPLE: [string, string, string][] = [
  ['s_financial', 's2_financial', 'Financial'], ['s_mortgage', 's2_mortgage', 'Mortgage'], ['s_household', 's2_household', 'Household'],
  ['s_personal', 's2_personal', 'Personal'], ['s_children', 's2_children', 'Children'], ['s_lifestyle', 's2_lifestyle', 'Lifestyle'],
]
const LOAN_KEYS: [string, string][] = [['d_mortgage_cash', 'd2_mortgage_cash'], ['d_vehicle_repay', 'd2_vehicle_repay'], ['d_personal_loan_repay', 'd2_personal_loan_repay']]

export interface Snapshot {
  asAt: string
  income: number
  /** Whole expenses table (loans, insurance, tax and regular savings included). */
  spending: number
  regularSavings: number
  freeCash: number
  /** (income - expenses without regular savings) / income, 0 if no income. */
  savingsRate: number
  bankShare: number
  productsShare: number
  cash: number
  investments: number
  /** Property loans and other debts. */
  debts: number
  loanRepayments: number
  lines: Record<string, number>
  /** Simple expense mode: regular savings cannot be separated. */
  simple: boolean
}

export function snapshot(input: GrowthInput): Snapshot {
  const d = input.data
  const couple = d.mode === 'couple'
  const c = (k1: string, k2: string) => num(d[k1]) + (couple ? num(d[k2]) : 0)
  const custom = (key: string) => arr(d[key]).reduce((s, i) => s + num(i.amount) + (couple ? num(i.amount2) : 0), 0)
  const simple = d.expense_mode !== 'detailed'

  const lines: Record<string, number> = {}
  if (simple) {
    for (const [k, k2, label] of SIMPLE) lines[label] = c(k, k2)
  } else {
    for (const [k, k2, label] of LINES) lines[label] = c(k, k2)
    for (const key of CUSTOM) for (const i of arr(d[key])) {
      const label = typeof i.label === 'string' && i.label.trim() ? i.label.trim() : 'Other'
      lines[label] = (lines[label] ?? 0) + num(i.amount) + (couple ? num(i.amount2) : 0)
    }
  }
  const spending = Object.values(lines).reduce((s, v) => s + v, 0)
  const regularSavings = simple ? 0 : c('d_regular_savings', 'd2_regular_savings')
  const gp = growthPoint(input)
  const income = gp.income
  const freeCash = income - spending
  const loanRepayments = simple ? c('s_mortgage', 's2_mortgage') : LOAN_KEYS.reduce((s, [a, b]) => s + c(a, b), 0)

  const props = arr(d.properties)
  const mortgage = props.reduce((s, p) => s + outstandingAt(p, input.asAt), 0)
  const debts = mortgage +
    c('l_car_loan', 'l2_car_loan') + c('l_credit_card', 'l2_credit_card') + c('l_business_loan', 'l2_business_loan') +
    c('l_renovation_st', 'l2_renovation_st') + c('l_study_loan', 'l2_study_loan') + c('l_personal_loan', 'l2_personal_loan') +
    c('l_renovation_lt', 'l2_renovation_lt') + custom('l_st_custom') + custom('l_lt_custom')

  return {
    asAt: input.asAt,
    income: Math.round(income),
    spending: Math.round(spending),
    regularSavings: Math.round(regularSavings),
    freeCash: Math.round(freeCash),
    savingsRate: income > 0 ? gp.savings / income : 0,
    bankShare: income > 0 ? freeCash / income : 0,
    productsShare: income > 0 ? regularSavings / income : 0,
    cash: Math.round(c('a_savings', 'a2_savings') + c('a_fixed_deposit', 'a2_fixed_deposit') + custom('a_cash_custom')),
    investments: Math.round(
      c('a_shares', 'a2_shares') + c('a_etf', 'a2_etf') + c('a_bonds', 'a2_bonds') + c('a_alternatives', 'a2_alternatives') +
      c('a_srs', 'a2_srs') + c('a_unit_trust', 'a2_unit_trust') + custom('a_invested_custom')),
    debts: Math.round(debts),
    loanRepayments: Math.round(loanRepayments),
    lines,
    simple,
  }
}

export const BUFFER_MONTHS = 6

export interface Insights {
  months: number
  years: number
  prev: Snapshot
  cur: Snapshot
  expectedBuild: number
  expectedCash: number
  actualChange: number
  /** expected - actual. Positive = the bank grew less than the cashflow suggests. */
  shortfall: number
  /** Investments change minus the regular savings estimated to have gone in. */
  investBeyondSavings: number
  debtChange: number
  incomeGrowthPa: number | null
  spendGrowthPa: number | null
  incomeTotalPct: number | null
  spendTotalPct: number | null
  monthlySpend: number
  monthsOfCash: number
  bufferAmount: number
  /** cash - buffer. Negative = below the buffer. */
  aboveBuffer: number
  loansVsIncome: number
  prevLoansVsIncome: number
  increases: { label: string; change: number }[]
  questions: string[]
}

export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

const cagr = (a: number, b: number, years: number): number | null => (a > 0 && b > 0 && years > 0 ? (Math.pow(b / a, 1 / years) - 1) * 100 : null)
const pct = (a: number, b: number): number | null => (a > 0 ? ((b - a) / a) * 100 : null)
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`

export function reviewInsights(prev: Snapshot, cur: Snapshot): Insights | null {
  const months = monthsBetween(prev.asAt, cur.asAt)
  if (months < 1) return null
  const years = months / 12
  const expectedBuild = ((prev.freeCash + cur.freeCash) / 2) * years
  const expectedCash = prev.cash + expectedBuild
  const actualChange = cur.cash - prev.cash
  const shortfall = expectedCash - cur.cash
  const avgReg = (prev.regularSavings + cur.regularSavings) / 2
  const investBeyondSavings = cur.investments - prev.investments - avgReg * years
  const monthlySpend = cur.spending / 12
  const monthsOfCash = monthlySpend > 0 ? cur.cash / monthlySpend : 0
  const bufferAmount = monthlySpend * BUFFER_MONTHS
  const aboveBuffer = cur.cash - bufferAmount
  const loansVsIncome = cur.income > 0 ? cur.loanRepayments / cur.income : 0
  const prevLoansVsIncome = prev.income > 0 ? prev.loanRepayments / prev.income : 0
  const incomeGrowthPa = cagr(prev.income, cur.income, years)
  const spendGrowthPa = cagr(prev.spending, cur.spending, years)

  const labels = new Set([...Object.keys(prev.lines), ...Object.keys(cur.lines)])
  const increases = Array.from(labels)
    .map(label => ({ label, change: Math.round((cur.lines[label] ?? 0) - (prev.lines[label] ?? 0)) }))
    .filter(x => x.change > 0 && x.label !== 'Regular savings and investments')
    .sort((a, b) => b.change - a.change)
    .slice(0, 5)

  const q: string[] = []
  if (incomeGrowthPa !== null && spendGrowthPa !== null && spendGrowthPa > incomeGrowthPa + 1) {
    const top = increases.slice(0, 3).map(i => i.label.toLowerCase()).join(', ')
    q.push(`Spending is growing ${spendGrowthPa.toFixed(1)}% a year against income at ${incomeGrowthPa.toFixed(1)}%.${top ? ` What changed: ${top}?` : ''}`)
  }
  if (cur.spending > 0 && aboveBuffer > 0 && monthsOfCash > BUFFER_MONTHS + 3) {
    q.push(`${money(aboveBuffer)} sits above ${BUFFER_MONTHS} months of spending (${monthsOfCash.toFixed(0)} months in all). Is any of it set aside for something? If not, what is it for?`)
  } else if (cur.spending > 0 && monthsOfCash < 3) {
    q.push(`Cash covers only ${monthsOfCash.toFixed(1)} months of spending. How do they feel about that?`)
  }
  if (Math.abs(cur.savingsRate - prev.savingsRate) >= 0.03) {
    const dir = cur.savingsRate < prev.savingsRate ? 'fell' : 'rose'
    q.push(`Savings rate ${dir} from ${Math.round(prev.savingsRate * 100)}% to ${Math.round(cur.savingsRate * 100)}%. Is that a choice?`)
  }
  if (expectedCash > 0 && shortfall > Math.max(0.05 * expectedCash, 5000)) {
    q.push(`The bank is ${money(shortfall)} below what the cashflow suggests. A big purchase, a one-off, or spending the form does not capture?`)
  }
  if (loansVsIncome - prevLoansVsIncome >= 0.02) {
    q.push(`Loan repayments rose from ${Math.round(prevLoansVsIncome * 100)}% to ${Math.round(loansVsIncome * 100)}% of income. New borrowing?`)
  }

  return {
    months, years, prev, cur, expectedBuild, expectedCash, actualChange, shortfall, investBeyondSavings,
    debtChange: cur.debts - prev.debts, incomeGrowthPa, spendGrowthPa,
    incomeTotalPct: pct(prev.income, cur.income), spendTotalPct: pct(prev.spending, cur.spending),
    monthlySpend, monthsOfCash, bufferAmount, aboveBuffer, loansVsIncome, prevLoansVsIncome, increases, questions: q.slice(0, 4),
  }
}

/** "3 years 7 months", "11 months". */
export function durationText(months: number): string {
  const y = Math.floor(months / 12), m = months % 12
  const parts = [y ? `${y} year${y > 1 ? 's' : ''}` : '', m ? `${m} month${m > 1 ? 's' : ''}` : ''].filter(Boolean)
  return parts.join(' ') || '0 months'
}