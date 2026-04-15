'use client'

import { useState } from 'react'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type GoalType =
  | 'own_home'
  | 'property_upgrade'
  | 'investment_property'
  | 'business_fund'
  | 'major_life_event'
  | 'legacy_bequest'
  | 'other'

export type GoalOwner = 'client' | 'spouse' | 'joint'
export type ResidencyStatus = 'sc' | 'pr' | 'foreigner'

export interface WealthGoal {
  id: string
  type: GoalType
  label: string
  owner: GoalOwner
  targetAmount: number
  amountType: 'pv' | 'fv'
  yearsToGoal: number
  existingSavings: number
  lumpSumPct: number
  notes: string
  // Property-specific
  propertyNumber?: 1 | 2 | 3 | 4 | 5
  residencyStatus?: ResidencyStatus
  downpaymentPct?: number
  purchasePrice?: number  // kept separate so we can show stamp duty vs savings target
}

export interface AccumulationData {
  inflationRate: number
  returnRate: number
  emergencyTargetMonths: number
  goals: WealthGoal[]
  advisorNotes: string
}

export interface AccumulationProps {
  data: AccumulationData
  onChange: (updated: AccumulationData) => void
  clientSavings: number
  clientFD: number
  spouseSavings: number
  spouseFD: number
  monthlyExpenses: number
  monthlySurplus: number
  isCouple: boolean
  clientName?: string
  spouseName?: string
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const GOAL_OPTIONS: { type: GoalType; label: string; icon: string; desc: string }[] = [
  { type: 'own_home',            label: 'Purchase of Residential Home',   icon: '🏠', desc: 'First property or primary residence' },
  { type: 'property_upgrade',    label: 'Upgrade of Current Property',    icon: '🏡', desc: 'Sell existing home and buy larger' },
  { type: 'investment_property', label: 'Purchase of Investment Property', icon: '🏢', desc: 'Rental income or capital appreciation' },
  { type: 'business_fund',       label: 'Business / Entrepreneurship',    icon: '💼', desc: 'Start or expand a business venture' },
  { type: 'major_life_event',    label: 'Major Life Event',               icon: '🎯', desc: 'Wedding, sabbatical, travel, renovation' },
  { type: 'legacy_bequest',      label: 'Legacy / Bequest',               icon: '🎗', desc: 'Wealth to leave for next generation' },
  { type: 'other',               label: 'Other Goal',                     icon: '✦',  desc: 'Custom wealth accumulation goal' },
]

const PROPERTY_TYPES: GoalType[] = ['own_home', 'property_upgrade', 'investment_property']
const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th']
const RESIDENCY_LABELS: Record<ResidencyStatus, string> = {
  sc: 'SG Citizen',
  pr: 'PR',
  foreigner: 'Foreigner',
}

// ─── SINGAPORE STAMP DUTY ────────────────────────────────────────────────────

function calcBSD(price: number): number {
  if (price <= 0) return 0
  const bands = [
    { up: 180000,   rate: 0.01 },
    { up: 360000,   rate: 0.02 },
    { up: 1000000,  rate: 0.03 },
    { up: 1500000,  rate: 0.04 },
    { up: 3000000,  rate: 0.05 },
    { up: Infinity, rate: 0.06 },
  ]
  let bsd = 0, remaining = price, prev = 0
  for (const band of bands) {
    const slice = Math.min(remaining, band.up - prev)
    if (slice <= 0) break
    bsd += slice * band.rate
    remaining -= slice
    prev = band.up
    if (remaining <= 0) break
  }
  return Math.round(bsd)
}

function calcABSD(price: number, residency: ResidencyStatus, propNum: number): number {
  // Feb 2023 revised rates
  const rates: Record<ResidencyStatus, number[]> = {
    sc:       [0,    0.20, 0.30],
    pr:       [0.05, 0.30, 0.35],
    foreigner:[0.60, 0.60, 0.60],
  }
  const idx = Math.min(propNum - 1, 2)
  return Math.round(price * (rates[residency][idx] ?? 0))
}

function calcFees(price: number) {
  return {
    legal: Math.round(Math.min(Math.max(price * 0.002, 2500), 8000)),
    misc:  Math.round(500 + (price > 1000000 ? 500 : 0)),
  }
}

function totalCashNeeded(goal: WealthGoal): number {
  const price = goal.purchasePrice ?? goal.targetAmount
  const dp  = price * (goal.downpaymentPct ?? 25) / 100
  const bsd = calcBSD(price)
  const absd = calcABSD(price, goal.residencyStatus ?? 'sc', goal.propertyNumber ?? 1)
  const { legal, misc } = calcFees(price)
  return dp + bsd + absd + legal + misc
}

// ─── CALC ENGINE ──────────────────────────────────────────────────────────────

function calcGoal(goal: WealthGoal, inflationRate: number, returnRate: number) {
  const r = returnRate / 100, g = inflationRate / 100
  const n = Math.max(goal.yearsToGoal, 0.1), nm = n * 12, rm = r / 12
  const fvTarget = goal.amountType === 'pv' ? goal.targetAmount * Math.pow(1 + g, n) : goal.targetAmount
  const existingFV = goal.existingSavings * Math.pow(1 + r, n)
  const gap = Math.max(0, fvTarget - existingFV)
  const lp = goal.lumpSumPct / 100, mp = 1 - lp
  const lumpSumRequired = lp > 0 ? (gap * lp) / Math.pow(1 + r, n) : 0
  let monthlyRequired = 0
  if (mp > 0 && rm > 0 && nm > 0) monthlyRequired = (gap * mp) * rm / (Math.pow(1 + rm, nm) - 1)
  else if (mp > 0 && nm > 0) monthlyRequired = (gap * mp) / nm
  return { fvTarget, lumpSumRequired, monthlyRequired }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmtSGD(n: number) {
  if (!n || isNaN(n)) return 'SGD 0'
  return `SGD ${Math.round(n).toLocaleString('en-SG')}`
}
function newId() { return 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2,5) }

// ─── SUBCOMPONENTS ────────────────────────────────────────────────────────────

function SubLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16, marginTop:28 }}>
      <span style={{ fontFamily:'Inter', fontSize:9, letterSpacing:'0.15em', textTransform:'uppercase', fontWeight:600, color: color ?? 'var(--ink3)' }}>{children}</span>
      <div style={{ flex:1, height:1, background:'var(--line)' }} />
    </div>
  )
}

