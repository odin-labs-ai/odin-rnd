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
    fontSize: "12px"
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

The home lockup reads OdinLabs / R&D in sentence case, with the subdivision separated by a thin rule. The header exposes the canonical navigation destinations (listed below, with Find last) and the source link without a hidden mobile menu. The footer adds direct Odin Labs and Open Docs links. Keep all article routes in the same brand shell.

Find is a documented addition to those destinations (mission rnd-site-ux-nav-1101, 2026-11-01): the build adds a Find link as the last header destination on every page, so a visitor can search and filter everything the site publishes from anywhere. Field notes, lab pages and tool pages also get a breadcrumb trail at the top and up to four related links before the footer, styled by assets/chrome.css. This chrome is added to the built pages only (scripts/site-chrome.mjs), never to a committed page or frozen record, and never puts a breadcrumb or related link on a number-provenance page.

One header navigation (wave 3 of the same mission): the build rewrites the header nav of every built page to the same list, in this order: Factory, Experiments, Labs, Updates, Field notes, Work with us, Partners, then Find, with the page's own section marked current (aria-current, shown as a thin brand underline from assets/chrome.css; scripts/site-header.mjs; an unknown nav label stops the build, and each retired first-edition label is named with what became of it). Field notes and Tools have index pages of their own, journal/ and projects/, rendered from the site index (scripts/site-sections.mjs), and the breadcrumbs on notes and tools lead to them; the built experiments page ends with an All experiments list. Like the rest of the chrome this happens in dist/ only.

On this page (wave 4 of the same mission): a field note or lab page whose main text runs past 2,000 words with at least four section headings gets an "On this page" list right after its own header (scripts/site-toc.mjs, styled in assets/chrome.css). On phones and below 1100px it is a closed disclosure in the site's own summary style; from 1100px it is a plain list, which on a field note sits in the right margin beside the 740px text and stays in view while reading. Never on a number-provenance page. Lab 01's per-pull-request log is folded in the same disclosure style. An experiment whose ledger row links a raw JSON record has a record page (records/<slug>/, scripts/site-records.mjs) that shows the record's own fields as written and links the file; Find and the related links lead there.

## Layout and materials

A full-width forest-green entrance wraps the headline, large interactive drawing and stamped machine plate. Page gutters are 4.2%, 6% mobile; very wide hero content is capped through side padding. The hero reflows into one column on mobile without changing drawing geometry.

Below the dark bay, the pale introductory panel leads to the dark experiment workbench, ruled public-project records, retained blueprint partner plates and a light journal. Controls use 8–10px corners; introductory/workbench containers use 12px (8px workbench on mobile). Machinery plates remain square and ruled. Preserve four station controls, blueprint view, native transcript disclosure and copy behavior.

The private collaboration plates lead with intended customer benefits. Each concept has a descriptive 44px-minimum contact action; the footer invites early adopter partners. Keep their approved copy and audience intact.

## Accessibility and behavior

Use scoped focus colors: dark green on the light floor, light emerald inside dark surfaces. Keep keyboard use, selection, reduced motion, reading without JavaScript and native disclosure. Station and experiment focus stays inset so rounded containers do not clip it. Do not add idle animation or simulated runtime counters.

Labels and scores retain explicit GREEN/RED/UNVERIFIED text; color alone never conveys an outcome. The workbench records an experiment; it does not execute agents in the browser. The floor is conceptual geometry, not a map of deployed infrastructure.

A shorter home (wave 5 of the same mission, 2026-11-02): the build reshapes the finished home in dist/ (scripts/home-shape.mjs). The factory, the latest updates, the measured results and the offer stay open, in that order, followed by a "Go further" list to Find, the experiments, the labs, the field notes and the tools (five ruled links, 44px or taller). Every other section keeps its heading block in view and folds the rest into a closed disclosure. Its summary is a flex row, 44px or taller, set like the field notes' "earlier notes" summary (small mono capitals in the secondary colour, a ruled top), with the orange + at its far end. Nothing moves when a fold opens. The styles are in assets/home.css, and assets/home-fold.mjs opens the folds around a linked target (the experiment list); both are linked from the built home only. The fold shortens the page a visitor scrolls, not the words it carries; site/index.html is unchanged.

