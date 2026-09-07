---
name: Odin R&D
description: Odin's emerald interface and typography around a dark software-factory floor.
colors:
  ground: "#0a0a0f"
  panel: "#111118"
  paper: "#f5f5f7"
  steel: "#a1a1aa"
  rule: "#2a2a38"
  brand: "#34d399"
  primary: "#047857"
  primary-hover: "#065f46"
  blueprint: "#18393d"
  cyan: "#82b3c2"
  orange: "#ff7a45"
typography:
  display:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "clamp(62px,6.2vw,96px)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "clamp(34px,4vw,56px)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  article:
    fontFamily: "Inter, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.8
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.08em"
rounded:
  primary-control: "10px"
  small-control: "8px"
  record: "0"
spacing:
  gutter: "4.2%"
  gutter-mobile: "6%"
  section: "112px"
  section-mobile: "66px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.primary-control}"
    padding: "15px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  station-selected:
    backgroundColor: "#12352c"
    textColor: "#a7f3d0"
  experiment-selected:
    backgroundColor: "#12352c"
    textColor: "{colors.paper}"
  workbench:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.record}"
---

# Design System: Odin R&D

## Overview

The factory is the defining graphic. Odin's established typography and emerald interface connect it to Command Center and the main website. The owner explicitly approved the floor and requested this brand refinement on 7 September 2026. Preserve the composition, drawing, interactions and stamped records.

The current authority is this document plus the implemented stylesheet. The initial Barlow/orange interface plan is historical; `docs/brand-refinement.md` records the updated brief and reference observations. The live marketing homepage was observed using a system-sans stack on light surfaces. Command Center explicitly defines the three families used here; its dark theme is the stronger reference for this dark R&D surface.

## Colors

Use emerald for navigation feedback, primary actions, selected controls and conforming experiment results. The primary button uses dark emerald with light text; focus rings and headline emphasis use the brighter brand color.

Blue-black page and panel tones, neutral light text and secondary gray come from the website's declared dark palette. Keep existing blueprint teal/cyan, muted machine faces and safety-orange equipment. Orange remains meaningful for machinery, the drifted specimen, disclosure marks and the stamped invitation. Do not recolor the entire factory to match the buttons.

The introductory panel is deep emerald `#102b25`, with light text and green-tinted secondary copy. Selected station and experiment fills are `#12352c`; selected label tones use `#6ee7b7` and `#a7f3d0`. Outcome colors always accompany GREEN/RED/UNVERIFIED text and values.

## Typography

Use Space Grotesk at 600 for headings, Inter for prose and UI, and JetBrains Mono for identifiers, timestamps, specimen scores and code. These roles follow Command Center. The wider display face uses sentence case and more line height than the first edition's condensed lettering.

The desktop hero uses the display role; below 1100px its size is 6.2vw, and mobile uses `clamp(52px,12.7vw,82px)` with 1.06 line height. Section headings use the headline role, with local panels tuned to their width. Project and journal titles use 28px/1.25 on desktop and 23–24px on mobile. Experiment titles use 29px/1.2 and 25px on mobile.

Article prose uses 18px/1.8, reducing to 16px on mobile, in a 740px column with paragraph measure at most 68ch. The article title uses `clamp(44px,5.6vw,78px)`, 19ch maximum width, and 43px on mobile. Article section headings are 30px/1.1 and 27px on mobile. Body emphasis uses weight 600.

Metadata stays tabular and compact. Small 7–9px annotations belong only to diagrams and machine plates; ordinary prose and actions use larger sizes. Fonts are self-hosted Latin WOFF2 variable subsets: Space Grotesk 300–700, Inter 100–900 and JetBrains Mono 100–800. Only the display face is preloaded. Preserve the OFL files and `docs/asset-provenance.json`; visitors make no font-CDN request.

## Layout

Preserve the factory-first composition: headline left, large geometry right, equipment plate below; then introduction, experiment workbench, project rows, research drawing board, journal and invitation. The header exposes all navigation on mobile.

Page gutters are 4.2%, changing to 6% below 760px. Sections use 112px desktop and 66px mobile spacing. The hero changes from a 39/61 split to one column on mobile. The bench switches from side selectors to a three-column selector row. Project records, research columns and journal metadata reflow at existing breakpoints. Do not compress the drawing to make the wider type fit.

## Elevation & Depth

Depth comes from the exact orthographic machinery, not decorative card shadows. UI panels use fills and thin rules. Preserve the two drawing modes and their local material palette. No new idle animation or artificial live telemetry.

## Shapes

Interactive primary controls use 10px corners; blueprint/copy controls and the station strip use 8px. Equipment plates, specimen records and blueprint sheets stay square. Circle forms are reserved for drawing markers, crosshairs and the existing research loop symbol.

## Components

- Primary actions: dark emerald fill, light text, darker hover, visible emerald focus. Native links remain links.
- Station strip: four buttons with pressed state. Emerald selection changes the caption and selected SVG station. Focus stays visible inside the rounded strip.
- Blueprint toggle: native pressed button changes the same geometry's materials. It does not launch or monitor a service.
- Experiment selector: highlights a recorded recipe and changes the question, transcript and command. It does not execute the engine in the browser.
- Specimen records: JetBrains Mono scores, explicit GREEN/RED outcomes, unchanged provenance.
- Transcript: native details/summary; selectable, wrapping code; copy confirmation and manual-copy fallback remain intact.
- Journal rows: type/ID with the date, descriptive title and summary, a clear linked row.

Respect `prefers-reduced-motion`, keyboard focus, native disclosure and no-JavaScript reading. Theme selection and scrollbars with the same tokens.

## Do's and Don'ts

- Keep the factory geometry and orange equipment details intact.
- Use Odin fonts and emerald for the interface around it.
- Preserve factual content, public experiment provenance and research-status boundaries.
- Keep local fonts, licenses and asset hashes together.
- Check heading wrapping, selected states and control focus at desktop, tablet and mobile widths.
- Avoid adding card grids, decorative motion or simulated runtime state during refinement.

## Private collaboration plates
The Factory Intelligence and Odin Gym blueprint plates lead with intended customer benefits and contact actions for private collaboration. Keep the existing drawing board, symbols and typography. Each plate has a descriptive contact link with a 44px minimum target; the footer invites early adopter partners. The audience and access discussion are visible in ordinary reading text.
