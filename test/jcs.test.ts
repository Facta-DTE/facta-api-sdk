import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { canonicalJson, envelopeDigest, fingerprintV1, sha256HexOfText } from "../src/jcs.ts";
// @ts-ignore: plain ES module shared with the generator script
import { buildVectors, serializeVectors } from "../scripts/conformance-vectors.mjs";

const vectorsUrl = new URL("../conformance/fingerprint-v1.vectors.json", import.meta.url);

Deno.test("the committed conformance vectors equal what the generator produces now", async () => {
  const committed = await Deno.readTextFile(vectorsUrl);
  assertEquals(committed, serializeVectors(await buildVectors()));
});

Deno.test("canonicalJson matches every fingerprint-v1 vector", async () => {
  const vectors = JSON.parse(await Deno.readTextFile(vectorsUrl));
  assertEquals(vectors.fingerprintV1.length > 50, true);
  for (const vector of vectors.fingerprintV1) {
    const jcs = canonicalJson(JSON.parse(vector.input));
    assertEquals(jcs, vector.jcs, vector.name);
    assertEquals(await sha256HexOfText(jcs), vector.sha256, vector.name);
    assertEquals(await fingerprintV1(JSON.parse(vector.input)), vector.sha256, vector.name);
  }
});

Deno.test("envelopeDigest matches every vector", async () => {
  const vectors = JSON.parse(await Deno.readTextFile(vectorsUrl));
  assertEquals(vectors.envelopeDigest.length, 2);
  for (const vector of vectors.envelopeDigest) {
    assertEquals(JSON.stringify([vector.envelope]), vector.serialized, vector.name);
    assertEquals(vector.serialized.includes("\\/"), false, "slashes must not be escaped");
    assertEquals(await envelopeDigest(vector.envelope), vector.digest, vector.name);
  }
});

Deno.test("canonicalJson rejects values JSON cannot carry", () => {
  assertThrows(() => canonicalJson({ n: NaN }), TypeError);
  assertThrows(() => canonicalJson({ n: Infinity }), TypeError);
  assertThrows(() => canonicalJson({ n: 1n }), TypeError);
  assertEquals(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
});
