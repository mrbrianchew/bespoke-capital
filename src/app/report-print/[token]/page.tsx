import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { verifyReportPrintToken } from '@/lib/reportPrintToken'
import { buildOverviewSnapshot } from '@/lib/financialPlanSnapshot'
import { buildExecutiveWealthSummarySnapshot } from '@/lib/executiveWealthSummarySnapshot'
import { buildProtectionSnapshot, PersonProtectionProfile, PersonProtectionBreakdown, PersonCIBreakdown, CoverageTimeline } from '@/lib/protectionSnapshot'

// Print-only render target for the PDF export pipeline (see
// /api/report/export-pdf/route.ts, which mints the token and drives
// Puppeteer against this page). Never linked from the advisor UI and never
// meant to be visited by a real browser session — the signed, 5-minute
// token is the only way in, verified server-side below.
//
// This is a server component: no 'use client', no useEffect data-fetching.
// It fetches everything it needs before rendering, using the service-role
// key (Puppeteer carries no Supabase Auth session/cookies to forward), the
// same pattern /api/statement/[token]/route.ts already uses for its
// unauthenticated public route.
//
// INCREMENT 3: Cover + Overview + Wealth Summary. Protection, Capital Fund,
// and Action Plan pages are built in the same @media print / break-after:page
// structure but not wired into this route yet — see the mockup
// (page5-protection-breakdown.html) for the approved design of each.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })
}

function fmt(n: number): string {
  if (!n || isNaN(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-SG')
}

// Same category → color mapping as OverviewDisplay's donut (EXPENSE_COLORS),
// re-expressed as static SVG stroke segments here since Puppeteer renders
// this route with no client JS / Chart.js available.
const DONUT_COLORS = ['#1A1A18', '#7A3B34', '#9C9A94', '#B0AEA8', '#D8D5CA', '#C9A876', '#E4C9A0', '#F0DFC0']
const DONUT_CIRCUMFERENCE = 283 // 2 * PI * r45, matches the approved mockup's rounding

const INVERTED_BENCHMARK_CATEGORIES = ['Savings / Investments'] // more than benchmark is good here, unlike expense categories

function comparisonClass(label: string, actualPct: number, benchmarkPct: number): 'over' | 'under' | '' {
  if (actualPct === benchmarkPct) return ''
  const isInverted = INVERTED_BENCHMARK_CATEGORIES.includes(label)
  const isOver = actualPct > benchmarkPct
  if (isInverted) return isOver ? 'under' : 'over' // note: css classes are named for direction of concern (over=bad/accent, under=good/green), so an inverted category flips which class means "bad"
  return isOver ? 'over' : 'under'
}

// ─── Protection pages (4-9) helpers ─────────────────────────────────────────
// Design source: page5-protection-breakdown.html. The mockup's own coverage-
// timeline SVG is a hand-drawn placeholder (single curve, no have/shortfall
// shading) despite its legend promising all three — protectionSnapshot.ts
// already computes the real age-by-age need/have series (buildDTPDTimeline/
// buildCITimeline), so renderCoverageTimelineSvg below ports the LIVE
// ProtectionDisplay.tsx chart's geometry (CoverageTimelineChart) instead of
// the mockup's placeholder — same shortfall-shaded-region + have-bar visual
// language already used and approved elsewhere in the app, just static
// (no hover tooltips — this is a PDF, not an interactive page).

function fmtCompact(n: number): string {
  if (!n || isNaN(n)) return '$0'
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M'
  if (n >= 1000) return '$' + Math.round(n / 1000) + 'K'
  return fmt(n)
}

function protectionMilestoneEmoji(type: 'education' | 'mortgage' | 'retirement'): string {
  if (type === 'education') return '\u{1F393}' // 🎓
  if (type === 'mortgage') return '\u{1F511}' // 🔑
  return '\u{1F3D6}' // 🏖
}

// Static port of ProtectionDisplay.tsx's CoverageTimelineChart — same
// geometry constants, same shortfall-region path-building algorithm, same
// have-bars + need-line + milestone-marker rendering. Hover tooltips are
// dropped (no interactivity in a PDF); everything else is unchanged so the
// print chart matches the live tab's visual language exactly.
function renderCoverageTimelineSvg(timeline: CoverageTimeline, name: string, currentAge: number) {
  const { points, milestones } = timeline
  if (points.length === 0) return null

  const W = 900, H = 280, PL = 60, PR = 30, PT = 20, PB = 40
  const iW = W - PL - PR, iH = H - PT - PB
  const minA = points[0].age
  const maxA = points[points.length - 1].age
  const aRange = (maxA - minA) || 1
  const maxV = Math.max(...points.map(d => Math.max(d.need, d.have)), 100000)

  const xP = (age: number) => PL + ((age - minA) / aRange) * iW
  const yP = (v: number) => PT + iH - Math.min(1, v / maxV) * iH
  const fmtY = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`)
  const ticks = [0, 0.25, 0.5, 0.75, 1]

  const needPath = points.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xP(d.age).toFixed(1)} ${yP(d.need).toFixed(1)}`).join(' ')

  const shortfallSegs: string[] = []
  let segStart = -1
  for (let i = 0; i < points.length; i++) {
    const isShort = points[i].need > points[i].have
    if (isShort && segStart === -1) {
      segStart = i
    } else if (!isShort && segStart !== -1) {
      const seg = points.slice(segStart, i)
      const top = seg.map(d => `${xP(d.age).toFixed(1)},${yP(d.need).toFixed(1)}`)
      const bot = [...seg].reverse().map(d => `${xP(d.age).toFixed(1)},${yP(d.have).toFixed(1)}`)
      shortfallSegs.push(`M ${top.join(' L ')} L ${bot.join(' L ')} Z`)
      segStart = -1
    }
  }
  if (segStart !== -1) {
    const seg = points.slice(segStart)
    const top = seg.map(d => `${xP(d.age).toFixed(1)},${yP(d.need).toFixed(1)}`)
    const bot = [...seg].reverse().map(d => `${xP(d.age).toFixed(1)},${yP(d.have).toFixed(1)}`)
    shortfallSegs.push(`M ${top.join(' L ')} L ${bot.join(' L ')} Z`)
  }

  const barW = Math.max(2, (iW / points.length) * 0.7)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="42mm" style={{ display: 'block', overflow: 'visible' }}>
      {ticks.map(f => {
        const y = PT + iH - f * iH
        return (
          <g key={f}>
            <line x1={PL} y1={y} x2={PL + iW} y2={y} stroke="#EDEAE0" strokeWidth="1" />
            {f > 0 && <text x={PL - 8} y={y + 3.5} fontSize="14" fill="#9C9A94" textAnchor="end">{fmtY(maxV * f)}</text>}
          </g>
        )
      })}

      {shortfallSegs.map((d, i) => <path key={`sf-${i}`} d={d} fill="#F3E2DF" stroke="none" />)}

      {points.map(d => {
        if (d.have <= 0) return null
        const hy = yP(d.have)
        return (
          <rect key={`bar-${d.age}`} x={xP(d.age) - barW / 2} y={hy} width={barW} height={Math.max(1, PT + iH - hy)} fill="#B08D57" opacity="0.32" rx="1" />
        )
      })}

      <path d={needPath} stroke="#B08D57" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {milestones.map((m, i) => {
        const mx = xP(m.age)
        if (mx < PL || mx > PL + iW) return null
        const color = m.type === 'education' ? '#3F6B57' : m.type === 'mortgage' ? '#8A6D3F' : '#5C5A54'
        return (
          <g key={`ms-${i}`}>
            <line x1={mx} y1={PT} x2={mx} y2={PT + iH} stroke={color} strokeWidth="1" strokeDasharray="3,5" opacity="0.4" />
            <text x={mx} y={PT + 2} fontSize="16" textAnchor="middle">{protectionMilestoneEmoji(m.type)}</text>
          </g>
        )
      })}

      <line x1={PL} y1={PT + iH} x2={PL + iW} y2={PT + iH} stroke="#D8D5CA" strokeWidth="1" />

      {points.filter(d => d.age % 5 === 0 || d.age === currentAge || d.age === 100).map(d => (
        <text key={d.age} x={xP(d.age)} y={PT + iH + 20} fontSize="14" fill="#5C5A54" textAnchor="middle">{d.age}</text>
      ))}
    </svg>
  )
}

