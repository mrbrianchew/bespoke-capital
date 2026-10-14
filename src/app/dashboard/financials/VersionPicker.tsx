'use client'

// "Plan as at" picker for the Fact Finding header. Lists the client's saved
// versions (fact_finding_versions). Choosing one asks the page to show that
// version read-only; choosing "Current plan" returns to the live plan.
// This component only reads; it never writes anything.

import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const KIND: Record<string, string> = { initial: 'Initial plan', review: 'Annual review', earlier: 'Earlier record' }
interface Opt { id: string; as_at: string; kind: string }

export const fmtAsAtLabel = (s: string) => {
  const [y, m] = s.split('-')
  return `${MONTHS[Number(m) - 1]} ${y}`
}

export default function VersionPicker({ clientId, activeId, tick, onSelect }: {
  clientId: string
  activeId: string | null
  tick: number
  onSelect: (id: string | null) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [opts, setOpts] = useState<Opt[]>([])

  useEffect(() => {
    let off = false
    supabase.from('fact_finding_versions')
      .select('id, as_at, kind')
      .eq('client_id', clientId)
      .eq('section', 'financials')
      .order('as_at', { ascending: false })
      .then(({ data }) => { if (!off) setOpts((data as Opt[] | null) || []) })
    return () => { off = true }
  }, [clientId, tick, supabase])

  if (opts.length === 0) return null

  return (
    <label className="flex flex-col" style={{ marginRight: 16 }}>
      <span style={{ fontSize: 9, letterSpacing: '0.11em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)', marginBottom: 4 }}>Plan as at</span>
      <select
        value={activeId || ''}
        onChange={e => onSelect(e.target.value || null)}
        aria-label="Plan as at"
        style={{
          background: activeId ? 'rgba(168,131,74,0.25)' : 'rgba(255,255,255,0.06)',
          border: activeId ? '1.5px solid rgba(168,131,74,0.8)' : '1px solid rgba(255,255,255,0.15)',
          color: '#C4A464', fontSize: 12, padding: '6px 10px', outline: 'none', cursor: 'pointer', minWidth: 190,
        }}
      >
        <option value="" style={{ background: '#1A1816' }}>Current plan (live)</option>
        {opts.map(o => (
          <option key={o.id} value={o.id} style={{ background: '#1A1816' }}>
            {fmtAsAtLabel(o.as_at)} · {KIND[o.kind] || o.kind}
          </option>
        ))}
      </select>
    </label>
  )
}