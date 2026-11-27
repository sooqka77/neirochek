/* Pure JS ISO/IEC 18004 QR Code Model 2 Generator (Byte mode, ECC Level M, Versions 1–16)
 * Zero external dependencies — works offline and anywhere without CDN risk.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KartaQR = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // GF(256) with primitive polynomial 0x11D
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGeneratorPoly(ecLen) {
    let poly = [1];
    for (let i = 0; i < ecLen; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const factor = EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGeneratorPoly(ecLen);
    const rem = new Uint8Array(ecLen);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ rem[0];
      for (let j = 0; j < ecLen - 1; j++) {
        rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
      }
      rem[ecLen - 1] = gfMul(gen[ecLen], factor);
    }
    return rem;
  }

  // ISO/IEC 18004 Table 9 for ECC Level M: [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data]
  const ECC_M = [
    null,
    [10, 1, 16, 0, 0],   // V1
    [16, 1, 28, 0, 0],   // V2
    [26, 1, 44, 0, 0],   // V3
    [18, 2, 32, 0, 0],   // V4
    [24, 2, 43, 0, 0],   // V5
    [16, 4, 27, 0, 0],   // V6
    [18, 4, 31, 0, 0],   // V7
    [22, 2, 38, 2, 39],  // V8
    [22, 3, 36, 2, 37],  // V9
    [26, 4, 43, 1, 44],  // V10
    [30, 1, 50, 4, 51],  // V11
    [22, 6, 36, 2, 37],  // V12
    [22, 8, 37, 1, 38],  // V13
    [24, 4, 40, 5, 41],  // V14
    [24, 5, 41, 5, 42],  // V15
    [28, 7, 45, 3, 46]   // V16
  ];

  // ISO/IEC 18004 Annex E alignment centers
  const ALIGN = [
    null,
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74]
  ];

  function toUtf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.from(new TextEncoder().encode(str));
    }
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        const c2 = str.charCodeAt(++i);
        const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function pickVersion(byteLen) {
    for (let v = 1; v <= 16; v++) {
      const [, g1b, g1d, g2b, g2d] = ECC_M[v];
      const totalDataBytes = g1b * g1d + g2b * g2d;
      const countBits = v <= 9 ? 8 : 16;
      const neededBits = 4 + countBits + byteLen * 8;
      if (neededBits <= totalDataBytes * 8) return v;
    }
    throw new Error('URL слишком длинный для QR-кода (максимум ~450 байт).');
  }

  function buildCodewords(bytes, version) {
    const [ecPerBlock, g1b, g1d, g2b, g2d] = ECC_M[version];
    const totalDataBytes = g1b * g1d + g2b * g2d;
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };

    // Byte mode indicator 0100
    pushBits(0b0100, 4);
    pushBits(bytes.length, version <= 9 ? 8 : 16);
    for (let i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);

    // Terminator (up to 4 zeros)
    const maxBits = totalDataBytes * 8;
    const termLen = Math.min(4, maxBits - bits.length);
    for (let i = 0; i < termLen; i++) bits.push(0);

    // Pad to byte boundary
    while (bits.length % 8 !== 0) bits.push(0);

    // Convert to data bytes
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }

    // Pad bytes 0xEC, 0x11
    let padToggle = 0;
    while (data.length < totalDataBytes) {
      data.push(padToggle === 0 ? 0xec : 0x11);
      padToggle ^= 1;
    }

    // Split into blocks & compute RS EC
    const dataBlocks = [];
    const ecBlocks = [];
    let offset = 0;
    for (let i = 0; i < g1b; i++) {
      const blk = data.slice(offset, offset + g1d);
      offset += g1d;
      dataBlocks.push(blk);
      ecBlocks.push(rsEncode(blk, ecPerBlock));
    }
    for (let i = 0; i < g2b; i++) {
      const blk = data.slice(offset, offset + g2d);
      offset += g2d;
      dataBlocks.push(blk);
      ecBlocks.push(rsEncode(blk, ecPerBlock));
    }

    // Interleave data codewords, then EC codewords
    const out = [];
    const maxDataLen = Math.max(g1d, g2d);
    for (let i = 0; i < maxDataLen; i++) {
      for (let b = 0; b < dataBlocks.length; b++) {
        if (i < dataBlocks[b].length) out.push(dataBlocks[b][i]);
      }
    }
    for (let i = 0; i < ecPerBlock; i++) {
      for (let b = 0; b < ecBlocks.length; b++) {
        out.push(ecBlocks[b][i]);
      }
    }
    return out;
  }

  function bchFormatInfo(eccBits2, mask3) {
    const data = (eccBits2 << 3) | mask3;
    let rem = data << 10;
    const gen = 0x537;
    for (let i = 14; i >= 10; i--) {
      if ((rem >>> i) & 1) rem ^= gen << (i - 10);
    }
    return ((data << 10) | rem) ^ 0x5412;
  }

  function bchVersionInfo(version) {
    let rem = version << 12;
    const gen = 0x1f25;
    for (let i = 17; i >= 12; i--) {
      if ((rem >>> i) & 1) rem ^= gen << (i - 12);
    }
    return (version << 12) | rem;
  }

  function createEmptyMatrix(version) {
    const size = 17 + 4 * version;
    const modules = Array.from({ length: size }, () => new Uint8Array(size));
    const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

    const setFunc = (r, c, dark) => {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      modules[r][c] = dark ? 1 : 0;
      isFunc[r][c] = 1;
    };

    // Finder patterns + separators
    const drawFinder = (top, left) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = top + r;
          const cc = left + c;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          const inBox = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          const dark =
            inBox &&
            (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
          setFunc(rr, cc, dark);
        }
      }
    };
    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      setFunc(6, i, i % 2 === 0);
      setFunc(i, 6, i % 2 === 0);
    }

    // Alignment patterns
    const centers = ALIGN[version];
    for (let i = 0; i < centers.length; i++) {
      for (let j = 0; j < centers.length; j++) {
        const cr = centers[i];
        const cc = centers[j];
        // Skip overlaps with finder patterns
        if ((cr <= 8 && cc <= 8) || (cr <= 8 && cc >= size - 9) || (cr >= size - 9 && cc <= 8)) {
          continue;
        }
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dist = Math.max(Math.abs(dr), Math.abs(dc));
            setFunc(cr + dr, cc + dc, dist !== 1);
          }
        }
      }
    }

    // Reserve format information areas (values written after mask choice)
    for (let i = 0; i <= 8; i++) {
      if (i !== 6) {
        setFunc(8, i, false);
        setFunc(i, 8, false);
      }
    }
    for (let i = 0; i < 8; i++) {
      setFunc(8, size - 1 - i, false);
    }
    for (let i = 0; i < 7; i++) {
      setFunc(size - 1 - i, 8, false);
    }
    // Dark module
    setFunc(4 * version + 9, 8, true);

    // Version information (versions >= 7)
    if (version >= 7) {
      const vBits = bchVersionInfo(version);
      for (let i = 0; i < 18; i++) {
        const bit = ((vBits >>> i) & 1) === 1;
        const r = Math.floor(i / 3);
        const c = size - 11 + (i % 3);
        setFunc(r, c, bit);
        setFunc(c, r, bit);
      }
    }

    return { size, modules, isFunc };
  }

  function placeData(matrix, codewords) {
    const { size, modules, isFunc } = matrix;
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    let upward = true;

    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip vertical timing column
      for (let step = 0; step < size; step++) {
        const r = upward ? size - 1 - step : step;
        for (let dx = 0; dx < 2; dx++) {
          const c = right - dx;
          if (!isFunc[r][c]) {
            let bit = 0;
            if (bitIdx < totalBits) {
              bit = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
            }
            modules[r][c] = bit;
            bitIdx++;
          }
        }
      }
      upward = !upward;
    }
    return bitIdx;
  }

  function maskBit(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function applyFormatInfo(modules, size, mask) {
    // ECC Level M indicator = 00 (binary 0)
    const fmt = bchFormatInfo(0b00, mask);
    // Bit 14 is MSB, Bit 0 is LSB
    const getBit = (idx) => (fmt >>> idx) & 1;

    // Top-left around finder: horizontal row 8 (cols 0..5, 7, 8 -> bits 14..7)
    const hCols = [0, 1, 2, 3, 4, 5, 7, 8];
    for (let i = 0; i < 8; i++) modules[8][hCols[i]] = getBit(14 - i);

    // Top-left vertical col 8 (rows 7, 5, 4, 3, 2, 1, 0 -> bits 6..0)
    const vRows = [7, 5, 4, 3, 2, 1, 0];
    for (let i = 0; i < 7; i++) modules[vRows[i]][8] = getBit(6 - i);

    // Bottom-left col 8 (rows size-1 .. size-7 -> bits 14..8)
    for (let i = 0; i < 7; i++) modules[size - 1 - i][8] = getBit(14 - i);

    // Top-right row 8 (cols size-8 .. size-1 -> bits 7..0)
    for (let i = 0; i < 8; i++) modules[8][size - 8 + i] = getBit(7 - i);
  }

  function penaltyScore(modules, size) {
    let score = 0;

    // Rule 1: adjacent modules in row/col in same color
    for (let r = 0; r < size; r++) {
      let runColor = modules[r][0];
      let runLen = 1;
      for (let c = 1; c < size; c++) {
        if (modules[r][c] === runColor) {
          runLen++;
        } else {
          if (runLen >= 5) score += 3 + (runLen - 5);
          runColor = modules[r][c];
          runLen = 1;
        }
      }
      if (runLen >= 5) score += 3 + (runLen - 5);
    }
    for (let c = 0; c < size; c++) {
      let runColor = modules[0][c];
      let runLen = 1;
      for (let r = 1; r < size; r++) {
        if (modules[r][c] === runColor) {
          runLen++;
        } else {
          if (runLen >= 5) score += 3 + (runLen - 5);
          runColor = modules[r][c];
          runLen = 1;
        }
      }
      if (runLen >= 5) score += 3 + (runLen - 5);
    }

    // Rule 2: 2x2 blocks of same color
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = modules[r][c];
        if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
          score += 3;
        }
      }
    }

    // Rule 3: finder-like 1:1:3:1:1 patterns
    const matchFinderLike = (arr) => {
      let hits = 0;
      for (let i = 0; i <= arr.length - 11; i++) {
        // 10111010000 or 00001011101
        if (
          arr[i] === 1 && arr[i + 1] === 0 && arr[i + 2] === 1 && arr[i + 3] === 1 &&
          arr[i + 4] === 1 && arr[i + 5] === 0 && arr[i + 6] === 1 &&
          arr[i + 7] === 0 && arr[i + 8] === 0 && arr[i + 9] === 0 && arr[i + 10] === 0
        ) hits++;
        if (
          arr[i] === 0 && arr[i + 1] === 0 && arr[i + 2] === 0 && arr[i + 3] === 0 &&
          arr[i + 4] === 1 && arr[i + 5] === 0 && arr[i + 6] === 1 && arr[i + 7] === 1 &&
          arr[i + 8] === 1 && arr[i + 9] === 0 && arr[i + 10] === 1
        ) hits++;
      }
      return hits * 40;
    };
    for (let r = 0; r < size; r++) score += matchFinderLike(modules[r]);
    const colBuf = new Uint8Array(size);
    for (let c = 0; c < size; c++) {
      for (let r = 0; r < size; r++) colBuf[r] = modules[r][c];
      score += matchFinderLike(colBuf);
    }

    // Rule 4: balance of dark modules
    let dark = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) dark += modules[r][c];
    }
    const pct = (dark * 100) / (size * size);
    const k = Math.floor(Math.abs(pct - 50) / 5);
    score += k * 10;

    return score;
  }

  function encode(text) {
    const bytes = toUtf8Bytes(String(text || ''));
    const version = pickVersion(bytes.length);
    const codewords = buildCodewords(bytes, version);
    const base = createEmptyMatrix(version);
    const placedBits = placeData(base, codewords);

    let bestMask = 0;
    let bestScore = Infinity;
    let bestModules = null;

    for (let mask = 0; mask < 8; mask++) {
      const cand = base.modules.map((row, r) => {
        const copy = new Uint8Array(row);
        for (let c = 0; c < base.size; c++) {
          if (!base.isFunc[r][c] && maskBit(mask, r, c)) {
            copy[c] ^= 1;
          }
        }
        return copy;
      });
      applyFormatInfo(cand, base.size, mask);
      const sc = penaltyScore(cand, base.size);
      if (sc < bestScore) {
        bestScore = sc;
        bestMask = mask;
        bestModules = cand;
      }
    }

    return {
      version,
      size: base.size,
      mask: bestMask,
      modules: bestModules,
      placedBits,
      codewords
    };
  }

  function toSVG(text, opts) {
    const options = Object.assign({ quietZone: 4, dark: '#111827', light: '#FFFFFF', sizePx: 220 }, opts);
    const qr = encode(text);
    const qz = options.quietZone;
    const total = qr.size + qz * 2;
    let path = '';
    for (let r = 0; r < qr.size; r++) {
      for (let c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) {
          path += `M${c + qz},${r + qz}h1v1h-1z`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${options.sizePx}" height="${options.sizePx}" shape-rendering="crispEdges" role="img" aria-label="QR-код">` +
      `<rect width="100%" height="100%" fill="${options.light}"/>` +
      `<path d="${path}" fill="${options.dark}"/>` +
      `</svg>`;
  }

  function drawToCanvas(canvas, text, opts) {
    const options = Object.assign({ quietZone: 4, scale: 10, dark: '#111827', light: '#FFFFFF' }, opts);
    const qr = encode(text);
    const qz = options.quietZone;
    const total = qr.size + qz * 2;
    canvas.width = total * options.scale;
    canvas.height = total * options.scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = options.light;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = options.dark;
    for (let r = 0; r < qr.size; r++) {
      for (let c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) {
          ctx.fillRect((c + qz) * options.scale, (r + qz) * options.scale, options.scale, options.scale);
        }
      }
    }
    return qr;
  }

  return { encode, toSVG, drawToCanvas, _internal: { ECC_M, rsEncode, bchFormatInfo, bchVersionInfo, EXP, LOG, gfMul } };
});
