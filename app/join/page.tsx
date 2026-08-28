// Join page

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

type AvatarOption = {
  id: string;
  label: string;
  value: string;
};

export default function JoinGamePage() {
  const router = useRouter();

  const AVATARS: AvatarOption[] = useMemo(
    () => [
      { id: "luffy", label: "Luffy", value: "/avatars/Luffy.jpg" },
      { id: "darth-vader", label: "Darth Vader", value: "/avatars/Darth Vader.jpg" },
      { id: "r2d2", label: "R2D2", value: "/avatars/R2D2.jpg" },
      { id: "grogu", label: "Grogu", value: "/avatars/Grogu.jpg" },
      { id: "zeb", label: "Zeb", value: "/avatars/Zeb.jpg" },
      { id: "chopper", label: "Chopper", value: "/avatars/Chopper.jpg" },
      { id: "boba-fett", label: "Boba fett", value: "/avatars/Boba fett.jpg" },
      { id: "roronoa-zoro", label: "Roronoa Zoro", value: "/avatars/Roronoa Zoro.jpg" },
    ],
    []
  );

  const [gameName, setGameName] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [avatar, setAvatar] = useState<string>(
    AVATARS[0]?.value ?? ""
  );

  // Avatars already used by another player in the currently entered game.
  const [takenAvatarValues, setTakenAvatarValues] = useState<Set<string>>(
    new Set()
  );

  const [status, setStatus] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  // Remember last session on this device
  const [savedGameName, setSavedGameName] = useState("");
  const [savedPlayerName, setSavedPlayerName] = useState("");

  // --------------------------------------------------
  // Normalise IDs
  // Vinnie1 -> vinnie1
  // Vincent Audoore -> vincent-audoore
  // --------------------------------------------------
  function normalizeId(value: string) {
    return value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // --------------------------------------------------
  // Firebase anonymous authentication
  // --------------------------------------------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.error("Anonymous sign-in failed:", err);
          setStatus("❌ Could not connect to Horgoth.");
          return;
        }
      }

      setAuthReady(true);
    });

    return () => unsub();
  }, []);

  // --------------------------------------------------
  // Load remembered login from this device
  // --------------------------------------------------
  useEffect(() => {
    try {
      const savedGame =
        localStorage.getItem("horgoth:lastGameName") ?? "";

      const savedPlayer =
        localStorage.getItem("horgoth:lastPlayerName") ?? "";

      if (savedGame && savedPlayer) {
        setSavedGameName(savedGame);
        setSavedPlayerName(savedPlayer);
      }
    } catch {
      // localStorage unavailable: no problem
    }
  }, []);

  // --------------------------------------------------
  // Live avatar availability for the entered game
  // The current player's own avatar is excluded, so resume stays clean.
  // --------------------------------------------------
  useEffect(() => {
    const gameId = normalizeId(gameName);
    const currentPlayerId = normalizeId(playerName);

    if (!gameId) {
      setTakenAvatarValues(new Set());
      return;
    }

    const playersRef = collection(
      db,
      "games",
      gameId,
      "players"
    );

    const unsub = onSnapshot(
      playersRef,
      (snapshot) => {
        const used = new Set<string>();

        snapshot.docs.forEach((d) => {
          // If this player already exists, do not mark their own avatar as unavailable.
          if (currentPlayerId && d.id === currentPlayerId) {
            return;
          }

          const data = d.data() as any;
          const usedAvatar = String(data?.avatar ?? "");

          if (usedAvatar) {
            used.add(usedAvatar);
          }
        });

        setTakenAvatarValues(used);

        // If the currently selected avatar becomes taken, move to the first free one.
        if (used.has(avatar)) {
          const firstFree = AVATARS.find(
            (a) => !used.has(a.value)
          );

          if (firstFree) {
            setAvatar(firstFree.value);
          }
        }
      },
      (err) => {
        console.error("Avatar availability listener failed:", err);
        setTakenAvatarValues(new Set());
      }
    );

    return () => unsub();
  }, [gameName, playerName, avatar, AVATARS]);

  // --------------------------------------------------
  // Decide where player should go
  // --------------------------------------------------
  function goToCurrentGameState(
    gameId: string,
    playerId: string,
    gameData: any
  ) {
    // Once the actual game is live, go straight to player page
    if (
      gameData?.status === "live" ||
      gameData?.status === "playing" ||
      gameData?.startFinalized === true
    ) {
      router.replace(`/play/${gameId}/${playerId}`);
      return;
    }

    // Lobby / setup / start phase
    router.replace(`/start/${gameId}/${playerId}`);
  }

  // --------------------------------------------------
  // JOIN OR RESUME
  // --------------------------------------------------
  async function joinGame(
    requestedGameName = gameName,
    requestedPlayerName = playerName
  ) {
    if (!authReady) {
      setStatus("⏳ Connecting...");
      return;
    }

    const cleanGameName = requestedGameName.trim();
    const cleanPlayerName = requestedPlayerName.trim();

    if (!cleanGameName) {
      setStatus("❌ Please enter the game name.");
      return;
    }

    if (!cleanPlayerName) {
      setStatus("❌ Please enter your name.");
      return;
    }

    const gameId = normalizeId(cleanGameName);
    const playerId = normalizeId(cleanPlayerName);

    if (!gameId || !playerId) {
      setStatus("❌ Invalid game name or player name.");
      return;
    }

    setIsJoining(true);
    setStatus("🔎 Looking for game...");

    try {
      // --------------------------------------------------
      // 1. Check whether game exists
      // --------------------------------------------------
      const gameRef = doc(db, "games", gameId);
      const gameSnap = await getDoc(gameRef);

      if (!gameSnap.exists()) {
        setStatus(`❌ Game "${cleanGameName}" not found.`);
        setIsJoining(false);
        return;
      }

      const gameData = gameSnap.data();

      // --------------------------------------------------
      // 2. Check whether player already exists
      // --------------------------------------------------
      const playerRef = doc(
        db,
        "games",
        gameId,
        "players",
        playerId
      );

      const playerSnap = await getDoc(playerRef);

      if (playerSnap.exists()) {
        // ----------------------------------------------
        // EXISTING PLAYER
        // Do NOT overwrite anything!
        // ----------------------------------------------
        const existingPlayer = playerSnap.data();

        setStatus(
          `✅ Welcome back, ${
            existingPlayer?.name ?? cleanPlayerName
          }!`
        );
      } else {
        // ----------------------------------------------
        // NEW PLAYER
        // ----------------------------------------------
        setStatus("⚔️ Creating player...");

        const selectedAvatar = AVATARS.find(
          (a) => a.value === avatar
        );

        if (!selectedAvatar) {
          setStatus("❌ Please choose a valid character.");
          setIsJoining(false);
          return;
        }

        // Compatibility check:
        // catches avatars already used by players created before avatarClaims existed.
        const playersSnap = await getDocs(
          collection(db, "games", gameId, "players")
        );

        const avatarAlreadyUsed = playersSnap.docs.some((d) => {
          const data = d.data() as any;
          return String(data?.avatar ?? "") === avatar;
        });

        if (avatarAlreadyUsed) {
          setStatus(
            `❌ ${selectedAvatar.label} has already been chosen. Please choose another character.`
          );
          setIsJoining(false);
          return;
        }

        // Atomic safety lock:
        // prevents two new players from claiming the same avatar at the same time.
        const avatarClaimRef = doc(
          db,
          "games",
          gameId,
          "avatarClaims",
          selectedAvatar.id
        );

        await runTransaction(db, async (tx) => {
          const latestPlayerSnap = await tx.get(playerRef);

          // Another tab may have created this player between our earlier read and now.
          if (latestPlayerSnap.exists()) {
            return;
          }

          const claimSnap = await tx.get(avatarClaimRef);

          if (claimSnap.exists()) {
            throw new Error(
              `${selectedAvatar.label} has already been chosen. Please choose another character.`
            );
          }

          tx.set(playerRef, {
            name: cleanPlayerName,
            nameNormalized: playerId,
            avatar,
            avatarId: selectedAvatar.id,

            startReady: false,
            startReadyAt: null,

            startUnits: {
              foot: 0,
              cav: 0,
              arch: 0,
            },

            credits: 0,
            dominance: 0,
            beerCount: 0,

            units: {
              foot: 0,
              cav: 0,
              arch: 0,
            },

            exp: {
              foot: 0,
              cav: 0,
              arch: 0,
            },

            joinedAt: serverTimestamp(),

            // Keep this too because some existing code
            // currently sorts on createdAt.
            createdAt: serverTimestamp(),
          });

          tx.set(avatarClaimRef, {
            avatarId: selectedAvatar.id,
            avatar: selectedAvatar.value,
            playerId,
            playerName: cleanPlayerName,
            claimedAt: serverTimestamp(),
          });
        });

        setStatus(`✅ Welcome to Horgoth, ${cleanPlayerName}!`);
      }

      // --------------------------------------------------
      // 3. Remember login on this device
      // --------------------------------------------------
      try {
        localStorage.setItem(
          "horgoth:lastGameName",
          cleanGameName
        );

        localStorage.setItem(
          "horgoth:lastPlayerName",
          cleanPlayerName
        );

        localStorage.setItem(
          "horgoth:lastGameId",
          gameId
        );

        localStorage.setItem(
          "horgoth:lastPlayerId",
          playerId
        );
      } catch {
        // not critical
      }

      // --------------------------------------------------
      // 4. Continue at correct point in game
      // --------------------------------------------------
      goToCurrentGameState(
        gameId,
        playerId,
        gameData
      );
    } catch (err: any) {
      console.error(err);

      setStatus(
        `❌ ${err?.message ?? "Something went wrong."}`
      );

      setIsJoining(false);
    }
  }

  // --------------------------------------------------
  // Continue button for remembered session
  // --------------------------------------------------
  async function continueSavedGame() {
    if (!savedGameName || !savedPlayerName) return;

    setGameName(savedGameName);
    setPlayerName(savedPlayerName);

    await joinGame(savedGameName, savedPlayerName);
  }

  function forgetSavedGame() {
    try {
      localStorage.removeItem("horgoth:lastGameName");
      localStorage.removeItem("horgoth:lastPlayerName");
      localStorage.removeItem("horgoth:lastGameId");
      localStorage.removeItem("horgoth:lastPlayerId");
    } catch {}

    setSavedGameName("");
    setSavedPlayerName("");
  }

  const selectedAvatarOption =
    AVATARS.find((a) => a.value === avatar) ?? null;

  const isSelectedAvatarTaken =
    !!avatar && takenAvatarValues.has(avatar);

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 520,
        margin: "0 auto",
      }}
    >
      <h1>⚔️ Horgoth Edition</h1>

      <p>Enter the realm of Horgoth.</p>

      {!authReady && <p>🔐 Connecting...</p>}

      {/* ----------------------------------------------
          SAVED GAME
      ---------------------------------------------- */}

      {savedGameName && savedPlayerName && (
        <div
          style={{
            marginTop: 24,
            marginBottom: 30,
            padding: 18,
            border: "1px solid #aaa",
            borderRadius: 12,
          }}
        >
          <div
            style={{
              fontSize: 12,
              opacity: 0.7,
              marginBottom: 6,
            }}
          >
            CONTINUE LAST GAME
          </div>

          <div style={{ fontSize: 20 }}>
            <strong>{savedGameName}</strong>
          </div>

          <div style={{ marginTop: 4 }}>
            Playing as <strong>{savedPlayerName}</strong>
          </div>

          <button
            onClick={continueSavedGame}
            disabled={!authReady || isJoining}
            style={{
              marginTop: 14,
              padding: "10px 16px",
              width: "100%",
              cursor:
                !authReady || isJoining
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            ▶ Continue game
          </button>

          <button
            onClick={forgetSavedGame}
            disabled={isJoining}
            style={{
              marginTop: 8,
              padding: "6px 10px",
              width: "100%",
              opacity: 0.7,
            }}
          >
            Use another player
          </button>
        </div>
      )}

      {/* ----------------------------------------------
          GAME NAME
      ---------------------------------------------- */}

      <div style={{ marginTop: 16 }}>
        <label>
          Game name
          <br />
          <input
            value={gameName}
            onChange={(e) => setGameName(e.target.value)}
            placeholder="Example: Vinnie1"
            autoComplete="off"
            style={{
              padding: 10,
              width: "100%",
              boxSizing: "border-box",
              marginTop: 5,
            }}
          />
        </label>
      </div>

      {/* ----------------------------------------------
          PLAYER NAME
      ---------------------------------------------- */}

      <div style={{ marginTop: 16 }}>
        <label>
          Your name
          <br />
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Example: Vincent"
            autoComplete="off"
            style={{
              padding: 10,
              width: "100%",
              boxSizing: "border-box",
              marginTop: 5,
            }}
          />
        </label>
      </div>

      {/* ----------------------------------------------
          AVATAR
      ---------------------------------------------- */}

      <div style={{ marginTop: 20 }}>
        <div style={{ marginBottom: 8 }}>
          Choose avatar
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {AVATARS.map((a) => {
            const selected = avatar === a.value;
            const taken = takenAvatarValues.has(a.value);

            return (
              <div
                key={a.id}
                style={{
                  display: "grid",
                  justifyItems: "center",
                  gap: 4,
                }}
              >
                <button
                  type="button"
                  disabled={taken}
                  onClick={() => setAvatar(a.value)}
                  style={{
                    border: selected
                      ? "2px solid black"
                      : "1px solid #ccc",
                    borderRadius: 10,
                    padding: 6,
                    width: 68,
                    height: 68,
                    cursor: taken ? "not-allowed" : "pointer",
                    background: selected
                      ? "rgba(0,0,0,0.08)"
                      : "white",
                    display: "grid",
                    placeItems: "center",
                    opacity: taken ? 0.35 : 1,
                    position: "relative",
                  }}
                  title={
                    taken
                      ? `${a.label} is already taken`
                      : a.label
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.value}
                    alt={a.label}
                    style={{
                      width: 52,
                      height: 52,
                      objectFit: "cover",
                      borderRadius: 9,
                    }}
                  />

                  {taken && (
                    <span
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "grid",
                        placeItems: "center",
                        fontSize: 22,
                      }}
                    >
                      🔒
                    </span>
                  )}
                </button>

                <span
                  style={{
                    fontSize: 10,
                    maxWidth: 74,
                    textAlign: "center",
                    opacity: taken ? 0.55 : 0.8,
                  }}
                >
                  {a.label}
                </span>
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 12 }}>
            Selected:
          </span>

          {selectedAvatarOption ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedAvatarOption.value}
                alt={selectedAvatarOption.label}
                style={{
                  width: 30,
                  height: 30,
                  objectFit: "cover",
                  borderRadius: 6,
                }}
              />
              <strong>{selectedAvatarOption.label}</strong>
            </>
          ) : (
            <span>—</span>
          )}
        </div>

        {isSelectedAvatarTaken && (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              opacity: 0.8,
            }}
          >
            🔒 This character has just been taken. Choose another one.
          </div>
        )}
      </div>

      {/* ----------------------------------------------
          JOIN BUTTON
      ---------------------------------------------- */}

      <button
        onClick={() => joinGame()}
        disabled={!authReady || isJoining || isSelectedAvatarTaken}
        style={{
          marginTop: 24,
          padding: "12px 18px",
          width: "100%",
          border: "1px solid black",
          borderRadius: 8,
          fontSize: 16,
          cursor:
            !authReady || isJoining || isSelectedAvatarTaken
              ? "not-allowed"
              : "pointer",
          opacity:
            !authReady || isJoining || isSelectedAvatarTaken ? 0.6 : 1,
        }}
      >
        {isJoining
          ? "Entering Horgoth..."
          : "Enter game"}
      </button>

      <p style={{ marginTop: 16 }}>
        {status}
      </p>
    </main>
  );
}