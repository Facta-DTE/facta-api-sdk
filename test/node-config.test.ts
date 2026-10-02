import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createFactaFromConfigFile } from "../src/node-config.ts";

Deno.test("Node config file loads an explicit profile and programmatic values win", async () => {
  const directory = await Deno.makeTempDir({ prefix: "facta-config-test-" });
  const path = directory + "/facta.json";
  try {
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        version: 1,
        baseUrl: "https://file.example.test/api-v1",
        ticketPaperWidthMm: 58,
      }),
    );
    let url = "";
    const facta = await createFactaFromConfigFile({
      configFile: path,
      apiKey: "facta_test_a.bbbbbbbbbbbbbbbb",
      config: { version: 1, baseUrl: "https://override.example.test/api-v1" },
      fetch: ((input: string | URL | Request) => {
        url = String(input);
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as typeof globalThis.fetch,
    });
    await facta.downloadDocument("ABC-123", "ticket");
    assertEquals(
      url,
      "https://override.example.test/api-v1/v1/dte/ABC-123/file?kind=ticket&paperWidthMm=58",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Node config file rejects unknown keys and does not load credentials", async () => {
  const directory = await Deno.makeTempDir({ prefix: "facta-config-test-" });
  const path = directory + "/facta.json";
  try {
    await Deno.writeTextFile(
      path,
      JSON.stringify({ version: 1, apiKey: "should-not-be-here" }),
    );
    await assertRejects(
      () =>
        createFactaFromConfigFile({
          configFile: path,
          apiKey: "facta_test_a.bbbbbbbbbbbbbbbb",
        }),
      TypeError,
      "Unknown Facta config key: apiKey",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
