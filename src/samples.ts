import { decodeB64 } from "./bytes";
import { buildSampleExifPayload, buildExifTiff, SAMPLE_EXIF } from "./exif";
import {
  buildIptcApp13Payload,
  buildXmpApp1Payload,
  insertJpegSegments,
  makeJpegSegment,
} from "./jpeg";
import { insertPngChunksAfterIhdr, makeItxtChunk, makeTextChunk, makeTimeChunk } from "./png";

const CLEAN_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAQDAwMDAgQDAwMEBAQFBgoGBgUFBgwICQcKDgwPDg4MDQ0P" +
  "ERYTDxAVEQ0NExoTFRcYGRkZDxIbHRsYHRYYGRj/2wBDAQQEBAYFBgsGBgsYEA0QGBgYGBgYGBgYGBgY" +
  "GBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBj/wAARCABAAGADASIAAhEBAxEB/8QA" +
  "HwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIh" +
  "MUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVW" +
  "V1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG" +
  "x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQF" +
  "BgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAV" +
  "YnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE" +
  "hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq" +
  "8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5b+w+1H2H2rpPsPtR9h9q+t5D5/mOb+w+1H2H2rpPsPtR9h9q" +
  "OQOY5v7D7UfYfauk+w+1H2H2o5A5jm/sPtR9h9q6Q2IAyRVzSdBk1rxBYaPaNGlxe3EdtG0pIQM7BQSQ" +
  "CcZPYGuetXpUP4jsaQhKekUYWheENb8TawmlaBpVzqF2+D5cCFtoLBdzHoqgsMsxAGeSK63UPgF8U9M0" +
  "6S9ufB9y8UeNy208VxIckDiON2ZuvYHAyTwDX2z4U8KaJ4L8LwaDoNr5NtF8zO3MkznGZHb+JjgewAAA" +
  "AAA26/Hsb4n4j27+qUY+zX817tfJpK/zt5n3WH4Qpez/AH83zeVrL71r+B+Zf2H2o+w+1fYn7QXw1stY" +
  "8OSeNtKsQurWe37YYgc3EAGNzKAcsnynccYQNkkKoHy/9h9q/TOHs7o53hFiqSs72a3s/wBfJnyWaZfP" +
  "L67ozd+qfdHS/Yf9n9KPsP8As/pXS/Yf9mmvaLHE0jjCqCxPoBX0zilqzybnMyWqxrlh9BSR2ySfdAyO" +
  "1SXExnnLDhc/KPQU2ORopA6Hkdj3rwJZn+/uvg2/4J2rD+55jvsP+z+lH2H/AGf0roYII7m3WeIEow4z" +
  "WVr1ylhD9mj3C4kXII/hXPX9CK9mrVhTp+1b0OWMXKXKjnrt0MvlxEFR1I7mo7e4ntLuK6tZpIJ4nEkc" +
  "sTFWRgchgRyCDyCKjor5GvVdaTlPqelCPIrI+wvhF8SYPHPhZLXULuM+IbRMXcWwR+aucLKoBwQRtDYx" +
  "hs8AFc+jV8KeD/FWo+DfGFpr2mySAxOBNCj7RcRZBeJsgjDAdcHBwRyBX2Bp/wASfBmo+FYNej1uCKCV" +
  "A3kSH9+hztKmIZbIOQcAjjIJHNfj/EfDNbD4rmwdNyhPZJXs+1kvu+7off5PnEK1HlrySlHq3a676/iT" +
  "/EG6t7T4V+IZLqTYj2EsAO0nLyKY0HHqzKPx5r44+w/7P6V7F8RfHMvjNobCytnt9KgYSqsyjzJJMEbm" +
  "wTgAMQAD3JPYDgvsP+zX65wFw9XynAP60rTqO7XZWsk/Pq/u3TPjOJMzp43Er2OsYq1+/f5HS/Yf9n9K" +
  "47xHqCSXRsLcsEiYiU9NzDt9B/noDXJ07e/99vzrqxXELr0/ZqHLfzv+iPApSUJcz1LlFU97/wB9vzo3" +
  "v/fb868r62ux1fWl2NrT9ZGkmRpUaWJlOIwcfP2P9D/XGK52eea6uXuJ5DJI5yzHvUzfP975sevNJtX+" +
  "6PyrSWYylBU3shLEQTcralairO1f7o/Kjav90flWf1tdh/Wl2K1bfhzWU0u/8u6ZzaS8MBzsP97H88fr" +
  "gCs3av8AdH5UbV/uj8q0o5i6U1OC1QpYiMlZo9e+w/7P6UfYf9n9K8ior2v9aF/z6/8AJv8AgHDYKKKK" +
  "+SKCiiigAooooAKKKKACiiigAooooA//2Q==";

export const CLEAN_JPEG = decodeB64(CLEAN_JPEG_B64);

