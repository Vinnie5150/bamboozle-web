"use client";

import { useMemo } from "react";
import { HEX_TILES_60 } from "./tileLayout";

type Tile = { id: string; ownerPlayerId: string | null; isBasecamp: boolean };

export default function MapSvg({
  tiles,
  tileTroops,
  colorForPlayer,
  mageByTile,
  selectedTileId,
  onSelectTile,
  highlightTileIds,
}: {
  tiles: Tile[];
  tileTroops: Record<string, { foot: number; cav: number; arch: number }>;
  colorForPlayer: (playerId: string | null) => string;
  mageByTile: Record<string, string>;
  selectedTileId?: string | null;
  onSelectTile?: (tileId: string) => void;
  highlightTileIds?: string[];
}) {
  const VIEW_W = 1150;
  const VIEW_H = 600;
  const PAD = 40;

  const tileById = useMemo(() => new Map(tiles.map((t) => [String(t.id), t])), [tiles]);
  const highlightSet = useMemo(() => new Set((highlightTileIds ?? []).map(String)), [highlightTileIds]);

  // Auto-fit the hex blob into 1150x600
  const { s, tx, ty, centers } = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    // bbox from centers + approximate radius
    const approxR = 55;
    for (const t of HEX_TILES_60) {
      minX = Math.min(minX, t.cx - approxR);
      minY = Math.min(minY, t.cy - approxR);
      maxX = Math.max(maxX, t.cx + approxR);
      maxY = Math.max(maxY, t.cy + approxR);
    }

    const rawW = maxX - minX;
    const rawH = maxY - minY;

    const scale = Math.min((VIEW_W - 2 * PAD) / rawW, (VIEW_H - 2 * PAD) / rawH);
    const bboxW = rawW * scale;
    const bboxH = rawH * scale;

    const extraX = (VIEW_W - 2 * PAD - bboxW) / 2;
    const extraY = (VIEW_H - 2 * PAD - bboxH) / 2;

    const tX = PAD + extraX - minX * scale;
    const tY = PAD + extraY - minY * scale;

    const centers = HEX_TILES_60.map((t) => ({ cx: t.cx, cy: t.cy }));
    return { s: scale, tx: tX, ty: tY, centers };
  }, []);

  return (
    <div style={{ border: "1px solid #6b5b45", borderRadius: 14, padding: 10, background: "#1f1a12" }}>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" style={{ display: "block" }}>
        <defs>
          {/* Sea gradient */}
          <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#143246" />
            <stop offset="100%" stopColor="#0b1f2c" />
          </linearGradient>

          {/* Parchment overlay */}
          <filter id="paperTexture">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" />
            <feColorMatrix
              values="
                1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 .18 0"
            />
          </filter>

          {/* Soft vignette */}
          <radialGradient id="vignette" cx="50%" cy="45%" r="75%">
            <stop offset="0%" stopColor="rgba(0,0,0,0)" />
            <stop offset="70%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.40)" />
          </radialGradient>

          <filter id="inkShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#000" floodOpacity="0.35" />
          </filter>
          <filter id="selectedGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#000" floodOpacity="0.55" />
          </filter>
          <filter id="highlightGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#000" floodOpacity="0.35" />
          </filter>
          <filter id="titleGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

        </defs>

        {/* Background image */}
          <image
            href="/maps/fantasy-bg.png"
            x="0"
            y="0"
            width={VIEW_W}
            height={VIEW_H}
            preserveAspectRatio="xMidYMid slice"
            opacity="1"
            style={{ pointerEvents: "none" }}
          />

          {/* Map title */}
            <text
              x={VIEW_W / 2}
              y={50}
              textAnchor="middle"
              fontFamily="'Cinzel', serif"
              fontSize="60"
              letterSpacing="10"
              fill="#3b2a1a"
              opacity="0.95"
              pointerEvents="none"
              filter="url(#titleGlow)"
            >
              HORGOTH
            </text>

            {/* Title outline */}
            <text
              x={VIEW_W / 2}
              y={50}
              textAnchor="middle"
              fontFamily="'Cinzel', serif"
              fontSize="60"
              letterSpacing="10"
              fill="none"
              stroke="#f3e7cf"
              strokeWidth="2"
              opacity="0.9"
              pointerEvents="none"
              
            >
              HORGOTH
            </text>


          {/* Light parchment wash so unit icons stay readable */}
          <rect
            x="0"
            y="0"
            width={VIEW_W}
            height={VIEW_H}
            fill="#f3e7cf"
            opacity="0.35"
            pointerEvents="none"
          />

          {/* Subtle paper grain (your existing filter) */}
          <rect
            x="0"
            y="0"
            width={VIEW_W}
            height={VIEW_H}
            filter="url(#paperTexture)"
            opacity="0.30"
            pointerEvents="none"
          />


        {/* Tiles */}
        <g transform={`translate(${tx},${ty}) scale(${s})`}>
          {HEX_TILES_60.map((region, i) => {
            const id = region.id; // "0".."59"
            const t = tileById.get(id);
            const fill = colorForPlayer(t?.ownerPlayerId ?? null);

            const isSelected = String(selectedTileId ?? "") === id;
            const isHighlighted = highlightSet.has(id);

            const stroke = isSelected ? "#1a120b" : isHighlighted ? "#2b2116" : "rgba(43,33,22,0.55)";
            const strokeWidth = isSelected ? 4 : isHighlighted ? 3 : 1.2;
            const regionFilter = isSelected ? "url(#selectedGlow)" : isHighlighted ? "url(#highlightGlow)" : "url(#inkShadow)";

            const c = centers[i];

            return (
              <g key={id}>
                <path
                  d={region.d}
                  fill={fill}
                  fillOpacity={region.ownerPlayerId ? 0.65 : 0.35}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeOpacity={1}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: onSelectTile ? "pointer" : "default" }}
                  onClick={() => onSelectTile?.(id)}
                />


                {/* label */}
                <text
                  x={c.cx}
                  y={c.cy}
                  textAnchor="middle"
                  fontSize="12"
                  fill="#1a120b"
                  opacity={0.70}
                  stroke="rgba(243,231,207,0.9)"
                  strokeWidth={2}
                  paintOrder="stroke"
                  style={{ userSelect: "none", fontFamily: "Georgia, 'Times New Roman', serif" }}
                  onClick={() => onSelectTile?.(id)}
                >
                  {id}
                </text>

                {/* troops */}
                {(() => {
                  const troops = tileTroops[id] ?? { foot: 0, cav: 0, arch: 0 };
                  const hasAny = troops.foot > 0 || troops.cav > 0 || troops.arch > 0;
                  if (!hasAny) return null;

                  return (
                    <text
                      x={c.cx}
                      y={c.cy + 18}
                      textAnchor="middle"
                      fontSize="12"
                      fill="#1a120b"
                      style={{ userSelect: "none", fontFamily: "Georgia, 'Times New Roman', serif" }}
                    >
                      {troops.foot > 0 ? `🗡️${troops.foot} ` : ""}
                      {troops.cav > 0 ? `🐎${troops.cav} ` : ""}
                      {troops.arch > 0 ? `🏹${troops.arch}` : ""}
                    </text>
                  );
                })()}

                {/* mage */}
                {mageByTile?.[id] && (
                  <text x={c.cx + 18} y={c.cy - 16} textAnchor="middle" fontSize="16" style={{ userSelect: "none" }}>
                    🧙
                  </text>
                )}

                {/* basecamp */}
                {t?.isBasecamp && (
                  <text x={c.cx} y={c.cy - 16} textAnchor="middle" fontSize="16" style={{ userSelect: "none" }}>
                    🏰
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* vignette */}
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#vignette)" pointerEvents="none" />
      </svg>
    </div>
  );
}