Plain-language home and navigation (mission rnd-site-human PR 1, 2026-11-16; the founder found the site "too technical / jargon" and "hard to navigate"): the header now reads Start here (the lab on a page), Findings (the home's #findings), Labs, All results (experiments/), Notes & updates (journal/, which links updates/), How we test (methods/) and Work with us, then Find. Factory, Experiments, Updates, Field notes and Partners are retired labels in scripts/site-header.mjs, each with what became of it; Partners moved to the site footer of every built page. The hero says who we are in two plain sentences and leads with one primary button, "See what we found", then Work with us, both 44px targets. The measured results moved up to sit under the hero as "What we've found" (#findings, formerly #lab), each finding with its limit in words under a "Limit:" label and a dated line linking the result and the record; the numbers still come only from the records (scripts/number-provenance.mjs). The open order is now the hero (who we are, See what we found, and the dated correction folded under a summary that says in words what was corrected and when, its full text in the HTML), what we've found, the factory drawing in its own section under a plain heading ("The checks we study, in one drawing", #how-we-check) and one plain sentence saying it is a concept drawing of separate experiments, not stages results pass through, the latest updates and the offer. scripts/home-plain-language.test.mjs bans the plan's lab terms from the header, the hero, the findings, Go further and the fold summaries.

How we test (mission rnd-site-human PR 2, 2026-11-16): methods/ is the "How we test" page of the header. It opens in plain words (what we test, planned in writing before it runs, what a limit means, when a result does not hold up, why some results are exploratory), with an "On this page" list beside the headline, then explains the lab's words in a glossary (#glossary: an index of 44px links, then one ruled entry per word, id glossary-<entry>, a definition of one or two sentences and, where a published record has one, an example that adds nothing to it). The publication standard stays open, since every page's boundary note links it; each numbered method step keeps its heading and gains one plain "In short" line, and its earlier text sits unchanged in a closed native disclosure, "The details" (a dated correction is named with its date in the summary). On the home, "What we've found" links the first use of each lab word to its entry: the intro in site/index.html, and the findings through a `glossary` phrase map in data/lab-proof.json (scripts/lab-pages.mjs, home only). scripts/methods-glossary.test.mjs checks the entries, the index, every glossary link in the built site, the first-use links and the banned words in the opening (the word lists are shared with the home's test through scripts/plain-words.mjs).

Lab page openings (mission rnd-site-human PR 3, 2026-11-16): every lab page (the twelve labs; not the list of every run or the How we decide ledger, which are pages about the labs) opens right after its hero, and after its "On this page" list, with the same four parts: In short (two plain sentences, the question and the answer), What we found (one to three findings), Why it matters (one sentence) and a one-line Limit, then the existing detail, unchanged. A lab with a written plan links the plan and its result there, and the build checks that each links the other. The words come from site/data/lab-openings.json, rendered by openLabPages() in scripts/lab-pages.mjs, which scripts/labs.mjs runs over the lab pages it renders into dist/ only: plain words carry no digit and no number word, a number is either a quote of the same page's own words (the build stops when the page no longer holds it) or a value read from a measured record, and the first use of each mapped lab word links its glossary entry on How we test. The same pass folds the record's identifiers, verbatim, into closed native disclosures titled "How we checked", in the How we test page's fold style: each "Check it yourself" section's text (its heading stays in view), source lines citing a commit, a sha256 or the hash disclaimer, the latest-run provenance, lists of digests and the re-run commands. The review lab now shows what one review cost per model, read from EXP 017's record with the date of its runs and a link to the record, and says that the site shows a cost only with its date and source (the founder's ruling of 16 November 2026). scripts/lab-openings.test.mjs checks the four parts in order, the banned words, the plan and result links and that taking the folds out gives back the page byte for byte.

Field note openings (mission rnd-site-human PR 4, 2026-11-17): every field note the Notes & updates page lists opens right after its own header, and after its "On this page" list, with the lab pages' four parts in the note's 740px reading column: In short (two plain sentences), What we found (for a plan whose page holds no result yet, "Not run yet: what would count as a yes"), Why it matters and a one-line Limit, then the note exactly as its generator wrote it. A written plan and its result are paired: both openings link the plan (a plan note or the plan's record) and the result, and the build checks that each links the other, which gives EXP 009's frozen plan its missing link to its result. The Notes & updates list adds where a note stands in its pair, in words: Result, Plan, result published, or Plan, not run yet. The words come from site/data/note-openings.json, rendered by openNotePages() in scripts/note-openings.mjs (run by scripts/site-sections.mjs, in dist/ only, so every byte pin of a frozen note still holds) with the lab openings' renderOpening(), under the same rules: no digit or number word in plain words, a number only as a verbatim quote of the same note or a value read from a record, no banned lab word, no vendor or partner name, and the first use of each mapped word linked to its glossary entry. The same pass folds, verbatim, every paragraph, table or list item of the note that cites a hash, a commit, a run id or the hash disclaimer into a closed "How we checked" disclosure; a heading, or a block that states a verdict, a status, a failure, a limit or a correction, stays in view. scripts/note-openings.test.mjs checks the parts in order, the banned words, the pairs and that taking the opening and folds out gives back each note byte for byte.
