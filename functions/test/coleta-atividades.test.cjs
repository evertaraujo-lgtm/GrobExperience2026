const assert = require("node:assert/strict");
const test = require("node:test");

const {conflictingActivityScanTime} = require("../lib/coleta-atividades.js");

const minute = 60 * 1000;
const firstScan = 1_700_000_000_000;

test("bloqueia uma nova leitura antes de 30 minutos", () => {
  assert.equal(conflictingActivityScanTime([firstScan], firstScan + 30 * minute - 1), firstScan);
});

test("aceita uma nova leitura após exatamente 30 minutos", () => {
  assert.equal(conflictingActivityScanTime([firstScan], firstScan + 30 * minute), undefined);
});

test("compara todas as leituras aceitas quando a fila offline chega fora de ordem", () => {
  const laterScan = firstScan + 60 * minute;
  assert.equal(conflictingActivityScanTime([firstScan, laterScan], firstScan + 35 * minute), laterScan);
  assert.equal(conflictingActivityScanTime([firstScan, laterScan], firstScan + 30 * minute), undefined);
  assert.equal(conflictingActivityScanTime([laterScan], firstScan + 29 * minute), undefined);
});

test("sem histórico, a primeira leitura é aceita", () => {
  assert.equal(conflictingActivityScanTime([], firstScan), undefined);
});
