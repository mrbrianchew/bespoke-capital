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
const STATUS_OPTS = ['In-Force','Lapsed','Surrendered','Matured','Pending']
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProtectionPage() {
  const supabase = createClient()

  // Client / family
  const [clientId,   setClientId]   = useState<string | null>(null)
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // UI state
  const [activeTab,       setActiveTab]       = useState<'overview'|'portfolio'|'report'>('overview')
  const [overviewPerson,  setOverviewPerson]  = useState<'client'|'spouse'>('client')
  const [portfolioPerson, setPortfolioPerson] = useState<string>('client')
  const [editingPolicy,   setEditingPolicy]   = useState<Policy | null>(null)
  const [showModal,       setShowModal]       = useState(false)
  const [modalPerson,     setModalPerson]     = useState('client')

  useEffect(() => {
    const id = localStorage.getItem('selectedClientId')
    if (id) setClientId(id)
  }, [])

  useEffect(() => { if (clientId) loadAll(clientId) }, [clientId])

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
    if (!clientId) return
    setSaving(true)
    try {
      const { data: rows, error: fetchError } = await supabase
        .from('fact_finding')
        .select('id, data')
        .eq('client_id', clientId)

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
          .insert({ client_id: clientId, data: { risk_management: data } })
        if (insertError) throw insertError
      }
    } catch (error) {
      console.error("Error saving risk management data:", error)
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

  // FIX 1: Broader key coverage for spouse income
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

  // FIX 2: Broader key coverage for spouse expenses, with fallback chain
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
  function lifeHave(person: string) {
    return rmData.policies.filter(p=>p.person===person&&p.categoryCode==='life')
      .reduce((s,p)=>s+toSGD(Math.max(p.baseDeath||0,p.sumAssured||0),p),0)
  }
  function ciHave(person: string) {
    return rmData.policies.filter(p=>p.person===person&&p.categoryCode==='life')
      .reduce((s,p)=>s+toSGD(Math.max(p.baseAdvCI||0,p.baseEarlyCI||0),p),0)
  }
  function premHave(person: string) {
    return rmData.policies.filter(p=>p.person===person).reduce((s,p)=>s+toSGD((p.premiumCash||0),p)+(p.premiumMedisave||0),0)
  }

  const cLH = lifeHave('client'), cCH = ciHave('client')
  const sLH = lifeHave('spouse'), sCH = ciHave('spouse')
  const totalPrem = rmData.policies.reduce((s,p)=>s+(p.isUSD?(p.premiumCash||0)*(p.fxRate||1.35):(p.premiumCash||0))+(p.premiumMedisave||0),0)

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

  // FIX 3: Chart should show for spouse even when aDTPD is 0 due to missing data
  // We show charts if: (a) we have a real need figure, OR (b) we're on spouse tab and have
  // at least some financial data to render (exp > 0 acts as proxy)
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
            {saving && <span style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>Saving…</span>}
            <div style={{display:'flex',gap:2,background:'rgba(255,255,255,0.06)',borderRadius:6,padding:3}}>
              {(['overview','portfolio','report'] as const).map(t=>(
                <button key={t} onClick={()=>setActiveTab(t)}
                  style={{padding:'6px 18px',borderRadius:4,border:'none',cursor:'pointer',fontSize:12,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:500,background:activeTab===t?'rgba(200,169,110,0.2)':'transparent',color:activeTab===t?'#c8a96e':'rgba(255,255,255,0.45)'}}>
                  {t==='overview'?'Overview':t==='portfolio'?'Portfolio':'Report'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── OVERVIEW ── */}
      {activeTab==='overview' && (
        <div style={{padding:'36px 48px',flex:1}}>
          {/* FIX 4: KPI cards now use aName/aDTPD/aLH/aCI/aCH so they react to the person toggle */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:32}}>
            {[
              {label:'Total Policies',value:String(rmData.policies.length),sub:'all insured persons'},
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

          {/* FIX 3: Show charts whenever we have any data; only hide when truly no profile at all */}
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
              <div style={{fontSize:12,color:'var(--ink3)',marginTop:2}}>{rmData.policies.length} {rmData.policies.length===1?'policy':'policies'} · Total annual premium {fmt(totalPrem)}</div>
            </div>
            <button onClick={()=>setActiveTab('report')} style={{padding:'8px 18px',background:'#c8a96e',color:'white',border:'none',cursor:'pointer',fontSize:12}}>View Report / PDF</button>
          </div>

          {/* Person tabs */}
          <div style={{display:'flex',gap:0,marginBottom:28,borderBottom:'1px solid var(--line)'}} className="no-print">
            {sections.map(({key,label,isDependent,childKeys})=>{
              const tabPolicies = isDependent&&childKeys
                ? rmData.policies.filter(p=>childKeys.includes(p.person))
                : rmData.policies.filter(p=>p.person===key)
              const tabPrem = tabPolicies.reduce((s,p)=>s+(p.isUSD?(p.premiumCash||0)*(p.fxRate||1.35):(p.premiumCash||0))+(p.premiumMedisave||0),0)
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
              ? rmData.policies.filter(p=>childKeys.includes(p.person))
              : rmData.policies.filter(p=>p.person===key)
            const addKey = isDependent&&childKeys ? (childKeys[0]||key) : key
            const secPrem = policies.reduce((s,p)=>s+(p.isUSD?(p.premiumCash||0)*(p.fxRate||1.35):(p.premiumCash||0))+(p.premiumMedisave||0),0)
            return (
              <div key={key}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
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
                {policies.length===0 ? (
                  <div style={{background:'white',border:'0.5px dashed var(--line)',padding:'32px',textAlign:'center',fontSize:13,color:'var(--ink3)'}}>
                    No policies recorded for {label}
                    <div style={{marginTop:12}}>
                      <button onClick={()=>openNew(addKey)} className="no-print"
                        style={{padding:'7px 18px',background:'var(--ink)',color:'white',border:'none',cursor:'pointer',fontSize:12}}>
                        + Add First Policy
                      </button>
                    </div>
                  </div>
                ) : (
                  <PolicyTable policies={policies} catShort={CAT_SHORT} catColors={CAT_COLORS} onEdit={openEdit} onDelete={delPolicy} />
                )}
              </div>
            )
          })}

          {/* Portfolio summary — always visible at bottom */}
          {rmData.policies.length>0 && (
            <div style={{background:'#1C1A17',padding:'26px 32px',marginTop:32}}>
              <div style={{fontSize:10,letterSpacing:'0.15em',textTransform:'uppercase',color:'rgba(200,169,110,0.7)',marginBottom:16}}>Portfolio Summary — All Insured</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:24}}>
                {[
                  {label:'Total Policies',     val:String(rmData.policies.length)},
                  {label:'Total Annual Premium',val:fmt(totalPrem)},
                  {label:`${clientName} — Life+TPD`, val:fmt(cLH)},
                  {label:isCouple?`${spouseName} — Life+TPD`:'Client CI', val:isCouple?fmt(sLH):fmt(cCH)},
                ].map(item=>(
                  <div key={item.label}>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:6}}>{item.label}</div>
                    <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:22,color:'#F0EDE8',fontWeight:300}}>{item.val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── REPORT ── */}
      {activeTab==='report' && (
        <PortfolioReport
          clientName={clientName} clientAge={clientAge}
          spouseName={spouseName} spouseAge={spouseAge}
          isCouple={isCouple} children={children}
          policies={rmData.policies}
          ffData={ffData}
        />
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

      <style>{`@media print { .no-print{display:none!important} aside,nav{display:none!important} body{background:white!important} }`}</style>
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
  const sub=policies.reduce((s,p)=>s+(p.premiumCash||0)+(p.premiumMedisave||0),0)
  return (
    <div style={{background:'white',border:'0.5px solid var(--line)'}}>
      <div style={{display:'grid',gridTemplateColumns:'80px 80px 1fr 140px 130px 90px 55px',padding:'8px 18px',borderBottom:'1px solid var(--line)',background:'#FAFAF8'}}>
        {['CAT','TYPE','INSURER · PLAN · PH / LA','BENEFIT','PREMIUM (CASH)','STATUS',''].map(h=>(
          <div key={h} style={{fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink3)'}}>{h}</div>
        ))}
      </div>
      {policies.map((p,i)=>{
        const col=catColors[p.categoryCode]||'#999'
        const mainBen=p.baseDeath||p.baseAdvCI||p.monthlyBenefit||p.sumAssured
        return(
          <div key={p.id} style={{display:'grid',gridTemplateColumns:'80px 80px 1fr 140px 130px 90px 55px',padding:'12px 18px',alignItems:'center',borderBottom:i<policies.length-1?'0.5px solid var(--line)':'none',background:i%2===0?'white':'#FAFAF8'}}>
            <span style={{fontSize:10,fontWeight:600,color:col,padding:'2px 6px',background:col+'18',borderRadius:3}}>{catShort[p.categoryCode]||p.categoryCode}</span>
            <span style={{fontSize:11,color:'var(--ink3)'}}>{p.policyTypeCode||'—'}</span>
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
            <div style={{fontFamily:'DM Mono,monospace',fontSize:12,color:'var(--ink)'}}>
              {['ltc'].includes(p.categoryCode)&&p.monthlyBenefit
                ? `$${p.monthlyBenefit.toLocaleString()}/mo`
                : p.isUSD && mainBen
                  ? <>
                      <div>USD {Math.round(mainBen).toLocaleString()}</div>
                      <div style={{fontSize:10,color:'var(--ink3)'}}>≈ {fmt(mainBen*(p.fxRate||1.35))}</div>
                    </>
                  : fmt(mainBen)
              }
            </div>
            <div style={{fontFamily:'DM Mono,monospace',fontSize:12,color:'var(--ink)'}}>
              {fmt(p.premiumCash)}
              {p.premiumMedisave>0&&<div style={{fontSize:10,color:'var(--ink3)'}}>+{fmt(p.premiumMedisave)} Medisave</div>}
            </div>
            <span style={{fontSize:10,padding:'2px 7px',borderRadius:3,background:p.status==='In-Force'?'#E8F5E9':'#FEE2E2',color:p.status==='In-Force'?'#2D6A4F':'#9B1C1C'}}>{p.status}</span>
            <div style={{display:'flex',gap:5}} className="no-print">
              <button onClick={()=>onEdit(p)} style={{fontSize:10,color:'var(--ink3)',background:'none',border:'none',cursor:'pointer'}}>Edit</button>
              <button onClick={()=>onDelete(p.id)} style={{fontSize:10,color:'#C0392B',background:'none',border:'none',cursor:'pointer'}}>✕</button>
            </div>
          </div>
        )
      })}
      <div style={{display:'grid',gridTemplateColumns:'80px 80px 1fr 140px 130px 90px 55px',padding:'10px 18px',borderTop:'1px solid var(--line)',background:'#F8F7F4'}}>
        <div style={{gridColumn:'1/5',fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink3)'}}>Subtotal</div>
        <div style={{fontFamily:'DM Mono,monospace',fontSize:12,fontWeight:600,color:'var(--ink)'}}>{fmt(sub)}</div>
        <div/><div/>
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
    "Coverage for Deductibles and Co-Insurance."
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
                            if(stepYrs>0&&stepPct>0){const d=(stepYrs*stepPct)/100;return Math.max(base,(base*form.multiplier)*(1-d))}
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
              {/* Death / TPD / TI with $/% toggle */}
              {([
                { label:'Death Benefit', modeKey:'endowDeathMode' as const, valKey:'baseDeath' as const },
                { label:'TPD Benefit',   modeKey:'endowTPDMode'   as const, valKey:'baseTPD'   as const },
              ]).map(({ label, modeKey, valKey }) => {
                const mode    = (form[modeKey] as '%'|'$') || '$'
                const rawVal  = (form[valKey] as number) || 0
                const cashVal = form.currentCashValue || 0
                const computed = mode==='%' ? (rawVal/100)*cashVal : rawVal
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
                      <input type="number" value={rawVal||''} onChange={e=>f(valKey,+e.target.value)}
                        placeholder={mode==='%'?'e.g. 105':'e.g. 500000'}
                        style={{...inp,borderRadius:'0 3px 3px 0',flex:1}}/>
                    </div>
                    {mode==='%' && cashVal>0 && rawVal>0 && (
                      <div style={{fontSize:11,color:'var(--ink3)',marginTop:4,fontFamily:'DM Mono,monospace'}}>
                        = {fmt(computed)} <span style={{fontFamily:'Inter,sans-serif',fontSize:10}}>({rawVal}% of {fmt(cashVal)})</span>
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
          <div style={g2}>
            <div>
              <label style={lbl}>Status</label>
              <select value={form.status} onChange={e=>f('status',e.target.value)} style={s}>
                {STATUS_OPTS.map(st=><option key={st}>{st}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Remarks</label><input type="text" value={form.remarks} onChange={e=>f('remarks',e.target.value)} placeholder="e.g. In-Force, value as of 05/03/2026" style={inp}/></div>
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

// ─── Helper: compute effective SGD benefit for a policy ──────────────────────
function effectiveSGD(val: number, p: Policy) {
  return p.isUSD ? val * (p.fxRate || 1.35) : val
}

// ─── Helper: get annualised premium in SGD ───────────────────────────────────
function annualPremSGD(p: Policy) {
  const cash = p.isUSD ? (p.premiumCash||0)*(p.fxRate||1.35) : (p.premiumCash||0)
  const ms   = p.premiumMedisave || 0
  const total = cash + ms
  switch (p.frequency) {
    case 'Semi-Annual': return total * 2
    case 'Quarterly':   return total * 4
    case 'Monthly':     return total * 12
    case 'Single':      return total
    default:            return total // Annual
  }
}

// ─── Helper: monthly premium (for premium schedule chart) ────────────────────
function monthlyPremSGD(p: Policy) {
  const cash = p.isUSD ? (p.premiumCash||0)*(p.fxRate||1.35) : (p.premiumCash||0)
  const ms   = p.premiumMedisave || 0
  const total = cash + ms
  switch (p.frequency) {
    case 'Annual':      return total / 12
    case 'Semi-Annual': return total / 6
    case 'Quarterly':   return total / 3
    case 'Monthly':     return total
    case 'Single':      return 0
    default:            return total / 12
  }
}

// ─── Helper: which months does a policy pay in? ──────────────────────────────
function payMonths(p: Policy): number[] {
  if (!p.inceptionDate) {
    // No inception date — spread evenly
    switch (p.frequency) {
      case 'Monthly':     return [1,2,3,4,5,6,7,8,9,10,11,12]
      case 'Quarterly':   return [1,4,7,10]
      case 'Semi-Annual': return [1,7]
      case 'Annual':      return [1]
      default:            return []
    }
  }
  const startMonth = new Date(p.inceptionDate).getMonth() + 1
  switch (p.frequency) {
    case 'Monthly':     return [1,2,3,4,5,6,7,8,9,10,11,12]
    case 'Quarterly':   return [0,1,2,3].map(i=>((startMonth-1+i*3)%12)+1)
    case 'Semi-Annual': return [0,1].map(i=>((startMonth-1+i*6)%12)+1)
    case 'Annual':      return [startMonth]
    case 'Single':      return []
    default:            return [startMonth]
  }
}

// ─── Helper: coverage at a given age for a life policy ───────────────────────
function coverageAtAge(p: Policy, age: number, currentAge: number): { death: number; tpd: number; ci: number } {
  const fx = p.fxRate || 1.35
  const toSGD = (v: number) => p.isUSD ? v * fx : v

  const mult = p.multiplier > 1 ? p.multiplier : 1
  const multEnd = p.multiplierEnd || 999
  const activeMult = age <= multEnd ? mult : 1

  // Step-down after multiplier ends
  let stepFactor = 1
  if (p.coverStep && p.stepDownPct && age > multEnd) {
    const yearsAfter = age - multEnd
    const drops = Math.floor(yearsAfter / (p.coverStep || 1))
    stepFactor = Math.max(0, 1 - drops * ((p.stepDownPct||0)/100))
  }

  const death   = toSGD((p.baseDeath  ||0) * activeMult * stepFactor)
  const tpd     = toSGD((p.baseTPD    ||0) * activeMult * stepFactor)
  const advCI   = toSGD((p.baseAdvCI  ||0) * activeMult * stepFactor)
  const earlyCI = toSGD((p.baseEarlyCI||0) * activeMult * stepFactor)
  const ci      = Math.max(advCI, earlyCI)

  // Check coverage maturity
  if (p.coverageMaturity && p.coverageMaturity !== 'Lifetime' && p.coverageMaturity !== 'Renewable') {
    let matAge = 999
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.coverageMaturity)) {
      const matYear = new Date(p.coverageMaturity).getFullYear()
      const birthYear = new Date().getFullYear() - currentAge
      matAge = matYear - birthYear
    } else if (p.coverageMaturity.startsWith('Age ')) {
      matAge = parseInt(p.coverageMaturity.replace('Age ', ''))
    }
    if (age > matAge) return { death: 0, tpd: 0, ci: 0 }
  }

  return { death, tpd, ci }
}

// ─── fmt helpers ─────────────────────────────────────────────────────────────
function fmtR(n: number | null | undefined) {
  if (!n || n === 0) return '$0'
  return '$' + Math.round(n).toLocaleString()
}
function fmtDate(d: string) {
  if (!d) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y,m,day] = d.split('-')
    return `${day}/${m}/${y}`
  }
  return d
}

// ─── Person Report (one full printable page set per person) ──────────────────
function PersonReport({ personKey, personName, personAge, policies, allPolicies, children }:{
  personKey: string; personName: string; personAge: number
  policies: Policy[]; allPolicies: Policy[]; children: any[]
}) {
  const medPolicies    = policies.filter(p=>p.categoryCode==='medical')
  const ltcPolicies    = policies.filter(p=>p.categoryCode==='ltc')
  const generalPolicies= policies.filter(p=>p.categoryCode==='general')
  const lifePolicies   = policies.filter(p=>p.categoryCode==='life')
  const endowPolicies  = policies.filter(p=>p.categoryCode==='endowment')

  // ── Coverage timeline data ─────────────────────────────────────────────────
  const maxAge = 100
  const timelineData: {age:number;death:number;tpd:number;ci:number}[] = []
  for (let age = personAge; age <= maxAge; age++) {
    let death = 0, tpd = 0, ci = 0
    for (const p of policies) {
      const c = coverageAtAge(p, age, personAge)
      death += c.death; tpd += c.tpd; ci += c.ci
    }
    timelineData.push({age, death, tpd, ci})
  }

  // ── Premium schedule — monthly breakdown ──────────────────────────────────
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const monthlyAmounts = Array(12).fill(0).map((_,mi) => {
    let total = 0
    for (const p of policies) {
      const months = payMonths(p)
      if (months.includes(mi+1)) {
        const cash = p.isUSD ? (p.premiumCash||0)*(p.fxRate||1.35) : (p.premiumCash||0)
        total += cash + (p.premiumMedisave||0)
      }
    }
    return total
  })
  const maxMonthly = Math.max(...monthlyAmounts, 1)

  // ── Life totals ────────────────────────────────────────────────────────────
  const totalDeath = lifePolicies.reduce((s,p)=>s+effectiveSGD(p.baseDeath||0,p)*(p.multiplier>1?p.multiplier:1),0)
  const totalTPD   = lifePolicies.reduce((s,p)=>s+effectiveSGD(p.baseTPD||0,p)*(p.multiplier>1?p.multiplier:1),0)
  const totalCI    = lifePolicies.reduce((s,p)=>s+effectiveSGD(Math.max(p.baseAdvCI||0,p.baseEarlyCI||0),p)*(p.multiplier>1?p.multiplier:1),0)
  const totalPrem  = policies.reduce((s,p)=>s+annualPremSGD(p),0)

  const thStyle: React.CSSProperties = {
    fontSize: 8, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.06em', padding: '5px 6px', textAlign: 'center' as const,
    border: '1px solid #ddd', lineHeight: 1.3
  }
  const tdStyle: React.CSSProperties = {
    fontSize: 9, padding: '4px 6px', border: '1px solid #ddd',
    textAlign: 'center' as const, lineHeight: 1.3
  }
  const tdL: React.CSSProperties = { ...tdStyle, textAlign: 'left' as const }

  // ── Timeline chart dimensions ──────────────────────────────────────────────
  const TW=900, TH=220, TPL=68, TPR=10, TPT=14, TPB=28
  const TiW=TW-TPL-TPR, TiH=TH-TPT-TPB
  const ages = timelineData.map(d=>d.age)
  const minA = ages[0]||personAge, rangeA = (ages[ages.length-1]||maxAge)-minA||1
  const maxVal = Math.max(...timelineData.map(d=>Math.max(d.death,d.tpd,d.ci)),1)
  const xP=(a:number)=>((a-minA)/rangeA)*TiW
  const yP=(v:number)=>TiH-Math.min(1,v/maxVal)*TiH
  const barW = Math.max(1, TiW/timelineData.length - 0.8)
  const fmtAx=(n:number)=>n>=1e6?`$${(n/1e6).toFixed(1)}M`:n>=1e3?`$${(n/1e3).toFixed(0)}K`:`$${n}`
  const ticks=[0,0.25,0.5,0.75,1]

  return (
    <div className="report-person">
      {/* ═══ PAGE 1: Summary + Charts ═══════════════════════════════════════ */}
      <div className="report-page">
        <div style={{borderBottom:'2px solid #333',paddingBottom:8,marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}>
          <div>
            <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:28,fontWeight:400,letterSpacing:'0.05em',textTransform:'uppercase'}}>Financial Portfolio Summary</div>
            <div style={{fontSize:11,color:'#555',marginTop:3}}>Specially prepared for {personName}</div>
          </div>
          <div style={{textAlign:'right',fontSize:10,color:'#888'}}>
            <div style={{fontWeight:600,color:'#333'}}>BESPOKE CAPITAL</div>
            <div>Tailored Financial Advisory</div>
          </div>
        </div>

        {/* Coverage Timeline */}
        <div style={{border:'1px solid #ddd',padding:'14px 18px',marginBottom:16}}>
          <div style={{textAlign:'center',fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:15,fontWeight:600,color:'#1565C0',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:8}}>Coverage Timeline</div>
          <div style={{display:'flex',gap:18,justifyContent:'center',marginBottom:8}}>
            {[{col:'#1565C0',lbl:'Death Benefit'},{col:'#E53935',lbl:'TPD Benefit'},{col:'#F9A825',lbl:'Adv. CI Benefit'}].map(l=>(
              <div key={l.lbl} style={{display:'flex',alignItems:'center',gap:4}}>
                <div style={{width:14,height:10,background:l.col}}/>
                <span style={{fontSize:9}}>{l.lbl}</span>
              </div>
            ))}
          </div>
          <svg viewBox={`0 0 ${TW} ${TH}`} width="100%" style={{overflow:'visible'}}>
            {ticks.map(f=>{
              const y=TPT+TiH-f*TiH
              return <g key={f}>
                <line x1={TPL} y1={y} x2={TPL+TiW} y2={y} stroke="#E0E0E0" strokeWidth=".5"/>
                <text x={TPL-4} y={y+3} fontSize="7.5" fill="#888" textAnchor="end">{fmtAx(maxVal*f)}</text>
              </g>
            })}
            {timelineData.map((d,i)=>{
              const x=TPL+xP(d.age)
              const offsets=[
                {v:d.death,col:'#1565C0'},
                {v:d.tpd,  col:'#E53935'},
                {v:d.ci,   col:'#F9A825'},
              ]
              return <g key={d.age}>
                {offsets.map((o,oi)=>(
                  <rect key={oi} x={x+(oi-1)*barW} y={TPT+yP(o.v)} width={barW}
                    height={Math.max(0,TiH-yP(o.v))} fill={o.col} opacity=".85"/>
                ))}
              </g>
            })}
            <line x1={TPL} y1={TPT+TiH} x2={TPL+TiW} y2={TPT+TiH} stroke="#CCC" strokeWidth=".5"/>
            {timelineData.filter((_,i)=>i%5===0).map(d=>(
              <text key={d.age} x={TPL+xP(d.age)} y={TPT+TiH+10} fontSize="7" fill="#888" textAnchor="middle">{d.age}</text>
            ))}
            <text x={TPL+TiW/2} y={TPT+TiH+20} fontSize="7.5" fill="#888" textAnchor="middle">Age</text>
          </svg>
          <div style={{fontSize:7.5,color:'#888',marginTop:4}}>
            Disclaimer: The graph illustrates Death, TPD, and Critical Illness coverage. Excludes Accidental Death/TPD benefits and Sum Assured from Endowment/Annuity/Investment plans (if applicable).
          </div>
        </div>

        {/* Bottom row: Premium Schedule + Life Summary */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          {/* Premium Schedule */}
          <div style={{border:'1px solid #ddd',padding:'12px 14px'}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:10}}>Premium Schedule</div>
            {monthlyAmounts.map((amt,mi)=>(
              <div key={mi} style={{display:'grid',gridTemplateColumns:'28px 1fr 70px',alignItems:'center',gap:4,marginBottom:3}}>
                <div style={{fontSize:8,color:'#555',textAlign:'right'}}>{MONTH_NAMES[mi]}</div>
                <div style={{background:'#F5F5F5',borderRadius:2,height:14,position:'relative'}}>
                  <div style={{position:'absolute',top:0,left:0,height:'100%',background:'#42A5F5',borderRadius:2,width:`${(amt/maxMonthly)*100}%`}}/>
                </div>
                <div style={{fontSize:8,fontFamily:'monospace',textAlign:'right',paddingLeft:4}}>
                  {amt>0?`$${amt.toFixed(2)}`:'—'}
                </div>
              </div>
            ))}
            <div style={{fontSize:7.5,color:'#888',marginTop:8,borderTop:'1px solid #eee',paddingTop:6}}>
              Disclaimer: Reflects all premiums payable including Medical, General, Core Protection and Wealth Accumulation policies.
            </div>
          </div>

          {/* Life, Income & Family Protection summary */}
          <div style={{border:'2px solid #333',padding:'18px 20px',display:'flex',flexDirection:'column',justifyContent:'space-between'}}>
            <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:17,fontWeight:600,letterSpacing:'0.06em',textTransform:'uppercase',textAlign:'right',borderBottom:'1px solid #333',paddingBottom:10,marginBottom:14}}>
              Life, Income &amp; Family Protection
            </div>
            {[
              {lbl:'Death Benefit',val:totalDeath},
              {lbl:'Total & Permanent Disability Benefit',val:totalTPD},
              {lbl:'Critical Illness Benefit',val:totalCI},
            ].map(item=>(
              <div key={item.lbl} style={{textAlign:'right',marginBottom:14}}>
                <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:14,fontStyle:'italic',fontWeight:600}}>{item.lbl}</div>
                <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:18,color:'#555',marginTop:2}}>{fmtR(item.val)}</div>
              </div>
            ))}
            <div style={{borderTop:'1px solid #ccc',paddingTop:10,marginTop:4}}>
              <div style={{fontSize:8,color:'#888',textAlign:'right',fontStyle:'italic'}}>
                Disclaimer: This overview of your Wealth Protection Portfolio should be read with the following pages. For more details, please consult your Financial Advisor.
              </div>
              <div style={{fontSize:9,color:'#555',textAlign:'right',marginTop:8}}>Prepared by: Chew Zhiquan Brian</div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ PAGE 2: Basic Essential Protection ═════════════════════════════ */}
      <div className="report-page">
        <div style={{borderBottom:'2px solid #333',paddingBottom:6,marginBottom:20,textAlign:'center'}}>
          <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:26,fontWeight:400,letterSpacing:'0.08em',textTransform:'uppercase'}}>Basic Essential Protection</div>
          <div style={{fontSize:10,color:'#555',marginTop:2}}>{personName}</div>
        </div>

        {/* Medical */}
        <div style={{marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>Medical Insurance(s)</div>
          <div style={{fontSize:8.5,color:'#444',marginBottom:8,fontStyle:'italic'}}>
            Wealth Protection Plans to help you preserve your long-term financial security by covering major healthcare expenses. From hospitalisation and surgery to related outpatient treatments, these Medical plans reduce the burden of large medical bills, allowing you to focus on your health while your wealth remains safeguarded.
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:8.5}}>
            <thead>
              <tr style={{background:'#00897B',color:'white'}}>
                {['Policy No.','Coverage Type','Company / Product Name','Brief Coverage Description','Inception Date','Premium Maturity','Coverage Maturity','Premium (Medisave)','Premium (Cash)','Premium Mode','Premium Frequency'].map(h=>(
                  <th key={h} style={{...thStyle,background:'#00897B',color:'white',border:'1px solid #00695C'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {medPolicies.length===0
                ? <tr><td colSpan={11} style={{...tdL,color:'#aaa',fontStyle:'italic',padding:'10px'}}>No medical policies recorded</td></tr>
                : medPolicies.map((p,i)=>(
                  <tr key={p.id} style={{background:i%2===0?'white':'#F9FFFE'}}>
                    <td style={tdL}>{p.policyNo||'—'}</td>
                    <td style={tdStyle}>{p.policyTypeCode||'—'}</td>
                    <td style={tdL}>{[p.companyName,p.productName].filter(Boolean).join(' ')}</td>
                    <td style={tdL}>{p.briefDescription||'—'}</td>
                    <td style={tdStyle}>{fmtDate(p.inceptionDate)}</td>
                    <td style={tdStyle}>{p.premiumMaturity||'—'}</td>
                    <td style={tdStyle}>{p.coverageMaturity||'—'}</td>
                    <td style={tdStyle}>{p.premiumMedisave?fmtR(p.premiumMedisave):'$0.00'}</td>
                    <td style={tdStyle}>{p.premiumCash?fmtR(p.premiumCash):'$0.00'}</td>
                    <td style={tdStyle}>{p.premiumMode||'—'}</td>
                    <td style={tdStyle}>{p.frequency||'—'}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
          <div style={{fontSize:8,color:'#555',marginTop:3}}>**MS - Medisave</div>
        </div>

        {/* LTC */}
        <div style={{marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>Long Term Disability Care Insurance(s)</div>
          <div style={{fontSize:8.5,color:'#444',marginBottom:8,fontStyle:'italic'}}>
            Wealth Protection Plans to help you preserve your financial security in the event of a long-term disability. Long Term Disability Care Insurance provides regular payouts to support daily living expenses, medical care, and caregiving needs. This reduces the financial strain on you and your loved ones, ensuring that even if you are unable to work, your lifestyle and long-term plans remain safeguarded.
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:8.5}}>
            <thead>
              <tr style={{background:'#00897B',color:'white'}}>
                {['Policy No.','Coverage Type','Company / Product Name','Brief Coverage Description','Inception Date','Premium Maturity','Coverage Maturity','Premium (Medisave)','Premium (Cash)','Premium Mode','Premium Frequency'].map(h=>(
                  <th key={h} style={{...thStyle,background:'#00897B',color:'white',border:'1px solid #00695C'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ltcPolicies.length===0
                ? <tr><td colSpan={11} style={{...tdL,color:'#aaa',fontStyle:'italic',padding:'10px'}}>No LTC/DI policies recorded</td></tr>
                : ltcPolicies.map((p,i)=>(
                  <tr key={p.id} style={{background:i%2===0?'white':'#F9FFFE'}}>
                    <td style={tdL}>{p.policyNo||'—'}</td>
                    <td style={tdStyle}>{p.policyTypeCode||'—'}</td>
                    <td style={tdL}>{[p.companyName,p.productName].filter(Boolean).join(' ')}</td>
                    <td style={tdL}>{p.briefDescription||'—'}</td>
                    <td style={tdStyle}>{fmtDate(p.inceptionDate)}</td>
                    <td style={tdStyle}>{p.premiumMaturity||'—'}</td>
                    <td style={tdStyle}>{p.coverageMaturity||'—'}</td>
                    <td style={tdStyle}>{p.premiumMedisave?fmtR(p.premiumMedisave):'$0.00'}</td>
                    <td style={tdStyle}>{p.premiumCash?fmtR(p.premiumCash):'$0.00'}</td>
                    <td style={tdStyle}>{p.premiumMode||'—'}</td>
                    <td style={tdStyle}>{p.frequency||'—'}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
          <div style={{fontSize:8,color:'#555',marginTop:3}}>**MS - Medisave</div>
        </div>

        {/* General */}
        <div style={{marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:8}}>General Insurance(s) — Personal Accident / Travel / Maid</div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:8.5}}>
            <thead>
              <tr style={{background:'#E65100',color:'white'}}>
                {['Policy No.','Coverage Type','Company / Product Name','Brief Coverage Description','Inception Date','Premium Maturity','Coverage Maturity','Premium','Payment Mode','Premium Frequency'].map(h=>(
                  <th key={h} style={{...thStyle,background:'#E65100',color:'white',border:'1px solid #BF360C'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {generalPolicies.length===0
                ? <tr><td colSpan={10} style={{...tdL,color:'#aaa',fontStyle:'italic',padding:'10px'}}>No general insurance policies recorded</td></tr>
                : generalPolicies.map((p,i)=>(
                  <tr key={p.id} style={{background:i%2===0?'white':'#FFF8F5'}}>
                    <td style={tdL}>{p.policyNo||'—'}</td>
                    <td style={tdStyle}>{p.policyTypeCode||'—'}</td>
                    <td style={tdL}>{[p.companyName,p.productName].filter(Boolean).join(' ')}</td>
                    <td style={tdL}>{p.briefDescription||'—'}</td>
                    <td style={tdStyle}>{fmtDate(p.inceptionDate)}</td>
                    <td style={tdStyle}>{p.premiumMaturity||'—'}</td>
                    <td style={tdStyle}>{p.coverageMaturity||'—'}</td>
                    <td style={tdStyle}>{p.premiumCash?fmtR(p.premiumCash):'—'}</td>
                    <td style={tdStyle}>{p.premiumMode||'—'}</td>
                    <td style={tdStyle}>{p.frequency||'—'}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ PAGE 3: Core Protection + Wealth Accumulation ══════════════════ */}
      <div className="report-page">
        <div style={{borderBottom:'2px solid #333',paddingBottom:6,marginBottom:20,textAlign:'center'}}>
          <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:26,fontWeight:400,letterSpacing:'0.08em',textTransform:'uppercase'}}>Core Protection</div>
          <div style={{fontSize:8.5,color:'#444',marginTop:6,fontStyle:'italic'}}>
            Wealth Protection Plans are built to protect what matters most — your family's financial security. Covering Death, TPD, Critical Illness, and Early Critical Illness, these plans provide income replacement and long-term support, ensuring your loved ones remain financially protected no matter what life brings.
          </div>
        </div>

        {/* Life / WL / Term */}
        <div style={{marginBottom:6}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.07em',textTransform:'uppercase',marginBottom:6}}>
            Limited or Whole Life / Term Plan / ILP / UL / IUL / VUL
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:7.5}}>
            <thead>
              <tr style={{background:'#1A237E',color:'white'}}>
                {['Policy No.','Coverage Type','Company / Product Name','Death Benefit','TPD Benefit','Adv CI Benefit','Early CI Benefit','Premium Waiver','Multiplier','Multiplier Maturity','Inception Date','Premium Maturity','Coverage Maturity','Premium','Premium Mode','Frequency','Current Cash Value'].map(h=>(
                  <th key={h} style={{...thStyle,background:'#1A237E',color:'white',border:'1px solid #0D1357',fontSize:7}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lifePolicies.length===0
                ? <tr><td colSpan={17} style={{...tdL,color:'#aaa',fontStyle:'italic',padding:'10px'}}>No life / protection policies recorded</td></tr>
                : lifePolicies.map((p,i)=>{
                  const mult = p.multiplier>1?p.multiplier:1
                  const death = effectiveSGD((p.baseDeath||0)*mult, p)
                  const tpd   = effectiveSGD((p.baseTPD  ||0)*mult, p)
                  const advCI = effectiveSGD((p.baseAdvCI ||0)*mult, p)
                  const earCI = effectiveSGD((p.baseEarlyCI||0)*mult, p)
                  const prem  = p.isUSD ? fmtR((p.premiumCash||0)*(p.fxRate||1.35)) + ' (USD '+Math.round(p.premiumCash||0).toLocaleString()+')' : fmtR(p.premiumCash)
                  return (
                    <tr key={p.id} style={{background:i%2===0?'white':'#F5F5FF'}}>
                      <td style={tdL}>{p.policyNo||'—'}</td>
                      <td style={tdStyle}>{p.policyTypeCode||'—'}</td>
                      <td style={tdL}>{[p.companyName,p.productName].filter(Boolean).join(' ')}{p.isUSD&&<span style={{fontSize:7,color:'#c8a96e',marginLeft:3}}>[USD]</span>}</td>
                      <td style={tdStyle}>{death?fmtR(death):'$0'}</td>
                      <td style={tdStyle}>{tpd?fmtR(tpd):'$0'}</td>
                      <td style={tdStyle}>{advCI?fmtR(advCI):'$0'}</td>
                      <td style={tdStyle}>{earCI?fmtR(earCI):'$0'}</td>
                      <td style={tdStyle}>{p.multiplier>1?'Yes':'Nil'}</td>
                      <td style={tdStyle}>{p.multiplier>1?`${p.multiplier}X`:'N/A'}</td>
                      <td style={tdStyle}>{p.multiplierEnd?`Age ${p.multiplierEnd}`:'N/A'}</td>
                      <td style={tdStyle}>{fmtDate(p.inceptionDate)}</td>
                      <td style={tdStyle}>{p.premiumMaturity||'—'}</td>
                      <td style={tdStyle}>{p.coverageMaturity||'—'}</td>
                      <td style={tdStyle}>{prem}</td>
                      <td style={tdStyle}>{p.premiumMode||'—'}</td>
                      <td style={tdStyle}>{p.frequency||'—'}</td>
                      <td style={tdStyle}>{p.currentCashValue?fmtR(effectiveSGD(p.currentCashValue,p)):'—'}</td>
                    </tr>
                  )
                })
              }
            </tbody>
          </table>
        </div>

        {/* Remarks box */}
        <div style={{border:'1px solid #ddd',padding:'6px 10px',marginBottom:24,minHeight:36}}>
          <div style={{fontSize:8,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>Remarks</div>
        </div>

        {/* Wealth Accumulation */}
        <div style={{marginBottom:6}}>
          <div style={{fontSize:12,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:'#E65100',marginBottom:8}}>Wealth Accumulation Portfolio</div>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.07em',textTransform:'uppercase',marginBottom:6}}>
            Endowment / Annuity / Investments / 101 ILP
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:7.5}}>
            <thead>
              <tr style={{background:'#E65100',color:'white'}}>
                {['Policy / Account No.','Policy Type','Company / Product Name','Brief Product Description','G.M.V','Non-G.M.V','Inception Date','Premium Maturity','Maturity Date','Premium','Premium Mode','Frequency','Current Valuation'].map(h=>(
                  <th key={h} style={{...thStyle,background:'#E65100',color:'white',border:'1px solid #BF360C',fontSize:7}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {endowPolicies.length===0
                ? <tr><td colSpan={13} style={{...tdL,color:'#aaa',fontStyle:'italic',padding:'10px'}}>No endowment / annuity / investment policies recorded</td></tr>
                : endowPolicies.map((p,i)=>{
                  const deathMode = p.endowDeathMode||'$'
                  const cv = p.currentCashValue||0
                  const gmv  = deathMode==='%' ? ((p.baseDeath||0)/100)*cv : (p.baseDeath||0)
                  const nonGmv = deathMode==='%' ? ((p.baseTPD||0)/100)*cv : (p.baseTPD||0)
                  return (
                    <tr key={p.id} style={{background:i%2===0?'white':'#FFF8F5'}}>
                      <td style={tdL}>{p.policyNo||'—'}</td>
                      <td style={tdStyle}>{p.policyTypeCode||'—'}</td>
                      <td style={tdL}>{[p.companyName,p.productName].filter(Boolean).join(' ')}</td>
                      <td style={tdL}>{p.briefDescription||'—'}</td>
                      <td style={tdStyle}>{gmv?fmtR(gmv):'NA'}</td>
                      <td style={tdStyle}>{nonGmv?fmtR(nonGmv):'NA'}</td>
                      <td style={tdStyle}>{fmtDate(p.inceptionDate)}</td>
                      <td style={tdStyle}>{p.premiumMaturity||'—'}</td>
                      <td style={tdStyle}>{p.coverageMaturity||'—'}</td>
                      <td style={tdStyle}>{fmtR(p.premiumCash)}</td>
                      <td style={tdStyle}>{p.premiumMode||'—'}</td>
                      <td style={tdStyle}>{p.frequency||'—'}</td>
                      <td style={tdStyle}>{cv?fmtR(cv):'—'}</td>
                    </tr>
                  )
                })
              }
            </tbody>
          </table>
        </div>

        {/* Remarks box */}
        <div style={{border:'1px solid #ddd',padding:'6px 10px',minHeight:36}}>
          <div style={{fontSize:8,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>Remarks</div>
        </div>
      </div>
    </div>
  )
}

// ─── Portfolio Report (wraps PersonReport for client + spouse) ───────────────
function PortfolioReport({ clientName, clientAge, spouseName, spouseAge, isCouple, children, policies, ffData }: {
  clientName: string; clientAge: number
  spouseName: string; spouseAge: number
  isCouple: boolean; children: any[]
  policies: Policy[]; ffData: any
}) {
  const clientPolicies = policies.filter(p=>p.person==='client')
  const spousePolicies = policies.filter(p=>p.person==='spouse')

  return (
    <div style={{background:'white',minHeight:'100vh'}}>
      {/* Screen controls */}
      <div className="no-print" style={{background:'#1C1A17',padding:'16px 48px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:10}}>
        <div style={{fontSize:13,color:'rgba(255,255,255,0.7)'}}>
          Financial Portfolio Report — {clientName}{isCouple?` & ${spouseName}`:''}
        </div>
        <div style={{display:'flex',gap:10}}>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',alignSelf:'center'}}>
            Tip: Use browser Print → Save as PDF for best results
          </div>
          <button onClick={()=>window.print()}
            style={{padding:'8px 20px',background:'#c8a96e',color:'white',border:'none',cursor:'pointer',fontSize:12,fontWeight:600,letterSpacing:'0.05em'}}>
            🖨 Print / Save PDF
          </button>
        </div>
      </div>

      {/* Report pages */}
      <div style={{padding:'24px 0',background:'#E8E6E2'}} className="no-print"/>
      <div id="report-root" style={{maxWidth:980,margin:'0 auto',padding:'0 20px 60px'}}>
        <PersonReport
          personKey="client" personName={clientName} personAge={clientAge}
          policies={clientPolicies} allPolicies={policies} children={children}
        />
        {isCouple && (
          <PersonReport
            personKey="spouse" personName={spouseName} personAge={spouseAge}
            policies={spousePolicies} allPolicies={policies} children={children}
          />
        )}
      </div>

      <style>{`
        .report-page {
          background: white;
          padding: 36px 40px;
          margin-bottom: 8px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.08);
          page-break-after: always;
        }
        .report-person { margin-bottom: 0; }
        @media print {
          .no-print { display: none !important; }
          aside, nav { display: none !important; }
          body { background: white !important; margin: 0 !important; }
          #report-root { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
          .report-page {
            box-shadow: none !important;
            padding: 20px 24px !important;
            margin: 0 !important;
            page-break-after: always;
          }
        }
      `}</style>
    </div>
  )
}
