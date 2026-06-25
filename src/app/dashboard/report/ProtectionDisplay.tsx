'use client'
import { useState, ReactNode } from 'react'
import { Stethoscope, HeartPulse, Shield, Bandage, Home, Key, GraduationCap, Wallet, ShieldCheck, ArrowRight, LucideIcon } from 'lucide-react'
import { ProtectionSnapshot, PersonProtectionProfile, PersonProtectionBreakdown, PersonCIBreakdown, LifePolicyLineItem, FamilyRunway } from '@/lib/protectionSnapshot'

type Page = 'overview' | 'dtpd' | 'ci'

function fmt(n: number): string {
  if (!n || isNaN(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-SG')
}

// Compact display form for headline/story figures — e.g. $1.85M, $420K.
// Falls back to the full comma-formatted amount under $1,000.
function fmtCompact(n: number): string {
  if (!n || isNaN(n)) return '$0'
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M'
  if (n >= 1000) return '$' + Math.round(n / 1000) + 'K'
  return fmt(n)
}

function fundedPct(have: number, need: number): number {
  if (need <= 0) return 100
  return Math.round((have / need) * 100)
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[0] + ' and ' + parts[1]
  return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1]
}

// Mirrors formatDate() on the Risk Management page so "Lifetime" / "Renewable" /
// "Age 65" presets and ISO dates display the same way here as they do there.
function formatCoverAge(raw: string): string {
  if (!raw) return '—'
  if (raw === 'Lifetime' || raw === 'Renewable' || raw.startsWith('Age ')) return raw
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(raw)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  return raw
}

interface StoryItem {
  icon: LucideIcon
  label: string
  value: number
  accent?: string
}

// The fields shared by both breakdown shapes — enough for the overview
// page's headline stats, which don't need the protection-type-specific extras.
interface CoreBreakdown {
  maxCapitalRequired: number
  shortfall: number
  status: 'covered' | 'shortfall'
}

// Pre-built content for one narrative section (Death/TPD or Critical Illness).
// Keeping the copy-generation separate from layout lets both protection types
// share one rendering component below despite having different framing.
interface SectionContent {
  eyebrow: string
  headline: ReactNode
  hasNeed: boolean
  pct: number
  have: number
  need: number
  progressColor: string
  gapLine: ReactNode
  isShortfall: boolean
  protects: StoryItem[]
  inPlace: StoryItem[]
  closingLine: string
  accentColor: string
}

function StoryRow({ icon, label, value, accent }: StoryItem) {
  const Icon = icon
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon size={16} color={accent || 'var(--ink3)'} aria-hidden="true" />
        <span style={{ fontSize: 14, color: 'var(--ink2)' }}>{label}</span>
      </div>
      <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 17, color: 'var(--ink)', whiteSpace: 'nowrap', marginLeft: 16 }}>
        {fmtCompact(value)}
      </span>
    </div>
  )
}

function LadderRow({ icon, label, covered, statusText, last }: { icon: LucideIcon; label: string; covered: boolean; statusText: string; last?: boolean }) {
  const Icon = icon
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: last ? 0 : 24, position: 'relative' }}>
      <div style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: covered ? 'var(--emerald)' : 'var(--rouge-l)',
        border: covered ? 'none' : '1px solid var(--rouge)',
      }}>
        <Icon size={17} color={covered ? '#fff' : 'var(--rouge)'} aria-hidden="true" />
      </div>
      <div style={{ paddingTop: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{label}</div>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 13, color: covered ? 'var(--ink2)' : 'var(--rouge)', marginTop: 2 }}>
          {statusText}
        </div>
      </div>
    </div>
  )
}

function ProtectionLadder({ profile }: { profile: PersonProtectionProfile }) {
  const { ci, dtpd, framework } = profile

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', left: 19, top: 19, bottom: 19, width: 1, background: 'var(--line2)' }} />
      <LadderRow
        icon={Stethoscope}
        label="Medical & health protection"
        covered={framework.medicalCovered}
        statusText={framework.medicalCovered ? 'Covered' : 'Needs attention'}
      />
      <LadderRow
        icon={HeartPulse}
        label="Income protection — critical illness"
        covered={ci.status === 'covered'}
        statusText={ci.status === 'covered' ? 'Covered' : 'Needs attention'}
      />
      <LadderRow
        icon={Shield}
        label="Capital protection — death & TPD"
        covered={dtpd.status === 'covered'}
        statusText={dtpd.status === 'covered' ? 'Covered' : 'Needs attention'}
      />
      <LadderRow
        icon={Bandage}
        label="Personal accident"
        covered={framework.accidentCovered}
        statusText={framework.accidentCovered ? 'Covered' : 'Needs attention'}
        last
      />
    </div>
  )
}

