---
name: Odin R&D
description: Odin's forest-green factory bay, authentic brand mark and pale public reading floor.
colors:
  ground: "#f3f6ef"
  panel: "#e7efe3"
  paper: "#18382d"
  steel: "#496559"
  rule: "#c7d7c9"
  brand: "#236747"
  primary: "#047857"
  primary-hover: "#065f46"
  blueprint: "#18393d"
  cyan: "#82b3c2"
  orange: "#ff7a45"
typography:
  display:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "clamp(62px,5.9vw,88px)"
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
    fontFamily: "Manrope, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  article:
    fontFamily: "Manrope, sans-serif"
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
    textColor: "#ffffff"
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
    backgroundColor: "#142f27"
    rounded: "{rounded.record}"
---

# Design System: Odin R&D

## Overview

Odin R&D belongs visibly to the same family as Open Docs and odin-labs.ai. The user supplied those references and explicitly requested the real Odin logo on 7 September 2026. The identity pass preserves the factory geometry, blueprint interaction, content and private-partner positioning; it changes the surrounding design to forest-green navigation and pale reading surfaces.

Live references and asset provenance are recorded in docs/odin-identity.md. This edition supersedes the earlier dark-only Command Center palette and Inter body font. The shared Space Grotesk heading family and JetBrains Mono records remain.

## Colors and surfaces

The reading floor uses #f3f6ef with forest ink #18382d, secondary #496559, pale panel #e7efe3, rules #c7d7c9 and links #236747. These follow Open Docs’ observed visual language. Primary actions use #047857 with white text.

The header, hero and experiment workbench use a scoped dark palette: ground #102b22, panel #142f27, text #eef6ed, secondary #b8cec1, rules #3d5b4e and accents #6ee7b7. This keeps the factory bay and recorded terminal readable independently of the light page. The blueprint plates retain #18393d, their drawing grid, light text and emerald contact actions. Machine material colors and safety-orange geometry are unchanged. The orange stamp on light paper uses darker #92502d.

The introduction is a pale green bordered panel. Projects and field notes remain spacious ruled rows on the light page. Do not add an interchangeable card grid or decorative gradients. The official logo’s original lime-to-cyan gradient is brand artwork and remains unchanged.

## Typography

Use Space Grotesk 600 for headings, Manrope for prose and UI (matching Open Docs), and JetBrains Mono for identifiers, timestamps, scores and code. Self-host Latin variable WOFF2 and retain the OFL notices beside them. Only Space Grotesk is preloaded.

Desktop hero size is clamp(62px,5.9vw,88px), with 1.05 line height; tablet uses 6.2vw, mobile clamp(48px,12.7vw,72px). Section headings use the headline role. The introduction is clamp(32px,3.1vw,44px), 30px mobile. Project and journal headings preserve the existing 23–28px responsive scale.

Articles use 18px/1.8 Manrope, 16px on mobile, in a 740px reading column; paragraph measure stays at most 68ch. The article heading keeps clamp(44px,5.6vw,78px), 43px mobile. Technical micro-annotations belong to diagrams and equipment plates, while prose and actions stay larger. Real measurement records use tabular numerals.

## Logo and navigation

Use the unmodified public Open Docs odin-logo.svg, whose exact path matches the live odin-labs.ai header. Never redraw it as a generic geometric icon. It appears in the common header, footer, equipment plate, favicon and missing-page header, with explicit image dimensions and decorative alt text beside the named home link.

The home lockup reads OdinLabs / R&D in sentence case, with the subdivision separated by a thin rule. The header exposes the four existing navigation destinations and source link without a hidden mobile menu. The footer adds direct Odin Labs and Open Docs links. Keep all article routes in the same brand shell.

## Layout and materials

A full-width forest-green entrance wraps the headline, large interactive drawing and stamped machine plate. Page gutters are 4.2%, 6% mobile; very wide hero content is capped through side padding. The hero reflows into one column on mobile without changing drawing geometry.

Below the dark bay, the pale introductory panel leads to the dark experiment workbench, ruled public-project records, retained blueprint partner plates and a light journal. Controls use 8–10px corners; introductory/workbench containers use 12px (8px workbench on mobile). Machinery plates remain square and ruled. Preserve four station controls, blueprint view, native transcript disclosure and copy behavior.

The private collaboration plates lead with intended customer benefits. Each concept has a descriptive 44px-minimum contact action; the footer invites early adopter partners. Keep their approved copy and audience intact.

## Accessibility and behavior

Use scoped focus colors: dark green on the light floor, light emerald inside dark surfaces. Keep keyboard use, selection, reduced motion, reading without JavaScript and native disclosure. Station and experiment focus stays inset so rounded containers do not clip it. Do not add idle animation or simulated runtime counters.

Labels and scores retain explicit GREEN/RED/UNVERIFIED text; color alone never conveys an outcome. The workbench records an experiment; it does not execute agents in the browser. The floor is conceptual geometry, not a map of deployed infrastructure.
