// Growth numbers for one saved record (fact_finding_versions, section 'financials').
//
// Pure functions, no database or screen code. Reads only the record's own data, so it
// cannot change the live plan. The four numbers are the same ones the Financials page
// shows, worked out the way that page does for a saved record of an earlier month:
// the person's age in that month, and that month's CPF rates and wage ceiling.
//
//   netWorth : assets minus liabilities (same fields as buildOverviewSnapshot)
//   income   : yearly take-home after CPF, before income tax (same as the page)
//   expenses : yearly cash expenses, NOT counting regular savings/investments
//   savings  : income - expenses  (= surplus + regular savings/investments)
//
// Known limits (shown to the user, not hidden):
//  - In "simple" expense mode, regular savings are not entered separately, so they
//    stay inside expenses and savings shows only the money left over.
//  - CPF-OA mortgage repayments are left out of expenses, exactly as the page does.
//  - The CPF calculation below is a copy of calcCpf in financials/page.tsx (that
//    function is not exported). Keep the two in step; verification compares them.

import { calcSepMedisave, isSepEmploymentType } from './calc'
import { ageForCpfAt, cpfConfigAt, currentMonthStartSG, type HistConfig, type HistTier } from './cpfHistory'

type Rec = Record<string, unknown>

export interface GrowthPoint {
  asAt: string // 'YYYY-MM-01'
  netWorth: number
  income: number
  expenses: number
  savings: number
  /** True when regular savings could not be separated (simple expense mode). */
  savingsIncludedInExpenses: boolean
}

export interface PersonRef { dob?: string | null; age?: number | null }

export interface GrowthInput {
  asAt: string
  data: Rec
  client: PersonRef
  spouse: PersonRef | null
  /** CPF settings currently in force (the `config` table row 'cpf_rates'). */
  liveConfig: HistConfig
  /** Defaults to the current Singapore month; only passed in tests. */
  currentMonth?: string
}

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : [])
const obj = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {})
const sum = (keys: string[], d: Rec) => keys.reduce((s, k) => s + num(d[k]), 0)

// ── CPF (copy of the page's calcCpf, take-home only) ───────────────────────────

const PR_YEAR1_RATES: HistTier[] = [35, 45, 50, 55, 60, 65, 70, 999].map((max_age, i) => ({
  max_age, employee: 5, employer: 4,
  oa: i < 4 ? 3.5 : i === 4 ? 2.5 : 1, sa: i < 4 ? 1 : 0, ma: i < 4 ? 4.5 : i === 4 ? 6.5 : 8,
}))
const PR_YEAR2_RATES: HistTier[] = [
  { max_age: 35, employee: 15, employer: 9, oa: 12.5, sa: 3.5, ma: 8 },
  { max_age: 45, employee: 15, employer: 9, oa: 11, sa: 4, ma: 9 },
  { max_age: 50, employee: 15, employer: 9, oa: 9.5, sa: 4.5, ma: 10 },
  { max_age: 55, employee: 15, employer: 9, oa: 8.5, sa: 6, ma: 9.5 },
  { max_age: 60, employee: 12, employer: 7, oa: 6.5, sa: 2, ma: 10.5 },
  { max_age: 65, employee: 9.5, employer: 8.5, oa: 2, sa: 0.5, ma: 9.5 },
  { max_age: 70, employee: 5, employer: 6.5, oa: 1, sa: 0, ma: 6.5 },
  { max_age: 999, employee: 5, employer: 6, oa: 1, sa: 0, ma: 6 },
]

function annualTakeHome(p: Rec, age: number, cfg: HistConfig): number {
  const gross = num(p.gross_monthly)
  const bonus = num(p.gross_bonus)
  const cit = typeof p.citizenship === 'string' ? p.citizenship : 'SC'
  const prYear = typeof p.pr_year === 'string' ? p.pr_year : '3+'
  const empType = typeof p.employment_type === 'string' ? p.employment_type : undefined
  const plain = gross * 12 + bonus
  if (isSepEmploymentType(empType)) {
    if (!['SC', 'PR'].includes(cit)) return plain
    return plain - calcSepMedisave(plain, age).annualMedisave
  }
  if (!['SC', 'PR'].includes(cit)) return plain
  let tiers = cfg.sc_rates
  if (cit === 'PR') {
    if (prYear === '1') tiers = PR_YEAR1_RATES
    else if (prYear === '2') tiers = PR_YEAR2_RATES
  }
  const tier = tiers.find(t => age <= t.max_age) ?? tiers[tiers.length - 1]
  const owBase = Math.min(gross, cfg.ow_ceiling)
  const employee = Math.floor((owBase * tier.employee) / 100)
  const bonusEmp = Math.floor((bonus * tier.employee) / 100)
  return (gross - employee) * 12 + (bonus - bonusEmp)
}

