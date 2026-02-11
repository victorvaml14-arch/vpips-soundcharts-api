import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;
const CM_BASE = "https://api.chartmetric.com/api";

async function getAccessToken() {
  const r = await fetch(`${CM_BASE}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      refreshtoken: process.env.CHARTMETRIC_REFRESH_TOKEN || "",
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.token) {
    throw new Error(`token_error status=${r.status} body=${JSON.stringify(data)}`);
  }
  return data.token;
}

app.get("/", (req, res) => res.send("ok"));
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/cm-test", async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const accessToken = await getAccessToken();

    // ✅ Search endpoint (artists)
    const url = `${CM_BASE}/search?q=drake&type=artists`;

    const r = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const text = await r.text();
    return res.status(200).json({
      ok: r.ok,
      upstream_status: r.status,
      upstream_preview: text.slice(0, 800),
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      error: e.name === "AbortError" ? "timeout" : e.message,
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
