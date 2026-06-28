'use client'
import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)

// ─── TYPES ───────────────────────────────────────────────────────────────────

type PlanMode = 'couple' | 'individual'
type ActivePerson = 'client' | 'spouse' | 'combined'
type IncomeSource = 'desired' | 'current'
type VehicleType = 'investment' | 'cpf_life' | 'srs' | 'endowment' | 'annuity' | 'rental' | 'other'

interface CashflowEvent {
  id: string
  date: string        // YYYY-MM
  endDate?: string    // YYYY-MM — used for premium_holiday ranges
  type: 'contribution' | 'withdrawal' | 'top_up' | 'premium_holiday' | 'contribution_change' | 'end_contributions' | 'missed_premium'
  amount: number
  note?: string
}

interface FundingVehicle {
  id: string
  name: string
  vehicleType: VehicleType
  owner: 'client' | 'spouse' | 'joint'
  currentValue: number
  monthlyContribution: number
  expectedReturn: number
  startYear: number
  mode: 'Regular' | 'Lump Sum'
  startMonth?: string   // YYYY-MM
  endMonth?: string     // YYYY-MM
  valueAsOfMonth?: string // YYYY-MM
  cpfScheme?: 'BRS' | 'FRS' | 'ERS'
  cpfMonthlyPayout?: number
  cpfPayoutStartAge?: number
  endowmentMaturityValue?: number
  endowmentMaturityYear?: number
  endowmentPremium?: number
  annuityMonthlyIncome?: number
  annuityStartAge?: number
  annuityGuaranteeYears?: number
  rentalMonthlyNet?: number
  rentalStopAge?: number
  srsAnnualContribution?: number
  srsContributionMode?: 'regular' | 'lumpsum'
  srsStartYear?: number
  srsIsRegular?: boolean
  srsWithdrawalStartAge?: number
  srsWithdrawalDuration?: number
  annualizedReturn?: number | null
  totalContributed?: number
  cashflows: CashflowEvent[]
}

interface CapitalGoal {
  id: string
  source: 'retirement' | 'wealth' | 'education' | 'custom'
  label: string
  targetCorpus: number
  monthlyRequired: number
  targetAge: number
  yearsAway: number
  icon: string
  owner: 'client' | 'spouse' | 'joint'
}

interface CMSettings {
  expectedReturn: number
  legacyAmount: number
  incomeSource: IncomeSource
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (!n || isNaN(n)) return 'S$0'
  if (n >= 1_000_000) return 'S$' + (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return 'S$' + Math.round(n).toLocaleString('en-SG')
  return 'S$' + Math.round(n)
}
function fmtMo(n: number) {
  return 'S$' + Math.round(n).toLocaleString('en-SG') + '/mo'
}
function newId() {
  return 'cm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5)
}
function fmtAge(clientDisplayAge: number, isCouple: boolean, clientAge: number, spouseAge: number): string {
  if (!isCouple) return `Age ${clientDisplayAge}`
  const spouseDisplayAge = spouseAge + (clientDisplayAge - clientAge)
  return `Age ${clientDisplayAge} / ${spouseDisplayAge}`
}
function calcMonthlyRequired(corpus: number, yearsLeft: number, annualReturn: number): number {
  if (corpus <= 0 || yearsLeft <= 0) return 0
  const r = annualReturn / 100
  const rm = r / 12
  const nm = yearsLeft * 12
  // Annuity-due: payments at start of period (matches projection loop convention)
  return rm > 0 ? corpus * rm / ((Math.pow(1 + rm, nm) - 1) * (1 + rm)) : corpus / nm
}

// FV of an annuity-due stream of monthly payments
function fvAnnuityDue(monthly: number, annualRate: number, years: number): number {
  if (monthly <= 0 || years <= 0) return 0
  const rm = annualRate / 12
  const nm = years * 12
  if (rm === 0) return monthly * nm
  return monthly * ((Math.pow(1 + rm, nm) - 1) / rm) * (1 + rm)
}

// XIRR: Newton-Raphson solver
function xirr(cashflows: { amount: number; date: Date }[]): number | null {
  if (cashflows.length < 2) return null
  const hasNeg = cashflows.some(c => c.amount < 0)
  const hasPos = cashflows.some(c => c.amount > 0)
  if (!hasNeg || !hasPos) return null
  const t0 = cashflows[0].date.getTime()
  const years = cashflows.map(c => (c.date.getTime() - t0) / (365.25 * 24 * 3600 * 1000))
  function npv(r: number) {
    return cashflows.reduce((s, c, i) => s + c.amount / Math.pow(1 + r, years[i]), 0)
  }
  function dnpv(r: number) {
    return cashflows.reduce((s, c, i) => s - years[i] * c.amount / Math.pow(1 + r, years[i] + 1), 0)
  }
  let r = 0.1
  for (let i = 0; i < 100; i++) {
    const f = npv(r); const df = dnpv(r)
    if (Math.abs(df) < 1e-12) break
    const nr = r - f / df
    if (Math.abs(nr - r) < 1e-8) return Math.round(nr * 10000) / 100
    r = nr
    if (r < -0.999) r = -0.5
    if (r > 10) r = 1
  }
  return null
}

function computeXIRR(vehicle: FundingVehicle): number | null {
  if (!vehicle.cashflows?.length && !vehicle.currentValue) return null
  const flows: { amount: number; date: Date }[] = []
  vehicle.cashflows?.forEach(cf => {
    const [yr, mo] = cf.date.split('-').map(Number)
    const d = new Date(yr, mo - 1, 1)
    const amt = cf.type === 'withdrawal' ? cf.amount : -cf.amount
    flows.push({ amount: amt, date: d })
  })
  if (flows.length === 0 && vehicle.monthlyContribution > 0) {
    const start = new Date(vehicle.startYear, 0, 1)
    const now = new Date()
    let d = new Date(start)
    while (d <= now) {
      flows.push({ amount: -vehicle.monthlyContribution, date: new Date(d) })
      d.setMonth(d.getMonth() + 1)
    }
  }
  if (vehicle.currentValue > 0) {
    flows.push({ amount: vehicle.currentValue, date: new Date() })
  }
  if (flows.length < 2) return null
  flows.sort((a, b) => a.date.getTime() - b.date.getTime())
  return xirr(flows)
}

// ─── CASHFLOW MODAL ───────────────────────────────────────────────────────────

function CashflowModal({ vehicle, onSave, onClose }: {
  vehicle: FundingVehicle
  onSave: (cashflows: CashflowEvent[]) => void
  onClose: () => void
}) {
  const [flows, setFlows] = useState<CashflowEvent[]>(vehicle.cashflows || [])
  const [date, setDate] = useState('')
  const [type, setType] = useState<CashflowEvent['type']>('contribution')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  const inp: React.CSSProperties = { background: 'white', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink)', outline: 'none' }

  function addFlow() {
    if (!date || !amount) return
    setFlows(prev => [...prev, { id: newId(), date, type, amount: parseFloat(amount), note }])
    setDate(''); setAmount(''); setNote('')
  }

 const typeColors: Record<CashflowEvent['type'], string> = {
    contribution: '#4A9E8A', withdrawal: '#E08080', top_up: '#A8834A', premium_holiday: '#9A9690',
    contribution_change: '#4A7C9E', end_contributions: '#6B5B8B', missed_premium: '#E0A080'
  }
  const typeLabels: Record<CashflowEvent['type'], string> = {
    contribution: 'Contribution', withdrawal: 'Withdrawal', top_up: 'Top-Up', premium_holiday: 'Premium Holiday',
    contribution_change: 'Contribution Change', end_contributions: 'End Contributions', missed_premium: 'Missed Premium'
  }

  const [endDate, setEndDate] = useState('')
  const needsEndDate = type === 'premium_holiday'
  const needsAmount = !['premium_holiday', 'end_contributions', 'missed_premium'].includes(type)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.7)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--cream)', borderRadius: 16, width: 620, maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20 }}>Cashflow History</div>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{vehicle.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 20 }}>✕</button>
        </div>

        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', background: 'white' }}>
          <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 10 }}>Add Event</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {needsEndDate ? 'From' : 'Month'}
              </div>
              <input type="month" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, width: 130 }} />
            </div>
            {needsEndDate && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>To</div>
                <input type="month" value={endDate} onChange={e => setEndDate(e.target.value)} min={date || undefined} style={{ ...inp, width: 130 }} />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Type</div>
              <select value={type} onChange={e => { setType(e.target.value as CashflowEvent['type']); setEndDate('') }} style={{ ...inp, width: 170 }}>
                {(Object.keys(typeLabels) as CashflowEvent['type'][]).map(t => <option key={t} value={t}>{typeLabels[t]}</option>)}
              </select>
            </div>
            {needsAmount && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Amount (S$)</div>
                <input type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inp, width: 110 }} />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Note</div>
              <input placeholder="Optional" value={note} onChange={e => setNote(e.target.value)} style={{ ...inp, width: 100 }} />
            </div>
            <button onClick={() => {
              if (!date) return
              if (needsAmount && !amount) return
              setFlows(prev => [...prev, { id: newId(), date, endDate: needsEndDate ? endDate : undefined, type, amount: parseFloat(amount) || 0, note }])
              setDate(''); setEndDate(''); setAmount(''); setNote('')
            }} style={{ padding: '8px 16px', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', alignSelf: 'flex-end' }}>Add</button>
          </div>
          {type === 'premium_holiday' && (
            <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 8 }}>
              💡 Set From and To months to define the holiday range. Leave To empty for a single month.
            </div>
          )}
          {type === 'missed_premium' && (
            <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 8 }}>
              💡 Missed Premium records a single skipped month — no contribution was made that month.
            </div>
          )}
        </div>

        <div style={{ overflow: 'auto', flex: 1, padding: '8px 24px' }}>
          {flows.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>No cashflow events recorded</div>
          ) : (
            [...flows].sort((a, b) => a.date.localeCompare(b.date)).map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--ink3)', minWidth: 120 }}>
                  {f.date}{f.endDate ? ` → ${f.endDate}` : ''}
                </span>
                <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: typeColors[f.type] + '20', color: typeColors[f.type] }}>{typeLabels[f.type]}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--ink)', flex: 1 }}>
                  {['premium_holiday', 'end_contributions', 'missed_premium'].includes(f.type) ? '—' : 'S$' + f.amount.toLocaleString('en-SG')}
                </span>
                {f.note && <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', fontStyle: 'italic' }}>{f.note}</span>}
                <button onClick={() => setFlows(prev => prev.filter(x => x.id !== f.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 14 }}>×</button>
              </div>
            ))
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '9px 18px', border: '1px solid var(--line)', borderRadius: 8, background: 'white', color: 'var(--ink2)', cursor: 'pointer', fontFamily: 'Inter', fontSize: 12 }}>Cancel</button>
          <button onClick={() => onSave(flows)} style={{ padding: '9px 20px', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'Inter', fontSize: 12, fontWeight: 600 }}>Save Cashflows</button>
        </div>
      </div>
    </div>
  )
}

// ─── VEHICLE MODAL ────────────────────────────────────────────────────────────

