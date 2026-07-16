# Atomically regenerate the workflow

When an Author reruns a stage, InsightForge also reruns every downstream stage and promotes the results only after the complete cascade succeeds. The previous coherent workflow is preserved automatically as a Workflow Snapshot; if any Stage Run fails, it remains current. A proposed Insight Revision follows the same rule and replaces the current Insight Source only alongside its successfully generated workflow. This deliberately trades additional generation time and cost for consistent artifacts, explicit lineage, and safe recovery.

## Consequences

The interface must preview and confirm the cascade, communicate progress across every affected stage, keep partial candidate results out of the current workflow, and allow prior Workflow Snapshots to be inspected or restored as a unit.
