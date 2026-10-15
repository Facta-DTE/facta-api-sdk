import { describe, expect, it } from "vitest";
import { canShowPdfInline, downloadProblem, parseRollWidth, ticketLabel, ticketUnavailable } from "../site/components/document-forms-logic.ts";

describe("roll width", () => {
  it("accepts only integers from 40 through 120", () => {
    for (const ok of ["40", "58", "80", "120", 80, " 100 "]) expect(parseRollWidth(ok)).not.toBeNull();
    for (const bad of ["39", "121", "8", "1000", "80.5", "abc", "", "-80", "٨٠"]) expect(parseRollWidth(bad)).toBeNull();
    expect(parseRollWidth("58")).toBe(58);
  });
  it("names the button after the width", () => expect(ticketLabel(80)).toBe("Ticket 80 mm"));
});

describe("when there is no ticket", () => {
  it("explains a return event and a contingency document instead of offering it", () => {
    expect(ticketUnavailable({ kind: "return-event" })).toMatch(/evento de retorno no tiene ticket/);
    expect(ticketUnavailable({ estado: "contingencia" })).toMatch(/contingencia/);
    expect(ticketUnavailable({ estado: "sellado" })).toBeNull();
    expect(ticketUnavailable({ estado: "invalidado" })).toBeNull();
    expect(ticketUnavailable({})).toBeNull();
  });
  it("maps a failed download to words, never to the raw error", () => {
    expect(downloadProblem({ code: "return_pdf_unavailable", status: 404 }, "ticket")).toBe("Un evento de retorno no tiene ticket.");
    expect(downloadProblem({ code: "not_sealed", status: 409 }, "json")).toMatch(/sello/);
    expect(downloadProblem({ code: "document_not_yours", status: 403 }, "pdf")).toMatch(/emitió/);
    expect(downloadProblem({ status: 500 }, "pdf")).toMatch(/Intente de nuevo/);
    expect(downloadProblem(null, "ticket")).toMatch(/Intente de nuevo/);
  });
});

describe("inline PDF preview", () => {
  it("is for desktop browsers with a viewer; phones and tablets get open/download", () => {
    expect(canShowPdfInline({ userAgent: "Mozilla/5.0 (Macintosh) Chrome/130", pdfViewerEnabled: true })).toBe(true);
    expect(canShowPdfInline({ userAgent: "Mozilla/5.0 (Macintosh) Chrome/130" })).toBe(true);
    expect(canShowPdfInline({ userAgent: "Mozilla/5.0 (Macintosh) Chrome/130", pdfViewerEnabled: false })).toBe(false);
    expect(canShowPdfInline({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", pdfViewerEnabled: true })).toBe(false);
    expect(canShowPdfInline({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 })).toBe(false);
    expect(canShowPdfInline({ userAgent: "Mozilla/5.0 (Linux; Android 15)", pdfViewerEnabled: true })).toBe(false);
  });
});