function LifeInsuranceTable({ policies }: { policies: LifePolicyLineItem[] }) {
  if (policies.length === 0) return null
  const cols = '1.5fr 0.85fr 0.85fr 0.85fr 0.85fr 0.75fr'
  const single = (v: number) => (v > 0 ? fmtCompact(v) : '—')

  return (
    <div style={{ marginTop: 48 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 16 }}>
        Existing life insurance portfolio
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, paddingBottom: 10, borderBottom: '1px solid var(--line2)' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Provider / policy</div>
        <div style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink3)', textAlign: 'right' }}>Death</div>
        <div style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink3)', textAlign: 'right' }}>TPD</div>
        <div style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink3)', textAlign: 'right' }}>CI</div>
        <div style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink3)', textAlign: 'right' }}>ECI</div>
        <div style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink3)', textAlign: 'right' }}>Cover age</div>
      </div>
      {policies.map(pol => {
        const toSGD = (v: number) => (pol.isUSD ? v * pol.fxRate : v)
        return (
          <div key={pol.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--line2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink)' }}>
              <span>{pol.companyName}{pol.productName ? ` · ${pol.productName}` : ''}</span>
              {pol.isUSD && (
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--gold-tag)', background: 'var(--gold-l)', border: '1px solid var(--gold)', padding: '1px 5px', borderRadius: 3, letterSpacing: '0.05em' }}>
                  USD
                </span>
              )}
            </div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)', textAlign: 'right' }}>
              {single(toSGD(pol.deathSA))}
            </div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)', textAlign: 'right' }}>
              {single(toSGD(pol.tpdSA))}
            </div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)', textAlign: 'right' }}>
              {single(toSGD(pol.ciSA))}
            </div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)', textAlign: 'right' }}>
              {single(toSGD(pol.eciSA))}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink2)', textAlign: 'right' }}>
              {formatCoverAge(pol.coverAge)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatBlock({ label, icon, breakdown }: { label: string; icon: LucideIcon; breakdown: CoreBreakdown }) {
  const Icon = icon
  const hasNeed = breakdown.maxCapitalRequired > 0
  const isShortfall = breakdown.status === 'shortfall'
  const statusColor = !hasNeed ? 'var(--ink3)' : isShortfall ? 'var(--rouge)' : 'var(--emerald)'

  return (
    <div style={{ flex: 1, minWidth: 180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Icon size={14} color={statusColor} aria-hidden="true" />
        <span style={{ fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
          {label}
        </span>
      </div>
      {!hasNeed ? (
        <>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 36, lineHeight: 1, color: 'var(--ink3)' }}>—</div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 13, color: 'var(--ink3)', marginTop: 4 }}>not yet assessed</div>
        </>
      ) : isShortfall ? (
        <>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 36, lineHeight: 1, color: 'var(--rouge)' }}>{fmtCompact(breakdown.shortfall)}</div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>capital shortfall</div>
          <div style={{ width: 28, height: 3, background: 'var(--rouge)', marginTop: 12 }} />
        </>
      ) : (
        <>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 36, lineHeight: 1, color: 'var(--emerald)' }}>Covered</div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>fully in place</div>
          <div style={{ width: 28, height: 3, background: 'var(--emerald)', marginTop: 12 }} />
        </>
      )}
    </div>
  )
}

function ContinueLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: 40, border: 'none', background: 'none', cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: 'var(--gold)',
      }}
    >
      {label}
      <ArrowRight size={14} aria-hidden="true" />
    </button>
  )
}

