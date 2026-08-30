// Host page

"use client";

import { useEffect, useState, useRef } from "react";
import type React from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "@/lib/firebase";


import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  writeBatch,
  getDocs,
  getDoc,
  setDoc,
  serverTimestamp,
  limit,
  deleteField,
  runTransaction,
} from "firebase/firestore";

import MapSvg from "@/app/_components/MapSvg";

type Player = {
  id: string;
  name: string;
  avatar: string;
  credits: number;
  dominance: number;
  beerCount?: number;
  pregameRank?: number;
  tieFighters?: number;
  units: {
    foot: number;
    cav: number;
    arch: number;
    };
  exp?: {
    foot: number;
    cav: number;
    arch: number;
    };
};

type Tile = {
  id: string;
  ownerPlayerId: string | null;
  isBasecamp: boolean;
  basecampOwnerPlayerId?: string | null;
  isStartTile?: boolean;
  farmers?: number;
};

type DraftRow = {
  pregameRank: number | "";
};

type PregameReward = {
  credits: number;
  foot: number;
  cav: number;
  arch: number;
  extra?: string;
};

const PREGAME_REWARDS: Record<number, PregameReward> = {
  1: { credits: 25000, foot: 5, cav: 3, arch: 2 },
  2: { credits: 22000, foot: 5, cav: 5, arch: 0 },
  3: { credits: 19000, foot: 5, cav: 4, arch: 2 },
  4: { credits: 16000, foot: 4, cav: 2, arch: 2, extra: "+1 Dragonglass" },
  5: { credits: 15000, foot: 3, cav: 4, arch: 4 },
  6: { credits: 15000, foot: 3, cav: 3, arch: 2, extra: "+1 EXP of choice" },
  7: { credits: 15000, foot: 7, cav: 3, arch: 3 },
  8: { credits: 17000, foot: 4, cav: 2, arch: 1, extra: "+1 Mage" },
};