function VehicleModal({ item, onSave, onClose, isCouple, clientName, spouseName, clientAge, retirementAge }: {
  item?: FundingVehicle; onSave: (v: FundingVehicle) => void; onClose: () => void
  isCouple: boolean; clientName: string; spouseName: string; clientAge: number; retirementAge: number
}) {
  const [activeTab, setActiveTab] = useState<'details' | 'cashflows'>('details')
  const [name, setName] = useState(item?.name ?? '')
  const [nameError, setNameError] = useState(false)
  const [vehicleType, setVehicleType] = useState<VehicleType>(item?.vehicleType ?? 'investment')
  const [owner, setOwner] = useState<'client' | 'spouse' | 'joint'>(item?.owner ?? 'client')
  const [curVal, setCurVal] = useState(String(item?.currentValue ?? ''))
  const [monthly, setMonthly] = useState(String(item?.monthlyContribution ?? ''))
  const [ret, setRet] = useState(item?.expectedReturn ?? 6)
  const [startYear, setStartYear] = useState(item?.startYear ?? new Date().getFullYear())
  const [mode, setMode] = useState<'Regular' | 'Lump Sum'>(item?.mode ?? 'Regular')
  const [startMonth, setStartMonth] = useState(item?.startMonth ?? '')
  const [endMonth, setEndMonth] = useState(item?.endMonth ?? '')
  const [valueAsOfMonth, setValueAsOfMonth] = useState(item?.valueAsOfMonth ?? '')
  const [cpfScheme, setCpfScheme] = useState<'BRS' | 'FRS' | 'ERS'>(item?.cpfScheme ?? 'FRS')
  const [cpfPayout, setCpfPayout] = useState(String(item?.cpfMonthlyPayout ?? ''))
  const [cpfStartAge, setCpfStartAge] = useState(item?.cpfPayoutStartAge ?? 65)
  const [endMatVal, setEndMatVal] = useState(String(item?.endowmentMaturityValue ?? ''))
  const [endMatYear, setEndMatYear] = useState(item?.endowmentMaturityYear ?? new Date().getFullYear() + 10)
  const [endPremium, setEndPremium] = useState(String(item?.endowmentPremium ?? ''))
  const [annuityIncome, setAnnuityIncome] = useState(String(item?.annuityMonthlyIncome ?? ''))
  const [annuityStartAge, setAnnuityStartAge] = useState(item?.annuityStartAge ?? 65)
  const [annuityGuarantee, setAnnuityGuarantee] = useState(item?.annuityGuaranteeYears ?? 10)
  const [rentalNet, setRentalNet] = useState(String(item?.rentalMonthlyNet ?? ''))
  const [rentalStop, setRentalStop] = useState(item?.rentalStopAge ?? 75)
  const [srsAnnual, setSrsAnnual] = useState(String(item?.srsAnnualContribution ?? ''))
  const [srsIsRegular, setSrsIsRegular] = useState(item?.srsIsRegular ?? false)
  const [srsWithdrawalAge, setSrsWithdrawalAge] = useState(item?.srsWithdrawalStartAge ?? 63)
  const [srsDuration, setSrsDuration] = useState(item?.srsWithdrawalDuration ?? 10)
  const [srsStartYear, setSrsStartYear] = useState(item?.srsStartYear ?? new Date().getFullYear())

  // Cashflow state
  const [flows, setFlows] = useState<CashflowEvent[]>(item?.cashflows || [])
  const [cfDate, setCfDate] = useState('')
  const [cfEndDate, setCfEndDate] = useState('')
  const [cfType, setCfType] = useState<CashflowEvent['type']>('contribution')
  const [cfAmount, setCfAmount] = useState('')
  const [cfNote, setCfNote] = useState('')

  const cfNeedsEndDate = cfType === 'premium_holiday'
  const cfNeedsAmount = !['premium_holiday', 'end_contributions', 'missed_premium'].includes(cfType)

  const typeColors: Record<CashflowEvent['type'], string> = {
    contribution: '#4A9E8A', withdrawal: '#E08080', top_up: '#A8834A', premium_holiday: '#9A9690',
    contribution_change: '#4A7C9E', end_contributions: '#6B5B8B', missed_premium: '#E0A080'
  }
  const typeLabels: Record<CashflowEvent['type'], string> = {
    contribution: 'Contribution', withdrawal: 'Withdrawal', top_up: 'Top-Up', premium_holiday: 'Premium Holiday',
    contribution_change: 'Contribution Change', end_contributions: 'End Contributions', missed_premium: 'Missed Premium'
  }

  const inp: React.CSSProperties = { width: '100%', background: 'white', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }
  const inpSm: React.CSSProperties = { background: 'white', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink)', outline: 'none' }

  const vehicleOpts: { value: VehicleType; label: string; icon: string }[] = [
    { value: 'investment', label: 'Investment', icon: '📈' },
    { value: 'cpf_life', label: 'CPF Life', icon: '🇸🇬' },
    { value: 'srs', label: 'SRS', icon: '🏦' },
    { value: 'endowment', label: 'Endowment', icon: '📋' },
    { value: 'annuity', label: 'Annuity', icon: '🔄' },
    { value: 'rental', label: 'Rental Income', icon: '🏠' },
    { value: 'other', label: 'Other', icon: '✦' },
  ]

  const ownerOpts = [
    { value: 'client' as const, label: clientName },
    ...(isCouple ? [{ value: 'spouse' as const, label: spouseName }, ...(vehicleType !== 'srs' ? [{ value: 'joint' as const, label: 'Joint' }] : [])] : []),
  ]

  useEffect(() => {
    if (vehicleType === 'srs' && owner === 'joint') setOwner('client')
  }, [vehicleType])

  function addCashflow() {
    if (!cfDate) return
    if (cfNeedsAmount && !cfAmount) return
    setFlows(prev => [...prev, {
      id: newId(), date: cfDate,
      endDate: cfNeedsEndDate ? cfEndDate : undefined,
      type: cfType, amount: parseFloat(cfAmount) || 0, note: cfNote
    }])
    setCfDate(''); setCfEndDate(''); setCfAmount(''); setCfNote('')
  }

  function save() {
    if (!name.trim()) { setNameError(true); return }
    let savedAnnualizedReturn: number | null = null
    let savedTotalContributed = 0
    const currentValNum = parseFloat(curVal) || 0
    const monthlyNum = parseFloat(monthly) || 0
    const startDate = startMonth ? new Date(startMonth + '-01') : null
    // Use valueAsOfMonth if set, otherwise fall back to today
    const now = valueAsOfMonth ? new Date(valueAsOfMonth + '-01') : new Date()
    const monthsHeldSave = startDate
      ? (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth()) + 1
      : 0
    if ((vehicleType === 'investment' || vehicleType === 'other') && startDate && monthsHeldSave > 0 && currentValNum > 0) {
      if (mode === 'Lump Sum') {
        savedTotalContributed = monthlyNum || currentValNum
        flows.forEach(cf => { if (cf.type === 'top_up') savedTotalContributed += cf.amount; if (cf.type === 'withdrawal') savedTotalContributed -= cf.amount })
        savedTotalContributed = Math.max(0, savedTotalContributed)
        savedAnnualizedReturn = savedTotalContributed > 0 ? Math.pow(currentValNum / savedTotalContributed, 1 / Math.max(monthsHeldSave / 12, 0.1)) - 1 : null
      } else {
      const sortedChangesS = [...flows.filter(cf => cf.type === 'contribution_change').sort((a, b) => a.date.localeCompare(b.date))]
      const holidayMonthsS = new Set<string>()
      flows.filter(cf => cf.type === 'premium_holiday' || cf.type === 'missed_premium').forEach(cf => {
        const hd = new Date(cf.date + '-01')
        const he = cf.endDate ? new Date(cf.endDate + '-01') : new Date(cf.date + '-01')
        while (hd <= he) { holidayMonthsS.add(hd.toISOString().slice(0, 7)); hd.setMonth(hd.getMonth() + 1) }
      })
      let activeRateS = monthlyNum; let rateIdxS = 0
      const iterS = new Date(startDate)
      while (iterS <= now) {
        const ym = iterS.toISOString().slice(0, 7)
        while (rateIdxS < sortedChangesS.length && sortedChangesS[rateIdxS].date <= ym) { activeRateS = sortedChangesS[rateIdxS].amount; rateIdxS++ }
        if (!holidayMonthsS.has(ym)) savedTotalContributed += activeRateS
        iterS.setMonth(iterS.getMonth() + 1)
      }
      flows.forEach(cf => { if (cf.type === 'top_up') savedTotalContributed += cf.amount; if (cf.type === 'withdrawal') savedTotalContributed -= cf.amount })
      savedTotalContributed = Math.max(0, savedTotalContributed)
      if (mode === 'Regular' && monthsHeldSave > 1) {
        try {
          const xf: { amount: number; date: Date }[] = []
          let xRate = monthlyNum; let xIdx = 0
          const xIter = new Date(startDate)
          while (xIter <= now) {
            const ym = xIter.toISOString().slice(0, 7)
            while (xIdx < sortedChangesS.length && sortedChangesS[xIdx].date <= ym) { xRate = sortedChangesS[xIdx].amount; xIdx++ }
            if (xRate > 0 && !holidayMonthsS.has(ym)) xf.push({ amount: -xRate, date: new Date(xIter) })
            xIter.setMonth(xIter.getMonth() + 1)
          }
          flows.forEach(cf => { const [yr, mo] = cf.date.split('-').map(Number); if (cf.type === 'top_up') xf.push({ amount: -cf.amount, date: new Date(yr, mo - 1, 1) }); if (cf.type === 'withdrawal') xf.push({ amount: cf.amount, date: new Date(yr, mo - 1, 1) }) })
          xf.push({ amount: currentValNum, date: new Date() })
          xf.sort((a, b) => a.date.getTime() - b.date.getTime())
          const xr = xirr(xf)
          savedAnnualizedReturn = xr !== null ? xr / 100 : null
        } catch { savedAnnualizedReturn = null }
      } else {
        savedAnnualizedReturn = savedTotalContributed > 0 ? Math.pow(currentValNum / savedTotalContributed, 1 / Math.max(monthsHeldSave / 12, 0.1)) - 1 : null
      }
      } // end Regular mode block
    } else if (vehicleType === 'srs') {
      const yearsHeldS = new Date().getFullYear() - srsStartYear
      const annualAmt = parseFloat(srsAnnual) || 0
      if (yearsHeldS > 0 && currentValNum > 0) {
        savedTotalContributed = srsIsRegular && annualAmt > 0 ? annualAmt * yearsHeldS : (annualAmt || currentValNum)
        savedTotalContributed = Math.max(0, savedTotalContributed)
        if (savedTotalContributed > 0) savedAnnualizedReturn = Math.pow(currentValNum / savedTotalContributed, 1 / Math.max(yearsHeldS, 0.1)) - 1
      }
    } else if (vehicleType === 'endowment') {
      const endPrem = parseFloat(endPremium) || 0
      const startYearEnd = item?.startYear || new Date().getFullYear()
      const yearsHeldE = new Date().getFullYear() - startYearEnd
      if (yearsHeldE > 0 && currentValNum > 0 && endPrem > 0) {
        savedTotalContributed = endPrem * yearsHeldE * 12
        savedAnnualizedReturn = savedTotalContributed > 0 ? Math.pow(currentValNum / savedTotalContributed, 1 / Math.max(yearsHeldE, 0.1)) - 1 : null
      }
    }
    onSave({
      id: item?.id ?? newId(),
      name: name.trim(), vehicleType, owner, mode,
      currentValue: parseFloat(curVal) || 0,
      monthlyContribution: parseFloat(monthly) || 0,
      expectedReturn: ret, startYear,
      startMonth, endMonth, valueAsOfMonth,
      annualizedReturn: savedAnnualizedReturn,
      totalContributed: savedTotalContributed,
      cpfScheme, cpfMonthlyPayout: parseFloat(cpfPayout) || 0, cpfPayoutStartAge: cpfStartAge,
      endowmentMaturityValue: parseFloat(endMatVal) || 0, endowmentMaturityYear: endMatYear, endowmentPremium: parseFloat(endPremium) || 0,
      annuityMonthlyIncome: parseFloat(annuityIncome) || 0, annuityStartAge, annuityGuaranteeYears: annuityGuarantee,
      rentalMonthlyNet: parseFloat(rentalNet) || 0, rentalStopAge: rentalStop,
      srsAnnualContribution: parseFloat(srsAnnual) || 0, srsIsRegular,
      srsContributionMode: srsIsRegular ? 'regular' : 'lumpsum',
      srsWithdrawalStartAge: srsWithdrawalAge, srsWithdrawalDuration: srsDuration,
      srsStartYear,
      cashflows: flows,
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--cream)', borderRadius: 16, width: 560, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>

        {/* Header */}
        <div style={{ padding: '24px 28px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22 }}>{item ? 'Edit Funding Vehicle' : 'Add Funding Vehicle'}</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 20 }}>✕</button>
          </div>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0 }}>
            {(['details', 'cashflows'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: '8px 20px', border: 'none', borderBottom: activeTab === tab ? '2px solid var(--ink)' : '2px solid transparent',
                background: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 12, fontWeight: activeTab === tab ? 600 : 400,
                color: activeTab === tab ? 'var(--ink)' : 'var(--ink3)', transition: 'all 0.15s',
                textTransform: 'capitalize',
              }}>
                {tab === 'cashflows' ? `Cashflows${flows.length > 0 ? ` (${flows.length})` : ''}` : 'Details'}
              </button>
            ))}
          </div>
        </div>

        {/* Tab: Details */}
        {activeTab === 'details' && (
          <div style={{ overflow: 'auto', flex: 1, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Vehicle Type</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {vehicleOpts.map(o => (
                  <button key={o.value} onClick={() => setVehicleType(o.value)} style={{ padding: '8px 14px', border: '1px solid var(--line)', borderRadius: 8, cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, background: vehicleType === o.value ? 'var(--ink)' : 'white', color: vehicleType === o.value ? 'white' : 'var(--ink3)', transition: 'all 0.15s' }}>
                    {o.icon} {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Name</div>
              <input style={{ ...inp, borderColor: nameError ? '#E08080' : undefined }} value={name} onChange={e => { setName(e.target.value); setNameError(false) }} placeholder={vehicleType === 'cpf_life' ? 'e.g. CPF Life (Brian)' : vehicleType === 'endowment' ? 'e.g. Manulife RetireReady' : vehicleType === 'annuity' ? 'e.g. NTUC Income Annuity' : 'e.g. Global Equity RSP'} />
              {nameError && <div style={{ fontFamily: 'Inter', fontSize: 10, color: '#E08080', marginTop: 4 }}>Please enter a name before saving.</div>}
            </div>

            {isCouple && (
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Belongs To</div>
                <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                  {ownerOpts.map(o => <button key={o.value} onClick={() => setOwner(o.value)} style={{ flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, background: owner === o.value ? 'var(--ink)' : 'white', color: owner === o.value ? 'white' : 'var(--ink3)', transition: 'all 0.15s' }}>{o.label}</button>)}
                </div>
              </div>
            )}

            {vehicleType === 'cpf_life' && (
              <>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>CPF Life Scheme</div>
                  <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                    {(['BRS', 'FRS', 'ERS'] as const).map(s => <button key={s} onClick={() => setCpfScheme(s)} style={{ flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 600, background: cpfScheme === s ? 'var(--ink)' : 'white', color: cpfScheme === s ? 'white' : 'var(--ink3)', transition: 'all 0.15s' }}>{s}</button>)}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Est. Monthly Payout (S$)</div>
                    <input type="number" style={inp} value={cpfPayout} onChange={e => setCpfPayout(e.target.value)} placeholder="e.g. 1200" />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Payout Start Age</div>
                    <input type="number" style={inp} value={cpfStartAge} onChange={e => setCpfStartAge(parseInt(e.target.value) || 65)} />
                  </div>
                </div>
                <div style={{ background: '#EBF2F8', borderRadius: 8, padding: '10px 14px', fontFamily: 'Inter', fontSize: 11, color: '#4A7C9E' }}>
                  💡 Use the CPF LIFE Estimator at <strong>cpf.gov.sg</strong> to get your projected monthly payout, then enter it above.
                </div>
              </>
            )}

            {vehicleType === 'endowment' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Monthly Premium (S$)</div>
                    <input type="number" style={inp} value={endPremium} onChange={e => setEndPremium(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Current Surrender Value (S$)</div>
                    <input type="number" style={inp} value={curVal} onChange={e => setCurVal(e.target.value)} placeholder="0" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Projected Maturity Value (S$)</div>
                    <input type="number" style={inp} value={endMatVal} onChange={e => setEndMatVal(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Maturity Year</div>
                    <input type="number" style={inp} value={endMatYear} onChange={e => setEndMatYear(parseInt(e.target.value) || new Date().getFullYear() + 10)} />
                  </div>
                </div>
              </>
            )}

            {vehicleType === 'annuity' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Monthly Income (S$)</div>
                    <input type="number" style={inp} value={annuityIncome} onChange={e => setAnnuityIncome(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Start Age</div>
                    <input type="number" style={inp} value={annuityStartAge} onChange={e => setAnnuityStartAge(parseInt(e.target.value) || 65)} />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Guarantee (yrs)</div>
                    <input type="number" style={inp} value={annuityGuarantee} onChange={e => setAnnuityGuarantee(parseInt(e.target.value) || 10)} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Monthly Premium (S$)</div>
                    <input type="number" style={inp} value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Current Surrender Value (S$)</div>
                    <input type="number" style={inp} value={curVal} onChange={e => setCurVal(e.target.value)} placeholder="0" />
                  </div>
                </div>
              </>
            )}

            {vehicleType === 'rental' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Net Monthly Rental (S$)</div>
                  <input type="number" style={inp} value={rentalNet} onChange={e => setRentalNet(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Income Until Age</div>
                  <input type="number" style={inp} value={rentalStop} onChange={e => setRentalStop(parseInt(e.target.value) || 75)} />
                </div>
              </div>
            )}

            {vehicleType === 'srs' && (() => {
              const currentYear = new Date().getFullYear()
              const annualAmt = parseFloat(srsAnnual) || 0
              const currentValNum = parseFloat(curVal) || 0
              const effectiveWithdrawalAge = Math.max(srsWithdrawalAge, retirementAge ?? 65)
              const yearsToWithdrawal = Math.max(1, effectiveWithdrawalAge - clientAge)
              let projectedBalance = currentValNum * Math.pow(1 + ret / 100, yearsToWithdrawal)
              if (srsIsRegular && annualAmt > 0) {
                const r = ret / 100
                if (r > 0) projectedBalance += annualAmt * ((Math.pow(1 + r, yearsToWithdrawal) - 1) / r) * (1 + r)
                else projectedBalance += annualAmt * yearsToWithdrawal
              } else if (!srsIsRegular && annualAmt > 0 && currentValNum === 0) {
                projectedBalance = annualAmt * Math.pow(1 + ret / 100, yearsToWithdrawal)
              }
              const r = ret / 100; const g = 0.03; const n = srsDuration
              let monthlyWithdrawalY1 = 0
              if (projectedBalance > 0 && n > 0) {
                const annualBase = Math.abs(r - g) < 0.0001 ? projectedBalance / n : projectedBalance * (r - g) / (1 - Math.pow((1 + g) / (1 + r), n))
                monthlyWithdrawalY1 = annualBase / 12
              }
              const taxableMonthly = monthlyWithdrawalY1 * 0.5
              const yearsHeld = currentYear - srsStartYear
              let annualizedReturn: number | null = null
              if (yearsHeld > 0 && currentValNum > 0) {
                if (srsIsRegular && annualAmt > 0) {
                  const totalContributed = annualAmt * yearsHeld
                  if (totalContributed > 0 && currentValNum > totalContributed) annualizedReturn = Math.pow(currentValNum / totalContributed, 1 / yearsHeld) - 1
                } else if (!srsIsRegular) {
                  const initialAmt = annualAmt || currentValNum
                  if (initialAmt > 0) annualizedReturn = Math.pow(currentValNum / initialAmt, 1 / yearsHeld) - 1
                }
              }
              const totalContributed = srsIsRegular && annualAmt > 0 ? annualAmt * Math.max(1, yearsHeld) : (annualAmt || currentValNum)
              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Start Year</div>
                      <input type="number" style={inp} value={srsStartYear} onChange={e => setSrsStartYear(parseInt(e.target.value) || currentYear)} placeholder={String(currentYear)} />
                    </div>
                    <div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Current SRS Value (S$)</div>
                      <input type="number" style={inp} value={curVal} onChange={e => setCurVal(e.target.value)} placeholder="0" />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Annual Contribution Amount (S$)</div>
                      <input type="number" style={inp} value={srsAnnual} onChange={e => setSrsAnnual(e.target.value)} placeholder="e.g. 15,300" />
                      {annualAmt > 15300 && <div style={{ fontFamily: 'Inter', fontSize: 10, color: '#A8834A', marginTop: 4 }}>💡 Check total SRS contributions don't exceed S$15,300/yr per person</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', background: srsIsRegular ? 'rgba(45,90,78,0.08)' : 'white', border: `1px solid ${srsIsRegular ? '#2D5A4E' : 'var(--line)'}`, borderRadius: 8, transition: 'all 0.15s' }}>
                        <input type="checkbox" checked={srsIsRegular} onChange={e => setSrsIsRegular(e.target.checked)} style={{ accentColor: '#2D5A4E', width: 14, height: 14 }} />
                        <div>
                          <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, color: srsIsRegular ? '#2D5A4E' : 'var(--ink3)' }}>Regular Annual</div>
                          <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginTop: 1 }}>Contribute every year until withdrawal</div>
                        </div>
                      </label>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Expected Return %</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input type="range" min={0} max={12} step={0.5} value={ret} onChange={e => setRet(parseFloat(e.target.value))} style={{ flex: 1, accentColor: 'var(--gold)' }} />
                        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, background: 'white', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px', minWidth: 44, textAlign: 'center' }}>{ret}%</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Withdrawal Start Age</div>
                      <input type="number" style={inp} value={srsWithdrawalAge} onChange={e => setSrsWithdrawalAge(parseInt(e.target.value) || 63)} />
                      {srsWithdrawalAge < 63 && <div style={{ fontFamily: 'Inter', fontSize: 10, color: '#E08080', marginTop: 4 }}>⚠ Early withdrawal: 5% penalty + full tax</div>}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Withdrawal Duration (yrs)</div>
                      <input type="number" style={inp} value={srsDuration} min={1} max={20} onChange={e => setSrsDuration(Math.max(1, parseInt(e.target.value) || 10))} />
                      {srsDuration <= 10 && <div style={{ fontFamily: 'Inter', fontSize: 9, color: '#4A9E8A', marginTop: 4 }}>✓ Within 10yr tax concession window</div>}
                      {srsDuration > 10 && <div style={{ fontFamily: 'Inter', fontSize: 9, color: '#A8834A', marginTop: 4 }}>💡 Beyond 10yrs: remaining balance fully taxable</div>}
                    </div>
                    <div style={{ background: 'var(--cream2)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 2 }}>Effective Withdrawal Age</div>
                      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, color: 'var(--ink)' }}>Age {effectiveWithdrawalAge}</div>
                      <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginTop: 2 }}>{effectiveWithdrawalAge > srsWithdrawalAge ? `Deferred from ${srsWithdrawalAge} (retirement later)` : 'At statutory retirement age'}</div>
                    </div>
                  </div>
                  {yearsHeld > 0 && currentValNum > 0 && (
                    <div style={{ background: '#F5F0E8', border: '1px solid rgba(168,131,74,0.2)', borderRadius: 10, padding: '14px 16px' }}>
                      <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A8834A', marginBottom: 10 }}>Historical Performance · {yearsHeld} yr{yearsHeld !== 1 ? 's' : ''}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                        <div><div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginBottom: 3 }}>Total Contributed</div><div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17 }}>{totalContributed >= 1_000_000 ? 'S$' + (totalContributed / 1_000_000).toFixed(2) + 'M' : 'S$' + Math.round(totalContributed).toLocaleString('en-SG')}</div></div>
                        <div><div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginBottom: 3 }}>Current Value</div><div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17 }}>{currentValNum >= 1_000_000 ? 'S$' + (currentValNum / 1_000_000).toFixed(2) + 'M' : 'S$' + Math.round(currentValNum).toLocaleString('en-SG')}</div></div>
                        <div><div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginBottom: 3 }}>Annualized Return</div><div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17, color: annualizedReturn !== null ? (annualizedReturn >= 0 ? '#4A9E8A' : '#E08080') : 'var(--ink3)' }}>{annualizedReturn !== null ? (annualizedReturn >= 0 ? '+' : '') + (annualizedReturn * 100).toFixed(1) + '%' : '—'}</div></div>
                      </div>
                    </div>
                  )}
                  {projectedBalance > 0 && (
                    <div style={{ background: '#EBF5EE', border: '1px solid rgba(74,158,138,0.2)', borderRadius: 10, padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                      <div><div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4A9E8A', marginBottom: 4 }}>Projected Balance</div><div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17 }}>{projectedBalance >= 1_000_000 ? 'S$' + (projectedBalance / 1_000_000).toFixed(2) + 'M' : 'S$' + Math.round(projectedBalance).toLocaleString('en-SG')}</div><div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginTop: 2 }}>at age {effectiveWithdrawalAge} · {ret}% p.a.</div></div>
                      <div><div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4A9E8A', marginBottom: 4 }}>Monthly Income (Yr 1)</div><div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17 }}>S${Math.round(monthlyWithdrawalY1).toLocaleString('en-SG')}/mo</div><div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginTop: 2 }}>over {srsDuration} yrs · inflation-adj.</div></div>
                      <div><div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4A9E8A', marginBottom: 4 }}>Taxable Portion</div><div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17 }}>S${Math.round(taxableMonthly).toLocaleString('en-SG')}/mo</div><div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginTop: 2 }}>50% concession applies</div></div>
                    </div>
                  )}
                  <div style={{ background: '#EBF2F8', borderRadius: 8, padding: '10px 14px', fontFamily: 'Inter', fontSize: 11, color: '#4A7C9E' }}>
                    💡 Only 50% of SRS withdrawals are taxable from statutory retirement age (63). Spread over 10 years to minimise tax impact.
                  </div>
                </>
              )
            })()}

            {(vehicleType === 'investment' || vehicleType === 'other') && (() => {
              const currentYearMonth = new Date().toISOString().slice(0, 7)
              const startDate = startMonth ? new Date(startMonth + '-01') : null
              const now = new Date()
              const monthsHeld = startDate ? (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth()) + 1 : 0
              const yearsHeld = monthsHeld / 12
              const currentValNum = parseFloat(curVal) || 0
              const monthlyNum = parseFloat(monthly) || 0
              let annualizedReturn: number | null = null
              let totalContributed = 0
              if (yearsHeld > 0 && currentValNum > 0 && startDate) {
                const changeEvents = flows.filter(cf => cf.type === 'contribution_change').sort((a, b) => a.date.localeCompare(b.date))
                const holidayMonths = new Set<string>()
                flows.filter(cf => cf.type === 'premium_holiday' || cf.type === 'missed_premium').forEach(cf => {
                  const hd = new Date(cf.date + '-01'); const he = cf.endDate ? new Date(cf.endDate + '-01') : new Date(cf.date + '-01')
                  while (hd <= he) { holidayMonths.add(hd.toISOString().slice(0, 7)); hd.setMonth(hd.getMonth() + 1) }
                })
                if (mode === 'Regular') {
                  let activeRate = monthlyNum; let rateIdx = 0
                  const iter = new Date(startDate)
                  while (iter <= now) {
                    const ym = iter.toISOString().slice(0, 7)
                    while (rateIdx < changeEvents.length && changeEvents[rateIdx].date <= ym) { activeRate = changeEvents[rateIdx].amount; rateIdx++ }
                    if (!holidayMonths.has(ym)) totalContributed += activeRate
                    iter.setMonth(iter.getMonth() + 1)
                  }
                  flows.forEach(cf => { if (cf.type === 'top_up') totalContributed += cf.amount; if (cf.type === 'withdrawal') totalContributed -= cf.amount })
                } else {
                  totalContributed = monthlyNum || currentValNum
                  flows.forEach(cf => { if (cf.type === 'top_up') totalContributed += cf.amount; if (cf.type === 'withdrawal') totalContributed -= cf.amount })
                }
                totalContributed = Math.max(0, totalContributed)
                if (totalContributed > 0 && currentValNum > 0) {
                  if (mode === 'Regular' && monthsHeld > 1) {
                    try {
                      const xf: { amount: number; date: Date }[] = []
                      let xRate = monthlyNum; let xIdx = 0
                      const xIter = new Date(startDate)
                      while (xIter <= now) {
                        const ym = xIter.toISOString().slice(0, 7)
                        while (xIdx < changeEvents.length && changeEvents[xIdx].date <= ym) { xRate = changeEvents[xIdx].amount; xIdx++ }
                        if (xRate > 0 && !holidayMonths.has(ym)) xf.push({ amount: -xRate, date: new Date(xIter) })
                        xIter.setMonth(xIter.getMonth() + 1)
                      }
                      flows.forEach(cf => { const [yr, mo] = cf.date.split('-').map(Number); if (cf.type === 'top_up') xf.push({ amount: -cf.amount, date: new Date(yr, mo - 1, 1) }); if (cf.type === 'withdrawal') xf.push({ amount: cf.amount, date: new Date(yr, mo - 1, 1) }) })
                      xf.push({ amount: currentValNum, date: new Date() })
                      xf.sort((a, b) => a.date.getTime() - b.date.getTime())
                      const xr = xirr(xf)
                      annualizedReturn = xr !== null ? xr / 100 : Math.pow(currentValNum / totalContributed, 1 / Math.max(yearsHeld, 0.1)) - 1
                    } catch { annualizedReturn = Math.pow(currentValNum / totalContributed, 1 / Math.max(yearsHeld, 0.1)) - 1 }
                  } else {
                    annualizedReturn = Math.pow(currentValNum / totalContributed, 1 / Math.max(yearsHeld, 0.1)) - 1
                  }
                }
              }
              return (
                <>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Mode</div>
                    <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                      {(['Regular', 'Lump Sum'] as const).map(m => <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, background: mode === m ? 'var(--ink)' : 'white', color: mode === m ? 'white' : 'var(--ink3)', transition: 'all 0.15s' }}>{m}</button>)}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Start Month / Year</div>
                      <input type="month" style={inp} value={startMonth} onChange={e => setStartMonth(e.target.value)} max={currentYearMonth} />
                    </div>
                    <div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Current Value (S$)</div>
                      <input type="number" style={inp} value={curVal} onChange={e => setCurVal(e.target.value)} placeholder="0" />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Value as of Month</div>
                      <input type="month" style={inp} value={valueAsOfMonth} onChange={e => setValueAsOfMonth(e.target.value)} max={currentYearMonth} />
                      <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginTop: 4 }}>When was this value last updated?</div>
                    </div>
                  </div>
                  {mode === 'Regular' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Monthly Contribution (S$)</div>
                        <input type="number" style={inp} value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="0" />
                      </div>
                      <div>
                        <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>End Month / Year</div>
                        <input type="month" style={inp} value={endMonth} onChange={e => setEndMonth(e.target.value)} min={startMonth || undefined} />
                        <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginTop: 4 }}>After this date, portfolio compounds at expected return only</div>
                      </div>
                    </div>
                  )}
                  {mode === 'Lump Sum' && (
                    <div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Initial Lump Sum (S$)</div>
                      <input type="number" style={inp} value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="0" />
                      <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginTop: 4 }}>Use the Cashflows tab to record top-ups and withdrawals</div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Expected Return % p.a.</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="range" min={0} max={15} step={0.5} value={ret} onChange={e => setRet(parseFloat(e.target.value))} style={{ flex: 1, accentColor: 'var(--gold)' }} />
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, background: 'white', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px', minWidth: 44, textAlign: 'center' }}>{ret}%</span>
                    </div>
                  </div>
                  {yearsHeld > 0 && currentValNum > 0 && (
                    <div style={{ background: '#F5F0E8', border: '1px solid rgba(168,131,74,0.2)', borderRadius: 10, padding: '14px 16px' }}>
                      <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A8834A', marginBottom: 10 }}>Portfolio Performance · {monthsHeld} month{monthsHeld !== 1 ? 's' : ''} · {startMonth}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                        <div><div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginBottom: 3 }}>Total Contributed</div><div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17 }}>{totalContributed >= 1_000_000 ? 'S$' + (totalContributed / 1_000_000).toFixed(2) + 'M' : 'S$' + Math.round(totalContributed).toLocaleString('en-SG')}</div></div>
                        <div><div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginBottom: 3 }}>Current Value</div><div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17 }}>{currentValNum >= 1_000_000 ? 'S$' + (currentValNum / 1_000_000).toFixed(2) + 'M' : 'S$' + Math.round(currentValNum).toLocaleString('en-SG')}</div></div>
                        <div><div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginBottom: 3 }}>Annualized Return</div><div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17, color: annualizedReturn !== null ? (annualizedReturn >= 0 ? '#4A9E8A' : '#E08080') : 'var(--ink3)' }}>{annualizedReturn !== null ? (annualizedReturn >= 0 ? '+' : '') + (annualizedReturn * 100).toFixed(1) + '%' : '—'}</div><div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginTop: 2 }}>{mode === 'Regular' && monthsHeld > 1 ? 'XIRR · time-weighted' : 'Simple annualized'}</div></div>
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        )}

        {/* Tab: Cashflows */}
        {activeTab === 'cashflows' && (
          <div style={{ overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
            {/* Add event form */}
            <div style={{ padding: '16px 28px', borderBottom: '1px solid var(--line)', background: 'white' }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 10 }}>Add Event</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{cfNeedsEndDate ? 'From' : 'Month'}</div>
                  <input type="month" value={cfDate} onChange={e => setCfDate(e.target.value)} style={{ ...inpSm, width: 130 }} />
                </div>
                {cfNeedsEndDate && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>To</div>
                    <input type="month" value={cfEndDate} onChange={e => setCfEndDate(e.target.value)} min={cfDate || undefined} style={{ ...inpSm, width: 130 }} />
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Type</div>
                  <select value={cfType} onChange={e => { setCfType(e.target.value as CashflowEvent['type']); setCfEndDate('') }} style={{ ...inpSm, width: 170 }}>
                    {(Object.keys(typeLabels) as CashflowEvent['type'][]).map(t => <option key={t} value={t}>{typeLabels[t]}</option>)}
                  </select>
                </div>
                {cfNeedsAmount && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Amount (S$)</div>
                    <input type="number" placeholder="0" value={cfAmount} onChange={e => setCfAmount(e.target.value)} style={{ ...inpSm, width: 110 }} />
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Note</div>
                  <input placeholder="Optional" value={cfNote} onChange={e => setCfNote(e.target.value)} style={{ ...inpSm, width: 100 }} />
                </div>
                <button onClick={addCashflow} style={{ padding: '8px 16px', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', alignSelf: 'flex-end' }}>Add</button>
              </div>
              {cfType === 'premium_holiday' && <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 8 }}>💡 Set From and To months to define the holiday range. Leave To empty for a single month.</div>}
              {cfType === 'missed_premium' && <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 8 }}>💡 Missed Premium records a single skipped month — no contribution was made that month.</div>}
            </div>
            {/* Event list */}
            <div style={{ flex: 1, padding: '8px 28px', overflow: 'auto' }}>
              {flows.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>No cashflow events recorded</div>
              ) : (
                [...flows].sort((a, b) => a.date.localeCompare(b.date)).map(f => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--ink3)', minWidth: 120 }}>{f.date}{f.endDate ? ` → ${f.endDate}` : ''}</span>
                    <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: typeColors[f.type] + '20', color: typeColors[f.type] }}>{typeLabels[f.type]}</span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--ink)', flex: 1 }}>{['premium_holiday', 'end_contributions', 'missed_premium'].includes(f.type) ? '—' : 'S$' + f.amount.toLocaleString('en-SG')}</span>
                    {f.note && <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', fontStyle: 'italic' }}>{f.note}</span>}
                    <button onClick={() => setFlows(prev => prev.filter(x => x.id !== f.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 14 }}>×</button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '16px 28px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end', background: 'var(--cream)' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', fontFamily: 'Inter', fontSize: 12, border: '1px solid var(--line)', borderRadius: 8, background: 'white', color: 'var(--ink2)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} style={{ padding: '10px 24px', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: 'var(--ink)', color: 'white', cursor: 'pointer' }}>{item ? 'Update' : 'Add Vehicle'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── CUSTOM GOAL MODAL ────────────────────────────────────────────────────────

function CustomGoalModal({ onSave, onClose, clientAge, spouseAge, isCouple, clientName, spouseName, expectedReturn, existing }: {
  onSave: (g: CapitalGoal) => void; onClose: () => void; clientAge: number; spouseAge: number
  isCouple: boolean; clientName: string; spouseName: string; expectedReturn: number; existing?: CapitalGoal
}) {
  const [label, setLabel] = useState(existing?.label ?? '')
  const [corpus, setCorpus] = useState(existing?.targetCorpus ? String(existing.targetCorpus) : '')
  const [owner, setOwner] = useState<'client' | 'spouse' | 'joint'>(existing?.owner ?? 'client')
  const [targetAge, setTargetAge] = useState(existing?.targetAge ?? clientAge + 10)
  const inp: React.CSSProperties = { width: '100%', background: 'white', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }
  const ownerOpts = [{ value: 'client' as const, label: clientName }, ...(isCouple ? [{ value: 'spouse' as const, label: spouseName }, { value: 'joint' as const, label: 'Joint' }] : [])]

  // When owner changes, reset target age to the relevant person's age + 10
  function handleOwnerChange(o: 'client' | 'spouse' | 'joint') {
    setOwner(o)
    if (o === 'spouse') setTargetAge(spouseAge + 10)
    else if (o === 'joint') setTargetAge(Math.max(clientAge, spouseAge) + 10)
    else setTargetAge(clientAge + 10)
  }

  const ownerBaseAge = owner === 'spouse' ? spouseAge : clientAge
  const yearsAway = Math.max(0, targetAge - ownerBaseAge)
  const corpusNum = parseFloat(corpus) || 0
  const autoMonthly = calcMonthlyRequired(corpusNum, Math.max(1, yearsAway), expectedReturn)

  function save() {
    if (!label.trim()) return
    onSave({ id: existing?.id ?? newId(), source: 'custom', label: label.trim(), icon: '✦', targetCorpus: corpusNum, monthlyRequired: autoMonthly, targetAge, yearsAway, owner })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--cream)', borderRadius: 16, width: 440, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>
        <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22 }}>Add Capital Goal</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 20 }}>✕</button>
        </div>
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Goal Label</div>
            <input style={inp} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Second property, Business fund" />
          </div>
          {isCouple && (
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>For</div>
              <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                {ownerOpts.map(o => <button key={o.value} onClick={() => handleOwnerChange(o.value)} style={{ flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, background: owner === o.value ? 'var(--ink)' : 'white', color: owner === o.value ? 'white' : 'var(--ink3)', transition: 'all 0.15s' }}>{o.label}</button>)}
              </div>
            </div>
          )}
          <div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Target Corpus (S$)</div>
            <input type="number" style={inp} value={corpus} onChange={e => setCorpus(e.target.value)} placeholder="0" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>
                Target Age {owner === 'joint' ? `(${clientAge > spouseAge ? clientName : spouseName})` : ''}
              </div>
              <input type="number" style={inp} value={targetAge} onChange={e => setTargetAge(parseInt(e.target.value) || ownerBaseAge + 10)} />
            </div>
            <div style={{ background: 'var(--cream2)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Monthly Required</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, color: corpusNum > 0 ? 'var(--ink)' : 'var(--ink3)' }}>
                {corpusNum > 0 && yearsAway > 0 ? fmtMo(autoMonthly) : '—'}
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginTop: 2 }}>
                {yearsAway > 0 ? `${yearsAway} yrs · ${expectedReturn}% p.a.` : 'Set corpus & age'}
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: '16px 28px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', fontFamily: 'Inter', fontSize: 12, border: '1px solid var(--line)', borderRadius: 8, background: 'white', color: 'var(--ink2)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} style={{ padding: '10px 24px', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: 'var(--ink)', color: 'white', cursor: 'pointer' }}>Add Goal</button>
        </div>
      </div>
    </div>
  )
}

