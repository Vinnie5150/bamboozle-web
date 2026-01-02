"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { db } from "@/lib/firebase";
import { isNeighbor } from "@/app/_components/tileLayout";
import { HEX_TILES_60 } from "@/app/_components/tileLayout";
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
  const gameId = params.gameId as string;
  const playerId = params.playerId as string;

  const [startUnits, setStartUnits] = useState<{ foot: number; cav: number; arch: number } | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [basecamp, setBasecamp] = useState<Tile | null>(null);
  const [status, setStatus] = useState("");

  // ✅ auth gating
  const [authReady, setAuthReady] = useState(false);

  // Timer state (read-only)
  const [startEndsAtMs, setStartEndsAtMs] = useState<number | null>(null);
  const [startActive, setStartActive] = useState(false);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [startReady, setStartReady] = useState(false);

  const [deployments, setDeployments] = useState<Record<string, { foot: number; cav: number; arch: number }>>({});

  // ✅ Anonymous auth (sets authReady when done)
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

  // load tiles
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
  }, [gameId, playerId, authReady]);

  // listen to game timer
  useEffect(() => {
    if (!authReady) return;

    const ref = doc(db, "games", gameId);

    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      const startClaim = data?.startClaim ?? null;

      setStartActive(!!startClaim?.active);

      const endsAt = startClaim?.endsAt?.toDate?.()
        ? startClaim.endsAt.toDate()
        : null;

      setStartEndsAtMs(endsAt ? endsAt.getTime() : null);
    });

    return () => unsub();
  }, [gameId, authReady]);

  // local ticking clock for countdown
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const timeLeftSec =
    startEndsAtMs !== null
      ? Math.max(0, Math.ceil((startEndsAtMs - nowMs) / 1000))
      : null;

  const isLocked =
    startReady ||
    !startActive ||
    (startEndsAtMs !== null && nowMs >= startEndsAtMs);

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

    // Alleen basecamp of adjacent tiles
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

        // Nooit vijandelijk basecamp
        if (tileIsBasecamp && !isOwnBasecamp) {
          throw new Error("You cannot claim an enemy basecamp");
        }

        // Eigen basecamp: owner bestaat al, enkel start flag zetten
        if (isOwnBasecamp) {
          tx.update(tileRef, { isStartTile: true });
          return;
        }

        // Adjacent tile: vrij of al van jou
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

  // listen player doc (startReady + startUnits)
  useEffect(() => {
    if (!authReady) return;

    const ref = doc(db, "games", gameId, "players", playerId);

    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      setStartReady(!!data?.startReady);

      const su = data?.startUnits ?? data?.units ?? null; // fallback
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
  }, [gameId, playerId, authReady]);

  async function markReady() {
    if (!authReady) {
      setStatus("⏳ Waiting for login...");
      return;
    }

    const ref = doc(db, "games", gameId, "players", playerId);

    await setDoc(
      ref,
      {
        startReady: true,
        startReadyAt: serverTimestamp(),
      },
      { merge: true }
    );

    setStatus("✅ Locked in. Waiting for others / timer.");
  }

  // listen deployments
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
  }, [gameId, playerId, authReady]);

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

    // totals zonder deze tile
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

    setStatus(""); // clear error
  }

  const deployedTotals = Object.values(deployments).reduce(
    (acc, d) => ({
      foot: acc.foot + (d.foot ?? 0),
      cav: acc.cav + (d.cav ?? 0),
      arch: acc.arch + (d.arch ?? 0),
    }),
    { foot: 0, cav: 0, arch: 0 }
  );

  const remaining = startUnits
    ? {
        foot: Math.max(0, startUnits.foot - deployedTotals.foot),
        cav: Math.max(0, startUnits.cav - deployedTotals.cav),
        arch: Math.max(0, startUnits.arch - deployedTotals.arch),
      }
    : null;

  return (
    <main style={{ padding: 24 }}>
      <h1>Choose your start position</h1>
      <p>Player: {playerId}</p>

      <div style={{ marginTop: 12 }}>
        <div>
          Start phase: <strong>{startActive ? "ACTIVE" : "INACTIVE"}</strong>
        </div>
        <div>
          Time left: <strong>{timeLeftSec === null ? "-" : `${timeLeftSec}s`}</strong>
        </div>

        <div style={{ marginTop: 8 }}>
          <strong>Start units:</strong>{" "}
          {startUnits ? `Foot ${startUnits.foot}, Cav ${startUnits.cav}, Arch ${startUnits.arch}` : "—"}
        </div>

        <div>
          <strong>Deployed:</strong> Foot {deployedTotals.foot}, Cav {deployedTotals.cav}, Arch {deployedTotals.arch}
        </div>

        <div>
          <strong>Remaining:</strong>{" "}
          {remaining ? `Foot ${remaining.foot}, Cav ${remaining.cav}, Arch ${remaining.arch}` : "—"}
        </div>

        {isLocked && (
          <div style={{ marginTop: 8 }}>
            ⏱️ Locked — no more start tiles can be claimed.
          </div>
        )}

        {!authReady && (
          <div style={{ marginTop: 8 }}>
            🔐 Logging in (anonymous)...
          </div>
        )}
      </div>

      {!basecamp && <p style={{ marginTop: 12 }}>Waiting for basecamp assignment...</p>}

      {basecamp && (
        <>
          <p style={{ marginTop: 12 }}>
            Your basecamp is tile <strong>#{basecamp.id}</strong>
          </p>
          <p>Claim as many start tiles as you want (basecamp + adjacent tiles).</p>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {(() => {
              const base = HEX_TILES_60.find((t) => t.id === String(basecamp.id));
              if (!base) return [];
              return [base.id, ...base.neighbors];
            })().map((id) => {
              const t = tiles.find((x) => x.id === id);
              const isOwn = t?.ownerPlayerId === playerId;
              const isTakenByOther = !!t?.ownerPlayerId && t?.ownerPlayerId !== playerId;

              const label = id === basecamp.id ? `🏠 Basecamp (#${id})` : `#${id}`;

              return (
                <div
                  key={id}
                  style={{
                    border: "1px solid #ccc",
                    borderRadius: 10,
                    padding: 10,
                    minWidth: 220,
                    opacity: isTakenByOther ? 0.4 : 1,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      disabled={!authReady || isLocked || isTakenByOther}
                      onClick={() => claimStartTile(id)}
                      style={{
                        padding: "8px 12px",
                        border: "1px solid black",
                        borderRadius: 8,
                        cursor: !authReady || isLocked || isTakenByOther ? "not-allowed" : "pointer",
                      }}
                    >
                      {label} {isOwn ? "✅" : ""}
                    </button>
                  </div>

                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <label style={{ fontSize: 12 }}>
                      Foot{" "}
                      <input
                        type="number"
                        value={deployments[id]?.foot ?? 0}
                        disabled={!authReady || isLocked || !isOwn}
                        onChange={(e) => setDeployment(id, { foot: Number(e.target.value) })}
                        style={{ width: 60 }}
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
                        style={{ width: 60 }}
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
                        style={{ width: 60 }}
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

      {startReady && <p style={{ marginTop: 8 }}>✅ You are locked in.</p>}

      <p style={{ marginTop: 16 }}>{status}</p>
    </main>
  );
}