// Same second-person, dynamic subtitle text as ProtectionDisplay.tsx's
// buildDTPDSubtitle — ported verbatim so the print narrative matches the
// live tab's wording exactly.
function protectionDTPDNarrative(dtpd: PersonProtectionBreakdown) {
  const have = dtpd.assetMitigation + dtpd.existingCoverage
  if (dtpd.maxCapitalRequired <= 0) return 'No death & TPD protection need has been identified for you yet.'
  if (dtpd.status === 'shortfall') {
    const pct = dtpd.maxCapitalRequired > 0 ? Math.round((have / dtpd.maxCapitalRequired) * 100) : 100
    return <>If something were to happen to you today, your family would have <b>{fmtCompact(have)}</b> ready — about <b className="pct">{pct}%</b> of what they would need to clear debts and carry on without you.</>
  }
  return <>If something were to happen to you today, your family would have <b>{fmtCompact(have)}</b> ready — more than enough to clear debts and carry on without you.</>
}

function protectionCINarrative(ci: PersonCIBreakdown) {
  const have = ci.assetMitigation + ci.existingCoverage
  if (ci.maxCapitalRequired <= 0) return 'No critical illness protection need has been identified for you yet.'
  if (ci.status === 'shortfall') {
    const pct = ci.maxCapitalRequired > 0 ? Math.round((have / ci.maxCapitalRequired) * 100) : 100
    return <>If you were diagnosed with a critical illness today, you and your family would have <b>{fmtCompact(have)}</b> ready — about <b className="pct">{pct}%</b> of what you'd need to cover treatment, replace lost income, and keep the household running through recovery.</>
  }
  return <>If you were diagnosed with a critical illness today, you and your family would have <b>{fmtCompact(have)}</b> ready — more than enough to replace lost income and cover the cost of recovery.</>
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[0] + ' and ' + parts[1]
  return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1]
}

// Verbatim ports of ProtectionDisplay.tsx's buildDTPDClosingLine/buildCIClosingLine,
// returning JSX (with the client's name bolded) instead of a plain string so the
// caller never needs dangerouslySetInnerHTML to style it.
function protectionDTPDClosing(name: string, dtpd: PersonProtectionBreakdown) {
  if (dtpd.maxCapitalRequired <= 0) return null
  if (dtpd.status === 'covered') return <><b>{name}</b>&rsquo;s family already has full protection in place — with room to spare.</>
  const parts: string[] = ['keep their lifestyle']
  if (dtpd.mortgageDebtClearance > 0) parts.push('stay in their home')
  if (dtpd.tertiaryFunding > 0) parts.push('see the children through school')
  return <>Closing this gap means <b>{name}</b>&rsquo;s family can {joinWithAnd(parts)} — whatever happens. Without it, the people <b>{name}</b> cares about most could face difficult choices at the hardest possible moment.</>
}

function protectionCIClosing(name: string, ci: PersonCIBreakdown) {
  if (ci.maxCapitalRequired <= 0) return null
  if (ci.status === 'covered') return <><b>{name}</b>&rsquo;s family already has enough in place to weather a critical illness without financial disruption.</>
  return <>Unlike death, a critical illness leaves <b>{name}</b> present but unable to provide. Closing this gap means the people around them can focus on recovery — not on making ends meet.</>
}

// One segmented runway bar row (Family's full need / Chosen coverage target /
// Currently in place) — ports FamilyRunwayChart's SegmentedRow, given segment
// values already computed by the caller and a shared axisMax (= runway.fullNeed)
// so all three rows stay proportionally comparable.
function RunwayRow({ label, amount, amountClass, segments, axisMax, shortLabel }: {
  label: string
  amount: number
  amountClass?: string
  segments: { value: number; cls: string }[]
  axisMax: number
  shortLabel?: string
}) {
  return (
    <div className="runway-row">
      <div className="rh"><span className="l">{label}</span><span className={`v ${amountClass || ''}`}>{fmtCompact(amount)}</span></div>
      <div className="runway-bar">
        {segments.filter(s => s.value > 0).map((s, i) => (
          <div key={i} className={`seg ${s.cls}`} style={{ width: `${axisMax > 0 ? (s.value / axisMax) * 100 : 0}%` }} />
        ))}
        {axisMax > amount && <div className="seg gap" style={{ width: `${axisMax > 0 ? ((axisMax - amount) / axisMax) * 100 : 0}%` }} />}
      </div>
      {shortLabel && <div className="runway-short">{shortLabel}</div>}
    </div>
  )
}

