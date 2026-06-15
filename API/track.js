// api/track.js — Vercel serverless function (PBJZ submission tracker)
// Reads the "psa" table in your Airtable base, keeping your token secret server-side.
//
// Environment variables to set in Vercel → Project → Settings → Environment Variables:
//   AIRTABLE_TOKEN  — Personal Access Token with data.records:read on the base
//   AIRTABLE_BASE   — appXQv0MUBLJkUlEK
//   AIRTABLE_TABLE  — psa
//
// Table fields used: PSA_NUMBER, STAGE, "LAST UPDATED", NOTES, PAYMENT_STATUS, INVOICE_LINK, VISIBLE

// STAGE order must match the front-end STAGES array in index.html.
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
    if (!r.ok) return res.status(502).json({ error: "Lookup failed" });
    const data = await r.json();
    const rec = data.records && data.records[0];
    if (!rec) return res.status(404).json({ error: "Not found" });

    const f = rec.fields || {};

    // Respect the VISIBLE flag — hidden rows behave as if they don't exist.
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
      stage,
      updated,
      notes: f["NOTES"] || "",
      paymentStatus: f["PAYMENT_STATUS"] || "",
      invoiceLink: f["INVOICE_LINK"] || ""
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
}
