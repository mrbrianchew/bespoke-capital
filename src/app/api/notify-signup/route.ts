import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { name, email, firm } = await req.json()

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
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Firm:</strong> ${firm || 'Not provided'}</p>
        <p>Log in to your <a href="https://bespoke-capital.vercel.app/admin">Admin Hub</a> to approve or reject.</p>
      `
    })
  })

  if (!res.ok) return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  return NextResponse.json({ success: true })
}
