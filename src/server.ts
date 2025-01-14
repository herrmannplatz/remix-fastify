import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  AppLoadContext,
  ServerBuild,
  ServerPlatform,
} from "@remix-run/server-runtime";
import { createRequestHandler as createRemixRequestHandler } from "@remix-run/server-runtime";
import type {
  RequestInit as NodeRequestInit,
  Response as NodeResponse,
} from "@remix-run/node";
import {
  // This has been added as a global in node 15+
  AbortController,
  Headers as NodeHeaders,
  Request as NodeRequest,
} from "@remix-run/node";

/**
 * A function that returns the value to use as `context` in route `loader` and
 * `action` functions.
 *
 * You can think of this as an escape hatch that allows you to pass
 * environment/platform-specific values through to your loader/action.
 */
export type GetLoadContextFunction = (
  request: FastifyRequest,
  reply: FastifyReply
) => AppLoadContext;

export type RequestHandler = ReturnType<typeof createRequestHandler>;

/**
 * Returns a request handler for Fastify that serves the response using Remix.
 */
export function createRequestHandler({
  build,
  getLoadContext,
  mode = process.env.NODE_ENV,
}: {
  build: ServerBuild;
  getLoadContext?: GetLoadContextFunction;
  mode?: string;
}) {
  let platform: ServerPlatform = {};
  let handleRequest = createRemixRequestHandler(build, platform, mode);

  return async (request: FastifyRequest, reply: FastifyReply) => {
    let abortController = new AbortController();
    let remixRequest = createRemixRequest(request, abortController);
    let loadContext =
      typeof getLoadContext === "function"
        ? getLoadContext(request, reply)
        : undefined;

    let response = (await handleRequest(
      remixRequest as unknown as Request,
      loadContext
    )) as unknown as NodeResponse;

    sendRemixResponse(reply, response, abortController);
  };
}

export function createRemixHeaders(
  requestHeaders: FastifyRequest["headers"]
): NodeHeaders {
  let headers = new NodeHeaders();

  for (let [header, values] of Object.entries(requestHeaders)) {
    if (!values) continue;

    if (Array.isArray(values)) {
      for (let value of values) {
        headers.append(header, value);
      }
    } else {
      headers.append(header, values);
    }
  }

  return headers;
}

export function createRemixRequest(
  request: FastifyRequest,
  abortController?: AbortController
): NodeRequest {
  let origin = `${request.protocol}://${request.hostname}`;
  let url = new URL(request.url, origin);

  let init: NodeRequestInit = {
    method: request.method,
    headers: createRemixHeaders(request.headers),
    signal: abortController?.signal,
    abortController,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body as any;
  }

  return new NodeRequest(url.href, init);
}

function sendRemixResponse(
  reply: FastifyReply,
  response: NodeResponse,
  abortController: AbortController
): void {
  reply.code(response.status);

  reply.headers(response.headers.raw());

  if (abortController.signal.aborted) {
    reply.headers({ Connection: "close" });
  }

  if (Buffer.isBuffer(response.body)) {
    reply.send(response.body);
  } else if (response.body?.pipe) {
    response.body.pipe(reply.raw);
  } else {
    reply.send();
  }
}
