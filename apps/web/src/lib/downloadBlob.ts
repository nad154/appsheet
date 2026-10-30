// Save a downloaded Blob to disk via a temporary object URL + <a download>.
// Mirrors downloadTemplateCsv in csvImport.ts (no server round trip involved);
// the filename comes from the API's Content-Disposition header.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
