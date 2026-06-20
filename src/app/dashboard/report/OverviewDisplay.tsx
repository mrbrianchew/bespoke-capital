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
const EXPENSE_COLORS = ['#A8834A', '#1C1A17', '#2A5E46', '#7A9CBF', '#9A7C5A', '#8A2828', '#C9A65F', '#5A7A8A']

function tooltipBase() {
  return {
    backgroundColor: 'rgba(28,26,23,0.95)',
    titleColor: 'rgba(196,164,100,0.9)',
    bodyColor: 'rgba(240,237,232,0.9)',
    padding: 12,
    titleFont: { size: 12, weight: 'bold' as const },
    bodyFont: { size: 12 },
  }
}

function DonutChart({ data, colors, id }: { data: { label: string; value: number }[]; colors: string[]; id: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || data.length === 0) return
    const existing = Chart.getChart(ref.current)
    if (existing) existing.destroy()
    const ctx = ref.current.getContext('2d')
    if (!ctx) return
    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.label),
        datasets: [{ data: data.map(d => d.value), backgroundColor: colors, borderColor: '#FFFFFF', borderWidth: 3 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipBase(),
            callbacks: { label: (ctx: any) => `  ${ctx.label}: ${fmt(ctx.parsed)}` },
          },
        },
      },
      plugins: [{
        id: 'pctLabels',
        afterDraw(chart: any) {
          const { ctx: c } = chart
          const meta = chart.getDatasetMeta(0)
          const total = data.reduce((s, d) => s + d.value, 0)
          c.save()
          c.font = '10px Inter, sans-serif'
          c.fillStyle = '#FFFFFF'
          c.textAlign = 'center'
          c.textBaseline = 'middle'
          meta.data.forEach((arc: any, i: number) => {
            const pct = total > 0 ? Math.round((data[i].value / total) * 100) : 0
            if (pct < 3) return
            const point = arc.getCenterPoint()
            c.fillText(pct + '%', point.x, point.y)
          })
          c.restore()
        },
      }],
    })
    return () => chart.destroy()
  }, [data, colors])
  return <div style={{ position: 'relative', height: 190 }}><canvas key={id} ref={ref} /></div>
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
          { label: 'Actual', data: data.map(d => d.actualPct), backgroundColor: '#A8834A', borderRadius: 4, maxBarThickness: 18 },
          { label: 'Benchmark', data: data.map(d => d.benchmarkPct), backgroundColor: '#1C1A17', borderRadius: 4, maxBarThickness: 18 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', align: 'end', labels: { boxWidth: 10, font: { size: 11 }, color: '#4A4740' } },
          tooltip: { ...tooltipBase(), callbacks: { label: (ctx: any) => `  ${ctx.dataset.label}: ${ctx.parsed.y}%` } },
        },
        scales: {
          x: { ticks: { font: { size: 10.5 }, color: '#9A9690', maxRotation: 28, minRotation: 28, autoSkip: false }, grid: { display: false } },
          y: { ticks: { font: { size: 10 }, color: '#9A9690', callback: (v: any) => v + '%' }, grid: { color: '#ECE9E1' } },
        },
      },
    })
    return () => chart.destroy()
  }, [data])
  return <div style={{ position: 'relative', height: 240 }}><canvas ref={ref} /></div>
}

function Legend({ data, colors }: { data: { label: string; value: number }[]; colors: string[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: '4px 16px', marginTop: 12 }}>
      {data.map((d, i) => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: colors[i % colors.length], flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{d.label}</span>
        </div>
      ))}
    </div>
  )
}

function PlainRow({ label, value, italic }: { label: string; value: number; italic?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ fontSize: 13, color: 'var(--ink2)', fontStyle: italic ? 'italic' : 'normal' }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: 'DM Mono, monospace', color: 'var(--ink)' }}>{value > 0 ? fmt(value) : '—'}</span>
    </div>
  )
}

function CashflowRow({ label, value, actualPct, benchmarkPct }: { label: string; value: number; actualPct: number; benchmarkPct?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ fontSize: 13, color: 'var(--ink2)', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: 'DM Mono, monospace', color: 'var(--ink)' }}>{fmt(value)}</span>
      <span style={{ fontSize: 11, color: 'var(--ink3)', width: typeof benchmarkPct === 'number' ? 78 : 32, textAlign: 'right' }}>
        {actualPct}%{typeof benchmarkPct === 'number' && <span style={{ color: '#C9C5BB' }}> vs {benchmarkPct}%</span>}
      </span>
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
  const otherDebts = snapshot.liabilities.find(l => l.label === 'Other Debts')
  const mortgage = snapshot.liabilities.find(l => l.label !== 'Other Debts')

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 36 }}>
        <StatCard label="Net Worth" value={fmt(snapshot.netWorth)} sub="Liquid &amp; equity" />
        <StatCard label="Annual Inflow" value={fmt(snapshot.annualInflow)} sub="Gross income" />
        <StatCard label="Annual Surplus" value={fmt(snapshot.annualSurplus)} sub="Take-home minus expenses" />
      </div>

      {/* Asset composition & liabilities — plain two-column list, no chart */}
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 19, color: 'var(--ink)', marginBottom: 14 }}>
        Asset Composition &amp; Liabilities
      </div>
      <div style={{ background: '#FFFFFF', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 22px', marginBottom: 36 }}>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 32 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Asset Composition</div>
            {snapshot.assetBreakdown.map(d => <PlainRow key={d.label} label={d.label} value={d.value} italic />)}
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Liabilities</div>
            {mortgage && <PlainRow label={mortgage.label} value={mortgage.value} italic />}
            {otherDebts && <PlainRow label={otherDebts.label} value={otherDebts.value} italic />}
            <div style={{ background: '#F5EFE3', border: '1.5px solid var(--gold)', borderRadius: 12, padding: '14px 18px', marginTop: 14 }}>
              <div style={{ fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold-tag)', fontWeight: 600 }}>Net Worth</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 28, color: 'var(--ink)', marginTop: 4 }}>{fmt(snapshot.netWorth)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Annual cashflow — donut (composition) + bar chart (actual vs benchmark) */}
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 19, color: 'var(--ink)', marginBottom: 14 }}>
        Annual Cashflow
      </div>
      <div style={{ background: '#FFFFFF', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 22px' }}>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 28, alignItems: 'start' }}>
          <div>
            {hasBenchmark
              ? snapshot.expenseBenchmark.map(d => (
                  <CashflowRow key={d.label} label={d.label} value={d.actualValue} actualPct={d.actualPct} benchmarkPct={d.benchmarkPct} />
                ))
              : snapshot.expenseBreakdown.map(d => {
                  const total = snapshot.expenseBreakdown.reduce((s, x) => s + x.value, 0)
                  return <CashflowRow key={d.label} label={d.label} value={d.value} actualPct={Math.round(d.value / Math.max(1, total) * 100)} />
                })}
          </div>
          <div>
            <DonutChart data={snapshot.expenseBreakdown} colors={EXPENSE_COLORS} id="expense-donut" />
            <Legend data={snapshot.expenseBreakdown} colors={EXPENSE_COLORS} />
          </div>
        </div>
        {hasBenchmark && (
          <div style={{ marginTop: 28, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 10 }}>Actual vs Benchmark</div>
            <BenchmarkBarChart data={snapshot.expenseBenchmark} />
          </div>
        )}
      </div>
    </div>
  )
}
