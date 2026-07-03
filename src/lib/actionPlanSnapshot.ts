import { ageYearOnly, fv } from './calc'
import { PersonProtectionProfile } from './protectionSnapshot'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type ProtectionActionCategory = 'medical' | 'ltc' | 'core' | 'general'

export interface ActionPlanReplacedPolicy {
  policyName: string
  companyName: string
  annualPremium: number
  // Benefit amounts carried on the replaced policy, only ever populated for
  // Core Protection replacements (recommendations/page.tsx's Core replace-policy
  // handler is the only one that captures these — Medical/LTC/General replaced
  // policies are saved with these at 0). Used to net the old policy's cover out
  // of the framework tape's "existing" segment so a replacement doesn't get
  // counted twice — once under existing, once under recommended.
  deathBenefit: number
  tpdBenefit: number
  ciBenefit: number
  earlyCiBenefit: number
}

// One segment of the "measuring tape" shown under Core Protection — needs
// split into asset mitigation (gold) / existing (grey) / recommended (green)
// / remaining shortfall (red). Widths are pre-clamped so the four always sum
// to exactly `needs`, even if the raw figures overshoot it.
export interface ProtectionTape {
  needs: number
  assetMitigation: number
  existing: number
  recommended: number
  remaining: number
  // Product names contributing to `recommended`, for the "via ..." caption.
  viaProducts: string[]
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
  rationale: string
  replacedPolicies: ActionPlanReplacedPolicy[]
  replacedAnnualPremiumTotal: number
}

export interface AccumulationActionItem {
  id: string
  mode: 'new' | 'replacement' | 'topup'
  company: string
  planType: string
  productType: string
  hasLumpSum: boolean
  lumpSumAmount: number
  hasRegular: boolean
  annualContribution: number
  // Cash-flow-relevant delta for this item. For 'new' and 'topup' this equals
  // annualContribution — for a top-up, the advisor enters the ADDITIONAL
  // amount being added on top of the existing premium (not a new total), so
  // it's already the correct incremental cash-flow figure. For 'replacement'
  // it ALSO equals annualContribution — deliberately not netted, matching the
  // pre-existing behaviour documented below.
  cashImpactDelta: number
  benefits: string
  limitations: string
  rationale: string
  // Joint-account contribution split, frozen at save time. accountType and
  // jointSplitClientPct are only meaningful when accountType === 'joint';
  // clientAnnualContribution/spouseAnnualContribution give each spouse's
  // share of annualContribution (they sum back to annualContribution).
  accountType: 'individual' | 'joint'
  jointSplitClientPct: number
  clientAnnualContribution: number
  spouseAnnualContribution: number
  replacedPolicies: ActionPlanReplacedPolicy[]
  // Shown for context only — NOT netted out of annualContribution/cashImpactDelta
  // for the 'replacement' case. The live tool's CashflowSidebar treats every
  // chosen 'replacement'-mode accumulation contribution as full new cash
  // outflow (unlike the protection categories, which do net replacements).
  // Kept as-is rather than "fixed" here so the report's cash-flow figures
  // match what the advisor approved.
  replacedAnnualContribution: number
  // Set only when mode === 'topup' — the existing product being topped up and
  // its previous annual amount, frozen at save time. Used for display only
  // (old amount → old + annualContribution as the new total); NOT subtracted
  // from cashImpactDelta since annualContribution is already the increment.
  topupProductLabel: string
  previousAnnualContribution: number
  allocatedGoalIds: string[]
}

export interface ActionPlanGoal {
  id: string
  label: string
  targetAge: number
  // Gross target — before netting out achieved. For Retirement this is the
  // corpus figure Strategic Objectives already saves as gross (retirementGap
  // is the net figure, saved alongside it). For custom Wealth goals there's
  // no netting concept in the data model at all — the advisor enters this
  // directly, so `achieved` is always 0. Education is NOT included here yet
  // — see the note on buildGoals below.
  targetCorpus: number
  // Projected value of savings/investments already in motion toward this
  // goal, by targetAge — 0 where the underlying tool doesn't track that
  // (custom goals).
  achieved: number
}

