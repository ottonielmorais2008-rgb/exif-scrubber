const decoder = new TextDecoder("utf-8", { fatal: false });
const latin = new TextDecoder("latin1");

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function asciiCString(data: Uint8Array): string {
  let end = data.length;
  const nul = data.indexOf(0);
  if (nul !== -1) end = nul;
  return latin.decode(data.subarray(0, end)).trim();
}

export function utf8String(data: Uint8Array): string {
  let end = data.length;
  const nul = data.indexOf(0);
  if (nul !== -1) end = nul;
  return decoder.decode(data.subarray(0, end)).replace(/\u0000/g, "").trim();
}

export function printable(text: string): string {
  return [...text].filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
}

export function decodeB64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function isJpeg(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0xff && data[1] === 0xd8;
}

export function isPng(data: Uint8Array): boolean {
  return (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  );
}