export default function HostPage() {
  const params = useParams();
  const gameId = params.gameId as string;

  const [players, setPlayers] = useState<Player[]>([]);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [tileTroops, setTileTroops] = useState<
    Record<string, { foot: number; cav: number; arch: number }>
  >({});
    const [playerTroopTotals, setPlayerTroopTotals] = useState<
    Record<string, { foot: number; cav: number; arch: number }>
  >({});
  const [selectedTileId, setSelectedTileId] = useState<string>("");


  const [battleLog, setBattleLog] = useState<Array<{ id: string } & any>>([]);
  const [bankLog, setBankLog] = useState<Array<{ id: string } & any>>([]);

  // ===== Central host audio =====
  const [hostAudioEnabled, setHostAudioEnabled] = useState(false);
  const hostAudioEnabledRef = useRef(false);
  const battleLogInitialSnapshotSeenRef = useRef(false);
  const playersForAudioRef = useRef<Player[]>([]);

  useEffect(() => {
    playersForAudioRef.current = players;
  }, [players]);

  function enableHostAudio() {
    hostAudioEnabledRef.current = true;
    setHostAudioEnabled(true);
  }

  function playHostAudio(src: string, volume = 0.9) {
    if (!hostAudioEnabledRef.current) return;

    const a = new Audio(src);
    a.volume = volume;
    a.play().catch((err) => {
      console.warn(`Could not play host audio: ${src}`, err);
    });
  }

  function playHostAirstrikeAudio() {
    playHostAudio("/audio/airstrike.mp3", 0.9);
  }

  function victorySoundForAvatar(avatar: string | undefined | null) {
    const a = String(avatar ?? "").trim();

    const victorySounds: Record<string, string> = {
      "/avatars/Luffy.jpg": "/audio/Luffy.mp3",
      "/avatars/Darth Vader.jpg": "/audio/Darth Vader.mp3",
      "/avatars/R2D2.jpg": "/audio/R2D2.mp3",
      "/avatars/Grogu.jpg": "/audio/Grogu.mp3",
      "/avatars/Zeb.jpg": "/audio/Zeb.mp3",
      "/avatars/Chopper.jpg": "/audio/Chopper.mp3",
      "/avatars/Boba fett.jpg": "/audio/Boba fett.mp3",
      "/avatars/Roronoa Zoro.jpg": "/audio/Roronoa Zoro.mp3",
    };

    return victorySounds[a] ?? null;
  }

  function playVictorySoundForPlayer(playerId: string | null | undefined) {
    if (!playerId) return;

    const winner = playersForAudioRef.current.find((p) => p.id === playerId);
    if (!winner) {
      console.warn("Victory sound: winner not found in Host players list:", playerId);
      return;
    }

    const src = victorySoundForAvatar(winner.avatar);
    if (!src) {
      console.warn("Victory sound: no sound mapped for avatar:", winner.avatar);
      return;
    }

    playHostAudio(src, 0.95);
  }

  // ===== Farmers: automatic income =====
  const [gameStatus, setGameStatus] = useState<string>("");
  const farmerPayoutInFlightRef = useRef(false);
  const FARMER_INCOME_PER_MINUTE = 100;
  const FARMER_PAYOUT_MS = 60 * 1000;

  const [magesByPlayer, setMagesByPlayer] = useState<Record<string, { tileId: string } | null>>(
    {}
  );

const [mapZoom, setMapZoom] = useState(1);
const [mapPan, setMapPan] = useState({ x: 0, y: 0 });

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function zoomBy(delta: number) {
  setMapZoom((z) => clamp(Number((z + delta).toFixed(2)), 0.7, 2.0));
}

function resetView() {
  setMapZoom(1);
  setMapPan({ x: 0, y: 0 });
}

function onWheelZoom(e: React.WheelEvent) {
  // CTRL+scroll is vaak browser zoom — laat ook zonder CTRL werken
  e.preventDefault();
  const dir = e.deltaY > 0 ? -1 : 1; // scroll down -> out, scroll up -> in
  zoomBy(dir * 0.08);
}

const isPanningRef = useRef(false);
const panStartRef = useRef({ x: 0, y: 0 });
const panOriginRef = useRef({ x: 0, y: 0 });

function onPanStart(e: React.MouseEvent) {
  // enkel links klikken
  if (e.button !== 0) return;
  isPanningRef.current = true;
  panStartRef.current = { x: e.clientX, y: e.clientY };
  panOriginRef.current = { x: mapPan.x, y: mapPan.y };
}

function onPanMove(e: React.MouseEvent) {
  if (!isPanningRef.current) return;
  const dx = e.clientX - panStartRef.current.x;
  const dy = e.clientY - panStartRef.current.y;
  setMapPan({ x: panOriginRef.current.x + dx, y: panOriginRef.current.y + dy });
}

function onPanEnd() {
  isPanningRef.current = false;
}


  // pregame draft state (BELANGRIJK: hooks bovenaan)
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});

  // timer state
  const [startEndsAtMs, setStartEndsAtMs] = useState<number | null>(null);
  const [startActive, setStartActive] = useState(false);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const autoFinalizeStartedRef = useRef(false);
  // winter is coming
  const [winterLevel, setWinterLevel] = useState<number>(0);
  // bamboozle: take over enemy tile
  const [bbActorId, setBbActorId] = useState<string>("");
  const [bbTargetTileId, setBbTargetTileId] = useState<string>("");

    // bamboozle: destroy dragonglass
  const [dgTargetPlayerId, setDgTargetPlayerId] = useState<string>("");
  // bamboozle - remove mage
  const [mageTargets, setMageTargets] = useState<string[]>([]);
  const [selectedMageVictim, setSelectedMageVictim] = useState<string>("");
  // bamboozle - destroy troops on a specific tile
  const [bbVictimPlayerId, setBbVictimPlayerId] = useState<string>("");
  const [bbVictimTileId, setBbVictimTileId] = useState<string>("");

  const [bbKillFoot, setBbKillFoot] = useState<number>(0);
  const [bbKillCav, setBbKillCav] = useState<number>(0);
  const [bbKillArch, setBbKillArch] = useState<number>(0);

  const [bbVictimTilesWithTroops, setBbVictimTilesWithTroops] = useState<
    Array<{ tileId: string; foot: number; cav: number; arch: number }>
  >([]);

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

  // players listener
  useEffect(() => {
    const q = query(
      collection(db, "games", gameId, "players"),
      orderBy("joinedAt")
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const list: Player[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Player, "id">),
      }));

      setPlayers(list);

      // init draft for new players (zonder bestaande overschrijven)
      setDraft((prev) => {
        const next = { ...prev };
        for (const p of list) {
          if (!next[p.id]) {
            next[p.id] = {
              pregameRank: p.pregameRank ?? "",
            };
          }
        }
        return next;
      });
    });

    return () => unsub();
  }, [gameId]);

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

    setTileTroops(next);
  }

  players.forEach((p) => {
    const depCol = collection(db, "games", gameId, "deployments", p.id, "tiles");

    const unsub = onSnapshot(depCol, (snap) => {
      const byTile: Record<string, { foot: number; cav: number; arch: number }> =
        {};

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

  if (players.length === 0) setTileTroops({});

  return () => {
    unsubs.forEach((u) => u());
  };
}, [gameId, players]);

    // ===== live totals per player (sum of deployments) =====
  useEffect(() => {
    if (!gameId) return;

    const unsubs: Array<() => void> = [];
    const nextTotals: Record<string, { foot: number; cav: number; arch: number }> = {};

    players.forEach((p) => {
      const depCol = collection(db, "games", gameId, "deployments", p.id, "tiles");

      const unsub = onSnapshot(depCol, (snap) => {
        let foot = 0, cav = 0, arch = 0;

        snap.docs.forEach((d) => {
          const data = d.data() as any;
          foot += Number(data.foot ?? 0);
          cav += Number(data.cav ?? 0);
          arch += Number(data.arch ?? 0);
        });

        nextTotals[p.id] = { foot, cav, arch };
        setPlayerTroopTotals({ ...nextTotals });
      });

      unsubs.push(unsub);
    });

    if (players.length === 0) setPlayerTroopTotals({});

    return () => unsubs.forEach((u) => u());
  }, [gameId, players]);


    // all mages (for map icon display)
  useEffect(() => {
    if (!gameId) return;

    const unsubs: Array<() => void> = [];
    const nextByPlayer: Record<string, { tileId: string } | null> = {};

    players.forEach((p) => {
      const ref = doc(db, "games", gameId, "mages", p.id);
      const unsub = onSnapshot(ref, (snap) => {
        nextByPlayer[p.id] = snap.exists() ? ({ tileId: (snap.data() as any).tileId } as any) : null;
        setMagesByPlayer({ ...nextByPlayer });
      });
      unsubs.push(unsub);
    });

    if (players.length === 0) setMagesByPlayer({});

    return () => unsubs.forEach((u) => u());
  }, [gameId, players]);


  // tiles listener
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
  if (!gameId) return;

  const ql = query(
    collection(db, "games", gameId, "battleLog"),
    orderBy("createdAt", "desc"),
    limit(10)
  );

  const unsub = onSnapshot(ql, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    setBattleLog(rows);

    // Do not replay old airstrikes when the Host page opens/refreshed.
    if (!battleLogInitialSnapshotSeenRef.current) {
      battleLogInitialSnapshotSeenRef.current = true;
      return;
    }

    for (const change of snap.docChanges()) {
      if (change.type !== "added") continue;
      const entry = change.doc.data() as any;

      // AIRSTRIKE has absolute priority: exactly one central sound.
      // Even if the airstrike neutralizes/wins the tile, no character victory sound follows.
      if (entry?.type === "AIRSTRIKE") {
        playHostAirstrikeAudio();
        continue;
      }

      // Ordinary battles: play the personal sound of the actual winner.
      if (
        (entry?.type === "ATTACKER_WIN" || entry?.type === "DEFENDER_HOLD") &&
        entry?.winnerId
      ) {
        playVictorySoundForPlayer(String(entry.winnerId));
      }
    }
  });

  return () => unsub();
}, [gameId]);

  useEffect(() => {
  if (!gameId) return;

  const ql = query(
    collection(db, "games", gameId, "bankLog"),
    orderBy("createdAt", "desc"),
    limit(20)
  );

  const unsub = onSnapshot(ql, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    setBankLog(rows);
  });

  return () => unsub();
}, [gameId]);


  // game doc listener (timer)
  useEffect(() => {
    const ref = doc(db, "games", gameId);

    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      const startClaim = data?.startClaim ?? null;

      setGameStatus(String(data?.status ?? ""));
      setStartActive(!!startClaim?.active);

      const endsAt = startClaim?.endsAt?.toDate?.()
        ? startClaim.endsAt.toDate()
        : null;

      setStartEndsAtMs(endsAt ? endsAt.getTime() : null);
      const wl = Number(data?.winter?.level ?? 0);
      setWinterLevel(Math.max(0, Math.min(10, wl)));

    });

    return () => unsub();
  }, [gameId]);

  // local ticking clock
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  async function processFarmerPayout() {
    if (!gameId) return;
    if (farmerPayoutInFlightRef.current) return;
    if (gameStatus !== "live" && gameStatus !== "playing") return;
    if (!tiles || tiles.length === 0) return;

    farmerPayoutInFlightRef.current = true;

    try {
      const gameRef = doc(db, "games", gameId);
      const tileRefs = tiles.map((t) => doc(db, "games", gameId, "tiles", String(t.id)));

      await runTransaction(db, async (tx) => {
        // ----- READ GAME FIRST -----
        const gameSnap = await tx.get(gameRef);
        if (!gameSnap.exists()) return;

        const gameData = gameSnap.data() as any;
        const statusNow = String(gameData?.status ?? "");

        if (statusNow !== "live" && statusNow !== "playing") return;

        const nowMs = Date.now();
        const lastRaw = gameData?.lastFarmerPayoutAt ?? null;

        let lastMs: number | null = null;

        if (lastRaw?.toMillis) {
          lastMs = Number(lastRaw.toMillis());
        } else if (lastRaw?.toDate) {
          lastMs = Number(lastRaw.toDate().getTime());
        } else if (lastRaw instanceof Date) {
          lastMs = lastRaw.getTime();
        } else if (typeof lastRaw === "number") {
          lastMs = lastRaw;
        }

        // Legacy/live game without a farmer clock:
        // start counting from now, without paying an artificial backlog.
        if (!lastMs || !Number.isFinite(lastMs)) {
          tx.set(
            gameRef,
            { lastFarmerPayoutAt: new Date(nowMs) },
            { merge: true }
          );
          return;
        }

        const elapsedMinutes = Math.floor((nowMs - lastMs) / FARMER_PAYOUT_MS);
        if (elapsedMinutes <= 0) return;

        // ----- READ ALL TILES -----
        const tileSnaps = [];
        for (const ref of tileRefs) {
          tileSnaps.push(await tx.get(ref));
        }

        const farmerCountsByOwner: Record<string, number> = {};

        tileSnaps.forEach((snap) => {
          if (!snap.exists()) return;

          const t = snap.data() as any;
          const farmers = Math.max(0, Math.floor(Number(t?.farmers ?? 0)));
          const ownerId = String(t?.ownerPlayerId ?? "");
          const isBasecamp = !!t?.isBasecamp;

          if (farmers <= 0) return;
          if (!ownerId) return; // neutral land produces nothing
          if (isBasecamp) return; // defensive rule; farmers should never exist here

          farmerCountsByOwner[ownerId] =
            (farmerCountsByOwner[ownerId] ?? 0) + farmers;
        });

        const ownerIds = Object.keys(farmerCountsByOwner);

        // ----- READ PLAYER DOCS BEFORE WRITES -----
        const playerSnaps: Array<{
          playerId: string;
          ref: ReturnType<typeof doc>;
          snap: any;
        }> = [];

        for (const ownerId of ownerIds) {
          const playerRef = doc(db, "games", gameId, "players", ownerId);
          const pSnap = await tx.get(playerRef);
          playerSnaps.push({ playerId: ownerId, ref: playerRef, snap: pSnap });
        }

        // Move the payout marker by full minutes only.
        // This preserves the leftover seconds instead of drifting over time.
        const nextPayoutMs =
          lastMs + elapsedMinutes * FARMER_PAYOUT_MS;

        // ----- WRITES -----
        tx.set(
          gameRef,
          {
            lastFarmerPayoutAt: new Date(nextPayoutMs),
          },
          { merge: true }
        );

        for (const row of playerSnaps) {
          if (!row.snap.exists()) continue;

          const farmers = farmerCountsByOwner[row.playerId] ?? 0;
          if (farmers <= 0) continue;

          const income =
            farmers *
            FARMER_INCOME_PER_MINUTE *
            elapsedMinutes;

          const pdata = row.snap.data() as any;
          const creditsBefore = Number(pdata?.credits ?? 0);
          const creditsAfter = creditsBefore + income;

          tx.update(row.ref, {
            credits: creditsAfter,
          });

          const logRef = doc(collection(db, "games", gameId, "bankLog"));
          tx.set(
            logRef,
            {
              createdAt: serverTimestamp(),
              type: "FARMER_INCOME",
              playerId: row.playerId,
              farmers,
              elapsedMinutes,
              incomePerFarmerPerMinute: FARMER_INCOME_PER_MINUTE,
              delta: income,
              from: creditsBefore,
              to: creditsAfter,
            },
            { merge: true }
          );
        }
      });
    } catch (err) {
      console.error("Farmer payout failed:", err);
    } finally {
      farmerPayoutInFlightRef.current = false;
    }
  }

  // Check regularly; the transaction itself only pays when a full minute elapsed.
  // The Firestore payout marker prevents duplicate payments, even with two host tabs.
  useEffect(() => {
    if (gameStatus !== "live" && gameStatus !== "playing") return;

    processFarmerPayout().catch((err) =>
      console.error("Initial farmer payout check failed:", err)
    );

    const timer = window.setInterval(() => {
      processFarmerPayout().catch((err) =>
        console.error("Automatic farmer payout check failed:", err)
      );
    }, 5000);

    return () => window.clearInterval(timer);

    // tiles are deliberately included so newly purchased farmers are seen immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, gameStatus, tiles]);

  async function pauseGame() {
    if (gameStatus !== "live" && gameStatus !== "playing") {
      alert("❌ The game is not currently running.");
      return;
    }

    try {
      await setDoc(
        doc(db, "games", gameId),
        {
          status: "paused",
          pausedAt: serverTimestamp(),
        },
        { merge: true }
      );

      alert("⏸️ Game paused.");
    } catch (err: any) {
      console.error(err);
      alert(`❌ ${err?.message ?? String(err)}`);
    }
  }

  async function resumeGame() {
    if (gameStatus !== "paused") {
      alert("❌ The game is not paused.");
      return;
    }

    try {
      await setDoc(
        doc(db, "games", gameId),
        {
          status: "live",
          resumedAt: serverTimestamp(),

          // Important: paused time must NOT generate farmer income.
          // Start the farmer clock again from the resume moment.
          lastFarmerPayoutAt: serverTimestamp(),
        },
        { merge: true }
      );

      alert("▶️ Game resumed.");
    } catch (err: any) {
      console.error(err);
      alert(`❌ ${err?.message ?? String(err)}`);
    }
  }

  async function endGame() {
    if (gameStatus === "finished") {
      alert("ℹ️ This game has already ended.");
      return;
    }

    const ok = window.confirm(
      "End this Horgoth game? Players will no longer be able to perform actions. The final game state will remain saved."
    );

    if (!ok) return;

    try {
      await setDoc(
        doc(db, "games", gameId),
        {
          status: "finished",
          finishedAt: serverTimestamp(),
          startClaim: {
            active: false,
          },
        },
        { merge: true }
      );

      alert("🏁 Game ended. Final state saved.");
    } catch (err: any) {
      console.error(err);
      alert(`❌ ${err?.message ?? String(err)}`);
    }
  }


  async function setWinterLevelInGame(nextLevel: number) {
  const lvl = Math.max(0, Math.min(10, Math.floor(Number(nextLevel) || 0)));
  const ref = doc(db, "games", gameId);

  await setDoc(
    ref,
    {
      winter: {
        level: lvl,
        updatedAt: serverTimestamp(),
      },
    },
    { merge: true }
  );
}

function pickRandom<T>(arr: T[], n: number) {
  const copy = [...arr];
  // Fisher-Yates shuffle partial
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

async function triggerFrostGiantsAttack() {
  // veiligheid
  if (!gameId) return;
  if (tiles.length === 0) {
    alert("Tiles not loaded yet.");
    return;
  }

  // enkel non-basecamp tiles
  const candidates = tiles.filter((t) => !t.isBasecamp);

  if (candidates.length < 15) {
    alert("Not enough non-basecamp tiles to attack.");
    return;
  }

  const attacked = pickRandom(candidates, 15);

  // We gaan: per attacked tile -> check owner -> als owner dragonglass => consume; else halve troops (rounded up loss)
  // Troops staan in deployments/{owner}/tiles/{tileId}
  // Dragonglass staat in players/{owner}
  const batch = writeBatch(db);

  const results: any[] = [];

  for (const t of attacked) {
    const tileId = String(t.id);
    const ownerId: string | null = t.ownerPlayerId ?? null;

    // neutral tile: enkel loggen
    if (!ownerId) {
      results.push({ tileId, ownerId: null, note: "neutral" });
      continue;
    }

    // basecamps zijn uitgesloten, maar extra safety:
    if (t.isBasecamp) {
      results.push({ tileId, ownerId, note: "basecamp_skipped" });
      continue;
    }

    const playerRef = doc(db, "games", gameId, "players", ownerId);
    const playerSnap = await getDoc(playerRef);
    const playerData = (playerSnap.data() as any) ?? {};
    const hasDG = !!playerData.hasDragonglass;

      if (hasDG) {
        // consume dragonglass, no troop loss
        batch.update(playerRef, { hasDragonglass: false });

        results.push({
          tileId,
          ownerId,
          dragonglassConsumed: true,
          losses: { foot: 0, cav: 0, arch: 0 },
        });
        continue;
      }


    // no dragonglass => troop loss
    const depRef = doc(db, "games", gameId, "deployments", ownerId, "tiles", tileId);
    const depSnap = await getDoc(depRef);
    const dep = (depSnap.data() as any) ?? {};

    const cur = {
      foot: Number(dep.foot ?? 0),
      cav: Number(dep.cav ?? 0),
      arch: Number(dep.arch ?? 0),
    };

    // verlies = ceil(half), over = floor(half)
    const next = {
      foot: Math.floor(cur.foot / 2),
      cav: Math.floor(cur.cav / 2),
      arch: Math.floor(cur.arch / 2),
    };

    const losses = {
      foot: cur.foot - next.foot, // = ceil(half)
      cav: cur.cav - next.cav,
      arch: cur.arch - next.arch,
    };

    batch.set(depRef, next, { merge: true });
    // ✅ if all troops gone => tile becomes neutral
      const becomesEmpty = next.foot + next.cav + next.arch <= 0;

      if (becomesEmpty) {
        const attackedTileRef = doc(db, "games", gameId, "tiles", tileId);
        batch.update(attackedTileRef, { ownerPlayerId: null });

        // ✅ if the owner's mage was on this tile => mage destroyed
        const mageRef = doc(db, "games", gameId, "mages", ownerId);
        const mageSnap = await getDoc(mageRef);
        if (mageSnap.exists()) {
          const md = mageSnap.data() as any;
          if (String(md.tileId ?? "") === String(tileId)) {
            batch.delete(mageRef);
          }
        }
      }


    results.push({
      tileId,
      ownerId,
      dragonglassConsumed: false,
      before: cur,
      after: next,
      losses,
    });
  }

  // winter reset naar 0 + timestamp
  const gameRef = doc(db, "games", gameId);
  batch.set(
    gameRef,
    {
      winter: {
        level: 0,
        lastTriggeredAt: serverTimestamp(),
      },
    },
    { merge: true }
  );

  // log één samenvattende entry in battleLog zodat iedereen het ziet
  const logRef = doc(collection(db, "games", gameId, "battleLog"));
  batch.set(
    logRef,
    {
      createdAt: serverTimestamp(),
      type: "FROST_GIANTS_ATTACK",
      attackedTileIds: attacked.map((x) => String(x.id)),
      results,
    },
    { merge: true }
  );

  await batch.commit();

  alert("❄️ Frost Giants attacked 15 random tiles! Winter level reset to 0.");
}
async function bamboozleDestroyDragonglass() {
  if (!dgTargetPlayerId) {
    alert("Choose a player first.");
    return;
  }

  const playerRef = doc(db, "games", gameId, "players", dgTargetPlayerId);

  const p = players.find((x) => x.id === dgTargetPlayerId);
  const name = p?.name ?? dgTargetPlayerId;

  //const ok = confirm(`🎴 Destroy Dragonglass of ${name}?`);
 // if (!ok) return;

  // remove dragonglass
  await setDoc(
    playerRef,
    {
      hasDragonglass: false,
    },
    { merge: true }
  );

  // optional: log to bankLog so everyone sees it
  //const logRef = doc(collection(db, "games", gameId, "bankLog"));
  //await setDoc(
   // logRef,
   // {
   //   createdAt: serverTimestamp(),
   //   type: "BAMBOOZLE_DG_DESTROY",
   //   playerId: dgTargetPlayerId,
   // },
   // { merge: true }
 // );
  // ✅ also log to tile/battle log (so it appears in "Last 10 tile changes")
      const tileLogRef = doc(collection(db, "games", gameId, "battleLog"));
      await setDoc(
        tileLogRef,
        {
          createdAt: serverTimestamp(),
          type: "BAMBOOZLE_DG_DESTROY",
          playerId: dgTargetPlayerId,
        },
        { merge: true }
      );


  //alert(`✅ Dragonglass destroyed for ${name}.`);
}
    // listener tiles met troops voor geselecteerde victim
    useEffect(() => {
      if (!gameId) return;

      // reset wanneer speler veranderd
      setBbVictimTileId("");
      setBbVictimTilesWithTroops([]);

      if (!bbVictimPlayerId) return;

      const depCol = collection(db, "games", gameId, "deployments", bbVictimPlayerId, "tiles");

      const unsub = onSnapshot(depCol, (snap) => {
        const list: Array<{ tileId: string; foot: number; cav: number; arch: number }> = [];

        snap.docs.forEach((d) => {
          const data = d.data() as any;
          const foot = Number(data.foot ?? 0);
          const cav = Number(data.cav ?? 0);
          const arch = Number(data.arch ?? 0);

          // enkel tiles tonen waar effectief troops staan
          if (foot + cav + arch > 0) {
            list.push({ tileId: d.id, foot, cav, arch });
          }
        });

        // sort numeriek op tileId
        list.sort((a, b) => Number(a.tileId) - Number(b.tileId));

        setBbVictimTilesWithTroops(list);
      });

  return () => unsub();
}, [gameId, bbVictimPlayerId]);


  async function initTiles() {
    const existing = await getDocs(collection(db, "games", gameId, "tiles"));
    if (!existing.empty) {
      alert("Tiles already initialized");
      return;
    }

    const batch = writeBatch(db);

    for (let i = 0; i < 60; i++) {
      const tileRef = doc(db, "games", gameId, "tiles", String(i));
      batch.set(tileRef, {
        ownerPlayerId: null,
        isBasecamp: false,
        basecampOwnerPlayerId: null,
        isStartTile: false,
        adjacent: [],
      });
    }

    await batch.commit();
    alert("✅ Tiles initialized");
  }

  function colorForPlayer(playerId: string | null) {
    if (!playerId) return "#eee";
    const idx = players.findIndex((p) => p.id === playerId);
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

    useEffect(() => {
  // players die een mage hebben
  const withMage = players
    .filter((p) => !!magesByPlayer[p.id]?.tileId)
    .map((p) => p.id);

  setMageTargets(withMage);

  // als huidige selectie niet meer geldig is, reset
  if (selectedMageVictim && !withMage.includes(selectedMageVictim)) {
    setSelectedMageVictim("");
  }
}, [players, magesByPlayer, selectedMageVictim]);


    const mageByTile = (() => {
    const m: Record<string, string> = {};
    Object.entries(magesByPlayer).forEach(([pid, md]) => {
      if (md?.tileId) m[md.tileId] = pid;
    });
    return m;
  })();


  function nameFor(pid?: string | null) {
  if (!pid) return "Unknown";
  return players.find((p) => p.id === pid)?.name ?? pid;
}

function labelForPlayer(p: Player) {
  const a = String(p.avatar ?? "");
  const emoji = a && !a.startsWith("/") ? a : "";
  return `${emoji ? emoji + " " : ""}${p.name}`;
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

  // lijst met bezette enemy tiles
    function occupiedEnemyTiles(actorId: string) {
      return tiles
        .filter((t) => {
          const owner = t.ownerPlayerId ?? null;
          if (!owner) return false;            // enkel bezette tiles
          if (!actorId) return false;
          if (owner === actorId) return false; // niet van jezelf
          if (t.isBasecamp) return false;      // basecamps veilig (zoals eerder)
          return true;
        })
        .sort((a, b) => Number(a.id) - Number(b.id));
    }


    // ===== Dominance + Ranking helpers =====
  const TOTAL_TILES = 60;

  function calcDominancePct(pid: string) {
    const owned = tiles.filter((t) => {
      const isOwn = t.ownerPlayerId === pid;
      const isOwnBasecamp = !!t.isBasecamp && t.basecampOwnerPlayerId === pid;
      return isOwn || isOwnBasecamp;
    }).length;

    return TOTAL_TILES > 0 ? (owned / TOTAL_TILES) * 100 : 0;
  }

  function getUnitTotals(pid: string) {
    // som van alle deployments van deze speler over alle tiles
    // tileTroops is aggregated over ALL players, dus dat kunnen we niet gebruiken voor één speler.
    // Daarom gebruiken we hier de player.units als "start units" niet; beter: we gebruiken p.units als fallback.
    // Ranking rule vroeg: cav/arch/foot -> jij bedoelt total troops in bezit.
    // In jouw app heb je momenteel geen "per player totals" live behalve deployments per player (host leest die niet apart).
    // Simpelste: gebruik p.units (als jij die updatet) OF voeg later per-player totals toe.
    // Voor nu: we nemen p.units uit player doc, want die bestaat.
    const pl = players.find((p) => p.id === pid);
    return {
      cav: Number(pl?.units?.cav ?? 0),
      arch: Number(pl?.units?.arch ?? 0),
      foot: Number(pl?.units?.foot ?? 0),
    };
  }

  function rankPlayers(list: Player[]) {
    const withScores = list.map((p) => {
      const dominance = calcDominancePct(p.id);
      const credits = Number(p.credits ?? 0);
            const tot = playerTroopTotals[p.id] ?? { foot: 0, cav: 0, arch: 0 };
      const u = { cav: tot.cav, arch: tot.arch, foot: tot.foot };


      return {
        ...p,
        dominance,
        credits,
        u,
      };
    });

    withScores.sort((a, b) => {
      // 1) dominance desc
      if (b.dominance !== a.dominance) return b.dominance - a.dominance;
      // 2) credits desc
      if (b.credits !== a.credits) return b.credits - a.credits;
      // 3) cav desc
      if (b.u.cav !== a.u.cav) return b.u.cav - a.u.cav;
      // 4) arch desc
      if (b.u.arch !== a.u.arch) return b.u.arch - a.u.arch;
      // 5) foot desc
      if (b.u.foot !== a.u.foot) return b.u.foot - a.u.foot;
      return 0;
    });

    return withScores;
  }

  const rankedPlayers = rankPlayers(players);
  // ✅ publish ranking to Firestore so player pages can read it
useEffect(() => {
  if (!gameId) return;
  if (!rankedPlayers || rankedPlayers.length === 0) return;

  // build a compact map: playerId -> { rank, dominance, credits, troops }
  const ranking: Record<
    string,
    { rank: number; dominance: number; credits: number; cav: number; arch: number; foot: number }
  > = {};

  rankedPlayers.forEach((p, idx) => {
    ranking[String(p.id)] = {
      rank: idx + 1,
      dominance: Number(p.dominance ?? 0),
      credits: Number(p.credits ?? 0),
      cav: Number(p.u?.cav ?? 0),
      arch: Number(p.u?.arch ?? 0),
      foot: Number(p.u?.foot ?? 0),
    };
  });

  // write into one stable doc
  setDoc(
    doc(db, "games", gameId, "meta", "ranking"),
    {
      ranking,
      totalPlayers: rankedPlayers.length,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  ).catch((err) => console.error("Failed to publish ranking:", err));
}, [gameId, rankedPlayers]);



  // helpers voor basecamp spreiding (grid-based voor nu)
  function tileToXY(tileId: number) {
    const cols = 10;
    const x = tileId % cols;
    const y = Math.floor(tileId / cols);
    return { x, y };
  }

  function dist(a: number, b: number) {
    const A = tileToXY(a);
    const B = tileToXY(b);
    return Math.abs(A.x - B.x) + Math.abs(A.y - B.y);
  }

  function neighborCountGrid(tileId: number) {
    const cols = 10;
    const rows = 6;
    const x = tileId % cols;
    const y = Math.floor(tileId / cols);

    let count = 0;
    if (x > 0) count++;
    if (x < cols - 1) count++;
    if (y > 0) count++;
    if (y < rows - 1) count++;
    return count;
  }

  function pickSpreadTiles(n: number, total: number) {
    if (n <= 0) return [];

    const candidates = Array.from({ length: total }, (_, i) => i).filter(
      (id) => neighborCountGrid(id) >= 4
    );

    if (candidates.length < n) {
      alert("Not enough valid tiles for basecamps with current constraint.");
      return [];
    }

    const picked: number[] = [candidates[0]];

    while (picked.length < n) {
      let best = -1;
      let bestScore = -1;

      for (const c of candidates) {
        if (picked.includes(c)) continue;
        const minD = Math.min(...picked.map((p) => dist(c, p)));
        if (minD > bestScore) {
          bestScore = minD;
          best = c;
        }
      }

      if (best === -1) break;
      picked.push(best);
    }

    return picked;
  }

  const FIXED_BASECAMP_TILES = ["42", "14", "59", "21", "22", "41", "50", "5"];
    function shuffle<T>(arr: T[]) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }


  async function assignBasecamps() {
        if (players.length === 0) {
          alert("No players yet.");
          return;
        }
        if (tiles.length !== 60) {
          alert("Tiles not initialized (need 60 tiles).");
          return;
        }

        if (players.length > FIXED_BASECAMP_TILES.length) {
          alert(`Too many players (${players.length}). Max is ${FIXED_BASECAMP_TILES.length} with the fixed basecamps.`);
          return;
        }

        const anyBasecamp = tiles.some((t) => t.isBasecamp);
        if (anyBasecamp) {
          const ok = confirm("Basecamps already exist. Overwrite them?");
          if (!ok) return;
        }

        // 1) kies random basecamp tiles uit de vaste set (zelfde plekken, random toewijzing)
        const shuffled = shuffle(FIXED_BASECAMP_TILES);
        const pickedTileIds = shuffled.slice(0, players.length);

        const batch = writeBatch(db);

        // 2) reset alle basecamps flags
        for (const t of tiles) {
          const ref = doc(db, "games", gameId, "tiles", t.id);
          batch.update(ref, {
            isBasecamp: false,
            basecampOwnerPlayerId: null,
          });
        }

        // 3) wijs basecamps toe aan spelers (random mapping)
        players.forEach((p, idx) => {
          const tileId = pickedTileIds[idx];
          const ref = doc(db, "games", gameId, "tiles", tileId);
          batch.update(ref, {
            isBasecamp: true,
            basecampOwnerPlayerId: p.id,
            ownerPlayerId: p.id,
          });
        });

        await batch.commit();
        alert("✅ Basecamps assigned (fixed tiles, random players)");
      }

  async function startStartTimer() {
    if (!tiles || tiles.length !== 60) {
      alert("❌ Initialize the 60 tiles first.");
      return;
    }

    if (players.length === 0) {
      alert("❌ No players have joined yet.");
      return;
    }

    // Every player needs a basecamp before the deployment phase can start.
    for (const p of players) {
      const bcId = findBasecampTileIdForPlayer(p.id);
      if (!bcId) {
        alert(`❌ No basecamp assigned for ${p.name ?? p.id}. Assign basecamps first.`);
        return;
      }
    }

    const ref = doc(db, "games", gameId);

    await setDoc(
      ref,
      {
        status: "starting",
        startClaim: {
          active: true,
          endsAt: new Date(Date.now() + 10 * 60 * 1000),
          startedAt: serverTimestamp(),
        },
        startFinalized: false,
      },
      { merge: true }
    );

    autoFinalizeStartedRef.current = false;
    alert("⏱️ 10-minute deployment phase started!");
  }

  async function lockStartNow() {
    const ref = doc(db, "games", gameId);
    await setDoc(ref, { startClaim: { active: false } }, { merge: true });
  }

  const timeLeftSec =
    startEndsAtMs !== null
      ? Math.max(0, Math.ceil((startEndsAtMs - nowMs) / 1000))
      : null;

  const timeLeftDisplay =
    timeLeftSec !== null
      ? `${Math.floor(timeLeftSec / 60)}:${String(timeLeftSec % 60).padStart(2, "0")}`
      : "-";

  async function savePregameSetup() {
    // Every player must have a valid Destructo Truck ranking.
    for (const p of players) {
      const rank = Number(draft[p.id]?.pregameRank);

      if (!rank || rank < 1 || rank > 8) {
        alert(`❌ Choose a Destructo Truck rank for ${p.name}.`);
        return;
      }
    }

    // A ranking position can only be assigned once.
    const ranks = players.map((p) => Number(draft[p.id]?.pregameRank));

    if (new Set(ranks).size !== ranks.length) {
      alert("❌ Every Destructo Truck rank can only be assigned once.");
      return;
    }

    const batch = writeBatch(db);

    players.forEach((p) => {
      const rank = Number(draft[p.id]?.pregameRank);
      const reward = PREGAME_REWARDS[rank];

      if (!reward) return;

      const ref = doc(db, "games", gameId, "players", p.id);
      batch.update(ref, {
        pregameRank: rank,
        credits: reward.credits,
        units: { foot: reward.foot, cav: reward.cav, arch: reward.arch },

        startCredits: reward.credits,
        startUnits: { foot: reward.foot, cav: reward.cav, arch: reward.arch },
      });
    });

    await batch.commit();
    alert("✅ Destructo Truck rankings and pregame rewards saved");
  }

  function findBasecampTileIdForPlayer(playerId: string): string | null {
    const bc = tiles.find(
      (t) => t.isBasecamp && t.basecampOwnerPlayerId === playerId
    );
    return bc ? bc.id : null;
  }

  async function finalizeStartAndFillRemainder() {
    // Prevent double finalization from the timer and the manual button.
    if (autoFinalizeStartedRef.current) return;
    autoFinalizeStartedRef.current = true;

    try {
      // Lock the start phase first so players can no longer change deployments.
      await lockStartNow();

      for (const p of players) {
        const basecampTileId = findBasecampTileIdForPlayer(p.id);

        if (!basecampTileId) {
          console.error(`No basecamp found for ${p.name}`);
          continue;
        }

        // Read the player's original starting units.
        const pRef = doc(db, "games", gameId, "players", p.id);
        const pSnap = await getDoc(pRef);
        const pdata = (pSnap.data() as any) ?? {};
        const su = pdata.startUnits ?? pdata.units ?? { foot: 0, cav: 0, arch: 0 };

        const startUnits = {
          foot: Number(su.foot ?? 0),
          cav: Number(su.cav ?? 0),
          arch: Number(su.arch ?? 0),
        };

        // Read every deployment already made by this player.
        const depCol = collection(db, "games", gameId, "deployments", p.id, "tiles");
        const depSnap = await getDocs(depCol);

        let deployed = { foot: 0, cav: 0, arch: 0 };
        let basecampExisting = { foot: 0, cav: 0, arch: 0 };

        depSnap.docs.forEach((d) => {
          const data = d.data() as any;
          const entry = {
            foot: Number(data.foot ?? 0),
            cav: Number(data.cav ?? 0),
            arch: Number(data.arch ?? 0),
          };

          deployed.foot += entry.foot;
          deployed.cav += entry.cav;
          deployed.arch += entry.arch;

          if (d.id === basecampTileId) {
            basecampExisting = entry;
          }
        });

        // Anything the player did not place goes automatically to the basecamp.
        const remaining = {
          foot: Math.max(0, startUnits.foot - deployed.foot),
          cav: Math.max(0, startUnits.cav - deployed.cav),
          arch: Math.max(0, startUnits.arch - deployed.arch),
        };

        const bcDepRef = doc(
          db,
          "games",
          gameId,
          "deployments",
          p.id,
          "tiles",
          basecampTileId
        );

        await setDoc(
          bcDepRef,
          {
            foot: basecampExisting.foot + remaining.foot,
            cav: basecampExisting.cav + remaining.cav,
            arch: basecampExisting.arch + remaining.arch,
          },
          { merge: true }
        );

        // Lock this player's start setup.
        await setDoc(
          pRef,
          {
            startReady: true,
            startReadyAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      // Only now make the game live.
      await setDoc(
        doc(db, "games", gameId),
        {
          status: "live",
          startFinalized: true,
          startedAt: serverTimestamp(),
          lastFarmerPayoutAt: serverTimestamp(),
          startClaim: {
            active: false,
          },
        },
        { merge: true }
      );

      alert("⚔️ Deployment finished. Horgoth begins!");
    } catch (err: any) {
      console.error("Failed to finalize start:", err);
      autoFinalizeStartedRef.current = false;
      alert(`❌ ${err?.message ?? String(err)}`);
    }
  }

  // Automatically finalize when the 10-minute deployment timer expires.
  useEffect(() => {
    if (!startActive || startEndsAtMs === null) return;
    if (nowMs < startEndsAtMs) return;
    if (autoFinalizeStartedRef.current) return;

    finalizeStartAndFillRemainder().catch((err) => {
      console.error("Automatic start finalization failed:", err);
      autoFinalizeStartedRef.current = false;
    });
    // finalizeStartAndFillRemainder intentionally uses the latest live state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startActive, startEndsAtMs, nowMs]);

  async function commitBatches(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  chunkSize = 450
) {
  for (let i = 0; i < ops.length; i += chunkSize) {
    const batch = writeBatch(db);
    const chunk = ops.slice(i, i + chunkSize);
    chunk.forEach((fn) => fn(batch));
    await batch.commit();
  }
}

async function bamboozleDestroyMage(victimPlayerId: string) {
  if (!victimPlayerId) return;

  //const ok = confirm(`Destroy Mage of ${nameFor(victimPlayerId)}?`);
  // if (!ok) return;

  const mageRef = doc(db, "games", gameId, "mages", victimPlayerId);
  const victimPlayerRef = doc(db, "games", gameId, "players", victimPlayerId);
  const logRef = doc(collection(db, "games", gameId, "battleLog"));

  const batch = writeBatch(db);

  // mage verwijderen
  batch.delete(mageRef);

  // ✅ belangrijk: speler terug "geen mage" geven zodat hij opnieuw kan kopen/gratis krijgen
  batch.update(victimPlayerRef, { hasMage: false });

  // (optioneel) log zodat iedereen het ziet
  batch.set(
    logRef,
    {
      createdAt: serverTimestamp(),
      type: "BAMBOOZLE_DESTROY_MAGE",
      playerId: victimPlayerId,
    },
    { merge: true }
  );

  await batch.commit();

 // alert(`🧙‍♂️ Mage destroyed for ${nameFor(victimPlayerId)}.`);
}


async function bamboozleDestroyTroops() {
  const victimId = bbVictimPlayerId;
  const tileId = bbVictimTileId;

  const kill = {
    foot: Math.max(0, Math.floor(Number(bbKillFoot) || 0)),
    cav: Math.max(0, Math.floor(Number(bbKillCav) || 0)),
    arch: Math.max(0, Math.floor(Number(bbKillArch) || 0)),
  };

  if (!victimId) {
    alert("Choose a victim player.");
    return;
  }
  if (!tileId) {
    alert("Choose a tile.");
    return;
  }
  if (kill.foot + kill.cav + kill.arch <= 0) {
    alert("Enter at least 1 troop to destroy.");
    return;
  }

  const ok = confirm(
    `Destroy troops on tile #${tileId} of ${nameFor(victimId)}?\n\n` +
      `Foot: ${kill.foot}\nCav: ${kill.cav}\nArch: ${kill.arch}`
  );
  if (!ok) return;

  const depRef = doc(db, "games", gameId, "deployments", victimId, "tiles", tileId);
  const tileRef = doc(db, "games", gameId, "tiles", tileId);
  const mageRef = doc(db, "games", gameId, "mages", victimId);
  const logRef = doc(collection(db, "games", gameId, "battleLog"));

  try {
    await runTransaction(db, async (tx) => {
  // ===== READS FIRST =====

  // 1) deployment
  const depSnap = await tx.get(depRef);
  const dep = (depSnap.exists() ? (depSnap.data() as any) : {}) as any;

  const cur = {
    foot: Number(dep.foot ?? 0),
    cav: Number(dep.cav ?? 0),
    arch: Number(dep.arch ?? 0),
  };

  const next = {
    foot: Math.max(0, cur.foot - kill.foot),
    cav: Math.max(0, cur.cav - kill.cav),
    arch: Math.max(0, cur.arch - kill.arch),
  };

  const nextTotal = next.foot + next.cav + next.arch;

  // 2) alleen als leeg -> lees tile + mage (maar nog altijd VOOR writes!)
  let tdata: any = null;
  let md: any = null;

  if (nextTotal <= 0) {
    const tileSnap = await tx.get(tileRef);
    tdata = tileSnap.exists() ? (tileSnap.data() as any) : null;

    const mageSnap = await tx.get(mageRef);
    md = mageSnap.exists() ? (mageSnap.data() as any) : null;
  }

  // ===== WRITES =====

  // update deployment
  tx.set(depRef, next, { merge: true });

  // als alles 0 => tile neutral + mage weg indien mage op die tile stond
  if (nextTotal <= 0) {
    if (tdata && (tdata.ownerPlayerId ?? null) === victimId) {
      tx.update(tileRef, { ownerPlayerId: null });
    }

    if (md && String(md.tileId ?? "") === String(tileId)) {
      tx.delete(mageRef);
    }
  }

  // log
  tx.set(
    logRef,
    {
      createdAt: serverTimestamp(),
      type: "BAMBOOZLE_DESTROY_TROOPS",
      victimId,
      tileId,
      kill,
      before: cur,
      after: next,
    },
    { merge: true }
  );
});


    // reset inputs
    setBbKillFoot(0);
    setBbKillCav(0);
    setBbKillArch(0);

    alert(`🎴 Troops destroyed on tile #${tileId} (${nameFor(victimId)}).`);
  } catch (err: any) {
    console.error(err);
    alert(`❌ ${err?.message ?? String(err)}`);
  }
}

async function bamboozleTakeOverEnemyTile() {
  if (!bbActorId) {
    alert("Choose who plays the bamboozle (actor).");
    return;
  }
  if (!bbTargetTileId) {
    alert("Choose a target tile.");
    return;
  }

  const tileId = String(bbTargetTileId);
  const tileRef = doc(db, "games", gameId, "tiles", tileId);

  try {
    await runTransaction(db, async (tx) => {
      // ===== READS FIRST =====
      const tileSnap = await tx.get(tileRef);
      if (!tileSnap.exists()) throw new Error("Tile not found");

      const tdata = tileSnap.data() as any;
      const curOwner: string | null = tdata.ownerPlayerId ?? null;
      const isBasecamp = !!tdata.isBasecamp;

      if (!curOwner) throw new Error("Tile is neutral (must be owned).");
      if (curOwner === bbActorId) throw new Error("You already own this tile.");
      if (isBasecamp) throw new Error("Cannot target a basecamp.");

      // defender deployment ref (enemy troops to wipe)
      const defDepRef = doc(db, "games", gameId, "deployments", curOwner, "tiles", tileId);
      const defDepSnap = await tx.get(defDepRef);
      const defDep = (defDepSnap.exists() ? (defDepSnap.data() as any) : {}) as any;

      const beforeDef = {
        foot: Number(defDep.foot ?? 0),
        cav: Number(defDep.cav ?? 0),
        arch: Number(defDep.arch ?? 0),
      };

      // defender mage check
      const defMageRef = doc(db, "games", gameId, "mages", curOwner);
      const defMageSnap = await tx.get(defMageRef);
      const defMage = defMageSnap.exists() ? (defMageSnap.data() as any) : null;
      const mageWasOnTile = !!defMage && String(defMage.tileId ?? "") === String(tileId);

      // attacker deployment ref (place +1 new cav)
      const attDepRef = doc(db, "games", gameId, "deployments", bbActorId, "tiles", tileId);
      const attDepSnap = await tx.get(attDepRef);
      const attDep = (attDepSnap.exists() ? (attDepSnap.data() as any) : {}) as any;

      const beforeAtt = {
        foot: Number(attDep.foot ?? 0),
        cav: Number(attDep.cav ?? 0),
        arch: Number(attDep.arch ?? 0),
      };

      // log ref
      const logRef = doc(collection(db, "games", gameId, "battleLog"));

      // ===== WRITES =====

      // 1) tile ownership -> actor
      tx.update(tileRef, { ownerPlayerId: bbActorId });

      // 2) wipe defender troops on that tile
      tx.set(defDepRef, { foot: 0, cav: 0, arch: 0 }, { merge: true });

      // 3) delete defender mage if it was on that tile
      if (mageWasOnTile) {
        tx.delete(defMageRef);
      }

      // 4) add +1 cav to actor on that tile (free cav, not from stock)
      tx.set(
        attDepRef,
        {
          foot: beforeAtt.foot,
          cav: beforeAtt.cav + 1,
          arch: beforeAtt.arch,
        },
        { merge: true }
      );

      // 5) log event
      tx.set(
        logRef,
        {
          createdAt: serverTimestamp(),
          type: "BAMBOOZLE_TAKEOVER_TILE",
          actorId: bbActorId,
          tileId,
          oldOwnerId: curOwner,
          defenderBefore: beforeDef,
          attackerBefore: beforeAtt,
          attackerAfter: { ...beforeAtt, cav: beforeAtt.cav + 1 },
          defenderMageDestroyed: mageWasOnTile,
        },
        { merge: true }
      );
    });

    alert(`🎴 Tile #${bbTargetTileId} taken over: +1 cav placed.`);
    setBbTargetTileId("");
  } catch (err: any) {
    console.error(err);
    alert(`❌ ${err?.message ?? String(err)}`);
  }
}


async function resetGame() {
  const ok = confirm(
    "RESET GAME?\n\nDit wist:\n- battleLog\n- deployments (alle troops)\n- tile ownership (behalve basecamps)\n\nDoorgaan?"
  );
  if (!ok) return;

  // extra confirm
  const ok2 = confirm("Laatste bevestiging: echt resetten?");
  if (!ok2) return;

  // 1) load data we need
  const tilesSnap = await getDocs(collection(db, "games", gameId, "tiles"));
  const playersSnap = await getDocs(collection(db, "games", gameId, "players"));
  const battleSnap = await getDocs(collection(db, "games", gameId, "battleLog"));
  const bankSnap = await getDocs(collection(db, "games", gameId, "bankLog"));


  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  // 2) clear battle log
  battleSnap.docs.forEach((d) => {
    ops.push((batch) => batch.delete(d.ref));
  });

  // 2b) clear bank log
bankSnap.docs.forEach((d) => {
  ops.push((batch) => batch.delete(d.ref));
});


  // 3) reset tiles ownership (keep basecamps owned by their basecamp owner)
  tilesSnap.docs.forEach((d) => {
    const t = d.data() as any;
    const isBasecamp = !!t.isBasecamp;
    const basecampOwner = t.basecampOwnerPlayerId ?? null;

    const nextOwner = isBasecamp ? basecampOwner : null;

    ops.push((batch) =>
      batch.update(d.ref, {
        ownerPlayerId: nextOwner,
        farmers: deleteField(),
      })
    );
  });

  // 4) clear deployments subcollections for every player
  // deployments/{playerId}/tiles/* delete
  for (const p of playersSnap.docs) {
    const pid = p.id;
    const depSnap = await getDocs(collection(db, "games", gameId, "deployments", pid, "tiles"));
    depSnap.docs.forEach((dd) => {
      ops.push((batch) => batch.delete(dd.ref));
    });

    // 5) unlock player start status (optional but handy for re-testing)
    ops.push((batch) =>
      batch.update(p.ref, {
        startReady: false,
        startReadyAt: deleteField(),
      })
    );
  }

  // 6) reset game startClaim to inactive (optional)
  // (setDoc outside batch is fine; or add to ops via batch.set on doc ref)
  const gameRef = doc(db, "games", gameId);
  ops.push((batch) =>
    batch.set(
      gameRef,
      {
        status: "lobby",
        startFinalized: false,
        startClaim: { active: false },
        startedAt: deleteField(),
        lastFarmerPayoutAt: deleteField(),
      },
      { merge: true }
    )
  );

  // 7) commit in safe chunks
  await commitBatches(ops, 450);

  alert("✅ Game reset done (battleLog cleared, deployments cleared, tiles reset).");
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
    headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  } as const,

  pill: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(243,231,207,0.18)",
    background: "rgba(243,231,207,0.06)",
    whiteSpace: "nowrap",
  } as const,

  title: {
    fontFamily: "var(--font-cinzel), serif",
    letterSpacing: 2,
    fontSize: 26,
    margin: 0,
    lineHeight: 1,
  } as const,
  subTitle: {
    marginTop: 6,
    fontSize: 12,
    letterSpacing: 0.6,
    opacity: 0.8,
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
    buttonGhost: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px dashed rgba(243,231,207,0.22)",
    background: "transparent",
    color: "#f3e7cf",
    cursor: "pointer",
  } as const,

  helpText: {
    marginTop: 10,
    fontSize: 12,
    opacity: 0.8,
    lineHeight: 1.35,
  } as const,

  label: {
    display: "grid",
    gap: 6,
    fontSize: 12,
    opacity: 0.9,
  } as const,

  select: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(243,231,207,0.22)",
    background: "rgba(0,0,0,0.25)",
    color: "#f3e7cf",
    outline: "none",
  } as const,

  selectFull: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(243,231,207,0.22)",
    background: "rgba(0,0,0,0.25)",
    color: "#f3e7cf",
    outline: "none",
    width: "100%",
  } as const,

  miniLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    opacity: 0.9,
  } as const,

  miniInput: {
    width: 74,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(243,231,207,0.22)",
    background: "rgba(0,0,0,0.25)",
    color: "#f3e7cf",
    outline: "none",
  } as const,

  smallLabel: {
    display: "grid",
    gap: 6,
    fontSize: 12,
    opacity: 0.9,
  } as const,

  smallInput: {
    width: 120,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(243,231,207,0.22)",
    background: "rgba(0,0,0,0.25)",
    color: "#f3e7cf",
    outline: "none",
  } as const,

  playerCard: {
    borderRadius: 12,
    border: "1px solid rgba(243,231,207,0.14)",
    background: "rgba(0,0,0,0.18)",
    padding: 12,
  } as const,

  subBox: {
    borderRadius: 12,
    border: "1px solid rgba(243,231,207,0.14)",
    background: "rgba(0,0,0,0.14)",
    padding: 12,
  } as const,

  subBoxTitle: {
    fontFamily: "var(--font-cinzel), serif",
    letterSpacing: 0.8,
    fontSize: 13,
    marginBottom: 10,
    opacity: 0.95,
  } as const,

  legendPill: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 999,
    border: "1px solid rgba(243,231,207,0.16)",
    background: "rgba(0,0,0,0.18)",
  } as const,

  legendSwatch: {
    width: 14,
    height: 14,
    borderRadius: 999,
    border: "1px solid rgba(0,0,0,0.35)",
    display: "inline-block",
  } as const,

  thLeft: {
    textAlign: "left",
    fontSize: 12,
    opacity: 0.8,
    padding: "8px 6px",
    borderBottom: "1px solid rgba(243,231,207,0.14)",
    whiteSpace: "nowrap",
  } as const,

  thRight: {
    textAlign: "right",
    fontSize: 12,
    opacity: 0.8,
    padding: "8px 6px",
    borderBottom: "1px solid rgba(243,231,207,0.14)",
    whiteSpace: "nowrap",
  } as const,

  tdLeft: {
    textAlign: "left",
    padding: "8px 6px",
    borderBottom: "1px solid rgba(243,231,207,0.10)",
    whiteSpace: "nowrap",
  } as const,

  tdRight: {
    textAlign: "right",
    padding: "8px 6px",
    borderBottom: "1px solid rgba(243,231,207,0.10)",
    whiteSpace: "nowrap",
  } as const,

};

// UI block
return (
  <main style={ui.page}>
    {/* ===== Header ===== */}
    <div style={ui.header}>
      <div>
        <h1 style={ui.title}>HORGOTH — Host</h1>
        <div style={ui.subTitle}>Game ID: {gameId}</div>
      </div>

      <div style={ui.headerRight}>
        <button
          onClick={enableHostAudio}
          disabled={hostAudioEnabled}
          style={hostAudioEnabled ? ui.buttonGhost : ui.button}
          title="Enable central game audio on this Host device"
        >
          {hostAudioEnabled ? "🔊 Game audio ON" : "🔇 Enable game audio"}
        </button>
        <div style={ui.pill}>
          Start phase: <strong>{startActive ? "ACTIVE" : "INACTIVE"}</strong>
        </div>
        <div style={ui.pill}>
          Time left: <strong>{timeLeftDisplay}</strong>
        </div>
      </div>
    </div>

    {/* ===== Main grid ===== */}
    <div style={ui.grid}>
      {/* ================= LEFT: Map + Legend + Bamboozle ================= */}
      <div style={{ display: "grid", gap: 14 }}>
        {/* Winter barometer ABOVE map */}
        <div style={ui.card}>
          <div style={ui.cardTitle}>❄️ Winter is Coming</div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              Level: <strong>{winterLevel}</strong> / 10
            </div>

            <div style={{ flex: "1 1 280px" }}>
              <div
                style={{
                  height: 14,
                  borderRadius: 999,
                  border: "1px solid rgba(243,231,207,0.22)",
                  overflow: "hidden",
                  background: "rgba(243,231,207,0.08)",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(winterLevel / 10) * 100}%`,
                    background: "rgba(243,231,207,0.75)",
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setWinterLevelInGame(winterLevel + 1)} style={ui.button}>
              +1
            </button>
            <button onClick={() => setWinterLevelInGame(winterLevel - 1)} style={ui.button}>
              −1
            </button>
            <button onClick={() => setWinterLevelInGame(0)} style={ui.buttonGhost}>
              Reset to 0
            </button>

            <button
              onClick={triggerFrostGiantsAttack}
              disabled={winterLevel < 10}
              style={{
                ...ui.button,
                opacity: winterLevel < 10 ? 0.6 : 1,
                cursor: winterLevel < 10 ? "not-allowed" : "pointer",
              }}
              title={winterLevel < 10 ? "Winter level must be 10 to trigger" : "Trigger attack"}
            >
              ❄️ Trigger Frost Giants Attack (needs 10)
            </button>
          </div>

          <div style={ui.helpText}>
            Attack targets 15 random <strong>non-basecamp</strong> tiles. Dragonglass blocks the attack but is
            consumed. Without dragonglass: troops lose <strong>50% (rounded up loss)</strong> per type.
          </div>
        </div>

        {/* Map */}
        <div style={ui.card}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={ui.cardTitle}>🗺️ World Map</div>

            {/* Zoom controls */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={() => zoomBy(-0.1)} style={ui.buttonGhost}>
                −
              </button>
              <div style={{ ...ui.pill, padding: "6px 10px" }}>
                Zoom: <strong>{Math.round(mapZoom * 100)}%</strong>
              </div>
              <button type="button" onClick={() => zoomBy(+0.1)} style={ui.buttonGhost}>
                +
              </button>
              <button type="button" onClick={resetView} style={ui.buttonGhost}>
                Reset
              </button>
            </div>
          </div>

          {/* Viewport: ONLY the map zooms, not the rest */}
          <div
            onWheel={onWheelZoom}
            onMouseDown={onPanStart}
            onMouseMove={onPanMove}
            onMouseUp={onPanEnd}
            onMouseLeave={onPanEnd}
            style={{
              marginTop: 10,
              borderRadius: 12,
              border: "1px solid rgba(243,231,207,0.12)",
              overflow: "hidden",
              background: "rgba(0,0,0,0.15)",
              height: 640,
              position: "relative",
              touchAction: "none",
              cursor: isPanningRef.current ? "grabbing" : "grab",
              userSelect: "none",
            }}
          >
            <div
              style={{
                transform: `translate(${mapPan.x}px, ${mapPan.y}px) scale(${mapZoom})`,
                transformOrigin: "50% 50%",
                width: "100%",
                height: "100%",
              }}
            >
              <MapSvg
                tiles={tiles}
                tileTroops={tileTroops}
                colorForPlayer={colorForPlayer}
                mageByTile={mageByTile}
                selectedTileId={selectedTileId}
                tieFighterPlayers={players}
                onSelectTile={(id) => setSelectedTileId(id)}
              />
            </div>
          </div>
        </div>

        {/* Legend (under map) */}
        <div style={ui.card}>
          <div style={ui.cardTitle}>Legend</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {players.map((p) => {
              const bg = colorForPlayer(p.id);
              return (
                <div key={p.id} style={ui.legendPill}>
                  <span style={{ ...ui.legendSwatch, background: bg }} />
                  <span style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Avatar value={p.avatar} size={18} />
                    <span>{p.name}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ===== Bamboozle cards moved under Legend (LEFT column) ===== */}

        {/* Bamboozle — Destroy Troops */}
        <div style={ui.card}>
          <div style={ui.cardTitle}>🎴 Bamboozle — Destroy Troops</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select value={bbVictimPlayerId} onChange={(e) => setBbVictimPlayerId(e.target.value)} style={ui.select}>
              <option value="">— choose player —</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {labelForPlayer(p)}
                </option>
              ))}
            </select>

            <select
              value={bbVictimTileId}
              onChange={(e) => setBbVictimTileId(e.target.value)}
              disabled={!bbVictimPlayerId}
              style={{ ...ui.select, opacity: !bbVictimPlayerId ? 0.6 : 1 }}
            >
              <option value="">— choose tile (with troops) —</option>
              {bbVictimTilesWithTroops.map((t) => (
                <option key={t.tileId} value={t.tileId}>
                  #{t.tileId} (🗡️{t.foot} 🐎{t.cav} 🏹{t.arch})
                </option>
              ))}
            </select>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={ui.miniLabel}>
                🗡️
                <input
                  type="number"
                  min={0}
                  value={bbKillFoot}
                  onChange={(e) => setBbKillFoot(Math.max(0, Number(e.target.value)))}
                  style={ui.miniInput}
                />
              </label>

              <label style={ui.miniLabel}>
                🐎
                <input
                  type="number"
                  min={0}
                  value={bbKillCav}
                  onChange={(e) => setBbKillCav(Math.max(0, Number(e.target.value)))}
                  style={ui.miniInput}
                />
              </label>

              <label style={ui.miniLabel}>
                🏹
                <input
                  type="number"
                  min={0}
                  value={bbKillArch}
                  onChange={(e) => setBbKillArch(Math.max(0, Number(e.target.value)))}
                  style={ui.miniInput}
                />
              </label>
            </div>

            <button
              onClick={bamboozleDestroyTroops}
              disabled={!bbVictimPlayerId || !bbVictimTileId}
              style={{
                ...ui.button,
                opacity: !bbVictimPlayerId || !bbVictimTileId ? 0.6 : 1,
                cursor: !bbVictimPlayerId || !bbVictimTileId ? "not-allowed" : "pointer",
              }}
            >
              🎴 Destroy troops
            </button>
          </div>

          <div style={ui.helpText}>
            If the tile ends up with <strong>0 troops</strong>, it becomes <strong>neutral</strong>. If the victim’s
            Mage was on that tile, it is destroyed as well.
          </div>
        </div>

        {/* Bamboozle — Take over enemy tile */}
        <div style={ui.card}>
          <div style={ui.cardTitle}>🎴 Bamboozle — Take over enemy tile</div>

          <div style={{ display: "grid", gap: 10 }}>
            <label style={ui.label}>
              Actor (who plays the card)
              <select
                value={bbActorId}
                onChange={(e) => {
                  setBbActorId(e.target.value);
                  setBbTargetTileId("");
                }}
                style={ui.selectFull}
              >
                <option value="">— choose player —</option>
                {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {labelForPlayer(p)}
                </option>
                  ))}
              </select>
            </label>

            <label style={ui.label}>
              Target tile (owned by someone else, non-basecamp)
              <select
                value={bbTargetTileId}
                onChange={(e) => setBbTargetTileId(e.target.value)}
                disabled={!bbActorId}
                style={{ ...ui.selectFull, opacity: !bbActorId ? 0.6 : 1 }}
              >
                <option value="">— choose tile —</option>
                {occupiedEnemyTiles(bbActorId).map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.id} — owner: {nameFor(t.ownerPlayerId)}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={bamboozleTakeOverEnemyTile}
              disabled={!bbActorId || !bbTargetTileId}
              style={{
                ...ui.button,
                opacity: !bbActorId || !bbTargetTileId ? 0.6 : 1,
                cursor: !bbActorId || !bbTargetTileId ? "not-allowed" : "pointer",
                width: "fit-content",
              }}
            >
              🎴 Execute takeover (+1 🐎 cav)
            </button>

            <div style={ui.helpText}>
              This destroys all troops on the target tile, destroys the defender mage if it was on that tile, sets the
              tile owner to the actor, and places <strong>+1 free cavalry</strong> for the actor.
            </div>
          </div>
        </div>

        {/* Combined card: Destroy Mage OR Dragonglass (independent) */}
        <div style={ui.card}>
          <div style={ui.cardTitle}>🎴 Bamboozle — Destroy Mage or Dragonglass</div>

          <div style={{ display: "grid", gap: 12 }}>
            {/* Destroy Mage */}
            <div style={ui.subBox}>
              <div style={ui.subBoxTitle}>🧙 Destroy Mage</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <select
                  value={selectedMageVictim}
                  onChange={(e) => setSelectedMageVictim(e.target.value)}
                  style={ui.selectFull}
                >
                  <option value="">— choose player with Mage —</option>
                  {mageTargets.map((pid) => {
                    const p = players.find((x) => x.id === pid);
                    const tileId = magesByPlayer[pid]?.tileId;
                    return (
                      <option key={pid} value={pid}>
                     🧙✅ {p ? labelForPlayer(p) : pid} (tile #{tileId})
                        </option>
                    );
                  })}
                </select>

                <button
                  onClick={() => bamboozleDestroyMage(selectedMageVictim)}
                  disabled={!selectedMageVictim}
                  style={{
                    ...ui.button,
                    opacity: !selectedMageVictim ? 0.6 : 1,
                    cursor: !selectedMageVictim ? "not-allowed" : "pointer",
                  }}
                >
                  🎴 Destroy Mage
                </button>
              </div>

              <div style={ui.helpText}>Only players who currently own a Mage appear in the list.</div>
            </div>

            {/* Destroy Dragonglass */}
            <div style={ui.subBox}>
              <div style={ui.subBoxTitle}>🔷 Destroy Dragonglass</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <select value={dgTargetPlayerId} onChange={(e) => setDgTargetPlayerId(e.target.value)} style={ui.selectFull}>
                  <option value="">— choose player —</option>
                  {players
                    .filter((p) => !!(p as any).hasDragonglass)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        🔷✅ {labelForPlayer(p)}
                      </option>
                    ))}
                </select>

                <button
                  onClick={bamboozleDestroyDragonglass}
                  disabled={!dgTargetPlayerId}
                  style={{
                    ...ui.button,
                    opacity: !dgTargetPlayerId ? 0.6 : 1,
                    cursor: !dgTargetPlayerId ? "not-allowed" : "pointer",
                  }}
                >
                  🎴 Destroy Dragonglass
                </button>
              </div>

              <div style={ui.helpText}>Host chooses a player. Their Dragonglass is removed immediately.</div>
            </div>
          </div>
        </div>
      </div>

      {/* ================= RIGHT: Bank + Tile log + Ranking ================= */}
<div style={{ display: "grid", gap: 14 }}>
  {/* Bank log */}
  <div style={ui.card}>
    <div style={ui.cardTitle}>🏦 Bank transactions (last 20)</div>

    {bankLog.length === 0 ? (
      <div style={{ opacity: 0.75 }}>No bank transactions yet.</div>
    ) : (
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        {bankLog.map((e) => {
          const who = nameFor(e.playerId);
          const type = String((e as any).type ?? "");

          if (type === "EXP_SALE") {
            const unitType = String((e as any).unitType ?? "");
            const icon = unitType === "foot" ? "🗡️" : unitType === "cav" ? "🐎" : unitType === "arch" ? "🏹" : "⭐";
            const price = Number((e as any).price ?? 10000);
            const expFrom = Number((e as any).expFrom ?? 0);
            const expTo = Number((e as any).expTo ?? Math.max(0, expFrom - 1));
            return (
              <li key={(e as any).id} style={{ marginBottom: 6 }}>
                <strong>{who}</strong> sold 1 EXP {icon} ({expFrom} → {expTo}) for +{price} credits
              </li>
            );
          }

          if (type === "DESERTER") {
            const unitType = String((e as any).unitType ?? "");
            const icon = unitType === "foot" ? "🗡️" : unitType === "cav" ? "🐎" : unitType === "arch" ? "🏹" : "⚔️";
            const tileId = String((e as any).tileId ?? "?");
            const refund = Number((e as any).refund ?? 0);
            return (
              <li key={(e as any).id} style={{ marginBottom: 6 }}>
                <strong>{who}</strong>: 🏃 {icon} deserter left tile #{tileId} (+{refund} credits)
              </li>
            );
          }

          // EXP ADJUST: toon exp i.p.v. credits
          if (type === "EXP_ADJUST") {
            const unitType = String((e as any).unitType ?? "");
            const icon =
              unitType === "foot"
                ? "🗡️"
                : unitType === "cav"
                ? "🐎"
                : unitType === "arch"
                ? "🏹"
                : "⭐";

            const delta = Number((e as any).delta ?? 0);
            const from = Number((e as any).from ?? 0);
            const to = Number((e as any).to ?? 0);

            return (
              <li key={(e as any).id} style={{ marginBottom: 6 }}>
                <strong>{who}</strong>: EXP {icon} {delta > 0 ? "+" : ""}
                {delta} ({from} → {to})
              </li>
            );
          }
                    // ✅ Dragonglass / Mage logs
          if (type === "FARMER_PURCHASE") {
            const cost = Number((e as any).cost ?? 0);
            const qty = Number((e as any).quantity ?? 0);
            const tileId = String((e as any).tileId ?? "");
            return (
              <li key={(e as any).id} style={{ marginBottom: 6 }}>
                <strong>{who}</strong> bought 🌾 {qty} farmer{qty === 1 ? "" : "s"} on tile #{tileId} (-{cost} credits)
              </li>
            );
          }

          if (type === "FARMER_INCOME") {
            const farmers = Number((e as any).farmers ?? 0);
            const mins = Number((e as any).elapsedMinutes ?? 1);
            const delta = Number((e as any).delta ?? 0);
            const from = Number((e as any).from ?? 0);
            const to = Number((e as any).to ?? from + delta);

            return (
              <li key={(e as any).id} style={{ marginBottom: 6 }}>
                <strong>{who}</strong> 🌾 farmer income: +{delta} credits
                {" "}({farmers} farmer{farmers === 1 ? "" : "s"}
                {mins > 1 ? ` × ${mins} min` : ""}; {from} → {to})
              </li>
            );
          }

          if (type === "DRAGONGLASS_PURCHASE") {
            const cost = Number((e as any).cost ?? 0);
            return (
              <li key={(e as any).id} style={{ marginBottom: 6 }}>
                <strong>{who}</strong> bought 🔷 Dragonglass (-{cost} credits)
              </li>
            );
          }

          if (type === "DRAGONGLASS_FREE") {
            return (
              <li key={(e as any).id} style={{ marginBottom: 6 }}>
                <strong>{who}</strong> received 🔷 Dragonglass for FREE (🎴 Bamboozle)
              </li>
            );
          }

          if (type === "MAGE_PURCHASE") {
            const cost = Number((e as any).cost ?? 0);
            const tileId = String((e as any).tileId ?? "");
            return (
              <li key={(e as any).id} style={{ marginBottom: 6 }}>
                <strong>{who}</strong> bought 🧙 Mage on tile #{tileId} (-{cost} credits)
              </li>
            );
          }

          if (type === "MAGE_FREE") {
            const tileId = String((e as any).tileId ?? "");
            return (
              <li key={(e as any).id} style={{ marginBottom: 6 }}>
                <strong>{who}</strong> received 🧙 Mage for FREE on tile #{tileId} (🎴 Bamboozle)
              </li>
            );
          }

          if (type === "DART_FREE_ARCHER") {
              const tileId = String((e as any).tileId ?? "");
              const n = Number((e as any).deltaArch ?? 1);
              return (
                <li key={(e as any).id} style={{ marginBottom: 6 }}>
                  <strong>{who}</strong> received 🎯 +{n} archer on tile #{tileId} (Dart reward)
                </li>
              );
            }

            if (type === "BEERCULES") {
              const reward = String((e as any).reward ?? "");

              // reward: CREDITS
              if (reward === "CREDITS") {
                const n = Number((e as any).deltaCredits ?? 5000);
                const beerFrom = Number((e as any).beerFrom ?? 0);
                const beerTo = Number((e as any).beerTo ?? beerFrom + 1);

                return (
                  <li key={(e as any).id} style={{ marginBottom: 6 }}>
                    <strong>{who}</strong> 🍺 Beercules {beerFrom} → {beerTo}: +{n} credits
                  </li>
                );
              }

              // reward: EXP
              if (reward === "EXP") {
                const expType = String((e as any).expType ?? "");
                const icon = expType === "foot" ? "🗡️" : expType === "cav" ? "🐎" : expType === "arch" ? "🏹" : "⭐";
                const from = Number((e as any).expFrom ?? 0);
                const to = Number((e as any).expTo ?? from + 1);

                const beerFrom = Number((e as any).beerFrom ?? 0);
                const beerTo = Number((e as any).beerTo ?? beerFrom + 1);

                return (
                  <li key={(e as any).id} style={{ marginBottom: 6 }}>
                    <strong>{who}</strong> 🍺 Beercules {beerFrom} → {beerTo}: +1 EXP {icon} ({from} → {to})
                  </li>
                );
              }

              // reward: BAMBOOZLE (physical)
              const beerFrom = Number((e as any).beerFrom ?? 0);
              const beerTo = Number((e as any).beerTo ?? beerFrom + 1);

              return (
                <li key={(e as any).id} style={{ marginBottom: 6 }}>
                  <strong>{who}</strong> 🍺 Beercules {beerFrom} → {beerTo}: 🎴 Draw 1 Bamboozle card (physical)
                </li>
              );
            }


          const delta = Number(e.delta ?? 0);
          const from = Number(e.from ?? 0);
          const to = Number(e.to ?? 0);
          const sign = delta > 0 ? "+" : "";
          const action = delta > 0 ? "added" : "removed";

          return (
            <li key={e.id} style={{ marginBottom: 6 }}>
              <strong>{who}</strong> {action} {sign}
              {delta} credits ({from} → {to})
            </li>
          );
        })}
      </ol>
    )}
  </div>

  {/* Tile log */}
  <div style={ui.card}>
    <div style={ui.cardTitle}>📜 Last 10 tile changes</div>

    {battleLog.length === 0 ? (
      <div style={{ opacity: 0.75 }}>No events yet.</div>
    ) : (
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        {battleLog.map((e) => {
          let text = "";

          if (e.type === "CONQUER") {
            text = `Tile #${e.tileId}: ${nameFor(e.newOwnerId)} conquered neutral land`;
          } else if (e.type === "RELEASE") {
            text = `Tile #${e.tileId}: ${nameFor(e.oldOwnerId)} left it empty → neutral`;
          } else if (e.type === "ATTACKER_WIN") {
            const ap = Number(e.attackerPower ?? 0);
            const dp = Number(e.defenderPower ?? 0);
            const df = Number(e.diff ?? ap - dp);
            text = `Tile #${e.tileId}: ${nameFor(e.attackerId)} conquered from ${nameFor(
              e.defenderId
            )} (score ${ap.toFixed(2)} vs ${dp.toFixed(2)}, diff ${df.toFixed(2)})`;
          } else if (e.type === "DEFENDER_HOLD") {
            const ap = Number(e.attackerPower ?? 0);
            const dp = Number(e.defenderPower ?? 0);
            const df = Number(e.diff ?? ap - dp);
            text = `Tile #${e.tileId}: ${nameFor(e.defenderId)} held vs ${nameFor(
              e.attackerId
            )} (score ${ap.toFixed(2)} vs ${dp.toFixed(2)}, diff ${df.toFixed(2)})`;
          } else if (e.type === "DRAW") {
            const ap = Number(e.attackerPower ?? 0);
            const dp = Number(e.defenderPower ?? 0);
            const df = Number(e.diff ?? ap - dp);
            text = `Tile #${e.tileId}: draw (${nameFor(e.attackerId)} vs ${nameFor(
              e.defenderId
            )}) (score ${ap.toFixed(2)} vs ${dp.toFixed(2)}, diff ${df.toFixed(2)}) → neutral`;
          } else if (e.type === "BAMBOOZLE_DESTROY_TROOPS") {
            const k = e.kill ?? {};
            text = `🎴 Troops destroyed on tile #${e.tileId} of ${nameFor(e.victimId)} (🗡️${k.foot ?? 0} 🐎${
              k.cav ?? 0
            } 🏹${k.arch ?? 0})`;
          } else if (e.type === "BAMBOOZLE_TAKEOVER_TILE") {
            const tileId = String(e.tileId ?? "");
            const actor = nameFor(e.actorId);
            const oldOwner = nameFor(e.oldOwnerId);
            const mageKilled = !!e.defenderMageDestroyed;
            text = `🎴 Tile #${tileId}: ${actor} took over from ${oldOwner} (+1 🐎 cav, enemy troops wiped${
              mageKilled ? ", mage destroyed" : ""
            })`;
            } else if (e.type === "BAMBOOZLE_DESTROY_MAGE") {
                const victim = nameFor((e as any).playerId);
                const tileId = (e as any).tileId ? String((e as any).tileId) : "";
                text = tileId
                  ? `🎴 Mage destroyed for ${victim} on tile #${tileId}`
                  : `🎴 Mage destroyed for ${victim}`;
              } else if (e.type === "BAMBOOZLE_DG_DESTROY") {
                const victim = nameFor((e as any).playerId);
                text = `🎴 Dragonglass destroyed for ${victim}`;
          } else if (e.type === "FROST_GIANTS_ATTACK") {
            const ids = Array.isArray((e as any).attackedTileIds) ? (e as any).attackedTileIds : [];
            const results = Array.isArray((e as any).results) ? (e as any).results : [];

            const dgUsed = results.filter((r: any) => r?.dragonglassConsumed).length;
            const hitOwned = results.filter((r: any) => r?.ownerId).length;

            text =
              `❄️ Frost Giants attacked ${ids.length || hitOwned} tiles` +
              (dgUsed ? ` — 🧪 Dragonglass used: ${dgUsed}` : "") +
              (ids.length ? `: ${ids.map((id: any) => `#${id}`).join(", ")}` : "");
          } else {
            text = `Event on tile #${(e as any).tileId ?? "?"}`;
          }

          return (
            <li key={e.id} style={{ marginBottom: 6 }}>
              {text}
            </li>
          );
        })}
      </ol>
    )}
  </div>

  {/* Ranking (moved under logs) */}
  <div style={ui.card}>
    <div style={ui.cardTitle}>🏆 Ranking ({players.length})</div>

    {rankedPlayers.length === 0 ? (
      <div style={{ opacity: 0.75 }}>No players yet.</div>
    ) : (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
          <thead>
            <tr>
              <th style={ui.thLeft}>#</th>
              <th style={ui.thLeft}>Player</th>
              <th style={ui.thRight}>Dominance</th>
              <th style={ui.thRight}>Credits</th>
              <th style={ui.thRight}>🐎</th>
              <th style={ui.thRight}>🏹</th>
              <th style={ui.thRight}>🗡️</th>
              <th style={ui.thRight}>🍺</th>
            </tr>
          </thead>
          <tbody>
            {rankedPlayers.map((p, idx) => (
              <tr key={p.id}>
                <td style={ui.tdLeft}>{idx + 1}</td>
                <td style={ui.tdLeft}>
                  <strong style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Avatar value={p.avatar} size={22} />
                    <span>{p.name}</span>
                  </strong>
                </td>
                <td style={ui.tdRight}>{p.dominance.toFixed(1)}%</td>
                <td style={ui.tdRight}>{Number(p.credits ?? 0)}</td>
                <td style={ui.tdRight}>{Number(p.u?.cav ?? 0)}</td>
                <td style={ui.tdRight}>{Number(p.u?.arch ?? 0)}</td>
                <td style={ui.tdRight}>{Number(p.u?.foot ?? 0)}</td>
                <td style={ui.tdRight}>{Number((p as any).beerCount ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
</div>
</div>

    {/* ===== Bottom: Host controls + Pregame under it ===== */}
    <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
      {/* Host controls */}
      <div style={ui.card}>
        <div style={ui.cardTitle}>🧰 Host controls</div>

        <div style={{ marginBottom: 10, fontSize: 13, opacity: 0.88 }}>
          Game status: <strong>{gameStatus || "—"}</strong>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button onClick={initTiles} style={ui.button}>
            Initialize tiles (60)
          </button>

          <button onClick={assignBasecamps} style={ui.button}>
            Assign basecamps (spread)
          </button>

          <button onClick={startStartTimer} style={ui.button}>
            ⏱️ Start 10-minute deployment
          </button>

          <button onClick={finalizeStartAndFillRemainder} style={ui.button}>
            ⚔️ Start game now
          </button>

          {(gameStatus === "live" || gameStatus === "playing") && (
            <button onClick={pauseGame} style={ui.button}>
              ⏸️ Pause game
            </button>
          )}

          {gameStatus === "paused" && (
            <button onClick={resumeGame} style={ui.button}>
              ▶️ Resume game
            </button>
          )}

          {gameStatus !== "finished" && (
            <button onClick={endGame} style={ui.buttonDanger}>
              🛑 End game
            </button>
          )}

          <button onClick={resetGame} style={ui.buttonDanger}>
            Reset game (clear troops + log)
          </button>
        </div>
      </div>

      {/* Pregame setup */}
      <div style={ui.card}>
        <div style={ui.cardTitle}>🏁 Destructo Truck Pregame</div>
        <div style={ui.helpText}>
          Select each player's final Destructo Truck ranking. Starting credits and troops are assigned automatically.
          Dragonglass, Mage and the +1 EXP reward are shown as reminders only and are not added automatically.
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {players.map((p) => {
            const d = draft[p.id] ?? { pregameRank: "" };
            const rank = Number(d.pregameRank);
            const reward = rank >= 1 && rank <= 8 ? PREGAME_REWARDS[rank] : null;

            return (
              <div key={p.id} style={ui.playerCard}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <strong style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Avatar value={p.avatar} size={22} />
                    <span>{p.name}</span>
                  </strong>

                  <label style={ui.smallLabel}>
                    Destructo Truck rank
                    <select
                      value={d.pregameRank}
                      onChange={(e) => {
                        const value = e.target.value;

                        setDraft((prev) => ({
                          ...prev,
                          [p.id]: {
                            pregameRank: value === "" ? "" : Number(value),
                          },
                        }));
                      }}
                      style={ui.smallInput}
                    >
                      <option value="">Choose...</option>
                      {Array.from({ length: 8 }, (_, i) => i + 1).map((rankOption) => (
                        <option key={rankOption} value={rankOption}>
                          #{rankOption}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {reward && (
                  <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
                    💰 {reward.credits.toLocaleString()} credits
                    {" · "}
                    🪖 {reward.foot} Foot
                    {" · "}
                    🐎 {reward.cav} Cav
                    {" · "}
                    🏹 {reward.arch} Arch
                    {reward.extra && (
                      <>
                        {" · "}
                        🎁 <strong>{reward.extra}</strong>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: 14,
          }}
        >
          <button onClick={savePregameSetup} style={ui.button}>
            Save pregame setup
          </button>
        </div>
      </div>
    </div>
  </main>
);

}