'use client'
import { useState } from 'react'
import { ExecutiveWealthSummarySnapshot, RatioStatus } from '@/lib/executiveWealthSummarySnapshot'

function fmt(n: number): string {
  if (!n || isNaN(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-SG')
}

function LineRow({ label, sublabel, value, bold }: { label: string; sublabel?: string; value: number; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <div>
        <div style={{ fontSize: 14, color: bold ? 'var(--ink)' : 'var(--ink2)', fontWeight: bold ? 600 : 400, fontFamily: 'Cormorant Garamond, serif' }}>{label}</div>
        {sublabel && <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--ink3)', marginTop: 1 }}>{sublabel}</div>}
      </div>
      <span style={{ fontSize: 14, fontFamily: 'DM Mono, monospace', fontWeight: bold ? 600 : 400, color: bold ? 'var(--gold-tag)' : 'var(--ink)', flexShrink: 0, paddingLeft: 12 }}>
        {fmt(value)}
      </span>
    </div>
  )
}

function TotalRow({ label, value, dark }: { label: string; value: number; dark?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0 4px', marginTop: 4, borderTop: '2px solid var(--gold)' }}>
      <span style={{ fontSize: 15, fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, color: dark ? 'var(--gold-tag)' : 'var(--ink)' }}>{label}</span>
      <span style={{ fontSize: 17, fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, color: dark ? 'var(--gold-tag)' : 'var(--ink)' }}>{fmt(value)}</span>
    </div>
  )
}

const STATUS_STYLE: Record<RatioStatus, { bg: string; border: string; text: string }> = {
  good: { bg: 'var(--emerald-l)', border: 'var(--emerald)', text: 'var(--emerald)' },
  watch: { bg: 'var(--gold-l)', border: 'var(--gold)', text: 'var(--gold-tag)' },
  concern: { bg: 'var(--rouge-l)', border: 'var(--rouge)', text: 'var(--rouge)' },
}

function RatioTile({ label, value, sublabel, explainer, range, status }: { label: string; value: string; sublabel?: string; explainer: string; range: string; status: RatioStatus }) {
  const s = STATUS_STYLE[status]
  // Visible on hover (desktop) OR while pinned open by a click/tap (so it also
  // works on touch devices, which don't fire hover events). Click toggles the pin.
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hovered || pinned
  return (
    <div
      style={{ position: 'relative', background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 10, padding: '14px 10px', textAlign: 'center', cursor: 'pointer' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => setPinned(p => !p)}
    >
      <div style={{
        position: 'absolute', top: 6, right: 6, width: 14, height: 14, borderRadius: '50%',
        border: `1px solid ${s.border}`, color: s.text, fontSize: 9, fontWeight: 600,
        fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>i</div>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 21, color: s.text }}>{value}</div>
      <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink2)', fontWeight: 600, marginTop: 5, lineHeight: 1.3 }}>{label}</div>
      {sublabel && <div style={{ fontSize: 9, color: 'var(--ink3)', marginTop: 1 }}>{sublabel}</div>}

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
          marginTop: 8, width: 200, background: 'var(--charcoal)', color: '#F0EDE8',
          borderRadius: 8, padding: '10px 12px', fontSize: 11, lineHeight: 1.45,
          textAlign: 'left', zIndex: 30, boxShadow: '0 8px 20px rgba(0,0,0,0.28)',
        }}>
          <div>{explainer}</div>
          <div style={{ marginTop: 7, paddingTop: 7, borderTop: '1px solid rgba(240,237,232,0.18)', fontSize: 10, color: 'rgba(240,237,232,0.7)' }}>{range}</div>
        </div>
      )}
    </div>
  )
}

