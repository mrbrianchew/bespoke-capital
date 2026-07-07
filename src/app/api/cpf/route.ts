/**
 * src/app/api/cpf/route.ts
 *
 * POST /api/cpf
 * Body: { grossMonthly, age, employmentType, citizenship, bonusMonths? }
 * Returns: { monthly: CpfResult, annual: {...}, ceilings: CpfCeilings }
 *
 * Ceilings are always fetched fresh from cpf_settings table so any
 * admin update applies immediately to all calculations.
 */

import { NextRequest, NextResponse } from "next/server"
import { calcCpf, calcCpfAnnual } from "@/lib/cpf"
import { getCpfSettings } from "@/lib/getCpfSettings"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { grossMonthly, age, employmentType, citizenship, bonusMonths = 0 } = body

    if (!grossMonthly || grossMonthly < 0) return NextResponse.json({ error: "Invalid grossMonthly" }, { status: 400 })
    if (!age || age < 16 || age > 100)     return NextResponse.json({ error: "Invalid age" }, { status: 400 })
    if (!["employee", "self-employed", "employer-only"].includes(employmentType))
      return NextResponse.json({ error: "Invalid employmentType" }, { status: 400 })
    if (!["citizen", "pr1", "pr2", "foreigner"].includes(citizenship))
      return NextResponse.json({ error: "Invalid citizenship" }, { status: 400 })

    // Fetch live ceilings from DB (falls back to defaults if unavailable)
    const ceilings = await getCpfSettings()

    const monthly = calcCpf({ grossMonthly, age, employmentType, citizenship, ceilings })
    const annual  = calcCpfAnnual(grossMonthly, grossMonthly * bonusMonths, age, citizenship, ceilings)

    return NextResponse.json({ monthly, annual, ceilings })
  } catch (err) {
    console.error("CPF calc error:", err)
    return NextResponse.json({ error: "Calculation failed" }, { status: 500 })
  }
}

// GET — returns current ceilings only (useful for client-side display)
export async function GET() {
  const ceilings = await getCpfSettings()
  return NextResponse.json({ ceilings })
}
