"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

export default function Home() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        await signInAnonymously(auth);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  async function joinGame() {
    setStatus("");

    const gameCode = code.trim().toUpperCase();
    const playerName = name.trim();

    if (!gameCode) return setStatus("❌ Vul game code in");
    if (!playerName) return setStatus("❌ Vul je naam in");
    if (!auth.currentUser?.uid) return setStatus("❌ Niet ingelogd (auth)");

    setStatus("⏳ Game checken...");

    // 1) bestaat de game?
    const gameRef = doc(db, "games", gameCode);
    const gameSnap = await getDoc(gameRef);
    if (!gameSnap.exists()) return setStatus("❌ Game niet gevonden");

    const gameData = gameSnap.data() as any;

    // 2) alleen joinen als lobby
    if (gameData.status !== "lobby") {
      return setStatus("❌ Game is al gestart");
    }

    // 3) max 8 spelers check
    const playersCol = collection(db, "games", gameCode, "players");
    const playersSnap = await getDocs(playersCol);
    if (playersSnap.size >= (gameData.maxPlayers ?? 8)) {
      return setStatus("❌ Game is vol");
    }

    // 4) schrijf speler op UID (belangrijk!)
    const uid = auth.currentUser.uid;
    const playerRef = doc(db, "games", gameCode, "players", uid);

    await setDoc(
      playerRef,
      {
        name: playerName,
        joinedAt: serverTimestamp(),
      },
      { merge: true }
    );

    setStatus("✅ Joined! Doorsturen...");

    // volgende stap: we maken straks /game/[gameId]
    router.push(`/game/${gameCode}`);
  }

  return (
    <main style={{ padding: 24, maxWidth: 420 }}>
      <h1>Bamboozle</h1>

      {!authReady && <p>🔐 Aan het inloggen (anonymous)...</p>}

      <div style={{ marginTop: 16 }}>
        <label>Game code</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="H7K9QD"
          disabled={!authReady}
          style={{
            width: "100%",
            padding: 10,
            fontSize: 16,
            marginTop: 6,
            textTransform: "uppercase",
          }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <label>Jouw naam</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vincent"
          disabled={!authReady}
          style={{ width: "100%", padding: 10, fontSize: 16, marginTop: 6 }}
        />
      </div>

      <button
        onClick={joinGame}
        disabled={!authReady}
        style={{
          marginTop: 16,
          width: "100%",
          padding: 12,
          fontSize: 16,
          cursor: authReady ? "pointer" : "not-allowed",
        }}
      >
        Join
      </button>

      {status && <p style={{ marginTop: 16 }}>{status}</p>}
    </main>
  );
}