function RateSlider({ label, value, onChange, min=0, max=20, step=0.5 }: { label:string; value:number; onChange:(v:number)=>void; min?:number; max?:number; step?:number }) {
  return (
    <div>
      <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:6 }}>{label}</div>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} style={{ flex:1, accentColor:'var(--gold)', height:2, cursor:'pointer' }} />
        <div style={{ fontFamily:'DM Mono, monospace', fontSize:13, fontWeight:500, color:'var(--ink)', background:'var(--cream2)', borderRadius:6, padding:'4px 10px', minWidth:52, textAlign:'center' }}>{value.toFixed(1)}%</div>
      </div>
    </div>
  )
}

function PillSelect<T extends string | number>({ options, value, onChange }: { options:{value:T;label:string}[]; value:T; onChange:(v:T)=>void }) {
  return (
    <div style={{ display:'flex', background:'white', border:'1px solid var(--line)', borderRadius:8, overflow:'hidden' }}>
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)} style={{ flex:1, padding:'9px 4px', border:'none', cursor:'pointer', fontFamily:'Inter', fontSize:11, fontWeight:500, background: value===opt.value ? 'var(--ink)' : 'white', color: value===opt.value ? 'white' : 'var(--ink3)', transition:'all 0.15s', whiteSpace:'nowrap' }}>{opt.label}</button>
      ))}
    </div>
  )
}

// ─── PROPERTY STAMP DUTY PANEL ────────────────────────────────────────────────

function PropertyPanel({ goal, onUpdate }: { goal: WealthGoal; onUpdate: (c: Partial<WealthGoal>) => void }) {
  const price    = goal.purchasePrice ?? 0
  const propNum  = goal.propertyNumber ?? 1
  const residency = goal.residencyStatus ?? 'sc'
  const dpPct    = goal.downpaymentPct ?? 25
  const dpAmt    = price * dpPct / 100
  const loanAmt  = price - dpAmt
  const bsd      = calcBSD(price)
  const absd     = calcABSD(price, residency, propNum)
  const { legal, misc } = calcFees(price)
  const totalStamp = bsd + absd
  const totalCash  = dpAmt + bsd + absd + legal + misc

  const inp: React.CSSProperties = { width:'100%', background:'white', border:'1px solid var(--line)', borderRadius:8, padding:'9px 12px', fontFamily:'Inter', fontSize:13, color:'var(--ink)', outline:'none', boxSizing:'border-box' }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Purchase price */}
      <div>
        <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:6 }}>Purchase Price</div>
        <div style={{ position:'relative' }}>
          <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontFamily:'Inter', fontSize:12, color:'var(--ink3)' }}>SGD</span>
          <input type="number" style={{ ...inp, paddingLeft:48 }} value={price||''} placeholder="0"
  onChange={e => {
    const newPrice = parseFloat(e.target.value) || 0
    const cashNeeded = totalCashNeeded({ ...goal, purchasePrice: newPrice })
    onUpdate({ purchasePrice: newPrice, targetAmount: cashNeeded })
  }} />
        </div>
      </div>

      {/* Property number + residency */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <div>
          <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:6 }}>Which Property</div>
          <div style={{ display:'flex', background:'white', border:'1px solid var(--line)', borderRadius:8, overflow:'hidden' }}>
  {([1,2,3,4,5] as const).map(n => (
    <button key={n} onClick={() => onUpdate({ propertyNumber:n })} style={{ flex:1, padding:'9px 0', border:'none', cursor:'pointer', fontFamily:'Inter', fontSize:11, fontWeight:500, background:propNum===n?'var(--ink)':'white', color:propNum===n?'white':'var(--ink3)', transition:'all 0.15s' }}>
      {ORDINALS[n]}
    </button>
  ))}
