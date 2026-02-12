import express from "express";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

const CM_BASE = "https://api.chartmetric.com/api";

// 🔐 Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🔒 Protección contra crashes
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});

// ========================
// AUTH TOKEN
// ========================
async function getAccessToken() {
  const response = await fetch(`${CM_BASE}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      refreshtoken: process.env.CHARTMETRIC_REFRESH_TOKEN,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.token) {
    throw new Error("Chartmetric token error");
  }

  return data.token;
}

// ========================
// BASIC ROUTES
// ========================
app.get("/", (req, res) => res.send("OK"));
app.get("/health", (req, res) => res.json({ ok: true }));

// ========================
// TEST CHARTMETRIC
// ========================
app.get("/cm-test", async (req, res) => {
  try {
    const token = await getAccessToken();

    const response = await fetch(
      `${CM_BASE}/search?q=drake&type=artists`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();
    res.json({ ok: true, preview: data.obj?.artists?.slice(0, 3) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// LINK ARTIST (Guardar Chartmetric ID)
// ========================
app.get("/cm-link-artist", async (req, res) => {
  try {
    const artistId = Number(req.query.artist_id);
    const q = req.query.q;

    if (!artistId || !q)
      return res.status(400).json({ error: "artist_id and q required" });

    const token = await getAccessToken();

    const response = await fetch(
      `${CM_BASE}/search?q=${encodeURIComponent(q)}&type=artists`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();
    const artists = data.obj?.artists || [];

    if (!artists.length)
      return res.status(404).json({ error: "No artist found" });

    const best = artists[0];

    await supabase
      .from("artists")
      .update({ chartmetric_artist_id: best.id })
      .eq("id", artistId);

    res.json({
      ok: true,
      artist_id: artistId,
      chartmetric_artist_id: best.id,
      chosen_name: best.name,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// SYNC ONE ARTIST
// ========================
app.get("/cm-sync-artist", async (req, res) => {
  try {
    const artistId = Number(req.query.artist_id);
    if (!artistId)
      return res.status(400).json({ error: "artist_id required" });

    const { data: artist } = await supabase
      .from("artists")
      .select("*")
      .eq("id", artistId)
      .single();

    if (!artist?.chartmetric_artist_id)
      return res
        .status(400)
        .json({ error: "Artist not linked to Chartmetric" });

    const token = await getAccessToken();

    const response = await fetch(
      `${CM_BASE}/artist/${artist.chartmetric_artist_id}/stat/spotify`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();
    const stats = data.obj || {};
    const listenersHistory = stats.listeners || [];

    const latestListeners =
      listenersHistory.length > 0
        ? Number(listenersHistory[listenersHistory.length - 1].value)
        : 0;

    const ts = new Date();
    ts.setMinutes(0, 0, 0);

    // Guardar métricas
    await supabase.from("hourly_artist_metrics").upsert({
      ts_hour: ts.toISOString(),
      artist_id: artistId,
      streams_total: latestListeners,
      listeners_total: latestListeners,
      top_country_code: null,
      source: "chartmetric",
    });

    // Calcular revenue estimado
    const payout = 0.0035;
    const estimatedUsd = Number((latestListeners * payout).toFixed(6));

    await supabase.from("hourly_artist_revenue_estimate").upsert({
      ts_hour: ts.toISOString(),
      artist_id: artistId,
      estimated_usd: estimatedUsd,
    });

    res.json({
      ok: true,
      artist_id: artistId,
      listeners: latestListeners,
      estimated_usd: estimatedUsd,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// SYNC ALL ARTISTS
// ========================
app.get("/cm-sync-all", async (req, res) => {
  try {
    const { data: artists } = await supabase
      .from("artists")
      .select("id")
      .eq("is_active", true);

    for (const a of artists) {
      await fetch(
        `${req.protocol}://${req.get("host")}/cm-sync-artist?artist_id=${a.id}`
      );
    }

    res.json({ ok: true, synced: artists.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// DASHBOARD DATA ENDPOINT
// ========================
app.get("/dashboard-data", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("v_artist_dashboard")
      .select("*")
      .order("ts_hour", { ascending: false })
      .limit(500);

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
