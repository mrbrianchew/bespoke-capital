'use client'
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Priority    = 'High' | 'Medium' | 'Low'
type ActionStatus = 'Proposed' | 'In Discussion' | 'Accepted' | 'Declined'
type PremiumMode = 'Monthly' | 'Annual'

interface ProtectionRec {
  id: string
  person: string                 // 'client' | 'spouse' | child key
  category: string               // 'life' | 'medical' | 'ci' | 'ltc' | 'general'
  policyType: string             // 'Term' | 'Whole Life' | 'ILP' | 'CI Rider' | …
  company: string
  product: string
  recommendedSA: number
  premiumAmount: number
  premiumMode: PremiumMode
  priority: Priority
  status: ActionStatus
  remarks: string
}

type WealthVehicle = 'ILP' | 'Endowment' | 'Unit Trust' | 'CPF Top-up (OA)' | 'CPF Top-up (SA)' | 'CPF Top-up (MA)' | 'SRS' | 'RSP' | 'Lump Sum Investment' | 'Cash Savings' | 'Other'
type WealthGoalLink = 'Retirement' | 'Education' | 'Wealth Accumulation' | 'Emergency Fund' | 'Custom'

interface WealthRec {
  id: string
  person: string
  vehicle: WealthVehicle
  linkedGoal: WealthGoalLink
  targetCorpus: number
  monthlyContribution: number
  horizon: number                // years
  expectedReturn: number         // % p.a.
  priority: Priority
  status: ActionStatus
  remarks: string
}

type DistribCategory = 'Will' | 'LPA' | 'CPF Nomination' | 'Trust' | 'Estate Duty' | 'Business Succession' | 'Gifting Strategy'
type DistribUrgency  = 'Immediate' | 'Within 6 months' | 'Within 1 year' | 'Long-term'

interface DistribRec {
  id: string
  person: string
  category: DistribCategory
  action: string                 // free-text: what needs to be done
  urgency: DistribUrgency
  status: ActionStatus
  remarks: string
}

interface RecData {
  protection: ProtectionRec[]
  wealth: WealthRec[]
  distribution: DistribRec[]
}

const EMPTY_REC_DATA: RecData = { protection: [], wealth: [], distribution: [] }

// ─── REFERENCE DATA ───────────────────────────────────────────────────────────
const PROTECTION_CATEGORIES = [
  { code: 'life',       label: 'Life / Death & TPD',        color: '#c8a96e' },
  { code: 'ci',         label: 'Critical Illness',           color: '#8A9A7E' },
  { code: 'medical',    label: 'Medical / Hospitalisation',  color: '#7A9CBF' },
  { code: 'ltc',        label: 'Long-Term Care / DI',        color: '#9B7BAA' },
  { code: 'general',    label: 'General Insurance',          color: '#B0A898' },
]
const POLICY_TYPES   = ['Term', 'Whole Life', 'Universal Life', 'ILP', 'CI Rider', 'ECI Rider', 'Hospital Plan', 'LTC Plan', 'Disability Income', 'Annuity', 'Other']
const WEALTH_VEHICLES: WealthVehicle[] = ['ILP','Endowment','Unit Trust','CPF Top-up (OA)','CPF Top-up (SA)','CPF Top-up (MA)','SRS','RSP','Lump Sum Investment','Cash Savings','Other']
const GOAL_LINKS: WealthGoalLink[] = ['Retirement','Education','Wealth Accumulation','Emergency Fund','Custom']
const DISTRIB_CATEGORIES: DistribCategory[] = ['Will','LPA','CPF Nomination','Trust','Estate Duty','Business Succession','Gifting Strategy']
const DISTRIB_URGENCIES: DistribUrgency[] = ['Immediate','Within 6 months','Within 1 year','Long-term']
const PRIORITIES: Priority[] = ['High','Medium','Low']
const STATUSES: ActionStatus[] = ['Proposed','In Discussion','Accepted','Declined']
const PREMIUM_MODES: PremiumMode[] = ['Monthly','Annual']

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function newId() { return 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2,6) }
function fmt(n: number) {
  if (!n || isNaN(n)) return '—'
  if (n >= 1_000_000) return 'S$' + (n/1_000_000).toFixed(2) + 'M'
  return 'S$' + Math.round(n).toLocaleString('en-SG')
}
function fmtMo(n: number) { return n ? 'S$' + Math.round(n).toLocaleString('en-SG') + '/mo' : '—' }

const PRIORITY_STYLE: Record<Priority,{color:string;bg:string}> = {
  High:   { color:'#9B1C1C', bg:'#FEE2E2' },
  Medium: { color:'#854F0B', bg:'#FEF3C7' },
  Low:    { color:'#1E4D35', bg:'#D1FAE5' },
}
const STATUS_STYLE: Record<ActionStatus,{color:string;bg:string}> = {
  Proposed:      { color:'#1C3A6B', bg:'#DBEAFE' },
  'In Discussion':{ color:'#6B3A1C', bg:'#FEF3C7' },
  Accepted:      { color:'#1E4D35', bg:'#D1FAE5' },
  Declined:      { color:'#4A4740', bg:'#E4E1DA' },
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

// Shared pill select
function PillSelect<T extends string>({ options, value, onChange, styleMap }: {
  options: T[]; value: T; onChange:(v:T)=>void
  styleMap?: Record<string,{color:string;bg:string}>
}) {
  const style = styleMap?.[value]
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as T)}
      style={{
        border: 'none', borderRadius: 4, padding: '2px 8px', fontSize: 11,
        fontFamily: 'Inter', fontWeight: 600, letterSpacing:'0.05em', cursor:'pointer',
        background: style?.bg ?? 'var(--cream2)',
        color: style?.color ?? 'var(--ink2)',
        appearance: 'none', WebkitAppearance: 'none',
      }}
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

// Gap summary badge
function GapBadge({ need, have }: { need:number; have:number }) {
  if (need <= 0) return null
  const gap = need - have
  if (gap <= 0) return (
    <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:'#D1FAE5', color:'#1E4D35', fontFamily:'Inter', fontWeight:600 }}>Covered</span>
  )
  const pct = Math.round((have/need)*100)
  return (
    <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:'#FEE2E2', color:'#9B1C1C', fontFamily:'Inter', fontWeight:600 }}>
      {pct}% covered · Gap {fmt(gap)}
    </span>
  )
}

