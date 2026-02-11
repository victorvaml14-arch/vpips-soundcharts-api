import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;
const CM_BASE = "https://api.chartmetric.com/api";

// 🔑 Obtener access token usando refresh token
async function getAccessToken() {
  const response = await fetch(`${CM_BASE}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      refreshtoken: process.env.CHARTMETRIC_REFRESH_TOKEN
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Token error: ${JSON.stringify(data)}`);
  }

  return data.token;
}

app.get("/", (req, res) => res.send("ok"));
app.get("/health", (req, res) => res.json({ ok: true }));

// 🔎 Test endpoint
app.get("/cm-test", async (req, res) => {
  try {
    const accessToken = await getAccessToken();

    const response = await fetch(
      `${CM_BASE}/artist/search?q=drake`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    const text = await response.text();
    res.status(response.status).send(text);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
