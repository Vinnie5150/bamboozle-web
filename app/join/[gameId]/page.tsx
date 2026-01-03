// Join page

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

type AvatarOption = {
  id: string;
  label: string;
  value: string; // "/avatars/xxx.jpg" or emoji like "🎲"
};

export default function JoinGamePage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params.gameId as string;

  const AVATARS: AvatarOption[] = useMemo(
    () => [
      { id: "anton", label: "Anton", value: "/avatars/Anton.jpg" },
      { id: "arne", label: "Arne", value: "/avatars/Arne.jpg" },
      { id: "elizabeth", label: "Elizabeth", value: "/avatars/Elizabeth.jpg" },
      { id: "jochen", label: "Jochen", value: "/avatars/Jochen.jpg" },
      { id: "stijn", label: "Stijn", value: "/avatars/Stijn.jpg" },
      { id: "tim", label: "Tim", value: "/avatars/Tim.jpg" },
      { id: "vinnie", label: "Vinnie", value: "/avatars/Vinnie.jpg" },
      { id: "wannie", label: "Wannie", value: "/avatars/Wannie.jpg" },

      // fallback emoji
      { id: "dice", label: "🎲", value: "🎲" },
    ],
    []
  );

  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string>(AVATARS[0]?.value ?? "🎲");
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
      const ref = await addDoc(collection(db, "games", gameId, "players"), {
        name: name.trim(),
        avatar,

        // start phase flags (IMPORTANT)
        startReady: false,
        startReadyAt: null,

        // keep startUnits separate so UI never reads "units"
        startUnits: { foot: 0, cav: 0, arch: 0 },

        // game stats
        credits: 0,
        dominance: 0,
        units: { foot: 0, cav: 0, arch: 0 },

        createdAt: serverTimestamp(),
      });

      const playerId = ref.id;

      try {
        localStorage.setItem(`bamboozle:${gameId}:playerId`, playerId);
      } catch {}

      setStatus("✅ Joined! Redirecting to start setup...");
      router.push(`/start/${gameId}/${playerId}`);
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ ${err?.message ?? String(err)}`);
      setIsJoining(false);
    }
  }

  const isImageAvatar = typeof avatar === "string" && avatar.startsWith("/");

  return (
    <main style={{ padding: 24 }}>
      <h1>Join Game</h1>
      <p>Game ID: {gameId}</p>

      <div style={{ marginTop: 16 }}>
        <label>
          Name
          <br />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ padding: 8, width: 240 }}
            placeholder="Your name"
          />
        </label>
      </div>

      {/* Avatar picker */}
      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 6 }}>Avatar</div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {AVATARS.map((a) => {
            const selected = avatar === a.value;
            const isImg = a.value.startsWith("/");

            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAvatar(a.value)}
                style={{
                  border: selected ? "2px solid black" : "1px solid #ccc",
                  borderRadius: 10,
                  padding: 6,
                  width: 68,
                  height: 68,
                  cursor: "pointer",
                  background: selected ? "rgba(0,0,0,0.08)" : "white",
                  display: "grid",
                  placeItems: "center",
                }}
                title={a.label}
              >
                {isImg ? (
                  // eslint-disable-next-line @next/next/no-img-element
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
                ) : (
                  <span style={{ fontSize: 28 }}>{a.value}</span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, opacity: 0.9 }}>
          <span style={{ fontSize: 12 }}>Selected:</span>
          {isImageAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt="selected avatar"
              style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 6 }}
            />
          ) : (
            <span style={{ fontSize: 22 }}>{avatar}</span>
          )}
        </div>
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
