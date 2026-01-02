"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

export default function CreateGamePage() {
  const [gameId, setGameId] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  // ✅ auth gating
  const [authReady, setAuthReady] = useState(false);

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

  async function createGame() {
    if (!authReady) {
      setStatus("⏳ Logging in (anonymous)...");
      return;
    }

    setStatus("Creating game...");
    try {
      const docRef = await addDoc(collection(db, "games"), {
        status: "lobby",
        round: 1,
        phase: "setup",
        wic: 0,
        createdAt: serverTimestamp(),
      });

      setGameId(docRef.id);
      setStatus("✅ Game created");
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ ${err?.message ?? String(err)}`);
    }
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Create Game (Host)</h1>

      {!authReady && <p>🔐 Logging in (anonymous)...</p>}

      <button
        onClick={createGame}
        disabled={!authReady}
        style={{
          padding: "10px 16px",
          border: "1px solid black",
          borderRadius: 8,
          cursor: !authReady ? "not-allowed" : "pointer",
          opacity: !authReady ? 0.6 : 1,
        }}
      >
        Create new game
      </button>

      <p style={{ marginTop: 16 }}>{status}</p>

      {gameId && (
        <>
          <h2>Game ID</h2>
          <pre style={{ padding: 12, border: "1px solid #ccc", borderRadius: 8 }}>
            {gameId}
          </pre>

          <p>
            Player join link:{" "}
            <a href={`/join/${gameId}`}>{`/join/${gameId}`}</a>
          </p>

          <p>
            Host link:{" "}
            <a href={`/host/${gameId}`}>{`/host/${gameId}`}</a>
          </p>
        </>
      )}
    </main>
  );
}