// ── Property loan balance as at the record's month ─────────────────────────────

export function outstandingAt(prop: Rec, asAt: string): number {
  if (num(prop.outstanding) > 0) return num(prop.outstanding)
  const loan = num(prop.initialLoanAmount)
  const rate = num(prop.interestRate)
  const tenure = num(prop.initialTenure) || 25
  const parts = (typeof prop.loanStartDate === 'string' ? prop.loanStartDate : '').split('/')
  if (!loan || !tenure) return 0
  if (parts.length !== 2) return loan
  const [ay, am] = asAt.split('-').map(Number)
  const months = (ay - parseInt(parts[1])) * 12 + (am - parseInt(parts[0]))
  const n = tenure * 12
  if (months <= 0) return loan
  if (months >= n) return 0
  if (!rate) return Math.round(loan * (1 - months / n))
  const rv = rate / 100 / 12
  const pmt = (loan * rv * Math.pow(1 + rv, n)) / (Math.pow(1 + rv, n) - 1)
  return Math.max(0, Math.round(loan * Math.pow(1 + rv, months) - (pmt * (Math.pow(1 + rv, months) - 1)) / rv))
}

// ── Expense categories (the page's table, with custom rows counted once) ───────

const DETAILED: { keys: string[]; keys2: string[]; custom?: string }[] = [
  { keys: ['d_vehicle_repay', 'd_personal_loan_repay', 'd_rental_expense', 'd_income_tax', 'd_insurance', 'd_regular_savings'], keys2: ['d2_vehicle_repay', 'd2_personal_loan_repay', 'd2_rental_expense', 'd2_income_tax', 'd2_insurance', 'd2_regular_savings'], custom: 'd_custom_financial' },
  { keys: ['d_mortgage_cash'], keys2: ['d2_mortgage_cash'] },
  { keys: ['d_conservancy', 'd_utilities', 'd_family_food', 'd_maid', 'd_other_household'], keys2: ['d2_conservancy', 'd2_utilities', 'd2_family_food', 'd2_maid', 'd2_other_household'], custom: 'd_custom_household' },
  { keys: ['d_personal_food', 'd_transport', 'd_car_petrol', 'd_car_insurance'], keys2: ['d2_personal_food', 'd2_transport', 'd2_car_petrol', 'd2_car_insurance'], custom: 'd_custom_personal' },
  { keys: ['d_childcare', 'd_school_fees', 'd_school_transport', 'd_allowance_children', 'd_other_children'], keys2: ['d2_childcare', 'd2_school_fees', 'd2_school_transport', 'd2_allowance_children', 'd2_other_children'], custom: 'd_custom_children' },
  { keys: ['d_holidays', 'd_hobbies', 'd_allowance_parents', 'd_others_lifestyle'], keys2: ['d2_holidays', 'd2_hobbies', 'd2_allowance_parents', 'd2_others_lifestyle'], custom: 'd_custom_lifestyle' },
]
const SIMPLE: [string, string][] = [
  ['s_financial', 's2_financial'], ['s_mortgage', 's2_mortgage'], ['s_household', 's2_household'],
  ['s_personal', 's2_personal'], ['s_children', 's2_children'], ['s_lifestyle', 's2_lifestyle'],
]

function expenses(d: Rec, couple: boolean): { total: number; regularSavings: number; detailed: boolean } {
  const detailed = d.expense_mode === 'detailed'
  let total = 0
  if (detailed) {
    for (const c of DETAILED) {
      total += sum(c.keys, d)
      if (c.custom) total += arr(d[c.custom]).reduce((s, i) => s + num(i.amount), 0)
      if (couple) {
        total += sum(c.keys2, d)
        if (c.custom) total += arr(d[c.custom]).reduce((s, i) => s + num(i.amount2), 0)
      }
    }
  } else {
    for (const [k, k2] of SIMPLE) total += num(d[k]) + (couple ? num(d[k2]) : 0)
  }
  const regularSavings = detailed ? num(d.d_regular_savings) + (couple ? num(d.d2_regular_savings) : 0) : 0
  return { total, regularSavings, detailed }
}

