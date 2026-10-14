// Historical CPF contribution rates (Singapore Citizens and PRs in their 3rd year
// onwards), monthly Ordinary Wage ceilings and allocation rates, by effective date.
//
// Source: CPF Board datasets on data.gov.sg ("CPF contribution rates", "Ordinary wage
// ceiling", "CPF allocation rates"), cross-checked against CPF Board's published rate
// tables for 2016 and for the 2022-2026 senior-worker changes.
//
// Used ONLY to show a saved plan version the way it would have calculated in its
// as-at month (age and rates of that time). It never touches the live plan.
//
// Known approximations, shown to the user:
//  - Before 2007-07 the 2007-07 table is used.
//  - Allocation (OA/SA/MA split) before 2014-01 uses the 2014-01 split. Take-home pay
//    does not depend on it.
//  - PR 1st/2nd-year (graduated) rates are not in this table; the page keeps using its
//    current PR tables for every year.

export interface HistTier { max_age: number; employee: number; employer: number; oa: number; sa: number; ma: number }
export interface HistConfig { ow_ceiling: number; annual_ceiling: number; effective_date: string; sc_rates: HistTier[] }

type Triple = [number, number, number] // share of total contribution: OA, SA/RA, MA

interface RatePeriod {
  from: string // 'YYYY-MM'
  ow: number
  seniors: 'old' | 'new' // 'old' = 7 age bands (one 65+ band); 'new' = 8 bands (65-70 and 70+ split) from 2022
  employee: number[]
  employer: number[]
  alloc: string
}

const BANDS_OLD = [35, 45, 50, 55, 60, 65, 999]
const BANDS_NEW = [35, 45, 50, 55, 60, 65, 70, 999]

const ALLOC: Record<string, Triple[]> = {
  '2014-01': [[.6390,.1666,.1944],[.5834,.1944,.2222],[.5278,.2222,.2500],[.4154,.2923,.2923],[.5107,.0851,.4042],[.2415,.1034,.6551],[.0871,.0869,.8260]],
  '2015-01': [[.6217,.1621,.2162],[.5677,.1891,.2432],[.5136,.2162,.2702],[.4000,.3000,.3000],[.4800,.1000,.4200],[.2188,.1250,.6562],[.0800,.0800,.8400]],
  '2016-01': [[.6217,.1621,.2162],[.5677,.1891,.2432],[.5136,.2162,.2702],[.4055,.3108,.2837],[.4616,.1346,.4038],[.2122,.1515,.6363],[.0800,.0800,.8400]],
  '2022-01': [[.6217,.1621,.2162],[.5677,.1891,.2432],[.5136,.2162,.2702],[.4055,.3108,.2837],[.4286,.1964,.3750],[.1893,.2432,.5675],[.0715,.1785,.7500],[.0800,.0800,.8400]],
  '2023-01': [[.6217,.1621,.2162],[.5677,.1891,.2432],[.5136,.2162,.2702],[.4055,.3108,.2837],[.4069,.2372,.3559],[.1709,.3170,.5121],[.0646,.2580,.6774],[.0800,.0800,.8400]],
  '2024-01': [[.6217,.1621,.2162],[.5677,.1891,.2432],[.5136,.2162,.2702],[.4055,.3108,.2837],[.3872,.2741,.3387],[.1592,.3636,.4772],[.0607,.3030,.6363],[.0800,.0800,.8400]],
  '2025-01': [[.6217,.1621,.2162],[.5677,.1891,.2432],[.5136,.2162,.2702],[.4055,.3108,.2837],[.3694,.3076,.3230],[.1490,.4042,.4468],[.0607,.3030,.6363],[.0800,.0800,.8400]],
  '2026-01': [[.6217,.1621,.2162],[.5677,.1891,.2432],[.5136,.2162,.2702],[.4055,.3108,.2837],[.3530,.3382,.3088],[.1400,.4400,.4200],[.0607,.3030,.6363],[.0800,.0800,.8400]],
}

