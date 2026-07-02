'use client'
import { useState, ReactNode } from 'react'
import { Stethoscope, HeartPulse, ShieldCheck, Home, Palmtree, GraduationCap, Building2, TrendingUp, LucideIcon } from 'lucide-react'
import {
  ActionPlanSnapshot,
  PersonActionPlan,
  ProtectionActionItem,
  ProtectionActionCategory,
  AccumulationActionItem,
  ActionPlanGoalFunding,
  ActionPlanCashflowImpact,
  ProtectionTape,
} from '@/lib/actionPlanSnapshot'

type Page = 'overview' | 'protection' | 'accumulation'

function fmt(n: number): string {
  if (!n || isNaN(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-SG')
}

function fmtSigned(n: number): string {
  if (!n || isNaN(n)) return '$0'
  return (n < 0 ? '–' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-SG')
}

const CATEGORY_META: Record<ProtectionActionCategory, { icon: LucideIcon; color: string }> = {
  medical: { icon: Stethoscope, color: '#7A9CBF' },
  ltc: { icon: HeartPulse, color: '#9B7BAA' },
  core: { icon: ShieldCheck, color: 'var(--gold)' },
  general: { icon: Home, color: '#8A9A7E' },
}

// Mirrors CapitalFundDisplay's objectiveIcon — same goal ids, same icons,
// so a goal looks the same whether it's seen on the Capital Fund tab or here.
function objectiveIcon(id: string): LucideIcon {
  if (id === 'retirement') return Palmtree
  if (id.startsWith('edu_')) return GraduationCap
  return Building2
}

function statsFor(item: ProtectionActionItem): { label: string; value: string }[] {
  const stats: { label: string; value: string }[] = []
  if (item.deathBenefit > 0) stats.push({ label: 'Death benefit', value: fmt(item.deathBenefit) })
  if (item.tpdBenefit > 0) stats.push({ label: 'TPD benefit', value: fmt(item.tpdBenefit) })
  if (item.ciBenefit > 0) stats.push({ label: 'CI benefit', value: fmt(item.ciBenefit) })
  if (item.earlyCiBenefit > 0) stats.push({ label: 'Early CI benefit', value: fmt(item.earlyCiBenefit) })
  if (item.monthlyBenefit > 0) stats.push({ label: 'Monthly benefit', value: fmt(item.monthlyBenefit) + '/mo' })
  if (item.sumAssured > 0) stats.push({ label: 'Sum assured', value: fmt(item.sumAssured) })
  return stats
}

function PageNav({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  const items: { id: Page; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'protection', label: 'Protection actions' },
    { id: 'accumulation', label: 'Accumulation & goals' },
  ]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 32, borderBottom: '1px solid var(--line)' }}>
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => setPage(item.id)}
          style={{
            border: 'none', background: 'none', cursor: 'pointer', padding: '0 0 12px 0', marginBottom: -1,
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: page === item.id ? 500 : 400,
            color: page === item.id ? 'var(--ink)' : 'var(--ink3)',
            borderBottom: page === item.id ? '2px solid var(--gold)' : '2px solid transparent',
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function CashflowImpactBanner({ impact }: { impact: ActionPlanCashflowImpact }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 10 }}>
        Household cash flow impact
      </div>
      <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink3)', marginBottom: 4 }}>New premiums &amp; contributions</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 20, color: 'var(--ink)' }}>{fmt(impact.totalAdditions)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink3)', marginBottom: 4 }}>Net change from top-ups</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 20, color: impact.totalTopupDelta <= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
              {fmtSigned(impact.totalTopupDelta)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink3)', marginBottom: 4 }}>Net change from replacements</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 20, color: impact.totalReplacementDelta <= 0 ? 'var(--emerald)' : 'var(--rouge)' }}>
              {fmtSigned(impact.totalReplacementDelta)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink3)', marginBottom: 4 }}>Net annual cash impact</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 20, color: 'var(--ink)' }}>{fmt(impact.netAnnualCashImpact)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink3)', marginBottom: 4 }}>Surplus after</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 20, color: impact.surplusAfter < 0 ? 'var(--rouge)' : 'var(--gold)' }}>
              {fmt(impact.surplusAfter)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 2 }}>of {fmt(impact.currentAnnualSurplus)} current surplus</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: 'var(--ink3)', fontStyle: 'italic' }}>{text}</div>
  )
}

