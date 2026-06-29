import { ageYearOnly } from './calc'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type ProtectionActionCategory = 'medical' | 'ltc' | 'core' | 'general'

export interface ActionPlanReplacedPolicy {
  policyName: string
  companyName: string
  annualPremium: number
}

export interface ProtectionActionItem {
  id: string
  category: ProtectionActionCategory
  categoryLabel: string
  mode: 'new' | 'replacement'
  productName: string
  insurer: string
  coverageDescription: string
  annualPremiumCash: number
  annualPremiumMedisave: number
  annualPremiumTotal: number
  // For 'new': equals annualPremiumCash. For 'replacement': annualPremiumCash
  // minus the cash portion of whatever's being replaced — mirrors the cash
  // delta the live CashflowSidebar (recommendations/page.tsx) computes, so
  // this report can never disagree with what the advisor saw while choosing.
  cashImpactDelta: number
  deathBenefit: number
  tpdBenefit: number
  ciBenefit: number
  earlyCiBenefit: number
  monthlyBenefit: number
  sumAssured: number
  benefits: string
  limitations: string
  replacedPolicies: ActionPlanReplacedPolicy[]
  replacedAnnualPremiumTotal: number
}

export interface AccumulationActionItem {
  id: string
  mode: 'new' | 'replacement'
  company: string
  planType: string
  productType: string
  hasLumpSum: boolean
  lumpSumAmount: number
  hasRegular: boolean
  annualContribution: number
  benefits: string
  limitations: string
  replacedPolicies: ActionPlanReplacedPolicy[]
  // Shown for context only — NOT netted out of annualContribution. The live
  // tool's CashflowSidebar treats every chosen accumulation contribution as
  // full new cash outflow regardless of mode (unlike the protection
  // categories, which do net replacements). Kept as-is rather than "fixed"
  // here so the report's cash-flow figures match what the advisor approved.
  replacedAnnualContribution: number
  allocatedGoalIds: string[]
}

export interface ActionPlanGoal {
  id: string
  label: string
  targetAge: number
  targetCorpus: number
}

export interface ActionPlanGoalFunding {
  goal: ActionPlanGoal
  fundedBy: { productLabel: string; annualContribution: number }[]
  totalAnnualContribution: number
}

export interface PersonActionPlan {
  personKey: string
  name: string
  protectionItems: ProtectionActionItem[]
  accumulationItems: AccumulationActionItem[]
  goalFunding: ActionPlanGoalFunding[]
  newAnnualCash: number
  replacementNetDelta: number
}

export interface ActionPlanCashflowImpact {
  totalAdditions: number
  totalReplacementDelta: number
  netAnnualCashImpact: number
  currentAnnualSurplus: number
  surplusAfter: number
}

