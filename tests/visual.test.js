const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.readUInt32BE(0), 0x89504e47, `${file} is not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const root = path.join(__dirname, '..');

test('store promo tile and screenshots use Chrome Web Store sizes', () => {
  const tile = pngSize(path.join(root, 'store', 'promo-440x280.png'));
  assert.deepEqual(tile, { width: 440, height: 280 });

  for (const name of [
    '1-watch-later-30min-budget.png',
    '2-shortest-first-sort.png',
    '3-hide-watched-toggle.png',
    '4-options-page.png',
  ]) {
    const size = pngSize(path.join(root, 'store', name));
    assert.deepEqual(size, { width: 1280, height: 800 }, name);
  }
});

test('visual before baselines are the previous 1280x800 and 440x280 shots', () => {
  const before = path.join(root, 'tests', 'visual', 'before');
  for (const name of ['1-watch-later-30min-budget.png', '7-popup.png']) {
    const size = pngSize(path.join(before, name));
    assert.equal(size.width, 1280);
    assert.equal(size.height, 800);
  }
  assert.deepEqual(pngSize(path.join(before, 'promo-440x280.png')), { width: 440, height: 280 });
});
