export function parseDemo(transcript, recipe, exitCode) {
  const clean = transcript.match(/^GREEN conformant: score (\d+), exit 0$/m);
  const drift = transcript.match(/^RED drift: score (\d+), would exit 1, violation (.+)$/m);
  return {
    passed: exitCode === 0 && Boolean(clean && drift) && transcript.includes(`bce demo: ${recipe} discriminates GREEN from RED`),
    cleanScore: clean ? Number(clean[1]) : null,
    driftScore: drift ? Number(drift[1]) : null,
    violation: drift ? drift[2] : null,
    processExitCode: exitCode,
  };
}