export interface ActionPlanSnapshot {
  client: PersonActionPlan
  spouse: PersonActionPlan | null
  children: PersonActionPlan[]
  cashflowImpact: ActionPlanCashflowImpact
  hasAnyActions: boolean
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function replacedTotal(list: any[]): number {
  return (list || []).reduce((s, p) => s + (p.annualPremium || 0), 0)
}

// Cash-only total across replaced policies — strips out whatever portion of
// each old premium was itself paid via Medisave, matching the live tool's
// "newCash - oldCash" delta for Medical and LTC.
function replacedCashTotal(list: any[]): number {
  return (list || []).reduce((s, p) => s + ((p.annualPremium || 0) - (p.premiumMedisave || 0)), 0)
}

function mapReplacedPolicies(list: any[]): ActionPlanReplacedPolicy[] {
  return (list || []).map((p: any) => ({
    policyName: p.policyName || 'Existing policy',
    companyName: p.companyName || '',
    annualPremium: Math.round(p.annualPremium || 0),
  }))
}

// Goal ids/labels/targets must match exactly what recommendations/page.tsx's
// own loadAll() builds — that's what AccRec.allocatedGoalIds was tagged
// against when the advisor allocated a product to a goal, so this can't be
// rebuilt from a different (even if more "correct") derivation without
// breaking the funding tie-in. Reads corpusNeeded / child.corpus directly,
// same as the live tool — no independent recalculation.
function buildGoals(retData: Record<string, any>, eduData: Record<string, any>, cmData: Record<string, any>, clientAge: number): ActionPlanGoal[] {
  const ret = retData || {}
  const edu = eduData?.edu || eduData || {}
  const cm = cmData || {}
  const goals: ActionPlanGoal[] = []

  const retCorpus = ret?.corpusNeeded || 0
  const retAge = ret?.ret?.client?.retirementAge || ret?.retirementAge || 65
  if (retCorpus > 0) {
    goals.push({ id: 'retirement', label: 'Retirement', targetAge: retAge, targetCorpus: Math.round(retCorpus) })
  }

  ;(edu?.children || []).forEach((c: any) => {
    if ((c.corpus || 0) > 0) {
      goals.push({
        id: `edu_${c.childId || c.name}`,
        label: `${c.name}'s Education`,
        targetAge: clientAge + (c.yearsAway || 18),
        targetCorpus: Math.round(c.corpus),
      })
    }
  })

  ;(cm?.customGoals || []).forEach((g: any) => {
    if ((g.targetCorpus || 0) > 0) {
      goals.push({
        id: g.id || `g_${g.label}`,
        label: g.label || 'Wealth Goal',
        targetAge: g.targetAge || 0,
        targetCorpus: Math.round(g.targetCorpus),
      })
    }
  })

  return goals.sort((a, b) => a.targetAge - b.targetAge)
}

function mapMedical(list: any[]): ProtectionActionItem[] {
  return (list || []).filter((r: any) => r.isChosen).map((r: any) => {
    const riderPremium = r.rider?.annualPremium || 0
    const cash = (r.premiumCash || 0) + riderPremium
    const medisave = r.premiumMedisave || 0
    const replacedCash = r.mode === 'replacement' ? replacedCashTotal(r.replacedPolicies) : 0
    const cashImpactDelta = r.mode === 'replacement' ? cash - replacedCash : cash
    return {
      id: r.id,
      category: 'medical',
      categoryLabel: 'Medical Insurance',
      mode: r.mode,
      productName: r.productName || r.briefCoverage || 'Medical plan',
      insurer: r.insurer || '',
      coverageDescription: r.briefCoverage === 'Other' ? (r.briefCoverageOther || '') : (r.briefCoverage || ''),
      annualPremiumCash: Math.round(cash),
      annualPremiumMedisave: Math.round(medisave),
      annualPremiumTotal: Math.round(cash + medisave),
      cashImpactDelta: Math.round(cashImpactDelta),
      deathBenefit: 0,
      tpdBenefit: 0,
      ciBenefit: 0,
      earlyCiBenefit: 0,
      monthlyBenefit: 0,
      sumAssured: 0,
      benefits: r.benefits || '',
      limitations: r.limitations || '',
      replacedPolicies: mapReplacedPolicies(r.replacedPolicies),
      replacedAnnualPremiumTotal: Math.round(replacedTotal(r.replacedPolicies)),
    }
  })
}

// Shared by LTC, Core Protection, and General Insurance — all three are
// saved as the same ProtRec shape in the live tool, with only the
// category-relevant fields populated.
function mapProt(category: 'ltc' | 'core' | 'general', categoryLabel: string, list: any[]): ProtectionActionItem[] {
  return (list || []).filter((r: any) => r.isChosen).map((r: any) => {
    let cash = 0
    let medisave = 0
    if (category === 'ltc') {
      medisave = Math.min(r.annualPremium || 0, 600)
      cash = Math.max((r.annualPremium || 0) - 600, 0)
    } else {
      // Core Protection and General Insurance carry no Medisave component.
      cash = r.annualPremium || 0
    }
    const replacedCash = r.mode === 'replacement'
      ? (category === 'ltc' ? replacedCashTotal(r.replacedPolicies) : replacedTotal(r.replacedPolicies))
      : 0
    const cashImpactDelta = r.mode === 'replacement' ? cash - replacedCash : cash
    return {
      id: r.id,
      category,
      categoryLabel,
      mode: r.mode,
      productName: r.productName || r.coverageType || `${categoryLabel} plan`,
      insurer: r.insurer || '',
      coverageDescription: r.coverageType || '',
      annualPremiumCash: Math.round(cash),
      annualPremiumMedisave: Math.round(medisave),
      annualPremiumTotal: Math.round(cash + medisave),
      cashImpactDelta: Math.round(cashImpactDelta),
      deathBenefit: Math.round(r.deathBenefit || 0),
      tpdBenefit: Math.round(r.tpdBenefit || 0),
      ciBenefit: Math.round(r.advCiBenefit || 0),
      earlyCiBenefit: Math.round(r.earlyCiBenefit || 0),
      monthlyBenefit: Math.round(r.monthlyBenefit || 0),
      sumAssured: Math.round(r.sumAssured || r.accidentalDeathBenefit || 0),
      benefits: r.benefits || '',
      limitations: r.limitations || '',
      replacedPolicies: mapReplacedPolicies(r.replacedPolicies),
      replacedAnnualPremiumTotal: Math.round(replacedTotal(r.replacedPolicies)),
    }
  })
}

function mapAccumulation(list: any[]): AccumulationActionItem[] {
  return (list || []).filter((r: any) => r.isChosen).map((r: any) => {
    const freqMult = r.regularFreq === 'Monthly' ? 12 : r.regularFreq === 'Quarterly' ? 4 : 1
    const annualContribution = r.hasRegular ? (r.regularAmount || 0) * freqMult : 0
    return {
      id: r.id,
      mode: r.mode,
      company: r.company || '',
      planType: r.planType || '',
      productType: r.productType || '',
      hasLumpSum: !!r.hasLumpSum,
      lumpSumAmount: Math.round(r.lumpSumAmount || 0),
      hasRegular: !!r.hasRegular,
      annualContribution: Math.round(annualContribution),
      benefits: r.benefits || '',
      limitations: r.limitations || '',
      replacedPolicies: mapReplacedPolicies(r.replacedPolicies),
      replacedAnnualContribution: Math.round(replacedTotal(r.replacedPolicies)),
      allocatedGoalIds: r.allocatedGoalIds || [],
    }
  })
}

// ─── BUILDER ─────────────────────────────────────────────────────────────────

export function buildActionPlanSnapshot(input: {
  client: { name: string; dob: string }
  familyMembers: { id: string; name: string; relationship: string; dob?: string }[]
  recData: Record<string, any>
  retData: Record<string, any>
  eduData: Record<string, any>
  cmData: Record<string, any>
  // Read directly from the already-built Wealth Summary snapshot
  // (annualSurplus) rather than re-derived from raw financials here.
  annualSurplus: number
}): ActionPlanSnapshot {
  const { client, familyMembers, recData, retData, eduData, cmData, annualSurplus } = input
  const clientAge = ageYearOnly(client.dob)

  const spouseMember = familyMembers.find(f => f.relationship === 'Spouse') || null
  const children = familyMembers.filter(f => ['Son', 'Daughter', 'Child'].includes(f.relationship))

  const goals = buildGoals(retData, eduData, cmData, clientAge)

  const medicalByPerson = recData?.medicalByPerson || {}
  const ltcByPerson = recData?.ltcByPerson || {}
  const expenseByPerson = recData?.expenseByPerson || {}
  const generalByPerson = recData?.generalByPerson || {}
  const accumulationByPerson = recData?.accumulationByPerson || {}

  function buildPerson(personKey: string, name: string): PersonActionPlan {
    const protectionItems: ProtectionActionItem[] = [
      ...mapMedical(medicalByPerson[personKey] || []),
      ...mapProt('ltc', 'Long Term Care Protection', ltcByPerson[personKey] || []),
      ...mapProt('core', 'Core Protection', expenseByPerson[personKey] || []),
      ...mapProt('general', 'General Insurance', generalByPerson[personKey] || []),
    ]
    const accumulationItems = mapAccumulation(accumulationByPerson[personKey] || [])

    const goalFunding: ActionPlanGoalFunding[] = goals
      .map(goal => {
        const fundedBy = accumulationItems
          .filter(item => item.allocatedGoalIds.includes(goal.id))
          .map(item => ({
            productLabel: item.company || item.planType || 'Accumulation plan',
            annualContribution: item.annualContribution,
          }))
        return { goal, fundedBy, totalAnnualContribution: fundedBy.reduce((s, f) => s + f.annualContribution, 0) }
      })
      .filter(gf => gf.fundedBy.length > 0)

    const newAnnualCash =
      protectionItems.filter(i => i.mode === 'new').reduce((s, i) => s + i.annualPremiumCash, 0) +
      accumulationItems.filter(i => i.mode === 'new').reduce((s, i) => s + i.annualContribution, 0)

    const replacementNetDelta =
      protectionItems.filter(i => i.mode === 'replacement').reduce((s, i) => s + i.cashImpactDelta, 0) +
      accumulationItems.filter(i => i.mode === 'replacement').reduce((s, i) => s + i.annualContribution, 0)

    return {
      personKey,
      name,
      protectionItems,
      accumulationItems,
      goalFunding,
      newAnnualCash: Math.round(newAnnualCash),
      replacementNetDelta: Math.round(replacementNetDelta),
    }
  }

  const clientPlan = buildPerson('client', client.name)
  const spousePlan = spouseMember ? buildPerson('spouse', spouseMember.name) : null
  const childPlans = children
    .map(c => buildPerson(`child_${c.id}`, c.name))
    .filter(p => p.protectionItems.length > 0 || p.accumulationItems.length > 0)

  const allPersons = [clientPlan, ...(spousePlan ? [spousePlan] : []), ...childPlans]
  const totalAdditions = allPersons.reduce((s, p) => s + p.newAnnualCash, 0)
  const totalReplacementDelta = allPersons.reduce((s, p) => s + p.replacementNetDelta, 0)
  const netAnnualCashImpact = totalAdditions + totalReplacementDelta

  return {
    client: clientPlan,
    spouse: spousePlan,
    children: childPlans,
    cashflowImpact: {
      totalAdditions: Math.round(totalAdditions),
      totalReplacementDelta: Math.round(totalReplacementDelta),
      netAnnualCashImpact: Math.round(netAnnualCashImpact),
      currentAnnualSurplus: Math.round(annualSurplus),
      surplusAfter: Math.round(annualSurplus - netAnnualCashImpact),
    },
    hasAnyActions: allPersons.some(p => p.protectionItems.length > 0 || p.accumulationItems.length > 0),
  }
}
