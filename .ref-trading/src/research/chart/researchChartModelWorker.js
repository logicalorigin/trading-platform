import { buildResearchChartModel } from "./researchChartModelCore.js";

self.onmessage = (event) => {
  const payload = event?.data || {};
  const requestId = Number(payload?.requestId) || 0;
  try {
    const model = buildResearchChartModel(payload);
    self.postMessage({
      requestId,
      ok: true,
      model,
    });
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error?.message || "Failed to build research chart model",
    });
  }
};
