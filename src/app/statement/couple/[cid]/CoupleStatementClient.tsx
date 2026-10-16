'use client'

// Couple link page (/statement/couple/[cid]).
//
// One link and one password for a client and their spouse. This page only does the
// front door and the person switcher: it unlocks once, then shows each person's own
// statement form (the same form as /statement/[token]) one at a time. Each person keeps
// their own draft, Save, Submit and lock. Both forms stay mounted while hidden, so
// switching person never loses what was typed.

import React, { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import StatementClient, { PasswordGate, CenteredNotice } from '../../[token]/StatementClient'

type Person = 'client' | 'spouse'
type Phase = 'loading' | 'gate' | 'open' | 'expired' | 'notfound'
interface PersonInfo { person: Person; name: string; status?: string; expired?: boolean; token?: string | null }
interface Info { status: 'draft' | 'submitted'; started: boolean }

export default function CoupleStatementClient() {
  const params = useParams<{ cid: string }>()
  const cid = params?.cid || ''

  const [phase, setPhase] = useState<Phase>('loading')
  const [firm, setFirm] = useState('Bespoke Capital')
  const [year, setYear] = useState<number | null>(null)
  const [hint, setHint] = useState('')
  const [names, setNames] = useState<PersonInfo[]>([])
  const [people, setPeople] = useState<PersonInfo[]>([])
  const [pw, setPw] = useState('')
  const [pwError, setPwError] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [active, setActive] = useState<Person>('client')
  const [infos, setInfos] = useState<Partial<Record<Person, Info>>>({})

  useEffect(() => {
    if (!cid) return
    fetch(`/api/statement/couple/${cid}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) { setPhase('notfound'); return }
        if (j.firm) setFirm(j.firm)
        setYear(j.year ?? null)
        setHint(j.hint || '')
        setNames(j.people || [])
        setPhase(j.expired ? 'expired' : 'gate')
      })
      .catch(() => setPhase('notfound'))
  }, [cid])

  async function unlock(password: string) {
    setUnlocking(true); setPwError('')
    try {
      const res = await fetch(`/api/statement/couple/${cid}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const j = await res.json()
      if (!res.ok) {
        if (j.error === 'wrong_password') setPwError('Incorrect password. Please try again.')
        else if (j.error === 'expired') { setPhase('expired'); return }
        else if (j.error === 'too_many_attempts') setPwError('Too many attempts. Please wait a minute and try again.')
        else setPwError('Something went wrong. Please try again.')
        return
      }
      if (j.firm) setFirm(j.firm)
      const list: PersonInfo[] = j.people || []
      setPeople(list)
      setPw(password)
      setActive((list.find(p => p.person === 'client' && p.token) || list.find(p => p.token) || list[0])?.person || 'client')
      setPhase('open')
    } catch {
      setPwError('Something went wrong. Please try again.')
    } finally {
      setUnlocking(false)
    }
  }

  if (phase === 'loading') return <CenteredNotice firm={firm} title="Loading…" body="Preparing your financial statement." />
  if (phase === 'notfound') return <CenteredNotice firm={firm} title="Link Not Found" body="This link is invalid or has been removed. Please check with your advisor for a new link." />
  if (phase === 'expired') return <CenteredNotice firm={firm} title="Link Expired" body="This link has expired. Please contact your advisor to request a new one." />
  if (phase === 'gate') {
    const both = names.map(n => n.name).join(' & ')
    return <PasswordGate hint={hint} firm={firm} year={year} personName={both} onUnlock={unlock} error={pwError} busy={unlocking} />
  }

  const chip = (p: PersonInfo): { label: string; cls: string; sub: string } => {
    if (!p.token) return p.expired ? { label: 'LINK EXPIRED', cls: 'none', sub: 'Ask your advisor' } : { label: 'LOCKED', cls: 'none', sub: 'Password does not open this one' }
    const i = infos[p.person]
    const submitted = i ? i.status === 'submitted' : p.status === 'submitted'
    if (submitted) return { label: '✓ SUBMITTED', cls: 'done', sub: 'Final, shared with your advisor' }
    if (i?.started) return { label: 'IN PROGRESS', cls: 'prog', sub: 'Tap to continue' }
    return { label: 'NOT STARTED', cls: 'none', sub: 'Tap to begin' }
  }

  const switcher = (
    <div>
      <style>{COUPLE_CSS}</style>
      <p className="cp-help">You can fill in both statements here. Tap a name to switch. Each person is saved and submitted separately.</p>
      <div className="cp-who">
        {people.map(p => {
          const c = chip(p)
          return (
            <button key={p.person} type="button" className={active === p.person ? 'active' : ''}
              onClick={() => { setActive(p.person); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
              <div className="n"><span>{p.name}</span><span className={`chip ${c.cls}`}>{c.label}</span></div>
              <div className="s">{c.sub}</div>
            </button>
          )
        })}
      </div>
    </div>
  )

  const activeInfo = people.find(p => p.person === active)

  return (
    <div style={{ background: '#F5F3EE', minHeight: '100vh' }}>
      <div style={{ background: '#1C1A17', color: '#F5F3EE', padding: '18px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontFamily: 'Cormorant Garamond,Georgia,serif', fontSize: 17, letterSpacing: 2.5 }}>BESPOKE <span style={{ color: '#A8834A' }}>CAPITAL</span></div>
        <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(245,243,238,0.4)' }}>{firm}</div>
      </div>
      {people.map(p => p.token ? (
        <div key={p.person} style={{ display: active === p.person ? 'block' : 'none' }}>
          <StatementClient
            tokenProp={p.token} presetPassword={pw} embedded topSlot={switcher}
            onInfo={i => setInfos(m => (m[p.person]?.status === i.status && m[p.person]?.started === i.started ? m : { ...m, [p.person]: i }))}
          />
        </div>
      ) : null)}
      {activeInfo && !activeInfo.token && (
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '36px 20px' }}>
          {switcher}
          <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 13, color: '#6B665E', fontFamily: 'Inter,sans-serif' }}>
            {activeInfo.expired
              ? `${activeInfo.name}’s link has expired. Please contact your advisor to request a new one.`
              : `This password does not open ${activeInfo.name}’s statement. Please ask your advisor.`}
          </div>
        </div>
      )}
    </div>
  )
}

// Person switcher styles (same look as the app's statement page: cream, gold, serif names).
const COUPLE_CSS = `
.cp-help{font-size:12.5px;color:#6B665E;line-height:1.55;margin:0 0 12px;font-family:Inter,sans-serif;}
.cp-who{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:26px;}
.cp-who button{font-family:Inter,sans-serif;text-align:left;background:#fff;border:1px solid #E4E1DA;border-radius:10px;padding:14px 16px;cursor:pointer;display:block;}
.cp-who button .n{font-family:'Cormorant Garamond',Georgia,serif;font-size:20px;font-weight:600;color:#1C1A17;display:flex;justify-content:space-between;align-items:center;gap:8px;}
.cp-who button .s{font-size:11px;color:#8B867E;margin-top:3px;}
.cp-who button.active{border:1.5px solid #A8834A;background:#F5EFE3;}
.cp-who .chip{font-family:Inter,sans-serif;font-size:9.5px;font-weight:700;letter-spacing:.4px;padding:2px 8px;border-radius:10px;white-space:nowrap;}
.cp-who .chip.prog{background:#F5EFE3;color:#8A6C3A;border:1px solid #E4DBC8;}
.cp-who .chip.done{background:#E8F2ED;color:#2A5E46;}
.cp-who .chip.none{background:#ECEAE4;color:#8B867E;}
@media (max-width:640px){.cp-who{grid-template-columns:1fr;}}
`