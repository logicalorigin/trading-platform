import { setBaseUrl } from "@workspace/api-client-react";

const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";

export const runtimeConfig = {
  apiBaseUrl: rawApiBaseUrl || null,
} as const;

setBaseUrl(runtimeConfig.apiBaseUrl);
