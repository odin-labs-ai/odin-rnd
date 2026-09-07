---
name: Odin R&D
description: An open software workshop expressed through machinery, blueprints, and dated evidence.
colors:
  ground: "#101716"
  panel: "#16201e"
  blueprint: "#18393d"
  paper: "#f0f0df"
  steel: "#a4b3ad"
  cyan: "#82b3c2"
  orange: "#ff7a45"
  rule: "#3a4944"
typography:
  display:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "clamp(84px,8.9vw,143px)"
    fontWeight: 700
    lineHeight: 0.87
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "clamp(46px,5.3vw,76px)"
    fontWeight: 700
    lineHeight: 0.97
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.15
  body:
    fontFamily: "Barlow, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  article:
    fontFamily: "Barlow, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.08em"
rounded:
  square: "0"
  circular: "50%"
spacing:
  gutter: "4.2%"
  gutter-mobile: "6%"
  section: "112px"
  section-mobile: "66px"
  bench-inset: "30px 40px"
  bench-inset-mobile: "23px 18px"
components:
  button-primary:
    backgroundColor: "{colors.orange}"
    textColor: "{colors.ground}"
    rounded: "{rounded.square}"
    padding: "15px 20px"
  button-primary-hover:
    backgroundColor: "{colors.paper}"
  button-outline:
    textColor: "{colors.paper}"
    rounded: "{rounded.square}"
    padding: "7px"
  station:
    textColor: "{colors.paper}"
    rounded: "{rounded.square}"
    padding: "13px 5px"
  station-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ground}"
  experiment-choice:
    textColor: "{colors.paper}"
    rounded: "{rounded.square}"
    padding: "23px 24px"
  experiment-choice-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ground}"
  workbench:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.square}"
  drawing-board:
    backgroundColor: "{colors.blueprint}"
    padding: "48px 50px 24px"
---

# Design System: Odin R&D

## Overview

**Creative North Star: "The Open Factory Floor"**

Odin R&D feels like an accessible research workshop: dark machinery, chalk lettering, safety-orange wayfinding, and engineering drawings carrying real identifiers. Exact authored geometry gives the software-factory metaphor a physical presence. The atmosphere is industrial and deliberate, with enough space for the reader to understand the work.

The system alternates large condensed statements with precise, ruled records. Long project and journal rows carry content; bounded panels serve experiment inspection and blueprint material. The confirmed direction rejects a neon dashboard and an interchangeable marketing-card grid. It does not require every future surface to repeat the entrance composition.

**Key Characteristics:**

- Dark graphite surfaces with chalk text and steel secondary copy.
- Safety-orange actions and annotations; cyan for blueprint and evidence detail.
- Condensed display lettering paired with readable prose and restrained technical labels.
- Square controls, thin rules, stamped metadata, and exact SVG machinery.

This is a record of the built system, extracted from `site/assets/style.css`, `site/assets/app.js`, `site/index.html`, `scripts/floor.mjs`, and the two journal pages. Root CSS tokens are normative for ongoing implementation; this document records their current values. The palette in `docs/factory-floor-brief.md` is a historical plan where it differs. That brief records the session's code-first, brief-bound implementation; no default comp approval is implied here.

## Colors

The palette combines muted industrial greens and blueprints with warm chalk and a clear safety-orange accent. Frontmatter records the shared CSS custom properties, rather than every illustration face or one-off text shade.

### Primary

- **Safety orange — `orange`:** primary entrance action, display emphasis, outgoing arrows, selected drawing markers, focus outlines, drifted specimen results, and the large introductory panel.

### Secondary

- **Blueprint teal — `blueprint`:** the gridded research drawing board and a face color within blueprint mode.
- **Drafting cyan — `cyan`:** transcript text, conforming specimen results, status and clipboard messages, blueprint strokes, and ghosted drawing detail.

### Neutral

- **Factory graphite — `ground`:** page ground, command well, and dark text on orange or chalk selections.
- **Workshop panel — `panel`:** the experiment workbench surface.
- **Chalk — `paper`:** primary text and selected station/experiment fills; primary action hover fill.
- **Steel — `steel`:** secondary prose, dates, labels, and diagram dimensions. Preserve the implemented value in frontmatter; the earlier iron value in the brief is superseded.
- **Ruled edge — `rule`:** dividers and control outlines throughout the page.

