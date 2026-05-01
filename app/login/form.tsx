'use client'

import { useState, useTransition } from 'react'
import { loginAction } from './actions'

export function LoginForm() {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await loginAction(fd)
          if (res?.error) setError(res.error)
        })
      }
      className="space-y-4"
    >
      <div className="space-y-2">
        <label
          htmlFor="password"
          className="block text-sm font-medium text-[hsl(var(--foreground))]"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className="w-full rounded-card border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-base outline-none focus:border-[hsl(var(--accent))]"
        />
      </div>
      {error ? (
        <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-card bg-[hsl(var(--accent))] px-4 py-2 font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
