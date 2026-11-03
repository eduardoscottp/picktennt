import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvelope, requestHash, definitionHash, DomainError } from '../../lib/tournament-builder/requests';

test('operation envelopes reject identity injection and malformed revisions', () => {
  const valid = { operation_id: 'b27c31ec-0c66-4bf6-94c4-708432cd11a0', expected_revision: 0, data: {} };
  assert.deepEqual(parseEnvelope(valid), valid);
  for (const bad of [{ ...valid, actor_id: 'owner' }, { ...valid, expected_revision: -1 }, { ...valid, operation_id: 'retry' }, { ...valid, data: [] }]) {
    assert.throws(() => parseEnvelope(bad), DomainError);
  }
  assert.throws(() => parseEnvelope({ operation_id: valid.operation_id, data: {} }), DomainError);
  assert.equal(parseEnvelope({ operation_id: valid.operation_id, data: {} }, true).expected_revision, undefined);
});

test('retry hashes ignore object key order but bind resource, command and revision', () => {
  const a = requestHash('submitScore', 't1', 2, { score_a: 11, score_b: 9 });
  assert.equal(a, requestHash('submitScore', 't1', 2, { score_b: 9, score_a: 11 }));
  assert.notEqual(a, requestHash('submitScore', 't1', 3, { score_a: 11, score_b: 9 }));
  assert.notEqual(a, requestHash('submitScore', 't2', 2, { score_a: 11, score_b: 9 }));
  assert.notEqual(a, requestHash('attestScore', 't1', 2, { score_a: 11, score_b: 9 }));
});

test('definition hashes preserve ordered arrays', () => {
  assert.equal(definitionHash({ a: 1, b: 2 }), definitionHash({ b: 2, a: 1 }));
  assert.notEqual(definitionHash(['a', 'b']), definitionHash(['b', 'a']));
});
