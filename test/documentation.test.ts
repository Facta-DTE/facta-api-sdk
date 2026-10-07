import { assert } from "jsr:@std/assert@1";

const reference = await Deno.readTextFile("guides/reference.md");
const clientSource = await Deno.readTextFile("src/client.ts");

Deno.test("method reference covers every public Facta client method", () => {
  const publicMethods = [
    "status",
    "diagnose",
    "syncDestinations",
    "syncCatalog",
    "catalogState",
    "listCustomers",
    "getCustomer",
    "searchCustomers",
    "listProducts",
    "getProduct",
    "searchProducts",
    "createCustomer",
    "updateCustomer",
    "deactivateCustomer",
    "createProduct",
    "updateProduct",
    "deactivateProduct",
    "issue",
    "issueAndArchive",
    "recoverOperation",
    "listPendingOperations",
    "replicateArchive",
    "diagnoseDestinations",
    "prepare",
    "sign",
    "getDocumentStatus",
    "listDocuments",
    "invalidate",
    "registerReturn",
    "invalidateAndArchive",
    "recoverInvalidation",
    "listPendingInvalidations",
    "downloadDocument",
    "print",
    "listHolding",
    "getContract",
    "getStorageStatus",
    "getDocumentCopies",
    "retryDocumentStorage",
    "deliverEmail",
    "deliverWhatsApp",
    "getDelivery",
    "waitForDelivery",
  ];

  for (const method of publicMethods) {
    assert(
      new RegExp(`\\b${method}\\s*\\(`).test(clientSource),
      `Expected ${method} to remain a public client method`,
    );
    assert(
      reference.includes("| `" + method + "("),
      `Expected the method reference to document ${method}`,
    );
  }
  assert(publicMethods.length === 43, "Update the method coverage list with the public API");
});

Deno.test("package Markdown links resolve to files or in-page anchors", async () => {
  const markdownFiles = ["README.md"];
  for await (const entry of Deno.readDir("guides")) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      markdownFiles.push(`guides/${entry.name}`);
    }
  }

  for (const markdownPath of markdownFiles) {
    const content = await Deno.readTextFile(markdownPath);
    const links = content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g);
    for (const [, target] of links) {
      if (/^(?:https?:|mailto:|#|\/)/.test(target)) continue;
      const path = target.split("#", 1)[0].split("?", 1)[0];
      if (!path) continue;
      const resolved = new URL(path, new URL(`file://${Deno.cwd()}/${markdownPath}`));
      let info;
      try {
        info = await Deno.stat(resolved);
      } catch {
        throw new Error(`${markdownPath} links to missing file: ${target}`);
      }
      assert(info.isFile, `${markdownPath} link target is not a file: ${target}`);
    }
  }
});

Deno.test("runtime and catalog guides have equivalent Spanish and English structure", async () => {
  for (const stem of ["catalog", "catalog-write", "storage-adapters", "node", "deno"]) {
    const english = await Deno.readTextFile(`guides/${stem}.md`);
    const spanish = await Deno.readTextFile(`guides/${stem}.es.md`);
    const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;
    assert(
      count(english, /^## /gm) === count(spanish, /^## /gm),
      `${stem} guides should cover the same number of sections`,
    );
    assert(
      count(english, /^```/gm) === count(spanish, /^```/gm),
      `${stem} guides should retain equivalent code examples`,
    );
    assert(spanish.includes(`(${stem}.md)`), `${stem}.es.md should link to English`);
    assert(english.includes(`(${stem}.es.md)`), `${stem}.md should link to Spanish`);
  }
});

Deno.test("document listing describes recipient privacy and rejected lookup limits", () => {
  const row = reference.split("\n").find((line) => line.startsWith("| `listDocuments("));
  assert(row?.includes("private-mode encryption at rest does not hide these fields"));
  assert(row?.includes("Rejected reservations are queried by generation code"));
});