const CLEAN_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAADRUlEQVR42mMU0vJiGAW4AQsTE9NoKOAP" +
  "IObRUBgNIEoCiHk0gEZT0GghjQYe9r7DFJQvFhrNYgz3u17jDzXFMtERmsXudrwgPgSVKyRGVgDdbntK" +
  "amiqVkkPwywmwnnnzXcVNMGbzY/IC1P1WjmCyhg1nDOHSugIsd+EMN79VIcLXm+8T4mZmvWKw7AWo6Kb" +
  "CRrFqOORNyQChY/pCjL30z8dBgaGyzW3KDdZt0VtyBfSPAwXMcPrC4M+lRIR89AOIK5/53CHGhvl5l+s" +
  "um7YoTOUU9A/OhRqzHiq+UFdSLP9PIlH1rrt19EqKiQiPIFAtRQkwHzpw189KncUvx8jqIYqYYQ3BVEj" +
  "gPgYz0PC6NN/Q6ol+6+HiVRJeRjhCyBmqrSkYcUEM/Xa5f/pmJHxOJsKKYjzD6KY4P535juLOeUu/vth" +
  "L0nqKUxENMxi7L+OYYbXTzYrSsz8/W4XGbrIDiOHGQ54mtMU1WKs34/gCrXfnDbkmfnz9Q6y3UNeGOEP" +
  "AVq1g4bKKIrLXFf8vTHyA4jx8z58xd7Xg/95nUg18+vzTRR6mNRERND7ZI4H/f+wm5gQZBRwJd7Mz0/W" +
  "UyVREB9GHou8CSYPclLQ33c7iA9HZiGPwZm5vJb4ETNqQs540F8ajN28f7CKip4nmIh8lgUQ6W9G35zZ" +
  "pNUyrzaT3BQQ88Wv4O295bRII1jDyG9FMGlFrX/+POJVf3++gczGpGQALqnXt5fQLh8hh1HA6jBy+oP0" +
  "qY8HqtYPWhuJ5AbyXM7ETCT6+nQt2Q79+nQtVjNf3lxI0wB6eXMh8R7EhZiJQZ8fU1qIfn68Cs3M59fn" +
  "0SERPb8+j0g/YkfEgI8PqFOIfnywHG7m0yuz6ZbRnl6ZzUQuoPeQ60AVRmTbSziLvb2ziIoOfXtnERMz" +
  "88ML0+gcQA8vTCMvizHG1uPr/ry8Pofqbv3y5ctAtZ6VTQuoWYsNs9BhYGC4e3oCqVUYC/MIW4JHqn8Z" +
  "9WIMsEpI/JIbZskH4QyhdyS0pHFJvGB7RH2nCQ29FDe6inw0gEYDaDSARgNoNIBGA2g0gEYDaBSMBtBo" +
  "AI0G0GgAjQbQaACNBtBoAI2C0QAaDaDRABoNoNEAGhoAAJt76TOK8otqAAAAAElFTkSuQmCC";

export const CLEAN_PNG = decodeB64(CLEAN_PNG_B64);

const COMMENT = "demo-comment";
const IPTC_CAPTION = "Synthetic sample used only to demonstrate metadata stripping.";
const IPTC_BYLINE = "Demo Photographer";
const XMP_CREATOR = "Demo Photographer";
const XMP_TOOL = "ExifScrubber Sample";

export function buildSampleJpeg(): Uint8Array {
  const exif = makeJpegSegment(0xe1, buildSampleExifPayload());
  const xmp = makeJpegSegment(0xe1, buildXmpApp1Payload(XMP_CREATOR, XMP_TOOL));
  const iptc = makeJpegSegment(0xed, buildIptcApp13Payload(IPTC_CAPTION, IPTC_BYLINE));
  const com = makeJpegSegment(0xfe, new TextEncoder().encode(COMMENT));
  return insertJpegSegments(CLEAN_JPEG, [exif, xmp, iptc, com]);
}

export function buildSamplePng(): Uint8Array {
  const tiff = buildExifTiff(
    [
      { tag: 0x010f, type: 2, value: SAMPLE_EXIF.make },
      { tag: 0x0110, type: 2, value: SAMPLE_EXIF.model },
      { tag: 0x0131, type: 2, value: SAMPLE_EXIF.software },
      { tag: 0x0132, type: 2, value: SAMPLE_EXIF.dateTime },
    ],
    [
      { tag: 0x0001, type: 2, value: SAMPLE_EXIF.latRef },
      { tag: 0x0002, type: 5, value: SAMPLE_EXIF.lat },
      { tag: 0x0003, type: 2, value: SAMPLE_EXIF.lonRef },
      { tag: 0x0004, type: 5, value: SAMPLE_EXIF.lon },
    ],
  );
  return insertPngChunksAfterIhdr(CLEAN_PNG, [
    { type: "eXIf", data: tiff, crcOk: true },
    makeTextChunk("Author", "Demo Photographer"),
    makeItxtChunk("Description", "Synthetic sample used only to demonstrate metadata stripping."),
    makeTimeChunk(2020, 1, 2, 3, 4, 5),
  ]);
}

export const SAMPLE_VALUES = {
  comment: COMMENT,
  caption: IPTC_CAPTION,
  byline: IPTC_BYLINE,
  xmpCreator: XMP_CREATOR,
  xmpTool: XMP_TOOL,
  author: "Demo Photographer",
  description: "Synthetic sample used only to demonstrate metadata stripping.",
};
