/**
 * Export Strategies
 *
 * Strategy pattern for exporting audio in different formats.
 * Each strategy handles a specific format with intelligent fallbacks.
 */

import { audioProcessor } from './audioProcessor';
import { audioBufferToMp3 } from './mp3Encoder';
import { audioBufferToAiff } from './aiffEncoder';
import { audioBufferToFlac } from './flacEncoder';
import { encodeWithMediaRecorder, getMimeTypeForFormat } from './mediaRecorderEncoder';
import { BITRATE } from '../constants';

/**
 * Export options passed to each strategy
 */
export interface ExportOptions {
  buffer: AudioBuffer;
  originalFile: File | null;
  estimatedBitrate: number;
}

/**
 * Result of an export operation
 */
export interface ExportResult {
  blob: Blob;
  extension: string;
}

/**
 * Base export strategy interface
 */
export interface ExportStrategy {
  /**
   * Export the audio buffer to the target format
   * @throws Error if export fails and no fallback is available
   */
  export(options: ExportOptions): Promise<ExportResult>;
}

class WavExportStrategy implements ExportStrategy {
  async export({ buffer }: ExportOptions): Promise<ExportResult> {
    const blob = await audioProcessor.audioBufferToWav(buffer);
    return { blob, extension: 'wav' };
  }
}

class Mp3ExportStrategy implements ExportStrategy {
  async export({ buffer, estimatedBitrate }: ExportOptions): Promise<ExportResult> {
    const blob = await audioBufferToMp3(buffer, estimatedBitrate);
    return { blob, extension: 'mp3' };
  }
}

class AiffExportStrategy implements ExportStrategy {
  async export({ buffer }: ExportOptions): Promise<ExportResult> {
    const blob = await audioBufferToAiff(buffer);
    return { blob, extension: 'aiff' };
  }
}

/**
 * Encodes a true lossless FLAC stream via libFLAC (WASM). Falls back to WAV -
 * also lossless - if the encoder fails to load or run.
 */
class FlacExportStrategy implements ExportStrategy {
  async export({ buffer }: ExportOptions): Promise<ExportResult> {
    try {
      const blob = await audioBufferToFlac(buffer);
      return { blob, extension: 'flac' };
    } catch (error) {
      console.warn('FLAC encoding failed, falling back to WAV (lossless):', error);
      const blob = await audioProcessor.audioBufferToWav(buffer);
      return { blob, extension: 'wav' };
    }
  }
}

/** MediaRecorder-based export with fallback to MP3 when the format is unsupported. */
abstract class MediaRecorderExportStrategy implements ExportStrategy {
  protected abstract getFormatName(): string;
  protected abstract getPreferredExtension(): string;

  async export({ buffer, estimatedBitrate }: ExportOptions): Promise<ExportResult> {
    const formatName = this.getFormatName();
    const mimeType = getMimeTypeForFormat(formatName);

    if (!mimeType) {
      // Browser doesn't support this format, fallback to MP3
      console.warn(`${formatName.toUpperCase()} not supported, falling back to MP3`);
      return this.fallbackToMp3(buffer, estimatedBitrate);
    }

    try {
      const bitRate = estimatedBitrate * 1000; // Convert kbps to bps
      const blob = await encodeWithMediaRecorder(buffer, {
        mimeType,
        audioBitsPerSecond: bitRate,
      });
      return { blob, extension: this.getPreferredExtension() };
    } catch (error) {
      console.warn(`MediaRecorder failed for ${formatName.toUpperCase()}, falling back to MP3:`, error);
      return this.fallbackToMp3(buffer, estimatedBitrate);
    }
  }

  private async fallbackToMp3(buffer: AudioBuffer, estimatedBitrate: number): Promise<ExportResult> {
    const blob = await audioBufferToMp3(buffer, estimatedBitrate);
    return { blob, extension: 'mp3' };
  }
}

class WebmExportStrategy extends MediaRecorderExportStrategy {
  protected getFormatName(): string {
    return 'webm';
  }

  protected getPreferredExtension(): string {
    return 'webm';
  }
}

class OggExportStrategy extends MediaRecorderExportStrategy {
  protected getFormatName(): string {
    return 'ogg';
  }

  protected getPreferredExtension(): string {
    return 'ogg';
  }
}

class M4aExportStrategy extends MediaRecorderExportStrategy {
  private sourceExtension: string;

  constructor(sourceExtension: string = 'm4a') {
    super();
    this.sourceExtension = sourceExtension;
  }

  protected getFormatName(): string {
    return 'm4a';
  }

  protected getPreferredExtension(): string {
    // Return original extension if it was mp4, otherwise m4a
    return this.sourceExtension === 'mp4' ? 'mp4' : 'm4a';
  }
}

/** Unknown formats fall back to MP3. */
class DefaultExportStrategy implements ExportStrategy {
  async export({ buffer, estimatedBitrate }: ExportOptions): Promise<ExportResult> {
    const blob = await audioBufferToMp3(buffer, estimatedBitrate);
    return { blob, extension: 'mp3' };
  }
}

/**
 * Map of file extensions to their export strategies
 */
const EXPORT_STRATEGIES: Record<string, ExportStrategy | ((ext: string) => ExportStrategy)> = {
  // Lossless formats
  'wav': new WavExportStrategy(),
  'wave': new WavExportStrategy(),
  'aiff': new AiffExportStrategy(),
  'aif': new AiffExportStrategy(),
  'aifc': new AiffExportStrategy(),
  'flac': new FlacExportStrategy(),

  // Lossy formats
  'mp3': new Mp3ExportStrategy(),

  // MediaRecorder-based formats
  'webm': new WebmExportStrategy(),
  'ogg': new OggExportStrategy(),
  'opus': new OggExportStrategy(), // Opus typically in OGG container
  'oga': new OggExportStrategy(),  // OGG audio

  // M4A/AAC formats - use factory to preserve original extension
  'm4a': (ext) => new M4aExportStrategy(ext),
  'aac': (ext) => new M4aExportStrategy(ext),
  'mp4': (ext) => new M4aExportStrategy(ext),
};

/**
 * Get the appropriate export strategy for a given file extension
 *
 * @param extension - File extension (e.g., 'mp3', 'wav', 'flac')
 * @returns ExportStrategy instance for the format
 */
export function getExportStrategy(extension: string): ExportStrategy {
  const normalized = extension.toLowerCase();
  const strategy = EXPORT_STRATEGIES[normalized];

  if (!strategy) {
    console.warn(`Unknown format: ${extension}, using default (MP3)`);
    return new DefaultExportStrategy();
  }

  // Handle factory functions (for formats that need context)
  if (typeof strategy === 'function') {
    return strategy(normalized);
  }

  return strategy;
}

/**
 * Estimate bitrate from file size and duration
 *
 * @param file - Original audio file
 * @param durationSeconds - Duration in seconds
 * @returns Estimated bitrate in kbps, clamped to common MP3 range
 */
export function estimateBitrate(file: File | null, durationSeconds: number): number {
  if (!file || durationSeconds <= 0) {
    return BITRATE.DEFAULT_MP3_KBPS;
  }

  const kbps = Math.round(((file.size * 8) / durationSeconds) / 1000);
  return Math.min(BITRATE.MAX_MP3_KBPS, Math.max(BITRATE.MIN_MP3_KBPS, kbps));
}
