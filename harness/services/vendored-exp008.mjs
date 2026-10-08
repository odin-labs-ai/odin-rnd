// Byte-identical copies of the module-private EXP 008 symbols the harness needs (the EXP 006 vendored-exp005.mjs
// precedent). Never edited here: scripts/harness-adapters.test.mjs slices each declaration out of the frozen source
// (experiments/latent-handoff/ffr8.mjs, bound by EXP 008's pre-registration) and requires the bytes to be equal.
const ID = /[^A-Za-z0-9._:-]/g;
const safeId = s => String(s).replace(ID, '-').slice(0, 128);

export { ID, safeId };
