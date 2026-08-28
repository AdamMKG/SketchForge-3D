import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectAssetIdsInShapes, sha256Hex, sourceFormatForFileName } from "@/lib/projectAssets";
import type { WorkplaneShape } from "@/types/sketchforge";

const utf8 = new TextEncoder();

function textShape(id: string, font: string): WorkplaneShape {
  return {
    id,
    name: "Text",
    kind: "text",
    color: "#12a4cc",
    x: 0,
    z: 0,
    size: 86,
    width: 86,
    depth: 28,
    height: 10,
    rotation: 0,
    text: "HI",
    font,
  };
}

describe("project asset hashing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ])("computes SHA-256 without Web Crypto for %j", async (input, expected) => {
    vi.stubGlobal("crypto", {});
    await expect(sha256Hex(utf8.encode(input))).resolves.toBe(expected);
  });

  it.each([55, 56, 63, 64, 65, 1024, 4097])("matches Node SHA-256 for %i binary bytes", async (length) => {
    const bytes = Uint8Array.from({ length }, (_value, index) => (index * 37 + 11) & 0xff);
    const expected = createHash("sha256").update(bytes).digest("hex");
    vi.stubGlobal("crypto", {});
    await expect(sha256Hex(bytes)).resolves.toBe(expected);
  });
});

describe("font file detection", () => {
  it("maps font extensions to the typeface source format", () => {
    expect(sourceFormatForFileName("Inter-Bold.ttf")).toBe("typeface");
    expect(sourceFormatForFileName("font.OTF")).toBe("typeface");
    expect(sourceFormatForFileName("hinted.woff2")).toBe("typeface");
    expect(sourceFormatForFileName("catalog.woff")).toBe("typeface");
    expect(sourceFormatForFileName("model.stl")).toBe("stl");
    expect(sourceFormatForFileName("image.svg")).toBe("svg");
    expect(sourceFormatForFileName("part.step")).toBe("step");
    expect(sourceFormatForFileName("part.stp")).toBe("step");
    expect(sourceFormatForFileName("document.pdf")).toBeNull();
    expect(sourceFormatForFileName("no-extension")).toBeNull();
  });

  it("collects custom font asset ids from text shapes while skipping built-in fonts", () => {
    const shapes: WorkplaneShape[] = [
      textShape("custom-text", "asset-font-1"),
      textShape("builtin-text", "Sans"),
      {
        ...textShape("default-text", undefined as unknown as string),
        groupedShapes: [
          textShape("nested-custom", "asset-font-2"),
          textShape("nested-builtin", "Multilanguage"),
        ],
      },
    ];
    expect([...projectAssetIdsInShapes(shapes)]).toEqual(["asset-font-1", "asset-font-2"]);
  });
});
