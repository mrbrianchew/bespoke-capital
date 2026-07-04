'use client'
import { useState, MouseEvent } from 'react'
import { Stethoscope, HeartPulse, Shield, Bandage, Key, GraduationCap, ArrowRight, Palmtree, LucideIcon } from 'lucide-react'
import { ProtectionSnapshot, PersonProtectionProfile, PersonProtectionBreakdown, PersonCIBreakdown, LifePolicyLineItem, FamilyRunway, FrameworkRowKey, FrameworkRowStatus, CoverageTimeline, CoverageMilestone, CoverageMilestoneType } from '@/lib/protectionSnapshot'

type Page = 'overview' | 'dtpd'

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

// The fields shared by both breakdown shapes — enough for the overview
// page's headline stats, which don't need the protection-type-specific extras.
interface CoreBreakdown {
  maxCapitalRequired: number
  shortfall: number
  status: 'covered' | 'shortfall'
}

function LadderRow({
  icon, label, covered, last, rowKey, editable, currentOverride, onOverrideChange,
}: {
  icon: LucideIcon
  label: string
  covered: boolean
  last?: boolean
  rowKey: FrameworkRowKey
  editable?: boolean
  currentOverride?: FrameworkRowStatus
  onOverrideChange?: (key: FrameworkRowKey, value: FrameworkRowStatus | undefined) => void
}) {
  const Icon = icon
  const effectiveCovered = currentOverride ? currentOverride === 'covered' : covered
  const statusText = effectiveCovered ? 'Covered' : 'Needs attention'

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: last ? 0 : 24, position: 'relative' }}>
      <div style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: effectiveCovered ? 'var(--emerald)' : 'var(--rouge-l)',
        border: effectiveCovered ? 'none' : '1px solid var(--rouge)',
      }}>
        <Icon size={17} color={effectiveCovered ? '#fff' : 'var(--rouge)'} aria-hidden="true" />
      </div>
      <div style={{ paddingTop: 6, flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: editable ? 5 : 0 }}>{label}</div>
        {editable ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              value={currentOverride ?? (covered ? 'covered' : 'needs_attention')}
              onChange={e => {
                const value = e.target.value as FrameworkRowStatus
                const systemValue: FrameworkRowStatus = covered ? 'covered' : 'needs_attention'
                onOverrideChange?.(rowKey, value === systemValue ? undefined : value)
              }}
              style={{
                fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 13,
                color: effectiveCovered ? 'var(--ink2)' : 'var(--rouge)',
                border: `1px solid ${effectiveCovered ? 'var(--line2)' : 'var(--rouge)'}`,
                borderRadius: 4, padding: '3px 8px', background: '#fff', cursor: 'pointer',
              }}
            >
              <option value="covered">Covered</option>
              <option value="needs_attention">Needs attention</option>
            </select>
            <span style={{ fontSize: 10, color: currentOverride ? 'var(--gold-tag)' : 'var(--ink3)' }}>
              {currentOverride ? 'manually set' : 'system default'}
            </span>
          </div>
        ) : (
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 13, color: effectiveCovered ? 'var(--ink2)' : 'var(--rouge)', marginTop: 2 }}>
            {statusText}
          </div>
        )}
      </div>
    </div>
  )
}

function ProtectionLadder({
  profile, editable, onOverrideChange,
}: {
  profile: PersonProtectionProfile
  editable?: boolean
  onOverrideChange?: (key: FrameworkRowKey, value: FrameworkRowStatus | undefined) => void
}) {
  const { ci, dtpd, framework } = profile
  const overrides = framework.overrides ?? {}

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', left: 19, top: 19, bottom: 19, width: 1, background: 'var(--line2)' }} />
      <LadderRow
        icon={Stethoscope}
        label="Medical & health protection"
        covered={framework.medicalCovered}
        rowKey="medical"
        editable={editable}
        currentOverride={overrides.medical}
        onOverrideChange={onOverrideChange}
      />
      <LadderRow
        icon={HeartPulse}
        label="Income protection — critical illness"
        covered={ci.status === 'covered'}
        rowKey="ci"
        editable={editable}
        currentOverride={overrides.ci}
        onOverrideChange={onOverrideChange}
      />
      <LadderRow
        icon={Shield}
        label="Capital protection — death & TPD"
        covered={dtpd.status === 'covered'}
        rowKey="dtpd"
        editable={editable}
        currentOverride={overrides.dtpd}
        onOverrideChange={onOverrideChange}
      />
      <LadderRow
        icon={Bandage}
        label="Personal accident"
        covered={framework.accidentCovered}
        rowKey="accident"
        editable={editable}
        currentOverride={overrides.accident}
        onOverrideChange={onOverrideChange}
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
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 640 }}>
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
      </div>
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
    { id: 'dtpd', label: 'Protection scenarios' },
  ]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 36, borderBottom: '1px solid var(--line)' }}>
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
      <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5, marginBottom: 28 }}>
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

