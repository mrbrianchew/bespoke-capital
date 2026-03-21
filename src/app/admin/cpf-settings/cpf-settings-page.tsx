"use client"

/**
 * src/app/admin/cpf-settings/page.tsx
 *
 * Creator-only admin page to update CPF ceiling values.
 * Protected: redirects non-creators to /dashboard.
 *
 * Route: /admin/cpf-settings
 *
 * Setup required:
 *   1. Add NEXT_PUBLIC_CREATOR_ID=your-supabase-user-uuid to .env.local
 *   2. Run migration_cpf_settings.sql in Supabase SQL Editor
 *   3. Replace YOUR_ADVISOR_UUID in the SQL with the same UUID
 */

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

interface CpfSettingsRow {
  id: string
  ow_ceiling: number
  aw_ceiling: number
  effective_year: number
  notes: string | null
  updated_at: string
}

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

export default function CpfSettingsPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [checking, setChecking]   = useState(true)
  const [loading, setLoading]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [settings, setSettings]   = useState<CpfSettingsRow | null>(null)
  const [saved, setSaved]         = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const [form, setForm] = useState({
    ow_ceiling: "",
    aw_ceiling: "",
    effective_year: new Date().getFullYear().toString(),
    notes: "",
  })

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || user.id !== CREATOR_ID) {
        router.replace("/dashboard")
        return
      }
      setChecking(false)
      loadSettings()
    }
    check()
  }, [])

  // ── Load current settings ─────────────────────────────────────────────────
  async function loadSettings() {
    setLoading(true)
    const { data, error } = await supabase
      .from("cpf_settings")
      .select("*")
      .order("effective_year", { ascending: false })
      .limit(1)
      .single()

    if (data) {
      setSettings(data)
      setForm({
        ow_ceiling: String(data.ow_ceiling),
        aw_ceiling: String(data.aw_ceiling),
        effective_year: String(data.effective_year),
        notes: data.notes ?? "",
      })
    }
    if (error) setError(error.message)
    setLoading(false)
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)

    const payload = {
      ow_ceiling:     Number(form.ow_ceiling),
      aw_ceiling:     Number(form.aw_ceiling),
      effective_year: Number(form.effective_year),
      notes:          form.notes || null,
    }

    let result
    if (settings?.id) {
      result = await supabase
        .from("cpf_settings")
        .update(payload)
        .eq("id", settings.id)
    } else {
      result = await supabase
        .from("cpf_settings")
        .insert(payload)
    }

    if (result.error) {
      setError(result.error.message)
    } else {
      setSaved(true)
      loadSettings()
      setTimeout(() => setSaved(false), 3000)
    }
    setSaving(false)
  }

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }))

  // ── Guards ────────────────────────────────────────────────────────────────
  if (checking) return null
  if (loading)  return <PageShell><p style={styles.muted}>Loading...</p></PageShell>

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageShell>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <p style={styles.eyebrow}>Admin · CPF Settings</p>
        <h1 style={styles.title}>CPF Ceiling Manager</h1>
        <p style={styles.subtitle}>
          Update annually when CPF Board announces new Ordinary Wage ceilings.
          Changes apply instantly to all advisor accounts and calculations.
        </p>
      </div>

      {/* Current values banner */}
      {settings && (
        <div style={styles.banner}>
          <div style={styles.bannerInner}>
            <BannerStat label="OW Ceiling (monthly)" value={`$${Number(settings.ow_ceiling).toLocaleString()}`} />
            <BannerDivider />
            <BannerStat label="AW Ceiling (annual)" value={`$${Number(settings.aw_ceiling).toLocaleString()}`} />
            <BannerDivider />
            <BannerStat label="Effective year" value={String(settings.effective_year)} />
            <BannerDivider />
            <BannerStat
              label="Last updated"
              value={new Date(settings.updated_at).toLocaleDateString("en-SG", {
                day: "numeric", month: "short", year: "numeric"
              })}
            />
          </div>
          {settings.notes && (
            <p style={styles.bannerNote}>{settings.notes}</p>
          )}
        </div>
      )}

      {/* Edit form */}
      <div style={styles.card}>
        <p style={styles.cardLabel}>Update values</p>

        <div style={styles.fieldGrid}>
          <Field label="OW Ceiling (monthly, SGD)" hint="e.g. 8000">
            <div style={{ position: "relative" }}>
              <span style={styles.prefix}>$</span>
              <input
                type="number"
                value={form.ow_ceiling}
                onChange={set("ow_ceiling")}
                style={{ ...styles.input, paddingLeft: 24 }}
                min={0}
              />
            </div>
            {form.ow_ceiling && (
              <p style={styles.fieldMath}>
                Annual OW subject to CPF: ${(Number(form.ow_ceiling) * 12).toLocaleString()}
                &nbsp;→ effective AW ceiling: ${Math.max(0, Number(form.aw_ceiling) - Number(form.ow_ceiling) * 12).toLocaleString()}
              </p>
            )}
          </Field>

          <Field label="AW Ceiling base (annual, SGD)" hint="Currently $102,000 — rarely changes">
            <div style={{ position: "relative" }}>
              <span style={styles.prefix}>$</span>
              <input
                type="number"
                value={form.aw_ceiling}
                onChange={set("aw_ceiling")}
                style={{ ...styles.input, paddingLeft: 24 }}
                min={0}
              />
            </div>
          </Field>

          <Field label="Effective year">
            <input
              type="number"
              value={form.effective_year}
              onChange={set("effective_year")}
              style={styles.input}
              min={2020}
              max={2050}
            />
          </Field>
        </div>

        <Field label="Notes (optional)" hint="e.g. 'OW ceiling raised from $7,400 to $8,000 effective Jan 2026'">
          <textarea
            value={form.notes}
            onChange={set("notes")}
            rows={2}
            style={{ ...styles.input, resize: "vertical", height: "auto", padding: "8px 12px" }}
            placeholder="Add a note for your own records..."
          />
        </Field>

        {error && (
          <div style={styles.errorBox}>
            <strong>Error:</strong> {error}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={saving ? styles.btnDisabled : styles.btn}
          >
            {saving ? "Saving..." : "Save CPF Settings"}
          </button>
          {saved && (
            <span style={styles.savedBadge}>
              ✓ Saved — all calculations updated
            </span>
          )}
        </div>
      </div>

      {/* Info box */}
      <div style={styles.infoBox}>
        <p style={styles.infoTitle}>When to update</p>
        <p style={styles.infoText}>
          CPF Board typically announces ceiling changes in the annual Budget statement (February).
          Changes take effect on 1 January of that year. Check:{" "}
          <a
            href="https://www.cpf.gov.sg/employer/employer-guides/paying-cpf-contributions/cpf-contribution-and-allocation-rates"
            target="_blank"
            rel="noopener noreferrer"
            style={styles.link}
          >
            cpf.gov.sg → Contribution & Allocation Rates
          </a>
        </p>
        <ul style={styles.infoList}>
          <li>OW Ceiling: check annually — raised from $6,800 → $7,400 (Sep 2023), $7,400 → $8,000 (Jan 2026)</li>
          <li>AW Ceiling: $102,000 base — rarely changes</li>
          <li>Contribution rate tables (by age/citizenship): edit directly in <code>src/lib/cpf.ts</code></li>
        </ul>
      </div>

    </PageShell>
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      maxWidth: 760,
      margin: "0 auto",
      padding: "2.5rem 2rem",
      fontFamily: "Inter, sans-serif",
    }}>
      {children}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.label}>{label}</label>
      {hint && <p style={styles.hint}>{hint}</p>}
      {children}
    </div>
  )
}

function BannerStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1 }}>
      <p style={styles.bannerLabel}>{label}</p>
      <p style={styles.bannerValue}>{value}</p>
    </div>
  )
}

function BannerDivider() {
  return <div style={{ width: 1, background: "#E0DDD6", alignSelf: "stretch" }} />
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  eyebrow: {
    fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase",
    color: "#9A9690", margin: "0 0 6px",
  },
  title: {
    fontSize: 26, fontFamily: "Cormorant Garamond, serif", fontWeight: 600,
    color: "#1A1816", margin: "0 0 8px", lineHeight: 1.2,
  },
  subtitle: {
    fontSize: 14, color: "#4A4740", margin: 0, lineHeight: 1.6,
  },
  muted: { fontSize: 14, color: "#9A9690" },
  banner: {
    background: "#1C1A17",
    borderRadius: 12,
    padding: "1.25rem 1.5rem",
    marginBottom: 20,
  },
  bannerInner: {
    display: "flex", gap: 24, alignItems: "flex-start",
  },
  bannerLabel: {
    fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
    color: "#9A9690", margin: "0 0 4px",
  },
  bannerValue: {
    fontSize: 18, fontWeight: 500, color: "#F5F3EE", margin: 0,
    fontFamily: "DM Mono, monospace",
  },
  bannerNote: {
    fontSize: 12, color: "#9A9690", margin: "12px 0 0", borderTop: "1px solid #2C2A27",
    paddingTop: 10,
  },
  card: {
    background: "#fff",
    border: "0.5px solid #E0DDD6",
    borderRadius: 12,
    padding: "1.5rem",
    marginBottom: 20,
  },
  cardLabel: {
    fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
    color: "#9A9690", margin: "0 0 20px",
  },
  fieldGrid: {
    display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 8,
  },
  label: {
    display: "block", fontSize: 12, color: "#4A4740", marginBottom: 4, fontWeight: 500,
  },
  hint: {
    fontSize: 11, color: "#9A9690", margin: "0 0 5px",
  },
  input: {
    width: "100%", boxSizing: "border-box" as const,
    fontSize: 14, color: "#1A1816",
  },
  prefix: {
    position: "absolute" as const, left: 10, top: "50%", transform: "translateY(-50%)",
    color: "#9A9690", fontSize: 14,
  },
  fieldMath: {
    fontSize: 11, color: "#A8834A", margin: "5px 0 0",
  },
  btn: {
    padding: "10px 20px",
    background: "#1C1A17",
    color: "#F5F3EE",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    letterSpacing: "0.04em",
  },
  btnDisabled: {
    padding: "10px 20px",
    background: "#ECEAE4",
    color: "#9A9690",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    cursor: "default",
  },
  savedBadge: {
    fontSize: 13, color: "#2A5E46", fontWeight: 500,
  },
  errorBox: {
    background: "#F2EAEA",
    color: "#8A2828",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    marginTop: 12,
  },
  infoBox: {
    background: "#F5F3EE",
    border: "0.5px solid #E0DDD6",
    borderRadius: 12,
    padding: "1.25rem 1.5rem",
  },
  infoTitle: {
    fontSize: 12, fontWeight: 500, color: "#1A1816", margin: "0 0 6px",
  },
  infoText: {
    fontSize: 13, color: "#4A4740", margin: "0 0 8px", lineHeight: 1.6,
  },
  infoList: {
    fontSize: 12, color: "#9A9690", margin: 0, paddingLeft: 16, lineHeight: 1.8,
  },
  link: {
    color: "#A8834A", textDecoration: "underline",
  },
}
