export type MetadataGroup =
  | "GPS"
  | "Camera"
  | "Date/Time"
  | "Software"
  | "Comment"
  | "IPTC"
  | "XMP"
  | "PNG text"
  | "Color profile"
  | "Other";

export type MetadataTag = {
  group: MetadataGroup;
  label: string;
  value: string;
  sensitive?: boolean;
};

export type ImageFormat = "jpeg" | "png";

export type Inspection = {
  format: ImageFormat;
  byteSize: number;
  tags: MetadataTag[];
  warnings: string[];
  hasIcc: boolean;
};

export type StripOptions = {
  preserveIcc?: boolean;
};

export type StripResult = {
  format: ImageFormat;
  bytes: Uint8Array;
  beforeBytes: number;
  afterBytes: number;
  remainingTags: MetadataTag[];
  valid: boolean;
};

export class UnsupportedFormatError extends Error {
  constructor(message = "This app supports JPEG and PNG only. WebP, HEIC and RAW files are not supported.") {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}
