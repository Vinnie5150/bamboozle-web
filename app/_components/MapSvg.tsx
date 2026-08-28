"use client";

import { useMemo } from "react";
import { HEX_TILES_60 } from "./tileLayout";

type Tile = { id: string; ownerPlayerId: string | null; isBasecamp: boolean; farmers?: number };

export default function MapSvg({
  tiles,
  tileTroops,
  colorForPlayer,
  mageByTile,
  selectedTileId,
  onSelectTile,
  highlightTileIds,
  tieFighterPlayers,
}: {
  tiles: Tile[];
  tileTroops: Record<string, { foot: number; cav: number; arch: number }>;
  colorForPlayer: (playerId: string | null) => string;
  mageByTile: Record<string, string>;
  selectedTileId?: string | null;
  onSelectTile?: (tileId: string) => void;
  highlightTileIds?: string[];

  // Optional so existing MapSvg calls keep working until Play/Host are wired up.
  tieFighterPlayers?: Array<{
    id: string;
    name: string;
    tieFighters?: number;
  }>;
}) {
  const VIEW_W = 1150;
  const VIEW_H = 690;

  // Extra room above the board for TIE Fighters.
  const AIRSPACE_H = 105;
  const PAD = 40;

  const tileById = useMemo(() => new Map(tiles.map((t) => [String(t.id), t] as const)), [tiles]);
  const highlightSet = useMemo(() => new Set((highlightTileIds ?? []).map(String)), [highlightTileIds]);

  // label styling helpers
  const label = {
    idFont: 16,
    troopFont: 14,
    idDy: 2,
    troopDy: 28,
    textFill: "#1a120b",
    strokeLight: "rgba(243,231,207,0.95)",
  };

  // Auto-fit the hex blob below the dedicated airspace.
  const { s, tx, ty, centers } = useMemo(() => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

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

    const boardH = VIEW_H - AIRSPACE_H;

    const scale = Math.min(
      (VIEW_W - 2 * PAD) / rawW,
      (boardH - 2 * PAD) / rawH
    );

    const bboxW = rawW * scale;
    const bboxH = rawH * scale;

    const extraX = (VIEW_W - 2 * PAD - bboxW) / 2;
    const extraY = (boardH - 2 * PAD - bboxH) / 2;

    const tX = PAD + extraX - minX * scale;
    const tY = AIRSPACE_H + PAD + extraY - minY * scale;

    const centers = HEX_TILES_60.map((t) => ({ cx: t.cx, cy: t.cy }));
    return { s: scale, tx: tX, ty: tY, centers };
  }, []);

  const activeTieFighterPlayers = useMemo(() => {
    return (tieFighterPlayers ?? [])
      .map((p) => ({
        ...p,
        tieFighters: Math.max(
          0,
          Math.floor(Number(p.tieFighters ?? 0))
        ),
      }))
      .filter((p) => p.tieFighters > 0);
  }, [tieFighterPlayers]);

  return (
    <div
      style={{
        border: "1px solid #6b5b45",
        borderRadius: 14,
        padding: 10,
        background: "#1f1a12",
      }}
    >
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

          {/* Extra badge shadow */}
          <filter id="badgeShadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" floodColor="#000" floodOpacity="0.45" />
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

        {/* ===== AIRSPACE: TIE FIGHTERS ===== */}
        {activeTieFighterPlayers.length > 0 && (
          <g pointerEvents="none">
            {/* subtle airspace divider */}
            <line
              x1={55}
              y1={AIRSPACE_H - 7}
              x2={VIEW_W - 55}
              y2={AIRSPACE_H - 7}
              stroke="rgba(243,231,207,0.38)"
              strokeWidth={1}
              strokeDasharray="6 8"
            />

            {activeTieFighterPlayers.map((p, idx) => {
              const count = activeTieFighterPlayers.length;
              const usableW = VIEW_W - 120;
              const slotW = usableW / Math.max(1, count);
              const x = 60 + slotW * idx + slotW / 2;
              const playerColor = colorForPlayer(p.id);

              return (
                <g key={`tie-${p.id}`} transform={`translate(${x},92)`}>
                  {/* Player name */}
                  <text
                    x={0}
                    y={-16}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={800}
                    fill="#1a120b"
                    stroke="rgba(243,231,207,0.96)"
                    strokeWidth={3}
                    paintOrder="stroke"
                    style={{
                      userSelect: "none",
                      fontFamily: "Georgia, 'Times New Roman', serif",
                    }}
                  >
                    {p.name}
                  </text>

                  {/* Stylised twin-wing fighter in the player's colour */}
                  <g filter="url(#badgeShadow)">
                    <path
                      d="M -22 -10 L -14 -14 L -14 14 L -22 10 Z"
                      fill={playerColor}
                      stroke="#1a120b"
                      strokeWidth={1.6}
                    />
                    <path
                      d="M 22 -10 L 14 -14 L 14 14 L 22 10 Z"
                      fill={playerColor}
                      stroke="#1a120b"
                      strokeWidth={1.6}
                    />
                    <line
                      x1={-14}
                      y1={0}
                      x2={-6}
                      y2={0}
                      stroke="#1a120b"
                      strokeWidth={2.4}
                    />
                    <line
                      x1={14}
                      y1={0}
                      x2={6}
                      y2={0}
                      stroke="#1a120b"
                      strokeWidth={2.4}
                    />
                    <circle
                      cx={0}
                      cy={0}
                      r={7}
                      fill={playerColor}
                      stroke="#1a120b"
                      strokeWidth={2}
                    />
                    <circle
                      cx={0}
                      cy={0}
                      r={2.3}
                      fill="#1a120b"
                    />
                  </g>

                  {/* Fighter count */}
                  <text
                    x={30}
                    y={5}
                    textAnchor="start"
                    fontSize={14}
                    fontWeight={900}
                    fill="#1a120b"
                    stroke="rgba(243,231,207,0.96)"
                    strokeWidth={3}
                    paintOrder="stroke"
                    style={{
                      userSelect: "none",
                      fontFamily: "Georgia, 'Times New Roman', serif",
                    }}
                  >
                    {`×${p.tieFighters}`}
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* Light parchment wash so unit icons stay readable */}
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="#f3e7cf" opacity="0.35" pointerEvents="none" />

        {/* Subtle paper grain */}
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} filter="url(#paperTexture)" opacity="0.30" pointerEvents="none" />

        {/* Tiles */}
        <g transform={`translate(${tx + 22},${ty - 24}) scale(${s})`}>
          {HEX_TILES_60.map((region, i) => {
            const id = String(region.id); // "0".."59"
            const t = tileById.get(id);

            const fill = colorForPlayer(t?.ownerPlayerId ?? null);

            const isSelected = String(selectedTileId ?? "") === id;
            const isHighlighted = highlightSet.has(id);

            const stroke = isSelected ? "#1a120b" : isHighlighted ? "#2b2116" : "rgba(43,33,22,0.55)";
            const strokeWidth = isSelected ? 4 : isHighlighted ? 3 : 1.2;
            const regionFilter = isSelected ? "url(#selectedGlow)" : isHighlighted ? "url(#highlightGlow)" : "url(#inkShadow)";

            const c = centers[i];
            const clickable = !!onSelectTile;
            const cursor = clickable ? "pointer" : "default";
            const onPick = () => onSelectTile?.(id);

            // troops
            const troops = tileTroops[id] ?? { foot: 0, cav: 0, arch: 0 };
            const hasAnyTroops = troops.foot > 0 || troops.cav > 0 || troops.arch > 0;

            // build troops text
            const troopParts = [
              troops.foot > 0 ? `🗡️${troops.foot}` : "",
              troops.cav > 0 ? `🐎${troops.cav}` : "",
              troops.arch > 0 ? `🏹${troops.arch}` : "",
            ].filter(Boolean);
            const troopText = troopParts.join("  ");

            // sizes for badges (simple estimates)
            const idText = id;
            const isTwo = idText.length >= 2;
            const idW = isTwo ? 24 : 20;
            const idH = 18;

            const estChar = 7; // rough px per char
            const troopW = Math.min(180, Math.max(70, troopText.length * estChar));
            const troopH = 20;

            // icon badges
            const hasMageHere = !!mageByTile?.[id];
            const isBasecamp = !!t?.isBasecamp;
            const farmers = Math.max(0, Math.floor(Number(t?.farmers ?? 0)));
            const hasFarmers = farmers > 0;

            return (
              <g key={id} filter={regionFilter}>
                <path
                  d={region.d}
                  fill={fill}
                  fillOpacity={t?.ownerPlayerId ? 0.65 : 0.35}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeOpacity={1}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor }}
                  onClick={onPick}
                />

                {/* ===== TILE ID BADGE ===== */}
                <g onClick={onPick} style={{ cursor }}>
                  <rect
                    x={c.cx - idW / 2}
                    y={c.cy - idH / 2 - 2}
                    width={idW}
                    height={idH}
                    rx={6}
                    ry={6}
                    fill="rgba(0,0,0,0.38)"
                    stroke="rgba(243,231,207,0.50)"
                    strokeWidth={1}
                    filter="url(#badgeShadow)"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={c.cx}
                    y={c.cy + label.idDy}
                    textAnchor="middle"
                    fontSize={label.idFont}
                    fontWeight={800}
                    fill={label.textFill}
                    stroke={label.strokeLight}
                    strokeWidth={3}
                    paintOrder="stroke"
                    opacity={0.98}
                    style={{ userSelect: "none", fontFamily: "Georgia, 'Times New Roman', serif" }}
                  >
                    {idText}
                  </text>
                </g>

                {/* ===== TROOPS (simple text, no badge) ===== */}
                {hasAnyTroops ? (
                  <text
                    x={c.cx}
                    y={c.cy + 22}
                    textAnchor="middle"
                    fontSize={12}              // ⬅ kleiner
                    fontWeight={600}
                    fill="#1a120b"
                    opacity={0.85}
                    stroke="rgba(243,231,207,0.75)" // ⬅ zachte outline
                    strokeWidth={1.2}
                    paintOrder="stroke"
                    style={{
                      userSelect: "none",
                      fontFamily: "Georgia, 'Times New Roman', serif",
                      pointerEvents: "none",    // ⬅ voorkomt per ongeluk klikken
                    }}
                  >
                    {troopText}
                  </text>
                ) : null}


                {/* ===== ICON BADGES (Mage / Basecamp / Farmers) ===== */}
                {(hasMageHere || isBasecamp || hasFarmers) && (
                  <g onClick={onPick} style={{ cursor }}>
                    {/* Mage badge (top-right of center) */}
                    {hasMageHere && (
                      <g>
                        <circle
                          cx={c.cx + 22}
                          cy={c.cy - 18}
                          r={10}
                          fill="rgba(0,0,0,0.45)"
                          stroke="rgba(243,231,207,0.55)"
                          strokeWidth={1}
                          filter="url(#badgeShadow)"
                          vectorEffect="non-scaling-stroke"
                        />
                        <text
                          x={c.cx + 22}
                          y={c.cy - 14}
                          textAnchor="middle"
                          fontSize="14"
                          stroke="rgba(243,231,207,0.95)"
                          strokeWidth={2}
                          paintOrder="stroke"
                          style={{ userSelect: "none" }}
                        >
                          🧙
                        </text>
                      </g>
                    )}

                    {/* Basecamp badge (top-left of center) */}
                    {isBasecamp && (
                      <g>
                        <circle
                          cx={c.cx - 22}
                          cy={c.cy - 18}
                          r={10}
                          fill="rgba(0,0,0,0.45)"
                          stroke="rgba(243,231,207,0.55)"
                          strokeWidth={1}
                          filter="url(#badgeShadow)"
                          vectorEffect="non-scaling-stroke"
                        />
                        <text
                          x={c.cx - 22}
                          y={c.cy - 14}
                          textAnchor="middle"
                          fontSize="14"
                          stroke="rgba(243,231,207,0.95)"
                          strokeWidth={2}
                          paintOrder="stroke"
                          style={{ userSelect: "none" }}
                        >
                          🏰
                        </text>
                      </g>
                    )}

                    {/* Farmers badge: same position as basecamp badge.
                        Farmers are never allowed on basecamps, so these cannot overlap. */}
                    {hasFarmers && (
                      <g>
                        <circle
                          cx={c.cx - 22}
                          cy={c.cy - 18}
                          r={10}
                          fill="rgba(0,0,0,0.45)"
                          stroke="rgba(243,231,207,0.55)"
                          strokeWidth={1}
                          filter="url(#badgeShadow)"
                          vectorEffect="non-scaling-stroke"
                        />
                        <text
                          x={c.cx - 22}
                          y={c.cy - 14}
                          textAnchor="middle"
                          fontSize="11"
                          fontWeight={700}
                          stroke="rgba(243,231,207,0.95)"
                          strokeWidth={2}
                          paintOrder="stroke"
                          style={{ userSelect: "none", pointerEvents: "none" }}
                        >
                          {`🌾${farmers}`}
                        </text>
                      </g>
                    )}
                  </g>
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