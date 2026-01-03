// Join page

"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

export default function JoinGamePage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params.gameId as string;

  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("🎲");
  const [status, setStatus] = useState("");
  const [isJoining, setIsJoining] = useState(false);

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

  async function joinGame() {
    if (!name.trim()) {
      setStatus("❌ Please enter your name");
      return;
    }

    setIsJoining(true);
    setStatus("Joining game...");

    try {
      // ✅ capture the created player doc ref so we have playerId
      const ref = await addDoc(collection(db, "games", gameId, "players"), {
        name: name.trim(),
        avatar,
        credits: 0,
        dominance: 0,
        units: {
          foot: 0,
          cav: 0,
          arch: 0,
        },
        createdAt: serverTimestamp(),
      });

      const playerId = ref.id;

      // ✅ optional but strongly recommended: remember this device's playerId for this game
      try {
        localStorage.setItem(`bamboozle:${gameId}:playerId`, playerId);
      } catch {}

      setStatus("✅ Joined! Redirecting to start setup...");

      // ✅ automatic redirect to start page
      router.push(`/start/${gameId}/${playerId}`);
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ ${err?.message ?? String(err)}`);
      setIsJoining(false);
    }
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Join Game</h1>
      <p>Game ID: {gameId}</p>

      <div style={{ marginTop: 16 }}>
        <label>
          Name<br />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ padding: 8, width: 200 }}
          />
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        <label>
          Avatar<br />
          <input
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            style={{ padding: 8, width: 200 }}
          />
        </label>
        <p style={{ fontSize: 24 }}>{avatar}</p>
      </div>

      <button
        onClick={joinGame}
        disabled={isJoining}
        style={{
          marginTop: 20,
          padding: "10px 16px",
          border: "1px solid black",
          borderRadius: 8,
          cursor: isJoining ? "not-allowed" : "pointer",
          opacity: isJoining ? 0.7 : 1,
        }}
      >
        {isJoining ? "Joining..." : "Join game"}
      </button>

      <p style={{ marginTop: 16 }}>{status}</p>
    </main>
  );
}
