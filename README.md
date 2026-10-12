<p align="center">
  <img src="docs/assets/nora-banner.svg" alt="Nora Health Assistant" width="100%">
</p>

<p align="center">
  <img alt="Phase" src="https://img.shields.io/badge/phase-P0%20in%20progress-087F8C?style=flat-square">
  <img alt="Node" src="https://img.shields.io/badge/node-26-142B45?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-12-142B45?style=flat-square&logo=nestjs&logoColor=white">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-142B45?style=flat-square&logo=nextdotjs&logoColor=white">
  <img alt="LangGraph" src="https://img.shields.io/badge/LangGraph.js-1.4-142B45?style=flat-square&logo=langchain&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/Postgres-17%20%2B%20pgvector-142B45?style=flat-square&logo=postgresql&logoColor=white">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-workspace-142B45?style=flat-square&logo=pnpm&logoColor=white">
</p>

<p align="center">
  <b>Nora</b> is an enterprise, multi-tenant health assistant that helps adults understand common symptoms,<br>
  decide <i>how urgently</i> to seek care, and hand off to the right clinician — with every claim traceable to approved evidence.
</p>

> [!WARNING]
> **Not a medical device. Not for real patients.** All clinical content in this repository (rules, questions, explanations, knowledge sources, providers, medicines) is **synthetic demo data** that has not been clinically validated. It exists to exercise the software end to end.

---

## Why Nora is different

| Principle | How it is enforced |
| --- | --- |
| **Rules decide urgency, never the model** | A deterministic rules engine evaluates a versioned clinical bundle on every input. Emergencies short-circuit the pipeline before any LLM call. AI output can never lower urgency. |
| **Bounded explanations** | The model may only rank *approved candidate explanations* from the active bundle; it cannot invent diagnoses. |
| **Every claim is cited** | A read-only research agent retrieves approved passages; drafts are verified so each explanation cites retrieved evidence IDs. |
| **Verify, retry, fall back** | Drafts with uncited claims, diagnosis or dosing language are rejected and retried, then replaced by approved template content. |
| **Memory without guesswork** | Nora remembers only what the patient confirmed: profile conditions, medicines and allergies, past checks and upcoming appointments. Memory is built deterministically and given to the model as numbered facts; the verifier rejects any history claim that doesn't cite one. |
| **Survives provider outages** | OpenRouter is primary and Google Gemini takes over automatically on rate limits, quota exhaustion or outages. If every provider fails, patients get approved template guidance and urgency is unaffected. |
| **Defence in depth** | A deterministic red-flag extractor always runs beside the LLM extractor; a critical finding it sees can never be dropped by the model. |
| **Tenant isolation & privacy** | Tenant-scoped data access, append-only consent, audit trails, idle timeouts, rotating refresh tokens and CSRF protection. |

## Screenshots

<table>
  <tr>
    <td width="66%"><img src="docs/screenshots/14-check-result.png" alt="Sore-throat check result with urgency, cited reasons and ranked explanations" /></td>
    <td width="34%"><img src="docs/screenshots/17-mobile-findings.png" alt="Check result on a phone, opened on the Findings tab" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/15-emergency-escalation.png" alt="Chest pain escalated to an emergency banner with a call button" /></td>
    <td><img src="docs/screenshots/18-mobile-care-plan.png" alt="Care plan on a phone" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/13-check-question.png" alt="Nora asking a follow-up question during a check" /></td>
    <td><img src="docs/screenshots/05-mobile-workspace.png" alt="Patient workspace on a phone with bottom navigation" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/19-consent-before-first-check.png" alt="Consent notice shown before the first check" /></td>
    <td><img src="docs/screenshots/07-tablet-next-steps-drawer.png" alt="Tablet layout with the next steps drawer" /></td>
  </tr>
</table>

