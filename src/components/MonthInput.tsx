'use client'

import { useEffect, useRef, useState } from 'react'

// ─── MONTH INPUT ────────────────────────────────────────────────────────────
// Drop-in replacement for native <input type="month">.
// - Always displays/accepts mm/yyyy, regardless of browser/OS locale (native
//   month inputs render inconsistently across browsers the same way native
//   date inputs do — Safari's picker UI and formatting differs from Chrome's).
// - value / onChange contract matches native <input type="month">: the value
//   prop and the string passed to onChange are always 'YYYY-MM' (or '' when
//   empty), so this is a safe swap wherever a native month input was used —
//   no changes needed to surrounding state/save logic.

interface MonthInputProps {
  value: string // 'YYYY-MM' or ''
  onChange: (value: string) => void
  min?: string // 'YYYY-MM' — months before this are disabled (mirrors native min)
  max?: string // 'YYYY-MM' — months after this are disabled (mirrors native max)
  style?: React.CSSProperties
  className?: string
  placeholder?: string
  disabled?: boolean
}

function isoToDisplay(iso: string): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})$/.exec(iso)
  if (!m) return ''
  const [, y, mo] = m
  return `${mo}/${y}`
}

function displayToIso(display: string): string {
  // Accepts a fully-typed mm/yyyy string. Returns '' if incomplete/invalid.
  const m = /^(\d{2})\/(\d{4})$/.exec(display)
  if (!m) return ''
  const [, mo, y] = m
  const month = parseInt(mo, 10)
  if (month < 1 || month > 12) return ''
  return `${y}-${mo}`
}

// Reformats raw keystrokes into mm/yyyy as the user types, inserting '/'
// automatically and capping each segment's length.
function maskInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 6)
  const mo = digits.slice(0, 2)
  const y = digits.slice(2, 6)
  let out = mo
  if (y) out += '/' + y
  return out
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function MonthInput({
  value,
  onChange,
  min,
  max,
  style,
  className,
  placeholder = 'mm/yyyy',
  disabled,
}: MonthInputProps) {
  const [text, setText] = useState(isoToDisplay(value))
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(value)
    return m ? parseInt(m[1], 10) : new Date().getFullYear()
  })
  const wrapRef = useRef<HTMLDivElement>(null)

  // Keep local text in sync if the external value changes (e.g. parent reset).
  useEffect(() => {
    setText(isoToDisplay(value))
    const m = /^(\d{4})-(\d{2})$/.exec(value)
    if (m) setViewYear(parseInt(m[1], 10))
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

  const isBeforeMin = (iso: string) => !!min && iso < min
  const isAfterMax = (iso: string) => !!max && iso > max
  const outOfRange = (iso: string) => isBeforeMin(iso) || isAfterMax(iso)

  const handleTextChange = (raw: string) => {
    const masked = maskInput(raw)
    setText(masked)
    if (masked.length === 7) {
      const iso = displayToIso(masked)
      if (iso && !outOfRange(iso)) {
        onChange(iso)
        const m = /^(\d{4})-(\d{2})$/.exec(iso)
        if (m) setViewYear(parseInt(m[1], 10))
      } else if (!iso) {
        // invalid month, leave as-is until blur revert
      }
    } else if (masked.length === 0) {
      onChange('')
    }
  }

  const handleTextBlur = () => {
    // On blur, if text doesn't resolve to a valid (and in-range) month, revert.
    if (text.length > 0) {
      const iso = displayToIso(text)
      if (!iso || outOfRange(iso)) {
        setText(isoToDisplay(value))
      }
    }
  }

  const selectedIso = displayToIso(text) || value

  const goPrevYear = () => setViewYear((y) => y - 1)
  const goNextYear = () => setViewYear((y) => y + 1)

  const pickMonth = (monthIndex: number) => {
    const iso = `${viewYear}-${String(monthIndex + 1).padStart(2, '0')}`
    if (outOfRange(iso)) return
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
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleTextBlur}
          onFocus={() => setOpen(true)}
          className={className}
          style={{
            ...style,
            width: '100%',
            paddingRight: 30,
            fontFamily: style?.fontFamily || 'inherit',
          }}
        />
        <button
          type="button"
          aria-label="Open month picker"
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
            width: 220,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button
              type="button"
              onClick={goPrevYear}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink2, #4A4740)', fontSize: 14, padding: 4 }}
            >
              ‹
            </button>
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, color: 'var(--charcoal, #1C1A17)', fontWeight: 600 }}>
              {viewYear}
            </span>
            <button
              type="button"
              onClick={goNextYear}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink2, #4A4740)', fontSize: 14, padding: 4 }}
            >
              ›
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
            {MONTH_ABBR.map((label, i) => {
              const iso = `${viewYear}-${String(i + 1).padStart(2, '0')}`
              const isSelected = iso === selectedIso
              const disabledMonth = outOfRange(iso)
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => pickMonth(i)}
                  disabled={disabledMonth}
                  style={{
                    padding: '8px 0',
                    border: 'none',
                    borderRadius: 6,
                    cursor: disabledMonth ? 'default' : 'pointer',
                    fontSize: 12,
                    fontFamily: 'DM Mono, monospace',
                    background: isSelected ? 'var(--gold, #A8834A)' : 'transparent',
                    color: disabledMonth ? 'var(--ink3, #9A9690)' : isSelected ? '#fff' : 'var(--ink, #1A1816)',
                    opacity: disabledMonth ? 0.4 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !disabledMonth) e.currentTarget.style.background = 'var(--cream2, #ECEAE4)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected && !disabledMonth) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