// Fixed display order for the Overview tab's category sections — Medical,
// then LTC, then Core Protection (where the measuring tape lives), then
// General. Deliberately not CATEGORY_META's own key order re-derived, so a
// future reshuffle of that object can't silently reorder this.
const OVERVIEW_CATEGORY_ORDER: ProtectionActionCategory[] = ['medical', 'ltc', 'core', 'general']

interface OverviewRow {
  key: string
  color: string
  productName: string
  amount: number
  tag: string
  isTopup: boolean
  previousAmount: number
}

function protectionToRow(i: ProtectionActionItem): OverviewRow {
  return {
    key: i.id,
    color: CATEGORY_META[i.category].color,
    productName: i.productName,
    amount: i.annualPremiumTotal,
    tag: i.mode === 'replacement' ? `Replacing ${i.replacedPolicies.length} polic${i.replacedPolicies.length === 1 ? 'y' : 'ies'}` : 'New',
    isTopup: false,
    previousAmount: 0,
  }
}

function accumulationToRow(i: AccumulationActionItem): OverviewRow {
  return {
    key: i.id,
    color: 'var(--emerald)',
    productName: i.company || i.planType || 'Accumulation plan',
    amount: i.mode === 'topup' ? (i.previousAnnualContribution + i.annualContribution) : i.annualContribution,
    tag: i.mode === 'topup'
      ? 'Top-up'
      : (i.allocatedGoalIds.length > 0
        ? `Funds ${i.allocatedGoalIds.length} goal${i.allocatedGoalIds.length === 1 ? '' : 's'}`
        : (i.mode === 'replacement' ? 'Replacing' : 'New')),
    isTopup: i.mode === 'topup',
    previousAmount: i.previousAnnualContribution,
  }
}

function OverviewProductRow({ row }: { row: OverviewRow }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: '13px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: row.color, flexShrink: 0 }} />
        <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.productName}</div>
      </div>
      {row.isTopup ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--emerald)', background: 'var(--cream2)', padding: '3px 9px 3px 7px', borderRadius: 20 }}>
            <TrendingUp size={11} aria-hidden="true" />Top-up
          </span>
          <div style={{ textAlign: 'right' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 5 }}>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--ink3)', textDecoration: 'line-through' }}>{fmt(row.previousAmount)}</span>
              <span style={{ fontSize: 11, color: 'var(--ink3)' }}>→</span>
            </div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)' }}>{fmt(row.amount)}/yr</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink3)', background: 'var(--cream2)', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>
            {row.tag}
          </span>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)', textAlign: 'right' }}>{fmt(row.amount)}/yr</div>
        </div>
      )}
    </div>
  )
}

// The "measuring tape" — needs split into existing (grey) / recommended
// (green) / remaining shortfall (red). Segment widths come pre-clamped from
// buildTape() so they always sum to `tape.needs`.
function MeasuringTape({ label, tape }: { label: string; tape: ProtectionTape }) {
  const existingPct = (tape.existing / tape.needs) * 100
  const recommendedPct = (tape.recommended / tape.needs) * 100
  const remainingPct = (tape.remaining / tape.needs) * 100
  const isClosed = tape.remaining === 0

  return (
    <div style={{ padding: '16px 0 18px', borderBottom: '1px solid var(--cream3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{label}</span>
        <span style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 13, color: 'var(--ink3)' }}>
          needs <b style={{ color: 'var(--ink)', fontWeight: 600, fontStyle: 'normal' }}>{fmt(tape.needs)}</b>
        </span>
      </div>
      <div style={{ borderTop: '1px dashed var(--line2)', borderBottom: '1px dashed var(--line2)', padding: '5px 0' }}>
        <div style={{ display: 'flex', height: 11, borderRadius: 6, overflow: 'hidden' }}>
          {existingPct > 0 && <div style={{ width: `${existingPct}%`, background: 'var(--ink3)' }} />}
          {recommendedPct > 0 && <div style={{ width: `${recommendedPct}%`, background: 'var(--emerald)' }} />}
          {remainingPct > 0 && <div style={{ width: `${remainingPct}%`, background: 'var(--rouge)' }} />}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 10.5 }}>
        <div>
          <div style={{ color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--ink3)', display: 'inline-block' }} />Existing
          </div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11.5, color: 'var(--ink)', paddingLeft: 13 }}>{fmt(tape.existing)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--emerald)', display: 'inline-block' }} />Recommended
          </div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11.5, color: 'var(--ink)', paddingLeft: 13 }}>+{fmt(tape.recommended)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--rouge)', opacity: isClosed ? 0.25 : 1, display: 'inline-block' }} />Remaining shortfall
          </div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11.5, color: isClosed ? 'var(--emerald)' : 'var(--rouge)', paddingLeft: 13 }}>
            {isClosed ? `${fmt(0)} — closed` : fmt(tape.remaining)}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 13, fontStyle: 'italic', fontFamily: 'Cormorant Garamond, serif', color: 'var(--ink3)', marginTop: 12 }}>
        via {tape.viaProducts.join(', ')}
      </div>
    </div>
  )
}

