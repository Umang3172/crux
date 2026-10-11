// The pump set in 3D: motor, drive-end bearing, coupling, pump, on a baseplate.
// It moves only with real numbers: the shake comes from the measured level and
// the suspect's own pattern, the marker from the check the engine asked for,
// and a part lights up only when the engine has named it. Colour is flat with
// ink outlines, so it reads as the same drawing as the rest of the page.

import { Canvas, useFrame, useThree, type ThreeElements } from "@react-three/fiber";
import { Edges, Html, Outlines } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import type { Part } from "../../lib/plain";

export type ScenePalette = {
  body: string;
  metal: string;
  base: string;
  ink: string;
  hot: string;
  marker: string;
  ground: string;
};

/** The scene's colours, read from the page's tokens so the drawing and the page agree. */
export function scenePalette(): ScenePalette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    body: v("--scene-body", "#b9bab3"),
    metal: v("--scene-metal", "#8f9089"),
    base: v("--scene-base", "#3c3d39"),
    ink: v("--scene-ink", "#1d1d1b"),
    hot: v("--scene-hot", "#f2c200"),
    marker: v("--scene-marker", "#0b5cad"),
    ground: v("--scene-ground", "#e6e7e2"),
  };
}

/** How a cause moves the machine, so each suspect shakes its own way. */
export type ShakePattern = "steady" | "once-per-turn" | "twice-per-turn" | "rattle" | "impacts";

export function patternFor(kind: string | null | undefined): ShakePattern {
  switch (kind) {
    case "imbalance":
      return "once-per-turn";
    case "misalignment":
      return "twice-per-turn";
    case "looseness":
      return "rattle";
    case "outer_race":
    case "inner_race":
    case "rolling_element":
    case "rolling_element_defect":
    case "auxiliary_seal_flush_pump":
      return "impacts";
    default:
      return "steady";
  }
}

export type MachineSceneProps = {
  /** Measured level as a multiple of normal; 1 moves like a healthy machine. */
  vibration: number;
  pattern?: ShakePattern;
  /** The part the engine named. Never set before a verdict. */
  highlight?: Part | null;
  /** Where the requested check is taken. */
  marker?: Part | null;
  /** Lifts the bearing out of its housing when the verdict blames one of its parts. */
  openBearing?: boolean;
  /** Names the lifted part, so it never floats unexplained. */
  partLabel?: string;
  palette?: ScenePalette;
  reduceMotion?: boolean;
  /** Where the marked point lands on screen, as fractions of the canvas, for a tag's string. */
  onAnchor?: (p: { x: number; y: number }) => void;
  /** Shown when WebGL is unavailable. */
  fallback?: ReactNode;
  className?: string;
  ariaLabel?: string;
};

const BEARING_PARTS: Part[] = ["bearing", "bearing-inner", "bearing-outer", "bearing-ball"];
const DRIVE_END = new THREE.Vector3(-0.32, 0.95, 0);
const FEET = new THREE.Vector3(-0.75, 0.3, 0.5);
const DOWN = new THREE.Vector3(0, -0.6, 0);

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

type SolidProps = {
  children: ReactNode;
  color: string;
  ink: string;
  lit?: boolean;
  hot: string;
  opacity?: number;
} & ThreeElements["mesh"];

function Solid({ children, color, ink, lit, hot, opacity = 1, ...rest }: SolidProps) {
  return (
    <mesh {...rest}>
      {children}
      <meshBasicMaterial color={lit ? hot : color} transparent={opacity < 1} opacity={opacity} />
      {opacity === 1 && <Outlines thickness={0.014} color={ink} />}
      <Edges threshold={25} color={ink} />
    </mesh>
  );
}

/** Keeps the whole pump in frame on a narrow screen. */
function Fit() {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  useEffect(() => {
    camera.zoom = Math.min(112, width / 4.9);
    camera.updateProjectionMatrix();
  }, [camera, width]);
  return null;
}