// Employee / employer % by age band: [<=35, 35-45, 45-50, 50-55, 55-60, 60-65, 65+] (old)
// or [<=35, 35-45, 45-50, 50-55, 55-60, 60-65, 65-70, 70+] (new).
const PERIODS: RatePeriod[] = [
  { from: '2007-07', ow: 4500, seniors: 'old', employee: [20, 20, 20, 18, 12.5, 7.5, 5], employer: [14.5, 14.5, 14.5, 10.5, 7.5, 5, 5], alloc: '2014-01' },
  { from: '2010-09', ow: 4500, seniors: 'old', employee: [20, 20, 20, 18, 12.5, 7.5, 5], employer: [15, 15, 15, 11, 8, 5.5, 5.5], alloc: '2014-01' },
  { from: '2011-03', ow: 4500, seniors: 'old', employee: [20, 20, 20, 18, 12.5, 7.5, 5], employer: [15.5, 15.5, 15.5, 11.5, 8.5, 6, 6], alloc: '2014-01' },
  { from: '2011-09', ow: 5000, seniors: 'old', employee: [20, 20, 20, 18, 12.5, 7.5, 5], employer: [16, 16, 16, 12, 9, 6.5, 6.5], alloc: '2014-01' },
  { from: '2012-09', ow: 5000, seniors: 'old', employee: [20, 20, 20, 18.5, 13, 7.5, 5], employer: [16, 16, 16, 14, 10.5, 7, 6.5], alloc: '2014-01' },
  { from: '2014-01', ow: 5000, seniors: 'old', employee: [20, 20, 20, 18.5, 13, 7.5, 5], employer: [16, 16, 16, 14, 10.5, 7, 6.5], alloc: '2014-01' },
  { from: '2015-01', ow: 5000, seniors: 'old', employee: [20, 20, 20, 19, 13, 7.5, 5], employer: [17, 17, 17, 16, 12, 8.5, 7.5], alloc: '2015-01' },
  { from: '2016-01', ow: 6000, seniors: 'old', employee: [20, 20, 20, 20, 13, 7.5, 5], employer: [17, 17, 17, 17, 13, 9, 7.5], alloc: '2016-01' },
  { from: '2022-01', ow: 6000, seniors: 'new', employee: [20, 20, 20, 20, 14, 8.5, 6, 5], employer: [17, 17, 17, 17, 14, 10, 8, 7.5], alloc: '2022-01' },
  { from: '2023-01', ow: 6000, seniors: 'new', employee: [20, 20, 20, 20, 15, 9.5, 7, 5], employer: [17, 17, 17, 17, 14.5, 11, 8.5, 7.5], alloc: '2023-01' },
  { from: '2023-09', ow: 6300, seniors: 'new', employee: [20, 20, 20, 20, 15, 9.5, 7, 5], employer: [17, 17, 17, 17, 14.5, 11, 8.5, 7.5], alloc: '2023-01' },
  { from: '2024-01', ow: 6800, seniors: 'new', employee: [20, 20, 20, 20, 16, 10.5, 7.5, 5], employer: [17, 17, 17, 17, 15, 11.5, 9, 7.5], alloc: '2024-01' },
  { from: '2025-01', ow: 7400, seniors: 'new', employee: [20, 20, 20, 20, 17, 11.5, 7.5, 5], employer: [17, 17, 17, 17, 15.5, 12, 9, 7.5], alloc: '2025-01' },
  { from: '2026-01', ow: 8000, seniors: 'new', employee: [20, 20, 20, 20, 18, 12.5, 7.5, 5], employer: [17, 17, 17, 17, 16, 12.5, 9, 7.5], alloc: '2026-01' },
]

const r2 = (n: number) => Math.round(n * 100) / 100

function build(p: RatePeriod): HistConfig {
  const bands = p.seniors === 'new' ? BANDS_NEW : BANDS_OLD
  const alloc = ALLOC[p.alloc]
  return {
    ow_ceiling: p.ow,
    annual_ceiling: 102000, // not used by the take-home calculation
    effective_date: p.from + '-01',
    sc_rates: bands.map((max_age, i) => {
      const total = p.employee[i] + p.employer[i]
      const a = alloc[i]
      return { max_age, employee: p.employee[i], employer: p.employer[i], oa: r2(a[0] * total), sa: r2(a[1] * total), ma: r2(a[2] * total) }
    }),
  }
}

const EARLIEST = PERIODS[0].from

/** CPF settings in force in the as-at month ('YYYY-MM-01'). */
export function cpfConfigAt(asAt: string): { config: HistConfig; period: string; approximate: boolean } {
  const ym = asAt.slice(0, 7)
  let pick = PERIODS[0]
  for (const p of PERIODS) if (p.from <= ym) pick = p
  return { config: build(pick), period: pick.from, approximate: ym < EARLIEST }
}

/**
 * Age to use for CPF in the as-at month. CPF moves a person to the next age band
 * from the month AFTER the birthday month, so the age counted is the one completed
 * by the last day of the previous month. Falls back to today's stored age minus the
 * years elapsed when there is no date of birth.
 */
export function ageForCpfAt(dob: string | null | undefined, storedAgeToday: number | null | undefined, asAt: string, today: Date = new Date()): { age: number; estimated: boolean } | null {
  const [ay, am] = asAt.split('-').map(Number)
  if (dob && /^\d{4}-\d{2}-\d{2}/.test(dob)) {
    const [by, bm, bd] = dob.slice(0, 10).split('-').map(Number)
    // last day of the month before the as-at month
    const ref = new Date(Date.UTC(ay, am - 1, 0))
    const ry = ref.getUTCFullYear(), rm = ref.getUTCMonth() + 1, rd = ref.getUTCDate()
    let age = ry - by
    if (rm < bm || (rm === bm && rd < bd)) age -= 1
    return { age: Math.max(age, 0), estimated: false }
  }
  if (typeof storedAgeToday === 'number' && storedAgeToday > 0) {
    return { age: Math.max(storedAgeToday - (today.getFullYear() - ay), 0), estimated: true }
  }
  return null
}

/** 'YYYY-MM-01' of the current month in Singapore. */
export function currentMonthStartSG(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const y = parts.find(p => p.type === 'year')?.value
  const m = parts.find(p => p.type === 'month')?.value
  return `${y}-${m}-01`
}