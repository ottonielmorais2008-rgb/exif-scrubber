import { asciiCString } from "./bytes";
import type { MetadataTag } from "./types";

const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
  9: 4,
  10: 8,
};

const TAG_INFO: Record<number, { label: string; group: MetadataTag["group"] }> = {
  0x010e: { label: "Image description", group: "Other" },
  0x010f: { label: "Make", group: "Camera" },
  0x0110: { label: "Model", group: "Camera" },
  0x0112: { label: "Orientation", group: "Other" },
  0x0131: { label: "Software", group: "Software" },
  0x0132: { label: "DateTime", group: "Date/Time" },
  0x013b: { label: "Artist", group: "Other" },
  0x8298: { label: "Copyright", group: "Other" },
  0x9003: { label: "DateTimeOriginal", group: "Date/Time" },
  0x9004: { label: "DateTimeDigitized", group: "Date/Time" },
  0xa430: { label: "Camera owner", group: "Camera" },
  0xa431: { label: "Body serial", group: "Camera" },
  0xa433: { label: "Lens make", group: "Camera" },
  0xa434: { label: "Lens model", group: "Camera" },
};

const GPS_LAT_REF = 0x0001;
const GPS_LAT = 0x0002;
const GPS_LON_REF = 0x0003;
const GPS_LON = 0x0004;
const GPS_ALT_REF = 0x0005;
const GPS_ALT = 0x0006;
const GPS_TIME = 0x0007;
const GPS_DATE = 0x001d;
const EXIF_IFD = 0x8769;
const GPS_IFD = 0x8825;

export type TiffEntry = {
  tag: number;
  type: number;
  count: number;
  value: Uint8Array;
};

export type BuiltExifField = {
  tag: number;
  type: 2 | 3 | 4 | 5;
  value: string | number | number[];
};

function readU16(view: DataView, offset: number, le: boolean): number {
  return le ? view.getUint16(offset, true) : view.getUint16(offset, false);
}

function readU32(view: DataView, offset: number, le: boolean): number {
  return le ? view.getUint32(offset, true) : view.getUint32(offset, false);
}

function inRange(offset: number, size: number, end: number): boolean {
  return offset >= 0 && size >= 0 && offset + size <= end;
}

function rationals(data: Uint8Array, le: boolean): [number, number][] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: [number, number][] = [];
  for (let i = 0; i + 8 <= data.length; i += 8) {
    out.push([
      le ? view.getUint32(i, true) : view.getUint32(i, false),
      le ? view.getUint32(i + 4, true) : view.getUint32(i + 4, false),
    ]);
  }
  return out;
}

function rationalNumber(pair: [number, number] | undefined): number | undefined {
  if (!pair || pair[1] === 0) return undefined;
  return pair[0] / pair[1];
}

function dmsToDegrees(values: [number, number][]): number | undefined {
  if (values.length < 3) return undefined;
  const deg = rationalNumber(values[0]);
  const min = rationalNumber(values[1]);
  const sec = rationalNumber(values[2]);
  if (deg === undefined || min === undefined || sec === undefined) return undefined;
  return deg + min / 60 + sec / 3600;
}

export function formatGps(
  lat: [number, number][],
  latRef: string,
  lon: [number, number][],
  lonRef: string,
): string | undefined {
  const latDeg = dmsToDegrees(lat);
  const lonDeg = dmsToDegrees(lon);
  if (latDeg === undefined || lonDeg === undefined) return undefined;
  const ns = latRef.toUpperCase().startsWith("S") ? "S" : "N";
  const ew = lonRef.toUpperCase().startsWith("W") ? "W" : "E";
  return `${latDeg.toFixed(6)}° ${ns}, ${lonDeg.toFixed(6)}° ${ew}`;
}

function parseIfd(
  view: DataView,
  start: number,
  end: number,
  le: boolean,
  ifdOffset: number,
  seen: Set<number>,
): TiffEntry[] {
  if (seen.has(ifdOffset) || !inRange(start + ifdOffset, 2, end)) return [];
  seen.add(ifdOffset);
  const count = readU16(view, start + ifdOffset, le);
  if (count > 256) return [];
  const entriesEnd = start + ifdOffset + 2 + count * 12;
  if (!inRange(start + ifdOffset, 2 + count * 12 + 4, end)) return [];
  const entries: TiffEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = start + ifdOffset + 2 + i * 12;
    const tag = readU16(view, base, le);
    const type = readU16(view, base + 2, le);
    const num = readU32(view, base + 4, le);
    const unit = TYPE_SIZE[type];
    if (!unit || num > 0x10000) continue;
    const size = unit * num;
    let value: Uint8Array;
    if (size <= 4) {
      value = new Uint8Array(size);
      const slice = new Uint8Array(view.buffer, view.byteOffset + base + 8, 4);
      value.set(slice.subarray(0, size));
    } else {
      const offset = readU32(view, base + 8, le);
      if (!inRange(start + offset, size, end)) continue;
      value = new Uint8Array(view.buffer, view.byteOffset + start + offset, size).slice();
    }
    entries.push({ tag, type, count: num, value });
  }
  const next = readU32(view, entriesEnd, le);
  if (next !== 0) entries.push(...parseIfd(view, start, end, le, next, seen));
  return entries;
}

