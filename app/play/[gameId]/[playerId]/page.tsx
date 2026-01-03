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
};

type PlayerDoc = {
  name?: string;
  avatar?: string;
  credits?: number;
  beerCount?: number;

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
  const [mapAction, setMapAction] = useState<"MOVE" | "TP">("MOVE");
  const [tpPickMode, setTpPickMode] = useState<"TP_FROM" | "TP_TO">("TP_FROM");

  const [authReady, setAuthReady] = useState(false);

  const [tileTroopsAll, setTileTroopsAll] = useState<
    Record<string, { foot: number; cav: number; arch: number }>
  >({});

  const [status, setStatus] = useState<string>("");
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

    // ===== Mage =====
  const [mage, setMage] = useState<MageDoc | null>(null);
  const [magePlaceTileId, setMagePlaceTileId] = useState<string>("");
  const [magesByPlayer, setMagesByPlayer] = useState<Record<string, MageDoc | null>>({});



  const SHOP_PRICES = useMemo(() => {
    return {
      foot: 1000,
      cav: 3000,
      arch: 3000,
      mage: 10000, 
      dragonglass: 10000,
    };
  }, []);

  const buyCost =
    Math.max(0, buyFoot) * SHOP_PRICES.foot +
    Math.max(0, buyCav) * SHOP_PRICES.cav +
    Math.max(0, buyArch) * SHOP_PRICES.arch;


  // movement UI
  const [fromTileId, setFromTileId] = useState<string>("");
  const [toTileId, setToTileId] = useState<string>("");
    // mage teleport UI
  const [tpFromTileId, setTpFromTileId] = useState<string>("");
  const [tpToTileId, setTpToTileId] = useState<string>("");
    // mage reposition (adjacent move, no teleport)
  const [mageMoveToTileId, setMageMoveToTileId] = useState<string>("");


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

  // ====== GRID adjacency (10x6) ======
  function isNeighbors(tileId: number) {
    const cols = 10;
    const rows = 6;
    const x = tileId % cols;
    const y = Math.floor(tileId / cols);

    const n: number[] = [];
    if (x > 0) n.push(tileId - 1);
    if (x < cols - 1) n.push(tileId + 1);
    if (y > 0) n.push(tileId - cols);
    if (y < rows - 1) n.push(tileId + cols);
    return n.map(String);
  }

  function neighbors(tileId: number) {
    return isNeighbors(tileId);
  }

  function isAdjacent(fromId: string, toId: string) {
  if (!fromId || !toId) return false;
  return isNeighbor(String(fromId), String(toId));
}

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

  useEffect(() => {
    const ref = doc(db, "games", gameId, "players", playerId);
    const unsub = onSnapshot(ref, (snap) => {
      setPlayer((snap.data() as any) ?? null);
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
  } else {
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

  const fromTroops = deployments[fromTileId] ?? { foot: 0, cav: 0, arch: 0 };

 const highlightTileIds = useMemo(() => {
  // MOVE: highlight neighbors van fromTileId
  if (mapAction === "MOVE") {
    if (!fromTileId) return [];
    return neighbors(Number(fromTileId));
  }

  // TP: highlight neighbors van tpFromTileId (of alles, afhankelijk van jouw teleport rules)
  if (mapAction === "TP") {
    if (!tpFromTileId) return [];
    return neighbors(Number(tpFromTileId)); // als teleport enkel adjacent mage move is
    // Als teleport "any tile" mag: return Array.from({length:60},(_,i)=>String(i));
  }

  return [];
}, [mapAction, fromTileId, tpFromTileId]);


 
  const toOptions = useMemo(() => {
    if (!fromTileId) return [];
    return neighbors(Number(fromTileId));
  }, [fromTileId]);

    const mageMoveOptions = useMemo(() => {
    if (!mage?.tileId) return [];
    return neighbors(Number(mage.tileId));
  }, [mage?.tileId]);


  const moveCount = Math.max(0, moveFoot) + Math.max(0, moveCav) + Math.max(0, moveArch);
  const moveCost = moveCount * 1000;
    const tpCount =
    Math.max(0, tpFoot) + Math.max(0, tpCav) + Math.max(0, tpArch);
  const tpCost = tpCount * 1000;

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

    function playBattleAudio() {
    const a = new Audio("/audio/battle.mp3");
    a.volume = 0.8;
    a.play().catch(() => {});
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
    foot: Math.max(0, Math.floor((Number(t.foot) || 0) / d)),
    cav: Math.max(0, Math.floor((Number(t.cav) || 0) / d)),
    arch: Math.max(0, Math.floor((Number(t.arch) || 0) / d)),
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

    const allowed = neighbors(Number(fromTileId)).includes(toTileId);
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

    const cost = total * 1000;
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
        // attacker exp = from own player doc (pSnap)
const attExp = {
  foot: Math.max(0, Math.floor(Number((pSnap.data() as any)?.exp?.foot ?? 0))),
  cav: Math.max(0, Math.floor(Number((pSnap.data() as any)?.exp?.cav ?? 0))),
  arch: Math.max(0, Math.floor(Number((pSnap.data() as any)?.exp?.arch ?? 0))),
};

// defender exp: default 0 als neutral/unknown
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

// bestaand gedrag voor attacker-win (laat je zoals het was)
const attackerDiv = winnerDivisor(margin);

// nieuw gedrag voor defender-win
const defenderDiv = defenderWinDivisor(margin);

// outcome moet je bepalen vóór je de juiste defender survivors kiest
const battleOutcome =
  attackerPower > defenderPower
    ? "ATTACKER"
    : attackerPower < defenderPower
    ? "DEFENDER"
    : "DRAW";

// survivors
const attackerSurvivors = applyWinnerSurvivors(m, attackerDiv);

// defender survivors: enkel jouw nieuwe regels gebruiken wanneer defender wint
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

        // we may need up to 2 log entries (release + conquer/battle)
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

       // enemy tile => battle (always log)
if (battleOutcome === "ATTACKER") {
  didBattle = true;

  // ✅ If attacker "wins" but ends with 0 survivors => DRAW (neutral tile)
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
  }

} else if (battleOutcome === "DEFENDER") {
  didBattle = true;

  // ✅ If defender "wins" but ends with 0 survivors => DRAW (neutral tile)
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

} else {
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
  }
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
        playBattleAudio();
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

        // 2) apply chosen reward
        if (beerculesReward === "CREDITS") {
          tx.update(playerRef, {
            beerCount: nextBeer,
            credits: curCredits + 5000,
          });
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
          return;
        }

        // BAMBOOZLE = no in-game effect besides counter
        tx.update(playerRef, {
          beerCount: nextBeer,
        });
      });

      // UI feedback after transaction
      if (beerculesReward === "CREDITS") {
        setStatus("🍺 Beercules +1 — Reward: +5000 credits!");
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

    if (!dartPlaceTileId) {
      setStatus("❌ Kies een tile om je gratis archer te plaatsen.");
      return;
    }

    // client-side check: must be owned tile OR own basecamp
    const tile = tiles.find((t) => t.id === dartPlaceTileId) ?? null;
    if (!tile) {
      setStatus("❌ Tile not found.");
      return;
    }

    const isOwn =
      tile.ownerPlayerId === playerId ||
      (tile.isBasecamp && tile.basecampOwnerPlayerId === playerId);

    if (!isOwn) {
      setStatus("❌ Je mag enkel plaatsen op een tile die jij controleert (of je basecamp).");
      return;
    }

    const depRef = doc(db, "games", gameId, "deployments", playerId, "tiles", dartPlaceTileId);
    const tileRef = doc(db, "games", gameId, "tiles", dartPlaceTileId);

    try {
      await runTransaction(db, async (tx) => {
        // re-check in transaction
        const tSnap = await tx.get(tileRef);
        if (!tSnap.exists()) throw new Error("Tile not found");
        const tData = tSnap.data() as any;

        const ok =
          (tData.ownerPlayerId ?? null) === playerId ||
          (!!tData.isBasecamp && (tData.basecampOwnerPlayerId ?? null) === playerId);

        if (!ok) throw new Error("You can only place on a tile you control (or your basecamp)");

        const dSnap = await tx.get(depRef);
        const d = (dSnap.exists() ? (dSnap.data() as any) : {}) as any;

        const cur = {
          foot: Number(d.foot ?? 0),
          cav: Number(d.cav ?? 0),
          arch: Number(d.arch ?? 0),
        };

        // add 1 archer for free
        tx.set(
          depRef,
          {
            ...cur,
            arch: cur.arch + 1,
          },
          { merge: true }
        );
      });

      const placed = dartPlaceTileId;
      setDartPlaceTileId("");
      setStatus(`🎯✅ Gratis archer geplaatst op tile #${placed}.`);
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

    // Mage must be on a tile you control
    const mageTile = tiles.find((t) => t.id === mage.tileId) ?? null;
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

    const fromTile = tiles.find((t) => t.id === tpFromTileId) ?? null;
    const toTile = tiles.find((t) => t.id === tpToTileId) ?? null;

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

    const cost = total * 1000;
    setStatus("Teleporting...");

    const playerRef = doc(db, "games", gameId, "players", playerId);
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
        const credits = Number((pSnap.data() as any)?.credits ?? 0);
        if (credits < cost) throw new Error("Not enough credits");

        // re-check mage tile ownership in transaction
        const mageTileRef = doc(db, "games", gameId, "tiles", mage.tileId);
        const mageTileSnap = await tx.get(mageTileRef);
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
          (!!fromTileData.isBasecamp &&
            (fromTileData.basecampOwnerPlayerId ?? null) === playerId);

        if (!fromIsOwnTx) throw new Error("Teleport FROM must be your tile (or your basecamp)");

        const toTileSnap = await tx.get(toTileRef);
        if (!toTileSnap.exists()) throw new Error("TO tile not found");
        const toTileData = toTileSnap.data() as any;

        if (!!toTileData.isBasecamp) throw new Error("Teleport TO cannot be a basecamp");

        const toOwner: string | null = toTileData.ownerPlayerId ?? null;
        // ===== defender mage check (READ) =====
        const defMageRef =
        toOwner && toOwner !== playerId
        ? doc(db, "games", gameId, "mages", toOwner)
        : null;

        let defenderMageOnThisTile = false;

        if (defMageRef) {
          const defMageSnap = await tx.get(defMageRef);
        if (defMageSnap.exists()) {
        const defMage = defMageSnap.data() as any;
         defenderMageOnThisTile = String(defMage.tileId ?? "") === tpToTileId;
         }
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

        // defender troops if enemy
        let defRef: any = null;
        let defTroops: Troops = { foot: 0, cav: 0, arch: 0 };

        const isEmptyOrOwn = !toOwner || toOwner === playerId;

        if (!isEmptyOrOwn) {
          defRef = doc(db, "games", gameId, "deployments", toOwner, "tiles", tpToTileId);
          const dSnap = await tx.get(defRef);
          const d = (dSnap.exists() ? (dSnap.data() as any) : {}) as any;
          defTroops = {
            foot: Number(d.foot ?? 0),
            cav: Number(d.cav ?? 0),
            arch: Number(d.arch ?? 0),
          };
        }

        // ===== DECISION =====
        // attacker exp = from own player doc (pSnap)
const attExp = {
  foot: Math.max(0, Math.floor(Number((pSnap.data() as any)?.exp?.foot ?? 0))),
  cav: Math.max(0, Math.floor(Number((pSnap.data() as any)?.exp?.cav ?? 0))),
  arch: Math.max(0, Math.floor(Number((pSnap.data() as any)?.exp?.arch ?? 0))),
};

// defender exp: default 0 als neutral/unknown
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
        // outcome eerst bepalen (handig om juiste divisor te kiezen)
        const battleOutcome =
          attackerPower > defenderPower
            ? "ATTACKER"
            : attackerPower < defenderPower
            ? "DEFENDER"
            : "DRAW";

        // divisors
        const attackerDiv = winnerDivisor(margin);
        const defenderDiv = defenderWinDivisor(margin);

        // survivors
        const attackerSurvivors = applyWinnerSurvivors(m, attackerDiv);

        const defenderSurvivors =
          battleOutcome === "DEFENDER"
            ? applyWinnerSurvivors(defTroops, defenderDiv) // ✅ nieuwe defender regels
            : applyWinnerSurvivors(defTroops, attackerDiv);

        const attackerSurvivorsTotal =
          attackerSurvivors.foot + attackerSurvivors.cav + attackerSurvivors.arch;

        const defenderSurvivorsTotal =
          defenderSurvivors.foot + defenderSurvivors.cav + defenderSurvivors.arch;



        // ===== WRITES =====
        tx.update(playerRef, { credits: credits - cost });

        // troops always leave FROM
        tx.set(fromRef, nextFrom, { merge: true });

        const logRef1 = doc(collection(db, "games", gameId, "battleLog"));
        const logRef2 = doc(collection(db, "games", gameId, "battleLog"));

        // release if FROM becomes empty and isn't basecamp
        if (
          fromBecomesEmpty &&
          !fromTileData.isBasecamp &&
          (fromTileData.ownerPlayerId ?? null) === playerId
        ) {
          tx.update(fromTileRef, { ownerPlayerId: null });

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

        if (isEmptyOrOwn) {
          // teleport into own/neutral
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

        // enemy tile => battle
if (battleOutcome === "ATTACKER") {
  didBattle = true;

  // If attacker "wins" but 0 survivors => DRAW
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
        divisor: attackerDiv,
        note: "teleport_attacker_win_but_no_survivors",
      },
      { merge: true }
    );

    tx.update(toTileRef, { ownerPlayerId: null });
    tx.set(toRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });
    tx.set(defRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

    if (defenderMageOnThisTile && defMageRef) {
      tx.delete(defMageRef);
    }

    return;
  }

  // Normal attacker win
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
      divisor: attackerDiv,
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
  }

} else if (battleOutcome === "DEFENDER") {
  didBattle = true;

  // If defender "wins" but 0 survivors => DRAW
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
        divisor: attackerDiv,
        note: "teleport_defender_hold_but_no_survivors",
      },
      { merge: true }
    );

    tx.update(toTileRef, { ownerPlayerId: null });
    tx.set(toRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });
    tx.set(defRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

    if (defenderMageOnThisTile && defMageRef) {
      tx.delete(defMageRef);
    }

    return;
  }

  // Normal defender hold (mage stays)
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
      divisor: defenderDiv,
      survivors: defenderSurvivors,
    },
    { merge: true }
  );

  tx.set(defRef, defenderSurvivors, { merge: true });

} else {
  didBattle = true;
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
      divisor: attackerDiv,
    },
    { merge: true }
  );

  tx.update(toTileRef, { ownerPlayerId: null });

  tx.set(toRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });
  tx.set(defRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

  if (defenderMageOnThisTile && defMageRef) {
    tx.delete(defMageRef);
  }
}

      });

      // ===== after transaction =====
      setTpFoot(0);
      setTpCav(0);
      setTpArch(0);

      if (didBattle) {
        playBattleAudio();
        setStatus(uiMessage || "🧙⚔️ Teleport battle resolved.");
      } else {
        setStatus(`🧙 Teleport moved. Cost: ${cost} credits`);
      }
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ ${err?.message ?? String(err)}`);
    }
  }

  async function moveMageAdjacent() {
    setStatus("");

    if (!mage?.tileId) {
      setStatus("❌ You don’t own a Mage.");
      return;
    }
    if (!mageMoveToTileId) {
      setStatus("❌ Kies een adjacent tile om de Mage naartoe te verplaatsen.");
      return;
    }
    if (mageMoveToTileId === mage.tileId) {
      setStatus("❌ Destination is same as current Mage tile.");
      return;
    }

    const allowed = neighbors(Number(mage.tileId)).includes(mageMoveToTileId);
    if (!allowed) {
      setStatus("❌ Mage move must be adjacent.");
      return;
    }

    const dest = tiles.find((t) => t.id === mageMoveToTileId) ?? null;
    if (!dest) {
      setStatus("❌ Tile not found.");
      return;
    }
    if (dest.isBasecamp) {
      setStatus("❌ Mage cannot be on a basecamp.");
      return;
    }
    if (dest.ownerPlayerId !== playerId) {
      setStatus("❌ Mage can only move to a tile you control.");
      return;
    }

    const cost = 1000;
    setStatus("Moving Mage...");

    const playerRef = doc(db, "games", gameId, "players", playerId);
    const mageRef = doc(db, "games", gameId, "mages", playerId);
    const destTileRef = doc(db, "games", gameId, "tiles", mageMoveToTileId);

    try {
      await runTransaction(db, async (tx) => {
        const pSnap = await tx.get(playerRef);
        if (!pSnap.exists()) throw new Error("Player not found");
        const credits = Number((pSnap.data() as any)?.credits ?? 0);
        if (credits < cost) throw new Error("Not enough credits");

        const mSnap = await tx.get(mageRef);
        if (!mSnap.exists()) throw new Error("Mage not found");
        const mData = mSnap.data() as any;
        const curTileId = String(mData.tileId ?? "");

        const okAdj = neighbors(Number(curTileId)).includes(mageMoveToTileId);
        if (!okAdj) throw new Error("Mage move must be adjacent");

        const dSnap = await tx.get(destTileRef);
        if (!dSnap.exists()) throw new Error("Destination tile not found");
        const dData = dSnap.data() as any;

        if (!!dData.isBasecamp) throw new Error("Mage cannot be on a basecamp");
        if ((dData.ownerPlayerId ?? null) !== playerId)
          throw new Error("Mage can only move to a tile you control");

        tx.update(playerRef, { credits: credits - cost });
        tx.update(mageRef, { tileId: mageMoveToTileId });
      });

      const movedTo = mageMoveToTileId; // keep before reset
      setMageMoveToTileId("");
      setStatus(`✅ Mage moved to tile #${movedTo}. Cost: ${cost} credits`);
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { isNeighbor, HEX_TILES_60 } from "@/app/_components/tileLayout";
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

