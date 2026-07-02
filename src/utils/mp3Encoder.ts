import { Mp3Encoder } from '@breezystack/lamejs';
import { channelToInt16 } from './pcm';

// Encodes an AudioBuffer to MP3 at the requested bitrate (matched to the source when available).
export async function audioBufferToMp3(
  audioBuffer: AudioBuffer,
  bitRate: number = 192
): Promise<Blob> {
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.length;

  const left = channelToInt16(audioBuffer.getChannelData(0));
  const right = channels > 1 ? channelToInt16(audioBuffer.getChannelData(1)) : null;

  // Encode to MP3
  const mp3encoder = new Mp3Encoder(channels, sampleRate, bitRate);
  const mp3Data: Uint8Array[] = [];

  const sampleBlockSize = 1152;
  for (let i = 0; i < samples; i += sampleBlockSize) {
    const leftChunk = left.subarray(i, i + sampleBlockSize);
    const rightChunk = right ? right.subarray(i, i + sampleBlockSize) : undefined;
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
  }

  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(new Uint8Array(mp3buf));
  }

  return new Blob(mp3Data as BlobPart[], { type: 'audio/mp3' });
}
