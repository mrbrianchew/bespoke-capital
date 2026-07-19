// Shared field taxonomy for the client-facing Financial Statement feature.
// Used by BOTH the public statement page (/statement/[token]) and the advisor
// Snapshots tab, so the two can never drift apart.
//
// UNITS CONVENTION (important):
// - The client statement collects ANNUAL figures for income (except gross
//   monthly salary) and expenses. fact_finding stores these MONTHLY
//   (other_incomes, s_*, d_* are all monthly on the advisor side), so the
//   Apply step divides by 12. Assets / liabilities / properties are balances
//   and transfer 1:1.

export interface StmtLineItem { label: string; amount: number }
export interface StmtCatLineItem { cat: string; label: string; amount: number }

export interface StmtProperty {
  id: string
  label: string
  propertyType: string
  isPrimaryResidence: boolean
  ownershipType: string
  purchasePrice?: number
  propertyValue?: number
  bank?: string
  loanType?: string
  outstanding?: number
  remainingTenure?: number
  interestRate?: number
  monthlyRepayment?: number
}

export interface StatementData {
  income: {
    gross_monthly?: number // monthly
    gross_bonus?: number   // annual
    others: StmtLineItem[] // ANNUAL amounts
  }
  expense_mode: 'simple' | 'detailed'
  exp_simple: Record<string, number>          // s_* keys, ANNUAL
  exp_simple_custom: StmtLineItem[]           // ANNUAL
  exp_detailed: Record<string, number>        // d_* keys, ANNUAL
  exp_detailed_custom: StmtCatLineItem[]      // cat: financial|household|personal|children|lifestyle, ANNUAL
  assets: Record<string, number>              // a_* keys, balances
  assets_custom: StmtCatLineItem[]            // cat: cash|invested|personal
  liabilities: Record<string, number>         // l_* keys, balances
  liabilities_custom: StmtCatLineItem[]       // cat: st|lt
  properties: StmtProperty[]
}

export function emptyStatementData(): StatementData {
  return {
    income: { others: [] },
    expense_mode: 'detailed',
    exp_simple: {}, exp_simple_custom: [],
    exp_detailed: {}, exp_detailed_custom: [],
    assets: {}, assets_custom: [],
    liabilities: {}, liabilities_custom: [],
    properties: [],
  }
}

// ---------- Income ----------
export const INCOME_POOL: { id: string; label: string }[] = [
  { id: 'rental',    label: 'Rental Income' },
  { id: 'dividend',  label: 'Dividend Income' },
  { id: 'interest',  label: 'Interest Income' },
  { id: 'freelance', label: 'Freelance / Commission Income' },
  { id: 'business',  label: 'Business Income' },
  { id: 'allowance', label: 'Allowance Received' },
]

// ---------- Expenses: simple mode (mirrors EXP_CATEGORIES on the advisor page) ----------
export const EXP_SIMPLE_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: 's_financial', label: 'Financial Obligations',    hint: 'Income tax, insurance premiums, regular investments/savings' },
  { key: 's_cpf_oa',    label: 'Mortgage (CPF OA)',        hint: 'Home loan repayment via CPF Ordinary Account' },
  { key: 's_mortgage',  label: 'Mortgage / Rent (Cash)',   hint: 'Cash home loan repayment, rental payments' },
  { key: 's_household', label: 'Household & Living',       hint: 'Conservancy fees, utilities, groceries, maid salary' },
  { key: 's_personal',  label: 'Personal Expenses',        hint: 'Personal food & dining, transport, car expenses' },
  { key: 's_children',  label: 'Children Expenses',        hint: 'Childcare, school & tuition fees, transport, pocket money' },
  { key: 's_lifestyle', label: 'Lifestyle & Miscellaneous',hint: 'Holidays, hobbies, allowance to parents, donations, shopping' },
]

// ---------- Expenses: detailed mode (mirrors detailed keys on the advisor page) ----------
export interface StmtBlock { id: string; title: string; color: string; bg: string; fields: { key: string; label: string }[] }

