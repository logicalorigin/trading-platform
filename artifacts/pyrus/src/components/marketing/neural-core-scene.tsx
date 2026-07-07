/**
 * Lazy boundary for the NeuralCore particle sphere.
 *
 * NeuralCore imports `three` directly. This wrapper exists so callers can
 * `lazy(() => import("@/components/marketing/neural-core-scene"))` and have all
 * the three weight land in a dynamically-imported "neural-core-scene" chunk -
 * the same code-splitting contract `pyrus-mark-3d-scene` provides for the 3D
 * mark, and the chunk name the `audit:bundle` gate sanctions for three.
 */
export { default } from "./neural-core";
