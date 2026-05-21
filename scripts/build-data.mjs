import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://www.cyber.gc.ca";
const TOC_URL = "/en/guidance/cyber-security-privacy-risk-management/itsp10033";
const API = `${BASE}/api/cccs/page/v1/get?lang=en&url=`;

const outDir = "data";
const snapshotDir = join(outDir, "snapshots");
const publicDataDir = join("public", "data");

function decodeHtml(value = "") {
  return value
    .replace(/\\u003C/g, "<")
    .replace(/\\u003E/g, ">")
    .replace(/\\u0026/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, "-");
}

function htmlToText(html = "") {
  return decodeHtml(html)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slugFor(url) {
  return url.split("/").filter(Boolean).at(-1);
}

function normalizeId(id) {
  const match = id.match(/^([A-Z]{2})-(\d{1,3})(?:\s*\((\d{1,3})\))?$/);
  if (!match) return { canonicalId: id, displayId: id, family: id.slice(0, 2), sort: id };
  const [, family, number, enhancement] = match;
  const control = number.padStart(2, "0");
  const canonicalId = enhancement ? `${family}-${control}.${enhancement.padStart(2, "0")}` : `${family}-${control}`;
  const displayId = enhancement ? `${family}-${control} (${enhancement.padStart(2, "0")})` : `${family}-${control}`;
  return { canonicalId, displayId, family, sort: `${family}-${control}-${(enhancement || "0").padStart(3, "0")}` };
}

function normalizeCyberId(id) {
  return normalizeId(id.replace(/\((\d+)\)/, " ($1)"));
}

function parseOldYaml(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let i = 0;

  while (i < lines.length) {
    const header = lines[i].match(/^([A-Z]{2}-\d{1,3}(?: \(\d{1,3}\))?):\s*$/);
    if (!header) {
      i += 1;
      continue;
    }

    const sourceId = header[1];
    const item = { sourceId, ...normalizeId(sourceId) };
    i += 1;

    while (i < lines.length && !/^[A-Z]{2}-\d{1,3}(?: \(\d{1,3}\))?:\s*$/.test(lines[i])) {
      const line = lines[i];
      const field = line.match(/^  (family|name|description):\s*(.*)$/);
      if (!field) {
        i += 1;
        continue;
      }

      const [, key, raw] = field;
      if (key !== "description") {
        item[key] = raw.replace(/^['"]|['"]$/g, "");
        i += 1;
        continue;
      }

      if (raw.startsWith("|")) {
        const desc = [];
        i += 1;
        while (i < lines.length && /^    /.test(lines[i])) {
          desc.push(lines[i].slice(4));
          i += 1;
        }
        item.description = desc.join("\n").trim();
      } else {
        const desc = [raw.replace(/^['"]|['"]$/g, "")];
        i += 1;
        while (i < lines.length && /^    /.test(lines[i])) {
          desc.push(lines[i].slice(4));
          i += 1;
        }
        item.description = desc.join(" ").replace(/\\n/g, "\n").trim();
      }
    }

    item.type = item.canonicalId.includes(".") ? "enhancement" : "control";
    item.title = item.name || "";
    item.text = item.description || "";
    entries.push(item);
  }

  return entries;
}

async function fetchPage(urlPath) {
  await mkdir(snapshotDir, { recursive: true });
  const snapshot = join(snapshotDir, `${slugFor(urlPath)}.json`);
  if (existsSync(snapshot)) return JSON.parse(await readFile(snapshot, "utf8"));

  const res = await fetch(`${API}${encodeURIComponent(urlPath)}`);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${urlPath}`);
  const json = await res.json();
  await writeFile(snapshot, JSON.stringify(json, null, 2));
  return json;
}

function pageBody(json) {
  const body = json?.response?.page?.body;
  return Array.isArray(body) ? body.join("\n") : String(body || "");
}

function extractFamilyLinks(tocHtml) {
  const links = [];
  const re = /<a[^>]+href="([^"]*\/itsp10033\/[^"#]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = re.exec(tocHtml))) {
    const title = htmlToText(match[2]);
    if (!/^[A-Z]/.test(title)) continue;
    if (["Next", "Previous", "Table of Contents", "Foreword", "Overview", "Purpose", "Scope and applicability", "Audience", "Publication taxonomy", "Publication organization", "Requirements, controls, and activities", "Controls and assurance activities, structure, and organization", "Implementation approaches", "Security and privacy controls and assurance activities", "Robustness"].includes(title)) continue;
    if (/^\d\./.test(title) || title.startsWith("Figure")) continue;
    const url = match[1].replace(BASE, "");
    if (!links.some((link) => link.url === url)) links.push({ title, url });
  }
  return links;
}

function sectionHtml(chunk, heading) {
  const re = new RegExp(`<h3[^>]*>\\s*(?:<[^>]+>)*${heading}(?:<[^>]+>)*\\s*<\\/h3>([\\s\\S]*?)(?=<h3|<p><strong>(?:Enhancements|References):?<\\/strong>|<hr|$)`, "i");
  return chunk.match(re)?.[1] || "";
}

function parseRelated(text) {
  return text
    .replace(/^None\.?$/i, "")
    .split(",")
    .map((part) => part.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

function parseReferences(html) {
  const refs = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = re.exec(html))) refs.push({ title: htmlToText(match[2]), url: match[1].startsWith("/") ? `${BASE}${match[1]}` : decodeHtml(match[1]) });
  if (!refs.length && /^None\.?$/i.test(htmlToText(html))) return [];
  return refs;
}

function parseEnhancements(html, parent, sourceUrl) {
  const text = htmlToText(html);
  if (!text || /^None\.?$/i.test(text)) return [];

  const items = [];
  const re = /<li>\s*<strong>\((\d{1,3})\)\s*([\s\S]*?)<\/strong>([\s\S]*?)(?=\n?\s*<li>\s*<strong>\(\d{1,3}\)|<\/ul>\s*<h3|<\/ul>\s*<p><strong>References|$)/gi;
  let match;
  while ((match = re.exec(html))) {
    const [, num, rawTitle, rawBody] = match;
    const fullTitle = htmlToText(rawTitle);
    const id = `${parent.displayId} (${num.padStart(2, "0")})`;
    const parsed = normalizeCyberId(id);
    const body = htmlToText(rawBody);
    items.push({
      ...parsed,
      sourceId: id,
      parentId: parent.canonicalId,
      type: "enhancement",
      family: parent.family,
      title: fullTitle,
      text: body.replace(/^\s+/, ""),
      discussion: body.match(/Discussion:\s*([\s\S]*?)(?:Related controls and activities:|$)/)?.[1]?.trim() || "",
      related: parseRelated(body.match(/Related controls and activities:\s*([^\n]+)/)?.[1] || ""),
      withdrawn: /(^|\n)\s*Withdrawn:/i.test(body),
      sourceUrl,
    });
  }
  return items;
}

function parseFamilyPage(family, html) {
  const entries = [];
  const h2Re = /<h2[^>]*id="([^"]*-[A-Z]{2}-\d{2})"[^>]*>([\s\S]*?)<\/h2>/g;
  const headings = [];
  let match;
  while ((match = h2Re.exec(html))) {
    headings.push({ anchor: match[1], headingHtml: match[2], start: match.index, end: h2Re.lastIndex });
  }

  for (let index = 0; index < headings.length; index += 1) {
    const { anchor, headingHtml, end } = headings[index];
    const next = headings[index + 1]?.start ?? html.length;
    const chunk = html.slice(end, next);
    const heading = htmlToText(headingHtml);
    const headingMatch = heading.match(/^([A-Z]{2}-\d{2})\s+(.+)$/);
    if (!headingMatch) continue;

    const [, id, title] = headingMatch;
    const parsed = normalizeCyberId(id);
    const controlHtml = sectionHtml(chunk, "Control");
    const activityHtml = sectionHtml(chunk, "Activity");
    const discussionHtml = sectionHtml(chunk, "Discussion");
    const gcDiscussionHtml = sectionHtml(chunk, "GC discussion");
    const relatedHtml = sectionHtml(chunk, "Related controls and activities");
    const enhancementsHtml = sectionHtml(chunk, "Enhancements");
    const referencesHtml = sectionHtml(chunk, "References") || chunk.match(/<p><strong>References:<\/strong><\/p>([\s\S]*?)(?=<!--\*\* TOP OF PAGE|<hr>|$)/i)?.[1] || "";
    const sourceUrl = `${BASE}${family.url}#${anchor}`;

    const control = {
      ...parsed,
      sourceId: id,
      type: activityHtml ? "activity" : "control",
      title,
      familyTitle: family.title,
      text: htmlToText(controlHtml || activityHtml),
      discussion: htmlToText(discussionHtml),
      gcDiscussion: htmlToText(gcDiscussionHtml),
      related: parseRelated(htmlToText(relatedHtml)),
      references: parseReferences(referencesHtml),
      sourceUrl,
    };
    entries.push(control, ...parseEnhancements(enhancementsHtml, control, sourceUrl));
  }
  return entries;
}

function comparable(item) {
  return [item.title, item.text, item.discussion, item.gcDiscussion, (item.related || []).join(", ")].filter(Boolean).join("\n\n").replace(/\s+/g, " ").trim().toLowerCase();
}

function diffWords(oldText = "", newText = "") {
  const a = oldText.split(/\s+/).filter(Boolean);
  const b = newText.split(/\s+/).filter(Boolean);
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) rows[i][j] = a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  }
  const parts = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      parts.push({ t: "same", v: a[i++] });
      j += 1;
    } else if (rows[i + 1][j] >= rows[i][j + 1]) {
      parts.push({ t: "del", v: a[i++] });
    } else {
      parts.push({ t: "add", v: b[j++] });
    }
  }
  while (i < a.length) parts.push({ t: "del", v: a[i++] });
  while (j < b.length) parts.push({ t: "add", v: b[j++] });
  return parts.slice(0, 500);
}

function buildDiff(oldEntries, newEntries) {
  const oldMap = new Map(oldEntries.map((item) => [item.canonicalId, item]));
  const newMap = new Map(newEntries.map((item) => [item.canonicalId, item]));
  const ids = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort();
  return ids.map((id) => {
    const oldItem = oldMap.get(id);
    const newItem = newMap.get(id);
    let status = "unchanged";
    if (!oldItem) status = "added";
    else if (!newItem) status = "removed";
    else if (/withdrawn/i.test(newItem.text || "")) status = "withdrawn";
    else if (comparable(oldItem) !== comparable(newItem)) status = "changed";
    return {
      id,
      displayId: newItem?.displayId || oldItem?.displayId || id,
      family: newItem?.family || oldItem?.family,
      type: newItem?.type || oldItem?.type,
      status,
      old: oldItem || null,
      new: newItem || null,
      diff: oldItem && newItem && status !== "unchanged" ? diffWords(oldItem.text, newItem.text) : [],
    };
  });
}

function yamlScalar(value, indent = 2) {
  if (Array.isArray(value)) return value.length ? `\n${value.map((v) => `${" ".repeat(indent)}- ${JSON.stringify(v)}`).join("\n")}` : " []";
  if (value && typeof value === "object") return ` ${JSON.stringify(value)}`;
  const text = String(value ?? "");
  if (text.includes("\n") || text.length > 90) return ` |-\n${text.split("\n").map((line) => `${" ".repeat(indent)}${line}`).join("\n")}`;
  return ` ${JSON.stringify(text)}`;
}

function toYaml(entries) {
  return `name: ITSP.10.033\nsource: ${BASE}${TOC_URL}\nfetched_at: ${new Date().toISOString()}\ncontrols:\n${entries.map((item) => {
    const fields = ["canonicalId", "displayId", "sourceId", "family", "type", "title", "text", "discussion", "gcDiscussion", "related", "withdrawn", "sourceUrl"];
    return `  - ${fields.map((field, index) => {
      const value = item[field];
      if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return "";
      return `${index === 0 ? "" : "    "}${field}:${yamlScalar(value, 6)}`;
    }).filter(Boolean).join("\n")}`;
  }).join("\n")}\n`;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await mkdir(publicDataDir, { recursive: true });

  const oldText = await readFile("ITSG-33a.yaml", "utf8");
  const oldEntries = parseOldYaml(oldText);

  const toc = await fetchPage(TOC_URL);
  const familyLinks = extractFamilyLinks(pageBody(toc));
  const newEntries = [];
  for (const family of familyLinks) {
    const json = await fetchPage(family.url);
    newEntries.push(...parseFamilyPage(family, pageBody(json)));
  }

  const diffs = buildDiff(oldEntries, newEntries);
  const catalogue = {
    generatedAt: new Date().toISOString(),
    source: `${BASE}${TOC_URL}`,
    counts: {
      old: oldEntries.length,
      new: newEntries.length,
      added: diffs.filter((d) => d.status === "added").length,
      changed: diffs.filter((d) => d.status === "changed").length,
      removed: diffs.filter((d) => d.status === "removed").length,
      withdrawn: diffs.filter((d) => d.status === "withdrawn").length,
      unchanged: diffs.filter((d) => d.status === "unchanged").length,
    },
    families: familyLinks,
    diffs,
  };

  await writeFile(join(outDir, "itsg33a-normalized.json"), JSON.stringify(oldEntries, null, 2));
  await writeFile(join(outDir, "itsp10033.json"), JSON.stringify(newEntries, null, 2));
  await writeFile(join(outDir, "itsp10033.yaml"), toYaml(newEntries));
  await writeFile(join(outDir, "diff.json"), JSON.stringify(diffs, null, 2));
  await writeFile(join(publicDataDir, "catalogue.json"), JSON.stringify(catalogue));

  console.log(`Old entries: ${oldEntries.length}`);
  console.log(`New entries: ${newEntries.length}`);
  console.log(`Diffs: ${JSON.stringify(catalogue.counts)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
