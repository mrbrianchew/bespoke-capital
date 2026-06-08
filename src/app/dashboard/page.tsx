'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getAge(dob?: string): number {
  if (!dob) return 0
  const birth = new Date(dob)
  return Math.max(0, new Date().getFullYear() - birth.getFullYear())
}

function fmt(n: number): string {
  if (!n || isNaN(n)) return 'SGD 0'
  return 'SGD ' + Math.round(n).toLocaleString('en-SG')
}

function fmtShort(n: number): string {
  if (!n || isNaN(n)) return '$0'
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
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
  const [saving, setSaving] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingType, setEditingType] = useState<'client' | 'spouse' | 'child' | null>(null)
  const [editingMember, setEditingMember] = useState<any>(null)
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

  async function updateClientComplete(updatedData: any) {
  setSaving(true)
  try {
    if (!client.id) throw new Error('No client ID found')
    const updateFields: any = { name: updatedData.name, gender: updatedData.gender }
    if (updatedData.dob) updateFields.dob = updatedData.dob
    const { error } = await supabase
      .from('clients')
      .update(updateFields)
      .eq('id', client.id)
    if (error) throw error
    setClient((prev: any) => ({ ...prev, ...updateFields }))
  } catch (error: any) {
    alert(`Failed to update client: ${error.message || 'Unknown error'}`)
  } finally {
    setSaving(false)
  }
}