function OverviewPage({
  name, profile, onContinue, editable, onOverrideChange,
}: {
  name: string
  profile: PersonProtectionProfile
  onContinue: () => void
  editable?: boolean
  onOverrideChange?: (key: FrameworkRowKey, value: FrameworkRowStatus | undefined) => void
}) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 14 }}>
        Protection overview
      </div>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontSize: 26, lineHeight: 1.45, color: 'var(--ink)', marginBottom: 36 }}>
        Here's where {name}'s protection stands today.
      </div>

      <div className="flex flex-wrap" style={{ gap: 24, marginBottom: 48 }}>
        <StatBlock label="Death & TPD" icon={Shield} breakdown={profile.dtpd} />
        <div className="hidden sm:block" style={{ width: 1, background: 'var(--line2)' }} />
        <StatBlock label="Critical illness" icon={HeartPulse} breakdown={profile.ci} />
      </div>

      <FamilyRunwayChart name={name} runway={profile.runway} />

      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 22 }}>
        Protection framework
      </div>
      <ProtectionLadder profile={profile} editable={editable} onOverrideChange={onOverrideChange} />

      <LifeInsuranceTable policies={profile.lifePolicies} />

      <ContinueLink label="See the protection scenarios" onClick={onContinue} />
    </div>
  )
}

// ─── Death & TPD breakdown (card-based redesign) ────────────────────────────
// Replaces the old narrative buildDTPDContent()/ProtectionSection combo for
// this tab. The CI tab below was rebuilt the same way — see CIBreakdownPage.

function milestoneColor(type: CoverageMilestone['type']): string {
  if (type === 'education') return 'var(--emerald)'
  if (type === 'mortgage') return 'var(--gold-tag)'
  return 'var(--ink2)'
}

function milestoneIcon(type: CoverageMilestone['type']): LucideIcon {
  if (type === 'education') return GraduationCap
  if (type === 'mortgage') return Key
  return Palmtree
}

