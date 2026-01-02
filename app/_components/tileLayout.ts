// app/_components/tileLayout.ts
export type HexTile = {
  id: string;       // "0".."59"
  q: number;        // axial coords
  r: number;
  cx: number;       // center in SVG coords
  cy: number;
  d: string;        // path for the (jittered) hex
  neighbors: string[]; // neighbor ids
};

// 6 axial neighbor directions
const DIRS: Array<[number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

// deterministic pseudo-random (so layout stays stable)
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function key(q: number, r: number) {
  return `${q},${r}`;
}

function axialToPixel(q: number, r: number, size: number) {
  // pointy-top hex
  const x = size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const y = size * ((3 / 2) * r);
  return { x, y };
}

function hexPath(cx: number, cy: number, size: number) {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30); // pointy top
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    pts.push([x, y]);
  }
  return `M ${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`;
}


/**
 * Build a “blob” of exactly 60 hexes, deterministic.
 * - We start from a hex disk (radius 5 -> 91 tiles),
 * - then keep the 60 tiles with highest “noise score” to form an organic continent.
 */
function build60(seed = 1337) {
  const rand = mulberry32(seed);

  // generate disk radius 5 (axial coords)
  const radius = 5;
  const all: Array<{ q: number; r: number; score: number }> = [];

  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const s = -q - r;
      if (Math.abs(q) <= radius && Math.abs(r) <= radius && Math.abs(s) <= radius) {
        // score: mix of distance + random -> keeps center dense, edges jagged
        const dist = (Math.abs(q) + Math.abs(r) + Math.abs(s)) / 2;
        const edgeBias = 1 - dist / radius; // center higher
        const noise = rand();               // 0..1
        const score = edgeBias * 0.8 + noise * 0.2;
        all.push({ q, r, score });
      }
    }
  }

  // pick top 60 by score
  all.sort((a, b) => b.score - a.score);
  const picked = all.slice(0, 60);

  // map coords -> index
  const byCoord = new Map<string, number>();
  picked.forEach((t, i) => byCoord.set(key(t.q, t.r), i));

  // centers, paths, neighbors
  const size = 42; // hex size in “local space”; we’ll auto-fit in MapSvg anyway
  const centers = picked.map((t, i) => {
    const { x, y } = axialToPixel(t.q, t.r, size);
    return { i, q: t.q, r: t.r, x, y };
  });

  // normalize to positive coords later in MapSvg; for now keep raw
  const tiles: HexTile[] = centers.map(({ i, q, r, x, y }) => {
    // per-tile jitter uses stable seed based on tile index
    const r2 = mulberry32(seed * 1000 + i);
    const d = hexPath(x, y, size);


    const neighbors: string[] = [];
    for (const [dq, dr] of DIRS) {
      const j = byCoord.get(key(q + dq, r + dr));
      if (j !== undefined) neighbors.push(String(j)); // id = index
    }

    return {
      id: String(i),
      q,
      r,
      cx: x,
      cy: y,
      d,
      neighbors,
    };
  });

  return tiles;
}

export const HEX_TILES_60: HexTile[] = build60(1337);

// helper for move validation (from host/player)
export function isNeighbor(fromId: string, toId: string) {
  const t = HEX_TILES_60[Number(fromId)];
  if (!t) return false;
  return t.neighbors.includes(String(toId));
}
