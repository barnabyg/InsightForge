export class GenerationBoundaryError extends Error {
  readonly code: string;
  readonly requestId: string | null;
  readonly responseId: string | null;

  constructor(
    code: string,
    message: string,
    identifiers: { requestId?: string; responseId?: string } = {},
  ) {
    super(message);
    this.name = 'GenerationBoundaryError';
    this.code = code;
    this.requestId = identifiers.requestId ?? null;
    this.responseId = identifiers.responseId ?? null;
  }
}
