'use server'

import { redirect } from 'next/navigation'
import { logIn } from '@/lib/auth'

export async function loginAction(formData: FormData) {
  const ok = await logIn('')
  if (!ok) throw new Error('Login failed')
  redirect('/')
}
