import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { createParticleGeometry } from "./createParticleGeometry";
import { NEURAL_FRAGMENT_SHADER, NEURAL_VERTEX_SHADER } from "./particleShaders";
import {
  NEURAL_COLORS,
  POINT_COUNT,
  POINT_COUNT_TIGHT,
  TIGHT_SPIN_RAD_PER_SEC,
  type NeuralMode,
} from "./types";
import { useMorphMachine } from "./useMorphMachine";

type NeuralPointsProps = {
  mode: NeuralMode;
  contentReady?: boolean;
  onReveal?: () => void;
  onDisperseStart?: () => void;
};

// World extents (+ margin) of each formed target, used to scale it to fit any
// viewport/container so it is never clipped.
const FIT = {
  opener: { width: 3.9, height: 2.8, max: 1.15 },
  tight: { width: 2.4, height: 2.4, max: 1.4 },
} as const;

export function NeuralPoints({
  mode,
  contentReady = false,
  onReveal,
  onDisperseStart,
}: NeuralPointsProps) {
  const gl = useThree((state) => state.gl);
  const viewport = useThree((state) => state.viewport);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const machine = useMorphMachine(mode);
  const pointsRef = useRef<THREE.Points>(null);
  const revealedRef = useRef(false);
  const disperseRef = useRef(false);
  const isTight = mode === "tight";

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: NEURAL_VERTEX_SHADER,
        fragmentShader: NEURAL_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uTime: { value: 0 },
          uMorph: { value: 0 },
          uScatter: { value: 0 },
          uOpacity: { value: 1 },
          uPointSize: { value: isTight ? 3.0 : 2.6 },
          uPixelRatio: { value: 1 },
          uColorA: { value: new THREE.Color(NEURAL_COLORS.a) },
          uColorB: { value: new THREE.Color(NEURAL_COLORS.b) },
          uColorC: { value: new THREE.Color(NEURAL_COLORS.c) },
        },
      }),
    [isTight],
  );

  // Build geometry once: the expanded opener samples the full lockup; the tight
  // loader samples the mark only (legible small) with a lighter point budget.
  useEffect(() => {
    let alive = true;
    let built: THREE.BufferGeometry | null = null;
    const count = isTight ? POINT_COUNT_TIGHT : POINT_COUNT;
    const variant = isTight ? "mark" : "lockup";
    void createParticleGeometry(count, undefined, variant).then((g) => {
      if (!alive) {
        g.dispose();
        return;
      }
      built = g;
      setGeometry(g);
    });
    return () => {
      alive = false;
      built?.dispose();
    };
  }, [isTight]);

  useEffect(() => {
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  }, [gl, material]);

  useEffect(() => {
    machine.setContentReady(contentReady);
  }, [contentReady, machine]);

  useEffect(() => () => material.dispose(), [material]);

  const fit = useMemo(() => {
    const f = FIT[isTight ? "tight" : "opener"];
    if (!viewport.width || !viewport.height) return f.max;
    return Math.min(
      f.max,
      (viewport.width * 0.9) / f.width,
      (viewport.height * 0.9) / f.height,
    );
  }, [viewport.width, viewport.height, isTight]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    material.uniforms.uTime.value += dt;
    const { revealed, justDispersing } = machine.update(dt * 1000);
    material.uniforms.uMorph.value = machine.morph;
    material.uniforms.uScatter.value = machine.scatter;
    material.uniforms.uOpacity.value = machine.opacity;

    const points = pointsRef.current;
    if (points) {
      if (isTight) {
        // Idle motion: spin the formed mark + a subtle breathing pulse.
        points.rotation.z += dt * TIGHT_SPIN_RAD_PER_SEC;
        const pulse =
          1 + 0.03 * Math.sin(material.uniforms.uTime.value * 1.8) * machine.morph;
        points.scale.setScalar(fit * pulse);
      } else {
        points.scale.setScalar(fit);
      }
    }

    if (justDispersing && !disperseRef.current) {
      disperseRef.current = true;
      onDisperseStart?.();
    }
    if (revealed && !revealedRef.current) {
      revealedRef.current = true;
      onReveal?.();
    }
  });

  if (!geometry) return null;

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      scale={fit}
      frustumCulled={false}
    />
  );
}
