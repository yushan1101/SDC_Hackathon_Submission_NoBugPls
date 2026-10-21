---
name: AiversePulse
description: Evidence-grounded reskilling assistant; a white page, one clear blue, few words at a readable size.
colors:
  accent-blue: "oklch(0.53 0.19 263)"
  accent-field: "oklch(0.55 0.17 258)"
  accent-soft: "oklch(0.955 0.028 262)"
  link-blue: "oklch(0.47 0.18 263)"
  paper-white: "oklch(1 0 0)"
  blue-grey-field: "oklch(0.968 0.007 255)"
  ink: "oklch(0.22 0.02 262)"
  ink-secondary: "oklch(0.44 0.02 262)"
  rule: "oklch(0.92 0.008 258)"
  rule-strong: "oklch(0.84 0.012 258)"
  navy-shell: "oklch(0.24 0.05 262)"
  shell-ink: "oklch(0.97 0.006 262)"
  shell-ink-secondary: "oklch(0.8 0.03 262)"
  ok: "oklch(0.47 0.11 150)"
  ok-soft: "oklch(0.95 0.035 150)"
  warn: "oklch(0.5 0.11 70)"
  warn-soft: "oklch(0.965 0.04 85)"
  danger: "oklch(0.5 0.18 28)"
  danger-soft: "oklch(0.955 0.03 28)"
  hr-ground: "oklch(0.975 0.005 258)"
typography:
  display:
    fontFamily: "EB Garamond, Garamond, Times New Roman, serif"
    fontSize: "clamp(52px, 8vw, 96px)"
    fontWeight: 500
    lineHeight: 0.98
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "EB Garamond, Garamond, Times New Roman, serif"
    fontSize: "clamp(34px, 3.6vw, 48px)"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-0.015em"
  page-title:
    fontFamily: "EB Garamond, Garamond, Times New Roman, serif"
    fontSize: "clamp(40px, 5.4vw, 64px)"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  lede:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(18px, 1.6vw, 21px)"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  prose:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.4
  floor:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.45
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    fontFeature: "\"tnum\" 1"
  hr-body:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  pill: "999px"
  card-xl: "32px"
  card-xl-mobile: "26px"
  drop: "24px"
  composer: "22px"
  panel: "18px"
  tile: "16px"
  inset: "14px"
  base: "10px"
spacing:
  gap: "8px"
  sm: "12px"
  md: "20px"
  lg: "28px"
  xl: "44px"
  section: "clamp(72px, 10vw, 128px)"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "46px"
  button-primary-hero:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.pill}"
    padding: "0 28px"
    height: "54px"
  button-outline:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "46px"
  button-on-field:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.accent-blue}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "46px"
  button-small:
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "38px"
    typography: "{typography.label}"
  chip:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.composer}"
    padding: "8px 16px"
    typography: "{typography.label}"
  input:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "10px 14px"
    height: "46px"
  way-card:
    backgroundColor: "{colors.blue-grey-field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card-xl}"
    padding: "clamp(28px, 3.4vw, 44px)"
  way-card-lead:
    backgroundColor: "{colors.accent-field}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.card-xl}"
    padding: "clamp(28px, 3.4vw, 44px)"
  answer-option:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "12px 18px"
    height: "64px"
  tag:
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    typography: "{typography.floor}"
  nav-link:
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  nav-link-active:
    backgroundColor: "{colors.blue-grey-field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
---

# Design System: AiversePulse

## Overview

**Creative North Star: "The Open Page"**

A white page that says one thing at a time, in a voice large enough to read from across the desk. Each block carries one serif line, one sentence and one action. The interface trusts big type and empty white to do the work that kickers, numbered steps, badge clusters and floating fake-UI labels do on a crowded SaaS landing page. One clear blue marks everything you can act on. The JobSmart owl, recoloured into that blue, is the only character on the page.