function ProtectionOverviewPage({ name, profile, pageLabel }: { name: string; profile: PersonProtectionProfile; pageLabel: string }) {
  const { dtpd, ci, framework, lifePolicies, runway } = profile
  const axisMax = runway.fullNeed
  const currentShortfall = Math.max(0, runway.fullNeed - runway.currentProvision)
  const currentLabel = runway.assetOffsetEnabled ? 'Currently in place (insurance + assets)' : 'Currently in place (insurance only)'
  const axisTicks = [0, axisMax * 0.25, axisMax * 0.5, axisMax * 0.75, axisMax]

  function StatCol({ label, breakdown }: { label: string; breakdown: { maxCapitalRequired: number; shortfall: number; status: string } }) {
    const hasNeed = breakdown.maxCapitalRequired > 0
    const isShortfall = breakdown.status === 'shortfall'
    return (
      <div className="po-stat">
        <div className="sl"><span className="dot" style={{ background: !hasNeed ? '#9C9A94' : isShortfall ? 'var(--accent)' : '#3F6B57' }} />{label}</div>
        <div className="sv" style={{ color: !hasNeed ? '#9C9A94' : isShortfall ? 'var(--accent)' : '#3F6B57' }}>
          {!hasNeed ? '—' : isShortfall ? fmtCompact(breakdown.shortfall) : 'Covered'}
        </div>
        <div className="sc">{!hasNeed ? 'not yet assessed' : isShortfall ? 'capital shortfall' : 'fully in place'}</div>
        <div className="rule" style={{ background: !hasNeed ? '#9C9A94' : isShortfall ? 'var(--accent)' : '#3F6B57' }} />
      </div>
    )
  }

  const totalDeath = lifePolicies.reduce((s, p) => s + (p.isUSD ? p.deathSA * p.fxRate : p.deathSA), 0)
  const totalTpd = lifePolicies.reduce((s, p) => s + (p.isUSD ? p.tpdSA * p.fxRate : p.tpdSA), 0)
  const totalCi = lifePolicies.reduce((s, p) => s + (p.isUSD ? p.ciSA * p.fxRate : p.ciSA), 0)
  const totalEci = lifePolicies.reduce((s, p) => s + (p.isUSD ? p.eciSA * p.fxRate : p.eciSA), 0)

  return (
    <div className="page">
      <div className="po-eyebrow">Protection Overview</div>
      <div className="po-headline">Here&rsquo;s where {name}&rsquo;s protection stands today.</div>

      <div className="po-stats">
        <StatCol label="Death &amp; TPD" breakdown={dtpd} />
        <StatCol label="Critical Illness" breakdown={ci} />
      </div>

      <div className="runway-head">Family Financial Runway</div>
      <div className="runway-desc">What {name}&rsquo;s family would need to maintain their current lifestyle, clear debts, and fund education — against what&rsquo;s targeted and what&rsquo;s currently in place.</div>
      <div className="runway-legend">
        <span><span className="sw dep" />Family dependency</span>
        <span><span className="sw mort" />Mortgage &amp; debt</span>
        <span><span className="sw edu" />Education</span>
      </div>

      <RunwayRow
        label="Family's full need (100%)"
        amount={runway.fullNeed}
        segments={[{ value: runway.fullNeedFD, cls: 'dep' }, { value: runway.fullNeedMort, cls: 'mort' }, { value: runway.fullNeedEdu, cls: 'edu' }]}
        axisMax={axisMax}
      />
      <RunwayRow
        label="Chosen coverage target"
        amount={runway.targetNeed}
        segments={[{ value: runway.targetFD, cls: 'dep' }, { value: runway.targetMort, cls: 'mort' }, { value: runway.targetEdu, cls: 'edu' }]}
        axisMax={axisMax}
      />
      <RunwayRow
        label={currentLabel}
        amount={runway.currentProvision}
        amountClass={runway.currentProvision >= runway.targetNeed && runway.targetNeed > 0 ? '' : 'accent-v'}
        segments={[{ value: runway.currentInsurance, cls: 'ins' }, { value: runway.currentAssets, cls: 'assets' }]}
        axisMax={axisMax}
        shortLabel={currentShortfall > 0 ? `~${fmtCompact(currentShortfall)} short of full family need` : undefined}
      />
      <div className="runway-legend" style={{ marginTop: '-2mm' }}>
        <span><span className="sw ins" />Insurance</span>
        <span><span className="sw assets" />Assets</span>
      </div>
      <div className="runway-axis">{axisTicks.map((t, i) => <span key={i}>{fmtCompact(t)}</span>)}</div>

      <div className="po-fw-h" style={{ marginTop: '2mm' }}>Protection Framework</div>
      {([
        { key: 'medical', label: 'Medical & health protection', covered: framework.medicalCovered },
        { key: 'ci', label: 'Income protection — critical illness', covered: ci.status === 'covered' },
        { key: 'dtpd', label: 'Capital protection — death & TPD', covered: dtpd.status === 'covered' },
        { key: 'accident', label: 'Personal accident', covered: framework.accidentCovered },
      ] as const).map(row => (
        <div className="po-fw-row" key={row.key}>
          <div className={`po-fw-icon ${row.covered ? 'covered' : 'needs'}`}>{row.covered ? '✓' : '!'}</div>
          <div className="po-fw-label">{row.label}</div>
          <div className={`po-fw-status ${row.covered ? 'covered' : 'needs'}`}>{row.covered ? 'Covered' : 'Needs attention'}</div>
          <div className="po-fw-tag">system default</div>
        </div>
      ))}

      <div className="seclabel" style={{ marginTop: '3mm' }}>Existing Life Insurance Portfolio</div>
      {lifePolicies.length > 0 ? (
        <>
          <div className="pol-cards">
            <div className="pol-card"><div className="l">Death</div><div className={`v ${totalDeath === 0 ? 'zero' : ''}`}>{totalDeath > 0 ? fmtCompact(totalDeath) : '—'}</div></div>
            <div className="pol-card"><div className="l">TPD</div><div className={`v ${totalTpd === 0 ? 'zero' : ''}`}>{totalTpd > 0 ? fmtCompact(totalTpd) : '—'}</div></div>
            <div className="pol-card"><div className="l">Critical Illness</div><div className={`v ${totalCi === 0 ? 'zero' : ''}`}>{totalCi > 0 ? fmtCompact(totalCi) : '—'}</div></div>
            <div className="pol-card"><div className="l">Early CI</div><div className={`v ${totalEci === 0 ? 'zero' : ''}`}>{totalEci > 0 ? fmtCompact(totalEci) : '—'}</div></div>
          </div>
          <div className="pol-note">
            {lifePolicies.length} {lifePolicies.length === 1 ? 'policy' : 'policies'} in force &middot; {lifePolicies.map(p => `${p.companyName} ${p.productName}`.trim()).join(', ')}
          </div>
        </>
      ) : (
        <div className="pol-note">No life insurance policies on record.</div>
      )}

      <div className="ftr"><span>Bespoke Capital — Confidential</span><span>{pageLabel}</span></div>
    </div>
  )
}

function ProtectionBreakdownPage({ type, name, profile, pageLabel }: {
  type: 'dtpd' | 'ci'
  name: string
  profile: PersonProtectionProfile
  pageLabel: string
}) {
  const isDtpd = type === 'dtpd'
  const dtpd = profile.dtpd
  const ci = profile.ci
  const timeline = isDtpd ? profile.dtpdTimeline : profile.ciTimeline
  const currentAge = timeline.points.length > 0 ? timeline.points[0].age : null
  const eyebrow = isDtpd ? 'Capital Protection — Death & TPD' : 'Income & Capital Protection — Critical Illness'
  const headline = isDtpd ? 'Death & TPD' : 'Critical Illness'
  const narrative = isDtpd ? protectionDTPDNarrative(dtpd) : protectionCINarrative(ci)
  const closing = isDtpd ? protectionDTPDClosing(name, dtpd) : protectionCIClosing(name, ci)
  const maxCapitalRequired = isDtpd ? dtpd.maxCapitalRequired : ci.maxCapitalRequired
  const have = isDtpd ? dtpd.assetMitigation + dtpd.existingCoverage : ci.assetMitigation + ci.existingCoverage
  const shortfall = isDtpd ? dtpd.shortfall : ci.shortfall
  const status = isDtpd ? dtpd.status : ci.status
  const havePct = maxCapitalRequired > 0 ? Math.min(100, (have / maxCapitalRequired) * 100) : 100

  // Needs card rows differ by type (DTPD: family/mortgage/education; CI: income
  // replacement/mortgage/education/medical/recovery) — mirrors NeedsCard/CINeedsCard.
  const needsRows: { icon: JSX.Element; label: string; value: number }[] = isDtpd
    ? [
        { icon: <><circle cx="12" cy="12" r="9" /><path d="M9 12h6M12 9v6" /></>, label: 'Their day-to-day life — keeping the household running', value: dtpd.familyDependency },
        ...(dtpd.mortgageDebtClearance > 0 ? [{ icon: <path d="M4 11l8-6 8 6M6 10v9h12v-9" />, label: 'The roof over their heads — mortgage and debts cleared', value: dtpd.mortgageDebtClearance }] : []),
        ...(dtpd.tertiaryFunding > 0 ? [{ icon: <path d="M2 9l10-4 10 4-10 4-10-4zM6 11v4c0 1.5 3 3 6 3s6-1.5 6-3v-4" />, label: 'Their children’s future — university funded', value: dtpd.tertiaryFunding }] : []),
      ]
    : [
        { icon: <><circle cx="12" cy="12" r="9" /><path d="M9 12h6M12 9v6" /></>, label: `Income replacement — ${ci.ciYears * 12} months while you recover`, value: ci.familyDependency },
        ...(ci.mortgageDebtClearance > 0 ? [{ icon: <path d="M4 11l8-6 8 6M6 10v9h12v-9" />, label: 'Mortgage covered through the recovery period', value: ci.mortgageDebtClearance }] : []),
        ...(ci.tertiaryFunding > 0 ? [{ icon: <path d="M2 9l10-4 10 4-10 4-10-4zM6 11v4c0 1.5 3 3 6 3s6-1.5 6-3v-4" />, label: 'Children’s education stays funded regardless', value: ci.tertiaryFunding }] : []),
        ...(ci.medicalBuffer > 0 ? [{ icon: <path d="M12 3v18M3 12h18" />, label: 'Medical and alternative treatment costs', value: ci.medicalBuffer }] : []),
        ...(ci.recoveryBuffer > 0 ? [{ icon: <path d="M4 4h16v16H4zM8 4v16M16 4v16" />, label: 'A cushion for the wider cost of recovery', value: ci.recoveryBuffer }] : []),
      ]

  // Have card rows: DTPD splits assets into cash/property (reconciled against
  // assetMitigation, mirrors HaveCard's propertyEquity/cashSavings split); CI
  // has only one combined liquid-assets row (mirrors CIHaveCard).
  const propertyRaw = isDtpd ? dtpd.assetMitigationProperty : 0
  const propertyEquity = isDtpd ? Math.min(propertyRaw, dtpd.assetMitigation) : 0
  const cashSavings = isDtpd ? Math.max(0, dtpd.assetMitigation - propertyEquity) : ci.assetMitigation

  return (
    <div className="page">
      <div className="cp-eyebrow">{eyebrow}</div>
      <div className="cp-headline">{headline}: <i>{name}</i></div>
      <div className="cp-narrative">{narrative}</div>

      <div className="cp-body">
      <div className="cp-cards">
        <div className="cp-card">
          <div className="cp-card-title">Protection Objectives (Needs)</div>
          {needsRows.map((row, i) => (
            <div className="cp-row" key={i}>
              <div className="cp-icon"><svg viewBox="0 0 24 24">{row.icon}</svg></div>
              <div className="cp-row-label">{row.label}</div>
              <div className="cp-row-value">{fmtCompact(row.value)}</div>
            </div>
          ))}
          <div className="cp-card-total"><div className="l">Max capital required</div><div className="v">{fmt(maxCapitalRequired)}</div></div>
        </div>

        <div className="cp-card">
          <div className="cp-card-title">Existing Infrastructure (Have)</div>
          {isDtpd ? (
            <>
              <div className="cp-row"><div className="cp-icon have"><svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="12" rx="1" /><path d="M3 12h18M7 8V6a2 2 0 012-2h6a2 2 0 012 2v2" /></svg></div><div className="cp-row-label">Savings &amp; CPF</div><div className="cp-row-value">{fmtCompact(cashSavings)}</div></div>
              <div className="cp-row"><div className="cp-icon have"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="16" /><rect x="13" y="9" width="7" height="11" /></svg></div><div className="cp-row-label">Property equity</div><div className="cp-row-value">{fmtCompact(propertyEquity)}</div></div>
            </>
          ) : (
            <div className="cp-row"><div className="cp-icon have"><svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="12" rx="1" /><path d="M3 12h18M7 8V6a2 2 0 012-2h6a2 2 0 012 2v2" /></svg></div><div className="cp-row-label">Savings &amp; liquid assets</div><div className="cp-row-value">{fmtCompact(cashSavings)}</div></div>
          )}
          <div className="cp-row"><div className="cp-icon have"><svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" /></svg></div><div className="cp-row-label">Existing {isDtpd ? '' : 'CI '}insurance coverage</div><div className="cp-row-value">{fmtCompact(isDtpd ? dtpd.existingCoverage : ci.existingCoverage)}</div></div>
          <div className="cp-card-total"><div className="l">Total</div><div className="v">{fmt(have)}</div></div>
          <div className="cp-card-status"><div className="l">Status</div><div className="v">{status === 'shortfall' ? 'Shortfall' : 'Covered'}</div></div>
        </div>
      </div>

      {currentAge !== null && (
        <div className="cp-timeline">
          <div className="cp-tl-label">Coverage Timeline</div>
          <div className="cp-tl-sub">How the {isDtpd ? 'capital need' : 'CI capital need'} and existing portfolio evolve as {name} ages.</div>
          <div className="cp-tl-meta">
            <span>{name} &middot; Age {currentAge} to 100</span>
            <span className="cp-tl-legend"><span><span className="sw need" />Capital needed</span><span><span className="sw have" />Existing portfolio</span><span><span className="sw gap" />Shortfall</span></span>
          </div>
          {renderCoverageTimelineSvg(timeline, name, currentAge)}
        </div>
      )}

      <div className="cp-analysis">
        <div className="cp-an-label">Coverage Analysis</div>
        <div className="cp-an-row"><span>Total protection in place — {fmt(have)}</span><span className="r">{shortfall > 0 ? `Shortfall — ${fmt(shortfall)}` : 'Fully funded'}</span></div>
        <div className="cp-bar">
          <div className="have" style={{ width: `${havePct}%` }}>{fmt(have)}</div>
          {shortfall > 0 && <div className="gap" style={{ width: `${100 - havePct}%` }}>{fmt(shortfall)}</div>}
        </div>
      </div>

      {closing && (
        <div className="cp-insight">
          <p>{closing}</p>
        </div>
      )}
      </div>

      <div className="ftr"><span>Bespoke Capital — Confidential</span><span>{pageLabel}</span></div>
    </div>
  )
}