### Memory, follow-ups and care plans

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/33-next-steps-memory.png" alt="Next steps panel showing what Nora remembers from confirmed records and recent checks" /></td>
    <td width="33%"><img src="docs/screenshots/36-follow-up-check.png" alt="Follow-up check linked to the earlier sore-throat check, escalated because symptoms worsened" /></td>
    <td width="33%"><img src="docs/screenshots/35-care-plan-checklist.png" alt="Care plan checklist with one item ticked off" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/34-findings-medical-terms.png" alt="Possible explanations switched to medical terms" /></td>
    <td><img src="docs/screenshots/37-platform-health.png" alt="Platform health with OpenRouter primary and Gemini fallback status" /></td>
    <td></td>
  </tr>
</table>

### Patient tools

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/24-doctors.png" alt="Doctor directory with verified doctors, next openings and booking handoff" /></td>
    <td width="50%"><img src="docs/screenshots/25-medicines.png" alt="Medicine library with plain-language summaries" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/21-preferences.png" alt="Preferences with health background that distinguishes none from not sure" /></td>
    <td><img src="docs/screenshots/23-privacy-controls.png" alt="Privacy controls with data download and scheduled deletion" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/22-history.png" alt="Check history with urgency and clinician updates" /></td>
    <td><img src="docs/screenshots/27-mobile-appointments.png" alt="Appointments tracker on a phone" width="60%" /></td>
  </tr>
</table>

### Staff consoles

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/29-review-case-signed-off.png" alt="Clinician case view with conversation, evidence trail and a signed-off urgency change" /></td>
    <td width="50%"><img src="docs/screenshots/28-review-queue.png" alt="Clinician review queue ordered by urgency" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/30-admin-overview.png" alt="Tenant admin overview with activity and feature switches" /></td>
    <td><img src="docs/screenshots/31-admin-audit-log.png" alt="Audit log of case access and configuration changes" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/32-platform-kill-switches.png" alt="Platform kill switches with a paused booking handoff and its reason" /></td>
    <td></td>
  </tr>
</table>

More in [`docs/screenshots/`](docs/screenshots/).

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    W["Next.js 16 web app<br/>(three-panel workspace)"]
  end
  subgraph API["NestJS 12 API"]
    A[Auth · JWT + rotating refresh]
    C[Checks & answers]
    Q[(Outbox worker)]
    G[LangGraph assessment graph]
    R[Rules engine<br/>urgency · scope · questions]
  end
  subgraph Data
    P[(Postgres 17<br/>+ pgvector)]
    RD[(Redis 7)]
  end
  subgraph OpenRouter["OpenRouter (primary)"]
    N[Nemotron 3.5 Lightning<br/>reasoning · tools]
    D[Mercury Decide<br/>calibrated decisions]
    E[Nemotron Embed VL<br/>embeddings]
  end
  subgraph Gemini["Google Gemini (fallback)"]
    GM[Gemini Flash-Lite<br/>reasoning · tools]
  end
  W -- "/api proxy · cookies" --> A
  W --> C
  C --> Q --> G
  G --> R
  G --> N
  G --> D
  G -. "rate limit · quota · outage" .-> GM
  G -- retrieval --> P
  E -. index .-> P
  A --> P
  A --> RD
```

### The assessment graph

```mermaid
stateDiagram-v2
  [*] --> extract: patient message / answer
  extract --> triage: rules + LLM observations
  triage --> escalate: emergency rule fired
  triage --> unsupported: out of scope
  triage --> select_question
  select_question --> [*]: needs input (next question)
  select_question --> research: enough information
  research --> tools: tool calls
  tools --> research: ≤ N rounds
  research --> ensure_evidence
  ensure_evidence --> decide: rank approved candidates
  decide --> compose_draft
  compose_draft --> verify
  verify --> compose_draft: issues (retry)
  verify --> fallback: retries exhausted
  verify --> finalize
  fallback --> finalize
  escalate --> [*]
  unsupported --> [*]
  finalize --> [*]
