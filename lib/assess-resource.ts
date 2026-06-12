/**
 * Haiku-powered assessment: evaluate resource quality, fit to projects, and sequence.
 * Returns: suggested project, sequence position, quality score, confidence, reasoning.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { FetchedContent } from './fetch-content'

export type ProjectContext = {
  id: number
  name: string
  description: string
}

export type ExistingResource = {
  id: number
  title: string
  url: string | null
  summary: string
}

export type AssessmentResult = {
  qualityScore: number // 1-10
  isDuplicate: boolean
  duplicateOf?: ExistingResource
  suggestedProjectId: number | null
  suggestedProjectName: string | null
  suggestedSequenceIndex: number | null
  rationale: string
  confidence: number // 0-100
}

const client = new Anthropic()

export async function assessResource(
  content: FetchedContent,
  projects: ProjectContext[],
  existingResources: ExistingResource[],
): Promise<AssessmentResult> {
  const projectsDesc =
    projects.length > 0
      ? projects
          .map(
            (p) =>
              `- **${p.name}**: ${p.description}`,
          )
          .join('\n')
      : 'No projects yet.'

  const existingDesc =
    existingResources.length > 0
      ? existingResources
          .map((r) => `- ${r.title} (${r.url || 'text'})`)
          .join('\n')
      : 'No existing resources.'

  const prompt = `You are an expert curator for AI infrastructure and upleveling resources. Your job is to assess a newly discovered resource and determine:

1. **Quality**: Is this genuine, useful content or fluff/listicles/regurgitation?
2. **Fit**: Which project (if any) does it serve?
3. **Sequence**: Where in that project's sequence should it go (foundational first, then advanced)?
4. **Duplicates**: Is this content redundant with something already ingested?

## Current Projects:
${projectsDesc}

## Existing Resources in Library:
${existingDesc}

## Resource to Assess:
**Title**: ${content.title}
**Type**: ${content.contentType}
**URL**: ${content.url}
**Summary**: ${content.summary}

---

**Full Content** (for assessment):
${content.fullContent}

---

## Your Assessment:

Respond as JSON with no markdown formatting:
{
  "qualityScore": <1-10, where 10 is exceptional/foundational content>,
  "qualityReasoning": "<brief explanation of quality>",
  "isDuplicate": <true if substantially similar to existing>,
  "duplicateSimilarity": "<which existing resource, if duplicate>",
  "suggestedProjectId": <null if no fit, or which project>,
  "suggestedProjectName": "<name if new project should be created, null if existing>",
  "suggestedSequenceIndex": <0 for foundational, higher for advanced>,
  "sequenceReasoning": "<why this position>",
  "confidence": <0-100, how sure you are>,
  "overallReasoning": "<2-3 sentence summary of your assessment>"
}

**Quality Thresholds**:
- 8-10: Foundational guides, deep technical content, original research
- 6-7: Solid implementation guides, practical tutorials with novel angles
- 4-5: Decent but generic, lots of similar content already exists
- 1-3: Fluff, listicles, regurgitated content, marketing material

Be harsh on quality. Filter slop.`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    const responseText =
      response.content[0].type === 'text' ? response.content[0].text : ''

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON in response')
    }

    const assessment = JSON.parse(jsonMatch[0]) as {
      qualityScore: number
      qualityReasoning: string
      isDuplicate: boolean
      duplicateSimilarity: string
      suggestedProjectId: number | null
      suggestedProjectName: string | null
      suggestedSequenceIndex: number
      sequenceReasoning: string
      confidence: number
      overallReasoning: string
    }

    // Find if duplicate matches an existing resource
    let duplicateOf: ExistingResource | undefined
    if (assessment.isDuplicate) {
      const dupName = assessment.duplicateSimilarity.toLowerCase()
      duplicateOf = existingResources.find((r) =>
        r.title.toLowerCase().includes(dupName),
      )
    }

    // Build rationale
    const rationale = [
      `**Quality**: ${assessment.qualityScore}/10 - ${assessment.qualityReasoning}`,
      `**Fit**: ${assessment.suggestedProjectName || (assessment.suggestedProjectId ? projects.find((p) => p.id === assessment.suggestedProjectId)?.name : 'No project match')}`,
      `**Position**: ${assessment.sequenceReasoning}`,
      assessment.isDuplicate ? `**Note**: Similar to "${assessment.duplicateSimilarity}"` : '',
      `${assessment.overallReasoning}`,
    ]
      .filter(Boolean)
      .join('\n\n')

    return {
      qualityScore: assessment.qualityScore,
      isDuplicate: assessment.isDuplicate,
      duplicateOf,
      suggestedProjectId: assessment.suggestedProjectId,
      suggestedProjectName: assessment.suggestedProjectName,
      suggestedSequenceIndex: assessment.suggestedSequenceIndex,
      rationale,
      confidence: assessment.confidence,
    }
  } catch (err) {
    console.error('[assess] Haiku failed:', err)
    throw new Error(`Assessment failed: ${String(err)}`)
  }
}
