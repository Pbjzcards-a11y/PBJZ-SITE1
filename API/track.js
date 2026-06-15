// api/track.js — Vercel serverless function
// Reads submission status from Airtable, keeping your token secret on the server.
//
// Required environment variables (set in Vercel → Project → Settings → Environment Variables):
//   AIRTABLE_TOKEN  — a Personal Access Token with data.records:read on your base
//   AIRTABLE_BASE   — your base id (looks like app XXXXXXXXXXXXXX)
//   AIRTABLE_TABLE  — the table name (default: "Submissions")
//
// Airtable table fields expected:
//   "Submission Number"  (single line text)
//   "Status"             (single select — values must match STAGES below)
//   "Cards"              (single line text, optional — e.g. "2023 Topps Chrome · 8 cards")
//   "Last Updated"       (last modified time or date, optional)

const STAGES = ["Received", "Order prep", "Research & ID", "Grading", "Assembly", "Quality check", "Shipped"];

export default async function handler(req, res) {
  const sub = (req.query.sub || "").toString().trim();
  if (!sub) return res.status(400).json({ error: "Missing submission number" });

  const { AIRTABLE_TOKEN, AIRTABLE_BASE } = process.env;
  const table = process.env.AIRTABLE_TABLE || "Submissions";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE) {
    return res.status(500).json({ error: "Server not configured" });
  }

  // Escape quotes for the Airtable formula, then match the submission number exactly.
  const safe = sub.replace(/'/g, "\\'");
  const formula = `{Submission Number}='${safe}'`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}`
            + `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    if (!r.ok) return res.status(502).json({ error: "Lookup failed" });
    const data = await r.json();
    const rec = data.records && data.records[0];
    if (!rec) return res.status(404).json({ error: "Not found" });

    const f = rec.fields || {};
    const stage = Math.max(0, STAGES.indexOf((f["Status"] || "").trim()));
    const updated = f["Last Updated"]
      ? new Date(f["Last Updated"]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "";

    // Cache at the edge for 60s so repeat checks don't re-hit Airtable.
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ stage, card: f["Cards"] || "Your submission", updated });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
}
