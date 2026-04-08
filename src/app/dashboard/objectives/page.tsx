'use client'


import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useUniCosts } from '@/hooks/useUniCosts'

// ─── INTERFACES ──────────────────────────────────────────────────────────────

interface MortgageProperty {
  id: string
  label: string
  outstanding: number
  interestRate: number
  monthlyRepayment: number
  tenure: number
  initialLoanAmount: number
  initialTenure: number
  loanStartDate: string
  remainingTenure: number
}

interface FamilyMember {
  id: string
  name: string
  relationship: string
  date_of_birth?: string
  age?: number
}

interface FactFinding {
  // Expense mode
  expense_mode?: 'simple' | 'detailed'
  // Simplified expenses client
  s_income_tax?: number; s_insurance?: number; s_regular_savings?: number
  s_housing?: number; s_utilities?: number; s_family_food?: number
  s_transport?: number; s_children?: number; s_lifestyle?: number; s_others?: number
  // Simplified expenses spouse
  s2_income_tax?: number; s2_insurance?: number; s2_regular_savings?: number
  s2_housing?: number; s2_utilities?: number; s2_family_food?: number
  s2_transport?: number; s2_children?: number; s2_lifestyle?: number; s2_others?: number
  // Detailed expenses client
  d_rental_expense?: number; d_income_tax?: number; d_insurance?: number; d_regular_savings?: number
  d_conservancy?: number; d_utilities?: number; d_family_food?: number
  d_maid?: number; d_other_household?: number; d_personal_food?: number
  d_transport?: number; d_car_petrol?: number; d_car_insurance?: number
  d_childcare?: number; d_school_fees?: number; d_school_transport?: number
  d_allowance_children?: number; d_other_children?: number
  d_holidays?: number; d_hobbies?: number; d_allowance_parents?: number
  d_others_lifestyle?: number; d_mortgage_cpf?: number; d_mortgage_cash?: number
  // Detailed expenses spouse
  d2_rental_expense?: number; d2_income_tax?: number; d2_insurance?: number; d2_regular_savings?: number
  d2_conservancy?: number; d2_utilities?: number; d2_family_food?: number
  d2_maid?: number; d2_other_household?: number; d2_personal_food?: number
  d2_transport?: number; d2_car_petrol?: number; d2_car_insurance?: number
  d2_childcare?: number; d2_school_fees?: number; d2_school_transport?: number
  d2_allowance_children?: number; d2_other_children?: number
  d2_holidays?: number; d2_hobbies?: number; d2_allowance_parents?: number
  d2_others_lifestyle?: number; d2_mortgage_cpf?: number; d2_mortgage_cash?: number
  // Assets client
  a_savings?: number; a_fixed_deposit?: number; a_srs?: number
  a_shares?: number; a_etf?: number; a_unit_trust?: number; a_bonds?: number
  a_alternatives?: number; a_cpf_oa?: number; a_cpf_sa?: number
  a_cpf_ma?: number; a_cpf_ra?: number; a_inv_property_res?: number; a_inv_property_com?: number
  // Assets spouse
  a2_savings?: number; a2_fixed_deposit?: number; a2_srs?: number
  a2_shares?: number; a2_etf?: number; a2_unit_trust?: number; a2_bonds?: number
  a2_alternatives?: number; a2_cpf_oa?: number; a2_cpf_sa?: number
  a2_cpf_ma?: number; a2_cpf_ra?: number; a2_inv_property_res?: number; a2_inv_property_com?: number
  // Mortgages
  mortgages?: MortgageProperty[]
  // Other
  strategic_objectives?: Record<string, unknown>
  protection?: ProtectionData
  [key: string]: unknown
}
