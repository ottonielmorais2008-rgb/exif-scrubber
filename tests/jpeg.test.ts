import { describe, expect, it } from "vitest";
import { SAMPLE_EXIF, buildSampleExifPayload, parseExifApp1 } from "../src/exif";
import { inspectImage, stripImage } from "../src/inspect";
import {
  insertJpegSegments,
  jpegIsValid,
  makeJpegSegment,
  parseJpegSegments,
  stripJpeg,
} from "../src/jpeg";
import { CLEAN_JPEG, SAMPLE_VALUES, buildSampleJpeg } from "../src/samples";
import { UnsupportedFormatError } from "../src/types";

function tagsByLabel(tags: { label: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(tags.map((tag) => [tag.label, tag.value]));
}

describe("JPEG inspection and stripping", () => {
  it("builds an APP1 EXIF payload that the parser can read, including GPS", () => {
    const tags = tagsByLabel(parseExifApp1(buildSampleExifPayload()));
    expect(tags.Make).toBe(SAMPLE_EXIF.make);
    expect(tags.Model).toBe(SAMPLE_EXIF.model);
    expect(tags.Software).toBe(SAMPLE_EXIF.software);
    expect(tags.DateTime).toBe(SAMPLE_EXIF.dateTime);
    expect(tags.Coordinates).toMatch(/° N, .*° W/);
  });

  it("extracts EXIF, GPS, XMP, IPTC and COM from a synthetic JPEG", () => {
    const jpeg = buildSampleJpeg();
    const inspection = inspectImage(jpeg);
    const labels = tagsByLabel(inspection.tags);
    expect(inspection.format).toBe("jpeg");
    expect(labels.Make).toBe(SAMPLE_EXIF.make);
    expect(labels.Model).toBe(SAMPLE_EXIF.model);
    expect(labels.DateTime).toBe(SAMPLE_EXIF.dateTime);
    expect(labels.Coordinates).toMatch(/° N, .*° W/);
    expect(labels["JPEG comment"]).toBe(SAMPLE_VALUES.comment);
    expect(labels.Caption).toBe(SAMPLE_VALUES.caption);
    expect(labels.Byline).toBe(SAMPLE_VALUES.byline);
    expect(labels.Creator).toBe(SAMPLE_VALUES.xmpCreator);
    expect(labels["Creator tool"]).toBe(SAMPLE_VALUES.xmpTool);
    expect(inspection.warnings.some((warning) => warning.includes("GPS"))).toBe(true);
  });

  it("strips every metadata segment, keeps a valid JPEG, and re-parses to zero tags", () => {
    const jpeg = buildSampleJpeg();
    const before = parseJpegSegments(jpeg);
    expect(before.segments.some((segment) => segment.marker === 0xe1)).toBe(true);
    expect(before.segments.some((segment) => segment.marker === 0xed)).toBe(true);
    expect(before.segments.some((segment) => segment.marker === 0xfe)).toBe(true);

    const result = stripImage(jpeg);
    expect(result.format).toBe("jpeg");
    expect(jpegIsValid(result.bytes)).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.remainingTags).toEqual([]);
    expect(result.afterBytes).toBeLessThan(result.beforeBytes);

    const after = parseJpegSegments(result.bytes);
    expect(after.hasSoi).toBe(true);
    expect(after.hasEoi).toBe(true);
    expect(after.hasSof).toBe(true);
    expect(after.hasSos).toBe(true);
    expect(after.segments.some((segment) => [0xe1, 0xed, 0xfe].includes(segment.marker))).toBe(false);
    expect(inspectImage(result.bytes).tags).toEqual([]);
  });

  it("handles a JPEG that already has no metadata without breaking it", () => {
    const inspection = inspectImage(CLEAN_JPEG);
    expect(inspection.tags).toEqual([]);
    const result = stripImage(CLEAN_JPEG);
    expect(jpegIsValid(result.bytes)).toBe(true);
    expect(result.remainingTags).toEqual([]);
    expect(result.afterBytes).toBe(CLEAN_JPEG.length);
    expect(result.bytes).toEqual(CLEAN_JPEG);
  });

  it("strips or keeps a synthetic ICC APP2 segment depending on the toggle", () => {
    const iccPayload = new Uint8Array(16);
    const iccLabel = "ICC_PROFILE\0";
    for (let i = 0; i < iccLabel.length; i += 1) iccPayload[i] = iccLabel.charCodeAt(i);
    iccPayload[12] = 0;
    iccPayload[13] = 1;
    iccPayload[14] = 1;
    iccPayload[15] = 99;
    const withIcc = insertJpegSegments(CLEAN_JPEG, [makeJpegSegment(0xe2, iccPayload)]);
    expect(inspectImage(withIcc).hasIcc).toBe(true);
    expect(inspectImage(withIcc).tags.some((tag) => tag.group === "Color profile")).toBe(true);

    const stripped = stripJpeg(withIcc, { preserveIcc: false });
    expect(inspectImage(stripped).hasIcc).toBe(false);
    expect(inspectImage(stripped).tags).toEqual([]);

    const kept = stripJpeg(withIcc, { preserveIcc: true });
    expect(inspectImage(kept).hasIcc).toBe(true);
    expect(jpegIsValid(kept)).toBe(true);
  });

  it("rejects unsupported formats clearly", () => {
    expect(() => inspectImage(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toThrow(UnsupportedFormatError);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(() => inspectImage(webp)).toThrow(/JPEG and PNG only/);
  });
});
