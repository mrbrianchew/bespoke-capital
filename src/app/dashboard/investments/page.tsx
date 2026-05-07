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
type DrawdownMode = 'invested' | 'cash'
type VehicleType = 'investment' | 'cpf_life' | 'endowment' | 'annuity' | 'rental' | 'other'

interface CashflowEvent {
  id: string
  date: string        // YYYY-MM
  type: 'contribution' | 'withdrawal' | 'top_up' | 'premium_holiday'
  amount: number
  note?: string
}

interface FundingVehicle {
  id: string
  name: string
  vehicleType: VehicleType
  owner: 'client' | 'spouse' | 'joint'
  // Investment fields
  currentValue: number
  monthlyContribution: number
  expectedReturn: number
  startYear: number
  mode: 'Regular' | 'Lump Sum' | 'Mixed'
  // CPF Life fields
  cpfScheme?: 'BRS' | 'FRS' | 'ERS'
  cpfMonthlyPayout?: number
  cpfPayoutStartAge?: number
  // Endowment fields
  endowmentMaturityValue?: number
  endowmentMaturityYear?: number
  endowmentPremium?: number
  // Annuity fields
  annuityMonthlyIncome?: number
  annuityStartAge?: number
  annuityGuaranteeYears?: number
  // Rental fields
  rentalMonthlyNet?: number
  rentalStopAge?: number
  // Cashflow history
  cashflows: CashflowEvent[]
}

interface CapitalGoal {
  id: string
  source: 'retirement' | 'wealth' | 'education' | 'custom'
  label: string
  targetCorpus: number
  monthlyRequired: number
  targetAge: number
  icon: string
  owner: 'client' | 'spouse' | 'joint'
}

interface CMSettings {
  expectedReturn: number
  inflation: number
  legacyAmount: number
  incomeSource: IncomeSource
  drawdownMode: DrawdownMode
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
function calcMonthlyRequired(corpus: number, yearsLeft: number, annualReturn: number): number {
  if (corpus <= 0 || yearsLeft <= 0) return 0
  const r = annualReturn / 100
  const rm = r / 12
  const nm = yearsLeft * 12
  return rm > 0 ? corpus * rm / ((Math.pow(1 + rm, nm) - 1) * (1 + rm)) : corpus / nm
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
  // Historical cashflows (contributions negative, withdrawals positive)
  vehicle.cashflows?.forEach(cf => {
    const [yr, mo] = cf.date.split('-').map(Number)
    const d = new Date(yr, mo - 1, 1)
    const amt = cf.type === 'withdrawal' ? cf.amount : -cf.amount
    flows.push({ amount: amt, date: d })
  })
  // If no cashflow history but we have contribution and start year, synthesise monthly contributions
  if (flows.length === 0 && vehicle.monthlyContribution > 0) {
    const start = new Date(vehicle.startYear, 0, 1)
    const now = new Date()
    let d = new Date(start)
    while (d <= now) {
      flows.push({ amount: -vehicle.monthlyContribution, date: new Date(d) })
      d.setMonth(d.getMonth() + 1)
    }
  }
  // Current value as terminal positive cashflow today
  if (vehicle.currentValue > 0) {
    flows.push({ amount: vehicle.currentValue, date: new Date() })
  }
  if (flows.length < 2) return null
  // Sort by date
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
    contribution: '#4A9E8A', withdrawal: '#E08080', top_up: '#A8834A', premium_holiday: '#9A9690'
  }
  const typeLabels: Record<CashflowEvent['type'], string> = {
    contribution: 'Contribution', withdrawal: 'Withdrawal', top_up: 'Top-Up', premium_holiday: 'Premium Holiday'
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.7)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--cream)', borderRadius: 16, width: 600, maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20 }}>Cashflow History</div>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{vehicle.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 20 }}>✕</button>
        </div>

        {/* Add new cashflow */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', background: 'white' }}>
          <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 10 }}>Add Event</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <input type="month" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, width: 140 }} />
            <select value={type} onChange={e => setType(e.target.value as CashflowEvent['type'])} style={{ ...inp, width: 150 }}>
              {(Object.keys(typeLabels) as CashflowEvent['type'][]).map(t => <option key={t} value={t}>{typeLabels[t]}</option>)}
            </select>
            <input type="number" placeholder="Amount (S$)" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inp, width: 130 }} />
            <input placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} style={{ ...inp, flex: 1, minWidth: 100 }} />
            <button onClick={addFlow} style={{ padding: '8px 16px', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>Add</button>
          </div>
        </div>

        {/* Cashflow list */}
        <div style={{ overflow: 'auto', flex: 1, padding: '8px 24px' }}>
          {flows.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>No cashflow events recorded</div>
          ) : (
            [...flows].sort((a, b) => a.date.localeCompare(b.date)).map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--ink3)', minWidth: 70 }}>{f.date}</span>
                <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: typeColors[f.type] + '20', color: typeColors[f.type] }}>{typeLabels[f.type]}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--ink)', flex: 1 }}>{f.type === 'premium_holiday' ? '—' : 'S$' + f.amount.toLocaleString('en-SG')}</span>
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

