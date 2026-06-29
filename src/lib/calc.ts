// Financial Calculations
export function neededMonthly(target: number, ratePercent: number, years: number): number {
  if (years <= 0 || target <= 0) return 0
  const r = ratePercent / 100
  const n = Math.max(1, Math.round(years))
  if (r === 0) return target / (n * 12)
  return (target * r / ((Math.pow(1 + r, n) - 1) * (1 + r))) / 12
}
export function retirementCorpus(monthlyIncomeToday: number,currentAge: number,retirementAge: number,lifeExpectancy: number,inflationPct: number,postReturnPct: number,legacyAmt: number = 0,contInv: boolean = false): number {
  const gi = inflationPct / 100
  const yrsToRet = retirementAge - currentAge
  const drawdownYrs = Math.max(1, lifeExpectancy - retirementAge)
  const fvMo = monthlyIncomeToday * Math.pow(1 + gi, yrsToRet)
  const fvAnn = fvMo * 12
  let corpus: number
  if (!contInv) {
    if (Math.abs(gi) < 0.0001) corpus = fvAnn * drawdownYrs
    else corpus = fvAnn * (Math.pow(1 + gi, drawdownYrs) - 1) / gi * (1 + gi)
  } else {
    const pr = postReturnPct / 100
    if (Math.abs(pr - gi) < 0.0001) corpus = fvAnn * drawdownYrs
    else corpus = fvAnn * (1 - Math.pow((1 + gi) / (1 + pr), drawdownYrs)) / (pr - gi) * (1 + pr)
  }
  if (legacyAmt > 0) {
    const dr = contInv ? postReturnPct / 100 : gi
    corpus += legacyAmt / Math.pow(1 + Math.max(dr, 0.001), drawdownYrs)
  }
  return Math.max(0, corpus)
}
export function projectFwd(currentVal: number, monthlyContrib: number, ratePercent: number, years: number): number {
  const r = ratePercent / 100
  const n = Math.max(0, years)
  if (n === 0) return currentVal
  if (r === 0) return currentVal + monthlyContrib * 12 * n
  return currentVal * Math.pow(1 + r, n) + monthlyContrib * 12 * (Math.pow(1 + r, n) - 1) / r
}
export function calcIRR(cashflows: number[]): number | null {
  if (!cashflows || cashflows.length < 2) return null
  let r = 0.01
  let converged = false
  for (let iter = 0; iter < 300; iter++) {
    let f = 0, df = 0
    for (let t = 0; t < cashflows.length; t++) {
      const disc = Math.pow(1 + r, t)
      f += cashflows[t] / disc
      df -= t * cashflows[t] / Math.pow(1 + r, t + 1)
    }
    if (Math.abs(df) < 1e-14) break
    const rNew = r - f / df
    if (isNaN(rNew) || !isFinite(rNew)) break
    if (Math.abs(rNew - r) < 1e-10) { r = rNew; converged = true; break }
    r = Math.max(-0.999, Math.min(rNew, 50))
  }
  // Running out of iterations without the step-size check ever tripping
  // (e.g. oscillating against the clamp) used to fall through to the bounds
  // check below and get accepted anyway — that's how a non-converged,
  // clamped r produced a "valid-looking" but nonsensical IRR. Require
  // genuine convergence first.
  if (!converged || r <= -0.999 || r >= 50 || isNaN(r) || !isFinite(r)) return null
  // Belt-and-suspenders: confirm the converged rate actually zeroes the NPV,
  // relative to the scale of the cash flows involved.
  let finalF = 0
  for (let t = 0; t < cashflows.length; t++) finalF += cashflows[t] / Math.pow(1 + r, t)
  const scale = cashflows.reduce((s, c) => s + Math.abs(c), 0) || 1
  if (Math.abs(finalF) / scale > 1e-6) return null
  return (Math.pow(1 + r, 12) - 1) * 100
}
export function fmt(n: number): string {
  if (!n || isNaN(n)) return '$0'
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K'
  return sign + '$' + Math.round(a).toLocaleString()
}
export function fmtMo(n: number): string {
  if (!n || isNaN(n)) return '$0'
  return '$' + Math.round(Math.abs(n)).toLocaleString()
}
export function ageFromDob(dob: string): number {
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}
// Future value of a level annuity-due — used by the protection needs engine
// (family dependency, CI family dependency) to turn a constant annual amount
// into a lump-sum capital requirement over a term, compounding at `rate`.
export function fv(rate: number, nper: number, pmt: number): number {
  if (nper <= 0) return 0
  if (rate === 0) return pmt * nper
  return pmt * ((Math.pow(1 + rate, nper) - 1) / rate) * (1 + rate)
}
// Year-only age (currentYear − birthYear, no adjustment for whether the
// birthday has passed yet this year). This is the convention used throughout
// the dashboard (see the duplicated local `getAge` in dashboard/page.tsx,
// objectives/page.tsx, EducationSection.tsx, layout.tsx) — deliberately
// different from ageFromDob above. Use this one for anything that needs to
// match what the rest of the app displays.
export function ageYearOnly(dob?: string): number {
  if (!dob) return 0
  const birth = new Date(dob)
  return Math.max(0, new Date().getFullYear() - birth.getFullYear())
}
// CPF employee contribution rates (Ordinary Wage tiers)
export const SC_RATES = [
  { max_age: 35, employee: 20 }, { max_age: 45, employee: 20 },
  { max_age: 50, employee: 20 }, { max_age: 55, employee: 20 },
  { max_age: 60, employee: 18 }, { max_age: 65, employee: 14.5 },
  { max_age: 70, employee: 7.5 }, { max_age: 999, employee: 5 },
]
export const PR1_RATES = [{ max_age: 999, employee: 5 }]
export const PR2_RATES = [{ max_age: 999, employee: 15 }]
export const CPF_OW_CEILING = 8000
export function getCpfEmpRate(age: number, cit: string, prYear: string): number {
  if (!['SC', 'PR'].includes(cit)) return 0
  const tiers = cit === 'PR' ? (prYear === '1' ? PR1_RATES : prYear === '2' ? PR2_RATES : SC_RATES) : SC_RATES
  return (tiers.find(t => age <= t.max_age) || tiers[tiers.length - 1]).employee
}
// ─── Self-Employed MediSave (SEP) ──────────────────────────────────────────
// Self-employed persons have NO mandatory Employer/Employee CPF contribution
// (there is no employer). They DO have a mandatory MediSave-only contribution
// once annual Net Trade Income (NTI) exceeds $6,000.
// Rates below are CPF Board's official "MediSave Contribution Rates for SEPs
// (Non-Pensioners)" table, applicable 2026.
// Source: cpf.gov.sg — Self-Employed MediSave Contribution Rates (PDF)
export const SEP_EMPLOYMENT_TYPES = ['Self-Employed', 'Business Owner', 'Commission-Based']

