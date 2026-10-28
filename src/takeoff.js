// Takeoff import: reads a Trowel True export and turns it into rows the user picks from.
// Accepts the current export (format 'jobsite-tracker-export' with a `takeoff` block),
// the older Trowel True targets file ('jobsite-material-tracker/targets-v1'),
// and a plain job export (uses the job's materials as the takeoff).

const TRACK_CATS = ['CMU', 'Brick', 'Stone', 'Rebar'];

export function catOf(category, item, wg, kind) {
  if (wg === 'rebar' || barOf(item)) return 'Rebar';
  if (wg === 'mortar' || wg === 'grout') return 'Other';
  const t = String(item || '');
  const unitName = /^(bond beam|half block|bullnose|sash|cap|precast lintel|block \/ cmu|brick|soldier|rowlock|sailor|stone|cast stone (band|sill|veneer)|corner)/i.test(t);
  const unitLike = kind === 'unit' || (kind !== 'acc' && (unitName || !/cement|sand|aggregate|grout|insulation|joint reinforcement|flashing|weep|sealant|backer|angle|beam|plate|cleanout|drainage|anchor|\bties?\b|dowel|epoxy|lath|barrier|fastener|\bbars?\b|cuts|centering|termination|filler|coping/i.test(t)));
  if (!unitLike) return /^(masonry cement|mortar|mason sand|portland|lime|cpm|grout —|grout -|cement)/i.test(t) ? 'Other' : 'Accessories';
  if (/brick/i.test(category || '')) return 'Brick';
  if (/stone/i.test(category || '')) return 'Stone';
  if (/cmu|block/i.test(category || '')) return 'CMU';
  return 'Accessories';
}
// "#5 rebar, vertical @ 6'-8"" · "#5 jamb bar @ 4'-0"" · "#5 dowel, drilled & epoxied @ 3'-0" (footing)"
export function barOf(item) {
  const m = String(item || '').match(/^(#\d{1,2})\b[^@]*@\s*(\d+)'\s*-\s*(\d+(?:\.\d+)?)"/);
  if (!m) return null;
  return { bar: m[1], lengthIn: Math.round(Number(m[2]) * 12 + Number(m[3])) };
}
const ftin = i => `${Math.floor(i / 12)}'-${Math.round(i - Math.floor(i / 12) * 12)}"`;
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

/** Parse a file's JSON into {source, project, wasteIncluded, rows:[{key,name,cat,unit,net,gross,bar,lengthIn,lines,on}]} or throw. */
export function parseTakeoff(j) {
  let src = null;
  if (j && j.takeoff && Array.isArray(j.takeoff.items)) {
    src = { source: j.takeoff.source || 'Trowel True', project: j.takeoff.project || {}, wasteIncluded: false,
      lines: j.takeoff.items.map(x => ({ key: x.key || x.item, category: x.category, item: x.item, unit: x.unit, net: num(x.net), gross: num(x.gross ?? x.net), wg: x.wg, kind: x.kind, cat: x.cat })) };
  } else if (j && /^jobsite-material-tracker\/targets/.test(j.format || '') && Array.isArray(j.items)) {
    // Older Trowel True file: one quantity, with or without waste.
    src = { source: 'Trowel True', project: j.project || {}, wasteIncluded: !!j.wasteIncluded,
      lines: j.items.map(x => ({ key: x.item, category: x.category, item: x.item, unit: x.unit, net: num(x.targetQty), gross: num(x.targetQty) })) };
  } else if (j && j.format === 'jobsite-tracker-export' && Array.isArray(j.projects) && j.projects.length) {
    const p = j.projects[0];
    src = { source: j.source || 'export', project: p.data || {}, wasteIncluded: false,
      lines: ((p.collections || {}).items || []).map(d => d.data || {}).filter(x => x.required != null).map(x => ({ key: x.ttKey || x.name, category: x.cat, item: x.name, unit: x.unit, net: num(x.required), gross: num(x.required), cat: x.cat, bar: x.bar, lengthIn: x.lengthIn })) };
  }
  if (!src) throw new Error('not a takeoff');
  // Rebar of the same bar and piece length is one material in the yard, whatever its use in the wall.
  const rows = [], byBar = new Map();
  for (const l of src.lines) {
    if (!(l.net > 0) && !(l.gross > 0)) continue;
    const b = l.bar ? { bar: l.bar, lengthIn: l.lengthIn } : barOf(l.item);
    const cat = l.cat || catOf(l.category, l.item, l.wg, l.kind);
    if (b && b.lengthIn) {
      const k = `${b.bar}|${b.lengthIn}`;
      if (!byBar.has(k)) { const r = { key: 'rebar:' + k, name: `${b.bar} rebar @ ${ftin(b.lengthIn)}`, cat: 'Rebar', unit: 'EA', net: 0, gross: 0, bar: b.bar, lengthIn: b.lengthIn, lines: [], on: false }; byBar.set(k, r); rows.push(r); }
      const r = byBar.get(k); r.net += l.net; r.gross += l.gross; r.lines.push(l.item);
    } else rows.push({ key: l.key, name: l.item, cat, unit: l.unit || 'EA', net: l.net, gross: l.gross, bar: '', lengthIn: null, lines: [l.item], on: TRACK_CATS.includes(cat) && l.unit !== 'LF' && l.unit !== 'SF' });
  }
  for (const r of byBar.values()) r.on = r.net >= 5;
  const order = ['CMU', 'Brick', 'Stone', 'Rebar', 'Accessories', 'Other'];
  rows.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || (a.lengthIn || 0) - (b.lengthIn || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { ...src, rows };
}

/** Best existing material for a takeoff row: same takeoff key, same bar and length, or same name. */
export function matchItem(row, items) {
  const k = x => String(x || '').replace(/\|[A-Z ()0-9,.]+$/, '');
  return items.find(it => it.ttKey && k(it.ttKey) === k(row.key))
    || (row.bar && items.find(it => it.bar === row.bar && Number(it.lengthIn) === Number(row.lengthIn)))
    || items.find(it => normName(it.name) === normName(row.name))
    || null;
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
