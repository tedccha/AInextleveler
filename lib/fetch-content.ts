/**
 * Fetch and parse content from URLs, GitHub repos, or plain text.
 * Returns title + summary + full content for assessment.
 */

export type FetchedContent = {
  title: string
  url: string
  contentType: 'article' | 'github' | 'code' | 'text' | 'social'
  summary: string // First 500 chars of content
  fullContent: string // Up to 4000 chars for LLM assessment
  metadata: {
    author?: string
    publishedAt?: string
    language?: string
  }
}

async function fetchUrl(url: string): Promise<FetchedContent> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const html = await response.text()
    const isXPost = url.includes('x.com') || url.includes('twitter.com')
    
    // For X posts, try multiple extraction strategies
    if (isXPost) {
      // Strategy 1: Look for description meta tags
      const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/)
      const twitterDescMatch = html.match(/<meta\s+name=["']twitter:description["']\s+content=["']([^"']+)["']/)
      const description = ogDescMatch?.[1] || twitterDescMatch?.[1]
      
      // Strategy 2: Extract from script tags (X stores initial state in JSON)
      const scriptMatch = html.match(/<script[^>]*>window\.initialState=(.+?)<\/script>/)
      let jsonContent = ''
      if (scriptMatch) {
        try {
          const decoded = JSON.parse(scriptMatch[1])
          // Try to find tweet text in the structure
          jsonContent = JSON.stringify(decoded).slice(0, 2000)
        } catch {
          // JSON parse failed, continue
        }
      }
      
      // Strategy 3: Extract from nitter (X alternative that doesn't require JS)
      if (!description && !jsonContent) {
        try {
          const nitterUrl = url.replace('x.com', 'nitter.net').replace('twitter.com', 'nitter.net')
          const nitterRes = await fetch(nitterUrl, {
            signal: AbortSignal.timeout(5000),
          })
          if (nitterRes.ok) {
            const nitterHtml = await nitterRes.text()
            const tweetMatch = nitterHtml.match(/<p[^>]*class=["'][^"']*tweet-text[^"']*["'][^>]*>([^<]+)/i)
            if (tweetMatch) {
              const content = tweetMatch[1].trim().slice(0, 4000)
              return {
                title: extractTitle(html, url),
                url,
                contentType: 'social',
                summary: content.slice(0, 500),
                fullContent: content,
                metadata: { language: 'en' },
              }
            }
          }
        } catch {
          // Nitter fallback failed, continue
        }
      }
      
      // Return whatever we found
      const content = description || jsonContent || ''
      if (content) {
        return {
          title: extractTitle(html, url),
          url,
          contentType: 'social',
          summary: content.slice(0, 500),
          fullContent: content.slice(0, 4000),
          metadata: { language: 'en' },
        }
      }
    }
    
    // For regular URLs, extract Open Graph metadata
    const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/)
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/)
    
    if (ogDescMatch) {
      const title = ogTitleMatch ? ogTitleMatch[1] : extractTitle(html, url)
      const content = ogDescMatch[1]
      return {
        title,
        url,
        contentType: isXPost ? 'social' : 'article',
        summary: content.slice(0, 500),
        fullContent: content.slice(0, 4000),
        metadata: { language: 'en' },
      }
    }
    
    const title = extractTitle(html, url)
    const content = extractMainContent(html)

    return {
      title,
      url,
      contentType: isXPost ? 'social' : 'article',
      summary: content.slice(0, 500),
      fullContent: content.slice(0, 4000),
      metadata: { language: 'en' },
    }
  } catch (err) {
    throw new Error(`Failed to fetch URL: ${String(err)}`)
  }
}

async function fetchGitHub(url: string): Promise<FetchedContent> {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (!match) throw new Error('Invalid GitHub URL')

  const [, owner, repo] = match
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`

  try {
    // Get repo metadata
    const res = await fetch(apiUrl, {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`)

    const data = (await res.json()) as {
      name: string
      description: string
      topics: string[]
      language: string
      stars: number
      size: number
    }

    // Get repo tree to understand structure
    let treeContent = ''
    try {
      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
        { signal: AbortSignal.timeout(5000) },
      )
      if (treeRes.ok) {
        const treeData = (await treeRes.json()) as { tree: { path: string; type: string }[] }
        // Get summary of structure (main source files, docs)
        const files = treeData.tree.filter((f) => f.type === 'blob').map((f) => f.path)
        const sourceFiles = files.filter(
          (f) =>
            /\.(py|js|ts|go|rs|java|cpp|c|h|rb|sh)$/.test(f) &&
            !f.includes('test') &&
            !f.includes('node_modules'),
        )
        const docFiles = files.filter(
          (f) =>
            /\.(md|rst|txt)$/.test(f) ||
            f.includes('doc') ||
            f.includes('wiki'),
        )

        treeContent = [
          `Repository Structure:`,
          `Total files: ${files.length}`,
          `Main source files: ${sourceFiles.slice(0, 5).join(', ') || 'N/A'}`,
          `Documentation: ${docFiles.slice(0, 3).join(', ') || 'N/A'}`,
          '',
        ].join('\n')
      }
    } catch {
      // Tree fetch failed, continue with what we have
    }

    // Get README
    let readmeContent = ''
    try {
      const readmeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/readme`,
        {
          headers: { Accept: 'application/vnd.github.v3.raw' },
          signal: AbortSignal.timeout(5000),
        },
      )
      if (readmeRes.ok) {
        readmeContent = await readmeRes.text()
      }
    } catch {
      // README fetch failed, continue
    }

    const content = [
      `Repository: ${data.name}`,
      `Stars: ${data.stars}`,
      `Language: ${data.language || 'N/A'}`,
      `Topics: ${data.topics.join(', ') || 'None'}`,
      `Size: ${data.size || 'N/A'}`,
      '',
      `Description:\n${data.description || 'No description'}`,
      '',
      treeContent,
      `README Summary:\n${readmeContent.slice(0, 2000)}`,
    ].join('\n')

    return {
      title: `${owner}/${repo}`,
      url,
      contentType: 'github',
      summary: content.slice(0, 500),
      fullContent: content.slice(0, 6000),
      metadata: {
        language: data.language || undefined,
      },
    }
  } catch (err) {
    throw new Error(`Failed to fetch GitHub: ${String(err)}`)
  }
}

function extractTitle(html: string, url: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleMatch) return titleMatch[1].trim()

  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
  if (h1Match) return h1Match[1].trim()

  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 50)
  }
}

function extractMainContent(html: string): string {
  let content = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .slice(0, 5000)

  return content
}

export async function fetchContent(
  url: string,
  sourceType: 'link' | 'github' | 'pastedText' | 'upload',
): Promise<FetchedContent> {
  if (sourceType === 'pastedText' || sourceType === 'upload') {
    return {
      title: sourceType === 'upload' ? 'Uploaded File' : 'Pasted Content',
      url: sourceType === 'upload' ? 'uploaded' : 'pasted',
      contentType: 'text',
      summary: url.slice(0, 500),
      fullContent: url.slice(0, 4000),
      metadata: {},
    }
  }

  if (sourceType === 'github' || url.includes('github.com')) {
    return fetchGitHub(url)
  }

  return fetchUrl(url)
}
