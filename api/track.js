// api/track.js — PBJZ submission tracker (with diagnostics)
const STAGES = ["ORDER ARRIVED", "RESEARCH & ID", "GRADING", "ASSEMBLY", "QA CHECKS", "SHIPPED TO PBJZ", "ORDER SENT"];

export default async function handler(req, res) {
  const sub = (req.query.sub || "").toString().trim();
  if (!sub) return res.status(400).json({ error: "Missing submission number" });

  const { AIRTABLE_TOKEN, AIRTABLE_BASE } = process.env;
  const table = process.env.AIRTABLE_TABLE || "psa";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE) {
    return res.status(500).json({ error: "Server not configured" });
  }

  const safe = sub.replace(/'/g, "\\'");
  const formula = `{PSA_NUMBER}='${safe}'`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}`
            + `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      return res.status(502).json({ error: "Lookup failed", status: r.status, tokenPrefix: AIRTABLE_TOKEN.slice(0, 3), detail });
    }
    const data = await r.json();
    const rec = data.records && data.records[0];
    if (!rec) return res.status(404).json({ error: "Not found" });

    const f = rec.fields || {};
    const visible = f["VISIBLE"];
    if (visible !== undefined && String(visible).toUpperCase().trim() !== "YES") {
      return res.status(404).json({ error: "Not found" });
    }

    const stage = Math.max(0, STAGES.indexOf(String(f["STAGE"] || "").toUpperCase().trim()));
    const updated = f["LAST UPDATED"]
      ? new Date(f["LAST UPDATED"]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "";

    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({
      stage, updated,
      notes: f["NOTES"] || "",
      paymentStatus: f["PAYMENT_STATUS"] || "",
      invoiceLink: f["INVOICE_LINK"] || ""
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e).slice(0, 200) });
  }
}
