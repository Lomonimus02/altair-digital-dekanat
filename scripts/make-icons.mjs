import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const nx = (x / size) * 64;
      const ny = (y / size) * 64;
      const radius = 16;
      const inside =
        nx >= 2 && ny >= 2 && nx <= 62 && ny <= 62 &&
        (nx >= radius || ny >= radius || (nx - radius) ** 2 + (ny - radius) ** 2 <= radius ** 2) &&
        (nx <= 64 - radius || ny >= radius || (nx - (64 - radius)) ** 2 + (ny - radius) ** 2 <= radius ** 2) &&
        (nx >= radius || ny <= 64 - radius || (nx - radius) ** 2 + (ny - (64 - radius)) ** 2 <= radius ** 2) &&
        (nx <= 64 - radius || ny <= 64 - radius || (nx - (64 - radius)) ** 2 + (ny - (64 - radius)) ** 2 <= radius ** 2);
      const dx = nx - 32;
      const dy = ny - 32;
      const star = Math.abs(dx) * 0.55 + Math.abs(dy) < 18 && Math.abs(dy) * 0.55 + Math.abs(dx) < 18;
      if (!inside) {
        raw[i + 3] = 0;
      } else if (star) {
        raw[i] = 255;
        raw[i + 1] = 255;
        raw[i + 2] = 255;
        raw[i + 3] = 255;
      } else {
        raw[i] = 2;
        raw[i + 1] = 191;
        raw[i + 2] = 122;
        raw[i + 3] = 255;
      }
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ~crc >>> 0;
}

writeFileSync("client/public/icon-192.png", png(192));
writeFileSync("client/public/icon-512.png", png(512));