function Shaker({ vibration, pattern, reduceMotion, children }: { vibration: number; pattern: ShakePattern; reduceMotion: boolean; children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  // Displacement in scene units: a healthy machine barely moves; the cap keeps
  // a big reading readable instead of violent.
  const amp = Math.min(0.03, 0.004 + Math.max(0, vibration - 1) * 0.008);
  useFrame(({ clock }) => {
    if (!g.current) return;
    if (reduceMotion) {
      g.current.position.set(0, 0, 0);
      return;
    }
    // Shaft speed is shown slowed (6 turns a second) so the eye can follow it.
    const t = clock.getElapsedTime() * 6 * Math.PI * 2;
    let x: number;
    let y: number;
    switch (pattern) {
      case "once-per-turn":
        x = Math.sin(t);
        y = Math.cos(t) * 0.6;
        break;
      case "twice-per-turn":
        x = Math.sin(2 * t) * 0.8;
        y = Math.sin(2 * t + 1) * 0.4;
        break;
      case "rattle":
        x = Math.sign(Math.sin(t)) * 0.7 + Math.sin(0.5 * t) * 0.5;
        y = Math.abs(Math.sin(0.5 * t)) * 0.9;
        break;
      case "impacts": {
        const phase = (t / (Math.PI * 2)) * 3.6;
        const kick = Math.exp(-((phase % 1) * 9));
        x = Math.sin(t) * 0.3 + kick * 0.9;
        y = kick * 0.6;
        break;
      }
      default:
        x = Math.sin(t) * 0.35;
        y = Math.cos(t * 1.3) * 0.2;
    }
    g.current.position.set(x * amp, y * amp, 0);
  });
  return <group ref={g}>{children}</group>;
}

function Marker({ at, color, reduceMotion }: { at: THREE.Vector3; color: string; reduceMotion: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ring.current || reduceMotion) return;
    // The pulse means "waiting for this reading"; it ends when the marker goes.
    const k = (clock.getElapsedTime() * 0.7) % 1;
    ring.current.scale.setScalar(1 + k * 0.7);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = 1 - k;
  });
  return (
    <group position={at}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.15, 0.2, 48]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, 0.23, 48]} />
        <meshBasicMaterial color={color} transparent />
      </mesh>
    </group>
  );
}

/** Reports where a point of the machine lands on the canvas. */
function Anchor({ at, onAnchor }: { at: THREE.Vector3; onAnchor: (p: { x: number; y: number }) => void }) {
  const camera = useThree((s) => s.camera);
  const last = useRef({ x: -1, y: -1 });
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    v.copy(at).add(DOWN).project(camera);
    const x = (v.x + 1) / 2;
    const y = (1 - v.y) / 2;
    if (Math.abs(x - last.current.x) > 0.002 || Math.abs(y - last.current.y) > 0.002) {
      last.current = { x, y };
      onAnchor({ x, y });
    }
  });
  return null;
}

function Bearing({ p, open, highlight, label }: { p: ScenePalette; open: boolean; highlight?: Part | null; label?: string }) {
  const balls = useMemo(() => Array.from({ length: 9 }, (_, i) => (i / 9) * Math.PI * 2), []);
  const g = useRef<THREE.Group>(null);
  // Lift the bearing out of its housing when the verdict blames a ring, so the
  // part the engine named is the part the eye sees.
  useFrame((_, dt) => {
    if (!g.current) return;
    const target = open ? 0.95 : 0;
    g.current.position.y += (target - g.current.position.y) * Math.min(1, dt * 4);
  });
  const lit = (part: Part) => highlight === part || highlight === "bearing";
  return (
    <group ref={g} position={[-0.32, 0, 0]}>
      <group position={[0, 0.62, 0]} rotation={[0, Math.PI / 2, 0]}>
        <mesh>
          <torusGeometry args={[0.2, 0.04, 16, 48]} />
          <meshBasicMaterial color={lit("bearing-outer") ? p.hot : p.metal} />
          <Outlines thickness={0.01} color={p.ink} />
        </mesh>
        <mesh>
          <torusGeometry args={[0.1, 0.035, 16, 48]} />
          <meshBasicMaterial color={lit("bearing-inner") ? p.hot : p.metal} />
          <Outlines thickness={0.01} color={p.ink} />
        </mesh>
        {balls.map((a, i) => (
          <mesh key={i} position={[Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0]}>
            <sphereGeometry args={[0.032, 16, 16]} />
            <meshBasicMaterial color={lit("bearing-ball") && i === 0 ? p.hot : p.metal} />
            <Outlines thickness={0.008} color={p.ink} />
          </mesh>
        ))}
      </group>
      {open && (
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.006, 0.006, 0.62, 6]} />
          <meshBasicMaterial color={p.ink} />
        </mesh>
      )}
      {open && label && (
        <Html position={[0.3, 0.62, 0]} className="scene-label" zIndexRange={[10, 0]}>
          {label}
        </Html>
      )}
    </group>
  );
}

