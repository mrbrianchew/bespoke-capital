import { NextResponse } from 'next/server'

// Escape user-supplied text so it can't inject markup into the email HTML.
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Very small in-memory rate limiter (per server instance). Basic abuse
// protection so this public endpoint can't be trivially spammed in a loop.
const hits = new Map<string, number[]>()
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 5
function rateLimited(key: string): boolean {
  const now = Date.now()
  const recent = (hits.get(key) || []).filter(t => now - t < WINDOW_MS)
  recent.push(now)
  hits.set(key, recent)
  return recent.length > MAX_PER_WINDOW
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const name = String(body.name || '').slice(0, 200)
  const email = String(body.email || '').slice(0, 200)
  const firm = String(body.firm || '').slice(0, 200)

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'Bespoke Capital <onboarding@resend.dev>',
      to: 'mrbrianchew@gmail.com',
      subject: 'New Advisor Signup — Approval Required',
      html: `
        <h2>New advisor registered</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Firm:</strong> ${escapeHtml(firm) || 'Not provided'}</p>
        <p>Log in to your <a href="https://bespoke-capital.vercel.app/admin">Admin Hub</a> to approve or reject.</p>
      `
    })
  })

  if (!res.ok) return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  return NextResponse.json({ success: true })
}