function PageNav({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  const items: { id: Page; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'dtpd', label: 'Death & TPD' },
    { id: 'ci', label: 'Critical illness' },
  ]
  return (
    <div style={{ display: 'flex', gap: 24, marginBottom: 36, borderBottom: '1px solid var(--line)' }}>
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

function FamilyRunwayChart({ name, runway }: { name: string; runway: FamilyRunway }) {
  const { fundedYears, targetYears, status } = runway
  const isCovered = status === 'covered'
  const fundedColor = isCovered ? 'var(--emerald)' : 'var(--rouge)'
  const axisMax = Math.max(fundedYears, targetYears)
  const ticks = [0, axisMax * 0.25, axisMax * 0.5, axisMax * 0.75, axisMax]
  const fmtYrs = (n: number) => (Math.round(n * 10) / 10).toString()

  return (
    <div style={{ marginBottom: 44 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 10 }}>
        Family financial runway
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5, maxWidth: 480, marginBottom: 28 }}>
        How long the existing death benefit would sustain {name}'s family at their current lifestyle, assuming inflation on that need.
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--ink2)' }}>Funded today</span>
          <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 17, color: fundedColor }}>{fmtYrs(fundedYears)} yrs</span>
        </div>
        <div style={{ height: 10, background: 'var(--cream2)' }}>
          <div style={{ height: '100%', width: `${axisMax > 0 ? (fundedYears / axisMax) * 100 : 0}%`, background: fundedColor }} />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--ink2)' }}>Family's need</span>
          <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>{fmtYrs(targetYears)} yrs</span>
        </div>
        <div style={{ height: 10, background: 'var(--cream2)' }}>
          <div style={{ height: '100%', width: `${axisMax > 0 ? (targetYears / axisMax) * 100 : 0}%`, background: 'var(--ink2)' }} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink3)', fontFamily: 'DM Mono, monospace', paddingTop: 2, borderTop: '1px solid var(--line2)' }}>
        {ticks.map((t, i) => <span key={i}>{fmtYrs(t)}</span>)}
      </div>
    </div>
  )
}

function OverviewPage({ name, profile, onContinue }: { name: string; profile: PersonProtectionProfile; onContinue: () => void }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 14 }}>
        Protection overview
      </div>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontSize: 26, lineHeight: 1.45, color: 'var(--ink)', marginBottom: 36 }}>
        Here's where {name}'s protection stands today.
      </div>

      <div style={{ display: 'flex', marginBottom: 48 }}>
        <StatBlock label="Death & TPD" icon={Shield} breakdown={profile.dtpd} />
        <div style={{ width: 1, background: 'var(--line2)', margin: '0 32px' }} />
        <StatBlock label="Critical illness" icon={HeartPulse} breakdown={profile.ci} />
      </div>

      <FamilyRunwayChart name={name} runway={profile.runway} />

      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 22 }}>
        Protection framework
      </div>
      <ProtectionLadder profile={profile} />

      <LifeInsuranceTable policies={profile.lifePolicies} />

      <ContinueLink label="See the Death & TPD breakdown" onClick={onContinue} />
    </div>
  )
}

function buildDTPDContent(name: string, dtpd: PersonProtectionBreakdown): SectionContent {
  const have = dtpd.assetMitigation + dtpd.existingCoverage
  const isShortfall = dtpd.status === 'shortfall'
  const hasNeed = dtpd.maxCapitalRequired > 0
  const pct = fundedPct(have, dtpd.maxCapitalRequired)

  const protects: StoryItem[] = []
  protects.push({ icon: Home, label: 'Their day-to-day life — keeping the household running', value: dtpd.familyDependency })
  if (dtpd.mortgageDebtClearance > 0) {
    protects.push({ icon: Key, label: 'The roof over their heads — mortgage and debts cleared', value: dtpd.mortgageDebtClearance })
  }
  if (dtpd.tertiaryFunding > 0) {
    protects.push({ icon: GraduationCap, label: "Their children's future — university funded", value: dtpd.tertiaryFunding })
  }

  const inPlace: StoryItem[] = []
  if (dtpd.assetMitigation > 0) {
    inPlace.push({ icon: Wallet, label: 'Savings, CPF and property equity', value: dtpd.assetMitigation, accent: 'var(--emerald)' })
  }
  inPlace.push({ icon: ShieldCheck, label: 'Existing life insurance', value: dtpd.existingCoverage, accent: 'var(--gold)' })

  const closingParts: string[] = ['keep their lifestyle']
  if (dtpd.mortgageDebtClearance > 0) closingParts.push('stay in their home')
  if (dtpd.tertiaryFunding > 0) closingParts.push('see the children through school')

  let headline: ReactNode
  let progressColor = 'var(--gold)'
  let gapLine: ReactNode = null
  let closingLine = ''

  if (!hasNeed) {
    headline = <>No capital protection need has been identified for {name} yet.</>
  } else if (isShortfall) {
    headline = (
      <>
        If something happened to {name} today, their family would have{' '}
        <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{fmtCompact(have)}</span> ready — about{' '}
        <span style={{ fontWeight: 600 }}>{pct}%</span> of what they would need to stay secure and keep life unchanged.
      </>
    )
    progressColor = 'var(--gold)'
    gapLine = <>A gap of {fmtCompact(dtpd.shortfall)} remains.</>
    closingLine = `Closing this gap means ${name}'s family can ${joinWithAnd(closingParts)} — whatever happens. Without it, the people ${name} cares about most could face difficult choices at the hardest possible moment.`
  } else {
    headline = (
      <>
        If something happened to {name} today, their family would have{' '}
        <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>{fmtCompact(have)}</span> ready — more than enough to stay secure
        and keep life unchanged.
      </>
    )
    progressColor = 'var(--emerald)'
    const surplus = have - dtpd.maxCapitalRequired
    gapLine = surplus > 0 ? <>{fmtCompact(surplus)} more than they would need.</> : <>Exactly what they would need, in place today.</>
    closingLine = `${name}'s family already has full protection in place — with room to spare.`
  }

  return {
    eyebrow: 'Capital protection — death & TPD',
    headline, hasNeed, pct, have, need: dtpd.maxCapitalRequired, progressColor, gapLine, isShortfall,
    protects, inPlace, closingLine, accentColor: isShortfall ? 'var(--gold)' : 'var(--emerald)',
  }
}

