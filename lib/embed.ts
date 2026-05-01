/**
 * Voyage-3 embedding wrapper.
 *
 * Per eng review A3: Voyage failure is non-blocking. Callers get `null`
 * back on any error (network, rate-limit, missing key) and are expected
 * to handle null embeddings throughout the system. The /inbox + /capability-map
 * "Backfill" button picks up rows where embedding IS NULL and retries.
 *
 * Per CEO plan critical item #6: bulk embeds need a 100ms delay between
 * calls to stay under Voyage's free-tier rate limit. Single embeds (paste
 * classify) don't need the delay.
 *
 * No SDK dependency. Voyage's REST API is a single POST — direct fetch
 * keeps us off the npm-version treadmill.
 */

const VOYAGE_API = 'https://api.voyageai.com/v1/embeddings'
const VOYAGE_MODEL = 'voyage-3'
export const EMBEDDING_DIMS = 1024

type VoyageResponse = {
  data: Array<{ embedding: number[]; index: number }>
  model: string
  usage: { total_tokens: number }
}

/**
 * Embed a single string. Returns null on any failure.
 *
 * Caller is responsible for trimming + length-capping the input. Voyage
 * accepts up to 32k tokens but we send much less (cap at 4000 chars per
 * resource per the design doc).
 */
export async function embedSingle(text: string): Promise<number[] | null> {
  const key = process.env.VOYAGE_API_KEY
  if (!key) {
    console.warn('[embed] VOYAGE_API_KEY not set — returning null embedding')
    return null
  }
  if (!text || !text.trim()) {
    return null
  }
  try {
    const res = await fetch(VOYAGE_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        input: [text],
        model: VOYAGE_MODEL,
      }),
    })
    if (!res.ok) {
      console.warn(
        `[embed] Voyage ${res.status} ${res.statusText} — returning null`,
      )
      return null
    }
    const json = (await res.json()) as VoyageResponse
    const vec = json.data?.[0]?.embedding
    if (!vec || vec.length !== EMBEDDING_DIMS) {
      console.warn(
        `[embed] Voyage returned ${vec?.length ?? 0} dims, expected ${EMBEDDING_DIMS}`,
      )
      return null
    }
    return vec
  } catch (err) {
    console.warn('[embed] Voyage call threw:', err)
    return null
  }
}

/**
 * Sleep helper.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Embed N strings sequentially with `delayMs` between calls. Returns an
 * array of {embedding|null} matching the input order — never throws.
 *
 * Use 100ms for capability bulk embeds (per CEO plan #6). Use 0 for paste
 * classify (single call, no delay needed).
 */
export async function embedBulk(
  texts: string[],
  delayMs = 100,
): Promise<Array<number[] | null>> {
  const out: Array<number[] | null> = []
  for (let i = 0; i < texts.length; i++) {
    if (i > 0 && delayMs > 0) await sleep(delayMs)
    out.push(await embedSingle(texts[i]))
  }
  return out
}
