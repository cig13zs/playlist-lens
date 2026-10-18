// Copies src/ into dist/chrome and dist/firefox, adapts the manifest per browser, checks it, and
// zips both. No background script, so only Firefox's gecko settings differ.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const base = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));

const targets = {
  chrome: base,
  firefox: {
    ...base,
    // Firefox Add-ons caps names at 50 characters; the store title lives in the name on both stores.
    name: 'Playlist Lens: sort playlists by duration',
    browser_specific_settings: {
      gecko: { id: 'playlist-lens@jju1s', strict_min_version: '128.0', data_collection_permissions: { required: ['none'] } },
      gecko_android: { strict_min_version: '128.0' },
    },
  },
};

function check(name, m, dir) {
  const files = [
    ...Object.values(m.icons),
    ...Object.values(m.action.default_icon),
    m.action.default_popup,
    m.options_ui.page,
    ...m.content_scripts.flatMap(c => [...c.js, ...(c.css || [])]),
  ];
  const missing = files.filter(f => !fs.existsSync(path.join(dir, f)));
  const problems = [
    ...missing.map(f => `points at missing file ${f}`),
    m.manifest_version !== 3 && 'manifest_version must be 3',
    m.name.length > (name === 'firefox' ? 50 : 75) && 'name is too long for the store',
    m.description.length > 132 && 'description is over 132 characters',
    !/^\d+(\.\d+){0,3}$/.test(m.version) && 'version is not dotted numbers',
  ].filter(Boolean);
  if (problems.length) throw new Error(`${name} manifest: ${problems.join('; ')}`);
}

// Minimal deflate zip with fixed timestamps, so the same source gives the same bytes.
function zip(dir) {
  const files = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else files.push(p);
    }
  };
  walk(dir);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(path.relative(dir, file).split(path.sep).join('/'));
    const data = fs.readFileSync(file);
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);   // UTF-8 names
    local.writeUInt16LE(8, 8);        // deflate
    local.writeUInt16LE(0x21, 12);    // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, name, packed);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

fs.rmSync(dist, { recursive: true, force: true });
for (const [name, manifest] of Object.entries(targets)) {
  const out = path.join(dist, name);
  fs.cpSync(src, out, { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  check(name, manifest, out);
  const file = path.join(dist, `playlist-lens-${manifest.version}-${name}.zip`);
  fs.writeFileSync(file, zip(out));
  console.log(`${name}: dist/${name}/ and ${path.relative(root, file).split(path.sep).join('/')} (${fs.statSync(file).size} bytes)`);
}
