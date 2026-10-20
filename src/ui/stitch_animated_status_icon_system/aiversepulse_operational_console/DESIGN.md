---
name: AiversePulse Operational Console
colors:
  surface: '#f9f9ff'
  surface-dim: '#d8dae1'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3fb'
  surface-container: '#ecedf5'
  surface-container-high: '#e6e8ef'
  surface-container-highest: '#e1e2e9'
  on-surface: '#191c21'
  on-surface-variant: '#444656'
  inverse-surface: '#2e3036'
  inverse-on-surface: '#eff0f8'
  outline: '#747687'
  outline-variant: '#c4c5d8'
  surface-tint: '#274aea'
  primary: '#002ec4'
  on-primary: '#ffffff'
  primary-container: '#2448e8'
  on-primary-container: '#ced3ff'
  inverse-primary: '#bac3ff'
  secondary: '#565f6d'
  on-secondary: '#ffffff'
  secondary-container: '#dae3f4'
  on-secondary-container: '#5c6573'
  tertiary: '#832200'
  on-tertiary: '#ffffff'
  tertiary-container: '#ac3000'
  on-tertiary-container: '#ffcabb'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dee0ff'
  primary-fixed-dim: '#bac3ff'
  on-primary-fixed: '#00105a'
  on-primary-fixed-variant: '#0030c8'
  secondary-fixed: '#dae3f4'
  secondary-fixed-dim: '#bec7d7'
  on-secondary-fixed: '#131c28'
  on-secondary-fixed-variant: '#3e4755'
  tertiary-fixed: '#ffdbd1'
  tertiary-fixed-dim: '#ffb59f'
  on-tertiary-fixed: '#3a0a00'
  on-tertiary-fixed-variant: '#852300'
  background: '#f9f9ff'
  on-background: '#191c21'
  surface-variant: '#e1e2e9'
typography:
  title-md:
    fontFamily: IBM Plex Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  title-sm:
    fontFamily: IBM Plex Sans
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.005em
  body-default:
    fontFamily: IBM Plex Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  body-semibold:
    fontFamily: IBM Plex Sans
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 20px
  label-default:
    fontFamily: IBM Plex Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  caption-caps:
    fontFamily: IBM Plex Sans
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  code-xs:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
  data-tabular:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system delivers a high-density, precise, and utilitarian operating environment engineered for workforce planners, enterprise operations leads, and HR data analysts. It avoids decorative distraction, marketing flourishes, and soft consumer cues in favor of maximum legibility, informational hierarchy, and ruthless spatial efficiency—echoing the ergonomics of high-speed trading platforms and developer consoles.

Key aesthetic principles:
- **Precision over Decoration:** Interfaces prioritize raw information throughput. No gradients, ornamental illustrations, or expressive display typography.
- **Micro-Structured Hierarchy:** Layouts rely on structural borders, micro-spacing, and typographic weight shifts rather than elevation or heavy backdrops.
- **Calm Operational Demeanor:** Neutral surfaces keep visual noise minimal during continuous, multi-hour analytical sessions. Contrast is used strategically to isolate operational status and primary workflows.

## Colors

The color architecture is built around functional utility:
- **Canvas (`#F6F7F9`) & Surface (`#FFFFFF`):** High-clarity, cool-neutral backdrop hierarchy separating global layouts from active working panels.
- **Text Primary (`#0E1116`) & Secondary (`#5B6472`):** Delivers strict WCAG AAA contrast ratios for body copy and data tables, while keeping supporting metadata non-intrusive.
- **Rules & Dividers (`#E3E6EB`):** Crisp 1px structural framing across data grids, headers, and split-panes.
- **Single Accent "Cobalt" (`#2448E8`):** Reserved exclusively for active selection states, high-priority operational buttons, and focused inputs.
- **Semantic Status Signals:** Function-led colors calibrated for clarity:
  - **Approved:** `#1F7A4D` (deep botanical green)
  - **Draft / Inactive:** `#5B6472` (slate neutral)
  - **Flagged / Warning:** `#C2410C` (sharp amber-ochre)

## Typography

Typography prioritizes tabular clarity and high scannability:
- **IBM Plex Sans** serves as the primary system typeface. Standard body copy, navigation targets, and input labels sit firmly at `13px` with a `20px` line-height for clean horizontal cadence.
- Maximum heading size is capped at `18px/24px` semibold (`title-md`) to eliminate marketing-style scale jumps and preserve screen density.
- **Monospace Usage:** All unique IDs, employee codes, headcount totals, monetary metrics, currency units, timestamps, and shortcut cues must utilize `font-variant-numeric: tabular-nums` or the monospaced font token to ensure vertical numerical alignment across tables and audit logs.
- **Micro-Caps:** Status labels and categorical badges use small-caps styling at `11px` with `+0.04em` tracking for rapid peripheral identification.

## Layout & Spacing

