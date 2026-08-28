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

  const [startUnits, setStartUnits] = useState<{
    foot: number;
    cav: number;
    arch: number;
  } | null>(null);

  const [startReady, setStartReady] = useState(false);

  const [deployments, setDeployments] = useState<
    Record<
      string,
      {
        foot: number;
        cav: number;
        arch: number;
      }
    >
  >({});

  // --------------------------------------------------
  // Game / start phase state
  // --------------------------------------------------

  const [gameStatus, setGameStatus] = useState("");

  const [startEndsAtMs, setStartEndsAtMs] =
    useState<number | null>(null);

  const [startActive, setStartActive] =
    useState(false);

  const [nowMs, setNowMs] =
    useState<number>(Date.now());

  const [startFinalized, setStartFinalized] =
    useState(false);

  const [status, setStatus] = useState("");

  // --------------------------------------------------
  // AUTH
  // --------------------------------------------------

  useEffect(() => {
    const unsub = onAuthStateChanged(
      auth,
      async (user) => {
        if (!user) {
          try {
            await signInAnonymously(auth);
          } catch (err) {
            console.error(
              "Anonymous sign-in failed:",
              err
            );

            alert(
              "Anonymous login failed. Check console."
            );

            return;
          }
        }

        setAuthReady(true);
      }
    );

    return () => unsub();
  }, []);

  // --------------------------------------------------
  // LOCAL CLOCK
  // Used for old start timer system
  // --------------------------------------------------

  useEffect(() => {
    const t = setInterval(
      () => setNowMs(Date.now()),
      250
    );

    return () => clearInterval(t);
  }, []);

  // --------------------------------------------------
  // GAME DOC LISTENER
  // --------------------------------------------------

  useEffect(() => {
    if (!authReady) return;

    const gameRef = doc(
      db,
      "games",
      gameId
    );

    const unsub = onSnapshot(
      gameRef,
      (snap) => {
        const data =
          (snap.data() as any) ?? {};

        // NEW:
        // central game status
        setGameStatus(
          data?.status ?? ""
        );

        // old start timer system
        const startClaim =
          data?.startClaim ?? null;

        const active =
          !!startClaim?.active;

        setStartActive(active);

        const endsAt =
          startClaim?.endsAt?.toDate?.()
            ? startClaim.endsAt.toDate()
            : null;

        setStartEndsAtMs(
          endsAt
            ? endsAt.getTime()
            : null
        );

        setStartFinalized(
          !!data?.startFinalized
        );
      }
    );

    return () => unsub();
  }, [authReady, gameId]);

  // --------------------------------------------------
  // REDIRECT TO PLAY
  //
  // IMPORTANT:
  // The player's local timer reaching 00:00 does NOT redirect directly.
  // The host first finalizes remaining troops and then sets the game to "live".
  // --------------------------------------------------

  useEffect(() => {
    if (!authReady) return;

    if (
      gameStatus === "live" ||
      gameStatus === "playing" ||
      startFinalized
    ) {
      router.replace(
        `/play/${gameId}/${playerId}`
      );
    }
  }, [
    authReady,
    gameStatus,
    startFinalized,
    router,
    gameId,
    playerId,
  ]);

  const timeLeftSec =
    startEndsAtMs !== null
      ? Math.max(
          0,
          Math.ceil(
            (startEndsAtMs - nowMs) /
              1000
          )
        )
      : null;

  const timeLeftDisplay =
    timeLeftSec !== null
      ? `${Math.floor(timeLeftSec / 60)}:${String(
          timeLeftSec % 60
        ).padStart(2, "0")}`
      : "-";

  // --------------------------------------------------
  // START LOCK
  // --------------------------------------------------

  const startLockedByTime =
    startEndsAtMs !== null &&
    nowMs >= startEndsAtMs;

  const isLocked =
    startReady ||
    !startActive ||
    startLockedByTime;

  // --------------------------------------------------
  // TILES LISTENER
  // --------------------------------------------------

  useEffect(() => {
    if (!authReady) return;

    const unsub = onSnapshot(
      collection(
        db,
        "games",
        gameId,
        "tiles"
      ),
      (snap) => {
        const list =
          snap.docs.map(
            (d) =>
              ({
                id: d.id,
                ...(d.data() as any),
              }) as Tile
          );

        setTiles(list);

        const bc =
          list.find(
            (t) =>
              t.isBasecamp &&
              t.basecampOwnerPlayerId ===
                playerId
          ) ?? null;

        setBasecamp(bc);
      }
    );

    return () => unsub();
  }, [
    authReady,
    gameId,
    playerId,
  ]);

  // --------------------------------------------------
  // PLAYER DOC LISTENER
  // --------------------------------------------------

  useEffect(() => {
    if (!authReady) return;

    const playerRef = doc(
      db,
      "games",
      gameId,
      "players",
      playerId
    );

    const unsub = onSnapshot(
      playerRef,
      (snap) => {
        const data =
          (snap.data() as any) ?? {};

        setStartReady(
          !!data?.startReady
        );

        const su =
          data?.startUnits ??
          data?.units ??
          null;

        if (su) {
          setStartUnits({
            foot: Number(
              su.foot ?? 0
            ),

            cav: Number(
              su.cav ?? 0
            ),

            arch: Number(
              su.arch ?? 0
            ),
          });
        } else {
          setStartUnits(null);
        }
      }
    );

    return () => unsub();
  }, [
    authReady,
    gameId,
    playerId,
  ]);

  // --------------------------------------------------
  // DEPLOYMENTS LISTENER
  // --------------------------------------------------

  useEffect(() => {
    if (!authReady) return;

    const depCol = collection(
      db,
      "games",
      gameId,
      "deployments",
      playerId,
      "tiles"
    );

    const unsub = onSnapshot(
      depCol,
      (snap) => {
        const next: Record<
          string,
          {
            foot: number;
            cav: number;
            arch: number;
          }
        > = {};

        snap.docs.forEach((d) => {
          const data =
            d.data() as any;

          next[d.id] = {
            foot: Number(
              data.foot ?? 0
            ),

            cav: Number(
              data.cav ?? 0
            ),

            arch: Number(
              data.arch ?? 0
            ),
          };
        });

        setDeployments(next);
      }
    );

    return () => unsub();
  }, [
    authReady,
    gameId,
    playerId,
  ]);

  // --------------------------------------------------
  // DEPLOY TROOPS
  // --------------------------------------------------

  async function setDeployment(
    tileId: string,
    patch: Partial<{
      foot: number;
      cav: number;
      arch: number;
    }>
  ) {
    if (!authReady) {
      setStatus("⏳ Waiting for login...");
      return;
    }

    if (isLocked) {
      setStatus(
        !startActive
          ? "⏳ Waiting for host to start the start phase..."
          : "⏱️ Locked."
      );
      return;
    }

    if (!startUnits) {
      setStatus(
        "❌ Start units not set yet (host must save pregame setup)."
      );
      return;
    }

    if (!basecamp) {
      setStatus("❌ No basecamp assigned yet.");
      return;
    }

    const basecampId = String(basecamp.id);

    const allowed =
      String(tileId) === basecampId ||
      isNeighbor(basecampId, String(tileId));

    if (!allowed) {
      setStatus(
        "❌ You can only deploy on your basecamp or an adjacent tile."
      );
      return;
    }

    const current =
      deployments[tileId] ?? {
        foot: 0,
        cav: 0,
        arch: 0,
      };

    const nextForTile = {
      foot: Math.max(0, patch.foot ?? current.foot),
      cav: Math.max(0, patch.cav ?? current.cav),
      arch: Math.max(0, patch.arch ?? current.arch),
    };

    const othersTotals = Object.entries(deployments).reduce(
      (acc, [id, d]) => {
        if (id === tileId) return acc;

        return {
          foot: acc.foot + Number(d.foot ?? 0),
          cav: acc.cav + Number(d.cav ?? 0),
          arch: acc.arch + Number(d.arch ?? 0),
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
      setStatus(
        "❌ You can't deploy more troops than your start units."
      );
      return;
    }

    const totalOnTile =
      nextForTile.foot +
      nextForTile.cav +
      nextForTile.arch;

    const tileRef = doc(
      db,
      "games",
      gameId,
      "tiles",
      tileId
    );

    const depRef = doc(
      db,
      "games",
      gameId,
      "deployments",
      playerId,
      "tiles",
      tileId
    );

    try {
      await runTransaction(db, async (tx) => {
        const tileSnap = await tx.get(tileRef);

        if (!tileSnap.exists()) {
          throw new Error("Tile not found");
        }

        const tileData = tileSnap.data() as any;

        const owner = tileData.ownerPlayerId ?? null;
        const isBasecamp = !!tileData.isBasecamp;
        const basecampOwner =
          tileData.basecampOwnerPlayerId ?? null;

        const isOwnBasecamp =
          isBasecamp &&
          basecampOwner === playerId;

        if (
          isBasecamp &&
          !isOwnBasecamp
        ) {
          throw new Error(
            "You cannot deploy on an enemy basecamp."
          );
        }

        if (
          owner &&
          owner !== playerId
        ) {
          throw new Error(
            "Tile already belongs to another player."
          );
        }

        tx.set(
          depRef,
          nextForTile,
          { merge: true }
        );

        if (totalOnTile > 0) {
          tx.update(
            tileRef,
            isOwnBasecamp
              ? {
                  isStartTile: true,
                }
              : {
                  ownerPlayerId: playerId,
                  isStartTile: true,
                }
          );
        } else if (!isOwnBasecamp) {
          tx.update(tileRef, {
            ownerPlayerId: null,
            isStartTile: false,
          });
        }
      });

      setStatus("");
    } catch (err: any) {
      console.error(err);

      setStatus(
        `❌ ${err?.message ?? String(err)}`
      );
    }
  }

  // --------------------------------------------------
  // PLAYER READY
  // --------------------------------------------------

  async function markReady() {
    if (!authReady) {
      setStatus(
        "⏳ Waiting for login..."
      );
      return;
    }

    if (!startActive) {
      setStatus(
        "⏳ The deployment phase has not started yet."
      );
      return;
    }

    if (startLockedByTime) {
      setStatus(
        "⏱️ Time is up. Waiting for the host to finalize the start."
      );
      return;
    }

    setStatus(
      "Locking in..."
    );

    const ref = doc(
      db,
      "games",
      gameId,
      "players",
      playerId
    );

    await setDoc(
      ref,
      {
        startReady: true,
        startReadyAt:
          serverTimestamp(),
      },
      {
        merge: true,
      }
    );

    setStatus(
      "✅ Ready! Your deployment is locked. Waiting for Horgoth to begin..."
    );
  }

  // --------------------------------------------------
  // DEPLOYED TOTALS
  // --------------------------------------------------

  const deployedTotals =
    useMemo(() => {
      return Object.values(
        deployments
      ).reduce(
        (acc, d) => ({
          foot:
            acc.foot +
            (d.foot ?? 0),

          cav:
            acc.cav +
            (d.cav ?? 0),

          arch:
            acc.arch +
            (d.arch ?? 0),
        }),

        {
          foot: 0,
          cav: 0,
          arch: 0,
        }
      );
    }, [deployments]);

  // --------------------------------------------------
  // REMAINING TROOPS
  // --------------------------------------------------

  const remaining =
    useMemo(() => {
      if (!startUnits) {
        return null;
      }

      return {
        foot: Math.max(
          0,
          startUnits.foot -
            deployedTotals.foot
        ),

        cav: Math.max(
          0,
          startUnits.cav -
            deployedTotals.cav
        ),

        arch: Math.max(
          0,
          startUnits.arch -
            deployedTotals.arch
        ),
      };
    }, [
      startUnits,
      deployedTotals,
    ]);

  // --------------------------------------------------
  // CLAIMABLE TILES
  // --------------------------------------------------

  const claimableTileIds =
    useMemo(() => {
      if (!basecamp) {
        return [];
      }

      const base =
        HEX_TILES_60.find(
          (t) =>
            t.id ===
            String(basecamp.id)
        );

      if (!base) {
        return [];
      }

      return [
        base.id,
        ...base.neighbors,
      ];
    }, [basecamp]);

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <main style={{ padding: 24 }}>
      <h1>
        Choose your start position
      </h1>

      <p>
        Game:{" "}
        <strong>{gameId}</strong>
        {" — "}
        Player:{" "}
        <strong>
          {playerId}
        </strong>
      </p>

      <div
        style={{
          marginTop: 12,
        }}
      >
        <div>
          Game status:{" "}
          <strong>
            {gameStatus || "—"}
          </strong>
        </div>

        <div>
          Start phase:{" "}
          <strong>
            {startActive
              ? "ACTIVE"
              : "WAITING"}
          </strong>
        </div>

        <div>
          Time left:{" "}
          <strong>
            {timeLeftDisplay}
          </strong>
        </div>

        {!startActive &&
          gameStatus !== "live" && (
            <div
              style={{
                marginTop: 10,
                padding: 10,
                border:
                  "1px solid #ccc",
                borderRadius: 10,
              }}
            >
              ⏳ Waiting for the
              host to start the
              game.
            </div>
          )}

        <div
          style={{
            marginTop: 8,
          }}
        >
          <strong>
            Start units:
          </strong>{" "}
          {startUnits
            ? `Foot ${startUnits.foot}, Cav ${startUnits.cav}, Arch ${startUnits.arch}`
            : "—"}
        </div>

        <div>
          <strong>
            Deployed:
          </strong>{" "}
          Foot{" "}
          {deployedTotals.foot},
          Cav{" "}
          {deployedTotals.cav},
          Arch{" "}
          {deployedTotals.arch}
        </div>

        <div>
          <strong>
            Remaining:
          </strong>{" "}
          {remaining
            ? `Foot ${remaining.foot}, Cav ${remaining.cav}, Arch ${remaining.arch}`
            : "—"}
        </div>

        {!authReady && (
          <div
            style={{
              marginTop: 8,
            }}
          >
            🔐 Logging in...
          </div>
        )}

        {isLocked &&
          startActive && (
            <div
              style={{
                marginTop: 8,
              }}
            >
              ⏱️ Locked.
            </div>
          )}
      </div>

      {!basecamp && (
        <p
          style={{
            marginTop: 12,
          }}
        >
          Waiting for basecamp
          assignment...
        </p>
      )}

      {basecamp && (
        <>
          <p
            style={{
              marginTop: 12,
            }}
          >
            Your basecamp is tile{" "}
            <strong>
              #{basecamp.id}
            </strong>
          </p>

          <p>
            Deploy troops on your basecamp or adjacent tiles. A tile is claimed automatically when you place at least 1 troop on it.
          </p>

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 12,
              flexWrap: "wrap",
            }}
          >
            {claimableTileIds.map(
              (id) => {
                const t =
                  tiles.find(
                    (x) =>
                      x.id === id
                  );

                const isOwn =
                  t?.ownerPlayerId ===
                  playerId;

                const isTakenByOther =
                  !!t?.ownerPlayerId &&
                  t?.ownerPlayerId !==
                    playerId;

                const label =
                  id === basecamp.id
                    ? `🏠 Basecamp (#${id})`
                    : `Tile #${id}`;

                return (
                  <div
                    key={id}
                    style={{
                      border:
                        "1px solid #ccc",

                      borderRadius: 10,

                      padding: 10,

                      minWidth: 230,

                      opacity:
                        isTakenByOther
                          ? 0.4
                          : 1,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        marginBottom: 10,
                      }}
                    >
                      {label}{" "}
                      {isOwn ? "✅" : ""}
                    </div>

                    <div
                      style={{
                        marginTop: 10,
                        display:
                          "flex",
                        gap: 8,
                        flexWrap:
                          "wrap",
                      }}
                    >
                      <label
                        style={{
                          fontSize: 12,
                        }}
                      >
                        Foot{" "}
                        <input
                          type="number"
                          value={
                            deployments[
                              id
                            ]?.foot ??
                            0
                          }
                          disabled={
                            !authReady ||
                            isLocked ||
                            isTakenByOther
                          }
                          onChange={(
                            e
                          ) =>
                            setDeployment(
                              id,
                              {
                                foot: Number(
                                  e
                                    .target
                                    .value
                                ),
                              }
                            )
                          }
                          style={{
                            width: 62,
                          }}
                          min={0}
                        />
                      </label>

                      <label
                        style={{
                          fontSize: 12,
                        }}
                      >
                        Cav{" "}
                        <input
                          type="number"
                          value={
                            deployments[
                              id
                            ]?.cav ??
                            0
                          }
                          disabled={
                            !authReady ||
                            isLocked ||
                            isTakenByOther
                          }
                          onChange={(
                            e
                          ) =>
                            setDeployment(
                              id,
                              {
                                cav: Number(
                                  e
                                    .target
                                    .value
                                ),
                              }
                            )
                          }
                          style={{
                            width: 62,
                          }}
                          min={0}
                        />
                      </label>

                      <label
                        style={{
                          fontSize: 12,
                        }}
                      >
                        Arch{" "}
                        <input
                          type="number"
                          value={
                            deployments[
                              id
                            ]?.arch ??
                            0
                          }
                          disabled={
                            !authReady ||
                            isLocked ||
                            isTakenByOther
                          }
                          onChange={(
                            e
                          ) =>
                            setDeployment(
                              id,
                              {
                                arch: Number(
                                  e
                                    .target
                                    .value
                                ),
                              }
                            )
                          }
                          style={{
                            width: 62,
                          }}
                          min={0}
                        />
                      </label>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </>
      )}

      <button
        onClick={markReady}
        disabled={
          !authReady ||
          isLocked
        }
        style={{
          marginTop: 16,

          padding:
            "10px 16px",

          border:
            "1px solid black",

          borderRadius: 8,

          cursor:
            !authReady ||
            isLocked
              ? "not-allowed"
              : "pointer",

          opacity:
            !authReady ||
            isLocked
              ? 0.5
              : 1,
        }}
      >
        I’m ready (lock in)
      </button>

      <p
        style={{
          marginTop: 16,
        }}
      >
        {status}
      </p>
    </main>
  );
}