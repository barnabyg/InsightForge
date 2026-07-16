# Generate Concept Screens sequentially

The Concept Screens stage uses the OpenAI Image API and the selected GPT Image model directly. It generates the first screen from the Design Brief and Stage Prompt, then generates each subsequent screen using earlier screens as visual references. All three requests form one atomic Stage Run, and successfully generated candidate screens remain resumable if a later request fails. This accepts higher image-input cost and latency to improve visual continuity across the primary journey.

OpenAI documents both multi-image reference workflows and remaining limitations around consistency, text rendering, and precise composition in its [image generation guide](https://developers.openai.com/api/docs/guides/image-generation).
