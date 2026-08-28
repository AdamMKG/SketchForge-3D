import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { WorkplaneShape } from "@/types/sketchforge";
import { applyReliefToGeometry, hasReliefFaces } from "@/lib/textureRelief";

function boxShape(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "box-1",
    name: "Box",
    kind: "box",
    color: "#d41721",
    x: 0,
    z: 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 10,
    rotation: 0,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

function faceIds(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  const seen = new Set<string>();
  for (let i = 0; i < position.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, i);
    const b = new THREE.Vector3().fromBufferAttribute(position, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(position, i + 2);
    const normal = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(b, a),
      new THREE.Vector3().subVectors(c, a),
    );
    if (normal.lengthSq() < 1e-9) continue;
    normal.normalize();
    const ax = Math.abs(normal.x);
    const ay = Math.abs(normal.y);
    const az = Math.abs(normal.z);
    if (ay > 0.98) seen.add(normal.y > 0 ? "top" : "bottom");
    else if (az > 0.98) seen.add(normal.z > 0 ? "front" : "back");
    else seen.add(normal.x > 0 ? "right" : "left");
  }
  return seen;
}

describe("textureRelief", () => {
  it("hasReliefFaces reports textured shapes", () => {
    const texture = { dataUrl: "data:image/png;base64,aa", mimeType: "image/png", pixelWidth: 2, pixelHeight: 2, useAsBump: false, bumpScale: 1 };
    expect(hasReliefFaces(boxShape())).toBe(false);
    expect(hasReliefFaces(boxShape({ faceTextures: { py: texture } }))).toBe(true);
  });

  it("subdivides only textured faces and displaces along the face normal", () => {
    const shape = boxShape();
    const geometry = new THREE.BoxGeometry(20, 10, 20);
    const result = applyReliefToGeometry(
      geometry,
      shape,
      { depthMm: 2, detail: 3 },
      (face) => (face.id === "py" ? () => 1 : null),
    );

    expect(result).not.toBe(geometry);
    const position = result.getAttribute("position");
    expect(result.index).toBeTruthy();
    // 6 box faces * 2 triangles, top face subdivided into 2 * detail^2.
    const expectedTriangles = 5 * 2 + 2 * 3 * 3;
    expect((result.index as THREE.BufferAttribute).count / 3).toBe(expectedTriangles);

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < position.count; i += 1) {
      minY = Math.min(minY, position.getY(i));
      maxY = Math.max(maxY, position.getY(i));
    }
    // Top face pushed +depth/2 = +1mm along +Y, bottom face untouched.
    expect(maxY).toBeCloseTo(6, 5);
    expect(minY).toBeCloseTo(-5, 5);

    // All six faces are still present and outward-facing (winding preserved).
    expect(faceIds(result)).toEqual(new Set(["top", "bottom", "front", "back", "right", "left"]));
    result.dispose();
  });

  it("samples luminance per vertex across the face repeat", () => {
    const shape = boxShape();
    const geometry = new THREE.BoxGeometry(20, 10, 20);
    const result = applyReliefToGeometry(
      geometry,
      shape,
      { depthMm: 2, detail: 4 },
      (face) => {
        if (face.id !== "py") return null;
        return (u) => (u < 0.5 ? 0 : 1);
      },
    );
    const position = result.getAttribute("position");
    const raised: number[] = [];
    const sunken: number[] = [];
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      if (position.getY(i) > 5.9) raised.push(x);
      if (position.getY(i) < 4.1) sunken.push(x);
    }
    // u=0 sits at -x and u=1 wraps back to the first texel, so bright tiles rise
    // on the +x half (including the u=0.5 midline) while dark tiles sink on the
    // -x half and along the wrap seam.
    expect(raised.length).toBeGreaterThan(0);
    expect(sunken.length).toBeGreaterThan(0);
    expect(Math.min(...raised)).toBeGreaterThanOrEqual(0);
    expect(sunken.some((x) => x < 0)).toBe(true);
    result.dispose();
  });

  it("returns an equivalent, non-displaced geometry when nothing is displaced", () => {
    const shape = boxShape();
    const geometry = new THREE.BoxGeometry(20, 10, 20);
    const result = applyReliefToGeometry(geometry, shape, { depthMm: 0, detail: 3 }, () => null);
    // The indexed input is decomposed for processing, so a fresh geometry comes
    // back rather than the input instance itself.
    expect(result).not.toBe(geometry);
    // The indexed input is decomposed for processing, so the flat copy that
    // comes back is non-indexed and undivided.
    expect(result.index).toBeNull();
    expect(result.getAttribute("position").count).toBe(36);
    const position = result.getAttribute("position");
    let maxY = -Infinity;
    for (let i = 0; i < position.count; i += 1) {
      maxY = Math.max(maxY, position.getY(i));
    }
    expect(maxY).toBeCloseTo(5, 5);
    result.dispose();
  });
});
