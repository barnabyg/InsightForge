import type {
  ImageQuality,
  StageId,
  StageInputId,
  StageKind,
} from '../shared/workflow-configuration.js';

export interface DefaultStageConfiguration {
  id: StageId;
  name: string;
  kind: StageKind;
  prompt: string;
  model: string;
  imageQuality: ImageQuality | null;
  requiredInputs: StageInputId[];
  outputContract: string;
}

export const defaultStageConfigurations: DefaultStageConfiguration[] = [
  {
    id: 'design_brief',
    name: 'Design Brief',
    kind: 'text',
    model: 'gpt-5.6-luna',
    imageQuality: null,
    requiredInputs: ['insight_source'],
    outputContract: 'Return one structured Markdown Design Brief.',
    prompt: `Act as an experienced product designer turning an early product insight into a disciplined Design Brief.

Create a concise but substantive brief with clear Markdown headings for:
- Insight summary
- Problem or opportunity
- Target user and context
- Evidence, assumptions, and unknowns
- Desired outcomes and success measures
- Product principles
- Primary journey
- Scope and non-goals
- Constraints and risks
- Open questions
- Direction for exactly three coordinated Concept Screens

Keep the brief focused on product and interaction intent. Do not drift into detailed implementation requirements. Never invent certainty: label missing facts as conservative assumptions or open questions. Work from the attached Insight Source, make the best single-shot interpretation you can, and do not ask follow-up questions.`,
  },
  {
    id: 'concept_screens',
    name: 'Concept Screens',
    kind: 'image',
    model: 'gpt-image-2',
    imageQuality: 'medium',
    requiredInputs: ['design_brief'],
    outputContract: 'Generate exactly three coordinated PNG Concept Screens, one interface per image.',
    prompt: `Create exactly three coordinated Concept Screens that communicate the primary journey described by the attached Design Brief.

Choose three sequential journey moments. Show one interface screen per image. Keep the platform, layout system, navigation, component language, and representative content consistent across the complete set. Aim for neutral mid-fidelity product design: realistic controls and content, clear hierarchy, restrained colour, and enough visual detail to communicate interaction intent without implying final branding.

Do not include logos, marketing artwork, device photography, hands, perspective mockups, decorative presentation boards, or multi-screen collages. Do not turn the screens into polished brand concepts. Make conservative assumptions where the Design Brief is incomplete and express the strongest coherent single direction rather than alternatives.`,
  },
  {
    id: 'prd',
    name: 'PRD',
    kind: 'text',
    model: 'gpt-5.6-luna',
    imageQuality: null,
    requiredInputs: ['design_brief', 'concept_screen_set'],
    outputContract: 'Return one structured Markdown Product Requirements Document.',
    prompt: `Act as a senior product manager. Produce a rigorous Product Requirements Document from the attached Design Brief and Concept Screen Set.

Use clear Markdown headings for:
- Overview and context
- Goals, success measures, and non-goals
- Target user and primary journey
- Walkthrough of all three Concept Screens
- Functional requirements with stable requirement IDs
- Loading, empty, error, success, and recovery states
- Business rules and data needs
- Accessibility, privacy, security, and performance expectations
- Analytics and measurement
- Dependencies, risks, and assumptions
- Release scope and acceptance criteria
- Open questions

Reconcile the written and visual inputs. Call out contradictions rather than silently choosing between them. Do not receive or infer from the original Insight Source. Avoid invented certainty, make conservative assumptions explicit, and do not ask follow-up questions.`,
  },
];

export function defaultStage(stageId: StageId): DefaultStageConfiguration {
  const stage = defaultStageConfigurations.find(({ id }) => id === stageId);
  if (!stage) {
    throw new Error(`Unknown stage ${stageId}`);
  }
  return stage;
}
