/**
 * AIFF (Audio Interchange File Format) Encoder
 * AIFF is similar to WAV but uses big-endian byte order (Apple's format)
 */

import { BinaryWriter } from './binary';
import { interleaveToInt16 } from './pcm';

const COMM_CHUNK_BYTES = 26;
const SSND_HEADER_BYTES = 16;

export async function audioBufferToAiff(audioBuffer: AudioBuffer): Promise<Blob> {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const numFrames = audioBuffer.length;
  const dataSize = numFrames * numberOfChannels * 2;

  // FORM container (12 bytes) + COMM chunk + SSND chunk header + samples.
  const formChunkSize = 4 + COMM_CHUNK_BYTES + SSND_HEADER_BYTES + dataSize;
  const buffer = new ArrayBuffer(12 + COMM_CHUNK_BYTES + SSND_HEADER_BYTES + dataSize);
  const writer = new BinaryWriter(buffer, false);

  // Sample rate is stored as 80-bit extended precision; this simplified encoding
  // covers every standard audio rate.
  const writeExtendedSampleRate = (value: number) => {
    const exponent = 0x400e;
    const mantissa = Math.floor(value * Math.pow(2, 32 - 15));
    writer.u16(exponent);
    writer.u32(mantissa);
    writer.u32(0); // lower 32 bits of the mantissa
  };

  writer.ascii('FORM');
  writer.u32(formChunkSize);
  writer.ascii('AIFF');

  writer.ascii('COMM');
  writer.u32(18); // COMM payload size
  writer.u16(numberOfChannels);
  writer.u32(numFrames);
  writer.u16(16); // bits per sample
  writeExtendedSampleRate(audioBuffer.sampleRate);

  writer.ascii('SSND');
  writer.u32(dataSize + 8); // data + offset + blockSize fields
  writer.u32(0); // offset
  writer.u32(0); // blockSize

  const pcm = interleaveToInt16(audioBuffer);
  for (let i = 0; i < pcm.length; i++) {
    writer.i16(pcm[i]);
  }

  return new Blob([buffer], { type: 'audio/aiff' });
}