export default async function ReportPrintPage({ params }: { params: { token: string } }) {
  const payload = verifyReportPrintToken(params.token)
  if (!payload) notFound()

  const [{ data: client }, { data: family }, { data: advisor }, { data: ffRows }] = await Promise.all([
    supabaseAdmin.from('clients').select('id, name, dob').eq('id', payload.clientId).maybeSingle(),
    supabaseAdmin.from('family_members').select('id, name, relationship, dob, gender').eq('client_id', payload.clientId),
    supabaseAdmin.from('advisors').select('name').eq('id', payload.advisorId).maybeSingle(),
    supabaseAdmin.from('fact_finding').select('section, data').eq('client_id', payload.clientId).in('section', ['financials', 'protection_needs', 'protection_portfolio', 'retirement']),
  ])
  if (!client) notFound()

  const spouseName = (family || []).find(f => f.relationship === 'Spouse')?.name || null
  const advisorName = advisor?.name || 'Bespoke Capital'
  const datePrepared = formatDate(new Date())

  const financialsData = (ffRows || []).find(r => r.section === 'financials')?.data || {}
  const overview = buildOverviewSnapshot({
    client: { name: client.name, dob: client.dob || '' },
    familyMembers: (family || []).map(f => ({ name: f.name, relationship: f.relationship, dob: f.dob || undefined })),
    fin: financialsData,
  })

  const expenseTotal = overview.expenseBreakdown.reduce((s, d) => s + d.value, 0)
  let donutCumulative = 0
  const donutSegments = overview.expenseBreakdown.map((d, i) => {
    const len = expenseTotal > 0 ? (d.value / expenseTotal) * DONUT_CIRCUMFERENCE : 0
    const seg = { color: DONUT_COLORS[i % DONUT_COLORS.length], dasharray: `${len} ${DONUT_CIRCUMFERENCE}`, dashoffset: -donutCumulative }
    donutCumulative += len
    return seg
  })
  const hasBenchmark = overview.expenseBenchmark.length > 0

  const wealthSummary = buildExecutiveWealthSummarySnapshot({
    client: { name: client.name, dob: client.dob || '' },
    familyMembers: (family || []).map(f => ({ name: f.name, relationship: f.relationship, dob: f.dob || undefined })),
    fin: financialsData,
  })
  const wealthSummaryYear = new Date(wealthSummary.generatedAt).getFullYear()

  // Mirrors report/page.tsx's load() exactly: protection_portfolio's policies
  // live nested under risk_management, not the separate insurance_policies
  // SQL table; retirement age/life expectancy live on a separate 'retirement'
  // fact_finding section, merged onto a protection-specific ff object here so
  // the coverage timeline's retirement milestone and CI-floor calc have what
  // they need without touching financialsData (used by Overview/Wealth Summary).
  const merged: Record<string, any> = {}
  for (const row of ffRows || []) merged[row.section] = row.data || {}
  const policies = merged['protection_portfolio']?.risk_management?.policies || []
  const spouseMember = (family || []).find(f => f.relationship === 'Spouse') || null
  const isCouple = !!spouseMember
  const childrenMembers = (family || []).filter(f => ['Son', 'Daughter', 'Child'].includes(f.relationship))
  const retData = (merged['retirement'] as any)?.ret || merged['retirement'] || {}
  const protectionFf = {
    ...financialsData,
    client: { ...(financialsData.client || {}), retirementAge: retData?.client?.retirementAge, lifeExpectancy: retData?.client?.lifeExpectancy },
    spouse: { ...(financialsData.spouse || {}), retirementAge: retData?.spouse?.retirementAge, lifeExpectancy: retData?.spouse?.lifeExpectancy },
  }
  const protection = buildProtectionSnapshot({
    ff: protectionFf,
    protection: merged['protection_needs']?.protection || {},
    policies,
    children: childrenMembers.map(c => ({ id: c.id, name: c.name, dob: c.dob || undefined, gender: c.gender || undefined })),
    isCouple,
    clientDob: client.dob || '',
    spouseDob: spouseMember?.dob || '',
  })

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <title>Financial Report — {client.name}</title>
        <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      </head>
      <body>
        <div className="page-wrap">
          {/* ============ COVER ============ */}
          <div className="page">
            <div className="cover">
              <div className="cover-top">
                <div className="cover-eyebrow">Bespoke Capital</div>
                <div className="cover-eyebrow">Private and Confidential</div>
              </div>
              <div className="cover-body">
                <div className="cover-label">Financial Planning Report — Prepared For</div>
                <div className="cover-name">
                  {client.name}
                  {spouseName && (
                    <>
                      <br />
                      &amp; {spouseName}
                    </>
                  )}
                </div>
                <div className="cover-rule" />
              </div>
            </div>
            <div className="ftr">
              <div className="m">
                <div className="l">Date Prepared</div>
                <div className="v">{datePrepared}</div>
              </div>
              <div className="m" style={{ textAlign: 'right' }}>
                <div className="l">Specially Prepared</div>
                <div className="v">{advisorName}</div>
              </div>
            </div>
          </div>

          {/* ============ OVERVIEW ============ */}
          <div className="page">
            <div className="hdr">
              <div className="tablabel">Financial Planning Report · Overview</div>
              <div className="titlerow">
                <div className="client">{client.name}{spouseName && <> &amp; {spouseName}</>}</div>
                <div className="date">{datePrepared}</div>
              </div>
            </div>

            <div className="ov-body">
              <div className="card-kpi-row">
                <div className="card-kpi"><div className="l">Net Worth</div><div className="v">{fmt(overview.netWorth)}</div><div className="s">Liquid &amp; equity</div></div>
                <div className="card-kpi"><div className="l">Annual Inflow</div><div className="v">{fmt(overview.annualInflow)}</div><div className="s">Gross income</div></div>
                <div className="card-kpi"><div className="l">Annual Surplus</div><div className="v">{fmt(overview.annualSurplus)}</div><div className="s">Take-home minus expenses</div></div>
              </div>

              <div>
                <div className="seclabel" style={{ marginTop: 0 }}>Asset Composition &amp; Liabilities</div>
                <div className="al-card">
                  <div className="al-col">
                    <div className="al-h">Asset Composition</div>
                    {overview.assetBreakdown.map(a => (
                      <div className="al-row" key={a.label}><span className="lbl">{a.label}</span><span className="amt">{fmt(a.value)}</span></div>
                    ))}
                  </div>
                  <div className="al-col">
                    <div className="al-h">Liabilities</div>
                    {overview.liabilities.map(l => (
                      <div className="al-row" key={l.label}><span className="lbl">{l.label}</span><span className="amt">{fmt(l.value)}</span></div>
                    ))}
                  </div>
                </div>
                <div className="nw-bar"><div className="l">Net Worth</div><div className="v">{fmt(overview.netWorth)}</div></div>
              </div>

              <div>
                <div className="seclabel" style={{ marginTop: 0 }}>Annual Cashflow</div>
                <div className="cashflow-wrap">
                  <div className="cf-list">
                    {hasBenchmark
                      ? overview.expenseBenchmark.map(d => (
                          <div className="cf-row" key={d.label}>
                            <span className="lbl">{d.label}</span>
                            <span className="amt">{fmt(d.actualValue)}</span>
                            <span className={`pct ${comparisonClass(d.label, d.actualPct, d.benchmarkPct)}`}>
                              {d.actualPct}%<span className="vs"> vs {d.benchmarkPct}%</span>
                            </span>
                          </div>
                        ))
                      : overview.expenseBreakdown.map(d => (
                          <div className="cf-row" key={d.label}>
                            <span className="lbl">{d.label}</span>
                            <span className="amt">{fmt(d.value)}</span>
                            <span className="pct">{expenseTotal > 0 ? Math.round((d.value / expenseTotal) * 100) : 0}%</span>
                          </div>
                        ))}
                  </div>
                  <div className="cf-donut-wrap">
                    <svg viewBox="0 0 120 120" width="150" height="150" style={{ display: 'block' }}>
                      {donutSegments.map((seg, i) => (
                        <circle key={i} cx="60" cy="60" r="45" fill="none" stroke={seg.color} strokeWidth="18" strokeDasharray={seg.dasharray} strokeDashoffset={seg.dashoffset} transform="rotate(-90 60 60)" />
                      ))}
                      <text x="60" y="57" textAnchor="middle" fontFamily="Fraunces, serif" fontWeight="600" fontSize="14" fill="#1A1A18">{fmt(expenseTotal)}</text>
                      <text x="60" y="68" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="400" fontSize="5.5" letterSpacing="0.5" fill="#9C9A94">ANNUAL OUTFLOW</text>
                    </svg>
                    <div className="cf-legend">
                      {overview.expenseBreakdown.map((d, i) => (
                        <div className="li2" key={d.label}>
                          <span className="sw2" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                          {d.label} {expenseTotal > 0 ? Math.round((d.value / expenseTotal) * 100) : 0}%
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="ftr"><span>Bespoke Capital — Confidential</span><span>Page 2 of 17</span></div>
          </div>

          {/* ============ WEALTH SUMMARY ============ */}
          <div className="page">
            <div className="ews-title">Executive Wealth Summary</div>
            <div className="ews-sub">
              A consolidated view of {client.name}{spouseName && <> &amp; {spouseName}</>}&rsquo;s assets, liabilities and annual cashflow as at {wealthSummaryYear}.
            </div>

            <div className="ews-body">
            <div className="ews-nw-box">
              <div className="l">Total Consolidated Net Worth</div>
              <div className="v">{fmt(wealthSummary.netWorth)}</div>
              <div className="rule" />
              <div className="cap">{wealthSummary.takeaway}</div>
            </div>

            <div className="ews-cols">
              <div>
                <div className="ews-h">Consolidated Assets</div>
                {wealthSummary.assetBreakdown.map(a => (
                  <div className="ews-row" key={a.label}>
                    <span className="lbl">{a.label}{a.sublabel && <span className="sub">{a.sublabel}</span>}</span>
                    <span className="amt">{fmt(a.value)}</span>
                  </div>
                ))}
                <div className="ews-row total"><span className="lbl">Total Assets</span><span className="amt">{fmt(wealthSummary.totalAssets)}</span></div>

                <div className="ews-h ews-block-gap">Consolidated Liabilities</div>
                {wealthSummary.liabilities.map(l => (
                  <div className="ews-row" key={l.label}>
                    <span className="lbl">{l.label}{l.sublabel && <span className="sub">{l.sublabel}</span>}</span>
                    <span className="amt">{fmt(l.value)}</span>
                  </div>
                ))}
                <div className="ews-row total-plain"><span className="lbl">Total Liabilities</span><span className="amt">{fmt(wealthSummary.totalLiabilities)}</span></div>
              </div>

              <div>
                <div className="ews-h">Annual Household Cashflow</div>
                {wealthSummary.perPersonInflow.map(p => (
                  <div className="ews-row" key={p.name}><span className="lbl">{p.name}</span><span className="amt">{fmt(p.takeHome)}</span></div>
                ))}
                <div className="ews-row total">
                  <span className="lbl">Total Inflows<span className="sub" style={{ color: '#8A6D3F', fontStyle: 'italic' }}>Take-home</span></span>
                  <span className="amt">{fmt(wealthSummary.totalInflow)}</span>
                </div>

                <div style={{ marginTop: '4mm' }}>
                  {wealthSummary.expenseBreakdown.map(e => (
                    <div className="ews-row" key={e.label}><span className="lbl">{e.label}</span><span className="amt">{fmt(e.value)}</span></div>
                  ))}
                  <div className="ews-row total-plain"><span className="lbl">Total Outflows</span><span className="amt">{fmt(wealthSummary.totalOutflow)}</span></div>
                </div>

                <div className="ews-surplus-box">
                  <div className="l">Annual Deployable Cash Surplus</div>
                  <div className="v">{fmt(wealthSummary.annualSurplus)}</div>
                </div>

                <div className="ews-h" style={{ marginTop: '5mm' }}>Key Financial Ratios</div>
                <div className="ews-ratios ews-ratios-narrow">
                  <div className={`ews-ratio ${wealthSummary.savingsRateStatus}`}><div className="icon">i</div><div className="v">{wealthSummary.savingsRatePct}%</div><div className="l">Savings Rate</div></div>
                  <div className={`ews-ratio ${wealthSummary.debtToAssetStatus}`}><div className="icon">i</div><div className="v">{wealthSummary.debtToAssetPct}%</div><div className="l">Debt-to-Asset</div></div>
                  <div className={`ews-ratio ${wealthSummary.investmentRatioStatus}`}><div className="icon">i</div><div className="v">{wealthSummary.investmentRatioPct}%</div><div className="l">Investment Ratio<span className="sub2">of net worth</span></div></div>
                </div>
              </div>
            </div>

            <div className="ews-runway">
              <div className="txt">
                <div className="l">Emergency Cash Runway</div>
                {fmt(wealthSummary.liquidCash)} in cash &amp; fixed deposits covers this many months of essential household expenses (excludes Lifestyle &amp; Miscellaneous, which would simply pause in an emergency).
              </div>
              <div className="v">{wealthSummary.runwayMonths.toFixed(1)} months</div>
            </div>
            </div>

            <div className="ftr"><span>Bespoke Capital — Confidential</span><span>Page 3 of 17</span></div>
          </div>

          {/* ============ PROTECTION (pages 4-9) ============
              Page numbering below assumes the couple case (6 protection
              pages, matching the brief's 17-page structure) — a single-client
              report only renders 3 of them (4-6) and the "of 17" denominator
              would need revisiting for that case, not handled yet. */}
          <ProtectionOverviewPage name={client.name} profile={protection.client} pageLabel="Page 4 of 17" />
          <ProtectionBreakdownPage type="dtpd" name={client.name} profile={protection.client} pageLabel="Page 5 of 17" />
          <ProtectionBreakdownPage type="ci" name={client.name} profile={protection.client} pageLabel="Page 6 of 17" />
          {isCouple && protection.spouse && (
            <>
              <ProtectionOverviewPage name={spouseName || 'Spouse'} profile={protection.spouse} pageLabel="Page 7 of 17" />
              <ProtectionBreakdownPage type="dtpd" name={spouseName || 'Spouse'} profile={protection.spouse} pageLabel="Page 8 of 17" />
              <ProtectionBreakdownPage type="ci" name={spouseName || 'Spouse'} profile={protection.spouse} pageLabel="Page 9 of 17" />
            </>
          )}

          {/* Remaining pages (Capital Fund ×3, Action Plan ×4) land here in
              subsequent increments, each its own <div className="page"
              break-after:page> per the approved mockup. */}
        </div>
      </body>
    </html>
  )
}

// Inlined rather than a separate stylesheet import — Puppeteer's page.pdf()
// with printBackground:true reads @media print rules directly from whatever
// the page serves, and inlining avoids a second network round-trip for a
// route that only Puppeteer ever requests. Font is loaded via @import,
// matching the approved mockup; Fraunces/Inter are Google Fonts already
// used elsewhere in the app's report views.
const PRINT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@400;500;600&display=swap');

  :root{
    --ink:#1A1A18; --ink2:#5C5A54; --ink3:#9C9A94; --ink4:#B0AEA8;
    --line:#E4E1D8; --line2:#D8D5CA; --paper:#FEFEFC; --accent:#7A3B34;
    --gold:#B08D57; --gold-tint:#F3ECE0; --dep:#3F4E5C; --tan:#C7A874;
  }
  *{box-sizing:border-box;}
  html,body{margin:0; padding:0; background:#fff; font-family:'Inter',sans-serif; color:var(--ink);}

  .page-wrap{display:block;}
  .page{
    width:210mm; min-height:297mm; background:var(--paper);
    padding:20mm 18mm 14mm; position:relative; display:flex; flex-direction:column;
    break-after:page;
  }
  .page:last-child{break-after:auto;}

  .cover{display:flex; flex-direction:column; flex:1;}
  .cover-top{display:flex; justify-content:space-between; align-items:flex-start;}
  .cover-eyebrow{font-size:9.5px; letter-spacing:0.18em; text-transform:uppercase; color:var(--ink3);}
  .cover-body{flex:1; display:flex; flex-direction:column; justify-content:center; padding:20mm 0;}
  .cover-label{font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:var(--ink3); margin-bottom:6mm;}
  .cover-name{font-family:'Fraunces',serif; font-size:42px; font-weight:500; font-style:italic; line-height:1.15; color:var(--ink); margin-bottom:10mm; max-width:140mm;}
  .cover-rule{width:32mm; height:1px; background:var(--ink); margin-bottom:8mm;}

  .ftr{margin-top:auto; padding-top:4mm; display:flex; justify-content:space-between; align-items:flex-end; border-top:1px solid var(--ink); font-size:8.5px; color:var(--ink3); letter-spacing:0.04em;}
  .ftr .m .l{font-size:9px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink3); margin-bottom:2mm;}
  .ftr .m .v{font-size:11.5px; color:var(--ink);}

  /* ===== interior page header (Overview onward) =====
     Spacing here is deliberately tighter than the fp.html mockup's original
     values — real client data (up to 7 asset categories, 8-category detailed
     cashflow) overflowed a single A4 page with the mockup's generous margins. */
  .tablabel{font-size:9.5px; letter-spacing:0.16em; text-transform:uppercase; color:var(--ink3); margin-bottom:4.5mm;}
  .hdr{margin-bottom:7mm;}
  .titlerow{display:flex; justify-content:space-between; align-items:baseline; border-bottom:1px solid var(--ink); padding-bottom:5mm;}
  .client{font-family:'Fraunces',serif; font-size:24px; font-weight:500; font-style:italic; color:var(--ink);}
  .date{font-size:10px; color:var(--ink3);}
  .seclabel{font-size:9.5px; letter-spacing:0.14em; text-transform:uppercase; color:var(--ink3); margin:0 0 4mm; break-after:avoid;}
  .seclabel:first-of-type{margin-top:0;}

  /* Fills all remaining space between the header and footer (minus a fixed
     6mm breathing gap above the footer rule), then distributes any leftover
     as even gaps BETWEEN the three sections (KPIs / Assets & Liabilities /
     Cashflow) rather than dumping it all as dead space after the last one —
     so the page always reaches the footer regardless of how much data a
     given client has. Verified in a real browser against both a typical
     client (5 asset rows) and the worst case (7 asset rows + 8 cashflow
     rows): content always sits exactly 6mm above the footer rule, with
     ~15mm of margin still to spare before real overflow in the worst case. */
  .ov-body{flex:1; min-height:0; display:flex; flex-direction:column; justify-content:space-between; margin-bottom:6mm;}

  /* ===== bordered KPI cards ===== */
  .card-kpi-row{display:flex; gap:6mm;}
  .card-kpi{flex:1; border:1px solid var(--line); border-radius:9px; padding:5mm 6mm; background:#FBFAF6;}
  .card-kpi .l{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink3); margin-bottom:3.5mm;}
  .card-kpi .v{font-family:'Fraunces',serif; font-weight:600; font-size:22px; color:var(--ink); margin-bottom:2mm;}
  .card-kpi .s{font-size:9px; color:var(--ink3);}

  /* ===== asset composition & liabilities ===== */
  .al-card{border:1px solid var(--line); border-radius:9px; padding:5mm 6mm; margin-bottom:4mm; display:grid; grid-template-columns:1fr 1fr; gap:10mm;}
  .al-col .al-h{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink3); margin-bottom:3.5mm;}
  .al-row{display:flex; justify-content:space-between; align-items:baseline; padding:2.2mm 0; border-bottom:1px dotted var(--line2); font-size:10.5px;}
  .al-row:last-child{border-bottom:none;}
  .al-row .lbl{color:var(--ink2); font-style:italic;}
  .al-row .amt{color:var(--ink);}

  .nw-bar{border:1px solid var(--gold, #B08D57); background:#F6F0E4; border-radius:9px; padding:4.5mm 6mm; display:flex; justify-content:space-between; align-items:center;}
  .nw-bar .l{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:#8A6D3F;}
  .nw-bar .v{font-family:'Fraunces',serif; font-weight:600; font-size:20px; color:var(--ink);}

  /* ===== annual cashflow ===== */
  .cashflow-wrap{display:grid; grid-template-columns:1.15fr 0.85fr; gap:9mm; border:1px solid var(--line); border-radius:9px; padding:5mm 6mm; margin-bottom:0;}
  .cf-row{display:flex; align-items:baseline; gap:6px; padding:2mm 0; border-bottom:1px solid var(--line);}
  .cf-row:last-child{border-bottom:none;}
  .cf-row .lbl{flex:1; font-size:10px; color:var(--ink2);}
  .cf-row .amt{font-size:9.5px; color:var(--ink3); width:20mm; text-align:right;}
  .cf-row .pct{font-size:9.5px; font-weight:500; width:26mm; text-align:right;}
  .cf-row .pct .vs{color:#B0AEA8; font-weight:400;}
  .cf-row .pct.over{color:var(--accent);}
  .cf-row .pct.under{color:#3F6B57;}
  .cf-donut-wrap{display:flex; flex-direction:column; align-items:center; justify-content:center;}
  .cf-legend{display:grid; grid-template-columns:1fr 1fr; gap:1.5mm 4mm; margin-top:4mm; width:100%;}
  .cf-legend .li2{display:flex; align-items:center; gap:4px; font-size:8px; color:var(--ink2);}
  .cf-legend .sw2{width:6px; height:6px; border-radius:1px; flex-shrink:0;}

  /* ===== Executive Wealth Summary ===== */
  .ews-title{font-family:'Fraunces',serif; font-size:22px; font-weight:600; color:var(--ink); margin:0 0 3mm;}
  .ews-sub{font-size:10.5px; color:var(--ink2); margin-bottom:4mm; line-height:1.5;}
  .ews-body{flex:1; min-height:0; display:flex; flex-direction:column; justify-content:space-between; margin-bottom:5mm;}
  .ews-nw-box{border:1.3px solid var(--gold, #B08D57); background:#F8F2E4; border-radius:9px; padding:3.5mm 7mm;}
  .ews-nw-box .l{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:#8A6D3F; margin-bottom:3mm;}
  .ews-nw-box .v{font-family:'Fraunces',serif; font-weight:700; font-size:27px; color:var(--ink);}
  .ews-nw-box .rule{border-top:1px solid #DDCBA0; margin:3mm 0;}
  .ews-nw-box .cap{font-size:10px; font-style:italic; color:#6B5A3A;}
  .ews-cols{display:grid; grid-template-columns:1fr 1fr; gap:9mm;}
  .ews-h{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink3); margin-bottom:3mm;}
  .ews-row{display:flex; justify-content:space-between; align-items:baseline; padding:1mm 0; border-bottom:1px solid var(--line);}
  .ews-row .lbl{font-size:10px; color:var(--ink); line-height:1.3;}
  .ews-row .lbl .sub{display:block; font-size:8px; font-style:italic; color:var(--ink3); margin-top:0.5mm;}
  .ews-row .amt{font-size:10px; color:var(--ink); white-space:nowrap; padding-left:4mm;}
  .ews-row.total{border-bottom:none; border-top:1.3px solid var(--gold,#B08D57); padding-top:3mm; margin-top:1mm;}
  .ews-row.total .lbl, .ews-row.total .amt{font-weight:700; color:#8A6D3F; font-size:10.5px;}
  .ews-row.total-plain{border-bottom:none; border-top:1.3px solid var(--ink); padding-top:3mm; margin-top:1mm;}
  .ews-row.total-plain .lbl, .ews-row.total-plain .amt{font-weight:700; color:var(--ink); font-size:10.5px;}
  .ews-block-gap{margin-top:4mm;}
  .ews-surplus-box{background:#1A1A18; border-radius:9px; padding:3mm 6mm; margin-top:3mm; text-align:center;}
  .ews-surplus-box .l{font-size:9px; letter-spacing:0.1em; text-transform:uppercase; color:#B0AEA8;}
  .ews-surplus-box .v{font-family:'Fraunces',serif; font-weight:700; font-size:20px; color:#D9B475; margin-top:2mm;}
  .ews-ratios{display:grid; grid-template-columns:1fr 1fr 1fr; gap:5mm; margin-bottom:5mm;}
  .ews-ratios-narrow{gap:2.5mm;}
  .ews-ratios-narrow .ews-ratio{padding:3mm;}
  .ews-ratios-narrow .ews-ratio .v{font-size:14px;}
  .ews-ratios-narrow .ews-ratio .l{font-size:7px; margin-top:2mm;}
  .ews-ratios-narrow .ews-ratio .icon{width:10px; height:10px; font-size:6px; top:2.5mm; right:2.5mm;}
  .ews-ratio{border-radius:8px; padding:5mm; text-align:left; position:relative; border:1px solid transparent;}
  .ews-ratio.good{background:#EAF2ED; border-color:#BFDCCB;}
  .ews-ratio.watch{background:#F8F0DD; border-color:#E7CE95;}
  .ews-ratio.concern{background:#F7E9E6; border-color:#E5B3AA;}
  .ews-ratio .icon{position:absolute; top:3.5mm; right:3.5mm; width:12px; height:12px; border-radius:50%; border:1px solid currentColor; font-size:7px; font-family:'Fraunces',serif; font-style:italic; display:flex; align-items:center; justify-content:center; opacity:0.55;}
  .ews-ratio .v{font-family:'Fraunces',serif; font-weight:700; font-size:19px; display:block;}
  .ews-ratio.good .v, .ews-ratio.good .icon{color:#3F6B57;}
  .ews-ratio.watch .v, .ews-ratio.watch .icon{color:#8A6D3F;}
  .ews-ratio.concern .v, .ews-ratio.concern .icon{color:var(--accent);}
  .ews-ratio .l{font-size:8.5px; letter-spacing:0.06em; text-transform:uppercase; color:var(--ink3); margin-top:3mm; display:block;}
  .ews-ratio .l .sub2{display:block; font-size:8px; letter-spacing:normal; text-transform:none; font-style:italic; color:var(--ink3); margin-top:0.5mm;}
  .ews-runway{background:#EAF2ED; border-radius:9px; padding:3.5mm 6mm; display:flex; justify-content:space-between; align-items:center; gap:6mm;}
  .ews-runway .txt{font-size:9.5px; color:#3F6B57; line-height:1.5;}
  .ews-runway .txt .l{font-size:9px; letter-spacing:0.08em; text-transform:uppercase; color:#3F6B57; font-weight:600; margin-bottom:2mm;}
  .ews-runway .v{font-family:'Fraunces',serif; font-weight:700; font-size:20px; color:#2E5442; white-space:nowrap;}

  /* ===== Protection overview (pages 4 & 7) ===== */
  .po-eyebrow{font-size:9.5px; letter-spacing:0.12em; text-transform:uppercase; color:var(--ink3); margin-bottom:3mm;}
  .po-headline{font-family:'Fraunces',serif; font-weight:500; font-size:17px; line-height:1.4; color:var(--ink); margin-bottom:7mm;}
  .po-stats{display:flex; gap:12mm; margin-bottom:6mm; padding-bottom:5mm; border-bottom:1px solid var(--line);}
  .po-stat{flex:1;}
  .po-stat .sl{display:flex; align-items:center; gap:2mm; font-size:9.5px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink3); margin-bottom:3mm;}
  .po-stat .sl .dot{width:6px; height:6px; border-radius:50%; flex-shrink:0;}
  .po-stat .sv{font-family:'Fraunces',serif; font-weight:600; font-size:24px; line-height:1;}
  .po-stat .sc{font-family:'Fraunces',serif; font-style:italic; font-size:10.5px; color:var(--ink2); margin-top:2mm;}
  .po-stat .rule{width:8mm; height:2px; margin-top:3mm;}
  .po-fw-h{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink3); margin-bottom:4mm;}
  .po-fw-row{display:flex; align-items:center; gap:4mm; padding:2mm 0;}
  .po-fw-icon{width:7mm; height:7mm; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:600;}
  .po-fw-icon.covered{background:#3F6B57; color:#fff;}
  .po-fw-icon.needs{background:#F3E2DF; color:var(--accent); border:1px solid var(--accent);}
  .po-fw-label{flex:1; font-size:10.5px; color:var(--ink); font-weight:500;}
  .po-fw-status{font-family:'Fraunces',serif; font-style:italic; font-size:10px; padding:1mm 3mm; border-radius:3px; border:1px solid;}
  .po-fw-status.covered{color:#3F6B57; border-color:#BFDCCB;}
  .po-fw-status.needs{color:var(--accent); border-color:#E5B3AA;}
  .po-fw-tag{font-size:8px; color:var(--ink4); margin-left:2mm; font-style:italic;}

  .runway-head{font-size:9.5px; letter-spacing:0.14em; text-transform:uppercase; color:var(--ink3); margin-bottom:3mm;}
  .runway-desc{font-size:10.5px; color:var(--ink2); line-height:1.55; margin-bottom:5mm; max-width:165mm;}
  .runway-legend{display:flex; gap:6mm; margin-bottom:6mm; font-size:9px; color:var(--ink2);}
  .runway-legend span{display:flex; align-items:center; gap:1.5mm;}
  .runway-legend .sw{width:8px; height:8px; border-radius:2px; display:inline-block;}
  .runway-legend .sw.dep{background:var(--dep);}
  .runway-legend .sw.mort{background:var(--gold);}
  .runway-legend .sw.edu{background:#3F6B57;}
  .runway-legend .sw.ins{background:var(--ink);}
  .runway-legend .sw.assets{background:var(--tan);}
  .runway-row{margin-bottom:4mm;}
  .runway-row .rh{display:flex; justify-content:space-between; align-items:baseline; margin-bottom:2mm;}
  .runway-row .rh .l{font-size:10.5px; color:var(--ink);}
  .runway-row .rh .v{font-family:'Fraunces',serif; font-weight:600; font-size:13px; color:var(--ink);}
  .runway-row .rh .v.accent-v{color:var(--accent);}
  .runway-bar{display:flex; height:6mm; border-radius:2px; overflow:hidden; background:var(--line);}
  .runway-bar .seg.dep{background:var(--dep);}
  .runway-bar .seg.mort{background:var(--gold);}
  .runway-bar .seg.edu{background:#3F6B57;}
  .runway-bar .seg.ins{background:var(--ink);}
  .runway-bar .seg.assets{background:var(--tan);}
  .runway-bar .seg.gap{background:var(--line);}
  .runway-short{text-align:right; font-size:9px; color:var(--ink3); margin-top:1.5mm;}
  .runway-axis{display:flex; justify-content:space-between; font-size:8px; color:var(--ink3); padding-top:2mm; border-top:1px solid var(--line2); margin-top:2mm; margin-bottom:5mm;}

  .pol-cards{display:grid; grid-template-columns:repeat(4,1fr); gap:5mm; margin-top:1mm;}
  .pol-card{border:1px solid var(--line); border-radius:8px; padding:3.5mm 4mm; text-align:center;}
  .pol-card .l{font-size:8.5px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink3); margin-bottom:2mm;}
  .pol-card .v{font-family:'Fraunces',serif; font-weight:600; font-size:17px; color:var(--ink);}
  .pol-card .v.zero{color:var(--ink4); font-size:14px;}
  .pol-note{font-size:9px; color:var(--ink3); margin-top:2.5mm;}

  /* ===== Protection per-peril breakdown (pages 5, 6, 8, 9) ===== */
  .cp-eyebrow{font-size:9.5px; letter-spacing:0.16em; text-transform:uppercase; color:var(--ink3); margin-bottom:4mm;}
  .cp-headline{font-family:'Fraunces',serif; font-size:22px; font-weight:600; color:var(--ink); margin:0 0 6mm;}
  .cp-headline i{font-weight:500; font-style:italic; color:var(--ink);}
  .cp-narrative{font-size:13px; line-height:1.65; color:var(--ink); max-width:165mm; margin:0 0 10mm;}
  .cp-narrative b{color:var(--gold); font-weight:600;}
  .cp-narrative b.pct{color:var(--ink);}
  .cp-cards{display:grid; grid-template-columns:1fr 1fr; gap:8mm;}
  .cp-card{border:1px solid var(--line); border-radius:10px; padding:7mm 7mm 6mm;}
  .cp-card-title{font-size:9px; letter-spacing:0.1em; text-transform:uppercase; color:var(--gold); font-weight:600; margin-bottom:5mm;}
  .cp-row{display:flex; align-items:flex-start; gap:3.5mm; padding:3mm 0; border-bottom:1px dotted var(--line2);}
  .cp-row:last-of-type{border-bottom:none;}
  .cp-icon{width:6.5mm; height:6.5mm; border-radius:4px; background:var(--gold-tint); display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:0.3mm;}
  .cp-icon svg{width:3.6mm; height:3.6mm; stroke:var(--gold); fill:none; stroke-width:1.8;}
  .cp-icon.have{background:#EDF1EC;}
  .cp-icon.have svg{stroke:#3F6B57;}
  .cp-row-label{font-size:9.8px; color:var(--ink2); line-height:1.4; flex:1;}
  .cp-row-value{font-size:10.5px; font-weight:600; color:var(--ink); white-space:nowrap; margin-left:2mm;}
  .cp-card-total{display:flex; justify-content:space-between; align-items:baseline; padding-top:3.5mm; margin-top:1mm; border-top:1px solid var(--ink);}
  .cp-card-total .l{font-size:10px; color:var(--ink2);}
  .cp-card-total .v{font-size:12.5px; font-weight:600; color:var(--ink);}
  .cp-card-status{display:flex; justify-content:space-between; align-items:baseline; padding-top:1.5mm;}
  .cp-card-status .l{font-size:10px; color:var(--ink2);}
  .cp-card-status .v{font-size:10.5px; font-weight:600; color:var(--accent);}
  .cp-timeline{}
  .cp-tl-label{font-size:9.5px; letter-spacing:0.14em; text-transform:uppercase; color:var(--ink3); margin-bottom:2.5mm;}
  .cp-tl-sub{font-size:10.5px; color:var(--ink2); margin-bottom:5mm; line-height:1.5;}
  .cp-tl-meta{display:flex; justify-content:space-between; align-items:baseline; font-size:8.5px; letter-spacing:0.06em; text-transform:uppercase; color:var(--ink3); margin-bottom:2mm;}
  .cp-tl-legend{display:flex; gap:6mm; align-items:center;}
  .cp-tl-legend span{display:flex; align-items:center; gap:1.5mm;}
  .cp-tl-legend .sw{width:9px; height:2px; display:inline-block;}
  .cp-tl-legend .sw.need{background:var(--gold);}
  .cp-tl-legend .sw.have{background:var(--line2); height:5px;}
  .cp-tl-legend .sw.gap{background:var(--accent);}
  .cp-analysis{}
  .cp-an-label{font-size:9.5px; letter-spacing:0.14em; text-transform:uppercase; color:var(--ink3); margin-bottom:5mm;}
  .cp-an-row{display:flex; justify-content:space-between; font-size:9.5px; color:var(--ink2); margin-bottom:2mm;}
  .cp-an-row .r{color:var(--accent); font-weight:600;}
  .cp-bar{display:flex; height:9mm; border-radius:3px; overflow:hidden;}
  .cp-bar .have{background:var(--ink); display:flex; align-items:center; padding-left:4mm; color:var(--paper); font-size:10px; font-weight:600;}
  .cp-bar .gap{background:var(--accent); display:flex; align-items:center; justify-content:flex-end; padding-right:4mm; color:var(--paper); font-size:10px; font-weight:600;}
  .cp-body{flex:1; min-height:0; display:flex; flex-direction:column; justify-content:space-between; margin-bottom:6mm;}
  .cp-insight{border-left:2px solid var(--gold); padding-left:6mm;}
  .cp-insight p{font-family:'Fraunces',serif; font-style:italic; font-size:12px; line-height:1.65; color:var(--ink2); margin:0;}
  .cp-insight p b{color:var(--ink); font-weight:600;}

  @media print{
    body{background:none;}
    .page{box-shadow:none;}
    .card-kpi-row, .al-card, .cashflow-wrap{break-inside:avoid;}
    .ews-nw-box, .ews-surplus-box, .ews-ratios, .ews-runway{break-inside:avoid;}
    .po-stats, .cp-cards, .cp-card{break-inside:avoid;}
  }
`