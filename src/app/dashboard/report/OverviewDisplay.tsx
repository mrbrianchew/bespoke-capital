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
          borderColor: '#FFFFFF',
          borderWidth: 3,
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

function BenchmarkBarChart({ data }: { data: { label: string; actualPct: number; benchmarkPct: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || data.length === 0) return
    const existing = Chart.getChart(ref.current)
    if (existing) existing.destroy()
    const ctx = ref.current.getContext('2d')
    if (!ctx) return
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [
          { label: 'Actual', data: data.map(d => d.actualPct), backgroundColor: '#A8834A', borderRadius: 4, maxBarThickness: 22 },
          { label: 'Benchmark', data: data.map(d => d.benchmarkPct), backgroundColor: '#1C1A17', borderRadius: 4, maxBarThickness: 22 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', align: 'end', labels: { boxWidth: 10, font: { size: 11 }, color: '#4A4740' } },
          tooltip: {
            ...tooltipBase(),
            callbacks: { label: (ctx: any) => `  ${ctx.dataset.label}: ${ctx.parsed.y}%` },
          },
        },
        scales: {
          x: { ticks: { font: { size: 10 }, color: '#9A9690', maxRotation: 45, minRotation: 45 }, grid: { display: false } },
          y: { ticks: { font: { size: 10 }, color: '#9A9690', callback: (v: any) => v + '%' }, grid: { color: '#ECE9E1' } },
        },
      },
    })
    return () => chart.destroy()
  }, [data])
  return <div style={{ position: 'relative', height: 240 }}><canvas ref={ref} /></div>
}

function Legend({ data, colors }: { data: { label: string; value: number }[]; colors: string[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: '4px 16px' }}>
      {data.map((d, i) => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: colors[i % colors.length], flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{d.label}</span>
        </div>
      ))}
    </div>
  )
}

function ListRow({ label, value, pct, color }: { label: string; value: number; pct: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: 'var(--ink2)', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: 'DM Mono, monospace', color: 'var(--ink)' }}>{fmt(value)}</span>
      <span style={{ fontSize: 11, color: 'var(--ink3)', width: 32, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

function ListRowWithBenchmark({ label, value, actualPct, benchmarkPct, color }: { label: string; value: number; actualPct: number; benchmarkPct: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: 'var(--ink2)', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: 'DM Mono, monospace', color: 'var(--ink)' }}>{fmt(value)}</span>
      <span style={{ fontSize: 11, color: 'var(--ink3)', width: 70, textAlign: 'right' }}>{actualPct}% <span style={{ color: '#C9C5BB' }}>vs {benchmarkPct}%</span></span>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)' }}>{label}</div>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 27, color: 'var(--ink)', marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{sub}</div>
    </div>
  )
}

export default function OverviewDisplay({ snapshot }: { snapshot: OverviewSnapshot }) {
  const hasBenchmark = snapshot.expenseBenchmark.length > 0

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 36 }}>
        <StatCard label="Net Worth" value={fmt(snapshot.netWorth)} sub="Liquid &amp; equity" />
        <StatCard label="Annual Inflow" value={fmt(snapshot.annualInflow)} sub="Gross income" />
        <StatCard label="Annual Surplus" value={fmt(snapshot.annualSurplus)} sub="Take-home minus expenses" />
      </div>

      {/* Asset composition */}
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 19, color: 'var(--ink)', marginBottom: 14 }}>
        Asset Composition &amp; Liabilities
      </div>
      <div style={{ background: '#FFFFFF', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 22px', marginBottom: 36 }}>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 28, alignItems: 'center' }}>
          <div>
            {snapshot.assetBreakdown.map((d, i) => (
              <ListRow key={d.label} label={d.label} value={d.value}
                pct={Math.round(d.value / Math.max(1, snapshot.assetBreakdown.reduce((s, x) => s + x.value, 0)) * 100)}
                color={ASSET_COLORS[i % ASSET_COLORS.length]} />
            ))}
          </div>
          <div>
            <DonutChart data={snapshot.assetBreakdown} colors={ASSET_COLORS} id="asset-donut" />
            <Legend data={snapshot.assetBreakdown} colors={ASSET_COLORS} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
          {snapshot.liabilities.map(l => (
            <div key={l.label} style={{ flex: 1, minWidth: 150, background: 'var(--cream2)', borderRadius: 12, padding: '12px 16px' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink3)' }}>{l.label}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: 'var(--rouge)', marginTop: 2 }}>{fmt(l.value)}</div>
            </div>
          ))}
          <div style={{ flex: 1, minWidth: 150, background: '#FFFFFF', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 16px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold-tag)', fontStyle: 'italic' }}>Net Worth</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 19, color: 'var(--ink)', marginTop: 2 }}>{fmt(snapshot.netWorth)}</div>
          </div>
        </div>
      </div>

      {/* Annual cashflow */}
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 19, color: 'var(--ink)', marginBottom: 14 }}>
        Annual Cashflow
      </div>
      <div style={{ background: '#FFFFFF', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 22px' }}>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 28, alignItems: 'center' }}>
          <div>
            {hasBenchmark
              ? snapshot.expenseBenchmark.map((d, i) => (
                  <ListRowWithBenchmark key={d.label} label={d.label} value={d.actualValue} actualPct={d.actualPct} benchmarkPct={d.benchmarkPct} color={ASSET_COLORS[i % ASSET_COLORS.length]} />
                ))
              : snapshot.expenseBreakdown.map((d, i) => (
                  <ListRow key={d.label} label={d.label} value={d.value}
                    pct={Math.round(d.value / Math.max(1, snapshot.expenseBreakdown.reduce((s, x) => s + x.value, 0)) * 100)}
                    color={ASSET_COLORS[i % ASSET_COLORS.length]} />
                ))}
          </div>
          <div>
            {hasBenchmark
              ? <BenchmarkBarChart data={snapshot.expenseBenchmark} />
              : <DonutChart data={snapshot.expenseBreakdown} colors={ASSET_COLORS} id="expense-donut" />}
          </div>
        </div>
      </div>
    </div>
  )
}
