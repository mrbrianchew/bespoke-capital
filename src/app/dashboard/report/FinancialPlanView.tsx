'use client'
import { useState } from 'react'
import { OverviewSnapshot } from '@/lib/financialPlanSnapshot'
import { ProtectionDTPDSnapshot } from '@/lib/protectionSnapshot'
import OverviewDisplay from './OverviewDisplay'
import ProtectionDisplay from './ProtectionDisplay'

export interface PlanSnapshot {
  clientName: string
  spouseName?: string
  overview: OverviewSnapshot
  protection: ProtectionDTPDSnapshot
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'protection', label: 'Protection' },
  { id: 'capital', label: 'Capital Fund', comingSoon: true },
  { id: 'recommendations', label: 'Recommendations', comingSoon: true },
]

export default function FinancialPlanView({ plan }: { plan: PlanSnapshot }) {
  const [active, setActive] = useState('overview')
  const generatedDate = new Date(plan.overview.generatedAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div style={{ background: '#F5F3EE', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }}>
      {/* Hero + tabs */}
      <div style={{ background: 'var(--charcoal)', padding: '36px 44px 0' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(240,237,232,0.4)' }}>
          Bespoke Capital · Private Wealth
        </div>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 32, fontWeight: 600, color: '#F5F0E8', marginTop: 6 }}>
          {plan.clientName}{plan.spouseName ? ` & ${plan.spouseName}` : ''}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(240,237,232,0.45)', fontStyle: 'italic', marginTop: 4, marginBottom: 22 }}>
          Financial Plan · As of {generatedDate}
        </div>

        <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => !t.comingSoon && setActive(t.id)}
              disabled={t.comingSoon}
              style={{
                background: 'none', border: 'none', cursor: t.comingSoon ? 'default' : 'pointer',
                padding: '10px 14px', fontSize: 12, letterSpacing: '0.02em', fontFamily: 'Inter, sans-serif',
                color: t.comingSoon ? 'rgba(240,237,232,0.25)' : active === t.id ? '#F5F0E8' : 'rgba(240,237,232,0.55)',
                borderBottom: active === t.id ? '2px solid var(--gold)' : '2px solid transparent',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {t.label}{t.comingSoon ? ' (soon)' : ''}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '32px 44px 44px' }}>
        {active === 'overview' && <OverviewDisplay snapshot={plan.overview} />}
        {active === 'protection' && (
          <ProtectionDisplay snapshot={plan.protection} clientName={plan.clientName} spouseName={plan.spouseName} />
        )}
      </div>
    </div>
  )
}
