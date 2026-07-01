# Interlinearizer Extension — Model & Architecture Audit (2026-07-01)

## Instructions (for resuming this task)

> **If this task was interrupted, re-read this section and continue from the first
> unchecked item in the Plan below.**
>
> Original request: Do a high-level audit/analysis of the `interlinearizer-extension`
> data model (`src/types/interlinearizer.d.ts`) and architecture as it is on branch
> `main` (commit `73cf42b`). Review open GitHub issues to see where the project is
> heading and assess how well the current model/architecture supports that direction.
> Use cheaper subagents where useful. Progressively save plan, progress, and findings
> to this file, committing to branch `audit/model-architecture-2026-07` (created from
> `main`). Do NOT modify existing branches; do NOT push or make any remote changes.

## Plan

- [x] Create branch `audit/model-architecture-2026-07` from `main`; create this file.
- [ ] Read and analyze the data model (`src/types/interlinearizer.d.ts` and
      supporting types in `src/types/`).
- [ ] Map the architecture via subagents:
  - [ ] Extension lifecycle & PAPI surface (`src/main.ts`, commands, web views,
        settings, contributions).
  - [ ] State management & persistence (`src/store/`, `src/services/projectStorage.ts`,
        `src/hooks/useDraftProject.ts`).
  - [ ] Parsing/tokenization pipeline (`src/parsers/`).
  - [ ] UI component architecture (`src/components/`, `src/hooks/`).
- [ ] Review open issues (26 open as of today) and cluster into themes; map each
      theme against the current model/architecture for fit and friction.
- [ ] Synthesize findings: strengths, risks, model gaps vs. roadmap, recommendations.
- [ ] Final commit.

## Progress log

- 2026-07-01: Branch and audit file created. Repo state: `main` @ `73cf42b`
  ("Add engine to generate token gloss suggestions from previous glosses (#131)").
  26 open issues fetched.

## Findings

_(populated progressively below)_