export function isSepEmploymentType(employmentType?: string): boolean {
  return SEP_EMPLOYMENT_TYPES.includes(employmentType || '')
}

type SepMedisaveBand = {
  maxAge: number       // "Below 35" / "35 to below 45" / "45 to below 50" / "50 and above"
  lowRate: number      // rate applied to NTI $6,000–$12,000 band
  highRate: number     // rate applied to NTI above $18,000
  highCap: number      // annual MediSave $ cap once NTI is above $18,000
  phaseBase: number    // $ contribution at NTI = $12,000 (start of phase-in band)
  phaseSlope: number   // $ added per $1 of NTI above $12,000, up to $18,000
}

const SEP_MEDISAVE_BANDS: SepMedisaveBand[] = [
  { maxAge: 34,  lowRate: 4.00, highRate: 8.00,  highCap: 7680,  phaseBase: 480, phaseSlope: 0.16 },
  { maxAge: 44,  lowRate: 4.50, highRate: 9.00,  highCap: 8640,  phaseBase: 540, phaseSlope: 0.18 },
  { maxAge: 49,  lowRate: 5.00, highRate: 10.00, highCap: 9600,  phaseBase: 600, phaseSlope: 0.20 },
  { maxAge: 999, lowRate: 5.25, highRate: 10.50, highCap: 10080, phaseBase: 630, phaseSlope: 0.21 },
]

