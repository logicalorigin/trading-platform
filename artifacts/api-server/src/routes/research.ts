import { Router, type IRouter } from "express";
import {
  GetResearchEarningsCalendarQueryParams,
  GetResearchEarningsCalendarResponse,
  GetResearchFundamentalsQueryParams,
  GetResearchFundamentalsResponse,
  GetResearchSecFilingsQueryParams,
  GetResearchSecFilingsResponse,
  GetResearchStatusResponse,
  GetResearchTranscriptQueryParams,
  GetResearchTranscriptResponse,
  GetResearchTranscriptsQueryParams,
  GetResearchTranscriptsResponse,
} from "@workspace/api-zod";
import {
  getResearchCalendar,
  getResearchFilings,
  getResearchFundamentals,
  getResearchStatus,
  getResearchTranscript,
  getResearchTranscriptDates,
} from "../services/research";

const router: IRouter = Router();

function coerceDateQueryFields<T extends Record<string, unknown>>(
  input: T,
  keys: string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input };

  keys.forEach((key) => {
    const value = output[key];

    if (typeof value === "string" && value.trim()) {
      output[key] = new Date(value);
    }
  });

  return output;
}

router.get("/research/status", async (_req, res) => {
  const data = GetResearchStatusResponse.parse(await getResearchStatus());

  res.json(data);
});

router.get("/research/fundamentals", async (req, res) => {
  const query = GetResearchFundamentalsQueryParams.parse(req.query);
  const data = GetResearchFundamentalsResponse.parse(
    await getResearchFundamentals(query),
  );

  res.json(data);
});

router.get("/research/earnings-calendar", async (req, res) => {
  const query = GetResearchEarningsCalendarQueryParams.parse(
    coerceDateQueryFields(req.query as Record<string, unknown>, ["from", "to"]),
  );
  const data = GetResearchEarningsCalendarResponse.parse(
    await getResearchCalendar(query),
  );

  res.json(data);
});

router.get("/research/sec-filings", async (req, res) => {
  const query = GetResearchSecFilingsQueryParams.parse(req.query);
  const data = GetResearchSecFilingsResponse.parse(await getResearchFilings(query));

  res.json(data);
});

router.get("/research/transcripts", async (req, res) => {
  const query = GetResearchTranscriptsQueryParams.parse(req.query);
  const data = GetResearchTranscriptsResponse.parse(
    await getResearchTranscriptDates(query),
  );

  res.json(data);
});

router.get("/research/transcript", async (req, res) => {
  const query = GetResearchTranscriptQueryParams.parse(req.query);
  const data = GetResearchTranscriptResponse.parse(
    await getResearchTranscript(query),
  );

  res.json(data);
});

export default router;