// ─── PROTECTION CARD ─────────────────────────────────────────────────────────
function ProtectionCard({ rec, onChange, onDelete, companies, products }: {
  rec: ProtectionRec
  onChange: (r:ProtectionRec) => void
  onDelete: () => void
  companies: {id:number;name:string;category_id:number}[]
  products:  {id:number;name:string;category_id:number;company_id:number}[]
}) {
  const [expanded, setExpanded] = useState(false)
  const catInfo = PROTECTION_CATEGORIES.find(c=>c.code===rec.category)
  const availCompanies = companies.filter(c => {
    // Show all companies (category_id filtering is optional for flexibility)
    return true
  })
  const availProducts = products.filter(p => rec.company ? p.company_id === companies.find(c=>c.name===rec.company)?.id : true)

  function upd<K extends keyof ProtectionRec>(k:K, v:ProtectionRec[K]) { onChange({...rec,[k]:v}) }

  const inp: React.CSSProperties = {
    background:'var(--cream2)', border:'1px solid var(--cream3)', borderRadius:4,
    padding:'5px 8px', fontFamily:'Inter', fontSize:12, color:'var(--ink)',
    width:'100%', outline:'none',
  }
  const lbl: React.CSSProperties = {
    fontFamily:'Inter', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase',
    color:'var(--ink3)', marginBottom:3, display:'block',
  }

  return (
    <div style={{
      background:'#fff', border:'1px solid var(--cream3)', borderRadius:8,
      overflow:'hidden', marginBottom:10,
    }}>
      {/* Card header */}
      <div style={{
        display:'flex', alignItems:'center', gap:10, padding:'12px 16px',
        background:'var(--cream)', borderBottom: expanded ? '1px solid var(--cream3)' : 'none',
        cursor:'pointer',
      }} onClick={() => setExpanded(e=>!e)}>
        {/* Category dot */}
        <div style={{ width:8, height:8, borderRadius:'50%', background: catInfo?.color ?? '#ccc', flexShrink:0 }} />
        {/* Category + product */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:'Inter', fontSize:11, color:'var(--ink3)', letterSpacing:'0.06em', textTransform:'uppercase' }}>
            {catInfo?.label ?? rec.category}
          </div>
          <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:16, color:'var(--ink)', marginTop:1, fontWeight:600 }}>
            {rec.product || rec.company || <span style={{color:'var(--ink3)',fontStyle:'italic',fontWeight:400}}>New recommendation</span>}
          </div>
        </div>
        {/* Badges */}
        <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0}}>
          <PillSelect options={PRIORITIES} value={rec.priority} onChange={v=>upd('priority',v)} styleMap={PRIORITY_STYLE} />
          <PillSelect options={STATUSES} value={rec.status} onChange={v=>upd('status',v)} styleMap={STATUS_STYLE} />
        </div>
        {/* Expand chevron */}
        <div style={{ color:'var(--ink3)', fontSize:12, marginLeft:4, transform: expanded?'rotate(180deg)':'none', transition:'transform 0.2s' }}>▾</div>
        {/* Delete */}
        <button onClick={e=>{e.stopPropagation();onDelete()}} style={{
          background:'none',border:'none',color:'var(--ink3)',cursor:'pointer',fontSize:14,padding:'0 2px',marginLeft:2,lineHeight:1
        }}>×</button>
      </div>

      {/* Expanded form */}
      {expanded && (
        <div style={{ padding:'16px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px 16px' }}>
          {/* Row 1 */}
          <div>
            <label style={lbl}>Category</label>
            <select value={rec.category} onChange={e=>upd('category',e.target.value)} style={inp}>
              {PROTECTION_CATEGORIES.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Policy Type</label>
            <select value={rec.policyType} onChange={e=>upd('policyType',e.target.value)} style={inp}>
              <option value=''>Select…</option>
              {POLICY_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Company</label>
            <input
              list={`co-list-${rec.id}`}
              value={rec.company}
              onChange={e=>upd('company',e.target.value)}
              placeholder='Type or select…'
              style={inp}
            />
            <datalist id={`co-list-${rec.id}`}>
              {availCompanies.map(c=><option key={c.id} value={c.name}/>)}
            </datalist>
          </div>
          {/* Row 2 */}
          <div style={{gridColumn:'1/3'}}>
            <label style={lbl}>Product Name</label>
            <input
              list={`prod-list-${rec.id}`}
              value={rec.product}
              onChange={e=>upd('product',e.target.value)}
              placeholder='Type or select…'
              style={inp}
            />
            <datalist id={`prod-list-${rec.id}`}>
              {availProducts.map(p=><option key={p.id} value={p.name}/>)}
            </datalist>
          </div>
          <div>
            <label style={lbl}>Recommended SA / Benefit</label>
            <input type='number' value={rec.recommendedSA||''} onChange={e=>upd('recommendedSA',Number(e.target.value))} placeholder='0' style={inp}/>
          </div>
          {/* Row 3 */}
          <div>
            <label style={lbl}>Est. Premium</label>
            <input type='number' value={rec.premiumAmount||''} onChange={e=>upd('premiumAmount',Number(e.target.value))} placeholder='0' style={inp}/>
          </div>
          <div>
            <label style={lbl}>Premium Frequency</label>
            <select value={rec.premiumMode} onChange={e=>upd('premiumMode',e.target.value as PremiumMode)} style={inp}>
              {PREMIUM_MODES.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            {/* empty cell for alignment */}
          </div>
          {/* Remarks full width */}
          <div style={{gridColumn:'1/4'}}>
            <label style={lbl}>Advisor Remarks</label>
            <textarea
              value={rec.remarks}
              onChange={e=>upd('remarks',e.target.value)}
              placeholder='Notes for client discussion…'
              rows={2}
              style={{...inp, resize:'vertical', fontFamily:'DM Mono, monospace', fontSize:11, lineHeight:1.5}}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── WEALTH CARD ─────────────────────────────────────────────────────────────
function WealthCard({ rec, onChange, onDelete }: {
  rec: WealthRec
  onChange: (r:WealthRec) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  function upd<K extends keyof WealthRec>(k:K, v:WealthRec[K]) { onChange({...rec,[k]:v}) }

  const inp: React.CSSProperties = {
    background:'var(--cream2)', border:'1px solid var(--cream3)', borderRadius:4,
    padding:'5px 8px', fontFamily:'Inter', fontSize:12, color:'var(--ink)',
    width:'100%', outline:'none',
  }
  const lbl: React.CSSProperties = {
    fontFamily:'Inter', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase',
    color:'var(--ink3)', marginBottom:3, display:'block',
  }

  const VEHICLE_COLORS: Record<string,string> = {
    'ILP':'#c8a96e','Endowment':'#B8956A','Unit Trust':'#7A9CBF',
    'CPF Top-up (OA)':'#2D5A4E','CPF Top-up (SA)':'#3A7A65','CPF Top-up (MA)':'#4A9E8A',
    'SRS':'#8A9A7E','RSP':'#9B7BAA','Lump Sum Investment':'#7A9CBF',
    'Cash Savings':'#B0A898','Other':'#9A9690',
  }
  const vColor = VEHICLE_COLORS[rec.vehicle] ?? '#9A9690'

  return (
    <div style={{
      background:'#fff', border:'1px solid var(--cream3)', borderRadius:8,
      overflow:'hidden', marginBottom:10,
    }}>
      <div style={{
        display:'flex', alignItems:'center', gap:10, padding:'12px 16px',
        background:'var(--cream)', borderBottom: expanded ? '1px solid var(--cream3)' : 'none',
        cursor:'pointer',
      }} onClick={() => setExpanded(e=>!e)}>
        <div style={{ width:8, height:8, borderRadius:'50%', background: vColor, flexShrink:0 }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:'Inter', fontSize:11, color:'var(--ink3)', letterSpacing:'0.06em', textTransform:'uppercase' }}>
            {rec.vehicle || 'Vehicle'}
            {rec.linkedGoal && <span style={{color:'var(--gold)',marginLeft:8}}>→ {rec.linkedGoal}</span>}
          </div>
          <div style={{ display:'flex', gap:16, marginTop:3, alignItems:'baseline' }}>
            {rec.targetCorpus > 0 && (
              <span style={{fontFamily:'Cormorant Garamond,serif', fontSize:16, fontWeight:600, color:'var(--ink)'}}>{fmt(rec.targetCorpus)}</span>
            )}
            {rec.monthlyContribution > 0 && (
              <span style={{fontFamily:'Inter', fontSize:12, color:'var(--ink2)'}}>{fmtMo(rec.monthlyContribution)}</span>
            )}
            {!rec.targetCorpus && !rec.monthlyContribution && (
              <span style={{fontFamily:'Cormorant Garamond,serif', fontSize:16, fontWeight:400, color:'var(--ink3)', fontStyle:'italic'}}>New recommendation</span>
            )}
          </div>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0}}>
          <PillSelect options={PRIORITIES} value={rec.priority} onChange={v=>upd('priority',v)} styleMap={PRIORITY_STYLE} />
          <PillSelect options={STATUSES} value={rec.status} onChange={v=>upd('status',v)} styleMap={STATUS_STYLE} />
        </div>
        <div style={{ color:'var(--ink3)', fontSize:12, marginLeft:4, transform: expanded?'rotate(180deg)':'none', transition:'transform 0.2s' }}>▾</div>
        <button onClick={e=>{e.stopPropagation();onDelete()}} style={{
          background:'none',border:'none',color:'var(--ink3)',cursor:'pointer',fontSize:14,padding:'0 2px',marginLeft:2,lineHeight:1
        }}>×</button>
      </div>

      {expanded && (
        <div style={{ padding:'16px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px 16px' }}>
          <div>
            <label style={lbl}>Vehicle Type</label>
            <select value={rec.vehicle} onChange={e=>upd('vehicle',e.target.value as WealthVehicle)} style={inp}>
              {WEALTH_VEHICLES.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Linked Goal</label>
            <select value={rec.linkedGoal} onChange={e=>upd('linkedGoal',e.target.value as WealthGoalLink)} style={inp}>
              {GOAL_LINKS.map(g=><option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Target Corpus</label>
            <input type='number' value={rec.targetCorpus||''} onChange={e=>upd('targetCorpus',Number(e.target.value))} placeholder='0' style={inp}/>
          </div>
          <div>
            <label style={lbl}>Monthly Contribution (S$)</label>
            <input type='number' value={rec.monthlyContribution||''} onChange={e=>upd('monthlyContribution',Number(e.target.value))} placeholder='0' style={inp}/>
          </div>
          <div>
            <label style={lbl}>Investment Horizon (years)</label>
            <input type='number' value={rec.horizon||''} onChange={e=>upd('horizon',Number(e.target.value))} placeholder='0' style={inp}/>
          </div>
          <div>
            <label style={lbl}>Expected Return (% p.a.)</label>
            <input type='number' step='0.1' value={rec.expectedReturn||''} onChange={e=>upd('expectedReturn',Number(e.target.value))} placeholder='e.g. 5' style={inp}/>
          </div>
          <div style={{gridColumn:'1/4'}}>
            <label style={lbl}>Advisor Remarks</label>
            <textarea value={rec.remarks} onChange={e=>upd('remarks',e.target.value)} placeholder='Notes for client discussion…' rows={2}
              style={{...inp, resize:'vertical', fontFamily:'DM Mono, monospace', fontSize:11, lineHeight:1.5}}/>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── DISTRIBUTION CARD ───────────────────────────────────────────────────────
const DISTRIB_ICONS: Record<DistribCategory, string> = {
  'Will': '📜',
  'LPA': '⚖️',
  'CPF Nomination': '🏦',
  'Trust': '🏛️',
  'Estate Duty': '📋',
  'Business Succession': '🏢',
  'Gifting Strategy': '🎁',
}

function DistribCard({ rec, onChange, onDelete }: {
  rec: DistribRec
  onChange: (r:DistribRec) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  function upd<K extends keyof DistribRec>(k:K, v:DistribRec[K]) { onChange({...rec,[k]:v}) }

  const inp: React.CSSProperties = {
    background:'var(--cream2)', border:'1px solid var(--cream3)', borderRadius:4,
    padding:'5px 8px', fontFamily:'Inter', fontSize:12, color:'var(--ink)',
    width:'100%', outline:'none',
  }
  const lbl: React.CSSProperties = {
    fontFamily:'Inter', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase',
    color:'var(--ink3)', marginBottom:3, display:'block',
  }
  const URGENCY_STYLE: Record<DistribUrgency,{color:string;bg:string}> = {
    'Immediate':        {color:'#9B1C1C',bg:'#FEE2E2'},
    'Within 6 months':  {color:'#854F0B',bg:'#FEF3C7'},
    'Within 1 year':    {color:'#6B3A1C',bg:'#FEF3C7'},
    'Long-term':        {color:'#1E4D35',bg:'#D1FAE5'},
  }

  return (
    <div style={{
      background:'#fff', border:'1px solid var(--cream3)', borderRadius:8,
      overflow:'hidden', marginBottom:10,
    }}>
      <div style={{
        display:'flex', alignItems:'center', gap:10, padding:'12px 16px',
        background:'var(--cream)', borderBottom: expanded ? '1px solid var(--cream3)' : 'none',
        cursor:'pointer',
      }} onClick={() => setExpanded(e=>!e)}>
        <div style={{ fontSize:16, flexShrink:0 }}>{DISTRIB_ICONS[rec.category]}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:'Inter', fontSize:11, color:'var(--ink3)', letterSpacing:'0.06em', textTransform:'uppercase' }}>{rec.category}</div>
          <div style={{ fontFamily:'Cormorant Garamond,serif', fontSize:16, fontWeight:600, color:'var(--ink)', marginTop:1 }}>
            {rec.action || <span style={{color:'var(--ink3)',fontStyle:'italic',fontWeight:400}}>New action item</span>}
          </div>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0}}>
          <PillSelect options={DISTRIB_URGENCIES} value={rec.urgency} onChange={v=>upd('urgency',v)} styleMap={URGENCY_STYLE} />
          <PillSelect options={STATUSES} value={rec.status} onChange={v=>upd('status',v)} styleMap={STATUS_STYLE} />
        </div>
        <div style={{ color:'var(--ink3)', fontSize:12, marginLeft:4, transform: expanded?'rotate(180deg)':'none', transition:'transform 0.2s' }}>▾</div>
        <button onClick={e=>{e.stopPropagation();onDelete()}} style={{
          background:'none',border:'none',color:'var(--ink3)',cursor:'pointer',fontSize:14,padding:'0 2px',marginLeft:2,lineHeight:1
        }}>×</button>
      </div>

      {expanded && (
        <div style={{ padding:'16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px 16px' }}>
          <div>
            <label style={lbl}>Category</label>
            <select value={rec.category} onChange={e=>upd('category',e.target.value as DistribCategory)} style={inp}>
              {DISTRIB_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Urgency</label>
            <select value={rec.urgency} onChange={e=>upd('urgency',e.target.value as DistribUrgency)} style={inp}>
              {DISTRIB_URGENCIES.map(u=><option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div style={{gridColumn:'1/3'}}>
            <label style={lbl}>Recommended Action</label>
            <input value={rec.action} onChange={e=>upd('action',e.target.value)} placeholder='e.g. Draft a will with an estate lawyer, nominating spouse and children equally' style={inp}/>
          </div>
          <div style={{gridColumn:'1/3'}}>
            <label style={lbl}>Advisor Remarks</label>
            <textarea value={rec.remarks} onChange={e=>upd('remarks',e.target.value)} placeholder='Additional context…' rows={2}
              style={{...inp, resize:'vertical', fontFamily:'DM Mono, monospace', fontSize:11, lineHeight:1.5}}/>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── SECTION HEADER ──────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle, count, onAdd, addLabel }: {
  title: string; subtitle: string; count: number
  onAdd: () => void; addLabel: string
}) {
  return (
    <div style={{
      display:'flex', alignItems:'flex-end', justifyContent:'space-between',
      marginBottom:16, paddingBottom:12, borderBottom:'1px solid var(--cream3)',
    }}>
      <div>
        <div style={{ fontFamily:'Cormorant Garamond,serif', fontSize:22, fontWeight:600, color:'var(--ink)', lineHeight:1.1 }}>{title}</div>
        <div style={{ fontFamily:'Inter', fontSize:12, color:'var(--ink3)', marginTop:3 }}>{subtitle}</div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        {count > 0 && (
          <span style={{ fontFamily:'Inter', fontSize:11, color:'var(--ink3)', background:'var(--cream2)', padding:'3px 9px', borderRadius:20 }}>
            {count} item{count!==1?'s':''}
          </span>
        )}
        <button onClick={onAdd} style={{
          background:'var(--charcoal)', color:'var(--cream)', border:'none',
          borderRadius:6, padding:'8px 16px', fontFamily:'Inter', fontSize:12,
          cursor:'pointer', display:'flex', alignItems:'center', gap:6,
        }}>
          <span style={{fontSize:16,lineHeight:1}}>+</span>{addLabel}
        </button>
      </div>
    </div>
  )
}

// ─── GAP SUMMARY ROW ─────────────────────────────────────────────────────────
function GapSummaryRow({ label, need, have }: { label:string; need:number; have:number }) {
  if (need <= 0) return null
  const gap = Math.max(0, need - have)
  const pct = need > 0 ? Math.min(100, Math.round((have/need)*100)) : 100
  const covered = gap <= 0
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12, padding:'8px 0',
      borderBottom:'1px solid var(--cream3)',
    }}>
      <div style={{ fontFamily:'Inter', fontSize:12, color:'var(--ink2)', width:120, flexShrink:0 }}>{label}</div>
      {/* Bar */}
      <div style={{ flex:1, height:6, background:'var(--cream3)', borderRadius:3, overflow:'hidden' }}>
        <div style={{ width:`${pct}%`, height:'100%', background: covered ? 'var(--emerald)' : '#c8a96e', borderRadius:3, transition:'width 0.4s' }}/>
      </div>
      <div style={{ fontFamily:'DM Mono,monospace', fontSize:11, color:'var(--ink3)', width:90, textAlign:'right', flexShrink:0 }}>
        {fmt(have)} / {fmt(need)}
      </div>
      <div style={{ width:80, flexShrink:0, textAlign:'right' }}>
        {covered
          ? <span style={{fontSize:10,padding:'2px 7px',borderRadius:4,background:'#D1FAE5',color:'#1E4D35',fontFamily:'Inter',fontWeight:600}}>Covered</span>
          : <span style={{fontSize:10,padding:'2px 7px',borderRadius:4,background:'#FEE2E2',color:'#9B1C1C',fontFamily:'Inter',fontWeight:600}}>Gap {fmt(gap)}</span>
        }
      </div>
    </div>
  )
}

// ─── GOAL CONTEXT ROW ────────────────────────────────────────────────────────
function GoalContextRow({ icon, label, corpus, monthly, shortfall }: {
  icon:string; label:string; corpus:number; monthly:number; shortfall:number
}) {
  return (
    <div style={{
      display:'grid', gridTemplateColumns:'28px 1fr auto auto auto',
      alignItems:'center', gap:12, padding:'10px 0', borderBottom:'1px solid var(--cream3)',
    }}>
      <span style={{fontSize:16}}>{icon}</span>
      <div style={{fontFamily:'Inter',fontSize:12,color:'var(--ink2)'}}>{label}</div>
      <div style={{fontFamily:'DM Mono,monospace',fontSize:11,color:'var(--ink3)',textAlign:'right'}}>
        {corpus > 0 ? <><span style={{color:'var(--ink2)',fontWeight:600}}>{fmt(corpus)}</span> corpus</> : '—'}
      </div>
      <div style={{fontFamily:'DM Mono,monospace',fontSize:11,color:'var(--ink3)',textAlign:'right'}}>
        {monthly > 0 ? <><span style={{color:'var(--ink2)',fontWeight:600}}>{fmtMo(monthly)}</span></> : '—'}
      </div>
      <div style={{width:90,textAlign:'right'}}>
        {shortfall > 0
          ? <span style={{fontSize:10,padding:'2px 7px',borderRadius:4,background:'#FEE2E2',color:'#9B1C1C',fontFamily:'Inter',fontWeight:600}}>↓ {fmt(shortfall)}</span>
          : corpus > 0
            ? <span style={{fontSize:10,padding:'2px 7px',borderRadius:4,background:'#D1FAE5',color:'#1E4D35',fontFamily:'Inter',fontWeight:600}}>On track</span>
            : null
        }
      </div>
    </div>
  )
}

// ─── PERSON TAB SECTION ──────────────────────────────────────────────────────
function PersonSection({ person, personLabel, recData, onChangeRecData, ffData, gapData, goalsData, companies, products }: {
  person: string
  personLabel: string
  recData: RecData
  onChangeRecData: (d:RecData) => void
  ffData: any
  gapData: { dtpd: { need:number; have:number }; ci: { need:number; have:number } }
  goalsData: { icon:string; label:string; corpus:number; monthly:number; shortfall:number }[]
  companies: {id:number;name:string;category_id:number}[]
  products:  {id:number;name:string;category_id:number;company_id:number}[]
}) {
  const protRecs   = recData.protection.filter(r=>r.person===person)
  const wealthRecs = recData.wealth.filter(r=>r.person===person)
  const distribRecs= recData.distribution.filter(r=>r.person===person)

  function addProtection() {
    const newRec: ProtectionRec = {
      id:newId(), person, category:'life', policyType:'', company:'', product:'',
      recommendedSA:0, premiumAmount:0, premiumMode:'Monthly',
      priority:'High', status:'Proposed', remarks:'',
    }
    onChangeRecData({...recData, protection:[...recData.protection, newRec]})
  }
  function addWealth() {
    const newRec: WealthRec = {
      id:newId(), person, vehicle:'ILP', linkedGoal:'Retirement',
      targetCorpus:0, monthlyContribution:0, horizon:0, expectedReturn:5,
      priority:'Medium', status:'Proposed', remarks:'',
    }
    onChangeRecData({...recData, wealth:[...recData.wealth, newRec]})
  }
  function addDistrib() {
    const newRec: DistribRec = {
      id:newId(), person, category:'Will', action:'',
      urgency:'Within 1 year', status:'Proposed', remarks:'',
    }
    onChangeRecData({...recData, distribution:[...recData.distribution, newRec]})
  }
  function updateProtRec(id:string, r:ProtectionRec) {
    onChangeRecData({...recData, protection:recData.protection.map(x=>x.id===id?r:x)})
  }
  function deleteProtRec(id:string) {
    onChangeRecData({...recData, protection:recData.protection.filter(x=>x.id!==id)})
  }
  function updateWealthRec(id:string, r:WealthRec) {
    onChangeRecData({...recData, wealth:recData.wealth.map(x=>x.id===id?r:x)})
  }
  function deleteWealthRec(id:string) {
    onChangeRecData({...recData, wealth:recData.wealth.filter(x=>x.id!==id)})
  }
  function updateDistribRec(id:string, r:DistribRec) {
    onChangeRecData({...recData, distribution:recData.distribution.map(x=>x.id===id?r:x)})
  }
  function deleteDistribRec(id:string) {
    onChangeRecData({...recData, distribution:recData.distribution.filter(x=>x.id!==id)})
  }

  const sectionCard: React.CSSProperties = {
    background:'var(--cream)', border:'1px solid var(--cream3)', borderRadius:10,
    padding:'24px', marginBottom:20,
  }

  const hasGaps = gapData.dtpd.need > 0 || gapData.ci.need > 0

  return (
    <div>
      {/* ── Wealth Protection ── */}
      <div style={sectionCard}>
        <SectionHeader
          title='Wealth Protection'
          subtitle='Insurance & risk coverage recommendations'
          count={protRecs.length}
          onAdd={addProtection}
          addLabel='Add Protection Rec'
        />

        {/* Gap context */}
        {hasGaps && (
          <div style={{
            background:'#fff', border:'1px solid var(--cream3)', borderRadius:8,
            padding:'14px 16px', marginBottom:16,
          }}>
            <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:10 }}>
              Coverage Gap Summary — from Risk Management
            </div>
            <GapSummaryRow label='Death / TPD' need={gapData.dtpd.need} have={gapData.dtpd.have} />
            <GapSummaryRow label='Critical Illness' need={gapData.ci.need} have={gapData.ci.have} />
          </div>
        )}

        {protRecs.length === 0 ? (
          <div style={{
            textAlign:'center', padding:'32px 16px', color:'var(--ink3)',
            fontFamily:'Inter', fontSize:13, fontStyle:'italic',
          }}>
            No protection recommendations yet — click <strong>+ Add Protection Rec</strong> to begin
          </div>
        ) : (
          protRecs.map(r => (
            <ProtectionCard
              key={r.id} rec={r}
              onChange={u=>updateProtRec(r.id,u)}
              onDelete={()=>deleteProtRec(r.id)}
              companies={companies}
              products={products}
            />
          ))
        )}
      </div>

      {/* ── Wealth Accumulation ── */}
      <div style={sectionCard}>
        <SectionHeader
          title='Wealth Accumulation & Management'
          subtitle='Investment and savings vehicle recommendations'
          count={wealthRecs.length}
          onAdd={addWealth}
          addLabel='Add Wealth Rec'
        />

        {/* Goals context */}
        {goalsData.length > 0 && (
          <div style={{
            background:'#fff', border:'1px solid var(--cream3)', borderRadius:8,
            padding:'14px 16px', marginBottom:16,
          }}>
            <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:8 }}>
              Goal Context — from Capital Mandate
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'28px 1fr auto auto auto', gap:'0 12px', padding:'0 0 4px' }}>
              {['','Goal','Corpus Needed','Monthly Required','Status'].map((h,i)=>(
                <div key={i} style={{fontFamily:'Inter',fontSize:10,letterSpacing:'0.07em',textTransform:'uppercase',color:'var(--ink3)'}}>{h}</div>
              ))}
            </div>
            {goalsData.map((g,i)=>(
              <GoalContextRow key={i} {...g} />
            ))}
          </div>
        )}

        {wealthRecs.length === 0 ? (
          <div style={{
            textAlign:'center', padding:'32px 16px', color:'var(--ink3)',
            fontFamily:'Inter', fontSize:13, fontStyle:'italic',
          }}>
            No wealth recommendations yet — click <strong>+ Add Wealth Rec</strong> to begin
          </div>
        ) : (
          wealthRecs.map(r => (
            <WealthCard key={r.id} rec={r} onChange={u=>updateWealthRec(r.id,u)} onDelete={()=>deleteWealthRec(r.id)} />
          ))
        )}
      </div>

      {/* ── Wealth Distribution ── */}
      <div style={sectionCard}>
        <SectionHeader
          title='Wealth Distribution'
          subtitle='Estate, legacy & distribution planning recommendations'
          count={distribRecs.length}
          onAdd={addDistrib}
          addLabel='Add Distribution Rec'
        />

        {/* Estate status context from objectives */}
        {ffData?.estate && (
          <div style={{
            background:'#fff', border:'1px solid var(--cream3)', borderRadius:8,
            padding:'14px 16px', marginBottom:16,
          }}>
            <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--ink3)', marginBottom:10 }}>
              Current Estate Status — from Strategic Objectives
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {[
                { label:'Will', val: ffData.estate[person === 'spouse' ? 'spouse' : 'client']?.willStatus },
                { label:'LPA',  val: ffData.estate[person === 'spouse' ? 'spouse' : 'client']?.lpaStatus },
                { label:'CPF Nomination', val: ffData.estate[person === 'spouse' ? 'spouse' : 'client']?.cpfNomStatus },
                { label:'Trust', val: ffData.estate[person === 'spouse' ? 'spouse' : 'client']?.trustStatus },
              ].map(item=>{
                if (!item.val) return null
                const isGood = item.val === 'has_will' || item.val === 'has_lpa' || item.val === 'nominated' || item.val === 'has_trust'
                const isNone = item.val === 'no_will' || item.val === 'no_lpa' || item.val === 'not_nominated' || item.val === 'no_trust'
                return (
                  <div key={item.label} style={{
                    display:'flex', alignItems:'center', gap:6, padding:'5px 10px',
                    background: isGood ? '#D1FAE5' : isNone ? '#FEE2E2' : '#FEF3C7',
                    borderRadius:6,
                  }}>
                    <span style={{fontFamily:'Inter',fontSize:11,color:'var(--ink2)',fontWeight:600}}>{item.label}</span>
                    <span style={{fontSize:10,color: isGood ? '#1E4D35' : isNone ? '#9B1C1C' : '#854F0B'}}>
                      {isGood ? '✓' : isNone ? '✗' : '⚠'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {distribRecs.length === 0 ? (
          <div style={{
            textAlign:'center', padding:'32px 16px', color:'var(--ink3)',
            fontFamily:'Inter', fontSize:13, fontStyle:'italic',
          }}>
            No distribution recommendations yet — click <strong>+ Add Distribution Rec</strong> to begin
          </div>
        ) : (
          distribRecs.map(r => (
            <DistribCard key={r.id} rec={r} onChange={u=>updateDistribRec(r.id,u)} onDelete={()=>deleteDistribRec(r.id)} />
          ))
        )}
      </div>
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function RecommendationsPage() {
  const supabase = createClient()

  // Client / family state
  const [clientId,   setClientId]   = useState<string|null>(null)
  const [clientName, setClientName] = useState('Client')
  const [spouseName, setSpouseName] = useState('Spouse')
  const [isCouple,   setIsCouple]   = useState(false)
  const [children,   setChildren]   = useState<any[]>([])
  const [ffData,     setFfData]     = useState<any>({})

  // Gap & goals data (read-only from other tabs)
  const [clientGaps,  setClientGaps]  = useState({ dtpd:{need:0,have:0}, ci:{need:0,have:0} })
  const [spouseGaps,  setSpouseGaps]  = useState({ dtpd:{need:0,have:0}, ci:{need:0,have:0} })
  const [clientGoals, setClientGoals] = useState<{icon:string;label:string;corpus:number;monthly:number;shortfall:number}[]>([])
  const [spouseGoals, setSpouseGoals] = useState<{icon:string;label:string;corpus:number;monthly:number;shortfall:number}[]>([])
  const [jointGoals,  setJointGoals]  = useState<{icon:string;label:string;corpus:number;monthly:number;shortfall:number}[]>([])

  // Reference data
  const [companies, setCompanies] = useState<{id:number;name:string;category_id:number}[]>([])
  const [products,  setProducts]  = useState<{id:number;name:string;category_id:number;company_id:number}[]>([])

  // Rec data
  const [recData,  setRecData]  = useState<RecData>(EMPTY_REC_DATA)
  const [saving,   setSaving]   = useState(false)
  const [saveOk,   setSaveOk]   = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>|null>(null)

  // UI
  const [activeTab, setActiveTab] = useState('client')
  const [error,     setError]     = useState<string|null>(null)

  // ── Load client ID ──────────────────────────────────────────────────────────
  useEffect(() => {
    const id = localStorage.getItem('selectedClientId')
    if (id) setClientId(id)
  }, [])

  useEffect(() => { if (clientId) loadAll(clientId) }, [clientId])

  // ── Load all data ───────────────────────────────────────────────────────────
  async function loadAll(id: string) {
    try {
      setError(null)
      const sc = createClient()

      const [
        { data: ffRows },
        { data: familyRows },
        { data: comps },
        { data: prods },
      ] = await Promise.all([
        sc.from('fact_finding').select('section,data').eq('client_id', id)
          .in('section',['financials','protection_needs','protection_portfolio','retirement','accumulation','education','estate','objectives','capital_mandate','strategic_recommendations']),
        sc.from('family_members').select('*').eq('client_id', id),
        sc.from('ins_companies').select('*').eq('active',true).order('sort_order'),
        sc.from('ins_products').select('*').eq('active',true).order('sort_order'),
      ])

      if (comps) setCompanies(comps)
      if (prods) setProducts(prods)

      // Build merged FF
      const by: Record<string,any> = {}
      if (ffRows) ffRows.forEach((r:any) => { by[r.section] = r.data })

      const fin  = by['financials']    ?? {}
      const pNeeds = by['protection_needs'] ?? {}
      const pPort  = by['protection_portfolio'] ?? {}
      const accRow = by['accumulation'] ?? {}
      const retRow = by['retirement']   ?? {}
      const eduRow = by['education']    ?? {}
      const estateRow = by['estate']    ?? {}
      const objRow = by['objectives']   ?? {}
      const cmRow  = by['capital_mandate'] ?? {}

      // Client name
      const cName = fin?.client?.firstName
        ? `${fin.client.firstName} ${fin.client.lastName||''}`.trim()
        : 'Client'
      const sName = fin?.spouse?.firstName
        ? `${fin.spouse.firstName} ${fin.spouse.lastName||''}`.trim()
        : fin?.person2?.firstName
          ? `${fin.person2.firstName} ${fin.person2.lastName||''}`.trim()
          : 'Spouse'
      setClientName(cName)
      setSpouseName(sName)

      // Couple mode
      const coupled = objRow?.protection?.planType === 'couple'
        || objRow?.planType === 'couple'
        || fin?.mode === 'couple'
        || fin?.planType === 'couple'
      setIsCouple(coupled)

      // Children from family_members
      const kids = familyRows
        ? familyRows.filter((m:any) => ['son','daughter','child'].includes((m.relationship||'').toLowerCase()))
        : []
      setChildren(kids)

      // Gaps from protection_needs
      const prot = pNeeds?.protection ?? {}
      const policies: any[] = pPort?.risk_management?.policies ?? []
      const ACTIVE = ['In-Force','Premium Holiday','Paid-up']
      const activePolicies = policies.filter((p:any) => ACTIVE.includes(p.status))

      function sumBenefit(person:string, type:'death'|'ci') {
        return activePolicies
          .filter((p:any)=>p.person===person)
          .reduce((s:number,p:any)=>{
            const mult = p.multiplier || 1
            if (type==='death') return s + (p.baseDeath||0)*mult + (p.baseTPD||0)*mult
            return s + (p.baseAdvCI||0)*mult + (p.baseEarlyCI||0)*mult
          },0)
      }
      setClientGaps({
        dtpd: { need: prot.p1_dtpd_need || 0, have: sumBenefit('client','death') },
        ci:   { need: prot.p1_ci_need   || 0, have: sumBenefit('client','ci') },
      })
      setSpouseGaps({
        dtpd: { need: prot.p2_dtpd_need || 0, have: sumBenefit('spouse','death') },
        ci:   { need: prot.p2_ci_need   || 0, have: sumBenefit('spouse','ci') },
      })

      // Goals from capital_mandate
      const cmGoals: any[] = cmRow?.portfolio?.vehicles ? [] : []
      // Pull from accumulation goals
      const accGoals: {icon:string;label:string;corpus:number;monthly:number;shortfall:number;owner:string}[] = []
      ;(accRow?.acc?.goals || []).forEach((g:any)=>{
        accGoals.push({
          icon:'💰', label: g.label || 'Wealth Goal',
          corpus: g.targetCorpus || 0, monthly: g.monthlyRequired || 0,
          shortfall: 0, owner: g.owner || 'client',
        })
      })
      // Retirement goal
      const ret = retRow?.ret ?? retRow ?? {}
      const retCorpus = ret?.client?.corpusNeeded || ret?.corpusNeeded || 0
      if (retCorpus > 0) {
        accGoals.unshift({
          icon:'🌅', label:'Retirement', corpus: retCorpus, monthly: 0, shortfall: 0, owner:'joint',
        })
      }
      // Education goals
      ;(eduRow?.edu?.children || []).forEach((c:any)=>{
        if (c.corpus > 0) accGoals.push({
          icon:'🎓', label:`${c.name}'s Education`, corpus:c.corpus||0, monthly:c.monthlyRequired||0, shortfall:0, owner:'joint',
        })
      })
      setClientGoals(accGoals.filter(g=>g.owner==='client'))
      setSpouseGoals(accGoals.filter(g=>g.owner==='spouse'))
      setJointGoals(accGoals.filter(g=>g.owner==='joint'))

      // Merge estate data into ffData
      setFfData({ ...fin, estate: estateRow?.estate ?? estateRow ?? {} })

      // Load saved recommendations
      const saved = by['strategic_recommendations']
      if (saved?.recData) setRecData(saved.recData)
      else setRecData(EMPTY_REC_DATA)

    } catch(e:any) {
      setError('Failed to load data: ' + e.message)
    }
  }

  // ── Auto-save ───────────────────────────────────────────────────────────────
  const schedSave = useCallback((data:RecData) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(data), 1200)
  }, [clientId])

  async function save(data:RecData) {
    if (!clientId) return
    setSaving(true)
    try {
      const sc = createClient()
      const { data: rows } = await sc.from('fact_finding').select('id')
        .eq('client_id',clientId).eq('section','strategic_recommendations')
        .order('created_at',{ascending:false}).limit(1)
      const payload = { recData: data, updatedAt: new Date().toISOString() }
      if (rows && rows.length > 0) {
        await sc.from('fact_finding').update({ data:payload, updated_at:new Date().toISOString() }).eq('id',rows[0].id)
      } else {
        await sc.from('fact_finding').insert({ client_id:clientId, section:'strategic_recommendations', data:payload })
      }
      setSaveOk(true)
      setTimeout(()=>setSaveOk(false), 2000)
    } catch(e) { console.error('Save failed',e) }
    setSaving(false)
  }

  function handleChange(data:RecData) {
    setRecData(data)
    schedSave(data)
  }

  // ── Tabs ────────────────────────────────────────────────────────────────────
  const tabs = [
    { key:'client', label: clientName },
    ...(isCouple ? [{ key:'spouse', label: spouseName }] : []),
    ...(children.length > 0 ? children.map((c:any)=>({ key:`child_${c.id||c.name}`, label: c.name || 'Child' })) : []),
  ]

  // Goals for current tab
  function getGoals(person:string) {
    const jt = jointGoals
    if (person==='client') return [...jt, ...clientGoals]
    if (person==='spouse') return [...jt, ...spouseGoals]
    return []  // children don't have goals context
  }
  function getGaps(person:string) {
    if (person==='client') return clientGaps
    if (person==='spouse') return spouseGaps
    return { dtpd:{need:0,have:0}, ci:{need:0,have:0} }
  }

  // Summary counts for hero band
  const totalProt  = recData.protection.length
  const totalWealth = recData.wealth.length
  const totalDistrib = recData.distribution.length
  const highPriority = [
    ...recData.protection.filter(r=>r.priority==='High'),
    ...recData.wealth.filter(r=>r.priority==='High'),
    ...recData.distribution.filter(r=>r.urgency==='Immediate'),
  ].length

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      {/* ── Hero band ── */}
      <div style={{ background:'var(--charcoal)', padding:'0 48px' }}>
        <div style={{ paddingTop:32, paddingBottom:24 }}>
          <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.15em', textTransform:'uppercase', color:'#9A9690', marginBottom:6 }}>
                Advisory Summary
              </div>
              <div style={{ fontFamily:'Cormorant Garamond,serif', fontSize:30, fontWeight:300, color:'#F0EDE8', lineHeight:1.1 }}>
                Strategic Recommendations
              </div>
              <div style={{ fontFamily:'Inter', fontSize:12, color:'#9A9690', marginTop:6, fontStyle:'italic' }}>
                Consolidated product &amp; planning recommendations across all areas
              </div>
            </div>
            {/* Stats */}
            <div style={{ display:'flex', gap:24, alignItems:'flex-end' }}>
              {[
                { label:'Protection', val:totalProt, color:'#c8a96e' },
                { label:'Wealth',     val:totalWealth, color:'#4A9E8A' },
                { label:'Distribution', val:totalDistrib, color:'#9B7BAA' },
                { label:'High Priority', val:highPriority, color:'#FF8A80' },
              ].map(s=>(
                <div key={s.label} style={{ textAlign:'center' }}>
                  <div style={{ fontFamily:'Cormorant Garamond,serif', fontSize:28, fontWeight:300, color:s.color, lineHeight:1 }}>{s.val}</div>
                  <div style={{ fontFamily:'Inter', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', color:'#9A9690', marginTop:3 }}>{s.label}</div>
                </div>
              ))}
              {/* Save indicator */}
              <div style={{ fontFamily:'Inter', fontSize:11, color: saveOk ? '#4A9E8A' : saving ? '#c8a96e' : 'transparent', marginLeft:8, transition:'color 0.3s', alignSelf:'center' }}>
                {saveOk ? '✓ Saved' : saving ? 'Saving…' : '.'}
              </div>
            </div>
          </div>
        </div>

        {/* Person tabs */}
        <div style={{ display:'flex', gap:0, borderTop:'1px solid rgba(255,255,255,0.08)', marginTop:4 }}>
          {tabs.map(t=>(
            <button key={t.key} onClick={()=>setActiveTab(t.key)} style={{
              background:'none', border:'none', padding:'12px 20px', cursor:'pointer',
              fontFamily:'Inter', fontSize:12, letterSpacing:'0.06em',
              color: activeTab===t.key ? '#F0EDE8' : '#9A9690',
              borderBottom: activeTab===t.key ? '2px solid #A8834A' : '2px solid transparent',
              transition:'all 0.2s',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ flex:1, padding:'32px 48px', maxWidth:1100 }}>
        {error && (
          <div style={{ background:'#FEE2E2', border:'1px solid #FCA5A5', borderRadius:8, padding:'12px 16px', marginBottom:20, fontFamily:'Inter', fontSize:13, color:'#9B1C1C' }}>
            {error}
          </div>
        )}

        {tabs.map(t=>(
          <div key={t.key} style={{ display: activeTab===t.key ? 'block' : 'none' }}>
            <PersonSection
              person={t.key}
              personLabel={t.label}
              recData={recData}
              onChangeRecData={handleChange}
              ffData={ffData}
              gapData={getGaps(t.key)}
              goalsData={getGoals(t.key)}
              companies={companies}
              products={products}
            />
          </div>
        ))}

        {tabs.length === 0 && (
          <div style={{ textAlign:'center', padding:'80px 0', color:'var(--ink3)', fontFamily:'Inter', fontSize:13 }}>
            No client selected. Please select a client from the dashboard.
          </div>
        )}
      </div>
    </div>
  )
}