function PumpSet({ p, highlight, openBearing, partLabel }: { p: ScenePalette; highlight?: Part | null; openBearing: boolean; partLabel?: string }) {
  // Two rings mark the motor's frame; more read as a spring at this size.
  const fins = useMemo(() => [-1.75, -0.85], []);
  const hot = (part: Part) => highlight === part;
  const bearingLit = !!highlight && BEARING_PARTS.includes(highlight);
  const common = { ink: p.ink, hot: p.hot };
  return (
    <group>
      {/* Baseplate and feet */}
      <Solid {...common} color={p.base} lit={hot("feet")} position={[-0.2, 0.06, 0]}>
        <boxGeometry args={[4.2, 0.12, 1.1]} />
      </Solid>
      {[-1.9, -0.75, 0.55, 1.45].map((x) => (
        <Solid key={x} {...common} color={p.base} lit={hot("feet")} position={[x, 0.2, 0]}>
          <boxGeometry args={[0.22, 0.16, 0.9]} />
        </Solid>
      ))}
      {/* Motor: finned body, fan cover at the far end */}
      <Solid {...common} color={p.body} position={[-1.3, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.38, 0.38, 1.5, 32]} />
      </Solid>
      {fins.map((x) => (
        <mesh key={x} position={[x, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.41, 0.41, 0.03, 32]} />
          <meshBasicMaterial color={p.body} />
          <Edges threshold={25} color={p.ink} />
        </mesh>
      ))}
      <Solid {...common} color={p.metal} position={[-2.15, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.34, 0.38, 0.22, 32]} />
      </Solid>
      {/* Drive-end bearing housing: goes see-through when the bearing is lifted out */}
      <Solid
        {...common}
        color={p.metal}
        lit={bearingLit && !openBearing}
        opacity={openBearing ? 0.25 : 1}
        position={[-0.32, 0.62, 0]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry args={[0.3, 0.3, 0.32, 32]} />
      </Solid>
      <Bearing p={p} open={openBearing} highlight={highlight} label={partLabel} />
      {/* Shaft and coupling */}
      <Solid {...common} color={p.metal} position={[0.05, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 0.5, 16]} />
      </Solid>
      <Solid {...common} color={p.metal} lit={hot("coupling")} position={[0.26, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.2, 0.14, 32]} />
      </Solid>
      <Solid {...common} color={p.metal} lit={hot("coupling")} position={[0.44, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.2, 0.14, 32]} />
      </Solid>
      {/* Pump: bearing frame, volute, suction and discharge */}
      <Solid {...common} color={p.body} position={[0.85, 0.55, 0]}>
        <boxGeometry args={[0.55, 0.42, 0.42]} />
      </Solid>
      <Solid {...common} color={p.body} lit={hot("impeller")} position={[1.42, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.52, 0.52, 0.42, 40]} />
      </Solid>
      <Solid {...common} color={p.metal} position={[1.9, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.16, 0.6, 24]} />
      </Solid>
      <Solid {...common} color={p.metal} position={[1.42, 1.25, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.75, 24]} />
      </Solid>
      {/* Belt-driven seal-flush pump: only the aux-pump story blames it */}
      <Solid {...common} color={p.body} lit={hot("aux")} position={[0.85, 0.62, 0.42]}>
        <boxGeometry args={[0.24, 0.24, 0.2]} />
      </Solid>
    </group>
  );
}

export function MachineScene({
  vibration,
  pattern = "steady",
  highlight = null,
  marker = null,
  openBearing = false,
  partLabel,
  palette,
  reduceMotion = false,
  onAnchor,
  fallback = null,
  className,
  ariaLabel = "The pump set: motor, drive-end bearing, coupling and pump",
}: MachineSceneProps) {
  const webgl = useMemo(hasWebGL, []);
  const p = useMemo(() => palette ?? scenePalette(), [palette]);
  if (!webgl) return <>{fallback}</>;
  const markerAt = marker === "feet" ? FEET : DRIVE_END;
  return (
    <div className={className} role="img" aria-label={ariaLabel}>
      <Canvas
        orthographic
        dpr={[1, 2]}
        camera={{ position: [4.5, 3.2, 5.5], zoom: 112, near: 0.1, far: 50 }}
        frameloop={reduceMotion && !openBearing && !onAnchor ? "demand" : "always"}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <Fit />
          <ambientLight intensity={1.2} />
          <directionalLight position={[3, 6, 4]} intensity={1.5} />
          <group position={[0, -0.6, 0]}>
            <Shaker vibration={vibration} pattern={pattern} reduceMotion={reduceMotion}>
              <PumpSet p={p} highlight={highlight} openBearing={openBearing} partLabel={partLabel} />
            </Shaker>
            {marker && <Marker at={markerAt} color={p.marker} reduceMotion={reduceMotion} />}
          </group>
          {onAnchor && <Anchor at={markerAt} onAnchor={onAnchor} />}
        </Suspense>
      </Canvas>
    </div>
  );
}
