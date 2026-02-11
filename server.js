app.get("/cm-test", async (req, res) => {
  try {
    const accessToken = await getAccessToken();

    const response = await fetch(
      `${CM_BASE}/search?q=drake&type=artists`,
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
