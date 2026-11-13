import { asciiCString, concat, isJpeg, printable, utf8String } from "./bytes";
import { parseExifApp1 } from "./exif";
import type { Inspection, MetadataTag, StripOptions } from "./types";

export type JpegSegment = {
  marker: number;
  // Undefined for SOI/EOI. For SOS this is only the SOS header; entropy follows separately.
  payload?: Uint8Array;
  label: string;
};

const MARKER_LABELS: Record<number, string> = {
  0xe0: "APP0 JFIF",
  0xe1: "APP1",
  0xe2: "APP2",
  0xed: "APP13",
  0xee: "Adobe APP14",
  0xfe: "COM",
};

function markerLabel(marker: number, payload?: Uint8Array): string {
  if (marker === 0xe1 && payload) {
    if (startsWith(payload, "Exif")) return "APP1 EXIF";
    if (startsWith(payload, "http://ns.adobe.com/xap/1.0/") || startsWith(payload, "http://ns.adobe.com/xmp/extension/")) {
      return "APP1 XMP";
    }
    return "APP1";
  }
  if (marker === 0xe2 && payload && startsWith(payload, "ICC_PROFILE")) return "APP2 ICC";
  if (marker === 0xed) return "APP13 IPTC";
  return MARKER_LABELS[marker] ?? `marker 0x${marker.toString(16)}`;
}

