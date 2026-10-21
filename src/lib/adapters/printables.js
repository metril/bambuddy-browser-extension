// Printables adapter: anonymous GraphQL. Pure helpers + one fetch function with injected fetchImpl.
import { sanitizeFilename, classifyFile } from '../filenames.js';

export const GRAPHQL_URL = 'https://api.printables.com/graphql/';
const MEDIA = 'https://media.printables.com/';

export function parseModelId(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  const m = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?model\/(\d+)(?:-[^/?#]*)?\/?$/i.exec(u.pathname);
  return m ? m[1] : null;
}

export function buildPrintQuery(id) {
  return {
    query: 'query P($id: ID!){ print(id:$id){ id name premium user{publicUsername} image{filePath} license{name} stls{id name fileSize} gcodes{id name fileSize} otherFiles{id name fileSize} } }',
    variables: { id: String(id) },
  };
}

export function buildDownloadMutation(printId, fileType, fileId) {
  return {
    query: 'mutation G($printId: ID!, $files: [DownloadFileInput]!, $source: DownloadSourceEnum!){ getDownloadLink(printId:$printId, files:$files, source:$source){ ok errors{field messages} output{ link } } }',
    variables: { printId: String(printId), files: [{ fileType, ids: [String(fileId)] }], source: 'model_detail' },
  };
}

const gqlErrors = (json) => (Array.isArray(json?.errors) && json.errors.length
  ? json.errors.map((e) => e?.message || String(e)).join('; ') : null);

export function parsePrint(json) {
  const err = gqlErrors(json);
  if (err) throw new Error(`Printables error: ${err}`);
  const p = json?.data?.print;
  if (!p) throw new Error('Printables model not found');
  const files = [];
  for (const [key, group] of [['stls', 'stl'], ['gcodes', 'gcode'], ['otherFiles', 'other']]) {
    for (const f of p[key] || []) {
      if (f && f.id != null && f.name) files.push({ id: String(f.id), name: String(f.name), size: Number(f.fileSize) || 0, group });
    }
  }
  return {
    id: String(p.id),
    title: p.name || '',
    designer: p.user?.publicUsername || '',
    premium: !!p.premium,
    license: p.license?.name || '',
    thumbnailUrl: p.image?.filePath ? MEDIA + String(p.image.filePath).replace(/^\/+/, '') : '',
    files,
  };
}

export function selectFiles(print) {
  return (print?.files || []).filter((f) => {
    const k = classifyFile(f.name);
    if (f.group === 'gcode') return k === 'gcode3mf';
    return k === '3mf' || k === 'stl';
  });
}

export const fileTypeForGroup = (group) => (group === 'gcode' ? 'gcode' : group === 'other' ? 'other' : 'stl');

async function gql(fetchImpl, body) {
  const res = await fetchImpl(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  let json = null;
  try { json = await res.json(); } catch { /* fall through */ }
  if (!res.ok && !json) throw new Error(`Printables HTTP ${res.status}`);
  return json;
}

export async function fetchPrint(id, { fetchImpl = globalThis.fetch } = {}) {
  if (!id) throw new Error('Not a Printables model URL');
  return parsePrint(await gql(fetchImpl, buildPrintQuery(id)));
}

export async function fetchPrintablesModel(url, { fetchImpl = globalThis.fetch } = {}) {
  const print = await fetchPrint(parseModelId(url), { fetchImpl });
  if (print.premium) throw new Error('Printables Club / paid model — download it in Printables and upload manually');
  const selected = selectFiles(print);
  const files = [];
  for (const f of selected) {
    const json = await gql(fetchImpl, buildDownloadMutation(print.id, fileTypeForGroup(f.group), f.id));
    const err = gqlErrors(json);
    if (err) throw new Error(`Printables error: ${err}`);
    const out = json?.data?.getDownloadLink;
    const link = out?.output?.link;
    if (!out?.ok || !link) {
      const m = (out?.errors || []).flatMap((e) => e.messages || []).join('; ');
      throw new Error(`Printables download link failed for ${f.name}${m ? `: ${m}` : ''}`);
    }
    files.push({ url: link, filename: sanitizeFilename(f.name), sizeHint: f.size });
  }
  return {
    print,
    meta: { title: print.title, designer: print.designer, site: 'printables', pageUrl: url, thumbnailUrl: print.thumbnailUrl, license: print.license },
    files,
  };
}
