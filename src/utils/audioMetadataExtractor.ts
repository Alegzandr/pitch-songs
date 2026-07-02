/**
 * Extracts audio metadata directly from file headers without decoding
 * This preserves the original sample rate before Web Audio API resampling
 */

import { METADATA_EXTRACTION, ERROR_MESSAGES } from '../constants';
import { readAscii } from './binary';

export interface RawAudioMetadata {
  sampleRate: number | null;
  channels: number | null;
  bitDepth: number | null;
}

const NO_METADATA: RawAudioMetadata = { sampleRate: null, channels: null, bitDepth: null };

async function extractWavMetadata(file: File): Promise<RawAudioMetadata> {
  const buffer = await file.slice(0, METADATA_EXTRACTION.HEADER_SIZES.WAV).arrayBuffer();
  const view = new DataView(buffer);

  if (readAscii(view, 0, 4) !== 'RIFF') return NO_METADATA;
  if (readAscii(view, 8, 4) !== 'WAVE') return NO_METADATA;
  if (readAscii(view, 12, 4) !== 'fmt ') return NO_METADATA;

  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitDepth = view.getUint16(34, true);

  return { sampleRate, channels, bitDepth };
}

async function extractAiffMetadata(file: File): Promise<RawAudioMetadata> {
  const buffer = await file.slice(0, METADATA_EXTRACTION.HEADER_SIZES.AIFF).arrayBuffer();
  const view = new DataView(buffer);

  if (readAscii(view, 0, 4) !== 'FORM') return NO_METADATA;
  const aiff = readAscii(view, 8, 4);
  if (aiff !== 'AIFF' && aiff !== 'AIFC') return NO_METADATA;

  // Find the COMM chunk
  let offset = 12;
  while (offset < buffer.byteLength - 8) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, false);

    if (chunkId === 'COMM') {
      const channels = view.getUint16(offset + 8, false);
      const bitDepth = view.getUint16(offset + 14, false);

      // The sample rate is 80-bit extended precision; the high 32 mantissa bits
      // are enough to reconstruct every standard audio rate.
      const exponent = view.getUint16(offset + 16, false);
      const mantissaHigh = view.getUint32(offset + 18, false);
      const sampleRate = mantissaHigh / Math.pow(2, 32 - (exponent - 0x3ffe));

      return { sampleRate: Math.round(sampleRate), channels, bitDepth };
    }

    offset += 8 + chunkSize;
  }

  return NO_METADATA;
}

async function extractFlacMetadata(file: File): Promise<RawAudioMetadata> {
  const buffer = await file.slice(0, METADATA_EXTRACTION.HEADER_SIZES.FLAC).arrayBuffer();
  const view = new DataView(buffer);

  if (readAscii(view, 0, 4) !== 'fLaC') {
    return NO_METADATA;
  }

  // Read STREAMINFO block (should be first metadata block)
  const blockType = view.getUint8(4) & 0x7f;
  if (blockType !== 0) {
    return NO_METADATA;
  }

  // Read sample rate (20 bits starting at byte 18, bits 0-19)
  // Channels (3 bits, bits 20-22)
  // Bit depth (5 bits, bits 23-27)
  const byte18 = view.getUint8(18);
  const byte19 = view.getUint8(19);
  const byte20 = view.getUint8(20);
  const byte21 = view.getUint8(21);

  const sampleRate = (byte18 << 12) | (byte19 << 4) | (byte20 >> 4);
  const channels = ((byte20 & 0x0e) >> 1) + 1;
  // Bit depth is a 5-bit field stored as (bitsPerSample - 1). The `+ 1` must apply
  // to the whole reconstructed value, not just the low nibble - hence the parens.
  const bitDepth = (((byte20 & 0x01) << 4) | ((byte21 & 0xf0) >> 4)) + 1;

  return { sampleRate, channels, bitDepth };
}

async function extractMp3Metadata(file: File): Promise<RawAudioMetadata> {
  const buffer = await file.slice(0, METADATA_EXTRACTION.HEADER_SIZES.MP3_SEARCH).arrayBuffer();
  const view = new DataView(buffer);

  // Skip ID3v2 tag if present
  let offset = 0;
  if (readAscii(view, 0, 3) === 'ID3') {
    const size = (view.getUint8(6) << 21) | (view.getUint8(7) << 14) |
                 (view.getUint8(8) << 7) | view.getUint8(9);
    offset = 10 + size;
  }

  while (offset < buffer.byteLength - 4) {
    const byte = view.getUint8(offset);

    // Check for frame sync (11 consecutive set bits)
    if (byte === METADATA_EXTRACTION.MP3_FRAME_SYNC) {
      const nextByte = view.getUint8(offset + 1);
      if ((nextByte & METADATA_EXTRACTION.MP3_FRAME_SYNC_MASK) === METADATA_EXTRACTION.MP3_FRAME_SYNC_MASK) {
        // Found sync word
        const version = (nextByte >> 3) & 0x03;
        const samplingRateIndex = (view.getUint8(offset + 2) >> 2) & 0x03;
        const channelMode = (view.getUint8(offset + 3) >> 6) & 0x03;

        const sampleRate = METADATA_EXTRACTION.MP3_SAMPLE_RATES[version]?.[samplingRateIndex];
        const channels = channelMode === 3 ? 1 : 2;

        if (sampleRate) {
          return { sampleRate, channels, bitDepth: null };
        }
      }
    }
    offset++;
  }

  return NO_METADATA;
}

/**
 * Extract metadata from audio file based on format
 */
export async function extractAudioMetadata(file: File): Promise<RawAudioMetadata> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';

  try {
    switch (extension) {
      case 'wav':
      case 'wave':
        return await extractWavMetadata(file);

      case 'aiff':
      case 'aif':
      case 'aifc':
        return await extractAiffMetadata(file);

      case 'flac':
        return await extractFlacMetadata(file);

      case 'mp3':
        return await extractMp3Metadata(file);

      // For other formats (OGG, M4A, WebM), we can't easily extract without heavy parsing
      // Return null values to use decoded buffer info as fallback
      default:
        return NO_METADATA;
    }
  } catch (error) {
    console.warn(ERROR_MESSAGES.METADATA_EXTRACTION_FAILED(extension), error);
    return NO_METADATA;
  }
}
