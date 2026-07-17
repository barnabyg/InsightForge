import type { TextGenerationBoundary } from '../shared/generation.js';
import { GenerationBoundaryError } from './generation-boundary.js';

function stableIdentifier(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function words(value: string): number {
  return value.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

export function createMockTextGeneration(
  options: { delayMs?: number } = {},
): TextGenerationBoundary {
  return {
    async generateDesignBrief(input) {
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (input.insightSource.includes('[mock:refusal]')) {
        throw new GenerationBoundaryError(
          'openai_refusal',
          'OpenAI declined to generate this Design Brief.',
          { requestId: 'mock_req_refusal' },
        );
      }
      if (input.insightSource.includes('[mock:failure]')) {
        throw new GenerationBoundaryError(
          'openai_request_failed',
          'OpenAI could not generate the Design Brief.',
          { requestId: 'mock_req_failure' },
        );
      }

      const markdown = input.insightSource.includes('[mock:short]')
        ? '# Design Brief\n\n## Insight summary\n\nA deliberately short mock result for validating the Author warning flow.'
        : `# Design Brief

## Insight summary

${input.insightSource}

This signal suggests that people are not short of information; they are short of a dependable way to interpret it at the moment a consequential choice must be made. The opportunity is to turn scattered evidence into a calm, legible decision path.

## Problem or opportunity

People currently assemble their understanding across inconsistent sources, informal explanations, and assumptions that remain invisible until late in the journey. That creates hesitation, repeated checking, and avoidable dependence on whichever source appears most confident rather than whichever source is most useful.

The product opportunity is to help an Author expose meaningful trade-offs early, preserve the reasoning behind a choice, and move forward without pretending that uncertainty has disappeared. The experience should support judgement rather than replace it.

## Target user and context

The primary user is a motivated non-specialist facing a complex decision with limited time and uneven domain knowledge. They are willing to engage with detail when it clearly affects the outcome, but they do not want to decode specialist language or reconstruct comparisons manually.

The critical context is the period between initial interest and commitment. Users may arrive with partial notes, competing proposals, or advice from several people. They need continuity across short sessions and confidence that important caveats have not been silently lost.

## Evidence, assumptions, and unknowns

The Insight Source is treated as directional evidence, not proof of frequency or market size. We conservatively assume that comparison effort and hidden trade-offs contribute to delay. We do not yet know which distinctions matter most, how users currently record decisions, or where professional guidance must remain prominent.

Early research should test the vocabulary users naturally apply, the smallest useful comparison structure, and whether showing unresolved questions increases trust. It should also examine where simplification becomes misleading and which details need traceable source context.

## Desired outcomes and success measures

Users should be able to explain the available options, identify the trade-offs that affect them, and state what information is still missing. A successful first release reduces repeated reconstruction, makes uncertainty explicit, and helps users reach a defensible next step sooner.

Useful measures include completion of the primary comparison journey, time to identify a preferred direction, return visits to unresolved questions, and qualitative confidence in explaining the decision. These are learning signals rather than promises of a final commercial outcome.

## Product principles

- Reveal reasoning, not just recommendations.
- Separate observed evidence from assumptions and open questions.
- Prefer progressive disclosure over dense dashboards.
- Keep the user in control of consequential choices.
- Make the next useful action obvious without manufacturing urgency.

## Primary journey

The user begins with a concise orientation that reflects their situation in familiar language. They add or review the options being considered, then move through a coordinated comparison focused on the few distinctions that materially change the decision. Unresolved information remains visible alongside a clear next action.

The journey concludes with a reviewable decision record: the preferred direction, important trade-offs, remaining questions, and the evidence that shaped the choice. Users can revisit it without reconstructing the original context.

## Scope and non-goals

The initial scope includes guided orientation, structured comparison, explicit assumptions, unresolved-question tracking, and a concise decision summary. It does not include professional certification, marketplace transactions, automated recommendations, exhaustive domain education, or claims that uncertainty can be eliminated.

The product should prove that a disciplined decision path is valuable before adding integrations, collaboration, personalization, or broad content libraries. Manual entry and representative content are acceptable where they keep the learning loop focused.

## Constraints and risks

The interface must remain trustworthy when evidence is incomplete and must not imply authority it does not possess. Too much structure could feel burdensome; too little could reproduce the ambiguity users already face. Representative content must avoid accidental promises and remain clearly distinguishable from verified facts.

## Open questions

- Which trade-offs are both common and consequential?
- What source context is necessary for trust?
- When do users want guidance versus an unopinionated comparison?
- How should the experience communicate missing or conflicting information?

## Direction for three coordinated Concept Screens

Show an orientation screen that frames the decision and current evidence, a comparison workspace that makes material trade-offs legible, and a decision review that preserves the chosen direction with open questions. Keep the screens mid-fidelity, calm, and structurally consistent.`;

      const identifier = stableIdentifier([
        input.model,
        input.stagePrompt,
        input.insightSource,
      ].join('\n'));
      const inputTokens = Math.ceil(words(input.stagePrompt + input.insightSource) * 1.35);
      const outputTokens = Math.ceil(words(markdown) * 1.4);
      return {
        markdown,
        responseId: `mock_resp_${identifier}`,
        requestId: `mock_req_${identifier}`,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      };
    },

    async generatePrd(input) {
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (input.designBrief.includes('[mock:prd-refusal]')) {
        throw new GenerationBoundaryError(
          'openai_refusal',
          'OpenAI declined to generate the PRD.',
          { requestId: 'mock_req_prd_refusal' },
        );
      }
      if (input.designBrief.includes('[mock:prd-failure]')) {
        throw new GenerationBoundaryError(
          'openai_request_failed',
          'OpenAI could not generate the PRD.',
          { requestId: 'mock_req_prd_failure' },
        );
      }

      const markdown = input.designBrief.includes('[mock:prd-short]')
        ? '# Product Requirements Document\n\n## Overview\n\nA deliberately short mock PRD for validating the Author warning flow.'
        : `# Product Requirements Document

## Overview and context

This product helps a motivated non-specialist compare consequential options, understand the trade-offs that materially affect the decision, and preserve a defensible record of the direction chosen. The Design Brief establishes the authoritative product intent. The three Concept Screens translate that intent into an orientation moment, a structured comparison workspace, and a final decision review. This PRD reconciles those sources without introducing claims that are not supported by them.

## Goals, measures, and non-goals

The release should reduce repeated reconstruction of information, make assumptions and missing evidence visible, and help the user reach a reasoned next step sooner. Measures include completion of the comparison journey, time to identify a preferred direction, successful return to unresolved questions, and qualitative confidence explaining the final choice. The release does not provide professional certification, make an automated recommendation, complete a transaction, or claim that uncertainty has been eliminated.

## Target user and primary journey

The primary user has limited specialist knowledge, several imperfect sources, and a decision that deserves more discipline than a simple checklist. They begin by confirming the situation and available evidence, progress to a focused comparison of material differences, and conclude by reviewing the preferred direction, its supporting reasoning, and remaining questions. Information must persist across short sessions without requiring the user to reconstruct context.

## Concept Screen walkthrough

### Concept Screen 1 — orientation

Concept Screen 1 frames the decision, summarizes available evidence, distinguishes known information from assumptions, and presents the next useful action. It should avoid manufactured urgency and provide a calm entry point into the comparison.

### Concept Screen 2 — comparison

Concept Screen 2 presents the candidate options in a coordinated workspace. Material trade-offs are aligned, unresolved evidence remains visible, and representative content shows how the user can inspect detail without losing the comparison context.

### Concept Screen 3 — decision review

Concept Screen 3 records the preferred direction, important trade-offs, open questions, and evidence that shaped the choice. The user can return to the comparison when new evidence changes the decision.

## Functional requirements

- **FR-001:** The product shall present a concise orientation using language derived from the current decision context.
- **FR-002:** The product shall distinguish observed evidence, assumptions, and unresolved questions.
- **FR-003:** The product shall support at least two options in a consistent comparison structure.
- **FR-004:** The product shall emphasize differences that materially affect the user's decision.
- **FR-005:** The product shall preserve source context for evidence where it is available.
- **FR-006:** The product shall allow the user to record a preferred direction without representing it as an automated recommendation.
- **FR-007:** The decision review shall retain selected trade-offs, remaining questions, and supporting evidence.
- **FR-008:** The user shall be able to return from the review to the comparison without losing entered context.

## States and recovery

Loading states must preserve layout and identify the content being prepared. Empty states explain what evidence or option is needed next. Validation errors remain adjacent to the relevant input and do not discard valid work. Network or persistence failures provide a safe retry action initiated by the user. Successful saves are announced without interrupting the journey. If a session ends unexpectedly, the last durable state is restored.

## Business rules and data needs

Every option has a stable identifier, display name, representative attributes, evidence references, and unresolved questions. A trade-off may be marked material without assigning a universal score. The preferred direction is optional until the user explicitly records it. Changing evidence must not silently erase an earlier rationale; the review should show that the decision needs reconsideration.

## Quality expectations

Keyboard operation, visible focus, semantic headings, labelled controls, and sufficient contrast are required. Private decision data remains local unless the user explicitly invokes an external generation operation. Authorization material is never displayed or logged. The primary comparison should become interactive quickly on a typical laptop, and long operations must expose clear progress rather than an indeterminate frozen surface.

## Analytics and learning

The MVP has no third-party analytics. Test sessions may measure journey completion, time to comparison, return to unresolved questions, and whether users can accurately explain the selected trade-offs. Findings must distinguish usability evidence from assumptions about commercial demand.

## Dependencies, risks, and assumptions

The experience depends on representative content and a stable local persistence layer. The central risk is oversimplifying a consequential choice or implying authority the product does not possess. We assume users value explicit uncertainty when it is paired with a clear next action. Research should test which distinctions are genuinely material and when professional guidance must remain prominent.

## Release scope and acceptance criteria

The first release includes orientation, structured comparison, evidence and assumption labels, unresolved-question tracking, and a decision review. A user can complete the three-screen journey, identify a preferred direction, explain the trade-offs behind it, and leave unresolved questions visible. The workflow remains usable after reload and failure messages never expose credentials or discard previously durable information.

## Open questions

- Which comparison attributes are common enough to deserve a default structure?
- How much evidence context is necessary before the interface feels trustworthy?
- When does explicit uncertainty build confidence, and when does it feel obstructive?
- Which recovery actions are essential when information changes after a decision is recorded?`;

      const identifier = stableIdentifier([
        input.model,
        input.stagePrompt,
        input.designBrief,
        ...input.conceptScreens.map((screen) => [
          String(screen.ordinal),
          Buffer.from(screen.png).toString('base64'),
        ].join(':')),
      ].join('\n'));
      const inputTokens = Math.ceil(words(input.stagePrompt + input.designBrief) * 1.35)
        + input.conceptScreens.length * 260;
      const outputTokens = Math.ceil(words(markdown) * 1.4);
      return {
        markdown,
        responseId: `mock_resp_${identifier}`,
        requestId: `mock_req_${identifier}`,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      };
    },
  };
}
