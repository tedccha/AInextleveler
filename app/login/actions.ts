'use server'

import { redirect } from 'next/navigation'
import { logIn } from '@/lib/auth'

export async function loginAction(formData: FormData): Promise<{ error?: string }> {
  const password = String(formData.get('password') ?? '')
  if (!password) return { error: 'Password required.' }
  const ok = await logIn(password)
  if (!ok) return { error: 'Wrong password.' }
  redirect('/capability-map')
}
