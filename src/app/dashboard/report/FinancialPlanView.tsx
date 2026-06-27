'use client'
import { useState } from 'react'
import { OverviewSnapshot } from '@/lib/financialPlanSnapshot'
import { ProtectionSnapshot, FrameworkRowKey, FrameworkRowStatus } from '@/lib/protectionSnapshot'
import { ExecutiveWealthSummarySnapshot } from '@/lib/executiveWealthSummarySnapshot'
import { CapitalFundSnapshot } from '@/lib/capitalFundSnapshot'
import OverviewDisplay from './OverviewDisplay'
import ProtectionDisplay from './ProtectionDisplay'
import ExecutiveWealthSummaryDisplay from './ExecutiveWealthSummaryDisplay'
import CapitalFundDisplay from './CapitalFundDisplay'

export interface PlanSnapshot {
  clientName: string
  spouseName?: string
  overview: OverviewSnapshot
  protection: ProtectionSnapshot
  executiveSummary: ExecutiveWealthSummarySnapshot
  capitalFund: CapitalFundSnapshot
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'wealth-summary', label: 'Wealth Summary' },
  { id: 'protection', label: 'Protection' },
  { id: 'capital', label: 'Capital Fund' },
  { id: 'recommendations', label: 'Recommendations', comingSoon: true },
]

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function PersonCard({ label, name, age, color }: { label: string; name: string; age?: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 160, background: '#FFFFFF', border: '1px solid var(--line)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 38, height: 38, borderRadius: '50%', background: color, color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 500, flexShrink: 0 }}>
        {initials(name)}
      </div>
      <div>
        <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)' }}>{label}</div>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>
          {name}{typeof age === 'number' && <span style={{ fontSize: 12, color: 'var(--ink3)', fontFamily: 'Inter, sans-serif' }}> · Age {age}</span>}
        </div>
      </div>
    </div>
  )
}

export default function FinancialPlanView({
  plan, editable, onFrameworkOverrideChange,
}: {
  plan: PlanSnapshot
  editable?: boolean
  onFrameworkOverrideChange?: (who: 'client' | 'spouse', key: FrameworkRowKey, value: FrameworkRowStatus | undefined) => void
}) {
  const [active, setActive] = useState('overview')
  const generatedDate = new Date(plan.overview.generatedAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div style={{ background: '#F5F3EE', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }}>
      {/* Hero + tabs */}
      <div className="px-5 md:px-11" style={{ background: 'var(--charcoal)', paddingTop: 26, paddingBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="text-2xl md:text-[30px]" style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, color: '#F5F0E8' }}>
              {plan.clientName}{plan.spouseName ? ` & ${plan.spouseName}` : ''}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(240,237,232,0.45)', fontStyle: 'italic', marginTop: 4 }}>
              Financial Plan · As of {generatedDate}
            </div>
          </div>
          <div style={{
            background: '#F5F0E8', color: 'var(--charcoal)', borderRadius: 999,
            padding: '7px 18px', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500,
          }}>
            {TABS.find(t => t.id === active)?.label}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 22, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => !t.comingSoon && setActive(t.id)}
              disabled={t.comingSoon}
              style={{
                background: t.comingSoon ? 'none' : active === t.id ? '#F5F0E8' : 'rgba(240,237,232,0.08)',
                border: 'none', cursor: t.comingSoon ? 'default' : 'pointer', borderRadius: 999,
                padding: '8px 16px', fontSize: 12, letterSpacing: '0.02em', fontFamily: 'Inter, sans-serif',
                color: t.comingSoon ? 'rgba(240,237,232,0.25)' : active === t.id ? 'var(--charcoal)' : 'rgba(240,237,232,0.65)',
                fontWeight: active === t.id ? 500 : 400,
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {t.label}{t.comingSoon ? ' (soon)' : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 md:px-11" style={{ paddingTop: 22, paddingBottom: 36 }}>
        {active !== 'wealth-summary' && active !== 'protection' && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
            <PersonCard label="Primary Client" name={plan.clientName} age={plan.overview.client.age} color="var(--gold)" />
            {plan.overview.spouse && (
              <PersonCard label="Spouse" name={plan.overview.spouse.name} age={plan.overview.spouse.age} color="var(--emerald)" />
            )}
            {plan.overview.dependents.map(d => (
              <PersonCard key={d.name} label="Dependent" name={d.name} age={d.age} color="#7A9CBF" />
            ))}
          </div>
        )}

        {active === 'overview' && <OverviewDisplay snapshot={plan.overview} />}
        {active === 'wealth-summary' && <ExecutiveWealthSummaryDisplay snapshot={plan.executiveSummary} />}
        {active === 'protection' && (
          <ProtectionDisplay
            snapshot={plan.protection}
            clientName={plan.clientName}
            spouseName={plan.spouseName}
            editable={editable}
            onFrameworkOverrideChange={onFrameworkOverrideChange}
          />
        )}
        {active === 'capital' && (
          <CapitalFundDisplay snapshot={plan.capitalFund} clientName={plan.clientName} spouseName={plan.spouseName} />
        )}
      </div>
    </div>
  )
}