**The Evidence Label Rule.** Pair outcome colors with explicit words and values. The built specimens say GREEN, RED, or UNVERIFIED; a colored stroke alone is not a result.

The machinery has its own local face palette, changed by drawing mode. Preserve those local values in the drawing stylesheet and authored SVG rather than promoting each face to a global brand token. The drawing-board grid uses translucent linear gradients to make drafting paper, not a lighting effect.

## Typography

**Display font:** Barlow Condensed, with sans-serif fallback. **Body font:** Barlow, with sans-serif fallback. **Technical font:** SFMono-Regular, Consolas, Liberation Mono, monospace.

Barlow Condensed supplies the compressed, stamped character. Barlow carries explanation at a comfortable measure. Monospace is reserved for identifiers, date/version records, code, and technical labels.

### Hierarchy

- **Display:** uppercase entrance lettering uses the frontmatter display role. At widths up to 1100px it becomes 9vw; up to 760px it uses `clamp(78px,18vw,128px)` with line height .88.
- **Headline:** section headings use the headline role. Individual narrative panels and mobile sections have purpose-specific sizes; preserve those existing rules rather than forcing one size across every surface.
- **Title:** project and journal titles share the title role. Experiment titles are 38px/1.05 on desktop and 31px on mobile.
- **Body:** global prose uses the body role; section descriptions typically use 15–18px. The project description measure is at most 62ch and experiment questions at most 72ch.
- **Article:** journal prose uses the article role in a 740px maximum column, reducing to 17px on mobile while retaining 1.75 line height. Article headings use a 15ch maximum title measure; blockquotes use orange condensed lettering and top/bottom rules.
- **Label:** the technical role is the common base, with smaller 7–9px variants on dense plates and mobile drawing annotations. Do not extend these tiny annotation sizes to prose or primary actions.

Fonts are self-hosted TTF assets: Barlow Regular (400), Barlow Medium (500), and Barlow Condensed Bold (700), all with `font-display: swap`. Retain `site/assets/fonts/barlow-OFL.txt` and `barlowcondensed-OFL.txt` with their fonts. There is no shipped webfont CDN dependency.

## Layout

The shared desktop gutter and section spacing are recorded in frontmatter. The entrance and content sections cap at 1800px. This is a broad editorial layout with controlled text measures, not a repeated card grid. Borders align metadata, selectable records, and adjacent specimens.

The current entrance uses a 39%/61% text/drawing split, moving to 40%/60% at 1100px. The workbench uses 26%/74% navigation/detail columns. Project rows use an identifier column, flexible description, and 205px specification rail. Journal rows use a 16% date column, title/body column, and 80px arrow column. These are implemented surface patterns, not mandatory templates for new pages.

Responsive breakpoints are 1100px and 760px maximum widths, plus a 1600px minimum-width adjustment to entrance spacing. At 760px and below:

- The header wraps its full navigation onto a second line; it has no hamburger menu.
- The entrance becomes a vertical sequence, with the drawing and all four station controls retained.
- Machine metadata becomes a two-column grid.
- The three experiment choices become an equal-width row above the result panel.
- Project specifications move under each description; research plates become one column.
- Journal date/type metadata occupies a full row before the title, and the copy-command button moves below the command.

Articles use a separate 1250px shell with 5% horizontal padding, changing to the shared mobile gutter. Their prose remains centered and narrow. Preformatted text wraps anywhere; transcripts have a 450px maximum height with scrolling. Tables retain their native rows and full content width.

## Elevation & Depth

The interface has no box-shadow vocabulary. Surface color, one-pixel rules, and spacing establish hierarchy. The factory drawing alone uses authored top, side, and front faces to create physical depth; blueprint mode recolors the same geometry. There is no simulated live machinery movement.

Motion is limited to drawing background (.3s), switch-thumb transform (.25s), and station-geometry opacity (.2s), using CSS's default easing. In the current behavior, selection changes marker/facet styling, not opacity. Anchor scrolling is smooth. Reduced-motion preference removes animations and transitions and makes scrolling immediate.

## Shapes

Controls and panels have square corners. Thin borders create drawing frames, selection rails, machinery plates, table rows, and transcript separators. Circles belong to crosshairs, SVG station markers, machinery joints, and the circular research symbol; they are not the general control shape. The outlined closing stamp rotates −9 degrees.

