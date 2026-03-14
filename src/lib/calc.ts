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
    if (Math.abs(rNew - r) < 1e-10) { r = rNew; break }
    r = Math.max(-0.999, Math.min(rNew, 50))
  }
  if (r > -0.999 && r < 50 && !isNaN(r) && isFinite(r)) return (Math.pow(1 + r, 12) - 1) * 100
  return null
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