export interface SepMedisaveResult {
  annualNti: number
  rate: number          // effective % of NTI (for display only)
  annualMedisave: number
  applicable: boolean   // false when NTI <= $6,000 — no mandatory contribution that year
}

// annualNti: annual Net Trade Income (proxied in this app as gross_monthly*12 + gross_bonus
// for Self-Employed / Business Owner / Commission-Based persons).
export function calcSepMedisave(annualNti: number, age: number): SepMedisaveResult {
  if (annualNti <= 6000) return { annualNti, rate: 0, annualMedisave: 0, applicable: false }
  const band = SEP_MEDISAVE_BANDS.find(b => age <= b.maxAge) ?? SEP_MEDISAVE_BANDS[SEP_MEDISAVE_BANDS.length - 1]
  let amount: number
  if (annualNti <= 12000) {
    amount = (annualNti * band.lowRate) / 100
  } else if (annualNti <= 18000) {
    amount = band.phaseBase + band.phaseSlope * (annualNti - 12000)
  } else {
    amount = Math.min((annualNti * band.highRate) / 100, band.highCap)
  }
  amount = Math.round(amount)
  const rate = annualNti > 0 ? Math.round((amount / annualNti) * 1000) / 10 : 0
  return { annualNti, rate, annualMedisave: amount, applicable: true }
}

// Annual take-home pay, branching on employment type. Self-Employed / Business
// Owner / Commission-Based have no mandatory Employer/Employee CPF contribution
// (there is no employer) — only MediSave, based on age and annual Net Trade
// Income (proxied as gross_monthly*12 + gross_bonus). Foreigners have neither.
// Shared by financialPlanSnapshot.ts, executiveWealthSummarySnapshot.ts, and
// dashboard/page.tsx so this logic only ever lives in one place.
export function calcAnnualTakeHome(gross: number, bonus: number, age: number, citizenship: string, prYear: string, employmentType?: string): number {
  const annualGross = gross * 12 + bonus
  if (isSepEmploymentType(employmentType)) {
    if (!['SC', 'PR'].includes(citizenship)) return annualGross
    const sep = calcSepMedisave(annualGross, age)
    return annualGross - sep.annualMedisave
  }
  const empRate = getCpfEmpRate(age, citizenship, prYear) / 100
  const monthlyCpf = Math.floor(Math.min(gross, CPF_OW_CEILING) * empRate)
  const bonusCpf = Math.floor(bonus * empRate)
  return (gross - monthlyCpf) * 12 + (bonus - bonusCpf)
}

export function amortisedOutstanding(prop: any): number {
  if (prop.outstanding > 0) return prop.outstanding
  const initialLoan = prop.initialLoanAmount ?? 0
  const annualRate  = prop.interestRate ?? 0
  const tenure      = prop.initialTenure ?? 25
  const start       = prop.loanStartDate ?? ''
  if (!initialLoan || !tenure) return 0
  const parts = start.split('/')
  if (parts.length !== 2) return initialLoan
  const startDate = new Date(parseInt(parts[1]), parseInt(parts[0]) - 1, 1)
  const today2 = new Date()
  const months = (today2.getFullYear() - startDate.getFullYear()) * 12 +
    (today2.getMonth() - startDate.getMonth())
  if (months <= 0) return initialLoan
  const n = tenure * 12
  if (months >= n) return 0
  if (!annualRate) return Math.round(initialLoan * (1 - months / n))
  const rv = annualRate / 100 / 12
  const pmt = initialLoan * rv * Math.pow(1 + rv, n) / (Math.pow(1 + rv, n) - 1)
  return Math.max(0, Math.round(
    initialLoan * Math.pow(1 + rv, months) -
    pmt * (Math.pow(1 + rv, months) - 1) / rv
  ))
}
