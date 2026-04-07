import axios from "axios";
import { apiUrl } from "./api";

export async function downloadApiPdf(path, { params = {}, filename = "report.pdf" } = {}) {
  const response = await axios.get(apiUrl(path), {
    params,
    responseType: "blob",
  });

  const blob = new Blob([response.data], {
    type: response.headers["content-type"] || "application/pdf",
  });
  const objectUrl = globalThis.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  globalThis.setTimeout(() => {
    globalThis.URL.revokeObjectURL(objectUrl);
  }, 250);
}
