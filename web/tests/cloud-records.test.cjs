const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createJiti } = require('jiti');
const jiti = createJiti(__filename);
const { mergeDomains, splitRecords } = jiti('../src/services/cloud/records.ts');
const domain = ids => ({ name: 'assets', domainVersion: 1, data: { assets: ids.map(id => ({ id, name: id })) }, mediaRefs: [] });
const manifest = domains => ({ app: 'infinite-canvas', manifestVersion: 1, clientId: 'test', capturedAt: '2026-09-11T00:00:00Z', domains, files: [] });

test('three local and five distinct server assets merge to eight without mutating inputs', () => {
    const local = [domain(['a', 'b', 'c'])];
    const remote = [domain(['d', 'e', 'f', 'g', 'h'])];
    const merged = mergeDomains(local, remote);
    assert.equal(merged[0].data.assets.length, 8);
    assert.equal(local[0].data.assets.length, 3);
    assert.equal(mergeDomains(merged, remote)[0].data.assets.length, 8);
});
test('updates replace only matching IDs and empty input does not erase local data', () => {
    const local = [domain(['a', 'b'])];
    const changed = domain(['a']); changed.data.assets[0].name = 'updated';
    const result = mergeDomains(local, [changed]);
    assert.equal(result[0].data.assets[0].name, 'updated');
    assert.equal(result[0].data.assets[1].id, 'b');
    assert.deepEqual(mergeDomains(result, [domain([])]), result);
});
test('record identity and fingerprint ignore unrelated rows and capture timestamps', async () => {
    const one = await splitRecords(manifest([domain(['a'])]));
    const several = manifest([domain(['x', 'a'])]); several.capturedAt = '2026-09-12T00:00:00Z';
    const two = await splitRecords(several);
    assert.equal(one[0].key, two[1].key);
    assert.equal(one[0].hash, two[1].hash);
});
test('record extraction remaps media pointers and retains only referenced files', async () => {
    const source = manifest([domain(['a', 'b'])]);
    source.domains[0].data.assets[1].url = null;
    source.domains[0].mediaRefs = [{ pointer: '/assets/1/url', fileKey: 'file-a', representation: 'blob-url' }];
    source.files = [{ fileKey: 'file-a', sha256: 'a'.repeat(64), bytes: 3, mimeType: 'image/png', originalStorageKey: 'image:old' }];
    const records = await splitRecords(source);
    assert.equal(records[0].manifest.files.length, 0);
    assert.equal(records[1].manifest.domains[0].mediaRefs[0].pointer, '/assets/0/url');
    assert.equal(records[1].manifest.files[0].originalStorageKey, undefined);
});
test('configuration records merge individually and never erase other channels', () => {
    const settings = ids => ({ name: 'settings', domainVersion: 1, data: { items: ids.map(id => ({ id, value: id })) }, mediaRefs: [] });
    const result = mergeDomains([settings(['channel-a'])], [settings(['channel-b'])]);
    assert.equal(result[0].data.items.length, 2);
});
