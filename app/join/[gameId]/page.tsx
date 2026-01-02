"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";



export default function JoinGamePage() {
  const params = useParams();
  const gameId = params.gameId as string;

  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("🎲");
  const [status, setStatus] = useState("");

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

    setStatus("Joining game...");

    try {
      await addDoc(collection(db, "games", gameId, "players"), {
        name,
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

      setStatus("✅ Joined game!");
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ ${err?.message ?? String(err)}`);
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
        style={{
          marginTop: 20,
          padding: "10px 16px",
          border: "1px solid black",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        Join game
      </button>

      <p style={{ marginTop: 16 }}>{status}</p>
    </main>
  );
}
