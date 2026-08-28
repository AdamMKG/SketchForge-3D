import { describe, expect, it } from "vitest";
import type { WorkplaneShape } from "@/types/sketchforge";
import {
  distributionCloneShapes,
  distributionPitch,
  distributionTileBounds,
  distributionUnitCount,
  isValidDistributionOptions,
  type DistributionOptions,
} from "@/lib/shapeDistribution";

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

function options(overrides: Partial<DistributionOptions> = {}): DistributionOptions {
  return {
    layout: "horizontal",
    count: 3,
    columns: 3,
    rows: 3,
    spacingX: 10,
    spacingZ: 10,
    ...overrides,
  };
}

describe("shape distribution helpers", () => {
  it("measures the union tile bounds of the selected shapes", () => {
    expect(distributionTileBounds([shape()])).toEqual({ width: 20, depth: 20 });
    expect(
      distributionTileBounds([
        shape({ x: 0, width: 20, depth: 20 }),
        shape({ id: "box-2", x: 30, width: 10, depth: 30 }),
      ]),
    ).toEqual({ width: 45, depth: 30 });
    expect(distributionTileBounds([])).toEqual({ width: 0, depth: 0 });
  });

  it("computes edge-to-edge pitch from the tile size and spacing", () => {
    expect(distributionPitch(options(), 20, 20)).toEqual({ x: 30, z: 30 });
    expect(distributionPitch(options({ spacingX: 0, spacingZ: -5 }), 20, 20)).toEqual({ x: 20, z: 20 });
  });

  it("counts units including the original", () => {
    expect(distributionUnitCount(options({ layout: "horizontal", count: 5 }))).toBe(5);
    expect(distributionUnitCount(options({ layout: "grid", columns: 3, rows: 3 }))).toBe(9);
    expect(distributionUnitCount(options({ layout: "grid", columns: 2, rows: 4 }))).toBe(8);
    expect(distributionUnitCount(options({ layout: "grid", columns: 0, rows: 3 }))).toBe(0);
  });

  it("rejects arrangements with no copies or invalid spacing", () => {
    expect(isValidDistributionOptions(options({ layout: "horizontal", count: 1 }), 20, 20)).toBe(false);
    expect(isValidDistributionOptions(options({ layout: "grid", columns: 1, rows: 1 }), 20, 20)).toBe(false);
    expect(isValidDistributionOptions(options({ layout: "horizontal", count: 3 }), 0, 20)).toBe(true);
    expect(isValidDistributionOptions(options({ layout: "horizontal", count: 3 }), 20, 0)).toBe(true);
    expect(isValidDistributionOptions(options({ layout: "vertical", count: 3, spacingX: 0, spacingZ: 0 }), 20, 0)).toBe(false);
    expect(isValidDistributionOptions(options({ layout: "grid", columns: 2, rows: 2, spacingX: 0, spacingZ: 0 }), 0, 20)).toBe(false);
  });

  it("distributes copies along the x axis for horizontal layouts", () => {
    const clones = distributionCloneShapes([shape()], options({ layout: "horizontal", count: 4 }));
    expect(clones).toHaveLength(3);
    expect(clones.map((clone) => [clone.x, clone.z])).toEqual([
      [30, 0],
      [60, 0],
      [90, 0],
    ]);
  });

  it("distributes copies along the z axis for vertical layouts", () => {
    const clones = distributionCloneShapes([shape()], options({ layout: "vertical", count: 4 }));
    expect(clones).toHaveLength(3);
    expect(clones.map((clone) => [clone.x, clone.z])).toEqual([
      [0, 30],
      [0, 60],
      [0, 90],
    ]);
  });

  it("builds a rows by columns grid with the original as the first cell", () => {
    const clones = distributionCloneShapes([shape()], options({ layout: "grid", columns: 3, rows: 3 }));
    expect(clones).toHaveLength(8);
    expect(clones.map((clone) => [clone.x, clone.z])).toEqual([
      [30, 0],
      [60, 0],
      [0, 30],
      [30, 30],
      [60, 30],
      [0, 60],
      [30, 60],
      [60, 60],
    ]);
  });

  it("repeats the whole selection as a tile unit", () => {
    const selection = [
      shape({ x: 0, width: 10, depth: 10 }),
      shape({ id: "box-2", x: 15, width: 10, depth: 10 }),
    ];
    const clones = distributionCloneShapes(selection, options({ layout: "horizontal", count: 2 }));
    expect(clones).toHaveLength(2);
    expect(clones.map((clone) => [clone.x, clone.z])).toEqual([
      [35, 0],
      [50, 0],
    ]);
  });

  it("keeps every other property and resets lock and visibility on copies", () => {
    const clones = distributionCloneShapes([shape({ locked: true, hidden: true, rotation: 45 })], options({ layout: "horizontal", count: 4 }));
    expect(clones[0].rotation).toBe(45);
    expect(clones[0].width).toBe(20);
    expect(clones[0].elevation).toBe(0);
    expect(clones[0].locked).toBe(false);
    expect(clones[0].hidden).toBe(false);
    expect(clones[0].id).toMatch(/^box-1-copy-/);
    expect(clones[0].id).not.toBe(clones[1].id);
    expect(clones[1].id).not.toBe(clones[2].id);
  });

  it("keeps grouped children at their local offsets", () => {
    const grouped = shape({
      kind: "mesh",
      groupedShapes: [shape({ id: "child-box", x: -5 })],
    });
    const clones = distributionCloneShapes([grouped], options({ layout: "horizontal", count: 2 }));
    expect(clones).toHaveLength(1);
    expect(clones[0].x).toBe(30);
    expect(clones[0].groupedShapes).toHaveLength(1);
    expect(clones[0].groupedShapes?.[0].x).toBe(-5);
    expect(clones[0].groupedShapes?.[0].id).toBe("child-box");
  });

  it("returns no clones for an empty selection", () => {
    expect(distributionCloneShapes([], options())).toEqual([]);
  });
});
