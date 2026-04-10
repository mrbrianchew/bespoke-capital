'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'

// ─── Reference types (loaded from DB) ────────────────────────────────────────
interface InsCategory   { id: number; code: string; name: string; sort_order: number }
interface InsPolicyType { id: number; category_id: number; code: string; name: string }
interface InsCompany    { id: number; category_id: number; name: string }
interface InsProduct    { id: number; category_id: number; company_id: number; name: string }

// ─── Policy record ────────────────────────────────────────────────────────────
interface Policy {
  id: string
  // Classification
  categoryCode:   string  // 'medical' | 'ltc' | 'general' | 'life' | 'endowment'
  policyTypeCode: string
  companyName:    string
  productName:    string
  // People
  policyholder: string
  lifeAssured:  string
  // Policy details
  policyNo:     string
  briefDescription: string
  // Sums
  baseDeath:    number
  baseTPD:      number
  baseAdvCI:    number
  baseEarlyCI:  number
  sumAssured:   number
  monthlyBenefit: number
  deferredPeriod: string
  benefitTerm?: string
  payoutTerm?:  string
  multiplier:   number
  multiplierEnd?: number
  coverStep:    number
  stepDownPct?: number
  currentCashValue: number
  // Endowment benefit input modes: '$' or '%'
  endowDeathMode?: '%' | '$'
  endowTPDMode?:   '%' | '$'
  // Premiums
  premiumMedisave: number
  premiumCash:     number
  premiumMode:     string
  frequency:       string
  // Dates
  inceptionDate:    string
  premiumMaturity:  string
  coverageMaturity: string
  // Status
  status:  string
  remarks: string
  // Section
  person: string
  // USD policy flag
  isUSD?:  boolean
  fxRate?: number   // USD/SGD rate stored at time of entry
}

interface RiskMgmtData { policies: Policy[]; advisorNotes: string }
const EMPTY_RM: RiskMgmtData = { policies: [], advisorNotes: '' }

function emptyPolicy(person: string, ph = '', la = ''): Policy {
  return {
    id: crypto.randomUUID(), categoryCode: 'life', policyTypeCode: '', companyName: '', productName: '',
    policyholder: ph, lifeAssured: la, policyNo: '', briefDescription: '',
    baseDeath: 0, baseTPD: 0, baseAdvCI: 0, baseEarlyCI: 0, sumAssured: 0,
    monthlyBenefit: 0, deferredPeriod: '', benefitTerm: '', payoutTerm: '', multiplier: 0, multiplierEnd: 0, coverStep: 0, stepDownPct: 0, currentCashValue: 0,
    endowDeathMode: '$', endowTPDMode: '$',
    premiumMedisave: 0, premiumCash: 0, premiumMode: '', frequency: 'Annual',
    inceptionDate: '', premiumMaturity: '', coverageMaturity: '',
    status: 'In-Force', remarks: '', person,
    isUSD: false, fxRate: 1.35,
  }
}

// ─── Display helpers ──────────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  medical: '#7A9CBF', ltc: '#9B7BAA', general: '#8A9A7E',
  life: '#c8a96e', endowment: '#B8956A',
}
const CAT_SHORT: Record<string, string> = {
  medical: 'Medical', ltc: 'LTC/DI', general: 'General',
  life: 'Life', endowment: 'Endowment',
}
const FREQ = ['Annual','Semi-Annual','Quarterly','Monthly','Single']
const STATUS_OPTS = ['In-Force', 'Terminated', 'Paid-up', 'Surrendered', 'Matured', 'Premium Holiday']
const ACTIVE_STATUSES = ['In-Force', 'Premium Holiday', 'Paid-up']
const PAY_MODES   = ['Cash', 'Credit Card', 'Giro', 'Medisave', 'CPF OA', 'CPF SA', 'CPF SRS', 'MS + Cash', 'MS + Giro', 'MS + CC']

function fmt(n: number | null | undefined) {
  if (!n || n === 0) return '—'
  return '$' + Math.round(n).toLocaleString()
}
function gapSt(need: number, have: number) {
  if (need <= 0) return { label: 'N/A',     color: '#555',    bg: '#F0EEE9' }
  if (have >= need) return { label: 'Covered', color: '#2D6A4F', bg: '#E8F5E9' }
  if (have > 0)     return { label: 'Partial',  color: '#854F0B', bg: '#FEF3C7' }
  return                   { label: 'Gap',      color: '#9B1C1C', bg: '#FEE2E2' }
}

// Helper to format dates nicely
function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  if (dateStr === 'Lifetime' || dateStr === 'Renewable' || dateStr.startsWith('Age ')) return dateStr
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  return dateStr
}