```

Research tools are **read-only**: `search_knowledge`, `get_case_summary`, `get_source`. The orchestration is tested end to end with a scripted chat model that replays tool calls and structured outputs.

## Repository layout

```text
.
├── apps/
│   ├── api/                 NestJS API · Prisma 7 · LangGraph orchestration
│   │   ├── prisma/          schema, migrations, synthetic seed
│   │   └── src/
│   │       ├── auth/        JWT access + opaque rotating refresh, CSRF, roles
│   │       ├── clinical/    bundle schema, rules engine, synthetic content
│   │       ├── assessment/  extraction, graph, tools, verification
│   │       ├── ai/          OpenRouter + Gemini model factories, provider failover, scripted test model
│   │       ├── memory/      grounded patient memory from confirmed records
│   │       ├── admin/       tenant admin, analytics, platform health
│   │       └── knowledge/   retrieval port (full-text + vector)
│   └── web/                 Next.js 16 app (App Router, cacheComponents)
├── packages/
│   ├── brand/               design tokens, Tailwind theme, logo assets, guidelines
│   └── ui/                  shared accessible React components
├── infra/docker/            Postgres 17 + pgvector image
├── docs/assets/             README artwork
└── prd/                     product requirements
```

## Quick start

**Prerequisites:** Node 26, pnpm 12, and Docker or Podman (with Compose).

```bash
pnpm install
cp .env.example .env                       # add OPENROUTER_API_KEY and/or GEMINI_API_KEY to enable AI
cp apps/api/.env.example apps/api/.env     # then set JWT_ACCESS_SECRET (openssl rand -base64 48)

