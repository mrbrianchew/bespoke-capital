'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// ─── TYPES ──────────────────────────────────────────────────────────────────

export type GoalType =
  | 'own_home'
  | 'property_upgrade'
  | 'investment_property'
  | 'business_fund'
  | 'major_life_event'
  | 'legacy_bequest'
  | 'other'

export interface WealthGoal {
  id: string
  type: GoalType
  label: string           // custom label for 'other' or display name
  targetAmount: number
  amountType: 'pv' | 'fv' // is the target in today's dollars or future dollars?
  yearsToGoal: number
  existingSavings: number  // amount already earmarked for this goal
  lumpSumPct: number       // 0–100: % funded by lump sum now vs monthly savings
  notes: string
}

export interface AccumulationData {
  inflationRate: number        // shared global rate (%)
  returnRate: number           // shared global expected return (%)
  emergencyTargetMonths: number // 0–24 slider
  goals: WealthGoal[]
  advisorNotes: string
}

export interface AccumulationProps {
  data: AccumulationData
  onChange: (updated: AccumulationData) => void
  // Financial profile values (read-only, pulled from ff)
  clientSavings: number        // a_savings
  clientFD: number             // a_fixed_deposit
  spouseSavings: number        // a2_savings
  spouseFD: number             // a2_fixed_deposit
  monthlyExpenses: number      // annual total expenses / 12
  monthlySurplus: number       // monthly disposable surplus
  isCouple: boolean
}

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const GOAL_OPTIONS: { type: GoalType; label: string; icon: string; desc: string }[] = [
  { type: 'own_home',           label: 'Purchase of Residential Home',   icon: '🏠', desc: 'First property or primary residence' },
  { type: 'property_upgrade',   label: 'Upgrade of Current Property',    icon: '🏡', desc: 'Sell existing home and buy larger' },
  { type: 'investment_property',label: 'Purchase of Investment Property', icon: '🏢', desc: 'Rental income or capital appreciation' },
  { type: 'business_fund',      label: 'Business / Entrepreneurship',    icon: '💼', desc: 'Start or expand a business venture' },
  { type: 'major_life_event',   label: 'Major Life Event',               icon: '🎯', desc: 'Wedding, sabbatical, travel, renovation' },
  { type: 'legacy_bequest',     label: 'Legacy / Bequest',               icon: '🎗', desc: 'Wealth to leave for next generation' },
  { type: 'other',              label: 'Other Goal',                     icon: '✦',  desc: 'Custom wealth accumulation goal' },
]

