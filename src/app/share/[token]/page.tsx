'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'

interface Policy {
  id: string; categoryCode: string; policyTypeCode: string
  companyName: string; productName: string
  policyholder: string; lifeAssured: string; policyNo: string
  briefDescription: string
  baseDeath: number; baseTPD: number; baseAdvCI: number; baseEarlyCI: number
  sumAssured: number; monthlyBenefit: number; multiplier: number
  multiplierEnd?: number; coverStep: number; stepDownPct?: number
  currentCashValue: number; premiumMedisave: number; premiumCash: number
  premiumMode: string; frequency: string
  inceptionDate: string; premiumMaturity: string; coverageMaturity: string
  status: string; remarks: string; person: string
  isUSD?: boolean; fxRate?: number
}

const ACTIVE_STATUSES = ['In-Force', 'Premium Holiday', 'Paid-up']

function fmt(n: number|null|undefined) {
  if (!n || n===0) return '—'
  return '$' + Math.round(n).toLocaleString()
}
function formatDate(d: string) {
  if (!d) return '—'
  if (['Lifetime','Renewable'].includes(d)||d.startsWith('Age ')) return d
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
  }
  return d
}
function toSGD(val: number, p: Policy) { return p.isUSD ? val*(p.fxRate||1.35) : val }
function annualPrem(p: Policy) {
  const cash = p.isUSD ? (p.premiumCash||0)*(p.fxRate||1.35) : (p.premiumCash||0)
  const total = cash + (p.premiumMedisave||0)
  switch(p.frequency) {
    case 'Semi-Annual': return total*2
    case 'Quarterly': return total*4
    case 'Monthly': return total*12
    case 'Single': return total
    default: return total
  }
}
function getMultiplied(p: Policy, key: 'baseDeath'|'baseTPD'|'baseAdvCI'|'baseEarlyCI') {
  return (p[key]||0) * (p.multiplier||1)
}

const th: React.CSSProperties = {
  padding:'8px 12px',textAlign:'left',fontSize:9,letterSpacing:'0.1em',
  textTransform:'uppercase',color:'#888070',fontWeight:500,
}
const td: React.CSSProperties = {
  padding:'10px 12px',verticalAlign:'top',fontSize:11,color:'#1C1A17',
}

function PasswordGate({ hint, onUnlock, wrongPw }: { hint: string; onUnlock: (pw: string) => void; wrongPw?: boolean }) {
  const [pw, setPw] = useState('')
  const [localError, setLocalError] = useState(false)

  useEffect(() => { if (wrongPw) setLocalError(true) }, [wrongPw])

  function attempt() {
    if (!pw.trim()) return
    setLocalError(false)
    onUnlock(pw.trim())
  }

  return (
    <div style={{minHeight:'100vh',background:'#1C1A17',display:'flex',alignItems:'center',justifyContent:'center',padding:24,fontFamily:'Inter,sans-serif'}}>
      <div style={{width:'100%',maxWidth:420}}>
        <div style={{textAlign:'center',marginBottom:40}}>
          <div style={{fontSize:11,letterSpacing:'0.2em',textTransform:'uppercase',color:'rgba(168,131,74,0.7)',marginBottom:12}}>Bespoke Capital</div>
          <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:28,fontWeight:300,color:'#F0EDE8',marginBottom:8}}>Protected Document</div>
          <div style={{width:40,height:1,background:'#A8834A',margin:'0 auto'}}/>
        </div>
        <div style={{background:'rgba(255,255,255,0.04)',border:'0.5px solid rgba(255,255,255,0.1)',padding:'28px 32px'}}>
          <div style={{fontSize:13,color:'rgba(255,255,255,0.55)',lineHeight:1.7,marginBottom:28,textAlign:'center'}}>
            {hint}
          </div>
          <div style={{marginBottom:16}}>
            <input
              type="password"
              value={pw}
              onChange={e=>{setPw(e.target.value);setLocalError(false)}}
              onKeyDown={e=>e.key==='Enter'&&attempt()}
              placeholder="Enter password"
              style={{
                width:'100%',padding:'12px 16px',
                background:'rgba(255,255,255,0.06)',
                border:`0.5px solid ${localError?'#E08080':'rgba(255,255,255,0.15)'}`,
                color:'#F0EDE8',fontSize:15,outline:'none',
                fontFamily:'DM Mono,monospace',letterSpacing:'0.08em',
                boxSizing:'border-box' as const,
              }}
            />
            {localError && <div style={{fontSize:11,color:'#E08080',marginTop:6,textAlign:'center'}}>Incorrect password. Please try again.</div>}
          </div>
          <button onClick={attempt} style={{
            width:'100%',padding:'12px',background:'#A8834A',color:'white',
            border:'none',cursor:'pointer',fontSize:13,letterSpacing:'0.1em',
            textTransform:'uppercase' as const,fontFamily:'Inter,sans-serif',fontWeight:500,
          }}>
            Access Document
          </button>
        </div>
        <div style={{textAlign:'center',marginTop:24,fontSize:11,color:'rgba(255,255,255,0.2)'}}>
          This document is confidential and intended solely for the named recipient.
        </div>
      </div>
    </div>
  )
}

