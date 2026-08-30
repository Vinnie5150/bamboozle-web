// PLAYER PAGE

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { db } from "@/lib/firebase";
import { isNeighbor } from "@/app/_components/tileLayout";
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  query,
  orderBy,
  serverTimestamp,
  limit,
  getDoc,
} from "firebase/firestore";

import MapSvg from "@/app/_components/MapSvg";

type Tile = {
  id: string;
  ownerPlayerId: string | null;
  isBasecamp: boolean;
  basecampOwnerPlayerId?: string | null;
  farmers?: number;
};

type PlayerDoc = {
  name?: string;
  avatar?: string;
  credits?: number;
  beerCount?: number;
  tieFighters?: number;

  // you use these fields in the UI + logic
  hasMage?: boolean;
  hasDragonglass?: boolean;

  // legacy / optional
  dragonglass?: boolean;

  exp?: {
    foot?: number;
    cav?: number;
    arch?: number;
  };
};

type Player = {
  id: string;
  name: string;
  avatar: string;
  beerCount?: number;
  tieFighters?: number;
};

type Troops = { foot: number; cav: number; arch: number };
type MageDoc = {
  tileId: string;
  createdAt?: any;
};


type BattleLogRow =
  | {
      type: "CONQUER";
      tileId: string;
      newOwnerId: string;
      oldOwnerId: null;
      attackerId?: string;
      defenderId?: string;
      winnerId?: string | null;
      createdAt?: any;
    }
  | {
      type: "RELEASE";
      tileId: string;
      oldOwnerId: string;
      newOwnerId: null;
      attackerId?: string;
      defenderId?: string;
      winnerId?: string | null;
      createdAt?: any;
    }
  | {
      type: "ATTACKER_WIN" | "DEFENDER_HOLD" | "DRAW";
      tileId: string;
      attackerId: string;
      defenderId: string;
      winnerId?: string | null;
      createdAt?: any;
    }
  | {
      type: string;
      tileId: string;
      [k: string]: any;
    };

export default function PlayPage() {
  const params = useParams();
  const gameId = params.gameId as string;
  const playerId = params.playerId as string;

  const [tiles, setTiles] = useState<Tile[]>([]);
  const [player, setPlayer] = useState<PlayerDoc | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [deployments, setDeployments] = useState<Record<string, Troops>>({});

  const [selectedTileId, setSelectedTileId] = useState<string>("");
  const [mapPickMode, setMapPickMode] = useState<"FROM" | "TO">("FROM");
  const [mapAction, setMapAction] = useState<"MOVE" | "TP" | "AIRSTRIKE">("MOVE");
  const [tpPickMode, setTpPickMode] = useState<"TP_FROM" | "TP_TO">("TP_FROM");

  const [authReady, setAuthReady] = useState(false);

  const [tileTroopsAll, setTileTroopsAll] = useState<
    Record<string, { foot: number; cav: number; arch: number }>
  >({});

  const [status, setStatus] = useState<string>("");
  const [gameStatus, setGameStatus] = useState<string>("");
  // ===== Ranking (from host published doc) =====
const [myRank, setMyRank] = useState<number | null>(null);
const [rankTotal, setRankTotal] = useState<number | null>(null);
const [myDominance, setMyDominance] = useState<number | null>(null);
const [rankingRows, setRankingRows] = useState<
  Array<{
    playerId: string;
    rank: number;
    dominance: number;
    credits: number;
    cav: number;
    arch: number;
    foot: number;
  }>
>([]);

    // ===== Dart reward (free archer) =====
  const [dartPlaceTileId, setDartPlaceTileId] = useState<string>("");

    // ===== Beercules (beer) UI =====
  const [beerculesReward, setBeerculesReward] = useState<"CREDITS" | "EXP" | "BAMBOOZLE">(
    "CREDITS"
  );
  const [beerculesExpType, setBeerculesExpType] = useState<"foot" | "cav" | "arch">("foot");


  // ===== Bank UI =====
  const [bankAmount, setBankAmount] = useState<number>(1000);


    // ===== Shop UI =====
  const [buyFoot, setBuyFoot] = useState<number>(0);
  const [buyCav, setBuyCav] = useState<number>(0);
  const [buyArch, setBuyArch] = useState<number>(0);

  // ===== TIE Fighter / Airstrike =====
  const TIE_FIGHTER_ATTACK_POWER = 8;
  const [airstrikeTargetTileId, setAirstrikeTargetTileId] = useState<string>("");

  // ===== Farmers =====
  const [farmerTileId, setFarmerTileId] = useState<string>("");
  const [buyFarmers, setBuyFarmers] = useState<number>(0);

    // ===== Mage =====
  const [mage, setMage] = useState<MageDoc | null>(null);
  const [magePlaceTileId, setMagePlaceTileId] = useState<string>("");
  const [magesByPlayer, setMagesByPlayer] = useState<Record<string, MageDoc | null>>({});



  const SHOP_PRICES = useMemo(() => {
    return {
      foot: 2000,
      cav: 5000,
      arch: 5000,
      farmer: 1000,
      mage: 15000,
      dragonglass: 15000,
      tieFighter: 20000,
    };
  }, []);

  const MOVEMENT_COST_PER_TROOP = 500;
  const EXP_SELL_PRICE = 10000;
  const TROOP_SELL_FACTOR = 0.7;
  const TROOP_SELL_PRICES = useMemo(
    () => ({
      foot: Math.floor(SHOP_PRICES.foot * TROOP_SELL_FACTOR),
      cav: Math.floor(SHOP_PRICES.cav * TROOP_SELL_FACTOR),
      arch: Math.floor(SHOP_PRICES.arch * TROOP_SELL_FACTOR),
    }),
    [SHOP_PRICES]
  );

  const buyCost =
    Math.max(0, buyFoot) * SHOP_PRICES.foot +
    Math.max(0, buyCav) * SHOP_PRICES.cav +
    Math.max(0, buyArch) * SHOP_PRICES.arch;

  const myTieFighters = Math.max(
    0,
    Math.floor(Number(player?.tieFighters ?? 0))
  );


  // movement UI
  const [fromTileId, setFromTileId] = useState<string>("");
  const [toTileId, setToTileId] = useState<string>("");
    // mage teleport UI
  const [tpFromTileId, setTpFromTileId] = useState<string>("");
  const [tpToTileId, setTpToTileId] = useState<string>("");
  


  const [tpFoot, setTpFoot] = useState<number>(0);
  const [tpCav, setTpCav] = useState<number>(0);
  const [tpArch, setTpArch] = useState<number>(0);


  const [moveFoot, setMoveFoot] = useState<number>(0);
  const [moveCav, setMoveCav] = useState<number>(0);
  const [moveArch, setMoveArch] = useState<number>(0);

  // battle log entries relevant for this player (acts as "notifications")
  const [battleLogMine, setBattleLogMine] = useState<Array<{ id: string } & BattleLogRow>>(
    []
  );

  // ====== HEX adjacency (single source of truth) ======
const ALL_TILE_IDS = useMemo(() => {
  // Use loaded tiles when available; fallback to 0..59 to avoid "empty neighbor list" during first render.
  if (tiles?.length) return tiles.map((t) => String(t.id));
  return Array.from({ length: 60 }, (_, i) => String(i));
}, [tiles]);

function isAdjacent(fromId: string, toId: string) {
  if (!fromId || !toId) return false;
  return isNeighbor(String(fromId), String(toId));
}

function neighborIds(fromId: string) {
  const from = String(fromId);
  return ALL_TILE_IDS.filter((to) => to !== from && isNeighbor(from, to));
}

// handy sets (prevents any "random" selection: only allowed ids pass)
const moveToAllowedSet = useMemo(() => {
  if (!fromTileId) return new Set<string>();
  return new Set(neighborIds(fromTileId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [fromTileId, ALL_TILE_IDS]);


useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        signInAnonymously(auth).catch((err) => {
          console.error("Anonymous sign-in failed:", err);
          alert("Anonymous login failed. Check console.");
        });
      }
    });
    return () => unsub();
  }, []);


  // ====== listeners ======
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "games", gameId, "tiles"), (snap) => {
      const list: Tile[] = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => Number(a.id) - Number(b.id));
      setTiles(list);
    });
    return () => unsub();
  }, [gameId]);

  // Game status listener: used to freeze the Player Page on pause/end.
  useEffect(() => {
    const ref = doc(db, "games", gameId);
    const unsub = onSnapshot(ref, (snap) => {
      const data = (snap.data() as any) ?? {};
      setGameStatus(String(data?.status ?? ""));
    });
    return () => unsub();
  }, [gameId]);

  useEffect(() => {
    const ref = doc(db, "games", gameId, "players", playerId);
    const unsub = onSnapshot(ref, (snap) => {
      setPlayer((snap.data() as any) ?? null);
    });
    return () => unsub();
  }, [gameId, playerId]);

  // ===== Ranking listener (published by host) =====