// ── Net worth (same fields as buildOverviewSnapshot) ───────────────────────────

function netWorth(d: Rec, couple: boolean, asAt: string): number {
  const c = (k1: string, k2: string) => num(d[k1]) + (couple ? num(d[k2]) : 0)
  const customSum = (key: string) => arr(d[key]).reduce((s, i) => s + num(i.amount) + (couple ? num(i.amount2) : 0), 0)
  const cash = c('a_savings', 'a2_savings') + c('a_fixed_deposit', 'a2_fixed_deposit')
  const cpf = c('a_cpf_oa', 'a2_cpf_oa') + c('a_cpf_sa', 'a2_cpf_sa') + c('a_cpf_ma', 'a2_cpf_ma') + c('a_cpf_ra', 'a2_cpf_ra')
  const invest = c('a_shares', 'a2_shares') + c('a_etf', 'a2_etf') + c('a_bonds', 'a2_bonds') + c('a_alternatives', 'a2_alternatives') + customSum('a_invested_custom')
  const managed = c('a_srs', 'a2_srs') + c('a_unit_trust', 'a2_unit_trust')
  const business = c('a_business', 'a2_business')
  const personal = c('a_vehicles', 'a2_vehicles') + c('a_club', 'a2_club') + customSum('a_personal_custom')
  const props = arr(d.properties)
  const propValue = props.reduce((s, p) => s + (num(p.propertyValue) || num(p.purchasePrice)), 0)
  const mortgage = props.reduce((s, p) => s + outstandingAt(p, asAt), 0)
  const debts =
    c('l_car_loan', 'l2_car_loan') + c('l_credit_card', 'l2_credit_card') + c('l_business_loan', 'l2_business_loan') +
    c('l_renovation_st', 'l2_renovation_st') + c('l_study_loan', 'l2_study_loan') + c('l_personal_loan', 'l2_personal_loan') +
    c('l_renovation_lt', 'l2_renovation_lt') + customSum('l_st_custom') + customSum('l_lt_custom')
  return Math.max(0, cash + cpf + invest + managed + propValue + business + personal - mortgage - debts)
}

// ── Public ─────────────────────────────────────────────────────────────────────

export function growthPoint(input: GrowthInput): GrowthPoint {
  const { asAt, data, client, spouse, liveConfig } = input
  const couple = data.mode === 'couple'
  const past = asAt < (input.currentMonth ?? currentMonthStartSG())
  const cfg = past ? cpfConfigAt(asAt).config : liveConfig
  const ageOf = (p: PersonRef | null): number => {
    if (past) return ageForCpfAt(p?.dob, p?.age, asAt)?.age ?? (p?.age || 35)
    return p?.age || 35
  }
  const p1 = obj(data.person1)
  const p2 = obj(data.person2)
  const otherYear = (p: Rec) => arr(p.other_incomes).reduce((s, i) => s + num(i.amount), 0) * 12
  const income =
    annualTakeHome(p1, ageOf(client), cfg) + otherYear(p1) +
    (couple ? annualTakeHome(p2, ageOf(spouse), cfg) + otherYear(p2) : 0)

  const exp = expenses(data, couple)
  const expensesExSavings = exp.total - exp.regularSavings
  return {
    asAt,
    netWorth: Math.round(netWorth(data, couple, asAt)),
    income: Math.round(income),
    expenses: Math.round(expensesExSavings),
    savings: Math.round(income - expensesExSavings),
    savingsIncludedInExpenses: !exp.detailed,
  }
}

/** One point per month, oldest first. If a month has two records, the later-created one wins. */
export function growthSeries(
  rows: { as_at: string; data: Rec; created_at?: string }[],
  ctx: Omit<GrowthInput, 'asAt' | 'data'>
): GrowthPoint[] {
  const byMonth = new Map<string, { as_at: string; data: Rec; created_at?: string }>()
  for (const r of rows) {
    const cur = byMonth.get(r.as_at)
    if (!cur || (r.created_at ?? '') >= (cur.created_at ?? '')) byMonth.set(r.as_at, r)
  }
  return Array.from(byMonth.values())
    .sort((a, b) => a.as_at.localeCompare(b.as_at))
    .map(r => growthPoint({ ...ctx, asAt: r.as_at, data: r.data }))
}