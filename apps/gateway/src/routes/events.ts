import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  EventPageSchema,
  ListEventsQuerySchema,
  ProblemDetailsSchema,
  type EventDto,
} from "@website/contracts";
import { isRegistrationOpen, type EventEntity } from "@website/domain/events";
import type { GatewayDeps, GatewayVariables } from "../types";

export function toEventDto(event: EventEntity, now: Date): EventDto {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    summary: event.summary,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    timezone: event.timezone,
    location: event.location,
    chapterId: event.chapterId,
    registrationOpen: isRegistrationOpen(event, now),
    updatedAt: event.updatedAt.toISOString(),
  };
}

const problemContent = { "application/problem+json": { schema: ProblemDetailsSchema } };

const listEventsRoute = createRoute({
  method: "get",
  path: "/events",
  summary: "List published events",
  security: [{ ApiKey: [] }],
  request: { query: ListEventsQuerySchema },
  responses: {
    200: {
      description: "A page of events",
      content: { "application/json": { schema: EventPageSchema } },
    },
    400: { description: "Invalid query", content: problemContent },
    401: { description: "Missing or invalid API key", content: problemContent },
    403: { description: "Missing scope events.read", content: problemContent },
    429: { description: "Rate limited", content: problemContent },
  },
});

export function eventRoutes(deps: GatewayDeps) {
  const app = new OpenAPIHono<{ Variables: GatewayVariables }>();
  app.openapi(listEventsRoute, async (c) => {
    const query = c.req.valid("query");
    const page = await deps.events.listPublished({
      limit: query.limit,
      ...(query.chapterId !== undefined && { chapterId: query.chapterId }),
      ...(query.cursor !== undefined && { cursor: query.cursor }),
      ...(query.updatedSince !== undefined && { updatedSince: new Date(query.updatedSince) }),
    });
    const now = deps.now();
    return c.json(
      { data: page.items.map((e) => toEventDto(e, now)), nextCursor: page.nextCursor },
      200,
    );
  });
  return app;
}
