function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runGeneration({ mode, selection }, sendProgress) {
  const steps = [
    { key: "validate", label: "Validating card segments" },
    { key: "download", label: "Downloading sources" },
    { key: "clip", label: "Clipping segments" },
    { key: "stitch", label: "Stitching output" },
    { key: "export", label: `Exporting ${mode}` }
  ];

  for (const [index, step] of steps.entries()) {
    sendProgress({
      step: step.key,
      label: step.label,
      current: index + 1,
      total: steps.length,
      selectionCount: selection?.length || 0
    });
    await sleep(350);
  }

  return {
    ok: true,
    message: "Generator stub: completed",
    outputPath: "C:/path/to/output"
  };
}

module.exports = {
  runGeneration
};
