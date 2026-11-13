import { describe, expect, it } from "vitest";
import { SAMPLE_EXIF } from "../src/exif";
import { inspectImage, stripImage } from "../src/inspect";
import { parsePngChunks, pngIsValid, stripPng } from "../src/png";
import { CLEAN_PNG, SAMPLE_VALUES, buildSamplePng } from "../src/samples";

function tagsByLabel(tags: { label: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(tags.map((tag) => [tag.label, tag.value]));
}

describe("PNG inspection and stripping", () => {
  it("extracts eXIf, tEXt, iTXt and tIME from a synthetic PNG", () => {
    const png = buildSamplePng();
    const types = parsePngChunks(png).map((chunk) => chunk.type);
    expect(types).toContain("eXIf");
    expect(types).toContain("tEXt");
    expect(types).toContain("iTXt");
    expect(types).toContain("tIME");

    const inspection = inspectImage(png);
    const labels = tagsByLabel(inspection.tags);
    expect(inspection.format).toBe("png");
    expect(labels.Make).toBe(SAMPLE_EXIF.make);
    expect(labels.Model).toBe(SAMPLE_EXIF.model);
    expect(labels.DateTime).toBe(SAMPLE_EXIF.dateTime);
    expect(labels.Coordinates).toMatch(/° N, .*° W/);
    expect(labels.Author).toBe(SAMPLE_VALUES.author);
    expect(labels.Description).toBe(SAMPLE_VALUES.description);
    expect(labels["PNG tIME"]).toBe("2020-01-02 03:04:05");
  });

  it("strips metadata chunks, keeps a valid PNG, and re-parses to zero tags", () => {
    const png = buildSamplePng();
    const result = stripImage(png);
    expect(result.format).toBe("png");
    expect(pngIsValid(result.bytes)).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.remainingTags).toEqual([]);
    expect(result.afterBytes).toBeLessThan(result.beforeBytes);

    const types = parsePngChunks(result.bytes).map((chunk) => chunk.type);
    expect(types[0]).toBe("IHDR");
    expect(types).toContain("IDAT");
    expect(types[types.length - 1]).toBe("IEND");
    expect(types.some((type) => ["eXIf", "tEXt", "iTXt", "tIME", "zTXt"].includes(type))).toBe(false);
    expect(inspectImage(result.bytes).tags).toEqual([]);
  });

  it("handles a PNG that already has no metadata without breaking it", () => {
    const inspection = inspectImage(CLEAN_PNG);
    expect(inspection.tags).toEqual([]);
    const result = stripImage(CLEAN_PNG);
    expect(pngIsValid(result.bytes)).toBe(true);
    expect(result.remainingTags).toEqual([]);
    expect(parsePngChunks(result.bytes).map((chunk) => chunk.type)).toEqual(
      parsePngChunks(CLEAN_PNG).map((chunk) => chunk.type),
    );
  });

  it("reconstructs chunk CRCs so the cleaned file stays well-formed", () => {
    const cleaned = stripPng(buildSamplePng());
    expect(parsePngChunks(cleaned).every((chunk) => chunk.crcOk)).toBe(true);
  });
});
