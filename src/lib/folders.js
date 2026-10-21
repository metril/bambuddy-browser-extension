// Flatten the Bambuddy folder tree (nested or flat with parent_id) for pickers.

const byName = (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''));

export function flattenFolders(tree) {
  if (!Array.isArray(tree)) return [];
  const hasNested = tree.some((f) => Array.isArray(f?.children) && f.children.length);
  let roots = tree.filter(Boolean);
  if (!hasNested) {
    const ids = new Set(roots.map((f) => f.id));
    const kids = new Map();
    const top = [];
    for (const f of roots) {
      if (f.parent_id != null && ids.has(f.parent_id)) {
        if (!kids.has(f.parent_id)) kids.set(f.parent_id, []);
        kids.get(f.parent_id).push(f);
      } else top.push(f);
    }
    roots = top.map(function attach(f) {
      return { ...f, children: (kids.get(f.id) || []).map(attach) };
    });
  }
  const out = [];
  const walk = (nodes, depth, parentPath) => {
    for (const f of [...nodes].sort(byName)) {
      const path = parentPath ? `${parentPath}/${f.name}` : String(f.name);
      out.push({ id: f.id, name: f.name, depth, path });
      if (Array.isArray(f.children)) walk(f.children, depth + 1, path);
    }
  };
  walk(roots, 0, '');
  return out;
}
