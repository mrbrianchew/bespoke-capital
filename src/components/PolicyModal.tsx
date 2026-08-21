'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { getUsdSgdRate } from '@/lib/fxRate'
import { getLatestHistoryByPolicy, getHistoryForPolicy, addCorrection, PolicyHistoryEntry } from '@/lib/policyServiceHistory'
import DateInput from '@/components/DateInput'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'

// Extracted from src/app/dashboard/protection/page.tsx so the New Business
// Pipeline's product/application flow can reuse the exact same policy
// editing form (category-driven fields, product/company reference data,
// USD/FX handling, LTC auto-description, etc.) instead of forking a
// second, thinner version that drifts the moment Admin Hub product lists
// change. Behavior is unchanged from the original. Protection page now
// imports everything below from here rather than defining it locally.

export interface InsCategory   { id: number; code: string; name: string; sort_order: number }
export interface InsPolicyType { id: number; category_id: number; code: string; name: string }
export interface InsCompany    { id: number; category_id: number; name: string }
export interface InsProduct    { id: number; category_id: number; company_id: number; name: string; default_remarks?: string | null; policy_type_id?: number | null }

export interface Policy {
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

// Shape of the protection_portfolio.risk_management JSONB blob — shared
// here so both the Protection page and the New Business Pipeline's push-
// to-portfolio step read/write the exact same structure instead of two
// independently-typed copies drifting apart.
export interface RiskMgmtData { policies: Policy[]; advisorNotes: string; statusOverrides?: Record<string, string> }
export const EMPTY_RM: RiskMgmtData = { policies: [], advisorNotes: '', statusOverrides: {} }

export function emptyPolicy(person: string, ph = '', la = ''): Policy {
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
export const CAT_COLORS: Record<string, string> = {
  medical: '#7A9CBF', ltc: '#9B7BAA', general: '#8A9A7E',
  life: '#c8a96e', endowment: '#B8956A',
}
export const CAT_SHORT: Record<string, string> = {
  medical: 'Medical', ltc: 'LTC/DI', general: 'General',
  life: 'Life', endowment: 'Endowment',
}
export const FREQ = ['Annual','Semi-Annual','Quarterly','Monthly','Single']
export const STATUS_OPTS = ['In-Force', 'Terminated', 'Paid-up', 'Surrendered', 'Matured', 'Premium Holiday']
export const PAY_MODES   = ['Cash', 'Credit Card', 'Giro', 'Medisave', 'CPF OA', 'CPF SA', 'CPF SRS', 'MS + Cash', 'MS + Giro', 'MS + CC']

export function fmt(n: number | null | undefined) {
  if (!n || n === 0) return '—'
  return '$' + Math.round(n).toLocaleString()
}
// Premium-specific formatter: shows cents only when the value has a non-zero
// fractional part (e.g. $1,200.50 stays, $1,200.00 displays as $1,200).
export function fmtPremium(n: number | null | undefined) {
  if (!n || n === 0) return '—'
  const rounded = Math.round(n * 100) / 100
  const hasCents = Math.abs(rounded - Math.round(rounded)) > 1e-9
  return '$' + rounded.toLocaleString(undefined, {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

export default function PolicyModal({policy,personLabel,allPeople,categories,policyTypes,companies,products,onSave,onClose,clientId,onHistoryChanged}:{
  policy:Policy; personLabel:string
  allPeople:{key:string;label:string}[]
  categories:InsCategory[]; policyTypes:InsPolicyType[]
  companies:InsCompany[]; products:InsProduct[]
  onSave:(p:Policy)=>void; onClose:()=>void
  clientId:string|null; onHistoryChanged:()=>void
}) {
  const toast = useToast()
  const confirmAction = useConfirm()
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
      const rate = await getUsdSgdRate()
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
  // Policy Type filtering (once tagged in Admin Hub) only applies to Medical —
  // LTC's cascade is Coverage Type -> Company; there's no per-product type tag
  // for LTC. Untyped Medical products stay visible until tagged.
  const selType = form.categoryCode === 'medical' ? filtTypes.find(t => t.name === form.policyTypeCode) : undefined
  const filtProds = selComp && hasProducts
    ? products.filter(pr => pr.company_id === selComp.id && (!selType || pr.policy_type_id == null || pr.policy_type_id === selType.id))
    : []

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
    setIsOtherProduct(false);
    setPremMatMode('preset');
    setCovMatMode('preset');
  }
  const onCompChange=(name:string)=>{
    setForm(prev=>({...prev,companyName:name,productName:''}))
    setIsOtherProduct(false)
  }

  const isMedical  = form.categoryCode==='medical'
  const isLTC      = form.categoryCode==='ltc'
  const isLife     = form.categoryCode==='life'
  const isEndow    = form.categoryCode==='endowment'
  const isGeneral  = form.categoryCode==='general'
  const isRider    = form.policyTypeCode?.toLowerCase() === 'rider'

  // Product Name "Other (type manually)" — mirrors the isOtherRiderDesc pattern
  // below: a separate flag decouples the <select> from the free-text value so
  // typing doesn't collapse the manual input on the first keystroke.
  const [isOtherProduct, setIsOtherProduct] = useState(() => {
    return !!policy.productName && !filtProds.some(p => p.name === policy.productName);
  });

  const ltcProductName = (form.productName || '').trim().toLowerCase();
  const isStandardLTC = isLTC && ['careshield life', 'eldershield 300', 'eldershield 400'].includes(ltcProductName);

  // Remarks auto-generate — only for Medical & LTC, pulls the selected
  // product's default_remarks from Admin, falls back to "Provides {briefDescription}"
  // for Medical when no default is set. Always editable after.
  async function generateRemarks() {
    const selProd = filtProds.find(pr => pr.name === form.productName);
    let generated = '';
    if (selProd?.default_remarks && selProd.default_remarks.trim()) {
      generated = selProd.default_remarks.trim();
    } else if (isMedical) {
      if (!form.briefDescription) { toast('Select a Brief Description first.', 'error'); return; }
      generated = `Provides ${form.briefDescription}`;
    } else {
      toast('No default remarks set for this product yet. Add one in Admin → Insurance Reference Data.', 'error');
      return;
    }
    if (form.remarks && form.remarks.trim() && form.remarks.trim() !== generated) {
      if (!await confirmAction('This will replace your current Remarks text. Continue?', { confirmLabel: 'Replace' })) return;
    }
    f('remarks', generated);
  }

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
  const ltcPayModes   = ['Cash', 'Medisave', 'MS + Cash', 'MS + Giro', 'MS + CC'];
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
              <select
                value={isOtherProduct ? '__other' : form.productName}
                onChange={e => {
                  if (e.target.value === '__other') {
                    setIsOtherProduct(true);
                    f('productName', '');
                  } else {
                    setIsOtherProduct(false);
                    f('productName', e.target.value);
                  }
                }}
                style={s}>
                <option value="">Select…</option>
                {filtProds.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}
                <option value="__other">Other (type manually)</option>
              </select>
            ) : (
              <input type="text" value={form.productName} onChange={e=>f('productName',e.target.value)} placeholder="e.g. MyWholeLife Plan" style={inp}/>
            )}
            {isOtherProduct && (
              <input type="text" value={form.productName} onChange={e=>f('productName',e.target.value)} placeholder="Enter product name" style={{...inp,marginTop:6}}/>
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
                <div style={{fontSize:10,color:'var(--ink3)',marginTop:3,fontFamily:'DM Mono,monospace'}}>≈ {fmtPremium((form.premiumCash||0)*fx)} SGD</div>
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
            <div><label style={lbl}>Inception Date</label><DateInput value={form.inceptionDate} onChange={v=>f('inceptionDate',v)} style={inp}/></div>
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
              {premMatMode==='date'&&<DateInput value={form.premiumMaturity||''} onChange={v=>f('premiumMaturity',v)} style={{...inp,marginTop:6}}/>}
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
              {covMatMode==='date'&&<DateInput value={form.coverageMaturity||''} onChange={v=>f('coverageMaturity',v)} style={{...inp,marginTop:6}}/>}
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
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:5}}>
                <label style={{...lbl,marginBottom:0}}>Remarks</label>
                {(isMedical || isLTC) && (
                  <button type="button" onClick={generateRemarks}
                    style={{fontSize:11,padding:'3px 10px',border:'1px solid var(--gold)',background:'none',color:'var(--gold)',cursor:'pointer',fontFamily:'inherit'}}>
                    ✨ Generate
                  </button>
                )}
              </div>
              <textarea 
                value={form.remarks} 
                onChange={e=>f('remarks',e.target.value)} 
                placeholder="e.g. In-Force, value as of 05/03/2026. Additional notes about the policy..."
                rows={4}
                style={{...inp, resize:'vertical', minHeight:'80px', fontFamily:'inherit'}}
              />
            </div>
          </div>

          {!isNew && clientId && (
            <ServicingHistorySection clientId={clientId} policyId={policy.id} onChanged={onHistoryChanged} />
          )}
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

export function ServicingHistorySection({clientId, policyId, onChanged}:{clientId:string; policyId:string; onChanged:()=>void}) {
  const supabase = createClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [entries, setEntries] = useState<PolicyHistoryEntry[]>([])
  const [correctingId, setCorrectingId] = useState<string | null>(null)
  const [correctionText, setCorrectionText] = useState('')
  const [correctionReason, setCorrectionReason] = useState('Wrong date entered')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const rows = await getHistoryForPolicy(supabase, clientId, policyId)
    setEntries(rows)
    setLoading(false)
  }

  useEffect(() => { load() }, [clientId, policyId])

  const active = entries.filter(e => !e.is_superseded)
  const lastUpdate = active[0] || entries[0]

  function startCorrection(entry: PolicyHistoryEntry) {
    setCorrectingId(entry.id)
    setCorrectionText(entry.description)
    setCorrectionReason('Wrong date entered')
  }

  async function submitCorrection() {
    const original = entries.find(e => e.id === correctingId)
    if (!original || !correctionText.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await addCorrection(supabase, original, {
      description: correctionText.trim(),
      reason: correctionReason,
      createdBy: user?.id || null,
    })
    setSaving(false)
    if (error) { toast('Could not save correction: ' + error, 'error'); return }
    setCorrectingId(null)
    await load()
    onChanged()
  }

  const lbl: React.CSSProperties = {fontFamily:'DM Mono,monospace',fontSize:10,letterSpacing:'0.05em',textTransform:'uppercase',color:'var(--ink3)'}

  return (
    <div style={{marginTop:20,border:'1px solid var(--line)',borderRadius:8,overflow:'hidden'}}>
      <div
        onClick={()=>setOpen(o=>!o)}
        style={{display:'flex',alignItems:'center',gap:8,padding:'12px 14px',cursor:'pointer',background:'white'}}
      >
        <span style={{fontSize:11,color:'var(--ink3)',transition:'transform 0.15s ease',transform:open?'rotate(90deg)':'none',display:'inline-block'}}>▶</span>
        <span style={lbl}>Servicing History</span>
        {entries.length > 0 && (
          <span style={{fontSize:10,fontWeight:600,color:'var(--emerald)',background:'rgba(45,90,78,.12)',padding:'1px 7px',borderRadius:10,fontFamily:'Inter,sans-serif'}}>
            {entries.length}
          </span>
        )}
        <span style={{flex:1}} />
        {lastUpdate && (
          <span style={{fontSize:11,color:'var(--ink3)'}}>
            Last update {new Date(lastUpdate.occurred_at).toLocaleDateString('en-SG',{day:'numeric',month:'short',year:'numeric'})}
          </span>
        )}
      </div>

      {open && (
        <div style={{padding:'4px 14px 12px',background:'#FAFAF8'}}>
          {loading && <div style={{padding:'14px 4px',fontSize:12,color:'var(--ink3)'}}>Loading…</div>}
          {!loading && entries.length === 0 && (
            <div style={{padding:'14px 4px',fontSize:12,color:'var(--ink3)'}}>No servicing history yet for this policy.</div>
          )}
          {!loading && entries.map((entry, i) => {
            const isLast = i === entries.length - 1
            return (
              <div key={entry.id} style={{display:'flex',gap:10,padding:'10px 0',borderBottom:isLast?'none':'1px solid var(--line)'}}>
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',paddingTop:3}}>
                  <span style={{width:7,height:7,borderRadius:'50%',background:entry.is_superseded?'var(--ink3)':'var(--emerald)',flexShrink:0}} />
                </div>
                <div style={{flex:1}}>
                  <div style={{
                    fontSize:13,
                    color: entry.is_superseded ? 'var(--ink3)' : 'var(--ink)',
                    textDecoration: entry.is_superseded ? 'line-through' : 'none',
                    textDecorationColor: '#C9C3B3',
                  }}>
                    {entry.description}
                  </div>
                  <div style={{fontFamily:'DM Mono,monospace',fontSize:10.5,color:'var(--ink3)',marginTop:2}}>
                    {new Date(entry.occurred_at).toLocaleDateString('en-SG',{day:'2-digit',month:'short',year:'numeric'}).toUpperCase()}
                    {entry.entry_type === 'correction' && ' · Correction'}
                  </div>
                  {entry.is_superseded && (
                    <div style={{fontSize:12,color:'var(--ink2)',marginTop:5,padding:'8px 10px',background:'white',borderRadius:6,borderLeft:'2px solid var(--rouge)'}}>
                      <div style={{fontFamily:'DM Mono,monospace',fontSize:9.5,color:'var(--rouge)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:2}}>Superseded</div>
                      {entries.find(e => e.supersedes_id === entry.id)?.correction_reason || 'Corrected'}
                    </div>
                  )}
                  {/* Only system-generated / correction entries linked to a Service Request are eligible for
                      correction — the onboarding entry (no service_request_id, entry_type='onboarded') isn't. */}
                  {!entry.is_superseded && entry.entry_type !== 'manual' && entry.entry_type !== 'onboarded' && correctingId !== entry.id && (
                    <button
                      onClick={()=>startCorrection(entry)}
                      style={{marginTop:5,fontSize:11,fontWeight:600,color:'var(--ink3)',background:'none',border:'none',cursor:'pointer',padding:0}}
                    >
                      Correct this entry
                    </button>
                  )}
                  {correctingId === entry.id && (
                    <div style={{marginTop:8,padding:'10px 12px',background:'white',border:'1px solid var(--line)',borderRadius:6}}>
                      <div style={{fontSize:11,color:'var(--ink3)',marginBottom:8}}>The original entry stays visible, struck through. This adds a new entry that supersedes it.</div>
                      <label style={{...lbl,display:'block',marginBottom:4}}>What actually happened</label>
                      <textarea
                        value={correctionText}
                        onChange={e=>setCorrectionText(e.target.value)}
                        rows={2}
                        style={{width:'100%',padding:'8px 9px',background:'var(--cream2)',border:'1px solid var(--line)',borderRadius:6,fontFamily:'inherit',fontSize:13,resize:'vertical'}}
                      />
                      <label style={{...lbl,display:'block',margin:'8px 0 4px'}}>Reason for correction</label>
                      <select
                        value={correctionReason}
                        onChange={e=>setCorrectionReason(e.target.value)}
                        style={{width:'100%',padding:'8px 9px',background:'var(--cream2)',border:'1px solid var(--line)',borderRadius:6,fontFamily:'inherit',fontSize:13}}
                      >
                        <option>Wrong date entered</option>
                        <option>Wrong policy linked</option>
                        <option>Wrong Service Request linked</option>
                        <option>Other — explain above</option>
                      </select>
                      <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:10}}>
                        <button onClick={()=>setCorrectingId(null)} style={{padding:'7px 14px',background:'none',border:'1px solid var(--line)',color:'var(--ink3)',cursor:'pointer',fontSize:12}}>Cancel</button>
                        <button
                          onClick={submitCorrection}
                          disabled={saving || !correctionText.trim()}
                          style={{padding:'7px 14px',background:'var(--rouge)',color:'white',border:'none',cursor:saving?'default':'pointer',fontSize:12,fontWeight:500,opacity:saving?0.6:1}}
                        >
                          {saving ? 'Saving…' : 'Save Correction'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}