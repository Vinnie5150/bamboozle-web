"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

export default function CreateGamePage() {
  const router = useRouter();

  const [gameName, setGameName] = useState("");
  const [status, setStatus] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  function normalizeId(value: string) {
    return value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

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

  async function createGame() {
    if (!authReady) {
      setStatus("⏳ Connecting...");
      return;
    }

    const cleanGameName = gameName.trim();

    if (!cleanGameName) {
      setStatus("❌ Please enter a game name.");
      return;
    }

    const gameId = normalizeId(cleanGameName);

    if (!gameId) {
      setStatus("❌ Invalid game name.");
      return;
    }

    setIsCreating(true);
    setStatus("Creating game...");

    try {
      const gameRef = doc(db, "games", gameId);
      const gameSnap = await getDoc(gameRef);

      if (gameSnap.exists()) {
        setStatus(
          `❌ Game "${cleanGameName}" already exists. Choose another name.`
        );
        setIsCreating(false);
        return;
      }

      await setDoc(gameRef, {
        name: cleanGameName,
        status: "lobby",
        round: 1,
        phase: "setup",
        wic: 0,

        startClaim: {
          active: false,
        },

        startFinalized: false,

        createdAt: serverTimestamp(),
      });

      try {
        localStorage.setItem("horgoth:lastHostGameName", cleanGameName);
        localStorage.setItem("horgoth:lastHostGameId", gameId);
      } catch {}

      setStatus("✅ Game created.");

      router.push(`/host/${gameId}`);
    } catch (err: any) {
      console.error(err);

      setStatus(
        `❌ ${err?.message ?? "Something went wrong."}`
      );

      setIsCreating(false);
    }
  }

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 520,
        margin: "0 auto",
      }}
    >
      <h1>⚔️ Create Horgoth Game</h1>

      <p>
        Choose a fixed game name that players can use to join.
      </p>

      {!authReady && <p>🔐 Connecting...</p>}

      <div style={{ marginTop: 24 }}>
        <label>
          Game name
          <br />

          <input
            value={gameName}
            onChange={(e) => setGameName(e.target.value)}
            placeholder="Example: Vinnie1"
            autoComplete="off"
            style={{
              marginTop: 6,
              padding: 10,
              width: "100%",
              boxSizing: "border-box",
            }}
          />
        </label>
      </div>

      <button
        onClick={createGame}
        disabled={!authReady || isCreating}
        style={{
          marginTop: 20,
          padding: "12px 18px",
          width: "100%",
          border: "1px solid black",
          borderRadius: 8,
          fontSize: 16,
          cursor:
            !authReady || isCreating
              ? "not-allowed"
              : "pointer",
          opacity:
            !authReady || isCreating ? 0.6 : 1,
        }}
      >
        {isCreating ? "Creating..." : "Create game"}
      </button>

      <p style={{ marginTop: 16 }}>
        {status}
      </p>

      <div
        style={{
          marginTop: 30,
          padding: 14,
          border: "1px solid #ccc",
          borderRadius: 10,
        }}
      >
        <strong>Players join via:</strong>

        <div style={{ marginTop: 8 }}>
          /join
        </div>

        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            opacity: 0.7,
          }}
        >
          Example: game name <strong>Vinnie1</strong>
        </div>
      </div>
    </main>
  );
}