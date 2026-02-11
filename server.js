app.get("/cm-test", async (req, res) => {
  try {
    const response = await fetch("https://api.chartmetric.com/api/artist/search?q=drake", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.CHARTMETRIC_API_KEY}`,
        Accept: "application/json"
      }
    });

    const text = await response.text();
    res.status(response.status).send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
