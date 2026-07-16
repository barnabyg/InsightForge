import OpenAI from 'openai';

export interface CompatibleModels {
  text: string[];
  image: string[];
}

const incompatibleTextMarkers = [
  'audio',
  'chat',
  'codex',
  'image',
  'realtime',
  'search',
  'transcribe',
  'tts',
];

export function isCompatibleTextModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  const supportedFamily = /^gpt-(?:4o(?:[.-]|$)|4\.(?:1|5)(?:[.-]|$)|5(?:[.-]|$))/.test(lower)
    || /^o[134](?:-|$)/.test(lower);
  return supportedFamily
    && !incompatibleTextMarkers.some((marker) => lower.includes(marker));
}

export function isCompatibleImageModel(modelId: string): boolean {
  return /^gpt-image-(?:\d|latest)/.test(modelId.toLowerCase());
}

export function filterCompatibleModels(modelIds: string[]): CompatibleModels {
  const unique = [...new Set(modelIds)];
  return {
    text: unique.filter(isCompatibleTextModel).sort(),
    image: unique.filter(isCompatibleImageModel).sort(),
  };
}

export async function discoverCompatibleModels(
  apiKey: string,
): Promise<CompatibleModels> {
  const client = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: 10_000,
  });
  const models = await client.models.list();
  return filterCompatibleModels(models.data.map(({ id }) => id));
}
