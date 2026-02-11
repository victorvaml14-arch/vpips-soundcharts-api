import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Base URL Chartmetric
const CM_BASE = "https://api.chartmetric.com/api";

app.get("/", (req, res) => res.send("ok"));
app.get("/health", (req, res) => res.json({ ok: true }));

// ✅ Test Chartmetric API (simple search)
app.get("/cm-test", async (req, res) => {
  try {
    const response = await fetch(`${CM_BASE}/artist/search?q=drake`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.CHARTMETRIC_API_KEY}`,
        Accept: "application/json",
      },
    });

    const text = await response.text();
    res.status(response.status).send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
