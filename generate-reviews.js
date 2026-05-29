/**
 * generate-reviews.js
 * ----------------------------------------------------------------------------
 * Fetches Google reviews once via the Places API (New) and writes a finished,
 * self-contained HTML file. Paste that HTML into a Wix "Embed HTML" element.
 *
 * Visitors load plain static HTML, so no service counts views or clicks. Your
 * API key stays on the server and never reaches the browser. Run on a schedule
 * to keep reviews fresh.
 *
 * Long reviews are truncated at build time and the full text opens in a CSS-only
 * modal overlay (no JavaScript), so expanding a review never grows the layout.
 * That matters because a Wix Embed HTML iframe has a FIXED height and will clip
 * content that grows taller than it.
 *
 * Requires Node 18+ (built-in fetch). No npm packages.
 *
 * Usage:  GOOGLE_API_KEY=your_key node generate-reviews.js
 * ----------------------------------------------------------------------------
 */

// ============================ CONFIG ========================================
const CONFIG = {
  apiKey: process.env.GOOGLE_API_KEY || "",

  // Paste a Place ID to skip the lookup, or leave blank to resolve from search.
  placeId: "",
  searchQuery: "Energy 1 Services Limited Partnership, Burnaby BC",

  // "most_relevant" (as Google returns them) or "newest" (sorts the returned
  // set by publish time). Note: Google only ever returns up to 5 reviews, so
  // "newest" reorders those 5, not the newest 5 of all reviews ever left.
  reviewSort: "most_relevant",

  minRating: 4,           // hide reviews below this star rating (1 = show all)
  excerptLength: 200,     // characters before a review is truncated + "Read more"
  showWriteReview: true,  // show the "Write a review" button/link
  showDates: false,       // show "2 weeks ago" / "a year ago" next to each review

  outputPath: "google-reviews.html",

  theme: {
    heading: "What our customers say",
    navy: "#133764",   // headings, author names, links, Write a review button
    green: "#6baa51",  // stars and the Read more link
    cardBg: "#ffffff",
    pageBg: "transparent",
    text: "#1f2328",
    muted: "#6b7280",
    radius: "16px",
    // The iframe cannot inherit the Wix page font, so set it explicitly.
    fontFamily:
      "'DIN Next Light','DIN Next','DIN',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    fontWeight: "300",
    // To actually render DIN Next Light inside the iframe, host a webfont file
    // and put its URL here. Leave "" to use the fallback stack above.
    fontFaceUrl: "",
    fontFaceFormat: "woff2",
  },
};
// ============================================================================

const PLACES_BASE = "https://places.googleapis.com/v1";
let GID = 0; // unique gradient id counter

function die(msg) {
  console.error("\n[generate-reviews] " + msg + "\n");
  process.exit(1);
}
if (!CONFIG.apiKey) {
  die("No API key. Run with: GOOGLE_API_KEY=your_key node generate-reviews.js");
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only allow http(s) links through; anything else becomes a no-op.
function safeUrl(u) {
  return /^https?:\/\//i.test(u || "") ? u : "#";
}

// Truncate at a word boundary near n characters.
function truncate(text, n) {
  if (text.length <= n) return text;
  const slice = text.slice(0, n);
  const cut = slice.lastIndexOf(" ");
  return (cut > 60 ? slice.slice(0, cut) : slice).trimEnd() + "\u2026";
}

async function resolvePlaceId(query) {
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": CONFIG.apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery: query }),
  });
  const data = await res.json();
  if (!res.ok) die("Text Search failed: " + JSON.stringify(data));
  if (!data.places || !data.places.length) die("No place matched: " + query);
  const p = data.places[0];
  console.log(`[generate-reviews] Matched: ${p.displayName?.text} (${p.id})`);
  return p.id;
}

async function fetchPlace(placeId) {
  const fieldMask = ["displayName", "rating", "userRatingCount", "googleMapsUri", "reviews"].join(",");
  const url = `${PLACES_BASE}/places/${encodeURIComponent(placeId)}`;
  const res = await fetch(url, {
    headers: { "X-Goog-Api-Key": CONFIG.apiKey, "X-Goog-FieldMask": fieldMask },
  });
  const data = await res.json();
  if (!res.ok) die("Place Details failed: " + JSON.stringify(data));
  return data;
}

