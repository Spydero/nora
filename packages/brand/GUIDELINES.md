# Nora brand and UX guidelines

Implementation reference for PRD Sections 1 and 2. Tokens live in `src/tokens.ts` (TypeScript) and `src/theme.css` (Tailwind v4 `@theme`); the test suite keeps them in sync and enforces contrast. The live reference page is `/brand` in the web app.

> Status: proposed baseline. The product name, mark and exact token values require brand, trademark, accessibility and clinical approval before patient release (PRD 1.2, BR AC04).

## Identity

- Product brand **Nora**; enterprise descriptor **Health Assistant**.
- Tenant deployments show the organisation logo beside a restrained "Powered by Nora" where contractually appropriate. Tenant branding never obscures urgency messages or clinical provenance.
- Mark: rounded square with an abstract N pathway (`assets/nora-mark.svg`); monochrome variant uses `currentColor` (`assets/nora-mark-mono.svg`).
- Minimum sizes: 24 px app icon, 120 px wordmark. Clear space on every side equals half the mark height.
- Never use medical certification seals, diagnostic accuracy claims, or a cross emblem.
- The wordmark SVG uses live text; outline it to paths when producing the approved masters (SVG, PNG, monochrome, favicon).

## Colour

| Tailwind class suffix | Token | Use |
| --- | --- | --- |
| `brand-navy` | `brand.navy` #142B45 | Primary brand, enterprise navigation |
| `brand-teal` | `brand.teal` #087F8C | Primary actions, selected states |
| `brand-cyan` | `brand.cyan` #16C4D5 | Illustration accent only; never small text on white |
| `fg` / `fg-muted` | `text.primary` / `text.secondary` | Headings and body / supporting copy |
| `canvas` / `panel` | `surface.page` / `surface.panel` | App canvas / cards and working panels |
| `line` | `border.default` | Dividers and inactive boundaries |
| `focus` | `focus.ring` #2457C5 | Visible keyboard focus |
| `success`, `warning`, `danger`, `info` (+ `-bg`) | `status.*` | Status text on pale tint backgrounds |

Rules:
- Colour always accompanies a text label and an icon. Status is never communicated by colour alone.
- Every new text/background pairing is added to `requiredContrastPairs` so the test measures it. A token name is not evidence of accessibility.
- Operational screens use flat backgrounds; luminous gradients are presentation-only.

## Typography

Inter (self-hosted via `@fontsource-variable/inter`) with system sans-serif fallback.

| Class | Size / line height | Use |
| --- | --- | --- |
| `text-page-title` | 28/36 | Page title |
| `text-panel-title` | 18/26 | Panel title |
| `text-card-title` | 16/24 | Card title |
| `text-body` | 16/24 | Body copy |
| `text-secondary` | 14/20 | Supporting copy |
| `text-meta` | 12/18 | Metadata, timestamps |

Weights: 400 regular, 500 medium, 600 semibold. Avoid thin weights in patient text.

## Layout, shape and motion

- Spacing on a 4 px base: 8, 12, 16, 24, 32, 48.
- Radii: `rounded-control` 8 px, `rounded-card` 12 px, `rounded-panel` 16 px.
- 1 px neutral borders; `shadow-overlay` for overlays only. No decorative 3D cards.
- Icons: Lucide outline at 20 px, 1.5 to 2 px stroke; label unfamiliar actions.
- Interactive targets at least 44 × 44 CSS px.
- Transitions 120 to 180 ms; `prefers-reduced-motion` is honoured globally. No animated urgency countdowns.

## Workspace

- ≥1280 px: three panels — Intake 28 %, Findings 44 %, Next steps 28 % — with 16 px gutters under a 64 px header.
- 768 to 1279 px: Intake and Findings visible; Next steps in a drawer.
- <768 px: Intake, Findings and Next steps views with preserved state. Test reflow at 320 CSS px.
- Urgency always appears above ordinary findings in every layout and never only inside a drawer.
- Navigation: Intake, Medicines, Doctors, Appointments. Profile menu: preferences, history, privacy controls, sign out.

## Voice and content

- Direct, respectful sentences. Say "Possible explanation" and "Based on the information provided"; never present an AI output as a confirmed diagnosis.
- State the action and timeframe before background explanation.
- Never promise recovery, hide uncertainty, exaggerate expertise, or use alarmist marketing in care workflows.
- Use specific action labels — Continue, Review answers, Find a doctor, Confirm appointment — not a generic Submit.
- Distinguish No, Unknown, Prefer not to answer and Not asked. A skipped answer is never a negative finding.
- Patient guidance and translations require named clinical author approval.

## Accessibility

Target WCAG 2.2 AA across complete patient and staff journeys: 4.5:1 normal text, 3:1 large text and UI focus indicators, visible focus, semantic headings, labelled inputs, error summaries, non-repetitive live-region announcements, 200 % zoom and reflow, VoiceOver and NVDA testing.
