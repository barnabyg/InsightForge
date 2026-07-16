import OpenAI, { toFile } from 'openai';
import type { ImagesResponse } from 'openai/resources/images';
import type {
  ConceptScreenGenerationResult,
  ImageGenerationBoundary,
} from './image-generation-boundary.js';
import { GenerationBoundaryError } from './generation-boundary.js';

type ImageResponse = ImagesResponse & { _request_id?: string | null };

function assemblePrompt(input: Parameters<ImageGenerationBoundary['generateConceptScreen']>[0]): string {
  const referenceInstructions = input.references.length === 0
    ? 'Establish the shared platform, layout system, navigation, component language, and visual tone for the complete set.'
    : [
        `Use the attached earlier Concept Screen${input.references.length === 1 ? '' : 's'} as visual reference${input.references.length === 1 ? '' : 's'}.`,
        ...input.references.map((reference, index) =>
          `Reference Image ${index + 1} — Concept Screen ${reference.ordinal}.`),
        'Preserve the same platform, dimensions, layout system, navigation, component language, and visual tone.',
      ].join('\n');
  return [
    input.stagePrompt,
    '',
    'Stage Input — Design Brief:',
    input.designBrief,
    '',
    `Concept Screen ${input.ordinal} of 3:`,
    referenceInstructions,
    'Generate only this single interface screen as a PNG. Do not create a collage, device mockup, presentation board, or alternative direction.',
  ].join('\n');
}

function resultFromResponse(response: ImageResponse): ConceptScreenGenerationResult {
  const encoded = response.data?.[0]?.b64_json;
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new GenerationBoundaryError(
      'invalid_image_output',
      'OpenAI returned no PNG for this Concept Screen.',
      { requestId: response._request_id ?? undefined },
    );
  }
  const usage = response.usage ?? {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
  return {
    png: Buffer.from(encoded, 'base64'),
    requestId: response._request_id ?? null,
    responseId: null,
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,
    },
  };
}

export function createOpenAIImageGeneration(apiKey: string): ImageGenerationBoundary {
  const client = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: 300_000,
  });

  return {
    async generateConceptScreen(input) {
      const prompt = assemblePrompt(input);
      let response: ImageResponse;
      try {
        if (input.references.length === 0) {
          response = await client.images.generate({
            model: input.model,
            prompt,
            n: 1,
            size: input.size,
            quality: input.quality,
            output_format: 'png',
          }) as ImageResponse;
        } else {
          const images = await Promise.all(input.references.map((reference) =>
            toFile(
              reference.png,
              `concept-screen-${reference.ordinal}.png`,
              { type: 'image/png' },
            )));
          response = await client.images.edit({
            model: input.model,
            image: images,
            prompt,
            n: 1,
            size: input.size,
            quality: input.quality,
            output_format: 'png',
          }) as ImageResponse;
        }
      } catch (error) {
        if (error instanceof GenerationBoundaryError) throw error;
        const requestId = typeof error === 'object'
          && error !== null
          && 'request_id' in error
          && typeof error.request_id === 'string'
          ? error.request_id
          : undefined;
        throw new GenerationBoundaryError(
          'openai_request_failed',
          `OpenAI could not generate Concept Screen ${input.ordinal}.`,
          { requestId },
        );
      }
      return resultFromResponse(response);
    },
  };
}
