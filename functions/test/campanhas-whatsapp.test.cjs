const assert = require("node:assert/strict");
const test = require("node:test");

const {campaignTemplateName, nextConsecutiveFailureCount} = require("../lib/campanhas-whatsapp.js");

test("acrescenta a frase depois do nome", () => {
  assert.equal(campaignTemplateName("Everton", "e família"), "Everton e família");
});

test("normaliza espaços e aceita uma frase vazia", () => {
  assert.equal(campaignTemplateName(" Everton ", "  convidado   especial  "), "Everton convidado especial");
  assert.equal(campaignTemplateName("Everton", ""), "Everton");
});

test("zera as falhas consecutivas depois de um envio aceito", () => {
  let failures = 0;
  [true, true, true, true, false, true].forEach((failed) => {
    failures = nextConsecutiveFailureCount(failures, failed);
  });
  assert.equal(failures, 1);
});

test("contabiliza cinco falhas consecutivas", () => {
  let failures = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    failures = nextConsecutiveFailureCount(failures, true);
  }
  assert.equal(failures, 5);
});
