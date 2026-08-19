import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { verifyReportPrintToken } from '@/lib/reportPrintToken'
import { buildOverviewSnapshot } from '@/lib/financialPlanSnapshot'

// Print-only render target for the PDF export pipeline (see
// /api/report/export-pdf/route.ts, which mints the token and drives
// Puppeteer against this page). Never linked from the advisor UI and never
// meant to be visited by a real browser session — the signed, 5-minute
// token is the only way in, verified server-side below.
//
// This is a server component: no 'use client', no useEffect data-fetching.
// It fetches everything it needs before rendering, using the service-role
// key (Puppeteer carries no Supabase Auth session/cookies to forward), the
// same pattern /api/statement/[token]/route.ts already uses for its
// unauthenticated public route.
//
// INCREMENT 2: Cover + Overview. Wealth Summary, Protection, Capital Fund,
// and Action Plan pages are built in the same @media print / break-after:page
// structure but not wired into this route yet — see the mockup
// (page5-protection-breakdown.html) for the approved design of each.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })
}

function fmt(n: number): string {
  if (!n || isNaN(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-SG')
}

// Same category → color mapping as OverviewDisplay's donut (EXPENSE_COLORS),
// re-expressed as static SVG stroke segments here since Puppeteer renders
// this route with no client JS / Chart.js available.
const DONUT_COLORS = ['#1A1A18', '#7A3B34', '#9C9A94', '#B0AEA8', '#D8D5CA', '#C9A876', '#E4C9A0', '#F0DFC0']
const DONUT_CIRCUMFERENCE = 283 // 2 * PI * r45, matches the approved mockup's rounding

const INVERTED_BENCHMARK_CATEGORIES = ['Savings / Investments'] // more than benchmark is good here, unlike expense categories

function comparisonClass(label: string, actualPct: number, benchmarkPct: number): 'over' | 'under' | '' {
  if (actualPct === benchmarkPct) return ''
  const isInverted = INVERTED_BENCHMARK_CATEGORIES.includes(label)
  const isOver = actualPct > benchmarkPct
  if (isInverted) return isOver ? 'under' : 'over' // note: css classes are named for direction of concern (over=bad/accent, under=good/green), so an inverted category flips which class means "bad"
  return isOver ? 'over' : 'under'
}

export default async function ReportPrintPage({ params }: { params: { token: string } }) {
  const payload = verifyReportPrintToken(params.token)
  if (!payload) notFound()

  const [{ data: client }, { data: family }, { data: advisor }, { data: ffRows }] = await Promise.all([
    supabaseAdmin.from('clients').select('id, name, dob').eq('id', payload.clientId).maybeSingle(),
    supabaseAdmin.from('family_members').select('name, relationship, dob').eq('client_id', payload.clientId),
    supabaseAdmin.from('advisors').select('name').eq('id', payload.advisorId).maybeSingle(),
    supabaseAdmin.from('fact_finding').select('section, data').eq('client_id', payload.clientId).in('section', ['financials']),
  ])
  if (!client) notFound()

  const spouseName = (family || []).find(f => f.relationship === 'Spouse')?.name || null
  const advisorName = advisor?.name || 'Bespoke Capital'
  const datePrepared = formatDate(new Date())

  const financialsData = (ffRows || []).find(r => r.section === 'financials')?.data || {}
  const overview = buildOverviewSnapshot({
    client: { name: client.name, dob: client.dob || '' },
    familyMembers: (family || []).map(f => ({ name: f.name, relationship: f.relationship, dob: f.dob || undefined })),
    fin: financialsData,
  })

  const expenseTotal = overview.expenseBreakdown.reduce((s, d) => s + d.value, 0)
  let donutCumulative = 0
  const donutSegments = overview.expenseBreakdown.map((d, i) => {
    const len = expenseTotal > 0 ? (d.value / expenseTotal) * DONUT_CIRCUMFERENCE : 0
    const seg = { color: DONUT_COLORS[i % DONUT_COLORS.length], dasharray: `${len} ${DONUT_CIRCUMFERENCE}`, dashoffset: -donutCumulative }
    donutCumulative += len
    return seg
  })
  const hasBenchmark = overview.expenseBenchmark.length > 0

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <title>Financial Report — {client.name}</title>
        <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      </head>
      <body>
        <div className="page-wrap">
          {/* ============ COVER ============ */}
          <div className="page">
            <div className="cover">
              <div className="cover-top">
                <div className="cover-eyebrow">Bespoke Capital</div>
                <div className="cover-eyebrow">Private and Confidential</div>
              </div>
              <div className="cover-body">
                <div className="cover-label">Financial Planning Report — Prepared For</div>
                <div className="cover-name">
                  {client.name}
                  {spouseName && (
                    <>
                      <br />
                      &amp; {spouseName}
                    </>
                  )}
                </div>
                <div className="cover-rule" />
              </div>
            </div>
            <div className="ftr">
              <div className="m">
                <div className="l">Date Prepared</div>
                <div className="v">{datePrepared}</div>
              </div>
              <div className="m" style={{ textAlign: 'right' }}>
                <div className="l">Specially Prepared</div>
                <div className="v">{advisorName}</div>
              </div>
            </div>
          </div>

          {/* ============ OVERVIEW ============ */}
          <div className="page">
            <div className="hdr">
              <div className="tablabel">Financial Planning Report · Overview</div>
              <div className="titlerow">
                <div className="client">{client.name}{spouseName && <> &amp; {spouseName}</>}</div>
                <div className="date">{datePrepared}</div>
              </div>
            </div>

            <div className="card-kpi-row">
              <div className="card-kpi"><div className="l">Net Worth</div><div className="v">{fmt(overview.netWorth)}</div><div className="s">Liquid &amp; equity</div></div>
              <div className="card-kpi"><div className="l">Annual Inflow</div><div className="v">{fmt(overview.annualInflow)}</div><div className="s">Gross income</div></div>
              <div className="card-kpi"><div className="l">Annual Surplus</div><div className="v">{fmt(overview.annualSurplus)}</div><div className="s">Take-home minus expenses</div></div>
            </div>

            <div className="seclabel" style={{ marginTop: 0 }}>Asset Composition &amp; Liabilities</div>
            <div className="al-card">
              <div className="al-col">
                <div className="al-h">Asset Composition</div>
                {overview.assetBreakdown.map(a => (
                  <div className="al-row" key={a.label}><span className="lbl">{a.label}</span><span className="amt">{fmt(a.value)}</span></div>
                ))}
              </div>
              <div className="al-col">
                <div className="al-h">Liabilities</div>
                {overview.liabilities.map(l => (
                  <div className="al-row" key={l.label}><span className="lbl">{l.label}</span><span className="amt">{fmt(l.value)}</span></div>
                ))}
              </div>
            </div>
            <div className="nw-bar"><div className="l">Net Worth</div><div className="v">{fmt(overview.netWorth)}</div></div>

            <div className="seclabel" style={{ marginTop: 0 }}>Annual Cashflow</div>
            <div className="cashflow-wrap">
              <div className="cf-list">
                {hasBenchmark
                  ? overview.expenseBenchmark.map(d => (
                      <div className="cf-row" key={d.label}>
                        <span className="lbl">{d.label}</span>
                        <span className="amt">{fmt(d.actualValue)}</span>
                        <span className={`pct ${comparisonClass(d.label, d.actualPct, d.benchmarkPct)}`}>
                          {d.actualPct}%<span className="vs"> vs {d.benchmarkPct}%</span>
                        </span>
                      </div>
                    ))
                  : overview.expenseBreakdown.map(d => (
                      <div className="cf-row" key={d.label}>
                        <span className="lbl">{d.label}</span>
                        <span className="amt">{fmt(d.value)}</span>
                        <span className="pct">{expenseTotal > 0 ? Math.round((d.value / expenseTotal) * 100) : 0}%</span>
                      </div>
                    ))}
              </div>
              <div className="cf-donut-wrap">
                <svg viewBox="0 0 120 120" width="100" height="100" style={{ display: 'block' }}>
                  {donutSegments.map((seg, i) => (
                    <circle key={i} cx="60" cy="60" r="45" fill="none" stroke={seg.color} strokeWidth="18" strokeDasharray={seg.dasharray} strokeDashoffset={seg.dashoffset} transform="rotate(-90 60 60)" />
                  ))}
                  <text x="60" y="57" textAnchor="middle" fontFamily="Fraunces, serif" fontWeight="600" fontSize="14" fill="#1A1A18">{fmt(expenseTotal)}</text>
                  <text x="60" y="68" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="400" fontSize="5.5" letterSpacing="0.5" fill="#9C9A94">ANNUAL OUTFLOW</text>
                </svg>
                <div className="cf-legend">
                  {overview.expenseBreakdown.map((d, i) => (
                    <div className="li2" key={d.label}>
                      <span className="sw2" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      {d.label} {expenseTotal > 0 ? Math.round((d.value / expenseTotal) * 100) : 0}%
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="ftr"><span>Bespoke Capital — Confidential</span><span>Page 2 of 17</span></div>
          </div>

          {/* Remaining pages (Wealth Summary, Protection ×6, Capital Fund ×3,
              Action Plan ×4) land here in subsequent increments, each its own
              <div className="page" break-after:page> per the approved
              mockup. */}
        </div>
      </body>
    </html>
  )
}

// Inlined rather than a separate stylesheet import — Puppeteer's page.pdf()
// with printBackground:true reads @media print rules directly from whatever
// the page serves, and inlining avoids a second network round-trip for a
// route that only Puppeteer ever requests. Font is loaded via @import,
// matching the approved mockup; Fraunces/Inter are Google Fonts already
// used elsewhere in the app's report views.
const PRINT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@400;500;600&display=swap');

  :root{
    --ink:#1A1A18; --ink2:#5C5A54; --ink3:#9C9A94; --ink4:#B0AEA8;
    --line:#E4E1D8; --line2:#D8D5CA; --paper:#FEFEFC; --accent:#7A3B34;
  }
  *{box-sizing:border-box;}
  html,body{margin:0; padding:0; background:#fff; font-family:'Inter',sans-serif; color:var(--ink);}

  .page-wrap{display:block;}
  .page{
    width:210mm; min-height:297mm; background:var(--paper);
    padding:20mm 18mm 14mm; position:relative; display:flex; flex-direction:column;
    break-after:page;
  }
  .page:last-child{break-after:auto;}

  .cover{display:flex; flex-direction:column; flex:1;}
  .cover-top{display:flex; justify-content:space-between; align-items:flex-start;}
  .cover-eyebrow{font-size:9.5px; letter-spacing:0.18em; text-transform:uppercase; color:var(--ink3);}
  .cover-body{flex:1; display:flex; flex-direction:column; justify-content:center; padding:20mm 0;}
  .cover-label{font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:var(--ink3); margin-bottom:6mm;}
  .cover-name{font-family:'Fraunces',serif; font-size:42px; font-weight:500; font-style:italic; line-height:1.15; color:var(--ink); margin-bottom:10mm; max-width:140mm;}
  .cover-rule{width:32mm; height:1px; background:var(--ink); margin-bottom:8mm;}

  .ftr{margin-top:auto; padding-top:4mm; display:flex; justify-content:space-between; align-items:flex-end; border-top:1px solid var(--ink); font-size:8.5px; color:var(--ink3); letter-spacing:0.04em;}
  .ftr .m .l{font-size:9px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink3); margin-bottom:2mm;}
  .ftr .m .v{font-size:11.5px; color:var(--ink);}

  /* ===== interior page header (Overview onward) ===== */
  .tablabel{font-size:9.5px; letter-spacing:0.16em; text-transform:uppercase; color:var(--ink3); margin-bottom:5mm;}
  .hdr{margin-bottom:12mm;}
  .titlerow{display:flex; justify-content:space-between; align-items:baseline; border-bottom:1px solid var(--ink); padding-bottom:6mm;}
  .client{font-family:'Fraunces',serif; font-size:25px; font-weight:500; font-style:italic; color:var(--ink);}
  .date{font-size:10px; color:var(--ink3);}
  .seclabel{font-size:9.5px; letter-spacing:0.14em; text-transform:uppercase; color:var(--ink3); margin:11mm 0 5mm; break-after:avoid;}
  .seclabel:first-of-type{margin-top:0;}

  /* ===== bordered KPI cards ===== */
  .card-kpi-row{display:flex; gap:6mm; margin-bottom:11mm;}
  .card-kpi{flex:1; border:1px solid var(--line); border-radius:9px; padding:6mm; background:#FBFAF6;}
  .card-kpi .l{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink3); margin-bottom:4mm;}
  .card-kpi .v{font-family:'Fraunces',serif; font-weight:600; font-size:23px; color:var(--ink); margin-bottom:2.5mm;}
  .card-kpi .s{font-size:9.5px; color:var(--ink3);}

  /* ===== asset composition & liabilities ===== */
  .al-card{border:1px solid var(--line); border-radius:9px; padding:6mm; margin-bottom:6mm; display:grid; grid-template-columns:1fr 1fr; gap:10mm;}
  .al-col .al-h{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink3); margin-bottom:4mm;}
  .al-row{display:flex; justify-content:space-between; align-items:baseline; padding:2.6mm 0; border-bottom:1px dotted var(--line2); font-size:10.5px;}
  .al-row:last-child{border-bottom:none;}
  .al-row .lbl{color:var(--ink2); font-style:italic;}
  .al-row .amt{color:var(--ink);}

  .nw-bar{border:1px solid var(--gold, #B08D57); background:#F6F0E4; border-radius:9px; padding:5mm 6mm; margin-bottom:11mm; display:flex; justify-content:space-between; align-items:center;}
  .nw-bar .l{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:#8A6D3F;}
  .nw-bar .v{font-family:'Fraunces',serif; font-weight:600; font-size:22px; color:var(--ink);}

  /* ===== annual cashflow ===== */
  .cashflow-wrap{display:grid; grid-template-columns:1.15fr 0.85fr; gap:10mm; border:1px solid var(--line); border-radius:9px; padding:6mm; margin-bottom:9mm;}
  .cf-row{display:flex; align-items:baseline; gap:6px; padding:2.4mm 0; border-bottom:1px solid var(--line);}
  .cf-row:last-child{border-bottom:none;}
  .cf-row .lbl{flex:1; font-size:10px; color:var(--ink2);}
  .cf-row .amt{font-size:9.5px; color:var(--ink3); width:20mm; text-align:right;}
  .cf-row .pct{font-size:9.5px; font-weight:500; width:26mm; text-align:right;}
  .cf-row .pct .vs{color:#B0AEA8; font-weight:400;}
  .cf-row .pct.over{color:var(--accent);}
  .cf-row .pct.under{color:#3F6B57;}
  .cf-donut-wrap{display:flex; flex-direction:column; align-items:center; justify-content:center;}
  .cf-legend{display:grid; grid-template-columns:1fr 1fr; gap:1.5mm 4mm; margin-top:4mm; width:100%;}
  .cf-legend .li2{display:flex; align-items:center; gap:4px; font-size:8px; color:var(--ink2);}
  .cf-legend .sw2{width:6px; height:6px; border-radius:1px; flex-shrink:0;}

  @media print{
    body{background:none;}
    .page{box-shadow:none;}
    .card-kpi-row, .al-card, .cashflow-wrap{break-inside:avoid;}
  }
`