function ROPolicyTable({ policies, cat }: { policies: Policy[]; cat: string }) {
  const isEssential = ['medical','ltc','general'].includes(cat)
  const isLife = cat === 'life'

  if (isEssential) {
    const hasMedisave = policies.some(p=>(p.premiumMedisave||0)>0)
    return (
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
        <thead>
          <tr style={{background:'#FAFAF8',borderBottom:'1px solid #E0DDD6'}}>
            <th style={th}>Insurer · Product</th>
            <th style={th}>Brief Description</th>
            {hasMedisave && <th style={{...th,width:80}}>Prem (MS)</th>}
            <th style={{...th,width:80}}>Prem (Cash)</th>
            <th style={{...th,width:60}}>Freq.</th>
            <th style={{...th,width:160}}>Dates</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((p,i)=>(
            <tr key={p.id} style={{background:i%2===0?'white':'#FAFAF8',borderBottom:'0.5px solid #ECEAE4'}}>
              <td style={td}>
                <div style={{fontWeight:500}}>{p.companyName}{p.productName?` · ${p.productName}`:''}</div>
                {p.policyNo&&<div style={{fontSize:10,color:'#888',fontFamily:'DM Mono,monospace'}}>{p.policyNo}</div>}
                {(p.policyholder||p.lifeAssured)&&<div style={{fontSize:10,color:'#888'}}>
                  {p.policyholder&&`PH: ${p.policyholder}`}
                  {p.lifeAssured&&p.lifeAssured!==p.policyholder&&` · LA: ${p.lifeAssured}`}
                </div>}
              </td>
              <td style={{...td,color:'#555'}}>{p.briefDescription||'—'}</td>
              {hasMedisave&&<td style={{...td,fontFamily:'DM Mono,monospace'}}>{fmt(p.premiumMedisave)}</td>}
              <td style={{...td,fontFamily:'DM Mono,monospace'}}>{fmt(p.premiumCash)}</td>
              <td style={{...td,color:'#888'}}>{p.frequency||'—'}</td>
              <td style={td}>
                <div style={{fontSize:10,color:'#888',lineHeight:1.7}}>
                  <div>Start: {formatDate(p.inceptionDate)}</div>
                  <div>Prem: {formatDate(p.premiumMaturity)}</div>
                  <div>Cov: {formatDate(p.coverageMaturity)}</div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  if (isLife) {
    return (
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
        <thead>
          <tr style={{background:'#FAFAF8',borderBottom:'1px solid #E0DDD6'}}>
            <th style={th}>Insurer · Product</th>
            <th style={{...th,width:90}}>Death</th>
            <th style={{...th,width:90}}>TPD</th>
            <th style={{...th,width:90}}>Adv. CI</th>
            <th style={{...th,width:90}}>Early CI</th>
            <th style={{...th,width:90}}>Premium</th>
            <th style={{...th,width:60}}>Freq.</th>
            <th style={{...th,width:160}}>Dates</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((p,i)=>(
            <tr key={p.id} style={{background:i%2===0?'white':'#FAFAF8',borderBottom:'0.5px solid #ECEAE4'}}>
              <td style={td}>
                <div style={{fontWeight:500}}>{p.companyName}{p.productName?` · ${p.productName}`:''}</div>
                {p.policyNo&&<div style={{fontSize:10,color:'#888',fontFamily:'DM Mono,monospace'}}>{p.policyNo}</div>}
                {(p.policyholder||p.lifeAssured)&&<div style={{fontSize:10,color:'#888'}}>
                  {p.policyholder&&`PH: ${p.policyholder}`}
                  {p.lifeAssured&&p.lifeAssured!==p.policyholder&&` · LA: ${p.lifeAssured}`}
                </div>}
                {p.multiplier>1&&<div style={{fontSize:10,color:'#A8834A'}}>{p.multiplier}× to age {p.multiplierEnd}</div>}
              </td>
              <td style={{...td,fontFamily:'DM Mono,monospace'}}>{fmt(toSGD(getMultiplied(p,'baseDeath'),p))}</td>
              <td style={{...td,fontFamily:'DM Mono,monospace'}}>{fmt(toSGD(getMultiplied(p,'baseTPD'),p))}</td>
              <td style={{...td,fontFamily:'DM Mono,monospace'}}>{fmt(toSGD(getMultiplied(p,'baseAdvCI'),p))}</td>
              <td style={{...td,fontFamily:'DM Mono,monospace'}}>{fmt(toSGD(getMultiplied(p,'baseEarlyCI'),p))}</td>
              <td style={{...td,fontFamily:'DM Mono,monospace'}}>
                {fmt(p.premiumCash)}
                {p.premiumMedisave>0&&<div style={{fontSize:10,color:'#888'}}>+{fmt(p.premiumMedisave)} MS</div>}
              </td>
              <td style={{...td,color:'#888'}}>{p.frequency||'—'}</td>
              <td style={td}>
                <div style={{fontSize:10,color:'#888',lineHeight:1.7}}>
                  <div>Start: {formatDate(p.inceptionDate)}</div>
                  <div>Prem: {formatDate(p.premiumMaturity)}</div>
                  <div>Cov: {formatDate(p.coverageMaturity)}</div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
      <thead>
        <tr style={{background:'#FAFAF8',borderBottom:'1px solid #E0DDD6'}}>
          <th style={th}>Insurer · Product</th>
          <th style={{...th,width:110}}>Death Benefit</th>
          <th style={{...th,width:90}}>Premium</th>
          <th style={{...th,width:60}}>Freq.</th>
          <th style={{...th,width:160}}>Dates</th>
        </tr>
      </thead>
      <tbody>
        {policies.map((p,i)=>{
          const mainBen = p.baseDeath||p.baseAdvCI||p.monthlyBenefit||p.sumAssured
          return(
            <tr key={p.id} style={{background:i%2===0?'white':'#FAFAF8',borderBottom:'0.5px solid #ECEAE4'}}>
              <td style={td}>
                <div style={{fontWeight:500}}>{p.companyName}{p.productName?` · ${p.productName}`:''}</div>
                {p.policyNo&&<div style={{fontSize:10,color:'#888',fontFamily:'DM Mono,monospace'}}>{p.policyNo}</div>}
              </td>
              <td style={{...td,fontFamily:'DM Mono,monospace'}}>{fmt(mainBen)}</td>
              <td style={{...td,fontFamily:'DM Mono,monospace'}}>{fmt(p.premiumCash)}</td>
              <td style={{...td,color:'#888'}}>{p.frequency||'—'}</td>
              <td style={td}>
                <div style={{fontSize:10,color:'#888',lineHeight:1.7}}>
                  <div>Start: {formatDate(p.inceptionDate)}</div>
                  <div>Prem: {formatDate(p.premiumMaturity)}</div>
                  <div>Cov: {formatDate(p.coverageMaturity)}</div>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function CoverageTimeline({ policies, personAge, personName }: { policies: Policy[]; personAge: number; personName: string }) {
  const W=600,H=160,PL=50,PR=12,PT=16,PB=24
  const iW=W-PL-PR, iH=H-PT-PB
  const COL_D='#C8A96E', COL_T='#8B9DAF', COL_CI='#7FAAA0'

  const timeline: {age:number;d:number;t:number;ci:number}[] = []
  for (let age=personAge; age<=100; age++) {
    let d=0,t=0,ci=0
    for (const p of policies) {
      const mult = p.multiplier>1?p.multiplier:1
      const multEnd = p.multiplierEnd||999
      const actMult = age<=multEnd?mult:1
      if (p.coverageMaturity&&!['Lifetime','Renewable'].includes(p.coverageMaturity)) {
        if (p.coverageMaturity.startsWith('Age ')) {
          if (age>parseInt(p.coverageMaturity.replace('Age ',''))) continue
        }
      }
      d += toSGD((p.baseDeath||0)*actMult, p)
      t += toSGD((p.baseTPD||0)*actMult, p)
      ci += toSGD(Math.max((p.baseAdvCI||0),(p.baseEarlyCI||0))*actMult, p)
    }
    timeline.push({age,d,t,ci})
  }

  const maxV = Math.max(...timeline.map(r=>Math.max(r.d,r.t,r.ci)),1)
  const bSlot = iW/timeline.length
  const xOf = (i:number) => PL+i*bSlot+bSlot/2
  const yOf = (v:number) => PT+iH-Math.min(1,v/maxV)*iH
  const fmtAx = (n:number) => n>=1e6?`$${(n/1e6).toFixed(1)}M`:n>=1e3?`$${(n/1e3).toFixed(0)}K`:''
  const ticks=[0,0.25,0.5,0.75,1]

  return (
    <div style={{background:'white',border:'0.5px solid #E0DDD6',borderRadius:12,padding:'18px 20px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
        <div>
          <div style={{fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'#888',marginBottom:4}}>Coverage Timeline</div>
          <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:16,color:'#1A1A1A'}}>{personName} · Age {personAge} — 100</div>
        </div>
        <div style={{display:'flex',gap:16}}>
          {[{c:COL_D,l:'Death'},{c:COL_T,l:'TPD'},{c:COL_CI,l:'CI'}].map(lg=>(
            <div key={lg.l} style={{display:'flex',alignItems:'center',gap:5}}>
              <div style={{width:10,height:10,background:lg.c,borderRadius:2}}/>
              <span style={{fontSize:10,color:'#666'}}>{lg.l}</span>
            </div>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{display:'block',overflow:'visible'}}>
        {ticks.map(f=>{
          const y=PT+iH-f*iH
          return <g key={f}>
            <line x1={PL} y1={y} x2={PL+iW} y2={y} stroke="#F0F0F0" strokeWidth="1"/>
            <text x={PL-8} y={y+3.5} fontSize="9" fill="#AAA" textAnchor="end">{fmtAx(maxV*f)}</text>
          </g>
        })}
        {timeline.map((row,i)=>{
          const cx=xOf(i); const w3=Math.max(2,bSlot/3-0.5)
          return <g key={row.age}>
            <rect x={cx-bSlot/2} y={yOf(row.d)} width={w3} height={Math.max(0,iH-(yOf(row.d)-PT))} fill={COL_D} rx="1" opacity="0.85"/>
            <rect x={cx-bSlot/2+w3+0.5} y={yOf(row.t)} width={w3} height={Math.max(0,iH-(yOf(row.t)-PT))} fill={COL_T} rx="1" opacity="0.85"/>
            <rect x={cx-bSlot/2+w3*2+1} y={yOf(row.ci)} width={w3} height={Math.max(0,iH-(yOf(row.ci)-PT))} fill={COL_CI} rx="1" opacity="0.85"/>
          </g>
        })}
        <line x1={PL} y1={PT+iH} x2={PL+iW} y2={PT+iH} stroke="#E5E5E5" strokeWidth="1"/>
        {timeline.filter(r=>r.age%5===0||r.age===personAge).map(r=>(
          <text key={r.age} x={xOf(timeline.indexOf(r))} y={PT+iH+16} fontSize="9" fill="#AAA" textAnchor="middle">{r.age}</text>
        ))}
      </svg>
      <div style={{fontSize:10,color:'#AAA',marginTop:4,fontStyle:'italic'}}>Excludes Accidental Death/TPD benefits and Endowment/Annuity sum assured</div>
    </div>
  )
}

function PremiumSchedule({ policies }: { policies: Policy[] }) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  function payMonths(p: Policy): number[] {
    const sm = p.inceptionDate ? new Date(p.inceptionDate).getMonth()+1 : 1
    switch(p.frequency) {
      case 'Monthly': return [1,2,3,4,5,6,7,8,9,10,11,12]
      case 'Quarterly': return [0,1,2,3].map(i=>((sm-1+i*3)%12)+1)
      case 'Semi-Annual': return [0,1].map(i=>((sm-1+i*6)%12)+1)
      case 'Annual': return [sm]
      case 'Single': return []
      default: return [sm]
    }
  }
  const monthly = MONTHS.map((_,mi)=>{
    let total=0
    for (const p of policies) {
      if (payMonths(p).includes(mi+1)) {
        const cash = p.isUSD?(p.premiumCash||0)*(p.fxRate||1.35):(p.premiumCash||0)
        total += cash+(p.premiumMedisave||0)
      }
    }
    return total
  })
  const maxM = Math.max(...monthly,1)

  return (
    <div style={{background:'white',border:'0.5px solid #E0DDD6',borderRadius:12,padding:'18px 20px'}}>
      <div style={{fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'#888',marginBottom:12}}>Premium Schedule</div>
      <div style={{display:'flex',flexDirection:'column',gap:5}}>
        {MONTHS.map((mon,mi)=>{
          const amt=monthly[mi]; const pct=maxM>0?(amt/maxM)*100:0
          return (
            <div key={mon} style={{display:'grid',gridTemplateColumns:'32px 1fr 80px',alignItems:'center',gap:10}}>
              <div style={{fontSize:11,color:amt>0?'#444':'#BBB',fontWeight:amt>0?500:400}}>{mon}</div>
              <div style={{background:'#F5F5F5',height:7,borderRadius:20,overflow:'hidden'}}>
                <div style={{height:'100%',borderRadius:20,width:`${pct}%`,background:'#C8A96E'}}/>
              </div>
              <div style={{fontSize:11,fontFamily:'DM Mono,monospace',color:amt>0?'#1A1A1A':'#CCC',textAlign:'right'}}>
                {amt>0?`$${Math.round(amt).toLocaleString()}`:'—'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RemarksBox({ policies, cat }: { policies: Policy[]; cat: string }) {
  const withRemarks = policies.filter(p=>p.remarks?.trim())
  return (
    <div style={{border:'0.5px solid #E0DDD6',background:'#FAFAF8',marginTop:0}}>
      <div style={{fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:'#888',padding:'6px 12px',borderBottom:'0.5px solid #E0DDD6',background:'white'}}>Remarks</div>
      {withRemarks.length>0 ? (
        <div style={{padding:'10px 12px'}}>
          {withRemarks.map(p=>(
            <div key={p.id} style={{fontSize:11,color:'#555',lineHeight:1.6,marginBottom:6}}>
              <strong style={{color:'#1C1A17'}}>{p.companyName} {p.productName}</strong> — {p.remarks}
            </div>
          ))}
        </div>
      ) : (
        <div style={{height:56}}/>
      )}
    </div>
  )
}

export default function SharePage({ params }: { params: { token: string } }) {
  const supabase = createClient()
  const [stage, setStage] = useState<'loading'|'gate'|'unlocked'|'expired'|'notfound'>('loading')
  const [shareData, setShareData] = useState<any>(null)
  const [wrongPw, setWrongPw] = useState(false)
  const [policies, setPolicies] = useState<Policy[]>([])
  const [clientAge, setClientAge] = useState(40)
  const [clientName, setClientName] = useState('')
  const year = new Date().getFullYear()
  const page1Ref = useRef<HTMLDivElement>(null)
  const page2Ref = useRef<HTMLDivElement>(null)
  const page3Ref = useRef<HTMLDivElement>(null)

  useEffect(() => { loadShare() }, [])

  async function loadShare() {
    const { data: share, error } = await supabase
      .from('client_shares').select('*').eq('token', params.token).maybeSingle()
    if (error || !share) { setStage('notfound'); return }
    if (share.expires_at && new Date(share.expires_at) < new Date()) { setStage('expired'); return }
    setShareData(share)
    setStage('gate')
  }

  async function handleUnlock(pw: string) {
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(pw))
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b=>b.toString(16).padStart(2,'0')).join('')
    if (hashHex !== shareData.password_hash) { setWrongPw(true); setTimeout(()=>setWrongPw(false),100); return }

    const { data: client } = await supabase.from('clients').select('name,age,dob').eq('id',shareData.client_id).maybeSingle()
    if (client) {
      setClientName(client.name||'Client')
      if (client.dob) setClientAge(Math.floor((Date.now()-new Date(client.dob).getTime())/(365.25*24*3600*1000)))
      else if (client.age) setClientAge(Number(client.age))
    }
    const { data: row } = await supabase.from('fact_finding').select('data').eq('client_id',shareData.client_id).eq('section','protection_portfolio').maybeSingle()
    const all: Policy[] = row?.data?.risk_management?.policies||[]
const person = shareData.person || 'client'
const filtered = all.filter(p => {
  if (!ACTIVE_STATUSES.includes(p.status)) return false
  if (person === 'dependents') {
    return p.person !== 'client' && p.person !== 'spouse'
  }
  return p.person === person
})
setPolicies(filtered)
    setStage('unlocked')
  }

  function handleDownloadPDF() {
  window.print()
}
  
  const darkBg: React.CSSProperties = {background:'#1C1A17',display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',fontFamily:'Inter,sans-serif',padding:24}

  if (stage==='loading') return (
    <div style={darkBg}>
      <div style={{textAlign:'center'}}>
        <div style={{width:32,height:32,border:'2px solid #A8834A',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 16px'}}/>
        <div style={{fontSize:11,letterSpacing:'0.15em',textTransform:'uppercase',color:'rgba(168,131,74,0.7)'}}>Loading</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (stage==='notfound') return (
    <div style={darkBg}>
      <div style={{textAlign:'center'}}>
        <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:28,fontWeight:300,color:'#F0EDE8',marginBottom:12}}>Link Not Found</div>
        <div style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>This link does not exist or has been removed.</div>
      </div>
    </div>
  )

  if (stage==='expired') return (
    <div style={darkBg}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:11,letterSpacing:'0.2em',textTransform:'uppercase',color:'rgba(168,131,74,0.7)',marginBottom:12}}>Bespoke Capital</div>
        <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:28,fontWeight:300,color:'#F0EDE8',marginBottom:12}}>Link Expired</div>
        <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',maxWidth:320,lineHeight:1.6}}>This document link has expired. Please contact your financial advisor for a new link.</div>
      </div>
    </div>
  )

  if (stage==='gate') return (
    <PasswordGate hint={shareData?.password_hint||''} onUnlock={handleUnlock} wrongPw={wrongPw}/>
  )

  const catBuckets = [
    {code:'medical',  label:'Medical Insurance',                  accent:'#7A9CBF',hint:'Hospitalisation & surgical coverage'},
    {code:'ltc',      label:'Long Term Disability Care Insurance', accent:'#9B7BAA',hint:'Disability income & long-term care'},
    {code:'general',  label:'General Insurance',                  accent:'#8A9A7E',hint:'Personal accident · travel · maid'},
    {code:'life',     label:'Core Protection',                    accent:'#c8a96e',hint:'Life · WL · Term · UL · IUL · VUL'},
    {code:'endowment',label:'Wealth Accumulation Portfolio',       accent:'#B8956A',hint:'Endowment · Annuity · Investments · ILP'},
  ]

  const totalPrem = policies.reduce((s,p)=>s+annualPrem(p),0)
  const lifePols = policies.filter(p=>p.categoryCode==='life')
  const totDeath = lifePols.reduce((s,p)=>s+toSGD(getMultiplied(p,'baseDeath'),p),0)
  const totTPD   = lifePols.reduce((s,p)=>s+toSGD(getMultiplied(p,'baseTPD'),p),0)
  const totAdvCI = lifePols.reduce((s,p)=>s+toSGD(getMultiplied(p,'baseAdvCI'),p),0)
  const totEarCI = lifePols.reduce((s,p)=>s+toSGD(getMultiplied(p,'baseEarlyCI'),p),0)

  const hero = (title: string): React.CSSProperties => ({
    background:'#1C1A17',padding:'16px 40px',
    display:'flex',justifyContent:'space-between',alignItems:'center',
  })
  const pageBody: React.CSSProperties = {
  background:'white',padding:'32px 40px',
  fontFamily:'Inter,sans-serif',color:'#1C1A17',
  width:'100%',boxSizing:'border-box' as const,
}

  function CatSection({ cat }: { cat: typeof catBuckets[0] }) {
    const catPols = policies.filter(p=>p.categoryCode===cat.code)
    const catPrem = catPols.reduce((s,p)=>s+annualPrem(p),0)
    return (
      <div style={{marginBottom:28}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,paddingBottom:8,borderBottom:`0.5px solid ${cat.accent}44`}}>
          <div style={{width:3,height:16,background:cat.accent,flexShrink:0}}/>
          <span style={{fontSize:11,fontWeight:600,color:cat.accent,letterSpacing:'0.06em'}}>{cat.label.toUpperCase()}</span>
          <span style={{fontSize:10,color:'#888',borderLeft:'0.5px solid #E0DDD6',paddingLeft:10}}>{cat.hint}</span>
          {catPrem>0&&<span style={{marginLeft:'auto',fontSize:10,color:'#888',fontFamily:'DM Mono,monospace'}}>{fmt(catPrem)}/yr</span>}
        </div>
        {catPols.length===0
          ? <div style={{padding:'12px 0',fontSize:12,color:'#bbb',fontStyle:'italic'}}>No policies recorded in this category.</div>
          : <ROPolicyTable policies={catPols} cat={cat.code}/>
        }
        <RemarksBox policies={catPols} cat={cat.code}/>
      </div>
    )
  }

  return (
    <div style={{background:'#F5F3EE',minHeight:'100vh',fontFamily:'Inter,sans-serif',overflowX:'auto'}}>
     <style>{`
  @media print {
    @page {
      size: A4 landscape;
      margin: 1.2cm 1.5cm;
    }
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .no-print {
      display: none !important;
    }
    .print-break-before {
      page-break-before: always !important;
      break-before: page !important;
    }
    body {
      background: white !important;
    }
  }
`}</style>

      {/* Sticky nav */}
     <div className="no-print" style={{position:'sticky',top:0,zIndex:100,background:'#1C1A17',padding:'10px 24px',display:'flex',justifyContent:'space-between',alignItems:'center',minWidth:1100}}>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          <div style={{fontSize:10,letterSpacing:'0.15em',textTransform:'uppercase',color:'rgba(168,131,74,0.7)'}}>Bespoke Capital</div>
          <div style={{width:1,height:14,background:'rgba(255,255,255,0.15)'}}/>
          <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:16,fontWeight:300,color:'#F0EDE8'}}>
            Portfolio Summary {year} — {clientName}
          </div>
        </div>
        <button onClick={handleDownloadPDF} style={{
          padding:'8px 20px',background:'#A8834A',color:'white',border:'none',
          cursor:'pointer',fontSize:11,letterSpacing:'0.1em',textTransform:'uppercase',
          fontFamily:'Inter,sans-serif',fontWeight:500,
        }}>
          Download PDF
        </button>
      </div>

      {/* PAGE 1 */}
      <div ref={page1Ref} style={{width:1100,overflow:'hidden'}}>
        <div style={hero('')}>
          <div>
            <div style={{fontSize:10,letterSpacing:'0.18em',textTransform:'uppercase',color:'rgba(168,131,74,0.7)',marginBottom:6}}>Bespoke Capital · Wealth Protection</div>
            <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:28,fontWeight:300,color:'#F0EDE8'}}>Portfolio Summary {year} — {clientName}</div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:4}}>Prepared by Chew Zhiquan Brian</div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginBottom:2}}>Total Annual Premium</div>
            <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:26,fontWeight:300,color:'#C4A464'}}>{fmt(totalPrem)}</div>
          </div>
        </div>
        <div style={{...pageBody,paddingTop:24}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:24}}>
            {[
              {label:'Death Benefit',value:totDeath},
              {label:'TPD Benefit',value:totTPD},
              {label:'Late Stage CI',value:totAdvCI},
              {label:'Early Stage CI',value:totEarCI},
              {label:'Total Annual Premium',value:totalPrem,gold:true},
            ].map(k=>(
              <div key={k.label} style={{background:'white',border:'0.5px solid #E0DDD6',borderRadius:12,padding:'16px 18px',position:'relative',overflow:'hidden'}}>
                {k.gold&&<div style={{position:'absolute',top:0,left:0,right:0,height:3,background:'#A8834A'}}/>}
                <div style={{fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:'#888',marginBottom:8,marginTop:k.gold?4:0}}>{k.label}</div>
                <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:k.gold?24:22,fontWeight:300,color:k.gold?'#A8834A':'#1A1A1A'}}>{fmt(k.value)}</div>
              </div>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:16}}>
            <CoverageTimeline policies={lifePols} personAge={clientAge} personName={clientName}/>
            <PremiumSchedule policies={policies}/>
          </div>
          <div style={{marginTop:16,fontSize:10,color:'#aaa',fontStyle:'italic',textAlign:'center'}}>
            This overview should be read with the full portfolio details below. Please consult your Financial Advisor for more information.
          </div>
        </div>
      </div>

      {/* PAGE 2 — Medical, LTC, General */}
      <div ref={page2Ref} className="print-break-before" style={{width:1100,overflow:'hidden'}}>
        <div style={hero('')}>
          <div>
            <div style={{fontSize:9,letterSpacing:'0.16em',textTransform:'uppercase',color:'rgba(168,131,74,0.7)',marginBottom:3}}>Bespoke Capital · Wealth Protection</div>
            <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:20,fontWeight:300,color:'#F0EDE8'}}>Basic Essential Protection · {clientName}</div>
          </div>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>Prepared by Chew Zhiquan Brian</div>
        </div>
        <div style={pageBody}>
          {catBuckets.filter(c=>['medical','ltc','general'].includes(c.code)).map(cat=>(
            <CatSection key={cat.code} cat={cat}/>
          ))}
        </div>
      </div>

      {/* PAGE 3 — Core Protection & Wealth Accumulation */}
      <div ref={page3Ref} className="print-break-before" style={{width:1100,overflow:'hidden'}}>
        <div style={hero('')}>
          <div>
            <div style={{fontSize:9,letterSpacing:'0.16em',textTransform:'uppercase',color:'rgba(168,131,74,0.7)',marginBottom:3}}>Bespoke Capital · Wealth Protection</div>
            <div style={{fontFamily:'Cormorant Garamond,Georgia,serif',fontSize:20,fontWeight:300,color:'#F0EDE8'}}>Core Protection & Wealth Accumulation · {clientName}</div>
          </div>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>Prepared by Chew Zhiquan Brian</div>
        </div>
        <div style={pageBody}>
          {catBuckets.filter(c=>['life','endowment'].includes(c.code)).map(cat=>(
            <CatSection key={cat.code} cat={cat}/>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{minWidth:1100,background:'#1C1A17',padding:'20px 40px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>
          This document is confidential and prepared solely for {clientName}. © {year} Bespoke Capital.
        </div>
        <div style={{fontSize:10,color:'rgba(168,131,74,0.6)'}}>Chew Zhiquan Brian · Bespoke Capital</div>
      </div>
    </div>
  )
}
