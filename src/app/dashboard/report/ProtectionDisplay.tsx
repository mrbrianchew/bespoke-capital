'use client'
import { ProtectionDTPDSnapshot, PersonProtectionBreakdown } from '@/lib/protectionSnapshot'

function fmt(n: number): string {
  if (!n || isNaN(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-SG')
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', padding: '9px 0',
      borderBottom: '1px solid var(--line)',
    }}>
      <span style={{ fontSize: 13, color: bold ? 'var(--ink)' : 'var(--ink2)', fontWeight: bold ? 500 : 400 }}>{label}</span>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)', fontWeight: bold ? 500 : 400 }}>{fmt(value)}</span>
    </div>
  )
}

function PersonSection({ name, breakdown }: { name: string; breakdown: PersonProtectionBreakdown }) {
  const isShortfall = breakdown.status === 'shortfall'
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Capital protection analysis</div>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'var(--ink)' }}>Death &amp; TPD: {name}</div>
      </div>

      <div style={{
        background: isShortfall ? '#F2EAEA' : '#E8F2ED',
        border: `1px solid ${isShortfall ? 'var(--rouge)' : 'var(--emerald)'}`,
        borderRadius: 10, padding: '14px 18px', marginBottom: 20,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: isShortfall ? '#8A2828' : 'var(--emerald)' }}>
            {isShortfall ? 'Shortfall' : 'Fully covered'}
          </div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 24, color: isShortfall ? '#8A2828' : 'var(--emerald)' }}>
            {fmt(breakdown.shortfall)}
          </div>
        </div>
        <span style={{
          fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase',
          padding: '4px 12px', borderRadius: 12,
          background: isShortfall ? '#8A2828' : 'var(--emerald)', color: '#fff',
        }}>
          {isShortfall ? 'Severe shortfall' : 'Covered'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 28 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>
            Protection objectives (needs)
          </div>
          <Row label="Family Dependency Protection" value={breakdown.familyDependency} />
          <Row label="Mortgage &amp; Debt Clearance" value={breakdown.mortgageDebtClearance} />
          <Row label="Dependent(s) Tertiary Funding" value={breakdown.tertiaryFunding} />
          <Row label="Max Capital Required" value={breakdown.maxCapitalRequired} bold />
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>
            Existing infrastructure (have)
          </div>
          <Row label="Asset Mitigation" value={breakdown.assetMitigation} />
          <Row label="Existing Coverage" value={breakdown.existingCoverage} />
        </div>
      </div>
    </div>
  )
}

export default function ProtectionDisplay({ snapshot, clientName, spouseName }: {
  snapshot: ProtectionDTPDSnapshot
  clientName: string
  spouseName?: string
}) {
  return (
    <div>
      <PersonSection name={clientName} breakdown={snapshot.client} />
      {snapshot.spouse && <PersonSection name={spouseName || 'Spouse'} breakdown={snapshot.spouse} />}
    </div>
  )
}
