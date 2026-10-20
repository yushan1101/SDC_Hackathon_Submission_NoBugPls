---
name: Field Guide & Companion
colors:
  surface: '#fef9ee'
  surface-dim: '#dedacf'
  surface-bright: '#fef9ee'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f8f3e9'
  surface-container: '#f2ede3'
  surface-container-high: '#ece8dd'
  surface-container-highest: '#e6e2d8'
  on-surface: '#1d1c15'
  on-surface-variant: '#5a413a'
  inverse-surface: '#32302a'
  inverse-on-surface: '#f5f0e6'
  outline: '#8e7068'
  outline-variant: '#e2bfb5'
  surface-tint: '#b12e00'
  primary: '#ad2c00'
  on-primary: '#ffffff'
  primary-container: '#d14316'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb5a0'
  secondary: '#605e59'
  on-secondary: '#ffffff'
  secondary-container: '#e4dfd8'
  on-secondary-container: '#65625d'
  tertiary: '#2347e7'
  on-tertiary: '#ffffff'
  tertiary-container: '#4564ff'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbd1'
  primary-fixed-dim: '#ffb5a0'
  on-primary-fixed: '#3b0900'
  on-primary-fixed-variant: '#872100'
  secondary-fixed: '#e7e2db'
  secondary-fixed-dim: '#cac6bf'
  on-secondary-fixed: '#1d1c17'
  on-secondary-fixed-variant: '#494741'
  tertiary-fixed: '#dee0ff'
  tertiary-fixed-dim: '#bac3ff'
  on-tertiary-fixed: '#00105a'
  on-tertiary-fixed-variant: '#0030c8'
  background: '#fef9ee'
  on-background: '#1d1c15'
  surface-variant: '#e6e2d8'
typography:
  headline-xl:
    fontFamily: Domine
    fontSize: 44px
    fontWeight: '700'
    lineHeight: 52px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Domine
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Domine
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Domine
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Domine
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Domine
    fontSize: 19px
    fontWeight: '700'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Public Sans
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Public Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 23px
  body-sm:
    fontFamily: Public Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 19px
  label-md:
    fontFamily: IBM Plex Sans
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.04em
  label-sm:
    fontFamily: IBM Plex Sans
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.06em
  data-tabular:
    fontFamily: IBM Plex Sans
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.01em
spacing:
  gutter: 1.5rem
  gutter-sm: 1rem
  margin: 2.5rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system expresses the tactile precision, authority, and quiet confidence of an archival field manual, enriched by modern assistive intelligence. Built for professional transition and reskilling, it discards decorative tech tropes—such as neon gradients, heavy dropshadows, and hyper-saturated surfaces—in favor of a disciplined, printed-paper sensibility. 

The emotional signature is steady, literate, and reassuring. Career transformation demands cognitive clarity; the interface treats information as durable record-keeping rather than ephemeral software state. 

### Visual Movement
- **Archival Editorial & Neo-Rationalist Utility**: Warm tactile paper surfaces, razor-thin structural rules, dense data density, and purposeful ink typography.
- **Companion-Assisted Wayfinding**: A discrete, restrained micro-animated Owl companion serving as an active guide, shifting through functional states without descending into cartoonish novelty.

## Colors

The palette operates under strict hierarchical constraints. Backgrounds emulate heavy uncoated stock, text embodies physical printer's ink, and color is applied solely to indicate state, pathfinding, or immediate operational priority.

### Surface & Ink Hierarchy
- **Canvas / Paper**: `#F4F1EA` (Primary background across full viewports)
- **Paper Substrate / Well**: `#EBE6DC` (Inset table headers, muted card wells, nested containers)
- **Ink Primary**: `#14130F` (Maximum contrast, headline, body text, structural rules)
- **Ink Secondary**: `#5C5A52` (Metadata, breadcrumbs, supporting notes, inactive borders)
- **Ink Muted / Ghost**: `#8A877D` (Placeholders, disabled copy, structural grid guides)
- **Hairline Rule**: `#D9D4C7` (Precise 1px structural demarcations)

### Signal & Feedback Colors
- **Signal Vermilion** (`#D9481C`): The primary visual beacon. Reserved strictly for primary action commits, unread metric pulses, active focus rings, and milestone progress points.
- **Verification Green** (`#2E6B3F`): Career milestone reached, skills verified, application approved.
- **Advisory Amber** (`#A86A00`): Skill gap identified, credential expiring, pacing notice.
- **Analytical Blue** (`#2448E8`): Deep profile intake, labor market query running, data inspection.
- **Critical Flag** (`#C2410C`): Immediate prerequisite mismatch, missing submission item.

## Typography

The typographic hierarchy establishes clear structural tension between literary weight and technical objectivity:
- **Headings (Domine)**: Selected for its authoritative, sturdy, classic editorial qualities. Used for page-level concepts, career trajectory milestones, and module framing. Always set with compact line heights and deliberate slight negative tracking.
- **Body & Interface (Public Sans)**: Clear, accessible, institutional sans-serif. Delivers maximum optical balance on long-form competency summaries, role descriptions, and curriculum plans.
- **Tabular Figures, Metadata, and Labels (IBM Plex Sans / Monospace fallback)**: Strict data alignment for wage tiers, completion ratios, dates, skill codes, and system telemetry. Ensure `font-variant-numeric: tabular-nums` is active on all numerical arrays.

