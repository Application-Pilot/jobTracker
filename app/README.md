# app/

The multi-tenant rewrite of jobtracker.

**Status:** scaffolding only — no code yet. The pnpm workspace setup lands in a future commit.

## Planned layout

```
app/
├── package.json          # workspace root
├── pnpm-workspace.yaml
├── apps/
│   ├── web/              # Next.js dashboard (Cognito-authed, multi-tenant)
│   └── workers/          # Lambda handlers (sync scheduler, sync worker)
└── packages/
    ├── core/             # Domain model: Application, status rules
    ├── llm/              # Provider-agnostic extractor (Gemini, Groq, etc.)
    ├── gmail/            # Gmail OAuth + message fetching
    └── db/               # DynamoDB access layer
```

## Why a workspace

`apps/web` and `apps/workers` share the same domain model, LLM extractor, Gmail client, and DB layer. Splitting them into `packages/*` lets the web tier and the worker tier import the same code without duplication or a shared `src/` hack.
