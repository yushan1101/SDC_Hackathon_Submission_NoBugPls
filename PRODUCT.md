# Product

## Register

product

## Users
- **Public users (AiversePulse):** individual learners and employees planning their own reskilling, often on a phone in a spare moment or at a laptop in the evening. Job: "tell me which skills the market asks for, how far I am, and give me a realistic 90-day plan I control."
- **HR advisors (AiversePulse Enterprise):** workforce-planning staff reviewing a team of pseudonymous employees at a desk, in long focused sessions. Job: "see where the team needs training, review each AI-drafted plan, fix it, and approve it with an audit trail." Decision support only; never hiring/firing.

## Product Purpose
A multi-agent, evidence-grounded reskilling assistant. Every claim cites dated public sources (2023 job ads, O*NET 31.0); forecasts are labelled historical backtests; plans stay drafts until a named human approves them. Success = a user trusts the plan because they can see where every number came from, and an HR advisor can review a team in minutes.

## Brand Personality
Precise, candid, companionable. The interface speaks like a knowledgeable field guide; the JobSmart owl adds warmth and shows what the agents are doing right now, without turning the product into a toy. Public side: calm and editorial. Enterprise side: dense and operational.

## Anti-references
- Generic AI SaaS: purple gradients, glassmorphism, glowing cards, "hero + three feature cards", big-number KPI templates.
- Warm cream "paper" backgrounds and eyebrow-kicker-on-every-section scaffolding.
- Static dashboards that dump every chart at once; the report should arrive like a conversation.
- Invented metrics or sources (no fake confidence scores, R², vendor names that are not real data sources).

## Design Principles
1. **Show the evidence, not the confidence.** Citations, dates and limitations are first-class UI, never footnotes.
2. **The work is visible.** Agent steps stream in real time; the owl reflects the true system state, never decoration.
3. **Humans hold the pen.** Approval is explicit, reversible only by a new version, and always shows who did what.
4. **Two audiences, two densities.** Public screens breathe; enterprise screens pack information for expert scanning.
5. **Honest numbers.** Backtests are labelled as such; uncertainty bands are shown wherever a forecast is.

## Accessibility & Inclusion
WCAG 2.2 AA: 4.5:1 text contrast, full keyboard operation, visible focus, labelled controls and live regions for streamed content, 44px touch targets on mobile, and all owl/stream motion replaced by instant transitions under `prefers-reduced-motion`.
