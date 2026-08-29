import { beforeAll, describe, expect, it } from "vitest";
import manifoldModule, { type ManifoldToplevel } from "manifold-3d";
import * as THREE from "three";
import {
  DEFAULT_SEAM_OPTIONS,
  layoutSeamKeys,
  seamKeySpecFromOptions,
  seamPlaneFromPoints,
  type SeamKeyCenter,
  type SeamPlane,
} from "@/lib/seamCut";

// Integration check for the manifold seam cut (mirrors the algorithm in
// SketchForgeEditor.seamCutHalfShapes) so the physical dovetail invariants are
// guarded: the flared tip must sit deep inside the socket half and the key
// prism must be centered on its seam-line slot.
//
// Box: x∈[-30,30] width 60, y∈[0,40] height 40, z∈[-20,20] depth 40.
// Seam: top face y=20 crossing along +Z. plane.normal = +X, faceUp = +Y,
// tangent = +Z. The +X side (aSide = +1) keeps the pins by default.

type Solid = ReturnType<ManifoldToplevel["Manifold"]["cube"]>;

const spec = seamKeySpecFromOptions(DEFAULT_SEAM_OPTIONS);
const keyDepth = DEFAULT_SEAM_OPTIONS.keyDepth;
const keyWidth = DEFAULT_SEAM_OPTIONS.keyWidth;

describe("seam cut solid geometry", () => {
  let runtime: ManifoldToplevel;

  beforeAll(async () => {
    runtime = await manifoldModule();
    runtime.setup();
  });

  function boxSolid() {
    const cross = new runtime.CrossSection([
      [
        [-30, 0],
        [30, 0],
        [30, 40],
        [-30, 40],
      ],
    ]);
    return cross.extrude(40).translate([0, 0, -20]);
  }

  function keyMatrix(center: SeamKeyCenter["center"], plane: SeamPlane) {
    const matrix = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(plane.normal[0], plane.normal[1], plane.normal[2]),
      new THREE.Vector3(plane.faceUp[0], plane.faceUp[1], plane.faceUp[2]),
      new THREE.Vector3(plane.tangent[0], plane.tangent[1], plane.tangent[2]),
    );
    matrix.setPosition(new THREE.Vector3(center[0], center[1], center[2]));
    return matrix.elements as unknown as Parameters<Solid["transform"]>[0];
  }

  function keyPrism(plane: SeamPlane, key: SeamKeyCenter, polygon: number[][], width: number) {
    const cross = new runtime.CrossSection([polygon]);
    const extruded = cross.extrude(width);
    const centered = extruded.translate([0, 0, -width / 2]);
    return centered.transform(keyMatrix(key.center, plane));
  }

  function meshVertices(solid: Solid) {
  const mesh = solid.getMesh();
  const props = mesh.vertProperties as unknown as Float32Array;
  const stride = mesh.numProp;
  const cols = (mesh.triVerts as unknown as Uint32Array);
  const out: number[] = [];
  for (let i = 0; i < cols.length; i += 1) {
    const base = cols[i] * stride;
    out.push(props[base], props[base + 1], props[base + 2]);
  }
  return { positions: out, weighted: (weights: number[]) =>
    weights.map((w) => out[w]) };
}

function meshBounds(solid: Solid) {
  const { positions } = meshVertices(solid);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function sideSign(half: Solid, plane: SeamPlane, offset: number) {
  const { positions } = meshVertices(half);
  let total = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    total += positions[i] * plane.normal[0] + positions[i + 1] * plane.normal[1] + positions[i + 2] * plane.normal[2];
  }
  const vertexCount = Math.max(1, positions.length / 3);
  return total / vertexCount >= offset ? 1 : -1;
}

  it("flares the tenon tip into the socket half so the halves key together", () => {
    const plane = seamPlaneFromPoints([0, 20, 0], [0, 1, 0], [0, 20, 10])!;
    expect(plane.normal[0]).toBeCloseTo(1, 6);
    expect(plane.normal[1]).toBeCloseTo(0, 6);
    expect(plane.tangent[2]).toBeCloseTo(1, 6);
    expect(plane.faceUp[1]).toBeCloseTo(1, 6);

    const box = boxSolid();
    const offset = plane.normal[0] * plane.point[0] + plane.normal[1] * plane.point[1] + plane.normal[2] * plane.point[2];
    const [a, b] = box.splitByPlane(plane.normal, offset);
    const boxBounds = { minX: -30, minY: 0, minZ: -20, maxX: 30, maxY: 40, maxZ: 20 };

    const layout = layoutSeamKeys(plane, boxBounds, spec, -1);
    expect(layout).not.toBeNull();
    expect(layout!.count).toBeGreaterThan(0);

    const tenons = layout!.keys.map((key) => keyPrism(plane, key, layout!.tenonPolygon, spec.keyWidth));
    const sockets = layout!.keys.map((key) =>
      keyPrism(plane, key, layout!.socketPolygon, spec.keyWidth + 2 * DEFAULT_SEAM_OPTIONS.clearance),
    );

    const pinSide = 1;
    const aSide = sideSign(a, plane, offset);
    const pinHalf = aSide === pinSide ? a : b;
    const socketHalf = aSide === pinSide ? b : a;

    const pin = runtime.Manifold.union([pinHalf, ...tenons]);
    const socket = runtime.Manifold.difference([socketHalf, ...sockets]);
    const pinBounds = meshBounds(pin);

    // The pin half solid must protrude at least keyDepth past the seam plane
    // into the socket half (-X): the flared tip sits deep in the socket.
    expect(pinBounds.minX).toBeLessThan(-(keyDepth - 1e-6));
    expect(pinBounds.minX).toBeGreaterThan(-(keyDepth + 0.5));
    // The socket half keeps its full -X side; the mortise does not blow through
    // to the +X side and leaves at least keyDepth of wall for the flare.
    const socketBounds = meshBounds(socket);
    expect(socketBounds.maxX).toBeLessThanOrEqual(1e-6);
    expect(socketBounds.minX).toBeLessThanOrEqual(-30);

    // Data-level lock check: the dovetail tip is wider than the throat opening,
    // so the flared end cannot be pulled out through the seam-plane opening.
    const tenonTipHalfWidth = Math.abs(layout!.tenonPolygon[0][1]);
    expect(tenonTipHalfWidth).toBeGreaterThan(spec.keyThroat + spec.clearance);
  }, 30000);

  it("centers the key prism on its seam-line slot", () => {
    const plane = seamPlaneFromPoints([0, 20, 0], [0, 1, 0], [0, 20, 10])!;
    const layout = layoutSeamKeys(
      plane,
      { minX: -30, minY: 0, minZ: -20, maxX: 30, maxY: 40, maxZ: 20 },
      spec,
      -1,
    )!;
    const first = layout.keys[0];
    const prism = keyPrism(plane, first, layout.tenonPolygon, spec.keyWidth);
    const { minZ, maxZ, minX } = meshBounds(prism);
    // Centered on the key center along the seam tangent.
    expect(minZ).toBeCloseTo(first.center[2] - keyWidth / 2, 6);
    expect(maxZ).toBeCloseTo(first.center[2] + keyWidth / 2, 6);
    // Flared tip reaches keyDepth into the socket half.
    expect(minX).toBeCloseTo(-keyDepth, 6);
  });
});