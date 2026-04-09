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
  multiplier:   number
  coverStep:    number
  currentCashValue: number
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
}

interface RiskMgmtData { policies: Policy[]; advisorNotes: string }
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

// ─── Display helpers ──────────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  medical: '#7A9CBF', ltc: '#9B7BAA', general: '#8A9A7E',
  life: '#c8a96e', endowment: '#B8956A',
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
  const [activeTab,       setActiveTab]       = useState<'overview'|'portfolio'>('overview')
  const [overviewPerson,  setOverviewPerson]  = useState<'client'|'spouse'>('client')
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
    if (!clientId) return; 
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

  // People list for dropdowns — spouse by actual name, each child by actual name
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
              {label:'Total Policies',value:String(rmData.policies.length),sub:'all insured persons'},
              {label:'Annual Premium',value:fmt(totalPrem),sub:'combined portfolio'},
              {label:`${clientName} — D/TPD Gap`,value:fmt(Math.max(0,clientDTPD-cLH)),sub:clientDTPD>0?`Need ${fmt(clientDTPD)}`:'Complete profile first'},
              {label:`${clientName} — CI Gap`,value:fmt(Math.max(0,clientCI-cCH)),sub:clientCI>0?`Need ${fmt(clientCI)}`:'Complete profile first'},
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

          {aDTPD>0 ? (
            <div style={{marginTop:24,display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
              <CoverageChart title="Death / TPD Coverage Needs Analysis" needLabel="Required Family Protection Capital" haveLabel="Existing Family Protection" data={chartData.map(d=>({age:d.age,need:d.dtpd,have:aLH}))} needColor="#00BCD4" />
              <CoverageChart title="Critical Illness Coverage Needs Analysis" needLabel="Required Critical Illness Protection" haveLabel="Existing Critical Illness Protection" data={chartData.map(d=>({age:d.age,need:d.ci,have:aCH}))} needColor="#00BCD4" />
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
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:28}} className="no-print">
            <div>
              <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:22,color:'var(--ink)'}}>Wealth Protection Portfolio</div>
              <div style={{fontSize:12,color:'var(--ink3)',marginTop:2}}>{rmData.policies.length} {rmData.policies.length===1?'policy':'policies'} · Total annual premium {fmt(totalPrem)}</div>
            </div>
            <button onClick={()=>window.print()} style={{padding:'8px 18px',background:'#c8a96e',color:'white',border:'none',cursor:'pointer',fontSize:12}}>Print / PDF</button>
          </div>

          {sections.map(({key,label,isDependent,childKeys})=>{
            const policies = isDependent&&childKeys ? rmData.policies.filter(p=>childKeys.includes(p.person)) : rmData.policies.filter(p=>p.person===key)
            const addKey = isDependent&&childKeys ? (childKeys[0]||key) : key
            const secPrem = policies.reduce((s,p)=>s+(p.premiumCash||0)+(p.premiumMedisave||0),0)
            return (
              <div key={key} style={{marginBottom:32}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:3,height:18,background:isDependent?'#7B9E87':'#c8a96e'}} />
                    <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:18,color:'var(--ink)'}}>{label}</div>
                    {isDependent && <span style={{fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink3)',padding:'2px 7px',border:'1px solid var(--line)'}}>Dependent</span>}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:16}} className="no-print">
                    {secPrem>0 && <span style={{fontSize:12,color:'var(--ink3)'}}>Premium: <strong style={{fontFamily:'DM Mono,monospace',color:'var(--ink)'}}>{fmt(secPrem)}</strong></span>}
                    <button onClick={()=>openNew(addKey)}
                      style={{padding:'6px 14px',background:isDependent?'#F5FAF6':'var(--ink)',color:isDependent?'#2D6A4F':'white',border:isDependent?'1px solid #7B9E87':'none',cursor:'pointer',fontSize:12}}>
                      + Add Policy
                    </button>
                  </div>
                </div>
                {policies.length===0 ? (
                  <div style={{background:'white',border:'0.5px dashed var(--line)',padding:'24px',textAlign:'center',fontSize:13,color:'var(--ink3)'}}>No policies recorded for {label}</div>
                ) : (
                  <PolicyTable policies={policies} catShort={CAT_SHORT} catColors={CAT_COLORS} onEdit={openEdit} onDelete={delPolicy} />
                )}
              </div>
            )
          })}

          {rmData.policies.length>0 && (
            <div style={{background:'#1C1A17',padding:'26px 32px',marginTop:8}}>
              <div style={{fontSize:10,letterSpacing:'0.15em',textTransform:'uppercase',color:'rgba(200,169,110,0.7)',marginBottom:16}}>Portfolio Summary</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:24}}>
                {[
                  {label:'Total Policies',val:String(rmData.policies.length)},
                  {label:'Total Annual Premium',val:fmt(totalPrem)},
                  {label:`${clientName} — Life+TPD`,val:fmt(cLH)},
                  {label:isCouple?`${spouseName} — Life+TPD`:'Client CI',val:isCouple?fmt(sLH):fmt(cCH)},
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
      {dtpdNeed===0?(
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
              <div style={{fontSize:12,fontWeight:500,color:'var(--ink)'}}>{p.companyName||'—'}{p.productName?` · ${p.productName}`:''}</div>
              {(p.policyholder||p.lifeAssured)&&<div style={{fontSize:10,color:'var(--ink3)',marginTop:2}}>
                {p.policyholder&&<span>PH: {p.policyholder}</span>}
                {p.lifeAssured&&p.lifeAssured!==p.policyholder&&<span> · LA: {p.lifeAssured}</span>}
              </div>}
              {p.policyNo&&<div style={{fontSize:10,color:'var(--ink3)',marginTop:1,fontFamily:'DM Mono,monospace'}}>{p.policyNo}</div>}
            </div>
            <div style={{fontFamily:'DM Mono,monospace',fontSize:12,color:'var(--ink)'}}>
              {['ltc'].includes(p.categoryCode)&&p.monthlyBenefit?`$${p.monthlyBenefit.toLocaleString()}/mo`:fmt(mainBen)}
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
    setForm(prev=>({...prev,categoryCode:code,policyTypeCode:'',companyName:'',productName:''}))
  }
  const onCompChange=(name:string)=>{
    setForm(prev=>({...prev,companyName:name,productName:''}))
  }

  const isMedical  = form.categoryCode==='medical'
  const isLTC      = form.categoryCode==='ltc'
  const isLife     = form.categoryCode==='life'
  const isEndow    = form.categoryCode==='endowment'
  const isGeneral  = form.categoryCode==='general'

  const s:React.CSSProperties={width:'100%',padding:'8px 10px',border:'1px solid var(--line)',background:'var(--cream)',color:'var(--ink)',fontSize:13,outline:'none'}
  const inp:React.CSSProperties={width:'100%',padding:'8px 10px',border:'1px solid var(--line)',background:'var(--cream)',color:'var(--ink)',fontSize:13,outline:'none',boxSizing:'border-box'}
  const lbl:React.CSSProperties={display:'block',fontSize:9,letterSpacing:'0.13em',textTransform:'uppercase',color:'var(--ink3)',marginBottom:5}
  const g2:React.CSSProperties={display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}
  const g3:React.CSSProperties={display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14}

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

          {/* ── Row 1: Category + Policy Type (cascades from category) ── */}
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

          {/* ── Row 3: Company (cascades from category) + Policy No ── */}
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

          {/* ── Row 4: Product (cascades from company, medical+ltc only) or manual ── */}
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

          {/* ── Brief description ── */}
          <div>
            <label style={lbl}>Brief Description</label>
            <input type="text" value={form.briefDescription} onChange={e=>f('briefDescription',e.target.value)} placeholder="e.g. As-Charged Coverage Up to Private Hospitals" style={inp}/>
          </div>

          {/* ── Life / WL benefit fields ── */}
          {(isLife||isEndow) && (
            <>
              <div style={g3}>
                <div><label style={lbl}>Base Death ($)</label><input type="number" value={form.baseDeath||''} onChange={e=>f('baseDeath',+e.target.value)} style={inp}/></div>
                <div><label style={lbl}>Base TPD ($)</label><input type="number" value={form.baseTPD||''} onChange={e=>f('baseTPD',+e.target.value)} style={inp}/></div>
                <div><label style={lbl}>Base Adv CI ($)</label><input type="number" value={form.baseAdvCI||''} onChange={e=>f('baseAdvCI',+e.target.value)} style={inp}/></div>
              </div>
              <div style={g3}>
                <div><label style={lbl}>Base Early CI ($)</label><input type="number" value={form.baseEarlyCI||''} onChange={e=>f('baseEarlyCI',+e.target.value)} style={inp}/></div>
                <div><label style={lbl}>Multiplier</label><input type="number" value={form.multiplier||''} onChange={e=>f('multiplier',+e.target.value)} style={inp}/></div>
                <div><label style={lbl}>Cover Step (yrs)</label><input type="number" value={form.coverStep||''} onChange={e=>f('coverStep',+e.target.value)} style={inp}/></div>
              </div>
            </>
          )}

          {/* ── Medical / General sum assured ── */}
          {(isMedical||isGeneral) && (
            <div><label style={lbl}>Sum Assured / Coverage Limit ($)</label><input type="number" value={form.sumAssured||''} onChange={e=>f('sumAssured',+e.target.value)} style={inp}/></div>
          )}

          {/* ── LTC / DI ── */}
          {isLTC && (
            <div style={g2}>
              <div><label style={lbl}>Monthly Benefit ($)</label><input type="number" value={form.monthlyBenefit||''} onChange={e=>f('monthlyBenefit',+e.target.value)} style={inp}/></div>
              <div>
                <label style={lbl}>Deferred Period / Benefit Term</label>
                <select value={form.deferredPeriod} onChange={e=>f('deferredPeriod',e.target.value)} style={s}>
                  <option value="">Select…</option>
                  {['3/6 ADLs','Lifetime','72 months','Up to age 67','Up to age 70','Other'].map(d=><option key={d}>{d}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* ── Endowment investment fields ── */}
          {isEndow && (
            <div style={g2}>
              <div><label style={lbl}>Current Cash Value / GMV ($)</label><input type="number" value={form.currentCashValue||''} onChange={e=>f('currentCashValue',+e.target.value)} style={inp}/></div>
              <div><label style={lbl}>Non-GMV ($)</label><input type="number" value={form.sumAssured||''} onChange={e=>f('sumAssured',+e.target.value)} style={inp}/></div>
            </div>
          )}

          {/* ── Premiums ── */}
          <div style={isMedical ? g3 : g2}>
            <div><label style={lbl}>Premium — Cash ($)</label><input type="number" value={form.premiumCash||''} onChange={e=>f('premiumCash',+e.target.value)} style={inp}/></div>
            {isMedical && <div><label style={lbl}>Premium — Medisave ($)</label><input type="number" value={form.premiumMedisave||''} onChange={e=>f('premiumMedisave',+e.target.value)} style={inp}/></div>}
            <div>
              <label style={lbl}>Payment Mode</label>
              <select value={form.premiumMode} onChange={e=>f('premiumMode',e.target.value)} style={s}>
                <option value="">Select…</option>
                {PAY_MODES.map(m=><option key={m}>{m}</option>)}
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
            <div><label style={lbl}>Current Cash Value ($)</label><input type="number" value={form.currentCashValue||''} onChange={e=>f('currentCashValue',+e.target.value)} style={inp}/></div>
          </div>

          {/* ── Dates ── */}
          <div style={g3}>
            <div><label style={lbl}>Inception Date</label><input type="date" value={form.inceptionDate} onChange={e=>f('inceptionDate',e.target.value)} style={inp}/></div>
            <div><label style={lbl}>Premium Maturity</label><input type="date" value={form.premiumMaturity} onChange={e=>f('premiumMaturity',e.target.value)} style={inp}/></div>
            <div><label style={lbl}>Coverage Maturity</label><input type="date" value={form.coverageMaturity} onChange={e=>f('coverageMaturity',e.target.value)} style={inp}/></div>
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