useEffect(() => {
  if (!gameId || !playerId) return;

  const ref = doc(db, "games", gameId, "meta", "ranking");
  const unsub = onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      setMyRank(null);
      setRankTotal(null);
      setMyDominance(null);
      setRankingRows([]);
      return;
    }

    const data = snap.data() as any;
    const ranking = (data?.ranking ?? {}) as Record<
      string,
      { rank?: number; dominance?: number; credits?: number; cav?: number; arch?: number; foot?: number }
    >;

    const me = ranking[String(playerId)];

    setMyRank(typeof me?.rank === "number" ? me.rank : null);
    setMyDominance(typeof me?.dominance === "number" ? me.dominance : null);

    const total =
      typeof data?.totalPlayers === "number"
        ? data.totalPlayers
        : Object.keys(ranking).length;

    setRankTotal(total || null);

    const rows = Object.entries(ranking)
      .map(([pid, r]) => ({
        playerId: pid,
        rank: Number(r?.rank ?? 999),
        dominance: Number(r?.dominance ?? 0),
        credits: Number(r?.credits ?? 0),
        cav: Number(r?.cav ?? 0),
        arch: Number(r?.arch ?? 0),
        foot: Number(r?.foot ?? 0),
      }))
      .sort((a, b) => a.rank - b.rank);

    setRankingRows(rows);
  });

  return () => unsub();
}, [gameId, playerId]);


    // mage doc (one per player)
  useEffect(() => {
    const ref = doc(db, "games", gameId, "mages", playerId);
    const unsub = onSnapshot(ref, (snap) => {
      setMage(snap.exists() ? ((snap.data() as any) as MageDoc) : null);
    });
    return () => unsub();
  }, [gameId, playerId]);



  useEffect(() => {
      if (!fromTileId) {
        setMapPickMode("FROM");
        return;
      }
      // zodra FROM gekozen is, willen we TO kiezen
      setMapPickMode("TO");
    }, [fromTileId]);

      useEffect(() => {
  if (mapAction === "MOVE") {
    // bij MOVE volgen we FROM → TO
    setMapPickMode(fromTileId ? "TO" : "FROM");
  } else if (mapAction === "TP") {
    // bij TELEPORT volgen we TP_FROM → TP_TO
    setTpPickMode(tpFromTileId ? "TP_TO" : "TP_FROM");
  }
}, [mapAction, fromTileId, tpFromTileId]);

  
    // players list (colors + legend + name mapping)
  useEffect(() => {
    const q = query(collection(db, "games", gameId, "players"), orderBy("createdAt"));

    const unsub = onSnapshot(q, (snap) => {
      const list: Player[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setPlayers(list);
    });

    return () => unsub();
  }, [gameId]);

  // own deployments (FROM availability)
  useEffect(() => {
    const depCol = collection(db, "games", gameId, "deployments", playerId, "tiles");
    const unsub = onSnapshot(depCol, (snap) => {
      const next: Record<string, Troops> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        next[d.id] = {
          foot: Number(data.foot ?? 0),
          cav: Number(data.cav ?? 0),
          arch: Number(data.arch ?? 0),
        };
      });
      setDeployments(next);
    });
    return () => unsub();
  }, [gameId, playerId]);

    // all mages (for map icon display)
  useEffect(() => {
    if (!gameId) return;

    const unsubs: Array<() => void> = [];
    const nextByPlayer: Record<string, MageDoc | null> = {};

    players.forEach((p) => {
      const ref = doc(db, "games", gameId, "mages", p.id);
      const unsub = onSnapshot(ref, (snap) => {
        nextByPlayer[p.id] = snap.exists() ? ((snap.data() as any) as MageDoc) : null;
        // clone to trigger react update
        setMagesByPlayer({ ...nextByPlayer });
      });
      unsubs.push(unsub);
    });

    // if players list empties
    if (players.length === 0) setMagesByPlayer({});

    return () => unsubs.forEach((u) => u());
  }, [gameId, players]);


  // aggregated troops for map display (ALL players)
  useEffect(() => {
    if (!gameId) return;

    const unsubs: Array<() => void> = [];
    const allPlayerTiles: Record<
      string,
      Record<string, { foot: number; cav: number; arch: number }>
    > = {};

    function recompute() {
      const next: Record<string, { foot: number; cav: number; arch: number }> = {};

      Object.values(allPlayerTiles).forEach((byTile) => {
        Object.entries(byTile).forEach(([tileId, d]) => {
          const cur = next[tileId] ?? { foot: 0, cav: 0, arch: 0 };
          next[tileId] = {
            foot: cur.foot + (d.foot ?? 0),
            cav: cur.cav + (d.cav ?? 0),
            arch: cur.arch + (d.arch ?? 0),
          };
        });
      });

      setTileTroopsAll(next);
    }

    players.forEach((p) => {
      const depCol = collection(db, "games", gameId, "deployments", p.id, "tiles");
      const unsub = onSnapshot(depCol, (snap) => {
        const byTile: Record<string, { foot: number; cav: number; arch: number }> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          byTile[d.id] = {
            foot: Number(data.foot ?? 0),
            cav: Number(data.cav ?? 0),
            arch: Number(data.arch ?? 0),
          };
        });

        allPlayerTiles[p.id] = byTile;
        recompute();
      });
      unsubs.push(unsub);
    });

    if (players.length === 0) setTileTroopsAll({});

    return () => unsubs.forEach((u) => u());
  }, [gameId, players]);

  // "Notifications" from battleLog (last 30, filter client-side)
  useEffect(() => {
    const ql = query(
      collection(db, "games", gameId, "battleLog"),
      orderBy("createdAt", "desc"),
      limit(10)
    );

    const unsub = onSnapshot(ql, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any[];

      const mine = rows.filter((r) => {
        if (r.type === "CONQUER") return r.newOwnerId === playerId;
        if (r.type === "RELEASE") return r.oldOwnerId === playerId;
        return r.attackerId === playerId || r.defenderId === playerId;
      });

      setBattleLogMine(mine);
    });

    return () => unsub();
  }, [gameId, playerId]);

  // ====== derived ======
  const hasMage = !!player?.hasMage;
  const basecamp = useMemo(() => {
    return (
      tiles.find((t) => t.isBasecamp && t.basecampOwnerPlayerId === playerId) ?? null
    );
  }, [tiles, playerId]);

  const ownedTileIds = useMemo(() => {
    return tiles
      .filter((t) => {
        const isOwn = t.ownerPlayerId === playerId;
        const isOwnBasecamp = t.isBasecamp && t.basecampOwnerPlayerId === playerId;
        return isOwn || isOwnBasecamp;
      })
      .map((t) => t.id);
  }, [tiles, playerId]);

  const farmerEligibleTiles = useMemo(() => {
    return tiles.filter((t) => {
      if (t.isBasecamp) return false;
      if (t.ownerPlayerId !== playerId) return false;

      const d = deployments[t.id] ?? { foot: 0, cav: 0, arch: 0 };
      const troops =
        Number(d.foot ?? 0) +
        Number(d.cav ?? 0) +
        Number(d.arch ?? 0);

      return troops > 0;
    });
  }, [tiles, deployments, playerId]);

  const myControlledFarmers = useMemo(() => {
    return farmerEligibleTiles.reduce(
      (sum, t) => sum + Math.max(0, Math.floor(Number(t.farmers ?? 0))),
      0
    );
  }, [farmerEligibleTiles]);

  const farmerIncomePerMinute = myControlledFarmers * 100;

  const farmerPurchaseQty = Math.max(0, Math.floor(Number(buyFarmers) || 0));
  const farmerPurchaseCost = farmerPurchaseQty * SHOP_PRICES.farmer;

  useEffect(() => {
    if (!farmerTileId) return;
    const stillEligible = farmerEligibleTiles.some((t) => t.id === farmerTileId);
    if (!stillEligible) setFarmerTileId("");
  }, [farmerTileId, farmerEligibleTiles]);

  const fromTroops = deployments[fromTileId] ?? { foot: 0, cav: 0, arch: 0 };

 const highlightTileIds = useMemo(() => {
  // Map highlights are purely UI: selection rules are enforced in onSelectTile + moveTroops().
  if (mapAction === "MOVE") {
    // When choosing FROM: highlight your tiles (optional, makes UX clearer)
    if (mapPickMode === "FROM") {
      return ownedTileIds.map(String);
    }

    // When choosing TO: highlight ONLY true adjacent neighbors
    if (mapPickMode === "TO" && fromTileId) {
      return neighborIds(fromTileId);
    }

    return [];
  }

  // TELEPORT
  if (mapAction === "TP") {
    if (tpPickMode === "TP_FROM") {
      return ownedTileIds.map(String);
    }

    // TP_TO: your rules say "any tile, no basecamps"
    if (tpPickMode === "TP_TO") {
      return tiles.filter((t) => !t.isBasecamp).map((t) => String(t.id));
    }

    return [];
  }

  // AIRSTRIKE: enemy owned tiles only, never a basecamp
  if (mapAction === "AIRSTRIKE") {
    return tiles
      .filter(
        (t) =>
          !t.isBasecamp &&
          !!t.ownerPlayerId &&
          t.ownerPlayerId !== playerId
      )
      .map((t) => String(t.id));
  }

  return [];
}, [mapAction, mapPickMode, tpPickMode, fromTileId, ownedTileIds, tiles, playerId]);



 
 const toOptions = useMemo(() => {
  if (!fromTileId) return [];
  return neighborIds(fromTileId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [fromTileId, ALL_TILE_IDS]);



    


  const moveCount = Math.max(0, moveFoot) + Math.max(0, moveCav) + Math.max(0, moveArch);
  const moveCost = moveCount * MOVEMENT_COST_PER_TROOP;
    const tpCount =
    Math.max(0, tpFoot) + Math.max(0, tpCav) + Math.max(0, tpArch);
  const tpCost = tpCount * MOVEMENT_COST_PER_TROOP;

  const tpFromTroops = deployments[tpFromTileId] ?? { foot: 0, cav: 0, arch: 0 };


    const mageByTile = useMemo(() => {
    const m: Record<string, string> = {};
    Object.entries(magesByPlayer).forEach(([pid, md]) => {
      if (md?.tileId) m[md.tileId] = pid;
    });
    return m;
  }, [magesByPlayer]);

  function isMine(tileId: string) {
  const t = tiles.find((x) => x.id === tileId);
  if (!t) return false;
  return (
    t.ownerPlayerId === playerId ||
    (t.isBasecamp && t.basecampOwnerPlayerId === playerId)
  );
}


  function colorForPlayer(pid: string | null) {
    if (!pid) return "#eee";
    const idx = players.findIndex((p) => p.id === pid);
    const palette = [
      "#ffd6a5",
      "#caffbf",
      "#9bf6ff",
      "#bdb2ff",
      "#ffc6ff",
      "#fdffb6",
      "#a0c4ff",
      "#ffadad",
    ];
    return palette[(idx >= 0 ? idx : 0) % palette.length] ?? "#ddd";
  }

  function nameFor(pid?: string | null) {
    if (!pid) return "Unknown";
    return players.find((p) => p.id === pid)?.name ?? pid;
  }
function labelForPlayer(p: Player) {
  const a = String(p.avatar ?? "");
  const emoji = a && !a.startsWith("/") ? a : "";
  return `${emoji ? emoji + " " : ""}${p.name}`;
}

function farmersControlledBy(pid: string) {
  return tiles.reduce((sum, t) => {
    if (t.ownerPlayerId !== pid) return sum;
    if (t.isBasecamp) return sum;
    return sum + Math.max(0, Math.floor(Number(t.farmers ?? 0)));
  }, 0);
}


  function Avatar({ value, size = 22 }: { value?: string; size?: number }) {
  const v = String(value ?? "🎲");

  if (v.startsWith("/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={v}
        alt="avatar"
        style={{
          width: size,
          height: size,
          borderRadius: Math.max(6, Math.floor(size / 3)),
          objectFit: "cover",
          display: "inline-block",
        }}
      />
    );
  }

  return <span style={{ fontSize: Math.max(16, Math.floor(size * 0.9)) }}>{v}</span>;
}


  async function bankAdjustCredits(delta: number) {
  setStatus("");

  const amount = Math.floor(Number(delta) || 0);
  if (!amount) {
    setStatus("❌ Amount is 0.");
    return;
  }

  const playerRef = doc(db, "games", gameId, "players", playerId);

  try {
    await runTransaction(db, async (tx) => {
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists()) throw new Error("Player not found");

      const cur = Number((pSnap.data() as any)?.credits ?? 0);
      const next = Math.max(0, cur + amount); // nooit onder 0

      tx.update(playerRef, { credits: next });

      // ✅ log naar aparte bankLog collectie (host kan dit volgen)
      const logRef = doc(collection(db, "games", gameId, "bankLog"));
      tx.set(
        logRef,
        {
          createdAt: serverTimestamp(),
          playerId,
          delta: amount,
          from: cur,
          to: next,
        },
        { merge: true }
      );
    });

    setStatus(`✅ Bank: credits ${amount > 0 ? "added" : "removed"} (${amount > 0 ? "+" : ""}${amount}).`);
  } catch (err: any) {
    console.error(err);
    setStatus(`❌ ${err?.message ?? String(err)}`);
  }
}
  function getMyExpSafe() {
  return {
    foot: Math.max(0, Math.floor(Number(player?.exp?.foot ?? 0))),
    cav: Math.max(0, Math.floor(Number(player?.exp?.cav ?? 0))),
    arch: Math.max(0, Math.floor(Number(player?.exp?.arch ?? 0))),
  };
}

  async function adjustExp(unitType: "foot" | "cav" | "arch", delta: number) {
  setStatus("");

  const d = Math.floor(Number(delta) || 0);
  if (!d) return;

  const playerRef = doc(db, "games", gameId, "players", playerId);

  try {
    await runTransaction(db, async (tx) => {
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists()) throw new Error("Player not found");

      const data = pSnap.data() as any;
      const curExp = Math.max(0, Math.floor(Number(data?.exp?.[unitType] ?? 0)));

      const nextExp = Math.max(0, curExp + d); // nooit < 0

      tx.update(playerRef, {
        exp: {
          ...(data.exp ?? {}),
          [unitType]: nextExp,
        },
      });

      // ✅ log naar dezelfde bankLog zodat host dit ziet
      const logRef = doc(collection(db, "games", gameId, "bankLog"));
      tx.set(
        logRef,
        {
          createdAt: serverTimestamp(),
          type: "EXP_ADJUST",
          playerId,
          unitType,
          delta: nextExp - curExp,
          from: curExp,
          to: nextExp,
        },
        { merge: true }
      );
    });

    setStatus(`✅ EXP updated: ${unitType} ${d > 0 ? "+" : ""}${d}`);
  } catch (err: any) {
    console.error(err);
    setStatus(`❌ ${err?.message ?? String(err)}`);
  }
}

  async function sellExpPoint(unitType: "foot" | "cav" | "arch") {
    setStatus("");

    const playerRef = doc(db, "games", gameId, "players", playerId);

    try {
      await runTransaction(db, async (tx) => {
        const pSnap = await tx.get(playerRef);
        if (!pSnap.exists()) throw new Error("Player not found");

        const data = pSnap.data() as any;
        const curExp = Math.max(0, Math.floor(Number(data?.exp?.[unitType] ?? 0)));
        if (curExp <= 0) throw new Error("No EXP point available to sell");

        const credits = Math.max(0, Number(data?.credits ?? 0));
        const nextExp = curExp - 1;
        const nextCredits = credits + EXP_SELL_PRICE;

        tx.update(playerRef, {
          credits: nextCredits,
          exp: {
            ...(data.exp ?? {}),
            [unitType]: nextExp,
          },
        });

        const logRef = doc(collection(db, "games", gameId, "bankLog"));
        tx.set(logRef, {
          createdAt: serverTimestamp(),
          type: "EXP_SALE",
          playerId,
          unitType,
          expFrom: curExp,
          expTo: nextExp,
          price: EXP_SELL_PRICE,
          delta: EXP_SELL_PRICE,
          from: credits,
          to: nextCredits,
        });
      });

      const label = unitType === "foot" ? "Footsoldier" : unitType === "cav" ? "Cavalry" : "Archer";
      setStatus(`💰 Sold 1 ${label} EXP point for ${EXP_SELL_PRICE} credits.`);
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ ${err?.message ?? String(err)}`);
    }
  }

  async function desertTroop(unitType: "foot" | "cav" | "arch") {
    setStatus("");

    // Pick at random from tiles currently controlled by this player that actually
    // contain at least one troop of the requested type. Basecamp is included.
    const candidates = tiles.filter((t) => {
      if (t.ownerPlayerId !== playerId) return false;
      const d = deployments[t.id] ?? { foot: 0, cav: 0, arch: 0 };
      return Math.max(0, Math.floor(Number(d[unitType] ?? 0))) > 0;
    });

    if (candidates.length === 0) {
      setStatus("❌ No controlled tile contains that troop type.");
      return;
    }

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const refund = TROOP_SELL_PRICES[unitType];

    const playerRef = doc(db, "games", gameId, "players", playerId);
    const tileRef = doc(db, "games", gameId, "tiles", chosen.id);
    const depRef = doc(db, "games", gameId, "deployments", playerId, "tiles", chosen.id);

    try {
      await runTransaction(db, async (tx) => {
        const [pSnap, tSnap, dSnap] = await Promise.all([
          tx.get(playerRef),
          tx.get(tileRef),
          tx.get(depRef),
        ]);

        if (!pSnap.exists()) throw new Error("Player not found");
        if (!tSnap.exists()) throw new Error("Selected tile no longer exists");

        const tileData = tSnap.data() as any;
        if (String(tileData?.ownerPlayerId ?? "") !== playerId) {
          throw new Error("The randomly selected tile is no longer under your control. Try again.");
        }

        const depData = (dSnap.exists() ? dSnap.data() : {}) as any;
        const currentTroops = {
          foot: Math.max(0, Math.floor(Number(depData?.foot ?? 0))),
          cav: Math.max(0, Math.floor(Number(depData?.cav ?? 0))),
          arch: Math.max(0, Math.floor(Number(depData?.arch ?? 0))),
        };

        if (currentTroops[unitType] <= 0) {
          throw new Error("That troop is no longer present on the selected tile. Try again.");
        }

        const pData = pSnap.data() as any;
        const credits = Math.max(0, Number(pData?.credits ?? 0));
        const nextCredits = credits + refund;
        const nextTroops = {
          ...currentTroops,
          [unitType]: currentTroops[unitType] - 1,
        };

        const troopsLeft =
          nextTroops.foot + nextTroops.cav + nextTroops.arch;

        const isBasecamp = tileData?.isBasecamp === true;
        const tileNeutralized = troopsLeft === 0 && !isBasecamp;

        tx.update(playerRef, { credits: nextCredits });
        tx.set(depRef, nextTroops, { merge: true });

        // Same ownership rule as normal troop movement:
        // an empty non-basecamp tile is released and becomes neutral.
        if (tileNeutralized) {
          tx.update(tileRef, { ownerPlayerId: null });

          // If this player's Mage was standing on the released tile,
          // it is lost as well, consistent with the existing release logic.
          if (mage?.tileId && String(mage.tileId) === String(chosen.id)) {
            const myMageRef = doc(db, "games", gameId, "mages", playerId);
            tx.delete(myMageRef);
            tx.update(playerRef, { hasMage: false });
          }
        }

        const logRef = doc(collection(db, "games", gameId, "bankLog"));
        tx.set(logRef, {
          createdAt: serverTimestamp(),
          type: "DESERTER",
          playerId,
          unitType,
          tileId: chosen.id,
          refund,
          troopFrom: currentTroops[unitType],
          troopTo: currentTroops[unitType] - 1,
          tileNeutralized,
          delta: refund,
          from: credits,
          to: nextCredits,
        });
      });

      const label = unitType === "foot" ? "Footsoldier" : unitType === "cav" ? "Cavalry" : "Archer";
      setStatus(`🏃 ${label} deserted from tile #${chosen.id}. +${refund} credits.`);
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ ${err?.message ?? String(err)}`);
    }
  }

  function winnerDivisor(margin: number) {
  const m = Math.max(0, Number(margin) || 0);
  if (m <= 3) return 3;
  if (m <= 5) return 2.5;
  return 2;
}

function defenderWinDivisor(margin: number) {
  const m = Math.max(0, Number(margin) || 0);

  // jouw regels voor defender-win:
  if (m <= 1) return 2;     // delen door 2
  if (m <= 2) return 1.5;   // delen door 1.5  (dus margin tussen 3-5)
  return 1;                 // > 5: geen verlies
}


function applyWinnerSurvivors(t: { foot: number; cav: number; arch: number }, div: number) {
  const d = Number(div) || 1;
  return {
    foot: Math.max(0, Math.ceil((Number(t.foot) || 0) / d)),
    cav: Math.max(0, Math.ceil((Number(t.cav) || 0) / d)),
    arch: Math.max(0, Math.ceil((Number(t.arch) || 0) / d)),
  };
}

async function moveTroops() {
  setStatus("");

  if (!fromTileId || !toTileId) {
    setStatus("❌ Kies een FROM en TO tile.");
    return;
  }
  if (toTileId === fromTileId) {
    setStatus("❌ TO mag niet dezelfde zijn als FROM.");
    return;
  }

  const allowed = isAdjacent(fromTileId, toTileId);
  if (!allowed) {
    setStatus("❌ TO moet adjacent zijn aan FROM.");
    return;
  }

  const m = {
    foot: Math.max(0, Math.floor(Number(moveFoot) || 0)),
    cav: Math.max(0, Math.floor(Number(moveCav) || 0)),
    arch: Math.max(0, Math.floor(Number(moveArch) || 0)),
  };

  const total = m.foot + m.cav + m.arch;
  if (total <= 0) {
    setStatus("❌ Kies minstens 1 troep om te verplaatsen.");
    return;
  }

  const from = deployments[fromTileId] ?? { foot: 0, cav: 0, arch: 0 };
  if (m.foot > from.foot || m.cav > from.cav || m.arch > from.arch) {
    setStatus("❌ Niet genoeg troops op FROM tile.");
    return;
  }

  const cost = total * MOVEMENT_COST_PER_TROOP;
  setStatus("Moving...");

  const playerRef = doc(db, "games", gameId, "players", playerId);
  const fromRef = doc(db, "games", gameId, "deployments", playerId, "tiles", fromTileId);
  const toRef = doc(db, "games", gameId, "deployments", playerId, "tiles", toTileId);

  const tileRef = doc(db, "games", gameId, "tiles", toTileId);
  const fromTileRef = doc(db, "games", gameId, "tiles", fromTileId);

  let didBattle = false;
  let uiMessage = "";

  try {
    await runTransaction(db, async (tx) => {
      // ===== READS FIRST =====
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists()) throw new Error("Player not found");
      const credits = Number((pSnap.data() as any)?.credits ?? 0);
      if (credits < cost) throw new Error("Not enough credits");

      const fromTileSnap = await tx.get(fromTileRef);
      if (!fromTileSnap.exists()) throw new Error("FROM tile not found");
      const fromTile = fromTileSnap.data() as any;
      const fromTileIsBasecamp = !!fromTile.isBasecamp;
      const fromTileOwner: string | null = fromTile.ownerPlayerId ?? null;

      const tileSnap = await tx.get(tileRef);
      if (!tileSnap.exists()) throw new Error("Tile not found");
      const tile = tileSnap.data() as any;

      const toOwner: string | null = tile.ownerPlayerId ?? null;
      const toIsBasecamp = !!tile.isBasecamp;
      const toBasecampOwner = tile.basecampOwnerPlayerId ?? null;

      if (toIsBasecamp && toBasecampOwner !== playerId) {
        throw new Error("You cannot enter an enemy basecamp");
      }

      const fSnap = await tx.get(fromRef);
      const f = (fSnap.exists() ? (fSnap.data() as any) : {}) as any;
      const fTroops = {
        foot: Number(f.foot ?? 0),
        cav: Number(f.cav ?? 0),
        arch: Number(f.arch ?? 0),
      };

      if (m.foot > fTroops.foot || m.cav > fTroops.cav || m.arch > fTroops.arch) {
        throw new Error("Not enough troops on FROM tile");
      }

      const nextFrom = {
        foot: fTroops.foot - m.foot,
        cav: fTroops.cav - m.cav,
        arch: fTroops.arch - m.arch,
      };
      const fromBecomesEmpty = nextFrom.foot + nextFrom.cav + nextFrom.arch <= 0;

      const toSnap = await tx.get(toRef);
      const toData = (toSnap.exists() ? (toSnap.data() as any) : {}) as any;
      const toTroops = {
        foot: Number(toData.foot ?? 0),
        cav: Number(toData.cav ?? 0),
        arch: Number(toData.arch ?? 0),
      };

      // defender troops only needed if enemy
      let defRef: any = null;
      let defTroops: Troops = { foot: 0, cav: 0, arch: 0 };

      const isEmptyOrOwn = !toOwner || toOwner === playerId;

      let defMageRef: any = null;
      let defenderMageOnThisTile = false;

      if (!isEmptyOrOwn) {
        defRef = doc(db, "games", gameId, "deployments", toOwner, "tiles", toTileId);
        const dSnap = await tx.get(defRef);
        const d = (dSnap.exists() ? (dSnap.data() as any) : {}) as any;

        defTroops = {
          foot: Number(d.foot ?? 0),
          cav: Number(d.cav ?? 0),
          arch: Number(d.arch ?? 0),
        };

        // ✅ check of defender mage op deze tile staat
        defMageRef = doc(db, "games", gameId, "mages", toOwner);
        const defMageSnap = await tx.get(defMageRef);
        if (defMageSnap.exists()) {
          const md = defMageSnap.data() as any;
          defenderMageOnThisTile = String(md.tileId ?? "") === String(toTileId);
        }
      }

      // ===== DECISION =====
      const attExp = {
        foot: Math.max(0, Math.floor(Number((pSnap.data() as any)?.exp?.foot ?? 0))),
        cav: Math.max(0, Math.floor(Number((pSnap.data() as any)?.exp?.cav ?? 0))),
        arch: Math.max(0, Math.floor(Number((pSnap.data() as any)?.exp?.arch ?? 0))),
      };

      let defExp = { foot: 0, cav: 0, arch: 0 };
      if (!isEmptyOrOwn && toOwner) {
        const defPlayerRef = doc(db, "games", gameId, "players", toOwner);
        const defPlayerSnap = await tx.get(defPlayerRef);
        if (defPlayerSnap.exists()) {
          const dp = defPlayerSnap.data() as any;
          defExp = {
            foot: Math.max(0, Math.floor(Number(dp?.exp?.foot ?? 0))),
            cav: Math.max(0, Math.floor(Number(dp?.exp?.cav ?? 0))),
            arch: Math.max(0, Math.floor(Number(dp?.exp?.arch ?? 0))),
          };
        }
      }

      const attackerPower =
        (m.foot * attExp.foot) / 3 +
        (m.cav * attExp.cav) / 3 +
        (m.arch * attExp.arch) / 3;

      const defenderPower =
        (defTroops.foot * defExp.foot) / 3 +
        (defTroops.cav * defExp.cav) / 3 +
        (defTroops.arch * defExp.arch) / 3;

      const diff = attackerPower - defenderPower;
      const margin = Math.abs(diff);

      const attackerDiv = winnerDivisor(margin);
      const defenderDiv = defenderWinDivisor(margin);

      const battleOutcome =
        attackerPower > defenderPower
          ? "ATTACKER"
          : attackerPower < defenderPower
          ? "DEFENDER"
          : "DRAW";

      const attackerSurvivors = applyWinnerSurvivors(m, attackerDiv);
      const defenderSurvivors =
        battleOutcome === "DEFENDER"
          ? applyWinnerSurvivors(defTroops, defenderDiv)
          : applyWinnerSurvivors(defTroops, attackerDiv);

      const attackerSurvivorsTotal =
        attackerSurvivors.foot + attackerSurvivors.cav + attackerSurvivors.arch;

      const defenderSurvivorsTotal =
        defenderSurvivors.foot + defenderSurvivors.cav + defenderSurvivors.arch;

      // ===== WRITES =====
      tx.update(playerRef, { credits: credits - cost });

      // moved troops leave FROM always
      tx.set(fromRef, nextFrom, { merge: true });

      const logRef1 = doc(collection(db, "games", gameId, "battleLog"));
      const logRef2 = doc(collection(db, "games", gameId, "battleLog"));

      // if FROM becomes empty => release tile (unless basecamp)
      if (fromBecomesEmpty && !fromTileIsBasecamp && fromTileOwner === playerId) {
        tx.update(fromTileRef, { ownerPlayerId: null });

        tx.set(
          logRef1,
          {
            createdAt: serverTimestamp(),
            type: "RELEASE",
            tileId: fromTileId,
            oldOwnerId: playerId,
            newOwnerId: null,
          },
          { merge: true }
        );

        // ✅ Mage sterft wanneer tile neutral wordt
        if (mage?.tileId && String(mage.tileId) === String(fromTileId)) {
          const myMageRef = doc(db, "games", gameId, "mages", playerId);
          tx.delete(myMageRef);
          tx.update(playerRef, { hasMage: false });
        }
      }

      if (isEmptyOrOwn) {
        // move into own/empty
        tx.set(
          toRef,
          {
            foot: toTroops.foot + m.foot,
            cav: toTroops.cav + m.cav,
            arch: toTroops.arch + m.arch,
          },
          { merge: true }
        );

        if (!toOwner) {
          // conquest
          tx.update(tileRef, { ownerPlayerId: playerId });

          tx.set(
            logRef2,
            {
              createdAt: serverTimestamp(),
              type: "CONQUER",
              tileId: toTileId,
              oldOwnerId: null,
              newOwnerId: playerId,
            },
            { merge: true }
          );
        }

        return;
      }

      // enemy tile => battle
      if (battleOutcome === "ATTACKER") {
        didBattle = true;

        // If attacker "wins" but 0 survivors => DRAW
        if (attackerSurvivorsTotal <= 0) {
          uiMessage = `🤝 You attacked tile #${toTileId}, but BOTH armies were defeated. (No survivors)`;

          tx.set(
            logRef2,
            {
              createdAt: serverTimestamp(),
              type: "DRAW",
              tileId: toTileId,
              attackerId: playerId,
              defenderId: toOwner,
              winnerId: null,
              attackerPower,
              defenderPower,
              diff,
              margin,
              divisor: attackerDiv,
              note: "attacker_win_but_no_survivors",
            },
            { merge: true }
          );

          tx.update(tileRef, { ownerPlayerId: null });
          tx.set(toRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });
          tx.set(defRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

          if (defenderMageOnThisTile && defMageRef) {
            tx.delete(defMageRef);
            const defPlayerRef = doc(db, "games", gameId, "players", toOwner);
            tx.update(defPlayerRef, { hasMage: false });
          }

          return;
        }

        uiMessage = `⚔️ You attacked tile #${toTileId} and WON.`;

        tx.set(
          logRef2,
          {
            createdAt: serverTimestamp(),
            type: "ATTACKER_WIN",
            tileId: toTileId,
            attackerId: playerId,
            defenderId: toOwner,
            winnerId: playerId,
            attackerPower,
            defenderPower,
            diff,
            margin,
            divisor: attackerDiv,
            survivors: attackerSurvivors,
          },
          { merge: true }
        );

        tx.update(tileRef, { ownerPlayerId: playerId });

        tx.set(
          toRef,
          {
            foot: toTroops.foot + attackerSurvivors.foot,
            cav: toTroops.cav + attackerSurvivors.cav,
            arch: toTroops.arch + attackerSurvivors.arch,
          },
          { merge: true }
        );

        tx.set(defRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

        if (defenderMageOnThisTile && defMageRef) {
          tx.delete(defMageRef);
          const defPlayerRef = doc(db, "games", gameId, "players", toOwner);
          tx.update(defPlayerRef, { hasMage: false });
        }

        return;
      }

      if (battleOutcome === "DEFENDER") {
        didBattle = true;

        // If defender "wins" but 0 survivors => DRAW
        if (defenderSurvivorsTotal <= 0) {
          uiMessage = `🤝 You attacked tile #${toTileId} — DRAW. Both armies destroyed. (No defender survivors)`;

          tx.set(
            logRef2,
            {
              createdAt: serverTimestamp(),
              type: "DRAW",
              tileId: toTileId,
              attackerId: playerId,
              defenderId: toOwner,
              winnerId: null,
              attackerPower,
              defenderPower,
              diff,
              margin,
              divisor: attackerDiv,
              note: "defender_hold_but_no_survivors",
            },
            { merge: true }
          );

          tx.update(tileRef, { ownerPlayerId: null });
          tx.set(toRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });
          tx.set(defRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

          if (defenderMageOnThisTile && defMageRef) {
            tx.delete(defMageRef);
            const defPlayerRef = doc(db, "games", gameId, "players", toOwner);
            tx.update(defPlayerRef, { hasMage: false });
          }

          return;
        }

        uiMessage = `⚔️ You attacked tile #${toTileId} but LOST.`;

        tx.set(
          logRef2,
          {
            createdAt: serverTimestamp(),
            type: "DEFENDER_HOLD",
            tileId: toTileId,
            attackerId: playerId,
            defenderId: toOwner,
            winnerId: toOwner,
            attackerPower,
            defenderPower,
            diff,
            margin,
            divisor: defenderDiv,
            survivors: defenderSurvivors,
          },
          { merge: true }
        );

        tx.set(defRef, defenderSurvivors, { merge: true });

        // ✅ IMPORTANT: ensure attacker has no troops on enemy tile
        tx.set(toRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

        return;
      }

      // DRAW
      didBattle = true;
      uiMessage = `🤝 You attacked tile #${toTileId}, but BOTH armies were defeated.`;

      tx.set(
        logRef2,
        {
          createdAt: serverTimestamp(),
          type: "DRAW",
          tileId: toTileId,
          attackerId: playerId,
          defenderId: toOwner,
          winnerId: null,
          attackerPower,
          defenderPower,
          diff,
          margin,
          divisor: attackerDiv,
        },
        { merge: true }
      );

      tx.update(tileRef, { ownerPlayerId: null });

      tx.set(toRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });
      tx.set(defRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

      if (defenderMageOnThisTile && defMageRef) {
        tx.delete(defMageRef);
        const defPlayerRef = doc(db, "games", gameId, "players", toOwner);
        tx.update(defPlayerRef, { hasMage: false });
      }
    });

    // reset inputs
    setMoveFoot(0);
    setMoveCav(0);
    setMoveArch(0);
    setFromTileId("");
    setToTileId("");
    setMapPickMode("FROM");
    setSelectedTileId("");

    if (didBattle) {
      setStatus(uiMessage || "⚔️ Battle resolved.");
    } else {
      setStatus(`✅ Moved. Cost: ${cost} credits`);
    }
  } catch (err: any) {
    console.error(err);
    setStatus(`❌ ${err?.message ?? String(err)}`);
  }
}

  

      async function drinkBeerculesPint() {
    setStatus("");

    const playerRef = doc(db, "games", gameId, "players", playerId);

    try {
      await runTransaction(db, async (tx) => {
        const pSnap = await tx.get(playerRef);
        if (!pSnap.exists()) throw new Error("Player not found");

        const pdata = (pSnap.data() as any) ?? {};

        const curBeer = Number(pdata.beerCount ?? 0);
        const curCredits = Number(pdata.credits ?? 0);

        const curExp = {
          foot: Math.max(0, Math.floor(Number(pdata?.exp?.foot ?? 0))),
          cav: Math.max(0, Math.floor(Number(pdata?.exp?.cav ?? 0))),
          arch: Math.max(0, Math.floor(Number(pdata?.exp?.arch ?? 0))),
        };

        // 1) always increment Beercules
        const nextBeer = curBeer + 1;
        const logRef = doc(collection(db, "games", gameId, "bankLog"));

        // 2) apply chosen reward
        if (beerculesReward === "CREDITS") {
          tx.update(playerRef, {
            beerCount: nextBeer,
            credits: curCredits + 10000,
          });
          tx.set(
                logRef,
                {
                  createdAt: serverTimestamp(),
                  type: "BEERCULES",
                  playerId,
                  beerFrom: curBeer,
                  beerTo: nextBeer,
                  reward: "CREDITS",
                  deltaCredits: 10000,
                },
                { merge: true }
              );
          return;
        }

        if (beerculesReward === "EXP") {
          const t = beerculesExpType; // foot|cav|arch
          const nextExp = {
            ...curExp,
            [t]: curExp[t] + 1,
          };

          tx.update(playerRef, {
            beerCount: nextBeer,
            exp: nextExp,
          });
          tx.set(
            logRef,
            {
              createdAt: serverTimestamp(),
              type: "BEERCULES",
              playerId,
              beerFrom: curBeer,
              beerTo: nextBeer,
              reward: "EXP",
              expType: t,
              expFrom: curExp[t],
              expTo: curExp[t] + 1,
            },
            { merge: true }
          );
          return;
        }

        // BAMBOOZLE = no in-game effect besides counter
        tx.update(playerRef, {
          beerCount: nextBeer,
        });
        tx.set(
          logRef,
          {
            createdAt: serverTimestamp(),
            type: "BEERCULES",
            playerId,
            beerFrom: curBeer,
            beerTo: nextBeer,
            reward: "BAMBOOZLE",
          },
          { merge: true }
        );
      });

      // UI feedback after transaction
      if (beerculesReward === "CREDITS") {
        setStatus("🍺 Beercules +1 — Reward: +10000 credits!");
      } else if (beerculesReward === "EXP") {
        setStatus(`🍺 Beercules +1 — Reward: +1 EXP (${beerculesExpType})!`);
      } else {
        setStatus("🍺 Beercules +1 — Reward: Draw 1 Bamboozle card (physical).");
      }
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ ${err?.message ?? String(err)}`);
    }
  }
  

    async function addFreeArcherFromDart() {
  setStatus("");

  if (!playerId || !dartPlaceTileId) {
    setStatus("❌ No tile selected for dart reward.");
    return;
  }

  const tileId = String(dartPlaceTileId);

  // ✅ correct path
  const depRef = doc(db, "games", gameId, "deployments", playerId, "tiles", tileId);
  const tileRef = doc(db, "games", gameId, "tiles", tileId);

  try {
    await runTransaction(db, async (tx) => {
      // 1) security: re-check ownership in transaction
      const tileSnap = await tx.get(tileRef);
      if (!tileSnap.exists()) throw new Error("Tile not found");

      const t = tileSnap.data() as any;
      const isOwn =
        (t.ownerPlayerId ?? null) === playerId ||
        (!!t.isBasecamp && (t.basecampOwnerPlayerId ?? null) === playerId);

      if (!isOwn) throw new Error("You can only place a free archer on a tile you control.");

      // 2) read existing deployment (may not exist yet!)
      const depSnap = await tx.get(depRef);
      const cur = (depSnap.exists() ? (depSnap.data() as any) : {}) as any;

      const curFoot = Number(cur.foot ?? 0);
      const curCav = Number(cur.cav ?? 0);
      const curArch = Number(cur.arch ?? 0);

      // 3) write updated deployment (create if missing)
      tx.set(
        depRef,
        {
          foot: curFoot,
          cav: curCav,
          arch: curArch + 1,
        },
        { merge: true }
      );

      // 4) log so host sees it
      const logRef = doc(collection(db, "games", gameId, "bankLog"));
      tx.set(
        logRef,
        {
          createdAt: serverTimestamp(),
          type: "DART_FREE_ARCHER",
          playerId,
          tileId,
          deltaArch: 1,
          archFrom: curArch,
          archTo: curArch + 1,
          note: "Dart reward",
        },
        { merge: true }
      );
    });

    setStatus(`🎯🏹 Archer added for FREE (Dart reward) on tile #${tileId}.`);
  } catch (err: any) {
    console.error(err);
    setStatus(`❌ ${err?.message ?? String(err)}`);
  }
}




  async function buyAndPlaceFarmers() {
    setStatus("");

    const qty = Math.max(0, Math.floor(Number(buyFarmers) || 0));

    if (qty <= 0) {
      setStatus("❌ Choose at least 1 farmer to buy.");
      return;
    }

    if (!farmerTileId) {
      setStatus("❌ Choose a tile for your farmers.");
      return;
    }

    const cost = qty * SHOP_PRICES.farmer;

    const playerRef = doc(db, "games", gameId, "players", playerId);
    const tileRef = doc(db, "games", gameId, "tiles", farmerTileId);
    const depRef = doc(
      db,
      "games",
      gameId,
      "deployments",
      playerId,
      "tiles",
      farmerTileId
    );

    setStatus("🌾 Buying farmers...");

    try {
      await runTransaction(db, async (tx) => {
        // ===== READS FIRST =====
        const pSnap = await tx.get(playerRef);
        const tileSnap = await tx.get(tileRef);
        const depSnap = await tx.get(depRef);

        if (!pSnap.exists()) throw new Error("Player not found");
        if (!tileSnap.exists()) throw new Error("Tile not found");

        const pdata = pSnap.data() as any;
        const tileData = tileSnap.data() as any;
        const depData = (depSnap.exists() ? depSnap.data() : {}) as any;

        const credits = Number(pdata?.credits ?? 0);

        if (!!tileData.isBasecamp) {
          throw new Error("Farmers cannot be placed on a basecamp.");
        }

        if ((tileData.ownerPlayerId ?? null) !== playerId) {
          throw new Error("You can only place farmers on a tile you control.");
        }

        const troopsOnTile =
          Number(depData.foot ?? 0) +
          Number(depData.cav ?? 0) +
          Number(depData.arch ?? 0);

        if (troopsOnTile <= 0) {
          throw new Error("A controlled tile needs at least 1 troop before farmers can be placed.");
        }

        if (credits < cost) {
          throw new Error("Not enough credits");
        }

        const curFarmers = Math.max(
          0,
          Math.floor(Number(tileData.farmers ?? 0))
        );

        // ===== WRITES =====
        tx.update(playerRef, {
          credits: credits - cost,
        });

        tx.update(tileRef, {
          farmers: curFarmers + qty,
        });

        const logRef = doc(collection(db, "games", gameId, "bankLog"));
        tx.set(
          logRef,
          {
            createdAt: serverTimestamp(),
            type: "FARMER_PURCHASE",
            playerId,
            tileId: farmerTileId,
            quantity: qty,
            farmerFrom: curFarmers,
            farmerTo: curFarmers + qty,
            cost,
            from: credits,
            to: credits - cost,
            delta: -cost,
          },
          { merge: true }
        );
      });

      const placedTile = farmerTileId;
      setBuyFarmers(0);
      setStatus(
        `🌾✅ ${qty} farmer${qty === 1 ? "" : "s"} placed on tile #${placedTile}. Cost: ${cost} credits.`
      );
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ ${err?.message ?? String(err)}`);
    }
  }


    async function buyTroopsToBasecamp() {
    setStatus("");

    const qFoot = Math.max(0, Math.floor(Number(buyFoot) || 0));
    const qCav = Math.max(0, Math.floor(Number(buyCav) || 0));
    const qArch = Math.max(0, Math.floor(Number(buyArch) || 0));

    const totalQty = qFoot + qCav + qArch;
    if (totalQty <= 0) {
      setStatus("❌ Kies minstens 1 unit om te kopen.");
      return;
    }

    if (!basecamp?.id) {
      setStatus("❌ Basecamp nog niet gevonden. Wacht even en refresh.");
      return;
    }

    const cost =
      qFoot * SHOP_PRICES.foot +
      qCav * SHOP_PRICES.cav +
      qArch * SHOP_PRICES.arch;

    setStatus("Buying...");

    const playerRef = doc(db, "games", gameId, "players", playerId);
    const basecampDepRef = doc(
      db,
      "games",
      gameId,
      "deployments",
      playerId,
      "tiles",
      basecamp.id
    );

    try {
      await runTransaction(db, async (tx) => {
        // READS
        const pSnap = await tx.get(playerRef);
        if (!pSnap.exists()) throw new Error("Player not found");

        const credits = Number((pSnap.data() as any)?.credits ?? 0);
        if (credits < cost) throw new Error("Not enough credits");

        const bSnap = await tx.get(basecampDepRef);
        const b = (bSnap.exists() ? (bSnap.data() as any) : {}) as any;

        const cur = {
          foot: Number(b.foot ?? 0),
          cav: Number(b.cav ?? 0),
          arch: Number(b.arch ?? 0),
        };

        // WRITES
        tx.update(playerRef, { credits: credits - cost });

        tx.set(
          basecampDepRef,
          {
            foot: cur.foot + qFoot,
            cav: cur.cav + qCav,
            arch: cur.arch + qArch,
          },
          { merge: true }
        );
      });

      setBuyFoot(0);
      setBuyCav(0);
      setBuyArch(0);

      setStatus(`✅ Purchased. Cost: ${cost} credits → added to basecamp.`);
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ ${err?.message ?? String(err)}`);
    }
  }

    async function buyTieFighter() {
  setStatus("");

  const playerRef = doc(db, "games", gameId, "players", playerId);
  const cost = SHOP_PRICES.tieFighter;

  try {
    await runTransaction(db, async (tx) => {
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists()) throw new Error("Player not found");

      const pdata = pSnap.data() as any;
      const credits = Number(pdata?.credits ?? 0);
      const current = Math.max(0, Math.floor(Number(pdata?.tieFighters ?? 0)));

      if (credits < cost) throw new Error("Not enough credits");

      tx.update(playerRef, {
        credits: credits - cost,
        tieFighters: current + 1,
      });

      const logRef = doc(collection(db, "games", gameId, "bankLog"));
      tx.set(
        logRef,
        {
          createdAt: serverTimestamp(),
          type: "TIE_FIGHTER_PURCHASE",
          playerId,
          quantity: 1,
          tieFightersFrom: current,
          tieFightersTo: current + 1,
          cost,
          from: credits,
          to: credits - cost,
          delta: -cost,
        },
        { merge: true }
      );
    });

    setStatus(`✈️ TIE Fighter purchased for ${cost} credits.`);
  } catch (err: any) {
    console.error(err);
    setStatus(`❌ ${err?.message ?? String(err)}`);
  }
}

