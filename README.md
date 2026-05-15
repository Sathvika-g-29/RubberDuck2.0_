## Rubber Duck Debugger 🦆
An AI-powered Socratic debugging companion that helps developers find bugs on their own — by asking the right questions, not giving the answer.
## What It Does
Instead of telling you what's wrong, the rubber duck asks precise, Socratic questions that guide you to the answer yourself. The session evolves as you go:
- **Exchanges 1–7 (Socratic mode):** Pure questions only. No hints. No suggestions. The duck is a mirror.
- **Exchanges 8–10 (Nudge mode):** Questions get sharper and more pointed — almost leading. Like a teacher who can see you're one inch from the answer.
- **Type "I found it"** at any point → the duck breaks character and delivers a structured **debrief**: the bug named precisely, the moment that unblocked you, and one transferable lesson.
- **Type "I give up"** after exchange 10 → the duck reveals the answer directly, explains why it was hard to see, and still gives you the lesson.
## Stack
- **Frontend:** React + Vite + Tailwind CSS + shadcn/ui
- **Backend:** Express 5 (Node.js)
- **AI:** Anthropic Claude (via streaming SSE)
- **State:** Client-side only — no database, no accounts. When the tab closes, it's gone. That's a feature.
## Project Structure
artifacts/
rubber-duck/ ← React + Vite frontend
api-server/ ← Express API server (SSE streaming)
lib/
api-spec/ ← OpenAPI spec (source of truth)
api-client-react/ ← Generated React Query hooks
api-zod/ ← Generated Zod validation schemas
integrations-anthropic-ai/ ← Anthropic client wrapper

## Key Design Decisions
**Two prompts, four modes.** The entire product lives in four system prompts: Socratic, Nudge, Debrief, and Reveal. The mode switch at exchange 7 and the debrief/reveal at the end are the product's best moments.
**SSE streaming, not polling.** The duck's questions arrive word-by-word using `ReadableStream`. Waiting for a full response would kill the conversational feel.
**No persistence by design.** Session state lives in React `useState`. There's no login, no history, no cloud saves. A debugging session is a focused moment — it shouldn't follow you around.
**Contract-first API.** The OpenAPI spec in `lib/api-spec/openapi.yaml` is the single source of truth. All types, hooks, and validation schemas are generated from it.
## Running Locally
```bash
# Install dependencies
pnpm install
# Start the API server (port 5000)
pnpm --filter @workspace/api-server run dev
# Start the frontend (separate terminal)
pnpm --filter @workspace/rubber-duck run dev

Requires AI_INTEGRATIONS_ANTHROPIC_BASE_URL and AI_INTEGRATIONS_ANTHROPIC_API_KEY environment variables (or your own Anthropic API key).

License
MIT