async function updateFamilyMemberComplete(memberId: string, updatedData: any) {
  setSaving(true)
  try {
    if (!memberId) throw new Error('No member ID found')
    const updateFields: any = {
      name: updatedData.name,
      gender: updatedData.gender,
      relationship: updatedData.relationship,
    }
    if (updatedData.dob) {
      updateFields.dob = updatedData.dob
      updateFields.age = getAge(updatedData.dob)
    }
    if (updatedData.citizenship) updateFields.citizenship = updatedData.citizenship
    const { error } = await supabase
      .from('family_members')
      .update(updateFields)
      .eq('id', memberId)
    if (error) throw error
    if (updatedData.relationship === 'Spouse') {
      setSpouse((prev: any) => ({ ...prev, ...updateFields }))
   } else {
      setChildren((prev: any[]) =>
        prev.map(k => k.id === memberId ? { 
          ...k, 
          ...updateFields, 
          dob: updatedData.dob || k.dob,
          date_of_birth: updatedData.dob || k.date_of_birth,
          age: updatedData.dob ? getAge(updatedData.dob) : k.age
        } : k)
      )
    }
  } catch (error: any) {
    alert(`Failed to update: ${error.message || 'Unknown error'}`)
  } finally {
    setSaving(false)
  }
}
async function deleteFamilyMember(memberId: string) {
    if (!confirm('Are you sure you want to remove this family member?')) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('family_members')
        .delete()
        .eq('id', memberId)
      if (error) throw error
      if (spouse?.id === memberId) {
        setSpouse(null)
      } else {
        setChildren((prev: any[]) => prev.filter(k => k.id !== memberId))
      }
    } catch (error: any) {
      alert(`Failed to delete: ${error.message || 'Unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  async function addFamilyMember(relationship: string) {
    if (!client?.id) return
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('family_members')
        .insert({ client_id: client.id, name: relationship, relationship, gender: '' })
        .select()
        .single()
      if (error) throw error
      if (relationship === 'Spouse') {
        setSpouse(data)
      } else {
        setChildren((prev: any[]) => [...prev, data])
      }
    } catch (error: any) {
      alert(`Failed to add: ${error.message || 'Unknown error'}`)
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
  const cm    = ffData['capital_mandate'] || {}

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
      if (lifeGapClient > 0) protActions.push(`D/TPD gap of ${fmt(lifeGapClient)} for ${client.name}`)
      if (ciGapClient   > 0) protActions.push(`CI gap of ${fmt(ciGapClient)} for ${client.name}`)
      if (lifeGapSpouse > 0 && spouse) protActions.push(`D/TPD gap of ${fmt(lifeGapSpouse)} for ${spouse.name}`)
      if (ciGapSpouse   > 0 && spouse) protActions.push(`CI gap of ${fmt(ciGapSpouse)} for ${spouse.name}`)
    } else {
      protStatus   = 'good'
      protHeadline = 'Coverage adequate'
    }
  }

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

  // ── EDUCATION — mirrors EducationSection.tsx exactly ─────────────────────────

  const eduChildren    = edu.children || []
  const eduReturnRate  = edu.returnRate      ?? 5
  const eduTuitionInfl = edu.tuitionInflation ?? 5
  const eduLivingInfl  = edu.livingInflation  ?? 3
  const eduHasData     = children.length > 0

  function eduCalcChildFund(child: any): number {
    const yearsToUni = Math.max(0, child.uniEntryAge - child.age)
    const fvTuition = (child.annualTuition || 9000) * Math.pow(1 + eduTuitionInfl / 100, yearsToUni) * (child.courseDuration || 4)
    const fvLiving  = (child.annualLiving  || 12000) * Math.pow(1 + eduLivingInfl  / 100, yearsToUni) * (child.courseDuration || 4)
    return fvTuition + fvLiving
  }
  function eduCalcGap(fund: number, existingSavings: number, yearsToUni: number): number {
    const existingFV = existingSavings * Math.pow(1 + eduReturnRate / 100, yearsToUni)
    return Math.max(0, fund - existingFV)
  }
  function eduCalcMonthly(gap: number, yearsToUni: number): number {
    if (gap <= 0 || yearsToUni <= 0) return 0
    const n = yearsToUni * 12
    const r = eduReturnRate / 100 / 12
    if (r === 0) return gap / n
    return gap * r / (Math.pow(1 + r, n) - 1)   // ordinary annuity — matches EducationSection
  }

  // Build child list the same way EducationSection does: merge saved settings onto live family_members age
  const eduChildList = children.map((kid: any) => {
    const age = kid.age != null ? kid.age : getAge(kid.dob)
    const saved = eduChildren.find((e: any) => e.childId === kid.id)
    const defaultEntry = kid.gender === 'Male' ? 21 : 19
    if (saved) return { ...saved, age }   // use live age, keep all saved settings
    return {
      childId: kid.id, age,
      uniEntryAge: defaultEntry, courseDuration: 4,
      annualTuition: 9000, annualLiving: 12000,
      existingSavings: 0, lumpSumPct: 50,
    }
  })

  // ── RETIREMENT ───────────────────────────────────────────────────────────────

  const retClient = ret.client || {}
  const retSpouse = ret.spouse || {}
  const retHasData = !!ret.client
  const retAge = retClient.retirementAge || 65
  const retLE  = retClient.lifeExpectancy || 85

  // For display: years until *earliest* retirement; retirement period covers *longest* life
  const spouseRetAge = isCouple ? (retSpouse.retirementAge || 65) : retAge
  const spouseLE     = isCouple ? (retSpouse.lifeExpectancy || 85) : retLE
  const earliestRetAge = isCouple ? Math.min(retAge, spouseRetAge) : retAge
  // Convert spouse life expectancy to client-age scale to find true final age
  // ageDiff > 0 means client is older; spouse LE 88 at her age = client age 88 + ageDiff
  const ageDiff = clientAge - spouseAge
  const spouseLEInClientYears = spouseLE + ageDiff
  const finalDeathAge = isCouple ? Math.max(retLE, spouseLEInClientYears) : retLE

  const yrsToRet  = Math.max(0, earliestRetAge - clientAge)
  const retYears  = Math.max(0, finalDeathAge - earliestRetAge)

  // ── Capital Mandate portfolio (shared by retirement shortfall + education coverage) ──
  const cmPortfolio: any[] = cm?.portfolio || []
  const cmPortfolioValue = cmPortfolio.reduce((s: number, p: any) => {
    if (p.vehicleType === 'cpf_life' || p.vehicleType === 'rental') return s
    return s + (p.currentValue || 0)
  }, 0)


  const savedCorpusNeeded   = ffData['retirement']?.corpusNeeded        || 0
  const savedMonthlySavings = ffData['retirement']?.monthlySavingsNeeded || 0

  // ── Compute Capital Mandate projected shortfall ───────────────────────────
  // Project the CM portfolio (lump-sum + ongoing contributions) to retirement,
  // then compare against the saved corpus target. This matches what CM displays.
  const cmExpReturn   = (cm?.settings?.expectedReturn ?? 5) / 100
  // Monthly contributions — mirrors Capital Mandate's own projection loop exactly:
  // use latest contribution_change cashflow amount if present, else monthlyContribution.
  const cmMonthlyContribs = (cm?.portfolio || []).reduce((s: number, p: any) => {
    if (p.vehicleType === 'cpf_life' || p.vehicleType === 'rental') return s
    if (p.vehicleType === 'srs') return s + ((p.srsAnnualContribution || 0) / 12)
    if (p.vehicleType === 'endowment') return s + (p.endowmentPremium || 0)
    if (p.vehicleType === 'annuity') return s + (p.monthlyContribution || 0)
    const today = new Date().toISOString().slice(0, 7)
const onHoliday = (p.cashflows || []).some(
  (cf: any) => cf.type === 'premium_holiday' && cf.date <= today && (cf.endDate || '') >= today
)
if (onHoliday) return s
const changes = (p.cashflows || [])
  .filter((cf: any) => cf.type === 'contribution_change')
  .sort((a: any, b: any) => b.date.localeCompare(a.date))
const activeMonthly = changes.length > 0 ? (changes[0].amount || 0) : (p.monthlyContribution || 0)
return s + activeMonthly
  }, 0)

  // Project portfolio using the same annual loop as Capital Mandate:
  // grow at expectedReturn, add annual contributions, deduct education goals at their milestone ages.
  // This matches CM's projected portfolio figure exactly.
  let cmProjectedAtRetirement = 0
  if (cmPortfolioValue > 0 || cmMonthlyContribs > 0) {
    // Education goals sorted by client's age at milestone — same as CM's goalQueue
    const eduGoalsSorted = eduChildList
      .map((child: any) => ({
        targetAge: clientAge + Math.max(0, child.uniEntryAge - child.age),
        corpus: eduCalcGap(eduCalcChildFund(child), child.existingSavings || 0,
                           Math.max(0, child.uniEntryAge - child.age)),
      }))
      .filter((g: any) => g.corpus > 0)
      .sort((a: any, b: any) => a.targetAge - b.targetAge)

    let runningCM = cmPortfolioValue
    const annualContrib = cmMonthlyContribs * 12
    let gIdx = 0

    for (let age = clientAge; age < earliestRetAge; age++) {
      runningCM = runningCM * (1 + cmExpReturn) + annualContrib
      // Deduct education corpuses at their milestone age (matching CM loop)
      while (gIdx < eduGoalsSorted.length && eduGoalsSorted[gIdx].targetAge <= age) {
        runningCM = Math.max(0, runningCM - eduGoalsSorted[gIdx].corpus)
        gIdx++
      }
    }
    cmProjectedAtRetirement = runningCM
  }

  // Shortfall = how much more corpus is needed beyond what the portfolio will deliver
  const cmShortfall = savedCorpusNeeded > 0
    ? Math.max(0, savedCorpusNeeded - cmProjectedAtRetirement)
    : 0

  // Monthly top-up needed (from saved Retirement tab value)
  const cmSolution = cm?.shortfallSolution || null
  const retMonthlySavings = cmSolution?.pureMonthly || cm?.retirementMonthlyTopUp || savedMonthlySavings

  // If CM has portfolio data use the projected shortfall; else fall back to raw gap from Retirement tab
 const retGap = cm?.portfolioStatus === 'gap'
    ? (cm?.retirementShortfall || 1)
    : cm?.portfolioStatus === 'on_track'
    ? 0
    : (ffData['retirement']?.retirementGap || 0)

// Also account for active premium holidays in monthly contribs

  let retStatus: Status = 'empty'
  let retHeadline = 'Not yet configured'
  let retSubline = 'Set retirement parameters in Strategic Objectives'
  const retActions: string[] = []

  if (retHasData || savedCorpusNeeded > 0) {
    retStatus = retGap > 0 ? 'gap' : 'good'
    retHeadline = retGap > 0 ? `Shortfall ${fmtShort(retGap)}` : `On Track · ${fmtShort(savedCorpusNeeded)} target`
    retSubline = `Age ${earliestRetAge} · ${yrsToRet}y away · ${retYears}y retirement`
    if (retGap > 0) {
      retStatus = retGap > 100000 ? 'gap' : 'warn'
      const lsf = cmSolution?.lumpSumFraction ?? 0
      if (lsf >= 1 && cmSolution?.pureLump) {
        retActions.push(`Retirement savings gap of ${fmt(retGap)} — lump sum ${fmt(cmSolution.pureLump)} now`)
      } else if (lsf > 0 && lsf < 1 && cmSolution) {
        const lumpNow = lsf * retGap / Math.pow(1 + (cm?.settings?.expectedReturn ?? 5) / 100, Math.max(1, retAge - clientAge))
        retActions.push(`Retirement savings gap of ${fmt(retGap)} — lump sum ${fmt(lumpNow)} + ${fmt(retMonthlySavings)}/mo`)
      } else {
        retActions.push(`Retirement savings gap of ${fmt(retGap)} — invest ${fmt(retMonthlySavings)}/mo`)
      }
    }
  }

  // Liquid Assets = Cash / Near Cash only (matches Financial Profile "CASH / NEAR CASH" block)
  // Savings + Fixed Deposits + custom cash items, for both client and spouse
  const cashCustom = ((fin.a_cash_custom as any[]) || []).reduce(
    (s: number, i: any) => s + (i.amount || 0) + (isCouple ? (i.amount2 || 0) : 0), 0
  )
  const clientLiquid =
    (fin.a_savings || 0) + (fin.a_fixed_deposit || 0) +
    (isCouple ? (fin.a2_savings || 0) + (fin.a2_fixed_deposit || 0) : 0) +
    cashCustom

  // ── ANNUAL EXPENSES: detailed fields take priority; fall back to simplified ──
  const expMode = fin.expense_mode || 'simple'

  // Detailed field lists per category (annual amounts, excluding CPF OA)
  const DETAILED_ALL_KEYS = [
    'd_mortgage_cash','d_vehicle_repay','d_personal_loan_repay','d_rental_expense',
    'd_income_tax','d_insurance','d_regular_savings',
    'd_conservancy','d_utilities','d_family_food','d_maid','d_other_household',
    'd_personal_food','d_transport','d_car_petrol','d_car_insurance',
    'd_childcare','d_school_fees','d_school_transport','d_allowance_children','d_other_children',
    'd_holidays','d_hobbies','d_allowance_parents','d_others_lifestyle',
  ]
  const DETAILED_ALL_KEYS2 = [
    'd2_mortgage_cash','d2_vehicle_repay','d2_personal_loan_repay','d2_rental_expense',
    'd2_income_tax','d2_insurance','d2_regular_savings',
    'd2_conservancy','d2_utilities','d2_family_food','d2_maid','d2_other_household',
    'd2_personal_food','d2_transport','d2_car_petrol','d2_car_insurance',
    'd2_childcare','d2_school_fees','d2_school_transport','d2_allowance_children','d2_other_children',
    'd2_holidays','d2_hobbies','d2_allowance_parents','d2_others_lifestyle',
  ]
  const CUSTOM_EXP_KEYS = ['d_custom_financial','d_custom_household','d_custom_personal','d_custom_children','d_custom_lifestyle'] as const

  const detailedStd1 = DETAILED_ALL_KEYS.reduce((s, k) => s + ((fin[k] as number) || 0), 0)
  const detailedStd2 = isCouple ? DETAILED_ALL_KEYS2.reduce((s, k) => s + ((fin[k] as number) || 0), 0) : 0
  const detailedCustom1 = CUSTOM_EXP_KEYS.reduce((s, k) => {
    const items: any[] = fin[k] || []
    return s + items.reduce((a: number, i: any) => a + (i.amount || 0), 0)
  }, 0)
  const detailedCustom2 = isCouple ? CUSTOM_EXP_KEYS.reduce((s, k) => {
    const items: any[] = fin[k] || []
    return s + items.reduce((a: number, i: any) => a + (i.amount2 || 0), 0)
  }, 0) : 0
  const detailedTotal = detailedStd1 + detailedStd2 + detailedCustom1 + detailedCustom2

  // Simplified fields (annual, excluding CPF OA)
  const SIMP_KEYS  = ['s_financial','s_mortgage','s_household','s_personal','s_children','s_lifestyle'] as const
  const SIMP_KEYS2 = ['s2_financial','s2_mortgage','s2_household','s2_personal','s2_children','s2_lifestyle'] as const
  const simplifiedTotal =
    SIMP_KEYS.reduce((s, k) => s + ((fin[k] as number) || 0), 0) +
    (isCouple ? SIMP_KEYS2.reduce((s, k) => s + ((fin[k] as number) || 0), 0) : 0)

  // Detailed takes priority if mode is 'detailed' AND at least one field is filled
  const annExpClient = (expMode === 'detailed' && detailedTotal > 0) ? detailedTotal : simplifiedTotal


  let totalEduFund = 0, totalEduGap = 0, totalEduMonthly = 0
  for (const child of eduChildList) {
    const yearsToUni = Math.max(0, child.uniEntryAge - child.age)
    const fund = eduCalcChildFund(child)
    const gap  = eduCalcGap(fund, child.existingSavings || 0, yearsToUni)
    const mo   = eduCalcMonthly(gap * (1 - (child.lumpSumPct || 50) / 100), yearsToUni)
    totalEduFund    += fund
    totalEduGap     += gap
    totalEduMonthly += mo
  }

  // ── EDUCATION: check if Capital Mandate projected portfolio covers edu milestones ──
  // Project the CM portfolio forward to the earliest education milestone and check coverage.
  // cmPortfolio and cmPortfolioValue defined above (shared with retirement block)

  // For each education child, project portfolio value to that milestone and check if it covers the corpus
  // We use a simple lump-sum growth projection (conservative — ignores ongoing contributions)
  // then deduct each education corpus in age order, checking if covered at each step
  const eduChildsSorted = [...eduChildList].sort((a, b) => a.uniEntryAge - b.uniEntryAge)
  let runningPortfolio = cmPortfolioValue
  let eduCoveredByPortfolio = cmPortfolioValue > 0  // only consider portfolio coverage if CM has data
  let totalEduCoveredShortfall = 0

  if (cmPortfolioValue > 0) {
    for (const child of eduChildsSorted) {
      const yearsToUni = Math.max(0, child.uniEntryAge - child.age)
      const fund = eduCalcChildFund(child)
      const gap  = eduCalcGap(fund, child.existingSavings || 0, yearsToUni)
      // Project running portfolio to this child's milestone
      const projectedAtMilestone = runningPortfolio * Math.pow(1 + cmExpReturn, yearsToUni)
      if (projectedAtMilestone < gap) {
        eduCoveredByPortfolio = false
        totalEduCoveredShortfall += gap - projectedAtMilestone
      }
      // Deduct corpus from running portfolio (at milestone)
      runningPortfolio = Math.max(0, projectedAtMilestone - gap)
      // Discount back to today for next child comparison
      if (yearsToUni > 0) runningPortfolio = runningPortfolio / Math.pow(1 + cmExpReturn, yearsToUni)
    }
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
      if (eduCoveredByPortfolio) {
        // Portfolio projects to cover all education milestones — no separate action needed
        eduStatus   = 'good'
        eduHeadline = `${fmtShort(totalEduFund)} total fund`
        eduSubline  = `${fmtShort(totalEduGap)} gap · Covered by portfolio`
      } else {
        eduStatus   = 'gap'
        eduHeadline = `${fmtShort(totalEduFund)} total fund`
        eduSubline  = `Gap ${fmtShort(totalEduGap)} · ${fmt(totalEduMonthly)}/mo`
        if (totalEduMonthly > 0) eduActions.push(`Education fund shortfall — invest ${fmt(totalEduMonthly)}/mo`)
      }
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

  const allProps   = (fin.properties || []) as any[]
  const propEquity = allProps.reduce((s: number, p: any) =>
    s + Math.max(0, (p.propertyValue ?? p.purchasePrice ?? 0) - amortisedOutstanding(p)), 0)
  const totalLiab  = allProps.reduce((s: number, p: any) => s + amortisedOutstanding(p), 0)

  const savedNetEstate = ffData['estate']?.netEstate || estate.netEstate || 0
  let netEstate = savedNetEstate

  if (netEstate === 0) {
    // For net estate fallback: cash + invested + CPF + property equity (both persons)
    const investedAssets =
      (fin.a_srs || 0) + (fin.a_shares || 0) + (fin.a_etf || 0) +
      (fin.a_unit_trust || 0) + (fin.a_bonds || 0) + (fin.a_alternatives || 0) +
      ((fin.a_invested_custom as any[]) || []).reduce((s: number, i: any) => s + (i.amount || 0) + (isCouple ? (i.amount2 || 0) : 0), 0) +
      (isCouple ? (
        (fin.a2_srs || 0) + (fin.a2_shares || 0) + (fin.a2_etf || 0) +
        (fin.a2_unit_trust || 0) + (fin.a2_bonds || 0) + (fin.a2_alternatives || 0)
      ) : 0)
    const totalAssets = clientLiquid + investedAssets +
      (fin.a_cpf_oa || 0) + (fin.a_cpf_sa || 0) + (fin.a_cpf_ma || 0) + (fin.a_cpf_ra || 0) +
      propEquity
    netEstate = Math.max(0, totalAssets - totalLiab)
  }

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
    { id: 'protection',   icon: '🛡',  label: 'Wealth Protection',   status: protStatus, headline: protHeadline, subline: protSubline, href: '/dashboard/objectives?tab=0', actions: protActions },
    { id: 'accumulation', icon: '🏦',  label: 'Wealth Accumulation', status: accStatus,  headline: accHeadline,  subline: accSubline,  href: '/dashboard/objectives?tab=1', actions: accActions  },
    { id: 'retirement',   icon: '🌅',  label: 'Retirement',          status: retStatus,  headline: retHeadline,  subline: retSubline,  href: '/dashboard/objectives?tab=2', actions: retActions  },
    { id: 'education',    icon: '🎓',  label: 'Education Planning',  status: eduStatus,  headline: eduHeadline,  subline: eduSubline,  href: '/dashboard/objectives?tab=3', actions: eduActions  },
    { id: 'estate',       icon: '🏛',  label: 'Estate Planning',     status: estStatus,  headline: estHeadline,  subline: estSubline,  href: '/dashboard/objectives?tab=4', actions: estActions  },
  ]

  const allActions: ActionItem[] = [
    ...protActions.map(t => ({ priority: 'high'   as const, area: '🛡 Protection',   text: t, href: '/dashboard/objectives?tab=0' })),
    ...retActions .map(t => ({ priority: 'high'   as const, area: '🌅 Retirement',   text: t, href: '/dashboard/objectives?tab=2' })),
    ...eduActions .map(t => ({ priority: 'high'   as const, area: '🎓 Education',    text: t, href: '/dashboard/objectives?tab=3' })),
    ...estActions .map(t => ({ priority: 'medium' as const, area: '🏛 Estate',       text: t, href: '/dashboard/objectives?tab=4' })),
    ...accActions .map(t => ({ priority: 'medium' as const, area: '🏦 Accumulation', text: t, href: '/dashboard/objectives?tab=1' })),
  ]

  const lastSessionDate = Object.values(lastUpdated).sort().reverse()[0] || ''

  const p1Gross  = (fin.person1 as any)?.gross_monthly || 0
const p1Bonus  = (fin.person1 as any)?.gross_bonus || 0
const p1Cit    = (fin.person1 as any)?.citizenship || 'SC'
const p1PrYear = (fin.person1 as any)?.pr_year || '3+'
const p2Gross  = isCouple ? ((fin.person2 as any)?.gross_monthly || 0) : 0
const p2Bonus  = isCouple ? ((fin.person2 as any)?.gross_bonus || 0) : 0
const p2Cit    = isCouple ? ((fin.person2 as any)?.citizenship || 'SC') : 'SC'
const p2PrYear = isCouple ? ((fin.person2 as any)?.pr_year || '3+') : '3+'

// CPF rates (same tiers as financials page)
const SC_RATES = [
  { max_age: 35, employee: 20 }, { max_age: 45, employee: 20 },
  { max_age: 50, employee: 20 }, { max_age: 55, employee: 20 },
  { max_age: 60, employee: 18 }, { max_age: 65, employee: 14.5 },
  { max_age: 70, employee: 7.5 }, { max_age: 999, employee: 5 },
]
const PR1_RATES = [{ max_age: 999, employee: 5 }]
const PR2_RATES = [{ max_age: 999, employee: 15 }]

function getCpfEmpRate(age: number, cit: string, prYear: string): number {
  if (!['SC', 'PR'].includes(cit)) return 0
  const tiers = cit === 'PR' ? (prYear === '1' ? PR1_RATES : prYear === '2' ? PR2_RATES : SC_RATES) : SC_RATES
  return (tiers.find(t => age <= t.max_age) || tiers[tiers.length - 1]).employee
}

const owCap = 8000
const p1EmpRate = getCpfEmpRate(clientAge, p1Cit, p1PrYear) / 100
const p1MonthlyCpf = Math.floor(Math.min(p1Gross, owCap) * p1EmpRate)
const p1BonusCpf = Math.floor(p1Bonus * p1EmpRate)
const p1TakeHome = (p1Gross - p1MonthlyCpf) * 12 + (p1Bonus - p1BonusCpf)

const p2EmpRate = isCouple ? getCpfEmpRate(spouseAge, p2Cit, p2PrYear) / 100 : 0
const p2MonthlyCpf = isCouple ? Math.floor(Math.min(p2Gross, owCap) * p2EmpRate) : 0
const p2BonusCpf = isCouple ? Math.floor(p2Bonus * p2EmpRate) : 0
const p2TakeHome = isCouple ? (p2Gross - p2MonthlyCpf) * 12 + (p2Bonus - p2BonusCpf) : 0

const totalIncome = p1TakeHome + p2TakeHome
const totalExp    = annExpClient
const annualSurplus = totalIncome - totalExp

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
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(168,131,74,0.25)', border: '1px solid rgba(168,131,74,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Cormorant Garamond, serif', fontSize: 20, color: 'rgba(255,255,255,0.8)', flexShrink: 0 }}>
              {initials(client.name)}
            </div>
            <div>
              <p style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#A8834A', marginBottom: 6 }}>Executive Summary</p>
              <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 30, fontWeight: 300, color: '#F5F0E8', letterSpacing: 0.5, marginBottom: 4 }}>
                {isCouple ? `${client.name} & ${spouse.name}` : client.name}
              </h1>
             <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => {
                    setEditingType('client')
                    setEditingMember(client)
                    setShowEditModal(true)
                  }}
                  style={{
                    background: 'rgba(168,131,74,0.2)',
                    border: '1px solid rgba(168,131,74,0.4)',
                    color: '#A8834A',
                    padding: '4px 12px',
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: 'pointer',
                    fontFamily: 'Inter'
                  }}
                >
                  ✎ Edit Client
                </button>
              </div>
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

          <div style={{ display: 'flex', gap: 32, alignItems: 'flex-end' }}>
            {[
              { label: 'Annual Income',    val: totalIncome > 0 ? fmtShort(totalIncome) : '—', sub: 'gross combined'         },
              { label: 'Net Estate',       val: netEstate   > 0 ? fmtShort(netEstate)   : '—', sub: 'assets minus liabilities' },
              { label: 'Annual Surplus',   val: annualSurplus > 0 ? fmtShort(annualSurplus) : '—', sub: 'take-home minus expenses'  },
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

        <div>
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

          {(annExpClient > 0 || totalIncome > 0) && (
            <div style={{ marginTop: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--ink3)' }}>Financial Overview</span>
                <div style={{ flex: 1, height: 1, background: '#E8E4DC' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {[
                  { label: 'Liquid Assets',     val: fmtShort(clientLiquid),           sub: 'savings & fixed deposits'       },
                  { label: 'Property Equity',    val: fmtShort(propEquity),             sub: 'net of mortgage'          },
                  { label: 'Annual Expenses',    val: fmtShort(annExpClient),           sub: 'from financial profile'   },
                  { label: 'Emergency Fund',     val: annExpClient > 0 ? (clientLiquid / (annExpClient / 12)).toFixed(1) + ' mo' : '—', sub: 'months of expenses'  },
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: 'white', border: '1px solid #E8E4DC', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', background: '#F5F3EE', borderBottom: '1px solid #E8E4DC' }}>
              <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#1C1A17' }}>Household</span>
            </div>
            <div style={{ padding: '12px 18px' }}>
              <div style={{ position: 'relative' }}>
                <HouseholdRow
                  name={client.name}
                  tag="Client"
                  tagColor="#A8834A"
                  age={clientAge}
                  gender={client.gender}
                  dob={client.dob}
                />
                <button
                  onClick={() => {
                    setEditingType('client')
                    setEditingMember(client)
                    setShowEditModal(true)
                  }}
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 8,
                    background: 'transparent',
                    border: 'none',
                    color: '#A8834A',
                    cursor: 'pointer',
                    fontSize: 14,
                    padding: '4px 8px'
                  }}
                >
                  ✎
                </button>
              </div>
              
              {spouse && (
                <div style={{ position: 'relative' }}>
                  <HouseholdRow
                    name={spouse.name}
                    tag="Spouse"
                    tagColor="#6B5B8B"
                    age={spouseAge}
                    gender={spouse.gender}
                    dob={spouse.dob}
                  />
                  <div style={{ position: 'absolute', right: 0, top: 8, display: 'flex', gap: 4 }}>
                    <button onClick={() => { setEditingType('spouse'); setEditingMember(spouse); setShowEditModal(true) }}
                      style={{ background: 'transparent', border: 'none', color: '#6B5B8B', cursor: 'pointer', fontSize: 14, padding: '4px 6px' }}>✎</button>
                    <button onClick={() => deleteFamilyMember(spouse.id)}
                      style={{ background: 'transparent', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: 14, padding: '4px 6px' }}>✕</button>
                  </div>
                </div>
              )}
              
              {children.map((kid, i) => (
                <div key={kid.id} style={{ position: 'relative' }}>
                  <HouseholdRow
                    name={kid.name || kid.relationship}
                    tag={kid.relationship}
                    tagColor={kid.gender === 'Female' ? '#7A6AAA' : '#4A7C9E'}
                    age={kid.age ?? getAge(kid.dob)}
                    gender={kid.gender}
                    dob={kid.dob}
                    isLast={i === children.length - 1}
                  />
                  <div style={{ position: 'absolute', right: 0, top: 8, display: 'flex', gap: 4 }}>
                    <button onClick={() => { setEditingType('child'); setEditingMember(kid); setShowEditModal(true) }}
                      style={{ background: 'transparent', border: 'none', color: kid.gender === 'Female' ? '#7A6AAA' : '#4A7C9E', cursor: 'pointer', fontSize: 14, padding: '4px 6px' }}>✎</button>
                    <button onClick={() => deleteFamilyMember(kid.id)}
                      style={{ background: 'transparent', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: 14, padding: '4px 6px' }}>✕</button>
                  </div>
                </div>
              ))}
              
             {!spouse && children.length === 0 && (
                <p style={{ fontFamily: 'Inter', fontSize: 12, color: '#aaa', padding: '8px 0' }}>No family members added</p>
              )}
              <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {!spouse && (
                  <button onClick={() => addFamilyMember('Spouse')}
                    style={{ fontSize: 11, fontFamily: 'Inter', color: '#6B5B8B', background: 'rgba(107,91,139,0.08)', border: '1px solid rgba(107,91,139,0.3)', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}>
                    + Spouse
                  </button>
                )}
                <button onClick={() => addFamilyMember('Son')}
                  style={{ fontSize: 11, fontFamily: 'Inter', color: '#4A7C9E', background: 'rgba(74,124,158,0.08)', border: '1px solid rgba(74,124,158,0.3)', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}>
                  + Son
                </button>
                <button onClick={() => addFamilyMember('Daughter')}
                  style={{ fontSize: 11, fontFamily: 'Inter', color: '#7A6AAA', background: 'rgba(122,106,170,0.08)', border: '1px solid rgba(122,106,170,0.3)', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}>
                  + Daughter
                </button>
                <button onClick={() => addFamilyMember('Father')}
                  style={{ fontSize: 11, fontFamily: 'Inter', color: '#888', background: '#F5F3EE', border: '1px solid #E8E4DC', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}>
                  + Father
                </button>
                <button onClick={() => addFamilyMember('Mother')}
                  style={{ fontSize: 11, fontFamily: 'Inter', color: '#888', background: '#F5F3EE', border: '1px solid #E8E4DC', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}>
                  + Mother
                </button>
              </div>
            </div>
          </div>

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

      {/* ─── EDIT MODAL ────────────────────────────────────────────────────── */}
      {showEditModal && editingMember && (
        <EditMemberModal
          type={editingType!}
          member={editingMember}
          onClose={() => {
            setShowEditModal(false)
            setEditingType(null)
            setEditingMember(null)
          }}
          onSave={async (updatedData) => {
            if (editingType === 'client') {
              await updateClientComplete(updatedData)
            } else {
              await updateFamilyMemberComplete(editingMember.id, updatedData)
            }
          }}
        />
      )}
    </div>
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

// ─── HOUSEHOLD ROW ────────────────────────────────────────────────────────────

function HouseholdRow({ name, tag, tagColor, age, gender, dob, isLast }: {
  name: string; tag: string; tagColor: string
  age: number; gender?: string; dob?: string; isLast?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: isLast ? 'none' : '1px solid #F0EDE8' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: tagColor + '22', border: `1px solid ${tagColor}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Cormorant Garamond, serif', fontSize: 13, color: tagColor, flexShrink: 0 }}>
        {name?.trim().split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '?'}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: '#1C1A17' }}>{name}</span>
          <span style={{ fontFamily: 'Inter', fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: tagColor, background: tagColor + '18', padding: '1px 6px', borderRadius: 3 }}>{tag}</span>
        </div>
        <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#888', marginTop: 1 }}>
          Age {age}{gender ? ` · ${gender}` : ''}{dob ? ` · DOB: ${formatDate(dob)}` : ''}
        </div>
      </div>
    </div>
  )
}

