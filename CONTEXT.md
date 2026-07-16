# InsightForge

InsightForge is a product-development workspace in which one person turns an early product insight into a coherent set of planning and design artifacts.

## Language

**Author**:
The product manager or founder who privately develops and iterates the product artifacts in a workflow.
_Avoid_: Collaborator, approver, team member

**Project**:
A saved body of work that develops one product insight through a single, evolving chain of product artifacts. A Project does not contain alternative branches.
_Avoid_: Branch, workspace, document

**Insight Source**:
The single block of text from which a Project's generated workflow begins. Its original medium or origin has no domain significance, and after generation it changes only through a promoted Insight Revision.
_Avoid_: Attachment, source document, evidence collection

**Insight Revision**:
A proposed replacement for the current Insight Source. It becomes current only when the complete Candidate Workflow generated from it is promoted.
_Avoid_: Mixed-state edit, artifact edit

**Project Export**:
A self-contained portable representation of a Project, including its current artifacts, Workflow Snapshots, images, and Stage Run provenance. It does not contain credentials or current shared Stage Configurations.
_Avoid_: Cloud backup, shared Project

**Deliverable Export**:
A human-usable package containing the current Design Brief, PRD, Concept Screen images, and a small provenance manifest. It excludes workflow history and generation attempts.
_Avoid_: Project Export, backup

**Stage Prompt**:
The single shared set of editable instructions used to generate one workflow stage across all Projects. Changes apply to future runs; a historical prompt snapshot may replace it only through an explicit global restore.
_Avoid_: Project prompt, prompt override, prompt copy

**Prompt Draft**:
An uncommitted edit to a Stage Prompt. It is never used by a Stage Run until the Author explicitly saves it as the shared Stage Prompt.
_Avoid_: Active prompt, autosaved prompt

**Stage Input**:
The upstream content that the app attaches to a Stage Prompt according to the fixed workflow. An Author can improve the source content but cannot alter the attachment mechanism.
_Avoid_: Editable placeholder, prompt variable

**Stage Configuration**:
The shared Stage Prompt, selected OpenAI model, and any stage-specific generation settings that govern future runs of one stage across all Projects.
_Avoid_: Project configuration, provider configuration

**Default Workflow Configuration**:
The immutable built-in baseline of Stage Configurations from which the shared workflow can be restored.
_Avoid_: Project default, prompt history

**Workflow Configuration Export**:
A portable copy of the current shared Stage Configurations used for backup, transfer, or testing. It never contains an API credential.
_Avoid_: Project Export, credential backup

**Stage Run**:
One execution of a workflow stage using its current inputs and Stage Configuration. Each Stage Run preserves a read-only snapshot of the exact prompt, model, and generation settings alongside its result.
_Avoid_: Prompt copy, workflow run

**Variation Run**:
A deliberate Stage Run with unchanged Stage Input and Stage Configuration, used to sample a different model outcome. It is presented separately from regeneration driven by a meaningful change.
_Avoid_: Retry, prompt improvement

**Artifact**:
A read-only result produced by a Stage Run. An Artifact is improved by refining its source or Stage Prompt and running the stage again, never by editing the result directly.
_Avoid_: Editable document, draft

**Artifact Validation**:
Deterministic checks that confirm a Stage Run returned a structurally usable Artifact. A hard validation failure prevents promotion of a Candidate Workflow.
_Avoid_: Quality evaluation, AI review

**Sanity Warning**:
A deterministic signal that an otherwise valid Artifact may be unexpectedly thin, repetitive, or visually undersized. It requires Author review but does not declare the Artifact invalid.
_Avoid_: Validation failure, quality score

**Update Available**:
A neutral indication that an Artifact was generated with an earlier Stage Configuration. The current workflow remains coherent until the Author deliberately regenerates it.
_Avoid_: Out of date, invalid, automatic update

**Design Brief**:
The authoritative product-design interpretation generated from the Insight Source. It supplies the product intent used to generate both the Concept Screen Set and the PRD.
_Avoid_: Insight summary, editable brief

**Concept Screen**:
A provisional, mid-fidelity image that communicates interface structure and interaction intent using realistic components and representative content, without committing to branding or final visual design.
_Avoid_: Wireframe, high-fidelity mockup, final design

**Concept Screen Set**:
The three coordinated Concept Screens produced together to illustrate a Project's primary user journey. The set is treated as one Artifact.
_Avoid_: Gallery, individual screen artifact, variable screen count

**PRD**:
The final requirements Artifact generated from the Design Brief and Concept Screen Set. It does not consume the Insight Source directly.
_Avoid_: Insight analysis, editable requirements document

**Workflow Snapshot**:
An immutable, internally consistent set of a Project's artifacts preserved before regeneration. It can be inspected or restored as a unit without changing the shared Stage Prompts.
_Avoid_: Artifact version, mixed state, backup

**Candidate Workflow**:
A complete replacement workflow being produced by cascaded Stage Runs. It becomes current only after every required Stage Run succeeds and remains resumable if generation fails or is cancelled.
_Avoid_: Partial update, current workflow

**Full Generation**:
A single-pass cascade that creates the Design Brief, Concept Screen Set, and PRD directly from an Insight Source, promoting them only as a complete Candidate Workflow.
_Avoid_: Autonomous iteration, agentic workflow