function startsWith(data: Uint8Array, text: string): boolean {
  if (data.length < text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (data[i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function isSof(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

export function parseJpegSegments(data: Uint8Array): { segments: JpegSegment[]; entropy: Uint8Array; hasSoi: boolean; hasEoi: boolean; hasSof: boolean; hasSos: boolean } {
  const segments: JpegSegment[] = [];
  let entropy = new Uint8Array(0);
  let hasSoi = false;
  let hasEoi = false;
  let hasSof = false;
  let hasSos = false;
  if (!isJpeg(data)) return { segments, entropy, hasSoi, hasEoi, hasSof, hasSos };
  hasSoi = true;
  segments.push({ marker: 0xd8, label: "SOI" });
  let i = 2;
  while (i < data.length) {
    if (data[i] !== 0xff) break;
    while (i < data.length && data[i] === 0xff) i += 1;
    if (i >= data.length) break;
    const marker = data[i]!;
    i += 1;
    if (marker === 0xd9) {
      hasEoi = true;
      segments.push({ marker, label: "EOI" });
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, label: markerLabel(marker) });
      continue;
    }
    if (i + 2 > data.length) break;
    const length = (data[i]! << 8) | data[i + 1]!;
    if (length < 2 || i + length > data.length) break;
    const payload = data.subarray(i + 2, i + length);
    i += length;
    if (isSof(marker)) hasSof = true;
    if (marker === 0xda) {
      hasSos = true;
      segments.push({ marker, payload: payload.slice(), label: "SOS" });
      const start = i;
      while (i < data.length) {
        if (data[i] !== 0xff) {
          i += 1;
          continue;
        }
        if (i + 1 >= data.length) {
          i += 1;
          break;
        }
        const next = data[i + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          i += 2;
          continue;
        }
        if (next === 0xd9) {
          entropy = new Uint8Array(data.subarray(start, i));
          break;
        }
        // Unexpected marker in the scan: keep copying bytes so a later EOI can still be found.
        i += 1;
      }
      if (entropy.length === 0 && i > start) entropy = new Uint8Array(data.subarray(start, i));
      continue;
    }
    segments.push({ marker, payload: payload.slice(), label: markerLabel(marker, payload) });
  }
  return { segments, entropy, hasSoi, hasEoi, hasSof, hasSos };
}

function xmpXml(payload: Uint8Array): string {
  // The standard APP1 XMP header ends at the first NUL; the packet follows.
  const nul = payload.indexOf(0);
  const xmlStart = nul !== -1 && nul < 80 ? nul + 1 : 0;
  return new TextDecoder("utf-8", { fatal: false }).decode(payload.subarray(xmlStart));
}

function xmpTags(payload: Uint8Array): MetadataTag[] {
  const text = xmpXml(payload);
  const tags: MetadataTag[] = [];
  const capture = (pattern: RegExp, label: string, group: MetadataTag["group"] = "XMP") => {
    const match = text.match(pattern);
    const raw = match?.[1] ?? match?.[2];
    if (!raw) return;
    const cleaned = printable(raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (cleaned) tags.push({ group, label, value: cleaned });
  };
  capture(/<(?:dc:creator)\b[^>]*>([\s\S]*?)<\/(?:dc:creator)>/i, "Creator");
  capture(/<(?:dc:title)\b[^>]*>([\s\S]*?)<\/(?:dc:title)>/i, "Title");
  capture(/<(?:xmp:CreatorTool|xmp:creatortool)\b[^>]*>([^<]+)<\//i, "Creator tool", "Software");
  capture(/<(?:photoshop:Credit)\b[^>]*>([^<]+)<\//i, "Credit");
  if (tags.length === 0) tags.push({ group: "XMP", label: "XMP packet", value: `${payload.length} bytes` });
  return tags;
}

function iptcTags(payload: Uint8Array): MetadataTag[] {
  const tags: MetadataTag[] = [];
  const prefix = "Photoshop 3.0";
  let offset = 0;
  if (startsWith(payload, prefix)) offset = prefix.length + 1;
  const iptcNames: Record<number, string> = {
    5: "Object name",
    25: "Keywords",
    80: "Byline",
    90: "City",
    95: "Province/State",
    101: "Country",
    116: "Copyright",
    120: "Caption",
  };
  while (offset + 8 <= payload.length) {
    if (payload[offset] === 0x38 && payload[offset + 1] === 0x42 && payload[offset + 2] === 0x49 && payload[offset + 3] === 0x4d) {
      const id = (payload[offset + 4]! << 8) | payload[offset + 5]!;
      const nameLen = payload[offset + 6]!;
      let cursor = offset + 7 + nameLen;
      if (cursor % 2 === 1) cursor += 1;
      if (cursor + 4 > payload.length) break;
      const size = (payload[cursor]! << 24) | (payload[cursor + 1]! << 16) | (payload[cursor + 2]! << 8) | payload[cursor + 3]!;
      cursor += 4;
      if (cursor + size > payload.length || size < 0) break;
      if (id === 0x0404) {
        const block = payload.subarray(cursor, cursor + size);
        let i = 0;
        while (i + 5 <= block.length) {
          if (block[i] !== 0x1c) {
            i += 1;
            continue;
          }
          const dataset = block[i + 2]!;
          const length = (block[i + 3]! << 8) | block[i + 4]!;
          const start = i + 5;
          if (start + length > block.length) break;
          const label = iptcNames[dataset];
          const value = printable(asciiCString(block.subarray(start, start + length)));
          if (label && value) tags.push({ group: "IPTC", label, value });
          i = start + length;
        }
      }
      offset = cursor + size;
      if (offset % 2 === 1) offset += 1;
      continue;
    }
    break;
  }
  if (tags.length === 0) tags.push({ group: "IPTC", label: "Photoshop IRB / IPTC", value: `${payload.length} bytes` });
  return tags;
}

export function inspectJpeg(data: Uint8Array): Inspection {
  const parsed = parseJpegSegments(data);
  const tags: MetadataTag[] = [];
  const warnings: string[] = [];
  let hasIcc = false;
  for (const segment of parsed.segments) {
    if (segment.payload && segment.marker === 0xe1 && startsWith(segment.payload, "Exif")) {
      tags.push(...parseExifApp1(segment.payload));
      continue;
    }
    if (segment.payload && segment.marker === 0xe1 && (startsWith(segment.payload, "http://ns.adobe.com/xap/1.0/") || startsWith(segment.payload, "http://ns.adobe.com/xmp/extension/"))) {
      tags.push(...xmpTags(segment.payload));
      continue;
    }
    if (segment.payload && segment.marker === 0xed) {
      tags.push(...iptcTags(segment.payload));
      continue;
    }
    if (segment.payload && segment.marker === 0xfe) {
      const value = printable(utf8String(segment.payload)) || printable(asciiCString(segment.payload));
      if (value) tags.push({ group: "Comment", label: "JPEG comment", value });
      else tags.push({ group: "Comment", label: "JPEG comment", value: `${segment.payload.length} bytes` });
      continue;
    }
    if (segment.payload && segment.marker === 0xe2 && startsWith(segment.payload, "ICC_PROFILE")) {
      hasIcc = true;
      tags.push({ group: "Color profile", label: "ICC profile", value: `${segment.payload.length} bytes in APP2` });
    }
  }
  if (!parsed.hasSof || !parsed.hasSos || !parsed.hasEoi) warnings.push("This JPEG looks incomplete or damaged.");
  if (tags.some((tag) => tag.sensitive)) {
    warnings.push("This file includes GPS coordinates. They are shown as plain text only and are never sent to a map service.");
  }
  return { format: "jpeg", byteSize: data.length, tags, warnings, hasIcc };
}

function isMetadataMarker(marker: number, payload: Uint8Array | undefined, preserveIcc: boolean): boolean {
  if (marker === 0xe1 || marker === 0xed || marker === 0xfe) return true;
  if (marker === 0xe2 && payload && startsWith(payload, "ICC_PROFILE")) return !preserveIcc;
  return false;
}

export function stripJpeg(data: Uint8Array, options: StripOptions = {}): Uint8Array {
  const preserveIcc = options.preserveIcc === true;
  const parsed = parseJpegSegments(data);
  if (!parsed.hasSoi || !parsed.hasSof || !parsed.hasSos || !parsed.hasEoi) {
    throw new Error("This JPEG is missing required markers (SOI, SOF, SOS or EOI) and was not changed.");
  }
  const parts: Uint8Array[] = [];
  for (const segment of parsed.segments) {
    if (segment.marker === 0xd8) {
      parts.push(new Uint8Array([0xff, 0xd8]));
      continue;
    }
    if (segment.marker === 0xd9) {
      parts.push(parsed.entropy, new Uint8Array([0xff, 0xd9]));
      continue;
    }
    if (isMetadataMarker(segment.marker, segment.payload, preserveIcc)) continue;
    if (segment.payload) {
      const length = segment.payload.length + 2;
      const header = new Uint8Array(4);
      header[0] = 0xff;
      header[1] = segment.marker;
      header[2] = (length >> 8) & 0xff;
      header[3] = length & 0xff;
      parts.push(header, segment.payload);
    }
  }
  return concat(parts);
}

export function jpegIsValid(data: Uint8Array): boolean {
  const parsed = parseJpegSegments(data);
  return parsed.hasSoi && parsed.hasSof && parsed.hasSos && parsed.hasEoi;
}

export function makeJpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  if (length > 0xffff) throw new Error("JPEG segment too large");
  const out = new Uint8Array(2 + 2 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = (length >> 8) & 0xff;
  out[3] = length & 0xff;
  out.set(payload, 4);
  return out;
}

export function insertJpegSegments(jpeg: Uint8Array, segments: Uint8Array[]): Uint8Array {
  if (!isJpeg(jpeg)) throw new Error("Not a JPEG");
  return concat([new Uint8Array([0xff, 0xd8]), ...segments, jpeg.subarray(2)]);
}

export function buildIptcApp13Payload(caption: string, byline: string): Uint8Array {
  const datasets: Uint8Array[] = [];
  const add = (dataset: number, text: string) => {
    const chars = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) chars[i] = text.charCodeAt(i) & 0xff;
    const block = new Uint8Array(5 + chars.length);
    block[0] = 0x1c;
    block[1] = 0x02;
    block[2] = dataset;
    block[3] = (chars.length >> 8) & 0xff;
    block[4] = chars.length & 0xff;
    block.set(chars, 5);
    datasets.push(block);
  };
  add(80, byline);
  add(120, caption);
  const iptc = concat(datasets);
  const namePad = 1; // empty Pascal string, already even with the length byte
  const size = iptc.length;
  const irb = new Uint8Array(4 + 2 + 1 + namePad + 4 + size + (size % 2));
  irb.set([0x38, 0x42, 0x49, 0x4d], 0); // 8BIM
  irb[4] = 0x04;
  irb[5] = 0x04;
  irb[6] = 0x00; // empty name
  irb[7] = 0x00; // pad to even
  irb[8] = (size >> 24) & 0xff;
  irb[9] = (size >> 16) & 0xff;
  irb[10] = (size >> 8) & 0xff;
  irb[11] = size & 0xff;
  irb.set(iptc, 12);
  const prefix = new Uint8Array([
    0x50, 0x68, 0x6f, 0x74, 0x6f, 0x73, 0x68, 0x6f, 0x70, 0x20, 0x33, 0x2e, 0x30, 0x00,
  ]);
  return concat([prefix, irb]);
}

export function buildXmpApp1Payload(creator: string, tool: string): Uint8Array {
  const xml = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><rdf:Description><dc:creator><rdf:Seq><rdf:li>${creator}</rdf:li></rdf:Seq></dc:creator><xmp:CreatorTool>${tool}</xmp:CreatorTool></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const header = "http://ns.adobe.com/xap/1.0/\0";
  const bytes = new Uint8Array(header.length + xml.length);
  for (let i = 0; i < header.length; i += 1) bytes[i] = header.charCodeAt(i);
  for (let i = 0; i < xml.length; i += 1) bytes[header.length + i] = xml.charCodeAt(i);
  return bytes;
}

