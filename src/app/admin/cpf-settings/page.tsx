"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase"

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
    const router = useRouter()
    const supabase = createClient()

  const [checking, setChecking] = useState(true)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [settings, setSettings] = useState<CpfSettingsRow | null>(null)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
        ow_ceiling: "",
        aw_ceiling: "",
        effective_year: new Date().getFullYear().toString(),
        notes: "",
  })

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

  async function handleSave() {
        setSaving(true)
        setError(null)
        setSaved(false)
        const payload = {
                ow_ceiling: Number(form.ow_ceiling),
                aw_ceiling: Number(form.aw_ceiling),
                effective_year: Number(form.effective_year),
                notes: form.notes || null,
        }
        let result
        if (settings?.id) {
                result = await supabase.from("cpf_settings").update(payload).eq("id", settings.id)
        } else {
                result = await supabase.from("cpf_settings").insert(payload)
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

  if (checking) return null
    if (loading) return (
          <div style={{ maxWidth: 760, margin: "0 auto", padding: "2.5rem 2rem", fontFamily: "Inter, sans-serif" }}>
                  <p style={{ color: "#9A9690", fontSize: 14 }}>Loading...</p>p>
          </div></div>
        )

  return (
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "2.5rem 2rem", fontFamily: "Inter, sans-serif" }}>
                <div style={{ marginBottom: 32 }}>
                          <p style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#9A9690", margin: "0 0 6px" }}>Admin · CPF Settings</p>p>
                          <h1 style={{ fontSize: 26, fontFamily: "Cormorant Garamond, serif", fontWeight: 600, color: "#1A1816", margin: "0 0 8px" }}>CPF Ceiling Manager</h1>h1>
                          <p style={{ fontSize: 14, color: "#4A4740", margin: 0 }}>Update annually when CPF Board announces new Ordinary Wage ceilings. Changes apply instantly to all advisor accounts.</p>p>
                </div>div>

          {settings && (
                  <div style={{ background: "#1C1A17", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: 20 }}>
                              <div style={{ display: "flex", gap: 24 }}>
                                {[
                    { label: "OW Ceiling (monthly)", value: `$${Number(settings.ow_ceiling).toLocaleString()}` },
                    { label: "AW Ceiling (annual)", value: `$${Number(settings.aw_ceiling).toLocaleString()}` },
                    { label: "Effective year", value: String(settings.effective_year) },
                    { label: "Last updated", value: new Date(settings.updated_at).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }) },
                                ].map((item, i) => (
                                                <div key={i} style={{ flex: 1 }}>
                                                                  <p style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#9A9690", margin: "0 0 4px" }}>{item.label}</p>p>
                                                                  <p style={{ fontSize: 18, fontWeight: 500, color: "#F5F3EE", margin: 0, fontFamily: "DM Mono, monospace" }}>{item.value}</p>p>
                                                </div>div>
                                              ))}
                              </div>div>
                    {settings.notes && <p style={{ fontSize: 12, color: "#9A9690", margin: "12px 0 0", borderTop: "1px solid #2C2A27", paddingTop: 10 }}>{settings.notes}</p>p>}
                  </div>div>
                )}

                <div style={{ background: "#fff", border: "0.5px solid #E0DDD6", borderRadius: 12, padding: "1.5rem", marginBottom: 20 }}>
                          <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#9A9690", margin: "0 0 20px" }}>Update values</p>p>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
                            {[
          { key: "ow_ceiling", label: "OW Ceiling (monthly, SGD)" },
          { key: "aw_ceiling", label: "AW Ceiling (annual, SGD)" },
          { key: "effective_year", label: "Effective year" },
                    ].map(field => (
                                  <div key={field.key}>
                                                  <label style={{ display: "block", fontSize: 12, color: "#4A4740", marginBottom: 5, fontWeight: 500 }}>{field.label}</label>label>
                                                  <input
                                                                    type="number"
                                                                    value={form[field.key as keyof typeof form]}
                                                                    onChange={set(field.key)}
                                                                    style={{ width: "100%", boxSizing: "border-box" as const, fontSize: 14 }}
                                                                  />
                                  </div>div>
                                ))}
                          </div>div>
                          <div style={{ marginBottom: 16 }}>
                                      <label style={{ display: "block", fontSize: 12, color: "#4A4740", marginBottom: 5, fontWeight: 500 }}>Notes (optional)</label>label>
                                      <textarea value={form.notes} onChange={set("notes")} rows={2} style={{ width: "100%", boxSizing: "border-box" as const, fontSize: 14, resize: "vertical" as const }} placeholder="e.g. OW ceiling raised from $7,400 to $8,000 effective Jan 2026" />
                          </div>div>
                  {error && <div style={{ background: "#F2EAEA", color: "#8A2828", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}><strong>Error:</strong>strong> {error}</div>div>}
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                  <button onClick={handleSave} disabled={saving} style={{ padding: "10px 20px", background: saving ? "#ECEAE4" : "#1C1A17", color: saving ? "#9A9690" : "#F5F3EE", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: saving ? "default" : "pointer" }}>
                                    {saving ? "Saving..." : "Save CPF Settings"}
                                  </button>button>
                          {saved && <span style={{ fontSize: 13, color: "#2A5E46", fontWeight: 500 }}>Saved — all calculations updated</span>span>}
                        </div>div>
                </div>div>
        
              <div style={{ background: "#F5F3EE", border: "0.5px solid #E0DDD6", borderRadius: 12, padding: "1.25rem 1.5rem" }}>
                      <p style={{ fontSize: 12, fontWeight: 500, color: "#1A1816", margin: "0 0 6px" }}>When to update</p>p>
                      <p style={{ fontSize: 13, color: "#4A4740", margin: "0 0 8px" }}>CPF Board announces ceiling changes in the annual Budget (February). Check: <a href="https://www.cpf.gov.sg/employer/employer-guides/paying-cpf-contributions/cpf-contribution-and-allocation-rates" target="_blank" rel="noopener noreferrer" style={{ color: "#A8834A" }}>cpf.gov.sg</a>a></p>p>
                      <ul style={{ fontSize: 12, color: "#9A9690", margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
                                <li>OW Ceiling: check annually — last raised from $7,400 to $8,000 (Jan 2026)</li>li>
                                <li>AW Ceiling: $102,000 base — rarely changes</li>li>
                                <li>Contribution rate tables: edit directly in src/lib/cpf.ts</li>li>
                      </ul>ul>
              </div>div>
        </div>div>
      )
}</strong>
