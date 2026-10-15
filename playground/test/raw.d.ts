// The source-links test imports `shown-files.ts`, which reads files as text with Vite's `?raw`.
declare module "*?raw" {
  const text: string;
  export default text;
}
