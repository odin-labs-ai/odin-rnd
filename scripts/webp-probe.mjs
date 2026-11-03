import { readFileSync } from 'node:fs';

// The Lab 01 variants are VP8 stills. Refuse other WebP encodings until their headers are parsed here.
export function probeWebp(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error(`${file}: not a WebP RIFF file`);
  }
  if (bytes.readUInt32LE(4) !== bytes.length - 8) throw new Error(`${file}: invalid RIFF length`);
  const fourCC = bytes.toString('ascii', 12, 16);
  if (fourCC !== 'VP8 ') throw new Error(`${file}: unsupported WebP format ${fourCC}`);
  const chunkLength = bytes.readUInt32LE(16);
  if (chunkLength < 10 || 20 + chunkLength > bytes.length) throw new Error(`${file}: invalid VP8 chunk length`);
  if (bytes[20] & 1 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
    throw new Error(`${file}: invalid VP8 key-frame header`);
  }
  const width = bytes.readUInt16LE(26) & 0x3fff;
  const height = bytes.readUInt16LE(28) & 0x3fff;
  if (!width || !height) throw new Error(`${file}: invalid VP8 dimensions`);
  return { format: 'WebP', width, height };
}