// The Wealth Accumulation equivalent of ProtectionTape — needs split into
// achieved (grey, projected from what's already in motion) / recommended
// (green, future-valued contribution from chosen accumulation products) /
// remaining shortfall (red). No asset-mitigation-style gold segment here;
// that concept doesn't apply to accumulation goals.
export interface AccumulationTape {
  needs: number
  achieved: number
  recommended: number
  remaining: number
  viaProducts: string[]
}

export interface ActionPlanGoalFunding {
  goal: ActionPlanGoal
  fundedBy: { productLabel: string; annualContribution: number }[]
  totalAnnualContribution: number
  tape: AccumulationTape | null
}

export interface PersonActionPlan {
  personKey: string
  name: string
  protectionItems: ProtectionActionItem[]
  accumulationItems: AccumulationActionItem[]
  goalFunding: ActionPlanGoalFunding[]
  newAnnualCash: number
  replacementNetDelta: number
  topupNetDelta: number
  // Framework tapes for the Core Protection category — null when the person
  // has no protection profile (children, who aren't covered by Strategic
  // Objectives DTPD/CI) or when that pillar's maxCapitalRequired is 0.
  dtpdTape: ProtectionTape | null
  ciTape: ProtectionTape | null
}

export interface ActionPlanCashflowImpact {
  totalAdditions: number
  totalReplacementDelta: number
  totalTopupDelta: number
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
    deathBenefit: Math.round(p.deathBenefit || 0),
    tpdBenefit: Math.round(p.tpdBenefit || 0),
    ciBenefit: Math.round(p.advCiBenefit || 0),
    earlyCiBenefit: Math.round(p.earlyCiBenefit || 0),
  }))
}

// Goal ids/labels/targets must match exactly what recommendations/page.tsx's
// own loadAll() builds — that's what AccRec.allocatedGoalIds was tagged
// against when the advisor allocated a product to a goal, so this can't be
// rebuilt from a different (even if more "correct") derivation without
// breaking the funding tie-in.
function buildGoals(retData: Record<string, any>, eduData: Record<string, any>, cmData: Record<string, any>, clientAge: number): ActionPlanGoal[] {
  const ret = retData || {}
  const edu = eduData?.edu || eduData || {}
  const cm = cmData || {}
  const goals: ActionPlanGoal[] = []
  const expectedReturn = cm?.settings?.expectedReturn ?? 6

  const retCorpus = ret?.corpusNeeded || 0
  const retAge = ret?.ret?.client?.retirementAge || ret?.retirementAge || 65
  if (retCorpus > 0) {
    // retirementGap is the net figure (corpus - existing savings future-valued
    // to retirement age), saved alongside corpusNeeded by RetirementSection's
    // onCalculated — see scheduleRetSave in objectives/page.tsx. Clients whose
    // Retirement tab predates that field will have retirementGap undefined;
    // achieved falls back to 0 rather than guessing.
    const gap = typeof ret.retirementGap === 'number' ? ret.retirementGap : retCorpus
    const achieved = Math.max(0, Math.round(retCorpus - gap))
    goals.push({ id: 'retirement', label: 'Retirement', targetAge: retAge, targetCorpus: Math.round(retCorpus), achieved })
  }

  // Mirrors recommendations/page.tsx's loadAll() exactly — same inflation/
  // return-rate fallbacks, same yearsUntilUni/duration math. Previously this
  // read a `c.corpus` field that was never actually persisted (EducationChild
  // has no `corpus` property), so education goals never appeared here or in
  // the live goal picker at all. Computed directly now instead of reading a
  // number that was never saved — kept in sync with recommendations/page.tsx
  // by using the identical formula, since goal ids/corpus here have to match
  // what the picker showed the advisor when they allocated a product to it.
  const eduTuitionInf = (edu?.tuitionInflation ?? 5) / 100
  const eduLivingInf = (edu?.livingInflation ?? 3) / 100
  const eduReturnRate = edu?.returnRate ?? expectedReturn
  const seenEduChildIds = new Set<string>()
  ;(edu?.children || []).forEach((c: any) => {
    // Guard against duplicate/stale child records in the saved data producing
    // two goals for what should be the same child — kept identical to the
    // same guard in recommendations/page.tsx's loadAll().
    const eduKey = c.childId || c.name
    if (!eduKey || seenEduChildIds.has(eduKey)) return
    seenEduChildIds.add(eduKey)
    if ((c.annualTuition || 0) + (c.annualLiving || 0) === 0) return
    const yearsUntilUni = Math.max(1, (c.uniEntryAge || 18) - (c.age || 0))
    const duration = c.courseDuration || 4
    const fvTuition = (c.annualTuition || 0) * Math.pow(1 + eduTuitionInf, yearsUntilUni) * duration
    const fvLiving = (c.annualLiving || 0) * Math.pow(1 + eduLivingInf, yearsUntilUni) * duration
    const gross = fvTuition + fvLiving
    const achieved = Math.min(gross, (c.existingSavings || 0) * Math.pow(1 + eduReturnRate / 100, yearsUntilUni))
    if (gross <= 0) return
    goals.push({
      id: `edu_${c.childId || c.name}`,
      label: `${c.name}'s Education`,
      targetAge: clientAge + yearsUntilUni,
      targetCorpus: Math.round(gross),
      achieved: Math.round(achieved),
    })
  })

  ;(cm?.customGoals || []).forEach((g: any) => {
    if ((g.targetCorpus || 0) > 0) {
      goals.push({
        id: g.id || `g_${g.label}`,
        label: g.label || 'Wealth Goal',
        targetAge: g.targetAge || 0,
        targetCorpus: Math.round(g.targetCorpus),
        // Custom goals have no "existing progress" concept anywhere in the
        // data model — the advisor enters targetCorpus directly with no
        // netting step, unlike Retirement or (in principle) Education.
        achieved: 0,
      })
    }
  })

  return goals.sort((a, b) => a.targetAge - b.targetAge)
}

