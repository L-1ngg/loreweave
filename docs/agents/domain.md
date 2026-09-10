# Domain documentation

This project has one domain context: the root glossary and `docs/adr/`.
The planned Bun workspace does not by itself create multiple domain contexts.

Keep `CONTEXT.md` limited to terms and meanings. Record architectural trade-offs
in ADRs, product requirements in the construction spec, and module interfaces
in the module contracts. The design discussion preserves decision provenance.
When a new decision changes an existing contract, update that contract and its
dependent work items rather than leaving two competing definitions.