// ─── BADGES ──────────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: CapitalGoal['source'] }) {
  const map = { retirement: { label: 'Retirement', color: '#6B5B8B', bg: '#F0EBF8' }, wealth: { label: 'Wealth', color: '#4A7C9E', bg: '#EBF2F8' }, education: { label: 'Education', color: '#5E8A6A', bg: '#EBF5EE' }, custom: { label: 'Custom', color: '#A8834A', bg: '#F5EFE5' } }
  const { label, color, bg } = map[source]
  return <span style={{ fontFamily: 'Inter', fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color, background: bg, padding: '2px 8px', borderRadius: 4 }}>{label}</span>
}

function OwnerBadge({ owner, clientName, spouseName }: { owner: 'client' | 'spouse' | 'joint'; clientName: string; spouseName: string }) {
  const map = { client: { color: '#4A7C9E', bg: '#EBF2F8' }, spouse: { color: '#6B5B8B', bg: '#F0EBF8' }, joint: { color: '#A8834A', bg: '#F5EFE5' } }
  const { color, bg } = map[owner]
  const label = owner === 'client' ? clientName : owner === 'spouse' ? spouseName : 'Joint'
  return <span style={{ fontFamily: 'Inter', fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color, background: bg, padding: '2px 8px', borderRadius: 4 }}>{label}</span>
}

function XIRRBadge({ rate }: { rate: number | null }) {
  if (rate === null) return null
  const color = rate >= 6 ? '#4A9E8A' : rate >= 3 ? '#A8834A' : '#E08080'
  const bg = rate >= 6 ? 'rgba(74,158,138,0.1)' : rate >= 3 ? 'rgba(168,131,74,0.1)' : 'rgba(224,128,128,0.1)'
  return (
    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: bg, color, whiteSpace: 'nowrap' }}>
      XIRR {rate > 0 ? '+' : ''}{rate.toFixed(1)}%
    </span>
  )
}

