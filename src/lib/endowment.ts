// Endowment maths: premium schedule + three returns (current, guaranteed, total).
// Pure functions only. No React, no Supabase, no side effects.
//
// All dates are 'YYYY-MM' strings and are turned into whole-month numbers first,
// so the answer cannot shift by a day or a month because of timezones.

export type EndowmentFreq = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'

export const ENDOWMENT_FREQS: { value: EndowmentFreq; label: string; stepMonths: number; perYear: number }[] = [
  { value: 'monthly', label: 'Monthly', stepMonths: 1, perYear: 12 },
  { value: 'quarterly', label: 'Quarterly', stepMonths: 3, perYear: 4 },
  { value: 'half_yearly', label: 'Half-yearly', stepMonths: 6, perYear: 2 },
  { value: 'yearly', label: 'Yearly', stepMonths: 12, perYear: 1 },
]

function freqInfo(f: EndowmentFreq | undefined) {
  return ENDOWMENT_FREQS.find(x => x.value === f) ?? ENDOWMENT_FREQS[0]
}

export interface EndowmentTerms {
  startMonth: string          // policy start, 'YYYY-MM'
  maturityMonth: string       // policy maturity, 'YYYY-MM'
  premiumEndMonth?: string    // first month with NO premium. Blank = maturity month
  freq: EndowmentFreq
  premium: number             // amount per payment (not per month)
  guaranteed: number          // guaranteed maturity value
  nonGuaranteed: number       // projected non-guaranteed part
  surrenderValue: number      // surrender value today (or at asOfMonth)
  asOfMonth?: string          // when surrenderValue was taken. Blank = today
}

export interface EndowmentResult {
  paymentsTotal: number       // premium payments over the whole policy
  paymentsMade: number        // payments already made (completed months only)
  totalPremiums: number
  premiumsPaid: number
  totalMaturity: number       // guaranteed + non-guaranteed
  monthlyEquivalent: number   // premium spread to a monthly figure
  monthsHeld: number          // months from first premium to the as-at date
  currentIrr: number | null   // decimals: 0.034 = 3.4% a year
  guaranteedIrr: number | null
  totalIrr: number | null
}

function toIdx(ym: string | undefined): number | null {
  if (!ym) return null
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) return null
  const mo = parseInt(m[2], 10)
  if (mo < 1 || mo > 12) return null
  return parseInt(m[1], 10) * 12 + (mo - 1)
}

function idxToMs(idx: number): number {
  return Date.UTC(Math.floor(idx / 12), idx % 12, 1)
}

function todayIdx(today: Date): number {
  return today.getFullYear() * 12 + today.getMonth()
}

function todayMs(today: Date): number {
  return Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
}

// Month numbers of every premium: from the start month up to (not including) the premium end month.
function scheduleIdx(t: Pick<EndowmentTerms, 'startMonth' | 'maturityMonth' | 'premiumEndMonth' | 'freq'>): number[] {
  const start = toIdx(t.startMonth)
  const mat = toIdx(t.maturityMonth)
  if (start === null || mat === null || mat <= start) return []
  const end = toIdx(t.premiumEndMonth) ?? mat
  if (end <= start || end > mat) return []
  const step = freqInfo(t.freq).stepMonths
  const out: number[] = []
  for (let i = start; i < end; i += step) out.push(i)
  return out
}

// Plain-words problem with the dates, or null when fine / not filled in yet.
export function endowmentTermsError(t: Pick<EndowmentTerms, 'startMonth' | 'maturityMonth' | 'premiumEndMonth'>): string | null {
  const start = toIdx(t.startMonth)
  const mat = toIdx(t.maturityMonth)
  const pe = toIdx(t.premiumEndMonth)
  if (start !== null && mat !== null && mat <= start) return 'Maturity must be after the start month.'
  if (pe !== null && start !== null && pe <= start) return 'Premiums must end after the start month.'
  if (pe !== null && mat !== null && pe > mat) return 'Premiums cannot run past the maturity month.'
  return null
}

