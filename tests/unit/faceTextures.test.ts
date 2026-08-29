import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { WorkplaneShape } from "@/types/sketchforge";
import {
  applyFaceTexturesToGeometry,
  computeShapeFaces,
  faceIdForNormal,
  faceLabelForId,
  faceTextureGeometryToken,
  faceTextureMaterialToken,
  hasFaceTextures,
  isFaceTextureSupportedKind,
} from "@/lib/faceTextures";

function shape(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
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
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

// Builds an interleaved triangle soup for a 2x2x2 box (each of the 6 faces has
// 2 triangles, scattered across the buffer) so the clustering + reorder path in
// `applyFaceTexturesToGeometry` can be exercised.
function interleavedBoxSoup(): THREE.BufferGeometry {
  const quad = (normal: [number, number, number], corners: number[][]) => {
    const pick = (a: number[], b: number[], c: number[]): number[] => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      return [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    };
    const oriented = (p0: number[], p1: number[], p2: number[]) => {
      const [nx, ny, nz] = pick(p0, p1, p2);
      if (nx * normal[0] + ny * normal[1] + nz * normal[2] < 0) return [p0, p2, p1];
      return [p0, p1, p2];
    };
    const [p0, p1, p2, p3] = corners;
    return [oriented(p0, p1, p2), oriented(p0, p2, p3)];
  };
  const face = (normal: [number, number, number], corners: number[][]) => quad(normal, corners);
  const [px0, px1] = face([1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]);
  const [nx0, nx1] = face([-1, 0, 0], [[-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1]]);
  const [py0, py1] = face([0, 1, 0], [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]);
  const [ny0, ny1] = face([0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]);
  const [pz0, pz1] = face([0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]);
  const [nz0, nz1] = face([0, 0, -1], [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]]);
  const order = [px0, nx0, py0, ny0, pz0, nz0, px1, nx1, py1, ny1, pz1, nz1];
  const positions = new Float32Array(order.length * 9);
  order.forEach((triangle, index) => {
    for (let corner = 0; corner < 3; corner += 1) {
      positions[index * 9 + corner * 3 + 0] = triangle[corner][0];
      positions[index * 9 + corner * 3 + 1] = triangle[corner][1];
      positions[index * 9 + corner * 3 + 2] = triangle[corner][2];
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

describe("faceTextures helpers", () => {
  it("maps normals to face ids", () => {
    expect(faceIdForNormal(new THREE.Vector3(0, 1, 0))).toBe("top");
    expect(faceIdForNormal(new THREE.Vector3(0, -1, 0))).toBe("bottom");
    expect(faceIdForNormal(new THREE.Vector3(0, 0, 1))).toBe("front");
    expect(faceIdForNormal(new THREE.Vector3(1, 0, 0))).toBe("right");
    expect(faceIdForNormal(new THREE.Vector3(0.5, 0.5, 0.7))).toBe("frontSlope");
  });

  it("labels face ids", () => {
    expect(faceLabelForId("top")).toBe("Top");
    expect(faceLabelForId("frontSlope")).toBe("FrontSlope");
    expect(faceLabelForId("surface-0")).toBe("Surface 0");
    expect(faceLabelForId("surface-12")).toBe("Surface 12");
  });

  it("supports meshes but rejects sketch bodies", () => {
    expect(isFaceTextureSupportedKind("box")).toBe(true);
    expect(isFaceTextureSupportedKind("mesh")).toBe(true);
    expect(isFaceTextureSupportedKind("sketch")).toBe(false);
  });

  it("treats holes and empty face maps as untextured", () => {
    expect(hasFaceTextures(shape())).toBe(false);
    expect(hasFaceTextures(shape({ hole: true, faceTextures: { top: { dataUrl: "data:image/png;base64,x", mimeType: "image/png", pixelWidth: 2, pixelHeight: 2, useAsBump: false, bumpScale: 0.05 } } }))).toBe(false);
    expect(hasFaceTextures(shape({ faceTextures: { top: { dataUrl: "data:image/png;base64,x", mimeType: "image/png", pixelWidth: 2, pixelHeight: 2, useAsBump: false, bumpScale: 0.05 } } }))).toBe(true);
  });
});

describe("computeShapeFaces", () => {
  it("derives six grouped faces for a box", () => {
    const faces = computeShapeFaces(shape(), new THREE.BoxGeometry(2, 2, 2));
    expect(faces.map((face) => face.id)).toEqual(["px", "nx", "py", "ny", "pz", "nz"]);
    expect(faces.map((face) => face.label)).toEqual(["Right", "Left", "Top", "Bottom", "Front", "Back"]);
  });

  it("derives side/top/bottom for a cylinder", () => {
    const faces = computeShapeFaces(shape({ kind: "cylinder" }), new THREE.CylinderGeometry(1, 1, 2, 24));
    expect(faces.map((face) => face.id)).toEqual(["side", "top", "bottom"]);
  });

  it("collapses a rounded box to a single surface", () => {
    const faces = computeShapeFaces(shape({ radius: 0.25 }), new THREE.BoxGeometry(2, 2, 2, 3, 3, 3));
    expect(faces).toHaveLength(1);
    expect(faces[0].id).toBe("surface");
  });

  it("clusters a flat custom builder by normal", () => {
    const faces = computeShapeFaces(shape({ kind: "wedge" }), interleavedBoxSoup());
    expect(faces.length).toBeGreaterThanOrEqual(6);
    faces.forEach((face) => expect(face.triangles.length).toBe(2));
  });

  it("reorders clustered triangles into contiguous groups with generated UVs", () => {
    const geometry = interleavedBoxSoup();
    const textured = shape({
      kind: "wedge",
      faceTextures: { front: { dataUrl: "data:image/png;base64,x", mimeType: "image/png", pixelWidth: 2, pixelHeight: 2, useAsBump: false, bumpScale: 0.05 } },
    });
    applyFaceTexturesToGeometry(geometry, textured);

    expect(geometry.getAttribute("uv")).toBeDefined();
    const faces = computeShapeFaces(textured, geometry);
    expect(geometry.groups.length).toBe(faces.length);
    geometry.groups.forEach((group) => {
      expect(group.count % 3).toBe(0);
      expect(group.materialIndex).toBeGreaterThanOrEqual(0);
    });

    const uvs = geometry.getAttribute("uv");
    const face = faces.find((candidate) => candidate.id === "front");
    expect(face).toBeDefined();
    for (let triangle = 0; triangle < face!.triangles.length; triangle += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        const u = uvs.getX(face!.triangles[triangle] * 3 + corner);
        const v = uvs.getY(face!.triangles[triangle] * 3 + corner);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("mesh face clustering", () => {
  it("clusters a mesh into deterministic surface-N faces", () => {
    const faces = computeShapeFaces(shape({ kind: "mesh" }), interleavedBoxSoup());
    expect(faces.length).toBe(6);
    faces.forEach((face, index) => {
      expect(face.id).toBe(`surface-${index}`);
      expect(face.label).toBe(`Surface ${index}`);
      expect(face.uv).toBe("planar");
      expect(face.normal).not.toBeNull();
    });
    const covered = faces.reduce((sum, face) => sum + face.triangles.length, 0);
    expect(covered).toBe(12);
  });

  it("keeps mesh face ids and triangle sets stable across runs", () => {
    const first = computeShapeFaces(shape({ kind: "mesh" }), interleavedBoxSoup());
    const second = computeShapeFaces(shape({ kind: "mesh" }), interleavedBoxSoup());
    expect(first.map((face) => face.id)).toEqual(second.map((face) => face.id));
    first.forEach((face) => {
      const again = second.find((candidate) => candidate.id === face.id);
      expect(again).toBeDefined();
      expect(again!.triangles).toEqual(face.triangles);
    });
  });

  it("caps curved meshes to at most MAX_MESH_FACES with full coverage", () => {
    const geometry = new THREE.SphereGeometry(1, 12, 8).toNonIndexed();
    const triangleCount = geometry.getAttribute("position").count / 3;
    const faces = computeShapeFaces(shape({ kind: "mesh" }), geometry);
    expect(faces.length).toBeLessThanOrEqual(16);
    const covered = faces.reduce((sum, face) => sum + face.triangles.length, 0);
    expect(covered).toBe(triangleCount);
  });

  it("reorders a textured mesh into contiguous groups with generated UVs", () => {
    const geometry = interleavedBoxSoup();
    const textured = shape({
      kind: "mesh",
      faceTextures: { "surface-0": { dataUrl: "data:image/png;base64,x", mimeType: "image/png", pixelWidth: 2, pixelHeight: 2, useAsBump: false, bumpScale: 0.05 } },
    });
    applyFaceTexturesToGeometry(geometry, textured);

    expect(geometry.getAttribute("uv")).toBeDefined();
    const faces = computeShapeFaces(textured, geometry);
    expect(geometry.groups.length).toBe(faces.length);
    expect(geometry.groups.reduce((sum, group) => sum + group.count, 0)).toBe(geometry.getAttribute("position").count);
    geometry.groups.forEach((group) => {
      expect(group.count % 3).toBe(0);
      expect(group.materialIndex).toBeGreaterThanOrEqual(0);
    });

    const uvs = geometry.getAttribute("uv");
    const face = faces.find((candidate) => candidate.id === "surface-0");
    expect(face).toBeDefined();
    for (let triangle = 0; triangle < face!.triangles.length; triangle += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        expect(uvs.getX(face!.triangles[triangle] * 3 + corner)).toBeGreaterThanOrEqual(0);
        expect(uvs.getX(face!.triangles[triangle] * 3 + corner)).toBeLessThanOrEqual(1);
        expect(uvs.getY(face!.triangles[triangle] * 3 + corner)).toBeGreaterThanOrEqual(0);
        expect(uvs.getY(face!.triangles[triangle] * 3 + corner)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("tokens serialize surface-N ids", () => {
    const textured = shape({
      kind: "mesh",
      faceTextures: { "surface-0": { dataUrl: "data:image/png;base64,x", mimeType: "image/png", pixelWidth: 2, pixelHeight: 2, useAsBump: false, bumpScale: 0.05 } },
    });
    expect(faceTextureGeometryToken(textured)).toContain("surface-0");
    expect(faceTextureMaterialToken(textured)).toContain("surface-0");
  });
});

describe("face texture tokens", () => {
  it("tokens change with textures", () => {
    const base = shape();
    const textured = shape({
      faceTextures: { top: { dataUrl: "data:image/png;base64,x", mimeType: "image/png", pixelWidth: 2, pixelHeight: 2, useAsBump: false, bumpScale: 0.05 } },
    });
    expect(faceTextureGeometryToken(base)).toBe("");
    expect(faceTextureGeometryToken(textured)).toBe("top");

    const bump = shape({
      faceTextures: { top: { dataUrl: "data:image/png;base64,x", mimeType: "image/png", pixelWidth: 2, pixelHeight: 2, useAsBump: true, bumpScale: 0.2 } },
    });
    expect(faceTextureMaterialToken(textured)).not.toBe(faceTextureMaterialToken(bump));
  });
});