function CoverageTimelineChart({ name, timeline, currentAge }: { name: string; timeline: CoverageTimeline; currentAge: number }) {
  const [hovered, setHovered] = useState<{ age: number; need: number; have: number; x: number; yNeed: number; yHave: number } | null>(null)
  const [hoveredMilestone, setHoveredMilestone] = useState<number | null>(null)
  const { points, milestones } = timeline
  if (points.length === 0) return null

  const W = 900, H = 300, PL = 60, PR = 30, PT = 56, PB = 40
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

  function handleMouseMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (W / rect.width)
    if (mx < PL || mx > PL + iW) { setHovered(null); return }
    const rel = (mx - PL) / iW
    const targetAge = minA + rel * aRange
    const closest = points.reduce((prev, curr) => (Math.abs(curr.age - targetAge) < Math.abs(prev.age - targetAge) ? curr : prev))
    setHovered({ age: closest.age, need: closest.need, have: closest.have, x: xP(closest.age), yNeed: yP(closest.need), yHave: yP(closest.have) })
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
          {name} · Age {currentAge} to 100
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 2, background: 'var(--gold)' }} />
            <span style={{ fontSize: 10, color: 'var(--ink3)' }}>Capital needed</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 11, height: 7, background: 'var(--gold)', opacity: 0.32, borderRadius: 2 }} />
            <span style={{ fontSize: 10, color: 'var(--ink3)' }}>Existing portfolio</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 11, height: 7, background: 'var(--rouge)', opacity: 0.5 }} />
            <span style={{ fontSize: 10, color: 'var(--ink3)' }}>Shortfall</span>
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Coverage needed versus existing portfolio for ${name}, age ${currentAge} to 100`}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
      >
        {ticks.map(f => {
          const y = PT + iH - f * iH
          return (
            <g key={f}>
              <line x1={PL} y1={y} x2={PL + iW} y2={y} stroke="var(--cream3)" strokeWidth="1" />
              {f > 0 && <text x={PL - 8} y={y + 3.5} fontSize="9" fill="var(--ink3)" textAnchor="end">{fmtY(maxV * f)}</text>}
            </g>
          )
        })}

        {shortfallSegs.map((d, i) => <path key={`sf-${i}`} d={d} fill="var(--rouge-l)" stroke="none" />)}

        {points.map(d => {
          if (d.have <= 0) return null
          const hy = yP(d.have)
          return (
            <rect key={`bar-${d.age}`} x={xP(d.age) - barW / 2} y={hy} width={barW} height={Math.max(1, PT + iH - hy)} fill="var(--gold)" opacity="0.32" rx="1" />
          )
        })}

        <path d={needPath} stroke="var(--gold)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {milestones.map((m, i) => {
          const mx = xP(m.age)
          if (mx < PL || mx > PL + iW) return null
          const color = milestoneColor(m.type)
          const Icon = milestoneIcon(m.type)
          const isHovered = hoveredMilestone === i
          const iconSize = isHovered ? 18 : 15
          return (
            <g key={`ms-${i}`}>
              <line x1={mx} y1={PT} x2={mx} y2={PT + iH} stroke={color} strokeWidth="0.75" strokeDasharray="2,4" opacity={isHovered ? 0.6 : 0.35} />
              <g transform={`translate(${mx - iconSize / 2}, ${PT - 8 - iconSize / 2})`} opacity={isHovered ? 1 : 0.8}>
                <Icon size={iconSize} color={color} strokeWidth={2} />
              </g>
              {/* Larger invisible target makes the icon easy to hover without needing pixel-perfect aim */}
              <circle
                cx={mx} cy={PT - 8} r="11" fill="transparent"
                onMouseEnter={() => setHoveredMilestone(i)}
                onMouseLeave={() => setHoveredMilestone(null)}
                style={{ cursor: 'pointer' }}
              />
            </g>
          )
        })}

        <line x1={PL} y1={PT + iH} x2={PL + iW} y2={PT + iH} stroke="var(--line2)" strokeWidth="1" />

        {points.filter(d => d.age % 5 === 0 || d.age === currentAge || d.age === 100).map(d => (
          <text key={d.age} x={xP(d.age)} y={PT + iH + 16} fontSize="9" fill="var(--ink3)" textAnchor="middle">{d.age}</text>
        ))}

        {hovered && (
          <>
            <line x1={hovered.x} y1={PT} x2={hovered.x} y2={PT + iH} stroke="var(--ink)" strokeWidth="0.5" strokeDasharray="2,4" opacity="0.2" />
            <circle cx={hovered.x} cy={hovered.yNeed} r="4" fill="var(--gold)" stroke="#fff" strokeWidth="2" />
            {hovered.have > 0 && <circle cx={hovered.x} cy={hovered.yHave} r="3" fill="var(--gold)" stroke="#fff" strokeWidth="1.5" opacity="0.6" />}
          </>
        )}
      </svg>

      {hovered && hoveredMilestone === null && (
        <div style={{
          position: 'absolute',
          left: `${Math.min(Math.max(((hovered.x - PL) / iW) * 100, 10), 90)}%`,
          top: 16, transform: 'translateX(-50%)',
          background: 'var(--charcoal)', color: '#F5F0E8', padding: '14px 18px', borderRadius: 10,
          fontSize: 11, pointerEvents: 'none', zIndex: 10, whiteSpace: 'nowrap',
        }}>
          <div style={{ marginBottom: 10, color: 'var(--gold)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Age {hovered.age}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 28 }}>
              <span style={{ color: 'rgba(245,240,232,0.55)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Capital needed</span>
              <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 16 }}>{fmtCompact(hovered.need)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 28 }}>
              <span style={{ color: 'rgba(245,240,232,0.55)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Existing portfolio</span>
              <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 16, color: 'var(--gold)' }}>{fmtCompact(hovered.have)}</span>
            </div>
            <div style={{ paddingTop: 8, borderTop: '1px solid rgba(245,240,232,0.15)', display: 'flex', justifyContent: 'space-between', gap: 28 }}>
              <span style={{ color: 'rgba(245,240,232,0.55)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {hovered.need > hovered.have ? 'Shortfall' : 'Surplus'}
              </span>
              <span style={{
                fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 16,
                color: hovered.need > hovered.have ? 'var(--rouge)' : 'var(--emerald)',
              }}>
                {fmtCompact(Math.abs(hovered.need - hovered.have))}
              </span>
            </div>
          </div>
        </div>
      )}

      {hoveredMilestone !== null && milestones[hoveredMilestone] && (() => {
        const m = milestones[hoveredMilestone]
        const mx = xP(m.age)
        return (
          <div style={{
            position: 'absolute',
            left: `${Math.min(Math.max(((mx - PL) / iW) * 100, 6), 94)}%`,
            top: 16, transform: 'translateX(-50%)',
            background: 'var(--charcoal)', color: '#F5F0E8', padding: '8px 14px', borderRadius: 8,
            fontSize: 12, pointerEvents: 'none', zIndex: 10, whiteSpace: 'nowrap',
          }}>
            <span style={{ fontWeight: 500 }}>{m.label}</span>
            <span style={{ color: 'rgba(245,240,232,0.55)', marginLeft: 8 }}>age {m.age}</span>
          </div>
        )
      })()}
    </div>
  )
}

// Same closing-line copy the old narrative version used — only the
// surrounding layout changed, not the voice.
function buildDTPDClosingLine(name: string, dtpd: PersonProtectionBreakdown): string {
  if (dtpd.maxCapitalRequired <= 0) return ''
  if (dtpd.status === 'covered') {
    return `${name}'s family already has full protection in place — with room to spare.`
  }
  const closingParts: string[] = ['keep their lifestyle']
  if (dtpd.mortgageDebtClearance > 0) closingParts.push('stay in their home')
  if (dtpd.tertiaryFunding > 0) closingParts.push('see the children through school')
  return `Closing this gap means ${name}'s family can ${joinWithAnd(closingParts)} — whatever happens. Without it, the people ${name} cares about most could face difficult choices at the hardest possible moment.`
}