type Tile = {
  id: string;
  ownerPlayerId: string | null;
  isBasecamp: boolean;
  basecampOwnerPlayerId?: string | null;
  isStartTile?: boolean;
};

export default function StartPositionPage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params.gameId as string;
  const playerId = params.playerId as string;

  const [authReady, setAuthReady] = useState(false);

  const [tiles, setTiles] = useState<Tile[]>([]);
  const [basecamp, setBasecamp] = useState<Tile | null>(null);

  const [startUnits, setStartUnits] = useState<{ foot: number; cav: number; arch: number } | null>(null);
  const [startReady, setStartReady] = useState(false);

  const [deployments, setDeployments] = useState<Record<string, { foot: number; cav: number; arch: number }>>({});

  // Start phase timer state
  const [startEndsAtMs, setStartEndsAtMs] = useState<number | null>(null);
  const [startActive, setStartActive] = useState(false);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  const [status, setStatus] = useState("");

  // -----------------------------
  // Auth
  // -----------------------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.error("Anonymous sign-in failed:", err);
          alert("Anonymous login failed. Check console.");
          return;
        }
      }
      setAuthReady(true);
    });

    return () => unsub();
  }, []);

  // Local ticking clock for countdown
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const timeLeftSec =
    startEndsAtMs !== null
      ? Math.max(0, Math.ceil((startEndsAtMs - nowMs) / 1000))
      : null;

  // start is locked if:
  // - player already startReady
  // - host locked startActive false
  // - timer elapsed
  const startLockedByTime = startEndsAtMs !== null && nowMs >= startEndsAtMs;
  const isLocked = startReady || !startActive || startLockedByTime;

  // -----------------------------
  // Listen: game doc (startClaim)
  // + auto redirect when start becomes inactive / time elapsed
  // -----------------------------
  useEffect(() => {
    if (!authReady) return;

    const gameRef = doc(db, "games", gameId);

    const unsub = onSnapshot(gameRef, (snap) => {
      const data = snap.data() as any;
      const startClaim = data?.startClaim ?? null;

      const active = !!startClaim?.active;
      setStartActive(active);

      const endsAt = startClaim?.endsAt?.toDate?.()
        ? startClaim.endsAt.toDate()
        : null;

      setStartEndsAtMs(endsAt ? endsAt.getTime() : null);

      // ✅ If host ended start phase, redirect (unless already on play page)
      if (!active) {
        router.replace(`/play/${gameId}/${playerId}`);
      }
    });

    return () => unsub();
  }, [authReady, gameId, playerId, router]);

  // ✅ also redirect if timer elapsed (covers case where startActive still true but time passed)
  useEffect(() => {
    if (!authReady) return;
    if (startLockedByTime) {
      router.replace(`/play/${gameId}/${playerId}`);
    }
  }, [authReady, startLockedByTime, gameId, playerId, router]);

  // -----------------------------
  // Listen: tiles
  // -----------------------------
  useEffect(() => {
    if (!authReady) return;

    const unsub = onSnapshot(collection(db, "games", gameId, "tiles"), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Tile);
      setTiles(list);

      const bc =
        list.find((t) => t.isBasecamp && t.basecampOwnerPlayerId === playerId) ?? null;

      setBasecamp(bc);
    });

    return () => unsub();
  }, [authReady, gameId, playerId]);

  // -----------------------------
  // Listen: player doc (startReady + startUnits)
  // + auto redirect when host sets startReady true (Finalize & fill remainder)
  // -----------------------------
  useEffect(() => {
    if (!authReady) return;

    const playerRef = doc(db, "games", gameId, "players", playerId);

    const unsub = onSnapshot(playerRef, (snap) => {
      const data = snap.data() as any;

      const ready = !!data?.startReady;
      setStartReady(ready);

      // ✅ Host “Finalize start + fill remainder” will set startReady true -> redirect automatically
      if (ready) {
        router.replace(`/play/${gameId}/${playerId}`);
        return;
      }

      const su = data?.startUnits ?? data?.units ?? null;
      if (su) {
        setStartUnits({
          foot: Number(su.foot ?? 0),
          cav: Number(su.cav ?? 0),
          arch: Number(su.arch ?? 0),
        });
      } else {
        setStartUnits(null);
      }
    });

    return () => unsub();
  }, [authReady, gameId, playerId, router]);

  // -----------------------------
  // Listen: deployments
  // -----------------------------
  useEffect(() => {
    if (!authReady) return;

    const depCol = collection(db, "games", gameId, "deployments", playerId, "tiles");

    const unsub = onSnapshot(depCol, (snap) => {
      const next: Record<string, { foot: number; cav: number; arch: number }> = {};
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
  }, [authReady, gameId, playerId]);

  // -----------------------------
  // Actions
  // -----------------------------
  async function claimStartTile(tileId: string) {
    if (!authReady) {
      setStatus("⏳ Waiting for login...");
      return;
    }
    if (!basecamp) return;

    if (isLocked) {
      setStatus("⏱️ Start phase is locked. You can’t claim more tiles.");
      return;
    }

    setStatus("Claiming...");

    const basecampId = basecamp.id;
    const isAdjacent = isNeighbor(String(basecampId), String(tileId));
    const isBasecampTile = tileId === basecampId;

    if (!isBasecampTile && !isAdjacent) {
      setStatus("❌ Only basecamp or adjacent tiles are allowed");
      return;
    }

    const tileRef = doc(db, "games", gameId, "tiles", tileId);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(tileRef);
        if (!snap.exists()) throw new Error("Tile not found");

        const t = snap.data() as any;

        const tileIsBasecamp = !!t.isBasecamp;
        const basecampOwner = t.basecampOwnerPlayerId ?? null;
        const owner = t.ownerPlayerId ?? null;

        const isOwnBasecamp = tileIsBasecamp && basecampOwner === playerId;

        if (tileIsBasecamp && !isOwnBasecamp) {
          throw new Error("You cannot claim an enemy basecamp");
        }

        // Own basecamp: just mark as start tile
        if (isOwnBasecamp) {
          tx.update(tileRef, { isStartTile: true });
          return;
        }

        // Adjacent tile: must be free or already yours
        if (owner && owner !== playerId) {
          throw new Error("Tile already taken");
        }

        tx.update(tileRef, {
          ownerPlayerId: playerId,
          isStartTile: true,
        });
      });

      setStatus(`✅ Claimed tile #${tileId}`);
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ ${err?.message ?? String(err)}`);
    }
  }

  async function setDeployment(
    tileId: string,
    patch: Partial<{ foot: number; cav: number; arch: number }>
  ) {
    if (!authReady) {
      setStatus("⏳ Waiting for login...");
      return;
    }

    if (!startUnits) {
      setStatus("❌ Start units not set yet (host must save pregame setup).");
      return;
    }

    const current = deployments[tileId] ?? { foot: 0, cav: 0, arch: 0 };

    const nextForTile = {
      foot: patch.foot ?? current.foot,
      cav: patch.cav ?? current.cav,
      arch: patch.arch ?? current.arch,
    };

    // totals excluding this tile
    const othersTotals = Object.entries(deployments).reduce(
      (acc, [id, d]) => {
        if (id === tileId) return acc;
        return {
          foot: acc.foot + (d.foot ?? 0),
          cav: acc.cav + (d.cav ?? 0),
          arch: acc.arch + (d.arch ?? 0),
        };
      },
      { foot: 0, cav: 0, arch: 0 }
    );

    const wouldTotal = {
      foot: othersTotals.foot + nextForTile.foot,
      cav: othersTotals.cav + nextForTile.cav,
      arch: othersTotals.arch + nextForTile.arch,
    };

    if (
      wouldTotal.foot > startUnits.foot ||
      wouldTotal.cav > startUnits.cav ||
      wouldTotal.arch > startUnits.arch
    ) {
      setStatus("❌ You can't deploy more troops than your start units.");
      return;
    }

    const ref = doc(db, "games", gameId, "deployments", playerId, "tiles", tileId);

    await setDoc(
      ref,
      {
        foot: nextForTile.foot,
        cav: nextForTile.cav,
        arch: nextForTile.arch,
      },
      { merge: true }
    );

    setStatus("");
  }

  async function markReady() {
    if (!authReady) {
      setStatus("⏳ Waiting for login...");
      return;
    }

    setStatus("Locking in...");

    const ref = doc(db, "games", gameId, "players", playerId);

    await setDoc(
      ref,
      {
        startReady: true,
        startReadyAt: serverTimestamp(),
      },
      { merge: true }
    );

    // ✅ immediate redirect; also covered by snapshot listener
    router.replace(`/play/${gameId}/${playerId}`);
  }

  // -----------------------------
  // Derived UI values
  // -----------------------------
  const deployedTotals = useMemo(() => {
    return Object.values(deployments).reduce(
      (acc, d) => ({
        foot: acc.foot + (d.foot ?? 0),
        cav: acc.cav + (d.cav ?? 0),
        arch: acc.arch + (d.arch ?? 0),
      }),
      { foot: 0, cav: 0, arch: 0 }
    );
  }, [deployments]);

  const remaining = useMemo(() => {
    if (!startUnits) return null;
    return {
      foot: Math.max(0, startUnits.foot - deployedTotals.foot),
      cav: Math.max(0, startUnits.cav - deployedTotals.cav),
      arch: Math.max(0, startUnits.arch - deployedTotals.arch),
    };
  }, [startUnits, deployedTotals]);

  const claimableTileIds = useMemo(() => {
    if (!basecamp) return [];
    const base = HEX_TILES_60.find((t) => t.id === String(basecamp.id));
    if (!base) return [];
    return [base.id, ...base.neighbors];
  }, [basecamp]);

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <main style={{ padding: 24 }}>
      <h1>Choose your start position</h1>
      <p>
        Game: <strong>{gameId}</strong> — Player: <strong>{playerId}</strong>
      </p>

      <div style={{ marginTop: 12 }}>
        <div>
          Start phase: <strong>{startActive ? "ACTIVE" : "INACTIVE"}</strong>
        </div>
        <div>
          Time left:{" "}
          <strong>{timeLeftSec === null ? "-" : `${timeLeftSec}s`}</strong>
        </div>

        <div style={{ marginTop: 8 }}>
          <strong>Start units:</strong>{" "}
          {startUnits
            ? `Foot ${startUnits.foot}, Cav ${startUnits.cav}, Arch ${startUnits.arch}`
            : "—"}
        </div>

        <div>
          <strong>Deployed:</strong> Foot {deployedTotals.foot}, Cav{" "}
          {deployedTotals.cav}, Arch {deployedTotals.arch}
        </div>

        <div>
          <strong>Remaining:</strong>{" "}
          {remaining
            ? `Foot ${remaining.foot}, Cav ${remaining.cav}, Arch ${remaining.arch}`
            : "—"}
        </div>

        {!authReady && <div style={{ marginTop: 8 }}>🔐 Logging in...</div>}
        {isLocked && <div style={{ marginTop: 8 }}>⏱️ Locked.</div>}
      </div>

      {!basecamp && <p style={{ marginTop: 12 }}>Waiting for basecamp assignment...</p>}

      {basecamp && (
        <>
          <p style={{ marginTop: 12 }}>
            Your basecamp is tile <strong>#{basecamp.id}</strong>
          </p>
          <p>Claim start tiles (basecamp + adjacent) and deploy your start troops.</p>

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            {claimableTileIds.map((id) => {
              const t = tiles.find((x) => x.id === id);
              const isOwn = t?.ownerPlayerId === playerId;
              const isTakenByOther = !!t?.ownerPlayerId && t?.ownerPlayerId !== playerId;

              const label = id === basecamp.id ? `🏠 Basecamp (#${id})` : `Tile #${id}`;

              return (
                <div
                  key={id}
                  style={{
                    border: "1px solid #ccc",
                    borderRadius: 10,
                    padding: 10,
                    minWidth: 230,
                    opacity: isTakenByOther ? 0.4 : 1,
                  }}
                >
                  <button
                    disabled={!authReady || isLocked || isTakenByOther}
                    onClick={() => claimStartTile(id)}
                    style={{
                      padding: "8px 12px",
                      border: "1px solid black",
                      borderRadius: 8,
                      cursor: !authReady || isLocked || isTakenByOther ? "not-allowed" : "pointer",
                      width: "100%",
                      textAlign: "left",
                    }}
                  >
                    {label} {isOwn ? "✅" : ""}
                  </button>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <label style={{ fontSize: 12 }}>
                      Foot{" "}
                      <input
                        type="number"
                        value={deployments[id]?.foot ?? 0}
                        disabled={!authReady || isLocked || !isOwn}
                        onChange={(e) => setDeployment(id, { foot: Number(e.target.value) })}
                        style={{ width: 62 }}
                        min={0}
                      />
                    </label>

                    <label style={{ fontSize: 12 }}>
                      Cav{" "}
                      <input
                        type="number"
                        value={deployments[id]?.cav ?? 0}
                        disabled={!authReady || isLocked || !isOwn}
                        onChange={(e) => setDeployment(id, { cav: Number(e.target.value) })}
                        style={{ width: 62 }}
                        min={0}
                      />
                    </label>

                    <label style={{ fontSize: 12 }}>
                      Arch{" "}
                      <input
                        type="number"
                        value={deployments[id]?.arch ?? 0}
                        disabled={!authReady || isLocked || !isOwn}
                        onChange={(e) => setDeployment(id, { arch: Number(e.target.value) })}
                        style={{ width: 62 }}
                        min={0}
                      />
                    </label>
                  </div>

                  {!isOwn && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                      Claim this tile first to deploy troops.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <button
        onClick={markReady}
        disabled={!authReady || isLocked}
        style={{
          marginTop: 16,
          padding: "10px 16px",
          border: "1px solid black",
          borderRadius: 8,
          cursor: !authReady || isLocked ? "not-allowed" : "pointer",
          opacity: !authReady || isLocked ? 0.5 : 1,
        }}
      >
        I’m ready (lock in)
      </button>

      <p style={{ marginTop: 16 }}>{status}</p>
    </main>
  );
}

}
