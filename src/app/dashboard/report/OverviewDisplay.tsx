'use client'
import { useEffect, useRef } from 'react'
import { Chart, registerables } from 'chart.js'
import { OverviewSnapshot } from '@/lib/financialPlanSnapshot'

Chart.register(...registerables)

function fmt(n: number): string {
  if (!n || isNaN(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-SG')
}

const ASSET_COLORS = ['#A8834A', '#2A5E46', '#7A9CBF', '#8A6C3A', '#1C1A17']
const EXPENSE_COLORS = ['#A8834A', '#1C1A17', '#2A5E46', '#7A9CBF', '#9A7C5A', '#8A2828']

function tooltipBase() {
  return {
    backgroundColor: 'rgba(28,26,23,0.95)',
    titleColor: 'rgba(196,164,100,0.9)',
    bodyColor: 'rgba(240,237,232,0.9)',
    padding: 12,
    titleFont: { size: 12, weight: 'bold' as const },
    bodyFont: { size: 12 },
    callbacks: {
      label: (ctx: any) => `  ${ctx.label}: ${fmt(ctx.parsed)}`,
    },
  }
}

function DonutChart({ data, colors, id }: { data: { label: string; value: number }[]; colors: string[]; id: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const existing = Chart.getChart(ref.current)
    if (existing) existing.destroy()
    const ctx = ref.current.getContext('2d')
    if (!ctx) return
    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          data: data.map(d => d.value),
          backgroundColor: colors,
          borderColor: '#F5F3EE',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: tooltipBase(),
        },
      },
    })
    return () => chart.destroy()
  }, [data, colors])
  return <div style={{ position: 'relative', height: 220 }}><canvas key={id} ref={ref} /></div>
}

function Legend({ data, colors }: { data: { label: string; value: number }[]; colors: string[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div>
      {data.map((d, i) => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < data.length - 1 ? '1px solid var(--line)' : 'none' }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: colors[i % colors.length], flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--ink2)', flex: 1 }}>{d.label}</span>
          <span style={{ fontSize: 13, fontFamily: 'DM Mono, monospace', color: 'var(--ink)' }}>{fmt(d.value)}</span>
          <span style={{ fontSize: 11, color: 'var(--ink3)', width: 38, textAlign: 'right' }}>
            {total > 0 ? Math.round((d.value / total) * 100) : 0}%
          </span>
        </div>
      ))}
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ background: 'var(--cream2)', borderRadius: 10, padding: '16px 18px' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)' }}>{label}</div>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 26, color: 'var(--ink)', marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{sub}</div>
    </div>
  )
}

export default function OverviewDisplay({ snapshot }: { snapshot: OverviewSnapshot }) {
  const generatedDate = new Date(snapshot.generatedAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })
  const totalLiabilities = snapshot.liabilities.reduce((s, l) => s + l.value, 0)

  return (
    <div style={{ background: '#F5F3EE', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }}>
      {/* Hero */}
      <div style={{ background: 'var(--charcoal)', padding: '36px 44px 30px' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(240,237,232,0.4)' }}>
          Bespoke Capital · Private Wealth
        </div>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 32, fontWeight: 600, color: '#F5F0E8', marginTop: 6 }}>
          {snapshot.client.name}{snapshot.spouse ? ` & ${snapshot.spouse.name}` : ''}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(240,237,232,0.45)', fontStyle: 'italic', marginTop: 4 }}>
          Financial Plan Overview · As of {generatedDate}
        </div>

        <div style={{ display: 'flex', gap: 28, marginTop: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(240,237,232,0.35)' }}>Primary Client</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, color: '#F0EDE6' }}>{snapshot.client.name} · Age {snapshot.client.age}</div>
          </div>
          {snapshot.spouse && (
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(240,237,232,0.35)' }}>Spouse</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, color: '#F0EDE6' }}>{snapshot.spouse.name} · Age {snapshot.spouse.age}</div>
            </div>
          )}
          {snapshot.dependents.length > 0 && (
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(240,237,232,0.35)' }}>Dependents</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, color: '#F0EDE6' }}>
                {snapshot.dependents.map(d => `${d.name} (${d.age})`).join('  ·  ')}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '32px 44px 44px' }}>
        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 32 }}>
          <StatCard label="Net Worth" value={fmt(snapshot.netWorth)} sub="Liquid &amp; equity" />
          <StatCard label="Annual Inflow" value={fmt(snapshot.annualInflow)} sub="Gross income" />
          <StatCard
            label="Annual Surplus"
            value={fmt(snapshot.annualSurplus)}
            sub="Take-home minus expenses"
          />
        </div>

        {/* Asset composition */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 19, color: 'var(--ink)' }}>Asset Composition &amp; Liabilities</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 28, marginBottom: 36, alignItems: 'center' }}>
          <Legend data={snapshot.assetBreakdown} colors={ASSET_COLORS} />
          <DonutChart data={snapshot.assetBreakdown} colors={ASSET_COLORS} id="asset-donut" />
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 36, flexWrap: 'wrap' }}>
          {snapshot.liabilities.map(l => (
            <div key={l.label} style={{ flex: 1, minWidth: 160, background: 'var(--cream2)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink3)' }}>{l.label}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: 'var(--rouge)', marginTop: 2 }}>{fmt(l.value)}</div>
            </div>
          ))}
          <div style={{ flex: 1, minWidth: 160, background: '#F5EFE3', border: '1px solid var(--gold)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold-tag)' }}>Net Worth</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 19, color: 'var(--gold-tag)', marginTop: 2 }}>{fmt(snapshot.netWorth)}</div>
          </div>
        </div>

        {/* Expense breakdown */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 19, color: 'var(--ink)' }}>Annual Cashflow</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 28, alignItems: 'center' }}>
          <Legend data={snapshot.expenseBreakdown} colors={EXPENSE_COLORS} />
          <DonutChart data={snapshot.expenseBreakdown} colors={EXPENSE_COLORS} id="expense-donut" />
        </div>
      </div>
    </div>
  )
}