</div>
        </div>
        <div>
          <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:6 }}>Residency Status</div>
          <PillSelect<ResidencyStatus>
            options={(['sc','pr','foreigner'] as ResidencyStatus[]).map(r => ({ value:r, label:RESIDENCY_LABELS[r] }))}
            value={residency}
            onChange={v => onUpdate({ residencyStatus:v })}
          />
        </div>
      </div>

      {/* Downpayment slider */}
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
          <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)' }}>Downpayment</div>
          <div style={{ fontFamily:'Inter', fontSize:11, color:'var(--ink3)' }}>
            <span style={{ color:'var(--gold)', fontWeight:600 }}>{dpPct}% · {fmtSGD(dpAmt)}</span>
            {' — Loan: '}<span style={{ color:'var(--ink)', fontWeight:600 }}>{fmtSGD(loanAmt)}</span>
          </div>
        </div>
        <input type="range" min={0} max={100} step={1} value={dpPct}
          onChange={e => onUpdate({ downpaymentPct: parseInt(e.target.value) })}
          style={{ width:'100%', accentColor:'var(--gold)', height:2, cursor:'pointer' }}
        />
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:4 }}>
  {[0,10,20,25,30,50,75,100].map(p => (
    <span key={p} style={{ fontFamily:'Inter', fontSize:10, color:'var(--ink3)' }}>{p}%</span>
  ))}