function inlineNumber(entry: TiffEntry, le: boolean): number | undefined {
  if (entry.value.length === 0) return undefined;
  const view = new DataView(entry.value.buffer, entry.value.byteOffset, entry.value.byteLength);
  if (entry.type === 3 && entry.value.length >= 2) return le ? view.getUint16(0, true) : view.getUint16(0, false);
  if ((entry.type === 4 || entry.type === 1 || entry.type === 7) && entry.value.length >= 4) {
    return le ? view.getUint32(0, true) : view.getUint32(0, false);
  }
  if (entry.type === 1) return entry.value[0];
  return undefined;
}

function entryText(entry: TiffEntry): string | undefined {
  if (entry.type === 2) return asciiCString(entry.value);
  return undefined;
}

export function parseTiff(data: Uint8Array, start = 0, end = start + data.length): MetadataTag[] {
  if (!inRange(start, 8, end)) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const b0 = data[start];
  const b1 = data[start + 1];
  const le = b0 === 0x49 && b1 === 0x49;
  const be = b0 === 0x4d && b1 === 0x4d;
  if (!le && !be) return [];
  const magic = readU16(view, start + 2, le);
  if (magic !== 0x002a) return [];
  const ifd0 = readU32(view, start + 4, le);
  const seen = new Set<number>();
  const ifd0Entries = parseIfd(view, start, end, le, ifd0, seen);
  const tags: MetadataTag[] = [];

  const follow = (tag: number): TiffEntry[] => {
    const entry = ifd0Entries.find((item) => item.tag === tag);
    if (!entry) return [];
    const offset = inlineNumber(entry, le);
    if (offset === undefined) return [];
    return parseIfd(view, start, end, le, offset, seen);
  };

  const exifEntries = follow(EXIF_IFD);
  const gpsEntries = follow(GPS_IFD);

  const pushKnown = (entries: TiffEntry[]) => {
    for (const entry of entries) {
      if (entry.tag === EXIF_IFD || entry.tag === GPS_IFD) continue;
      const info = TAG_INFO[entry.tag];
      const text = entryText(entry);
      if (info && text) tags.push({ group: info.group, label: info.label, value: text });
    }
  };

  pushKnown(ifd0Entries);
  pushKnown(exifEntries);

  const gpsMap = new Map(gpsEntries.map((entry) => [entry.tag, entry]));
  const latEntry = gpsMap.get(GPS_LAT);
  const lonEntry = gpsMap.get(GPS_LON);
  const latRef = gpsMap.get(GPS_LAT_REF);
  const lonRef = gpsMap.get(GPS_LON_REF);
  if (latEntry && lonEntry && latRef && lonRef) {
    const formatted = formatGps(
      rationals(latEntry.value, le),
      entryText(latRef) ?? "N",
      rationals(lonEntry.value, le),
      entryText(lonRef) ?? "E",
    );
    if (formatted) {
      tags.push({
        group: "GPS",
        label: "Coordinates",
        value: formatted,
        sensitive: true,
      });
    }
  }
  const altEntry = gpsMap.get(GPS_ALT);
  if (altEntry) {
    const alt = rationalNumber(rationals(altEntry.value, le)[0]);
    if (alt !== undefined) {
      const below = gpsMap.get(GPS_ALT_REF)?.value[0] === 1;
      tags.push({
        group: "GPS",
        label: "Altitude",
        value: `${below ? "-" : ""}${alt.toFixed(1)} m`,
        sensitive: true,
      });
    }
  }
  const date = gpsMap.get(GPS_DATE);
  const time = gpsMap.get(GPS_TIME);
  if (date) {
    const dateText = entryText(date) ?? "";
    const timeParts = time ? rationals(time.value, le).map((pair) => rationalNumber(pair) ?? 0) : [];
    const clock =
      timeParts.length >= 3
        ? ` ${String(Math.floor(timeParts[0]!)).padStart(2, "0")}:${String(Math.floor(timeParts[1]!)).padStart(2, "0")}:${String(Math.floor(timeParts[2]!)).padStart(2, "0")}`
        : "";
    tags.push({ group: "GPS", label: "GPS timestamp", value: `${dateText}${clock}`.trim(), sensitive: true });
  }

  return tags;
}

