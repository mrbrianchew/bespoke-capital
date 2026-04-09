'use client'

import React, { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { 
  ShieldCheck, 
  TrendingUp, 
  AlertCircle, 
  Plus, 
  X, 
  FileText, 
  Printer,
  ChevronDown
} from 'lucide-react'

// ─── Reference Types (loaded from DB) ────────────────────────────────────────
interface InsCategory   { id: number; code: string; name: string; sort_order: number }
interface InsPolicyType { id: number; category_id: number; code: string; name: string }
interface InsCompany    { id: number; category_id: number; name: string }
interface InsProduct    { id: number; category_id: number; company_id: number; name: string }

// ─── Policy Record ────────────────────────────────────────────────────────────
export interface Policy {
  id: string
  categoryCode:   string
  policyTypeCode: string
  companyName:    string
  productName:    string
  policyholder:   string
  lifeAssured:    string
  policyNo:       string
  briefDescription: string
  baseDeath:      number
  baseTPD:        number
  baseAdvCI:      number
  baseEarlyCI:    number
  sumAssured:     number
  monthlyBenefit: number
  deferredPeriod: string
  multiplier:     number
  coverStep:      number
  currentCashValue: number
  premiumMedisave: number
  premiumCash:     number
  premiumMode:     string
  frequency:       string
  inceptionDate:   string
  premiumMaturity: string
  coverageMaturity: string
  status:  string
  remarks: string
  person:  string
}

export interface RiskMgmtData { policies: Policy[]; advisorNotes: string }
const EMPTY_RM: RiskMgmtData = { policies: [], advisorNotes: '' }

function emptyPolicy(person: string, ph = '', la = ''): Policy {
  return {
    id: crypto.randomUUID(), categoryCode: 'life', policyTypeCode: '', companyName: '', productName: '',
    policyholder: ph, lifeAssured: la, policyNo: '', briefDescription: '',
    baseDeath: 0, baseTPD: 0, baseAdvCI: 0, baseEarlyCI: 0, sumAssured: 0,
    monthlyBenefit: 0, deferredPeriod: '', multiplier: 0, coverStep: 0, currentCashValue: 0,
    premiumMedisave: 0, premiumCash: 0, premiumMode: '', frequency: 'Annual',
    inceptionDate: '', premiumMaturity: '', coverageMaturity: '',
    status: 'In-Force', remarks: '', person,
  }
}

// ─── Display Helpers & Constants ──────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  medical: 'bg-blue-100 text-blue-700', 
  ltc: 'bg-purple-100 text-purple-700', 
  general: 'bg-emerald-100 text-emerald-700',
  life: 'bg-amber-100 text-amber-700', 
  endowment: 'bg-orange-100 text-orange-700',
}
const CAT_SHORT: Record<string, string> = {
  medical: 'Medical', ltc: 'LTC/DI', general: 'General',
  life: 'Life', endowment: 'Endowment',
}
const FREQ = ['Annual','Semi-Annual','Quarterly','Monthly','Single','Giro']
const STATUS_OPTS = ['In-Force','Lapsed','Surrendered','Matured','Pending']
const PAY_MODES   = ['Cash','Giro','CPFIS','Medisave','SRS']

function fmt(n: number | null | undefined) {
  if (!n || n === 0) return '—'
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 0 }).format(n)
}

