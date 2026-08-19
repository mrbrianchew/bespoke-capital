import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { signReportPrintToken } from '@/lib/reportPrintToken'

// Runs under the advisor's own session (standard cookie auth, same pattern
// as update-last-active/route.ts) — this is the ONLY place that checks "is
// this advisor allowed to export this client's report". Once that check
// passes, it mints a short-lived signed token (reportPrintToken.ts) and
// hands it to a real, server-launched Chromium via puppeteer, which
// navigates to the token-gated /report-print/[token] route and exports it
// as a PDF. The advisor's browser never talks to Puppeteer directly.
//
// Uses puppeteer-core + @sparticuz/chromium, NOT the vanilla `puppeteer`
// package. The vanilla package downloads its own Chromium binary to a local
// cache directory at `npm install` time, and that binary does not survive
// Vercel's build → deploy packaging step — the function ships without it and
// fails at request time with "Could not find Chrome" (confirmed in
// production on this route's first deploy). @sparticuz/chromium instead
// ships a serverless-packaged Chromium as an actual npm dependency asset, so
// it's included in the deployed bundle the same way any other node_modules
// file is.
//
// Locally (npm run dev), @sparticuz/chromium's bundled binary doesn't run on
// most dev machines (it's built for Amazon Linux/Vercel's runtime) — so in
// development this falls back to a Chrome install already on the machine.
// Requires Chrome/Chromium to be installed locally; set
// PUPPETEER_EXECUTABLE_PATH if it's not in one of the common locations below.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://bespoke-capital.vercel.app'
const CREATOR_ID = process.env.CREATOR_ID || process.env.NEXT_PUBLIC_CREATOR_ID

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const LOCAL_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
  '/usr/bin/google-chrome', // Linux
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Windows
]

async function resolveExecutablePath(): Promise<string> {
  if (process.env.VERCEL) return chromium.executablePath()
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH
  const fs = await import('fs')
  const found = LOCAL_CHROME_PATHS.find(p => fs.existsSync(p))
  if (found) return found
  // Last resort even locally — same as production, in case a local Chrome
  // install can't be found automatically.
  return chromium.executablePath()
}

export async function POST(req: Request) {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const clientId: string = body?.clientId
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // Ownership check — the one thing this route exists to enforce. Creator
  // bypasses (matches the NEXT_PUBLIC_CREATOR_ID pattern used for Admin Hub
  // access elsewhere), everyone else must own the client record.
  const { data: clientRow } = await supabaseAdmin.from('clients').select('id, advisor_id').eq('id', clientId).maybeSingle()
  if (!clientRow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (clientRow.advisor_id !== user.id && user.id !== CREATOR_ID) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const token = signReportPrintToken({ clientId, advisorId: user.id })
  const printUrl = `${APP_URL}/report-print/${token}`

  let browser
  try {
    const executablePath = await resolveExecutablePath()
    browser = await puppeteer.launch({
      executablePath,
      args: process.env.VERCEL ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
    })
    const page = await browser.newPage()
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 45_000 })
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="financial-report-${clientId}.pdf"`,
      },
    })
  } catch (err) {
    console.error('PDF export failed:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: 'pdf_generation_failed', message }, { status: 500 })
  } finally {
    if (browser) await browser.close()
  }
}