export const EXP_DETAILED_BLOCKS: StmtBlock[] = [
  { id: 'financial', title: 'Financial Obligations', color: '#B04A4A', bg: '#FBEBEB', fields: [
    { key: 'd_mortgage_cpf',       label: 'Mortgage Loan (CPF OA)' },
    { key: 'd_mortgage_cash',      label: 'Mortgage Loan (Cash)' },
    { key: 'd_vehicle_repay',      label: 'Motor Vehicle Repayment' },
    { key: 'd_personal_loan_repay',label: 'Personal Loan Repayment' },
    { key: 'd_rental_expense',     label: 'Rental Expenses' },
    { key: 'd_income_tax',         label: 'Income Tax' },
    { key: 'd_insurance',          label: 'Insurance Payments' },
    { key: 'd_regular_savings',    label: 'Regular Savings / Investments' },
  ]},
  { id: 'household', title: 'Household & Living', color: '#4A7C9E', bg: '#EAF0F5', fields: [
    { key: 'd_conservancy',    label: 'Conservancy / MCST / Property Tax' },
    { key: 'd_utilities',      label: 'Utilities & Bills' },
    { key: 'd_family_food',    label: 'Family Food & Groceries' },
    { key: 'd_maid',           label: 'Maid Services (incl. Levy)' },
    { key: 'd_other_household',label: 'Other Household Expenses' },
  ]},
  { id: 'personal', title: 'Personal Expenses', color: '#7A6AAA', bg: '#F0EBFA', fields: [
    { key: 'd_personal_food', label: 'Personal Food & Groceries' },
    { key: 'd_transport',     label: 'Public Transport' },
    { key: 'd_car_petrol',    label: 'Car Petrol / Parking / Road Tax' },
    { key: 'd_car_insurance', label: 'Car Insurance' },
  ]},
  { id: 'children', title: 'Children Expenses', color: '#2A5E46', bg: '#E8F2ED', fields: [
    { key: 'd_childcare',          label: 'Childcare / DayCare' },
    { key: 'd_school_fees',        label: 'School & Tuition Fees' },
    { key: 'd_school_transport',   label: 'School Transport' },
    { key: 'd_allowance_children', label: 'Allowance / Pocket Money' },
    { key: 'd_other_children',     label: 'Other Children Expenses' },
  ]},
  { id: 'lifestyle', title: 'Lifestyle & Miscellaneous', color: '#8A6C3A', bg: '#F5EFE3', fields: [
    { key: 'd_holidays',         label: 'Holidays / Tours' },
    { key: 'd_hobbies',          label: 'Hobbies / Recreation' },
    { key: 'd_allowance_parents',label: 'Allowance to Parents' },
    { key: 'd_others_lifestyle', label: 'Others (Shopping, Tithes, Donations)' },
  ]},
]

// Maps a detailed-expense category id to the fact_finding custom-array key.
export const EXP_CUSTOM_KEY: Record<string, string> = {
  financial: 'd_custom_financial',
  household: 'd_custom_household',
  personal:  'd_custom_personal',
  children:  'd_custom_children',
  lifestyle: 'd_custom_lifestyle',
}

// ---------- Assets ----------
export const ASSET_BLOCKS: StmtBlock[] = [
  { id: 'cash', title: 'Cash / Near Cash', color: '#2A5E46', bg: '#E8F2ED', fields: [
    { key: 'a_savings',       label: 'Savings / Current Account(s)' },
    { key: 'a_fixed_deposit', label: 'Fixed Deposit(s)' },
  ]},
  { id: 'invested', title: 'Invested Asset(s)', color: '#4A7C9E', bg: '#EAF0F5', fields: [
    { key: 'a_cpf_oa',       label: 'CPF Ordinary Account (OA)' },
    { key: 'a_cpf_sa',       label: 'CPF Special Account (SA)' },
    { key: 'a_cpf_ma',       label: 'CPF Medisave Account (MA)' },
    { key: 'a_cpf_ra',       label: 'CPF Retirement Account (RA)' },
    { key: 'a_srs',          label: 'SRS' },
    { key: 'a_shares',       label: 'Shares' },
    { key: 'a_etf',          label: 'ETF(s)' },
    { key: 'a_unit_trust',   label: 'Unit Trust(s)' },
    { key: 'a_bonds',        label: 'Bonds / Treasury Bills' },
    { key: 'a_alternatives', label: 'Alternative Investments (Hedge Funds, Gold, etc.)' },
    { key: 'a_business',     label: 'Business Venture(s)' },
  ]},
  { id: 'personal', title: 'Personal Use Asset(s)', color: '#8A6C3A', bg: '#F5EFE3', fields: [
    { key: 'a_vehicles', label: 'Motor Vehicles (Cars, Bikes, Boats)' },
    { key: 'a_club',     label: 'Club Membership' },
  ]},
]

export const ASSET_CUSTOM_KEY: Record<string, string> = {
  cash: 'a_cash_custom', invested: 'a_invested_custom', personal: 'a_personal_custom',
}