// Future-values a chosen accumulation product's contribution out to a goal's
// target age, and nets it against that goal's targetCorpus/achieved — same
// "gross split into segments that sum to needs" shape as buildTape(), but
// for a goal instead of a protection pillar. Only ever includes items whose
// allocatedGoalIds names this specific goal (the same tagging goalFunding's
// fundedBy already relies on) — this is a projection, not a persisted
// figure, so it's intentionally not frozen anywhere else in the snapshot.
function buildAccumulationTape(
  items: AccumulationActionItem[],
  goal: ActionPlanGoal,
  expectedReturnPct: number,
  clientAge: number,
): AccumulationTape | null {
  if (goal.targetCorpus <= 0) return null
  const yearsToTarget = Math.max(1, goal.targetAge - clientAge)
  const r = expectedReturnPct / 100

  let recommended = 0
  const viaProducts: string[] = []
  items.forEach(item => {
    if (!item.allocatedGoalIds.includes(goal.id)) return
    let itemFv = 0
    if (item.hasLumpSum && item.lumpSumAmount > 0) {
      itemFv += item.lumpSumAmount * Math.pow(1 + r, yearsToTarget)
    }
    if (item.hasRegular && item.annualContribution > 0) {
      itemFv += fv(r / 12, yearsToTarget * 12, item.annualContribution / 12)
    }
    if (itemFv > 0) {
      recommended += itemFv
      viaProducts.push(item.company || item.planType || 'Accumulation plan')
    }
  })

  if (recommended <= 0) return null // nothing recommended actually funds this goal

  const needs = goal.targetCorpus
  const displayAchieved = Math.min(Math.max(0, goal.achieved), needs)
  const remAfterAchieved = needs - displayAchieved
  const displayRecommended = Math.min(recommended, remAfterAchieved)
  const displayRemaining = Math.max(0, remAfterAchieved - displayRecommended)

  return {
    needs: Math.round(needs),
    achieved: Math.round(displayAchieved),
    recommended: Math.round(displayRecommended),
    remaining: Math.round(displayRemaining),
    viaProducts,
  }
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
      rationale: r.rationale || '',
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
      rationale: r.rationale || '',
      replacedPolicies: mapReplacedPolicies(r.replacedPolicies),
      replacedAnnualPremiumTotal: Math.round(replacedTotal(r.replacedPolicies)),
    }
  })
}

