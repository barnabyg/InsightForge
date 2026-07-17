import OpenAI from 'openai';
import type {
  DesignBriefGenerationResult,
  PrdGenerationResult,
  TextGenerationBoundary,
} from '../shared/generation.js';
import { GenerationBoundaryError } from './generation-boundary.js';

const markdownArtifactSchema = {
  type: 'object' as const,
  properties: {
    markdown: { type: 'string' as const, minLength: 1 },
  },
  required: ['markdown'],
  additionalProperties: false,
};

function parseMarkdownArtifactResponse(
  response: {
  id: string;
  _request_id?: string | null;
  status?: string;
  output: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  } | null;
  },
  artifactName: 'Design Brief' | 'PRD',
): DesignBriefGenerationResult | PrdGenerationResult {
  const content = response.output
    .find(({ type }) => type === 'message')
    ?.content?.[0];
  if (content?.type === 'refusal') {
    throw new GenerationBoundaryError(
      'openai_refusal',
      `OpenAI declined to generate this ${artifactName}.`,
      { requestId: response._request_id ?? undefined, responseId: response.id },
    );
  }
  if (response.status !== 'completed') {
    throw new GenerationBoundaryError(
      'openai_incomplete',
      `OpenAI did not complete the ${artifactName} response.`,
      { requestId: response._request_id ?? undefined, responseId: response.id },
    );
  }
  if (content?.type !== 'output_text' || typeof content.text !== 'string') {
    throw new GenerationBoundaryError(
      'invalid_structured_output',
      `OpenAI returned no structured ${artifactName}.`,
      { requestId: response._request_id ?? undefined, responseId: response.id },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.text);
  } catch {
    throw new GenerationBoundaryError(
      'invalid_structured_output',
      `OpenAI returned an unreadable structured ${artifactName}.`,
      { requestId: response._request_id ?? undefined, responseId: response.id },
    );
  }
  if (
    typeof parsed !== 'object'
    || parsed === null
    || Array.isArray(parsed)
    || typeof (parsed as { markdown?: unknown }).markdown !== 'string'
  ) {
    throw new GenerationBoundaryError(
      'invalid_structured_output',
      `OpenAI returned an invalid structured ${artifactName}.`,
      { requestId: response._request_id ?? undefined, responseId: response.id },
    );
  }
  const usage = response.usage ?? {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
  return {
    markdown: (parsed as { markdown: string }).markdown,
    responseId: response.id,
    requestId: response._request_id ?? response.id,
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,
    },
  };
}

export function createOpenAITextGeneration(apiKey: string): TextGenerationBoundary {
  const client = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: 120_000,
  });

  return {
    async generateDesignBrief(input) {
      let response;
      try {
        response = await client.responses.create({
          model: input.model,
          input: [
            {
              role: 'developer',
              content: [{ type: 'input_text', text: input.stagePrompt }],
            },
            {
              role: 'user',
              content: [{
                type: 'input_text',
                text: `Stage Input — Insight Source:\n${input.insightSource}`,
              }],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'design_brief_artifact',
              strict: true,
              schema: markdownArtifactSchema,
            },
          },
        });
      } catch (error) {
        const requestId = typeof error === 'object'
          && error !== null
          && 'request_id' in error
          && typeof error.request_id === 'string'
          ? error.request_id
          : undefined;
        throw new GenerationBoundaryError(
          'openai_request_failed',
          'OpenAI could not generate the Design Brief.',
          { requestId },
        );
      }
      return parseMarkdownArtifactResponse(response, 'Design Brief');
    },

    async generatePrd(input) {
      let response;
      try {
        response = await client.responses.create({
          model: input.model,
          input: [
            {
              role: 'developer',
              content: [{ type: 'input_text', text: input.stagePrompt }],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: `Stage Input — Design Brief:\n${input.designBrief}\n\nStage Input — Concept Screen Set:`,
                },
                ...input.conceptScreens.flatMap((screen) => ([
                  {
                    type: 'input_text' as const,
                    text: `Concept Screen ${screen.ordinal}:`,
                  },
                  {
                    type: 'input_image' as const,
                    image_url: `data:image/png;base64,${Buffer.from(screen.png).toString('base64')}`,
                    detail: 'high' as const,
                  },
                ])),
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'prd_artifact',
              strict: true,
              schema: markdownArtifactSchema,
            },
          },
        });
      } catch (error) {
        const requestId = typeof error === 'object'
          && error !== null
          && 'request_id' in error
          && typeof error.request_id === 'string'
          ? error.request_id
          : undefined;
        throw new GenerationBoundaryError(
          'openai_request_failed',
          'OpenAI could not generate the PRD.',
          { requestId },
        );
      }
      return parseMarkdownArtifactResponse(response, 'PRD');
    },
  };
}
