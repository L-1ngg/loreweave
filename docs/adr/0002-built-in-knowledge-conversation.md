---
status: accepted
date: 2026-09-10
---

# Built-in conversation for knowledge operations

The redesigned first version provides a built-in conversational entry point for
members to supply Markdown, request source updates, and ask questions within the
same product as Wiki browsing. Keeping project, document, and operation context
in that interaction supports the natural-language workflow confirmed in Q18 and
direct use by organizational members. The trade-off is owning conversation
context management, intent interpretation, and tool-call orchestration in the
product.

This expands the current MCP-first design, which delegates Agent orchestration
to external clients. It is an accepted redesign decision, not an implemented
runtime change or a decision to remove external-client integration.
[ADR-0003](0003-forge-agent-sdk-and-bun-host.md) selects Forge SDK reuse and a Bun
host; the [blueprint](../rag-v1-blueprint.md) specifies conversation persistence,
interface technology and execution-budget defaults. Q20 and Q22 in the
[design discussion](../rag-optimization-design.md) establish bounded retrieval
and the 60-second total budget for complex questions. Concrete model selection,
monetary limits and integration verification remain preparation work.
