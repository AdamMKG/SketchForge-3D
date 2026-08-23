import { describe, expect, it } from "vitest";
import { normalizedRotationPlaneBasis } from "@/components/workplane/transformOverlayTypes";

describe("rotation handle projection", () => {
  it("preserves face-plane foreshortening while normalizing icon size", () => {
    expect(normalizedRotationPlaneBasis({ x: 10, y: 20, a: 2, b: 0, c: 0.5, d: 1 })).toEqual({
      a: 1,
      b: 0,
      c: 0.25,
      d: 0.5,
    });
  });

  it("turns an upper arrow upright without detaching it from the face plane", () => {
    expect(normalizedRotationPlaneBasis({ x: 10, y: 20, a: 2, b: 0, c: 0.5, d: 1 }, true)).toEqual({
      a: 1,
      b: 0,
      c: -0.25,
      d: -0.5,
    });
  });

  it("falls back to a screen-facing icon for a collapsed projection", () => {
    expect(normalizedRotationPlaneBasis({ x: 10, y: 20, a: 0, b: 0, c: 0, d: 0 })).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
    });
  });
});
