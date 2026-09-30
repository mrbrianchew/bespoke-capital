// Payout-start markers for the Capital Mandate lifecycle chart.
// Pure helpers (buildPayoutMarkers, payoutPopupHtml) plus a Chart.js plugin
// that draws a "coin stream" icon at the age each CPF Life / annuity begins
// paying out, with a hover / tap popup.
//
// Ages: the chart x-axis is CLIENT age. Payout start ages are entered as the
// OWNER's own age, so a spouse's payout is converted onto the client axis.

import type { Plugin } from 'chart.js'

export type PayoutKind = 'cpf_life' | 'annuity'
type Owner = 'client' | 'spouse' | 'joint'

export interface PayoutVehicle {
  id: string
  name: string
  vehicleType: string
  owner: Owner
  cpfScheme?: string
  cpfMonthlyPayout?: number
  cpfPayoutStartAge?: number
  annuityMonthlyIncome?: number
  annuityStartAge?: number
  annuityGuaranteeYears?: number
}

export interface PayoutItem {
  kind: PayoutKind
  name: string
  ownerLabel: string
  isSpouse: boolean
  ownerStartAge: number
  monthly: number
  scheme?: string
  guaranteeYears?: number
  alreadyPaying: boolean
}

export interface PayoutMarker {
  age: number        // client age the icon is plotted at
  index: number      // index on the category axis
  year: number       // calendar year of the payout start
  items: PayoutItem[]
}

export const PAYOUT_COLORS: Record<PayoutKind, string> = {
  cpf_life: '#4A7C9E',
  annuity: '#6B5B8B',
}
const GOLD = '#D9B865'

// Owner's own age -> client age. Legacy 'joint' records count as the client's.
export function ownerToClientAge(owner: Owner, ownerAge: number, clientAge: number, spouseAge: number): number {
  return owner === 'spouse' ? ownerAge + (clientAge - spouseAge) : ownerAge
}

interface BuildOpts {
  clientAge: number
  spouseAge: number
  lastAge: number          // last age on the chart axis
  currentYear: number
  clientName: string
  spouseName: string
}

