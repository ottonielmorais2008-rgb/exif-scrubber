import { isJpeg, isPng } from "./bytes";
import { inspectJpeg, jpegIsValid, stripJpeg } from "./jpeg";
import { inspectPng, pngIsValid, stripPng } from "./png";
import { UnsupportedFormatError, type Inspection, type StripOptions, type StripResult } from "./types";

export function detectFormat(data: Uint8Array): "jpeg" | "png" {
  if (isJpeg(data)) return "jpeg";
  if (isPng(data)) return "png";
  throw new UnsupportedFormatError();
}

export function inspectImage(data: Uint8Array): Inspection {
  const format = detectFormat(data);
  return format === "jpeg" ? inspectJpeg(data) : inspectPng(data);
}

export function stripImage(data: Uint8Array, options: StripOptions = {}): StripResult {
  const format = detectFormat(data);
  const bytes = format === "jpeg" ? stripJpeg(data, options) : stripPng(data, options);
  const remaining = inspectImage(bytes).tags;
  const valid = format === "jpeg" ? jpegIsValid(bytes) : pngIsValid(bytes);
  return {
    format,
    bytes,
    beforeBytes: data.length,
    afterBytes: bytes.length,
    remainingTags: remaining,
    valid,
  };
}
