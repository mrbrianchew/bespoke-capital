'use client'

import { useEffect, useRef, useState } from 'react'

// ─── DATE INPUT ─────────────────────────────────────────────────────────────
// Drop-in replacement for native <input type="date">.
// - Always displays/accepts dd/mm/yyyy (Singapore convention), regardless of
//   browser or OS locale (native date inputs vary: Safari often shows
//   mm/dd/yyyy, Chrome follows OS locale).
// - value / onChange contract matches native <input type="date">: the value
//   prop and the string passed to onChange are always ISO 'YYYY-MM-DD' (or
//   '' when empty), so this is a safe swap wherever a native date input was
//   used — no changes needed to surrounding state/save logic.

interface DateInputProps {
  value: string // 'YYYY-MM-DD' or ''
  onChange: (value: string) => void
  style?: React.CSSProperties
  className?: string
  placeholder?: string
  disabled?: boolean
}

function isoToDisplay(iso: string): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ''
  const [, y, mo, d] = m
  return `${d}/${mo}/${y}`
}

function displayToIso(display: string): string {
  // Accepts a fully-typed dd/mm/yyyy string. Returns '' if incomplete/invalid.
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display)
  if (!m) return ''
  const [, d, mo, y] = m
  const day = parseInt(d, 10)
  const month = parseInt(mo, 10)
  const year = parseInt(y, 10)
  if (month < 1 || month > 12) return ''
  const daysInMonth = new Date(year, month, 0).getDate()
  if (day < 1 || day > daysInMonth) return ''
  return `${y}-${mo}-${d}`
}

// Reformats raw keystrokes into dd/mm/yyyy as the user types, inserting '/'
// automatically and capping each segment's length.
function maskInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  const d = digits.slice(0, 2)
  const mo = digits.slice(2, 4)
  const y = digits.slice(4, 8)
  let out = d
  if (mo) out += '/' + mo
  if (y) out += '/' + y
  return out
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export default function DateInput({
  value,
  onChange,
  style,
  className,
  placeholder = 'dd/mm/yyyy',
  disabled,
}: DateInputProps) {
  const [text, setText] = useState(isoToDisplay(value))
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    return m ? parseInt(m[1], 10) : new Date().getFullYear()
  })
  const [viewMonth, setViewMonth] = useState(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    return m ? parseInt(m[2], 10) - 1 : new Date().getMonth()
  })
  const wrapRef = useRef<HTMLDivElement>(null)

  // Keep local text in sync if the external value changes (e.g. parent reset).
  useEffect(() => {
    setText(isoToDisplay(value))
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (m) {
      setViewYear(parseInt(m[1], 10))
      setViewMonth(parseInt(m[2], 10) - 1)
    }
  }, [value])

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleTextChange = (raw: string) => {
    const masked = maskInput(raw)
    setText(masked)
    if (masked.length === 10) {
      const iso = displayToIso(masked)
      if (iso) {
        onChange(iso)
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
        if (m) {
          setViewYear(parseInt(m[1], 10))
          setViewMonth(parseInt(m[2], 10) - 1)
        }
      }
    } else if (masked.length === 0) {
      onChange('')
    }
  }

  const handleTextBlur = () => {
    // On blur, if text doesn't resolve to a valid date, revert to last valid value.
    if (text.length > 0) {
      const iso = displayToIso(text)
      if (!iso) {
        setText(isoToDisplay(value))
      }
    }
  }

  const selectedIso = displayToIso(text) || value

  const daysInView = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7 // Mon=0
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInView }, (_, i) => i + 1),
  ]

  const goPrevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1) } else { setViewMonth(viewMonth - 1) }
  }
  const goNextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1) } else { setViewMonth(viewMonth + 1) }
  }

  const pickDay = (day: number) => {
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    onChange(iso)
    setText(isoToDisplay(iso))
    setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: style?.width || '100%' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          inputMode="numeric"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleTextBlur}
          onFocus={() => setOpen(true)}
          className={className}
          style={{
            ...style,
            width: '100%',
            paddingRight: 34,
            fontFamily: style?.fontFamily || 'inherit',
          }}
        />
        <button
          type="button"
          aria-label="Open calendar"
          tabIndex={-1}
          onClick={() => setOpen((o) => !o)}
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            cursor: disabled ? 'default' : 'pointer',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
            color: 'var(--ink3, #9A9690)',
          }}
          disabled={disabled}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
      </div>

      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 50,
            background: 'var(--cream, #F5F3EE)',
            border: '1px solid var(--cream3, #E4E1DA)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(28,26,23,0.14)',
            padding: 14,
            width: 268,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button
              type="button"
              onClick={goPrevMonth}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink2, #4A4740)', fontSize: 14, padding: 4 }}
            >
              ‹
            </button>
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, color: 'var(--charcoal, #1C1A17)', fontWeight: 600 }}>
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={goNextMonth}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink2, #4A4740)', fontSize: 14, padding: 4 }}
            >
              ›
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {WEEKDAY_NAMES.map((w) => (
              <div
                key={w}
                style={{
                  textAlign: 'center',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  color: 'var(--ink3, #9A9690)',
                  padding: '4px 0',
                }}
              >
                {w}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((day, i) => {
              if (day === null) return <div key={`blank-${i}`} />
              const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const isSelected = iso === selectedIso
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pickDay(day)}
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'DM Mono, monospace',
                    background: isSelected ? 'var(--gold, #A8834A)' : 'transparent',
                    color: isSelected ? '#fff' : 'var(--ink, #1A1816)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'var(--cream2, #ECEAE4)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
