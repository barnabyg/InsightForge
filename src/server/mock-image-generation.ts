import { PNG } from 'pngjs';
import type { ImageGenerationBoundary } from './image-generation-boundary.js';
import { GenerationBoundaryError } from './generation-boundary.js';

type Colour = [number, number, number, number];

function fill(image: PNG, x: number, y: number, width: number, height: number, colour: Colour) {
  for (let row = Math.max(0, y); row < Math.min(image.height, y + height); row++) {
    for (let column = Math.max(0, x); column < Math.min(image.width, x + width); column++) {
      const offset = (row * image.width + column) * 4;
      image.data[offset] = colour[0];
      image.data[offset + 1] = colour[1];
      image.data[offset + 2] = colour[2];
      image.data[offset + 3] = colour[3];
    }
  }
}

function renderMockScreen(ordinal: 1 | 2 | 3): Buffer {
  const image = new PNG({ width: 1024, height: 768 });
  fill(image, 0, 0, 1024, 768, [247, 244, 236, 255]);
  fill(image, 0, 0, 210, 768, [31, 35, 53, 255]);
  fill(image, 28, 34, 112, 12, [226, 231, 246, 255]);
  for (let item = 0; item < 5; item++) {
    fill(image, 28, 100 + item * 54, 150, 30, item === ordinal
      ? [77, 92, 184, 255]
      : [55, 60, 82, 255]);
  }
  fill(image, 210, 0, 814, 68, [255, 254, 250, 255]);
  fill(image, 246, 25, 240, 16, [42, 43, 48, 255]);
  fill(image, 246, 105, 420, 28, [42, 43, 48, 255]);
  fill(image, 246, 148, 650, 10, [173, 169, 158, 255]);

  if (ordinal === 1) {
    fill(image, 246, 198, 730, 160, [255, 255, 255, 255]);
    fill(image, 274, 224, 330, 18, [52, 55, 67, 255]);
    fill(image, 274, 260, 620, 10, [195, 191, 181, 255]);
    fill(image, 274, 288, 520, 10, [195, 191, 181, 255]);
    for (let card = 0; card < 3; card++) {
      fill(image, 246 + card * 244, 390, 220, 250, [255, 255, 255, 255]);
      fill(image, 270 + card * 244, 420, 130, 14, [52, 55, 67, 255]);
      fill(image, 270 + card * 244, 462, 170, 9, [196, 192, 183, 255]);
      fill(image, 270 + card * 244, 490, 150, 9, [196, 192, 183, 255]);
      fill(image, 270 + card * 244, 570, 92, 34, [77, 92, 184, 255]);
    }
  } else if (ordinal === 2) {
    for (let column = 0; column < 3; column++) {
      fill(image, 246 + column * 238, 198, 214, 430, [255, 255, 255, 255]);
      fill(image, 270 + column * 238, 225, 122, 16, [52, 55, 67, 255]);
      for (let row = 0; row < 7; row++) {
        fill(image, 270 + column * 238, 278 + row * 43, 150 + ((row + column) % 2) * 28, 10,
          row === 3 ? [77, 92, 184, 255] : [190, 187, 179, 255]);
      }
    }
  } else {
    fill(image, 246, 198, 460, 430, [255, 255, 255, 255]);
    fill(image, 274, 226, 190, 18, [52, 55, 67, 255]);
    for (let row = 0; row < 5; row++) {
      fill(image, 274, 286 + row * 55, 390, 34, [245, 243, 237, 255]);
      fill(image, 292, 298 + row * 55, 180 + row * 25, 9, [170, 167, 158, 255]);
    }
    fill(image, 738, 198, 238, 260, [255, 255, 255, 255]);
    fill(image, 766, 228, 130, 14, [52, 55, 67, 255]);
    fill(image, 766, 274, 160, 9, [190, 187, 179, 255]);
    fill(image, 766, 310, 120, 9, [190, 187, 179, 255]);
    fill(image, 766, 382, 130, 38, [77, 92, 184, 255]);
  }
  return PNG.sync.write(image);
}

function stableIdentifier(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createMockImageGeneration(
  options: { delayMs?: number } = {},
): ImageGenerationBoundary {
  const failedOnce = new Set<string>();
  return {
    async generateConceptScreen(input) {
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      const failureKey = `${input.designBrief}:${input.ordinal}`;
      if (
        input.designBrief.includes(`[mock:image-failure-once-${input.ordinal}]`)
        && !failedOnce.has(failureKey)
      ) {
        failedOnce.add(failureKey);
        throw new GenerationBoundaryError(
          'openai_request_failed',
          `OpenAI could not generate Concept Screen ${input.ordinal}.`,
          { requestId: `mock_req_screen_${input.ordinal}_failed` },
        );
      }
      const identifier = stableIdentifier([
        input.model,
        input.quality,
        input.stagePrompt,
        input.designBrief,
        String(input.ordinal),
      ].join('\n'));
      const inputTokens = 180 + input.references.length * 420;
      const outputTokens = 920;
      return {
        png: renderMockScreen(input.ordinal),
        requestId: `mock_req_image_${input.ordinal}_${identifier}`,
        responseId: null,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      };
    },
  };
}