function ClosingCallout({ text, accentColor }: { text: string; accentColor: string }) {
  if (!text) return null
  return (
    <div style={{ paddingLeft: 16, borderLeft: `2px solid ${accentColor}` }}>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 16, color: 'var(--ink2)', lineHeight: 1.6 }}>
        {text}
      </div>
    </div>
  )
}

// ─── Scenario card (frosted dial redesign) ──────────────────────────────────
// Replaces the old light two-column Needs/Have cards for both DTPD and CI.
// Client-blue / spouse-purple tints match OWNER_COLORS in ActionPlanDisplay.tsx.
const NARRATIVE_TINTS: Record<'client' | 'spouse', string> = { client: '#4A7C9E', spouse: '#6B5B8B' }

// Shape shared by PersonProtectionBreakdown and PersonCIBreakdown — enough
// for the dial and legend, which don't need the protection-type-specific extras.
interface DialBreakdown {
  existingCoverage: number
  assetMitigation: number
  shortfall: number
  maxCapitalRequired: number
  status: 'covered' | 'shortfall'
}

function RadialDial({ breakdown, size = 148 }: { breakdown: DialBreakdown; size?: number }) {
  const strokeW = 10
  const r = size / 2 - strokeW
  const c = size / 2
  const circumference = 2 * Math.PI * r
  const total = breakdown.maxCapitalRequired > 0 ? breakdown.maxCapitalRequired : 1

  const goldLen = circumference * Math.min(1, breakdown.existingCoverage / total)
  const sageLen = circumference * Math.max(0, Math.min(1 - breakdown.existingCoverage / total, breakdown.assetMitigation / total))
  const rougeLen = Math.max(0, circumference - goldLen - sageLen) * (breakdown.shortfall > 0 ? 1 : 0)

  const pct = breakdown.maxCapitalRequired > 0
    ? Math.min(100, Math.round(((breakdown.existingCoverage + breakdown.assetMitigation) / breakdown.maxCapitalRequired) * 100))
    : 100

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(245,240,232,0.1)" strokeWidth={strokeW} />
      {goldLen > 0 && (
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--gold)" strokeWidth={strokeW}
          strokeDasharray={`${goldLen} ${circumference}`} transform={`rotate(-90 ${c} ${c})`} />
      )}
      {sageLen > 0 && (
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--emerald)" strokeWidth={strokeW}
          strokeDasharray={`${sageLen} ${circumference}`} strokeDashoffset={-goldLen} transform={`rotate(-90 ${c} ${c})`} />
      )}
      {rougeLen > 0 && (
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--rouge)" strokeWidth={strokeW}
          strokeDasharray={`${rougeLen} ${circumference}`} strokeDashoffset={-(goldLen + sageLen)} transform={`rotate(-90 ${c} ${c})`} />
      )}
      <text x={c} y={c - 3} textAnchor="middle" fontFamily="Cormorant Garamond, serif" fontWeight={600} fontSize={size * 0.19} fill="#F5F0E8">
        {pct}%
      </text>
      <text x={c} y={c + 17} textAnchor="middle" fontSize={size * 0.07} letterSpacing="0.08em" fill="rgba(245,240,232,0.5)">
        PROTECTED
      </text>
    </svg>
  )
}

