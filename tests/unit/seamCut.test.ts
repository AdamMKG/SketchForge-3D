import { describe, expect, it } from "vitest";
import {
  clampSeamKeyCount,
  layoutSeamKeys,
  maxSeamKeyCount,
  seamKeySocketPolygon,
  seamKeyTenonPolygon,
  seamLineInterval,
  seamPlaneCorners,
  seamPlaneFromPoints,
  type SeamBox,
  type SeamKeySpec,
} from "@/lib/seamCut";

const BOX: SeamBox = { minX: -30, minY: 0, maxX: 30, minZ: -20, maxY: 40, maxZ: 20 };

function baseSpec(overrides: Partial<SeamKeySpec> = {}): SeamKeySpec {
  return {
    keyNum: 5,
    keyWidth: 8,
    keyDepth: 6,
    keyThroat: 3,
    keyFlare: 4,
    keyBuried: 4,
    keyGap: 10,
    endMargin: 4,
    clearance: 0.1,
    ...overrides,
  };
}

function dot(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function approx(value: number, expected: number, epsilon = 1e-6) {
  expect(Math.abs(value - expected)).toBeLessThan(epsilon);
}

describe("seamPlaneFromPoints", () => {
  it("builds a plane perpendicular to the face containing both picked points", () => {
    const p1 = [0, 20, 0] as const;
    const p2 = [10, 20, -15] as const;
    const plane = seamPlaneFromPoints([...p1], [0, 1, 0], [...p2]);
    expect(plane).not.toBeNull();
    const { normal, tangent, faceUp, point } = plane!;
    approx(dot(normal, tangent), 0);
    approx(dot(faceUp, tangent), 0);
    approx(dot([p2[0] - point[0], p2[1] - point[1], p2[2] - point[2]], normal), 0);
    // Plane normal has no vertical component for a horizontal face seam.
    approx(normal[1], 0);
  });

  it("rejects coincident or surface-perpendicular picks", () => {
    expect(seamPlaneFromPoints([0, 0, 0], [0, 1, 0], [0, 0, 0])).toBeNull();
    expect(seamPlaneFromPoints([0, 0, 0], [0, 1, 0], [0, 5, 0])).toBeNull();
  });
});

describe("seamLineInterval", () => {
  it("clamps a seam line crossing a box to its full height range", () => {
    const plane = seamPlaneFromPoints([0, 20, 0], [0, 1, 0], [0, 20, 10])!;
    const interval = seamLineInterval(BOX, plane);
    expect(interval).not.toBeNull();
    // Seam along +Z through the box: covers the entire Z depth span.
    approx(interval![0], -20, 1e-9);
    approx(interval![1], 20, 1e-9);
  });

  it("returns null when the line misses the box", () => {
    const plane = seamPlaneFromPoints([0, 20, 60], [0, 1, 0], [10, 20, 60])!;
    expect(seamLineInterval(BOX, plane)).toBeNull();
  });

  it("clamps a vertical seam to the box height with a 0 offset", () => {
    const plane = seamPlaneFromPoints([0, 20, -20], [0, 1, 0], [0, 20, -20 + 10])!;
    const [lo, hi] = seamLineInterval(BOX, plane)!;
    approx(lo, 0, 1e-9);
    approx(hi, 40, 1e-9);
  });
});

describe("seam key counts", () => {
  it("fits the largest whole number of keys in a span with margins", () => {
    const span = 40;
    const count = maxSeamKeyCount(span, 8, 10, 4);
    // usable = 32; keys are 8 wide + 10 gap => 2 keys use 26, 3 use 44.
    expect(count).toBe(2);
  });

it("clamps requests to the available maximum", () => {
    expect(clampSeamKeyCount(9, 40, 8, 10, 4)).toBe(2);
    expect(clampSeamKeyCount(0, 40, 8, 10, 4)).toBe(0);
  });

  it("returns zero when the span cannot fit a key", () => {
    expect(maxSeamKeyCount(4, 8, 10, 4)).toBe(0);
  });
});

describe("layoutSeamKeys", () => {
  it("places keys centered on the seam line within the clamped interval", () => {
    const plane = seamPlaneFromPoints([0, 20, 0], [0, 1, 0], [0, 20, 10])!;
    const layout = layoutSeamKeys(plane, BOX, baseSpec({ keyNum: 2 }));
    expect(layout).not.toBeNull();
    expect(layout!.count).toBe(2);
    const first = layout!.keys[0];
    const second = layout!.keys[1];
    // Keys lie on the seam line: x = 0, y = 20, symmetric about the box center.
    approx(first.center[0], 0);
    approx(first.center[1], 20);
    approx(second.center[0], 0);
    approx(second.center[1], 20);
    approx(first.center[2], -12, 1e-9);
    approx(second.center[2], 12, 1e-9);
  });

  it("clamps excessive key counts to what fits", () => {
    const plane = seamPlaneFromPoints([0, 20, 0], [0, 1, 0], [0, 20, 10])!;
    const layout = layoutSeamKeys(plane, BOX, baseSpec({ keyNum: 50 }));
    expect(layout!.count).toBe(2);
  });

  it("uses dovetail tenon and enlarged socket polygons", () => {
    const plane = seamPlaneFromPoints([0, 20, 0], [0, 1, 0], [0, 20, 10])!;
    const layout = layoutSeamKeys(plane, BOX, baseSpec())!;
    expect(layout.tenonPolygon).toEqual(seamKeyTenonPolygon(baseSpec()));
    const socket = seamKeySocketPolygon(baseSpec());
    // Socket flares wider than the tenon at the tip (positive-V tip corner).
    expect(socket[3][1]).toBeGreaterThan(layout.tenonPolygon[3][1]);
    // Clearance widens throat and extends depth.
    expect(socket[1][1]).toBeCloseTo(-(baseSpec().keyThroat + baseSpec().clearance));
    expect(socket[2][0]).toBeCloseTo(baseSpec().keyDepth + baseSpec().clearance);
  });
});

describe("seamPlaneCorners", () => {
  it("returns four coplanar corners spanning the seam plane patch", () => {
    const plane = seamPlaneFromPoints([0, 20, 0], [0, 1, 0], [0, 20, 10])!;
    const corners = seamPlaneCorners(BOX, plane);
    expect(corners).not.toBeNull();
    expect(corners!.length).toBe(4);
    // All corners sit on the cut plane (x = 0) and adjacent edges are perpendicular.
    corners!.forEach((corner) => approx(corner[0], 0));
    const edges = [
      [corners![1][0] - corners![0][0], corners![1][1] - corners![0][1], corners![1][2] - corners![0][2]],
      [corners![2][0] - corners![1][0], corners![2][1] - corners![1][1], corners![2][2] - corners![1][2]],
    ];
    approx(dot(edges[0], edges[1]), 0);
    const ys = corners!.map((corner) => corner[1]);
    const zs = corners!.map((corner) => corner[2]);
    // Blade covers the full box section with a small pad on each side.
    approx(Math.min(...ys), 0 - 4, 1e-9);
    approx(Math.max(...ys), 40 + 4, 1e-9);
    approx(Math.min(...zs), -20 - 4, 1e-9);
    approx(Math.max(...zs), 20 + 4, 1e-9);
  });
});