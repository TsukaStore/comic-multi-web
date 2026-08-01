import sharp from "sharp";

/**
 * Restore JM scrambled comic pages.
 * Port of the well-known strip-reorder algorithm (JMComic / PicaComic).
 */
export async function scrambleImage(input: Buffer, comicId: string): Promise<Buffer> {
  const num = getScrambleNum(comicId);
  if (num <= 1) return input;

  const image = sharp(input, { failOn: "none" });
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return input;

  const remainder = height % num;
  const partHeight = Math.floor(height / num);

  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const out = Buffer.alloc(data.length);

  // Scrambled top→bottom order is reverse natural strips.
  // Natural strip 0 (top) has height partHeight + remainder.
  let destY = 0;
  for (let i = 0; i < num; i++) {
    const naturalIndex = i;
    const stripH = naturalIndex === 0 ? partHeight + remainder : partHeight;

    // Position of naturalIndex in scrambled image (top = num-1)
    let srcY = 0;
    for (let k = num - 1; k > naturalIndex; k--) {
      srcY += k === 0 ? partHeight + remainder : partHeight;
    }

    copyStrip(data, out, width, channels, srcY, destY, stripH);
    destY += stripH;
  }

  return sharp(out, {
    raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
}

function copyStrip(
  src: Buffer,
  dest: Buffer,
  width: number,
  channels: number,
  srcY: number,
  destY: number,
  h: number,
) {
  const rowBytes = width * channels;
  for (let y = 0; y < h; y++) {
    const s = (srcY + y) * rowBytes;
    const d = (destY + y) * rowBytes;
    src.copy(dest, d, s, s + rowBytes);
  }
}

export function getScrambleNum(id: string): number {
  const n = Number(String(id).replace(/\D/g, "")) || 0;
  if (n >= 268850) {
    const x = n % 10;
    switch (x) {
      case 0:
        return 2;
      case 1:
        return 4;
      case 2:
        return 6;
      case 3:
        return 8;
      case 4:
        return 10;
      case 5:
        return 12;
      case 6:
        return 14;
      case 7:
        return 16;
      case 8:
        return 18;
      case 9:
        return 20;
      default:
        return 10;
    }
  }
  if (n >= 220980) return 10;
  return 0;
}