function LegendRow({ swatch, label, value }: { swatch: string; label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
      <div style={{ width: 9, height: 9, borderRadius: '50%', background: swatch, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'rgba(245,240,232,0.7)', flex: 1 }}>{label}</span>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#F5F0E8' }}>{fmt(value)}</span>
    </div>
  )
}

function BreakdownRow({ label, value, durationYears }: { label: string; value: number; durationYears?: number | null }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid rgba(245,240,232,0.08)' }}>
      <span style={{ fontSize: 12.5, color: 'rgba(245,240,232,0.75)' }}>
        {label}{durationYears != null && durationYears > 0 ? ` · ${durationYears} yrs` : ''}
      </span>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#F5F0E8', whiteSpace: 'nowrap', marginLeft: 12 }}>
        {fmt(value)}
      </span>
    </div>
  )
}

// "Years until milestone" for a category row — e.g. years left on the
// mortgage, or years until the youngest child reaches university. Reuses the
// same CoverageTimeline milestones the chart below already plots, rather
// than re-deriving ages from raw property/child data a second time. When a
// category has more than one milestone of its type (one per child, for
// education), the furthest-out one is used, matching how the dollar figure
// itself represents the combined need until everyone is through.
function getDuration(timeline: CoverageTimeline, type: CoverageMilestoneType): number | null {
  const currentAge = timeline.points.length > 0 ? timeline.points[0].age : null
  if (currentAge === null) return null
  const matches = timeline.milestones.filter(m => m.type === type)
  if (matches.length === 0) return null
  return Math.max(0, Math.round(Math.max(...matches.map(m => m.age)) - currentAge))
}

interface ScenarioRow {
  label: string
  value: number
  milestoneType?: CoverageMilestoneType
}