function CategorySection({ label, color, children }: { label: string; color: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 36 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink)', fontWeight: 600 }}>{label}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--line2)' }} />
      </div>
      {children}
    </div>
  )
}

function OverviewPage({ person }: { person: PersonActionPlan }) {
  const hasAnyProtection = person.protectionItems.length > 0
  const hasAny = hasAnyProtection || person.accumulationItems.length > 0

  if (!hasAny) return <EmptyNote text={`No actions recorded yet for ${person.name}.`} />

  return (
    <div>
      {OVERVIEW_CATEGORY_ORDER.map(cat => {
        const items = person.protectionItems.filter(i => i.category === cat)
        if (items.length === 0) return null
        return (
          <CategorySection key={cat} label={items[0].categoryLabel} color={CATEGORY_META[cat].color}>
            {items.map(item => <OverviewProductRow key={item.id} row={protectionToRow(item)} />)}
            {cat === 'core' && person.dtpdTape && <MeasuringTape label="Capital protection — Death & TPD" tape={person.dtpdTape} />}
            {cat === 'core' && person.ciTape && <MeasuringTape label="Income protection — Critical Illness" tape={person.ciTape} />}
          </CategorySection>
        )
      })}
      {person.accumulationItems.length > 0 && (
        <CategorySection label="Wealth Accumulation" color="var(--emerald)">
          {person.accumulationItems.map(item => <OverviewProductRow key={item.id} row={accumulationToRow(item)} />)}
        </CategorySection>
      )}
    </div>
  )
}

