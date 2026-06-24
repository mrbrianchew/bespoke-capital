'use client'
import { ExecutiveWealthSummarySnapshot } from '@/lib/executiveWealthSummarySnapshot'

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

function RatioTile({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div style={{ background: 'var(--cream2)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 8px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 21, color: 'var(--ink)' }}>{value}</div>
      <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink3)', marginTop: 5, lineHeight: 1.3 }}>{label}</div>
      {sublabel && <div style={{ fontSize: 9, color: 'var(--ink3)', marginTop: 1 }}>{sublabel}</div>}
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
            <RatioTile label="Savings Rate" value={`${snapshot.savingsRatePct}%`} />
            <RatioTile label="Debt-to-Asset" value={`${snapshot.debtToAssetPct}%`} />
            <RatioTile label="Net Worth Multiple" value={`${snapshot.netWorthMultiple}x`} sublabel="of income" />
          </div>

          {/* Emergency Cash Runway */}
          <div style={{ background: 'var(--emerald-l)', border: '1.5px solid var(--emerald)', borderRadius: 12, padding: '16px 20px', marginTop: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--emerald)', fontWeight: 600 }}>
              Emergency Cash Runway
            </div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 28, color: 'var(--ink)', marginTop: 4 }}>
              {snapshot.runwayMonths} months
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 8, lineHeight: 1.4 }}>
              {fmt(snapshot.liquidCash)} in cash &amp; fixed deposits covers {snapshot.runwayMonths} months of essential household expenses.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