// ─── EDIT MEMBER MODAL ────────────────────────────────────────────────────────

function EditMemberModal({ 
  type, 
  member, 
  onClose, 
  onSave 
}: { 
  type: 'client' | 'spouse' | 'child'
  member: any
  onClose: () => void
  onSave: (data: any) => Promise<void>
}) {
  const [formData, setFormData] = useState({
    name: member.name || '',
    dob: member.dob || member.dob || '',
    gender: member.gender || '',
    citizenship: member.citizenship || 'Singaporean',
    relationship: member.relationship || type,
  })
  const [isSaving, setIsSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    try {
      await onSave(formData)
    } catch (error) {
      console.error('Save failed:', error)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}
      onClick={onClose}
    >
      <div 
        style={{
          background: 'white',
          borderRadius: 16,
          padding: '28px',
          width: '100%',
          maxWidth: '450px',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ 
            fontFamily: 'Cormorant Garamond, serif', 
            fontSize: 24, 
            fontWeight: 300, 
            color: '#1C1A17',
            marginBottom: 4
          }}>
            Edit {type === 'client' ? 'Client' : type === 'spouse' ? 'Spouse' : 'Child'}
          </h2>
          <p style={{ fontFamily: 'Inter', fontSize: 12, color: '#888' }}>
            Update the information below
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ 
              display: 'block', 
              fontFamily: 'Inter', 
              fontSize: 11, 
              fontWeight: 600, 
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: '#666',
              marginBottom: 6
            }}>
              Full Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontFamily: 'Inter',
                fontSize: 14,
                border: '1px solid #E8E4DC',
                borderRadius: 8,
                outline: 'none'
              }}
              required
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ 
              display: 'block', 
              fontFamily: 'Inter', 
              fontSize: 11, 
              fontWeight: 600, 
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: '#666',
              marginBottom: 6
            }}>
              Date of Birth
            </label>
            <input
              type="date"
              value={formData.dob}
              onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontFamily: 'Inter',
                fontSize: 14,
                border: '1px solid #E8E4DC',
                borderRadius: 8,
                outline: 'none'
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ 
              display: 'block', 
              fontFamily: 'Inter', 
              fontSize: 11, 
              fontWeight: 600, 
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: '#666',
              marginBottom: 6
            }}>
              Gender
            </label>
            <select
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontFamily: 'Inter',
                fontSize: 14,
                border: '1px solid #E8E4DC',
                borderRadius: 8,
                outline: 'none',
                background: 'white'
              }}
            >
              <option value="">Select Gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ 
              display: 'block', 
              fontFamily: 'Inter', 
              fontSize: 11, 
              fontWeight: 600, 
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: '#666',
              marginBottom: 6
            }}>
              Citizenship
            </label>
            <select
              value={formData.citizenship}
              onChange={(e) => setFormData({ ...formData, citizenship: e.target.value })}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontFamily: 'Inter',
                fontSize: 14,
                border: '1px solid #E8E4DC',
                borderRadius: 8,
                outline: 'none',
                background: 'white'
              }}
            >
              <option value="Singaporean">Singaporean</option>
              <option value="PR">Permanent Resident</option>
              <option value="Foreigner">Foreigner</option>
            </select>
          </div>

          {type !== 'client' && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ 
                display: 'block', 
                fontFamily: 'Inter', 
                fontSize: 11, 
                fontWeight: 600, 
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: '#666',
                marginBottom: 6
              }}>
                Relationship
              </label>
              <select
                value={formData.relationship}
                onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontFamily: 'Inter',
                  fontSize: 14,
                  border: '1px solid #E8E4DC',
                  borderRadius: 8,
                  outline: 'none',
                  background: 'white'
                }}
              >
                <option value="Spouse">Spouse</option>
              <option value="Son">Son</option>
              <option value="Daughter">Daughter</option>
              <option value="Sister">Sister</option>
              <option value="Brother">Brother</option>
              <option value="Father">Father</option>
              <option value="Mother">Mother</option>
              <option value="Grandfather">Grandfather</option>
              <option value="Grandmother">Grandmother</option>
              <option value="Brother-in-law">Brother-in-law</option>
              <option value="Sister-in-law">Sister-in-law</option>
              <option value="Uncle">Uncle</option>
              <option value="Aunty">Aunty</option>
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '12px',
                background: 'transparent',
                border: '1px solid #E8E4DC',
                borderRadius: 8,
                fontFamily: 'Inter',
                fontSize: 13,
                fontWeight: 500,
                color: '#666',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              style={{
                flex: 1,
                padding: '12px',
                background: '#A8834A',
                border: 'none',
                borderRadius: 8,
                fontFamily: 'Inter',
                fontSize: 13,
                fontWeight: 500,
                color: 'white',
                cursor: isSaving ? 'not-allowed' : 'pointer',
                opacity: isSaving ? 0.7 : 1
              }}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