## Layout & Spacing

The layout philosophy mirrors an open broadsheet ledger. A strict baseline rhythm of `8px` governs all vertical movement, while column borders provide physical enclosure.

### Grid Anatomy
- **Desktop (1200px and above)**: 12-column grid, `margin`: `2.5rem` (40px), `gutter`: `1.5rem` (24px). Max container width constrained to `1360px` for optimal typographic line-length control.
- **Tablet (768px – 1199px)**: 8-column grid, `margin`: `2rem` (32px), `gutter`: `1.25rem` (20px).
- **Mobile (below 768px)**: 4-column grid, `margin-mobile`: `1.25rem` (20px), `gutter-sm`: `1rem` (16px).

### Section Framing
Layout segments are divided by explicit 1px rules (`#D9D4C7`) rather than empty whitespace gaps. Columns and rows lock together into contiguous panels reminiscent of early twentieth-century census charts and navigational registers.

## Elevation & Depth

This design system operates without drop shadows, colored ambient glows, or faux-dimensional lighting. Depth is produced purely through structural containment, border stacking, and surface tint variation.

### Elevation Principles
- **Tier 0 (Base Canvas)**: `#F4F1EA`. The uniform underlying sheet.
- **Tier 1 (Framed Enclosure / Cards)**: `#F4F1EA` bound by a 1px `#D9D4C7` border.
- **Tier 2 (Recessed Well / Sub-data Panels)**: `#EBE6DC` inset flat against the canvas. Used for terminal logs, citation notes, and input backgrounds.
- **Tier 3 (Overlay Modals / Flyouts)**: `#F4F1EA` framed by a 1px `#14130F` crisp border, positioned over an ink backdrop fill (`#14130F` with 30% alpha, no blur).
- **Focus / Activation Depth**: Represented by a double hairline border: 1px `#F4F1EA` inner spacer, 2px `#D9481C` outer solid frame.

## Shapes

The geometry of the system is sharp and architectural. 

- **Primary Structure & Cards**: Rigid `0px` border radius across all main cards, data tables, structural banners, and modals.
- **Interactive Controls (Exceptions)**: Buttons, segmented pills, and form inputs employ a minute `2px` border radius to signal tactile responsiveness without compromising the paper-cut grid discipline.
- **Borders & Dividers**: Fixed at exactly 1px solid stroke width (`#D9D4C7` default, `#14130F` active/selected).

## Components

### Buttons
- **Primary**: Background `#D9481C`, foreground `#F4F1EA`, radius 2px, height 40px, padding `0 20px`. Typography: `label-md`. Active click state: `#B83A14`. Focus outline: 2px offset rule.
- **Secondary**: Background `#F4F1EA`, border 1px solid `#14130F`, text `#14130F`. Hover: Background `#EBE6DC`.
- **Tertiary / Utility**: Ghost background, text `#5C5A52`, underline on hover, zero horizontal padding.

### Cards & Field Registers
- Default card: Background `#F4F1EA`, 1px solid `#D9D4C7`, radius 0px, padding `space-lg`.
- Top-accent card (active trajectory item): Standard card topped with a 3px solid horizontal band of `#D9481C`.
- Inset card: Background `#EBE6DC`, no border, padding `space-md`.

### Input Fields & Controls
- **Inputs**: Height 44px, radius 2px, background `#F4F1EA`, border 1px solid `#D9D4C7`. Text `#14130F`, placeholder `#8A877D`. Focused: Border 1.5px solid `#D9481C`.
- **Checkboxes & Radios**: 16px square (or circle), 1px solid `#14130F`, background `#F4F1EA`. Selected state: `#D9481C` fill with `#F4F1EA` checkmark. Sharp, high contrast.
- **Status Chips**: Compact height (24px), border 1px solid `#D9D4C7`, background `#EBE6DC`. Left edge features an uninterrupted 6px circular dot mapped to the respective status token (`#2E6B3F`, `#A86A00`, `#2448E8`, `#C2410C`).

### Companion Token: The JobSmart / AiversePulse Guide
An architectural, geometric owl glyph rendered in vector strokes (1.5px stroke weight, `#14130F`). It features an expressive eye aperture and discrete geometric sub-elements that communicate state via restrained CSS micro-animations:
- **Idle**: Periodic slow eye blink (3.5s interval), soft chest stroke pulsation.
- **Listening / Intake**: Ear feather tufts elevate 2px; subtle tilt (3deg); continuous gentle horizontal scan.
- **Searching / Analyzing**: Pupils sweep left-to-right (`#2448E8` tinted pupils), segmented mono coordinate tick beside the icon.
- **Job Matched / Approved**: Wings fold snug; crest flashes `#2E6B3F`; one deliberate confirming nod.
- **Update / Draft**: Monocle or lower perimeter ring rotates 180 degrees slowly; pencil hairline marker displays underneath.
- **Reminder**: Distinctive 4-beat perch shift; small alert badge (`#A86A00`) hovers over right brow.
- **Celebrating**: Single crisp hop (4px elevation); vermilion corona pulse radiates once from the perimeter.