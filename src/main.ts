import { inspectImage, stripImage } from "./inspect";
import { buildSampleJpeg, buildSamplePng } from "./samples";
import { UnsupportedFormatError } from "./types";
import type { Inspection, MetadataGroup, MetadataTag } from "./types";

const MAX_BYTES = 40 * 1024 * 1024;
const GROUP_ORDER: MetadataGroup[] = [
  "GPS",
  "Camera",
  "Date/Time",
  "Software",
  "Comment",
  "IPTC",
  "XMP",
  "PNG text",
  "Color profile",
  "Other",
];

const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const dropZone = document.querySelector<HTMLElement>("#drop-zone")!;
const results = document.querySelector<HTMLElement>("#results")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const keepIcc = document.querySelector<HTMLInputElement>("#keep-icc")!;
const sampleJpeg = document.querySelector<HTMLButtonElement>("#sample-jpeg")!;
const samplePng = document.querySelector<HTMLButtonElement>("#sample-png")!;
const resetBtn = document.querySelector<HTMLButtonElement>("#reset")!;

type CurrentFile = { name: string; bytes: Uint8Array; inspection: Inspection };
let current: CurrentFile | null = null;
let previewUrl: string | undefined;

function setStatus(message: string, kind: "info" | "error" | "ok" = "info"): void {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
}

function revokePreview(): void {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function extensionFor(format: "jpeg" | "png"): string {
  return format === "jpeg" ? "jpg" : "png";
}

function cleanName(name: string, format: "jpeg" | "png"): string {
  const trimmed = name.replace(/\.[^.]+$/, "");
  return `${trimmed || "image"}-clean.${extensionFor(format)}`;
}

function groupTags(tags: MetadataTag[]): [MetadataGroup, MetadataTag[]][] {
  const map = new Map<MetadataGroup, MetadataTag[]>();
  for (const tag of tags) {
    const list = map.get(tag.group) ?? [];
    list.push(tag);
    map.set(tag.group, list);
  }
  return GROUP_ORDER.filter((group) => map.has(group)).map((group) => [group, map.get(group)!]);
}

function renderInspection(file: CurrentFile): void {
  const { inspection, name, bytes } = file;
  const grouped = groupTags(inspection.tags);
  revokePreview();
  previewUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: inspection.format === "jpeg" ? "image/jpeg" : "image/png" }));
  const gpsWarning = inspection.tags.some((tag) => tag.sensitive)
    ? `<p class="banner warn">GPS coordinates were found. They are shown as plain text and degrees only — this page never sends them to a map API or any other network service.</p>`
    : "";
  const warnings = inspection.warnings
    .filter((warning) => !warning.includes("GPS coordinates"))
    .map((warning) => `<p class="banner warn">${escapeHtml(warning)}</p>`)
    .join("");
  const groups =
    grouped.length === 0
      ? `<p class="empty">No metadata tags were found. You can still download a copy that has been checked.</p>`
      : grouped
          .map(([group, tags]) => {
            const rows = tags
              .map(
                (tag) =>
                  `<div class="row${tag.sensitive ? " is-sensitive" : ""}"><dt>${escapeHtml(tag.label)}</dt><dd>${escapeHtml(tag.value)}</dd></div>`,
              )
              .join("");
            return `<section class="group"><h3>${escapeHtml(group)}</h3><dl>${rows}</dl></section>`;
          })
          .join("");

  results.innerHTML = `
    <div class="preview-pane">
      <img alt="Preview of ${escapeHtml(name)}" src="${previewUrl}" />
      <p class="file-meta">${escapeHtml(name)} · ${escapeHtml(inspection.format.toUpperCase())} · ${formatBytes(inspection.byteSize)} · ${inspection.tags.length} metadata tag${inspection.tags.length === 1 ? "" : "s"}</p>
    </div>
    ${gpsWarning}${warnings}
    <div class="groups">${groups}</div>
    <div class="strip-box">
      <p>Stripping removes EXIF, XMP, IPTC, comments and PNG text/time chunks at the byte level. Pixel data is copied, not re-encoded, so quality stays the same.</p>
      <div class="actions">
        <button type="button" class="primary" id="strip">Strip metadata &amp; download clean copy</button>
      </div>
      <div id="strip-result"></div>
    </div>
  `;
  results.hidden = false;
  document.querySelector<HTMLButtonElement>("#strip")!.addEventListener("click", () => onStrip(file));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function onStrip(file: CurrentFile): void {
  const out = document.querySelector<HTMLElement>("#strip-result")!;
  try {
    const result = stripImage(file.bytes, { preserveIcc: keepIcc.checked });
    if (!result.valid) {
      out.innerHTML = `<p class="banner error">The cleaned file did not pass the structural check, so nothing was downloaded.</p>`;
      setStatus("The cleaned file was not valid.", "error");
      return;
    }
    const remaining = result.remainingTags.length;
    const ok = remaining === 0;
    const blob = new Blob([new Uint8Array(result.bytes)], { type: file.inspection.format === "jpeg" ? "image/jpeg" : "image/png" });
    const url = URL.createObjectURL(blob);
    const leftover = result.remainingTags.map((tag) => `${tag.label}: ${tag.value}`).join("; ");
    out.innerHTML = `
      <p class="banner ${ok ? "ok" : "warn"}">
        ${ok ? "Re-parsed the cleaned file: 0 metadata tags remain." : `Re-parsed the cleaned file: ${remaining} tag(s) still present (${escapeHtml(leftover)}).`}
      </p>
      <p class="sizes">Size before: <strong>${formatBytes(result.beforeBytes)}</strong> · after: <strong>${formatBytes(result.afterBytes)}</strong> · saved ${formatBytes(Math.max(0, result.beforeBytes - result.afterBytes))}</p>
      <a class="download" href="${url}" download="${escapeHtml(cleanName(file.name, result.format))}">Download ${escapeHtml(cleanName(file.name, result.format))}</a>
    `;
    setStatus(ok ? "Metadata stripped. The clean copy is ready to download." : "Stripped, but some tags remain.", ok ? "ok" : "error");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not strip metadata.";
    out.innerHTML = `<p class="banner error">${escapeHtml(message)}</p>`;
    setStatus(message, "error");
  }
}