function mapAccumulation(list: any[]): AccumulationActionItem[] {
  return (list || []).filter((r: any) => r.isChosen).map((r: any) => {
    const freqMult = r.regularFreq === 'Monthly' ? 12 : r.regularFreq === 'Quarterly' ? 4 : 1
    const annualContribution = r.hasRegular ? (r.regularAmount || 0) * freqMult : 0
    const previousAnnualContribution = r.mode === 'topup' ? Math.round(r.topupOf?.previousAnnualAmount || 0) : 0
    const cashImpactDelta = annualContribution
    const accountType: 'individual' | 'joint' = r.accountType === 'joint' ? 'joint' : 'individual'
    const jointSplitClientPct = accountType === 'joint' ? (r.jointSplitClientPct ?? 50) : 100
    const clientAnnualContribution = Math.round(annualContribution * jointSplitClientPct / 100)
    const spouseAnnualContribution = Math.round(annualContribution) - clientAnnualContribution
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
      cashImpactDelta: Math.round(cashImpactDelta),
      benefits: r.benefits || '',
      limitations: r.limitations || '',
      rationale: r.rationale || '',
      accountType,
      jointSplitClientPct,
      clientAnnualContribution,
      spouseAnnualContribution,
      replacedPolicies: mapReplacedPolicies(r.replacedPolicies),
      replacedAnnualContribution: Math.round(replacedTotal(r.replacedPolicies)),
      topupProductLabel: r.topupOf?.policyName || '',
      previousAnnualContribution,
      allocatedGoalIds: r.allocatedGoalIds || [],
    }
  })
}

