// Node 22+ reads `node --test tests/` as a file path, resolving index.js; this runs every test file.
const fs = require('node:fs');
const path = require('node:path');
for (const f of fs.readdirSync(__dirname)) {
  if (f.endsWith('.test.js')) {
    require(path.join(__dirname, f));
  }
}