</div>
      </div>

      {/* Stamp duty breakdown */}
      {price > 0 && (
        <div style={{ background:'var(--cream2)', border:'1px solid var(--line)', borderRadius:12, overflow:'hidden' }}>
          <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--line)', display:'flex', justifyContent:'space-between' }}>
            <span style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--ink3)', fontWeight:600 }}>Singapore Stamp Duty & Fees</span>
            <span style={{ fontFamily:'Inter', fontSize:10, color:'var(--ink3)' }}>{RESIDENCY_LABELS[residency]} · {ORDINALS[propNum]} property</span>
          </div>
          <div style={{ padding:'14px 16px', display:'flex', flexDirection:'column', gap:10 }}>
            {[
              { label: "Buyer's Stamp Duty (BSD)", value: bsd, note:'Tiered 1–6%', alert:false },
              { label: `ABSD — ${ORDINALS[propNum]} property`, value: absd, note: absd===0 ? 'Nil (SC 1st property)' : `${(absd/price*100).toFixed(0)}% flat`, alert: absd>0 },
              { label: 'Legal Fees (est.)',         value: legal, note:'~0.2% conveyancing', alert:false },
              { label: 'Valuation & Misc',          value: misc, note:'Estimate', alert:false },
            ].map((row,i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div>
                  <div style={{ fontFamily:'Inter', fontSize:12, color: row.alert ? 'var(--rouge)' : 'var(--ink)', fontWeight: row.alert ? 600 : 400 }}>{row.label}</div>
                  <div style={{ fontFamily:'Inter', fontSize:10, color:'var(--ink3)' }}>{row.note}</div>
                </div>
                <div style={{ fontFamily:'DM Mono, monospace', fontSize:13, fontWeight:600, color: row.alert ? 'var(--rouge)' : 'var(--ink)', marginLeft:12 }}>{fmtSGD(row.value)}</div>
              </div>
            ))}
            <div style={{ borderTop:'1px solid var(--line)', paddingTop:10, display:'flex', flexDirection:'column', gap:6 }}>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ fontFamily:'Inter', fontSize:12, fontWeight:600 }}>Total Stamp Duty</span>
                <span style={{ fontFamily:'DM Mono, monospace', fontSize:13, fontWeight:700 }}>{fmtSGD(totalStamp)}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', background:'var(--gold-l)', padding:'8px 10px', borderRadius:8 }}>
                <span style={{ fontFamily:'Inter', fontSize:12, fontWeight:700, color:'var(--gold-tag)' }}>Total Cash at Completion</span>
                <span style={{ fontFamily:'DM Mono, monospace', fontSize:14, fontWeight:700, color:'var(--gold-tag)' }}>{fmtSGD(totalCash)}</span>
              </div>
              <div style={{ fontFamily:'Inter', fontSize:10, color:'var(--ink3)' }}>
                DP {fmtSGD(dpAmt)} + Stamp {fmtSGD(totalStamp)} + Fees {fmtSGD(legal+misc)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── GOAL MODAL ───────────────────────────────────────────────────────────────

function GoalModal({ initial, onSave, onClose, isCouple, clientName, spouseName }: {
  initial?: WealthGoal; onSave:(g:WealthGoal)=>void; onClose:()=>void
  isCouple:boolean; clientName:string; spouseName:string
}) {
  const [step, setStep] = useState<'pick'|'detail'>(initial ? 'detail' : 'pick')
  const [goal, setGoal] = useState<WealthGoal>(initial ?? {
    id: newId(), type:'own_home', label:GOAL_OPTIONS[0].label, owner:'client',
    targetAmount:0, amountType:'fv', yearsToGoal:10, existingSavings:0, lumpSumPct:50, notes:'',
    propertyNumber:1, residencyStatus:'sc', downpaymentPct:25, purchasePrice:0,
  })
  function upd(c: Partial<WealthGoal>) { setGoal(g => ({ ...g, ...c })) }
  const isProperty = PROPERTY_TYPES.includes(goal.type)
  const inp: React.CSSProperties = { width:'100%', background:'white', border:'1px solid var(--line)', borderRadius:8, padding:'10px 14px', fontFamily:'Inter', fontSize:13, color:'var(--ink)', outline:'none', boxSizing:'border-box' }

  const ownerOpts: {value:GoalOwner;label:string}[] = [
    { value:'client', label: clientName },
    ...(isCouple ? [{ value:'spouse' as GoalOwner, label:spouseName }, { value:'joint' as GoalOwner, label:'Joint' }] : []),
  ]

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(28,26,23,0.55)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={e => { if(e.target===e.currentTarget) onClose() }}>
      <div style={{ background:'var(--cream)', borderRadius:16, width:580, maxHeight:'92vh', overflow:'auto', boxShadow:'0 24px 64px rgba(0,0,0,0.22)' }}>
        <div style={{ padding:'28px 32px 0', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <p style={{ fontFamily:'Inter', fontSize:9, letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--gold)', marginBottom:6 }}>{step==='pick' ? 'New Goal' : 'Goal Details'}</p>
            <h3 style={{ fontFamily:'Cormorant Garamond, serif', fontSize:22, fontWeight:400, color:'var(--ink)' }}>
              {step==='pick' ? "What are you saving towards?" : (GOAL_OPTIONS.find(o=>o.type===goal.type)?.label ?? 'Custom Goal')}
            </h3>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--ink3)', fontSize:20, padding:4, marginTop:4 }}>✕</button>
        </div>

        <div style={{ padding:'20px 32px 32px' }}>
          {step==='pick' ? (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {GOAL_OPTIONS.map(opt => (
                <button key={opt.type} onClick={() => { setGoal(g=>({...g,type:opt.type,label:opt.type==='other'?'':opt.label})); setStep('detail') }}
                  style={{ background:'white', border:'1px solid var(--line)', borderRadius:12, padding:'16px 18px', textAlign:'left', cursor:'pointer', transition:'all 0.15s' }}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor='var(--gold)';(e.currentTarget as HTMLElement).style.background='var(--gold-l)'}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor='var(--line)';(e.currentTarget as HTMLElement).style.background='white'}}>
                  <div style={{ fontSize:20, marginBottom:6 }}>{opt.icon}</div>
                  <div style={{ fontFamily:'Inter', fontSize:12, fontWeight:600, color:'var(--ink)', marginBottom:3, lineHeight:1.3 }}>{opt.label}</div>
                  <div style={{ fontFamily:'Inter', fontSize:11, color:'var(--ink3)' }}>{opt.desc}</div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
              {!initial && <button onClick={()=>setStep('pick')} style={{ alignSelf:'flex-start', background:'none', border:'none', cursor:'pointer', fontFamily:'Inter', fontSize:11, color:'var(--ink3)', padding:0 }}>← Change goal type</button>}

              {/* Owner */}
              <div>
                <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:6 }}>Goal For</div>
                <PillSelect<GoalOwner> options={ownerOpts} value={goal.owner} onChange={v=>upd({owner:v})} />
              </div>

              {goal.type==='other' && (
                <div>
                  <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:6 }}>Goal Name</div>
                  <input style={inp} placeholder="e.g. Sabbatical fund, Dream car…" value={goal.label} onChange={e=>upd({label:e.target.value})} />
                </div>
              )}

              {isProperty ? (
                <PropertyPanel goal={goal} onUpdate={upd} />
              ) : (
                <div>
                  <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:6 }}>Target Amount</div>
                  <div style={{ display:'flex', gap:10 }}>
                    <div style={{ position:'relative', flex:1 }}>
                      <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', fontFamily:'Inter', fontSize:12, color:'var(--ink3)' }}>SGD</span>
                      <input type="number" style={{ ...inp, paddingLeft:48 }} value={goal.targetAmount||''} onChange={e=>upd({targetAmount:parseFloat(e.target.value)||0})} placeholder="0" />
                    </div>
                    <div style={{ display:'flex', background:'white', border:'1px solid var(--line)', borderRadius:8, overflow:'hidden' }}>
                      {(['pv','fv'] as const).map(t => (
                        <button key={t} onClick={()=>upd({amountType:t})} style={{ padding:'0 16px', border:'none', cursor:'pointer', fontFamily:'Inter', fontSize:11, fontWeight:600, background:goal.amountType===t?'var(--ink)':'white', color:goal.amountType===t?'white':'var(--ink3)', textTransform:'uppercase', transition:'all 0.15s' }}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <p style={{ fontFamily:'Inter', fontSize:11, color:'var(--ink3)', marginTop:6 }}>
                    {goal.amountType==='pv' ? "PV — today's dollars, inflated to target year." : "FV — future value, used as-is."}
                  </p>
                </div>
              )}

              {/* Years to goal */}
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                  <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)' }}>Years to Goal</div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontSize:13, fontWeight:500, color:'var(--ink)', background:'var(--cream2)', borderRadius:6, padding:'2px 10px' }}>{goal.yearsToGoal}y</div>
                </div>
                <input type="range" min={1} max={40} step={1} value={goal.yearsToGoal} onChange={e=>upd({yearsToGoal:parseInt(e.target.value)})} style={{ width:'100%', accentColor:'var(--gold)', height:2, cursor:'pointer' }} />
              </div>

              {/* Existing savings */}
              <div>
                <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:6 }}>
                  {isProperty ? 'Savings Already Set Aside for This Purchase' : 'Existing Savings Already Earmarked'}
                </div>
                <div style={{ position:'relative' }}>
                  <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', fontFamily:'Inter', fontSize:12, color:'var(--ink3)' }}>SGD</span>
                  <input type="number" style={{ ...inp, paddingLeft:48 }} value={goal.existingSavings||''} onChange={e=>upd({existingSavings:parseFloat(e.target.value)||0})} placeholder="0" />
                </div>
              </div>

              {/* Notes */}
              <div>
                <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:6 }}>Notes</div>
                <textarea rows={2} style={{ ...inp, resize:'vertical', lineHeight:1.5 }} placeholder="Context, preferences, assumptions…" value={goal.notes} onChange={e=>upd({notes:e.target.value})} />
              </div>

              <button
                onClick={() => {
                  const rawTarget = isProperty ? totalCashNeeded(goal) : goal.targetAmount
                  if (!rawTarget) return
                  const finalLabel = goal.type==='other' && goal.label.trim() ? goal.label : (GOAL_OPTIONS.find(o=>o.type===goal.type)?.label ?? 'Goal')
                  onSave({ ...goal, label:finalLabel, targetAmount: rawTarget, amountType:'fv' })
                }}
                style={{ background:'var(--ink)', color:'white', border:'none', borderRadius:10, padding:'14px 28px', fontFamily:'Inter', fontSize:12, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', cursor:'pointer', marginTop:4 }}
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

// ─── GOAL CARD ────────────────────────────────────────────────────────────────

function GoalCard({ goal, inflationRate, returnRate, onEdit, onDelete, onLumpSum, isCouple, clientName, spouseName }: {
  goal: WealthGoal; inflationRate:number; returnRate:number
  onEdit:()=>void; onDelete:()=>void; onLumpSum:(pct:number)=>void
  isCouple:boolean; clientName:string; spouseName:string
}) {
  const { fvTarget, lumpSumRequired, monthlyRequired } = calcGoal(goal, inflationRate, returnRate)
  const opt = GOAL_OPTIONS.find(o=>o.type===goal.type)
  const ownerLabel = goal.owner==='client' ? clientName : goal.owner==='spouse' ? spouseName : 'Joint'
  const ownerColors: Record<GoalOwner,{fg:string;bg:string}> = {
    client:  { fg:'var(--emerald)',  bg:'var(--emerald-l)' },
    spouse:  { fg:'#6B5B8B',        bg:'#F0EBF8' },
    joint:   { fg:'var(--gold-tag)', bg:'var(--gold-l)' },
  }
  const { fg, bg } = ownerColors[goal.owner]
  const isProperty = PROPERTY_TYPES.includes(goal.type)

  return (
    <div style={{ background:'white', border:'1px solid var(--line)', borderRadius:14, overflow:'hidden' }}>
      {/* Header */}
      <div style={{ padding:'16px 20px 12px', display:'flex', justifyContent:'space-between', alignItems:'flex-start', borderBottom:'1px solid var(--line)' }}>
        <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
          <span style={{ fontSize:18, lineHeight:1 }}>{opt?.icon??'✦'}</span>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
              <div style={{ fontFamily:'Inter', fontSize:12, fontWeight:600, color:'var(--ink)' }}>{goal.label}</div>
              {isCouple && <span style={{ fontFamily:'Inter', fontSize:9, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:fg, background:bg, padding:'2px 7px', borderRadius:4 }}>{ownerLabel}</span>}
            </div>
            <div style={{ fontFamily:'Inter', fontSize:11, color:'var(--ink3)' }}>
              {goal.yearsToGoal}y · {isProperty
                ? `${ORDINALS[goal.propertyNumber??1]} property · ${RESIDENCY_LABELS[goal.residencyStatus??'sc']} · DP ${goal.downpaymentPct??25}%`
                : goal.amountType==='pv' ? 'PV→FV inflated' : 'FV as stated'
              }
            </div>
          </div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={onEdit} style={{ background:'none', border:'1px solid var(--line)', borderRadius:6, cursor:'pointer', color:'var(--ink3)', fontFamily:'Inter', fontSize:11, padding:'4px 10px' }}>Edit</button>
          <button onClick={onDelete} style={{ background:'none', border:'1px solid var(--rouge-l)', borderRadius:6, cursor:'pointer', color:'var(--rouge)', fontFamily:'Inter', fontSize:11, padding:'4px 10px' }}>Remove</button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr' }}>
        {[
          { label:'Target (Cash)',      value:fmtSGD(goal.targetAmount), sub: isProperty ? 'Incl. stamp duty & fees' : (goal.amountType==='pv'?'Today\'s $':'Future value') },
          { label:`FV at Year ${goal.yearsToGoal}`, value:fmtSGD(fvTarget), sub:'Return-adjusted', hi:true },
          { label:'Lump Sum Now',       value:goal.lumpSumPct>0 ?fmtSGD(lumpSumRequired):'—', sub:`${goal.lumpSumPct}% of gap` },
          { label:'Monthly Savings',    value:goal.lumpSumPct<100?fmtSGD(monthlyRequired):'—', sub:`${100-goal.lumpSumPct}% of gap` },
        ].map((kpi,i) => (
          <div key={i} style={{ padding:'12px 16px', borderRight:i<3?'1px solid var(--line)':'none', background:kpi.hi?'var(--gold-l)':'transparent' }}>
            <div style={{ fontFamily:'Inter', fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:4 }}>{kpi.label}</div>
            <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:16, fontWeight:600, color:kpi.hi?'var(--gold-tag)':'var(--ink)', marginBottom:2 }}>{kpi.value}</div>
            <div style={{ fontFamily:'Inter', fontSize:10, color:'var(--ink3)' }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Inline lump sum slider */}
      <div style={{ padding:'12px 20px 14px', borderTop:'1px solid var(--line)', background:'var(--cream)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
          <div style={{ fontFamily:'Inter', fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)' }}>Funding Split</div>
          <div style={{ fontFamily:'Inter', fontSize:11, color:'var(--ink3)' }}>
            <span style={{ color:'var(--gold)', fontWeight:600 }}>{goal.lumpSumPct}% lump sum</span>{' · '}<span>{100-goal.lumpSumPct}% monthly</span>
          </div>
        </div>
        <input type="range" min={0} max={100} step={5} value={goal.lumpSumPct} onChange={e=>onLumpSum(parseInt(e.target.value))} style={{ width:'100%', accentColor:'var(--gold)', height:2, cursor:'pointer' }} />
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:3 }}>
          <span style={{ fontFamily:'Inter', fontSize:10, color:'var(--ink3)' }}>100% Monthly</span>
          <span style={{ fontFamily:'Inter', fontSize:10, color:'var(--ink3)' }}>100% Lump Sum</span>
        </div>
      </div>

      {goal.existingSavings > 0 && (
        <div style={{ padding:'8px 20px', background:'var(--emerald-l)', borderTop:'1px solid #d0e8da' }}>
          <span style={{ fontFamily:'Inter', fontSize:11, color:'var(--emerald)' }}>
            ✓ {fmtSGD(goal.existingSavings)} earmarked → {fmtSGD(goal.existingSavings * Math.pow(1+returnRate/100, goal.yearsToGoal))} at target year
          </span>
        </div>
      )}
    </div>
  )
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export default function WealthAccumulationSection({
  data, onChange, clientSavings, clientFD, spouseSavings, spouseFD,
  monthlyExpenses, monthlySurplus, isCouple,
  clientName = 'Client', spouseName = 'Spouse',
}: AccumulationProps) {
  const [modal, setModal] = useState<{open:boolean;editGoal?:WealthGoal}>({open:false})

  function upd(c: Partial<AccumulationData>) { onChange({...data,...c}) }
  function addOrUpdate(g: WealthGoal) {
    const idx = data.goals.findIndex(x=>x.id===g.id)
    upd({ goals: idx>=0 ? data.goals.map(x=>x.id===g.id?g:x) : [...data.goals,g] })
    setModal({open:false})
  }
  function remove(id:string) { upd({goals:data.goals.filter(g=>g.id!==id)}) }
  function lumpSum(id:string, pct:number) { upd({goals:data.goals.map(g=>g.id===id?{...g,lumpSumPct:pct}:g)}) }

  const totalLiquid = clientSavings+clientFD+(isCouple?spouseSavings+spouseFD:0)
  const currentMonths = monthlyExpenses>0 ? totalLiquid/monthlyExpenses : 0
  const targetLiquid = monthlyExpenses*data.emergencyTargetMonths
  const liquidGap = Math.max(0,targetLiquid-totalLiquid)
  const liquidSurplus = Math.max(0,totalLiquid-targetLiquid)
  const totals = data.goals.reduce((a,g)=>{
    const {lumpSumRequired:l,monthlyRequired:m}=calcGoal(g,data.inflationRate,data.returnRate)
    return {monthly:a.monthly+m,lumpSum:a.lumpSum+l}
  },{monthly:0,lumpSum:0})
  const surplusGap = monthlySurplus - totals.monthly

  return (
    <div>
      {/* Intro */}
      <div style={{ marginBottom:32 }}>
        <p style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--gold)', marginBottom:8, fontWeight:500 }}>Section 2 · Wealth Accumulation</p>
        <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontSize:28, fontWeight:400, color:'var(--ink)', marginBottom:8 }}>Building Towards Your Goals</h2>
        <p style={{ fontFamily:'Inter', fontSize:13, color:'var(--ink3)', lineHeight:1.6 }}>Let's identify what you're saving for, how much you'll need, and the most efficient path to get there.</p>
      </div>

      {/* Global rates */}
      <SubLabel color="var(--gold)">Global Assumptions</SubLabel>
      <div style={{ background:'var(--gold-l)', border:'1px solid #e8d9be', borderRadius:12, padding:'20px 24px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:28 }}>
          <RateSlider label="Expected Return Rate (p.a.)" value={data.returnRate} onChange={v=>upd({returnRate:v})} min={0} max={15} step={0.5} />
          <RateSlider label="Inflation Rate (p.a.)" value={data.inflationRate} onChange={v=>upd({inflationRate:v})} min={0} max={10} step={0.25} />
        </div>
        <p style={{ fontFamily:'Inter', fontSize:11, color:'var(--gold-tag)', marginTop:14 }}>These rates apply to all goals below.</p>
      </div>

      {/* Emergency liquidity */}
      <SubLabel color="var(--emerald)">Emergency &amp; Liquidity Reserve</SubLabel>
      <div style={{ background:'white', border:'1px solid var(--line)', borderRadius:14, overflow:'hidden' }}>
        <div style={{ background:'var(--emerald-l)', padding:'12px 20px', borderBottom:'1px solid #d0e8da' }}>
          <p style={{ fontFamily:'Inter', fontSize:12, color:'var(--emerald)', lineHeight:1.5 }}>
            <strong>Recommendation:</strong> An emergency reserve of <strong>3–6 months</strong> of expenses provides adequate liquidity. High-income earners may consider up to 12 months.
          </p>
        </div>
        <div style={{ padding:'20px 24px' }}>
          <div style={{ display:'grid', gridTemplateColumns:isCouple?'1fr 1fr 1fr 1fr':'1fr 1fr 1fr', gap:12, marginBottom:20 }}>
            {[
              { label:`${clientName} — Savings/Current`, value:clientSavings },
              { label:`${clientName} — Fixed Deposits`,  value:clientFD },
              ...(isCouple ? [{ label:`${spouseName} — Savings/Current`, value:spouseSavings },{ label:`${spouseName} — Fixed Deposits`, value:spouseFD }] : []),
            ].map((item,i) => (
              <div key={i} style={{ background:'var(--cream)', border:'1px solid var(--line)', borderRadius:10, padding:'12px 16px' }}>
                <div style={{ fontFamily:'Inter', fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:6 }}>{item.label}</div>
                <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:18, fontWeight:600, color:'var(--ink)' }}>{fmtSGD(item.value)}</div>
                <div style={{ fontFamily:'Inter', fontSize:10, color:'var(--ink3)', marginTop:2 }}>From financial profile</div>
              </div>
            ))}
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
            <div style={{ background:'var(--cream)', borderRadius:10, border:'1px solid var(--line)', padding:'14px 18px' }}>
              <div style={{ fontFamily:'Inter', fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:4 }}>Total Liquid Assets</div>
              <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:22, fontWeight:600, color:'var(--ink)' }}>{fmtSGD(totalLiquid)}</div>
            </div>
            <div style={{ background:currentMonths>=3?'var(--emerald-l)':'var(--rouge-l)', borderRadius:10, border:`1px solid ${currentMonths>=3?'#d0e8da':'#e8d0d0'}`, padding:'14px 18px' }}>
              <div style={{ fontFamily:'Inter', fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:4 }}>Current Coverage</div>
              <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:22, fontWeight:600, color:currentMonths>=3?'var(--emerald)':'var(--rouge)' }}>{currentMonths.toFixed(1)} months</div>
              <div style={{ fontFamily:'Inter', fontSize:10, color:'var(--ink3)', marginTop:2 }}>{monthlyExpenses>0?`Based on ${fmtSGD(monthlyExpenses)}/mo`:'Set expenses in Financial Profile'}</div>
            </div>
          </div>

          <div>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink3)' }}>Target Reserve</div>
              <div style={{ fontFamily:'DM Mono, monospace', fontSize:13, fontWeight:500, color:'var(--ink)', background:'var(--cream2)', borderRadius:6, padding:'4px 12px' }}>{data.emergencyTargetMonths} months · {fmtSGD(targetLiquid)}</div>
            </div>
            <input type="range" min={0} max={24} step={1} value={data.emergencyTargetMonths} onChange={e=>upd({emergencyTargetMonths:parseInt(e.target.value)})} style={{ width:'100%', accentColor:'var(--emerald)', height:2, cursor:'pointer' }} />
            <div style={{ display:'flex', justifyContent:'space-between', marginTop:4 }}>
              {[0,3,6,12,18,24].map(m=><span key={m} style={{ fontFamily:'Inter', fontSize:10, color:m===3||m===6?'var(--emerald)':'var(--ink3)' }}>{m}m</span>)}
            </div>
          </div>

          {data.emergencyTargetMonths>0 && (
            <div style={{ marginTop:16, background:liquidGap>0?'var(--rouge-l)':'var(--emerald-l)', border:`1px solid ${liquidGap>0?'#e8d0d0':'#d0e8da'}`, borderRadius:10, padding:'12px 18px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontFamily:'Inter', fontSize:12, color:liquidGap>0?'var(--rouge)':'var(--emerald)', fontWeight:500 }}>
                {liquidGap>0?`Shortfall of ${fmtSGD(liquidGap)} to reach ${data.emergencyTargetMonths}-month reserve`:`Surplus of ${fmtSGD(liquidSurplus)} above ${data.emergencyTargetMonths}-month reserve`}
              </span>
              <span style={{ fontFamily:'Inter', fontSize:11, color:'var(--ink3)' }}>{liquidGap>0?`${currentMonths.toFixed(1)}m → ${data.emergencyTargetMonths}m`:'✓ Target met'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Wealth goals */}
      <SubLabel>Wealth Goals</SubLabel>
      {data.goals.length===0 ? (
        <div style={{ background:'white', border:'2px dashed var(--line)', borderRadius:14, padding:'40px 24px', textAlign:'center' }}>
          <div style={{ fontSize:28, marginBottom:12 }}>✦</div>
          <p style={{ fontFamily:'Inter', fontSize:13, color:'var(--ink3)', marginBottom:4 }}>No goals added yet</p>
          <p style={{ fontFamily:'Inter', fontSize:11, color:'var(--ink3)' }}>Add the client's financial goals to calculate the capital required</p>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {data.goals.map(g => (
            <GoalCard key={g.id} goal={g} inflationRate={data.inflationRate} returnRate={data.returnRate}
              onEdit={()=>setModal({open:true,editGoal:g})} onDelete={()=>remove(g.id)} onLumpSum={pct=>lumpSum(g.id,pct)}
              isCouple={isCouple} clientName={clientName} spouseName={spouseName} />
          ))}
        </div>
      )}

      <button onClick={()=>setModal({open:true})}
        style={{ marginTop:14, width:'100%', background:'white', border:'1px solid var(--line)', borderRadius:12, padding:'14px 24px', cursor:'pointer', fontFamily:'Inter', fontSize:12, fontWeight:600, color:'var(--ink)', letterSpacing:'0.06em', textTransform:'uppercase', display:'flex', alignItems:'center', justifyContent:'center', gap:8, transition:'all 0.15s' }}
        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor='var(--gold)';(e.currentTarget as HTMLElement).style.color='var(--gold)'}}
        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor='var(--line)';(e.currentTarget as HTMLElement).style.color='var(--ink)'}}>
        <span style={{ fontSize:16, lineHeight:1 }}>+</span> Add Wealth Goal
      </button>

      {/* Capital mandate summary */}
      {data.goals.length>0 && (
        <>
          <SubLabel>Capital Mandate Summary</SubLabel>
          <div style={{ background:'var(--ink)', borderRadius:16, padding:'28px 32px', color:'white' }}>
            <p style={{ fontFamily:'Inter', fontSize:9, letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--gold)', marginBottom:16 }}>
              {data.goals.length} Goal{data.goals.length!==1?'s':''} · {data.returnRate}% return · {data.inflationRate}% inflation
            </p>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:0, marginBottom:24 }}>
              {[
                { label:'Total Lump Sum',    value:fmtSGD(totals.lumpSum),         sub:'Invest today' },
                { label:'Monthly Savings',   value:fmtSGD(totals.monthly),         sub:'Per month required' },
                { label:'Monthly Surplus',   value:fmtSGD(monthlySurplus),         sub:'Available from profile' },
                { label:surplusGap>=0?'Surplus Remaining':'Monthly Shortfall', value:fmtSGD(Math.abs(surplusGap)), sub:surplusGap>=0?'After goals funded':'Goals exceed surplus', alert:surplusGap<0 },
              ].map((kpi,i) => (
                <div key={i} style={{ paddingRight:i<3?24:0, borderRight:i<3?'1px solid rgba(255,255,255,0.12)':'none', paddingLeft:i>0?24:0 }}>
                  <div style={{ fontFamily:'Inter', fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'rgba(255,255,255,0.5)', marginBottom:8 }}>{kpi.label}</div>
                  <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:22, fontWeight:600, color:(kpi as any).alert?'#f0a0a0':i===0?'var(--gold)':'white', marginBottom:4 }}>{kpi.value}</div>
                  <div style={{ fontFamily:'Inter', fontSize:10, color:'rgba(255,255,255,0.45)' }}>{kpi.sub}</div>
                </div>
              ))}
            </div>
            <div style={{ borderTop:'1px solid rgba(255,255,255,0.1)', paddingTop:20 }}>
              <div style={{ fontFamily:'Inter', fontSize:9, letterSpacing:'0.12em', textTransform:'uppercase', color:'rgba(255,255,255,0.4)', marginBottom:12 }}>Goal Breakdown</div>
              {data.goals.map(g => {
                const {fvTarget,lumpSumRequired:l,monthlyRequired:m}=calcGoal(g,data.inflationRate,data.returnRate)
                const opt=GOAL_OPTIONS.find(o=>o.type===g.type)
                const oLabel=g.owner==='client'?clientName:g.owner==='spouse'?spouseName:'Joint'
                return (
                  <div key={g.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <span style={{ fontSize:14 }}>{opt?.icon??'✦'}</span>
                      <span style={{ fontFamily:'Inter', fontSize:12, color:'rgba(255,255,255,0.8)' }}>{g.label}</span>
                      {isCouple && <span style={{ fontFamily:'Inter', fontSize:10, color:'rgba(255,255,255,0.4)', background:'rgba(255,255,255,0.08)', padding:'1px 6px', borderRadius:4 }}>{oLabel}</span>}
                      <span style={{ fontFamily:'Inter', fontSize:10, color:'rgba(255,255,255,0.35)' }}>· {g.yearsToGoal}y · {fmtSGD(fvTarget)}</span>
                    </div>
                    <div style={{ display:'flex', gap:16 }}>
                      {g.lumpSumPct>0  && <span style={{ fontFamily:'DM Mono, monospace', fontSize:12, color:'var(--gold)' }}>{fmtSGD(l)} lump</span>}
                      {g.lumpSumPct<100 && <span style={{ fontFamily:'DM Mono, monospace', fontSize:12, color:'rgba(255,255,255,0.7)' }}>{fmtSGD(m)}/mo</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* Advisor notes */}
      <SubLabel>Advisor Notes</SubLabel>
      <textarea rows={3} value={data.advisorNotes} onChange={e=>upd({advisorNotes:e.target.value})}
        placeholder="Record any context, priorities, or constraints discussed during this section…"
        style={{ width:'100%', background:'white', border:'1px solid var(--line)', borderRadius:10, padding:'14px 16px', fontFamily:'Inter', fontSize:13, color:'var(--ink)', resize:'vertical', lineHeight:1.6, outline:'none', boxSizing:'border-box' }}
      />

      {modal.open && (
        <GoalModal initial={modal.editGoal} onSave={addOrUpdate} onClose={()=>setModal({open:false})}
          isCouple={isCouple} clientName={clientName} spouseName={spouseName} />
      )}
    </div>
  )
}