function loadBytes(name: string, bytes: Uint8Array): void {
  if (bytes.length > MAX_BYTES) {
    setStatus(`This file is larger than the ${formatBytes(MAX_BYTES)} in-memory limit.`, "error");
    return;
  }
  try {
    const inspection = inspectImage(bytes);
    current = { name, bytes, inspection };
    renderInspection(current);
    setStatus(`Loaded ${name}. Nothing was uploaded.`, "ok");
  } catch (error) {
    current = null;
    results.hidden = true;
    results.innerHTML = "";
    const message = error instanceof UnsupportedFormatError || error instanceof Error ? error.message : "Could not read this file.";
    setStatus(message, "error");
  }
}

async function loadFile(file: File): Promise<void> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  loadBytes(file.name, buffer);
}

function reset(): void {
  current = null;
  revokePreview();
  fileInput.value = "";
  results.hidden = true;
  results.innerHTML = "";
  setStatus("Choose a JPEG or PNG, or try a built-in sample. Files never leave this browser tab.", "info");
}

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-over");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-over"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-over");
  const file = event.dataTransfer?.files[0];
  if (file) void loadFile(file);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
});
sampleJpeg.addEventListener("click", () => loadBytes("sample-photo.jpg", buildSampleJpeg()));
samplePng.addEventListener("click", () => loadBytes("sample-photo.png", buildSamplePng()));
resetBtn.addEventListener("click", () => reset());
keepIcc.addEventListener("change", () => {
  if (current) setStatus("ICC option updated. Strip again to apply it.", "info");
});

reset();