function buildCIContent(name: string, ci: PersonCIBreakdown): SectionContent {
  const have = ci.assetMitigation + ci.existingCoverage
  const isShortfall = ci.status === 'shortfall'
  const hasNeed = ci.maxCapitalRequired > 0
  const pct = fundedPct(have, ci.maxCapitalRequired)

  const protects: StoryItem[] = []
  protects.push({ icon: HeartPulse, label: 'Their income during recovery — replacing earnings while they cannot work', value: ci.familyDependency })
  if (ci.mortgageDebtClearance > 0) {
    protects.push({ icon: Key, label: 'Mortgage and debt payments — covered through the recovery period', value: ci.mortgageDebtClearance })
  }
  if (ci.tertiaryFunding > 0) {
    protects.push({ icon: GraduationCap, label: "Their children's education — protected even if income stops", value: ci.tertiaryFunding })
  }
  if (ci.medicalBuffer > 0) {
    protects.push({ icon: Stethoscope, label: 'Medical and alternative treatment costs', value: ci.medicalBuffer })
  }
  if (ci.recoveryBuffer > 0) {
    protects.push({ icon: HeartPulse, label: 'A cushion for the wider cost of recovery', value: ci.recoveryBuffer })
  }

  const inPlace: StoryItem[] = []
  if (ci.assetMitigation > 0) {
    inPlace.push({ icon: Wallet, label: 'Savings, CPF and property equity', value: ci.assetMitigation, accent: 'var(--emerald)' })
  }
  inPlace.push({ icon: ShieldCheck, label: 'Existing critical illness coverage', value: ci.existingCoverage, accent: 'var(--gold)' })

  let headline: ReactNode
  let progressColor = 'var(--gold)'
  let gapLine: ReactNode = null
  let closingLine = ''

  if (!hasNeed) {
    headline = <>No critical illness protection need has been identified for {name} yet.</>
  } else if (isShortfall) {
    headline = (
      <>
        If {name} were diagnosed with a critical illness today, their family would have{' '}
        <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{fmtCompact(have)}</span> ready — about{' '}
        <span style={{ fontWeight: 600 }}>{pct}%</span> of what they would need to replace lost income and cover the cost of recovery.
      </>
    )
    progressColor = 'var(--gold)'
    gapLine = <>A gap of {fmtCompact(ci.shortfall)} remains.</>
    closingLine = `Unlike death, a critical illness leaves ${name} present but unable to provide. Closing this gap means the people around them can focus on recovery — not on making ends meet.`
  } else {
    headline = (
      <>
        If {name} were diagnosed with a critical illness today, their family would have{' '}
        <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>{fmtCompact(have)}</span> ready — more than enough to replace lost
        income and cover the cost of recovery.
      </>
    )
    progressColor = 'var(--emerald)'
    const surplus = have - ci.maxCapitalRequired
    gapLine = surplus > 0 ? <>{fmtCompact(surplus)} more than they would need.</> : <>Exactly what they would need, in place today.</>
    closingLine = `${name}'s family already has enough in place to weather a critical illness without financial disruption.`
  }

  return {
    eyebrow: 'Income protection — critical illness',
    headline, hasNeed, pct, have, need: ci.maxCapitalRequired, progressColor, gapLine, isShortfall,
    protects, inPlace, closingLine, accentColor: isShortfall ? 'var(--gold)' : 'var(--emerald)',
  }
}