The layout is anchored to a high-density, fluid operational model:
- **Workbench Canvas:** Full viewport height layout (`100vh`) with fixed multi-pane sidebars and scrollable independent panel regions. Grid systems adjust between 12-column analytical layouts and flexible split-views (40% table / 60% inspector pane).
- **Rhythm:** The baseline rhythm operates on strict `4px` increments (`space-xs: 4px`, `space-sm: 8px`, `space-md: 12px`, `space-lg: 16px`). Micro-alignments utilize `2px` (`space-2xs`) offsets for visual centering of monospaced glyphs and indicators.
- **Breakpoints:**
  - **Desktop Primary (≥1440px):** Uncollapsed sidebars, full split views, full table visibility without column truncation.
  - **Medium Workstation (1024px – 1439px):** Inspector panels switch to slide-out drawers; lower-priority table columns collapse into overflow menus.
  - **Mobile/Narrow View (<1024px):** Read-only audit log views; operations require standard tablet/desktop viewport widths.

## Elevation & Depth

This design system deliberately eschews drop shadows to maintain technical precision and flat-plane speed:
- **No Cast Shadows:** Floating drop shadows, diffuse glows, and colored ambient shadows are prohibited across all standard states.
- **Rule-Based Delimitation:** Elevation and visual stacking are established solely via `1px solid #E3E6EB` hairline borders.
- **Header Anchoring:** The sticky top navigation and pinned table headers feature a single bottom hairline rule (`1px solid #E3E6EB`) rather than an elevation shadow.
- **Overlay Modals & Command Palettes:** Modals and prompt dialogs use an unblurred 1px outer rule with a solid neutral boundary (`#0E1116` at 12% opacity or a sharp hairline border) supported by a dim neutral veil (`rgba(14, 17, 22, 0.40)`).

## Shapes

The design system uses a strict micro-radius discipline:
- **Corner Radius:** All active elements, buttons, inputs, dropdown menus, segmented controls, and dialog frames enforce a uniform `2px` corner radius. Full pill radii and circular buttons are strictly prohibited.
- **Rule Lines:** Structural lines, dividers, and component borders maintain a persistent `1px` stroke width.
- **Sharp Utility:** The strict geometric corners preserve screen area, prevent pixel interpolation blurring on non-retina workstation monitors, and reinforce the technical, console-first atmosphere.

## Components

### Buttons & Actions
- **Primary:** Background `#2448E8`, text `#FFFFFF`, border none, height `28px` (compact) or `32px` (default). Padding: `0 10px`. Hover: `#1B3BB8`.
- **Secondary / Ghost:** Background `transparent`, border `1px solid #E3E6EB`, text `#0E1116`. Hover: background `#F6F7F9`.
- **Keyboard Shortcuts:** Actions supporting quick access feature right-aligned monospace hotkey hints (e.g., `code-xs`, text `#5B6472`).

### Data Tables (High Density)
- **Rows:** Uniform `32px` height, single-line text with zero vertical padding clipping.
- **Zebra Striping:** Disabled. Background is uniformly `#FFFFFF`.
- **Row Interaction:** On cursor hover, tint entire row with `#F6F7F9` (100% opacity background transition, instant 0ms).
- **Headers:** Background `#F6F7F9`, height `28px`, uppercase `caption-caps` font, bottom border `1px solid #E3E6EB`.
- **Alignment:** Alphanumeric left-aligned; IDs, dates, and quantitative headcount metrics right-aligned using tabular monospace typography.

### Status Pills
- Micro-compact components (`18px` height, `2px` radius).
- Styling uses small-caps uppercase font (`caption-caps`).
- No solid color fills. Background is `#FFFFFF` with a `1px` outline tinted to the semantic color:
  - **Approved:** Border `#1F7A4D`, text `#1F7A4D`.
  - **Draft:** Border `#E3E6EB`, text `#5B6472`.
  - **Flagged:** Border `#C2410C`, text `#C2410C`.

### Segmented Control
- Height `28px`, container background `#F6F7F9`, border `1px solid #E3E6EB`, padding `2px`.
- Segments: text `12px/16px`, color `#5B6472`.
- Active segment: background `#FFFFFF`, text `#0E1116`, border `1px solid #E3E6EB`, font weight `600`.

### Command Palette (⌘K)
- Centered modal anchored at top 15% of viewport, width `560px`.
- Input field: `36px` height, borderless, font `14px`, auto-focused, with `#5B6472` hint placeholder.
- Trailing shortcut badge: `2px` radius container, `code-xs` text reading `ESC` and `⌘K`.
- Results list: `30px` per entry, selection highlight `#2448E8` background with `#FFFFFF` text.

### Toast Notifications
- Placed bottom-right, offset `16px`.
- Flat surface `#FFFFFF`, border `1px solid #0E1116`, radius `2px`, no drop shadow.
- Leading icon or text prefix indicating status, inline action link in Cobalt `#2448E8`.

### Confirmation Dialog
- Width `400px`, background `#FFFFFF`, border `1px solid #E3E6EB`.
- Title `15px` semibold, body `13px` muted secondary text.
- Footer actions right-aligned with `8px` gap: Cancel (Secondary) and Confirm (Primary or Destructive `#C2410C`).

### File Dropzone & Validation Panel
- Dropzone: `1px dashed #E3E6EB`, background `#F6F7F9`, padding `24px`. Active drag state switches border to `1px dashed #2448E8` and background to `#FFFFFF`.
- Validation Drawer/List: When parsing errors occur, renders an attached data block directly below the dropzone. Rows use `code-sm` font, displaying line number `[L:244]` in `#5B6472`, and the localized syntax or schema error in `#C2410C`.