The public site breathes. Sections sit 72 to 128px apart, cards are large and soft-cornered, and the smallest public text is 14px. The demos inside the cards show the real mechanism at reading size: an actual quiz item, a quoted résumé line turning into an ESCO skill, the 30/60/90 plan. They are not decoration. The HR console (Enterprise) uses the same palette and the same Geist UI face, but it stays dense: 15px body, Geist for headings too, and tables at 14px.

Confirmed rejections come from the user and PRODUCT.md: purple gradients, glassmorphism, glowing cards, warm cream paper grounds, and eyebrow kickers above section headings.

**Key Characteristics:**
- White ground, one blue hue (263) for every action, selection, focus ring and link.
- EB Garamond 500 for headlines and big display numbers. Geist for everything you operate.
- Pill controls throughout. Containers get rounder as they get bigger, up to 32px.
- Flat at rest. Cards lift slightly on hover, and the owl casts a soft shadow.
- Public text never goes below 14px.

## Colors

A cool, near-monochrome page of white, blue-grey and navy ink, with one saturated blue doing all the signalling.

### Primary
- **Clear Signal Blue** (accent-blue): primary buttons, the selected segment, focus outlines, caret and form accent colour, the cite marker, progress fill, and the "on" key in the quiz demo. White text on it passes at 5.6:1.
- **Lead Card Blue** (accent-field): reserved for the one lead card (Quick Match) on the home page. It is a full field of colour with white body text (5.1:1), and its button inverts to white with blue text.
- **Blue Wash** (accent-soft): text-selection highlight, input focus halo, `mark` highlights inside demo lines, and the hover state of cite markers.
- **Link Blue** (link-blue): inline links. It is one step darker than the action blue so that links still read on pale fields.

### Neutral
- **Paper White** (paper-white): the page ground, the header bar and button fills on the lead card.
- **Blue-Grey Field** (blue-grey-field): the secondary cards, nav hover and current-page pill, and table header rows.
- **Ink** (ink): body text, the dark skill pill in the résumé demo, and toasts.
- **Secondary Ink** (ink-secondary): supporting sentences, nav links at rest, and notes (7.4:1 on white).
- **Hairline** (rule) and **Firm Hairline** (rule-strong): dividers, and outlines on outline buttons, inputs and chips.
- **Navy Shell** (navy-shell, with shell-ink and shell-ink-secondary): the sign-in form panel only.
- **HR Ground** (hr-ground): a slightly cooler off-white behind Enterprise panels, which sit on white surfaces.

### Status
- **ok / warn / danger**, each with a soft partner tint, used only for real state: approved, flagged and rising/falling trends. Enterprise shifts ok to hue 155 and danger to hue 40.

### Named Rules
**The One Blue Rule.** Every interactive or selected thing is the same blue (hue 263). No second accent hue, and no purple anywhere.

**The One Field Rule.** The saturated blue field appears once per screen, on the lead card. Every other card is blue-grey on white.

## Typography

**Display Font:** EB Garamond 500/600 (fallback Garamond, Times New Roman, serif)
**Body Font:** Geist 400/500/600 (fallback system-ui, Segoe UI, sans-serif)
**Label/Mono Font:** Geist Mono 400/500, used for numbers, IDs and keycaps, always with tabular figures

**Character:** a bookish, slightly literary serif for the things the page *says*, over a clean modern grotesque for the things you *do*. The contrast between them is the whole hierarchy.

### Hierarchy
- **Display** (EB Garamond 500, clamp 52–96px, 0.98, -0.025em, max 12ch): the home hero line only.
- **Headline** (EB Garamond 500, clamp 34–60px, 1.08, -0.015em): card headings, section closers ("The world of work keeps moving."), quiz questions (clamp 30–44px).
- **Page title** (EB Garamond 500, clamp 40–64px, 1.05): the opening line on each app screen.
- **Title** (Geist 600, 18–22px, -0.01em): every h3 and h4 on public screens, such as block headings and plan phases.
- **Lede** (Geist 400, 18–21px, 1.5, max 38ch): the single supporting sentence under a headline, in secondary ink.
- **Body** (Geist 400, 17px, 1.55): the default. Streamed report prose is 18px at 1.7 line height with a 68ch measure.
- **Label** (Geist 500, 15px): buttons (17px in the hero), chips, field labels, notes, toasts.
- **Floor** (Geist 500 or Geist Mono, 14px): tags, citations, chart text, legends, table headers, IDs. Nothing on a public screen is smaller.