function stars(value, accent) {
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const fill = value >= i ? 1 : value > i - 1 ? value - (i - 1) : 0;
    const gid = `gr${GID++}`;
    out.push(`<svg viewBox="0 0 24 24" class="star" aria-hidden="true"><defs><linearGradient id="${gid}"><stop offset="${fill * 100}%" stop-color="${accent}"/><stop offset="${fill * 100}%" stop-color="rgba(0,0,0,.12)"/></linearGradient></defs><path fill="url(#${gid})" d="M12 17.3l-6.16 3.7 1.64-7.03L2 9.24l7.19-.61L12 2l2.81 6.63 7.19.61-5.48 4.73 1.64 7.03z"/></svg>`);
  }
  return out.join("");
}

function authorBlock(a, green, rating, when) {
  const name = esc(a.displayName || "Google user");
  const photo = a.photoUri
    ? `<img class="avatar" src="${esc(safeUrl(a.photoUri))}" alt="" referrerpolicy="no-referrer"/>`
    : `<span class="avatar avatar--blank">${esc(name.charAt(0))}</span>`;
  const profile = a.uri
    ? `<a class="author" href="${esc(safeUrl(a.uri))}" target="_blank" rel="noopener nofollow">${name}</a>`
    : `<span class="author">${name}</span>`;
  const whenHtml = CONFIG.showDates && when ? `<span class="when">${esc(when)}</span>` : "";
  return `<div class="who">${photo}<div class="who__meta">${profile}<div class="who__sub"><span class="stars">${stars(rating || 0, green)}</span>${whenHtml}</div></div></div>`;
}

function reviewCard(r, green, i) {
  const a = r.authorAttribution || {};
  const when = r.relativePublishTimeDescription || "";
  const full = (r.text && r.text.text) || "";
  const isLong = full.length > CONFIG.excerptLength;
  const shown = esc(isLong ? truncate(full, CONFIG.excerptLength) : full);
  const more = isLong ? ` <a class="more" href="#rev${i}">Read more</a>` : "";
  return `<article class="card">${authorBlock(a, green, r.rating, when)}<p class="card__body">${shown}${more}</p></article>`;
}

function reviewModal(r, green, i) {
  const a = r.authorAttribution || {};
  const when = r.relativePublishTimeDescription || "";
  const full = esc((r.text && r.text.text) || "");
  return `<div id="rev${i}" class="modal"><a class="modal__bg" href="#" aria-label="Close"></a><div class="modal__box"><a class="modal__x" href="#" aria-label="Close">&times;</a>${authorBlock(a, green, r.rating, when)}<p class="modal__text">${full}</p></div></div>`;
}

