import { asciiCString, concat, isPng, printable, utf8String } from "./bytes";
import { crc32 } from "./crc32";
import { parseTiff } from "./exif";
import type { Inspection, MetadataTag, StripOptions } from "./types";

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type PngChunk = {
  type: string;
  data: Uint8Array;
  crcOk: boolean;
};

const TEXT_CHUNKS = new Set(["tEXt", "zTXt", "iTXt"]);
const METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
const SAFE_ANCILLARY = new Set(["tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", "pHYs", "hIST", "sPLT"]);

function isCritical(type: string): boolean {
  const code = type.charCodeAt(0);
  return type.length === 4 && (code & 0x20) === 0;
}

function typeBytes(type: string): Uint8Array {
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) out[i] = type.charCodeAt(i);
  return out;
}

export function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeData = concat([typeBytes(type), data]);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeData, 4);
  view.setUint32(8 + data.length, crc32(typeData));
  return out;
}

export function parsePngChunks(data: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = [];
  if (!isPng(data)) return chunks;
  let i = 8;
  while (i + 12 <= data.length) {
    const length = new DataView(data.buffer, data.byteOffset + i, 4).getUint32(0);
    if (length > 0x800000 || i + 12 + length > data.length) break;
    const type = asciiCString(data.subarray(i + 4, i + 8));
    const chunkData = data.subarray(i + 8, i + 8 + length).slice();
    const crc = new DataView(data.buffer, data.byteOffset + i + 8 + length, 4).getUint32(0);
    const expected = crc32(data.subarray(i + 4, i + 8 + length));
    chunks.push({ type, data: chunkData, crcOk: crc === expected });
    i += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

export function pngIsValid(data: Uint8Array): boolean {
  const chunks = parsePngChunks(data);
  const types = chunks.map((chunk) => chunk.type);
  return isPng(data) && types.includes("IHDR") && types.includes("IDAT") && types[types.length - 1] === "IEND";
}

function parseTextChunk(type: string, data: Uint8Array): MetadataTag[] {
  if (type === "tEXt") {
    const split = data.indexOf(0);
    if (split <= 0) return [];
    const keyword = printable(asciiCString(data.subarray(0, split))) || "tEXt";
    const value = printable(asciiCString(data.subarray(split + 1)));
    return [{ group: "PNG text", label: keyword, value: value || "(empty)" }];
  }
  if (type === "iTXt") {
    const first = data.indexOf(0);
    if (first <= 0 || first + 3 > data.length) return [];
    const keyword = printable(asciiCString(data.subarray(0, first))) || "iTXt";
    const compressed = data[first + 1] === 1;
    let cursor = first + 3;
    const nextNul = (from: number) => {
      const at = data.indexOf(0, from);
      return at === -1 ? data.length : at;
    };
    const langEnd = nextNul(cursor);
    cursor = langEnd + 1;
    const transEnd = nextNul(cursor);
    cursor = transEnd + 1;
    if (compressed) {
      return [{ group: "PNG text", label: keyword, value: "compressed iTXt (will be stripped)" }];
    }
    const value = printable(utf8String(data.subarray(cursor)));
    return [{ group: "PNG text", label: keyword, value: value || "(empty)" }];
  }
  if (type === "zTXt") {
    const split = data.indexOf(0);
    const keyword = split > 0 ? printable(asciiCString(data.subarray(0, split))) : "zTXt";
    return [{ group: "PNG text", label: keyword || "zTXt", value: "compressed zTXt (will be stripped)" }];
  }
  return [];
}

function parseTimeChunk(data: Uint8Array): MetadataTag[] {
  if (data.length < 7) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const year = view.getUint16(0);
  const parts = [data[2], data[3], data[4], data[5], data[6]].map((n) => String(n).padStart(2, "0"));
  return [
    {
      group: "Date/Time",
      label: "PNG tIME",
      value: `${year}-${parts[0]}-${parts[1]} ${parts[2]}:${parts[3]}:${parts[4]}`,
    },
  ];
}

export function inspectPng(data: Uint8Array): Inspection {
  const chunks = parsePngChunks(data);
  const tags: MetadataTag[] = [];
  const warnings: string[] = [];
  let hasIcc = false;
  for (const chunk of chunks) {
    if (TEXT_CHUNKS.has(chunk.type)) tags.push(...parseTextChunk(chunk.type, chunk.data));
    else if (chunk.type === "eXIf") tags.push(...parseTiff(chunk.data));
    else if (chunk.type === "tIME") tags.push(...parseTimeChunk(chunk.data));
    else if (chunk.type === "iCCP") {
      hasIcc = true;
      const split = chunk.data.indexOf(0);
      const name = split > 0 ? printable(asciiCString(chunk.data.subarray(0, split))) : "ICC";
      tags.push({ group: "Color profile", label: "ICC profile", value: `${name} (${chunk.data.length} bytes)` });
    }
  }
  if (!pngIsValid(data)) warnings.push("This PNG looks incomplete or damaged.");
  if (tags.some((tag) => tag.sensitive)) {
    warnings.push("This file includes GPS coordinates. They are shown as plain text only and are never sent to a map service.");
  }
  return { format: "png", byteSize: data.length, tags, warnings, hasIcc };
}

function keepChunk(type: string, preserveIcc: boolean): boolean {
  if (METADATA_CHUNKS.has(type)) return false;
  if (type === "iCCP") return preserveIcc;
  if (isCritical(type)) return true;
  return SAFE_ANCILLARY.has(type);
}

export function stripPng(data: Uint8Array, options: StripOptions = {}): Uint8Array {
  const preserveIcc = options.preserveIcc === true;
  const chunks = parsePngChunks(data);
  if (!pngIsValid(data)) {
    throw new Error("This PNG is missing required chunks (IHDR, IDAT or IEND) and was not changed.");
  }
  const parts: Uint8Array[] = [PNG_SIGNATURE];
  for (const chunk of chunks) {
    if (!keepChunk(chunk.type, preserveIcc)) continue;
    parts.push(makePngChunk(chunk.type, chunk.data));
  }
  return concat(parts);
}

export function insertPngChunksAfterIhdr(png: Uint8Array, extra: PngChunk[]): Uint8Array {
  const chunks = parsePngChunks(png);
  if (!pngIsValid(png)) throw new Error("Not a valid PNG");
  const parts: Uint8Array[] = [PNG_SIGNATURE];
  let inserted = false;
  for (const chunk of chunks) {
    parts.push(makePngChunk(chunk.type, chunk.data));
    if (chunk.type === "IHDR" && !inserted) {
      for (const extraChunk of extra) parts.push(makePngChunk(extraChunk.type, extraChunk.data));
      inserted = true;
    }
  }
  return concat(parts);
}

export function makeTextChunk(keyword: string, text: string): PngChunk {
  const key = new Uint8Array(keyword.length);
  for (let i = 0; i < keyword.length; i += 1) key[i] = keyword.charCodeAt(i);
  const value = new TextEncoder().encode(text);
  return { type: "tEXt", data: concat([key, new Uint8Array([0]), value]), crcOk: true };
}

export function makeItxtChunk(keyword: string, text: string): PngChunk {
  const key = new TextEncoder().encode(keyword);
  const value = new TextEncoder().encode(text);
  // keyword, 0, compressionFlag=0, compressionMethod=0, language "", 0, translated "", 0, text
  return {
    type: "iTXt",
    data: concat([key, new Uint8Array([0, 0, 0, 0, 0]), value]),
    crcOk: true,
  };
}

export function makeTimeChunk(year: number, month: number, day: number, hour: number, minute: number, second: number): PngChunk {
  const data = new Uint8Array(7);
  new DataView(data.buffer).setUint16(0, year);
  data[2] = month;
  data[3] = day;
  data[4] = hour;
  data[5] = minute;
  data[6] = second;
  return { type: "tIME", data, crcOk: true };
}
