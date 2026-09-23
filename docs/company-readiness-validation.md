# Company journey: local verification

Verified 20 September 2026 against the local working changes based on `b5fa78d`. This is local implementation evidence, not a deployed-site receipt or proof of commercial delivery. Experiment inputs, recordings, engine pin and dependency lockfile were unchanged.

## Observed journey

Homepage and both journal pages → Work with us → prepare a brief → inspect plain-text preview → download Markdown → independently read the downloaded file. The file exactly matched the preview, including multiline Unicode and HTML-like content. HTML-like text remained inert.

The form rejects a missing workflow. Editing a prepared brief invalidates its old export. Keyboard skip navigation, visible focus and Enter-to-prepare work. No-JavaScript visitors retain downloadable templates and contact links without a dead interactive form. Layouts at 320px and 390px did not overflow; desktop and mobile screenshots were inspected.

Request observation during typing, preparation, copying and downloading found no requests; browser storage and cookies remained empty. A reload cleared the draft in this tested Chromium session only; the page makes no cross-browser clearing promise. Clipboard success and denial were controlled through a substituted browser clipboard API: exact content and the selectable-text fallback passed. Actual system clipboard persistence was not tested. Real Blob downloads were exercised and read back.

The existing factory blueprint toggle and all three experiment selectors remained functional. No browser page errors occurred. No contact message was sent.

## Checks

Node 22, pnpm 10.11.1:

- `pnpm test`: 9 tests passed, including blank/oversized input, stale exports, repeated copy, denied clipboard and negative public-export cases.
- `pnpm build`: passed.
- `pnpm check`: passed across 26 static files, including local links/anchors, export boundaries, experiment transcript digests and recorded verdicts.
- Browser acceptance: 15 checks passed.
- Independent source and claims review: approved after correcting the browser-clearing wording.

Public-content scanning now includes modules and downloadable Markdown/text. Existing font license attribution links are permitted only in their corresponding bundled license files. Controlled tests verify those exceptions do not grant unrelated pages permission to use them.

## Boundaries and release follow-up

No deployment, live intake delivery, pilot execution, customer benefit, security certification or production readiness was established. A public contact-page read supports the displayed company identity and contact address; it is not a company registry check.

Before publication, follow [the publishing guide](PUBLISHING.md), including current experiment runs, independent review of the exact publication revision and anonymous deployed-site verification. Confirm the live module MIME type, Pages-prefix routes, downloadable resources and company/contact journey. A local check is not a live-site check.
