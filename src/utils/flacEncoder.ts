/**
 * FLAC Encoder
 *
 * Encodes an AudioBuffer to a real, lossless FLAC stream using libFLAC compiled
 * to WebAssembly (libflacjs). The WASM module is loaded lazily on first use so it
 * never weighs on the initial bundle - it only ships when the user exports FLAC.
 *
 * NOTE: we drive libFLAC's low-level C API directly rather than the bundled
 * `Encoder` helper. That helper is a CommonJS module that does a runtime
 * `require("./utils/data-utils")`, which Rollup cannot statically resolve and
 * which throws at load time, white-screening the whole app. The low-level API is
 * just function calls on the WASM module object, so it bundles cleanly.
 */

import type * as LibFlac from 'libflacjs/dist/index';
import type { CompressionLevel } from 'libflacjs/dist/index';
import { FLAC_ENCODING } from '../constants';
import { interleaveToInt16 } from './pcm';

/** The libFLAC module namespace (all encoder/decoder bindings live on it). */
type Flac = typeof LibFlac;

let flacReady: Promise<Flac> | null = null;

/**
 * Lazily load the libFLAC WASM module and resolve once it is ready to encode.
 * Cached so the WASM is fetched and instantiated at most once per session.
 */
async function getFlac(): Promise<Flac> {
  if (!flacReady) {
    flacReady = (async () => {
      // Resolve the .wasm asset through Vite so it gets a hashed, served URL,
      // then tell libflacjs where to find it before the module instantiates.
      const { default: wasmUrl } = await import('libflacjs/dist/libflac.wasm.wasm?url');
      (globalThis as { FLAC_SCRIPT_LOCATION?: Record<string, string> }).FLAC_SCRIPT_LOCATION = {
        'libflac.wasm.wasm': wasmUrl,
      };

      const mod = await import('libflacjs/dist/libflac.wasm.js');
      const flac = ((mod as { default?: Flac }).default ?? (mod as unknown as Flac));

      if (!flac.isReady()) {
        await new Promise<void>((resolve) => {
          flac.on('ready', () => resolve());
        });
      }
      return flac;
    })();
  }
  return flacReady;
}

/**
 * Convert an AudioBuffer to a lossless FLAC file.
 *
 * The float samples are quantized to 16-bit signed PCM (matching the rest of the
 * export pipeline) and fed to libFLAC as a single interleaved block.
 *
 * @param audioBuffer - The AudioBuffer to encode
 * @param compressionLevel - libFLAC compression level (0–8), defaults to 5
 * @returns Promise resolving to a Blob containing the FLAC file
 * @throws Error if the encoder cannot be created or produces no data
 */
export async function audioBufferToFlac(
  audioBuffer: AudioBuffer,
  compressionLevel: CompressionLevel = FLAC_ENCODING.COMPRESSION_LEVEL,
): Promise<Blob> {
  const flac = await getFlac();

  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.length;

  // 16-bit PCM widened to an Int32Array (libFLAC reads one 32-bit slot per sample).
  const interleaved = new Int32Array(interleaveToInt16(audioBuffer));

  const encoderId = flac.create_libflac_encoder(
    sampleRate,
    channels,
    FLAC_ENCODING.BITS_PER_SAMPLE,
    compressionLevel,
    samples,
    false,
  );
  if (encoderId === 0) {
    throw new Error('Failed to create FLAC encoder');
  }

  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  const writeCallback = (data: Uint8Array, numberOfBytes: number) => {
    // `data` is a view into the WASM heap that may be reused - copy it out.
    const chunk = new Uint8Array(data.subarray(0, numberOfBytes));
    chunks.push(chunk);
    totalLength += chunk.length;
  };

  try {
    const initStatus = flac.init_encoder_stream(encoderId, writeCallback);
    if (initStatus !== 0) {
      throw new Error(`Failed to initialize FLAC encoder stream (status ${initStatus})`);
    }

    const ok = flac.FLAC__stream_encoder_process_interleaved(encoderId, interleaved, samples);
    if (!ok) {
      throw new Error('FLAC encoding failed during processing');
    }
    flac.FLAC__stream_encoder_finish(encoderId);

    if (totalLength === 0) {
      throw new Error('FLAC encoding produced no data');
    }

    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return new Blob([merged as BlobPart], { type: 'audio/flac' });
  } finally {
    flac.FLAC__stream_encoder_delete(encoderId);
  }
}