// Annual IRR from dated cash flows. Returns decimals, or null when it cannot be solved.
// Day count is actual/365 (same as Excel XIRR).
function irr(flows: { ms: number; amount: number }[]): number | null {
  if (flows.length < 2) return null
  if (!flows.some(f => f.amount < 0) || !flows.some(f => f.amount > 0)) return null
  const sorted = [...flows].sort((a, b) => a.ms - b.ms)
  const t0 = sorted[0].ms
  const yrs = sorted.map(f => (f.ms - t0) / (365 * 86400000))
  const npv = (r: number) => sorted.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, yrs[i]), 0)
  let lo = -0.99
  let hi = 100
  if (npv(lo) * npv(hi) > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (npv(lo) * npv(mid) <= 0) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

export function calcEndowment(t: EndowmentTerms, today: Date = new Date()): EndowmentResult | null {
  const sched = scheduleIdx(t)
  if (sched.length === 0) return null
  const mat = toIdx(t.maturityMonth) as number
  const premium = t.premium > 0 ? t.premium : 0
  const info = freqInfo(t.freq)

  // "As at" point for the surrender value
  const asOf = toIdx(t.asOfMonth)
  const asOfIdx = asOf ?? todayIdx(today)
  const asOfMs = asOf !== null ? idxToMs(asOf) : todayMs(today)

  // Same rule as the rest of Capital Mandate: a premium counts once its month has fully passed.
  const made = sched.filter(i => i < asOfIdx)
  const totalMaturity = (t.guaranteed > 0 ? t.guaranteed : 0) + (t.nonGuaranteed > 0 ? t.nonGuaranteed : 0)

  const outflows = (idxs: number[]) => idxs.map(i => ({ ms: idxToMs(i), amount: -premium }))
  const matMs = idxToMs(mat)

  // Under a year held, an "annual" return is mostly noise (it shows -70% and the like), so leave it blank.
  const monthsHeld = made.length > 0 ? Math.max(0, asOfIdx - sched[0]) : 0
  let currentIrr: number | null = null
  if (premium > 0 && made.length > 0 && monthsHeld >= 12 && t.surrenderValue > 0 && asOfMs > idxToMs(made[0])) {
    currentIrr = irr([...outflows(made), { ms: asOfMs, amount: t.surrenderValue }])
  }
  const guaranteedIrr = premium > 0 && t.guaranteed > 0
    ? irr([...outflows(sched), { ms: matMs, amount: t.guaranteed }])
    : null
  const totalIrr = premium > 0 && totalMaturity > 0
    ? irr([...outflows(sched), { ms: matMs, amount: totalMaturity }])
    : null

  return {
    paymentsTotal: sched.length,
    paymentsMade: made.length,
    totalPremiums: premium * sched.length,
    premiumsPaid: premium * made.length,
    totalMaturity,
    monthlyEquivalent: (premium * info.perYear) / 12,
    monthsHeld,
    currentIrr,
    guaranteedIrr,
    totalIrr,
  }
}

// ─── Helpers for a saved vehicle (so other code never needs to know the field names) ──

export interface EndowmentVehicleFields {
  currentValue?: number
  valueAsOfMonth?: string
  endowmentStartMonth?: string
  endowmentMaturityMonth?: string
  endowmentPremiumEndMonth?: string
  endowmentFreq?: EndowmentFreq
  endowmentPremiumPerPayment?: number
  endowmentGuaranteedValue?: number
  endowmentNonGuaranteedValue?: number
}

// Terms of a saved vehicle, or null for older records that never got the new fields.
export function termsFromVehicle(v: EndowmentVehicleFields): EndowmentTerms | null {
  if (!v.endowmentStartMonth || !v.endowmentMaturityMonth) return null
  return {
    startMonth: v.endowmentStartMonth,
    maturityMonth: v.endowmentMaturityMonth,
    premiumEndMonth: v.endowmentPremiumEndMonth,
    freq: v.endowmentFreq ?? 'monthly',
    premium: v.endowmentPremiumPerPayment ?? 0,
    guaranteed: v.endowmentGuaranteedValue ?? 0,
    nonGuaranteed: v.endowmentNonGuaranteedValue ?? 0,
    surrenderValue: v.currentValue ?? 0,
    asOfMonth: v.valueAsOfMonth || undefined,
  }
}

// Premiums actually due in one calendar year, or null for older records (caller keeps its old maths).
export function endowmentPremiumsInYear(v: EndowmentVehicleFields, year: number): number | null {
  const t = termsFromVehicle(v)
  if (!t) return null
  const per = t.premium > 0 ? t.premium : 0
  return scheduleIdx(t).filter(i => Math.floor(i / 12) === year).length * per
}

// Dated premium outflows already paid (completed months), or null for older records.
export function endowmentPaidFlows(v: EndowmentVehicleFields, today: Date = new Date()): { date: Date; amount: number }[] | null {
  const t = termsFromVehicle(v)
  if (!t) return null
  const per = t.premium > 0 ? t.premium : 0
  return scheduleIdx(t)
    .filter(i => i < todayIdx(today))
    .map(i => ({ date: new Date(idxToMs(i)), amount: -per }))
}