function fmtSGD(n: number) {
  if (!n || isNaN(n)) return 'SGD 0'
  if (n >= 1_000_000) return `SGD ${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `SGD ${(n / 1_000).toFixed(0)}K`
  return `SGD ${n.toFixed(0)}`
}

function newGoalId() {
  return 'goal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
}

// ─── CALCULATION ENGINE ─────────────────────────────────────────────────────
// Given a goal, return { monthlyRequired, lumpSumRequired, fvTarget }
function calcGoal(goal: WealthGoal, inflationRate: number, returnRate: number): {
  fvTarget: number
  lumpSumRequired: number
  monthlyRequired: number
} {
  const r  = returnRate / 100          // annual return
  const g  = inflationRate / 100       // annual inflation
  const n  = Math.max(goal.yearsToGoal, 0.1)
  const nm = n * 12                    // months
  const rm = r / 12                    // monthly return

  // Convert PV target → FV if needed
  const fvTarget = goal.amountType === 'pv'
    ? goal.targetAmount * Math.pow(1 + g, n)
    : goal.targetAmount

  // Existing savings grows to FV
  const existingFV = goal.existingSavings * Math.pow(1 + r, n)

  // Gap = FV needed minus what existing savings will grow to
  const gap = Math.max(0, fvTarget - existingFV)

  // Split gap between lump sum now and monthly savings
  const lumpPct    = goal.lumpSumPct / 100
  const monthlyPct = 1 - lumpPct

  // Lump sum required today (PV of lump-sum portion of gap)
  const lumpSumRequired = lumpPct > 0
    ? (gap * lumpPct) / Math.pow(1 + r, n)
    : 0

  // Monthly savings required (PMT formula, end-of-period)
  const monthlyGap = gap * monthlyPct
  let monthlyRequired = 0
  if (monthlyPct > 0 && rm > 0 && nm > 0) {
    monthlyRequired = monthlyGap * rm / (Math.pow(1 + rm, nm) - 1)
  } else if (monthlyPct > 0 && nm > 0) {
    monthlyRequired = monthlyGap / nm
  }

  return { fvTarget, lumpSumRequired, monthlyRequired }
}

// ─── SUBCOMPONENTS ──────────────────────────────────────────────────────────

function SectionIntro({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <p style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 8, fontWeight: 500 }}>{eyebrow}</p>
      <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 400, color: 'var(--ink)', marginBottom: 8, lineHeight: 1.2 }}>{title}</h2>
      <p style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6 }}>{subtitle}</p>
    </div>
  )
}

function SubLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 28 }}>
      <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600, color: color ?? 'var(--ink3)' }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  )
}

function RateInput({ label, value, onChange, min = 0, max = 20, step = 0.5 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number
}) {
  return (
    <div>
      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--gold)', height: 2, cursor: 'pointer' }}
        />
        <div style={{
          fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 500, color: 'var(--ink)',
          background: 'var(--cream2)', borderRadius: 6, padding: '4px 10px', minWidth: 52, textAlign: 'center'
        }}>
          {value.toFixed(1)}%
        </div>
      </div>
    </div>
  )
}

// ─── GOAL MODAL ─────────────────────────────────────────────────────────────

function GoalModal({ initial, onSave, onClose }: {
  initial?: WealthGoal
  onSave: (g: WealthGoal) => void
  onClose: () => void
}) {
  const [step, setStep] = useState<'pick' | 'detail'>(initial ? 'detail' : 'pick')
  const [goal, setGoal] = useState<WealthGoal>(initial ?? {
    id: newGoalId(),
    type: 'own_home',
    label: GOAL_OPTIONS[0].label,
    targetAmount: 0,
    amountType: 'pv',
    yearsToGoal: 10,
    existingSavings: 0,
    lumpSumPct: 50,
    notes: '',
  })

  function pickType(type: GoalType) {
    const opt = GOAL_OPTIONS.find(o => o.type === type)!
    setGoal(g => ({ ...g, type, label: type === 'other' ? '' : opt.label }))
    setStep('detail')
  }

  function upd(changes: Partial<WealthGoal>) {
    setGoal(g => ({ ...g, ...changes }))
  }

  const inp: React.CSSProperties = {
    width: '100%', background: 'white', border: '1px solid var(--line)',
    borderRadius: 8, padding: '10px 14px', fontFamily: 'Inter', fontSize: 13,
    color: 'var(--ink)', outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.55)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--cream)', borderRadius: 16, width: 540, maxHeight: '90vh',
        overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
      }}>
        {/* Header */}
        <div style={{ padding: '28px 32px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 6 }}>
              {step === 'pick' ? 'New Goal' : 'Goal Details'}
            </p>
            <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 400, color: 'var(--ink)' }}>
              {step === 'pick' ? 'What are you saving towards?' : (GOAL_OPTIONS.find(o => o.type === goal.type)?.label ?? 'Custom Goal')}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 20, lineHeight: 1, padding: 4, marginTop: 4 }}>✕</button>
        </div>

        <div style={{ padding: '20px 32px 32px' }}>
          {step === 'pick' ? (
            // ── STEP 1: Goal type picker ──────────────────────────────────
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {GOAL_OPTIONS.map(opt => (
                <button
                  key={opt.type}
                  onClick={() => pickType(opt.type)}
                  style={{
                    background: 'white', border: '1px solid var(--line)', borderRadius: 12,
                    padding: '16px 18px', textAlign: 'left', cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)'; (e.currentTarget as HTMLElement).style.background = 'var(--gold-l)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'; (e.currentTarget as HTMLElement).style.background = 'white' }}
                >
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{opt.icon}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 3, lineHeight: 1.3 }}>{opt.label}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>{opt.desc}</div>
                </button>
              ))}
            </div>
          ) : (
            // ── STEP 2: Goal details form ─────────────────────────────────
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Back to goal picker (only for new goals) */}
              {!initial && (
                <button onClick={() => setStep('pick')} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', padding: '0 0 4px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  ← Change goal type
                </button>
              )}

              {/* Custom label for 'other' */}
              {goal.type === 'other' && (
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Goal Name</div>
                  <input style={inp} placeholder="e.g. Sabbatical fund, Dream car…" value={goal.label} onChange={e => upd({ label: e.target.value })} />
                </div>
              )}

              {/* Target Amount + PV/FV toggle */}
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Target Amount</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>SGD</span>
                    <input
                      type="number" style={{ ...inp, paddingLeft: 48 }}
                      value={goal.targetAmount || ''}
                      onChange={e => upd({ targetAmount: parseFloat(e.target.value) || 0 })}
                      placeholder="0"
                    />
                  </div>
                  {/* PV / FV toggle */}
                  <div style={{ display: 'flex', background: 'white', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                    {(['pv', 'fv'] as const).map(t => (
                      <button key={t} onClick={() => upd({ amountType: t })} style={{
                        padding: '0 16px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 600,
                        background: goal.amountType === t ? 'var(--ink)' : 'white',
                        color: goal.amountType === t ? 'white' : 'var(--ink3)',
                        letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'all 0.15s',
                      }}>{t.toUpperCase()}</button>
                    ))}
                  </div>
                </div>
                <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>
                  {goal.amountType === 'pv'
                    ? 'PV — today\'s dollars. We\'ll inflate this to the target year.'
                    : 'FV — future value. Used as-is at the target year.'}
                </p>
              </div>

              {/* Years to goal */}
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Years to Goal</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="range" min={1} max={40} step={1} value={goal.yearsToGoal}
                    onChange={e => upd({ yearsToGoal: parseInt(e.target.value) })}
                    style={{ flex: 1, accentColor: 'var(--gold)', height: 2, cursor: 'pointer' }}
                  />
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 500, color: 'var(--ink)', background: 'var(--cream2)', borderRadius: 6, padding: '4px 10px', minWidth: 52, textAlign: 'center' }}>
                    {goal.yearsToGoal}y
                  </div>
                </div>
              </div>

              {/* Existing savings earmarked */}
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Existing Savings Already Earmarked</div>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>SGD</span>
                  <input type="number" style={{ ...inp, paddingLeft: 48 }} value={goal.existingSavings || ''} onChange={e => upd({ existingSavings: parseFloat(e.target.value) || 0 })} placeholder="0" />
                </div>
              </div>

              {/* Lump sum vs monthly slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Funding Split</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>
                    <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{goal.lumpSumPct}% Lump Sum</span>
                    {' · '}
                    <span>{100 - goal.lumpSumPct}% Monthly</span>
                  </div>
                </div>
                <input
                  type="range" min={0} max={100} step={5} value={goal.lumpSumPct}
                  onChange={e => upd({ lumpSumPct: parseInt(e.target.value) })}
                  style={{ width: '100%', accentColor: 'var(--gold)', height: 2, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>100% Monthly</span>
                  <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>100% Lump Sum</span>
                </div>
              </div>

              {/* Notes */}
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Notes</div>
                <textarea
                  rows={2} style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }}
                  placeholder="Any context, client preferences, assumptions…"
                  value={goal.notes} onChange={e => upd({ notes: e.target.value })}
                />
              </div>

              {/* Save */}
              <button
                onClick={() => {
                  if (!goal.targetAmount) return
                  const finalLabel = goal.type === 'other' && goal.label.trim() ? goal.label : (GOAL_OPTIONS.find(o => o.type === goal.type)?.label ?? 'Goal')
                  onSave({ ...goal, label: finalLabel })
                }}
                style={{
                  background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 10,
                  padding: '14px 28px', fontFamily: 'Inter', fontSize: 12, fontWeight: 600,
                  letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
                  marginTop: 4, transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                {initial ? 'Update Goal' : 'Add Goal'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── GOAL CARD ───────────────────────────────────────────────────────────────

function GoalCard({ goal, inflationRate, returnRate, onEdit, onDelete }: {
  goal: WealthGoal
  inflationRate: number
  returnRate: number
  onEdit: () => void
  onDelete: () => void
}) {
  const { fvTarget, lumpSumRequired, monthlyRequired } = calcGoal(goal, inflationRate, returnRate)
  const opt = GOAL_OPTIONS.find(o => o.type === goal.type)

  return (
    <div style={{
      background: 'white', border: '1px solid var(--line)', borderRadius: 14,
      overflow: 'hidden', transition: 'box-shadow 0.15s',
    }}>
      {/* Card header */}
      <div style={{ padding: '18px 20px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>{opt?.icon ?? '✦'}</span>
          <div>
            <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{goal.label}</div>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>
              Target in <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{goal.yearsToGoal} year{goal.yearsToGoal !== 1 ? 's' : ''}</span>
              {' · '}
              {goal.amountType === 'pv' ? 'PV inflated to FV' : 'FV as stated'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onEdit} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--ink3)', fontFamily: 'Inter', fontSize: 11, padding: '4px 10px' }}>Edit</button>
          <button onClick={onDelete} style={{ background: 'none', border: '1px solid var(--rouge-l)', borderRadius: 6, cursor: 'pointer', color: 'var(--rouge)', fontFamily: 'Inter', fontSize: 11, padding: '4px 10px' }}>Remove</button>
        </div>
      </div>

      {/* Card body — KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 0 }}>
        {[
          { label: 'Target (Today)', value: fmtSGD(goal.targetAmount), sub: goal.amountType === 'pv' ? 'In today\'s $' : 'As stated FV' },
          { label: 'FV at Year ' + goal.yearsToGoal, value: fmtSGD(fvTarget), sub: 'Inflation-adjusted', highlight: true },
          { label: 'Lump Sum Now', value: goal.lumpSumPct > 0 ? fmtSGD(lumpSumRequired) : '—', sub: goal.lumpSumPct + '% of gap' },
          { label: 'Monthly Savings', value: goal.lumpSumPct < 100 ? fmtSGD(monthlyRequired) : '—', sub: (100 - goal.lumpSumPct) + '% of gap' },
        ].map((kpi, i) => (
          <div key={i} style={{
            padding: '14px 18px',
            borderRight: i < 3 ? '1px solid var(--line)' : 'none',
            background: kpi.highlight ? 'var(--gold-l)' : 'transparent',
          }}>
            <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>{kpi.label}</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17, fontWeight: 600, color: kpi.highlight ? 'var(--gold-tag)' : 'var(--ink)', marginBottom: 2 }}>{kpi.value}</div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Existing savings note */}
      {goal.existingSavings > 0 && (
        <div style={{ padding: '8px 20px 10px', background: 'var(--emerald-l)', borderTop: '1px solid #d0e8da' }}>
          <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--emerald)' }}>
            ✓ {fmtSGD(goal.existingSavings)} already earmarked — grows to {fmtSGD(goal.existingSavings * Math.pow(1 + returnRate / 100, goal.yearsToGoal))} at target year
          </span>
        </div>
      )}
    </div>
  )
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function WealthAccumulationSection({
  data, onChange,
  clientSavings, clientFD, spouseSavings, spouseFD,
  monthlyExpenses, monthlySurplus, isCouple,
}: AccumulationProps) {
  const [modal, setModal] = useState<{ open: boolean; editGoal?: WealthGoal }>({ open: false })

  function upd(changes: Partial<AccumulationData>) {
    onChange({ ...data, ...changes })
  }

  function addOrUpdateGoal(g: WealthGoal) {
    const existing = data.goals.findIndex(x => x.id === g.id)
    const updated = existing >= 0
      ? data.goals.map(x => x.id === g.id ? g : x)
      : [...data.goals, g]
    upd({ goals: updated })
    setModal({ open: false })
  }

  function removeGoal(id: string) {
    upd({ goals: data.goals.filter(g => g.id !== id) })
  }

  // ── Emergency liquidity calculations ──
  const totalLiquid = clientSavings + clientFD + (isCouple ? spouseSavings + spouseFD : 0)
  const currentMonths = monthlyExpenses > 0 ? totalLiquid / monthlyExpenses : 0
  const targetMonths = data.emergencyTargetMonths
  const targetLiquid = monthlyExpenses * targetMonths
  const liquidGap = Math.max(0, targetLiquid - totalLiquid)
  const liquidSurplus = Math.max(0, totalLiquid - targetLiquid)

  // ── Goal totals ──
  const totals = data.goals.reduce((acc, goal) => {
    const { lumpSumRequired, monthlyRequired } = calcGoal(goal, data.inflationRate, data.returnRate)
    return {
      monthly: acc.monthly + monthlyRequired,
      lumpSum: acc.lumpSum + lumpSumRequired,
    }
  }, { monthly: 0, lumpSum: 0 })

  const totalMonthlyRequired = totals.monthly
  const totalLumpSumRequired = totals.lumpSum
  const surplusGap = monthlySurplus - totalMonthlyRequired

  return (
    <div>
      <SectionIntro
        eyebrow="Section 2 · Wealth Accumulation"
        title="Building Towards Your Goals"
        subtitle="Let's identify what you're saving for, how much you'll need, and the most efficient path to get there."
      />

      {/* ── PART A: GLOBAL RATES ─────────────────────────────────────── */}
      <SubLabel color="var(--gold)">Global Assumptions</SubLabel>
      <div style={{ background: 'var(--gold-l)', border: '1px solid #e8d9be', borderRadius: 12, padding: '20px 24px', marginBottom: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
          <RateInput
            label="Expected Return Rate (p.a.)"
            value={data.returnRate}
            onChange={v => upd({ returnRate: v })}
            min={0} max={15} step={0.5}
          />
          <RateInput
            label="Inflation Rate (p.a.)"
            value={data.inflationRate}
            onChange={v => upd({ inflationRate: v })}
            min={0} max={10} step={0.25}
          />
        </div>
        <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--gold-tag)', marginTop: 14 }}>
          These rates apply to all goals below. Return rate is used to grow both lump sum investments and monthly savings contributions.
        </p>
      </div>

      {/* ── PART B: EMERGENCY LIQUIDITY ─────────────────────────────── */}
      <SubLabel color="var(--emerald)">Emergency &amp; Liquidity Reserve</SubLabel>
      <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
        {/* Advisory note */}
        <div style={{ background: 'var(--emerald-l)', padding: '12px 20px', borderBottom: '1px solid #d0e8da' }}>
          <p style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--emerald)', lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600 }}>Recommendation:</span> An emergency reserve of <strong>3–6 months</strong> of expenses provides adequate liquidity for unexpected events. High-income earners or business owners may consider up to 12 months.
          </p>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Current liquid assets pulled from profile */}
          <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Client — Savings / Current', value: clientSavings },
              { label: 'Client — Fixed Deposits', value: clientFD },
              ...(isCouple ? [
                { label: 'Spouse — Savings / Current', value: spouseSavings },
                { label: 'Spouse — Fixed Deposits', value: spouseFD },
              ] : []),
            ].map((item, i) => (
              <div key={i} style={{ background: 'var(--cream)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 16px' }}>
                <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>{item.label}</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{fmtSGD(item.value)}</div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 2 }}>From financial profile</div>
              </div>
            ))}
          </div>

          {/* Current months coverage */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={{ background: 'var(--cream)', borderRadius: 10, border: '1px solid var(--line)', padding: '14px 18px' }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Total Liquid Assets</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>{fmtSGD(totalLiquid)}</div>
            </div>
            <div style={{
              background: currentMonths >= 3 ? 'var(--emerald-l)' : 'var(--rouge-l)',
              borderRadius: 10,
              border: `1px solid ${currentMonths >= 3 ? '#d0e8da' : '#e8d0d0'}`,
              padding: '14px 18px',
            }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Current Coverage</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: currentMonths >= 3 ? 'var(--emerald)' : 'var(--rouge)' }}>
                {currentMonths.toFixed(1)} months
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 2 }}>
                {monthlyExpenses > 0 ? `Based on ${fmtSGD(monthlyExpenses)}/mo expenses` : 'Set monthly expenses in Financial Profile'}
              </div>
            </div>
          </div>

          {/* Target months slider */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Target Reserve</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 500, color: 'var(--ink)', background: 'var(--cream2)', borderRadius: 6, padding: '4px 12px' }}>
                {targetMonths} months · {fmtSGD(targetLiquid)}
              </div>
            </div>
            <input
              type="range" min={0} max={24} step={1} value={targetMonths}
              onChange={e => upd({ emergencyTargetMonths: parseInt(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--emerald)', height: 2, cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              {[0, 3, 6, 12, 18, 24].map(m => (
                <span key={m} style={{ fontFamily: 'Inter', fontSize: 10, color: m === 3 || m === 6 ? 'var(--emerald)' : 'var(--ink3)' }}>{m}m</span>
              ))}
            </div>
          </div>

          {/* Gap / surplus */}
          {targetMonths > 0 && (
            <div style={{
              marginTop: 16,
              background: liquidGap > 0 ? 'var(--rouge-l)' : 'var(--emerald-l)',
              border: `1px solid ${liquidGap > 0 ? '#e8d0d0' : '#d0e8da'}`,
              borderRadius: 10, padding: '12px 18px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'Inter', fontSize: 12, color: liquidGap > 0 ? 'var(--rouge)' : 'var(--emerald)', fontWeight: 500 }}>
                {liquidGap > 0 ? `Shortfall of ${fmtSGD(liquidGap)} to reach ${targetMonths}-month reserve` : `Surplus of ${fmtSGD(liquidSurplus)} above ${targetMonths}-month reserve`}
              </span>
              <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>
                {liquidGap > 0 ? `${currentMonths.toFixed(1)}m → ${targetMonths}m` : '✓ Target met'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── PART C: WEALTH GOALS ─────────────────────────────────────── */}
      <SubLabel>Wealth Goals</SubLabel>

      {/* Goals list */}
      {data.goals.length === 0 ? (
        <div style={{
          background: 'white', border: '2px dashed var(--line)', borderRadius: 14,
          padding: '40px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>✦</div>
          <p style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', marginBottom: 6 }}>No goals added yet</p>
          <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>Add the client's financial goals to calculate the capital required</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.goals.map(goal => (
            <GoalCard
              key={goal.id}
              goal={goal}
              inflationRate={data.inflationRate}
              returnRate={data.returnRate}
              onEdit={() => setModal({ open: true, editGoal: goal })}
              onDelete={() => removeGoal(goal.id)}
            />
          ))}
        </div>
      )}

      {/* Add goal button */}
      <button
        onClick={() => setModal({ open: true })}
        style={{
          marginTop: 14, width: '100%', background: 'white',
          border: '1px solid var(--line)', borderRadius: 12,
          padding: '14px 24px', cursor: 'pointer', fontFamily: 'Inter',
          fontSize: 12, fontWeight: 600, color: 'var(--ink)',
          letterSpacing: '0.06em', textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)'; (e.currentTarget as HTMLElement).style.color = 'var(--gold)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)' }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add Wealth Goal
      </button>

      {/* ── PART D: SECTION SUMMARY ───────────────────────────────────── */}
      {data.goals.length > 0 && (
        <>
          <SubLabel>Capital Mandate Summary</SubLabel>
          <div style={{ background: 'var(--ink)', borderRadius: 16, padding: '28px 32px', color: 'white' }}>
            <p style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 16 }}>
              {data.goals.length} Goal{data.goals.length !== 1 ? 's' : ''} · Based on {data.returnRate}% return · {data.inflationRate}% inflation
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 0, marginBottom: 24 }}>
              {[
                { label: 'Total Lump Sum Required', value: fmtSGD(totalLumpSumRequired), sub: 'Invest today' },
                { label: 'Total Monthly Savings', value: fmtSGD(totalMonthlyRequired), sub: 'Per month required' },
                { label: 'Monthly Surplus', value: fmtSGD(monthlySurplus), sub: 'Available from profile' },
                {
                  label: surplusGap >= 0 ? 'Monthly Surplus Remaining' : 'Monthly Shortfall',
                  value: fmtSGD(Math.abs(surplusGap)),
                  sub: surplusGap >= 0 ? 'After all goals funded' : 'Goals exceed surplus',
                  alert: surplusGap < 0,
                },
              ].map((kpi, i) => (
                <div key={i} style={{ paddingRight: i < 3 ? 24 : 0, borderRight: i < 3 ? '1px solid rgba(255,255,255,0.12)' : 'none', paddingLeft: i > 0 ? 24 : 0 }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>{kpi.label}</div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: kpi.alert ? '#f0a0a0' : (i === 0 ? 'var(--gold)' : 'white'), marginBottom: 4 }}>{kpi.value}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>{kpi.sub}</div>
                </div>
              ))}
            </div>

            {/* Per-goal breakdown */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 20 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 12 }}>Goal Breakdown</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.goals.map(goal => {
                  const { fvTarget, lumpSumRequired, monthlyRequired } = calcGoal(goal, data.inflationRate, data.returnRate)
                  const opt = GOAL_OPTIONS.find(o => o.type === goal.type)
                  return (
                    <div key={goal.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: 14 }}>{opt?.icon ?? '✦'}</span>
                        <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>{goal.label}</span>
                        <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>· {goal.yearsToGoal}y · FV {fmtSGD(fvTarget)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 20 }}>
                        {goal.lumpSumPct > 0 && <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--gold)' }}>{fmtSGD(lumpSumRequired)} lump</span>}
                        {goal.lumpSumPct < 100 && <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{fmtSGD(monthlyRequired)}/mo</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── ADVISOR NOTES ──────────────────────────────────────────────── */}
      <SubLabel>Advisor Notes</SubLabel>
      <textarea
        rows={3}
        value={data.advisorNotes}
        onChange={e => upd({ advisorNotes: e.target.value })}
        placeholder="Record any context, priorities, or constraints discussed during this section…"
        style={{
          width: '100%', background: 'white', border: '1px solid var(--line)',
          borderRadius: 10, padding: '14px 16px', fontFamily: 'Inter', fontSize: 13,
          color: 'var(--ink)', resize: 'vertical', lineHeight: 1.6, outline: 'none',
          boxSizing: 'border-box',
        }}
      />

      {/* Modal */}
      {modal.open && (
        <GoalModal
          initial={modal.editGoal}
          onSave={addOrUpdateGoal}
          onClose={() => setModal({ open: false })}
        />
      )}
    </div>
  )
}
