'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getAge(dob?: string): number {
  if (!dob) return 0
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  if (today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--
  return Math.max(0, age)
}

function fmt(n: number): string {
  if (!n || isNaN(n)) return 'SGD 0'
  return 'SGD ' + Math.round(n).toLocaleString('en-SG')
}

function fmtShort(n: number): string {
  if (!n || isNaN(n)) return '$0'
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return '$' + Math.round(n / 1_000) + 'K'
  return '$' + Math.round(n)
}

function initials(name: string): string {
  return name?.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Status = 'good' | 'warn' | 'gap' | 'empty'

interface PlanningArea {
  id: string
  icon: string
  label: string
  status: Status
  headline: string
  subline: string
  href: string
  actions: string[]
}

interface ActionItem {
  priority: 'high' | 'medium'
  area: string
  text: string
  href: string
}

// ─── STATUS COLOURS ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<Status, { bg: string; border: string; dot: string; label: string }> = {
  good:  { bg: '#EFF7F3', border: '#d0e8da', dot: '#2D5A4E', label: 'On Track'   },
  warn:  { bg: '#FDF8F0', border: '#e8d9be', dot: '#A8834A', label: 'Review'     },
  gap:   { bg: '#FEF3F2', border: '#FCA5A5', dot: '#C0392B', label: 'Gap'        },
  empty: { bg: '#F5F3EE', border: '#E8E4DC', dot: '#aaa',    label: 'Not Started'},
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function ExecutiveSummaryPage() {
  const [loading, setLoading]       = useState(true)
  const [client, setClient]         = useState<any>(null)
  const [spouse, setSpouse]         = useState<any>(null)
  const [children, setChildren]     = useState<any[]>([])
  const [ffData, setFfData]         = useState<Record<string, any>>({})
const [lastUpdated, setLastUpdated] = useState<Record<string, string>>({})
const [editingField, setEditingField] = useState<string | null>(null)  
const [saving, setSaving] = useState(false)                             
const [editingMemberId, setEditingMemberId] = useState<string | null>(null) 
const router = useRouter()
  const supabase = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }

    const savedId = localStorage.getItem('selectedClientId')
    const { data: clients } = await supabase
      .from('clients').select('*').order('created_at', { ascending: false })
    if (!clients || clients.length === 0) { setLoading(false); return }

    const c = clients.find((x: any) => x.id === savedId) || clients[0]
    setClient(c)

    const [{ data: family }, { data: ffRows }] = await Promise.all([
      supabase.from('family_members').select('*').eq('client_id', c.id),
      supabase.from('fact_finding').select('*').eq('client_id', c.id),
    ])

    if (family) {
      setSpouse(family.find((f: any) => f.relationship === 'Spouse') || null)
      setChildren(family.filter((f: any) => ['Son', 'Daughter', 'Child'].includes(f.relationship)))
    }

    if (ffRows) {
      const merged: Record<string, any> = {}
      const updated: Record<string, string> = {}
      for (const row of ffRows) {
        merged[row.section] = row.data || {}
        if (row.updated_at) updated[row.section] = row.updated_at
      }
      setFfData(merged)
      setLastUpdated(updated)
    }

    setLoading(false)
  }
    // ─── UPDATE FUNCTIONS ───────────────────────────────────────────────────────

  async function updateClient(field: string, value: any) {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('clients')
        .update({ [field]: value })
        .eq('id', client.id)
      
      if (error) throw error
      
      await load()
      setEditingField(null)
    } catch (error) {
      console.error('Error updating client:', error)
      alert('Failed to update. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function updateFamilyMember(memberId: string, field: string, value: any) {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('family_members')
        .update({ [field]: value })
        .eq('id', memberId)
      
      if (error) throw error
      
      await load()
      setEditingMemberId(null)
      setEditingField(null)
    } catch (error) {
      console.error('Error updating family member:', error)
      alert('Failed to update. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen" style={{ background: '#EEEADE' }}>
      <div className="text-center">
        <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3"
          style={{ borderColor: '#A8834A', borderTopColor: 'transparent' }} />
        <p style={{ fontFamily: 'Inter', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#A8834A' }}>Loading</p>
      </div>
    </div>
  )

  if (!client) return (
    <div className="flex flex-col items-center justify-center h-screen" style={{ background: '#EEEADE' }}>
      <p style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: '#1C1A17', marginBottom: 8 }}>No Client Selected</p>
      <p style={{ fontFamily: 'Inter', fontSize: 12, color: '#888' }}>Select a client from the sidebar to begin</p>
    </div>
  )

  // ── DERIVE PLANNING AREAS FROM FACT_FINDING ─────────────────────────────────

  const clientAge = client.dob ? getAge(client.dob) : (client.age || 35)
  const spouseAge = spouse?.dob ? getAge(spouse.dob) : (spouse?.age || 0)
  const isCouple  = !!spouse

  const prot = ffData['protection_needs']?.protection || ffData['protection_needs'] || {}
  const portf = ffData['protection_portfolio'] || {}
  const acc   = ffData['accumulation']?.acc || {}
  const ret   = ffData['retirement']?.ret || {}
  const edu   = ffData['education']?.edu || {}
  const estate = ffData['estate']?.estate || {}
  const fin   = ffData['financials'] || {}

  // ── PROTECTION ───────────────────────────────────────────────────────────────

  const dtpdNeedClient  = prot.p1_dtpd_need || 0
  const ciNeedClient    = prot.p1_ci_need   || 0
  const dtpdNeedSpouse  = prot.p2_dtpd_need || 0
  const ciNeedSpouse    = prot.p2_ci_need   || 0

  const existingLifeClient = prot.existingLifeCoverClient || 0
  const existingCIClient   = prot.existingCICoverClient   || 0
  const existingLifeSpouse = prot.existingLifeCoverSpouse || 0
  const existingCISpouse   = prot.existingCICoverSpouse   || 0

  const lifeGapClient  = Math.max(0, dtpdNeedClient - existingLifeClient)
  const ciGapClient    = Math.max(0, ciNeedClient   - existingCIClient)
  const lifeGapSpouse  = Math.max(0, dtpdNeedSpouse - existingLifeSpouse)
  const ciGapSpouse    = Math.max(0, ciNeedSpouse   - existingCISpouse)
  const totalProtGap   = lifeGapClient + ciGapClient + lifeGapSpouse + ciGapSpouse
  const protHasData = (dtpdNeedClient > 0) || (ciNeedClient > 0) || (prot.p1_dtpd_need > 0) || (prot.p1_ci_need > 0)

  let protStatus: Status = 'empty'
  let protHeadline = 'Not yet assessed'
  const protActions: string[] = []

  if (protHasData) {
    if (totalProtGap > 0) {
      protStatus   = 'gap'
      protHeadline = `${fmtShort(totalProtGap)} total gap`
      // protSubline now built in AreaCard for multi-line — store structured data
      if (lifeGapClient > 0) protActions.push(`D/TPD gap of ${fmt(lifeGapClient)} for ${client.name}`)
      if (ciGapClient   > 0) protActions.push(`CI gap of ${fmt(ciGapClient)} for ${client.name}`)
      if (lifeGapSpouse > 0 && spouse) protActions.push(`D/TPD gap of ${fmt(lifeGapSpouse)} for ${spouse.name}`)
      if (ciGapSpouse   > 0 && spouse) protActions.push(`CI gap of ${fmt(ciGapSpouse)} for ${spouse.name}`)
    } else {
      protStatus   = 'good'
      protHeadline = 'Coverage adequate'
    }
  }

  // Build multi-line protection subline
  const protSublines: string[] = []
  if (protHasData && totalProtGap > 0) {
    if (lifeGapClient > 0 || ciGapClient > 0) {
      const parts = [lifeGapClient > 0 ? `D/TPD ${fmtShort(lifeGapClient)}` : '', ciGapClient > 0 ? `CI ${fmtShort(ciGapClient)}` : ''].filter(Boolean)
      protSublines.push(`${client.name}: ${parts.join(' · ')}`)
    }
    if (isCouple && (lifeGapSpouse > 0 || ciGapSpouse > 0) && spouse) {
      const parts = [lifeGapSpouse > 0 ? `D/TPD ${fmtShort(lifeGapSpouse)}` : '', ciGapSpouse > 0 ? `CI ${fmtShort(ciGapSpouse)}` : ''].filter(Boolean)
      protSublines.push(`${spouse.name}: ${parts.join(' · ')}`)
    }
  } else if (protHasData) {
    protSublines.push(`${client.name}: D/TPD ${fmtShort(existingLifeClient)} · CI ${fmtShort(existingCIClient)}`)
    if (isCouple && spouse) protSublines.push(`${spouse.name}: D/TPD ${fmtShort(existingLifeSpouse)} · CI ${fmtShort(existingCISpouse)}`)
  } else {
    protSublines.push('Complete Wealth Protection tab')
  }
  const protSubline = protSublines.join('\n')

  // ── ACCUMULATION ─────────────────────────────────────────────────────────────

  const accGoals       = acc.goals || []
  const accHasData     = accGoals.length > 0
  const accReturnRate  = acc.returnRate || 5
  const accInflation   = acc.inflationRate || 3

  function calcGoalMonthly(goal: any): number {
    const r    = accReturnRate / 100
    const g    = accInflation / 100
    const n    = Math.max(goal.yearsToGoal || 1, 0.1)
    const nm   = n * 12
    const rm   = r / 12
    const fvT  = goal.amountType === 'pv' ? (goal.targetAmount || 0) * Math.pow(1 + g, n) : (goal.targetAmount || 0)
    const fvEx = (goal.existingSavings || 0) * Math.pow(1 + r, n)
    const gap  = Math.max(0, fvT - fvEx)
    const mp   = 1 - (goal.lumpSumPct || 50) / 100
    if (mp <= 0 || nm <= 0) return 0
    if (rm === 0) return (gap * mp) / nm
    return (gap * mp) * rm / (Math.pow(1 + rm, nm) - 1)
  }

  const totalAccMonthly = accGoals.reduce((s: number, g: any) => s + calcGoalMonthly(g), 0)
  const totalAccCorpus  = accGoals.reduce((s: number, g: any) => {
    const r = accReturnRate / 100, g2 = accInflation / 100
    const n = Math.max(g.yearsToGoal || 1, 0.1)
    const fvT = g.amountType === 'pv' ? (g.targetAmount || 0) * Math.pow(1 + g2, n) : (g.targetAmount || 0)
    return s + fvT
  }, 0)

  let accStatus: Status = 'empty'
  let accHeadline = 'No goals added'
  let accSubline  = 'Add wealth goals in Strategic Objectives'
  const accActions: string[] = []

  if (accHasData) {
    accStatus   = totalAccMonthly > 0 ? 'gap' : 'good'
    accHeadline = `${accGoals.length} goal${accGoals.length !== 1 ? 's' : ''} · ${fmtShort(totalAccCorpus)}`
    accSubline  = totalAccMonthly > 0 ? `${fmt(totalAccMonthly)}/mo needed` : 'Fully funded from existing assets'
    if (totalAccMonthly > 0) accActions.push(`Invest ${fmt(totalAccMonthly)}/mo across ${accGoals.length} wealth goal${accGoals.length !== 1 ? 's' : ''}`)
  }

// ── RETIREMENT ───────────────────────────────────────────────────────────────

const retClient = ret.client || {}
const retHasData = !!ret.client
const retAge = retClient.retirementAge || 65
const retLE = retClient.lifeExpectancy || 85
const yrsToRet = Math.max(0, retAge - clientAge)
const retYears = Math.max(0, retLE - retAge)

// ✅ Read saved values from database
const savedCorpusNeeded = ffData['retirement']?.corpusNeeded || 0
const savedRetirementGap = ffData['retirement']?.retirementGap || 0
const savedMonthlySavings = ffData['retirement']?.monthlySavingsNeeded || 0

// Use saved values
let corpusNeeded = savedCorpusNeeded
let retGap = savedRetirementGap
let retMonthlySavings = savedMonthlySavings

let retStatus: Status = 'empty'
let retHeadline = 'Not yet configured'
let retGapLabel = 'Savings Gap'
let retSubline = 'Set retirement parameters in Strategic Objectives'
const retActions: string[] = []

if (retHasData || savedCorpusNeeded > 0) {
  retStatus = retGap > 0 ? 'gap' : 'good'
  retHeadline = `Savings Gap ${fmtShort(retGap)}`
  retSubline = `Age ${retAge} · ${yrsToRet}y away · ${retYears}y retirement`
  if (retGap > 0) {
    retStatus = retGap > 100000 ? 'gap' : 'warn'
    retActions.push(`Retirement savings gap of ${fmt(retGap)} — invest ${fmt(retMonthlySavings)}/mo`)
  }
}

// Calculate liquid assets (needed for Estate and Financial Overview)
const clientLiquid = (fin.a_savings || 0) + (fin.a_fixed_deposit || 0) + (fin.a_srs || 0) +
  (fin.a_shares || 0) + (fin.a_etf || 0) + (fin.a_unit_trust || 0) +
  (fin.a_bonds || 0) + (fin.a_alternatives || 0)

// Simple expense total for financial overview
const annExpClient = (fin.s_income_tax || 0) + (fin.s_insurance || 0) + (fin.s_regular_savings || 0) +
  (fin.s_housing || 0) + (fin.s_utilities || 0) + (fin.s_family_food || 0) +
  (fin.s_transport || 0) + (fin.s_children || 0) + (fin.s_lifestyle || 0) + (fin.s_others || 0)

// ── EDUCATION ────────────────────────────────────────────────────────────────

  const eduChildren   = edu.children || []
  const eduReturnRate = edu.returnRate || 5
  const eduTuitionInfl = edu.tuitionInflation || 5
  const eduLivingInfl  = edu.livingInflation  || 3
  const eduHasData    = children.length > 0

  let totalEduFund = 0, totalEduGap = 0, totalEduMonthly = 0

  for (const kid of children) {
    const age = kid.age ?? getAge(kid.date_of_birth)
    const ec  = eduChildren.find((e: any) => e.childId === kid.id)
    const defaultEntry = kid.gender === 'Male' ? 21 : 19
    const uniEntryAge  = ec?.uniEntryAge  || defaultEntry
    const courseDur    = ec?.courseDuration || 4
    const annTuition   = ec?.annualTuition  || 9000
    const annLiving    = ec?.annualLiving   || 12000
    const existSavings = ec?.existingSavings || 0
    const lumpPct      = ec?.lumpSumPct || 50
    const yearsToUni   = Math.max(0, uniEntryAge - age)

    const fvTuition = annTuition * Math.pow(1 + eduTuitionInfl / 100, yearsToUni) * courseDur
    const fvLiving  = annLiving  * Math.pow(1 + eduLivingInfl  / 100, yearsToUni) * courseDur
    const fund      = fvTuition + fvLiving
    const existFV   = existSavings * Math.pow(1 + eduReturnRate / 100, yearsToUni)
    const gap       = Math.max(0, fund - existFV)
    const n         = yearsToUni * 12
    const rm        = eduReturnRate / 100 / 12
    const mp        = 1 - lumpPct / 100
    const mo        = gap > 0 && n > 0 && mp > 0
      ? (rm === 0 ? (gap * mp) / n : (gap * mp) * rm / (Math.pow(1 + rm, n) - 1))
      : 0

    totalEduFund    += fund
    totalEduGap     += gap
    totalEduMonthly += mo
  }

  let eduStatus: Status = 'empty'
  let eduHeadline = 'No children in profile'
  let eduSubline  = 'Add children in client profile to plan education'
  const eduActions: string[] = []

  if (eduHasData) {
    const configured = eduChildren.length > 0
    if (!configured) {
      eduStatus   = 'warn'
      eduHeadline = `${children.length} child${children.length !== 1 ? 'ren' : ''} · Not configured`
      eduSubline  = 'Open Education Planning tab to project costs'
      eduActions.push(`Configure education plan for ${children.length} child${children.length !== 1 ? 'ren' : ''}`)
    } else if (totalEduGap > 0) {
      eduStatus   = 'gap'
      eduHeadline = `${fmtShort(totalEduFund)} total fund`
      eduSubline  = `Gap ${fmtShort(totalEduGap)} · ${fmt(totalEduMonthly)}/mo`
      if (totalEduMonthly > 0) eduActions.push(`Education fund shortfall — invest ${fmt(totalEduMonthly)}/mo`)
    } else {
      eduStatus   = 'good'
      eduHeadline = `${fmtShort(totalEduFund)} total fund`
      eduSubline  = `${children.length} child${children.length !== 1 ? 'ren' : ''} · Fully funded`
    }
  }

// ── ESTATE ───────────────────────────────────────────────────────────────────

const estClient      = estate.client || {}
const estSpouse      = estate.spouse  || {}
const estHasData     = Object.keys(estClient).length > 0

// Helper function
function amortisedOutstanding(prop: any): number {
  if (prop.outstanding > 0) return prop.outstanding
  const initialLoan = prop.initialLoanAmount ?? 0
  const annualRate  = prop.interestRate ?? 0
  const tenure      = prop.initialTenure ?? 25
  const start       = prop.loanStartDate ?? ''
  if (!initialLoan || !tenure) return 0
  const parts = start.split('/')
  if (parts.length !== 2) return initialLoan
  const startDate = new Date(parseInt(parts[1]), parseInt(parts[0]) - 1, 1)
  const today = new Date()
  const months = (today.getFullYear() - startDate.getFullYear()) * 12 +
    (today.getMonth() - startDate.getMonth())
  if (months <= 0) return initialLoan
  const n = tenure * 12
  if (months >= n) return 0
  if (!annualRate) return Math.round(initialLoan * (1 - months / n))
  const rv = annualRate / 100 / 12
  const pmt = initialLoan * rv * Math.pow(1 + rv, n) / (Math.pow(1 + rv, n) - 1)
  return Math.max(0, Math.round(
    initialLoan * Math.pow(1 + rv, months) -
    pmt * (Math.pow(1 + rv, months) - 1) / rv
  ))
}

// Calculate property equity (needed for both Estate and Financial Overview)
const allProps   = (fin.properties || []) as any[]
const propEquity = allProps.reduce((s: number, p: any) =>
  s + Math.max(0, (p.propertyValue ?? p.purchasePrice ?? 0) - amortisedOutstanding(p)), 0)
const totalLiab  = allProps.reduce((s: number, p: any) => s + amortisedOutstanding(p), 0)

// ✅ Read saved net estate from database FIRST
const savedNetEstate = ffData['estate']?.netEstate || estate.netEstate || 0

// Use saved value if available, otherwise calculate
let netEstate = savedNetEstate

// Fallback calculation only if no saved value
if (netEstate === 0) {
  const totalAssets = clientLiquid +
    (fin.a_cpf_oa || 0) + (fin.a_cpf_sa || 0) + (fin.a_cpf_ma || 0) + (fin.a_cpf_ra || 0) +
    propEquity
  netEstate = Math.max(0, totalAssets - totalLiab)
}

// Readiness score: will, lpa, cpf nomination, trust
function checkItem(person: any, key: string, goodVal: string): boolean {
  return person[key] === goodVal
}

const clientChecks = [
  checkItem(estClient, 'willStatus',   'has_will'),
  checkItem(estClient, 'lpaStatus',    'registered'),
  checkItem(estClient, 'cpfNomStatus', 'nominated'),
]
const spouseChecks = isCouple ? [
  checkItem(estSpouse, 'willStatus',   'has_will'),
  checkItem(estSpouse, 'lpaStatus',    'registered'),
  checkItem(estSpouse, 'cpfNomStatus', 'nominated'),
] : []
const allChecks   = [...clientChecks, ...spouseChecks]
const doneChecks  = allChecks.filter(Boolean).length
const totalChecks = allChecks.length || 3
const estScore    = totalChecks > 0 ? doneChecks / totalChecks : 0

let estStatus: Status = 'empty'
let estHeadline = 'Not yet reviewed'
let estSubline  = 'Complete Estate Planning tab'
const estActions: string[] = []

if (estHasData || netEstate > 0) {
  estStatus   = estScore === 1 ? 'good' : estScore >= 0.5 ? 'warn' : 'gap'
  estHeadline = `Net estate ${fmtShort(netEstate)}`
  estSubline  = estHasData ? `${doneChecks}/${totalChecks} readiness items done` : 'Estate documents not reviewed'
  if (!checkItem(estClient, 'willStatus', 'has_will'))
    estActions.push(`Will not in place for ${client.name}`)
  if (!checkItem(estClient, 'lpaStatus', 'registered'))
    estActions.push(`LPA not registered for ${client.name}`)
  if (!checkItem(estClient, 'cpfNomStatus', 'nominated') && (fin.a_cpf_oa || fin.a_cpf_sa || fin.a_cpf_ra))
    estActions.push(`CPF nomination missing for ${client.name}`)
  if (isCouple && spouse) {
    if (!checkItem(estSpouse, 'willStatus', 'has_will'))
      estActions.push(`Will not in place for ${spouse.name}`)
    if (!checkItem(estSpouse, 'lpaStatus', 'registered'))
      estActions.push(`LPA not registered for ${spouse.name}`)
  }
}

  // ── ASSEMBLE PLANNING AREAS ──────────────────────────────────────────────────

  const areas: PlanningArea[] = [
    { id: 'protection',   icon: '🛡',  label: 'Wealth Protection',   status: protStatus, headline: protHeadline, subline: protSubline, href: '/dashboard/objectives', actions: protActions },
    { id: 'accumulation', icon: '🏦',  label: 'Wealth Accumulation', status: accStatus,  headline: accHeadline,  subline: accSubline,  href: '/dashboard/objectives', actions: accActions  },
    { id: 'retirement',   icon: '🌅',  label: 'Retirement',          status: retStatus,  headline: retHeadline,  subline: retSubline,  href: '/dashboard/objectives', actions: retActions  },
    { id: 'education',    icon: '🎓',  label: 'Education Planning',  status: eduStatus,  headline: eduHeadline,  subline: eduSubline,  href: '/dashboard/objectives', actions: eduActions  },
    { id: 'estate',       icon: '🏛',  label: 'Estate Planning',     status: estStatus,  headline: estHeadline,  subline: estSubline,  href: '/dashboard/objectives', actions: estActions  },
  ]

  const allActions: ActionItem[] = [
    ...protActions.map(t => ({ priority: 'high'   as const, area: '🛡 Protection',   text: t, href: '/dashboard/objectives' })),
    ...retActions .map(t => ({ priority: 'high'   as const, area: '🌅 Retirement',   text: t, href: '/dashboard/objectives' })),
    ...eduActions .map(t => ({ priority: 'high'   as const, area: '🎓 Education',    text: t, href: '/dashboard/objectives' })),
    ...estActions .map(t => ({ priority: 'medium' as const, area: '🏛 Estate',       text: t, href: '/dashboard/objectives' })),
    ...accActions .map(t => ({ priority: 'medium' as const, area: '🏦 Accumulation', text: t, href: '/dashboard/objectives' })),
  ]

  // Last session — most recent updated_at across all sections
  const lastSessionDate = Object.values(lastUpdated).sort().reverse()[0] || ''

  // ── FINANCIAL SNAPSHOT ───────────────────────────────────────────────────────

  const p1Gross  = (fin.person1 as any)?.gross_monthly || 0
  const p2Gross  = isCouple ? ((fin.person2 as any)?.gross_monthly || 0) : 0
  const totalIncome = (p1Gross + p2Gross) * 12
  const totalExp    = annExpClient
  const annualSurplus = totalIncome * 0.8 - totalExp  // rough take-home after CPF

  // ─── RENDER ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#F5F3EE', fontFamily: 'Inter, sans-serif' }}>

          {saving && (
      <div style={{
        position: 'fixed',
        top: 20,
        right: 20,
        background: '#A8834A',
        color: 'white',
        padding: '8px 16px',
        borderRadius: 20,
        fontSize: 12,
        zIndex: 9999,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
      }}>
        Saving changes...
      </div>
    )}

      {/* ── HERO BAND ── */}
      <div style={{ background: '#1C1A17', padding: '28px 40px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Avatar */}
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(168,131,74,0.25)', border: '1px solid rgba(168,131,74,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Cormorant Garamond, serif', fontSize: 20, color: 'rgba(255,255,255,0.8)', flexShrink: 0 }}>
              {initials(client.name)}
            </div>
            <div>
              <p style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#A8834A', marginBottom: 6 }}>Executive Summary</p>
              <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 30, fontWeight: 300, color: '#F5F0E8', letterSpacing: 0.5, marginBottom: 4 }}>
  {isCouple && spouse ? (
    <>
      <EditableField 
        value={client.name} 
        onSave={(newName) => updateClient('name', newName)}
      />
      {' & '}
      <EditableField 
        value={spouse.name}
        onSave={(newName) => updateFamilyMember(spouse.id, 'name', newName)}
      />
    </>
  ) : (
    <EditableField 
      value={client.name} 
      onSave={(newName) => updateClient('name', newName)}
    />
  )}
</h1>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                  {client.gender || 'Client'} · Age {clientAge}
                  {isCouple && ` & ${spouse.name} Age ${spouseAge}`}
                </span>
                {children.length > 0 && (
                  <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                    · {children.length} {children.length === 1 ? 'child' : 'children'}
                  </span>
                )}
                {lastSessionDate && (
                  <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                    · Last updated {formatDate(lastSessionDate)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Quick financial snapshot */}
          <div style={{ display: 'flex', gap: 32, alignItems: 'flex-end' }}>
            {[
              { label: 'Annual Income',    val: totalIncome > 0 ? fmtShort(totalIncome) : '—', sub: 'gross combined'         },
              { label: 'Net Estate',       val: netEstate   > 0 ? fmtShort(netEstate)   : '—', sub: 'assets minus liabilities' },
              { label: 'Annual Surplus',   val: annualSurplus > 0 ? fmtShort(annualSurplus) : '—', sub: 'est. after expenses'  },
            ].map((kpi, i) => (
              <div key={i} style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>{kpi.label}</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 500, color: '#c8a96e' }}>{kpi.val}</div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>{kpi.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── MAIN BODY ── */}
      <div style={{ padding: '32px 40px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28, alignItems: 'start' }}>

        {/* LEFT COLUMN */}
        <div>

          {/* Planning Status Grid */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--ink3)' }}>Planning Status</span>
              <div style={{ flex: 1, height: 1, background: '#E8E4DC' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              {areas.slice(0, 3).map(area => (
                <AreaCard key={area.id} area={area} />
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {areas.slice(3).map(area => (
                <AreaCard key={area.id} area={area} />
              ))}
            </div>
          </div>

          {/* Action Items */}
          {allActions.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--ink3)' }}>Action Items</span>
                <div style={{ flex: 1, height: 1, background: '#E8E4DC' }} />
                <span style={{ fontFamily: 'Inter', fontSize: 10, color: '#C0392B', fontWeight: 600 }}>{allActions.length} open</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {allActions.map((action, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    background: action.priority === 'high' ? '#FEF3F2' : 'white',
                    border: `1px solid ${action.priority === 'high' ? '#FCA5A5' : '#E8E4DC'}`,
                    borderLeft: `3px solid ${action.priority === 'high' ? '#C0392B' : '#A8834A'}`,
                    borderRadius: 8, padding: '12px 16px',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 500, color: '#1C1A17', marginBottom: 2 }}>{action.text}</div>
                      <div style={{ fontFamily: 'Inter', fontSize: 10, color: '#888' }}>{action.area}</div>
                    </div>
                    <span style={{
                      fontFamily: 'Inter', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: action.priority === 'high' ? '#C0392B' : '#A8834A',
                      background: action.priority === 'high' ? '#FEE2E2' : '#FDF8F0',
                      padding: '3px 8px', borderRadius: 4,
                    }}>
                      {action.priority === 'high' ? 'Priority' : 'Review'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {allActions.length === 0 && areas.some(a => a.status !== 'empty') && (
            <div style={{ marginTop: 28, padding: '20px 24px', background: '#EFF7F3', border: '1px solid #d0e8da', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>✓</span>
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: '#2D5A4E' }}>All planning areas addressed</div>
                <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#2D5A4E', marginTop: 2 }}>No immediate action items identified — continue monitoring</div>
              </div>
            </div>
          )}

          {/* Financial Overview bar */}
          {(annExpClient > 0 || totalIncome > 0) && (
            <div style={{ marginTop: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--ink3)' }}>Financial Overview</span>
                <div style={{ flex: 1, height: 1, background: '#E8E4DC' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {[
                  { label: 'Liquid Assets',     val: fmtShort(clientLiquid),           sub: 'cash & investments'       },
                  { label: 'Property Equity',    val: fmtShort(propEquity),             sub: 'net of mortgage'          },
                  { label: 'Annual Expenses',    val: fmtShort(annExpClient),           sub: 'from financial profile'   },
                  { label: 'Emergency Cover',    val: annExpClient > 0 ? (clientLiquid / (annExpClient / 12)).toFixed(1) + 'mo' : '—', sub: 'months of expenses'  },
                ].map((kpi, i) => (
                  <div key={i} style={{ background: 'white', border: '1px solid #E8E4DC', borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888', marginBottom: 6 }}>{kpi.label}</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: '#1C1A17', marginBottom: 3 }}>{kpi.val}</div>
                    <div style={{ fontFamily: 'Inter', fontSize: 10, color: '#aaa' }}>{kpi.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Household */}
          <div style={{ background: 'white', border: '1px solid #E8E4DC', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', background: '#F5F3EE', borderBottom: '1px solid #E8E4DC' }}>
              <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#1C1A17' }}>Household</span>
            </div>
                       <div style={{ padding: '12px 18px' }}>
              {/* Client */}
              <HouseholdRow
                name={client.name}
                tag="Client"
                tagColor="#A8834A"
                age={clientAge}
                gender={client.gender}
                dob={client.dob}
                isClient={true}
                onUpdate={updateClient}
              />
              {/* Spouse */}
              {spouse && (
                <HouseholdRow
                  name={spouse.name}
                  tag="Spouse"
                  tagColor="#6B5B8B"
                  age={spouseAge}
                  gender={spouse.gender}
                  dob={spouse.dob}
                  memberId={spouse.id}
                  onUpdate={(field, value) => updateFamilyMember(spouse.id, field, value)}
                />
              )}
              {/* Children */}
              {children.map((kid, i) => (
                <HouseholdRow
                  key={kid.id}
                  name={kid.name || kid.relationship}
                  tag={kid.relationship}
                  tagColor={kid.gender === 'Female' ? '#7A6AAA' : '#4A7C9E'}
                  age={kid.age ?? getAge(kid.date_of_birth)}
                  gender={kid.gender}
                  dob={kid.date_of_birth}
                  isLast={i === children.length - 1}
                  memberId={kid.id}
                  onUpdate={(field, value) => updateFamilyMember(kid.id, field, value)}
                />
              ))}
              {!spouse && children.length === 0 && (
                <p style={{ fontFamily: 'Inter', fontSize: 12, color: '#aaa', padding: '8px 0' }}>No family members added</p>
              )}
            </div>
          </div>

          {/* Section Progress */}
          <div style={{ background: 'white', border: '1px solid #E8E4DC', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', background: '#F5F3EE', borderBottom: '1px solid #E8E4DC' }}>
              <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#1C1A17' }}>Session Progress</span>
            </div>
            <div style={{ padding: '8px 0' }}>
              {[
                { label: 'Financial Profile',    section: 'financials',         href: '/dashboard/financials',  icon: '◎' },
                { label: 'Wealth Protection',    section: 'protection_needs',   href: '/dashboard/objectives',  icon: '◉' },
                { label: 'Wealth Accumulation',  section: 'accumulation',       href: '/dashboard/objectives',  icon: '◉' },
                { label: 'Retirement',           section: 'retirement',         href: '/dashboard/objectives',  icon: '◉' },
                { label: 'Education Planning',   section: 'education',          href: '/dashboard/objectives',  icon: '◉' },
                { label: 'Estate Planning',      section: 'estate',             href: '/dashboard/objectives',  icon: '◉' },
                { label: 'Risk Management',      section: 'protection_portfolio', href: '/dashboard/protection', icon: '◈' },
              ].map((item, i, arr) => {
                const hasData = !!ffData[item.section] && Object.keys(ffData[item.section]).length > 0
                const date    = lastUpdated[item.section]
                return (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', padding: '10px 18px', borderBottom: i < arr.length - 1 ? '1px solid #F0EDE8' : 'none' }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: hasData ? '#2D5A4E' : '#E8E4DC', flexShrink: 0, marginRight: 10 }} />
                    <span style={{ fontFamily: 'Inter', fontSize: 12, color: hasData ? '#1C1A17' : '#aaa', flex: 1 }}>{item.label}</span>
                    {date
                      ? <span style={{ fontFamily: 'Inter', fontSize: 10, color: '#aaa' }}>{formatDate(date)}</span>
                      : <span style={{ fontFamily: 'Inter', fontSize: 10, color: '#ddd' }}>Not started</span>
                    }
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ─── EDITABLE FIELD COMPONENT ─────────────────────────────────────────────────

function EditableField({ 
  value, 
  onSave,
  type = 'text',
  placeholder = '—'
}: { 
  value: any
  onSave: (newValue: any) => Promise<void>
  type?: 'text' | 'date' | 'number'
  placeholder?: string
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [tempValue, setTempValue] = useState(value)
  const [isSaving, setIsSaving] = useState(false)
  
  const handleSave = async () => {
    if (tempValue === value) {
      setIsEditing(false)
      return
    }
    
    setIsSaving(true)
    try {
      await onSave(tempValue)
      setIsEditing(false)
    } catch (error) {
      console.error('Save failed:', error)
    } finally {
      setIsSaving(false)
    }
  }
  
  if (isSaving) {
    return <span style={{ opacity: 0.5 }}>Saving...</span>
  }
  
  if (!isEditing) {
    return (
      <span 
        onClick={() => setIsEditing(true)}
        style={{ 
          cursor: 'pointer', 
          borderBottom: '1px dashed rgba(168,131,74,0.5)',
          display: 'inline-block'
        }}
        title="Click to edit"
      >
        {value || placeholder}
      </span>
    )
  }
  
  return (
    <input
      type={type}
      value={tempValue}
      onChange={(e) => setTempValue(e.target.value)}
      onBlur={handleSave}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          handleSave()
        }
        if (e.key === 'Escape') {
          setTempValue(value)
          setIsEditing(false)
        }
      }}
      autoFocus
      style={{
        fontFamily: 'inherit',
        fontSize: 'inherit',
        fontWeight: 'inherit',
        color: '#1C1A17',
        padding: '2px 4px',
        border: '1px solid #A8834A',
        borderRadius: 4,
        background: 'white',
        outline: 'none',
        width: 'auto',
        minWidth: '100px'
      }}
    />
  )
}

// ─── AREA CARD ────────────────────────────────────────────────────────────────

function AreaCard({ area }: { area: PlanningArea }) {
  const cfg = STATUS_CONFIG[area.status]
  const router = useRouter()

  return (
    <div
      onClick={() => router.push(area.href)}
      style={{
        background: cfg.bg, border: `1px solid ${cfg.border}`,
        borderRadius: 12, padding: '16px 18px', cursor: 'pointer',
        transition: 'transform 0.12s, box-shadow 0.12s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>{area.icon}</span>
        <span style={{ fontFamily: 'Inter', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: cfg.dot, background: cfg.dot + '18', padding: '2px 7px', borderRadius: 4 }}>
          {cfg.label}
        </span>
      </div>
      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>{area.label}</div>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17, fontWeight: 600, color: '#1C1A17', marginBottom: 3, lineHeight: 1.2 }}>{area.headline}</div>
      <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#666', lineHeight: 1.6 }}>
        {area.subline.split('\n').map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
      {area.actions.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${cfg.border}` }}>
          <span style={{ fontFamily: 'Inter', fontSize: 10, color: cfg.dot, fontWeight: 500 }}>
            {area.actions.length} action{area.actions.length !== 1 ? 's' : ''} needed
          </span>
        </div>
      )}
    </div>
  )
}

// ─── HOUSEHOLD ROW WITH EDITING ────────────────────────────────────────────────

function HouseholdRow({ 
  name, 
  tag, 
  tagColor, 
  age, 
  gender, 
  dob, 
  isLast,
  memberId,
  isClient = false,
  onUpdate
}: {
  name: string
  tag: string
  tagColor: string
  age: number
  gender?: string
  dob?: string
  isLast?: boolean
  memberId?: string
  isClient?: boolean
  onUpdate?: (field: string, value: any) => Promise<void>
}) {
  const [showEditMenu, setShowEditMenu] = useState(false)
  
  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: 10, 
      padding: '9px 0', 
      borderBottom: isLast ? 'none' : '1px solid #F0EDE8',
      position: 'relative'
    }}>
      <div style={{ 
        width: 32, 
        height: 32, 
        borderRadius: '50%', 
        background: tagColor + '22', 
        border: `1px solid ${tagColor}44`, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        fontFamily: 'Cormorant Garamond, serif', 
        fontSize: 13, 
        color: tagColor, 
        flexShrink: 0 
      }}>
        {name?.trim().split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '?'}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onUpdate ? (
            <EditableField 
              value={name} 
              onSave={(newName) => onUpdate('name', newName)}
            />
          ) : (
            <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: '#1C1A17' }}>{name}</span>
          )}
          <span style={{ 
            fontFamily: 'Inter', 
            fontSize: 9, 
            fontWeight: 600, 
            letterSpacing: '0.06em', 
            textTransform: 'uppercase', 
            color: tagColor, 
            background: tagColor + '18', 
            padding: '1px 6px', 
            borderRadius: 3 
          }}>
            {tag}
          </span>
        </div>
        <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#888', marginTop: 1 }}>
          Age {age}{gender ? ` · ${gender}` : ''}
        </div>
      </div>
    </div>
  )
}