// Builds one framework tape (DTPD or CI) for a person's Core Protection
// items against that pillar's needs/assetMitigation/existingCoverage from
// the protection snapshot. Segment order mirrors the real shortfall formula
// there (netOfAssets = maxCapitalRequired - assetMitigation; shortfall =
// netOfAssets - existingCoverage): assets close the gap first, then existing
// cover, then the recommendation, with whatever's left over as shortfall.
// `benefitOf` reads the relevant benefit off a chosen core item;
// `replacedBenefitOf` reads the equivalent off a replaced policy so it can be
// netted out of existingCoverage — existingCoverage is computed live off the
// active policies table (see protectionSnapshot.ts) and has no idea a policy
// is being replaced in this Action Plan, so without this netting a
// replacement would double-count: once under existing, once under recommended.
function buildTape(
  coreItems: ProtectionActionItem[],
  needs: number,
  assetMitigation: number,
  existingCoverage: number,
  benefitOf: (item: ProtectionActionItem) => number,
  replacedBenefitOf: (p: ActionPlanReplacedPolicy) => number,
): ProtectionTape | null {
  if (needs <= 0) return null

  let recommended = 0
  let replacedOut = 0
  const viaProducts: string[] = []

  coreItems.forEach(item => {
    const benefit = benefitOf(item)
    if (benefit > 0) {
      recommended += benefit
      viaProducts.push(item.productName)
    }
    if (item.mode === 'replacement') {
      replacedOut += item.replacedPolicies.reduce((s, p) => s + replacedBenefitOf(p), 0)
    }
  })

  if (recommended <= 0) return null // nothing in Core actually addresses this pillar

  const adjustedExisting = Math.max(0, existingCoverage - replacedOut)

  const displayAsset = Math.min(Math.max(0, assetMitigation), needs)
  const remAfterAsset = needs - displayAsset
  const displayExisting = Math.min(adjustedExisting, remAfterAsset)
  const remAfterExisting = remAfterAsset - displayExisting
  const displayRecommended = Math.min(recommended, remAfterExisting)
  const displayRemaining = Math.max(0, remAfterExisting - displayRecommended)

  return {
    needs: Math.round(needs),
    assetMitigation: Math.round(displayAsset),
    existing: Math.round(displayExisting),
    recommended: Math.round(displayRecommended),
    remaining: Math.round(displayRemaining),
    viaProducts,
  }
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
  // DTPD/CI needs figures come from the already-built Protection snapshot —
  // frozen in here at save time like everything else, rather than
  // re-derived. null/undefined for a person with no protection profile
  // (e.g. no spouse on file) — that person's tapes will just be null.
  protectionProfiles?: { client: PersonProtectionProfile | null; spouse: PersonProtectionProfile | null }
}): ActionPlanSnapshot {
  const { client, familyMembers, recData, retData, eduData, cmData, annualSurplus, protectionProfiles } = input
  const clientAge = ageYearOnly(client.dob)

  const spouseMember = familyMembers.find(f => f.relationship === 'Spouse') || null
  const children = familyMembers.filter(f => ['Son', 'Daughter', 'Child'].includes(f.relationship))

  const goals = buildGoals(retData, eduData, cmData, clientAge)
  // Same default/fallback as capitalFundSnapshot.ts and investments/page.tsx —
  // kept identical so the projection here can't drift from what those tools
  // already assume.
  const expectedReturn = cmData?.settings?.expectedReturn ?? 6

  const medicalByPerson = recData?.medicalByPerson || {}
  const ltcByPerson = recData?.ltcByPerson || {}
  const expenseByPerson = recData?.expenseByPerson || {}
  const generalByPerson = recData?.generalByPerson || {}
  const accumulationByPerson = recData?.accumulationByPerson || {}

  // Joint accumulation products (e.g. FPI Global Wealth Advance held jointly)
  // are saved by the live tool under accumulationByPerson['joint'], a
  // separate bucket from 'client'/'spouse' — mirrors recommendations/page.tsx's
  // getEffectiveAccRecs, which merges personal + joint for display. Shown
  // under both client and spouse action plans (it's one shared account, not
  // two). Each item carries clientAnnualContribution/spouseAnnualContribution
  // (split via the advisor-set jointSplitClientPct, frozen at save time) —
  // these two always sum back to annualContribution, so allocating each
  // person their share below can never double-count the household total.
  const jointAccumulationItems = mapAccumulation(accumulationByPerson['joint'] || [])

  function buildPerson(personKey: string, name: string, includeJoint: boolean): PersonActionPlan {
    const protectionItems: ProtectionActionItem[] = [
      ...mapMedical(medicalByPerson[personKey] || []),
      ...mapProt('ltc', 'Long Term Care Protection', ltcByPerson[personKey] || []),
      ...mapProt('core', 'Core Protection', expenseByPerson[personKey] || []),
      ...mapProt('general', 'General Insurance', generalByPerson[personKey] || []),
    ]
    const ownAccumulationItems = mapAccumulation(accumulationByPerson[personKey] || [])
    // Display list includes joint items (for the Overview tab and goal
    // funding) at their full amount — the account is one shared product, not
    // two. Only the cash-impact totals below split by each person's share.
    const accumulationItems = includeJoint ? [...ownAccumulationItems, ...jointAccumulationItems] : ownAccumulationItems

    const goalFunding: ActionPlanGoalFunding[] = goals
      .map(goal => {
        const fundedBy = accumulationItems
          .filter(item => item.allocatedGoalIds.includes(goal.id))
          .map(item => ({
            productLabel: item.company || item.planType || 'Accumulation plan',
            annualContribution: item.annualContribution,
          }))
        return {
          goal,
          fundedBy,
          totalAnnualContribution: fundedBy.reduce((s, f) => s + f.annualContribution, 0),
          tape: buildAccumulationTape(accumulationItems, goal, expectedReturn, clientAge),
        }
      })
      .filter(gf => gf.fundedBy.length > 0)

    // Each person's share of a joint item's contribution — 'client' gets
    // jointSplitClientPct, 'spouse' gets the remainder. Children never
    // include joint items (includeJoint is false for them).
    const jointItemsForPerson = includeJoint ? jointAccumulationItems : []
    const jointShare = (item: AccumulationActionItem) =>
      personKey === 'spouse' ? item.spouseAnnualContribution : item.clientAnnualContribution

    const newAnnualCash =
      protectionItems.filter(i => i.mode === 'new').reduce((s, i) => s + i.annualPremiumCash, 0) +
      ownAccumulationItems.filter(i => i.mode === 'new').reduce((s, i) => s + i.annualContribution, 0) +
      jointItemsForPerson.filter(i => i.mode === 'new').reduce((s, i) => s + jointShare(i), 0)

    const replacementNetDelta =
      protectionItems.filter(i => i.mode === 'replacement').reduce((s, i) => s + i.cashImpactDelta, 0) +
      ownAccumulationItems.filter(i => i.mode === 'replacement').reduce((s, i) => s + i.annualContribution, 0) +
      jointItemsForPerson.filter(i => i.mode === 'replacement').reduce((s, i) => s + jointShare(i), 0)

    const topupNetDelta =
      ownAccumulationItems.filter(i => i.mode === 'topup').reduce((s, i) => s + i.cashImpactDelta, 0) +
      jointItemsForPerson.filter(i => i.mode === 'topup').reduce((s, i) => s + jointShare(i), 0)

    // Tapes only ever draw from Core Protection items — Medical, LTC, and
    // General have no dollar shortfall to measure against (medical/accident
    // are covered/needs-attention booleans on the framework ladder; LTC has
    // no framework pillar of its own).
    const profile: PersonProtectionProfile | null =
      personKey === 'client' ? (protectionProfiles?.client ?? null) :
      personKey === 'spouse' ? (protectionProfiles?.spouse ?? null) :
      null
    const coreItems = protectionItems.filter(i => i.category === 'core')
    const dtpdTape = profile
      ? buildTape(coreItems, profile.dtpd.maxCapitalRequired, profile.dtpd.assetMitigation, profile.dtpd.existingCoverage,
          item => item.deathBenefit, p => p.deathBenefit)
      : null
    const ciTape = profile
      ? buildTape(coreItems, profile.ci.maxCapitalRequired, profile.ci.assetMitigation, profile.ci.existingCoverage,
          item => item.ciBenefit + item.earlyCiBenefit, p => Math.max(p.ciBenefit, p.earlyCiBenefit))
      : null

    return {
      personKey,
      name,
      protectionItems,
      accumulationItems,
      goalFunding,
      newAnnualCash: Math.round(newAnnualCash),
      replacementNetDelta: Math.round(replacementNetDelta),
      topupNetDelta: Math.round(topupNetDelta),
      dtpdTape,
      ciTape,
    }
  }

  const clientPlan = buildPerson('client', client.name, true)
  const spousePlan = spouseMember ? buildPerson('spouse', spouseMember.name, true) : null
  const childPlans = children
    .map(c => buildPerson(`child_${c.id}`, c.name, false))
    .filter(p => p.protectionItems.length > 0 || p.accumulationItems.length > 0)

  const allPersons = [clientPlan, ...(spousePlan ? [spousePlan] : []), ...childPlans]

  // Joint contributions are now folded into each person's own
  // newAnnualCash/replacementNetDelta/topupNetDelta above via their split
  // share, so summing across allPersons already captures the full joint
  // amount exactly once — no separate joint addback needed here.
  const totalAdditions = allPersons.reduce((s, p) => s + p.newAnnualCash, 0)
  const totalReplacementDelta = allPersons.reduce((s, p) => s + p.replacementNetDelta, 0)
  const totalTopupDelta = allPersons.reduce((s, p) => s + p.topupNetDelta, 0)
  const netAnnualCashImpact = totalAdditions + totalReplacementDelta + totalTopupDelta

  return {
    client: clientPlan,
    spouse: spousePlan,
    children: childPlans,
    cashflowImpact: {
      totalAdditions: Math.round(totalAdditions),
      totalReplacementDelta: Math.round(totalReplacementDelta),
      totalTopupDelta: Math.round(totalTopupDelta),
      netAnnualCashImpact: Math.round(netAnnualCashImpact),
      currentAnnualSurplus: Math.round(annualSurplus),
      surplusAfter: Math.round(annualSurplus - netAnnualCashImpact),
    },
    hasAnyActions: allPersons.some(p => p.protectionItems.length > 0 || p.accumulationItems.length > 0),
  }
}