// Calculate benefit with multiplier
function getMultipliedBenefit(p: Policy, benefitType: 'death' | 'tpd' | 'advCI' | 'earlyCI'): number {
  const mult = p.multiplier || 1
  let base = 0
  switch (benefitType) {
    case 'death': base = p.baseDeath || 0; break
    case 'tpd': base = p.baseTPD || 0; break
    case 'advCI': base = p.baseAdvCI || 0; break
    case 'earlyCI': base = p.baseEarlyCI || 0; break
  }
  return base * mult
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProtectionPage() {
  const supabase = createClient()

  // Client / family
  const [clientId,   setClientId]   = useState<string | null>(null)
  const clientIdRef = useRef<string | null>(null)
  const [clientName, setClientName] = useState('Client')
  const [clientAge,  setClientAge]  = useState(40)
  const [spouseName, setSpouseName] = useState('Spouse')
  const [spouseAge,  setSpouseAge]  = useState(38)
  const [isCouple,   setIsCouple]   = useState(false)
  const [children,   setChildren]   = useState<any[]>([])
  const [ffData,     setFfData]     = useState<any>(null)

  // Reference data from DB
  const [refCategories,  setRefCategories]  = useState<InsCategory[]>([])
  const [refPolicyTypes, setRefPolicyTypes] = useState<InsPolicyType[]>([])
  const [refCompanies,   setRefCompanies]   = useState<InsCompany[]>([])
  const [refProducts,    setRefProducts]    = useState<InsProduct[]>([])

  // Portfolio data
  const [rmData,  setRmData]  = useState<RiskMgmtData>(EMPTY_RM)
  const [saving,  setSaving]  = useState(false)
  const [saveError, setSaveError] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // UI state
  const [activeTab,       setActiveTab]       = useState<'overview'|'portfolio'>('overview')
  const [overviewPerson,  setOverviewPerson]  = useState<'client'|'spouse'>('client')
  const [portfolioPerson, setPortfolioPerson] = useState<string>('client')
  const [editingPolicy,   setEditingPolicy]   = useState<Policy | null>(null)
  const [showModal,       setShowModal]       = useState(false)
  const [modalPerson,     setModalPerson]     = useState('client')
  const [showInactive,    setShowInactive]    = useState(false)

  useEffect(() => {
    const id = localStorage.getItem('selectedClientId')
    if (id) { setClientId(id); clientIdRef.current = id }
  }, [])

  useEffect(() => { if (clientId) loadAll(clientId) }, [clientId])

  useEffect(() => {
    // Reset the inactive toggle when switching people
    setShowInactive(false)
  }, [portfolioPerson])

  async function loadAll(id: string) {
    // Reference tables
    const [
      { data: cats },
      { data: ptypes },
      { data: comps },
      { data: prods },
    ] = await Promise.all([
      supabase.from('ins_categories').select('*').order('sort_order'),
      supabase.from('ins_policy_types').select('*').order('sort_order'),
      supabase.from('ins_companies').select('*').eq('active', true).order('sort_order'),
      supabase.from('ins_products').select('*').eq('active', true).order('sort_order'),
    ])
    if (cats)   setRefCategories(cats)
    if (ptypes) setRefPolicyTypes(ptypes)
    if (comps)  setRefCompanies(comps)
    if (prods)  setRefProducts(prods)

    // Client info
    const { data: client } = await supabase.from('clients').select('name, age, dob').eq('id', id).maybeSingle()
    if (client) {
      setClientName(client.name)
      if (client.dob) setClientAge(Math.floor((Date.now() - new Date(client.dob).getTime()) / (365.25*24*3600*1000)))
      else if (client.age) setClientAge(Number(client.age))
    }

    // Fact finding — merge all rows
    const { data: rows } = await supabase.from('fact_finding').select('data').eq('client_id', id)
    const merged: any = {}
    if (rows?.length) rows.forEach((r: any) => { if (r.data) Object.assign(merged, r.data) })

    // Also load family members from dedicated table (spouse + children)
    const { data: familyRows } = await supabase
      .from('family_members').select('*').eq('client_id', id)

    if (Object.keys(merged).length > 0) {
      setFfData(merged)

      // Spouse: try person2 first, then family_members table
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

      // Children: try family_members table first (most reliable), then merged JSON
      if (familyRows && familyRows.length > 0) {
        const spouse = familyRows.find((m: any) =>
          m.relationship?.toLowerCase() === 'spouse'
        )
        if (spouse?.name && !merged.person2?.name) {
          setSpouseName(spouse.name); setIsCouple(true)
          if (spouse.age) setSpouseAge(Number(spouse.age))
          else if (spouse.dob) setSpouseAge(Math.floor((Date.now() - new Date(spouse.dob).getTime()) / (365.25*24*3600*1000)))
        }
        const kids = familyRows.filter((m: any) =>
          m.relationship?.toLowerCase() !== 'spouse'
        )
        if (kids.length > 0) {
          setChildren(kids.map((k: any) => ({ name: k.name, age: k.age, id: k.id })))
        } else {
          const jsonKids = merged.children || []
          setChildren(Array.isArray(jsonKids) ? jsonKids : [])
        }
      } else {
        const jsonKids = merged.children || []
        setChildren(Array.isArray(jsonKids) ? jsonKids : [])
      }

      const rm = merged.risk_management
      if (rm) setRmData({ ...EMPTY_RM, ...rm })
    }
  }

  async function saveData(data: RiskMgmtData) {
    const id = clientIdRef.current
    if (!id) { console.warn('saveData: no clientId'); return }
    setSaving(true)
    try {
      const { data: rows, error: fetchError } = await supabase
        .from('fact_finding')
        .select('id, data')
        .eq('client_id', id)

      if (fetchError) throw fetchError

      if (rows && rows.length > 0) {
        const existingData = rows[0].data || {}
        const { error: updateError } = await supabase
          .from('fact_finding')
          .update({ data: { ...existingData, risk_management: data } })
          .eq('id', rows[0].id)
        if (updateError) throw updateError
      } else {
        const { error: insertError } = await supabase
          .from('fact_finding')
          .insert({ client_id: id, data: { risk_management: data } })
        if (insertError) throw insertError
      }
    } catch (error) {
      console.error('Risk management save error:', error)
      setSaveError(true)
      setTimeout(() => setSaveError(false), 4000)
    } finally {
      setSaving(false)
    }
  }

  function updateRm(next: RiskMgmtData) {
    setRmData(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveData(next), 1000)
  }

  // ── Financial calculations ─────────────────────────────────────────────────
  const ff = ffData || {}
  const inflation = (Number(ff.inflation_rate) || 3) / 100

  const p1Mo = Number(ff.monthly_income || ff.monthlyIncomeClient || ff.person1?.monthly_income || 0)
  const p2Mo = Number(
    ff.person2?.monthly_income ||
    ff.person2?.monthlyIncome  ||
    ff.monthly_income_spouse   ||
    ff.monthlyIncomeSpouse     ||
    ff.spouse_monthly_income   || 0
  )

  const expCats = ['financial_commitments','household','personal','children','lifestyle']
  const p1Exp = expCats.reduce((s,c) => s + Number(ff[`d_${c}`]||0), 0) || (p1Mo*12*0.7)

  const p2ExpRaw = expCats.reduce((s,c) =>
    s + Number(ff[`d2_${c}`] || ff.person2?.[`d_${c}`] || 0), 0
  )
  const p2Exp = p2ExpRaw || (p2Mo * 12 * 0.7) || (p1Exp * 0.7)

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

  function toSGD(val: number, p: Policy) {
    return p.isUSD ? val * (p.fxRate || 1.35) : val
  }
  function annualPremSGD(p: Policy) {
    const cash  = p.isUSD ? (p.premiumCash||0)*(p.fxRate||1.35) : (p.premiumCash||0)
    const total = cash + (p.premiumMedisave||0)
    switch (p.frequency) {
      case 'Semi-Annual': return total * 2
      case 'Quarterly':   return total * 4
      case 'Monthly':     return total * 12
      case 'Single':      return total
      default:            return total // Annual
    }
  }

  // CORE CHANGE: Only reflect active policies for gaps and dashboards
  const activePolicies = rmData.policies.filter(p => ACTIVE_STATUSES.includes(p.status))

  function lifeHave(person: string) {
    return activePolicies.filter(p=>p.person===person&&p.categoryCode==='life')
      .reduce((s,p)=>s+toSGD(Math.max(p.baseDeath||0,p.sumAssured||0),p),0)
  }
  function ciHave(person: string) {
    return activePolicies.filter(p=>p.person===person&&p.categoryCode==='life')
      .reduce((s,p)=>s+toSGD(Math.max(p.baseAdvCI||0,p.baseEarlyCI||0),p),0)
  }
  function premHave(person: string) {
    return activePolicies.filter(p=>p.person===person).reduce((s,p)=>s+annualPremSGD(p),0)
  }

  const cLH = lifeHave('client'), cCH = ciHave('client')
  const sLH = lifeHave('spouse'), sCH = ciHave('spouse')
  const totalPrem = activePolicies.reduce((s,p)=>s+annualPremSGD(p),0)

  // Chart data
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
  const hasChartData = aDTPD > 0 || aCI > 0 || aExp > 0

  // People list for dropdowns
  const allPeople = [
    { key: 'client', label: clientName },
    ...(isCouple ? [{ key: 'spouse', label: spouseName }] : []),
    ...children.map((c: any) => ({
      key: `child_${c.name || c.id}`,
      label: c.name || 'Child',
    })),
  ]

  // Portfolio sections
  const sections = [
    { key: 'client', label: clientName },
    ...(isCouple ? [{ key: 'spouse', label: spouseName }] : []),
    ...(children.length > 0 ? [{
      key: 'dependents',
      label: 'Dependents',
      isDependent: true,
      childKeys: children.map((c: any) => `child_${c.name || c.id || c}`),
    }] : []),
  ]

  function openNew(person: string) {
    const label = allPeople.find(p=>p.key===person)?.label||person
    setEditingPolicy(emptyPolicy(person, label, label))
    setModalPerson(person)
    setShowModal(true)
  }
  function openEdit(p: Policy) { setEditingPolicy({...p}); setModalPerson(p.person); setShowModal(true) }
  
  // Note: savePolicy and delPolicy operate on the full rmData.policies to not lose inactive ones during updates
  function savePolicy(p: Policy) {
    const exists = rmData.policies.find(x=>x.id===p.id)
    const next = exists
      ? {...rmData, policies: rmData.policies.map(x=>x.id===p.id?p:x)}
      : {...rmData, policies: [...rmData.policies, p]}
    updateRm(next); setShowModal(false); setEditingPolicy(null)
  }
  function delPolicy(id: string) { updateRm({...rmData, policies: rmData.policies.filter(p=>p.id!==id)}) }

  return (
    <div style={{minHeight:'100vh',background:'var(--cream)',display:'flex',flexDirection:'column'}}>
      {/* Hero */}
      <div style={{background:'#1C1A17',padding:'0 48px'}}>
        <div style={{paddingTop:32,paddingBottom:28,display:'flex',alignItems:'flex-end',justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:11,letterSpacing:'0.15em',textTransform:'uppercase',color:'rgba(200,169,110,0.8)',marginBottom:6}}>Risk Management</div>
            <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:32,fontWeight:300,color:'#F0EDE8'}}>Wealth Protection — {clientName}</div>
          </div>
          <div style={{display:'flex',gap:16,alignItems:'center',paddingBottom:4}}>
            {saveError && <span style={{fontSize:12,color:'#E53935',fontWeight:500}}>⚠ Save failed</span>}
            {saving && !saveError && <span style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>Saving…</span>}
            <div style={{display:'flex',gap:2,background:'rgba(255,255,255,0.06)',borderRadius:6,padding:3}}>
              {(['overview','portfolio'] as const).map(t=>(
                <button key={t} onClick={()=>setActiveTab(t)}
                  style={{padding:'6px 18px',borderRadius:4,border:'none',cursor:'pointer',fontSize:12,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:500,background:activeTab===t?'rgba(200,169,110,0.2)':'transparent',color:activeTab===t?'#c8a96e':'rgba(255,255,255,0.45)'}}>
                  {t==='overview'?'Overview':'Portfolio'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
            {/* ── OVERVIEW ── */}
      {activeTab==='overview' && (
        <div style={{padding:'36px 48px',flex:1}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:32}}>
            {[
              {label:'Total Active Policies',value:String(activePolicies.length),sub:'all insured persons'},
              {label:'Annual Premium',value:fmt(totalPrem),sub:'combined portfolio'},
              {label:`${aName} — D/TPD Gap`,value:fmt(Math.max(0,aDTPD-aLH)),sub:aDTPD>0?`Need ${fmt(aDTPD)}`:'Complete profile first'},
              {label:`${aName} — CI Gap`,value:fmt(Math.max(0,aCI-aCH)),sub:aCI>0?`Need ${fmt(aCI)}`:'Complete profile first'},
            ].map(c=>(
              <div key={c.label} style={{background:'white',border:'0.5px solid var(--line)',padding:'18px 22px'}}>
                <div style={{fontSize:10,letterSpacing:'0.13em',textTransform:'uppercase',color:'var(--ink3)',marginBottom:8}}>{c.label}</div>
                <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:26,color:'var(--ink)',fontWeight:300}}>{c.value}</div>
                <div style={{fontSize:11,color:'var(--ink3)',marginTop:2}}>{c.sub}</div>
              </div>
            ))}
          </div>

          {isCouple && (
            <div style={{display:'flex',gap:6,marginBottom:20}}>
              {(['client','spouse'] as const).map(p=>(
                <button key={p} onClick={()=>setOverviewPerson(p)}
                  style={{padding:'7px 20px',border:`1px solid ${overviewPerson===p?'#c8a96e':'var(--line)'}`,background:overviewPerson===p?'#FDF6EC':'white',color:overviewPerson===p?'#A8834A':'var(--ink3)',cursor:'pointer',fontSize:12,fontWeight:overviewPerson===p?600:400}}>
                  {p==='client'?clientName:spouseName}
                </button>
              ))}
            </div>
          )}

          <GapSection title={`${aName} — Coverage Gap Analysis`}
            dtpdNeed={aDTPD} ciNeed={aCI} lifeHave={aLH} ciHave={aCH}
            mortgageNeed={mort} educationNeed={edu} annualPremium={premHave(overviewPerson)} />

          {hasChartData ? (
            <div style={{marginTop:24,display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
              <CoverageChart
                title="Death / TPD Coverage Needs Analysis"
                needLabel="Required Family Protection Capital"
                haveLabel="Existing Family Protection"
                data={chartData.map(d=>({age:d.age,need:d.dtpd,have:aLH}))}
                needColor="#00BCD4"
              />
              <CoverageChart
                title="Critical Illness Coverage Needs Analysis"
                needLabel="Required Critical Illness Protection"
                haveLabel="Existing Critical Illness Protection"
                data={chartData.map(d=>({age:d.age,need:d.ci,have:aCH}))}
                needColor="#00BCD4"
              />
            </div>
          ) : (
            <div style={{marginTop:20,padding:'24px',background:'white',border:'0.5px solid var(--line)',textAlign:'center',fontSize:13,color:'var(--ink3)'}}>
              Complete the Financial Profile to generate coverage need charts.
            </div>
          )}

          <div style={{marginTop:28,background:'white',border:'0.5px solid var(--line)',padding:26}}>
            <div style={{fontSize:10,letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink3)',marginBottom:12}}>Advisor Notes</div>
            <textarea value={rmData.advisorNotes} onChange={e=>updateRm({...rmData,advisorNotes:e.target.value})}
              placeholder="Record observations, client concerns, agreed priorities, follow-up actions…" rows={4}
              style={{width:'100%',resize:'vertical',border:'none',outline:'none',background:'#1C1A17',color:'#c8a96e',fontFamily:'DM Mono,monospace',fontSize:13,padding:'14px 16px',borderRadius:4,boxSizing:'border-box',lineHeight:1.7}} />
          </div>
        </div>
      )}

      {/* ── PORTFOLIO ── */}
      {activeTab==='portfolio' && (
        <div style={{padding:'36px 48px',flex:1}}>
          {/* Header row */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}} className="no-print">
            <div>
              <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:22,color:'var(--ink)'}}>Wealth Protection Portfolio</div>
              <div style={{fontSize:12,color:'var(--ink3)',marginTop:2}}>{activePolicies.length} active {activePolicies.length===1?'policy':'policies'} · Total annual premium {fmt(totalPrem)}</div>
            </div>
            <button onClick={()=>window.print()} style={{padding:'8px 18px',background:'#c8a96e',color:'white',border:'none',cursor:'pointer',fontSize:12}}>Print / PDF</button>
          </div>

          {/* Person tabs */}
          <div style={{display:'flex',gap:0,marginBottom:28,borderBottom:'1px solid var(--line)'}} className="no-print">
            {sections.map(({key,label,isDependent,childKeys})=>{
              const tabPolicies = isDependent&&childKeys
                ? activePolicies.filter(p=>childKeys.includes(p.person))
                : activePolicies.filter(p=>p.person===key)
              const tabPrem = tabPolicies.reduce((s,p)=>s+annualPremSGD(p),0)
              const isActive = portfolioPerson===key
              return (
                <button key={key} onClick={()=>setPortfolioPerson(key)}
                  style={{padding:'10px 22px',border:'none',borderBottom:`2px solid ${isActive?'#c8a96e':'transparent'}`,background:'transparent',cursor:'pointer',fontSize:13,color:isActive?'#A8834A':'var(--ink3)',fontWeight:isActive?600:400,transition:'all 0.15s',display:'flex',flexDirection:'column',alignItems:'flex-start',gap:2}}>
                  <span>{label}</span>
                  <span style={{fontSize:10,color:isActive?'#c8a96e':'var(--ink3)',fontFamily:'DM Mono,monospace',fontWeight:400}}>
                    {tabPolicies.length} {tabPolicies.length===1?'policy':'policies'}{tabPrem>0?` · ${fmt(tabPrem)}`:''}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Active person's policies */}
          {sections.map(({key,label,isDependent,childKeys})=>{
            if (portfolioPerson!==key) return null
            const policies = isDependent&&childKeys
              ? activePolicies.filter(p=>childKeys.includes(p.person))
              : activePolicies.filter(p=>p.person===key)
            
            const inactiveTabPols = isDependent&&childKeys
              ? rmData.policies.filter(p=>!ACTIVE_STATUSES.includes(p.status) && childKeys.includes(p.person))
              : rmData.policies.filter(p=>!ACTIVE_STATUSES.includes(p.status) && p.person===key)

            const addKey = isDependent&&childKeys ? (childKeys[0]||key) : key
            const secPrem = policies.reduce((s,p)=>s+annualPremSGD(p),0)
            const personAge = key==='client' ? clientAge : spouseAge

            // Category buckets
            const catBuckets = [
              { code:'medical',    label:'Medical Insurance',                    accent:'#7A9CBF', hint:'Medical & hospitalisation coverage' },
              { code:'ltc',        label:'Long Term Disability Care Insurance',  accent:'#9B7BAA', hint:'LTC / disability income protection' },
              { code:'general',    label:'General Insurance',                    accent:'#8A9A7E', hint:'Personal accident, travel, maid' },
              { code:'life',       label:'Core Protection',                      accent:'#c8a96e', hint:'Life, WL, Term, UL, IUL, VUL' },
              { code:'endowment',  label:'Wealth Accumulation Portfolio',        accent:'#B8956A', hint:'Endowment, annuity, investments, ILP' },
            ]

            return (
              <div key={key}>
                {/* Luxury charts — only for named persons (not dependents) */}
                {!isDependent && policies.length > 0 && (
                  <>
                    <PersonPortfolioCharts
                      personName={label}
                      personAge={personAge}
                      policies={policies}
                    />
                    <div style={{pageBreakAfter: 'always'}} />
                  </>
                )}

                {/* Category-separated policy sections */}
                {policies.length===0 ? (
                  <div style={{background:'white',border:'0.5px dashed var(--line)',padding:'32px',textAlign:'center',fontSize:13,color:'var(--ink3)',marginTop: !isDependent ? 32 : 0}}>
                    No active policies recorded for {label}
                    <div style={{marginTop:12}}>
                      <button onClick={()=>openNew(addKey)} className="no-print"
                        style={{padding:'7px 18px',background:'var(--ink)',color:'white',border:'none',cursor:'pointer',fontSize:12}}>
                        + Add First Policy
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{marginTop: !isDependent ? 32 : 0}}>
                    {/* Section header with Add Policy */}
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <div style={{width:3,height:18,background:isDependent?'#7B9E87':'#c8a96e'}}/>
                        <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:18,color:'var(--ink)'}}>{label}</div>
                        {isDependent && <span style={{fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink3)',padding:'2px 7px',border:'1px solid var(--line)'}}>Dependent</span>}
                        {secPrem>0 && <span style={{fontSize:12,color:'var(--ink3)',marginLeft:8}}>Annual premium: <strong style={{fontFamily:'DM Mono,monospace',color:'var(--ink)'}}>{fmt(secPrem)}</strong></span>}
                      </div>
                      <button onClick={()=>openNew(addKey)} className="no-print"
                        style={{padding:'7px 16px',background:isDependent?'#F5FAF6':'var(--ink)',color:isDependent?'#2D6A4F':'white',border:isDependent?'1px solid #7B9E87':'none',cursor:'pointer',fontSize:12}}>
                        + Add Policy
                      </button>
                    </div>

                    {/* One block per category that has policies */}
                    {catBuckets.map(cat=>{
                      const catPols = policies.filter(p=>p.categoryCode===cat.code)
                      if (catPols.length===0) return null
                      const catPrem = catPols.reduce((s,p)=>s+annualPremSGD(p),0)
                      const isEssential = ['medical','ltc','general'].includes(cat.code)
                      const isLifeOrEndowment = ['life','endowment'].includes(cat.code)
                      
                      return (
                        <div key={cat.code} style={{marginBottom:28}}>
                          {cat.code === 'life' && <div style={{pageBreakBefore: 'always'}} />}
                          {/* Category header */}
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,paddingBottom:8,borderBottom:`1px solid ${cat.accent}22`}}>
                            <div style={{display:'flex',alignItems:'center',gap:10}}>
                              <div style={{width:2,height:14,background:cat.accent,flexShrink:0}}/>
                              <span style={{fontSize:11,fontWeight:600,color:'var(--ink)',letterSpacing:'0.04em'}}>{cat.label}</span>
                              <span style={{fontSize:10,color:'var(--ink3)',borderLeft:'1px solid var(--line)',paddingLeft:10}}>{cat.hint}</span>
                              <span style={{fontSize:10,color:cat.accent,fontFamily:'DM Mono,monospace',marginLeft:4}}>
                                {catPols.length} {catPols.length===1?'policy':'policies'}
                              </span>
                            </div>
                            {catPrem>0 && (
                              <span style={{fontSize:11,color:'var(--ink3)'}}>
                                <strong style={{fontFamily:'DM Mono,monospace',color:'var(--ink)'}}>{fmt(catPrem)}</strong>/yr
                              </span>
                            )}
                          </div>
                          <PolicyTable
                            policies={catPols}
                            catShort={CAT_SHORT}
                            catColors={CAT_COLORS}
                            onEdit={openEdit}
                            onDelete={delPolicy}
                          />
                          
                          {/* Policy Remarks - Attached to table */}
                          {catPols.some(p => p.remarks && p.remarks.trim() !== '') && (
                            <div style={{
                              padding: '16px 18px',
                              background: '#FAFAF8',
                              borderLeft: '1px solid var(--line)',
                              borderRight: '1px solid var(--line)',
                              borderBottom: '1px solid var(--line)',
                              borderTop: '1px dashed var(--line)'
                            }}>
                              {catPols.filter(p => p.remarks && p.remarks.trim() !== '').map((p, idx) => (
                                <div key={p.id} style={{
                                  marginBottom: idx === catPols.filter(p => p.remarks && p.remarks.trim() !== '').length - 1 ? 0 : 12,
                                  paddingBottom: idx === catPols.filter(p => p.remarks && p.remarks.trim() !== '').length - 1 ? 0 : 12,
                                  borderBottom: idx === catPols.filter(p => p.remarks && p.remarks.trim() !== '').length - 1 ? 'none' : '1px solid var(--line)',
                                  fontSize: 12,
                                  color: 'var(--ink2)',
                                  lineHeight: 1.6
                                }}>
                                  <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>
                                    {p.companyName} {p.productName}
                                  </strong>
                                  {' '}{p.remarks}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                
                {/* ── Inactive Policies Toggle ── */}
                {inactiveTabPols.length > 0 && (
                  <div style={{ marginTop: 40, borderTop: '1px dashed var(--line)', paddingTop: 24 }}>
                    <button
                      onClick={() => setShowInactive(!showInactive)}
                      className="no-print"
                      style={{
                        padding: '8px 16px', background: showInactive ? '#F8F7F4' : 'white',
                        border: '1px solid var(--line)', color: 'var(--ink3)',
                        cursor: 'pointer', fontSize: 12, borderRadius: 4, transition: 'all 0.2s'
                      }}
                    >
                      {showInactive ? 'Hide Inactive Policies' : `Show Inactive Policies (${inactiveTabPols.length})`}
                    </button>

                    {showInactive && (
                      <div style={{ marginTop: 24, opacity: 0.8 }}>
                        <div style={{ fontSize: 14, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 16 }}>Inactive / Terminated Policies</div>
                        {catBuckets.map(cat => {
                          const catPols = inactiveTabPols.filter(p => p.categoryCode === cat.code)
                          if (catPols.length === 0) return null
                          return (
                            <div key={`inactive-${cat.code}`} style={{ marginBottom: 28 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${cat.accent}22` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div style={{ width: 2, height: 14, background: cat.accent, flexShrink: 0 }} />
                                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', letterSpacing: '0.04em' }}>{cat.label} (Inactive)</span>
                                </div>
                              </div>
                              <PolicyTable
                                policies={catPols}
                                catShort={CAT_SHORT}
                                catColors={CAT_COLORS}
                                onEdit={openEdit}
                                onDelete={delPolicy}
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

              </div>
            )
          })}
        </div>
      )}
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

            <style>{`
        @media print {
          .no-print { display: none !important; }
          aside, nav { display: none !important; }
          body { background: white !important; }
          
          @page {
            size: A4 landscape;
            margin: 1cm;
          }
          
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </div>
  )
}

// ─── Coverage Chart ───────────────────────────────────────────────────────────
function CoverageChart({title,needLabel,haveLabel,data,needColor}:{title:string;needLabel:string;haveLabel:string;data:{age:number;need:number;have:number}[];needColor:string}) {
  const W=520,H=240,PL=72,PR=12,PT=16,PB=32
  const iW=W-PL-PR, iH=H-PT-PB
  if (!data.length) return null
  const maxV = Math.max(...data.map(d=>d.need),1)
  const minA=data[0].age, aR=data[data.length-1].age-minA||1
  const xP=(a:number)=>((a-minA)/aR)*iW
  const yP=(v:number)=>iH-Math.min(1,v/maxV)*iH
  const path=data.map((d,i)=>`${i===0?'M':'L'}${(PL+xP(d.age)).toFixed(1)},${(PT+yP(d.need)).toFixed(1)}`).join(' ')
  const ticks=[0,.25,.5,.75,1]
  const bW=Math.max(1.5,iW/data.length-0.5)
  const fmtAx=(n:number)=>n>=1e6?`$${(n/1e6).toFixed(1)}M`:n>=1e3?`$${(n/1e3).toFixed(0)}K`:`$${n.toFixed(0)}`
  return (
    <div style={{background:'white',border:'0.5px solid var(--line)',padding:'18px 22px'}}>
      <div style={{fontSize:13,fontWeight:500,color:'var(--ink)',marginBottom:8}}>{title}</div>
      <div style={{display:'flex',gap:14,marginBottom:10}}>
        {[{col:'#4A90BF',lbl:haveLabel,bar:true},{col:needColor,lbl:needLabel,bar:false}].map(l=>(
          <div key={l.lbl} style={{display:'flex',alignItems:'center',gap:5}}>
            {l.bar?<div style={{width:18,height:10,background:l.col,opacity:.65}}/>:<svg width="20" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke={l.col} strokeWidth="2"/></svg>}
            <span style={{fontSize:10,color:'var(--ink3)'}}>{l.lbl}</span>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{overflow:'visible'}}>
        {ticks.map(f=>{const y=PT+iH-f*iH;return(<g key={f}><line x1={PL} y1={y} x2={PL+iW} y2={y} stroke="#E8E6E2" strokeWidth=".5"/><text x={PL-5} y={y+3} fontSize="8" fill="#999" textAnchor="end">{fmtAx(maxV*f)}</text></g>)})}
        {data.map(d=><rect key={d.age} x={PL+xP(d.age)-bW/2} y={PT+yP(d.have)} width={bW} height={Math.max(0,iH-yP(d.have))} fill="#4A90BF" opacity=".6"/>)}
        <path d={path} stroke={needColor} strokeWidth="1.8" fill="none" strokeLinejoin="round"/>
        <line x1={PL} y1={PT+iH} x2={PL+iW} y2={PT+iH} stroke="#CCC" strokeWidth=".5"/>
        {data.filter((_,i)=>i%4===0).map(d=><text key={d.age} x={PL+xP(d.age)} y={PT+iH+12} fontSize="8" fill="#999" textAnchor="middle">{d.age}</text>)}
      </svg>
    </div>
  )
}

// ─── Gap Section ──────────────────────────────────────────────────────────────
function GapSection({title,dtpdNeed,ciNeed,lifeHave,ciHave,mortgageNeed,educationNeed,annualPremium}:{title:string;dtpdNeed:number;ciNeed:number;lifeHave:number;ciHave:number;mortgageNeed:number;educationNeed:number;annualPremium:number}) {
  const rows=[
    {label:'Life / Death & TPD',need:dtpdNeed,have:lifeHave},
    {label:'Critical Illness',need:ciNeed,have:ciHave},
    ...(mortgageNeed>0?[{label:'Mortgage Clearance',need:mortgageNeed,have:0}]:[]),
    ...(educationNeed>0?[{label:"Children's Education",need:educationNeed,have:0}]:[]),
  ]
  return (
    <div style={{background:'white',border:'0.5px solid var(--line)'}}>
      <div style={{padding:'14px 24px',borderBottom:'0.5px solid var(--line)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:3,height:16,background:'#c8a96e'}}/>
          <span style={{fontSize:13,fontWeight:500,color:'var(--ink)'}}>{title}</span>
        </div>
        {annualPremium>0&&<span style={{fontSize:12,color:'var(--ink3)'}}>Portfolio premium: <strong style={{fontFamily:'DM Mono,monospace',color:'var(--ink)'}}>{fmt(annualPremium)}/yr</strong></span>}
      </div>
      {dtpdNeed===0&&ciNeed===0?(
        <div style={{padding:'24px',textAlign:'center',fontSize:13,color:'var(--ink3)'}}>Complete the Financial Profile to see gap analysis.</div>
      ):(
        <>
          <div style={{display:'grid',gridTemplateColumns:'1fr 130px 130px 130px 100px',padding:'9px 24px',background:'#FAFAF8',borderBottom:'0.5px solid var(--line)'}}>
            {['COVERAGE AREA','NEED','HAVE','GAP','STATUS'].map(h=><div key={h} style={{fontSize:10,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--ink3)'}}>{h}</div>)}
          </div>
          {rows.map((row,i)=>{const gap=row.need-row.have;const st=gapSt(row.need,row.have);return(
            <div key={row.label} style={{display:'grid',gridTemplateColumns:'1fr 130px 130px 130px 100px',padding:'12px 24px',alignItems:'center',borderBottom:i<rows.length-1?'0.5px solid var(--line)':'none',background:i%2===0?'white':'#FAFAF8'}}>
              <span style={{fontSize:13,color:'var(--ink)'}}>{row.label}</span>
              <span style={{fontFamily:'DM Mono,monospace',fontSize:13}}>{fmt(row.need)}</span>
              <span style={{fontFamily:'DM Mono,monospace',fontSize:13,color:row.have>0?'#2D6A4F':'var(--ink3)'}}>{row.have>0?fmt(row.have):'—'}</span>
              <span style={{fontFamily:'DM Mono,monospace',fontSize:13,color:gap>0?'#9B1C1C':'#2D6A4F',fontWeight:gap>0?600:400}}>{gap>0?fmt(gap):'✓ Covered'}</span>
              <span style={{fontSize:11,fontWeight:600,padding:'2px 9px',borderRadius:3,background:st.bg,color:st.color}}>{st.label}</span>
            </div>
          )})}
          <div style={{padding:'14px 24px',borderTop:'0.5px solid var(--line)',background:'#FAFAF8',display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
            {[{l:'Life / D&TPD',n:dtpdNeed,h:lifeHave},{l:'Critical Illness',n:ciNeed,h:ciHave}].map(b=>{
              const pct=b.n>0?Math.min(100,(b.h/b.n)*100):0
              return(<div key={b.l}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                  <span style={{fontSize:10,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'0.07em'}}>{b.l}</span>
                  <span style={{fontSize:10,color:'var(--ink3)'}}>{Math.round(pct)}% covered</span>
                </div>
                <div style={{height:4,background:'#E5E3DF',borderRadius:2}}>
                  <div style={{height:'100%',borderRadius:2,width:`${pct}%`,background:pct>=100?'#2D6A4F':pct>50?'#c8a96e':'#C0392B'}}/>
                </div>
              </div>)
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Policy Table ─────────────────────────────────────────────────────────────
function PolicyTable({policies,catShort,catColors,onEdit,onDelete}:{policies:Policy[];catShort:Record<string,string>;catColors:Record<string,string>;onEdit:(p:Policy)=>void;onDelete:(id:string)=>void}) {
  function _sub(p: Policy) {
    const cash = p.isUSD ? (p.premiumCash||0)*(p.fxRate||1.35) : (p.premiumCash||0)
    const total = cash + (p.premiumMedisave||0)
    switch (p.frequency) {
      case 'Semi-Annual': return total*2
      case 'Quarterly':   return total*4
      case 'Monthly':     return total*12
      case 'Single':      return total
      default:            return total
    }
  }
  
  // Helper to convert benefit to SGD for subtotal
  function toSGDValue(val: number, p: Policy) {
    return p.isUSD ? val * (p.fxRate || 1.35) : val
  }
  
  const sub = policies.reduce((s,p)=>s+_sub(p),0)

  // Detect category — all policies in this table share the same category
  const cat = policies[0]?.categoryCode || 'life'
  const isEssential = ['medical','ltc','general'].includes(cat)
  const isLife = cat === 'life'
  const isEndowment = cat === 'endowment'

  // ── Essential layout (Medical / LTC / General) ──────────────────────────────
  if (isEssential) {
    const hasMedisave = policies.some(p=>(p.premiumMedisave||0)>0)
    // Grid: INSURER (1.2fr) | BRIEF DESC (1.5fr) | MEDISAVE (100px) | PREMIUM (100px) | FREQ/MODE (90px) | DATES (160px) | ACTIONS (40px)
    const cols = hasMedisave
      ? '1.2fr 1.5fr 100px 100px 90px 160px 40px'
      : '1.2fr 1.5fr 100px 90px 160px 40px'
    const headers = hasMedisave
      ? ['INSURER · PLAN · PH / LA', 'BRIEF DESCRIPTION', 'PREM (MEDISAVE)', 'PREMIUM', 'FREQ / MODE', 'DATES', '']
      : ['INSURER · PLAN · PH / LA', 'BRIEF DESCRIPTION', 'PREMIUM', 'FREQ / MODE', 'DATES', '']
    return (
      <div style={{background:'white',border:'0.5px solid var(--line)'}}>
        <div style={{display:'grid',gridTemplateColumns:cols,padding:'8px 18px',borderBottom:'1px solid var(--line)',background:'#FAFAF8'}}>
          {headers.map(h=>(
            <div key={h} style={{fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink3)'}}>{h}</div>
          ))}
        </div>
        {policies.map((p,i)=>{
          return (
          <div key={p.id} style={{display:'grid',gridTemplateColumns:cols,padding:'12px 18px',alignItems:'center',borderBottom:i<policies.length-1?'0.5px solid var(--line)':'none',background:i%2===0?'white':'#FAFAF8'}}>
            {/* Insurer · Plan · PH / Policy No */}
            <div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12,fontWeight:500,color:'var(--ink)'}}>{p.companyName||'—'}{p.productName?` · ${p.productName}`:''}</span>
              </div>
              {(p.policyholder||p.lifeAssured)&&<div style={{fontSize:10,color:'var(--ink3)',marginTop:2}}>
                {p.policyholder&&<span>PH: {p.policyholder}</span>}
                {p.lifeAssured&&p.lifeAssured!==p.policyholder&&<span> · LA: {p.lifeAssured}</span>}
              </div>}
              {p.policyNo&&<div style={{fontSize:10,color:'var(--ink3)',marginTop:1,fontFamily:'DM Mono,monospace'}}>{p.policyNo}</div>}
            </div>
            {/* Brief description */}
            <div style={{fontSize:11,color:'var(--ink3)',lineHeight:1.4,paddingRight:8}}>
              {p.briefDescription||'—'}
            </div>
            {/* Medisave premium (only if any policy has it) */}
            {hasMedisave && (
              <div style={{fontFamily:'DM Mono,monospace',fontSize:12,color:(p.premiumMedisave||0)>0?'var(--ink)':'var(--ink3)'}}>
                {(p.premiumMedisave||0)>0 ? fmt(p.premiumMedisave) : '—'}
              </div>
            )}
            {/* Premium (Cash) */}
            <div style={{fontFamily:'DM Mono,monospace',fontSize:12,color:(p.premiumCash||0)>0?'var(--ink)':'var(--ink3)'}}>
              {(p.premiumCash||0)>0 ? fmt(p.premiumCash) : '—'}
            </div>
            {/* Frequency + Mode */}
            <div style={{fontSize:10,color:'var(--ink3)'}}>
              <div>{p.frequency||'—'}</div>
              <div style={{fontSize:9,marginTop:2}}>{p.premiumMode||'—'}</div>
            </div>
            {/* Dates */}
            <div style={{fontSize:10,color:'var(--ink3)',lineHeight:1.4}}>
              <div><span style={{color:'var(--ink2)'}}>Start Date:</span> {formatDate(p.inceptionDate)}</div>
              <div><span style={{color:'var(--ink2)'}}>Premium Term:</span> {formatDate(p.premiumMaturity)}</div>
              <div><span style={{color:'var(--ink2)'}}>Coverage Term:</span> {formatDate(p.coverageMaturity)}</div>
            </div>
            {/* Actions - Compact */}
            <div style={{display:'flex',gap:3}} className="no-print">
              <button onClick={()=>onEdit(p)} style={{fontSize:11,color:'var(--ink3)',background:'none',border:'none',cursor:'pointer',padding:'2px 4px'}} title="Edit">✎</button>
              <button onClick={()=>onDelete(p.id)} style={{fontSize:11,color:'#C0392B',background:'none',border:'none',cursor:'pointer',padding:'2px 4px'}} title="Delete">✕</button>
            </div>
          </div>
        )})}
        {/* Subtotal */}
        {hasMedisave ? (
          <div style={{display:'grid',gridTemplateColumns:cols,padding:'10px 18px',borderTop:'1px solid var(--line)',background:'#F8F7F4'}}>
            <div style={{gridColumn:'span 2',fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink3)'}}>Subtotal</div>
            <div style={{fontFamily:'DM Mono,monospace',fontSize:12,fontWeight:600,color:'var(--ink)'}}>
              {fmt(policies.reduce((s,p)=>s+(p.premiumMedisave||0),0))}
            </div>
            <div style={{fontFamily:'DM Mono,monospace',fontSize:12,fontWeight:600,color:'var(--ink)'}}>
              {fmt(policies.reduce((s,p)=>s+(p.premiumCash||0),0))}
            </div>
            <div />
            <div />
            <div />
          </div>
        ) : (
          <div style={{display:'grid',gridTemplateColumns:cols,padding:'10px 18px',borderTop:'1px solid var(--line)',background:'#F8F7F4'}}>
            <div style={{gridColumn:'span 2',fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink3)'}}>Subtotal</div>
            <div style={{fontFamily:'DM Mono,monospace',fontSize:12,fontWeight:600,color:'var(--ink)'}}>
              {fmt(policies.reduce((s,p)=>s+(p.premiumCash||0),0))}
            </div>
            <div />
            <div />
            <div />
          </div>
        )}
      </div>
    )
  }
    // ── Life layout (Core Protection) ───────────────────────────────────────────
  if (isLife) {
    // Grid: INSURER (1.2fr) | DEATH (90px) | TPD (90px) | ADV CI (90px) | EARLY CI (90px) | PREMIUM (100px) | FREQ/MODE (90px) | DATES (160px) | ACTIONS (40px)
    const cols = '1.2fr 90px 90px 90px 90px 100px 90px 160px 40px'
    return (
      <div style={{background:'white',border:'0.5px solid var(--line)'}}>
        <div style={{display:'grid',gridTemplateColumns:cols,padding:'8px 18px',borderBottom:'1px solid var(--line)',background:'#FAFAF8'}}>
          {['INSURER · PLAN · PH / LA', 'DEATH', 'TPD', 'ADV CI', 'EARLY CI', 'PREMIUM', 'FREQ / MODE', 'DATES', ''].map(h=>(
            <div key={h} style={{fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink3)'}}>{h}</div>
          ))}
        </div>
        {policies.map((p,i)=>{
          const deathBen = getMultipliedBenefit(p, 'death')
          const tpdBen = getMultipliedBenefit(p, 'tpd')
          const advCIBen = getMultipliedBenefit(p, 'advCI')
          const earlyCIBen = getMultipliedBenefit(p, 'earlyCI')
          return(
            <div key={p.id} style={{display:'grid',gridTemplateColumns:cols,padding:'12px 18px',alignItems:'center',borderBottom:i<policies.length-1?'0.5px solid var(--line)':'none',background:i%2===0?'white':'#FAFAF8'}}>
              <div>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:12,fontWeight:500,color:'var(--ink)'}}>{p.companyName||'—'}{p.productName?` · ${p.productName}`:''}</span>
                  {p.isUSD && <span style={{fontSize:9,fontWeight:700,color:'#A8834A',background:'#FDF6EC',border:'1px solid #c8a96e',padding:'1px 5px',borderRadius:2,letterSpacing:'0.06em'}}>USD</span>}
                </div>
                {(p.policyholder||p.lifeAssured)&&<div style={{fontSize:10,color:'var(--ink3)',marginTop:2}}>
                  {p.policyholder&&<span>PH: {p.policyholder}</span>}
                  {p.lifeAssured&&p.lifeAssured!==p.policyholder&&<span> · LA: {p.lifeAssured}</span>}
                </div>}
                {p.policyNo&&<div style={{fontSize:10,color:'var(--ink3)',marginTop:1,fontFamily:'DM Mono,monospace'}}>{p.policyNo}</div>}
              </div>
              {/* Death Benefit */}
              <div style={{fontFamily:'DM Mono,monospace',fontSize:11,color:deathBen>0?'var(--ink)':'var(--ink3)'}}>
                {p.isUSD && deathBen>0 ? (
                  <>
                    <div>USD {Math.round(deathBen).toLocaleString()}</div>
                    <div style={{fontSize:9,color:'var(--ink3)'}}>≈ {fmt(deathBen*(p.fxRate||1.35))}</div>
                  </>
                ) : fmt(deathBen)}
              </div>
              {/* TPD Benefit */}
              <div style={{fontFamily:'DM Mono,monospace',fontSize:11,color:tpdBen>0?'var(--ink)':'var(--ink3)'}}>
                {p.isUSD && tpdBen>0 ? (
                  <>
                    <div>USD {Math.round(tpdBen).toLocaleString()}</div>
                    <div style={{fontSize:9,color:'var(--ink3)'}}>≈ {fmt(tpdBen*(p.fxRate||1.35))}</div>
                  </>
                ) : fmt(tpdBen)}
              </div>
              {/* Adv CI Benefit */}
              <div style={{fontFamily:'DM Mono,monospace',fontSize:11,color:advCIBen>0?'var(--ink)':'var(--ink3)'}}>
                {p.isUSD && advCIBen>0 ? (
                  <>
                    <div>USD {Math.round(advCIBen).toLocaleString()}</div>
                    <div style={{fontSize:9,color:'var(--ink3)'}}>≈ {fmt(advCIBen*(p.fxRate||1.35))}</div>
                  </>
                ) : fmt(advCIBen)}
              </div>
              {/* Early CI Benefit */}
              <div style={{fontFamily:'DM Mono,monospace',fontSize:11,color:earlyCIBen>0?'var(--ink)':'var(--ink3)'}}>
                {p.isUSD && earlyCIBen>0 ? (
                  <>
                    <div>USD {Math.round(earlyCIBen).toLocaleString()}</div>
                    <div style={{fontSize:9,color:'var(--ink3)'}}>≈ {fmt(earlyCIBen*(p.fxRate||1.35))}</div>
                  </>
                ) : fmt(earlyCIBen)}
              </div>
              {/* Premium */}
              <div style={{fontFamily:'DM Mono,monospace',fontSize:12,color:'var(--ink)'}}>
                {fmt(p.premiumCash)}
                {p.premiumMedisave>0&&<div style={{fontSize:10,color:'var(--ink3)'}}>+{fmt(p.premiumMedisave)} MS</div>}
              </div>
              {/* Frequency + Mode */}
              <div style={{fontSize:10,color:'var(--ink3)'}}>
                <div>{p.frequency||'—'}</div>
                <div style={{fontSize:9,marginTop:2}}>{p.premiumMode||'—'}</div>
              </div>
              {/* Dates */}
              <div style={{fontSize:10,color:'var(--ink3)',lineHeight:1.4}}>
                <div><span style={{color:'var(--ink2)'}}>Start Date:</span> {formatDate(p.inceptionDate)}</div>
                <div><span style={{color:'var(--ink2)'}}>Premium Term:</span> {formatDate(p.premiumMaturity)}</div>
                <div><span style={{color:'var(--ink2)'}}>Coverage Term:</span> {formatDate(p.coverageMaturity)}</div>
              </div>
              {/* Actions - Compact */}
              <div style={{display:'flex',gap:3}} className="no-print">
                <button onClick={()=>onEdit(p)} style={{fontSize:11,color:'var(--ink3)',background:'none',border:'none',cursor:'pointer',padding:'2px 4px'}} title="Edit">✎</button>
                <button onClick={()=>onDelete(p.id)} style={{fontSize:11,color:'#C0392B',background:'none',border:'none',cursor:'pointer',padding:'2px 4px'}} title="Delete">✕</button>
              </div>
            </div>
          )
        })}
        {/* Subtotal - with benefit totals */}
        <div style={{display:'grid',gridTemplateColumns:cols,padding:'10px 18px',borderTop:'1px solid var(--line)',background:'#F8F7F4'}}>
          <div style={{fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink3)'}}>Subtotal</div>
          <div style={{fontFamily:'DM Mono,monospace',fontSize:12,fontWeight:600,color:'var(--ink)'}}>
            {fmt(policies.reduce((s,p)=>s+toSGDValue(getMultipliedBenefit(p,'death'),p),0))}
          </div>
          <div style={{fontFamily:'DM Mono,monospace',fontSize:12,fontWeight:600,color:'var(--ink)'}}>
            {fmt(policies.reduce((s,p)=>s+toSGDValue(getMultipliedBenefit(p,'tpd'),p),0))}
          </div>
          <div style={{fontFamily:'DM Mono,monospace',fontSize:12,fontWeight:600,color:'var(--ink)'}}>
            {fmt(policies.reduce((s,p)=>s+toSGDValue(getMultipliedBenefit(p,'advCI'),p),0))}
          </div>
          <div style={{fontFamily:'DM Mono,monospace',fontSize:12,fontWeight:600,color:'var(--ink)'}}>
            {fmt(policies.reduce((s,p)=>s+toSGDValue(getMultipliedBenefit(p,'earlyCI'),p),0))}
          </div>
          <div style={{fontFamily:'DM Mono,monospace',fontSize:12,fontWeight:600,color:'var(--ink)'}}>{fmt(sub)}</div>
          <div/><div/><div/>
        </div>
      </div>
    )
  }

  // ── Endowment layout (Wealth Accumulation) ──────────────────────────────────
  // Grid: INSURER (1.2fr) | DEATH BENEFIT (100px) | PREMIUM (100px) | FREQ/MODE (90px) | DATES (160px) | ACTIONS (40px)
  const cols = '1.2fr 100px 100px 90px 160px 40px'
  return (
    <div style={{background:'white',border:'0.5px solid var(--line)'}}>
      <div style={{display:'grid',gridTemplateColumns:cols,padding:'8px 18px',borderBottom:'1px solid var(--line)',background:'#FAFAF8'}}>
        {['INSURER · PLAN · PH / LA', 'DEATH BENEFIT', 'PREMIUM', 'FREQ / MODE', 'DATES', ''].map(h=>(
          <div key={h} style={{fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink3)'}}>{h}</div>
        ))}
      </div>
      {policies.map((p,i)=>{
        const mainBen = p.baseDeath || p.baseAdvCI || p.monthlyBenefit || p.sumAssured
        return(
          <div key={p.id} style={{display:'grid',gridTemplateColumns:cols,padding:'12px 18px',alignItems:'center',borderBottom:i<policies.length-1?'0.5px solid var(--line)':'none',background:i%2===0?'white':'#FAFAF8'}}>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12,fontWeight:500,color:'var(--ink)'}}>{p.companyName||'—'}{p.productName?` · ${p.productName}`:''}</span>
                {p.isUSD && <span style={{fontSize:9,fontWeight:700,color:'#A8834A',background:'#FDF6EC',border:'1px solid #c8a96e',padding:'1px 5px',borderRadius:2,letterSpacing:'0.06em'}}>USD</span>}
              </div>
              {(p.policyholder||p.lifeAssured)&&<div style={{fontSize:10,color:'var(--ink3)',marginTop:2}}>
                {p.policyholder&&<span>PH: {p.policyholder}</span>}
                {p.lifeAssured&&p.lifeAssured!==p.policyholder&&<span> · LA: {p.lifeAssured}</span>}
              </div>}
              {p.policyNo&&<div style={{fontSize:10,color:'var(--ink3)',marginTop:1,fontFamily:'DM Mono,monospace'}}>{p.policyNo}</div>}
            </div>
            {/* Death Benefit */}
            <div style={{fontFamily:'DM Mono,monospace',fontSize:12,color:'var(--ink)'}}>
              {p.isUSD && mainBen
                ? <>
                    <div>USD {Math.round(mainBen).toLocaleString()}</div>
                    <div style={{fontSize:10,color:'var(--ink3)'}}>≈ {fmt(mainBen*(p.fxRate||1.35))}</div>
                  </>
                : fmt(mainBen)
              }
            </div>
            {/* Premium */}
            <div style={{fontFamily:'DM Mono,monospace',fontSize:12,color:'var(--ink)'}}>
              {fmt(p.premiumCash)}
              {p.premiumMedisave>0&&<div style={{fontSize:10,color:'var(--ink3)'}}>+{fmt(p.premiumMedisave)} MS</div>}
            </div>
            {/* Frequency + Mode */}
            <div style={{fontSize:10,color:'var(--ink3)'}}>
              <div>{p.frequency||'—'}</div>
              <div style={{fontSize:9,marginTop:2}}>{p.premiumMode||'—'}</div>
            </div>
            {/* Dates */}
            <div style={{fontSize:10,color:'var(--ink3)',lineHeight:1.4}}>
              <div><span style={{color:'var(--ink2)'}}>Start Date:</span> {formatDate(p.inceptionDate)}</div>
              <div><span style={{color:'var(--ink2)'}}>Premium Term:</span> {formatDate(p.premiumMaturity)}</div>
              <div><span style={{color:'var(--ink2)'}}>Coverage Term:</span> {formatDate(p.coverageMaturity)}</div>
            </div>
            {/* Actions - Compact */}
            <div style={{display:'flex',gap:3}} className="no-print">
              <button onClick={()=>onEdit(p)} style={{fontSize:11,color:'var(--ink3)',background:'none',border:'none',cursor:'pointer',padding:'2px 4px'}} title="Edit">✎</button>
              <button onClick={()=>onDelete(p.id)} style={{fontSize:11,color:'#C0392B',background:'none',border:'none',cursor:'pointer',padding:'2px 4px'}} title="Delete">✕</button>
            </div>
          </div>
        )
      })}
      {/* Subtotal */}
      <div style={{display:'grid',gridTemplateColumns:cols,padding:'10px 18px',borderTop:'1px solid var(--line)',background:'#F8F7F4'}}>
        <div style={{gridColumn:'1/3',fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink3)'}}>Subtotal</div>
        <div style={{fontFamily:'DM Mono,monospace',fontSize:12,fontWeight:600,color:'var(--ink)'}}>{fmt(sub)}</div>
        <div/><div/><div/>
      </div>
    </div>
  )
}

// ─── Policy Modal (cascading dropdowns) ──────────────────────────────────────
function PolicyModal({policy,personLabel,allPeople,categories,policyTypes,companies,products,onSave,onClose}:{
  policy:Policy; personLabel:string
  allPeople:{key:string;label:string}[]
  categories:InsCategory[]; policyTypes:InsPolicyType[]
  companies:InsCompany[]; products:InsProduct[]
  onSave:(p:Policy)=>void; onClose:()=>void
}) {
  const [form, setForm] = useState<Policy>({...policy})
  const f=(k:keyof Policy,v:any)=>setForm(prev=>({...prev,[k]:v}))
  const isNew = !policy.companyName && !policy.productName

  // USD / FX state
  const [fxLoading, setFxLoading] = useState(false)
  const [fxFetched, setFxFetched] = useState(false)

  // Auto-fetch live USD/SGD rate when USD is toggled on for the first time
  async function fetchFxRate() {
    setFxLoading(true)
    try {
      const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=SGD')
      const data = await res.json()
      const rate = data?.rates?.SGD
      if (rate) { f('fxRate', Math.round(rate * 10000) / 10000); setFxFetched(true) }
    } catch { /* silent — user can type manually */ }
    finally { setFxLoading(false) }
  }

  function handleUSDToggle(val: boolean) {
    f('isUSD', val)
    if (val && !fxFetched && (!form.fxRate || form.fxRate === 1.35)) {
      fetchFxRate()
    }
  }

  // Derived: effective SGD values for USD policy preview
  const fx = form.fxRate || 1.35
  const fmtUSD = (n: number) => n ? 'USD ' + Math.round(n).toLocaleString() : '—'
  const toSGDPreview = (n: number) => form.isUSD ? n * fx : n

  // Find selected category record
  const selCat    = categories.find(c=>c.code===form.categoryCode)
  const filtTypes = selCat ? policyTypes.filter(pt=>pt.category_id===selCat.id) : []
  const filtComps = selCat ? companies.filter(co=>co.category_id===selCat.id) : []
  const selComp   = filtComps.find(co=>co.name===form.companyName)
  // Products only for medical and ltc — others are manual
  const hasProducts = ['medical','ltc'].includes(form.categoryCode)
  const filtProds = selComp && hasProducts ? products.filter(pr=>pr.company_id===selComp.id) : []

  // When category changes, reset downstream
  const onCatChange=(code:string)=>{
    setForm(prev=>({
      ...prev,
      categoryCode:code,
      policyTypeCode:'',
      companyName:'',
      productName:'',
      premiumMaturity: code === 'medical' ? 'Renewable' : (prev.premiumMaturity === 'Renewable' ? '' : prev.premiumMaturity),
      coverageMaturity: code === 'medical' ? 'Renewable' : (prev.coverageMaturity === 'Renewable' ? '' : prev.coverageMaturity),
      benefitTerm: '',
      payoutTerm: ''
    }));
    setIsOtherBenefitTerm(false);
    setIsOtherPayoutTerm(false);
    setPremMatMode('preset');
    setCovMatMode('preset');
  }
  const onCompChange=(name:string)=>{
    setForm(prev=>({...prev,companyName:name,productName:''}))
  }

  const isMedical  = form.categoryCode==='medical'
  const isLTC      = form.categoryCode==='ltc'
  const isLife     = form.categoryCode==='life'
  const isEndow    = form.categoryCode==='endowment'
  const isGeneral  = form.categoryCode==='general'
  const isRider    = form.policyTypeCode?.toLowerCase() === 'rider'

  const ltcProductName = (form.productName || '').trim().toLowerCase();
  const isStandardLTC = isLTC && ['careshield life', 'eldershield 300', 'eldershield 400'].includes(ltcProductName);

  const riderDescOptions = [
    "Coverage for Deductibles, subject to 5% Co-Insurance",
    "Coverage for Deductibles, subject to 10% Co-Insurance",
    "Coverage for Co-Insurance, Subject to Deductible and 5% Co-Insurance",
    "Coverage for Deductibles and Co-Insurance.",
    "Coverage for Outpatient Cancer Treatment and Services (Subject to Deductibles)"
  ];

  const [isOtherRiderDesc, setIsOtherRiderDesc] = useState(() => {
    if (policy.categoryCode === 'medical' && policy.policyTypeCode?.toLowerCase() === 'rider') {
      return !!policy.briefDescription && !riderDescOptions.includes(policy.briefDescription);
    }
    return false;
  });

  const [isOtherBenefitTerm, setIsOtherBenefitTerm] = useState(() => {
    return !!policy.benefitTerm && !['2/6 ADLs', '3/6 ADLs'].includes(policy.benefitTerm);
  });
  const [isOtherPayoutTerm, setIsOtherPayoutTerm] = useState(() => {
    return !!policy.payoutTerm && policy.payoutTerm !== 'Lifetime';
  });

  const [premMatMode, setPremMatMode] = useState<'preset'|'date'|'text'>(() => {
    if (!policy.premiumMaturity) return 'preset';
    if (['Lifetime', 'Renewable', 'Age 67'].includes(policy.premiumMaturity)) return 'preset';
    if (/^\d{4}-\d{2}-\d{2}$/.test(policy.premiumMaturity)) return 'date';
    return 'text';
  });

  const [covMatMode, setCovMatMode] = useState<'preset'|'date'|'text'>(() => {
    if (!policy.coverageMaturity) return 'preset';
    if (['Lifetime', 'Renewable', 'Age 67'].includes(policy.coverageMaturity)) return 'preset';
    if (/^\d{4}-\d{2}-\d{2}$/.test(policy.coverageMaturity)) return 'date';
    return 'text';
  });

  useEffect(() => {
    if (form.categoryCode === 'ltc') {
      let expectedDesc = form.briefDescription || '';
      const prodName = (form.productName || '').trim().toLowerCase();

      if (prodName === 'careshield life') {
        expectedDesc = '$600+/mth Benefit for up to Lifetime for 3/6 ADLs';
      } else if (prodName === 'eldershield 300') {
        expectedDesc = '$300/mth Benefit for up to 60 months for 3/6 ADLs';
      } else if (prodName === 'eldershield 400') {
        expectedDesc = '$400/mth Benefit for up to 72 months for 3/6 ADLs';
      } else {
        const mb = form.monthlyBenefit ? form.monthlyBenefit.toLocaleString() : '0';
        const pt = form.payoutTerm || '[Payout Term]';
        const bt = form.benefitTerm || '[Benefit Term]';
        expectedDesc = `$${mb}/mth Benefit for up to ${pt}, in event of disability of at least ${bt}.`;
      }

      if (form.briefDescription !== expectedDesc) {
        f('briefDescription', expectedDesc);
      }
    }
  }, [form.categoryCode, form.productName, form.monthlyBenefit, form.benefitTerm, form.payoutTerm, form.briefDescription]);

  const s:React.CSSProperties={width:'100%',padding:'8px 10px',border:'1px solid var(--line)',background:'var(--cream)',color:'var(--ink)',fontSize:13,outline:'none'}
  const inp:React.CSSProperties={width:'100%',padding:'8px 10px',border:'1px solid var(--line)',background:'var(--cream)',color:'var(--ink)',fontSize:13,outline:'none',boxSizing:'border-box'}
  const lbl:React.CSSProperties={display:'block',fontSize:9,letterSpacing:'0.13em',textTransform:'uppercase',color:'var(--ink3)',marginBottom:5}
  const g2:React.CSSProperties={display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,alignItems:'flex-end'}
  const g3:React.CSSProperties={display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,alignItems:'flex-end'}
  const g4:React.CSSProperties={display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:14,alignItems:'flex-end'}

  const medPayModes   = ['Cash', 'Giro', 'Credit Card', 'Medisave', 'MS + Cash', 'MS + Giro', 'MS + CC'];
  const ltcPayModes   = ['Cash', 'Medisave', 'MS + Cash', 'MS + CC'];
  const endowPayModes = ['Cash', 'Giro', 'Credit Card', 'CPF OA', 'CPF SA', 'CPF SRS'];
  const currentPayModes = isMedical ? medPayModes : (isLTC ? ltcPayModes : (isEndow ? endowPayModes : PAY_MODES));

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(28,26,23,0.65)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{background:'white',width:'100%',maxWidth:620,maxHeight:'92vh',overflowY:'auto',boxShadow:'0 24px 64px rgba(0,0,0,0.3)'}}>
        <div style={{padding:'18px 26px',borderBottom:'1px solid var(--line)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:20,color:'var(--ink)'}}>{isNew?'Add Policy':'Edit Policy'}</div>
            <div style={{fontSize:12,color:'var(--ink3)',marginTop:2}}>{personLabel}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--ink3)'}}>✕</button>
        </div>

        <div style={{padding:'20px 26px',display:'flex',flexDirection:'column',gap:16}}>

          {/* ── Row 1: Category + Policy Type ── */}
          <div style={g2}>
            <div>
              <label style={lbl}>Category</label>
              <select value={form.categoryCode} onChange={e=>onCatChange(e.target.value)} style={s}>
                {categories.map(c=><option key={c.id} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Policy Type</label>
              <select value={form.policyTypeCode} onChange={e=>f('policyTypeCode',e.target.value)} style={s}>
                <option value="">Select…</option>
                {filtTypes.map(t=><option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
          </div>

          {/* ── Row 2: Policyholder + Life Assured ── */}
          <div style={g2}>
            <div>
              <label style={lbl}>Policyholder</label>
              <select value={form.policyholder} onChange={e=>f('policyholder',e.target.value)} style={s}>
                <option value="">Select…</option>
                {allPeople.map(p=><option key={p.key} value={p.label}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Life Assured</label>
              <select value={form.lifeAssured} onChange={e=>f('lifeAssured',e.target.value)} style={s}>
                <option value="">Select…</option>
                {allPeople.map(p=><option key={p.key} value={p.label}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {/* ── Row 3: Company + Policy No ── */}
          <div style={g2}>
            <div>
              <label style={lbl}>Company</label>
              <select value={form.companyName} onChange={e=>onCompChange(e.target.value)} style={s}>
                <option value="">Select…</option>
                {filtComps.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Policy No.</label>
              <input type="text" value={form.policyNo} onChange={e=>f('policyNo',e.target.value)} placeholder="e.g. 26725497" style={inp}/>
            </div>
          </div>

          {/* ── Row 4: Product Name ── */}
          <div>
            <label style={lbl}>Product Name</label>
            {hasProducts && filtProds.length > 0 ? (
              <select value={form.productName} onChange={e=>f('productName',e.target.value)} style={s}>
                <option value="">Select…</option>
                {filtProds.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}
                <option value="__other">Other (type manually)</option>
              </select>
            ) : (
              <input type="text" value={form.productName} onChange={e=>f('productName',e.target.value)} placeholder="e.g. MyWholeLife Plan" style={inp}/>
            )}
            {form.productName==='__other' && (
              <input type="text" placeholder="Enter product name" onChange={e=>f('productName',e.target.value)} style={{...inp,marginTop:6}}/>
            )}
          </div>
                    {/* ── USD Policy Toggle (Life only) ── */}
          {isLife && (
            <div style={{background: form.isUSD ? '#FDF6EC' : '#FAFAF8', border: `1px solid ${form.isUSD ? '#c8a96e' : 'var(--line)'}`, borderRadius: 4, padding: '12px 16px'}}>
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  {/* Toggle switch */}
                  <div onClick={()=>handleUSDToggle(!form.isUSD)}
                    style={{width:36,height:20,borderRadius:10,background:form.isUSD?'#c8a96e':'#D1CEC9',cursor:'pointer',position:'relative',transition:'background 0.2s',flexShrink:0}}>
                    <div style={{position:'absolute',top:2,left:form.isUSD?18:2,width:16,height:16,borderRadius:'50%',background:'white',boxShadow:'0 1px 3px rgba(0,0,0,0.2)',transition:'left 0.2s'}}/>
                  </div>
                  <div>
                    <div style={{fontSize:12,fontWeight:600,color: form.isUSD ? '#A8834A' : 'var(--ink3)'}}>USD Policy</div>
                    <div style={{fontSize:10,color:'var(--ink3)',marginTop:1}}>Values entered in USD — converted to SGD for gap analysis</div>
                  </div>
                </div>
                {/* FX rate field — only shown when USD is on */}
                {form.isUSD && (
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink3)',marginBottom:4}}>USD / SGD Rate</div>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        <input
                          type="number"
                          step="0.0001"
                          value={form.fxRate||''}
                          onChange={e=>f('fxRate',+e.target.value)}
                          style={{width:80,padding:'5px 8px',border:'1px solid var(--line)',background:'white',fontSize:13,fontFamily:'DM Mono,monospace',outline:'none',textAlign:'right'}}
                        />
                        <button type="button" onClick={fetchFxRate} disabled={fxLoading}
                          style={{padding:'5px 10px',background:'#1C1A17',color:'white',border:'none',cursor:fxLoading?'wait':'pointer',fontSize:10,letterSpacing:'0.05em',opacity:fxLoading?0.6:1}}>
                          {fxLoading ? '…' : '↻ Live'}
                        </button>
                      </div>
                      {fxFetched && <div style={{fontSize:10,color:'#2D6A4F',marginTop:3}}>✓ Live rate fetched</div>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Brief description (Hidden for Life Insurance) ── */}
          {!isLife && (
            <div>
              <label style={lbl}>Brief Description</label>
              {isMedical && form.policyTypeCode?.toLowerCase() === 'main' ? (
                <select value={form.briefDescription} onChange={e=>f('briefDescription',e.target.value)} style={s}>
                  <option value="">Select…</option>
                  <option value="As-Charged Up to Private Hospitals (Subject to Deductible and 10% Co-Insurance)">As-Charged Up to Private Hospitals (Subject to Deductible and 10% Co-Insurance)</option>
                  <option value="As-Charged Up to Government Hospitals Ward A (Subject to Deductible and 10% Co-Insurance)">As-Charged Up to Government Hospitals Ward A (Subject to Deductible and 10% Co-Insurance)</option>
                  <option value="As-Charged Up to Government Hospitals Ward B (Subject to Deductible and 10% Co-Insurance)">As-Charged Up to Government Hospitals Ward B (Subject to Deductible and 10% Co-Insurance)</option>
                  <option value="As-Charged Up to Government Hospitals Ward C (Subject to Deductible and 10% Co-Insurance)">As-Charged Up to Government Hospitals Ward C (Subject to Deductible and 10% Co-Insurance)</option>
                </select>
              ) : isMedical && isRider ? (
                <>
                  <select
                    value={isOtherRiderDesc ? '__other' : form.briefDescription}
                    onChange={e => {
                      if (e.target.value === '__other') {
                        setIsOtherRiderDesc(true);
                        f('briefDescription', '');
                      } else {
                        setIsOtherRiderDesc(false);
                        f('briefDescription', e.target.value);
                      }
                    }}
                    style={s}
                  >
                    <option value="">Select…</option>
                    {riderDescOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    <option value="__other">Others (Type Manually)</option>
                  </select>
                  {isOtherRiderDesc && (
                    <input type="text" value={form.briefDescription} onChange={e=>f('briefDescription',e.target.value)} placeholder="Please type description manually..." style={{...inp, marginTop: 6}}/>
                  )}
                </>
              ) : (
                <input type="text" value={form.briefDescription} onChange={e=>f('briefDescription',e.target.value)} placeholder="e.g. As-Charged Coverage Up to Private Hospitals" style={inp} readOnly={isLTC} />
              )}
            </div>
          )}

          {/* ── Life / WL benefit fields ── */}
          {isLife && (
            <>
              {form.isUSD && (
                <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',background:'#FDF6EC',border:'1px solid #c8a96e',borderRadius:3}}>
                  <span style={{fontSize:10,color:'#A8834A',fontWeight:600,letterSpacing:'0.08em'}}>USD POLICY</span>
                  <span style={{fontSize:10,color:'var(--ink3)'}}>Enter all benefit amounts in USD · SGD equivalents shown at {fx.toFixed(4)} rate</span>
                </div>
              )}
              <div style={g4}>
                {([
                  {fl:'Base Death',    key:'baseDeath'   as const},
                  {fl:'Base TPD',      key:'baseTPD'     as const},
                  {fl:'Base Adv CI',   key:'baseAdvCI'   as const},
                  {fl:'Base Early CI', key:'baseEarlyCI' as const},
                ]).map(({fl,key})=>(
                  <div key={key}>
                    <label style={lbl}>{fl} ({form.isUSD?'USD':'SGD'})</label>
                    <input type="number" value={(form[key] as number)||''} onChange={e=>f(key,+e.target.value)} style={inp}/>
                    {form.isUSD && (form[key] as number)>0 && (
                      <div style={{fontSize:10,color:'var(--ink3)',marginTop:3,fontFamily:'DM Mono,monospace'}}>≈ {fmt(toSGDPreview(form[key] as number))} SGD</div>
                    )}
                  </div>
                ))}
              </div>
              <div style={g4}>
                <div><label style={lbl}>Multiplier</label><input type="number" value={form.multiplier||''} onChange={e=>f('multiplier',+e.target.value)} style={inp}/></div>
                <div><label style={lbl}>Multiplier End (Age)</label><input type="number" value={form.multiplierEnd||''} onChange={e=>f('multiplierEnd',+e.target.value)} style={inp}/></div>
                <div><label style={lbl}>Cover Step down (yrs)</label><input type="number" value={form.coverStep||''} onChange={e=>f('coverStep',+e.target.value)} placeholder="Leave empty if none" style={inp}/></div>
                <div><label style={lbl}>Step Down (%)</label><input type="number" value={form.stepDownPct||''} onChange={e=>f('stepDownPct',+e.target.value)} style={inp}/></div>
              </div>
              {(form.multiplier || 0) > 1 && (
                <div style={{padding:'16px',background:'#FAFAF8',border:'1px solid var(--line)',borderRadius:4,marginTop:4}}>
                  <div style={{fontSize:10,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--ink3)',marginBottom:12,fontWeight:600}}>
                    Coverage with Multiplier (x{form.multiplier}){form.isUSD?' — SGD Equivalent':''}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:14,marginBottom:form.multiplierEnd?16:0}}>
                    {([
                      {dl:'DEATH',    base:form.baseDeath||0},
                      {dl:'TPD',      base:form.baseTPD||0},
                      {dl:'ADV CI',   base:form.baseAdvCI||0},
                      {dl:'EARLY CI', base:form.baseEarlyCI||0},
                    ]).map(({dl,base})=>(
                      <div key={dl}>
                        <div style={{fontSize:9,color:'var(--ink3)',marginBottom:2}}>{dl}</div>
                        <div style={{fontFamily:'DM Mono,monospace',fontSize:13,color:'var(--ink)',fontWeight:500}}>{fmt(toSGDPreview(base*form.multiplier))}</div>
                        {form.isUSD && <div style={{fontSize:9,color:'var(--ink3)',marginTop:1}}>{fmtUSD(base*form.multiplier)}</div>}
                      </div>
                    ))}
                  </div>
                  {form.multiplierEnd ? (
                    <>
                      <div style={{fontSize:10,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--ink3)',marginBottom:12,paddingTop:16,borderTop:'1px dashed var(--line)',fontWeight:600}}>
                        Lifetime Coverage (After Age {form.multiplierEnd}){form.isUSD?' — SGD Equivalent':''}
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:14}}>
                        {(()=>{
                          const stepYrs=form.coverStep||0; const stepPct=form.stepDownPct||0
                          const getLifetime=(base:number)=>{
                            if(!base)return 0
                            if(stepYrs>0&&stepPct>0){
                              const finalFactor=Math.max(0,1-stepYrs*(stepPct/100))
                              return Math.max(base,(base*form.multiplier)*finalFactor)
                            }
                            return base
                          }
                          return ([
                            {dl:'DEATH',    base:form.baseDeath||0},
                            {dl:'TPD',      base:form.baseTPD||0},
                            {dl:'ADV CI',   base:form.baseAdvCI||0},
                            {dl:'EARLY CI', base:form.baseEarlyCI||0},
                          ]).map(({dl,base})=>(
                            <div key={dl}>
                              <div style={{fontSize:9,color:'var(--ink3)',marginBottom:2}}>{dl}</div>
                              <div style={{fontFamily:'DM Mono,monospace',fontSize:13,color:'var(--ink)',fontWeight:500}}>{fmt(toSGDPreview(getLifetime(base)))}</div>
                              {form.isUSD && <div style={{fontSize:9,color:'var(--ink3)',marginTop:1}}>{fmtUSD(getLifetime(base))}</div>}
                            </div>
                          ))
                        })()}
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </>
          )}

          {/* ── Endowment / Annuity / Investment benefit fields ── */}
          {isEndow && (
            <>
              {/* Current Cash Value first — needed to compute % benefits below */}
              <div>
                <label style={lbl}>Current Cash Value ($)</label>
                <input type="number" value={form.currentCashValue||''} onChange={e=>f('currentCashValue',+e.target.value)} style={inp}/>
              </div>
              {/* Death / TPD with $/% toggle — % mode stores computed $ amount */}
              {([
                { label:'Death Benefit', modeKey:'endowDeathMode' as const, valKey:'baseDeath' as const },
                { label:'TPD Benefit',   modeKey:'endowTPDMode'   as const, valKey:'baseTPD'   as const },
              ]).map(({ label, modeKey, valKey }) => {
                const mode    = (form[modeKey] as '%'|'$') || '$'
                const cashVal = form.currentCashValue || 0
                // In $ mode: valKey holds the dollar amount directly
                // In % mode: valKey holds the computed dollar amount; we back-calculate % for display
                const storedDollar = (form[valKey] as number) || 0
                const displayPct   = mode==='%' && cashVal>0 ? Math.round((storedDollar/cashVal)*10000)/100 : 0
                return (
                  <div key={valKey}>
                    <label style={lbl}>{label}</label>
                    <div style={{display:'flex',gap:0}}>
                      <div style={{display:'flex',border:'1px solid var(--line)',borderRight:'none',borderRadius:'3px 0 0 3px',overflow:'hidden',flexShrink:0}}>
                        {(['$','%'] as const).map(m=>(
                          <button key={m} type="button" onClick={()=>f(modeKey,m)}
                            style={{padding:'8px 12px',border:'none',cursor:'pointer',fontSize:13,fontWeight:mode===m?600:400,background:mode===m?'#1C1A17':'var(--cream)',color:mode===m?'white':'var(--ink3)',transition:'all 0.1s'}}>
                            {m}
                          </button>
                        ))}
                      </div>
                      {mode==='$' ? (
                        <input type="number" value={storedDollar||''}
                          onChange={e=>f(valKey,+e.target.value)}
                          placeholder="e.g. 500000"
                          style={{...inp,borderRadius:'0 3px 3px 0',flex:1}}/>
                      ) : (
                        <input type="number"
                          value={displayPct||''}
                          onChange={e=>{
                            const pct = +e.target.value
                            f(valKey, cashVal>0 ? Math.round((pct/100)*cashVal) : 0)
                          }}
                          placeholder="e.g. 105"
                          style={{...inp,borderRadius:'0 3px 3px 0',flex:1}}/>
                      )}
                    </div>
                    {mode==='%' && cashVal>0 && storedDollar>0 && (
                      <div style={{fontSize:11,color:'var(--ink3)',marginTop:4,fontFamily:'DM Mono,monospace'}}>
                        = {fmt(storedDollar)} <span style={{fontFamily:'Inter,sans-serif',fontSize:10}}>({displayPct}% of {fmt(cashVal)})</span>
                      </div>
                    )}
                    {mode==='%' && cashVal===0 && (
                      <div style={{fontSize:11,color:'#854F0B',marginTop:4}}>Enter Current Cash Value above to compute amount</div>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {/* ── General sum assured ── */}
          {isGeneral && (
            <div><label style={lbl}>Sum Assured / Coverage Limit ($)</label><input type="number" value={form.sumAssured||''} onChange={e=>f('sumAssured',+e.target.value)} style={inp}/></div>
          )}

          {/* ── LTC / DI ── */}
          {isLTC && !isStandardLTC && (
            <div style={g3}>
              <div><label style={lbl}>Monthly Benefit ($)</label><input type="number" value={form.monthlyBenefit||''} onChange={e=>f('monthlyBenefit',+e.target.value)} style={inp}/></div>
              <div>
                <label style={lbl}>Benefit Term</label>
                <select value={isOtherBenefitTerm?'__other':(form.benefitTerm||'')} onChange={e=>{if(e.target.value==='__other'){setIsOtherBenefitTerm(true);f('benefitTerm','');}else{setIsOtherBenefitTerm(false);f('benefitTerm',e.target.value);}}} style={s}>
                  <option value="">Select…</option>
                  <option value="2/6 ADLs">2/6 ADLs</option>
                  <option value="3/6 ADLs">3/6 ADLs</option>
                  <option value="__other">Others (Type Manually)</option>
                </select>
                {isOtherBenefitTerm && <input type="text" value={form.benefitTerm||''} onChange={e=>f('benefitTerm',e.target.value)} placeholder="Type Benefit Term" style={{...inp,marginTop:6}}/>}
              </div>
              <div>
                <label style={lbl}>Payout Term</label>
                <select value={isOtherPayoutTerm?'__other':(form.payoutTerm||'')} onChange={e=>{if(e.target.value==='__other'){setIsOtherPayoutTerm(true);f('payoutTerm','');}else{setIsOtherPayoutTerm(false);f('payoutTerm',e.target.value);}}} style={s}>
                  <option value="">Select…</option>
                  <option value="Lifetime">Lifetime</option>
                  <option value="__other">Others (Type Manually)</option>
                </select>
                {isOtherPayoutTerm && <input type="text" value={form.payoutTerm||''} onChange={e=>f('payoutTerm',e.target.value)} placeholder="Type Payout Term" style={{...inp,marginTop:6}}/>}
              </div>
            </div>
          )}

          {/* ── Premiums ── */}
          <div style={((isMedical && !isRider) || isLTC) ? g3 : g2}>
            <div>
              <label style={lbl}>Premium — Cash ({form.isUSD && isLife ? 'USD' : 'SGD'})</label>
              <input type="number" value={form.premiumCash||''} onChange={e=>f('premiumCash',+e.target.value)} style={inp}/>
              {form.isUSD && isLife && (form.premiumCash||0)>0 && (
                <div style={{fontSize:10,color:'var(--ink3)',marginTop:3,fontFamily:'DM Mono,monospace'}}>≈ {fmt((form.premiumCash||0)*fx)} SGD</div>
              )}
            </div>
            {((isMedical && !isRider) || isLTC) && <div><label style={lbl}>Premium — Medisave ($)</label><input type="number" value={form.premiumMedisave||''} onChange={e=>f('premiumMedisave',+e.target.value)} style={inp}/></div>}
            <div>
              <label style={lbl}>Payment Mode</label>
              <select value={form.premiumMode} onChange={e=>f('premiumMode',e.target.value)} style={s}>
                <option value="">Select…</option>
                {currentPayModes.map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div style={g2}>
            <div>
              <label style={lbl}>Frequency</label>
              <select value={form.frequency} onChange={e=>f('frequency',e.target.value)} style={s}>
                {FREQ.map(f=><option key={f}>{f}</option>)}
              </select>
            </div>
            {!isMedical && !isLTC && !isEndow && (
              <div>
                <label style={lbl}>Current Cash Value ({form.isUSD && isLife ? 'USD' : 'SGD'})</label>
                <input type="number" value={form.currentCashValue||''} onChange={e=>f('currentCashValue',+e.target.value)} style={inp}/>
                {form.isUSD && isLife && (form.currentCashValue||0)>0 && (
                  <div style={{fontSize:10,color:'var(--ink3)',marginTop:3,fontFamily:'DM Mono,monospace'}}>≈ {fmt((form.currentCashValue||0)*fx)} SGD</div>
                )}
              </div>
            )}
          </div>

          {/* ── Dates ── */}
          <div style={g3}>
            <div><label style={lbl}>Inception Date</label><input type="date" value={form.inceptionDate} onChange={e=>f('inceptionDate',e.target.value)} style={inp}/></div>
            <div>
              <label style={lbl}>Premium Maturity</label>
              <select value={premMatMode==='preset'?(form.premiumMaturity||''):(premMatMode==='date'?'__date':'__other')} onChange={e=>{if(e.target.value==='__date'){setPremMatMode('date');f('premiumMaturity','');}else if(e.target.value==='__other'){setPremMatMode('text');f('premiumMaturity','');}else{setPremMatMode('preset');f('premiumMaturity',e.target.value);}}} style={s}>
                <option value="">Select…</option>
                <option value="Lifetime">Lifetime</option>
                {(isMedical||form.premiumMaturity==='Renewable')&&<option value="Renewable">Renewable</option>}
                {(isLTC||form.premiumMaturity==='Age 67')&&<option value="Age 67">Age 67</option>}
                <option value="__date">Input Date</option>
                <option value="__other">Type Manually</option>
              </select>
              {premMatMode==='date'&&<input type="date" value={form.premiumMaturity||''} onChange={e=>f('premiumMaturity',e.target.value)} style={{...inp,marginTop:6}}/>}
              {premMatMode==='text'&&<input type="text" value={form.premiumMaturity||''} onChange={e=>f('premiumMaturity',e.target.value)} placeholder="Type manually" style={{...inp,marginTop:6}}/>}
            </div>
            <div>
              <label style={lbl}>Coverage Maturity</label>
              <select value={covMatMode==='preset'?(form.coverageMaturity||''):(covMatMode==='date'?'__date':'__other')} onChange={e=>{if(e.target.value==='__date'){setCovMatMode('date');f('coverageMaturity','');}else if(e.target.value==='__other'){setCovMatMode('text');f('coverageMaturity','');}else{setCovMatMode('preset');f('coverageMaturity',e.target.value);}}} style={s}>
                <option value="">Select…</option>
                <option value="Lifetime">Lifetime</option>
                {(isMedical||form.coverageMaturity==='Renewable')&&<option value="Renewable">Renewable</option>}
                {(isLTC||form.coverageMaturity==='Age 67')&&<option value="Age 67">Age 67</option>}
                <option value="__date">Input Date</option>
                <option value="__other">Type Manually</option>
              </select>
              {covMatMode==='date'&&<input type="date" value={form.coverageMaturity||''} onChange={e=>f('coverageMaturity',e.target.value)} style={{...inp,marginTop:6}}/>}
              {covMatMode==='text'&&<input type="text" value={form.coverageMaturity||''} onChange={e=>f('coverageMaturity',e.target.value)} placeholder="Type manually" style={{...inp,marginTop:6}}/>}
            </div>
          </div>

          {/* ── Status + Remarks ── */}
          <div style={{display:'flex', flexDirection:'column', gap: 14}}>
            <div>
              <label style={lbl}>Status</label>
              <select value={form.status} onChange={e=>f('status',e.target.value)} style={s}>
                {STATUS_OPTS.map(st=><option key={st}>{st}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Remarks</label>
              <textarea 
                value={form.remarks} 
                onChange={e=>f('remarks',e.target.value)} 
                placeholder="e.g. In-Force, value as of 05/03/2026. Additional notes about the policy..."
                rows={4}
                style={{...inp, resize:'vertical', minHeight:'80px', fontFamily:'inherit'}}
              />
            </div>
          </div>
        </div>

        <div style={{padding:'14px 26px',borderTop:'1px solid var(--line)',display:'flex',justifyContent:'flex-end',gap:10}}>
          <button onClick={onClose} style={{padding:'9px 18px',background:'none',border:'1px solid var(--line)',color:'var(--ink3)',cursor:'pointer',fontSize:13}}>Cancel</button>
          <button onClick={()=>onSave(form)} style={{padding:'9px 18px',background:'#1C1A17',color:'white',border:'none',cursor:'pointer',fontSize:13,fontWeight:500}}>
            {isNew?'Add Policy':'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── Helpers (used by PersonPortfolioCharts) ─────────────────────────────────
function _toSGD(val: number, p: Policy) {
  return p.isUSD ? val * (p.fxRate || 1.35) : val
}
function _annualPrem(p: Policy) {
  const cash = p.isUSD ? (p.premiumCash||0)*(p.fxRate||1.35) : (p.premiumCash||0)
  const total = cash + (p.premiumMedisave||0)
  switch (p.frequency) {
    case 'Semi-Annual': return total*2
    case 'Quarterly':   return total*4
    case 'Monthly':     return total*12
    case 'Single':      return total
    default:            return total
  }
}
function _payMonths(p: Policy): number[] {
  const sm = p.inceptionDate ? new Date(p.inceptionDate).getMonth()+1 : 1
  switch (p.frequency) {
    case 'Monthly':     return [1,2,3,4,5,6,7,8,9,10,11,12]
    case 'Quarterly':   return [0,1,2,3].map(i=>((sm-1+i*3)%12)+1)
    case 'Semi-Annual': return [0,1].map(i=>((sm-1+i*6)%12)+1)
    case 'Annual':      return [sm]
    case 'Single':      return []
    default:            return [sm]
  }
}
function _coverAtAge(p: Policy, age: number, curAge: number) {
  const mult     = p.multiplier > 1 ? p.multiplier : 1
  const multEnd  = p.multiplierEnd || 999
  const actMult  = age <= multEnd ? mult : 1
  let stepFactor = 1
  if (p.coverStep && p.stepDownPct && age > multEnd) {
    // Each year after multiplier ends, reduce by stepDownPct% — but only for coverStep years
    const yearsIntoStep = Math.min(age - multEnd, p.coverStep)
    stepFactor = Math.max(0, 1 - yearsIntoStep * ((p.stepDownPct||0) / 100))
  }
  // Check maturity
  if (p.coverageMaturity && !['Lifetime','Renewable'].includes(p.coverageMaturity)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.coverageMaturity)) {
      const matYear  = new Date(p.coverageMaturity).getFullYear()
      const birthYear= new Date().getFullYear() - curAge
      if (age > matYear - birthYear) return {d:0,t:0,ci:0}
    } else if (p.coverageMaturity.startsWith('Age ')) {
      if (age > parseInt(p.coverageMaturity.replace('Age ',''))) return {d:0,t:0,ci:0}
    }
  }
  const d  = _toSGD((p.baseDeath  ||0)*actMult*stepFactor, p)
  const t  = _toSGD((p.baseTPD    ||0)*actMult*stepFactor, p)
  const ci = _toSGD(Math.max((p.baseAdvCI||0),(p.baseEarlyCI||0))*actMult*stepFactor, p)
  return {d, t, ci}
}
function _fmtK(n: number) {
  if (n===0) return '$0'
  if (n>=1e6) return `$${(n/1e6).toFixed(2)}M`
  if (n>=1e3) return `$${(n/1e3).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString()}`
}

// ─── PersonPortfolioCharts (Apple-Style Premium Design) ──────────────────────
function PersonPortfolioCharts({ personName, personAge, policies }: {
  personName: string; personAge: number; policies: Policy[]
}) {
  // ── Coverage timeline ──────────────────────────────────────────────────────
  const timeline: {age:number;d:number;t:number;ci:number}[] = []
  for (let age = personAge; age <= 100; age++) {
    let d=0,t=0,ci=0
    for (const p of policies) {
      const c = _coverAtAge(p, age, personAge)
      d+=c.d; t+=c.t; ci+=c.ci
    }
    timeline.push({age,d,t,ci})
  }

  // ── Premium schedule ───────────────────────────────────────────────────────
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const monthly = MONTHS.map((_,mi) => {
    let total = 0
    for (const p of policies) {
      if (_payMonths(p).includes(mi+1)) {
        const cash = p.isUSD ? (p.premiumCash||0)*(p.fxRate||1.35) : (p.premiumCash||0)
        total += cash + (p.premiumMedisave||0)
      }
    }
    return total
  })
  const maxMonthly = Math.max(...monthly, 1)

  // ── Totals ─────────────────────────────────────────────────────────────────
  const lifePols = policies.filter(p=>p.categoryCode==='life')
  const totDeath = lifePols.reduce((s,p)=>s+_toSGD((p.baseDeath||0)*(p.multiplier>1?p.multiplier:1),p),0)
  const totTPD   = lifePols.reduce((s,p)=>s+_toSGD((p.baseTPD||0)*(p.multiplier>1?p.multiplier:1),p),0)
  const totAdvCI = lifePols.reduce((s,p)=>s+_toSGD((p.baseAdvCI||0)*(p.multiplier>1?p.multiplier:1),p),0)
  const totEarCI = lifePols.reduce((s,p)=>s+_toSGD((p.baseEarlyCI||0)*(p.multiplier>1?p.multiplier:1),p),0)
  const totPrem  = policies.reduce((s,p)=>s+_annualPrem(p),0)
  const roundedTotPrem = Math.round(totPrem)

  // ── Timeline SVG ───────────────────────────────────────────────────────────
  const W=560, H=170, PL=50, PR=12, PT=20, PB=18
  const iW=W-PL-PR, iH=H-PT-PB
  const maxV = Math.max(...timeline.map(r=>Math.max(r.d,r.t,r.ci)),1)
  const bSlot = iW/timeline.length
  const bW = Math.max(2, bSlot*0.7)
  const xOf = (i:number) => PL + i*bSlot + bSlot/2
  const yOf = (v:number) => PT + iH - Math.min(1,v/maxV)*iH
  const ticks = [0,0.25,0.5,0.75,1]
  const fmtAx = (n:number) => n>=1e6?`$${(n/1e6).toFixed(1)}M`:n>=1e3?`$${(n/1e3).toFixed(0)}K`:''

  // Premium brand colors
  const COL_D  = '#C8A96E'
  const COL_T  = '#8B9DAF'
  const COL_CI = '#7FAAA0'
  const COL_CARD_BG = '#FFFFFF'
  const COL_BORDER = 'rgba(0,0,0,0.06)'

  // Custom formatter for whole dollars only (no cents)
  const fmtWhole = (n: number) => {
    if (!n || n === 0) return '—'
    return '$' + Math.round(n).toLocaleString()
  }

  return (
    <div style={{marginBottom: 24}}>
      
      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap: 12, marginBottom: 16}}>
        {[
          {label:'Death Benefit', value:totDeath, accent:COL_D},
          {label:'TPD Benefit', value:totTPD, accent:COL_T},
          {label:'Late Stage CI', value:totAdvCI, accent:COL_CI},
          {label:'Early Stage CI', value:totEarCI, accent:COL_CI},
          {label:'Total Annual Premium', value:roundedTotPrem, accent:'#A8834A', highlight: true},
        ].map(kpi=>(
          <div key={kpi.label} style={{
            background: COL_CARD_BG,
            border: `1px solid ${COL_BORDER}`,
            borderRadius: 12,
            padding: '18px 20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
            transition: 'all 0.2s ease',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {kpi.highlight && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: 3,
                background: `linear-gradient(90deg, ${kpi.accent}, ${kpi.accent}cc)`
              }} />
            )}
            <div style={{
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#8B8B8B',
              marginBottom: 10,
              fontWeight: 500
            }}>{kpi.label}</div>
            <div style={{
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: kpi.highlight ? 26 : 24,
              fontWeight: kpi.highlight ? 600 : 500,
              color: kpi.highlight ? kpi.accent : '#1A1A1A',
              letterSpacing: '-0.02em',
              lineHeight: 1.2
            }}>{fmtWhole(kpi.value)}</div>
          </div>
        ))}
      </div>

      {/* ── Charts Row ────────────────────────────────────────────────────── */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 360px', gap: 12}}>

        {/* Coverage Timeline Card */}
        <div style={{
          background: COL_CARD_BG,
          border: `1px solid ${COL_BORDER}`,
          borderRadius: 16,
          padding: '22px 24px 12px 24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
        }}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 16}}>
            <div>
              <div style={{
                fontSize: 11,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#8B8B8B',
                marginBottom: 6,
                fontWeight: 500
              }}>Coverage Timeline</div>
              <div style={{
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: 18,
                color: '#1A1A1A',
                fontWeight: 500,
                letterSpacing: '-0.01em'
              }}>{personName} · Age {personAge} — 100</div>
            </div>
            <div style={{display:'flex', gap: 20, alignItems:'center'}}>
              {[{c:COL_D, l:'Death'},{c:COL_T, l:'TPD'},{c:COL_CI, l:'CI'}].map(lg=>(
                <div key={lg.l} style={{display:'flex', alignItems:'center', gap: 6}}>
                  <div style={{
                    width: 12,
                    height: 12,
                    background: lg.c,
                    borderRadius: 3,
                    flexShrink: 0
                  }} />
                  <span style={{fontSize: 11, color: '#666', fontWeight: 500}}>{lg.l}</span>
                </div>
              ))}
            </div>
          </div>
          
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{overflow:'visible', display:'block', marginBottom: '-8px'}}>
            {/* Grid lines - softer */}
            {ticks.map(f=>{
              const y=PT+iH-f*iH
              return <g key={f}>
                <line x1={PL} y1={y} x2={PL+iW} y2={y} stroke="#F0F0F0" strokeWidth="1" strokeDasharray="3,3"/>
                <text x={PL-8} y={y+3.5} fontSize="9" fill="#AAA" textAnchor="end" fontWeight={400}>{fmtAx(maxV*f)}</text>
              </g>
            })}
            
            {/* Bars - with subtle rounding */}
            {timeline.map((row,i)=>{
              const cx = xOf(i)
              const w3 = Math.max(2, bW/3 - 1)
              return <g key={row.age}>
                <rect x={cx-bW/2} y={yOf(row.d)} width={w3} height={Math.max(0,iH-(yOf(row.d)-PT))} fill={COL_D} rx="2" ry="2" opacity="0.85"/>
                <rect x={cx-bW/2+w3+1} y={yOf(row.t)} width={w3} height={Math.max(0,iH-(yOf(row.t)-PT))} fill={COL_T} rx="2" ry="2" opacity="0.85"/>
                <rect x={cx-bW/2+w3*2+2} y={yOf(row.ci)} width={w3} height={Math.max(0,iH-(yOf(row.ci)-PT))} fill={COL_CI} rx="2" ry="2" opacity="0.85"/>
              </g>
            })}
            
            {/* Baseline */}
            <line x1={PL} y1={PT+iH} x2={PL+iW} y2={PT+iH} stroke="#E5E5E5" strokeWidth="1"/>
            
            {/* Age labels - cleaner */}
            {timeline.filter(r=>(r.age%5===0||r.age===personAge)).map((r,i)=>(
              <text key={r.age} x={xOf(timeline.indexOf(r))} y={PT+iH+14} fontSize="9" fill="#AAA" textAnchor="middle" fontWeight={400}>{r.age}</text>
            ))}
          </svg>
          
          <div style={{
            fontSize: 10,
            color: '#AAA',
            marginTop: 2,
            fontStyle: 'italic',
            letterSpacing: '0.02em'
          }}>
            Excludes Accidental Death/TPD benefits and Endowment/Annuity sum assured
          </div>
        </div>

        {/* Premium Schedule Card */}
        <div style={{
          background: COL_CARD_BG,
          border: `1px solid ${COL_BORDER}`,
          borderRadius: 16,
          padding: '22px 24px 20px 24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
        }}>
          <div style={{marginBottom: 16}}>
            <div style={{
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#8B8B8B',
              marginBottom: 6,
              fontWeight: 500
            }}>Premium Schedule</div>
          </div>
          
          <div style={{display:'flex', flexDirection:'column', gap: 6}}>
            {MONTHS.map((mon,mi)=>{
              const amt = monthly[mi]
              const pct = maxMonthly > 0 ? (amt/maxMonthly)*100 : 0
              return (
                <div key={mon} style={{
                  display:'grid',
                  gridTemplateColumns:'32px 1fr 70px',
                  alignItems:'center',
                  gap: 10
                }}>
                  <div style={{
                    fontSize: 11,
                    color: amt > 0 ? '#444' : '#BBB',
                    fontWeight: amt > 0 ? 500 : 400,
                    letterSpacing: '0.02em'
                  }}>{mon}</div>
                  <div style={{
                    background: '#F5F5F5',
                    height: 8,
                    borderRadius: 20,
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '100%',
                      borderRadius: 20,
                      width: `${pct}%`,
                      background: amt > 0 
                        ? `linear-gradient(90deg, ${COL_D}, ${COL_D}dd)`
                        : 'transparent',
                      transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                    }} />
                  </div>
                  <div style={{
                    fontSize: 12,
                    fontFamily: 'DM Mono, monospace',
                    color: amt > 0 ? '#1A1A1A' : '#CCC',
                    textAlign: 'right',
                    fontWeight: amt > 0 ? 500 : 400
                  }}>
                    {amt > 0 ? `$${amt.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}` : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