function vehicleIcon(t: VehicleType) {
  return { investment: '📈', cpf_life: '🇸🇬', srs: '🏦', endowment: '📋', annuity: '🔄', rental: '🏠', other: '✦' }[t]
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function CapitalMandatePage() {
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [client, setClient] = useState<any>(null)
  const clientRef = useRef<any>(null)
  const [clientAge, setClientAge] = useState(40)
  const [spouseAge, setSpouseAge] = useState(38)
  const [clientName, setClientName] = useState('Client')
  const [spouseName, setSpouseName] = useState('Spouse')

  const [retirementAge, setRetirementAge] = useState(65)
  const [lifeExpectancy, setLifeExpectancy] = useState(85)
  const [spouseRetirementAge, setSpouseRetirementAge] = useState(65)
  const [spouseLifeExpectancy, setSpouseLifeExpectancy] = useState(85)
  const [desiredMonthlyIncome, setDesiredMonthlyIncome] = useState(0)
  const [desiredAnnualHolidays, setDesiredAnnualHolidays] = useState(0)
  const [currentExpenses, setCurrentExpenses] = useState(0)
  const [postRetirementReturn, setPostRetirementReturn] = useState(3)
  const [retirementInflation, setRetirementInflation] = useState(3)

  const [planMode, setPlanMode] = useState<PlanMode>('individual')
  const [activePerson, setActivePerson] = useState<ActivePerson>('client')

  const [goals, setGoals] = useState<CapitalGoal[]>([])
  const [customGoalModal, setCustomGoalModal] = useState(false)
  const [editingGoal, setEditingGoal] = useState<CapitalGoal | null>(null)
  const [portfolio, setPortfolio] = useState<FundingVehicle[]>([])
  const [vehicleModal, setVehicleModal] = useState<{ open: boolean; item?: FundingVehicle }>({ open: false })
  const [cashflowModal, setCashflowModal] = useState<FundingVehicle | null>(null)
  const [settings, setSettings] = useState<CMSettings>({ expectedReturn: 6, legacyAmount: 0, incomeSource: 'desired' })

  const [notes, setNotes] = useState('')
  const [lumpSumFraction, setLumpSumFraction] = useState(0) // 0 = pure monthly, 1 = pure lump sum
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<any>(null)
  const breakdownShortfallRef = useRef<number>(0)
  const shortfallSolutionRef = useRef<{ pureMonthly: number; pureLump: number; lumpSumFraction: number } | null>(null)
  const chartSeriesRef = useRef<{
    ages: number[]; requiredLine: number[]; projectedLine: number[]; legacyLine: (number | null)[] | null
    milestones: { age: number; label: string; amount: number }[]
    retireIdx: number; retirementAge: number; finalDeathAge: number
    goldAnnualBase: number; guaranteedMonthlyRetirement: number; planMode: PlanMode; clientAge: number; spouseAge: number
  } | null>(null)

  const earliestRetirementAge = useMemo(() => {
    if (planMode === 'couple') {
      return Math.min(retirementAge, spouseRetirementAge + (clientAge - spouseAge))
    }
    return retirementAge
  }, [planMode, retirementAge, spouseRetirementAge, clientAge, spouseAge])

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    const { data: clients } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
    if (!clients?.length) { setLoading(false); return }
    const c = clients.find((x: any) => x.id === localStorage.getItem('selectedClientId')) || clients[0]
    setClient(c); clientRef.current = c

    const [{ data: rows }, { data: familyMembers }] = await Promise.all([
      supabase.from('fact_finding').select('section, data').eq('client_id', c.id),
      supabase.from('family_members').select('*').eq('client_id', c.id),
    ])
    const liveChildren = (familyMembers || []).filter((m: any) => ['son', 'daughter'].includes(m.relationship?.toLowerCase()))
    const liveChildIds = new Set(liveChildren.map((m: any) => m.id))
    const by: Record<string, any> = {}
    if (rows) rows.forEach((r: any) => { by[r.section] = r.data })

    const fin = by['financials'] || by['factfinding'] || {}
    const dob = c.dob || fin?.client?.dateOfBirth || fin?.client?.dob
    const age = dob
      ? new Date().getFullYear() - new Date(dob).getFullYear()
      : fin?.client?.currentAge || fin?.client?.age || c.age || 40
    const spouseMember = (familyMembers || []).find((m: any) => m.relationship?.toLowerCase() === 'spouse')
    const sage = spouseMember?.dob
      ? new Date().getFullYear() - new Date(spouseMember.dob).getFullYear()
      : fin?.spouse?.age || 38
    const cName = fin?.client?.firstName ? `${fin.client.firstName} ${fin.client.lastName || ''}`.trim() : c.name || 'Client'
    const sName = fin?.spouse?.firstName
      ? `${fin.spouse.firstName} ${fin.spouse.lastName || ''}`.trim()
      : spouseMember?.name || 'Spouse'
    setClientAge(age); setSpouseAge(sage); setClientName(cName); setSpouseName(sName)

    const protData = by['protection_needs']?.protection
    const hasSpouse = !!(fin?.spouse?.firstName || fin?.spouse?.age)
    const mode: PlanMode = (protData?.planType === 'couple' || hasSpouse) ? 'couple' : 'individual'
    setPlanMode(mode)
    setActivePerson(mode === 'couple' ? 'combined' : 'client')

    const retRow = by['retirement'] || {}
    const retNested = retRow?.ret || {}
    const retClientData = retNested?.client || {}
    const retSpouseData = retNested?.spouse || {}
    setRetirementAge(retClientData?.retirementAge || retRow?.retirementAge || 65)
    setLifeExpectancy(retClientData?.lifeExpectancy || retRow?.lifeExpectancy || 85)
    setSpouseRetirementAge(retSpouseData?.retirementAge || 65)
    setSpouseLifeExpectancy(retSpouseData?.lifeExpectancy || 85)
    // For couples, income/holidays are stored in expenseSelections (combined); for individuals, in client object
    const retExpSel = retNested?.expenseSelections || {}
    const isCouplePlan = mode === 'couple'
    const savedMonthly = isCouplePlan
      ? (retExpSel?.combinedDesiredMonthly || retClientData?.desiredMonthlyIncome || retRow?.desiredMonthlyIncome || 0)
      : (retClientData?.desiredMonthlyIncome || retRow?.desiredMonthlyIncome || 0)
    const savedHolidays = isCouplePlan
      ? (retExpSel?.combinedDesiredHolidays || retClientData?.desiredAnnualHolidays || retRow?.desiredAnnualHolidays || 0)
      : (retClientData?.desiredAnnualHolidays || retRow?.desiredAnnualHolidays || 0)
    setDesiredMonthlyIncome(savedMonthly)
    setDesiredAnnualHolidays(savedHolidays)
    setCurrentExpenses(fin?.client?.monthlyExpenses || fin?.client?.expenses || retRow?.currentExpenses || 0)
    const retAssumptions = retNested?.assumptions || retNested || {}
    setPostRetirementReturn(
      retNested?.postReturnRate ||
      retClientData?.postRetirementReturn ||
      retAssumptions?.postRetirementReturn ||
      retRow?.postRetirementReturn ||
      retNested?.postRetirementReturn || 4
    )
    const inflationVal =
      retNested?.inflationRate ||
      retClientData?.inflation ||
      retAssumptions?.inflation ||
      retRow?.inflation ||
      retNested?.inflation || 3
    setRetirementInflation(inflationVal)

    const cmData = by['capital_mandate'] || {}
    const savedSettings: CMSettings = {
      expectedReturn: 6, legacyAmount: 0, incomeSource: 'desired',
      ...(cmData?.settings || {})
    }
    setSettings(savedSettings)
    setNotes(cmData?.notes || '')
    if (cmData?.shortfallSolution?.lumpSumFraction != null) {
      setLumpSumFraction(cmData.shortfallSolution.lumpSumFraction)
    }

    const builtGoals: CapitalGoal[] = []

    const totalCorpusNeeded = retRow?.corpusNeeded || 0
    const totalMonthlyRet = retRow?.monthlySavingsNeeded || retRow?.monthlySavingsRequired || 0
    const retAge = retClientData?.retirementAge || retRow?.retirementAge || 65
    if (totalCorpusNeeded > 0) {
      builtGoals.push({
        id: 'ret_combined', source: 'retirement',
        label: mode === 'couple' ? `${cName} & ${sName} — Retirement` : `${cName} — Retirement`,
        icon: '🏖', targetCorpus: totalCorpusNeeded,
        monthlyRequired: totalMonthlyRet > 0 ? totalMonthlyRet : calcMonthlyRequired(totalCorpusNeeded, Math.max(1, retAge - age), savedSettings.expectedReturn),
        targetAge: retAge, yearsAway: Math.max(0, retAge - age), owner: mode === 'couple' ? 'joint' : 'client',
      })
    }

    const acc = by['accumulation']?.acc || by['accumulation'] || {}
    ;(acc?.goals || []).forEach((g: any) => {
      if (!g.targetAmount) return
      const yearsLeft = Math.max(1, g.yearsToGoal || 10)
      const corpus = g.amountType === 'pv' ? g.targetAmount * Math.pow(1 + inflationVal / 100, yearsLeft) : g.targetAmount
      const owner: 'client' | 'spouse' | 'joint' = g.owner === 'spouse' ? 'spouse' : g.owner === 'joint' ? 'joint' : 'client'
      const goalMonthly = (g.monthlyRequired != null) ? g.monthlyRequired : calcMonthlyRequired(corpus, yearsLeft, savedSettings.expectedReturn)
      builtGoals.push({ id: 'acc_' + g.id, source: 'wealth', label: g.label || 'Wealth Goal', icon: '🏠', targetCorpus: corpus, monthlyRequired: goalMonthly, targetAge: age + yearsLeft, yearsAway: Math.max(0, yearsLeft), owner })
    })

    const edu = by['education']?.edu || by['education'] || {}
    const eduTuitionInf = (edu?.tuitionInflation ?? 5) / 100
    const eduLivingInf = (edu?.livingInflation ?? 3) / 100
    const eduReturnRate = edu?.returnRate ?? 5
    ;(edu?.children || []).forEach((child: any) => {
      const childId = child.childId || child.id
      if (childId && !liveChildIds.has(childId)) return
      if ((!child.annualTuition && !child.annualLiving) || !child.name) return
      if ((child.annualTuition || 0) + (child.annualLiving || 0) === 0) return
      const liveChild = liveChildren.find((m: any) => m.id === childId)
      let liveAge: number
      if (liveChild) {
        if (liveChild.age != null) {
          liveAge = liveChild.age
        } else if (liveChild.date_of_birth) {
          liveAge = Math.max(0, new Date().getFullYear() - new Date(liveChild.date_of_birth).getFullYear())
        } else {
          liveAge = child.age || 0
        }
      } else {
        liveAge = child.age || 0
      }
      const yearsUntilUni = Math.max(1, (child.uniEntryAge || 18) - liveAge)
      const duration = child.courseDuration || 4
      const fvTuition = (child.annualTuition || 0) * Math.pow(1 + eduTuitionInf, yearsUntilUni) * duration
      const fvLiving = (child.annualLiving || 0) * Math.pow(1 + eduLivingInf, yearsUntilUni) * duration
      const corpus = Math.max(0, fvTuition + fvLiving - ((child.existingSavings || 0) * Math.pow(1 + eduReturnRate / 100, yearsUntilUni)))
      if (!corpus) return
      const clientAgeAtUni = age + yearsUntilUni       
      builtGoals.push({ id: 'edu_' + (child.childId || child.name), source: 'education', label: `${child.name}'s Education`, icon: '🎓', targetCorpus: corpus, monthlyRequired: calcMonthlyRequired(corpus, Math.max(1, yearsUntilUni), savedSettings.expectedReturn), targetAge: clientAgeAtUni, yearsAway: Math.max(0, yearsUntilUni), owner: 'joint' })
    })

    ;(cmData?.customGoals || []).forEach((g: CapitalGoal) => builtGoals.push({ ...g, source: 'custom' }))
    setGoals(builtGoals)

    const savedPortfolio: FundingVehicle[] = (cmData?.portfolio || []).map((p: any) => ({
      cashflows: [],
      vehicleType: p.vehicleType || 'investment',
      ...p,
      owner: p.owner ?? 'client',
    }))
    setPortfolio(savedPortfolio)
    setLoading(false)
  }

  async function saveData(updPortfolio: FundingVehicle[], updSettings: CMSettings, updCustomGoals: CapitalGoal[], updNotes: string, shortfall?: number) {
    const c = clientRef.current; if (!c) return
    // Use breakdownShortfallRef which is always kept in sync via useEffect
    const effectiveShortfall = breakdownShortfallRef.current > 0 ? breakdownShortfallRef.current : Math.max(0, shortfall ?? 0)
    const dataToSave = {
      portfolio: updPortfolio, settings: updSettings, customGoals: updCustomGoals, notes: updNotes,
      portfolioStatus: shortfall != null ? (shortfall > 0 ? 'gap' : 'on_track') : undefined,
      retirementShortfall: effectiveShortfall,
      shortfallSolution: shortfallSolutionRef.current || undefined,
      chartSeries: chartSeriesRef.current || undefined,
    }
    const { data: rows } = await supabase.from('fact_finding').select('id').eq('client_id', c.id).eq('section', 'capital_mandate')
    if (rows && rows.length > 0) {
      await supabase.from('fact_finding').update({ data: dataToSave }).eq('id', rows[0].id)
    } else {
      await supabase.from('fact_finding').insert({ client_id: c.id, section: 'capital_mandate', data: dataToSave })
    }
  }

  async function saveVehicle(item: FundingVehicle) {
    const updated = portfolio.find(p => p.id === item.id) ? portfolio.map(p => p.id === item.id ? item : p) : [...portfolio, item]
    setPortfolio(updated)
    await saveData(updated, settings, goals.filter(g => g.source === 'custom'), notes, corpusShortfall)
    setVehicleModal({ open: false })
  }

  async function saveCashflows(vehicleId: string, cashflows: CashflowEvent[]) {
    const updated = portfolio.map(p => p.id === vehicleId ? { ...p, cashflows } : p)
    setPortfolio(updated)
    await saveData(updated, settings, goals.filter(g => g.source === 'custom'), notes, corpusShortfall)
    setCashflowModal(null)
  }

  async function deleteVehicle(id: string) {
    if (!confirm('Remove this funding vehicle?')) return
    const updated = portfolio.filter(p => p.id !== id)
    setPortfolio(updated)
    await saveData(updated, settings, goals.filter(g => g.source === 'custom'), notes, corpusShortfall)
  }

  async function addCustomGoal(g: CapitalGoal) {
    const updGoals = [...goals, g]
    setGoals(updGoals)
    await saveData(portfolio, settings, updGoals.filter(x => x.source === 'custom'), notes)
    setCustomGoalModal(false)
  }

  async function editCustomGoal(g: CapitalGoal) {
    const updGoals = goals.map(x => x.id === g.id ? g : x)
    setGoals(updGoals)
    await saveData(portfolio, settings, updGoals.filter(x => x.source === 'custom'), notes)
    setCustomGoalModal(false)
    setEditingGoal(null)
  }

  async function removeGoal(id: string) {
    const updGoals = goals.filter(g => g.id !== id)
    setGoals(updGoals)
    await saveData(portfolio, settings, updGoals.filter(g => g.source === 'custom'), notes)
  }

  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function updateSettings(s: CMSettings) {
    setSettings(s)
    if (settingsSaveTimer.current) clearTimeout(settingsSaveTimer.current)
    settingsSaveTimer.current = setTimeout(() => {
      saveData(portfolio, s, goals.filter(g => g.source === 'custom'), notes, corpusShortfall)
    }, 800)
  }

  function updateNotes(val: string) {
    setNotes(val)
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => {
      saveData(portfolio, settings, goals.filter(g => g.source === 'custom'), val, corpusShortfall)
    }, 1200)
  }

  const lumpSumFractionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lumpSumFractionRef = useRef(lumpSumFraction)
  useEffect(() => {
    lumpSumFractionRef.current = lumpSumFraction
    // Guard against the stale-closure-on-mount bug: this effect always runs
    // once on mount (lumpSumFraction transitions from "unset" to its default).
    // If we schedule the save before the async load() has populated
    // portfolio/settings/notes, the 800ms timer fires with empty defaults
    // and silently overwrites real saved data. Only schedule once loading
    // has finished, so the closure holds the real, loaded values.
    if (loading) return
    if (lumpSumFractionTimer.current) clearTimeout(lumpSumFractionTimer.current)
    lumpSumFractionTimer.current = setTimeout(() => {
      saveData(portfolio, settings, goals.filter(g => g.source === 'custom'), notes, corpusShortfall)
    }, 800)
  }, [lumpSumFraction, loading])

  const matchesPerson = useCallback((_owner: 'client' | 'spouse' | 'joint'): boolean => true, [])

  const filteredGoals = useMemo(() => goals
    .filter(g => matchesPerson(g.owner))
    .map(g => {
      if (g.source === 'custom') return g
      // Always recompute yearsAway from live state so it matches the Retirement page (year-only age)
      const liveYearsAway = g.source === 'retirement'
        ? Math.max(0, retirementAge - clientAge)
        : g.yearsAway
      const monthly = liveYearsAway > 0
        ? calcMonthlyRequired(g.targetCorpus, liveYearsAway, settings.expectedReturn)
        : g.monthlyRequired
      return { ...g, yearsAway: liveYearsAway, monthlyRequired: monthly }
    }), [goals, matchesPerson, settings.expectedReturn, retirementAge, clientAge])

  const totalMonthlyNeeded = useMemo(() => filteredGoals.reduce((s, g) => s + g.monthlyRequired, 0), [filteredGoals])
  const totalCorpus = useMemo(() => filteredGoals.reduce((s, g) => s + g.targetCorpus, 0), [filteredGoals])

  const filteredPortfolio = useMemo(() => portfolio.filter(p => matchesPerson(p.owner)), [portfolio, matchesPerson])

  const totalMonthlyInvesting = useMemo(() => filteredPortfolio.reduce((s, p) => {
    if (p.mode === 'Lump Sum') return s
    if (p.vehicleType === 'investment' || p.vehicleType === 'other') {
      const latestChange = [...(p.cashflows || [])]
        .filter(cf => cf.type === 'contribution_change')
        .sort((a, b) => b.date.localeCompare(a.date))[0]
      return s + (latestChange ? latestChange.amount : p.monthlyContribution)
    }
    if (p.vehicleType === 'endowment') return s + (p.endowmentPremium || 0)
    if (p.vehicleType === 'annuity') return s + p.monthlyContribution
    if (p.vehicleType === 'srs' && p.srsIsRegular) return s + (p.srsAnnualContribution || 0) / 12
    return s
  }, 0), [filteredPortfolio])
  const totalCurrentValue = useMemo(() => filteredPortfolio.reduce((s, p) => s + (p.currentValue || 0), 0), [filteredPortfolio])
  const monthlyGap = totalMonthlyNeeded - totalMonthlyInvesting

  const personLabel = planMode === 'individual' ? clientName : `${clientName} & ${spouseName}`

  const derivedAnnualWithdrawal = useMemo(() => {
    const retGoal = goals.find(g => g.source === 'retirement')
    if (!retGoal || retGoal.targetCorpus <= 0) return 0
    const r = postRetirementReturn / 100
    const g = retirementInflation / 100
    const finalDE = planMode === 'couple'
      ? Math.max(lifeExpectancy, spouseLifeExpectancy + (clientAge - spouseAge))
      : lifeExpectancy
    const n = Math.max(1, finalDE - earliestRetirementAge)
    if (Math.abs(r - g) < 0.0001) {
      return retGoal.targetCorpus * (1 + r) / n
    }
    const ratio = Math.pow((1 + g) / (1 + r), n)
    const denom = 1 - ratio
    if (denom <= 0) return 0
    return retGoal.targetCorpus * (r - g) / denom
  }, [goals, retirementInflation, postRetirementReturn, lifeExpectancy, retirementAge])

  const effectiveRetirementIncome = useMemo(() => {
    if (settings.incomeSource === 'desired' && desiredMonthlyIncome > 0) return desiredMonthlyIncome
    if (currentExpenses > 0) return currentExpenses
    if (derivedAnnualWithdrawal > 0) {
      const yearsToRet = Math.max(0, retirementAge - clientAge)
      const inflationFactor = Math.pow(1 + retirementInflation / 100, yearsToRet)
      return (derivedAnnualWithdrawal / 12) / inflationFactor
    }
    return 0
  }, [settings.incomeSource, desiredMonthlyIncome, currentExpenses, derivedAnnualWithdrawal, retirementAge, clientAge, retirementInflation])

  const effectiveAnnualHolidays = useMemo(() => {
    if (settings.incomeSource === 'desired') return desiredAnnualHolidays
    return 0
  }, [settings.incomeSource, desiredAnnualHolidays])

  const xirrMap = useMemo(() => {
    const m: Record<string, number | null> = {}
    portfolio.forEach(p => { m[p.id] = computeXIRR(p) })
    return m
  }, [JSON.stringify(portfolio)])

  const blendedXIRR = useMemo(() => {
    let totalVal = 0
    let weighted = 0
    let counted = 0
    filteredPortfolio.forEach(p => {
      const xr = xirrMap[p.id]
      if (xr !== null && xr !== undefined && (p.currentValue || 0) > 0) {
        totalVal += p.currentValue
        weighted += xr * p.currentValue
        counted++
      }
    })
    if (totalVal === 0 || counted === 0) return null
    return weighted / totalVal
  }, [filteredPortfolio, xirrMap])

  const portfolioXIRR = useMemo(() => {
    const perfVehicles = filteredPortfolio.filter(p => p.vehicleType !== 'cpf_life' && p.vehicleType !== 'rental')
    if (perfVehicles.length === 0) return null
    const now = new Date()
    const allFlows: { amount: number; date: Date }[] = []

    perfVehicles.forEach(p => {
      if (p.vehicleType === 'investment' || p.vehicleType === 'other') {
        const startDate = p.startMonth ? new Date(p.startMonth + '-01') : p.startYear ? new Date(p.startYear, 0, 1) : null
        if (!startDate) return
        if (p.mode === 'Lump Sum') {
          // Lump sum: single initial outflow + any cashflow events
          if ((p.monthlyContribution || 0) > 0) allFlows.push({ amount: -(p.monthlyContribution), date: new Date(startDate) })
          ;(p.cashflows || []).forEach(cf => {
            const [yr, mo] = cf.date.split('-').map(Number)
            if (cf.type === 'top_up') allFlows.push({ amount: -cf.amount, date: new Date(yr, mo - 1, 1) })
            if (cf.type === 'withdrawal') allFlows.push({ amount: cf.amount, date: new Date(yr, mo - 1, 1) })
          })
        } else {
          const changeEvents = (p.cashflows || []).filter(cf => cf.type === 'contribution_change').sort((a, b) => a.date.localeCompare(b.date))
          const holidayMonths = new Set<string>()
          ;(p.cashflows || []).filter(cf => cf.type === 'premium_holiday' || cf.type === 'missed_premium').forEach(cf => {
            const hd = new Date(cf.date + '-01'); const he = cf.endDate ? new Date(cf.endDate + '-01') : new Date(cf.date + '-01')
            while (hd <= he) { holidayMonths.add(hd.toISOString().slice(0, 7)); hd.setMonth(hd.getMonth() + 1) }
          })
          let activeRate = p.monthlyContribution; let rateIdx = 0
          const iter = new Date(startDate)
          while (iter <= now) {
            const ym = iter.toISOString().slice(0, 7)
            while (rateIdx < changeEvents.length && changeEvents[rateIdx].date <= ym) { activeRate = changeEvents[rateIdx].amount; rateIdx++ }
            if (activeRate > 0 && !holidayMonths.has(ym)) allFlows.push({ amount: -activeRate, date: new Date(iter) })
            iter.setMonth(iter.getMonth() + 1)
          }
          ;(p.cashflows || []).forEach(cf => {
            const [yr, mo] = cf.date.split('-').map(Number)
            if (cf.type === 'top_up') allFlows.push({ amount: -cf.amount, date: new Date(yr, mo - 1, 1) })
            if (cf.type === 'withdrawal') allFlows.push({ amount: cf.amount, date: new Date(yr, mo - 1, 1) })
          })
        }
      } else if (p.vehicleType === 'srs') {
        const startYr = p.srsStartYear || new Date().getFullYear()
        const annual = p.srsAnnualContribution || 0
        if (annual > 0) {
          if (p.srsIsRegular) {
            for (let yr = startYr; yr <= now.getFullYear(); yr++) {
              allFlows.push({ amount: -annual, date: new Date(yr, 0, 1) })
            }
          } else {
            allFlows.push({ amount: -annual, date: new Date(startYr, 0, 1) })
          }
        }
      } else if (p.vehicleType === 'endowment') {
        const premium = p.endowmentPremium || 0
        if (premium > 0) {
          const startDate = new Date(p.startYear || new Date().getFullYear(), 0, 1)
          const iter = new Date(startDate)
          while (iter <= now) {
            allFlows.push({ amount: -premium, date: new Date(iter) })
            iter.setMonth(iter.getMonth() + 1)
          }
        }
      } else if (p.vehicleType === 'annuity') {
        const premium = p.monthlyContribution || 0
        if (premium > 0) {
          const startDate = new Date(p.startYear || new Date().getFullYear(), 0, 1)
          const iter = new Date(startDate)
          while (iter <= now) {
            allFlows.push({ amount: -premium, date: new Date(iter) })
            iter.setMonth(iter.getMonth() + 1)
          }
        }
      }
    })

    // Terminal inflow: total current value of all included vehicles
    const totalValue = perfVehicles.reduce((s, p) => s + (p.currentValue || 0), 0)
    if (totalValue <= 0 || allFlows.length === 0) return null
    allFlows.push({ amount: totalValue, date: new Date() })
    allFlows.sort((a, b) => a.date.getTime() - b.date.getTime())

    const result = xirr(allFlows)
    return result // already in percentage e.g. 7.33
  }, [filteredPortfolio])

 const projectedPortfolioData = useMemo(() => {
    const now = new Date()
    const currentYear = now.getFullYear()
    const lifeEnd = Math.max(lifeExpectancy, spouseLifeExpectancy + (clientAge - spouseAge), clientAge + 35, 85)
    const ages = Array.from({ length: lifeEnd - clientAge + 1 }, (_, i) => clientAge + i)
    const earliestRetAge = earliestRetirementAge
    const inflationRate = retirementInflation / 100
    const legacyAmt = settings.legacyAmount || 0
    const finalDeathAge = planMode === 'couple'
      ? Math.max(lifeExpectancy, spouseLifeExpectancy + (clientAge - spouseAge))
      : lifeExpectancy

    // Non-retirement goals sorted by targetAge — deduct corpus at each milestone
    const nonRetGoals = filteredGoals
      .filter(g => g.source !== 'retirement')
      .sort((a, b) => a.targetAge - b.targetAge)
    const goalQueue = nonRetGoals.map(g => ({ ...g }))

    const projectedLine: number[] = []
    let portfolioCorpus = 0
    let retirementCorpusPF: number | null = null

    filteredPortfolio.forEach(p => {
      if (p.vehicleType === 'cpf_life' || p.vehicleType === 'rental') return
      portfolioCorpus += p.currentValue || 0
    })

    for (let i = 0; i < ages.length; i++) {
      const a = ages[i]
      projectedLine.push(Math.max(0, portfolioCorpus))

      if (a === earliestRetAge && retirementCorpusPF === null) {
        retirementCorpusPF = portfolioCorpus
      }

      if (a < earliestRetAge) {
        // ── Accumulation ──────────────────────────────────────────────
        let annualGrowth = 0

        filteredPortfolio.forEach(p => {
          if (p.vehicleType === 'cpf_life' || p.vehicleType === 'rental') return

          if (p.vehicleType === 'srs') {
            const effWithdrawalAge = Math.max(p.srsWithdrawalStartAge || 63, retirementAge)
            if (a < effWithdrawalAge && p.srsIsRegular && (p.srsAnnualContribution || 0) > 0) {
              annualGrowth += p.srsAnnualContribution || 0
            }
          } else if (p.vehicleType === 'endowment') {
            annualGrowth += (p.endowmentPremium || 0) * 12
          } else if (p.vehicleType === 'annuity') {
            annualGrowth += (p.monthlyContribution || 0) * 12
          } else if (p.vehicleType === 'investment' || p.vehicleType === 'other') {
            if (p.mode === 'Lump Sum') {
              // No ongoing contributions
            } else {
              // Respect endMonth
              if (p.endMonth) {
                const endYear = parseInt(p.endMonth.slice(0, 4))
                if (currentYear + (a - clientAge) > endYear) return
              }
              // Latest contribution_change rate
              const changeEvents = [...(p.cashflows || [])]
                .filter(cf => cf.type === 'contribution_change')
                .sort((a, b) => b.date.localeCompare(a.date))
              const latestChange = changeEvents[0]
              const activeMonthly = latestChange ? latestChange.amount : (p.monthlyContribution || 0)
              annualGrowth += activeMonthly * 12
            }
          }
        })

        portfolioCorpus = portfolioCorpus * (1 + settings.expectedReturn / 100) + annualGrowth

        // Endowment maturity lump sum
        filteredPortfolio.forEach(p => {
          if (p.vehicleType === 'endowment') {
            const maturityAge = clientAge + ((p.endowmentMaturityYear || currentYear) - currentYear)
            if (a === maturityAge) portfolioCorpus += p.endowmentMaturityValue || 0
          }
        })

        // Deduct non-retirement goal corpuses at their target age
        while (goalQueue.length > 0 && goalQueue[0].targetAge <= a) {
          const g = goalQueue.shift()!
          portfolioCorpus = Math.max(0, portfolioCorpus - g.targetCorpus)
        }

      } else {
        // ── Drawdown ──────────────────────────────────────────────────
        const corpusPF = retirementCorpusPF ?? portfolioCorpus
        const retYearsPF = Math.max(1, finalDeathAge - earliestRetAge)

        let guaranteedAnnual = 0
        filteredPortfolio.forEach(p => {
          if (p.vehicleType === 'cpf_life' && a >= (p.cpfPayoutStartAge || 65)) {
            guaranteedAnnual += (p.cpfMonthlyPayout || 0) * 12
          }
          if (p.vehicleType === 'annuity' && a >= (p.annuityStartAge || 65)) {
            guaranteedAnnual += (p.annuityMonthlyIncome || 0) * 12
          }
          if (p.vehicleType === 'rental' && a <= (p.rentalStopAge || 75)) {
            guaranteedAnnual += (p.rentalMonthlyNet || 0) * 12
          }
          if (p.vehicleType === 'srs') {
            const effWithdrawalAge = Math.max(p.srsWithdrawalStartAge || 63, retirementAge)
            const endWithdrawalAge = effWithdrawalAge + (p.srsWithdrawalDuration || 10)
            if (a >= effWithdrawalAge && a < endWithdrawalAge) {
              const yearsToW = Math.max(1, effWithdrawalAge - clientAge)
              const pRate = (p.expectedReturn || settings.expectedReturn) / 100
              let srsBalAtWithdrawal = (p.currentValue || 0) * Math.pow(1 + pRate, yearsToW)
              if (p.srsIsRegular && (p.srsAnnualContribution || 0) > 0) {
                srsBalAtWithdrawal += pRate > 0
                  ? (p.srsAnnualContribution || 0) * ((Math.pow(1 + pRate, yearsToW) - 1) / pRate) * (1 + pRate)
                  : (p.srsAnnualContribution || 0) * yearsToW
              }
              const dur = p.srsWithdrawalDuration || 10
              const g = inflationRate
              const annualBase = Math.abs(pRate - g) < 0.0001
                ? srsBalAtWithdrawal / dur
                : srsBalAtWithdrawal * (pRate - g) / (1 - Math.pow((1 + g) / (1 + pRate), dur))
              guaranteedAnnual += annualBase * Math.pow(1 + g, a - effWithdrawalAge)
            }
          }
        })

        // Use the actual retirement income need, inflation-escalated each year
        // derivedAnnualWithdrawal is the Year 1 annual withdrawal from the retirement goal corpus
        const annualNeeded = derivedAnnualWithdrawal > 0
          ? derivedAnnualWithdrawal * Math.pow(1 + inflationRate, a - earliestRetAge)
          : (corpusPF / Math.max(1, retYearsPF)) * Math.pow(1 + inflationRate, a - earliestRetAge)
        const netDrawdown = Math.max(0, annualNeeded - guaranteedAnnual)
        portfolioCorpus = Math.max(0, portfolioCorpus * (1 + postRetirementReturn / 100) - netDrawdown)
      }
    }

    const retireIdx = ages.indexOf(earliestRetAge)
    const atRetirement = retireIdx >= 0 ? projectedLine[retireIdx] : 0

    return { projectedLine, ages, atRetirement }
  }, [
    filteredPortfolio, filteredGoals, settings,
    clientAge, spouseAge, retirementAge, spouseRetirementAge,
    lifeExpectancy, spouseLifeExpectancy,
    postRetirementReturn, retirementInflation, planMode,
    earliestRetirementAge,
  ])

  const projectedAtRetirement = useMemo(() => {
    const atAssumption = projectedPortfolioData.atRetirement
    return { atAssumption, atActual: atAssumption }
  }, [projectedPortfolioData])

  // Corpus shortfall/surplus: projected portfolio at retirement vs required corpus
  const retGoalForSummary = filteredGoals.find(g => g.source === 'retirement')
  const legacyAdjustedCorpus = useMemo(() => {
    if (!retGoalForSummary || !settings.legacyAmount) return retGoalForSummary?.targetCorpus || 0
    const finalDE = planMode === 'couple'
      ? Math.max(lifeExpectancy, spouseLifeExpectancy + (clientAge - spouseAge))
      : lifeExpectancy
    const n = Math.max(1, finalDE - earliestRetirementAge)
    const legacyPV = settings.legacyAmount / Math.pow(1 + postRetirementReturn / 100, n)
    return (retGoalForSummary.targetCorpus || 0) + legacyPV
  }, [retGoalForSummary, settings.legacyAmount, postRetirementReturn, lifeExpectancy, spouseLifeExpectancy, clientAge, spouseAge, planMode, earliestRetirementAge])
  const requiredCorpusAtRet = legacyAdjustedCorpus
  const corpusShortfall = requiredCorpusAtRet - projectedAtRetirement.atAssumption

  // Guaranteed monthly retirement income from all income-stream vehicles
  const guaranteedMonthlyRetirement = useMemo(() => {
    return filteredPortfolio.reduce((sum, p) => {
    if (p.vehicleType === 'cpf_life') return sum + (p.cpfMonthlyPayout || 0)
    if (p.vehicleType === 'annuity') return sum + (p.annuityMonthlyIncome || 0)
    if (p.vehicleType === 'rental') return sum + (p.rentalMonthlyNet || 0)
    if (p.vehicleType === 'srs') {
      const effAge = Math.max(p.srsWithdrawalStartAge || 63, retirementAge)
      const yearsToW = Math.max(1, effAge - clientAge)
      const pRate = (p.expectedReturn || settings.expectedReturn) / 100
      let bal = (p.currentValue || 0) * Math.pow(1 + pRate, yearsToW)
      if (p.srsIsRegular && (p.srsAnnualContribution || 0) > 0) {
        bal += pRate > 0
          ? (p.srsAnnualContribution || 0) * ((Math.pow(1 + pRate, yearsToW) - 1) / pRate) * (1 + pRate)
          : (p.srsAnnualContribution || 0) * yearsToW
      }
      const dur = p.srsWithdrawalDuration || 10
      const g = retirementInflation / 100
      const annualBase = Math.abs(pRate - g) < 0.0001
        ? bal / dur
        : bal * (pRate - g) / (1 - Math.pow((1 + g) / (1 + pRate), dur))
      return sum + annualBase / 12
    }
    return sum
    }, 0)
  }, [filteredPortfolio, retirementAge, clientAge, settings.expectedReturn, retirementInflation])

  const netMonthlyGapAfterIncome = Math.max(0, totalMonthlyNeeded - totalMonthlyInvesting - guaranteedMonthlyRetirement)

  // Top-level corpus calculation — shared by goal card and breakdown panel
  const retirementBreakdown = useMemo(() => {
    if (effectiveRetirementIncome <= 0) return null
    const yearsToRet = Math.max(0, retirementAge - clientAge)
    const inflFactor = Math.pow(1 + retirementInflation / 100, yearsToRet)
    const inflatedMonthlyIncome = effectiveRetirementIncome * inflFactor
    const inflatedAnnualHolidays = effectiveAnnualHolidays * inflFactor
    const annualGapTotal = inflatedMonthlyIncome * 12 + inflatedAnnualHolidays
    const finalDE = planMode === 'couple'
      ? Math.max(lifeExpectancy, spouseLifeExpectancy + (clientAge - spouseAge))
      : lifeExpectancy
    // Use retirementAge (client) as the drawdown start — matches Retirement page exactly
    const n = Math.max(1, finalDE - retirementAge)
    const rr = postRetirementReturn / 100
    const gg = retirementInflation / 100
    const legacyPV = settings.legacyAmount ? settings.legacyAmount / Math.pow(1 + rr, n) : 0
    // PV of full growing need (annuity-due, grows at inflation)
    let pvFullNeed: number
    if (Math.abs(rr - gg) < 0.0001) {
      pvFullNeed = annualGapTotal * n * (1 + rr)
    } else {
      const ratio = (1 + gg) / (1 + rr)
      pvFullNeed = annualGapTotal * (1 - Math.pow(ratio, n)) / (rr - gg) * (1 + rr)
    }
    // PV of each fixed nominal stream separately — each has its own duration
    // Guaranteed income streams do NOT grow with inflation
    const pvFixedAnnuityDue = (annual: number, years: number) => {
      if (annual <= 0 || years <= 0) return 0
      return rr > 0
        ? annual * (1 - Math.pow(1 / (1 + rr), years)) / (rr / (1 + rr))
        : annual * years
    }
    const pvFixedStream = filteredPortfolio.reduce((sum, p) => {
      if (p.vehicleType === 'cpf_life') {
        // CPF Life: lifetime payout — runs full n years
        const cpfStartOffset = Math.max(0, (p.cpfPayoutStartAge || 65) - retirementAge)
        const cpfYears = Math.max(0, n - cpfStartOffset)
        const pv = pvFixedAnnuityDue((p.cpfMonthlyPayout || 0) * 12, cpfYears)
        // Discount back if payout starts after retirement
        return sum + pv / Math.pow(1 + rr, cpfStartOffset)
      }
      if (p.vehicleType === 'annuity') {
        // Annuity: runs from annuityStartAge for annuityGuaranteeYears
        const startOffset = Math.max(0, (p.annuityStartAge || retirementAge) - retirementAge)
        const guaranteeYears = Math.min(p.annuityGuaranteeYears || n, n - startOffset)
        const pv = pvFixedAnnuityDue((p.annuityMonthlyIncome || 0) * 12, Math.max(0, guaranteeYears))
        return sum + pv / Math.pow(1 + rr, startOffset)
      }
      if (p.vehicleType === 'rental') {
        // Rental: runs from retirement until rentalStopAge
        const rentalYears = Math.max(0, Math.min((p.rentalStopAge || 75) - retirementAge, n))
        return sum + pvFixedAnnuityDue((p.rentalMonthlyNet || 0) * 12, rentalYears)
      }
      return sum
    }, 0)
    // Net corpus = PV(full need) - PV(fixed streams) + legacy
    const corpusPV = Math.max(legacyPV, pvFullNeed - pvFixedStream + legacyPV)
    return { inflatedMonthlyIncome, inflatedAnnualHolidays, annualGapTotal, baseAdjustedCorpus: corpusPV }
  }, [effectiveRetirementIncome, effectiveAnnualHolidays, earliestRetirementAge, clientAge, spouseAge,
      retirementAge, retirementInflation, planMode, lifeExpectancy, spouseLifeExpectancy,
      postRetirementReturn, settings.legacyAmount, guaranteedMonthlyRetirement])

  // Keep ref in sync so debounced saves always use latest value
  useEffect(() => {
    if (retirementBreakdown) {
      breakdownShortfallRef.current = Math.max(0, retirementBreakdown.baseAdjustedCorpus - projectedAtRetirement.atActual)
    }
  }, [retirementBreakdown, projectedAtRetirement])

  // Also set synchronously so it's available on same-render saves
  {
    const solveFor = (gap: number) => {
      if (gap <= 0) return null
      const _r = settings.expectedReturn / 100
      const _rm = _r / 12
      const _n = Math.max(1, retirementAge - clientAge) * 12
      const _af = _rm > 0 ? ((Math.pow(1 + _rm, _n) - 1) / _rm) * (1 + _rm) : _n
      return {
        pureMonthly: _af > 0 ? gap / _af : 0,
        pureLump: gap / Math.pow(1 + _r, Math.max(1, retirementAge - clientAge)),
        lumpSumFraction,
      }
    }
    if (retirementBreakdown && projectedAtRetirement) {
      const _gap = Math.max(0, retirementBreakdown.baseAdjustedCorpus - projectedAtRetirement.atActual)
      breakdownShortfallRef.current = _gap
      shortfallSolutionRef.current = solveFor(_gap)
    } else {
      // retirementBreakdown couldn't be computed (no desired income, no
      // current expenses, no derivable withdrawal) — fall back to the
      // simpler corpusShortfall gap so shortfallSolution doesn't silently
      // stay null while retirementShortfall (which already falls back to
      // corpusShortfall in saveData) reports a real gap. Without this,
      // the report's Required Amount could read $0 even with a real
      // shortfall on file.
      shortfallSolutionRef.current = solveFor(Math.max(0, corpusShortfall))
    }
  }

  // ── Full lifecycle chart series (accumulation + drawdown) — pure data,
  // independent of the canvas, so it can be persisted and the report can
  // render an identical chart without re-deriving this engine a second time.
  const fullLifecycleSeries = useMemo(() => {
    const lifeEnd = Math.max(lifeExpectancy, spouseLifeExpectancy + (clientAge - spouseAge), clientAge + 35, 85)
    const ages = Array.from({ length: lifeEnd - clientAge + 1 }, (_, i) => clientAge + i)
    const inflationRate = retirementInflation / 100
    const legacyAmt = settings.legacyAmount || 0
    const spouseDeathInClientYears = spouseLifeExpectancy + (clientAge - spouseAge)
    const finalDeathAge = planMode === 'couple'
      ? Math.max(lifeExpectancy, spouseDeathInClientYears)
      : lifeExpectancy

    const retGoal = filteredGoals.find(g => g.source === 'retirement') || null
    const nonRetGoals = filteredGoals
      .filter(g => g.source !== 'retirement')
      .sort((a, b) => a.targetAge - b.targetAge)

    const earliestRetAge = earliestRetirementAge
    const retireIdx = ages.indexOf(earliestRetAge)

    const milestonesByAge: Record<number, { label: string; amount: number }[]> = {}
    const requiredLine: number[] = []
    const corpusAtAge: Record<number, number> = {}
    let corpus = 0
    let runningMonthly = filteredGoals.reduce((s, g) => s + g.monthlyRequired, 0)
    const goalQueue = nonRetGoals.map(g => ({ ...g }))

    const rr = postRetirementReturn / 100
    const gg = inflationRate
    const retYears = Math.max(1, finalDeathAge - earliestRetAge)
    const retirementCorpus = legacyAmt > 0
      ? (retGoal?.targetCorpus || 0) + legacyAmt / Math.pow(1 + rr, retYears)
      : (retGoal?.targetCorpus || 0)
    const goldAnnualBase = (() => {
      const deployable = Math.max(0, retirementCorpus - legacyAmt / Math.pow(1 + rr, retYears))
      if (Math.abs(rr - gg) < 0.0001) return deployable / retYears
      const ratio = (1 + gg) / (1 + rr)
      const sumPV = ratio === 1 ? retYears : (1 - Math.pow(ratio, retYears)) / (1 - ratio)
      return deployable / sumPV
    })()

    const rmPre = (settings.expectedReturn / 100) / 12

    for (let i = 0; i < ages.length; i++) {
      const a = ages[i]
      if (a === earliestRetAge) {
        const retirementCorpusReset = legacyAmt > 0
          ? (retGoal?.targetCorpus || 0) + legacyAmt / Math.pow(1 + postRetirementReturn / 100, Math.max(1, finalDeathAge - earliestRetAge))
          : (retGoal?.targetCorpus || 0)
        corpus = retirementCorpusReset
      }
      const recordedCorpus = a === finalDeathAge ? legacyAmt : Math.max(0, corpus)
      requiredLine.push(recordedCorpus)
      corpusAtAge[a] = recordedCorpus

      while (goalQueue.length > 0 && goalQueue[0].targetAge <= a) {
        const g = goalQueue.shift()!
        corpus = Math.max(0, corpus - g.targetCorpus)
        runningMonthly = Math.max(0, runningMonthly - g.monthlyRequired)
        if (!milestonesByAge[a]) milestonesByAge[a] = []
        milestonesByAge[a].push({ label: g.label, amount: g.targetCorpus })
      }

      if (a < earliestRetAge) {
        for (let m = 0; m < 12; m++) {
          corpus = (corpus + runningMonthly) * (1 + rmPre)
        }
      } else {
        const yearsIntoRet = a - earliestRetAge
        const annualWithdrawal = goldAnnualBase * Math.pow(1 + gg, yearsIntoRet)
        corpus = (corpus - annualWithdrawal) * (1 + rr)
      }
    }

    const legacyLine: (number | null)[] | null = legacyAmt > 0
      ? ages.map(a => a >= earliestRetAge ? legacyAmt : null)
      : null

    return { ages, requiredLine, corpusAtAge, milestonesByAge, legacyLine, retireIdx, finalDeathAge, earliestRetAge, goldAnnualBase }
  }, [filteredGoals, settings.expectedReturn, settings.legacyAmount, postRetirementReturn, retirementInflation,
      clientAge, spouseAge, lifeExpectancy, spouseLifeExpectancy, planMode, earliestRetirementAge])

  // Keep the persistable chart series ref in sync — same pattern as
  // breakdownShortfallRef/shortfallSolutionRef above, so saveData() always
  // has the latest computed series without re-deriving it itself.
  useEffect(() => {
    const fl = fullLifecycleSeries
    const milestones = Object.entries(fl.milestonesByAge).flatMap(([ageStr, arr]) =>
      arr.map(m => ({ age: parseInt(ageStr), label: m.label, amount: Math.round(m.amount) })))
    chartSeriesRef.current = {
      ages: fl.ages,
      requiredLine: fl.requiredLine.map(v => Math.round(v)),
      projectedLine: projectedPortfolioData.projectedLine.map(v => Math.round(v)),
      legacyLine: fl.legacyLine,
      milestones,
      retireIdx: fl.retireIdx,
      retirementAge: fl.earliestRetAge,
      finalDeathAge: fl.finalDeathAge,
      goldAnnualBase: Math.round(fl.goldAnnualBase),
      guaranteedMonthlyRetirement: Math.round(guaranteedMonthlyRetirement),
      planMode,
      clientAge,
      spouseAge,
    }
  }, [fullLifecycleSeries, projectedPortfolioData, guaranteedMonthlyRetirement, planMode, clientAge, spouseAge])

 // ── CHART ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (loading) return
    if (!chartRef.current) return

    const existing = Chart.getChart(chartRef.current)
    if (existing) existing.destroy()
    if (chartInstance.current) {
      chartInstance.current.destroy()
      chartInstance.current = null
    }

    const timer = setTimeout(() => {
      if (!chartRef.current) return
      const canvasCtx = chartRef.current.getContext('2d')
      if (!canvasCtx) return

      // Pure series math now lives in fullLifecycleSeries (a useMemo above) —
      // this effect only turns it into a Chart.js render.
      const { ages, requiredLine, corpusAtAge, milestonesByAge, legacyLine, retireIdx, finalDeathAge, earliestRetAge, goldAnnualBase } = fullLifecycleSeries
      const { projectedLine } = projectedPortfolioData

      // ── Milestone dot plugin ───────────────────────────────────────────
      // Draws a circle + label at each non-retirement goal's targetAge on the line
      const milestonePlugin = {
        id: 'milestones',
        afterDatasetsDraw(chart: any) {
          const xAxis = chart.scales.x
          const yAxis = chart.scales.y
          if (!xAxis || !yAxis) return
          const ctx = chart.ctx

          Object.entries(milestonesByAge).forEach(([ageStr, msArr]) => {
            const age = parseInt(ageStr)
            const idx = ages.indexOf(age)
            if (idx < 0) return
            const x = xAxis.getPixelForValue(idx)
            const corpusVal = corpusAtAge[age] ?? 0
            const dotY = yAxis.getPixelForValue(corpusVal)

            ctx.save()

            // Vertical dashed guide line
            ctx.beginPath()
            ctx.setLineDash([4, 4])
            ctx.moveTo(x, yAxis.top)
            ctx.lineTo(x, yAxis.bottom)
            ctx.strokeStyle = 'rgba(94,138,106,0.2)'
            ctx.lineWidth = 1
            ctx.stroke()
            ctx.setLineDash([])

            // Dot on line
            ctx.beginPath()
            ctx.arc(x, dotY, 6, 0, Math.PI * 2)
            ctx.fillStyle = '#5E8A6A'
            ctx.fill()
            ctx.strokeStyle = 'white'
            ctx.lineWidth = 2
            ctx.stroke()

            ctx.restore()
          })
        }
      }

      const retireLinePlugin = {
        id: 'retireLine',
        afterDraw(chart: any) {
          if (retireIdx < 0) return
          const xAxis = chart.scales.x
          const yAxis = chart.scales.y
          if (!xAxis || !yAxis) return
          const x = xAxis.getPixelForValue(retireIdx)
          const ctx = chart.ctx
          const retirementMeta = chart.getDatasetMeta(0)
          const retirePoint = retirementMeta?.data?.[retireIdx]
          const lineY = retirePoint ? retirePoint.y : yAxis.top + 60

          ctx.save()

          // Vertical dashed guide
          ctx.beginPath()
          ctx.setLineDash([4, 4])
          ctx.moveTo(x, yAxis.top)
          ctx.lineTo(x, lineY)
          ctx.strokeStyle = 'rgba(168,131,74,0.3)'
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.setLineDash([])

          // Gold dot on line
          ctx.beginPath()
          ctx.arc(x, lineY, 6, 0, Math.PI * 2)
          ctx.fillStyle = '#A8834A'
          ctx.fill()
          ctx.strokeStyle = 'white'
          ctx.lineWidth = 2
          ctx.stroke()

          ctx.restore()
        }
      }

     const datasets: any[] = []

      datasets.push({
        label: 'Capital Required',
        data: requiredLine,
        borderColor: '#A8834A',
        backgroundColor: (context: any) => {
          const chart = context.chart
          const { ctx: c, chartArea } = chart
          if (!chartArea) return 'rgba(168,131,74,0.05)'
          const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
          gradient.addColorStop(0, 'rgba(168,131,74,0.12)')
          gradient.addColorStop(1, 'rgba(168,131,74,0.01)')
          return gradient
        },
        borderWidth: 2.5,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#A8834A',
        pointHoverBorderColor: 'white',
        pointHoverBorderWidth: 2,
        fill: true,
      })

      if (projectedLine.some(v => v > 0)) {
        datasets.push({
          label: 'Projected Portfolio',
          data: projectedLine,
          borderColor: '#4A9E8A',
          backgroundColor: 'rgba(74,158,138,0.04)',
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: '#4A9E8A',
          pointHoverBorderColor: 'white',
          pointHoverBorderWidth: 2,
          fill: false,
        })
      }

      if (legacyLine) {
        datasets.push({
          label: 'Legacy Floor',
          data: legacyLine,
          borderColor: 'rgba(196,164,100,0.5)',
          backgroundColor: 'rgba(196,164,100,0.03)',
          borderDash: [3, 3],
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          tension: 0,
          spanGaps: false,
        })
      }

      try {
        chartInstance.current = new Chart(canvasCtx, {
          type: 'line',
          plugins: [retireLinePlugin, milestonePlugin],
          data: {
            labels: ages.map(a => fmtAge(a, planMode === 'couple', clientAge, spouseAge)),
            datasets,
          },
          options: {
              responsive: true, maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              layout: { padding: { bottom: 0 } },
            plugins: {
              legend: {
                labels: {
                  color: '#9A9690', font: { size: 11 }, boxWidth: 20,
                  filter: (item: any) => item.text !== 'null'
                }
              },
              tooltip: {
                backgroundColor: 'rgba(26,24,22,0.95)',
                titleColor: 'rgba(196,164,100,0.9)',
                bodyColor: 'rgba(240,237,232,0.85)',
                padding: 14,
                titleFont: { size: 12, weight: 'bold' },
                bodyFont: { size: 11 },
                callbacks: {
                  title: (ctxs: any[]) => {
                    if (!ctxs.length) return ''
                    const idx = ctxs[0].dataIndex
                    const a = ages[idx]
                    const phase = a < retirementAge ? 'Accumulation' : a === retirementAge ? 'Retirement Begins' : 'Retirement'
                    return `${fmtAge(a, planMode === 'couple', clientAge, spouseAge)}  ·  ${phase}`
                  },
                  label: (ctx: any) => {
                    if (ctx.parsed.y === null || ctx.parsed.y === undefined || ctx.parsed.y < 0) return ''
                    return `  ${ctx.dataset.label}:  ${fmt(ctx.parsed.y)}`
                  },
                  afterBody: (ctxs: any[]) => {
                    if (!ctxs.length) return []
                    const idx = ctxs[0].dataIndex
                    const a = ages[idx]
                    const lines: string[] = []
                    // Show milestone if this age has a goal deduction
                   if (milestonesByAge[a]?.length) {
                      milestonesByAge[a].forEach(ms => {
                        lines.push('')
                        lines.push(`  🎯  ${ms.label}`)
                        lines.push(`       Corpus released: −${fmt(ms.amount)}`)
                      })
                    }
                    // Show retirement corpus at retirement age
                    if (a === retirementAge && corpusAtAge[retirementAge]) {
                      lines.push('')
                      lines.push(`  🏖  Portfolio target at retirement: ${fmt(corpusAtAge[retirementAge])}`)
                    }
                    // Show annual retirement income required at this age
                    if (a >= earliestRetAge && goldAnnualBase > 0) {
                      const annualAtAge = goldAnnualBase * Math.pow(1 + retirementInflation / 100, a - earliestRetAge)
                      lines.push('')
                      lines.push(`  💸  Retirement income: ${fmtMo(annualAtAge / 12)} (${fmt(annualAtAge)}/yr)`)
                    }
                    // Show monthly contributions still running
                    const activeGoals = filteredGoals.filter(g => g.source !== 'retirement' && g.targetAge > a)
                    if (a < retirementAge && activeGoals.length > 0) {
                      const mo = activeGoals.reduce((s, g) => s + g.monthlyRequired, 0) + (filteredGoals.find(g => g.source === 'retirement')?.monthlyRequired ?? 0)
                      lines.push('')
                      lines.push(`  📅  Saving: ${fmtMo(mo)}`)
                    }
                    return lines
                  },
                  footer: (ctxs: any[]) => {
                    if (!ctxs.length) return []
                    const idx = ctxs[0].dataIndex
                    const a = ages[idx]
                    if (a >= retirementAge && a < finalDeathAge) {
                      const yrsLeft = finalDeathAge - a
                      return [`  ${yrsLeft} yrs to life expectancy (${fmtAge(finalDeathAge, planMode === 'couple', clientAge, spouseAge)})`]
                    }
                    return []
                  },
                },
              },
            },
            scales: {
              x: { ticks: { color: '#9A9690', font: { size: 9 }, maxTicksLimit: 14 }, grid: { display: false } },
             y: {
                ticks: { callback: (v: any) => fmt(v), color: '#9A9690', font: { size: 9 } },
                grid: { color: 'rgba(26,24,22,0.04)' }, min: 0,
                max: Math.max(...requiredLine.filter(v => isFinite(v))) * 1.15,
              },
            },
          },
        })
      } catch (error) {
        console.error('Chart creation failed:', error)
      }
    }, 50)

    return () => {
      clearTimeout(timer)
      if (chartInstance.current) {
        chartInstance.current.destroy()
        chartInstance.current = null
      }
    }
  }, [
    loading, projectedPortfolioData, fullLifecycleSeries, filteredGoals, settings,
    clientAge, spouseAge, retirementAge, spouseRetirementAge, lifeExpectancy, spouseLifeExpectancy,
    effectiveRetirementIncome, postRetirementReturn, retirementInflation, planMode,
    earliestRetirementAge,
  ])

  // ── RENDER ────────────────────────────────────────────────────────────────
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)' }}>Loading…</div></div>
  if (!client) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)' }}>No client selected.</div></div>

  const vehicleTypeColors: Record<VehicleType, string> = {
    investment: '#4A9E8A', cpf_life: '#4A7C9E', srs: '#2D5A4E', endowment: '#A8834A', annuity: '#6B5B8B', rental: '#5E8A6A', other: '#9A9690'
  }

  type StripTone = 'good' | 'warn' | 'bad' | 'neutral'
  let narrativeStrip: { tone: StripTone; text: React.ReactNode } | null = null
  const displayXIRR = portfolioXIRR !== null ? portfolioXIRR : blendedXIRR
  if (displayXIRR !== null && filteredPortfolio.length > 0) {
    const diff = displayXIRR - settings.expectedReturn
    const diffAbs = Math.abs(diff).toFixed(1)
    const shortfallAtRet = projectedAtRetirement.atAssumption - projectedAtRetirement.atActual
    let tone: StripTone
    if (diff >= 0.5) tone = 'good'
    else if (diff >= -0.5) tone = 'neutral'
    else if (diff >= -2) tone = 'warn'
    else tone = 'bad'
    narrativeStrip = {
      tone,
      text: (
        <>
          Your portfolio is returning{' '}
          <strong style={{ color: tone === 'good' ? '#4A9E8A' : tone === 'warn' ? '#A8834A' : tone === 'bad' ? '#E08080' : 'var(--ink)' }}>
            {displayXIRR.toFixed(1)}%
          </strong>
          {' — '}that&apos;s {diff >= 0 ? <strong style={{ color: '#4A9E8A' }}>{diffAbs}% above</strong> : <strong style={{ color: tone === 'bad' ? '#E08080' : '#A8834A' }}>{diffAbs}% below</strong>} your{' '}
          <strong>{settings.expectedReturn}%</strong> assumption. At this pace, you&apos;ll reach{' '}
          <strong>{fmt(projectedAtRetirement.atActual)}</strong> by age {retirementAge}
          {requiredCorpusAtRet > 1000 && (
            <>
              {' '}instead of the <strong>{fmt(requiredCorpusAtRet)}</strong> portfolio target
              {projectedAtRetirement.atActual >= requiredCorpusAtRet
                ? ` (a ${fmt(projectedAtRetirement.atActual - requiredCorpusAtRet)} surplus)`
                : ` (a ${fmt(requiredCorpusAtRet - projectedAtRetirement.atActual)} shortfall)`}
            </>
          )}.
        </>
      ),
    }
  }

  const stripBg = narrativeStrip?.tone === 'good' ? 'rgba(74,158,138,0.08)'
    : narrativeStrip?.tone === 'warn' ? 'rgba(168,131,74,0.08)'
    : narrativeStrip?.tone === 'bad' ? 'rgba(224,128,128,0.08)'
    : 'var(--cream2)'
  const stripBorder = narrativeStrip?.tone === 'good' ? '#4A9E8A'
    : narrativeStrip?.tone === 'warn' ? '#A8834A'
    : narrativeStrip?.tone === 'bad' ? '#E08080'
    : 'var(--line)'

  // Chart canvas key: include all values that affect chart shape so canvas remounts properly
  const chartKey = [
    filteredGoals.length,
    settings.legacyAmount, settings.expectedReturn, settings.incomeSource,
    retirementInflation, postRetirementReturn,
    retirementAge, lifeExpectancy,
  ].join('-')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>

      {/* ── HERO BAND ── */}
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '28px 0 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 30, fontWeight: 300, color: '#F0EDE8', lineHeight: 1.1 }}>Capital Mandate</div>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
              {personLabel} · {filteredGoals.length} goal{filteredGoals.length !== 1 ? 's' : ''} · {planMode === 'couple' ? 'Joint planning' : 'Individual planning'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', padding: '20px 0' }}>
          {(() => {
            const simpleMonthlyGap = totalMonthlyNeeded - totalMonthlyInvesting
            const portfolioOnTrack = projectedAtRetirement.atAssumption >= requiredCorpusAtRet
            const portfolioGapAmt = requiredCorpusAtRet - projectedAtRetirement.atAssumption
            const items = [
              {
                label: 'Total Capital Required',
                val: fmt(totalCorpus),
                sub: `across ${filteredGoals.length} goal${filteredGoals.length !== 1 ? 's' : ''}`,
                color: '#C4A464',
              },
              {
                label: 'Monthly Savings Needed',
                val: fmtMo(totalMonthlyNeeded),
                sub: 'to fund all goals',
                color: '#F0EDE8',
              },
              {
                label: 'Currently Committing',
                val: fmtMo(totalMonthlyInvesting),
                sub: `across ${filteredPortfolio.filter(p => p.mode !== 'Lump Sum' && (p.monthlyContribution > 0 || (p.endowmentPremium || 0) > 0 || (p.srsIsRegular && (p.srsAnnualContribution || 0) > 0))).length} vehicle${filteredPortfolio.filter(p => p.mode !== 'Lump Sum' && (p.monthlyContribution > 0 || (p.endowmentPremium || 0) > 0 || (p.srsIsRegular && (p.srsAnnualContribution || 0) > 0))).length !== 1 ? 's' : ''}`,
                color: '#F0EDE8',
              },
              {
                label: portfolioOnTrack ? 'Portfolio Status' : 'Portfolio Shortfall',
                val: portfolioOnTrack ? 'On Track' : '−' + fmt(portfolioGapAmt),
                sub: portfolioOnTrack ? `Projected ${fmt(projectedAtRetirement.atAssumption)} covers target` : 'Projected portfolio below target',
                color: portfolioOnTrack ? '#80C4A0' : '#E08080',
              },
              {
                label: 'Current Portfolio Value',
                val: fmt(totalCurrentValue),
                sub: totalCurrentValue > 0 ? `+${fmt(totalCurrentValue - filteredPortfolio.reduce((s, p) => s + (p.totalContributed || p.currentValue || 0), 0))} unrealised gain` : 'No positions yet',
                color: '#80B4C4',
              },
            ]
            return items.map((s, i) => (
              <div key={i} style={{ flex: 1, paddingRight: i < items.length - 1 ? 28 : 0, borderRight: i < items.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none', marginRight: i < items.length - 1 ? 28 : 0 }}>
                <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300, color: s.color }}>{s.val}</div>
                <div style={{ fontFamily: 'Inter', fontSize: 9, color: 'rgba(255,255,255,0.28)', marginTop: 4 }}>{s.sub}</div>
              </div>
            ))
          })()}
        </div>
      </div>

      {/* ── SETTINGS BAR ── */}
      <div style={{ background: 'var(--cream2)', borderBottom: '1px solid var(--line)', padding: '10px 48px', display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', flexShrink: 0 }}>Assumptions</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', whiteSpace: 'nowrap' }}>Pre-Ret. Return</span>
          <input type="range" min={1} max={15} step={0.5} value={settings.expectedReturn} onChange={e => updateSettings({ ...settings, expectedReturn: parseFloat(e.target.value) })} style={{ width: 80, accentColor: 'var(--gold)' }} />
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 500, color: 'var(--ink)', background: 'white', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px', minWidth: 38, textAlign: 'center' }}>{settings.expectedReturn}%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', whiteSpace: 'nowrap' }}>Legacy Floor</span>
          <div style={{ display: 'flex', alignItems: 'center', background: 'white', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
            <span style={{ padding: '4px 8px', fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', borderRight: '1px solid var(--line)' }}>S$</span>
            <input type="number" value={settings.legacyAmount || ''} onChange={e => updateSettings({ ...settings, legacyAmount: parseFloat(e.target.value) || 0 })} placeholder="0" style={{ border: 'none', outline: 'none', padding: '4px 8px', fontFamily: 'DM Mono, monospace', fontSize: 12, width: 90, color: 'var(--ink)' }} />
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ padding: '32px 48px', flex: 1, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* ── 1. GOALS ── */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>From Strategic Objectives</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'var(--ink)' }}>Capital Goals</div>
            </div>
            <button onClick={() => setCustomGoalModal(true)} style={{ fontFamily: 'Inter', fontSize: 11, padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 6, background: 'white', color: 'var(--ink2)', cursor: 'pointer' }}>+ Add Goal</button>
          </div>

          {filteredGoals.length === 0 ? (
            <div style={{ background: 'white', border: '2px dashed var(--line)', borderRadius: 12, padding: '32px 24px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', marginBottom: 4 }}>No goals found</div>
              <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>Set goals in Strategic Objectives or add manually above</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(filteredGoals.length, 4)}, 1fr)`, gap: 12 }}>
              {filteredGoals.map(g => (
                <div key={g.id} style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: g.source === 'retirement' ? '#6B5B8B' : g.source === 'education' ? '#5E8A6A' : g.source === 'wealth' ? '#4A7C9E' : '#A8834A' }} />
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <SourceBadge source={g.source} />
                      {planMode === 'couple' && <OwnerBadge owner={g.owner} clientName={clientName} spouseName={spouseName} />}
                    </div>
                    {g.source === 'custom' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => { setEditingGoal(g); setCustomGoalModal(true) }} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 4, cursor: 'pointer', color: 'var(--ink3)', fontFamily: 'Inter', fontSize: 10, padding: '2px 8px' }}>Edit</button>
                        <button onClick={() => removeGoal(g.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                      </div>
                    )}
                  </div>
                  <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginBottom: 4, lineHeight: 1.3 }}>{g.label}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginBottom: 12 }}>
                    {g.source === 'retirement'
                      ? (() => {
                          const clientYrsAway = Math.max(0, retirementAge - clientAge)
                          const spouseYrsAway = Math.max(0, spouseRetirementAge - spouseAge)
                          const firstRetirer = planMode === 'couple' && spouseYrsAway < clientYrsAway
                            ? { name: spouseName, age: spouseRetirementAge, yrs: spouseYrsAway }
                            : { name: clientName, age: retirementAge, yrs: clientYrsAway }
                          return planMode === 'couple'
                            ? `${fmtAge(retirementAge, true, clientAge, spouseAge)} · ${firstRetirer.yrs} yrs away`
                            : `Age ${retirementAge} · ${clientYrsAway} yrs away`
                        })()
                      : `${fmtAge(g.targetAge, planMode === 'couple', clientAge, spouseAge)} · ${g.yearsAway} yrs away`
                    }
                  </div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{fmtMo(g.monthlyRequired)}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginBottom: 8 }}>monthly required</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--ink2)' }}>
                    {fmt(g.source === 'retirement' && retirementBreakdown ? retirementBreakdown.baseAdjustedCorpus : g.targetCorpus)} portfolio target
                    {g.source === 'retirement' && settings.legacyAmount > 0 && (
                      <span style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--ink3)', marginLeft: 6 }}>
                        (incl. {fmt(settings.legacyAmount)} legacy)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 2. NARRATIVE STRIP ── */}
        {narrativeStrip && (
          <div style={{ background: stripBg, border: `1px solid ${stripBorder}`, borderLeft: `4px solid ${stripBorder}`, borderRadius: 8, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 20, flexShrink: 0 }}>
              {narrativeStrip.tone === 'good' ? '✓' : narrativeStrip.tone === 'warn' ? '!' : narrativeStrip.tone === 'bad' ? '⚠' : 'ℹ'}
            </div>
            <div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, flex: 1 }}>
              {narrativeStrip.text}
            </div>
          </div>
        )}

        {/* ── 3. CHART ── */}
        <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Capital Journey · {personLabel}</div>
            </div>

          </div>
          {/* Milestone legend — HTML, zero collision risk */}
          <div style={{ padding: '10px 24px 0', background: 'var(--cream)', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            {Object.entries(
              (() => {
                const items: { label: string; age: number; amount: number; color: string }[] = []
                goals.filter(g => g.source === 'education').forEach(g => {
                  items.push({ label: g.label, age: g.targetAge, amount: g.targetCorpus, color: '#5E8A6A' })
                })
                const retGoal = goals.find(g => g.source === 'retirement')
                if (retGoal) {
                  const spouseAgeAtRet = retirementAge - (clientAge - spouseAge)
                  const retAgeLabel = planMode === 'couple' ? `${retirementAge} / ${spouseAgeAtRet}` : `${retirementAge}`
                  items.push({ label: 'Retirement', age: retirementAge, amount: retGoal.targetCorpus, color: '#A8834A' })
                }
                return items
              })()
            ).map(([, item]) => null).filter(Boolean)}
            {(() => {
              const items: { label: string; ageLine: string; sub: string; color: string }[] = []
              const sourceColor: Record<string, string> = {
                education: '#5E8A6A',
                wealth: '#4A7C9E',
                custom: '#A8834A',
              }
              goals.filter(g => g.source !== 'retirement').forEach(g => {
                items.push({
                  label: g.label,
                  ageLine: fmtAge(g.targetAge, planMode === 'couple', clientAge, spouseAge),
                  sub: '−' + fmt(g.targetCorpus),
                  color: sourceColor[g.source] ?? '#9A9690',
                })
              })
              const retGoal = goals.find(g => g.source === 'retirement')
              if (retGoal) {
                const earliestIsSpouse = planMode === 'couple' && spouseRetirementAge + (clientAge - spouseAge) < retirementAge
                const retAgeLabel = planMode === 'couple'
                  ? earliestIsSpouse
                    ? `${fmtAge(earliestRetirementAge, true, clientAge, spouseAge)} (${spouseName} retires first)`
                    : fmtAge(retirementAge, true, clientAge, spouseAge)
                  : `Age ${retirementAge}`
                items.push({
                  label: 'Retirement',
                  ageLine: retAgeLabel,
                  sub: fmt(legacyAdjustedCorpus) + ' portfolio target',
                  color: '#A8834A',
                })
              }
              return items.map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, color: item.color }}>{item.label}</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: 'var(--ink3)' }}>{item.ageLine}</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: 'var(--ink3)' }}>{item.sub}</span>
                </div>
              ))
            })()}
          </div>
          <div style={{ padding: '12px 24px 20px', background: 'var(--cream)', height: 400 }}>
            <canvas key={chartKey} ref={chartRef} />
          </div>
        </div>

        {/* ── 4. RETIREMENT INCOME BREAKDOWN ── */}
        {retirementBreakdown && (() => {
          const { inflatedMonthlyIncome, inflatedAnnualHolidays, annualGapTotal, baseAdjustedCorpus } = retirementBreakdown
          const projectedValue = projectedAtRetirement.atAssumption
          const gap = baseAdjustedCorpus - projectedValue
          const isOnTrack = gap <= 0
          const coveragePct = annualGapTotal > 0 ? Math.min(100, Math.round(guaranteedMonthlyRetirement * 12 / annualGapTotal * 100)) : 0

          return (
            <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Retirement Planning</div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, color: 'var(--ink)' }}>Retirement Income Breakdown</div>
                </div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', background: 'var(--cream2)', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px' }}>
                  {coveragePct}% of income covered by guaranteed streams
                </div>
              </div>

              {/* ── Top row: income breakdown ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '20px 24px 16px', gap: 0, borderBottom: '1px solid var(--line)' }}>
                {/* Col 1: Annual Income Needed (PV) */}
                <div style={{ paddingRight: 24, marginRight: 24, borderRight: '1px solid var(--line)' }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Annual Income Needed (Today)</div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'var(--ink)', marginBottom: 4 }}>
                    {'S$' + Math.round(effectiveRetirementIncome * 12 + effectiveAnnualHolidays).toLocaleString('en-SG') + '/yr'}
                  </div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>
                    {effectiveAnnualHolidays > 0
                      ? `S$${Math.round(effectiveRetirementIncome).toLocaleString('en-SG')}/mo + S$${Math.round(effectiveAnnualHolidays).toLocaleString('en-SG')} holidays`
                      : `S$${Math.round(effectiveRetirementIncome).toLocaleString('en-SG')}/mo · today's dollars`}
                  </div>
                </div>
                {/* Col 2: Annual Income Needed (FV at retirement) */}
                <div style={{ paddingRight: 24, marginRight: 24, borderRight: '1px solid var(--line)' }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Annual Income Needed (At Retirement)</div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'var(--ink)', marginBottom: 4 }}>
                    {'S$' + Math.round(annualGapTotal).toLocaleString('en-SG') + '/yr'}
                  </div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>
                    {effectiveAnnualHolidays > 0
                      ? `${fmtMo(inflatedMonthlyIncome)} + S$${Math.round(inflatedAnnualHolidays).toLocaleString('en-SG')} holidays`
                      : `${fmtMo(inflatedMonthlyIncome)} · inflated ${Math.max(0, retirementAge - clientAge)}y at ${retirementInflation}%`}
                  </div>
                </div>
                {/* Col 3: Guaranteed Income Streams */}
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Guaranteed Income Streams</div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: guaranteedMonthlyRetirement > 0 ? '#4A9E8A' : 'var(--ink3)', marginBottom: 4 }}>
                    {guaranteedMonthlyRetirement > 0 ? fmtMo(guaranteedMonthlyRetirement) : 'None'}
                  </div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>CPF Life · Annuity · Rental · SRS</div>
                </div>
              </div>

              {/* ── Bottom row: portfolio position ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '20px 24px', gap: 0, background: isOnTrack ? 'rgba(74,158,138,0.04)' : 'rgba(224,128,128,0.04)', borderBottom: !isOnTrack ? '1px solid var(--line)' : 'none' }}>
                <div style={{ paddingRight: 24, marginRight: 24, borderRight: '1px solid var(--line)' }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Portfolio Target</div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 26, color: 'var(--ink)', marginBottom: 4 }}>{fmt(baseAdjustedCorpus)}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>Required at {fmtAge(retirementAge, planMode === 'couple', clientAge, spouseAge)}</div>
                </div>
                <div style={{ paddingRight: 24, marginRight: 24, borderRight: '1px solid var(--line)' }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Projected Portfolio</div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 26, color: projectedValue >= baseAdjustedCorpus ? '#4A9E8A' : '#A8834A', marginBottom: 4 }}>{fmt(projectedValue)}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>At {fmtAge(retirementAge, planMode === 'couple', clientAge, spouseAge)} · {settings.expectedReturn}% p.a.</div>
                </div>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>{isOnTrack ? 'Surplus' : 'Shortfall'}</div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 26, color: isOnTrack ? '#4A9E8A' : '#E08080', marginBottom: 4 }}>
                    {isOnTrack ? '+' : '−'}{fmt(Math.abs(gap))}
                  </div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: isOnTrack ? '#4A9E8A' : '#E08080' }}>
                    {isOnTrack ? 'Portfolio exceeds target' : 'Additional capital needed'}
                  </div>
                </div>
              </div>

              {/* ── Shortfall solver row ── */}
              {!isOnTrack && gap > 0 && (() => {
                const r = settings.expectedReturn / 100
                const rm = r / 12
                const yearsLeft = Math.max(1, retirementAge - clientAge)
                const nm = yearsLeft * 12
                // Lump sum FV = lumpNow * (1+r)^yearsLeft
                // Monthly FV  = monthly * ((1+rm)^nm - 1)/rm * (1+rm)  [annuity-due]
                // lumpNow * (1+r)^y + monthly * annuityFactor = gap
                const annuityFactor = rm > 0 ? ((Math.pow(1 + rm, nm) - 1) / rm) * (1 + rm) : nm
                const lumpFV = (v: number) => v * Math.pow(1 + r, yearsLeft)
                // lumpSumFraction: 0 = pure monthly, 1 = pure lump sum
                const lumpNow = lumpSumFraction * gap / Math.pow(1 + r, yearsLeft)
                const remainingGap = Math.max(0, gap - lumpFV(lumpNow))
                const monthlyTopUp = annuityFactor > 0 ? remainingGap / annuityFactor : 0
                // Endpoints for display
                const pureLump = gap / Math.pow(1 + r, yearsLeft)
                const pureMonthly = annuityFactor > 0 ? gap / annuityFactor : 0

                return (
                  <div style={{ padding: '20px 24px', background: 'rgba(168,131,74,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                      <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Shortfall Solution · {settings.expectedReturn}% p.a. · {yearsLeft} yrs</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setLumpSumFraction(0)} style={{ fontFamily: 'Inter', fontSize: 10, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--line)', background: lumpSumFraction === 0 ? 'var(--ink)' : 'white', color: lumpSumFraction === 0 ? 'white' : 'var(--ink3)', cursor: 'pointer' }}>Monthly only</button>
                        <button onClick={() => setLumpSumFraction(1)} style={{ fontFamily: 'Inter', fontSize: 10, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--line)', background: lumpSumFraction === 1 ? 'var(--ink)' : 'white', color: lumpSumFraction === 1 ? 'white' : 'var(--ink3)', cursor: 'pointer' }}>Lump sum only</button>
                      </div>
                    </div>

                    {/* Slider */}
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>← More monthly</span>
                        <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>More lump sum →</span>
                      </div>
                      <input
                        type="range" min={0} max={100} step={1}
                        value={Math.round(lumpSumFraction * 100)}
                        onChange={e => setLumpSumFraction(parseFloat(e.target.value) / 100)}
                        style={{ width: '100%', accentColor: 'var(--gold)', cursor: 'pointer' }}
                      />
                    </div>

                    {/* Two result cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 10, padding: '16px 20px' }}>
                        <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>
                          {lumpSumFraction === 0 ? 'Lump Sum' : 'Lump Sum Now'}
                        </div>
                        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, color: lumpSumFraction > 0 ? 'var(--ink)' : 'var(--ink3)', marginBottom: 4 }}>
                          {lumpSumFraction > 0 ? fmt(lumpNow) : '—'}
                        </div>
                        <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>
                          {lumpSumFraction > 0
                            ? `Grows to ${fmt(lumpFV(lumpNow))} by retirement`
                            : `Pure monthly: ${fmtMo(pureMonthly)}`}
                        </div>
                      </div>
                      <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 10, padding: '16px 20px' }}>
                        <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>
                          {lumpSumFraction === 1 ? 'Monthly Top-Up' : 'Monthly Top-Up'}
                        </div>
                        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, color: lumpSumFraction < 1 ? 'var(--ink)' : 'var(--ink3)', marginBottom: 4 }}>
                          {lumpSumFraction < 1 ? fmtMo(monthlyTopUp) : '—'}
                        </div>
                        <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>
                          {lumpSumFraction < 1
                            ? `Over ${yearsLeft} yrs · annuity-due`
                            : `Pure lump sum: ${fmt(pureLump)}`}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )
        })()}

        {/* ── 4. TWO COLUMNS: Portfolio + Notes ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 28 }}>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Investments, CPF, Policies & Income</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'var(--ink)' }}>Funding Vehicles</div>
              </div>
              <button onClick={() => setVehicleModal({ open: true })} style={{ fontFamily: 'Inter', fontSize: 11, padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 6, background: 'white', color: 'var(--ink2)', cursor: 'pointer' }}>+ Add</button>
            </div>

            {filteredPortfolio.length > 0 && (() => {
              const perfVehicles = filteredPortfolio.filter(p => p.vehicleType !== 'cpf_life' && p.vehicleType !== 'annuity' && p.vehicleType !== 'rental')
              // Fall back to currentValue when totalContributed not yet calculated (no start date entered)
              const summaryTotalContributed = perfVehicles.reduce((s, p) => s + (p.totalContributed || p.currentValue || 0), 0)
              const summaryTotalValue = perfVehicles.reduce((s, p) => s + (p.currentValue || 0), 0)
              // Blended annualized return: weighted by current value
              let blendedNumerator = 0; let blendedDenominator = 0
              perfVehicles.forEach(p => {
                if (p.annualizedReturn != null && (p.currentValue || 0) > 0) {
                  blendedNumerator += p.annualizedReturn * p.currentValue
                  blendedDenominator += p.currentValue
                }
              })
              const blendedReturn = blendedDenominator > 0 ? blendedNumerator / blendedDenominator : null
              if (summaryTotalValue === 0) return null
              const displayReturn = portfolioXIRR !== null ? portfolioXIRR : (blendedReturn !== null ? blendedReturn * 100 : null)
              return (
                <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, padding: '18px 24px', marginBottom: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Total Capital Invested</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'var(--ink)' }}>{fmt(summaryTotalContributed)}</div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 2 }}>across {perfVehicles.length} vehicle{perfVehicles.length !== 1 ? 's' : ''}</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Total Portfolio Value</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'var(--ink)' }}>{fmt(summaryTotalValue)}</div>
                    {summaryTotalContributed > 0 && (
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: summaryTotalValue >= summaryTotalContributed ? '#4A9E8A' : '#E08080', marginTop: 2 }}>
                        {summaryTotalValue >= summaryTotalContributed ? '+' : ''}{fmt(summaryTotalValue - summaryTotalContributed)} gain
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Portfolio XIRR</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: displayReturn !== null ? (displayReturn >= 0 ? '#4A9E8A' : '#E08080') : 'var(--ink3)' }}>
                      {displayReturn !== null ? (displayReturn >= 0 ? '+' : '') + displayReturn.toFixed(1) + '%' : '—'}
                    </div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 2 }}>time-weighted across all vehicles</div>
                  </div>
                </div>
              )
            })()}

            {filteredPortfolio.length === 0 ? (
              <div style={{ background: 'white', border: '2px dashed var(--line)', borderRadius: 12, padding: '40px 24px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', marginBottom: 4 }}>No funding vehicles recorded</div>
                <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>Add investments, CPF Life, endowments, annuities, or rental income</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredPortfolio.map(p => {
                  const xr = xirrMap[p.id]
                  return (
                    <div key={p.id} style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: vehicleTypeColors[p.vehicleType || 'investment'], flexShrink: 0 }} />
                      <div style={{ fontSize: 18, flexShrink: 0 }}>{vehicleIcon(p.vehicleType || 'investment')}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{p.name}</span>
                          <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink3)', background: 'var(--cream2)', padding: '2px 6px', borderRadius: 4 }}>{p.vehicleType?.replace('_', ' ')}</span>
                          {planMode === 'couple' && <OwnerBadge owner={p.owner} clientName={clientName} spouseName={spouseName} />}
                          {xr !== null && p.vehicleType !== 'investment' && p.vehicleType !== 'other' && <XIRRBadge rate={xr} />}
                        </div>
                        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--ink3)' }}>
                          {p.vehicleType === 'cpf_life' && `${p.cpfScheme} · S$${(p.cpfMonthlyPayout || 0).toLocaleString('en-SG')}/mo from age ${p.cpfPayoutStartAge}`}
                          {p.vehicleType === 'endowment' && `Premium S$${(p.endowmentPremium || 0).toLocaleString('en-SG')}/mo · Maturity ${p.endowmentMaturityYear}: ${fmt(p.endowmentMaturityValue || 0)}`}
                          {p.vehicleType === 'annuity' && `S$${(p.annuityMonthlyIncome || 0).toLocaleString('en-SG')}/mo from age ${p.annuityStartAge} · ${p.annuityGuaranteeYears}yr guarantee`}
                          {p.vehicleType === 'rental' && `Net S$${(p.rentalMonthlyNet || 0).toLocaleString('en-SG')}/mo until age ${p.rentalStopAge}`}
                         {p.vehicleType === 'srs' && (() => {
                            const annual = p.srsAnnualContribution || 0
                            const contribStr = annual > 0
                              ? p.srsIsRegular
                                ? `S$${Math.round(annual).toLocaleString('en-SG')}/yr (regular)`
                                : `Lump Sum S$${Math.round(annual).toLocaleString('en-SG')}`
                              : '—'
                            return `${contribStr} · ${fmt(p.currentValue)} · Withdraw age ${p.srsWithdrawalStartAge || 63} over ${p.srsWithdrawalDuration || 10}yrs`
                          })()}
                          {(p.vehicleType === 'investment' || p.vehicleType === 'other') && (() => {
                            const latestChange = [...(p.cashflows || [])].filter(cf => cf.type === 'contribution_change').sort((a, b) => b.date.localeCompare(a.date))[0]
                            const displayMonthly = latestChange ? latestChange.amount : p.monthlyContribution
                            if (p.mode === 'Lump Sum') {
                              return `Lump Sum ${fmt(p.monthlyContribution)} · ${fmt(p.currentValue)} · ${p.expectedReturn}% p.a.`
                            }
                            return `${displayMonthly > 0 ? fmtMo(displayMonthly) : '—'} · ${fmt(p.currentValue)} · ${p.expectedReturn}% p.a.`
                          })()}
                        </div>
                        {(p.cashflows?.length || 0) > 0 && (
                          <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 3 }}>{p.cashflows.length} cashflow event{p.cashflows.length !== 1 ? 's' : ''} recorded</div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => setVehicleModal({ open: true, item: p })} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--ink3)', fontFamily: 'Inter', fontSize: 11, padding: '4px 10px' }}>Edit</button>
                        <button onClick={() => deleteVehicle(p.id)} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--rouge)', fontFamily: 'Inter', fontSize: 11, padding: '4px 8px' }}>×</button>
                      </div>
                    </div>
                  )
                })}

                <div style={{ marginTop: 4, background: 'var(--charcoal)', borderRadius: 12, padding: '18px 24px', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 6 }}>Monthly Committing</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, color: '#F0EDE8' }}>{fmtMo(totalMonthlyInvesting)}</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 6 }}>Monthly Gap</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, color: monthlyGap > 0 ? '#E08080' : '#80C4A0' }}>
                      {monthlyGap > 0 ? `−${fmtMo(monthlyGap)}` : 'On Track'}
                    </div>
                  </div>
                  {portfolioXIRR !== null && (
                    <div>
                      <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 6 }}>Portfolio XIRR</div>
                      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, color: portfolioXIRR >= settings.expectedReturn ? '#80C4A0' : '#E08080' }}>
                        {portfolioXIRR >= 0 ? '+' : ''}{portfolioXIRR.toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Advisor Notes</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'var(--ink)' }}>Session Notes</div>
            </div>
            <div style={{ flex: 1, background: 'white', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '10px 16px', background: 'var(--charcoal)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: notes.length > 0 ? '#80C4A0' : 'rgba(255,255,255,0.2)' }} />
                <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>
                  {notes.length > 0 ? 'Auto-saved' : 'No notes yet'}
                </span>
              </div>
              <textarea
                value={notes}
                onChange={e => updateNotes(e.target.value)}
                placeholder={`Notes for ${personLabel}...\n\n• Key discussion points\n• Client concerns\n• Next steps\n• Follow-up items`}
                style={{
                  flex: 1, border: 'none', outline: 'none', resize: 'none',
                  padding: '16px 18px',
                  fontFamily: 'Inter', fontSize: 13, lineHeight: 1.7,
                  color: 'var(--ink)', background: 'white',
                  minHeight: 320,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {vehicleModal.open && <VehicleModal item={vehicleModal.item} onSave={saveVehicle} onClose={() => setVehicleModal({ open: false })} isCouple={planMode === 'couple'} clientName={clientName} spouseName={spouseName} clientAge={clientAge} retirementAge={retirementAge} />}
      {customGoalModal && <CustomGoalModal onSave={editingGoal ? editCustomGoal : addCustomGoal} onClose={() => { setCustomGoalModal(false); setEditingGoal(null) }} clientAge={clientAge} spouseAge={spouseAge} isCouple={planMode === 'couple'} clientName={clientName} spouseName={spouseName} expectedReturn={settings.expectedReturn} existing={editingGoal ?? undefined} />}
    </div>
  )
}