export function parseExifApp1(payload: Uint8Array): MetadataTag[] {
  if (payload.length < 14) return [];
  const header = asciiCString(payload.subarray(0, 6));
  if (header !== "Exif") return [];
  return parseTiff(payload, 6, 6 + payload.length - 6);
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function encodeField(field: BuiltExifField): { type: number; count: number; bytes: Uint8Array } {
  if (field.type === 2) {
    const text = String(field.value);
    const bytes = new Uint8Array(text.length + 1);
    for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
    return { type: 2, count: bytes.length, bytes };
  }
  if (field.type === 5) {
    const nums = Array.isArray(field.value) ? field.value : [Number(field.value), 1];
    const bytes = new Uint8Array(nums.length * 4);
    const view = new DataView(bytes.buffer);
    nums.forEach((num, index) => writeU32(view, index * 4, num >>> 0));
    return { type: 5, count: nums.length / 2, bytes };
  }
  const value = Number(Array.isArray(field.value) ? field.value[0] : field.value) >>> 0;
  if (field.type === 3) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return { type: 3, count: 1, bytes };
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return { type: 4, count: 1, bytes };
}

function layoutIfd(fields: BuiltExifField[], ifdOffset: number): { size: number; table: Uint8Array; data: Uint8Array } {
  const encoded = fields.map((field) => ({ tag: field.tag, ...encodeField(field) }));
  const table = new Uint8Array(2 + encoded.length * 12 + 4);
  const tableView = new DataView(table.buffer);
  writeU16(tableView, 0, encoded.length);
  const dataParts: Uint8Array[] = [];
  let dataCursor = ifdOffset + table.length;
  encoded.forEach((field, index) => {
    const entry = 2 + index * 12;
    writeU16(tableView, entry, field.tag);
    writeU16(tableView, entry + 2, field.type);
    writeU32(tableView, entry + 4, field.count);
    if (field.bytes.length <= 4) {
      table.set(field.bytes, entry + 8);
    } else {
      writeU32(tableView, entry + 8, dataCursor);
      dataParts.push(field.bytes);
      const pad = field.bytes.length % 2 === 1 ? 1 : 0;
      if (pad) dataParts.push(new Uint8Array([0]));
      dataCursor += field.bytes.length + pad;
    }
  });
  const data = dataParts.length ? new Uint8Array(dataParts.reduce((n, p) => n + p.length, 0)) : new Uint8Array(0);
  let offset = 0;
  for (const part of dataParts) {
    data.set(part, offset);
    offset += part.length;
  }
  return { size: table.length + data.length, table, data };
}

export function buildExifTiff(ifd0: BuiltExifField[], gps: BuiltExifField[] = []): Uint8Array {
  const header = new Uint8Array(8);
  const headerView = new DataView(header.buffer);
  header[0] = 0x49;
  header[1] = 0x49;
  writeU16(headerView, 2, 0x002a);
  writeU32(headerView, 4, 8);

  const gpsPlaceholder: BuiltExifField[] = gps.length
    ? [...ifd0, { tag: GPS_IFD, type: 4, value: 0 }]
    : [...ifd0];

  // First pass: measure IFD0 with a dummy GPS offset so sizes are stable.
  const first = layoutIfd(gpsPlaceholder, 8);
  const gpsOffset = 8 + first.size;
  const withGps: BuiltExifField[] = gps.length
    ? [...ifd0, { tag: GPS_IFD, type: 4, value: gpsOffset }]
    : ifd0;
  const ifd0Layout = layoutIfd(withGps, 8);
  const parts = [header, ifd0Layout.table, ifd0Layout.data];
  if (gps.length) {
    const gpsLayout = layoutIfd(gps, gpsOffset);
    parts.push(gpsLayout.table, gpsLayout.data);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function buildExifApp1Payload(ifd0: BuiltExifField[], gps: BuiltExifField[] = []): Uint8Array {
  const tiff = buildExifTiff(ifd0, gps);
  const payload = new Uint8Array(6 + tiff.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
  payload.set(tiff, 6);
  return payload;
}

export const SAMPLE_EXIF = {
  make: "AcmeCam",
  model: "Demo 3000",
  software: "ExifScrubber Sample",
  dateTime: "2020:01:02 03:04:05",
  latRef: "N",
  lonRef: "W",
  // 40° 42' 46.0" N, 74° 00' 21.6" W (plain degrees only in the UI)
  lat: [40, 1, 42, 1, 460, 10] as number[],
  lon: [74, 1, 0, 1, 216, 10] as number[],
};

export function buildSampleExifPayload(): Uint8Array {
  return buildExifApp1Payload(
    [
      { tag: 0x010f, type: 2, value: SAMPLE_EXIF.make },
      { tag: 0x0110, type: 2, value: SAMPLE_EXIF.model },
      { tag: 0x0131, type: 2, value: SAMPLE_EXIF.software },
      { tag: 0x0132, type: 2, value: SAMPLE_EXIF.dateTime },
    ],
    [
      { tag: GPS_LAT_REF, type: 2, value: SAMPLE_EXIF.latRef },
      { tag: GPS_LAT, type: 5, value: SAMPLE_EXIF.lat },
      { tag: GPS_LON_REF, type: 2, value: SAMPLE_EXIF.lonRef },
      { tag: GPS_LON, type: 5, value: SAMPLE_EXIF.lon },
    ],
  );
}
