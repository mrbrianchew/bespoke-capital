// ─── RETIREMENT EXPENSE CATALOGUE ──────────────────────────────────────────
// Single source of truth for "what counts as a retirement-relevant expense
// category" and "how to read one off the fact_finding 'financials' section".
// Originally lived only in RetirementSection.tsx (the live Retirement tab);
// extracted here so the PDF report's Capital Fund pages (capitalFundSnapshot.ts)
// can compute the SAME expense-based monthly income figure when a client is
// on expenseSelections.mode === 'expense_based' (the DEFAULT_RETIREMENT_DATA
// mode) rather than falling back to a 'monthlyExpenses' field that doesn't
// exist anywhere in the 'financials' fact_finding schema (person1/person2 +
// flat d_*/d2_* detailed keys, or s_*/s2_* simple keys) — that mismatch is
// why the PDF previously showed $0/annum for clients using expense_based
// mode even though their live Retirement tab and Capital Mandate corpus were
// correctly computed from these same categories.

export interface ExpenseItem {
  key: string
  label: string
  simpleKey?: string
  detailedKey?: string
}

export interface ExpenseGroup {
  id: string
  label: string
  color: string
  items: ExpenseItem[]
}

export const RETIREMENT_EXPENSE_GROUPS: ExpenseGroup[] = [
  {
    id: 'financial',
    label: 'Financial Obligations',
    color: '#E08080',
    items: [
      { key: 'd_mortgage_cpf',        label: 'Mortgage Loan (CPF OA)',        simpleKey: 's_cpf_oa',   detailedKey: 'd_mortgage_cpf' },
      { key: 'd_mortgage_cash',       label: 'Mortgage Loan (Cash)',          simpleKey: 's_mortgage', detailedKey: 'd_mortgage_cash' },
      { key: 'd_vehicle_repay',       label: 'Motor Vehicle Repayment',       detailedKey: 'd_vehicle_repay' },
      { key: 'd_personal_loan_repay', label: 'Personal Loan Repayment',       detailedKey: 'd_personal_loan_repay' },
      { key: 'd_rental_expense',      label: 'Rental Expenses',               detailedKey: 'd_rental_expense' },
      { key: 'd_income_tax',          label: 'Income Tax',                    simpleKey: 's_financial', detailedKey: 'd_income_tax' },
      { key: 'd_insurance',           label: 'Insurance Payments',            simpleKey: 's_financial', detailedKey: 'd_insurance' },
      { key: 'd_regular_savings',     label: 'Regular Savings / Investments', simpleKey: 's_financial', detailedKey: 'd_regular_savings' },
    ],
  },
  {
    id: 'household',
    label: 'Household & Living',
    color: '#4A7C9E',
    items: [
      { key: 'd_conservancy',     label: 'Conservancy / MCST / Property Tax', simpleKey: 's_household', detailedKey: 'd_conservancy' },
      { key: 'd_utilities',       label: 'Utilities & Bills',                  simpleKey: 's_household', detailedKey: 'd_utilities' },
      { key: 'd_family_food',     label: 'Family Food & Groceries',            simpleKey: 's_household', detailedKey: 'd_family_food' },
      { key: 'd_maid',            label: 'Maid Services (incl. Levy)',         simpleKey: 's_household', detailedKey: 'd_maid' },
      { key: 'd_other_household', label: 'Other Household Expenses',           simpleKey: 's_household', detailedKey: 'd_other_household' },
    ],
  },
  {
    id: 'personal',
    label: 'Personal Expenses',
    color: '#7A6AAA',
    items: [
      { key: 'd_personal_food', label: 'Personal Food & Dining',     simpleKey: 's_personal', detailedKey: 'd_personal_food' },
      { key: 'd_transport',     label: 'Public Transport',           simpleKey: 's_personal', detailedKey: 'd_transport' },
      { key: 'd_car_petrol',    label: 'Car Petrol / Parking / Tax', simpleKey: 's_personal', detailedKey: 'd_car_petrol' },
      { key: 'd_car_insurance', label: 'Car Insurance',              simpleKey: 's_personal', detailedKey: 'd_car_insurance' },
    ],
  },
  {
    id: 'children',
    label: 'Children Expenses',
    color: '#2D5A4E',
    items: [
      { key: 'd_childcare',          label: 'Childcare / DayCare',      simpleKey: 's_children', detailedKey: 'd_childcare' },
      { key: 'd_school_fees',        label: 'School & Tuition Fees',    simpleKey: 's_children', detailedKey: 'd_school_fees' },
      { key: 'd_school_transport',   label: 'School Transport',         simpleKey: 's_children', detailedKey: 'd_school_transport' },
      { key: 'd_allowance_children', label: 'Allowance / Pocket Money', simpleKey: 's_children', detailedKey: 'd_allowance_children' },
      { key: 'd_other_children',     label: 'Other Children Expenses',  simpleKey: 's_children', detailedKey: 'd_other_children' },
    ],
  },
  {
    id: 'lifestyle',
    label: 'Lifestyle & Miscellaneous',
    color: '#9A7C5A',
    items: [
      { key: 'd_holidays',          label: 'Holidays / Travel',         simpleKey: 's_lifestyle', detailedKey: 'd_holidays' },
      { key: 'd_hobbies',           label: 'Hobbies / Recreation',      simpleKey: 's_lifestyle', detailedKey: 'd_hobbies' },
      { key: 'd_allowance_parents', label: 'Allowance to Parents',      simpleKey: 's_lifestyle', detailedKey: 'd_allowance_parents' },
      { key: 'd_others_lifestyle',  label: 'Others (Shopping, Tithes)', simpleKey: 's_lifestyle', detailedKey: 'd_others_lifestyle' },
    ],
  },
]

export function readExpenseValue(ff: Record<string, unknown>, item: ExpenseItem, expenseMode: 'simple' | 'detailed', who: 'client' | 'spouse'): number {
  if (expenseMode === 'detailed') {
    const base = item.detailedKey
    if (base) {
      const key = who === 'spouse' ? base.replace('d_', 'd2_') : base
      return (ff[key] as number) || 0
    }
  }
  const simpleMap: Record<string, string> = {
    's_financial': 'd_income_tax',
    's_cpf_oa':    'd_mortgage_cpf',
    's_mortgage':  'd_mortgage_cash',
    's_household': 'd_conservancy',
    's_personal':  'd_personal_food',
    's_children':  'd_childcare',
    's_lifestyle': 'd_holidays',
  }
  const base = item.simpleKey
  if (base) {
    const key = who === 'spouse' ? base.replace('s_', 's2_') : base
    const val = (ff[key] as number) || 0
    const mappedDetailedKey = simpleMap[base]
    if (mappedDetailedKey && item.detailedKey === mappedDetailedKey) return val
    return 0
  }
  return 0
}

export function sumSelectedExpenses(ff: Record<string, unknown>, selectedKeys: Record<string, boolean>, expenseMode: 'simple' | 'detailed', who: 'client' | 'spouse'): number {
  let total = 0
  for (const group of RETIREMENT_EXPENSE_GROUPS) {
    if (selectedKeys[group.id] === false) continue
    for (const item of group.items) {
      total += readExpenseValue(ff, item, expenseMode, who)
    }
  }
  return total
}