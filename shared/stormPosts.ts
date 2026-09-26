export const STORM_POST_WINDOW_MS = 72 * 60 * 60 * 1000;
export const STORM_POST_LIMIT = 6;

export const STORM_SEARCH_URL =
  "https://x.com/search?q=" +
  encodeURIComponent('("Broome County" OR Binghamton OR "Southern Tier") (nor\'easter OR noreaster OR "nor easter")') +
  "&f=live";

const STORM_TERMS = /\b(?:nor['’`]?easters?|noreasters?|rains?|showers?|flood(?:ing|ed|s)?|winds?|i-?\s*81)\b/i;
const LOCAL_PLACE = /\b(?:broome|binghamton|southern tier|endicott|vestal|johnson city|conklin|i-?\s*81|catskills?|nepa|northeast(?:ern)? pa|central ny|central new york)\b/i;
const COASTAL_ONLY = /\b(?:new york city|nyc|boston|outer banks)\b/i;
const ROUTINE_OBS = /\bcurrent weather in binghamton\b/i;

export interface StormPostCandidate {
  text: string;
  createdAt?: string | number | null;
  author?: string;
}

export interface StormPost {
  id: string;
  text: string;
  createdAt: string;
  author: string;
  authorName: string;
  url: string;
  imageUrl: string | null;
}

function createdMillis(createdAt: string | number): number {
  if (typeof createdAt === "number") return createdAt > 1e12 ? createdAt : createdAt * 1000;
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** Keep a recent local storm post. Coastal-only headlines and name collisions stay out. */
export function isBroomeStormPost(post: StormPostCandidate, now = Date.now()): boolean {
  if (post.createdAt !== undefined && post.createdAt !== null && post.createdAt !== "") {
    const posted = createdMillis(post.createdAt);
    if (Number.isFinite(posted) && now - posted > STORM_POST_WINDOW_MS) return false;
  }
  const text = post.text.replace(/\s+/g, " ").trim();
  if (!text || ROUTINE_OBS.test(text)) return false;
  const withoutNames = text.replace(/\b[A-Z][a-z]+ Flood\b/g, " ");
  if (!STORM_TERMS.test(withoutNames)) return false;
  if (COASTAL_ONLY.test(text) && !LOCAL_PLACE.test(text)) return false;
  return true;
}

function postMillis(row: Record<string, unknown>): number {
  const stamp = row.created_timestamp;
  if (typeof stamp === "number" && Number.isFinite(stamp)) return stamp > 1e12 ? stamp : stamp * 1000;
  if (typeof row.created_at === "string") return createdMillis(row.created_at);
  return NaN;
}

function photoUrl(row: Record<string, unknown>): string | null {
  const media = row.media;
  if (!media || typeof media !== "object") return null;
  const photos = (media as { photos?: Array<{ url?: string }> }).photos;
  if (Array.isArray(photos) && photos[0]?.url) return photos[0].url;
  const all = (media as { all?: Array<{ thumbnail_url?: string }> }).all;
  if (Array.isArray(all)) {
    const thumb = all.find(item => item?.thumbnail_url);
    if (thumb?.thumbnail_url) return thumb.thumbnail_url;
  }
  return null;
}

/** Turn a timeline payload into the posts the dashboard shows. */
export function selectStormPosts(results: unknown, now = Date.now()): StormPost[] {
  if (!Array.isArray(results)) return [];
  const posts: StormPost[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type && row.type !== "status") continue;
    const text = String(row.text || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const authorRecord = row.author && typeof row.author === "object" ? row.author as Record<string, unknown> : {};
    const author = String(authorRecord.screen_name || "NWSBinghamton");
    const posted = postMillis(row);
    if (!isBroomeStormPost({ text, createdAt: Number.isFinite(posted) ? posted : undefined, author }, now)) continue;
    const id = String(row.id || "");
    if (!id) continue;
    posts.push({
      id,
      text,
      createdAt: Number.isFinite(posted) ? new Date(posted).toISOString() : new Date(now).toISOString(),
      author,
      authorName: String(authorRecord.name || author),
      url: typeof row.url === "string" && row.url ? row.url : `https://x.com/${author}/status/${id}`,
      imageUrl: photoUrl(row),
    });
    if (posts.length >= STORM_POST_LIMIT) break;
  }
  return posts;
}
