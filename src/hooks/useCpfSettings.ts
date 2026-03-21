/**
 * useCpfSettings.ts — src/hooks/useCpfSettings.ts
 *
 * Client-side hook to fetch the current CPF ceilings.
 * Use this in any "use client" component that needs the OW/AW ceiling
 * values (e.g. to display them or pass into a local calcCpf() call).
 *
 * Usage:
 *   const { ceilings, loading } = useCpfSettings()
 *   const result = ceilings ? calcCpf({ ...input, ceilings }) : null
 */

"use client"

import { useState, useEffect } from "react"
import { DEFAULT_CEILINGS, type CpfCeilings } from "@/lib/cpf"

interface UseCpfSettingsResult {
  ceilings: CpfCeilings
  loading: boolean
  error: string | null
}

export function useCpfSettings(): UseCpfSettingsResult {
  const [ceilings, setCeilings] = useState<CpfCeilings>(DEFAULT_CEILINGS)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/cpf")
        if (!res.ok) throw new Error("Failed to load CPF settings")
        const data = await res.json()
        setCeilings(data.ceilings)
      } catch (err) {
        console.warn("[useCpfSettings] Using defaults:", err)
        setError("Could not load CPF settings — using defaults")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { ceilings, loading, error }
}