async function launchTieFighterAirstrike() {
  setStatus("");

  const tileId = String(airstrikeTargetTileId || "");
  if (!tileId) {
    setStatus("❌ Choose an enemy tile for the airstrike.");
    return;
  }

  const playerRef = doc(db, "games", gameId, "players", playerId);
  const tileRef = doc(db, "games", gameId, "tiles", tileId);

  let resultMessage = "";

  try {
    await runTransaction(db, async (tx) => {
      // ===== READS FIRST =====
      const pSnap = await tx.get(playerRef);
      const tileSnap = await tx.get(tileRef);

      if (!pSnap.exists()) throw new Error("Player not found");
      if (!tileSnap.exists()) throw new Error("Target tile not found");

      const pdata = pSnap.data() as any;
      const tileData = tileSnap.data() as any;

      const currentTieFighters = Math.max(
        0,
        Math.floor(Number(pdata?.tieFighters ?? 0))
      );

      if (currentTieFighters <= 0) {
        throw new Error("You do not own a TIE Fighter");
      }

      const defenderId = String(tileData?.ownerPlayerId ?? "");
      const isBasecamp = !!tileData?.isBasecamp;

      if (isBasecamp) {
        throw new Error("A basecamp cannot be targeted by an airstrike");
      }

      if (!defenderId) {
        throw new Error("You can only airstrike an enemy-controlled tile");
      }

      if (defenderId === playerId) {
        throw new Error("You cannot airstrike your own tile");
      }

      const defRef = doc(
        db,
        "games",
        gameId,
        "deployments",
        defenderId,
        "tiles",
        tileId
      );
      const defPlayerRef = doc(
        db,
        "games",
        gameId,
        "players",
        defenderId
      );
      const defMageRef = doc(
        db,
        "games",
        gameId,
        "mages",
        defenderId
      );

      const defSnap = await tx.get(defRef);
      const defPlayerSnap = await tx.get(defPlayerRef);
      const defMageSnap = await tx.get(defMageRef);

      const defData = (defSnap.exists() ? defSnap.data() : {}) as any;
      const defPlayerData = (defPlayerSnap.exists()
        ? defPlayerSnap.data()
        : {}) as any;

      const before: Troops = {
        foot: Math.max(0, Math.floor(Number(defData?.foot ?? 0))),
        cav: Math.max(0, Math.floor(Number(defData?.cav ?? 0))),
        arch: Math.max(0, Math.floor(Number(defData?.arch ?? 0))),
      };

      const defExp = {
        foot: Math.max(
          0,
          Math.floor(Number(defPlayerData?.exp?.foot ?? 0))
        ),
        cav: Math.max(
          0,
          Math.floor(Number(defPlayerData?.exp?.cav ?? 0))
        ),
        arch: Math.max(
          0,
          Math.floor(Number(defPlayerData?.exp?.arch ?? 0))
        ),
      };

      const defenderPower =
        (before.foot * defExp.foot) / 3 +
        (before.cav * defExp.cav) / 3 +
        (before.arch * defExp.arch) / 3;

      const attackPower = TIE_FIGHTER_ATTACK_POWER;
      const diff = attackPower - defenderPower;
      const margin = Math.abs(diff);

      let after: Troops;

      // A TIE win or exact draw wipes the defenders.
      // If the defender is stronger, use the same defender-survivor rule
      // as normal ground combat to determine how much damage the strike did.
      if (attackPower >= defenderPower) {
        after = { foot: 0, cav: 0, arch: 0 };
      } else {
        after = applyWinnerSurvivors(
          before,
          defenderWinDivisor(margin)
        );
      }

      const survivorsTotal =
        after.foot + after.cav + after.arch;

      const mageOnTarget =
        defMageSnap.exists() &&
        String((defMageSnap.data() as any)?.tileId ?? "") === tileId;

      // ===== WRITES =====
      tx.update(playerRef, {
        tieFighters: currentTieFighters - 1,
      });

      tx.set(defRef, after, { merge: true });

      if (survivorsTotal <= 0) {
        // Airstrike never gives ownership to the attacker.
        // A completely wiped tile simply becomes neutral.
        tx.update(tileRef, {
          ownerPlayerId: null,
        });

        if (mageOnTarget) {
          tx.delete(defMageRef);

          if (defPlayerSnap.exists()) {
            tx.update(defPlayerRef, {
              hasMage: false,
            });
          }
        }
      }

      const logRef = doc(
        collection(db, "games", gameId, "battleLog")
      );

      tx.set(
        logRef,
        {
          createdAt: serverTimestamp(),
          type: "AIRSTRIKE",
          tileId,
          attackerId: playerId,
          defenderId,
          winnerId: survivorsTotal <= 0 ? null : defenderId,
          attackPower,
          defenderPower,
          diff,
          margin,
          before,
          after,
          neutralized: survivorsTotal <= 0,
          tieFightersFrom: currentTieFighters,
          tieFightersTo: currentTieFighters - 1,
          mageDestroyed: mageOnTarget && survivorsTotal <= 0,
        },
        { merge: true }
      );

      const destroyed = {
        foot: before.foot - after.foot,
        cav: before.cav - after.cav,
        arch: before.arch - after.arch,
      };

      resultMessage =
        survivorsTotal <= 0
          ? `💥 Airstrike on tile #${tileId}: all defenders destroyed — tile is now neutral. TIE Fighter lost.`
          : `✈️ Airstrike on tile #${tileId}: destroyed ${destroyed.foot} Foot, ${destroyed.cav} Cav, ${destroyed.arch} Arch. TIE Fighter lost.`;
    });

    setAirstrikeTargetTileId("");
    setSelectedTileId("");
    // Airstrike audio is played centrally by the Host page.
    // Do not play the normal local battle/victory sound for an airstrike.
    setStatus(resultMessage || "✈️ Airstrike resolved.");
  } catch (err: any) {
    console.error(err);
    setStatus(`❌ ${err?.message ?? String(err)}`);
  }
}

    async function buyDragonglass() {
  setStatus("");

  const playerRef = doc(db, "games", gameId, "players", playerId);
  const cost = SHOP_PRICES.dragonglass;

  try {
    await runTransaction(db, async (tx) => {
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists()) throw new Error("Player not found");

      const data = pSnap.data() as any;
      const credits = Number(data.credits ?? 0);
      const already = !!data.hasDragonglass;

      if (already) throw new Error("You already own Dragonglass");
      if (credits < cost) throw new Error("Not enough credits");

      tx.update(playerRef, {
        credits: credits - cost,
        hasDragonglass: true,
      });
      // ✅ log: dragonglass purchase
      const logRef = doc(collection(db, "games", gameId, "bankLog"));
      tx.set(
        logRef,
        {
          createdAt: serverTimestamp(),
          type: "DRAGONGLASS_PURCHASE",
          playerId,
          cost,
          from: credits,
          to: credits - cost,
          delta: -cost,
        },
        { merge: true }
      );
    });

         
    setStatus(`✅ Dragonglass purchased (cost ${cost}).`);
  } catch (err: any) {
    console.error(err);
    setStatus(`❌ ${err?.message ?? String(err)}`);
  }
}
   async function grantDragonglassFree() {
  setStatus("");

  const playerRef = doc(db, "games", gameId, "players", playerId);

  try {
    await runTransaction(db, async (tx) => {
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists()) throw new Error("Player not found");

      const pdata = (pSnap.data() as any) ?? {};
      const already = !!pdata.hasDragonglass;

      if (already) throw new Error("You already have Dragonglass");

      // ✅ free grant (no credits change)
      tx.update(playerRef, { hasDragonglass: true });

      // ✅ log: dragonglass free (bamboozle)
      const logRef = doc(collection(db, "games", gameId, "bankLog"));
      tx.set(
        logRef,
        {
          createdAt: serverTimestamp(),
          type: "DRAGONGLASS_FREE",
          playerId,
          note: "Bamboozle",
        },
        { merge: true }
      );
    });

    setStatus("🪨✅ Dragonglass granted for FREE (Bamboozle).");
  } catch (err: any) {
    console.error(err);
    setStatus(`❌ ${err?.message ?? String(err)}`);
  }
}


    async function buyAndPlaceMage() {
  setStatus("");

  if (!magePlaceTileId) {
    setStatus("❌ Kies een tile om de Mage te plaatsen.");
    return;
  }

  // Mage mag enkel op eigen tile en nooit basecamp
  const tile = tiles.find((t) => t.id === magePlaceTileId) ?? null;
  if (!tile) {
    setStatus("❌ Tile niet gevonden.");
    return;
  }
  if (tile.isBasecamp) {
    setStatus("❌ Mage mag niet op een basecamp staan.");
    return;
  }
  if (tile.ownerPlayerId !== playerId) {
    setStatus("❌ Mage mag enkel op een tile onder jouw controle geplaatst worden.");
    return;
  }

  setStatus("Buying Mage...");

  const cost = SHOP_PRICES.mage;

  const playerRef = doc(db, "games", gameId, "players", playerId);
  const mageRef = doc(db, "games", gameId, "mages", playerId);

  try {
    await runTransaction(db, async (tx) => {
      // READS
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists()) throw new Error("Player not found");

      const pdata = pSnap.data() as any;
      const credits = Number(pdata?.credits ?? 0);

      // ✅ unified ownership check
      const alreadyOwned = !!pdata?.hasMage;
      if (alreadyOwned) throw new Error("Mage already owned");

      if (credits < cost) throw new Error("Not enough credits");

      // also guard: mage doc should not exist
      const mSnap = await tx.get(mageRef);
      if (mSnap.exists()) throw new Error("Mage already owned");

      // re-check tile in transaction
      const tileRef = doc(db, "games", gameId, "tiles", magePlaceTileId);
      const tileSnap = await tx.get(tileRef);
      if (!tileSnap.exists()) throw new Error("Tile not found");

      const tileData = tileSnap.data() as any;
      if (!!tileData.isBasecamp) throw new Error("Mage cannot be placed on a basecamp");
      if ((tileData.ownerPlayerId ?? null) !== playerId)
        throw new Error("Mage can only be placed on a tile you control");

      // WRITES
      tx.update(playerRef, {
        credits: credits - cost,
        hasMage: true,
      });

      tx.set(
        mageRef,
        {
          tileId: magePlaceTileId,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
       // ✅ log: mage purchase
      const logRef = doc(collection(db, "games", gameId, "bankLog"));
      tx.set(
        logRef,
        {
          createdAt: serverTimestamp(),
          type: "MAGE_PURCHASE",
          playerId,
          cost,
          tileId: magePlaceTileId,
          from: credits,
          to: credits - cost,
          delta: -cost,
        },
        { merge: true }
      );
    });

          
    const placed = magePlaceTileId;
    setMagePlaceTileId("");
    setStatus(`✅ Mage purchased & placed on tile #${placed}.`);
  } catch (err: any) {
    console.error(err);
    setStatus(`❌ ${err?.message ?? String(err)}`);
  }
}


      async function grantAndPlaceMageFree() {
  setStatus("");

  if (!magePlaceTileId) {
    setStatus("❌ Kies een tile om de Mage te plaatsen.");
    return;
  }

  const tile = tiles.find((t) => t.id === magePlaceTileId) ?? null;
  if (!tile) {
    setStatus("❌ Tile niet gevonden.");
    return;
  }
  if (tile.isBasecamp) {
    setStatus("❌ Mage mag niet op een basecamp staan.");
    return;
  }
  if (tile.ownerPlayerId !== playerId) {
    setStatus("❌ Mage mag enkel op een tile onder jouw controle geplaatst worden.");
    return;
  }

  const playerRef = doc(db, "games", gameId, "players", playerId);
  const mageRef = doc(db, "games", gameId, "mages", playerId);

  try {
    await runTransaction(db, async (tx) => {
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists()) throw new Error("Player not found");

      // cannot already own a mage
      const mSnap = await tx.get(mageRef);
      if (mSnap.exists()) throw new Error("Mage already owned");

      // re-check tile in transaction
      const tileRef = doc(db, "games", gameId, "tiles", magePlaceTileId);
      const tileSnap = await tx.get(tileRef);
      if (!tileSnap.exists()) throw new Error("Tile not found");
      const tileData = tileSnap.data() as any;

      if (!!tileData.isBasecamp) throw new Error("Mage cannot be placed on a basecamp");
      if ((tileData.ownerPlayerId ?? null) !== playerId)
        throw new Error("Mage can only be placed on a tile you control");

      // ✅ free grant: no credits update
      tx.set(
        mageRef,
        {
          tileId: magePlaceTileId,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
            // ✅ log: mage free (bamboozle)
      const logRef = doc(collection(db, "games", gameId, "bankLog"));
      tx.set(
        logRef,
        {
          createdAt: serverTimestamp(),
          type: "MAGE_FREE",
          playerId,
          tileId: magePlaceTileId,
          note: "Bamboozle",
        },
        { merge: true }
      );

    });

    const placed = magePlaceTileId;
    setMagePlaceTileId("");
    setStatus(`🧙✅ Mage granted for FREE (Bamboozle) on tile #${placed}.`);
  } catch (err: any) {
    console.error(err);
    setStatus(`❌ ${err?.message ?? String(err)}`);
  }
}

async function teleportMoveWithMage() {
  setStatus("");

  if (!mage?.tileId) {
    setStatus("❌ You need a Mage to teleport.");
    return;
  }

  // Mage must be on a tile you control (client-side quick check)
  const mageTile = tiles.find((t) => String(t.id) === String(mage.tileId)) ?? null;
  if (!mageTile || mageTile.ownerPlayerId !== playerId) {
    setStatus("❌ Mage must be on a tile you control.");
    return;
  }

  if (!tpFromTileId || !tpToTileId) {
    setStatus("❌ Kies een FROM en TO tile voor teleport.");
    return;
  }
  if (tpFromTileId === tpToTileId) {
    setStatus("❌ TO mag niet dezelfde zijn als FROM.");
    return;
  }

  const fromTile = tiles.find((t) => String(t.id) === String(tpFromTileId)) ?? null;
  const toTile = tiles.find((t) => String(t.id) === String(tpToTileId)) ?? null;

  if (!fromTile || !toTile) {
    setStatus("❌ Tile not found.");
    return;
  }

  // FROM must be your controlled (or your basecamp allowed as FROM)
  const fromIsOwn =
    fromTile.ownerPlayerId === playerId ||
    (fromTile.isBasecamp && fromTile.basecampOwnerPlayerId === playerId);

  if (!fromIsOwn) {
    setStatus("❌ Teleport FROM must be a tile you control (or your basecamp).");
    return;
  }

  // TO can be any tile EXCEPT basecamps
  if (toTile.isBasecamp) {
    setStatus("❌ Teleport TO cannot be a basecamp (anyone's).");
    return;
  }

  const m = {
    foot: Math.max(0, Math.floor(Number(tpFoot) || 0)),
    cav: Math.max(0, Math.floor(Number(tpCav) || 0)),
    arch: Math.max(0, Math.floor(Number(tpArch) || 0)),
  };

  const total = m.foot + m.cav + m.arch;
  if (total <= 0) {
    setStatus("❌ Kies minstens 1 troep om te teleporteren.");
    return;
  }

  const cost = total * MOVEMENT_COST_PER_TROOP;
  setStatus("Teleporting...");

  const playerRef = doc(db, "games", gameId, "players", playerId);
  const myMageRef = doc(db, "games", gameId, "mages", playerId);

  const fromRef = doc(db, "games", gameId, "deployments", playerId, "tiles", tpFromTileId);
  const toRef = doc(db, "games", gameId, "deployments", playerId, "tiles", tpToTileId);

  const fromTileRef = doc(db, "games", gameId, "tiles", tpFromTileId);
  const toTileRef = doc(db, "games", gameId, "tiles", tpToTileId);

  let didBattle = false;
  let uiMessage = "";

  try {
    await runTransaction(db, async (tx) => {
      // ===== READS FIRST =====
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists()) throw new Error("Player not found");
      const pData = pSnap.data() as any;

      const credits = Number(pData?.credits ?? 0);
      if (credits < cost) throw new Error("Not enough credits");

      // Re-check mage tile ownership in transaction
      const mageTileRefTx = doc(db, "games", gameId, "tiles", String(mage.tileId));
      const mageTileSnap = await tx.get(mageTileRefTx);
      if (!mageTileSnap.exists()) throw new Error("Mage tile not found");
      const mageTileData = mageTileSnap.data() as any;
      if ((mageTileData.ownerPlayerId ?? null) !== playerId) {
        throw new Error("Mage must be on a tile you control");
      }

      const fromTileSnap = await tx.get(fromTileRef);
      if (!fromTileSnap.exists()) throw new Error("FROM tile not found");
      const fromTileData = fromTileSnap.data() as any;

      const fromIsOwnTx =
        (fromTileData.ownerPlayerId ?? null) === playerId ||
        (!!fromTileData.isBasecamp && (fromTileData.basecampOwnerPlayerId ?? null) === playerId);

      if (!fromIsOwnTx) throw new Error("Teleport FROM must be your tile (or your basecamp)");

      const toTileSnap = await tx.get(toTileRef);
      if (!toTileSnap.exists()) throw new Error("TO tile not found");
      const toTileData = toTileSnap.data() as any;

      if (!!toTileData.isBasecamp) throw new Error("Teleport TO cannot be a basecamp");

      const toOwner: string | null = toTileData.ownerPlayerId ?? null;
      const isEmptyOrOwn = !toOwner || toOwner === playerId;

      // Defender mage check (READ)
      const defMageRef =
        toOwner && toOwner !== playerId ? doc(db, "games", gameId, "mages", toOwner) : null;

      let defenderMageOnThisTile = false;
      if (defMageRef) {
        const defMageSnap = await tx.get(defMageRef);
        if (defMageSnap.exists()) {
          const defMage = defMageSnap.data() as any;
          defenderMageOnThisTile = String(defMage.tileId ?? "") === String(tpToTileId);
        }
      }

      // FROM troops (your deployment)
      const fSnap = await tx.get(fromRef);
      const f = (fSnap.exists() ? (fSnap.data() as any) : {}) as any;
      const fTroops = {
        foot: Number(f.foot ?? 0),
        cav: Number(f.cav ?? 0),
        arch: Number(f.arch ?? 0),
      };

      if (m.foot > fTroops.foot || m.cav > fTroops.cav || m.arch > fTroops.arch) {
        throw new Error("Not enough troops on FROM tile");
      }

      const nextFrom = {
        foot: fTroops.foot - m.foot,
        cav: fTroops.cav - m.cav,
        arch: fTroops.arch - m.arch,
      };
      const fromBecomesEmpty = nextFrom.foot + nextFrom.cav + nextFrom.arch <= 0;

      // TO troops (your own deployment doc on TO)
      const toSnap = await tx.get(toRef);
      const toData = (toSnap.exists() ? (toSnap.data() as any) : {}) as any;
      const toTroops = {
        foot: Number(toData.foot ?? 0),
        cav: Number(toData.cav ?? 0),
        arch: Number(toData.arch ?? 0),
      };

      // Defender troops if enemy
      let defRef: any = null;
      let defTroops: Troops = { foot: 0, cav: 0, arch: 0 };

      if (!isEmptyOrOwn) {
        defRef = doc(db, "games", gameId, "deployments", toOwner!, "tiles", tpToTileId);
        const dSnap = await tx.get(defRef);
        const d = (dSnap.exists() ? (dSnap.data() as any) : {}) as any;
        defTroops = {
          foot: Number(d.foot ?? 0),
          cav: Number(d.cav ?? 0),
          arch: Number(d.arch ?? 0),
        };
      }

      // ===== DECISION (battle math) =====
      const attExp = {
        foot: Math.max(0, Math.floor(Number(pData?.exp?.foot ?? 0))),
        cav: Math.max(0, Math.floor(Number(pData?.exp?.cav ?? 0))),
        arch: Math.max(0, Math.floor(Number(pData?.exp?.arch ?? 0))),
      };

      let defExp = { foot: 0, cav: 0, arch: 0 };
      if (!isEmptyOrOwn && toOwner) {
        const defPlayerRef = doc(db, "games", gameId, "players", toOwner);
        const defPlayerSnap = await tx.get(defPlayerRef);
        if (defPlayerSnap.exists()) {
          const dp = defPlayerSnap.data() as any;
          defExp = {
            foot: Math.max(0, Math.floor(Number(dp?.exp?.foot ?? 0))),
            cav: Math.max(0, Math.floor(Number(dp?.exp?.cav ?? 0))),
            arch: Math.max(0, Math.floor(Number(dp?.exp?.arch ?? 0))),
          };
        }
      }

      const attackerPower =
        (m.foot * attExp.foot) / 3 + (m.cav * attExp.cav) / 3 + (m.arch * attExp.arch) / 3;

      const defenderPower =
        (defTroops.foot * defExp.foot) / 3 +
        (defTroops.cav * defExp.cav) / 3 +
        (defTroops.arch * defExp.arch) / 3;

      const diff = attackerPower - defenderPower;
      const margin = Math.abs(diff);

      const battleOutcome =
        attackerPower > defenderPower ? "ATTACKER" : attackerPower < defenderPower ? "DEFENDER" : "DRAW";

      const attackerDivisor = winnerDivisor(margin);
      const defenderDivisor = defenderWinDivisor(margin);

      const attackerSurvivors = applyWinnerSurvivors(m, attackerDivisor);
      const defenderSurvivors =
        battleOutcome === "DEFENDER"
          ? applyWinnerSurvivors(defTroops, defenderDivisor)
          : applyWinnerSurvivors(defTroops, attackerDivisor);

      const attackerSurvivorsTotal = attackerSurvivors.foot + attackerSurvivors.cav + attackerSurvivors.arch;
      const defenderSurvivorsTotal = defenderSurvivors.foot + defenderSurvivors.cav + defenderSurvivors.arch;

      // ===== WRITES =====
      tx.update(playerRef, { credits: credits - cost });

      // troops always leave FROM
      tx.set(fromRef, nextFrom, { merge: true });

      const logRef1 = doc(collection(db, "games", gameId, "battleLog"));
      const logRef2 = doc(collection(db, "games", gameId, "battleLog"));

      // release if FROM becomes empty and isn't basecamp
      if (fromBecomesEmpty && !fromTileData.isBasecamp && (fromTileData.ownerPlayerId ?? null) === playerId) {
        tx.update(fromTileRef, { ownerPlayerId: null });

        // Mage dies if it was on the released tile
        if (String(mage.tileId) === String(tpFromTileId)) {
          tx.delete(myMageRef);
          tx.update(playerRef, { hasMage: false });
        }

        tx.set(
          logRef1,
          {
            createdAt: serverTimestamp(),
            type: "RELEASE",
            tileId: tpFromTileId,
            oldOwnerId: playerId,
            newOwnerId: null,
          },
          { merge: true }
        );
      }

      // === No battle: teleport into own/neutral ===
      if (isEmptyOrOwn) {
        tx.set(
          toRef,
          {
            foot: toTroops.foot + m.foot,
            cav: toTroops.cav + m.cav,
            arch: toTroops.arch + m.arch,
          },
          { merge: true }
        );

        if (!toOwner) {
          tx.update(toTileRef, { ownerPlayerId: playerId });
          tx.set(
            logRef2,
            {
              createdAt: serverTimestamp(),
              type: "CONQUER",
              tileId: tpToTileId,
              oldOwnerId: null,
              newOwnerId: playerId,
            },
            { merge: true }
          );
        }

        return;
      }

      // === Enemy tile => battle ===
      didBattle = true;

      if (battleOutcome === "ATTACKER") {
        // attacker "wins" but no survivors => DRAW
        if (attackerSurvivorsTotal <= 0) {
          uiMessage = `🧙🤝 Teleport attack on tile #${tpToTileId}: DRAW. Both armies destroyed. (No survivors)`;

          tx.set(
            logRef2,
            {
              createdAt: serverTimestamp(),
              type: "DRAW",
              tileId: tpToTileId,
              attackerId: playerId,
              defenderId: toOwner,
              winnerId: null,
              attackerPower,
              defenderPower,
              diff,
              margin,
              attackerDivisor,
              defenderDivisor,
              note: "teleport_attacker_win_but_no_survivors",
            },
            { merge: true }
          );

          tx.update(toTileRef, { ownerPlayerId: null });

          // clear both deployments explicitly
          tx.set(toRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });
          tx.set(defRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

          if (defenderMageOnThisTile && defMageRef) {
            tx.delete(defMageRef);
            const defPlayerRef = doc(db, "games", gameId, "players", toOwner);
            tx.update(defPlayerRef, { hasMage: false });
          }

          return;
        }

        // normal attacker win
        uiMessage = `🧙⚔️ Teleport attack on tile #${tpToTileId}: WON.`;

        tx.set(
          logRef2,
          {
            createdAt: serverTimestamp(),
            type: "ATTACKER_WIN",
            tileId: tpToTileId,
            attackerId: playerId,
            defenderId: toOwner,
            winnerId: playerId,
            attackerPower,
            defenderPower,
            diff,
            margin,
            attackerDivisor,
            defenderDivisor,
            survivors: attackerSurvivors,
          },
          { merge: true }
        );

        tx.update(toTileRef, { ownerPlayerId: playerId });

        tx.set(
          toRef,
          {
            foot: toTroops.foot + attackerSurvivors.foot,
            cav: toTroops.cav + attackerSurvivors.cav,
            arch: toTroops.arch + attackerSurvivors.arch,
          },
          { merge: true }
        );

        tx.set(defRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

        if (defenderMageOnThisTile && defMageRef) {
          tx.delete(defMageRef);
          const defPlayerRef = doc(db, "games", gameId, "players", toOwner);
          tx.update(defPlayerRef, { hasMage: false });
        }

        return;
      }

      if (battleOutcome === "DEFENDER") {
        // defender wins but no survivors => DRAW
        if (defenderSurvivorsTotal <= 0) {
          uiMessage = `🧙🤝 Teleport attack on tile #${tpToTileId}: DRAW. Both armies destroyed. (No defender survivors)`;

          tx.set(
            logRef2,
            {
              createdAt: serverTimestamp(),
              type: "DRAW",
              tileId: tpToTileId,
              attackerId: playerId,
              defenderId: toOwner,
              winnerId: null,
              attackerPower,
              defenderPower,
              diff,
              margin,
              attackerDivisor,
              defenderDivisor,
              note: "teleport_defender_hold_but_no_survivors",
            },
            { merge: true }
          );

          tx.update(toTileRef, { ownerPlayerId: null });

          // clear both deployments explicitly
          tx.set(toRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });
          tx.set(defRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

          if (defenderMageOnThisTile && defMageRef) {
            tx.delete(defMageRef);
            const defPlayerRef = doc(db, "games", gameId, "players", toOwner);
            tx.update(defPlayerRef, { hasMage: false });
          }

          return;
        }

        // normal defender hold
        uiMessage = `🧙⚔️ Teleport attack on tile #${tpToTileId}: LOST.`;

        tx.set(
          logRef2,
          {
            createdAt: serverTimestamp(),
            type: "DEFENDER_HOLD",
            tileId: tpToTileId,
            attackerId: playerId,
            defenderId: toOwner,
            winnerId: toOwner,
            attackerPower,
            defenderPower,
            diff,
            margin,
            attackerDivisor,
            defenderDivisor,
            survivors: defenderSurvivors,
          },
          { merge: true }
        );

        // defender survivors remain
        tx.set(defRef, defenderSurvivors, { merge: true });

        // IMPORTANT: attacker should have no troops on enemy tile
        tx.set(toRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

        return;
      }

      // DRAW
      uiMessage = `🧙🤝 Teleport attack on tile #${tpToTileId}: DRAW. Both armies destroyed.`;

      tx.set(
        logRef2,
        {
          createdAt: serverTimestamp(),
          type: "DRAW",
          tileId: tpToTileId,
          attackerId: playerId,
          defenderId: toOwner,
          winnerId: null,
          attackerPower,
          defenderPower,
          diff,
          margin,
          attackerDivisor,
          defenderDivisor,
        },
        { merge: true }
      );

      tx.update(toTileRef, { ownerPlayerId: null });

      tx.set(toRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });
      tx.set(defRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

      if (defenderMageOnThisTile && defMageRef) {
        tx.delete(defMageRef);
        const defPlayerRef = doc(db, "games", gameId, "players", toOwner);
        tx.update(defPlayerRef, { hasMage: false });
      }
    });

    // ===== after transaction =====
    setTpFoot(0);
    setTpCav(0);
    setTpArch(0);

    if (didBattle) {
      setStatus(uiMessage || "🧙⚔️ Teleport battle resolved.");
    } else {
      setStatus(`🧙 Teleport moved. Cost: ${cost} credits`);
    }
  } catch (err: any) {
    console.error(err);
    setStatus(`❌ ${err?.message ?? String(err)}`);
  }
}

          

 

const ui = {
  page: {
    minHeight: "100vh",
    padding: 20,
    background: "radial-gradient(1200px 700px at 50% 10%, #2a2218 0%, #14110c 55%, #0e0c08 100%)",
    color: "#f3e7cf",
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  } as const,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 16px",
    borderRadius: 14,
    border: "1px solid rgba(243,231,207,0.18)",
    background: "rgba(20,16,11,0.65)",
    backdropFilter: "blur(6px)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
  } as const,
  title: {
    fontFamily: "var(--font-cinzel), serif",
    letterSpacing: 2,
    fontSize: 26,
    margin: 0,
    lineHeight: 1,
  } as const,
  chipRow: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } as const,
  chip: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(243,231,207,0.18)",
    background: "rgba(243,231,207,0.06)",
  } as const,
  grid: {
    marginTop: 14,
    display: "grid",
    gridTemplateColumns: "minmax(520px, 1.7fr) minmax(340px, 1fr)",
    gap: 14,
    alignItems: "start",
  } as const,
  card: {
    borderRadius: 14,
    border: "1px solid rgba(243,231,207,0.16)",
    background: "rgba(20,16,11,0.55)",
    backdropFilter: "blur(6px)",
    boxShadow: "0 10px 26px rgba(0,0,0,0.25)",
    padding: 14,
  } as const,
  cardTitle: {
    margin: "0 0 10px 0",
    fontFamily: "var(--font-cinzel), serif",
    letterSpacing: 1,
    fontSize: 16,
    opacity: 0.95,
  } as const,
  button: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(243,231,207,0.22)",
    background: "rgba(243,231,207,0.07)",
    color: "#f3e7cf",
    cursor: "pointer",
  } as const,
  buttonDanger: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,140,140,0.35)",
    background: "rgba(255,140,140,0.10)",
    color: "#ffd7d7",
    cursor: "pointer",
  } as const,
};

