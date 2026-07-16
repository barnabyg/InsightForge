# Use OpenAI with stage-specific models

The MVP integrates directly with OpenAI rather than introducing a multi-provider abstraction. Each generated stage has a global model selection so development can favor lower-cost models while production-quality runs can use stronger models independently. Every Stage Run records the exact model used for reproducibility.

## Consequences

OpenAI-specific text and image capabilities may shape the implementation. Supporting another provider later will require deliberate integration work rather than activating a prebuilt abstraction.