export function buildPayoutMarkers(portfolio: PayoutVehicle[], o: BuildOpts): PayoutMarker[] {
  const byAge: Record<number, PayoutMarker> = {}
  portfolio.forEach(p => {
    const isCpf = p.vehicleType === 'cpf_life'
    const isAnn = p.vehicleType === 'annuity'
    if (!isCpf && !isAnn) return
    const monthly = (isCpf ? p.cpfMonthlyPayout : p.annuityMonthlyIncome) || 0
    if (monthly <= 0) return
    const ownerStartAge = (isCpf ? p.cpfPayoutStartAge : p.annuityStartAge) || 65
    const isSpouse = p.owner === 'spouse'
    const startClientAge = ownerToClientAge(p.owner, ownerStartAge, o.clientAge, o.spouseAge)
    if (startClientAge > o.lastAge) return
    const alreadyPaying = startClientAge < o.clientAge
    const plotAge = Math.max(startClientAge, o.clientAge)
    const m = byAge[plotAge] || (byAge[plotAge] = {
      age: plotAge, index: plotAge - o.clientAge, year: o.currentYear + (plotAge - o.clientAge), items: [],
    })
    m.items.push({
      kind: isCpf ? 'cpf_life' : 'annuity',
      name: p.name || (isCpf ? 'CPF Life' : 'Annuity'),
      ownerLabel: isSpouse ? o.spouseName : o.clientName,
      isSpouse,
      ownerStartAge,
      monthly,
      scheme: isCpf ? p.cpfScheme : undefined,
      guaranteeYears: isAnn ? p.annuityGuaranteeYears : undefined,
      alreadyPaying,
    })
  })
  return Object.keys(byAge).map(k => byAge[Number(k)]).sort((a, b) => a.age - b.age)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
const money = (n: number) => 'S$' + Math.round(n).toLocaleString('en-SG')

export function payoutPopupHtml(m: PayoutMarker, isCouple: boolean, clientAge: number, spouseAge: number): string {
  const ageLabel = isCouple ? `Age ${m.age} / ${spouseAge + (m.age - clientAge)}` : `Age ${m.age}`
  const already = m.items.some(i => i.alreadyPaying)
  const title = already && m.items.every(i => i.alreadyPaying)
    ? `${ageLabel} · already paying`
    : `${ageLabel} · ${m.year} — income begins`
  const rows = m.items.map((it, idx) => {
    const c = PAYOUT_COLORS[it.kind]
    const kind = it.kind === 'cpf_life' ? 'CPF Life' + (it.scheme ? ' · ' + esc(it.scheme) : '') : 'Annuity'
    const who = esc(it.ownerLabel) + ` (age ${it.ownerStartAge})`
    const extra = it.kind === 'annuity' && it.guaranteeYears ? ` · ${it.guaranteeYears}-yr guarantee` : ''
    const note = it.alreadyPaying ? `<div style="color:rgba(240,237,232,.6);margin-top:2px">Started at age ${it.ownerStartAge}</div>` : ''
    return `<div style="padding:${idx ? '8px' : '0'} 0 8px;${idx ? 'border-top:1px solid rgba(255,255,255,.09);' : ''}">`
      + `<div style="display:flex;align-items:center;gap:8px;font-weight:600;color:#fff;font-size:12px">`
      + `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c}"></span>${esc(it.name)}</div>`
      + `<div style="color:rgba(240,237,232,.6);margin-top:2px">${kind} · ${who}${extra}</div>`
      + `<div style="margin-top:2px"><span style="color:#fff">${money(it.monthly)}/mo</span> `
      + `<span style="color:rgba(240,237,232,.6)">· ${money(it.monthly * 12)}/yr</span></div>${note}</div>`
  }).join('')
  const total = m.items.length > 1
    ? `<div style="border-top:1px solid rgba(255,255,255,.09);padding-top:8px;color:rgba(240,237,232,.6)">Combined: <span style="color:#fff">${money(m.items.reduce((s, i) => s + i.monthly, 0))}/mo</span></div>`
    : ''
  return `<div style="color:rgba(196,164,100,.95);font-weight:600;font-size:12px;margin-bottom:8px">${esc(title)}</div>${rows}${total}`
}

// ─── canvas drawing ─────────────────────────────────────────────────────────

const ICON_W = 30
const STEP = ICON_W * 0.95

function drawCoinStream(ctx: CanvasRenderingContext2D, x: number, cy: number, color: string) {
  // falling coins
  ;[[-9, 9, 3], [8, 13, 3.6]].forEach(([dx, dy, r]) => {
    ctx.beginPath(); ctx.arc(x + dx, cy + dy, r, 0, Math.PI * 2)
    ctx.fillStyle = GOLD; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#fff'; ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x + dx, cy + dy - r - 5); ctx.lineTo(x + dx, cy + dy - r - 2)
    ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.strokeStyle = GOLD; ctx.stroke()
  })
  // main coin
  ctx.beginPath(); ctx.arc(x, cy - 5, 9.6, 0, Math.PI * 2)
  ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke()
  ctx.beginPath(); ctx.arc(x, cy - 5, 6.6, 0, Math.PI * 2)
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.stroke()
  ctx.fillStyle = '#fff'; ctx.font = '700 11.5px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText('$', x, cy - 1)
}

interface Box { x0: number; y0: number; x1: number; y1: number; marker: PayoutMarker; cx: number; cy: number }

export interface PayoutHover { marker: PayoutMarker; x: number; y: number }

export function createPayoutMarkerPlugin(opts: {
  getMarkers: () => PayoutMarker[]
  onHover: (h: PayoutHover | null) => void
}): Plugin<'line'> {
  let boxes: Box[] = []
  let active: PayoutMarker | null = null
  let pinned = false

  return {
    id: 'payoutMarkers',
    afterDatasetsDraw(chart) {
      const xScale: any = (chart.scales as any).x
      const area = chart.chartArea
      if (!xScale || !area) return
      const ctx = chart.ctx
      boxes = []
      opts.getMarkers().forEach(m => {
        const x = xScale.getPixelForValue(m.index)
        if (!isFinite(x) || x < area.left - 1 || x > area.right + 1) return
        const cy = area.top + 24   // inside the plot's top headroom, clear of the legend
        const n = m.items.length
        const half = n > 1 ? STEP / 2 + ICON_W / 2 : ICON_W / 2
        ctx.save()
        // guide line
        ctx.beginPath(); ctx.setLineDash([3, 4]); ctx.moveTo(x, cy + 18); ctx.lineTo(x, area.bottom)
        ctx.strokeStyle = 'rgba(74,124,158,0.28)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([])
        // icon(s): one coin stream per distinct product colour, first & last if mixed
        if (n > 1) {
          drawCoinStream(ctx, x - STEP / 2, cy, PAYOUT_COLORS[m.items[0].kind])
          drawCoinStream(ctx, x + STEP / 2, cy, PAYOUT_COLORS[m.items[n - 1].kind])
          const bx = x - half + 2, by = cy - 16
          ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2)
          ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.3; ctx.strokeStyle = '#1A1816'; ctx.stroke()
          ctx.fillStyle = '#1A1816'; ctx.font = '700 9px Inter, system-ui, sans-serif'
          ctx.textAlign = 'center'; ctx.fillText(String(n), bx, by + 3.2)
        } else {
          drawCoinStream(ctx, x, cy, PAYOUT_COLORS[m.items[0].kind])
        }
        ctx.restore()
        boxes.push({ x0: x - half - 4, y0: cy - 22, x1: x + half + 4, y1: cy + 22, marker: m, cx: x, cy })
      })
    },
    afterEvent(chart, args) {
      const e: any = args.event
      if (!e || e.x == null || e.y == null) return
      const hit = boxes.filter(b => e.x >= b.x0 && e.x <= b.x1 && e.y >= b.y0 && e.y <= b.y1)[0]
      const show = (b: Box) => { active = b.marker; opts.onHover({ marker: b.marker, x: b.cx, y: b.y1 }); args.changed = true }
      const hide = () => { if (active) { active = null; opts.onHover(null); args.changed = true } pinned = false }
      if (e.type === 'mouseout') { if (!pinned) hide(); return }
      if (e.type === 'mousemove') {
        chart.canvas.style.cursor = hit ? 'pointer' : ''
        if (hit) { if (!active || active.age !== hit.marker.age) show(hit) }
        else if (active && !pinned) hide()
        return
      }
      if (e.type === 'click' || e.type === 'touchstart') {
        if (hit) {
          if (pinned && active && active.age === hit.marker.age) hide()
          else { show(hit); pinned = true }
        } else if (active) hide()
      }
    },
    // Suppress Chart.js's own tooltip while a coin popup is showing, so they never stack.
    beforeTooltipDraw() { if (active) return false },
    afterDestroy() { active = null; pinned = false; boxes = []; opts.onHover(null) },
  }
}