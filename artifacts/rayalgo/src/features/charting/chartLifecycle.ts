// Shared registry for live Lightweight Charts instances created by the
// research / sparkline chart components. Charts are always disposed
// (including across Vite hot reloads) so we don't leak GPU/canvas resources
// or DOM listeners over a long session.

type DisposableChart = { remove: () => void };

const liveCharts = new Set<DisposableChart>();

export const registerChart = (chart: DisposableChart | null | undefined) => {
  if (chart) liveCharts.add(chart);
};

export const unregisterChart = (chart: DisposableChart | null | undefined) => {
  if (!chart) return;
  liveCharts.delete(chart);
  try {
    chart.remove();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[rayalgo] research chart disposal failed", error);
    }
  }
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    liveCharts.forEach((chart) => {
      try {
        chart.remove();
      } catch (error) {
        // best-effort dispose during hot reload
      }
    });
    liveCharts.clear();
  });
}
