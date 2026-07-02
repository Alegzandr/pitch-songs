// Cursor-based DataView helpers shared by the WAV/AIFF encoders and the
// header-metadata reader.

export class BinaryWriter {
  readonly view: DataView;
  private pos = 0;
  private readonly littleEndian: boolean;

  constructor(buffer: ArrayBuffer, littleEndian: boolean) {
    this.view = new DataView(buffer);
    this.littleEndian = littleEndian;
  }

  ascii(text: string): void {
    for (let i = 0; i < text.length; i++) {
      this.view.setUint8(this.pos++, text.charCodeAt(i));
    }
  }

  u16(value: number): void {
    this.view.setUint16(this.pos, value, this.littleEndian);
    this.pos += 2;
  }

  u32(value: number): void {
    this.view.setUint32(this.pos, value, this.littleEndian);
    this.pos += 4;
  }

  i16(value: number): void {
    this.view.setInt16(this.pos, value, this.littleEndian);
    this.pos += 2;
  }
}

/** Read `length` ASCII characters at `offset` (chunk ids like "RIFF", "fLaC"). */
export function readAscii(view: DataView, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i++) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}
