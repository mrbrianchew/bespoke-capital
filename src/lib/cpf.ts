/**
 * cpf.ts — Bespoke Capital
 * Singapore CPF calculation engine (2026 rates)
 *
 * OW/AW ceilings are NOT hardcoded here — they are passed in from
 * getCpfSettings() which reads from the cpf_settings Supabase table.
 * This means the creator can update ceilings in the admin panel and
 * all calculations across all advisor accounts update instantly.
 *
 * CPF contribution rates last verified: January 2026
 * Source: https://www.cpf.gov.sg/employer/employer-guides/paying-cpf-contributions/cpf-contribution-and-allocation-rates
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmploymentType = "employee" | "self-employed" | "employer-only"
export type CitizenshipStatus = "citizen" | "pr1" | "pr2" | "foreigner"

export interface CpfCeilings {
  owCeiling: number   // Monthly OW ceiling — update annually (2026: $8,000)
  awCeiling: number   // Annual AW base ceiling (currently $102,000)
}

export interface CpfInput {
  grossMonthly: number
  age: number
  employmentType: EmploymentType
  citizenship: CitizenshipStatus
  ceilings?: CpfCeilings  // If omitted, falls back to DEFAULT_CEILINGS
}

export interface CpfRates {
  employee: number
  employer: number
  total: number
}

export interface CpfAllocations {
  oa: number
  sa: number
  ma: number
}

export interface CpfResult {
  grossMonthly: number
  employeeContribution: number
  employerContribution: number
  totalContribution: number
  takeHomePay: number
  oa: number
  sa: number
  ma: number
  saLabel: "SA" | "RA"
  rates: CpfRates
  ceilings: CpfCeilings
  wageSubjectToCpf: number
}

// ─── Fallback ceilings (update if Supabase is unavailable) ───────────────────

export const DEFAULT_CEILINGS: CpfCeilings = {
  owCeiling: 8000,    // 2026
  awCeiling: 102000,
}

// ─── Contribution Rate Tables ─────────────────────────────────────────────────

type RateBand = { maxAge: number; employee: number; employer: number }

const CITIZEN_RATES: RateBand[] = [
  { maxAge: 55,  employee: 20,   employer: 17   },
  { maxAge: 60,  employee: 15,   employer: 15   },
  { maxAge: 65,  employee: 9.5,  employer: 11.5 },
  { maxAge: 70,  employee: 7,    employer: 9    },
  { maxAge: 999, employee: 5,    employer: 7.5  },
]

const PR1_RATES: RateBand[] = [
  { maxAge: 55,  employee: 5,    employer: 4    },
  { maxAge: 60,  employee: 5,    employer: 4    },
  { maxAge: 65,  employee: 3.5,  employer: 3.5  },
  { maxAge: 999, employee: 3.5,  employer: 3.5  },
]

const PR2_RATES: RateBand[] = [
  { maxAge: 55,  employee: 15,   employer: 8    },
  { maxAge: 60,  employee: 12,   employer: 6    },
  { maxAge: 65,  employee: 7.5,  employer: 5    },
  { maxAge: 999, employee: 5,    employer: 5    },
]

// ─── Allocation Rate Tables ───────────────────────────────────────────────────

type AllocationBand = { maxAge: number; oa: number; sa: number; ma: number }

const ALLOCATION_RATES: AllocationBand[] = [
  { maxAge: 35,  oa: 62.17, sa: 16.21, ma: 21.62 },
  { maxAge: 45,  oa: 56.57, sa: 18.56, ma: 24.87 },
  { maxAge: 50,  oa: 51.78, sa: 17.49, ma: 30.73 },
  { maxAge: 55,  oa: 42.54, sa: 14.11, ma: 43.35 },
  { maxAge: 999, oa: 20.77, sa: 0,     ma: 79.23 },  // 55+: no SA, goes to RA
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRates(age: number, citizenship: CitizenshipStatus): CpfRates {
  const table =
    citizenship === "pr1" ? PR1_RATES :
    citizenship === "pr2" ? PR2_RATES :
    CITIZEN_RATES
  const band = table.find(b => age <= b.maxAge) ?? table[table.length - 1]
  return { employee: band.employee, employer: band.employer, total: band.employee + band.employer }
}

function getAllocations(age: number): CpfAllocations {
  const band = ALLOCATION_RATES.find(b => age <= b.maxAge) ?? ALLOCATION_RATES[ALLOCATION_RATES.length - 1]
  return { oa: band.oa, sa: band.sa, ma: band.ma }
}

const round = (n: number) => Math.round(n)

// ─── Main: monthly CPF ────────────────────────────────────────────────────────

export function calcCpf(input: CpfInput): CpfResult {
  const { grossMonthly, age, employmentType, citizenship } = input
  const ceilings = input.ceilings ?? DEFAULT_CEILINGS

  if (citizenship === "foreigner") return buildNoCpfResult(grossMonthly, age, ceilings)
  if (employmentType === "self-employed") return calcSelfEmployedCpf(input, ceilings)

  const wageSubjectToCpf = Math.min(grossMonthly, ceilings.owCeiling)
  const rates = getRates(age, citizenship)
  const alloc = getAllocations(age)

  const employeeContrib = round((wageSubjectToCpf * rates.employee) / 100)
  const employerContrib = round((wageSubjectToCpf * rates.employer) / 100)
  const totalContrib = employeeContrib + employerContrib

  const oa = round((totalContrib * alloc.oa) / 100)
  const ma = round((totalContrib * alloc.ma) / 100)
  const sa = totalContrib - oa - ma

  return {
    grossMonthly,
    employeeContribution: employeeContrib,
    employerContribution: employerContrib,
    totalContribution: totalContrib,
    takeHomePay: grossMonthly - employeeContrib,
    oa, sa, ma,
    saLabel: age > 55 ? "RA" : "SA",
    rates,
    ceilings,
    wageSubjectToCpf,
  }
}

// ─── Self-employed (Medisave only) ────────────────────────────────────────────

function calcSelfEmployedCpf(input: CpfInput, ceilings: CpfCeilings): CpfResult {
  const { grossMonthly, age } = input
  const maRate = age <= 35 ? 8 : age <= 45 ? 9 : age <= 50 ? 9.5 : 10.5
  const annualMA = Math.min((grossMonthly * 12 * maRate) / 100, 10800)
  const monthlyMA = round(annualMA / 12)

  return {
    grossMonthly,
    employeeContribution: monthlyMA,
    employerContribution: 0,
    totalContribution: monthlyMA,
    takeHomePay: grossMonthly - monthlyMA,
    oa: 0, sa: 0, ma: monthlyMA,
    saLabel: age > 55 ? "RA" : "SA",
    rates: { employee: maRate, employer: 0, total: maRate },
    ceilings,
    wageSubjectToCpf: grossMonthly,
  }
}

// ─── Foreigner (no CPF) ───────────────────────────────────────────────────────

function buildNoCpfResult(grossMonthly: number, age: number, ceilings: CpfCeilings): CpfResult {
  return {
    grossMonthly,
    employeeContribution: 0,
    employerContribution: 0,
    totalContribution: 0,
    takeHomePay: grossMonthly,
    oa: 0, sa: 0, ma: 0,
    saLabel: age > 55 ? "RA" : "SA",
    rates: { employee: 0, employer: 0, total: 0 },
    ceilings,
    wageSubjectToCpf: 0,
  }
}

// ─── Annual CPF (bonus + AW ceiling) ─────────────────────────────────────────

export function calcCpfAnnual(
  monthlyGross: number,
  annualBonus: number,
  age: number,
  citizenship: CitizenshipStatus,
  ceilings: CpfCeilings = DEFAULT_CEILINGS
) {
  const rates = getRates(age, citizenship)
  const monthlyOW = Math.min(monthlyGross, ceilings.owCeiling)
  const annualOW = monthlyOW * 12
  const awCeilingEffective = Math.max(0, ceilings.awCeiling - annualOW)
  const awSubject = Math.min(annualBonus, awCeilingEffective)
  const totalWage = annualOW + awSubject

  const employeeAnnual = round((totalWage * rates.employee) / 100)
  const employerAnnual = round((totalWage * rates.employer) / 100)

  return {
    employeeAnnual,
    employerAnnual,
    totalAnnual: employeeAnnual + employerAnnual,
    takeHomeAnnual: monthlyGross * 12 + annualBonus - employeeAnnual,
    awCeilingEffective,
  }
}

// ─── Convenience exports ──────────────────────────────────────────────────────

export function getCpfRates(age: number, citizenship: CitizenshipStatus): CpfRates {
  return getRates(age, citizenship)
}

export function getCpfAllocations(age: number): CpfAllocations {
  return getAllocations(age)
}
