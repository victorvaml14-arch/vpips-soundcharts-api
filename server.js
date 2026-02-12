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
app.get("/dashboard", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("v_artist_dashboard")
      .select("*")
      .order("ts_hour", { ascending: false })
      .limit(200);

    if (error) throw error;

    // KPI: última fila por artista
    const latestByArtist = new Map();
    for (const row of data) {
      if (!latestByArtist.has(row.artist_name)) latestByArtist.set(row.artist_name, row);
    }
    const latest = Array.from(latestByArtist.values());

    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Artist Dashboard</title>
  <style>
    body{font-family:Arial, sans-serif; margin:24px; background:#0b0f17; color:#e6edf3;}
    .row{display:flex; gap:16px; flex-wrap:wrap;}
    .card{background:#121826; border:1px solid #1f2a44; border-radius:16px; padding:16px; min-width:220px; flex:1;}
    h1{margin:0 0 12px 0; font-size:22px;}
    h2{margin:0 0 8px 0; font-size:16px; color:#9fb3c8;}
    .big{font-size:28px; font-weight:700;}
    table{width:100%; border-collapse:collapse; margin-top:16px;}
    th,td{border-bottom:1px solid #1f2a44; padding:10px; text-align:left;}
    th{color:#9fb3c8; font-weight:600;}
    .pill{display:inline-block; padding:4px 10px; border-radius:999px; background:#1f2a44; color:#cfe3ff; font-size:12px;}
    .muted{color:#9fb3c8;}
    a{color:#7dd3fc;}
  </style>
</head>
<body>
  <h1>VPIPS • Artist Performance Dashboard <span class="pill">auto</span></h1>
  <div class="muted">Updated hourly via Chartmetric → Railway → Supabase</div>

  <div class="row" style="margin-top:16px;">
    <div class="card">
      <h2>Total Artists</h2>
      <div class="big">${latest.length}</div>
    </div>
    <div class="card">
      <h2>Last Sync (UTC)</h2>
      <div class="big">${latest[0]?.ts_hour ?? "-"}</div>
    </div>
    <div class="card">
      <h2>Total Est. USD (latest)</h2>
      <div class="big">$${latest.reduce((s,r)=>s+Number(r.estimated_usd||0),0).toFixed(2)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Artist</th>
        <th>Listeners</th>
        <th>Est. USD</th>
        <th>Hour (UTC)</th>
      </tr>
    </thead>
    <tbody>
      ${latest.map(r=>`
        <tr>
          <td><b>${r.artist_name}</b></td>
          <td>${r.listeners_total ?? 0}</td>
          <td>$${Number(r.estimated_usd||0).toFixed(2)}</td>
          <td class="muted">${r.ts_hour}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>

  <div class="muted" style="margin-top:14px;">
    * Estimated USD uses a global payout factor (0.0035). Payments are not official and can vary by country/platform.
  </div>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (e) {
    res.status(500).send(`Error: ${e.message}`);
  }
});

app.get("/cm-link-artist-spotify", async (req, res) => {
  try {
    const artistId = Number(req.query.artist_id);
    const spotifyId = String(req.query.spotify_id || "").trim();

    if (!artistId || !spotifyId) {
      return res.status(400).json({ error: "artist_id and spotify_id are required" });
    }

    const token = await getAccessToken();

    // 1) Buscar en Chartmetric usando el Spotify ID como query
    const r = await fetch(`${CM_BASE}/search?q=${encodeURIComponent(spotifyId)}&type=artists`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });

    const data = await r.json();
    const artists = data?.obj?.artists || [];
    if (!artists.length) return res.status(404).json({ error: "No Chartmetric artist found for this spotify_id" });

    // 2) Elegir el candidato que realmente tenga ese Spotify ID (varios nombres posibles)
    // Chartmetric suele traer campos tipo sp_artist_id / spotify_id / external_ids. Probamos varios.
    const match = artists.find(a =>
      String(a.sp_artist_id || a.spotify_artist_id || a.spotify_id || "") === spotifyId
    ) || artists[0];

    // 3) Guardar chartmetric_artist_id
    const { error } = await supabase
      .from("artists")
      .update({ chartmetric_artist_id: match.id, spotify_artist_id: spotifyId })
      .eq("id", artistId);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      ok: true,
      artist_id: artistId,
      spotify_artist_id: spotifyId,
      chartmetric_artist_id: match.id,
      chosen_name: match.name
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