function ProtectionItemCard({ item }: { item: ProtectionActionItem }) {
  const stats = statsFor(item)
  const hasMidSection = stats.length > 0
  const hasLowerSection = !!item.rationale || !!item.benefits || !!item.limitations
  const hasReplacement = item.mode === 'replacement' && item.replacedPolicies.length > 0

  return (
    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: (hasMidSection || hasLowerSection || hasReplacement) ? 14 : 0 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>
            {item.productName}{item.insurer ? ` — ${item.insurer}` : ''}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
            {item.mode === 'replacement' ? `Replacing ${item.replacedPolicies.length} existing polic${item.replacedPolicies.length === 1 ? 'y' : 'ies'}` : 'New coverage'}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: 'var(--ink)' }}>{fmt(item.annualPremiumTotal)}/yr</div>
          {item.annualPremiumMedisave > 0 && (
            <div style={{ fontSize: 10, color: 'var(--ink3)' }}>incl. {fmt(item.annualPremiumMedisave)} via Medisave</div>
          )}
        </div>
      </div>

      {hasMidSection && (
        <div style={{
          display: 'grid', gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0,1fr))`, gap: 12,
          padding: '12px 0', borderTop: '1px solid var(--cream3)',
          borderBottom: (hasLowerSection || hasReplacement) ? '1px solid var(--cream3)' : 'none',
          marginBottom: (hasLowerSection || hasReplacement) ? 14 : 0,
        }}>
          {stats.map(s => (
            <div key={s.label}>
              <div style={{ fontSize: 10, color: 'var(--ink3)', marginBottom: 3 }}>{s.label}</div>
              <div style={{ fontSize: 13, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {item.rationale && (
        <div style={{ marginBottom: (item.benefits || item.limitations) ? 12 : (hasReplacement ? 14 : 0), background: 'var(--cream)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 4 }}>Purpose / Rationale</div>
          <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>{item.rationale}</div>
        </div>
      )}
      {item.benefits && (
        <div style={{ marginBottom: item.limitations ? 8 : (hasReplacement ? 14 : 0) }}>
          <div style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Benefits</div>
          <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>{item.benefits}</div>
        </div>
      )}
      {item.limitations && (
        <div style={{ marginBottom: hasReplacement ? 14 : 0 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Limitations</div>
          <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>{item.limitations}</div>
        </div>
      )}

      {hasReplacement && (
        <div style={{ background: 'var(--rouge-l,#F3E5E1)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--rouge)', marginBottom: 6 }}>Replacing</div>
          {item.replacedPolicies.map((p, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: i < item.replacedPolicies.length - 1 ? 4 : 0 }}>
              {p.policyName}{p.companyName ? ` — ${p.companyName}` : ''} · was {fmt(p.annualPremium)}/yr
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProtectionPage({ person }: { person: PersonActionPlan }) {
  if (person.protectionItems.length === 0) return <EmptyNote text={`No protection actions recorded yet for ${person.name}.`} />

  const categories: ProtectionActionCategory[] = ['medical', 'ltc', 'core', 'general']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {categories.map(cat => {
        const items = person.protectionItems.filter(i => i.category === cat)
        if (items.length === 0) return null
        const Icon = CATEGORY_META[cat].icon
        return (
          <div key={cat}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Icon size={15} color={CATEGORY_META[cat].color} aria-hidden="true" />
              <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>{items[0].categoryLabel}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {items.map(item => <ProtectionItemCard key={item.id} item={item} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AccumulationItemCard({ item }: { item: AccumulationActionItem }) {
  const contributionLines: string[] = []
  if (item.hasLumpSum && item.lumpSumAmount > 0) contributionLines.push(`${fmt(item.lumpSumAmount)} lump sum`)
  if (item.hasRegular && item.annualContribution > 0) contributionLines.push(`${fmt(item.annualContribution)}/yr regular`)

  const modeLabel = item.mode === 'topup' ? 'Top-up' : (item.mode === 'replacement' ? 'Replacement' : 'New')

  return (
    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: (item.rationale || item.benefits || item.limitations) ? 14 : 0 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>{item.company || item.planType || 'Accumulation plan'}</div>
          <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
            {[item.productType, item.planType].filter(Boolean).join(' · ') || modeLabel}
          </div>
          {item.mode === 'topup' && item.topupProductLabel && (
            <div style={{ fontSize: 11, color: 'var(--emerald)', marginTop: 4 }}>Topping up {item.topupProductLabel}</div>
          )}
          {item.accountType === 'joint' && (
            <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 4 }}>
              Joint account — split {item.jointSplitClientPct}% / {100 - item.jointSplitClientPct}%
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {item.mode === 'topup' && item.hasRegular && item.annualContribution > 0 ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 5 }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--ink3)', textDecoration: 'line-through' }}>{fmt(item.previousAnnualContribution)}</span>
                <span style={{ fontSize: 11, color: 'var(--ink3)' }}>→</span>
              </div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)' }}>{fmt(item.previousAnnualContribution + item.annualContribution)}/yr</div>
              <div style={{ fontSize: 10, color: 'var(--emerald)', marginTop: 2 }}>+{fmt(item.annualContribution)}/yr top-up</div>
            </div>
          ) : (
            contributionLines.map((l, i) => (
              <div key={i} style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)' }}>{l}</div>
            ))
          )}
        </div>
      </div>
      {item.rationale && (
        <div style={{ marginBottom: (item.benefits || item.limitations) ? 12 : 0, background: 'var(--cream)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 4 }}>Purpose / Rationale</div>
          <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>{item.rationale}</div>
        </div>
      )}
      {item.benefits && (
        <div style={{ marginBottom: item.limitations ? 8 : 0 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Benefits</div>
          <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>{item.benefits}</div>
        </div>
      )}
      {item.limitations && (
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Limitations</div>
          <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>{item.limitations}</div>
        </div>
      )}
    </div>
  )
}

function GoalFundingCard({ gf }: { gf: ActionPlanGoalFunding }) {
  const Icon = objectiveIcon(gf.goal.id)
  const accentColor = gf.goal.id === 'retirement' ? 'var(--gold)' : 'var(--emerald)'
  const iconColor = gf.goal.id === 'retirement' ? 'var(--gold-tag,#8A6C3A)' : 'var(--emerald)'

  return (
    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
        <div style={{ width: 3, borderRadius: 2, flexShrink: 0, alignSelf: 'stretch', background: accentColor }} />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon size={14} color={iconColor} aria-hidden="true" />
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, color: 'var(--ink)' }}>
              {gf.goal.label}{gf.goal.targetAge > 0 ? ` · age ${gf.goal.targetAge}` : ''}
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>Target {fmt(gf.goal.targetCorpus)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {gf.fundedBy.map((f, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--cream3)' }}>
            <div style={{ fontSize: 13, color: 'var(--ink2)' }}>{f.productLabel}</div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--ink)' }}>{fmt(f.annualContribution)}/yr</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AccumulationPage({ person }: { person: PersonActionPlan }) {
  if (person.accumulationItems.length === 0 && person.goalFunding.length === 0) {
    return <EmptyNote text={`No accumulation actions recorded yet for ${person.name}.`} />
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
      {person.accumulationItems.length > 0 && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 14 }}>Wealth Accumulation</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {person.accumulationItems.map(item => <AccumulationItemCard key={item.id} item={item} />)}
          </div>
        </div>
      )}
      {person.goalFunding.length > 0 && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 14 }}>Goal funding</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {person.goalFunding.map(gf => <GoalFundingCard key={gf.goal.id} gf={gf} />)}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ActionPlanDisplay({ snapshot, clientName, spouseName }: {
  snapshot: ActionPlanSnapshot
  clientName?: string
  spouseName?: string
}) {
  // clientName/spouseName reflect the live, current display name (same pattern
  // as the share-data route's personLabels) — preferred over the frozen
  // snapshot's name when both are available.
  const people: { key: string; name: string; plan: PersonActionPlan }[] = [
    { key: snapshot.client.personKey, name: clientName || snapshot.client.name, plan: snapshot.client },
    ...(snapshot.spouse ? [{ key: snapshot.spouse.personKey, name: spouseName || snapshot.spouse.name, plan: snapshot.spouse }] : []),
    ...snapshot.children.map(c => ({ key: c.personKey, name: c.name, plan: c })),
  ]

  const [activeKey, setActiveKey] = useState(people[0].key)
  const [page, setPage] = useState<Page>('overview')

  if (!snapshot.hasAnyActions) {
    return <EmptyNote text="No recommendations have been finalized yet — choose and confirm products in the Recommendations tool to populate this page." />
  }

  const active = people.find(p => p.key === activeKey) || people[0]

  function selectPerson(key: string) {
    setActiveKey(key)
    setPage('overview')
  }

  return (
    <div>
      <CashflowImpactBanner impact={snapshot.cashflowImpact} />

      {people.length > 1 && (
        <div style={{ display: 'inline-flex', background: 'var(--cream2)', borderRadius: 999, padding: 3, marginBottom: 28 }}>
          {people.map(p => (
            <button
              key={p.key}
              onClick={() => selectPerson(p.key)}
              style={{
                border: 'none', cursor: 'pointer', borderRadius: 999, padding: '8px 18px',
                fontSize: 13, fontWeight: active.key === p.key ? 500 : 400, fontFamily: 'Inter, sans-serif',
                background: active.key === p.key ? '#fff' : 'transparent',
                color: active.key === p.key ? 'var(--ink)' : 'var(--ink3)',
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <PageNav page={page} setPage={setPage} />

      {page === 'overview' && <OverviewPage person={active.plan} />}
      {page === 'protection' && <ProtectionPage person={active.plan} />}
      {page === 'accumulation' && <AccumulationPage person={active.plan} />}
    </div>
  )
}
