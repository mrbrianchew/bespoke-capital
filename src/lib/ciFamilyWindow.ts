import { fv } from './calc'

// CI "Family living" is sized for a diagnosis that comes late, not only one
// that happens today. The recovery window (ciYears, e.g. 5) is placed so it
// ENDS at the end of the planning period, and expenses are inflated to those
// years. A claim earlier than that needs less, so the sized figure also covers
// every earlier diagnosis.
//
// End of the planning period (counted in years from today):
//   - client has children still to graduate: when the youngest graduates
//     (the coverage term), but never later than the CI person's retirement —
//     after retirement a CI claim no longer cuts earned income
//   - no children (or all graduated): the CI person's retirement age
//   - never earlier than ciYears, so the figure is never lower than a claim today
//
// Same convention as fv() in calc.ts: each year's expense is inflated once
// per year counted from today (first year × (1+r)).

export interface CIWindowEndInput {
  ciYears: number
  hasDependentChildren: boolean
  coverageTerm: number
  currentAge: number
  retireAge: number
}

export function ciWindowEndYear(i: CIWindowEndInput): number {
  const yearsToRetire = Math.max(0, i.retireAge - i.currentAge)
  const target = i.hasDependentChildren && i.coverageTerm > 0
    ? Math.min(i.coverageTerm, yearsToRetire)
    : yearsToRetire
  return Math.max(i.ciYears, target)
}

// Multiplier on one year of expenses (today's prices) for the ciYears-long
// window that ends at endYear. When endYear === ciYears this equals the old
// fv(inflation, ciYears, 1), i.e. a claim starting today.
export function ciWindowFactor(inflation: number, ciYears: number, endYear: number): number {
  return ciWindowFactorFrom(inflation, ciYears, endYear, 0)
}

// Same, but only the part of the window still ahead of fromYear (years from
// today). Used for the need-by-age curve: flat while the whole window is still
// ahead, then shrinking through the final ciYears, reaching 0 at endYear.
export function ciWindowFactorFrom(inflation: number, ciYears: number, endYear: number, fromYear: number): number {
  const start = Math.max(fromYear, endYear - ciYears, 0)
  return Math.max(0, fv(inflation, endYear, 1) - fv(inflation, start, 1))
}