function VehicleModal({ item, onSave, onClose, isCouple, clientName, spouseName, clientAge }: {
  item?: FundingVehicle; onSave: (v: FundingVehicle) => void; onClose: () => void
  isCouple: boolean; clientName: string; spouseName: string; clientAge: number
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [vehicleType, setVehicleType] = useState<VehicleType>(item?.vehicleType ?? 'investment')
  const [owner, setOwner] = useState<'client' | 'spouse' | 'joint'>(item?.owner ?? 'client')
  // Investment
  const [curVal, setCurVal] = useState(String(item?.currentValue ?? ''))
  const [monthly, setMonthly] = useState(String(item?.monthlyContribution ?? ''))
  const [ret, setRet] = useState(item?.expectedReturn ?? 6)
  const [startYear, setStartYear] = useState(item?.startYear ?? new Date().getFullYear())
  const [mode, setMode] = useState<'Regular' | 'Lump Sum' | 'Mixed'>(item?.mode ?? 'Regular')
  // CPF Life
  const [cpfScheme, setCpfScheme] = useState<'BRS' | 'FRS' | 'ERS'>(item?.cpfScheme ?? 'FRS')
  const [cpfPayout, setCpfPayout] = useState(String(item?.cpfMonthlyPayout ?? ''))
  const [cpfStartAge, setCpfStartAge] = useState(item?.cpfPayoutStartAge ?? 65)
  // Endowment
  const [endMatVal, setEndMatVal] = useState(String(item?.endowmentMaturityValue ?? ''))
  const [endMatYear, setEndMatYear] = useState(item?.endowmentMaturityYear ?? new Date().getFullYear() + 10)
  const [endPremium, setEndPremium] = useState(String(item?.endowmentPremium ?? ''))
  // Annuity
  const [annuityIncome, setAnnuityIncome] = useState(String(item?.annuityMonthlyIncome ?? ''))
  const [annuityStartAge, setAnnuityStartAge] = useState(item?.annuityStartAge ?? 65)
  const [annuityGuarantee, setAnnuityGuarantee] = useState(item?.annuityGuaranteeYears ?? 10)
  // Rental
  const [rentalNet, setRentalNet] = useState(String(item?.rentalMonthlyNet ?? ''))
  const [rentalStop, setRentalStop] = useState(item?.rentalStopAge ?? 75)

  const inp: React.CSSProperties = { width: '100%', background: 'white', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }

  const vehicleOpts: { value: VehicleType; label: string; icon: string }[] = [
    { value: 'investment', label: 'Investment', icon: '📈' },
    { value: 'cpf_life', label: 'CPF Life', icon: '🇸🇬' },
    { value: 'endowment', label: 'Endowment', icon: '📋' },
    { value: 'annuity', label: 'Annuity', icon: '🔄' },
    { value: 'rental', label: 'Rental Income', icon: '🏠' },
    { value: 'other', label: 'Other', icon: '✦' },
  ]

  const ownerOpts = [
    { value: 'client' as const, label: clientName },
    ...(isCouple ? [{ value: 'spouse' as const, label: spouseName }, { value: 'joint' as const, label: 'Joint' }] : []),
  ]

  function save() {
    if (!name.trim()) return
    onSave({
      id: item?.id ?? newId(),
      name: name.trim(), vehicleType, owner, mode,
      currentValue: parseFloat(curVal) || 0,
      monthlyContribution: parseFloat(monthly) || 0,
      expectedReturn: ret, startYear,
      cpfScheme, cpfMonthlyPayout: parseFloat(cpfPayout) || 0, cpfPayoutStartAge: cpfStartAge,
      endowmentMaturityValue: parseFloat(endMatVal) || 0, endowmentMaturityYear: endMatYear, endowmentPremium: parseFloat(endPremium) || 0,
      annuityMonthlyIncome: parseFloat(annuityIncome) || 0, annuityStartAge, annuityGuaranteeYears: annuityGuarantee,
      rentalMonthlyNet: parseFloat(rentalNet) || 0, rentalStopAge: rentalStop,
      cashflows: item?.cashflows || [],
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--cream)', borderRadius: 16, width: 560, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>
        <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22 }}>{item ? 'Edit Funding Vehicle' : 'Add Funding Vehicle'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 20 }}>✕</button>
        </div>

        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Vehicle type selector */}
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
            <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder={vehicleType === 'cpf_life' ? 'e.g. CPF Life (Brian)' : vehicleType === 'endowment' ? 'e.g. Manulife RetireReady' : vehicleType === 'annuity' ? 'e.g. NTUC Income Annuity' : 'e.g. Global Equity RSP'} />
          </div>

          {isCouple && (
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Belongs To</div>
              <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                {ownerOpts.map(o => <button key={o.value} onClick={() => setOwner(o.value)} style={{ flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, background: owner === o.value ? 'var(--ink)' : 'white', color: owner === o.value ? 'white' : 'var(--ink3)', transition: 'all 0.15s' }}>{o.label}</button>)}
              </div>
            </div>
          )}

          {/* CPF Life fields */}
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

          {/* Endowment fields */}
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

          {/* Annuity fields */}
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

          {/* Rental fields */}
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

          {/* Investment / Other fields */}
          {(vehicleType === 'investment' || vehicleType === 'other') && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Current Value (S$)</div>
                  <input type="number" style={inp} value={curVal} onChange={e => setCurVal(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Monthly Contribution (S$)</div>
                  <input type="number" style={inp} value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="0" />
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Mode</div>
                <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                  {(['Regular', 'Lump Sum', 'Mixed'] as const).map(m => <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, background: mode === m ? 'var(--ink)' : 'white', color: mode === m ? 'white' : 'var(--ink3)', transition: 'all 0.15s' }}>{m}</button>)}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Expected Return %</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="range" min={0} max={15} step={0.5} value={ret} onChange={e => setRet(parseFloat(e.target.value))} style={{ flex: 1, accentColor: 'var(--gold)' }} />
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, background: 'white', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px', minWidth: 44, textAlign: 'center' }}>{ret}%</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Start Year</div>
                  <input type="number" style={inp} value={startYear} onChange={e => setStartYear(parseInt(e.target.value) || new Date().getFullYear())} />
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '16px 28px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', fontFamily: 'Inter', fontSize: 12, border: '1px solid var(--line)', borderRadius: 8, background: 'white', color: 'var(--ink2)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} style={{ padding: '10px 24px', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: 'var(--ink)', color: 'white', cursor: 'pointer' }}>{item ? 'Update' : 'Add Vehicle'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── CUSTOM GOAL MODAL ────────────────────────────────────────────────────────

function CustomGoalModal({ onSave, onClose, clientAge, isCouple, clientName, spouseName }: {
  onSave: (g: CapitalGoal) => void; onClose: () => void; clientAge: number
  isCouple: boolean; clientName: string; spouseName: string
}) {
  const [label, setLabel] = useState('')
  const [corpus, setCorpus] = useState('')
  const [monthly, setMonthly] = useState('')
  const [targetAge, setTargetAge] = useState(clientAge + 10)
  const [owner, setOwner] = useState<'client' | 'spouse' | 'joint'>('client')
  const inp: React.CSSProperties = { width: '100%', background: 'white', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }
  const ownerOpts = [{ value: 'client' as const, label: clientName }, ...(isCouple ? [{ value: 'spouse' as const, label: spouseName }, { value: 'joint' as const, label: 'Joint' }] : [])]
  function save() {
    if (!label.trim()) return
    onSave({ id: newId(), source: 'custom', label: label.trim(), icon: '✦', targetCorpus: parseFloat(corpus) || 0, monthlyRequired: parseFloat(monthly) || 0, targetAge, owner })
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
                {ownerOpts.map(o => <button key={o.value} onClick={() => setOwner(o.value)} style={{ flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, background: owner === o.value ? 'var(--ink)' : 'white', color: owner === o.value ? 'white' : 'var(--ink3)', transition: 'all 0.15s' }}>{o.label}</button>)}
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Target Corpus (S$)</div>
              <input type="number" style={inp} value={corpus} onChange={e => setCorpus(e.target.value)} placeholder="0" />
            </div>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Monthly Required (S$)</div>
              <input type="number" style={inp} value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Target Age</div>
            <input type="number" style={inp} value={targetAge} onChange={e => setTargetAge(parseInt(e.target.value) || clientAge + 10)} />
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

// ─── VEHICLE TYPE ICON ────────────────────────────────────────────────────────
function vehicleIcon(t: VehicleType) {
  return { investment: '📈', cpf_life: '🇸🇬', endowment: '📋', annuity: '🔄', rental: '🏠', other: '✦' }[t]
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

  // Retirement data from Strategic Objectives
  const [retirementAge, setRetirementAge] = useState(65)
  const [lifeExpectancy, setLifeExpectancy] = useState(85)
  const [desiredMonthlyIncome, setDesiredMonthlyIncome] = useState(0)
  const [currentExpenses, setCurrentExpenses] = useState(0)
  const [postRetirementReturn, setPostRetirementReturn] = useState(3)

  const [planMode, setPlanMode] = useState<PlanMode>('individual')
  const [activePerson, setActivePerson] = useState<ActivePerson>('client')

  const [goals, setGoals] = useState<CapitalGoal[]>([])
  const [customGoalModal, setCustomGoalModal] = useState(false)
  const [portfolio, setPortfolio] = useState<FundingVehicle[]>([])
  const [vehicleModal, setVehicleModal] = useState<{ open: boolean; item?: FundingVehicle }>({ open: false })
  const [cashflowModal, setCashflowModal] = useState<FundingVehicle | null>(null)
  const [settings, setSettings] = useState<CMSettings>({ expectedReturn: 6, inflation: 3, legacyAmount: 0, incomeSource: 'desired', drawdownMode: 'invested' })

  // Notes
  const [notes, setNotes] = useState('')
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<any>(null)

  // ── LOAD ──────────────────────────────────────────────────────────────────
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
    const age = fin?.client?.age || c.age || 40
    const sage = fin?.spouse?.age || 38
    const cName = fin?.client?.firstName ? `${fin.client.firstName} ${fin.client.lastName || ''}`.trim() : c.name || 'Client'
    const sName = fin?.spouse?.firstName ? `${fin.spouse.firstName} ${fin.spouse.lastName || ''}`.trim() : 'Spouse'
    setClientAge(age); setSpouseAge(sage); setClientName(cName); setSpouseName(sName)

    // Detect couple mode: check protection_needs planType, fallback to spouse presence
    const protData = by['protection_needs']?.protection
    const hasSpouse = !!(fin?.spouse?.firstName || fin?.spouse?.age)
    const mode: PlanMode = (protData?.planType === 'couple' || hasSpouse) ? 'couple' : 'individual'
    setPlanMode(mode)
    setActivePerson(mode === 'couple' ? 'combined' : 'client')

    // Retirement data
    const retRow = by['retirement'] || {}
    const retNested = retRow?.ret || {}
    const retClientData = retNested?.client || {}
    setRetirementAge(retClientData?.retirementAge || retRow?.retirementAge || 65)
    setLifeExpectancy(retClientData?.lifeExpectancy || retRow?.lifeExpectancy || 85)
    setDesiredMonthlyIncome(retClientData?.desiredMonthlyIncome || retRow?.desiredMonthlyIncome || 0)
    setCurrentExpenses(fin?.client?.monthlyExpenses || fin?.client?.expenses || retRow?.currentExpenses || 0)
    setPostRetirementReturn(retClientData?.postRetirementReturn || retRow?.postRetirementReturn || 3)

    const cmData = by['capital_mandate'] || {}
    const savedSettings: CMSettings = {
      expectedReturn: 6, inflation: 3, legacyAmount: 0, incomeSource: 'desired', drawdownMode: 'invested',
      ...(cmData?.settings || {})
    }
    setSettings(savedSettings)
    setNotes(cmData?.notes || '')

    const builtGoals: CapitalGoal[] = []

    // Retirement goal
    const totalCorpusNeeded = retRow?.corpusNeeded || 0
    const totalMonthlyRet = retRow?.monthlySavingsNeeded || retRow?.monthlySavingsRequired || 0
    const retAge = retClientData?.retirementAge || retRow?.retirementAge || 65
    if (totalCorpusNeeded > 0) {
      builtGoals.push({
        id: 'ret_combined', source: 'retirement',
        label: mode === 'couple' ? `${cName} & ${sName} — Retirement` : `${cName} — Retirement`,
        icon: '🏖', targetCorpus: totalCorpusNeeded,
        monthlyRequired: totalMonthlyRet > 0 ? totalMonthlyRet : calcMonthlyRequired(totalCorpusNeeded, Math.max(1, retAge - age), savedSettings.expectedReturn),
        targetAge: retAge, owner: mode === 'couple' ? 'joint' : 'client',
      })
    }

    // Wealth accumulation
    const acc = by['accumulation']?.acc || by['accumulation'] || {}
    ;(acc?.goals || []).forEach((g: any) => {
      if (!g.targetAmount) return
      const yearsLeft = Math.max(1, g.yearsToGoal || 10)
      const corpus = g.amountType === 'pv' ? g.targetAmount * Math.pow(1 + savedSettings.inflation / 100, yearsLeft) : g.targetAmount
      const owner: 'client' | 'spouse' | 'joint' = g.owner === 'spouse' ? 'spouse' : g.owner === 'joint' ? 'joint' : 'client'
      builtGoals.push({ id: 'acc_' + g.id, source: 'wealth', label: g.label || 'Wealth Goal', icon: '🏠', targetCorpus: corpus, monthlyRequired: g.monthlyRequired ?? calcMonthlyRequired(corpus, yearsLeft, savedSettings.expectedReturn), targetAge: age + yearsLeft, owner })
    })

    // Education — cross-referenced against live family_members to avoid ghost children
    const edu = by['education']?.edu || by['education'] || {}
    const eduTuitionInf = (edu?.tuitionInflation ?? 5) / 100
    const eduLivingInf = (edu?.livingInflation ?? 3) / 100
    const eduReturnRate = edu?.returnRate ?? 5
    ;(edu?.children || []).forEach((child: any) => {
      const childId = child.childId || child.id
      if (childId && !liveChildIds.has(childId)) return   // deleted from family_members
      if ((!child.annualTuition && !child.annualLiving) || !child.name) return
      if ((child.annualTuition || 0) + (child.annualLiving || 0) === 0) return
      // Use live age from family_members, not stale saved age
      const liveChild = liveChildren.find((m: any) => m.id === childId)
      const liveAge = liveChild
        ? (liveChild.age != null
            ? liveChild.age
            : liveChild.date_of_birth
              ? Math.max(0, new Date().getFullYear() - new Date(liveChild.date_of_birth).getFullYear())
              : (child.age || 0))
        : (child.age || 0)
      const yearsUntilUni = Math.max(1, (child.uniEntryAge || 18) - liveAge)
      const duration = child.courseDuration || 4
      const fvTuition = (child.annualTuition || 0) * Math.pow(1 + eduTuitionInf, yearsUntilUni) * duration
      const fvLiving = (child.annualLiving || 0) * Math.pow(1 + eduLivingInf, yearsUntilUni) * duration
      const corpus = Math.max(0, fvTuition + fvLiving - ((child.existingSavings || 0) * Math.pow(1 + eduReturnRate / 100, yearsUntilUni)))
      if (!corpus) return
      builtGoals.push({ id: 'edu_' + (child.childId || child.name), source: 'education', label: `${child.name}'s Education`, icon: '🎓', targetCorpus: corpus, monthlyRequired: calcMonthlyRequired(corpus, Math.max(1, yearsUntilUni), eduReturnRate), targetAge: age + yearsUntilUni, owner: 'joint' })
    })

    // Custom goals
    ;(cmData?.customGoals || []).forEach((g: CapitalGoal) => builtGoals.push({ ...g, source: 'custom' }))
    setGoals(builtGoals)

    // Portfolio — migrate old PortfolioItem format to FundingVehicle
    const savedPortfolio: FundingVehicle[] = (cmData?.portfolio || []).map((p: any) => ({
      cashflows: [],
      vehicleType: p.vehicleType || 'investment',
      ...p,
      owner: p.owner ?? 'client',
    }))
    setPortfolio(savedPortfolio)
    setLoading(false)
  }

  // ── SAVE ──────────────────────────────────────────────────────────────────
  async function saveData(updPortfolio: FundingVehicle[], updSettings: CMSettings, updCustomGoals: CapitalGoal[], updNotes: string) {
    const c = clientRef.current; if (!c) return
    const dataToSave = { portfolio: updPortfolio, settings: updSettings, customGoals: updCustomGoals, notes: updNotes }
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
    await saveData(updated, settings, goals.filter(g => g.source === 'custom'), notes)
    setVehicleModal({ open: false })
  }

  async function saveCashflows(vehicleId: string, cashflows: CashflowEvent[]) {
    const updated = portfolio.map(p => p.id === vehicleId ? { ...p, cashflows } : p)
    setPortfolio(updated)
    await saveData(updated, settings, goals.filter(g => g.source === 'custom'), notes)
    setCashflowModal(null)
  }

  async function deleteVehicle(id: string) {
    if (!confirm('Remove this funding vehicle?')) return
    const updated = portfolio.filter(p => p.id !== id)
    setPortfolio(updated)
    await saveData(updated, settings, goals.filter(g => g.source === 'custom'), notes)
  }

  async function addCustomGoal(g: CapitalGoal) {
    const updGoals = [...goals, g]
    setGoals(updGoals)
    await saveData(portfolio, settings, updGoals.filter(x => x.source === 'custom'), notes)
    setCustomGoalModal(false)
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
      saveData(portfolio, s, goals.filter(g => g.source === 'custom'), notes)
    }, 800)
  }

  function updateNotes(val: string) {
    setNotes(val)
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => {
      saveData(portfolio, settings, goals.filter(g => g.source === 'custom'), val)
    }, 1200)
  }

  // ── FILTERING ─────────────────────────────────────────────────────────────
  const matchesPerson = useCallback((owner: 'client' | 'spouse' | 'joint'): boolean => {
    if (planMode === 'individual') return true
    if (activePerson === 'combined') return true
    if (activePerson === 'client') return owner === 'client' || owner === 'joint'
    if (activePerson === 'spouse') return owner === 'spouse' || owner === 'joint'
    return true
  }, [planMode, activePerson])

  const filteredGoals = useMemo(() => goals.filter(g => matchesPerson(g.owner)), [goals, matchesPerson])
  const filteredPortfolio = useMemo(() => portfolio.filter(p => matchesPerson(p.owner)), [portfolio, matchesPerson])

  const totalMonthlyNeeded = useMemo(() => filteredGoals.reduce((s, g) => s + g.monthlyRequired, 0), [filteredGoals])
  const totalCorpus = useMemo(() => filteredGoals.reduce((s, g) => s + g.targetCorpus, 0), [filteredGoals])
  const totalMonthlyInvesting = useMemo(() => filteredPortfolio.reduce((s, p) => {
    if (p.vehicleType === 'investment' || p.vehicleType === 'other') return s + p.monthlyContribution
    if (p.vehicleType === 'endowment') return s + (p.endowmentPremium || 0)
    if (p.vehicleType === 'annuity') return s + p.monthlyContribution
    return s
  }, 0), [filteredPortfolio])
  const totalCurrentValue = useMemo(() => filteredPortfolio.reduce((s, p) => s + (p.currentValue || 0), 0), [filteredPortfolio])
  const monthlyGap = totalMonthlyNeeded - totalMonthlyInvesting

  const personLabel = planMode === 'individual' ? clientName
    : activePerson === 'combined' ? `${clientName} & ${spouseName}`
    : activePerson === 'client' ? clientName : spouseName

  // Effective monthly retirement income
  const effectiveRetirementIncome = useMemo(() => {
    if (settings.incomeSource === 'desired' && desiredMonthlyIncome > 0) return desiredMonthlyIncome
    return currentExpenses || desiredMonthlyIncome
  }, [settings.incomeSource, desiredMonthlyIncome, currentExpenses])

  // ── CHART ─────────────────────────────────────────────────────────────────
  useEffect(() => {
  // Wait for everything to be ready
  if (loading) return
  if (!chartRef.current) return
  
  const canvas = chartRef.current
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Clean up old chart
  if (chartInstance.current) {
    chartInstance.current.destroy()
    chartInstance.current = null
  }

  // Small delay to let DOM settle after any modal/state changes
  const timer = setTimeout(() => {
    // Check again that canvas is still valid
    if (!chartRef.current) return
    const canvasCtx = chartRef.current.getContext('2d')
    if (!canvasCtx) return

    const lifeEnd = Math.max(lifeExpectancy, clientAge + 35, 85)
    const ages = Array.from({ length: lifeEnd - clientAge + 1 }, (_, i) => clientAge + i)

    // Target corpus line
    const targetLine = ages.map(a => {
      if (a > retirementAge) return null
      return filteredGoals.reduce((sum, g) => {
        const yearsLeft = g.targetAge - a
        if (yearsLeft < 0) return sum
        return sum + g.targetCorpus / Math.pow(1 + settings.expectedReturn / 100, Math.max(yearsLeft, 0.001))
      }, 0)
    })

    // Calculate corpus at retirement ONCE (used for both lines)
const corpusAtRetirement = filteredPortfolio.reduce((sum, p) => {
  if (p.vehicleType === 'cpf_life' || p.vehicleType === 'rental') return sum
  const pRet = (p.expectedReturn || settings.expectedReturn) / 100
  const ytr = retirementAge - clientAge
  const fv = (p.currentValue || 0) * Math.pow(1 + pRet, ytr)
  let rsv = 0
  const monthly = p.vehicleType === 'endowment' ? (p.endowmentPremium || 0) 
    : p.vehicleType === 'annuity' ? p.monthlyContribution 
    : p.monthlyContribution
  if (monthly > 0 && ytr > 0) {
    const rm = pRet / 12
    const nm = ytr * 12
    rsv = rm > 0 ? monthly * (Math.pow(1 + rm, nm) - 1) / rm : monthly * nm
  }
  // Add endowment maturity value at maturity year
  let maturityBonus = 0
  if (p.vehicleType === 'endowment' && p.endowmentMaturityValue && p.endowmentMaturityYear) {
    const yearsToMaturity = p.endowmentMaturityYear - (new Date().getFullYear() + clientAge - clientAge) // simplified
    if (yearsToMaturity > 0 && yearsToMaturity <= ytr) {
      maturityBonus = p.endowmentMaturityValue * Math.pow(1 + pRet, ytr - yearsToMaturity)
    }
  }
  return sum + fv + rsv + maturityBonus
}, 0)

// Target corpus line (accumulation only) AND Retirement Fund Target
const retirementGoal = filteredGoals.find(g => g.source === 'retirement')
const retirementTargetCorpus = retirementGoal?.targetCorpus || 0

// Retirement fund projection (starts at retirement age, depletes with inflation)
const retirementFundLine = ages.map(a => {
  if (a < retirementAge) return null
  
  const yearsIntoRetirement = a - retirementAge
  const inflationRate = settings.inflation / 100
  const postRetReturn = postRetirementReturn / 100
  
  // Calculate total CPF/Annuity/Rental income for this age
  const guaranteedMonthlyIncome = filteredPortfolio.reduce((sum, p) => {
    if (p.vehicleType === 'cpf_life' && a >= (p.cpfPayoutStartAge || 65)) return sum + (p.cpfMonthlyPayout || 0)
    if (p.vehicleType === 'annuity' && a >= (p.annuityStartAge || 65)) return sum + (p.annuityMonthlyIncome || 0)
    if (p.vehicleType === 'rental' && a <= (p.rentalStopAge || 75)) return sum + (p.rentalMonthlyNet || 0)
    return sum
  }, 0)
  
  // Start with target corpus (or actual portfolio if smaller)
  let fundValue = retirementTargetCorpus
  
  // Simulate year by year depletion with inflation
  for (let y = 0; y < yearsIntoRetirement; y++) {
    const inflatedMonthlyNeed = effectiveRetirementIncome * Math.pow(1 + inflationRate, y)
    const netMonthlyNeed = Math.max(0, inflatedMonthlyNeed - guaranteedMonthlyIncome)
    const annualWithdrawal = netMonthlyNeed * 12
    
    if (settings.drawdownMode === 'cash') {
      fundValue = fundValue - annualWithdrawal
    } else {
      fundValue = fundValue * (1 + postRetReturn) - annualWithdrawal
    }
    
    if (fundValue <= 0) {
      fundValue = 0
      break
    }
  }
  
  return fundValue
})

// Existing Portfolio projection (accumulation then depletion)
const projectedLine = ages.map(a => {
  if (a <= retirementAge) {
    // Accumulation phase
    const yearsFromNow = a - clientAge
    return filteredPortfolio.reduce((sum, p) => {
      if (p.vehicleType === 'cpf_life' || p.vehicleType === 'rental') return sum
      const pRet = (p.expectedReturn || settings.expectedReturn) / 100
      const fv = (p.currentValue || 0) * Math.pow(1 + pRet, yearsFromNow)
      let rsv = 0
      const monthly = p.vehicleType === 'endowment' ? (p.endowmentPremium || 0)
        : p.vehicleType === 'annuity' ? p.monthlyContribution
        : p.monthlyContribution
      if (monthly > 0 && yearsFromNow > 0) {
        const rm = pRet / 12
        const nm = yearsFromNow * 12
        rsv = rm > 0 ? monthly * (Math.pow(1 + rm, nm) - 1) / rm : monthly * nm
      }
      return sum + fv + rsv
    }, 0)
  } else {
    // Decumulation phase - start with actual corpus at retirement
    const yearsIntoRetirement = a - retirementAge
    const inflationRate = settings.inflation / 100
    const postRetReturn = postRetirementReturn / 100
    
    // Calculate guaranteed income
    const guaranteedMonthlyIncome = filteredPortfolio.reduce((sum, p) => {
      if (p.vehicleType === 'cpf_life' && a >= (p.cpfPayoutStartAge || 65)) return sum + (p.cpfMonthlyPayout || 0)
      if (p.vehicleType === 'annuity' && a >= (p.annuityStartAge || 65)) return sum + (p.annuityMonthlyIncome || 0)
      if (p.vehicleType === 'rental' && a <= (p.rentalStopAge || 75)) return sum + (p.rentalMonthlyNet || 0)
      return sum
    }, 0)
    
    let fundValue = corpusAtRetirement
    
    for (let y = 0; y < yearsIntoRetirement; y++) {
      const inflatedMonthlyNeed = effectiveRetirementIncome * Math.pow(1 + inflationRate, y)
      const netMonthlyNeed = Math.max(0, inflatedMonthlyNeed - guaranteedMonthlyIncome)
      const annualWithdrawal = netMonthlyNeed * 12
      
      if (settings.drawdownMode === 'cash') {
        fundValue = fundValue - annualWithdrawal
      } else {
        fundValue = fundValue * (1 + postRetReturn) - annualWithdrawal
      }
      
      if (fundValue <= 0) {
        fundValue = 0
        break
      }
    }
    
    return fundValue
  }
})

    const legacyLine = settings.legacyAmount > 0 ? ages.map(a => a >= retirementAge ? settings.legacyAmount : null) : null
    const retireIdx = ages.indexOf(retirementAge)

    const retireLinePlugin = {
      id: 'retireLine',
      afterDraw(chart: any) {
        if (retireIdx < 0) return
        const xAxis = chart.scales.x
        const yAxis = chart.scales.y
        if (!xAxis || !yAxis) return
        const x = xAxis.getPixelForValue(ages[retireIdx])
        const top = yAxis.top
        const bottom = yAxis.bottom
        const c = chart.ctx
        c.save()
        c.beginPath()
        c.setLineDash([5, 5])
        c.moveTo(x, top)
        c.lineTo(x, bottom)
        c.strokeStyle = 'rgba(168,131,74,0.5)'
        c.lineWidth = 1.5
        c.stroke()
        c.setLineDash([])
        c.fillStyle = 'rgba(168,131,74,0.75)'
        c.font = '10px Inter, sans-serif'
        c.fillText('Retirement ' + retirementAge, x + 6, top + 14)
        c.restore()
      }
    }

    try {
      chartInstance.current = new Chart(canvasCtx, {
        type: 'line',
        plugins: [retireLinePlugin],
                        data: (() => {
          const baseDatasets = [
            {
              label: 'Retirement Fund Target',
              data: retirementFundLine,
              borderColor: '#A8834A',
              backgroundColor: 'rgba(168,131,74,0.08)',
              borderWidth: 2,
              borderDash: [8, 4],
              tension: 0.35,
              pointRadius: 0,
              pointHoverRadius: 4,
              fill: false,
              spanGaps: false,
            },
            {
              label: settings.drawdownMode === 'invested' ? 'Your Portfolio (Invested)' : 'Your Portfolio (Cash)',
              data: projectedLine,
              borderColor: '#4A9E8A',
              backgroundColor: 'rgba(74,158,138,0.05)',
              borderWidth: 2.5,
              tension: 0.35,
              pointRadius: 0,
              pointHoverRadius: 5,
              fill: false,
            },
          ];
          
         if (legacyLine) {
            baseDatasets.push({
              label: 'Legacy Floor',
              data: legacyLine,
              borderColor: 'rgba(196,164,100,0.5)',
              backgroundColor: 'rgba(196,164,100,0.03)',
              borderDash: [6, 4],
              borderWidth: 1.5,
              pointRadius: 0,
              pointHoverRadius: 4,
              fill: false,
              tension: 0,
              spanGaps: false,
            });
          }
          
          return {
            labels: ages.map(a => 'Age ' + a),
            datasets: baseDatasets,
          };
        })(),
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: '#9A9690', font: { size: 11 }, boxWidth: 20, filter: (item: any) => item.text !== 'null' } },
            tooltip: {
              backgroundColor: 'rgba(26,24,22,0.95)', titleColor: 'rgba(196,164,100,0.9)', bodyColor: 'rgba(240,237,232,0.7)', padding: 12,
              callbacks: { label: (ctx: any) => ctx.parsed.y === null ? '' : ' ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y) }
            },
          },
          scales: {
            x: { ticks: { color: '#9A9690', font: { size: 9 }, maxTicksLimit: 14 }, grid: { display: false } },
            y: { ticks: { callback: (v: any) => fmt(v), color: '#9A9690', font: { size: 9 } }, grid: { color: 'rgba(26,24,22,0.04)' }, min: 0 },
          },
        },
      })
    } catch (error) {
      console.error('Chart creation failed:', error)
    }
  }, 50) // 50ms delay

  return () => {
    clearTimeout(timer)
    if (chartInstance.current) {
      chartInstance.current.destroy()
      chartInstance.current = null
    }
  }
}, [loading, filteredGoals, filteredPortfolio, settings, clientAge, retirementAge, lifeExpectancy, effectiveRetirementIncome, postRetirementReturn, portfolio, goals])

  // ── XIRR per vehicle ──────────────────────────────────────────────────────
  const xirrMap = useMemo(() => {
    const m: Record<string, number | null> = {}
    portfolio.forEach(p => { m[p.id] = computeXIRR(p) })
    return m
  }, [JSON.stringify(portfolio)])

  // ── RENDER ────────────────────────────────────────────────────────────────
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)' }}>Loading…</div></div>
  if (!client) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)' }}>No client selected.</div></div>

  const vehicleTypeColors: Record<VehicleType, string> = {
    investment: '#4A9E8A', cpf_life: '#4A7C9E', endowment: '#A8834A', annuity: '#6B5B8B', rental: '#5E8A6A', other: '#9A9690'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>

      {/* ── HERO BAND ── */}
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '28px 0 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 30, fontWeight: 300, color: '#F0EDE8', lineHeight: 1.1 }}>Capital Mandate</div>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{personLabel} · {filteredGoals.length} goal{filteredGoals.length !== 1 ? 's' : ''}</div>
          </div>
          {planMode === 'couple' && (
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: 3 }}>
              {([{ val: 'combined' as ActivePerson, label: 'Combined' }, { val: 'client' as ActivePerson, label: clientName }, { val: 'spouse' as ActivePerson, label: spouseName }]).map(opt => (
                <button key={opt.val} onClick={() => setActivePerson(opt.val)} style={{ padding: '7px 18px', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', transition: 'all 0.15s', background: activePerson === opt.val ? 'rgba(255,255,255,0.15)' : 'transparent', color: activePerson === opt.val ? '#F0EDE8' : 'rgba(255,255,255,0.4)' }}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* KPI strip */}
        <div style={{ display: 'flex', padding: '20px 0' }}>
          {[
            { label: 'Total Capital Required', val: fmt(totalCorpus), color: '#C4A464' },
            { label: 'Monthly Savings Needed', val: fmtMo(totalMonthlyNeeded), color: '#F0EDE8' },
            { label: 'Currently Committing', val: fmtMo(totalMonthlyInvesting), color: '#F0EDE8' },
            { label: 'Monthly Gap', val: monthlyGap > 0 ? '−' + fmtMo(monthlyGap) : 'On Track', color: monthlyGap > 0 ? '#E08080' : '#80C4A0' },
            { label: 'Portfolio Value', val: fmt(totalCurrentValue), color: '#80B4C4' },
          ].map((s, i) => (
            <div key={i} style={{ flex: 1, paddingRight: i < 4 ? 28 : 0, borderRight: i < 4 ? '1px solid rgba(255,255,255,0.06)' : 'none', marginRight: i < 4 ? 28 : 0 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300, color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SETTINGS BAR ── */}
      <div style={{ background: 'var(--cream2)', borderBottom: '1px solid var(--line)', padding: '10px 48px', display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', flexShrink: 0 }}>Assumptions</span>
        {([{ label: 'Pre-Ret. Return', key: 'expectedReturn' as const, min: 1, max: 15, step: 0.5 }, { label: 'Inflation', key: 'inflation' as const, min: 1, max: 8, step: 0.5 }]).map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', whiteSpace: 'nowrap' }}>{s.label}</span>
            <input type="range" min={s.min} max={s.max} step={s.step} value={settings[s.key]} onChange={e => updateSettings({ ...settings, [s.key]: parseFloat(e.target.value) })} style={{ width: 80, accentColor: 'var(--gold)' }} />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 500, color: 'var(--ink)', background: 'white', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px', minWidth: 38, textAlign: 'center' }}>{settings[s.key]}%</span>
          </div>
        ))}
        {/* Legacy amount */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', whiteSpace: 'nowrap' }}>Legacy Floor</span>
          <div style={{ display: 'flex', alignItems: 'center', background: 'white', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
            <span style={{ padding: '4px 8px', fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', borderRight: '1px solid var(--line)' }}>S$</span>
            <input type="number" value={settings.legacyAmount || ''} onChange={e => updateSettings({ ...settings, legacyAmount: parseFloat(e.target.value) || 0 })} placeholder="0" style={{ border: 'none', outline: 'none', padding: '4px 8px', fontFamily: 'DM Mono, monospace', fontSize: 12, width: 90, color: 'var(--ink)' }} />
          </div>
        </div>
        {/* Drawdown mode */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', whiteSpace: 'nowrap' }}>In Retirement</span>
          <div style={{ display: 'flex', background: 'white', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
            {([{ v: 'invested' as DrawdownMode, l: 'Remain Invested' }, { v: 'cash' as DrawdownMode, l: 'Cash Drawdown' }]).map(o => (
              <button key={o.v} onClick={() => updateSettings({ ...settings, drawdownMode: o.v })} style={{ padding: '5px 12px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 10, fontWeight: 500, background: settings.drawdownMode === o.v ? 'var(--ink)' : 'white', color: settings.drawdownMode === o.v ? 'white' : 'var(--ink3)', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>{o.l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ padding: '32px 48px', flex: 1, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* ── 1. GOALS (horizontal cards, full-width) ── */}
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
                  {/* Accent stripe */}
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: g.source === 'retirement' ? '#6B5B8B' : g.source === 'education' ? '#5E8A6A' : g.source === 'wealth' ? '#4A7C9E' : '#A8834A' }} />
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <SourceBadge source={g.source} />
                      {planMode === 'couple' && activePerson === 'combined' && <OwnerBadge owner={g.owner} clientName={clientName} spouseName={spouseName} />}
                    </div>
                    {g.source === 'custom' && (
                      <button onClick={() => removeGoal(g.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                    )}
                  </div>
                  <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginBottom: 4, lineHeight: 1.3 }}>{g.label}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginBottom: 12 }}>Target age {g.targetAge}</div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{fmtMo(g.monthlyRequired)}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginBottom: 8 }}>monthly required</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--ink2)' }}>{fmt(g.targetCorpus)} corpus</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 2. CHART (full-width) ── */}
        <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Capital Journey · {personLabel}</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 400, color: 'var(--ink)' }}>
                Accumulation → Retirement {lifeExpectancy > 0 ? `→ Age ${lifeExpectancy}` : ''}
              </div>
            </div>
            {/* Income source toggle */}
            {(desiredMonthlyIncome > 0 || currentExpenses > 0) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>Retirement Income:</span>
                <div style={{ display: 'flex', background: 'var(--cream2)', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
                  {([{ v: 'desired' as IncomeSource, l: fmtMo(desiredMonthlyIncome), label: 'Desired' }, { v: 'current' as IncomeSource, l: fmtMo(currentExpenses), label: 'Current' }]).map(o => (
                    <button key={o.v} onClick={() => updateSettings({ ...settings, incomeSource: o.v })} style={{ padding: '5px 12px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 10, fontWeight: 500, background: settings.incomeSource === o.v ? 'var(--ink)' : 'transparent', color: settings.incomeSource === o.v ? 'white' : 'var(--ink3)', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                      {o.label}: {o.l}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div style={{ padding: '12px 24px 20px', background: 'var(--cream)', height: 300 }}>
            <canvas key={`chart-${activePerson}-${filteredGoals.length}-${filteredPortfolio.length}`} ref={chartRef} />
          </div>
        </div>

        {/* ── 3. TWO COLUMNS: Portfolio + Notes ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 28 }}>

          {/* LEFT — Funding Vehicles */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Investments, CPF, Policies & Income</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'var(--ink)' }}>Funding Vehicles</div>
              </div>
              <button onClick={() => setVehicleModal({ open: true })} style={{ fontFamily: 'Inter', fontSize: 11, padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 6, background: 'white', color: 'var(--ink2)', cursor: 'pointer' }}>+ Add</button>
            </div>

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
                          {planMode === 'couple' && activePerson === 'combined' && <OwnerBadge owner={p.owner} clientName={clientName} spouseName={spouseName} />}
                          {xr !== null && <XIRRBadge rate={xr} />}
                        </div>
                        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--ink3)' }}>
                          {p.vehicleType === 'cpf_life' && `${p.cpfScheme} · S$${(p.cpfMonthlyPayout || 0).toLocaleString('en-SG')}/mo from age ${p.cpfPayoutStartAge}`}
                          {p.vehicleType === 'endowment' && `Premium S$${(p.endowmentPremium || 0).toLocaleString('en-SG')}/mo · Maturity ${p.endowmentMaturityYear}: ${fmt(p.endowmentMaturityValue || 0)}`}
                          {p.vehicleType === 'annuity' && `S$${(p.annuityMonthlyIncome || 0).toLocaleString('en-SG')}/mo from age ${p.annuityStartAge} · ${p.annuityGuaranteeYears}yr guarantee`}
                          {p.vehicleType === 'rental' && `Net S$${(p.rentalMonthlyNet || 0).toLocaleString('en-SG')}/mo until age ${p.rentalStopAge}`}
                          {(p.vehicleType === 'investment' || p.vehicleType === 'other') && `${p.monthlyContribution > 0 ? fmtMo(p.monthlyContribution) : '—'} · ${fmt(p.currentValue)} · ${p.expectedReturn}% p.a.`}
                        </div>
                        {(p.cashflows?.length || 0) > 0 && (
                          <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 3 }}>{p.cashflows.length} cashflow event{p.cashflows.length !== 1 ? 's' : ''} recorded</div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => setCashflowModal(p)} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--ink3)', fontFamily: 'Inter', fontSize: 10, padding: '4px 10px', whiteSpace: 'nowrap' }}>Cashflows</button>
                        <button onClick={() => setVehicleModal({ open: true, item: p })} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--ink3)', fontFamily: 'Inter', fontSize: 11, padding: '4px 10px' }}>Edit</button>
                        <button onClick={() => deleteVehicle(p.id)} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--rouge)', fontFamily: 'Inter', fontSize: 11, padding: '4px 8px' }}>×</button>
                      </div>
                    </div>
                  )
                })}

                {/* Summary strip */}
                <div style={{ marginTop: 4, background: 'var(--charcoal)', borderRadius: 12, padding: '18px 24px', display: 'flex', gap: 32 }}>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 6 }}>Portfolio Value</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, color: '#80B4C4' }}>{fmt(totalCurrentValue)}</div>
                  </div>
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
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — Notes */}
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

      {vehicleModal.open && <VehicleModal item={vehicleModal.item} onSave={saveVehicle} onClose={() => setVehicleModal({ open: false })} isCouple={planMode === 'couple'} clientName={clientName} spouseName={spouseName} clientAge={clientAge} />}
      {cashflowModal && <CashflowModal vehicle={cashflowModal} onSave={(flows) => saveCashflows(cashflowModal.id, flows)} onClose={() => setCashflowModal(null)} />}
      {customGoalModal && <CustomGoalModal onSave={addCustomGoal} onClose={() => setCustomGoalModal(false)} clientAge={clientAge} isCouple={planMode === 'couple'} clientName={clientName} spouseName={spouseName} />}
    </div>
  )
}
