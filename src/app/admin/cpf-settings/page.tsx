"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase"

interface Row {
  id: string
  ow_ceiling: number
  aw_ceiling: number
  effective_year: number
  notes: string | null
  updated_at: string
}

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

export default function CpfSettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<Row | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ ow_ceiling: "", aw_ceiling: "", effective_year: String(new Date().getFullYear()), notes: "" })

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || user.id !== CREATOR_ID) { router.replace("/dashboard"); return }
      setChecking(false)
      loadData()
    }
    check()
  }, [])

  async function loadData() {
    const { data, error: err } = await supabase
      .from("cpf_settings").select("*").order("effective_year", { ascending: false }).limit(1).single()
    if (data) {
      setSettings(data)
      setForm({ ow_ceiling: String(data.ow_ceiling), aw_ceiling: String(data.aw_ceiling), effective_year: String(data.effective_year), notes: data.notes ?? "" })
    }
    if (err) setError(err.message)
  }

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    const payload = { ow_ceiling: Number(form.ow_ceiling), aw_ceiling: Number(form.aw_ceiling), effective_year: Number(form.effective_year), notes: form.notes || null }
    const res = settings?.id
      ? await supabase.from("cpf_settings").update(payload).eq("id", settings.id)
      : await supabase.from("cpf_settings").insert(payload)
    if (res.error) { setError(res.error.message) } else { setSaved(true); loadData(); setTimeout(() => setSaved(false), 3000) }
    setSaving(false)
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  if (checking) return null

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "2.5rem 2rem", fontFamily: "Inter, sans-serif" }}>
      <div style={{ marginBottom: 32 }}>
        <Link href="/admin" style={{ fontSize: 12, color: "#9A9690", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 16 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#A8834A"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#9A9690"}
        >
          ← Back to Admin Hub
        </Link>
        <p style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#9A9690", margin: "0 0 6px" }}>Admin - CPF Settings</p>
        <h1 style={{ fontSize: 26, fontFamily: "Cormorant Garamond, serif", fontWeight: 600, color: "#1A1816", margin: "0 0 8px" }}>CPF Ceiling Manager</h1>
        <p style={{ fontSize: 14, color: "#4A4740", margin: 0 }}>Update annually when CPF Board announces new Ordinary Wage ceilings.</p>
      </div>

      {settings && (
        <div style={{ background: "#1C1A17", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 24 }}>
            {([
              ["OW Ceiling (monthly)", "$" + Number(settings.ow_ceiling).toLocaleString()],
              ["AW Ceiling (annual)", "$" + Number(settings.aw_ceiling).toLocaleString()],
              ["Effective year", String(settings.effective_year)],
              ["Last updated", new Date(settings.updated_at).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })],
            ] as [string, string][]).map(([label, value], i) => (
              <div key={i} style={{ flex: 1 }}>
                <p style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#9A9690", margin: "0 0 4px" }}>{label}</p>
                <p style={{ fontSize: 18, fontWeight: 500, color: "#F5F3EE", margin: 0, fontFamily: "DM Mono, monospace" }}>{value}</p>
              </div>
            ))}
          </div>
          {settings.notes && (
            <p style={{ fontSize: 12, color: "#9A9690", margin: "12px 0 0", borderTop: "1px solid #2C2A27", paddingTop: 10 }}>{settings.notes}</p>
          )}
        </div>
      )}

      <div style={{ background: "#fff", border: "0.5px solid #E0DDD6", borderRadius: 12, padding: "1.5rem", marginBottom: 20 }}>
        <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#9A9690", margin: "0 0 20px" }}>Update values</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
          {([["ow_ceiling", "OW Ceiling (monthly, SGD)"], ["aw_ceiling", "AW Ceiling (annual, SGD)"], ["effective_year", "Effective year"]] as [string, string][]).map(([k, label]) => (
            <div key={k}>
              <label style={{ display: "block", fontSize: 12, color: "#4A4740", marginBottom: 5, fontWeight: 500 }}>{label}</label>
              <input type="number" value={form[k as keyof typeof form]} onChange={set(k)} style={{ width: "100%", boxSizing: "border-box" as const, fontSize: 14 }} />
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, color: "#4A4740", marginBottom: 5, fontWeight: 500 }}>Notes (optional)</label>
          <textarea value={form.notes} onChange={set("notes")} rows={2} style={{ width: "100%", boxSizing: "border-box" as const, fontSize: 14, resize: "vertical" as const }} />
        </div>
        {error && <div style={{ background: "#F2EAEA", color: "#8A2828", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}><strong>Error:</strong> {error}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={handleSave} disabled={saving} style={{ padding: "10px 20px", background: saving ? "#ECEAE4" : "#1C1A17", color: saving ? "#9A9690" : "#F5F3EE", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: saving ? "default" : "pointer" }}>
            {saving ? "Saving..." : "Save CPF Settings"}
          </button>
          {saved && <span style={{ fontSize: 13, color: "#2A5E46", fontWeight: 500 }}>Saved</span>}
        </div>
      </div>

      <div style={{ background: "#F5F3EE", border: "0.5px solid #E0DDD6", borderRadius: 12, padding: "1.25rem 1.5rem" }}>
        <p style={{ fontSize: 12, fontWeight: 500, color: "#1A1816", margin: "0 0 6px" }}>When to update</p>
        <p style={{ fontSize: 13, color: "#4A4740", margin: "0 0 8px" }}>CPF Board announces changes in the Budget (February). Check cpf.gov.sg for the latest rates.</p>
        <ul style={{ fontSize: 12, color: "#9A9690", margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
          <li>OW Ceiling: check annually - last raised from $7,400 to $8,000 (Jan 2026)</li>
          <li>AW Ceiling: $102,000 base - rarely changes</li>
          <li>Contribution rate tables: edit directly in src/lib/cpf.ts</li>
        </ul>
      </div>
    </div>
  )
}
