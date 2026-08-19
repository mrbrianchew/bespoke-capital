import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { verifyReportPrintToken } from '@/lib/reportPrintToken'

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
// INCREMENT 1: Cover page only. Overview, Wealth Summary, Protection,
// Capital Fund, and Action Plan pages are built in the same @media print /
// break-after:page structure but not wired into this route yet — see the
// mockup (page5-protection-breakdown.html) for the approved design of each.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function ReportPrintPage({ params }: { params: { token: string } }) {
  const payload = verifyReportPrintToken(params.token)
  if (!payload) notFound()

  const [{ data: client }, { data: family }, { data: advisor }] = await Promise.all([
    supabaseAdmin.from('clients').select('id, name').eq('id', payload.clientId).maybeSingle(),
    supabaseAdmin.from('family_members').select('name, relationship').eq('client_id', payload.clientId),
    supabaseAdmin.from('advisors').select('name').eq('id', payload.advisorId).maybeSingle(),
  ])
  if (!client) notFound()

  const spouseName = (family || []).find(f => f.relationship === 'Spouse')?.name || null
  const advisorName = advisor?.name || 'Bespoke Capital'
  const datePrepared = formatDate(new Date())

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

          {/* Remaining pages (Overview, Wealth Summary, Protection ×6, Capital
              Fund ×3, Action Plan ×4) land here in subsequent increments,
              each its own <div className="page" break-after:page> per the
              approved mockup. */}
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

  @media print{
    body{background:none;}
    .page{box-shadow:none;}
  }
`