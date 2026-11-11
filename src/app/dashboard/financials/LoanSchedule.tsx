'use client'

import React, { useMemo, useState } from 'react'
import { buildLoanSchedule } from '@/lib/loanSchedule'

const money = (n: number) => 'S$' + Math.round(n).toLocaleString()

// Hidden-by-default loan schedule shown inside each property card.
export default function LoanSchedule({
  outstanding, ratePct, remainingYears, clientAge, spouseAge, isCouple, enteredMonthly,
}: {
  outstanding: number
  ratePct: number
  remainingYears: number
  clientAge?: number
  spouseAge?: number
  isCouple?: boolean
  enteredMonthly?: number  // repayment typed in by the advisor, if any
}) {
  const [open, setOpen] = useState(false)
  const schedule = useMemo(
    () => buildLoanSchedule({ outstanding, ratePct, remainingYears, clientAge, spouseAge }),
    [outstanding, ratePct, remainingYears, clientAge, spouseAge],
  )
  if (!schedule) return null

  const showSpouse = !!isCouple && !!spouseAge
  const showClient = !!clientAge
  const last = schedule.rows[schedule.rows.length - 1]
  const differs = !!enteredMonthly && Math.abs(enteredMonthly - schedule.monthlyPayment) > 1

  const th: React.CSSProperties = {
    position: 'sticky', top: 0, background: 'var(--cream2)', textAlign: 'right', fontWeight: 600,
    fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink2)',
    padding: '7px 10px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = { padding: '5px 10px', textAlign: 'right', borderBottom: '1px solid #F0EEE9', whiteSpace: 'nowrap' }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 text-xs px-3 py-2 text-left"
        style={{ border: '1px solid var(--line)', background: 'white', color: 'var(--ink)', cursor: 'pointer' }}
      >
        <span style={{ color: 'var(--ink3)', fontSize: 10, display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
        <span className="font-medium">Loan schedule</span>
        <span className="ml-auto" style={{ color: 'var(--ink3)' }}>{open ? 'Hide' : 'Show'} balance by age</span>
      </button>

      {open && (
        <div style={{ border: '1px solid var(--line)', borderTop: 'none', background: 'white' }}>
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            <table className="text-xs" style={{ borderCollapse: 'collapse', width: '100%', fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Year</th>
                  {showClient && <th style={th}>Client age</th>}
                  {showSpouse && <th style={th}>Spouse age</th>}
                  <th style={th}>Paid in year</th>
                  <th style={th}>Interest</th>
                  <th style={th}>Principal</th>
                  <th style={th}>Balance left</th>
                </tr>
              </thead>
              <tbody>
                {schedule.rows.map((row, i) => {
                  const isNow = i === 0
                  const isPaid = row.balance <= 0.5
                  const bg = isNow ? 'var(--emerald-l)' : isPaid ? '#F4F4F4' : undefined
                  return (
                    <tr key={row.year} style={{ background: bg, fontWeight: isNow ? 600 : undefined, color: isPaid ? 'var(--ink3)' : undefined }}>
                      <td style={{ ...td, textAlign: 'left' }}>
                        {row.year}
                        {isNow && <span className="ml-2 px-1" style={{ background: 'var(--emerald)', color: 'white', fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Today</span>}
                      </td>
                      {showClient && <td style={td}>{row.clientAge ?? '—'}</td>}
                      {showSpouse && <td style={td}>{row.spouseAge ?? '—'}</td>}
                      <td style={td}>{row.paid === null ? '—' : money(row.paid)}</td>
                      <td style={td}>{row.interest === null ? '—' : money(row.interest)}</td>
                      <td style={td}>{row.principal === null ? '—' : money(row.principal)}</td>
                      <td style={td}><b>{isPaid ? 'Paid off' : money(row.balance)}</b></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap text-xs px-3 py-2" style={{ gap: '4px 16px', borderTop: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink2)' }}>
            <span>Total interest still to pay: <b style={{ color: 'var(--ink)' }}>{money(schedule.totalInterest)}</b></span>
            <span>
              Paid off in <b style={{ color: 'var(--ink)' }}>{last.year}</b>
              {last.clientAge ? <> (client age <b style={{ color: 'var(--ink)' }}>{last.clientAge}</b>{showSpouse && last.spouseAge ? <>, spouse <b style={{ color: 'var(--ink)' }}>{last.spouseAge}</b></> : null})</> : null}
            </span>
            <span>
              Based on calculated repayment {money(schedule.monthlyPayment)}/mo
              {differs ? ` — the ${money(enteredMonthly as number)}/mo entered above is not used here` : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}