The exact factory geometry is generated in `scripts/floor.mjs`, with a 900 × 615 SVG viewBox and a shared orthographic projection. Non-scaling strokes retain engineering-line character as the drawing resizes. Inline SVG supplies research symbols and identity marks. No raster image ships in this system; review PNGs are inspection evidence, not site assets.

## Components

### Actions

The primary action is a square orange link with dark medium-weight text, a widely separated directional arrow, and a chalk hover fill. Its desktop padding is recorded in frontmatter; mobile uses 14px 17px. Secondary actions are underlined text or square outlined buttons, not a second filled CTA system.

All links, buttons, summaries, and focusable code blocks receive a 2px orange `:focus-visible` outline with 5px offset. Links retain a one-pixel underline with a 5px offset where not explicitly styled as navigation or a row. The keyboard skip link appears above the header when focused. Disabled buttons, if present, use a wait cursor and .6 opacity.

### Navigation

The wordmark and thin ruled header frame four ordinary anchor links and a source link. Secondary navigation text is steel; hover is orange. Navigation remains visible on mobile. The header is in normal flow, not sticky. Journal pages reuse the header and provide a text back-link to the field notes.

### Factory drawing and selectors

The factory drawing is a conceptual assembly, with an accessible SVG title and description. Four native buttons represent Blueprint, Workcell, Gate, and Record. They use `aria-pressed`; a selected button has chalk fill and dark text, while the matching drawing marker becomes orange. Selection updates a polite live caption and its associated real destination. The four buttons retain a minimum height of 44px.

The blueprint-view control is a native toggle with `aria-pressed` and a square switch indicator. It changes the drawing's local CSS palette through `data-view`, leaving the station selection and geometry intact. The indicator translates 9px when pressed. No persistence or automatic station cycling is implemented.

### Experiment workbench

A ruled panel joins selectable recorded experiments to their inspection area. Experiment selectors are native pressed-state buttons, not ARIA tabs. Selected entries use chalk/dark inversion; unselected hover uses a muted green fill. The inspection area contains an identified recording, explicit result status, a paired conforming/drifted specimen, a disclosure transcript, reproduction command, provenance link, timestamp, and scope note.

Selecting an experiment replaces its title, question, results, transcript, command, and recording metadata from embedded report data. It clears the prior clipboard message. These controls inspect recordings; they do not execute the experiment. The first transcript remains available without JavaScript, with a link to all JSON results.

The transcript is a native `details`/`summary` disclosure. Its orange plus rotates 45 degrees when open. Code blocks can receive keyboard focus and wrap long commands. The copy button reports either “Command copied.” or manual-selection guidance through a status region; a clipboard failure does not remove the command.

### Plates and catalogue rows

Machine plates and project specification rails use semantic definition lists. Small monospace labels precede actual dates, versions, types, and access/license records. Project rows use large orange numbers and condensed linked titles; metadata provides context without pretending to be telemetry. The research drawing board uses a 24px grid and explicitly identifies its contents as research directions.

### Journal rows and article content

Each journal row is one link with a date/type group, condensed title, steel description, and orange arrow. Hover underlines the title. On mobile, date/type moves to a single row before the title, preserving the reading order.

Article content uses restrained paragraphs, clear subsection headings, ruled orange quotations, semantic tables with column headings, and a smaller steel evidence note separated by a rule. The reading surface shares the identity while reducing visual density. No inputs, forms, menus, dialogs, or independent chip system are currently implemented.

## Do's and Don'ts

### Do:

- **Do** preserve the factory-floor identity through exact SVG geometry, square controls, thin rules, and stamped metadata.
- **Do** use the implemented steel token for secondary text and retain explicit labels alongside outcome colors.
- **Do** keep Barlow fonts self-hosted with their OFL license files.
- **Do** preserve keyboard focus, native disclosure behavior, visible mobile navigation, and reduced-motion handling.
- **Do** distinguish conceptual drawings, recorded results, and research directions in the visible interface.

### Don't:

- **Don't** replace the industrial world with neon dashboard styling or an interchangeable marketing-card grid.
- **Don't** introduce decorative shadows or general pill-shaped controls into this square, ruled system.
- **Don't** turn diagram stations into fabricated live telemetry or imply that selecting a recording runs an experiment.
- **Don't** replace the authored interactive geometry with a raster or drop license/provenance material from shipped assets.
- **Don't** treat the planned palette or an unapproved comp workflow as authority over the current built system and recorded surface brief.
