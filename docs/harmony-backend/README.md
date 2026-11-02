# Harmony backend: working notes

Notes for building the C# Harmony (CRDT) backend behind `AnalysisRepository`. Keep them short and current; delete what turns out wrong.

| File | Holds |
| --- | --- |
| [concerns.md](concerns.md) | Problems, likely fixes and confidence; the place to record decisions |
| [log.md](log.md) | Dated learnings that don't fit a problem, newest first |

## Sources

- **Handoff (the authority):** [Interlinearizer data layer: CRDT backend handoff](https://claude.ai/artifact/Gq8zmC99Dvc7HfzNBGz6pa), 2026-10-30, with tabs for the Storage API reference and a glossary. It's a Claude Docs artifact: read it with the docs connector's `read` (`ref {object: project, id: Gq8zmC99Dvc7HfzNBGz6pa}`, then each tab's prose node). The Artifact tool's `read` returns an empty shell.
- **Tim's earlier plan (a critique, not the authority):** [Data Layer Plan, draft v8](https://claude.ai/artifact/VRn7dVCkaRxSsJ6uG1yBa1), 2026-10-16. Its proposed seam is in the collapsed "Code sketch" expander under Architecture; decisions 4 to 13 and the 39 sync rules cover most of what the handoff leaves open.