Display numerals inside demos ("Days 1–30") use the serif at 22–30px. The wordmark is EB Garamond 600 at 24px (22px on mobile).

### Named Rules
**The Fourteen Floor Rule.** No text on a public screen is set below 14px. Secondary text is 14–15px, never 11–13px. Enterprise may drop to 12–13px for dense tables and rails.

**The Serif Says, Sans Does Rule.** EB Garamond is for h1, h2 and display numerals. Everything you click, read in a table or scan as a label is Geist. Enterprise sets headings in Geist too.

## Layout

The page is a single centred column at most 1240px wide, with 20px side gutters. The home hero is centred: the owl at 168px, the h1, one sentence, and a row of three pills (blue primary plus two outlines) with 12px gaps. On mobile the pills stack to full width. Below the hero the cards sit in a two-column grid with 20px gaps. The third card ("way-plan") spans both columns and splits internally at 0.85fr/1.4fr. Below 900px everything collapses to one column. Home sections sit `clamp(72px, 10vw, 128px)` apart, and cards are 540px tall at minimum on desktop so the two leads match.

App screens use the same 1240px frame. The build flow uses a 220px sticky step list beside a 720px form column. The report uses a 760px thread with a 320px source rail. The header is a 68px white sticky bar (60px under 700px) with a hairline bottom border. A bottom tab bar takes over navigation on small screens.

Breakpoints observed: 699px (mobile), 767px, 899px (cards stack), 1099px and 1199px (app rails collapse).

## Elevation & Depth

The pages are flat at rest. Depth comes from tonal fields (blue-grey cards on white, white demo inserts on those cards) rather than from shadows. The shadows that do exist are soft, wide, negative-spread, and tinted navy or blue, never grey-black.

### Shadow Vocabulary
- **Action lift** (`box-shadow: 0 6px 16px -6px oklch(0.53 0.19 263 / 0.55)`): under the primary blue pill only.
- **Card hover lift** (`box-shadow: 0 28px 48px -30px oklch(0.25 0.06 262 / 0.5)` with `translateY(-4px)`): home cards on hover, only on hover-capable devices and only when reduced motion is not requested.
- **Insert** (`box-shadow: 0 12px 28px -16px oklch(0.25 0.04 262 / 0.35)`): a white demo insert sitting on a blue-grey card.
- **Composer** (`box-shadow: 0 12px 32px -12px oklch(0.25 0.04 262 / 0.22)`): the floating question composer on the report screen.
- **Owl drop** (`filter: drop-shadow(0 18px 24px oklch(0.4 0.12 262 / 0.18))`): the hero owl.

### Named Rules
**The Flat-Until-Touched Rule.** Cards have no shadow at rest. Lift is a response to hover, or it marks a white insert sitting on a field.

## Shapes

Controls are pills. Every button, chip cluster, segmented control, nav link, tag, skill chip and progress bar is fully rounded (999px). Multi-line chips relax to 22px so wrapped text stays legible. Containers scale their radius with their size: 32px for the big home cards (26px on mobile), 24px for the résumé drop zone, 22px for the composer, 18–20px for panels and report blocks, 16px for answer options, occupation cards and scenario tiles, and 14px for small inserts, the trace drawer and toasts. Inputs keep a 10px radius. Citation markers are 6px. Borders are 1px hairlines and are never doubled.

**The Bigger-Is-Rounder Rule.** The larger the surface, the softer its corner. Controls are always pills.

## Components