function ScenarioCard({
  who, name, eyebrow, narrativeClause, breakdown, rows, showDurations, timeline, closingLine, recoveryWindowYears,
}: {
  who: 'client' | 'spouse'
  name: string
  eyebrow: string
  narrativeClause: string
  breakdown: DialBreakdown
  rows: ScenarioRow[]
  showDurations: boolean
  timeline: CoverageTimeline
  closingLine: string
  recoveryWindowYears?: number
}) {
  const hasNeed = breakdown.maxCapitalRequired > 0
  const nameColor = NARRATIVE_TINTS[who]
  const visibleRows = rows.filter(r => r.value > 0)

  return (
    <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle at 18% 12%, rgba(168,131,74,0.14), transparent 55%), radial-gradient(circle at 85% 88%, rgba(42,94,70,0.16), transparent 55%)',
      }} />
      <div style={{ position: 'relative', background: 'rgba(28,26,23,0.94)', padding: '28px 30px' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 8 }}>
          {eyebrow}
        </div>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 24, lineHeight: 1.3, color: '#F5F0E8', marginBottom: hasNeed ? 22 : 0 }}>
          If <span style={{ color: nameColor }}>{name}</span> {narrativeClause}
        </div>

        {!hasNeed ? (
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 15, color: 'rgba(245,240,232,0.55)', marginTop: 14 }}>
            No need has been identified for {name} yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 30 }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                  <RadialDial breakdown={breakdown} />
                </div>
                {breakdown.status === 'shortfall' && (
                  <div style={{ textAlign: 'center', fontFamily: 'Cormorant Garamond, serif', fontSize: 19, color: '#C97C76', marginBottom: 18 }}>
                    {fmt(breakdown.shortfall)} shortfall
                  </div>
                )}
                <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid rgba(245,240,232,0.08)' }}>
                  <LegendRow swatch="var(--gold)" label="Existing insurance" value={breakdown.existingCoverage} />
                  <LegendRow swatch="var(--emerald)" label="Asset mitigation" value={breakdown.assetMitigation} />
                  {breakdown.shortfall > 0 && <LegendRow swatch="var(--rouge)" label="Shortfall" value={breakdown.shortfall} />}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(245,240,232,0.4)', marginBottom: 10 }}>
                  What the capital need is for
                </div>
                <div>
                  {visibleRows.map((r, i) => (
                    <BreakdownRow
                      key={i}
                      label={r.label}
                      value={r.value}
                      durationYears={showDurations && r.milestoneType ? getDuration(timeline, r.milestoneType) : null}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, marginTop: 'auto', fontSize: 13, fontWeight: 600, color: '#F5F0E8' }}>
                  <span>Total need</span>
                  <span style={{ fontFamily: 'DM Mono, monospace' }}>{fmt(breakdown.maxCapitalRequired)}</span>
                </div>
                {recoveryWindowYears != null && (
                  <div style={{ fontSize: 10, color: 'rgba(245,240,232,0.4)', marginTop: 6 }}>
                    Recovery window: {recoveryWindowYears} years
                  </div>
                )}
              </div>
            </div>

            {closingLine && (
              <div style={{ marginTop: 24, paddingLeft: 14, borderLeft: `2px solid ${breakdown.status === 'shortfall' ? 'var(--rouge)' : 'var(--emerald)'}` }}>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 14, color: 'rgba(245,240,232,0.75)', lineHeight: 1.6 }}>
                  {closingLine}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function DTPDCard({ who, name, profile }: { who: 'client' | 'spouse'; name: string; profile: PersonProtectionProfile }) {
  const { dtpd, dtpdTimeline } = profile
  const rows: ScenarioRow[] = [
    { label: 'Family living', value: dtpd.familyDependency },
    { label: 'Mortgage', value: dtpd.mortgageDebtClearance, milestoneType: 'mortgage' },
    { label: 'Education', value: dtpd.tertiaryFunding, milestoneType: 'education' },
  ]
  return (
    <ScenarioCard
      who={who} name={name}
      eyebrow="Death, terminal illness or permanent disability"
      narrativeClause="were gone tomorrow —"
      breakdown={dtpd}
      rows={rows}
      showDurations
      timeline={dtpdTimeline}
      closingLine={buildDTPDClosingLine(name, dtpd)}
    />
  )
}

function CICard({ who, name, profile }: { who: 'client' | 'spouse'; name: string; profile: PersonProtectionProfile }) {
  const { ci, ciTimeline } = profile
  const rows: ScenarioRow[] = [
    { label: 'Family living', value: ci.familyDependency },
    { label: 'Mortgage', value: ci.mortgageDebtClearance },
    { label: 'Education', value: ci.tertiaryFunding },
    { label: 'Medical buffer', value: ci.medicalBuffer },
    { label: 'Recovery buffer', value: ci.recoveryBuffer },
  ]
  return (
    <ScenarioCard
      who={who} name={name}
      eyebrow="Critical illness"
      narrativeClause="were diagnosed with a critical illness tomorrow —"
      breakdown={ci}
      rows={rows}
      showDurations={false}
      timeline={ciTimeline}
      closingLine={buildCIClosingLine(name, ci)}
      recoveryWindowYears={ci.ciYears}
    />
  )
}

// Stacked DTPD-then-CI view for one person. Each card is followed by its
// existing coverage timeline chart, called exactly as DTPDBreakdownPage /
// CIBreakdownPage did before — same component, same props, untouched.
function ScenarioPage({ who, name, profile }: { who: 'client' | 'spouse'; name: string; profile: PersonProtectionProfile }) {
  const { dtpdTimeline, ciTimeline } = profile
  const dtpdCurrentAge = dtpdTimeline.points.length > 0 ? dtpdTimeline.points[0].age : null
  const ciCurrentAge = ciTimeline.points.length > 0 ? ciTimeline.points[0].age : null

  return (
    <div>
      <DTPDCard who={who} name={name} profile={profile} />
      {dtpdCurrentAge !== null && (
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>
            Coverage timeline
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 14 }}>
            How the capital need and existing portfolio evolve as {name} ages.
          </div>
          <CoverageTimelineChart name={name} timeline={dtpdTimeline} currentAge={dtpdCurrentAge} />
        </div>
      )}

      <CICard who={who} name={name} profile={profile} />
      {ciCurrentAge !== null && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>
            Coverage timeline
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 14 }}>
            How the capital need and existing portfolio evolve as {name} ages.
          </div>
          <CoverageTimelineChart name={name} timeline={ciTimeline} currentAge={ciCurrentAge} />
        </div>
      )}
    </div>
  )
}

