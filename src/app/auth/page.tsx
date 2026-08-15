'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Particle = { left: number; dur: number; delay: number; dx: number }

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [firm, setFirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const router = useRouter()
  const supabase = createClient()

  // Particles and the live clock are generated/started client-side only, so
  // the server-rendered HTML and the first client render match exactly (no
  // Math.random() or Date.now() during render — both would cause a
  // hydration mismatch). They populate a beat after mount.
  const [particles, setParticles] = useState<Particle[]>([])
  const [clock, setClock] = useState<string | null>(null)

  useEffect(() => {
    setParticles(
      Array.from({ length: 14 }).map(() => ({
        left: Math.random() * 100,
        dur: 8 + Math.random() * 10,
        delay: Math.random() * 10,
        dx: Math.random() * 30 - 15,
      }))
    )
  }, [])

  useEffect(() => {
    function tick() {
      const now = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date())
      setClock(now)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [])

  const tickMarks = useMemo(() => {
    return Array.from({ length: 24 }).map((_, i) => {
      const a = (i * 15 * Math.PI) / 180
      const r1 = 92, r2 = i % 6 === 0 ? 82 : 87
      return { x1: 100 + r1 * Math.cos(a), y1: 100 + r1 * Math.sin(a), x2: 100 + r2 * Math.cos(a), y2: 100 + r2 * Math.sin(a) }
    })
  }, [])

  async function handleResetRequest(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    setLoading(false)
    // Generic message regardless of outcome — don't reveal whether the email is registered.
    if (error && error.status && error.status >= 500) {
      setError('Something went wrong sending the reset email. Please try again.')
      return
    }
    setMessage('If an account exists for that email, a password reset link has been sent.')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    if (mode === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); setLoading(false); return }
      // Check approval status
      const { data: adv } = await supabase.from('advisors').select('status').eq('id', data.user.id).maybeSingle()
      if (!adv || adv.status !== 'approved') {
        await supabase.auth.signOut()
        setError(
          adv?.status === 'suspended'
            ? 'Your account has been suspended. Contact your administrator for access.'
            : 'Your account is awaiting approval. You will be notified once approved.'
        )
        setLoading(false)
        return
      }
      router.push('/dashboard')
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name, firm } } })
      if (error) { setError(error.message); setLoading(false); return }
      if (data.user) {
        // Create advisor row as pending
        await supabase.from('advisors').upsert({ id: data.user.id, name, email, firm, status: 'pending' })
        // Notify admin
        await fetch('/api/notify-signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, firm }) })
      }
      setMessage('Account created! Your account is pending approval. We will notify you once approved.')
    }
    setLoading(false)
  }

  const inputStyle = {
    background: 'white',
    border: '1px solid var(--line)',
    color: 'var(--ink)',
  } as const

  return (
    <div className="min-h-screen flex flex-col md:flex-row" style={{ background: 'var(--cream)' }}>
      <style>{`
        @keyframes sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ping { 0% { r: 6; opacity: 0.55; } 100% { r: 92; opacity: 0; } }
        @keyframes drift {
          0% { transform: translateY(0) translateX(0); opacity: 0; }
          10% { opacity: 0.5; }
          90% { opacity: 0.3; }
          100% { transform: translateY(-140px) translateX(var(--dx, 0px)); opacity: 0; }
        }
        @keyframes scanline {
          0% { transform: translateY(-20%); opacity: 0; }
          10% { opacity: 0.5; }
          90% { opacity: 0.5; }
          100% { transform: translateY(420px); opacity: 0; }
        }
        @keyframes revealUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        .sweep-hand { animation: sweep 14s linear infinite; transform-origin: 50% 50%; }
        .ping-ring { animation: ping 4s cubic-bezier(0.2, 0.6, 0.4, 1) infinite; transform-origin: 100px 100px; }
        .ping-ring.d2 { animation-delay: 1.3s; }
        .ping-ring.d3 { animation-delay: 2.6s; }
        .particle { position: absolute; width: 2px; height: 2px; border-radius: 50%; background: #C4A464; animation: drift linear infinite; }
        .scanline {
          position: absolute; left: 0; right: 0; height: 90px; pointer-events: none;
          background: linear-gradient(180deg, transparent 0%, rgba(196,164,100,0.10) 45%, rgba(196,164,100,0.16) 50%, rgba(196,164,100,0.10) 55%, transparent 100%);
          animation: scanline 6s ease-in-out infinite; animation-delay: 1s;
        }
        .reveal { opacity: 0; animation: revealUp 0.7s cubic-bezier(0.2,0.7,0.3,1) forwards; }
        .reveal.r1 { animation-delay: 0.05s; }
        .reveal.r2 { animation-delay: 0.2s; }
        .reveal.r3 { animation-delay: 0.38s; }
        .reveal.r4 { animation-delay: 0.5s; }

        .auth-input:focus { border-color: var(--gold) !important; box-shadow: 0 0 0 3px rgba(168,131,74,0.15); }
        .auth-cta { position: relative; overflow: hidden; background: linear-gradient(135deg, #B99359 0%, #8A6C3A 100%); transition: box-shadow .2s ease, transform .2s ease; }
        .auth-cta:not(:disabled):hover { box-shadow: 0 6px 24px rgba(168,131,74,0.35); transform: translateY(-1px); }
        .auth-cta::after {
          content: ''; position: absolute; top: 0; left: -60%; width: 40%; height: 100%;
          background: linear-gradient(115deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%);
          transform: skewX(-20deg); transition: left .6s ease;
        }
        .auth-cta:not(:disabled):hover::after { left: 130%; }
        .status-dot { width: 5px; height: 5px; border-radius: 50%; background: #6FBF8E; box-shadow: 0 0 6px #6FBF8E; animation: blink 2.4s ease-in-out infinite; }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

        @media (prefers-reduced-motion: reduce) {
          .sweep-hand, .ping-ring, .particle, .scanline, .reveal, .status-dot { animation: none !important; }
          .reveal { opacity: 1; transform: none; }
          .auth-cta::after { display: none; }
        }
      `}</style>

      {/* Identity panel — compact band on mobile, full column from md up */}
      <div
        className="relative flex-shrink-0 overflow-hidden flex items-center justify-between gap-4 px-6 py-5 md:block md:px-12 md:py-12 md:w-[400px] lg:w-[460px]"
        style={{ background: 'linear-gradient(165deg, #201D19 0%, #14120F 100%)', borderBottom: '1px solid rgba(168,131,74,0.25)' }}
      >
        {/* constellation texture */}
        <div
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.9) 0.6px, transparent 0.6px)', backgroundSize: '22px 22px' }}
        />

        {/* scanline + drifting particles — desktop only, keeps the mobile strip clean */}
        <div className="hidden md:block scanline" />
        <div className="hidden md:block absolute inset-0 pointer-events-none overflow-hidden">
          {particles.map((p, i) => (
            <div
              key={i}
              className="particle"
              style={{ left: `${p.left}%`, bottom: '-10px', '--dx': `${p.dx}px`, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` } as React.CSSProperties}
            />
          ))}
        </div>

        {/* precision instrument mark */}
        <div className="hidden md:block absolute -right-16 top-1/2 -translate-y-1/2 opacity-80 pointer-events-none">
          <svg width="360" height="360" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="92" fill="none" stroke="rgba(168,131,74,0.14)" strokeWidth="1" />
            <circle cx="100" cy="100" r="66" fill="none" stroke="rgba(168,131,74,0.18)" strokeWidth="1" />
            <circle cx="100" cy="100" r="40" fill="none" stroke="rgba(168,131,74,0.22)" strokeWidth="1" />
            {tickMarks.map((t, i) => (
              <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="rgba(168,131,74,0.35)" strokeWidth="1" />
            ))}
            <circle className="ping-ring" cx="100" cy="100" r="6" fill="none" stroke="#C4A464" strokeWidth="1" />
            <circle className="ping-ring d2" cx="100" cy="100" r="6" fill="none" stroke="#C4A464" strokeWidth="1" />
            <circle className="ping-ring d3" cx="100" cy="100" r="6" fill="none" stroke="#C4A464" strokeWidth="1" />
            <circle cx="100" cy="100" r="2.5" fill="#C4A464" />
            <g className="sweep-hand">
              <line x1="100" y1="100" x2="100" y2="12" stroke="url(#sweepGrad)" strokeWidth="1.5" />
            </g>
            <defs>
              <linearGradient id="sweepGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#C4A464" stopOpacity="0" />
                <stop offset="100%" stopColor="#C4A464" stopOpacity="0.9" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* mobile: compact lockup */}
        <div className="relative flex items-center gap-3 md:hidden">
          <svg width="34" height="34" viewBox="0 0 200 200" className="flex-shrink-0">
            <circle cx="100" cy="100" r="92" fill="none" stroke="rgba(168,131,74,0.3)" strokeWidth="3" />
            <circle cx="100" cy="100" r="55" fill="none" stroke="rgba(168,131,74,0.5)" strokeWidth="3" />
            <circle cx="100" cy="100" r="6" fill="#C4A464" />
          </svg>
          <div>
            <div className="font-serif text-lg leading-none" style={{ color: '#F0EDE8' }}>Bespoke Capital</div>
            <div className="font-mono text-[10px] tracking-[0.2em] uppercase" style={{ color: 'rgba(168,131,74,0.65)' }}>Financial Plan</div>
          </div>
        </div>
        <div className="relative font-mono text-[10px] tracking-[0.15em] uppercase md:hidden flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
          <span className="status-dot" />
          {clock || '--:--:--'}
        </div>

        {/* desktop: full identity block */}
        <div className="relative hidden md:flex md:flex-col md:justify-between md:h-full">
          <div>
            <div className="font-serif text-2xl font-semibold mb-1" style={{ color: '#F0EDE8' }}>Bespoke Capital</div>
            <div className="font-mono text-[11px] tracking-[0.2em] uppercase" style={{ color: 'rgba(168,131,74,0.65)' }}>Financial Plan</div>
          </div>
          <div className="mt-20">
            <div className="font-serif reveal r1" style={{ fontSize: 36, fontWeight: 300, lineHeight: 1.2, color: '#F0EDE8' }}>Your clients.</div>
            <div className="font-serif reveal r2" style={{ fontSize: 36, fontWeight: 300, lineHeight: 1.2, color: '#F0EDE8' }}>Their future.</div>
            <div className="font-serif reveal r3" style={{ fontSize: 36, fontWeight: 300, lineHeight: 1.2, color: '#C4A464', marginBottom: 20 }}>Planned precisely.</div>
            <div className="reveal r4 text-sm leading-relaxed max-w-xs" style={{ color: 'rgba(255,255,255,0.32)' }}>A professional financial planning platform built for Singapore advisors.</div>
          </div>
          <div className="reveal r4 flex items-center justify-between mt-20">
            <div className="font-mono text-[10px] tracking-[0.1em]" style={{ color: 'rgba(255,255,255,0.2)' }}>FINANCIAL PLANNING ADVISORY PTE LTD</div>
            <div className="font-mono text-[10px] tracking-[0.12em] flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
              <span className="status-dot" />
              {clock ? `${clock} SGT` : '--:--:-- SGT'}
            </div>
          </div>
        </div>
      </div>

      {/* form panel */}
      <div className="flex-1 flex items-start md:items-center justify-center px-5 py-8 sm:px-8 md:p-12">
        <div className="w-full max-w-md">
          <div className="mb-7 md:mb-8">
            <h1 className="font-serif text-2xl sm:text-3xl font-light mb-2" style={{ color: 'var(--ink)' }}>
              {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset your password'}
            </h1>
            <p className="text-sm" style={{ color: 'var(--ink3)' }}>
              {mode === 'login' ? 'Sign in to your advisor account' : mode === 'signup' ? 'Set up your advisor profile' : "Enter your email and we'll send you a reset link"}
            </p>
          </div>
          {mode === 'reset' ? (
            <form onSubmit={handleResetRequest} className="space-y-4">
              <div>
                <label htmlFor="reset-email" className="block font-mono text-[11px] tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Email</label>
                <input id="reset-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" className="auth-input w-full px-4 py-3.5 text-base outline-none transition-colors" style={inputStyle} />
              </div>
              {error && <div className="px-4 py-3 text-sm" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)', borderLeft: '2px solid var(--rouge)' }}>{error}</div>}
              {message && <div className="px-4 py-3 text-sm" style={{ background: 'var(--emerald-l)', color: 'var(--emerald)', borderLeft: '2px solid var(--emerald)' }}>{message}</div>}
              <button type="submit" disabled={loading} className="auth-cta w-full py-3.5 text-sm font-semibold tracking-widest uppercase disabled:opacity-60" style={{ color: loading ? 'white' : '#1C1A17', background: loading ? 'var(--ink2)' : undefined }}>
                {loading ? 'Please wait…' : 'Send Reset Link'}
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label htmlFor="signup-name" className="block font-mono text-[11px] tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Full Name</label>
                  <input id="signup-name" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Sarah Tan" className="auth-input w-full px-4 py-3.5 text-base outline-none transition-colors" style={inputStyle} />
                </div>
                <div>
                  <label htmlFor="signup-firm" className="block font-mono text-[11px] tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Firm/Team Name</label>
                  <input id="signup-firm" type="text" autoComplete="organization" value={firm} onChange={e => setFirm(e.target.value)} placeholder="e.g. Financial Planning Advisory" className="auth-input w-full px-4 py-3.5 text-base outline-none transition-colors" style={inputStyle} />
                </div>
              </>
            )}
            <div>
              <label htmlFor="auth-email" className="block font-mono text-[11px] tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Email</label>
              <input id="auth-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" className="auth-input w-full px-4 py-3.5 text-base outline-none transition-colors" style={inputStyle} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2 gap-3">
                <label htmlFor="auth-password" className="block font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Password</label>
                {mode === 'login' && (
                  <button type="button" onClick={() => { setMode('reset'); setError(''); setMessage('') }} className="text-xs flex-shrink-0" style={{ color: 'var(--gold)' }}>
                    Forgot password?
                  </button>
                )}
              </div>
              <input id="auth-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" className="auth-input w-full px-4 py-3.5 text-base outline-none transition-colors" style={inputStyle} />
            </div>
            {error && <div className="px-4 py-3 text-sm" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)', borderLeft: '2px solid var(--rouge)' }}>{error}</div>}
            {message && <div className="px-4 py-3 text-sm" style={{ background: 'var(--emerald-l)', color: 'var(--emerald)', borderLeft: '2px solid var(--emerald)' }}>{message}</div>}
            <button type="submit" disabled={loading} className="auth-cta w-full py-3.5 text-sm font-semibold tracking-widest uppercase disabled:opacity-60" style={{ color: loading ? 'white' : '#1C1A17', background: loading ? 'var(--ink2)' : undefined }}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
          )}
          <div className="mt-6 text-center">
            {mode === 'reset' ? (
              <button onClick={() => { setMode('login'); setError(''); setMessage('') }} className="text-sm py-2" style={{ color: 'var(--ink3)' }}>
                Back to sign in
              </button>
            ) : (
              <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }} className="text-sm py-2" style={{ color: 'var(--ink3)' }}>
                {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}