// UI block
return (
  <main style={{ ...ui.page, position: "relative" }}>
    {(gameStatus === "paused" || gameStatus === "finished") && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(10,8,5,0.90)",
          backdropFilter: "blur(4px)",
          overflowY: "auto",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 720,
            width: "100%",
            margin: "30px auto",
            border: "1px solid rgba(243,231,207,0.30)",
            borderRadius: 18,
            padding: 28,
            background: "#1f1a12",
            color: "#f3e7cf",
            boxShadow: "0 20px 70px rgba(0,0,0,0.55)",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 42, marginBottom: 6 }}>
              {gameStatus === "paused" ? "⏸️" : "🏁"}
            </div>

            <h2 style={{ margin: 0 }}>
              {gameStatus === "paused" ? "CURRENT RANKING" : "FINAL RANKING"}
            </h2>

            <div
              style={{
                marginTop: 14,
                fontSize: 13,
                opacity: 0.76,
              }}
            >
              {gameStatus === "paused" ? "Your current position" : "Your final position"}
            </div>

            <div
              style={{
                marginTop: 4,
                fontSize: 32,
                fontWeight: 900,
              }}
            >
              {myRank ? `#${myRank}` : "—"}
              {rankTotal ? ` / ${rankTotal}` : ""}
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            {rankingRows.length === 0 ? (
              <div
                style={{
                  padding: 14,
                  borderRadius: 12,
                  border: "1px solid rgba(243,231,207,0.16)",
                  background: "rgba(0,0,0,0.12)",
                  opacity: 0.78,
                }}
              >
                Ranking is not available yet.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {rankingRows.map((r) => {
                  const p = players.find((x) => x.id === r.playerId);
                  const isMe = r.playerId === playerId;

                  const medal =
                    r.rank === 1
                      ? "🥇"
                      : r.rank === 2
                      ? "🥈"
                      : r.rank === 3
                      ? "🥉"
                      : "";

                  return (
                    <div
                      key={r.playerId}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "54px 1fr auto",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: isMe
                          ? "1px solid rgba(243,231,207,0.45)"
                          : "1px solid rgba(243,231,207,0.14)",
                        background: isMe
                          ? "rgba(243,231,207,0.10)"
                          : "rgba(0,0,0,0.10)",
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>
                        {medal || `#${r.rank}`}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 9,
                          minWidth: 0,
                        }}
                      >
                        <Avatar value={p?.avatar} size={24} />
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: isMe ? 800 : 650,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {p?.name ?? r.playerId}
                            {isMe ? " (you)" : ""}
                          </div>

                          <div
                            style={{
                              marginTop: 3,
                              fontSize: 11,
                              opacity: 0.72,
                            }}
                          >
                            🗺️ {r.dominance.toFixed(1)}% · 💰 {r.credits} · 🐎 {r.cav} · 🏹 {r.arch} · 🗡️ {r.foot}
                            {" · "}🌾 {farmersControlledBy(r.playerId)}
                            {" · "}🍺 {Number(p?.beerCount ?? 0)}
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          opacity: 0.9,
                        }}
                      >
                        #{r.rank}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: 14,
              textAlign: "center",
              fontSize: 13,
              opacity: 0.74,
              lineHeight: 1.5,
            }}
          >
            {gameStatus === "paused"
              ? "Waiting for the host to resume the game…"
              : `Game ${gameId} · ${player?.name ?? playerId}`}
          </div>
        </div>
      </div>
    )}

    {/* Header */}
    <div style={ui.header}>
      <div>
        <h1 style={ui.title}>HORGOTH — Player</h1>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
          Game: {gameId} · Player: {playerId}
        </div>
      </div>

      <div style={ui.chipRow}>
        <div style={ui.chip}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Avatar value={player?.avatar} size={22} />
              <strong>{player?.name ?? "—"}</strong>
            </span>
          </div>
        <div style={ui.chip}>
          Credits: <strong>{Number(player?.credits ?? 0)}</strong>
        </div>
        <div style={ui.chip}>
          Game: <strong>{gameStatus || "—"}</strong>
        </div>
        <div>
            Ranking:{" "}
            <strong>
              {myRank ? `#${myRank}` : "—"}
              {rankTotal ? ` / ${rankTotal}` : ""}
            </strong>
            {myDominance !== null ? (
              <span style={{ opacity: 0.8 }}> (dominance: {myDominance})</span>
            ) : null}
          </div>

        <div style={ui.chip}>
          Basecamp: <strong>{basecamp ? `#${basecamp.id}` : "—"}</strong>
        </div>
      </div>
    </div>

    <div style={ui.grid}>
      {/* LEFT: MAP + legend + notifications + BUY ACTIONS */}
      <section style={ui.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h2 style={ui.cardTitle}>World Map</h2>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {mapAction === "AIRSTRIKE"
              ? "✈️ Select an enemy non-basecamp tile for your airstrike"
              : "🗺️ Klik tiles om FROM/TO (Move) of TP_FROM/TP_TO (Teleport) te kiezen"}
          </div>
        </div>

        <div style={{ textAlign: "center", marginBottom: 8, fontSize: 12, opacity: 0.9 }}>
          {mapAction === "AIRSTRIKE" ? (
            <>✈️ Airstrike mode: <b>choose target</b></>
          ) : mapAction === "TP" ? (
            <>🧙 Teleport: <b>{tpPickMode === "TP_FROM" ? "kies TP FROM" : "kies TP TO"}</b></>
          ) : (
            <>🗺️ Klik op de map: <b>{mapPickMode === "FROM" ? "kies FROM" : "kies TO"}</b></>
          )}
        </div>

        <MapSvg
          tiles={tiles as any}
          tileTroops={tileTroopsAll as any}
          colorForPlayer={colorForPlayer}
          mageByTile={mageByTile as any}
          selectedTileId={selectedTileId}
          highlightTileIds={highlightTileIds}
          tieFighterPlayers={players}
          onSelectTile={(rawId) => {
            const id = String(rawId);
            setSelectedTileId(id);

            // ====== MOVE flow ======
            if (mapAction === "MOVE") {
              if (mapPickMode === "FROM") {
                if (!isMine(id)) {
                  setStatus("❌ FROM moet een tile zijn die jij controleert.");
                  return;
                }
                setFromTileId(id);
                setToTileId("");
                setStatus(`✅ FROM gekozen: tile #${id}. Kies nu je TO.`);
                setMapPickMode("TO");
                return;
              }

              // mapPickMode === "TO"
              if (!fromTileId) {
                setStatus("❌ Kies eerst een FROM tile.");
                setMapPickMode("FROM");
                return;
              }

              if (id === String(fromTileId)) {
                setToTileId("");
                setStatus("↩️ TO gereset. Kies opnieuw je bestemming.");
                return;
              }

              // ✅ hard gate: ONLY adjacent tiles are selectable as TO
              if (!moveToAllowedSet.has(id)) {
                setStatus(`❌ Tile #${id} is niet adjacent aan FROM #${fromTileId}.`);
                return;
              }

              setToTileId(id);
              setStatus(`✅ TO gekozen: tile #${id}. Klaar om te bewegen.`);
              return;
            }

            // ====== TELEPORT flow ======
            if (mapAction === "TP") {
              if (tpPickMode === "TP_FROM") {
                if (!isMine(id)) {
                  setStatus("❌ TP FROM moet een tile zijn die jij controleert.");
                  return;
                }
                setTpFromTileId(id);
                setTpToTileId("");
                setStatus(`✅ TP FROM gekozen: tile #${id}. Kies nu TP TO.`);
                setTpPickMode("TP_TO");
                return;
              }

              // tpPickMode === "TP_TO"
              if (!tpFromTileId) {
                setStatus("❌ Kies eerst een TP FROM tile.");
                setTpPickMode("TP_FROM");
                return;
              }

              if (id === String(tpFromTileId)) {
                setTpToTileId("");
                setStatus("↩️ TP TO gereset. Kies opnieuw je bestemming.");
                return;
              }

              const t = tiles.find((x) => String(x.id) === id);
              if (t?.isBasecamp) {
                setStatus("❌ Teleport TO mag geen basecamp zijn.");
                return;
              }

              setTpToTileId(id);
              setStatus(`✅ TP TO gekozen: tile #${id}. Klaar om te teleporteren.`);
              return;
            }

            // ====== AIRSTRIKE flow ======
            if (mapAction === "AIRSTRIKE") {
              if (myTieFighters <= 0) {
                setStatus("❌ You do not own a TIE Fighter.");
                return;
              }

              const t = tiles.find((x) => String(x.id) === id);

              if (!t) {
                setStatus("❌ Tile not found.");
                return;
              }

              if (t.isBasecamp) {
                setStatus("❌ A basecamp cannot be targeted by an airstrike.");
                return;
              }

              if (!t.ownerPlayerId) {
                setStatus("❌ You can only target an enemy-controlled tile.");
                return;
              }

              if (t.ownerPlayerId === playerId) {
                setStatus("❌ You cannot airstrike your own tile.");
                return;
              }

              setAirstrikeTargetTileId(id);
              setStatus(
                `✈️ Airstrike target selected: tile #${id} (${nameFor(t.ownerPlayerId)}). Confirm launch below.`
              );
              return;
            }
          }}
        />

        {status ? <div style={{ marginTop: 10, ...ui.chip, borderRadius: 12 }}>{status}</div> : null}

        {/* Legend */}
        <div style={{ marginTop: 14 }}>
          <h3 style={ui.cardTitle}>Legend</h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {players.map((p) => {
              const bg = colorForPlayer(p.id);
              const isMe = p.id === playerId;

              return (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(243,231,207,0.18)",
                    background: isMe ? "rgba(243,231,207,0.10)" : "rgba(243,231,207,0.04)",
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 4,
                      background: bg,
                      border: "1px solid rgba(0,0,0,0.55)",
                      display: "inline-block",
                    }}
                  />
                  <span style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Avatar value={p.avatar} size={18} />
                    <span>
                      {p.name ?? p.id}
                      {isMe ? " (you)" : ""}
                    </span>
                  </span>

                </div>
              );
            })}
          </div>
        </div>

        {/* Notifications */}
        <div style={{ marginTop: 14 }}>
          <h3 style={ui.cardTitle}>Notifications</h3>
          <div style={{ maxHeight: 220, overflow: "auto", paddingRight: 6 }}>
            {battleLogMine.length === 0 ? (
              <div style={{ opacity: 0.75, fontSize: 13 }}>No notifications yet.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {battleLogMine.map((e) => {
                  let text = "";

                  if (e.type === "CONQUER") {
                    text = `You conquered tile #${e.tileId}.`;
                  } else if (e.type === "RELEASE") {
                    text = `You left tile #${e.tileId} empty (it became neutral).`;
                  } else if (e.type === "ATTACKER_WIN") {
                    const defender = nameFor((e as any).defenderId);
                    text =
                      (e as any).attackerId === playerId
                        ? `You attacked tile #${e.tileId} from ${defender} and WON.`
                        : `You were attacked on tile #${e.tileId} by ${nameFor((e as any).attackerId)} and LOST.`;
                  } else if (e.type === "DEFENDER_HOLD") {
                    const defender = nameFor((e as any).defenderId);
                    text =
                      (e as any).attackerId === playerId
                        ? `You attacked tile #${e.tileId} from ${defender} but LOST.`
                        : `You were attacked on tile #${e.tileId} by ${nameFor((e as any).attackerId)} and WON (held the tile).`;
                  } else if (e.type === "DRAW") {
                    const attacker = nameFor((e as any).attackerId);
                    const defender = nameFor((e as any).defenderId);
                    text =
                      (e as any).attackerId === playerId
                        ? `You attacked tile #${e.tileId} from ${defender} — DRAW. Both armies destroyed.`
                        : `You were attacked on tile #${e.tileId} by ${attacker} — DRAW. Both armies destroyed.`;
                  } else if (e.type === "AIRSTRIKE") {
                    const attacker = nameFor((e as any).attackerId);
                    const defender = nameFor((e as any).defenderId);
                    const neutralized = !!(e as any).neutralized;

                    text =
                      (e as any).attackerId === playerId
                        ? `You launched an airstrike on ${defender} at tile #${e.tileId}${
                            neutralized ? " — all defenders destroyed, tile neutralized." : "."
                          }`
                        : `${attacker} launched an airstrike on you at tile #${e.tileId}${
                            neutralized ? " — all defenders destroyed, tile neutralized." : "."
                          }`;
                  } else {
                    text = `Event on tile #${(e as any).tileId}`;
                  }

                  return (
                    <li key={(e as any).id} style={{ marginBottom: 6, fontSize: 13, opacity: 0.95 }}>
                      {text}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ===== BUY ACTIONS (moved under Notifications) ===== */}

        {/* Experience */}
        <section style={{ ...ui.card, marginTop: 14 }}>
          <h2 style={ui.cardTitle}>Experience</h2>

          <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {(() => {
              const exp = getMyExpSafe();

              const itemStyle: React.CSSProperties = {
                border: "1px solid rgba(243,231,207,0.16)",
                borderRadius: 12,
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "rgba(0,0,0,0.10)",
              };

              const btnStyle: React.CSSProperties = { ...ui.button, padding: "6px 10px", borderRadius: 10 };

              return (
                <>
                  <div style={itemStyle}>
                    <span>🗡️</span>
                    <span style={{ minWidth: 22, textAlign: "center" }}>
                      <strong>{exp.foot}</strong>
                    </span>
                    <button style={btnStyle} onClick={() => adjustExp("foot", +1)}>
                      +1
                    </button>
                    <button style={btnStyle} onClick={() => adjustExp("foot", -1)}>
                      -1
                    </button>
                    <button
                      style={btnStyle}
                      disabled={exp.foot <= 0}
                      onClick={() => sellExpPoint("foot")}
                      title={`Sell 1 Footsoldier EXP for ${EXP_SELL_PRICE} credits`}
                    >
                      💰 Sell (+{EXP_SELL_PRICE})
                    </button>
                  </div>

                  <div style={itemStyle}>
                    <span>🐎</span>
                    <span style={{ minWidth: 22, textAlign: "center" }}>
                      <strong>{exp.cav}</strong>
                    </span>
                    <button style={btnStyle} onClick={() => adjustExp("cav", +1)}>
                      +1
                    </button>
                    <button style={btnStyle} onClick={() => adjustExp("cav", -1)}>
                      -1
                    </button>
                    <button
                      style={btnStyle}
                      disabled={exp.cav <= 0}
                      onClick={() => sellExpPoint("cav")}
                      title={`Sell 1 Cavalry EXP for ${EXP_SELL_PRICE} credits`}
                    >
                      💰 Sell (+{EXP_SELL_PRICE})
                    </button>
                  </div>

                  <div style={itemStyle}>
                    <span>🏹</span>
                    <span style={{ minWidth: 22, textAlign: "center" }}>
                      <strong>{exp.arch}</strong>
                    </span>
                    <button style={btnStyle} onClick={() => adjustExp("arch", +1)}>
                      +1
                    </button>
                    <button style={btnStyle} onClick={() => adjustExp("arch", -1)}>
                      -1
                    </button>
                    <button
                      style={btnStyle}
                      disabled={exp.arch <= 0}
                      onClick={() => sellExpPoint("arch")}
                      title={`Sell 1 Archer EXP for ${EXP_SELL_PRICE} credits`}
                    >
                      💰 Sell (+{EXP_SELL_PRICE})
                    </button>
                  </div>
                </>
              );
            })()}
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            EXP cannot go below 0. Sell 1 EXP point for <strong>{EXP_SELL_PRICE}</strong> credits. If EXP = 0 for a type → that type does not count in battle.
          </div>
        </section>

        {/* Bank */}
        <section style={{ ...ui.card, marginTop: 14 }}>
          <h2 style={ui.cardTitle}>Bank</h2>

          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="number"
              value={bankAmount}
              onChange={(e) => setBankAmount(Number(e.target.value))}
              style={{
                width: 130,
                padding: 8,
                borderRadius: 10,
                border: "1px solid rgba(243,231,207,0.18)",
                background: "rgba(0,0,0,0.18)",
                color: "#f3e7cf",
              }}
            />

            <button onClick={() => bankAdjustCredits(Math.abs(bankAmount))} style={ui.button}>
              + amount
            </button>

            <button onClick={() => bankAdjustCredits(-Math.abs(bankAmount))} style={ui.button}>
              − amount
            </button>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => bankAdjustCredits(1000)} style={ui.button}>
              +1000
            </button>
            <button onClick={() => bankAdjustCredits(10000)} style={ui.button}>
              +10000
            </button>
            <button onClick={() => bankAdjustCredits(-1000)} style={ui.button}>
              −1000
            </button>
            <button onClick={() => bankAdjustCredits(-10000)} style={ui.button}>
              −10000
            </button>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            Elke bankactie wordt gelogd (host ziet de laatste 20).
          </div>
        </section>

        {/* Shop */}
        <section style={{ ...ui.card, marginTop: 14 }}>
          <h2 style={ui.cardTitle}>Shop</h2>

          <div style={{ marginBottom: 8, opacity: 0.85 }}>
            Buys go to <strong>Basecamp</strong> (Tile #{basecamp?.id ?? "—"}).
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label style={{ fontSize: 12 }}>
              Footsoldiers ({SHOP_PRICES.foot})
              <br />
              <input
                type="number"
                min={0}
                value={buyFoot}
                onChange={(e) => setBuyFoot(Number(e.target.value))}
                style={{
                  width: 110,
                  padding: 8,
                  borderRadius: 10,
                  border: "1px solid rgba(243,231,207,0.18)",
                  background: "rgba(0,0,0,0.18)",
                  color: "#f3e7cf",
                }}
              />
            </label>

            <label style={{ fontSize: 12 }}>
              Cavalry ({SHOP_PRICES.cav})
              <br />
              <input
                type="number"
                min={0}
                value={buyCav}
                onChange={(e) => setBuyCav(Number(e.target.value))}
                style={{
                  width: 110,
                  padding: 8,
                  borderRadius: 10,
                  border: "1px solid rgba(243,231,207,0.18)",
                  background: "rgba(0,0,0,0.18)",
                  color: "#f3e7cf",
                }}
              />
            </label>

            <label style={{ fontSize: 12 }}>
              Archers ({SHOP_PRICES.arch})
              <br />
              <input
                type="number"
                min={0}
                value={buyArch}
                onChange={(e) => setBuyArch(Number(e.target.value))}
                style={{
                  width: 110,
                  padding: 8,
                  borderRadius: 10,
                  border: "1px solid rgba(243,231,207,0.18)",
                  background: "rgba(0,0,0,0.18)",
                  color: "#f3e7cf",
                }}
              />
            </label>
          </div>

          <div style={{ marginTop: 10 }}>
            Total cost: <strong>{buyCost}</strong> credits
          </div>

          <button onClick={buyTroopsToBasecamp} style={{ ...ui.button, marginTop: 10, width: "fit-content" }}>
            Buy (to basecamp)
          </button>
        </section>

        {/* Deserters / troop resale */}
        <section style={{ ...ui.card, marginTop: 14 }}>
          <h2 style={ui.cardTitle}>🏃 Deserters</h2>

          <div style={{ marginBottom: 10, fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
            Sell one troop for <strong>70% of its purchase price</strong>. The deserter is removed at random
            from one of your controlled tiles where that troop type is present.
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={() => desertTroop("foot")} style={ui.button}>
              🗡️ Footsoldier → +{TROOP_SELL_PRICES.foot}
            </button>
            <button type="button" onClick={() => desertTroop("cav")} style={ui.button}>
              🐎 Cavalry → +{TROOP_SELL_PRICES.cav}
            </button>
            <button type="button" onClick={() => desertTroop("arch")} style={ui.button}>
              🏹 Archer → +{TROOP_SELL_PRICES.arch}
            </button>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.72 }}>
            The bank log records which tile the deserter left. Basecamp can also be selected if the troop is stationed there.
          </div>
        </section>

        {/* TIE Fighter */}
        <section style={{ ...ui.card, marginTop: 14 }}>
          <h2 style={ui.cardTitle}>✈️ TIE Fighter</h2>

          <div style={{ marginBottom: 8, opacity: 0.88 }}>
            Cost: <strong>{SHOP_PRICES.tieFighter}</strong> credits
          </div>

          <div style={{ marginBottom: 8 }}>
            Available: <strong>{myTieFighters}</strong>
          </div>

          <div style={{ marginBottom: 10, fontSize: 13, opacity: 0.8, lineHeight: 1.5 }}>
            A TIE Fighter has <strong>{TIE_FIGHTER_ATTACK_POWER} attack power</strong> and can perform
            one suicide airstrike on an enemy non-basecamp tile. It cannot be destroyed before use.
          </div>

          <button
            type="button"
            onClick={buyTieFighter}
            style={{ ...ui.button, width: "fit-content" }}
          >
            ✈️ Buy TIE Fighter
          </button>
        </section>

        {/* Farmers */}
        <section style={{ ...ui.card, marginTop: 14 }}>
          <h2 style={ui.cardTitle}>🌾 Farmers</h2>

          <div style={{ marginBottom: 8, opacity: 0.88 }}>
            Farmers cost <strong>{SHOP_PRICES.farmer}</strong> credits each and generate{" "}
            <strong>100 credits per minute</strong> for whoever controls their tile.
          </div>

          <div style={{ marginBottom: 10, fontSize: 13, opacity: 0.8 }}>
            Farmers cannot be moved, do not fight, cannot die, and cannot be placed on a basecamp.
            If you lose the tile, the farmers stay there and serve the new ruler.
          </div>

          <div
            style={{
              marginBottom: 12,
              padding: 10,
              borderRadius: 12,
              border: "1px solid rgba(243,231,207,0.16)",
              background: "rgba(0,0,0,0.10)",
            }}
          >
            🌾 Farmers currently under your rule: <strong>{myControlledFarmers}</strong>
            <br />
            💰 Current farmer income: <strong>+{farmerIncomePerMinute}/min</strong>
          </div>

          <label style={{ fontSize: 12 }}>
            Place on (your controlled tile with at least 1 troop, no basecamp)
            <br />
            <select
              value={farmerTileId}
              onChange={(e) => setFarmerTileId(e.target.value)}
              style={{
                padding: 10,
                width: "100%",
                borderRadius: 12,
                border: "1px solid rgba(243,231,207,0.18)",
                background: "rgba(0,0,0,0.18)",
                color: "#f3e7cf",
              }}
            >
              <option value="">— choose —</option>
              {farmerEligibleTiles.map((t) => {
                const d = deployments[t.id] ?? { foot: 0, cav: 0, arch: 0 };
                const farmers = Math.max(0, Math.floor(Number(t.farmers ?? 0)));

                return (
                  <option key={t.id} value={t.id}>
                    #{t.id} — 🌾{farmers} (🗡️{d.foot ?? 0} 🐎{d.cav ?? 0} 🏹{d.arch ?? 0})
                  </option>
                );
              })}
            </select>
          </label>

          {farmerEligibleTiles.length === 0 ? (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              You currently have no non-basecamp tile with troops where farmers can be placed.
            </div>
          ) : null}

          <label style={{ fontSize: 12, display: "block", marginTop: 10 }}>
            Number of farmers
            <br />
            <input
              type="number"
              min={0}
              step={1}
              value={buyFarmers}
              onChange={(e) => setBuyFarmers(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              style={{
                width: 110,
                padding: 8,
                borderRadius: 10,
                border: "1px solid rgba(243,231,207,0.18)",
                background: "rgba(0,0,0,0.18)",
                color: "#f3e7cf",
              }}
            />
          </label>

          <div style={{ marginTop: 10 }}>
            Cost: <strong>{farmerPurchaseCost}</strong> credits
          </div>

          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.78 }}>
            Added income if you still control this tile:{" "}
            <strong>+{farmerPurchaseQty * 100}/min</strong>
          </div>

          <button
            onClick={buyAndPlaceFarmers}
            disabled={!farmerTileId || farmerPurchaseQty <= 0}
            style={{
              ...ui.button,
              marginTop: 10,
              width: "fit-content",
              cursor: !farmerTileId || farmerPurchaseQty <= 0 ? "not-allowed" : "pointer",
              opacity: !farmerTileId || farmerPurchaseQty <= 0 ? 0.6 : 1,
            }}
          >
            🌾 Buy & Place Farmers
          </button>
        </section>

        {/* Dragonglass */}
        <section style={{ ...ui.card, marginTop: 14 }}>
          <h2 style={ui.cardTitle}>Special: Dragonglass</h2>

          <div style={{ marginBottom: 8 }}>
            Cost: <strong>{SHOP_PRICES.dragonglass}</strong> credits — You can own only <strong>1</strong>.
          </div>

          <div style={{ marginBottom: 8 }}>
            Status: {player?.hasDragonglass ? <strong>✅ Owned 🔷</strong> : <strong>❌ Not owned</strong>}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={buyDragonglass}
              disabled={!!player?.hasDragonglass}
              style={{
                ...ui.button,
                cursor: player?.hasDragonglass ? "not-allowed" : "pointer",
                opacity: player?.hasDragonglass ? 0.6 : 1,
              }}
            >
              Buy Dragonglass
            </button>

            <button onClick={grantDragonglassFree} style={ui.button}>
              🎴 Bamboozle free
            </button>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            Once purchased, you keep it until it gets destroyed in battle.
          </div>
        </section>

        {/* Mage (buy/place) */}
        <section style={{ ...ui.card, marginTop: 14 }}>
          <h2 style={ui.cardTitle}>Special: Mage</h2>

          <div style={{ marginBottom: 8 }}>
            Cost: <strong>{SHOP_PRICES.mage}</strong> credits
          </div>

          {hasMage ? (
            <div>
              ✅ ✅ Mage owned {mage?.tileId ? <>on tile <strong>#{mage.tileId}</strong></> : null}
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                (Mage cannot be placed in basecamp and will never return to basecamp.)
              </div>
            </div>
          ) : (
            <>
              <label style={{ fontSize: 12 }}>
                Place Mage on (your controlled tile, not basecamp)
                <br />
                <select
                  value={magePlaceTileId}
                  onChange={(e) => setMagePlaceTileId(e.target.value)}
                  style={{
                    padding: 10,
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid rgba(243,231,207,0.18)",
                    background: "rgba(0,0,0,0.18)",
                    color: "#f3e7cf",
                  }}
                >
                  <option value="">— choose —</option>
                  {tiles
                    .filter((t) => !t.isBasecamp && t.ownerPlayerId === playerId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        #{t.id}
                      </option>
                    ))}
                </select>
              </label>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                <button
                  onClick={buyAndPlaceMage}
                  disabled={hasMage}
                  style={{
                    ...ui.button,
                    cursor: hasMage ? "not-allowed" : "pointer",
                    opacity: hasMage ? 0.6 : 1,
                  }}
                >
                  Buy & Place Mage
                </button>

                <button
                  onClick={grantAndPlaceMageFree}
                  disabled={hasMage}
                  style={{
                    ...ui.button,
                    cursor: hasMage ? "not-allowed" : "pointer",
                    opacity: hasMage ? 0.6 : 1,
                  }}
                >
                  🎴 Bamboozle free
                </button>
              </div>
            </>
          )}
        </section>

        {/* Dart reward */}
        <section style={{ ...ui.card, marginTop: 14 }}>
          <h2 style={ui.cardTitle}>🎯 Dart reward</h2>

          <div style={{ marginBottom: 8, opacity: 0.85 }}>
            Win a dart challenge → place <strong>+1 free archer</strong> on a tile you control (basecamp allowed).
          </div>

          <label style={{ fontSize: 12 }}>
            Place archer on (your controlled tile or your basecamp)
            <br />
            <select
              value={dartPlaceTileId}
              onChange={(e) => setDartPlaceTileId(e.target.value)}
              style={{
                padding: 10,
                width: "100%",
                borderRadius: 12,
                border: "1px solid rgba(243,231,207,0.18)",
                background: "rgba(0,0,0,0.18)",
                color: "#f3e7cf",
              }}
            >
              <option value="">— choose —</option>
              {ownedTileIds.map((id) => (
                <option key={id} value={id}>
                  #{id} (🗡️{deployments[id]?.foot ?? 0} 🐎{deployments[id]?.cav ?? 0} 🏹{deployments[id]?.arch ?? 0})
                </option>
              ))}
            </select>
          </label>

          <button onClick={addFreeArcherFromDart} style={{ ...ui.button, marginTop: 10, width: "fit-content" }}>
            🎯 +1 Free Archer
          </button>
        </section>
      </section>

      {/* RIGHT: CONTROLS (moves) */}
      <aside style={{ display: "grid", gap: 14 }}>
        {/* Status */}
        <section style={ui.card}>
          <h2 style={ui.cardTitle}>Status</h2>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 18, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <Avatar value={player?.avatar} size={24} />
                <span>{player?.name ?? "—"}</span>
              </span>

              {player?.hasDragonglass ? (
                <span
                  title="Dragonglass owned"
                  style={{
                    fontSize: 13,
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(243,231,207,0.22)",
                    background: "rgba(243,231,207,0.08)",
                  }}
                >
                  🔷 Dragonglass
                </span>
              ) : null}
            </div>

            <div>
              Credits: <strong>{Number(player?.credits ?? 0)}</strong>
            </div>

            <div>
              ✈️ <strong>TIE Fighters:</strong> {myTieFighters}
            </div>

            <div>
              🍺 <strong>Beercules:</strong> {Number(player?.beerCount ?? 0)}
            </div>

            <div>
              Dominance: <strong>{((ownedTileIds.length / 60) * 100).toFixed(1)}%</strong>{" "}
              <span style={{ opacity: 0.7 }}>({ownedTileIds.length}/60 tiles)</span>
            </div>

            <div style={{ fontSize: 12, opacity: 0.8 }}>Movement cost: 500 credits per troop per tile</div>

            <div>
              <strong>Basecamp</strong>: {basecamp ? `Tile #${basecamp.id}` : "Waiting..."}
            </div>
          </div>
        </section>

        {/* Map Mode */}
        <section style={ui.card}>
          <h2 style={ui.cardTitle}>Map mode</h2>

          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setMapAction("MOVE");
                setAirstrikeTargetTileId("");
                setStatus("🗺️ Map klikmodus: MOVE (FROM → TO)");
              }}
              style={{
                ...ui.button,
                background: mapAction === "MOVE" ? "rgba(243,231,207,0.16)" : "rgba(243,231,207,0.07)",
              }}
            >
              🪖 Move
            </button>

            <button
              type="button"
              onClick={() => {
                setMapAction("TP");
                setAirstrikeTargetTileId("");
                setStatus("🗺️ Map klikmodus: TELEPORT (TP FROM → TP TO)");
              }}
              style={{
                ...ui.button,
                background: mapAction === "TP" ? "rgba(243,231,207,0.16)" : "rgba(243,231,207,0.07)",
              }}
            >
              🧙 Teleport
            </button>

            <button
              type="button"
              disabled={myTieFighters <= 0}
              onClick={() => {
                setMapAction("AIRSTRIKE");
                setFromTileId("");
                setToTileId("");
                setTpFromTileId("");
                setTpToTileId("");
                setSelectedTileId("");
                setAirstrikeTargetTileId("");
                setStatus("✈️ AIRSTRIKE mode: choose an enemy non-basecamp tile.");
              }}
              style={{
                ...ui.button,
                background:
                  mapAction === "AIRSTRIKE"
                    ? "rgba(243,231,207,0.16)"
                    : "rgba(243,231,207,0.07)",
                cursor: myTieFighters <= 0 ? "not-allowed" : "pointer",
                opacity: myTieFighters <= 0 ? 0.55 : 1,
              }}
            >
              ✈️ Airstrike ({myTieFighters})
            </button>
          </div>

          {mapAction === "AIRSTRIKE" && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 12,
                border: "1px solid rgba(243,231,207,0.16)",
                background: "rgba(0,0,0,0.12)",
              }}
            >
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                Attack power: <strong>{TIE_FIGHTER_ATTACK_POWER}</strong>
                {" · "}
                TIE Fighters available: <strong>{myTieFighters}</strong>
              </div>

              <div style={{ marginTop: 6, fontSize: 13 }}>
                Target:{" "}
                <strong>
                  {airstrikeTargetTileId
                    ? `Tile #${airstrikeTargetTileId}`
                    : "— choose on map —"}
                </strong>
              </div>

              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.78 }}>
                A TIE Fighter is always destroyed after the strike. The airstrike can never capture a tile.
                If all defenders die, the tile becomes neutral.
              </div>

              <button
                type="button"
                onClick={launchTieFighterAirstrike}
                disabled={!airstrikeTargetTileId || myTieFighters <= 0}
                style={{
                  ...ui.button,
                  marginTop: 10,
                  width: "fit-content",
                  cursor:
                    !airstrikeTargetTileId || myTieFighters <= 0
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    !airstrikeTargetTileId || myTieFighters <= 0
                      ? 0.55
                      : 1,
                }}
              >
                💥 Launch airstrike
              </button>
            </div>
          )}
        </section>

        {/* Troop movement (moved up directly under Map mode) */}
        <section style={ui.card}>
          <h2 style={ui.cardTitle}>Troop movement</h2>

          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ fontSize: 12 }}>
              FROM (your tile)
              <br />
              <select
                value={fromTileId}
                onChange={(e) => {
                  setFromTileId(e.target.value);
                  setToTileId("");
                }}
                style={{
                  padding: 10,
                  width: "100%",
                  borderRadius: 12,
                  border: "1px solid rgba(243,231,207,0.18)",
                  background: "rgba(0,0,0,0.18)",
                  color: "#f3e7cf",
                }}
              >
                <option value="">— choose —</option>
                {ownedTileIds.map((id) => (
                  <option key={id} value={id}>
                    #{id} (🗡️{deployments[id]?.foot ?? 0} 🐎{deployments[id]?.cav ?? 0} 🏹{deployments[id]?.arch ?? 0})
                  </option>
                ))}
              </select>
            </label>

            <label style={{ fontSize: 12 }}>
              TO (adjacent)
              <br />
              <select
                value={toTileId}
                onChange={(e) => setToTileId(e.target.value)}
                disabled={!fromTileId}
                style={{
                  padding: 10,
                  width: "100%",
                  borderRadius: 12,
                  border: "1px solid rgba(243,231,207,0.18)",
                  background: !fromTileId ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.18)",
                  color: "#f3e7cf",
                  opacity: !fromTileId ? 0.7 : 1,
                }}
              >
                <option value="">— choose —</option>
                {toOptions.map((id) => (
                  <option key={id} value={id}>
                    #{id}
                  </option>
                ))}
              </select>
            </label>

            <div
              style={{
                border: "1px solid rgba(243,231,207,0.16)",
                borderRadius: 12,
                padding: 12,
                background: "rgba(0,0,0,0.10)",
              }}
            >
              <div style={{ marginBottom: 8 }}>
                Available on FROM: 🗡️{fromTroops.foot} 🐎{fromTroops.cav} 🏹{fromTroops.arch}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ fontSize: 12 }}>
                  Foot
                  <br />
                  <input
                    type="number"
                    min={0}
                    value={moveFoot}
                    onChange={(e) => setMoveFoot(Number(e.target.value))}
                    style={{
                      width: 90,
                      padding: 8,
                      borderRadius: 10,
                      border: "1px solid rgba(243,231,207,0.18)",
                      background: "rgba(0,0,0,0.18)",
                      color: "#f3e7cf",
                    }}
                  />
                </label>

                <label style={{ fontSize: 12 }}>
                  Cav
                  <br />
                  <input
                    type="number"
                    min={0}
                    value={moveCav}
                    onChange={(e) => setMoveCav(Number(e.target.value))}
                    style={{
                      width: 90,
                      padding: 8,
                      borderRadius: 10,
                      border: "1px solid rgba(243,231,207,0.18)",
                      background: "rgba(0,0,0,0.18)",
                      color: "#f3e7cf",
                    }}
                  />
                </label>

                <label style={{ fontSize: 12 }}>
                  Arch
                  <br />
                  <input
                    type="number"
                    min={0}
                    value={moveArch}
                    onChange={(e) => setMoveArch(Number(e.target.value))}
                    style={{
                      width: 90,
                      padding: 8,
                      borderRadius: 10,
                      border: "1px solid rgba(243,231,207,0.18)",
                      background: "rgba(0,0,0,0.18)",
                      color: "#f3e7cf",
                    }}
                  />
                </label>
              </div>

              <div style={{ marginTop: 10 }}>
                Cost: <strong>{moveCost}</strong> credits
              </div>
            </div>

            <button onClick={moveTroops} style={{ ...ui.button, width: "fit-content" }}>
              Move troops
            </button>

            {status ? <div style={{ marginTop: 6, fontSize: 13, opacity: 0.95 }}>{status}</div> : null}
          </div>
        </section>

        {/* Teleport move (under troop movement) */}
        <section style={ui.card}>
          <h2 style={ui.cardTitle}>Mage teleport move</h2>

          {!mage ? (
            <div style={{ opacity: 0.85 }}>❌ You don’t own a Mage yet.</div>
          ) : (
            <>
              <div style={{ marginBottom: 8 }}>
                Mage on tile: <strong>#{mage.tileId}</strong> — Teleport cost = 500 credits per troop
              </div>

              <label style={{ fontSize: 12 }}>
                FROM (your tile or your basecamp)
                <br />
                <select
                  value={tpFromTileId}
                  onChange={(e) => setTpFromTileId(e.target.value)}
                  style={{
                    padding: 10,
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid rgba(243,231,207,0.18)",
                    background: "rgba(0,0,0,0.18)",
                    color: "#f3e7cf",
                  }}
                >
                  <option value="">— choose —</option>
                  {ownedTileIds.map((id) => (
                    <option key={id} value={id}>
                      #{id} (🗡️{deployments[id]?.foot ?? 0} 🐎{deployments[id]?.cav ?? 0} 🏹{deployments[id]?.arch ?? 0})
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ fontSize: 12, marginTop: 10, display: "block" }}>
                TO (any tile, no basecamps)
                <br />
                <select
                  value={tpToTileId}
                  onChange={(e) => setTpToTileId(e.target.value)}
                  style={{
                    padding: 10,
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid rgba(243,231,207,0.18)",
                    background: "rgba(0,0,0,0.18)",
                    color: "#f3e7cf",
                  }}
                >
                  <option value="">— choose —</option>
                  {tiles
                    .filter((t) => !t.isBasecamp)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        #{t.id}
                      </option>
                    ))}
                </select>
              </label>

              <div style={{ marginTop: 8, opacity: 0.85 }}>
                Available on FROM: 🗡️{tpFromTroops.foot} 🐎{tpFromTroops.cav} 🏹{tpFromTroops.arch}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                <label style={{ fontSize: 12 }}>
                  Foot
                  <br />
                  <input
                    type="number"
                    min={0}
                    value={tpFoot}
                    onChange={(e) => setTpFoot(Number(e.target.value))}
                    style={{
                      width: 90,
                      padding: 8,
                      borderRadius: 10,
                      border: "1px solid rgba(243,231,207,0.18)",
                      background: "rgba(0,0,0,0.18)",
                      color: "#f3e7cf",
                    }}
                  />
                </label>

                <label style={{ fontSize: 12 }}>
                  Cav
                  <br />
                  <input
                    type="number"
                    min={0}
                    value={tpCav}
                    onChange={(e) => setTpCav(Number(e.target.value))}
                    style={{
                      width: 90,
                      padding: 8,
                      borderRadius: 10,
                      border: "1px solid rgba(243,231,207,0.18)",
                      background: "rgba(0,0,0,0.18)",
                      color: "#f3e7cf",
                    }}
                  />
                </label>

                <label style={{ fontSize: 12 }}>
                  Arch
                  <br />
                  <input
                    type="number"
                    min={0}
                    value={tpArch}
                    onChange={(e) => setTpArch(Number(e.target.value))}
                    style={{
                      width: 90,
                      padding: 8,
                      borderRadius: 10,
                      border: "1px solid rgba(243,231,207,0.18)",
                      background: "rgba(0,0,0,0.18)",
                      color: "#f3e7cf",
                    }}
                  />
                </label>
              </div>

              <div style={{ marginTop: 10 }}>
                Cost: <strong>{tpCost}</strong> credits
              </div>

              <button onClick={teleportMoveWithMage} style={{ ...ui.button, marginTop: 10, width: "fit-content" }}>
                Teleport move
              </button>
            </>
          )}
        </section>

        {/* Beercules (stays under moves) */}
        <section style={ui.card}>
          <h2 style={ui.cardTitle}>🍺 Beercules</h2>

          <div style={{ marginBottom: 8, opacity: 0.85 }}>
            Drink a pint → your <strong>Beercules</strong> counter goes up by 1, and you choose a reward.
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                name="beerculesReward"
                checked={beerculesReward === "CREDITS"}
                onChange={() => setBeerculesReward("CREDITS")}
              />
              +10000 credits
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                name="beerculesReward"
                checked={beerculesReward === "EXP"}
                onChange={() => setBeerculesReward("EXP")}
              />
              +1 EXP (choose troop type)
            </label>

            {beerculesReward === "EXP" && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingLeft: 22 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="radio"
                    name="beerculesExpType"
                    checked={beerculesExpType === "foot"}
                    onChange={() => setBeerculesExpType("foot")}
                  />
                  🗡️ Foot
                </label>

                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="radio"
                    name="beerculesExpType"
                    checked={beerculesExpType === "cav"}
                    onChange={() => setBeerculesExpType("cav")}
                  />
                  🐎 Cav
                </label>

                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="radio"
                    name="beerculesExpType"
                    checked={beerculesExpType === "arch"}
                    onChange={() => setBeerculesExpType("arch")}
                  />
                  🏹 Arch
                </label>
              </div>
            )}

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                name="beerculesReward"
                checked={beerculesReward === "BAMBOOZLE"}
                onChange={() => setBeerculesReward("BAMBOOZLE")}
              />
              Draw 1 Bamboozle card (physical)
            </label>
          </div>

          <button onClick={drinkBeerculesPint} style={{ ...ui.button, marginTop: 12, width: "fit-content" }}>
            🍺 Drink Pint (Beercules +1)
          </button>
        </section>
      </aside>
    </div>
  </main>
);

}