### Buttons
Calm, round and unmistakable.
- **Shape:** full pill (999px), 46px tall with 22px side padding, Geist 500.
- **Primary:** blue fill, white text, sitting on the action lift shadow. On hover the blue darkens by 10% (mixed toward black in OKLCH). Active state nudges down 1px.
- **Outline:** white with a firm hairline border. On hover the border turns to ink.
- **On the lead field:** white fill with blue text. On hover the fill becomes a faint blue-white.
- **Hero size:** 54px tall, 28px side padding, 17px text. **Small:** 38px tall, 15px text.
- **Ghost:** no border. A blue-grey fill appears on hover.
- **Focus:** 2px blue outline with a 2px offset, on every focusable element.
- Icons inside buttons are 16–18px line icons drawn in SVG (lib.js ICONS), placed after the label as a send arrow.

### Chips and Tags
- **Chips** are pills at least 40px tall with 15px text and a firm hairline border. On hover the border turns to ink. Wrapped chips use a 22px radius.
- **Tags** are 14px Geist 500 pills in sentence case. Status tags take the status colour on its soft tint.
- **Skill chips** are 15px pills.

### Cards / Containers
- **Way cards:** 32px corners, `clamp(28px, 3.4vw, 44px)` padding, 540px minimum height. Content is spread top to bottom: heading and sentence, then the demo, then the button. Background is blue-grey, or the blue field for the lead card.
- **Inserts:** white, 18px corners, 20–22px padding, carrying the insert shadow.
- **App blocks:** hairline border on white, 16–20px corners.

### Inputs / Fields
- **Style:** white fill, firm hairline border, 10px radius, 46px tall, 10px/14px padding. Labels are 15px.
- **Focus:** the border turns blue, plus a 3px blue-wash halo.
- **Sign-in variant:** translucent white on the navy shell.

### Navigation
- **Header:** a white 68px bar with a hairline bottom edge. The EB Garamond wordmark sits on the left. Nav links are 16px secondary ink in pills. Hover and the current page both get a blue-grey pill with ink text. On the right sit one outline "Sign in" and one blue "Get started". On mobile the bar is 60px, the sign-in link hides, and a bottom tab bar (14px labels) takes over.

### Quiz answer option
A 64px-tall tile with 16px corners and 18px text, with a 34px keycap (10px radius, Geist Mono 14px) leading. The selected option fills white on the blue field in the demo and blue-washed in the live quiz.

### The Owl
The JobSmart owl is the only character in the system. It is recoloured in both products with `filter: hue-rotate(-32deg) saturate(1.08)` on `.owl-svg` so it sits in the blue. It is 168px in the hero, 120px in the quiz and 44px beside report turns. Only one owl appears on the home screen, so the header owl-status hides there. It reflects real agent state and is never decorative.

## Do's and Don'ts

### Do:
- **Do** give each block one serif line, one sentence and one action.
- **Do** keep every public text at 14px or above. Supporting text is 15–18px.
- **Do** use the one blue (hue 263) for every action, selection, focus ring and progress fill.
- **Do** make every control a pill, and round containers more as they grow (up to 32px).
- **Do** show the real mechanism inside cards (real quiz items, quoted résumé lines, real plan phases) at reading size.
- **Do** carry depth with tonal fields (white on blue-grey, blue-grey on white), and add lift only on hover.
- **Do** keep Enterprise on the same palette and Geist, at a dense 15px base.

### Don't:
- **Don't** put eyebrow kickers or uppercase letter-spaced labels above headings.
- **Don't** number sections or features decoratively (01/02/03). Numbers appear only when they are data, like "Days 1–30".
- **Don't** float fake-UI labels or badge clusters around cards. Pills are controls or real data, never ornament.
- **Don't** introduce a second accent hue, purple, gradients, glassmorphism or glowing cards.
- **Don't** use a warm cream or paper-tinted ground. The page is pure white.
- **Don't** use the saturated blue field for more than the one lead card on a screen.
- **Don't** set h3/h4 or UI labels in the serif on public screens, or any heading in the serif in Enterprise.
- **Don't** use glyph or emoji icons. Icons are drawn SVG line icons from the shared set.