// ---------- Liabilities ----------
export const LIAB_BLOCKS: StmtBlock[] = [
  { id: 'st', title: 'Short Term (<5 Years)', color: '#B04A4A', bg: '#FBEBEB', fields: [
    { key: 'l_credit_card',   label: 'Credit Card / Credit Line' },
    { key: 'l_business_loan', label: 'Business Loan' },
    { key: 'l_renovation_st', label: 'Renovation Loan' },
  ]},
  { id: 'lt', title: 'Long Term (>5 Years)', color: '#8A5E3A', bg: '#F0EAE2', fields: [
    { key: 'l_car_loan',      label: 'Car / Motor Vehicle Loan' },
    { key: 'l_study_loan',    label: 'Study Loan' },
    { key: 'l_personal_loan', label: 'Personal Loan' },
    { key: 'l_renovation_lt', label: 'Renovation Loan' },
  ]},
]

export const LIAB_CUSTOM_KEY: Record<string, string> = { st: 'l_st_custom', lt: 'l_lt_custom' }

export const PROPERTY_TYPES = ['HDB', 'Private Condo', 'Landed', 'Commercial', 'Industrial', 'Overseas']
export const OWNERSHIP_TYPES = ['Sole Ownership', 'Joint Tenancy', 'Tenancy-in-Common']
export const LOAN_TYPES = ['Fixed', 'Floating', 'Split']

// ---------- Totals (all pure; safe on partial data) ----------
const num = (v: unknown): number => (typeof v === 'number' && isFinite(v)) ? v : 0

export function stmtIncomeTotal(d: StatementData): number {
  const others = (d.income.others || []).reduce((s, i) => s + num(i.amount), 0)
  return num(d.income.gross_monthly) * 12 + num(d.income.gross_bonus) + others
}

export function stmtExpSimpleTotal(d: StatementData): number {
  const base = EXP_SIMPLE_FIELDS.reduce((s, f) => s + num(d.exp_simple[f.key]), 0)
  const custom = (d.exp_simple_custom || []).reduce((s, i) => s + num(i.amount), 0)
  return base + custom
}

export function stmtExpDetailedBlockTotal(d: StatementData, blockId: string): number {
  const block = EXP_DETAILED_BLOCKS.find(b => b.id === blockId)
  if (!block) return 0
  const base = block.fields.reduce((s, f) => s + num(d.exp_detailed[f.key]), 0)
  const custom = (d.exp_detailed_custom || []).filter(i => i.cat === blockId).reduce((s, i) => s + num(i.amount), 0)
  return base + custom
}

export function stmtExpDetailedTotal(d: StatementData): number {
  return EXP_DETAILED_BLOCKS.reduce((s, b) => s + stmtExpDetailedBlockTotal(d, b.id), 0)
}

export function stmtExpenseTotal(d: StatementData): number {
  return d.expense_mode === 'simple' ? stmtExpSimpleTotal(d) : stmtExpDetailedTotal(d)
}

export function stmtAssetBlockTotal(d: StatementData, blockId: string): number {
  const block = ASSET_BLOCKS.find(b => b.id === blockId)
  if (!block) return 0
  const base = block.fields.reduce((s, f) => s + num(d.assets[f.key]), 0)
  const custom = (d.assets_custom || []).filter(i => i.cat === blockId).reduce((s, i) => s + num(i.amount), 0)
  return base + custom
}

export function stmtAssetsTotal(d: StatementData): number {
  return ASSET_BLOCKS.reduce((s, b) => s + stmtAssetBlockTotal(d, b.id), 0)
}

export function stmtLiabBlockTotal(d: StatementData, blockId: string): number {
  const block = LIAB_BLOCKS.find(b => b.id === blockId)
  if (!block) return 0
  const base = block.fields.reduce((s, f) => s + num(d.liabilities[f.key]), 0)
  const custom = (d.liabilities_custom || []).filter(i => i.cat === blockId).reduce((s, i) => s + num(i.amount), 0)
  return base + custom
}

export function stmtLiabTotal(d: StatementData): number {
  return LIAB_BLOCKS.reduce((s, b) => s + stmtLiabBlockTotal(d, b.id), 0)
}

export function stmtPropertyEquity(d: StatementData): number {
  return (d.properties || []).reduce((s, p) => s + (num(p.propertyValue) || num(p.purchasePrice)) - num(p.outstanding), 0)
}

export function fmtStmtMoney(n: number): string {
  if (n === undefined || n === null || isNaN(n) || !isFinite(n)) return '$ 0'
  return '$ ' + Math.round(n).toLocaleString('en-US')
}
