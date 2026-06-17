// api/inventory.js — PBJZ wax & sealed inventory (reads an INVENTORY table in Airtable)
// Table fields: Product, Price, Details, Photo (attachment), Status (Available/Sold/Hold), Visible (checkbox)

export default async function handler(req, res) {
  const token = (process.env.AIRTABLE_TOKEN || "").trim();
  const base = (process.env.AIRTABLE_BASE || "").trim();
  const table = (process.env.AIRTABLE_INVENTORY_TABLE || "INVENTORY").trim();
  if (!token || !base) return res.status(500).json({ error: "Server not configured" });

  const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?pageSize=100`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return res.status(502).json({ error: "Lookup failed", status: r.status });
    const data = await r.json();

    const items = (data.records || [])
      .map(rec => rec.fields || {})
      .filter(f => {
        const v = f["Visible"];
        return v === undefined || v === true || String(v).toUpperCase() === "YES";
      })
      .map(f => {
        const ph = f["Photo"];
        const photo = Array.isArray(ph) && ph[0] ? (ph[0].thumbnails?.large?.url || ph[0].url) : "";
        return {
          product: f["Product"] || "Sealed product",
          price: (f["Price"] !== undefined && f["Price"] !== "") ? String(f["Price"]) : "",
          details: f["Details"] || "",
          status: String(f["Status"] || "Available").trim(),
          photo
        };
      });

    // Available items first, sold/hold after
    items.sort((a, b) =>
      (a.status.toLowerCase() === "available" ? 0 : 1) - (b.status.toLowerCase() === "available" ? 0 : 1));

    // Short cache so newly added Airtable rows show up within ~30s. (Airtable photo URLs expire after ~2h.)
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
}