function gapSt(need: number, have: number) {
  if (need <= 0) return { label: 'N/A', color: 'text-gray-500', bg: 'bg-gray-100' }
  if (have >= need) return { label: 'Covered', color: 'text-emerald-700', bg: 'bg-emerald-50' }
  if (have > 0) return { label: 'Partial', color: 'text-amber-700', bg: 'bg-amber-50' }
  return { label: 'Gap', color: 'text-red-700', bg: 'bg-red-50' }
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ProtectionPage() {
  const supabase = createClient()

  // Client State
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState('Client')
  const [clientAge, setClientAge] = useState(40)
  const [spouseName, setSpouseName] = useState('Spouse')
  const [spouseAge, setSpouseAge] = useState(38)
  const [isCouple, setIsCouple] = useState(false)
  const [children, setChildren] = useState<any[]>([])
  const [ffData, setFfData] = useState<any>(null)

  // DB Reference State
  const [refCategories, setRefCategories] = useState<InsCategory[]>([])
  const [refPolicyTypes, setRefPolicyTypes] = useState<InsPolicyType[]>([])
  const [refCompanies, setRefCompanies] = useState<InsCompany[]>([])
  const [refProducts, setRefProducts] = useState<InsProduct[]>([])

  // Portfolio State
  const [rmData, setRmData] = useState<RiskMgmtData>(EMPTY_RM)
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // UI State
  const [activeTab, setActiveTab] = useState<'overview'|'portfolio'>('overview')
  const [overviewPerson, setOverviewPerson] = useState<'client'|'spouse'>('client')
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [modalPerson, setModalPerson] = useState('client')

  useEffect(() => {
    const id = localStorage.getItem('selectedClientId')
    if (id) setClientId(id)
  }, [])

  useEffect(() => { if (clientId) loadAll(clientId) }, [clientId])

  async function loadAll(id: string) {
    const [ { data: cats }, { data: ptypes }, { data: comps }, { data: prods } ] = await Promise.all([
      supabase.from('ins_categories').select('*').order('sort_order'),
      supabase.from('ins_policy_types').select('*').order('sort_order'),
      supabase.from('ins_companies').select('*').eq('active', true).order('sort_order'),
      supabase.from('ins_products').select('*').eq('active', true).order('sort_order'),
    ])
    
    if (cats) setRefCategories(cats)
    if (ptypes) setRefPolicyTypes(ptypes)
    if (comps) setRefCompanies(comps)
    if (prods) setRefProducts(prods)

    const { data: client } = await supabase.from('clients').select('name, age, dob').eq('id', id).maybeSingle()
    if (client) {
      setClientName(client.name)
      if (client.dob) setClientAge(Math.floor((Date.now() - new Date(client.dob).getTime()) / (365.25*24*3600*1000)))
      else if (client.age) setClientAge(Number(client.age))
    }

    const { data: rows } = await supabase.from('fact_finding').select('data').eq('client_id', id)
    const merged: any = {}
    if (rows?.length) rows.forEach((r: any) => { if (r.data) Object.assign(merged, r.data) })

    const { data: familyRows } = await supabase.from('family_members').select('*').eq('client_id', id)

    if (Object.keys(merged).length > 0) {
      setFfData(merged)
      const p2 = merged.person2
      if (p2?.name) {
        setSpouseName(p2.name); setIsCouple(true)
        if (p2.age) setSpouseAge(Number(p2.age))
        else if (p2.dob) setSpouseAge(Math.floor((Date.now() - new Date(p2.dob).getTime()) / (365.25*24*3600*1000)))
      } else if (merged.mode === 'couple') {
        setIsCouple(true)
        const sn = merged.spouse_name || merged.spouseName || ''
        if (sn) setSpouseName(sn)
      }

      if (familyRows && familyRows.length > 0) {
        const spouse = familyRows.find((m: any) => m.relationship?.toLowerCase() === 'spouse')
        if (spouse?.name && !merged.person2?.name) {
          setSpouseName(spouse.name); setIsCouple(true)
          if (spouse.age) setSpouseAge(Number(spouse.age))
          else if (spouse.dob) setSpouseAge(Math.floor((Date.now() - new Date(spouse.dob).getTime()) / (365.25*24*3600*1000)))
        }
        const kids = familyRows.filter((m: any) => m.relationship?.toLowerCase() !== 'spouse')
        setChildren(kids.length > 0 ? kids.map((k: any) => ({ name: k.name, age: k.age, id: k.id })) : (merged.children || []))
      } else {
        setChildren(Array.isArray(merged.children) ? merged.children : [])
      }

      const rm = merged.risk_management
      if (rm) setRmData({ ...EMPTY_RM, ...rm })
    }
  }

  async function saveData(data: RiskMgmtData) {
    if (!clientId) return; 
    setSaving(true)
    const { data: rows } = await supabase.from('fact_finding').select('data').eq('client_id', clientId)
    const existing = rows?.length ? (rows[0].data || {}) : {}
    await supabase.from('fact_finding').upsert({ client_id: clientId, data: { ...existing, risk_management: data } }, { onConflict: 'client_id' })
    setSaving(false)
  }

  function updateRm(next: RiskMgmtData) {
    setRmData(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveData(next), 1000)
  }

  // Financial Calculations
  const ff = ffData || {}
  const inflation = (Number(ff.inflation_rate) || 3) / 100
  const p1Mo = Number(ff.monthly_income || ff.monthlyIncomeClient || 0)
  const p2Mo = Number(ff.person2?.monthly_income || 0)
  const expCats = ['financial_commitments','household','personal','children','lifestyle']
  const p1Exp = expCats.reduce((s,c) => s + Number(ff[`d_${c}`]||0), 0) || (p1Mo*12*0.7)
  const p2Exp = expCats.reduce((s,c) => s + Number(ff[`d2_${c}`]||0), 0) || (p2Mo*12*0.7)
  
  let coverTerm = 25
  if (children.length > 0) {
    const minAge = Math.min(...children.map((c:any) => Number(c.age||0)))
    coverTerm = Math.max(5, 26 - minAge)
  }
  
  function fvAnn(annual: number, r: number, y: number) {
    if (y<=0) return 0; if (r===0) return annual*y
    return annual*((Math.pow(1+r,y)-1)/r)
  }

  const mort = Number(ff.l_mortgage_residing||0) + Number(ff.l2_mortgage_residing||0) + Number(ff.d_mortgage_cpf||0)
  const edu  = Number(ff.strategic_objectives?.ed_total||0)
  const p1CPF  = Number(ff.a_cpf_oa||0)+Number(ff.a_cpf_sa||0)+Number(ff.a_cpf_ma||0)
  const p2CPF  = Number(ff.a2_cpf_oa||0)+Number(ff.a2_cpf_sa||0)+Number(ff.a2_cpf_ma||0)
  const props: any[] = ff.properties||[]
  const p1Prop = props.filter((p:any)=>p.owner==='client'||p.owner==='joint').reduce((s:number,p:any)=>s+Number(p.current_value||0)*(p.owner==='joint'?0.5:1),0)
  const p2Prop = props.filter((p:any)=>p.owner==='spouse'||p.owner==='joint').reduce((s:number,p:any)=>s+Number(p.current_value||0)*(p.owner==='joint'?0.5:1),0)
  const p1Liq  = Number(ff.a_savings||0)+Number(ff.a_alternatives||0)
  const p2Liq  = Number(ff.a2_savings||0)+Number(ff.a2_alternatives||0)

  const clientDTPD = Math.max(0, fvAnn(p1Exp,inflation,coverTerm)+mort+edu-p1CPF-p1Prop)
  const clientCI   = Math.max(0, p1Mo*24 - p1Liq)
  const spouseDTPD = isCouple ? Math.max(0, fvAnn(p2Exp,inflation,coverTerm)+mort-p2CPF-p2Prop) : 0
  const spouseCI   = isCouple ? Math.max(0, p2Mo*24 - p2Liq) : 0

  function lifeHave(person: string) {
    return rmData.policies.filter(p=>p.person===person&&['life'].includes(p.categoryCode))
      .reduce((s,p)=>s+Math.max(p.baseDeath||0,p.sumAssured||0),0)
  }
  function ciHave(person: string) {
    return rmData.policies.filter(p=>p.person===person&&['life'].includes(p.categoryCode))
      .reduce((s,p)=>s+Math.max(p.baseAdvCI||0,p.baseEarlyCI||0),0)
  }
  function premHave(person: string) {
    return rmData.policies.filter(p=>p.person===person).reduce((s,p)=>s+(p.premiumCash||0)+(p.premiumMedisave||0),0)
  }

  const cLH = lifeHave('client'), cCH = ciHave('client')
  const sLH = lifeHave('spouse'), sCH = ciHave('spouse')
  const totalPrem = rmData.policies.reduce((s,p)=>s+(p.premiumCash||0)+(p.premiumMedisave||0),0)

  // Chart builder
  function buildChart(age: number, annExp: number, offset: number, ciNeed: number) {
    return Array.from({length:100-age}, (_,i) => {
      const a = age+i
      const yLeft = Math.max(0, (age+coverTerm)-a)
      const dtpd = Math.max(0, fvAnn(annExp,inflation,yLeft) + mort*(yLeft/Math.max(1,coverTerm)) + edu*(yLeft/Math.max(1,coverTerm)) - (i===0?offset:0))
      const ciFactor = a < age+coverTerm ? 1.0 : Math.max(0, 1-(a-(age+coverTerm))*0.04)
      return { age: a, dtpd, ci: Math.max(0, ciNeed*ciFactor) }
    })
  }

  const aAge    = overviewPerson==='client' ? clientAge  : spouseAge
  const aDTPD   = overviewPerson==='client' ? clientDTPD : spouseDTPD
  const aCI     = overviewPerson==='client' ? clientCI   : spouseCI
  const aLH     = overviewPerson==='client' ? cLH        : sLH
  const aCH     = overviewPerson==='client' ? cCH        : sCH
  const aExp    = overviewPerson==='client' ? p1Exp      : p2Exp
  const aOffset = overviewPerson==='client' ? p1CPF+p1Prop : p2CPF+p2Prop
  const aName   = overviewPerson==='client' ? clientName : spouseName

  const chartData = buildChart(aAge, aExp, aOffset, aCI)

  const allPeople = [
    { key: 'client', label: clientName },
    ...(isCouple ? [{ key: 'spouse', label: spouseName }] : []),
    ...children.map((c: any) => ({ key: `child_${c.name || c.id}`, label: c.name || 'Child' })),
  ]

  const sections = [
    { key: 'client', label: clientName },
    ...(isCouple ? [{ key: 'spouse', label: spouseName }] : []),
    ...(children.length > 0 ? [{ key: 'dependents', label: 'Dependents', isDependent: true, childKeys: children.map((c: any) => `child_${c.name || c.id || c}`) }] : []),
  ]

  function openNew(person: string) {
    const label = allPeople.find(p=>p.key===person)?.label||person
    setEditingPolicy(emptyPolicy(person, label, label))
    setModalPerson(person)
    setShowModal(true)
  }
  function openEdit(p: Policy) { setEditingPolicy({...p}); setModalPerson(p.person); setShowModal(true) }
  function savePolicy(p: Policy) {
    const exists = rmData.policies.find(x=>x.id===p.id)
    const next = exists
      ? {...rmData, policies: rmData.policies.map(x=>x.id===p.id?p:x)}
      : {...rmData, policies: [...rmData.policies, p]}
    updateRm(next); setShowModal(false); setEditingPolicy(null)
  }
  function delPolicy(id: string) { updateRm({...rmData, policies: rmData.policies.filter(p=>p.id!==id)}) }

  return (
    <div className="min-h-screen bg-[#FBFBFD] font-sans flex flex-col text-[#1D1D1F]">
      
      {/* ── HERO SECTION (Apple Premium Feel) ── */}
      <div className="bg-[#1D1D1F] text-white px-8 md:px-12 py-12 pb-16 relative overflow-hidden shrink-0">
        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-white/5 to-transparent pointer-events-none" />
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-6 relative z-10">
          <div>
            <div className="text-[11px] font-semibold tracking-widest uppercase text-amber-400/80 mb-3 flex items-center gap-2">
              <ShieldCheck size={14} />
              Risk Management
            </div>
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-white mb-2">
              Wealth Protection
            </h1>
            <p className="text-gray-400 text-lg font-medium tracking-tight">Portfolio for {clientName}</p>
          </div>

          <div className="flex items-center gap-4">
            {saving && <span className="text-sm text-gray-400 animate-pulse transition-opacity">Saving...</span>}
            <div className="flex bg-white/10 p-1 rounded-xl backdrop-blur-md">
              {(['overview','portfolio'] as const).map(t=>(
                <button 
                  key={t} 
                  onClick={()=>setActiveTab(t)}
                  className={`px-6 py-2 rounded-lg text-sm font-medium transition-all duration-300 capitalize ${
                    activeTab === t 
                    ? 'bg-white text-black shadow-sm' 
                    : 'text-gray-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto w-full flex-1 px-4 md:px-12 py-10 -mt-8 relative z-20">
        
        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Metric Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Total Policies" value={String(rmData.policies.length)} sub="Across all insured persons" />
              <MetricCard label="Annual Premium" value={fmt(totalPrem)} sub="Combined portfolio" />
              <MetricCard 
                label={`${clientName} — D/TPD Gap`} 
                value={fmt(Math.max(0, clientDTPD - cLH))} 
                sub={clientDTPD > 0 ? `Needs ${fmt(clientDTPD)}` : 'Complete profile first'} 
                alert={clientDTPD - cLH > 0} 
              />
              <MetricCard 
                label={`${clientName} — CI Gap`} 
                value={fmt(Math.max(0, clientCI - cCH))} 
                sub={clientCI > 0 ? `Needs ${fmt(clientCI)}` : 'Complete profile first'} 
                alert={clientCI - cCH > 0} 
              />
            </div>

            {/* Toggle Person */}
            {isCouple && (
              <div className="flex p-1 bg-gray-200/50 rounded-xl w-fit">
                {(['client','spouse'] as const).map(p=>(
                  <button 
                    key={p} 
                    onClick={()=>setOverviewPerson(p)}
                    className={`px-6 py-2 text-sm font-medium rounded-lg transition-all ${
                      overviewPerson === p ? 'bg-white shadow-sm text-black' : 'text-gray-500 hover:text-black'
                    }`}
                  >
                    {p === 'client' ? clientName : spouseName}
                  </button>
                ))}
              </div>
            )}

            {/* Gap Analysis List */}
            <GapSection 
              title={`${aName}'s Coverage Gap Analysis`}
              dtpdNeed={aDTPD} ciNeed={aCI} lifeHave={aLH} ciHave={aCH}
              mortgageNeed={mort} educationNeed={edu} annualPremium={premHave(overviewPerson)} 
            />

            {/* Charts */}
            {aDTPD > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <CoverageChart 
                  title="Death & TPD Needs Projection" 
                  needLabel="Required Capital" 
                  haveLabel="Current Protection" 
                  data={chartData.map(d=>({age:d.age,need:d.dtpd,have:aLH}))} 
                  needColor="#1D1D1F" 
                />
                <CoverageChart 
                  title="Critical Illness Needs Projection" 
                  needLabel="Required Protection" 
                  haveLabel="Current Protection" 
                  data={chartData.map(d=>({age:d.age,need:d.ci,have:aCH}))} 
                  needColor="#1D1D1F" 
                />
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200/60 p-8 text-center text-gray-500 text-sm">
                Complete the Financial Profile to generate precise coverage projections.
              </div>
            )}

            {/* Advisor Notes */}
            <div className="bg-white rounded-2xl border border-gray-200/60 p-6 shadow-sm">
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">
                <FileText size={14} /> Advisor Notes
              </label>
              <textarea 
                value={rmData.advisorNotes} 
                onChange={e=>updateRm({...rmData,advisorNotes:e.target.value})}
                placeholder="Record qualitative observations, client concerns, and agreed priorities..." 
                className="w-full bg-gray-50 text-gray-900 border-0 ring-1 ring-inset ring-gray-200 rounded-xl p-4 text-sm focus:ring-2 focus:ring-black outline-none resize-y min-h-[120px] transition-all"
              />
            </div>
          </div>
        )}

        {/* ── PORTFOLIO TAB ── */}
        {activeTab === 'portfolio' && (
          <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-end no-print">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Policy Inventory</h2>
                <p className="text-gray-500 mt-1 text-sm">{rmData.policies.length} {rmData.policies.length===1?'policy':'policies'} active</p>
              </div>
              <button 
                onClick={()=>window.print()} 
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-full text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm"
              >
                <Printer size={16} /> Print Report
              </button>
            </div>

            {sections.map(({key,label,isDependent,childKeys})=>{
              const policies = isDependent&&childKeys ? rmData.policies.filter(p=>childKeys.includes(p.person)) : rmData.policies.filter(p=>p.person===key)
              const addKey = isDependent&&childKeys ? (childKeys[0]||key) : key
              const secPrem = policies.reduce((s,p)=>s+(p.premiumCash||0)+(p.premiumMedisave||0),0)
              
              return (
                <div key={key} className="bg-white rounded-3xl border border-gray-200/60 shadow-sm overflow-hidden">
                  <div className="px-6 py-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/50">
                    <div className="flex items-center gap-3">
                      <div className={`w-1.5 h-6 rounded-full ${isDependent ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      <h3 className="text-xl font-semibold tracking-tight text-gray-900">{label}</h3>
                      {isDependent && <span className="text-[10px] uppercase tracking-wider font-semibold bg-white border border-gray-200 text-gray-500 px-2 py-0.5 rounded-full">Dependent</span>}
                    </div>
                    <div className="flex items-center gap-6 no-print">
                      {secPrem > 0 && <div className="text-sm text-gray-500">Premium: <span className="font-semibold text-gray-900">{fmt(secPrem)}/yr</span></div>}
                      <button 
                        onClick={()=>openNew(addKey)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-800 transition-colors"
                      >
                        <Plus size={16} /> Add Policy
                      </button>
                    </div>
                  </div>
                  
                  {policies.length === 0 ? (
                    <div className="p-12 text-center text-gray-400 text-sm border-t border-dashed border-gray-200">
                      No policies on file for {label}.
                    </div>
                  ) : (
                    <PolicyTable policies={policies} onEdit={openEdit} onDelete={delPolicy} />
                  )}
                </div>
              )
            })}

            {/* Portfolio Summary Card */}
            {rmData.policies.length > 0 && (
              <div className="bg-[#1D1D1F] rounded-3xl p-8 text-white mt-8 shadow-xl">
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-6">Portfolio Summary</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                  <div>
                    <div className="text-sm text-gray-400 mb-1">Total Policies</div>
                    <div className="text-2xl font-semibold">{rmData.policies.length}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400 mb-1">Total Premium</div>
                    <div className="text-2xl font-semibold">{fmt(totalPrem)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400 mb-1">{clientName} Life/TPD</div>
                    <div className="text-2xl font-semibold">{fmt(cLH)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400 mb-1">{isCouple ? `${spouseName} Life/TPD` : 'Client CI'}</div>
                    <div className="text-2xl font-semibold">{isCouple ? fmt(sLH) : fmt(cCH)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── MODAL ── */}
      {showModal && editingPolicy && (
        <PolicyModal
          policy={editingPolicy}
          personLabel={sections.find(s=>s.key===modalPerson||s.childKeys?.includes(modalPerson))?.label||modalPerson}
          allPeople={allPeople}
          categories={refCategories}
          policyTypes={refPolicyTypes}
          companies={refCompanies}
          products={refProducts}
          onSave={savePolicy}
          onClose={()=>{ setShowModal(false); setEditingPolicy(null) }}
        />
      )}
      
      {/* Print Styles */}
      <style>{`@media print { .no-print { display: none !important; } body { background: white !important; } }`}</style>
    </div>
  )
}

// ─── Sub-Components ───────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, alert }: { label: string, value: string, sub: string, alert?: boolean }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/60 flex flex-col justify-between">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
        {label}
        {alert && <AlertCircle size={14} className="text-amber-500" />}
      </div>
      <div className="text-3xl font-semibold text-gray-900 tracking-tight mb-1">{value}</div>
      <div className="text-sm text-gray-400 font-medium">{sub}</div>
    </div>
  )
}

function GapSection({ title, dtpdNeed, ciNeed, lifeHave, ciHave, mortgageNeed, educationNeed, annualPremium }: any) {
  const rows = [
    { label: 'Life / Death & TPD', need: dtpdNeed, have: lifeHave },
    { label: 'Critical Illness', need: ciNeed, have: ciHave },
    ...(mortgageNeed > 0 ? [{ label: 'Mortgage Clearance', need: mortgageNeed, have: 0 }] : []),
    ...(educationNeed > 0 ? [{ label: "Children's Education", need: educationNeed, have: 0 }] : []),
  ]

  if (dtpdNeed === 0) return null;

  return (
    <div className="bg-white rounded-3xl border border-gray-200/60 shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
        <h3 className="text-lg font-semibold tracking-tight text-gray-900">{title}</h3>
        {annualPremium > 0 && <span className="text-sm text-gray-500">Portfolio Premium: <strong className="text-gray-900">{fmt(annualPremium)}/yr</strong></span>}
      </div>
      
      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
        <div>Coverage Area</div>
        <div>Required</div>
        <div>Existing</div>
        <div>Gap</div>
        <div className="w-24 text-center">Status</div>
      </div>

      <div className="divide-y divide-gray-100">
        {rows.map((row) => {
          const gap = row.need - row.have
          const st = gapSt(row.need, row.have)
          return (
            <div key={row.label} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-6 py-4 items-center">
              <div className="font-medium text-gray-900">{row.label}</div>
              <div className="text-gray-600">{fmt(row.need)}</div>
              <div className={`${row.have > 0 ? 'text-emerald-600 font-medium' : 'text-gray-400'}`}>{row.have > 0 ? fmt(row.have) : '—'}</div>
              <div className={`${gap > 0 ? 'text-amber-600 font-semibold' : 'text-emerald-600 font-medium'}`}>{gap > 0 ? fmt(gap) : 'Covered'}</div>
              <div className="w-24">
                <span className={`block text-center text-xs font-semibold px-2.5 py-1 rounded-full ${st.bg} ${st.color}`}>{st.label}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Progress Bars */}
      <div className="bg-gray-50 px-6 py-5 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-8">
        {[{ l: 'Life / D&TPD', n: dtpdNeed, h: lifeHave }, { l: 'Critical Illness', n: ciNeed, h: ciHave }].map(b => {
          const pct = b.n > 0 ? Math.min(100, (b.h / b.n) * 100) : 0
          return (
            <div key={b.l}>
              <div className="flex justify-between text-xs font-semibold mb-2">
                <span className="text-gray-500 uppercase tracking-wider">{b.l}</span>
                <span className="text-gray-900">{Math.round(pct)}% Filled</span>
              </div>
              <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-1000 ${pct >= 100 ? 'bg-emerald-500' : pct > 50 ? 'bg-amber-400' : 'bg-red-500'}`} 
                  style={{ width: `${pct}%` }} 
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CoverageChart({ title, needLabel, haveLabel, data, needColor }: any) {
  if (!data.length) return null
  const maxV = Math.max(...data.map((d:any)=>d.need), 1)
  const minA = data[0].age, aR = data[data.length-1].age - minA || 1
  
  // Chart dimensions
  const W = 500, H = 220, PL = 60, PR = 10, PT = 20, PB = 30
  const iW = W - PL - PR, iH = H - PT - PB
  
  const xP = (a: number) => ((a - minA) / aR) * iW
  const yP = (v: number) => iH - Math.min(1, v / maxV) * iH
  
  const path = data.map((d:any, i:number) => `${i===0?'M':'L'}${(PL+xP(d.age)).toFixed(1)},${(PT+yP(d.need)).toFixed(1)}`).join(' ')
  const areaPath = `${path} L${PL+iW},${PT+iH} L${PL},${PT+iH} Z`
  
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const fmtAx = (n: number) => n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(0)}K` : `$${n}`

  return (
    <div className="bg-white rounded-3xl border border-gray-200/60 p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-6">
        <TrendingUp size={18} className="text-gray-400" />
        <h3 className="font-semibold text-gray-900 tracking-tight">{title}</h3>
      </div>

      <div className="flex gap-6 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-100 border border-blue-300" />
          <span className="text-xs font-medium text-gray-500">{haveLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-[2px] bg-black" />
          <span className="text-xs font-medium text-gray-500">{needLabel}</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible">
        {/* Grid lines */}
        {ticks.map(f => {
          const y = PT + iH - f * iH;
          return (
            <g key={f}>
              <line x1={PL} y1={y} x2={PL+iW} y2={y} stroke="#f3f4f6" strokeWidth="1" strokeDasharray="4 4" />
              <text x={PL-10} y={y+3} fontSize="10" fill="#9ca3af" textAnchor="end" fontFamily="Inter, sans-serif">{fmtAx(maxV*f)}</text>
            </g>
          )
        })}
        
        {/* Have Bars */}
        {data.map((d:any) => (
          <rect 
            key={d.age} 
            x={PL + xP(d.age) - 1.5} 
            y={PT + yP(d.have)} 
            width={3} 
            height={Math.max(0, iH - yP(d.have))} 
            fill="#dbeafe" 
            rx="1.5"
          />
        ))}
        
        {/* Need Area & Line */}
        <path d={areaPath} fill="url(#needGradient)" opacity="0.1" />
        <path d={path} stroke={needColor} strokeWidth="2.5" fill="none" strokeLinejoin="round" strokeLinecap="round" />
        
        {/* X Axis */}
        <line x1={PL} y1={PT+iH} x2={PL+iW} y2={PT+iH} stroke="#e5e7eb" strokeWidth="2" />
        {data.filter((_:any, i:number) => i % 5 === 0).map((d:any) => (
          <text key={d.age} x={PL + xP(d.age)} y={PT+iH+16} fontSize="10" fill="#9ca3af" textAnchor="middle" fontFamily="Inter, sans-serif">{d.age}</text>
        ))}

        <defs>
          <linearGradient id="needGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={needColor} stopOpacity="1" />
            <stop offset="100%" stopColor={needColor} stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}

function PolicyTable({ policies, onEdit, onDelete }: any) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <tr>
            <th className="px-6 py-4">Type</th>
            <th className="px-6 py-4">Policy & Details</th>
            <th className="px-6 py-4">Benefit</th>
            <th className="px-6 py-4">Premium</th>
            <th className="px-6 py-4">Status</th>
            <th className="px-6 py-4 text-right no-print">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {policies.map((p: Policy) => {
            const catStyle = CAT_COLORS[p.categoryCode] || 'bg-gray-100 text-gray-700'
            const mainBen = p.baseDeath || p.baseAdvCI || p.monthlyBenefit || p.sumAssured
            return (
              <tr key={p.id} className="hover:bg-gray-50/50 transition-colors group">
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest ${catStyle}`}>
                    {CAT_SHORT[p.categoryCode] || p.categoryCode}
                  </span>
                  <div className="text-gray-500 text-xs mt-1.5 font-medium">{p.policyTypeCode || '—'}</div>
                </td>
                <td className="px-6 py-4">
                  <div className="font-semibold text-gray-900">{p.companyName || '—'}{p.productName ? ` · ${p.productName}` : ''}</div>
                  {(p.policyholder || p.lifeAssured) && (
                    <div className="text-gray-500 text-xs mt-1 flex gap-2">
                      {p.policyholder && <span>PH: {p.policyholder}</span>}
                      {p.lifeAssured && p.lifeAssured !== p.policyholder && <span>LA: {p.lifeAssured}</span>}
                    </div>
                  )}
                  {p.policyNo && <div className="text-gray-400 text-xs mt-0.5 font-mono">{p.policyNo}</div>}
                </td>
                <td className="px-6 py-4 font-mono font-medium text-gray-900">
                  {['ltc'].includes(p.categoryCode) && p.monthlyBenefit ? `${fmt(p.monthlyBenefit)}/mo` : fmt(mainBen)}
                </td>
                <td className="px-6 py-4">
                  <div className="font-mono font-medium text-gray-900">{fmt(p.premiumCash)}</div>
                  {p.premiumMedisave > 0 && <div className="text-xs text-gray-500 mt-1">+{fmt(p.premiumMedisave)} Medisave</div>}
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${p.status === 'In-Force' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                    {p.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right no-print">
                  <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onEdit(p)} className="p-2 text-gray-400 hover:text-black rounded-lg hover:bg-gray-100 transition-colors">
                      Edit
                    </button>
                    <button onClick={() => onDelete(p.id)} className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                      <X size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PolicyModal({ policy, personLabel, allPeople, categories, policyTypes, companies, products, onSave, onClose }: any) {
  const [form, setForm] = useState<Policy>({ ...policy })
  const f = (k: keyof Policy, v: any) => setForm(prev => ({ ...prev, [k]: v }))
  const isNew = !policy.companyName && !policy.productName

  const selCat = categories.find((c:any) => c.code === form.categoryCode)
  const filtTypes = selCat ? policyTypes.filter((pt:any) => pt.category_id === selCat.id) : []
  const filtComps = selCat ? companies.filter((co:any) => co.category_id === selCat.id) : []
  const selComp = filtComps.find((co:any) => co.name === form.companyName)
  const hasProducts = ['medical', 'ltc'].includes(form.categoryCode)
  const filtProds = selComp && hasProducts ? products.filter((pr:any) => pr.company_id === selComp.id) : []

  const onCatChange = (code: string) => setForm(prev => ({ ...prev, categoryCode: code, policyTypeCode: '', companyName: '', productName: '' }))
  const onCompChange = (name: string) => setForm(prev => ({ ...prev, companyName: name, productName: '' }))

  const isMedical = form.categoryCode === 'medical'
  const isLTC = form.categoryCode === 'ltc'
  const isLife = form.categoryCode === 'life'
  const isEndow = form.categoryCode === 'endowment'
  const isGeneral = form.categoryCode === 'general'

  // Apple-style form classes
  const labelClass = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2"
  const inputClass = "w-full bg-gray-50 text-gray-900 border-0 ring-1 ring-inset ring-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-black outline-none transition-shadow appearance-none"
  const selectWrapper = "relative"
  const selectIcon = <ChevronDown size={16} className="absolute right-4 top-3.5 text-gray-400 pointer-events-none" />

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
      
      <div className="relative bg-white rounded-3xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-white/80 backdrop-blur-md rounded-t-3xl sticky top-0 z-10">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900">{isNew ? 'Add Policy' : 'Edit Policy'}</h2>
            <p className="text-gray-500 text-sm mt-1">{personLabel}</p>
          </div>
          <button onClick={onClose} className="p-2 bg-gray-100 text-gray-500 hover:text-black rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="p-8 overflow-y-auto space-y-8 bg-gray-50/50">
          
          {/* Section: Classification */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-900 border-b border-gray-200 pb-2">Classification</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={selectWrapper}>
                <label className={labelClass}>Category</label>
                <select value={form.categoryCode} onChange={e => onCatChange(e.target.value)} className={inputClass}>
                  {categories.map((c:any) => <option key={c.id} value={c.code}>{c.name}</option>)}
                </select>
                {selectIcon}
              </div>
              <div className={selectWrapper}>
                <label className={labelClass}>Policy Type</label>
                <select value={form.policyTypeCode} onChange={e => f('policyTypeCode', e.target.value)} className={inputClass}>
                  <option value="">Select Type</option>
                  {filtTypes.map((t:any) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
                {selectIcon}
              </div>
            </div>
          </div>

          {/* Section: Roles */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-900 border-b border-gray-200 pb-2">Roles & Identification</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={selectWrapper}>
                <label className={labelClass}>Policyholder</label>
                <select value={form.policyholder} onChange={e => f('policyholder', e.target.value)} className={inputClass}>
                  <option value="">Select...</option>
                  {allPeople.map((p:any) => <option key={p.key} value={p.label}>{p.label}</option>)}
                </select>
                {selectIcon}
              </div>
              <div className={selectWrapper}>
                <label className={labelClass}>Life Assured</label>
                <select value={form.lifeAssured} onChange={e => f('lifeAssured', e.target.value)} className={inputClass}>
                  <option value="">Select...</option>
                  {allPeople.map((p:any) => <option key={p.key} value={p.label}>{p.label}</option>)}
                </select>
                {selectIcon}
              </div>
              <div className={selectWrapper}>
                <label className={labelClass}>Company</label>
                <select value={form.companyName} onChange={e => onCompChange(e.target.value)} className={inputClass}>
                  <option value="">Select Company</option>
                  {filtComps.map((c:any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                {selectIcon}
              </div>
              <div>
                <label className={labelClass}>Policy Number</label>
                <input type="text" value={form.policyNo} onChange={e => f('policyNo', e.target.value)} placeholder="e.g. 26725497" className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Product Name</label>
                {hasProducts && filtProds.length > 0 ? (
                  <div className={selectWrapper}>
                    <select value={form.productName} onChange={e => f('productName', e.target.value)} className={inputClass}>
                      <option value="">Select Product...</option>
                      {filtProds.map((p:any) => <option key={p.id} value={p.name}>{p.name}</option>)}
                      <option value="__other">Other (type manually)</option>
                    </select>
                    {selectIcon}
                  </div>
                ) : (
                  <input type="text" value={form.productName} onChange={e => f('productName', e.target.value)} placeholder="e.g. MyWholeLife Plan" className={inputClass} />
                )}
                {form.productName === '__other' && (
                  <input type="text" placeholder="Enter custom product name" onChange={e => f('productName', e.target.value)} className={`${inputClass} mt-3`} />
                )}
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Brief Description</label>
                <input type="text" value={form.briefDescription} onChange={e => f('briefDescription', e.target.value)} placeholder="e.g. As-Charged Coverage Up to Private Hospitals" className={inputClass} />
              </div>
            </div>
          </div>

          {/* Section: Benefits (Dynamic) */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-900 border-b border-gray-200 pb-2">Benefits & Coverage</h4>
            
            {(isLife || isEndow) && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div><label className={labelClass}>Base Death ($)</label><input type="number" value={form.baseDeath || ''} onChange={e => f('baseDeath', +e.target.value)} className={inputClass} /></div>
                <div><label className={labelClass}>Base TPD ($)</label><input type="number" value={form.baseTPD || ''} onChange={e => f('baseTPD', +e.target.value)} className={inputClass} /></div>
                <div><label className={labelClass}>Base Adv CI ($)</label><input type="number" value={form.baseAdvCI || ''} onChange={e => f('baseAdvCI', +e.target.value)} className={inputClass} /></div>
                <div><label className={labelClass}>Base Early CI ($)</label><input type="number" value={form.baseEarlyCI || ''} onChange={e => f('baseEarlyCI', +e.target.value)} className={inputClass} /></div>
                <div><label className={labelClass}>Multiplier</label><input type="number" value={form.multiplier || ''} onChange={e => f('multiplier', +e.target.value)} className={inputClass} /></div>
                <div><label className={labelClass}>Cover Step (yrs)</label><input type="number" value={form.coverStep || ''} onChange={e => f('coverStep', +e.target.value)} className={inputClass} /></div>
              </div>
            )}

            {(isMedical || isGeneral) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className={labelClass}>Sum Assured Limit ($)</label><input type="number" value={form.sumAssured || ''} onChange={e => f('sumAssured', +e.target.value)} className={inputClass} /></div>
              </div>
            )}

            {isLTC && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className={labelClass}>Monthly Benefit ($)</label><input type="number" value={form.monthlyBenefit || ''} onChange={e => f('monthlyBenefit', +e.target.value)} className={inputClass} /></div>
                <div className={selectWrapper}>
                  <label className={labelClass}>Deferred Period</label>
                  <select value={form.deferredPeriod} onChange={e => f('deferredPeriod', e.target.value)} className={inputClass}>
                    <option value="">Select...</option>
                    {['3/6 ADLs', 'Lifetime', '72 months', 'Up to age 67', 'Up to age 70', 'Other'].map(d => <option key={d}>{d}</option>)}
                  </select>
                  {selectIcon}
                </div>
              </div>
            )}

            {isEndow && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className={labelClass}>Current Cash Value ($)</label><input type="number" value={form.currentCashValue || ''} onChange={e => f('currentCashValue', +e.target.value)} className={inputClass} /></div>
                <div><label className={labelClass}>Non-GMV ($)</label><input type="number" value={form.sumAssured || ''} onChange={e => f('sumAssured', +e.target.value)} className={inputClass} /></div>
              </div>
            )}
          </div>

          {/* Section: Financials & Dates */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-900 border-b border-gray-200 pb-2">Financials & Timeline</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div><label className={labelClass}>Premium Cash ($)</label><input type="number" value={form.premiumCash || ''} onChange={e => f('premiumCash', +e.target.value)} className={inputClass} /></div>
              {isMedical && <div><label className={labelClass}>Premium Medisave ($)</label><input type="number" value={form.premiumMedisave || ''} onChange={e => f('premiumMedisave', +e.target.value)} className={inputClass} /></div>}
              
              <div className={selectWrapper}>
                <label className={labelClass}>Payment Mode</label>
                <select value={form.premiumMode} onChange={e => f('premiumMode', e.target.value)} className={inputClass}>
                  <option value="">Select...</option>
                  {PAY_MODES.map(m => <option key={m}>{m}</option>)}
                </select>
                {selectIcon}
              </div>
              <div className={selectWrapper}>
                <label className={labelClass}>Frequency</label>
                <select value={form.frequency} onChange={e => f('frequency', e.target.value)} className={inputClass}>
                  {FREQ.map(f => <option key={f}>{f}</option>)}
                </select>
                {selectIcon}
              </div>

              <div><label className={labelClass}>Inception Date</label><input type="date" value={form.inceptionDate} onChange={e => f('inceptionDate', e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>Premium Maturity</label><input type="date" value={form.premiumMaturity} onChange={e => f('premiumMaturity', e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>Coverage Maturity</label><input type="date" value={form.coverageMaturity} onChange={e => f('coverageMaturity', e.target.value)} className={inputClass} /></div>
            </div>
          </div>

          {/* Section: Status */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-900 border-b border-gray-200 pb-2">Status</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={selectWrapper}>
                <label className={labelClass}>Status</label>
                <select value={form.status} onChange={e => f('status', e.target.value)} className={inputClass}>
                  {STATUS_OPTS.map(st => <option key={st}>{st}</option>)}
                </select>
                {selectIcon}
              </div>
              <div><label className={labelClass}>Remarks</label><input type="text" value={form.remarks} onChange={e => f('remarks', e.target.value)} placeholder="e.g. In-Force, value as of 05/03/2026" className={inputClass} /></div>
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="px-8 py-5 border-t border-gray-100 bg-white rounded-b-3xl flex justify-end gap-3 sticky bottom-0">
          <button onClick={onClose} className="px-6 py-2.5 rounded-full text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
            Cancel
          </button>
          <button onClick={() => onSave(form)} className="px-6 py-2.5 rounded-full text-sm font-medium bg-black text-white hover:bg-gray-800 transition-colors shadow-md">
            {isNew ? 'Add Policy' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