export default function ExecutiveWealthSummaryDisplay({ snapshot }: { snapshot: ExecutiveWealthSummarySnapshot }) {
  const year = new Date(snapshot.generatedAt).getFullYear()
  return (
    <div>
      {/* Title + description — replaces the person-card row for this tab */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 28, color: 'var(--ink)' }}>
          Executive Wealth Summary
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>
          A consolidated view of {snapshot.client.name}{snapshot.spouse ? ` & ${snapshot.spouse.name}` : ''}'s assets, liabilities and annual cashflow as at {year}.
        </div>
      </div>

      {/* Net Worth hero box */}
      <div style={{ background: '#F5EFE3', border: '1.5px solid var(--gold)', borderRadius: 14, padding: '22px 26px', marginBottom: 32 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gold-tag)', fontWeight: 600 }}>
          Total Consolidated Net Worth
        </div>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 38, color: 'var(--ink)', marginTop: 6 }}>
          {fmt(snapshot.netWorth)}
        </div>
        <div style={{ borderTop: '1px solid rgba(168,131,74,0.3)', marginTop: 14, paddingTop: 12, fontSize: 13, color: 'var(--ink2)' }}>
          {snapshot.takeaway}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 40 }}>
        {/* LEFT: Assets & Liabilities */}
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>
            Consolidated Assets
          </div>
          {snapshot.assetBreakdown.map(d => (
            <LineRow key={d.label} label={d.label} sublabel={d.sublabel} value={d.value} />
          ))}
          <TotalRow label="Total Assets" value={snapshot.totalAssets} dark />

          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginTop: 32, marginBottom: 8 }}>
            Consolidated Liabilities
          </div>
          {snapshot.liabilities.map(d => (
            <LineRow key={d.label} label={d.label} sublabel={d.sublabel} value={d.value} />
          ))}
          <TotalRow label="Total Liabilities" value={snapshot.totalLiabilities} />
        </div>

        {/* RIGHT: Cashflow */}
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>
            Annual Household Cashflow
          </div>
          {snapshot.perPersonInflow.map(p => (
            <LineRow key={p.name} label={p.name} value={p.takeHome} />
          ))}
          <TotalRow label="Total Inflows" value={snapshot.totalInflow} dark />
          <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--ink3)', marginTop: -2, marginBottom: 14 }}>Take-home</div>

          {snapshot.expenseBreakdown.map(d => (
            <LineRow key={d.label} label={d.label} value={d.value} />
          ))}
          <TotalRow label="Total Outflows" value={snapshot.totalOutflow} />

          <div style={{ background: 'var(--charcoal)', borderRadius: 12, padding: '18px 22px', marginTop: 22, textAlign: 'center' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(240,237,232,0.6)' }}>
              Annual Deployable Cash Surplus
            </div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 30, color: 'var(--gold)', marginTop: 6 }}>
              {fmt(snapshot.annualSurplus)}
            </div>
          </div>

          {/* Key Financial Ratios */}
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginTop: 28, marginBottom: 10 }}>
            Key Financial Ratios
          </div>
          <div className="grid grid-cols-3" style={{ gap: 10 }}>
            <RatioTile
              label="Savings Rate"
              value={`${snapshot.savingsRatePct}%`}
              status={snapshot.savingsRateStatus}
              explainer="Share of take-home income converted into annual surplus."
              range={snapshot.savingsRateRange}
            />
            <RatioTile
              label="Debt-to-Asset"
              value={`${snapshot.debtToAssetPct}%`}
              status={snapshot.debtToAssetStatus}
              explainer="Portion of total assets financed by debt."
              range={snapshot.debtToAssetRange}
            />
            <RatioTile
              label="Investment Ratio"
              value={`${snapshot.investmentRatioPct}%`}
              sublabel="of net worth"
              status={snapshot.investmentRatioStatus}
              explainer="Share of net worth held in growth/income-producing assets, excluding the primary residence and CPF."
              range={snapshot.investmentRatioRange}
            />
          </div>
        </div>
      </div>

      {/* Emergency Cash Runway — full-width band below both columns, deliberately
          outside the grid so it always sits beneath whichever column runs longer. */}
      <div style={{
        background: 'var(--emerald-l)', border: '1.5px solid var(--emerald)', borderRadius: 12,
        padding: '18px 24px', marginTop: 32, display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', flexWrap: 'wrap', gap: 16,
      }}>
        <div style={{ maxWidth: 480 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--emerald)', fontWeight: 600 }}>
            Emergency Cash Runway
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 6, lineHeight: 1.4 }}>
            {fmt(snapshot.liquidCash)} in cash &amp; fixed deposits covers this many months of essential household expenses (excludes Lifestyle &amp; Miscellaneous, which would simply pause in an emergency).
          </div>
        </div>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 32, color: 'var(--ink)', flexShrink: 0 }}>
          {snapshot.runwayMonths.toFixed(1)} months
        </div>
      </div>
    </div>
  )
}
