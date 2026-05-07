# docs/

Architecture diagrams, design notes, and decision records for jobtracker.

## Layout

```
docs/
├── decisions/    # ADRs — one short markdown file per architectural decision
└── README.md
```

Architecture diagrams (PNG, Mermaid, Excalidraw) live alongside this README as they're created.

## ADR format

Each decision gets one file in `decisions/`, named `NNNN-short-title.md`:

```markdown
# ADR-NNNN: Short title

**Status:** proposed | accepted | superseded

## Context
What problem are we solving?

## Decision
What did we choose?

## Consequences
What does this enable or constrain?
```

Keep them short — half a page is plenty. The point is to document *why*, not how.