function ProtectionSection({ content }: { content: SectionContent }) {
  const { eyebrow, headline, hasNeed, pct, have, need, progressColor, gapLine, isShortfall, protects, inPlace, closingLine, accentColor } = content

  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 14 }}>
        {eyebrow}
      </div>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontSize: 27, lineHeight: 1.5, color: 'var(--ink)', maxWidth: 560, marginBottom: 26 }}>
        {headline}
      </div>

      {hasNeed && (
        <>
          <div style={{ maxWidth: 520, marginBottom: 6 }}>
            <div style={{ height: 6, background: 'var(--cream3)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: progressColor, borderRadius: 4 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{fmtCompact(have)} in place</span>
              <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{fmtCompact(need)} needed</span>
            </div>
          </div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 14, color: isShortfall ? 'var(--rouge)' : 'var(--emerald)', marginBottom: 34 }}>
            {gapLine}
          </div>
        </>
      )}

      {protects.length > 0 && (
        <>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 2 }}>
            What this protects
          </div>
          <div>
            {protects.map((row, i) => (
              <StoryRow key={i} icon={row.icon} label={row.label} value={row.value} />
            ))}
          </div>
        </>
      )}

      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', margin: '28px 0 2px' }}>
        Already in place
      </div>
      <div>
        {inPlace.map((row, i) => (
          <StoryRow key={i} icon={row.icon} label={row.label} value={row.value} accent={row.accent} />
        ))}
      </div>

      {closingLine && (
        <div style={{ marginTop: 32, paddingLeft: 16, borderLeft: `2px solid ${accentColor}`, maxWidth: 520 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 16, color: 'var(--ink2)', lineHeight: 1.6 }}>
            {closingLine}
          </div>
        </div>
      )}
    </div>
  )
}

function PersonStory({ name, profile, page, onAdvance }: { name: string; profile: PersonProtectionProfile; page: Page; onAdvance: (p: Page) => void }) {
  if (page === 'overview') {
    return <OverviewPage name={name} profile={profile} onContinue={() => onAdvance('dtpd')} />
  }
  if (page === 'dtpd') {
    return (
      <div>
        <ProtectionSection content={buildDTPDContent(name, profile.dtpd)} />
        <ContinueLink label="See the critical illness breakdown" onClick={() => onAdvance('ci')} />
      </div>
    )
  }
  return <ProtectionSection content={buildCIContent(name, profile.ci)} />
}

export default function ProtectionDisplay({ snapshot, clientName, spouseName }: {
  snapshot: ProtectionSnapshot
  clientName: string
  spouseName?: string
}) {
  const [active, setActive] = useState<'client' | 'spouse'>('client')
  const [page, setPage] = useState<Page>('overview')
  const hasSpouse = !!snapshot.spouse
  const spouseLabel = spouseName || 'Spouse'

  const selectPerson = (p: 'client' | 'spouse') => {
    setActive(p)
    setPage('overview')
  }

  return (
    <div>
      {hasSpouse && (
        <div style={{ display: 'inline-flex', background: 'var(--cream2)', borderRadius: 999, padding: 3, marginBottom: 28 }}>
          <button
            onClick={() => selectPerson('client')}
            style={{
              border: 'none', cursor: 'pointer', borderRadius: 999, padding: '8px 18px',
              fontSize: 13, fontWeight: 500, fontFamily: 'Inter, sans-serif',
              background: active === 'client' ? '#fff' : 'transparent',
              color: active === 'client' ? 'var(--ink)' : 'var(--ink3)',
            }}
          >
            {clientName}
          </button>
          <button
            onClick={() => selectPerson('spouse')}
            style={{
              border: 'none', cursor: 'pointer', borderRadius: 999, padding: '8px 18px',
              fontSize: 13, fontWeight: 500, fontFamily: 'Inter, sans-serif',
              background: active === 'spouse' ? '#fff' : 'transparent',
              color: active === 'spouse' ? 'var(--ink)' : 'var(--ink3)',
            }}
          >
            {spouseLabel}
          </button>
        </div>
      )}

      <PageNav page={page} setPage={setPage} />

      {active === 'client' && <PersonStory name={clientName} profile={snapshot.client} page={page} onAdvance={setPage} />}
      {active === 'spouse' && snapshot.spouse && <PersonStory name={spouseLabel} profile={snapshot.spouse} page={page} onAdvance={setPage} />}
    </div>
  )
}
