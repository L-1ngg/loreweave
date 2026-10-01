# Architectural decisions

ADRs record choices and trade-offs; [current contracts](../architecture/contracts.md)
describe implemented behavior. IDs remain stable. Superseded decisions preserve
the reasoning at their original date and are not current requirements.

| ADR                                                  | State              | Decision                                                                          |
| ---------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------- |
| [0005](0005-pageindex-typescript-replacement.md)     | Accepted           | TypeScript document-tree QA, maintained TanStack stack and independent fresh data |
| [0004](0004-model-transport-capacity-and-outcome.md) | Superseded by 0005 | Historical model HTTP capacity and remote-outcome separation                      |
| [0003](0003-forge-agent-sdk-and-bun-host.md)         | Superseded by 0005 | Historical Forge SDK/Bun integration                                              |
| [0002](0002-built-in-knowledge-conversation.md)      | Superseded by 0005 | Historical built-in knowledge-maintenance conversation                            |
| [0001](0001-shared-wiki-graph-provenance.md)         | Superseded by 0005 | Historical shared Wiki/graph source identity                                      |

Read [history](../history.md) for fixed snapshots of the corresponding retired
designs. Create a new ADR only for a lasting choice with a meaningful trade-off;
routine work-item details stay in GitHub Issues.