function buildHtml(place, placeId) {
  const t = CONFIG.theme;
  let reviews = (place.reviews || []).filter((r) => (r.rating || 0) >= CONFIG.minRating);
  if (CONFIG.reviewSort === "newest") {
    reviews = reviews.slice().sort((x, y) => new Date(y.publishTime || 0) - new Date(x.publishTime || 0));
  }

  const ratingNum = place.rating ? place.rating.toFixed(1) : "\u2014";
  const count = place.userRatingCount || 0;
  const mapsUri = safeUrl(place.googleMapsUri);
  const writeUri = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;

  const cards = reviews.length
    ? reviews.map((r, i) => reviewCard(r, t.green, i)).join("")
    : `<p class="empty">No reviews to show yet.</p>`;
  const modals = reviews
    .map((r, i) => (((r.text && r.text.text) || "").length > CONFIG.excerptLength ? reviewModal(r, t.green, i) : ""))
    .join("");

  const fontFace = t.fontFaceUrl
    ? `@font-face{font-family:'DIN Next Light';src:url('${esc(t.fontFaceUrl)}') format('${esc(t.fontFaceFormat)}');font-weight:${t.fontWeight};font-display:swap}`
    : "";
  const writeBtn = CONFIG.showWriteReview
    ? `<a class="btn" href="${esc(writeUri)}" target="_blank" rel="noopener nofollow">Write a review</a>` : "";
  const writeFoot = CONFIG.showWriteReview
    ? `<a class="link" href="${esc(writeUri)}" target="_blank" rel="noopener nofollow">Write a review</a>` : "";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Google Reviews</title>
<style>
  ${fontFace}
  :root{--navy:${t.navy};--green:${t.green};--card:${t.cardBg};--bg:${t.pageBg};--text:${t.text};--muted:${t.muted};--radius:${t.radius};--font:${t.fontFamily};--fw:${t.fontWeight}}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--font);font-weight:var(--fw);-webkit-font-smoothing:antialiased;padding:24px 8px}
  .wrap{max-width:1080px;margin:0 auto}
  .head{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:24px}
  .head h2{color:var(--navy);font-weight:var(--fw);font-size:clamp(22px,3.4vw,30px);letter-spacing:.01em}
  .summary{display:flex;align-items:center;gap:10px;margin-left:auto;padding:10px 16px;background:var(--card);border:1px solid rgba(0,0,0,.07);border-radius:999px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .summary .big{color:var(--navy);font-weight:600;font-size:24px;line-height:1}
  .summary .cnt{font-size:13px;color:var(--muted)}
  .btn{display:inline-flex;align-items:center;background:var(--navy);color:#fff;font-family:var(--font);font-weight:500;font-size:14px;padding:11px 18px;border-radius:999px;text-decoration:none;transition:filter .15s ease}
  .btn:hover{filter:brightness(1.12)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}
  .card{background:var(--card);border:1px solid rgba(0,0,0,.07);border-radius:var(--radius);padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.05);opacity:0;transform:translateY(10px);animation:rise .5s ease forwards}
  .card:nth-child(1){animation-delay:.04s}.card:nth-child(2){animation-delay:.10s}.card:nth-child(3){animation-delay:.16s}.card:nth-child(4){animation-delay:.22s}.card:nth-child(5){animation-delay:.28s}
  @keyframes rise{to{opacity:1;transform:none}}
  .who{display:flex;align-items:center;gap:12px;margin-bottom:12px}
  .avatar{width:44px;height:44px;border-radius:50%;object-fit:cover;flex:none}
  .avatar--blank{display:grid;place-items:center;background:var(--navy);color:#fff;font-weight:500;font-size:18px}
  .who__meta{min-width:0}
  .author{display:block;font-weight:500;font-size:15px;color:var(--navy);text-decoration:none}
  .author:hover{text-decoration:underline}
  .who__sub{display:flex;align-items:center;gap:8px;margin-top:3px}
  .stars{display:inline-flex;gap:1px}.star{width:15px;height:15px}
  .when{font-size:12px;color:var(--muted)}
  .card__body{font-size:14.5px;line-height:1.65;color:#374151;white-space:pre-line}
  .more{color:var(--green);font-weight:500;text-decoration:none;white-space:nowrap}
  .more:hover{text-decoration:underline}
  .foot{margin-top:24px;display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap}
  .foot a.link{display:inline-flex;align-items:center;gap:7px;font-size:14px;color:var(--navy);text-decoration:none;font-weight:500}
  .foot a.link:hover{text-decoration:underline}
  .empty{color:var(--muted);padding:30px;text-align:center}
  /* CSS-only modal: opens via :target, overlays the visible frame, scrolls
     internally. No layout reflow, so a fixed iframe height never clips. */
  .modal{position:fixed;inset:0;z-index:100;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(15,28,48,.55)}
  .modal:target{display:flex}
  .modal__bg{position:absolute;inset:0}
  .modal__box{position:relative;background:var(--card);border-radius:var(--radius);padding:26px 26px 28px;max-width:560px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 24px 60px rgba(0,0,0,.3)}
  .modal__x{position:absolute;top:12px;right:16px;font-size:26px;line-height:1;color:var(--muted);text-decoration:none}
  .modal__x:hover{color:var(--navy)}
  .modal__text{margin-top:4px;font-size:15px;line-height:1.7;color:#374151;white-space:pre-line}
  @media(max-width:520px){.summary{margin-left:0}.head{gap:12px}}
</style>
</head><body>
  <div class="wrap">
    <div class="head">
      <h2>${esc(t.heading)}</h2>
      <div class="summary"><span class="big">${ratingNum}</span><span class="stars">${stars(place.rating || 0, t.green)}</span><span class="cnt">${count.toLocaleString()} reviews</span></div>
      ${writeBtn}
    </div>
    <div class="grid">${cards}</div>
    <div class="foot"><a class="link" href="${esc(mapsUri)}" target="_blank" rel="noopener nofollow">See all reviews on Google &rarr;</a>${writeFoot}</div>
  </div>
  ${modals}
</body></html>`;
}

(async () => {
  const placeId = CONFIG.placeId || (await resolvePlaceId(CONFIG.searchQuery));
  const place = await fetchPlace(placeId);
  const html = buildHtml(place, placeId);
  const fs = await import("node:fs/promises");
  await fs.writeFile(CONFIG.outputPath, html, "utf8");
  console.log(`[generate-reviews] Wrote ${CONFIG.outputPath} (${(place.reviews || []).length} reviews, rating ${place.rating}, ${place.userRatingCount} total).`);
})();