pnpm infra:up                              # Postgres (5433) + Redis (6379)
pnpm db:migrate && pnpm db:seed            # schema + synthetic India demo data
pnpm dev                                   # web http://localhost:3000 · api http://localhost:4000
```

Run the whole stack in containers instead with `pnpm stack:up`.

### Demo accounts

Every seeded account uses the password **`NoraDemo!2026`** and organisation code **`demo`** (or `acme`). Each role lands on its own home page and only sees the tools it is allowed to use.

| Email | Role | What to try |
| --- | --- | --- |
| `patient@demo.nora.local` | Patient | Checks, history, preferences, privacy controls, doctors, appointments, medicines. Shares checks with clinicians. |
| `priya@demo.nora.local` | Patient | Fresh account — exercises onboarding and consent |
| `clinician@demo.nora.local` | Clinician | Review queue: pick up a flagged check, agree or change the urgency, message the patient |
| `coordinator@demo.nora.local` | Care coordinator | Read-only view of the review queue and cases |
| `admin@demo.nora.local` | Tenant admin | Analytics (7/30/90 days), feature switches, members, doctor listings, audit log |
| `editor@demo.nora.local` / `approver@demo.nora.local` | Content editor / approver | Clinical bundle, sources and medicine library status |
| `operator@nora.local` | Platform operator | System and AI provider health, kill switches across all organisations (sign in with `demo`) |
| `*@acme.nora.local` | Second tenant | Isolation testing |

## AI configuration

Nora talks to models through [OpenRouter](https://openrouter.ai) first and falls back to [Google Gemini](https://ai.google.dev) through its OpenAI-compatible endpoint. Set either key, or both. With no key it runs in **template mode**: rules, questions, care plans and evidence still work, and results are clearly labelled.

| Variable | Default | Role |
| --- | --- | --- |
| `OPENROUTER_MODEL` | `nvidia/nemotron-3.5-lightning:free` | Tool-calling research agent and drafting |
| `OPENROUTER_FAST_MODEL` | `nvidia/nemotron-3.5-lightning:free` | Structured symptom extraction |
| `OPENROUTER_DECISION_MODEL` | `inception/mercury-decide:free` | Calibrated ranking of approved candidates and an urgency cross-check (can escalate to review, never lowers urgency) |
| `OPENROUTER_EMBEDDING_MODEL` | `nvidia/llama-nemotron-embed-vl-1b-v2:free` | Knowledge embeddings (pgvector) |
| `GEMINI_API_KEY` | — | Enables the Gemini fallback |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Fallback research agent and drafting |
| `GEMINI_FAST_MODEL` | `gemini-3.1-flash-lite` | Fallback symptom extraction |

**Failover.** When a provider returns a rate limit, quota or server error, or times out, the assessment is rerun on the next provider and the failing one is paused, so later checks skip it:

- When the provider gives a retry delay, it is paused for that long.
- When a daily quota runs out, it is paused until the quota resets: midnight UTC for OpenRouter, midnight Pacific time for Gemini.
- For other rate limits, it is paused for two minutes.

Gemini has no decision model, so explanations are ranked by the rules instead. Pause state lives in memory and resets when the API restarts. Operators can see each provider's status on the **Platform operations** page.

**Memory.** Before research, Nora builds a numbered list of facts (M1…Mn) from the patient's confirmed profile, recent checks and upcoming appointments. The model may reference these facts but never writes memory. Any claim about the patient's history that doesn't cite a fact is rejected by the verifier. A recent similar check triggers a deterministic recurrence rule.

## Testing

```bash
pnpm --filter @nora/api test          # rules engine, extraction, orchestration (scripted model)
pnpm --filter @nora/brand test        # token contrast + CSS/token sync
pnpm typecheck && pnpm lint
```

## Brand

<p>
  <img alt="Navy #142B45" src="https://img.shields.io/badge/Navy-%23142B45-142B45?style=for-the-badge">
  <img alt="Teal #087F8C" src="https://img.shields.io/badge/Teal-%23087F8C-087F8C?style=for-the-badge">
  <img alt="Cyan #16C4D5" src="https://img.shields.io/badge/Cyan-%2316C4D5-16C4D5?style=for-the-badge">
  <img alt="Focus #2457C5" src="https://img.shields.io/badge/Focus-%232457C5-2457C5?style=for-the-badge">
</p>

Tokens, typography, layout and accessibility rules live in [`packages/brand`](packages/brand/GUIDELINES.md); the live reference page is `/brand` in the web app. Colour never carries meaning alone, every text pairing is contrast-tested, and urgency messaging is never obscured by tenant theming.

## Roadmap

**P0 — core safe assessment** (in progress)

- [x] Containerised infra, brand system, JWT auth with refresh rotation and CSRF
- [x] Data model for consent, profiles, checks, results, review, providers, audit and privacy
- [x] Versioned clinical bundle, deterministic rules engine and sentinel evaluation
- [x] Synthetic India seed: 2 tenants, 11 users, 6 concerns, knowledge library, 18 providers, 25 medicines
- [x] Rule-based red-flag extractor
- [x] LangGraph assessment orchestration with read-only research tools and a deterministic safety verifier
- [x] Checks API with consent gate, outbox worker, retries with template fallback, and polled live stage events
- [x] Symptom-check workspace end to end: questions, emergency banner, findings with citations, care plan, mobile tabs
- [x] Preferences, check history, privacy controls (consents, data download, scheduled deletion)
- [x] Doctor directory with booking handoff, appointment tracker, medicine education library
- [x] Clinician review queue with sign-off, consent-aware sharing and patient-visible corrections
- [x] Tenant admin (feature switches, members, doctor listings, audit log), platform kill switches, content overview
- [x] Grounded patient memory, linked follow-up checks, care-plan checklist, plain/medical terms toggle
- [x] OpenRouter → Gemini failover with quota-aware pausing; platform health for operators
- [x] Tenant analytics with 7/30/90-day ranges; counts under 5, and any figure that would reveal one, are withheld
- [ ] Server-sent events with `Last-Event-ID` resume; embedding index and vector search

**P1** — voice input, report upload, live scheduling, notifications, clinician-signed guidance, more languages.
**P2** — personalised medicine guidance, EHR/FHIR integration, payments.

---

<p align="center">
  <img src="packages/brand/assets/nora-mark.svg" alt="" width="32"><br>
  <sub>Proprietary — all rights reserved. Synthetic demo content only; not for clinical use.</sub>
</p>
