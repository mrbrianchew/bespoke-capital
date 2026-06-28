'use client'
import { useState, useMemo, useEffect, useRef } from 'react'
import { GraduationCap, Palmtree, Coins } from 'lucide-react'
import { Chart, registerables } from 'chart.js'
import { CapitalFundSnapshot, CapitalFundChartPoint, CapitalFundFullSeries } from '@/lib/capitalFundSnapshot'

Chart.register(...registerables)

function fmt(n: number): string {
  if (!n || isNaN(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-SG')
}
function fmtMo(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-SG') + '/mo'
}
function fmtAge(displayAge: number, isCouple: boolean, clientAge: number, spouseAge: number): string {
  if (!isCouple) return `Age ${displayAge}`
  const spouseDisplayAge = spouseAge + (displayAge - clientAge)
  return `Age ${displayAge} / ${spouseDisplayAge}`
}
// Couple-aware "XX/YY" pairing for each person's own retirement age (or years
// to retirement) — unlike fmtAge above, this does NOT extrapolate the spouse's
// value from the age gap; it shows each person's independently-set figure.
function fmtAgePair(clientVal: number, spouseVal: number, isCouple: boolean): string {
  return isCouple ? `${clientVal}/${spouseVal}` : `${clientVal}`
}
function fmtCompact(n: number): string {
  if (!n || isNaN(n)) return '$0'
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M'
  if (n >= 1000) return '$' + Math.round(n / 1000) + 'K'
  return fmt(n)
}
function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}
function objectiveIcon(id: string) {
  if (id === 'retirement') return Palmtree
  if (id.startsWith('edu_')) return GraduationCap
  return Coins
}

// Catmull-Rom → cubic Bezier smoothing, same technique used elsewhere in the
// report for chart lines.
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]}`
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? i : i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2 === pts.length ? i + 1 : i + 2]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  return d
}

function CapitalChart({ target, projection, currentAge, retirementAge }: {
  target: CapitalFundChartPoint[]; projection: CapitalFundChartPoint[]; currentAge: number; retirementAge: number
}) {
  const [hoverAge, setHoverAge] = useState<number | null>(null)
  const W = 900, H = 300, PL = 56, PR = 16, PT = 14, PB = 30
  const iW = W - PL - PR, iH = H - PT - PB
  const minA = currentAge, maxA = Math.max(retirementAge, currentAge + 1)
  const xP = (a: number) => PL + ((a - minA) / (maxA - minA)) * iW
  const maxV = useMemo(() => Math.max(1, ...target.map(p => p.value), ...projection.map(p => p.value)) * 1.05, [target, projection])
  const yP = (v: number) => PT + iH - Math.min(1, v / maxV) * iH
  const toXY = (arr: CapitalFundChartPoint[]): [number, number][] => arr.map(p => [xP(p.age), yP(p.value)])
  const fmtY = (n: number) => n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + Math.round(n / 1000) + 'K' : '$' + Math.round(n)

  const tgtXY = toXY(target)
  const areaPath = tgtXY.length > 1
    ? `${smoothPath(tgtXY)} L ${tgtXY[tgtXY.length - 1][0]} ${PT + iH} L ${tgtXY[0][0]} ${PT + iH} Z`
    : ''

  function interp(arr: CapitalFundChartPoint[], age: number): number {
    if (arr.length === 0) return 0
    const sorted = arr
    let lo = sorted.filter(p => p.age <= age).pop() || sorted[0]
    let hi = sorted.filter(p => p.age >= age).shift() || sorted[sorted.length - 1]
    if (lo.age === hi.age) return lo.value
    const t = (age - lo.age) / (hi.age - lo.age)
    return lo.value + (hi.value - lo.value) * t
  }

  function handleMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (W / rect.width)
    const rel = Math.min(1, Math.max(0, (mx - PL) / iW))
    setHoverAge(Math.round(minA + rel * (maxA - minA)))
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="cf-gold-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const y = PT + iH - f * iH
          return (
            <g key={f}>
              <line x1={PL} y1={y} x2={PL + iW} y2={y} stroke="var(--cream3)" strokeWidth={1} />
              {f > 0 && <text x={PL - 8} y={y + 3.5} fontSize={9} fill="var(--ink3)" textAnchor="end">{fmtY(maxV * f)}</text>}
            </g>
          )
        })}
        {areaPath && <path d={areaPath} fill="url(#cf-gold-fade)" stroke="none" />}
        <path d={smoothPath(toXY(projection))} stroke="var(--teal,#4A8A86)" strokeWidth={2} fill="none" strokeLinecap="round" />
        <path d={smoothPath(tgtXY)} stroke="var(--gold)" strokeWidth={2.5} fill="none" strokeLinecap="round" />
        <line x1={PL} y1={PT + iH} x2={PL + iW} y2={PT + iH} stroke="var(--line2)" strokeWidth={1} />
        {Array.from({ length: Math.floor((maxA - minA) / 4) + 1 }, (_, i) => minA + i * 4).concat([maxA]).map(a => (
          <text key={a} x={xP(a)} y={PT + iH + 16} fontSize={9} fill="var(--ink3)" textAnchor="middle">{a}</text>
        ))}
        {hoverAge != null && (
          <line x1={xP(hoverAge)} y1={PT} x2={xP(hoverAge)} y2={PT + iH} stroke="var(--ink3)" strokeWidth={1} strokeDasharray="2,3" opacity={0.5} />
        )}
        <rect x={PL} y={0} width={iW} height={H} fill="transparent" onMouseMove={handleMove} onMouseLeave={() => setHoverAge(null)} />
      </svg>
      {hoverAge != null && (() => {
        const leftPct = Math.min(Math.max(((xP(hoverAge) - PL) / iW) * 100, 12), 88)
        return (
          <div style={{
            position: 'absolute', left: `${leftPct}%`, top: 4, transform: 'translateX(-50%)',
            background: 'var(--charcoal)', color: '#F0EDE6', padding: '12px 16px', borderRadius: 10,
            fontSize: 11, pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>
            <div style={{ color: '#C9A876', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Age {hoverAge}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
              <span style={{ color: 'rgba(245,240,232,0.5)', fontSize: 10, textTransform: 'uppercase' }}>Target</span>
              <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600 }}>{fmtY(interp(target, hoverAge))}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
              <span style={{ color: 'rgba(245,240,232,0.5)', fontSize: 10, textTransform: 'uppercase' }}>Projection</span>
              <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, color: '#4A8A86' }}>{fmtY(interp(projection, hoverAge))}</span>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function CapitalChartFull({ series, inflationRate }: { series: CapitalFundFullSeries; inflationRate: number }) {
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<any>(null)

  useEffect(() => {
    if (!chartRef.current) return
    const existing = Chart.getChart(chartRef.current)
    if (existing) existing.destroy()
    if (chartInstance.current) {
      chartInstance.current.destroy()
      chartInstance.current = null
    }

    const timer = setTimeout(() => {
      if (!chartRef.current) return
      const canvasCtx = chartRef.current.getContext('2d')
      if (!canvasCtx) return

      const { ages, requiredLine, projectedLine, legacyLine, milestones, retireIdx, retirementAge, finalDeathAge, goldAnnualBase, planMode, clientAge, spouseAge } = series
      const isCouple = planMode === 'couple'
      const earliestRetAge = retirementAge

      const corpusAtAge: Record<number, number> = {}
      ages.forEach((a, i) => { corpusAtAge[a] = requiredLine[i] })

      const milestonesByAge: Record<number, { label: string; amount: number }[]> = {}
      milestones.forEach(m => {
        if (!milestonesByAge[m.age]) milestonesByAge[m.age] = []
        milestonesByAge[m.age].push({ label: m.label, amount: m.amount })
      })

      // Draws a circle + label at each non-retirement goal's funding age
      const milestonePlugin = {
        id: 'milestones',
        afterDatasetsDraw(chart: any) {
          const xAxis = chart.scales.x
          const yAxis = chart.scales.y
          if (!xAxis || !yAxis) return
          const ctx = chart.ctx
          Object.entries(milestonesByAge).forEach(([ageStr, msArr]) => {
            const age = parseInt(ageStr)
            const idx = ages.indexOf(age)
            if (idx < 0) return
            const x = xAxis.getPixelForValue(idx)
            const corpusVal = corpusAtAge[age] ?? 0
            const dotY = yAxis.getPixelForValue(corpusVal)
            ctx.save()
            ctx.beginPath()
            ctx.setLineDash([4, 4])
            ctx.moveTo(x, yAxis.top)
            ctx.lineTo(x, yAxis.bottom)
            ctx.strokeStyle = 'rgba(94,138,106,0.2)'
            ctx.lineWidth = 1
            ctx.stroke()
            ctx.setLineDash([])
            ctx.beginPath()
            ctx.arc(x, dotY, 6, 0, Math.PI * 2)
            ctx.fillStyle = '#5E8A6A'
            ctx.fill()
            ctx.strokeStyle = 'white'
            ctx.lineWidth = 2
            ctx.stroke()
            ctx.restore()
          })
        },
      }

      const retireLinePlugin = {
        id: 'retireLine',
        afterDraw(chart: any) {
          if (retireIdx < 0) return
          const xAxis = chart.scales.x
          const yAxis = chart.scales.y
          if (!xAxis || !yAxis) return
          const x = xAxis.getPixelForValue(retireIdx)
          const ctx = chart.ctx
          const retirementMeta = chart.getDatasetMeta(0)
          const retirePoint = retirementMeta?.data?.[retireIdx]
          const lineY = retirePoint ? retirePoint.y : yAxis.top + 60
          ctx.save()
          ctx.beginPath()
          ctx.setLineDash([4, 4])
          ctx.moveTo(x, yAxis.top)
          ctx.lineTo(x, lineY)
          ctx.strokeStyle = 'rgba(168,131,74,0.3)'
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.arc(x, lineY, 6, 0, Math.PI * 2)
          ctx.fillStyle = '#A8834A'
          ctx.fill()
          ctx.strokeStyle = 'white'
          ctx.lineWidth = 2
          ctx.stroke()
          ctx.restore()
        },
      }

      const datasets: any[] = [
        {
          label: 'Capital Required',
          data: requiredLine,
          borderColor: '#A8834A',
          backgroundColor: (context: any) => {
            const chart = context.chart
            const { ctx: c, chartArea } = chart
            if (!chartArea) return 'rgba(168,131,74,0.05)'
            const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
            gradient.addColorStop(0, 'rgba(168,131,74,0.12)')
            gradient.addColorStop(1, 'rgba(168,131,74,0.01)')
            return gradient
          },
          borderWidth: 2.5, tension: 0.35, pointRadius: 0, pointHoverRadius: 6,
          pointHoverBackgroundColor: '#A8834A', pointHoverBorderColor: 'white', pointHoverBorderWidth: 2,
          fill: true,
        },
      ]
      if (projectedLine.some(v => v > 0)) {
        datasets.push({
          label: 'Projected Portfolio',
          data: projectedLine,
          borderColor: '#4A9E8A', backgroundColor: 'rgba(74,158,138,0.04)',
          borderWidth: 2, tension: 0.35, pointRadius: 0, pointHoverRadius: 6,
          pointHoverBackgroundColor: '#4A9E8A', pointHoverBorderColor: 'white', pointHoverBorderWidth: 2,
          fill: false,
        })
      }
      if (legacyLine) {
        datasets.push({
          label: 'Legacy Floor',
          data: legacyLine,
          borderColor: 'rgba(196,164,100,0.5)', backgroundColor: 'rgba(196,164,100,0.03)',
          borderDash: [3, 3], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4,
          fill: false, tension: 0, spanGaps: false,
        })
      }

      try {
        chartInstance.current = new Chart(canvasCtx, {
          type: 'line',
          plugins: [retireLinePlugin, milestonePlugin],
          data: { labels: ages.map(a => fmtAge(a, isCouple, clientAge, spouseAge)), datasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            layout: { padding: { bottom: 0 } },
            plugins: {
              legend: { labels: { color: '#9A9690', font: { size: 11 }, boxWidth: 20, filter: (item: any) => item.text !== 'null' } },
              tooltip: {
                backgroundColor: 'rgba(26,24,22,0.95)', titleColor: 'rgba(196,164,100,0.9)', bodyColor: 'rgba(240,237,232,0.85)',
                padding: 14, titleFont: { size: 12, weight: 'bold' }, bodyFont: { size: 11 },
                callbacks: {
                  title: (ctxs: any[]) => {
                    if (!ctxs.length) return ''
                    const idx = ctxs[0].dataIndex
                    const a = ages[idx]
                    const phase = a < earliestRetAge ? 'Accumulation' : a === earliestRetAge ? 'Retirement Begins' : 'Retirement'
                    return `${fmtAge(a, isCouple, clientAge, spouseAge)}  ·  ${phase}`
                  },
                  label: (ctx: any) => {
                    if (ctx.parsed.y === null || ctx.parsed.y === undefined || ctx.parsed.y < 0) return ''
                    return `  ${ctx.dataset.label}:  ${fmt(ctx.parsed.y)}`
                  },
                  afterBody: (ctxs: any[]) => {
                    if (!ctxs.length) return []
                    const idx = ctxs[0].dataIndex
                    const a = ages[idx]
                    const lines: string[] = []
                    if (milestonesByAge[a]?.length) {
                      milestonesByAge[a].forEach(ms => {
                        lines.push('')
                        lines.push(`  🎯  ${ms.label}`)
                        lines.push(`       Corpus released: −${fmt(ms.amount)}`)
                      })
                    }
                    if (a === earliestRetAge && corpusAtAge[earliestRetAge]) {
                      lines.push('')
                      lines.push(`  🏖  Portfolio target at retirement: ${fmt(corpusAtAge[earliestRetAge])}`)
                    }
                    if (a >= earliestRetAge && goldAnnualBase > 0) {
                      const annualAtAge = goldAnnualBase * Math.pow(1 + inflationRate / 100, a - earliestRetAge)
                      lines.push('')
                      lines.push(`  💸  Retirement income: ${fmtMo(annualAtAge / 12)} (${fmt(annualAtAge)}/yr)`)
                    }
                    return lines
                  },
                  footer: (ctxs: any[]) => {
                    if (!ctxs.length) return []
                    const idx = ctxs[0].dataIndex
                    const a = ages[idx]
                    if (a >= earliestRetAge && a < finalDeathAge) {
                      const yrsLeft = finalDeathAge - a
                      return [`  ${yrsLeft} yrs to life expectancy (${fmtAge(finalDeathAge, isCouple, clientAge, spouseAge)})`]
                    }
                    return []
                  },
                },
              },
            },
            scales: {
              x: { ticks: { color: '#9A9690', font: { size: 9 }, maxTicksLimit: 14 }, grid: { display: false } },
              y: {
                ticks: { callback: (v: any) => fmt(v), color: '#9A9690', font: { size: 9 } },
                grid: { color: 'rgba(26,24,22,0.04)' }, min: 0,
                max: Math.max(...requiredLine.filter(v => isFinite(v))) * 1.15,
              },
            },
          },
        })
      } catch (error) {
        console.error('Chart creation failed:', error)
      }
    }, 50)

    return () => {
      clearTimeout(timer)
      if (chartInstance.current) {
        chartInstance.current.destroy()
        chartInstance.current = null
      }
    }
  }, [series, inflationRate])

  return <div style={{ height: 320, position: 'relative' }}><canvas ref={chartRef} /></div>
}

function Donut({ slices }: { slices: { label: string; pct: number; color: string }[] }) {
  const dr = 70, dc = 2 * Math.PI * dr
  let off = 0
  return (
    <svg width={190} height={190} viewBox="0 0 190 190">
      <circle cx={95} cy={95} r={dr} fill="none" stroke="var(--cream3)" strokeWidth={22} />
      {slices.map((s, i) => {
        const len = (s.pct / 100) * dc
        const el = (
          <circle key={i} cx={95} cy={95} r={dr} fill="none" stroke={s.color} strokeWidth={22}
            strokeDasharray={`${len} ${dc - len}`} strokeDashoffset={-off} transform="rotate(-90 95 95)" />
        )
        off += len
        return el
      })}
    </svg>
  )
}

export default function CapitalFundDisplay({ snapshot, clientName, spouseName }: {
  snapshot: CapitalFundSnapshot
  clientName: string
  spouseName?: string
}) {
  const s = snapshot
  const objectiveLabels = s.objectives.map(o => o.id === 'retirement' ? 'the independence you\'re building toward' : o.label.replace(/'s Education$/, "'s education"))
  const assetAllocationTotal = s.assetAllocation.reduce((acc, a) => acc + a.value, 0)
  // 7 distinct colors — one per possible asset category (Cash, CPF, Investment,
  // Managed, Real Estate, Business, Personal Use). Previously only 5 colors
  // existed, so the 6th category silently reused the 1st's color (Business
  // Ventures rendered identically to Cash Reserves whenever both were on file).
  const donutColors = ['var(--charcoal)', 'var(--gold)', '#C9A876', 'var(--ink3)', 'var(--emerald)', 'var(--rouge)', '#8C7A65']

  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 14 }}>Strategic Wealth Accumulation</div>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontSize: 25, lineHeight: 1.5, color: 'var(--ink)', width: '100%', marginBottom: 30 }}>
        {s.objectives.length} commitment{s.objectives.length === 1 ? '' : 's'}, one number that has to work: {joinWithAnd(objectiveLabels)} — all by {fmtAgePair(s.retirementAge, s.spouseRetirementAge, s.isCouple)}.
      </div>

      {/* Hero income target */}
      <div style={{ display: 'flex', gap: 26, alignItems: 'center', background: 'var(--gold-l,#F5EFE3)', borderLeft: '3px solid var(--gold)', borderRadius: 10, padding: '24px 28px', marginBottom: 44 }}>
        <div>
          <div style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gold-tag,#8A6C3A)', marginBottom: 8 }}>Targeted Financial Independence (Retirement)</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 44, color: 'var(--gold-tag,#8A6C3A)' }}>{fmt(s.heroAnnualIncomeTarget)}</span>
            <span style={{ fontSize: 16, color: 'var(--ink3)', fontStyle: 'italic', fontFamily: 'Cormorant Garamond, serif' }}>/ annum</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink2)', maxWidth: 480, lineHeight: 1.55 }}>
            The income this capital needs to produce at {fmtAgePair(s.retirementAge, s.spouseRetirementAge, s.isCouple)} — {fmtAgePair(s.yearsToRetirement, s.spouseYearsToRetirement, s.isCouple)} years from where you're standing today — so retirement is a choice, not a constraint.
          </div>
        </div>
      </div>

      {/* Chart */}
      {s.fullChartSeries ? (
        <>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 18 }}>
            Capital Fund Framework · Age {s.currentAge} to {s.fullChartSeries.finalDeathAge}
          </div>
          <CapitalChartFull series={s.fullChartSeries} inflationRate={s.inflationRate} />
        </>
      ) : (
        <>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 18 }}>
            Capital Fund Framework · Age {s.currentAge} to {s.retirementAge}
          </div>
          <div style={{ display: 'flex', gap: 18, justifyContent: 'flex-end', marginBottom: 8 }}>
            <span style={{ fontSize: 10.5, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 2, background: '#4A8A86', display: 'inline-block' }} />Projection</span>
            <span style={{ fontSize: 10.5, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 2, background: 'var(--gold)', display: 'inline-block' }} />Target</span>
          </div>
          <CapitalChart target={s.chart.target} projection={s.chart.projection} currentAge={s.currentAge} retirementAge={s.retirementAge} />
          <div style={{ fontSize: 11.5, color: 'var(--ink3)', fontStyle: 'italic', marginTop: 10 }}>
            Full lifecycle chart pending — re-save this client's Capital Mandate to populate it.
          </div>
        </>
      )}

      {/* Stat trio */}
      <div style={{ display: 'flex', margin: '28px 0 48px' }}>
        {[
          { label: 'Retirement Age', val: fmtAgePair(s.retirementAge, s.spouseRetirementAge, s.isCouple) },
          { label: 'Expected Returns', val: `${s.expectedReturn.toFixed(1)}%` },
          { label: 'Inflation Rate', val: `${s.inflationRate.toFixed(1)}%` },
        ].map((st, i) => (
          <div key={st.label} style={{ flex: 1, paddingLeft: i > 0 ? 24 : 0, paddingRight: 24, borderLeft: i > 0 ? '1px solid var(--cream3)' : 'none' }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>{st.label}</div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, color: 'var(--ink)' }}>{st.val}</div>
          </div>
        ))}
      </div>

      {/* Two column: objectives + donut */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 48, marginBottom: 40, alignItems: 'stretch' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 18 }}>Funding Timeline Objectives</div>
          <div style={{ flex: 1 }}>
            {s.objectives.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--ink3)', fontStyle: 'italic' }}>No funding objectives on file yet — add goals in Strategic Objectives or the Capital Mandate tool.</div>
            )}
            {s.objectives.map((o, i) => {
              const Icon = objectiveIcon(o.id)
              return (
                <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', padding: '18px 0', borderBottom: i < s.objectives.length - 1 ? '1px solid var(--cream3)' : 'none', paddingTop: i === 0 ? 0 : 18 }}>
                  <div style={{ display: 'flex', gap: 14, maxWidth: 320 }}>
                    <div style={{ width: 3, borderRadius: 2, flexShrink: 0, alignSelf: 'stretch', background: o.accentColor === 'gold' ? 'var(--gold)' : 'var(--emerald)' }} />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Icon size={14} color={o.accentColor === 'gold' ? 'var(--gold-tag,#8A6C3A)' : 'var(--emerald)'} />
                        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, color: 'var(--ink)', lineHeight: 1.4 }}>{o.label}</div>
                      </div>
                      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 13, color: 'var(--ink3)', lineHeight: 1.5 }}>{o.purpose}</div>
                    </div>
                  </div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: 'var(--ink)', whiteSpace: 'nowrap', paddingTop: 1 }}>{fmt(o.amount)}</div>
                </div>
              )
            })}
          </div>
          {s.objectives.length > 0 && (
            <div style={{ background: 'var(--gold-l,#F5EFE3)', borderLeft: '3px solid var(--gold)', borderRadius: 10, padding: '20px 24px', marginTop: 24 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gold-tag,#8A6C3A)', marginBottom: 8 }}>Total Capital Fund Required</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 32, color: 'var(--gold-tag,#8A6C3A)', marginBottom: 6 }}>{fmt(s.totalCapitalRequired)}</div>
              <div style={{ fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>The sum of every objective above</div>
            </div>
          )}
          {s.objectives.length > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--ink3)', fontStyle: 'italic', marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--cream3)' }}>
              {s.objectives.length} objective{s.objectives.length === 1 ? '' : 's'} on file — add more in Strategic Objectives or the Capital Mandate tool.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 18, alignSelf: 'flex-start' }}>Asset Allocation</div>
          {s.assetAllocation.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink3)', fontStyle: 'italic', alignSelf: 'flex-start' }}>No assets on file yet.</div>
          ) : (
            <>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                <div style={{ position: 'relative' }}>
                  <Donut slices={s.assetAllocation.map((a, i) => ({
                    label: a.label,
                    // Raw value/total fraction, not the rounded display pct — keeps
                    // slice arc lengths exact regardless of label rounding.
                    pct: assetAllocationTotal > 0 ? (a.value / assetAllocationTotal) * 100 : 0,
                    color: donutColors[i % donutColors.length],
                  }))} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 26, color: 'var(--ink)' }}>{s.illiquidPct}%</div>
                    <div style={{ fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink3)', marginTop: 2, maxWidth: 70, lineHeight: 1.3 }}>illiquid<br />(property + CPF)</div>
                  </div>
                </div>
                <div style={{ width: '100%', marginTop: 18, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {s.assetAllocation.map((a, i) => (
                    <div key={a.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--ink2)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: donutColors[i % donutColors.length] }} />
                        {a.label}
                      </div>
                      <div style={{ fontFamily: 'DM Mono, monospace', color: 'var(--ink)' }}>{a.pct}%</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ width: '100%', fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.6, marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--cream3)' }}>
                <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{s.illiquidPct}%</b> of what's been built — real estate and CPF — can't be spent next year if it were ever needed. Worth knowing as we plan what's actually available for these objectives.
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sub-page divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '56px 0 36px' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--line2)' }} />
        <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', whiteSpace: 'nowrap' }}>Funding Strategy</div>
        <div style={{ flex: 1, height: 1, background: 'var(--line2)' }} />
      </div>

      {/* Investment vehicles + capital velocity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 230px', gap: 32, marginBottom: 44 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 18 }}>Current Investment Vehicles</div>
          {s.vehicles.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink3)', fontStyle: 'italic' }}>No vehicles on file yet — add them in the Capital Mandate tool.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Platform', 'Contribution', 'Current Value', 'Start Date'].map(h => (
                    <th key={h} style={{ textAlign: 'left', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', fontWeight: 500, paddingBottom: 12, borderBottom: '1px solid var(--line2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.vehicles.map((v, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, color: 'var(--ink)', padding: '14px 0', borderBottom: '1px solid var(--cream3)' }}>{v.platform}</td>
                    <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13.5, color: 'var(--ink2)', padding: '14px 0', borderBottom: '1px solid var(--cream3)' }}>{v.isRegular ? `${fmt(v.monthlyContribution)} / mo` : 'Lump sum'}</td>
                    <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13.5, color: 'var(--ink2)', padding: '14px 0', borderBottom: '1px solid var(--cream3)' }}>{fmt(v.currentValue)}</td>
                    <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13.5, color: 'var(--ink2)', padding: '14px 0', borderBottom: '1px solid var(--cream3)' }}>{v.startDateDisplay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ background: '#fff', border: '1px solid var(--line2)', borderRadius: 12, padding: '22px 24px' }}>
          <div style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--cream3)' }}>Capital Velocity</div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold-tag,#8A6C3A)', marginBottom: 4 }}>Asset Growth Rate</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 24, color: 'var(--ink)' }}>{s.assetGrowthRatePct != null ? `${s.assetGrowthRatePct.toFixed(1)}%` : '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold-tag,#8A6C3A)', marginBottom: 4 }}>Expected Returns</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 24, color: 'var(--ink)' }}>{s.expectedReturn.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* Capacity audit */}
      <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 18 }}>Liquidity Deployment &amp; Capacity Audit</div>
      <div style={{ fontSize: 14, color: 'var(--ink2)', maxWidth: 380, lineHeight: 1.6, marginBottom: 22 }}>Evaluating your investment deployment against your current funding commitments.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 36, alignItems: 'center', marginBottom: 32 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 500, marginBottom: 2 }}>Total Requirement <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 400, marginLeft: 6 }}>{fmt(s.capacityAudit.totalRequiredAnnual)}</span></div>
            <div style={{ fontSize: 12, color: 'var(--ink3)' }}>What it'd take annually, starting from zero</div>
          </div>
          <div>
            <div style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 500, marginBottom: 2 }}>Current Investment <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 400, marginLeft: 6 }}>{fmt(s.capacityAudit.currentInvestmentAnnual)}</span></div>
            <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Actual capital currently working</div>
          </div>
          <div>
            <div style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 500, marginBottom: 2 }}>Shortfall <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 400, marginLeft: 6 }}>{fmt(s.capacityAudit.requiredAnnual)}</span></div>
            <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Additional amount needed beyond what's invested today</div>
          </div>
          <div>
            <div style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 500, marginBottom: 2 }}>Available Cashflow <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 400, marginLeft: 6 }}>{fmt(s.capacityAudit.availableCashflowAnnual)}</span></div>
            <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Potential annual surplus capacity</div>
          </div>
        </div>
        {(() => {
          // Total Requirement = Current Investment (already happening) +
          // Shortfall (what's still missing) — shown as a literal
          // subtraction so the relationship between the three numbers
          // doesn't need separate explaining. Available isn't a fourth bar
          // here — it's compared directly against the Shortfall below,
          // since that's the only number it can actually offset.
          const totalVal = s.capacityAudit.totalRequiredAnnual
          const currentVal = s.capacityAudit.currentInvestmentAnnual
          const shortfallVal = s.capacityAudit.requiredAnnual
          const maxBar = Math.max(1, totalVal, currentVal, shortfallVal)
          return (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 170 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ width: '100%', borderRadius: '8px 8px 3px 3px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 10, height: `${Math.max(4, (totalVal / maxBar) * 100)}%`, background: 'linear-gradient(180deg, #C9A876, var(--gold))' }}>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#fff' }}>{fmt(totalVal)}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 10, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Total requirement</div>
              </div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 24, color: 'var(--ink3)', paddingBottom: 32 }}>−</div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ width: '100%', borderRadius: '8px 8px 3px 3px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 10, height: `${Math.max(4, (currentVal / maxBar) * 100)}%`, background: 'linear-gradient(180deg, #5A574F, var(--ink2))' }}>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#fff' }}>{fmt(currentVal)}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 10, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Current investment</div>
              </div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 24, color: 'var(--ink3)', paddingBottom: 32 }}>=</div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ width: '100%', borderRadius: '8px 8px 3px 3px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 10, height: `${Math.max(4, (shortfallVal / maxBar) * 100)}%`, background: 'linear-gradient(180deg, #E08080, var(--rouge))' }}>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#fff' }}>{fmt(shortfallVal)}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 10, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Shortfall</div>
              </div>
            </div>
          )
        })()}
      </div>

      {/* Advisory insight */}
      {(() => {
        const identifiableCapacity = s.capacityAudit.currentInvestmentAnnual + s.capacityAudit.availableCashflowAnnual
        const coversShortfall = s.capacityAudit.capacityBeyondMandate >= 0
        return (
          <div style={{ display: 'flex', background: 'var(--charcoal)', borderRadius: 12, overflow: 'hidden', marginBottom: 44 }}>
            <div style={{ flex: 1.5, padding: '26px 30px' }}>
              <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#C9A876', marginBottom: 10 }}>Advisory Insight</div>
              <div style={{ fontSize: 14, lineHeight: 1.65, color: 'rgba(240,237,232,0.85)' }}>
                Of the <b style={{ color: '#F0EDE6', fontWeight: 600 }}>{fmt(identifiableCapacity)}</b> you could be investing each year, only <b style={{ color: '#F0EDE6', fontWeight: 600 }}>{s.capacityAudit.investedShareOfCapacityPct}%</b> — <b style={{ color: '#F0EDE6', fontWeight: 600 }}>{fmt(s.capacityAudit.currentInvestmentAnnual)}</b> — actually is. Redirecting the other <b style={{ color: '#F0EDE6', fontWeight: 600 }}>{fmt(s.capacityAudit.availableCashflowAnnual)}</b> would {coversShortfall ? 'fully close' : 'close part of'} the <b style={{ color: '#F0EDE6', fontWeight: 600 }}>{fmt(s.capacityAudit.requiredAnnual)}</b> shortfall{coversShortfall
                  ? <>, with <b style={{ color: '#F0EDE6', fontWeight: 600 }}>{fmt(s.capacityAudit.capacityBeyondMandate)}</b> a year to spare.</>
                  : <>, but <b style={{ color: '#F0EDE6', fontWeight: 600 }}>{fmt(Math.abs(s.capacityAudit.capacityBeyondMandate))}</b> a year would still be missing to reach <b style={{ color: '#F0EDE6', fontWeight: 600 }}>{fmt(s.heroAnnualIncomeTarget)}</b> at retirement.</>}
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid rgba(240,237,232,0.1)', padding: 20 }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 30, color: coversShortfall ? '#80C4A0' : '#E08080' }}>
                {coversShortfall ? '+' : '−'}{fmt(Math.abs(s.capacityAudit.capacityBeyondMandate))}
              </div>
              <div style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(240,237,232,0.55)', marginTop: 4, textAlign: 'center' }}>
                {coversShortfall ? 'Capacity beyond what\'s required' : 'Still short, even fully redirected'}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Strategic optimization */}
      <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 18 }}>Strategic Optimization</div>
      {!s.strategy || s.shortfall <= 0 ? (
        <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.6, marginBottom: 8 }}>
          The portfolio is projected to meet this mandate at the current contribution rate — no additional capital injection is required today.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 14, color: 'var(--ink2)', maxWidth: 480, lineHeight: 1.6, marginBottom: 24 }}>To close the gap, two capital injection strategies are available — individually or blended.</div>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Goals &amp; Objectives Shortfall</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 30, color: 'var(--ink)' }}>{fmt(s.shortfall)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 8 }}>
            <div style={{ flex: 1, border: '1px solid var(--line2)', borderRadius: 12, padding: '26px 24px 22px', background: '#fff' }}>
              <div style={{ display: 'inline-block', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '5px 12px', borderRadius: 999, marginBottom: 18, fontWeight: 500, background: 'var(--gold-l,#F5EFE3)', color: 'var(--gold-tag,#8A6C3A)' }}>Option A · Regular Savings</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 32, color: 'var(--ink)', marginBottom: 8 }}>{fmt(s.strategy.pureMonthlyAnnual)}</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 13, color: 'var(--ink3)' }}>The quiet path — raise the monthly contribution, and let time do the rest.</div>
            </div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink3)', whiteSpace: 'nowrap', padding: '0 4px' }}>
              {Math.round((1 - s.strategy.lumpSumFraction) * 100)} — {Math.round(s.strategy.lumpSumFraction * 100)}
            </div>
            <div style={{ flex: 1, border: '1px solid var(--line2)', borderRadius: 12, padding: '26px 24px 22px', background: '#fff' }}>
              <div style={{ display: 'inline-block', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '5px 12px', borderRadius: 999, marginBottom: 18, fontWeight: 500, background: 'var(--emerald-l,#E8F2ED)', color: 'var(--emerald)' }}>Option B · Lump Sum</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, fontSize: 32, color: 'var(--ink)', marginBottom: 8 }}>{fmt(s.strategy.pureLumpSum)}</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 13, color: 'var(--ink3)' }}>The decisive path — one transfer, and the mandate is already met.</div>
            </div>
          </div>
        </>
      )}

      {/* Closing */}
      {s.strategy && s.shortfall > 0 && (
        <div style={{ padding: '50px 0 8px', textAlign: 'center' }}>
          <div style={{ width: 36, height: 1, background: 'var(--gold)', margin: '0 auto 22px' }} />
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontWeight: 500, fontSize: 21, lineHeight: 1.55, color: 'var(--ink2)', maxWidth: 560, margin: '0 auto' }}>
            <b style={{ fontStyle: 'normal', fontWeight: 600, color: 'var(--gold-tag,#8A6C3A)' }}>{fmt(s.strategy.pureMonthlyAnnual)} a year</b> is the difference between hoping these commitments work out, and knowing they will.
          </div>
        </div>
      )}
    </div>
  )
}
