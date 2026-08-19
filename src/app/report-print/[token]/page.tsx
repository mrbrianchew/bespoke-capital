import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { verifyReportPrintToken } from '@/lib/reportPrintToken'
import { buildOverviewSnapshot } from '@/lib/financialPlanSnapshot'
import { buildExecutiveWealthSummarySnapshot } from '@/lib/executiveWealthSummarySnapshot'

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
// INCREMENT 3: Cover + Overview + Wealth Summary. Protection, Capital Fund,
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

  const wealthSummary = buildExecutiveWealthSummarySnapshot({
    client: { name: client.name, dob: client.dob || '' },
    familyMembers: (family || []).map(f => ({ name: f.name, relationship: f.relationship, dob: f.dob || undefined })),
    fin: financialsData,
  })
  const wealthSummaryYear = new Date(wealthSummary.generatedAt).getFullYear()

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

            <div className="ov-body">
              <div className="card-kpi-row">
                <div className="card-kpi"><div className="l">Net Worth</div><div className="v">{fmt(overview.netWorth)}</div><div className="s">Liquid &amp; equity</div></div>
                <div className="card-kpi"><div className="l">Annual Inflow</div><div className="v">{fmt(overview.annualInflow)}</div><div className="s">Gross income</div></div>
                <div className="card-kpi"><div className="l">Annual Surplus</div><div className="v">{fmt(overview.annualSurplus)}</div><div className="s">Take-home minus expenses</div></div>
              </div>

              <div>
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
              </div>

              <div>
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
                    <svg viewBox="0 0 120 120" width="150" height="150" style={{ display: 'block' }}>
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
              </div>
            </div>

            <div className="ftr"><span>Bespoke Capital — Confidential</span><span>Page 2 of 17</span></div>
          </div>

          {/* ============ WEALTH SUMMARY ============ */}
          <div className="page">
            <div className="ews-title">Executive Wealth Summary</div>
            <div className="ews-sub">
              A consolidated view of {client.name}{spouseName && <> &amp; {spouseName}</>}&rsquo;s assets, liabilities and annual cashflow as at {wealthSummaryYear}.
            </div>

            <div className="ews-nw-box">
              <div className="l">Total Consolidated Net Worth</div>
              <div className="v">{fmt(wealthSummary.netWorth)}</div>
              <div className="rule" />
              <div className="cap">{wealthSummary.takeaway}</div>
            </div>

            <div className="ews-cols">
              <div>
                <div className="ews-h">Consolidated Assets</div>
                {wealthSummary.assetBreakdown.map(a => (
                  <div className="ews-row" key={a.label}>
                    <span className="lbl">{a.label}{a.sublabel && <span className="sub">{a.sublabel}</span>}</span>
                    <span className="amt">{fmt(a.value)}</span>
                  </div>
                ))}
                <div className="ews-row total"><span className="lbl">Total Assets</span><span className="amt">{fmt(wealthSummary.totalAssets)}</span></div>

                <div className="ews-h ews-block-gap">Consolidated Liabilities</div>
                {wealthSummary.liabilities.map(l => (
                  <div className="ews-row" key={l.label}>
                    <span className="lbl">{l.label}{l.sublabel && <span className="sub">{l.sublabel}</span>}</span>
                    <span className="amt">{fmt(l.value)}</span>
                  </div>
                ))}
                <div className="ews-row total-plain"><span className="lbl">Total Liabilities</span><span className="amt">{fmt(wealthSummary.totalLiabilities)}</span></div>
              </div>

              <div>
                <div className="ews-h">Annual Household Cashflow</div>
                {wealthSummary.perPersonInflow.map(p => (
                  <div className="ews-row" key={p.name}><span className="lbl">{p.name}</span><span className="amt">{fmt(p.takeHome)}</span></div>
                ))}
                <div className="ews-row total">
                  <span className="lbl">Total Inflows<span className="sub" style={{ color: '#8A6D3F', fontStyle: 'italic' }}>Take-home</span></span>
                  <span className="amt">{fmt(wealthSummary.totalInflow)}</span>
                </div>

                <div style={{ marginTop: '4mm' }}>
                  {wealthSummary.expenseBreakdown.map(e => (
                    <div className="ews-row" key={e.label}><span className="lbl">{e.label}</span><span className="amt">{fmt(e.value)}</span></div>
                  ))}
                  <div className="ews-row total-plain"><span className="lbl">Total Outflows</span><span className="amt">{fmt(wealthSummary.totalOutflow)}</span></div>
                </div>

                <div className="ews-surplus-box">
                  <div className="l">Annual Deployable Cash Surplus</div>
                  <div className="v">{fmt(wealthSummary.annualSurplus)}</div>
                </div>

                <div className="ews-h" style={{ marginTop: '5mm' }}>Key Financial Ratios</div>
                <div className="ews-ratios ews-ratios-narrow">
                  <div className={`ews-ratio ${wealthSummary.savingsRateStatus}`}><div className="icon">i</div><div className="v">{wealthSummary.savingsRatePct}%</div><div className="l">Savings Rate</div></div>
                  <div className={`ews-ratio ${wealthSummary.debtToAssetStatus}`}><div className="icon">i</div><div className="v">{wealthSummary.debtToAssetPct}%</div><div className="l">Debt-to-Asset</div></div>
                  <div className={`ews-ratio ${wealthSummary.investmentRatioStatus}`}><div className="icon">i</div><div className="v">{wealthSummary.investmentRatioPct}%</div><div className="l">Investment Ratio<span className="sub2">of net worth</span></div></div>
                </div>
              </div>
            </div>

            <div className="ews-runway">
              <div className="txt">
                <div className="l">Emergency Cash Runway</div>
                {fmt(wealthSummary.liquidCash)} in cash &amp; fixed deposits covers this many months of essential household expenses (excludes Lifestyle &amp; Miscellaneous, which would simply pause in an emergency).
              </div>
              <div className="v">{wealthSummary.runwayMonths.toFixed(1)} months</div>
            </div>

            <div className="ftr"><span>Bespoke Capital — Confidential</span><span>Page 3 of 17</span></div>
          </div>

          {/* Remaining pages (Protection ×6, Capital Fund ×3, Action Plan ×4)
              land here in subsequent increments, each its own
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

  /* ===== interior page header (Overview onward) =====
     Spacing here is deliberately tighter than the fp.html mockup's original
     values — real client data (up to 7 asset categories, 8-category detailed
     cashflow) overflowed a single A4 page with the mockup's generous margins. */
  .tablabel{font-size:9.5px; letter-spacing:0.16em; text-transform:uppercase; color:var(--ink3); margin-bottom:4.5mm;}
  .hdr{margin-bottom:7mm;}
  .titlerow{display:flex; justify-content:space-between; align-items:baseline; border-bottom:1px solid var(--ink); padding-bottom:5mm;}
  .client{font-family:'Fraunces',serif; font-size:24px; font-weight:500; font-style:italic; color:var(--ink);}
  .date{font-size:10px; color:var(--ink3);}
  .seclabel{font-size:9.5px; letter-spacing:0.14em; text-transform:uppercase; color:var(--ink3); margin:0 0 4mm; break-after:avoid;}
  .seclabel:first-of-type{margin-top:0;}

  /* Fills all remaining space between the header and footer (minus a fixed
     6mm breathing gap above the footer rule), then distributes any leftover
     as even gaps BETWEEN the three sections (KPIs / Assets & Liabilities /
     Cashflow) rather than dumping it all as dead space after the last one —
     so the page always reaches the footer regardless of how much data a
     given client has. Verified in a real browser against both a typical
     client (5 asset rows) and the worst case (7 asset rows + 8 cashflow
     rows): content always sits exactly 6mm above the footer rule, with
     ~15mm of margin still to spare before real overflow in the worst case. */
  .ov-body{flex:1; min-height:0; display:flex; flex-direction:column; justify-content:space-between; margin-bottom:6mm;}

  /* ===== bordered KPI cards ===== */
  .card-kpi-row{display:flex; gap:6mm;}
  .card-kpi{flex:1; border:1px solid var(--line); border-radius:9px; padding:5mm 6mm; background:#FBFAF6;}
  .card-kpi .l{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink3); margin-bottom:3.5mm;}
  .card-kpi .v{font-family:'Fraunces',serif; font-weight:600; font-size:22px; color:var(--ink); margin-bottom:2mm;}
  .card-kpi .s{font-size:9px; color:var(--ink3);}

  /* ===== asset composition & liabilities ===== */
  .al-card{border:1px solid var(--line); border-radius:9px; padding:5mm 6mm; margin-bottom:4mm; display:grid; grid-template-columns:1fr 1fr; gap:10mm;}
  .al-col .al-h{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink3); margin-bottom:3.5mm;}
  .al-row{display:flex; justify-content:space-between; align-items:baseline; padding:2.2mm 0; border-bottom:1px dotted var(--line2); font-size:10.5px;}
  .al-row:last-child{border-bottom:none;}
  .al-row .lbl{color:var(--ink2); font-style:italic;}
  .al-row .amt{color:var(--ink);}

  .nw-bar{border:1px solid var(--gold, #B08D57); background:#F6F0E4; border-radius:9px; padding:4.5mm 6mm; display:flex; justify-content:space-between; align-items:center;}
  .nw-bar .l{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:#8A6D3F;}
  .nw-bar .v{font-family:'Fraunces',serif; font-weight:600; font-size:20px; color:var(--ink);}

  /* ===== annual cashflow ===== */
  .cashflow-wrap{display:grid; grid-template-columns:1.15fr 0.85fr; gap:9mm; border:1px solid var(--line); border-radius:9px; padding:5mm 6mm; margin-bottom:0;}
  .cf-row{display:flex; align-items:baseline; gap:6px; padding:2mm 0; border-bottom:1px solid var(--line);}
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

  /* ===== Executive Wealth Summary ===== */
  .ews-title{font-family:'Fraunces',serif; font-size:22px; font-weight:600; color:var(--ink); margin:0 0 3mm;}
  .ews-sub{font-size:10.5px; color:var(--ink2); margin-bottom:6mm; line-height:1.5;}
  .ews-nw-box{border:1.3px solid var(--gold, #B08D57); background:#F8F2E4; border-radius:9px; padding:4.5mm 7mm; margin-bottom:5mm;}
  .ews-nw-box .l{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:#8A6D3F; margin-bottom:3mm;}
  .ews-nw-box .v{font-family:'Fraunces',serif; font-weight:700; font-size:27px; color:var(--ink);}
  .ews-nw-box .rule{border-top:1px solid #DDCBA0; margin:4mm 0;}
  .ews-nw-box .cap{font-size:10px; font-style:italic; color:#6B5A3A;}
  .ews-cols{display:grid; grid-template-columns:1fr 1fr; gap:9mm; margin-bottom:5mm;}
  .ews-h{font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink3); margin-bottom:3mm;}
  .ews-row{display:flex; justify-content:space-between; align-items:baseline; padding:1.3mm 0; border-bottom:1px solid var(--line);}
  .ews-row .lbl{font-size:10px; color:var(--ink); line-height:1.3;}
  .ews-row .lbl .sub{display:block; font-size:8px; font-style:italic; color:var(--ink3); margin-top:0.5mm;}
  .ews-row .amt{font-size:10px; color:var(--ink); white-space:nowrap; padding-left:4mm;}
  .ews-row.total{border-bottom:none; border-top:1.3px solid var(--gold,#B08D57); padding-top:3mm; margin-top:1mm;}
  .ews-row.total .lbl, .ews-row.total .amt{font-weight:700; color:#8A6D3F; font-size:10.5px;}
  .ews-row.total-plain{border-bottom:none; border-top:1.3px solid var(--ink); padding-top:3mm; margin-top:1mm;}
  .ews-row.total-plain .lbl, .ews-row.total-plain .amt{font-weight:700; color:var(--ink); font-size:10.5px;}
  .ews-block-gap{margin-top:5mm;}
  .ews-surplus-box{background:#1A1A18; border-radius:9px; padding:4mm 6mm; margin-top:4mm; text-align:center;}
  .ews-surplus-box .l{font-size:9px; letter-spacing:0.1em; text-transform:uppercase; color:#B0AEA8;}
  .ews-surplus-box .v{font-family:'Fraunces',serif; font-weight:700; font-size:20px; color:#D9B475; margin-top:2mm;}
  .ews-ratios{display:grid; grid-template-columns:1fr 1fr 1fr; gap:5mm; margin-bottom:5mm;}
  .ews-ratios-narrow{gap:2.5mm;}
  .ews-ratios-narrow .ews-ratio{padding:3mm;}
  .ews-ratios-narrow .ews-ratio .v{font-size:14px;}
  .ews-ratios-narrow .ews-ratio .l{font-size:7px; margin-top:2mm;}
  .ews-ratios-narrow .ews-ratio .icon{width:10px; height:10px; font-size:6px; top:2.5mm; right:2.5mm;}
  .ews-ratio{border-radius:8px; padding:5mm; text-align:left; position:relative; border:1px solid transparent;}
  .ews-ratio.good{background:#EAF2ED; border-color:#BFDCCB;}
  .ews-ratio.watch{background:#F8F0DD; border-color:#E7CE95;}
  .ews-ratio.concern{background:#F7E9E6; border-color:#E5B3AA;}
  .ews-ratio .icon{position:absolute; top:3.5mm; right:3.5mm; width:12px; height:12px; border-radius:50%; border:1px solid currentColor; font-size:7px; font-family:'Fraunces',serif; font-style:italic; display:flex; align-items:center; justify-content:center; opacity:0.55;}
  .ews-ratio .v{font-family:'Fraunces',serif; font-weight:700; font-size:19px; display:block;}
  .ews-ratio.good .v, .ews-ratio.good .icon{color:#3F6B57;}
  .ews-ratio.watch .v, .ews-ratio.watch .icon{color:#8A6D3F;}
  .ews-ratio.concern .v, .ews-ratio.concern .icon{color:var(--accent);}
  .ews-ratio .l{font-size:8.5px; letter-spacing:0.06em; text-transform:uppercase; color:var(--ink3); margin-top:3mm; display:block;}
  .ews-ratio .l .sub2{display:block; font-size:8px; letter-spacing:normal; text-transform:none; font-style:italic; color:var(--ink3); margin-top:0.5mm;}
  .ews-runway{background:#EAF2ED; border-radius:9px; padding:4.5mm 6mm; margin-bottom:6mm; display:flex; justify-content:space-between; align-items:center; gap:6mm;}
  .ews-runway .txt{font-size:9.5px; color:#3F6B57; line-height:1.5;}
  .ews-runway .txt .l{font-size:9px; letter-spacing:0.08em; text-transform:uppercase; color:#3F6B57; font-weight:600; margin-bottom:2mm;}
  .ews-runway .v{font-family:'Fraunces',serif; font-weight:700; font-size:20px; color:#2E5442; white-space:nowrap;}

  @media print{
    body{background:none;}
    .page{box-shadow:none;}
    .card-kpi-row, .al-card, .cashflow-wrap{break-inside:avoid;}
    .ews-nw-box, .ews-surplus-box, .ews-ratios, .ews-runway{break-inside:avoid;}
  }
`