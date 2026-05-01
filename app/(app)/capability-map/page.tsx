import { LIFECYCLE_THEMES, CAPABILITIES_BY_THEME } from '@/lib/taxonomy'

export const runtime = 'nodejs'

/**
 * Placeholder for Step 4 of the build (full /capability-map UI).
 * Currently renders the locked taxonomy structure so we can verify the
 * scaffold + auth gate are working.
 */
export default function CapabilityMapPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1>Capability Map</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Scaffold placeholder. Real UI lands in Step 4.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {LIFECYCLE_THEMES.map((theme, i) => (
          <section
            key={theme}
            className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
          >
            <div className="mb-2 flex items-baseline gap-2">
              <span className="font-mono text-sm text-[hsl(var(--muted-foreground))]">
                {i + 1}
              </span>
              <h3>{theme}</h3>
            </div>
            <ul className="space-y-1 text-sm">
              {CAPABILITIES_BY_THEME[theme].map((name) => (
                <li
                  key={name}
                  className="text-[hsl(var(--muted-foreground))]"
                >
                  ✗ {name}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