// ─── Critical illness breakdown (card-based redesign, mirrors D/TPD above) ──
// CI's "have" side needs only one asset row (no cash/property split) since
// getAssetOffset(ff, who, 'ci', p) on Strategic Objectives is liquid-only —
// no CPF or property component to split out the way D/TPD's assetMitigation
// did. It also needs only one coverage row (existingCoverage) rather than an
// Active/Lifetime split — that categorization was tried for D/TPD and removed
// because it doesn't hold up against multiplier step-downs and term expiries;
// the coverage-timeline chart is the correct way to show coverage changing
// over time, not a point-in-time split.

// Same closing-line copy the old narrative version used — only the
// surrounding layout changed, not the voice.
function buildCIClosingLine(name: string, ci: PersonCIBreakdown): string {
  if (ci.maxCapitalRequired <= 0) return ''
  if (ci.status === 'covered') {
    return `${name}'s family already has enough in place to weather a critical illness without financial disruption.`
  }
  return `Unlike death, a critical illness leaves ${name} present but unable to provide. Closing this gap means the people around them can focus on recovery — not on making ends meet.`
}

function PersonStory({
  who, name, profile, page, onAdvance, editable, onOverrideChange,
}: {
  who: 'client' | 'spouse'
  name: string
  profile: PersonProtectionProfile
  page: Page
  onAdvance: (p: Page) => void
  editable?: boolean
  onOverrideChange?: (key: FrameworkRowKey, value: FrameworkRowStatus | undefined) => void
}) {
  if (page === 'overview') {
    return (
      <OverviewPage
        name={name}
        profile={profile}
        onContinue={() => onAdvance('dtpd')}
        editable={editable}
        onOverrideChange={onOverrideChange}
      />
    )
  }
  return <ScenarioPage who={who} name={name} profile={profile} />
}

export default function ProtectionDisplay({ snapshot, clientName, spouseName, editable, onFrameworkOverrideChange }: {
  snapshot: ProtectionSnapshot
  clientName: string
  spouseName?: string
  // When true (live report, before saving a snapshot), the framework ladder
  // rows render as editable dropdowns instead of plain status text. Omitted
  // (or false) on the frozen share-link view, where it's always read-only.
  editable?: boolean
  onFrameworkOverrideChange?: (who: 'client' | 'spouse', key: FrameworkRowKey, value: FrameworkRowStatus | undefined) => void
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

      {active === 'client' && (
        <PersonStory
          who="client"
          name={clientName}
          profile={snapshot.client}
          page={page}
          onAdvance={setPage}
          editable={editable}
          onOverrideChange={(key, value) => onFrameworkOverrideChange?.('client', key, value)}
        />
      )}
      {active === 'spouse' && snapshot.spouse && (
        <PersonStory
          who="spouse"
          name={spouseLabel}
          profile={snapshot.spouse}
          page={page}
          onAdvance={setPage}
          editable={editable}
          onOverrideChange={(key, value) => onFrameworkOverrideChange?.('spouse', key, value)}
        />
      )}
    </div>
  )
}
