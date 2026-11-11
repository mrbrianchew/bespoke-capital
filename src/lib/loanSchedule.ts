// Year-by-year mortgage schedule for the Property Portfolio card.
// Uses the same inputs and the same repayment formula as the card's "PMT calc"
// (outstanding balance, interest rate, remaining tenure) and as the Risk
// Management chart's loan balance, so the three always agree.

export interface LoanScheduleRow {
  year: number
  clientAge: number | null
  spouseAge: number | null
  paid: number | null       // paid during the year (null on the "today" row)
  interest: number | null
  principal: number | null
  balance: number           // balance at the end of the year (today's balance on the first row)
}

export interface LoanSchedule {
  monthlyPayment: number
  totalInterest: number
  payoffYear: number
  rows: LoanScheduleRow[]
}

export function buildLoanSchedule(a: {
  outstanding: number
  ratePct: number
  remainingYears: number
  clientAge?: number
  spouseAge?: number
  startYear?: number
}): LoanSchedule | null {
  const { outstanding, ratePct, remainingYears } = a
  if (!(outstanding > 0) || !(remainingYears > 0)) return null

  const startYear = a.startYear ?? new Date().getFullYear()
  const n = remainingYears * 12
  const r = ratePct / 100 / 12
  const pmt = r === 0 ? outstanding / n : (outstanding * r) / (1 - Math.pow(1 + r, -n))
  const ageAt = (base: number | undefined, k: number) => (base ? base + k : null)

  const rows: LoanScheduleRow[] = [{
    year: startYear,
    clientAge: ageAt(a.clientAge, 0),
    spouseAge: ageAt(a.spouseAge, 0),
    paid: null, interest: null, principal: null,
    balance: outstanding,
  }]

  let balance = outstanding
  let monthsDone = 0
  const totalMonths = Math.ceil(n)
  let totalInterest = 0
  for (let k = 1; balance > 0.5 && monthsDone < totalMonths; k++) {
    let interest = 0
    let principal = 0
    for (let i = 0; i < 12 && balance > 0.5 && monthsDone < totalMonths; i++, monthsDone++) {
      const it = balance * r
      const pr = Math.min(balance, pmt - it)
      balance -= pr
      interest += it
      principal += pr
    }
    totalInterest += interest
    rows.push({
      year: startYear + k,
      clientAge: ageAt(a.clientAge, k),
      spouseAge: ageAt(a.spouseAge, k),
      paid: interest + principal,
      interest,
      principal,
      balance: Math.max(0, balance),
    })
  }

  return { monthlyPayment: pmt, totalInterest, payoffYear: rows[rows.length - 1].year, rows }
}