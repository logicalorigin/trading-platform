import * as THREE from "three";
import {
  fibonacciSphere,
  mulberry32,
  sampleLogoTargets,
} from "@/lib/neural-geometry";
import { NEURAL_SEED, POINT_COUNT, type NeuralVariant } from "./types";

// Builds the BufferGeometry the particle system renders. The two point clouds
// (drifting sphere + sampled logo target) and the per-particle scatter/phase
// data are computed once and uploaded as static attributes; the morph happens
// entirely in the vertex shader.
export async function createParticleGeometry(
  count: number = POINT_COUNT,
  seed: number = NEURAL_SEED,
  variant: NeuralVariant = "lockup",
): Promise<THREE.BufferGeometry> {
  const sphere = fibonacciSphere(count, 1.0);
  const target = await sampleLogoTargets({ count, seed, variant });

  const rng = mulberry32(seed ^ 0x5bd1e995);
  const random = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = rng() * 2 - 1;
    const y = rng() * 2 - 1;
    const z = rng() * 2 - 1;
    const len = Math.hypot(x, y, z) || 1;
    random[i * 3] = x / len;
    random[i * 3 + 1] = y / len;
    random[i * 3 + 2] = z / len;
    phase[i] = rng();
  }

  const geometry = new THREE.BufferGeometry();
  // `position` is required by THREE for a Points object; seed it with the sphere
  // so initial bounds are sane (the shader ignores it in favor of the morph).
  geometry.setAttribute("position", new THREE.BufferAttribute(sphere.slice(), 3));
  geometry.setAttribute("aSpherePos", new THREE.BufferAttribute(sphere, 3));
  geometry.setAttribute("aTargetPos", new THREE.BufferAttribute(target, 3));
  geometry.setAttribute("aRandom", new THREE.BufferAttribute(random, 3));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  // Encompass the full disperse range so frustum culling never clips mid-burst.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4.5);

  return geometry;
}
