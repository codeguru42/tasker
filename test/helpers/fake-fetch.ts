export interface FakeFetchRoute {
  url: string;
  status: number;
  body?: unknown;
}

export interface FakeFetchCall {
  url: string;
  authorization: string | null;
  signal: AbortSignal | undefined;
}

// A fetch that makes no network call. A URL of the routes resolves with a Response of the route status and the JSON of
// the body. Any other URL rejects with an Error that names the URL.
export function fakeFetch(routes: FakeFetchRoute[]): { fetch: typeof fetch; calls(): FakeFetchCall[] } {
  const calls: FakeFetchCall[] = [];
  const fakeFn = (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({
      url,
      authorization: new Headers(init?.headers).get("Authorization"),
      signal: init?.signal ?? undefined,
    });
    const route = routes.find((candidate) => candidate.url === url);
    if (route === undefined) return Promise.reject(new Error(`fakeFetch: no route for ${url}`));
    return Promise.resolve(new Response(JSON.stringify(route.body), { status: route.status }));
  };
  return { fetch: fakeFn, calls: () => [...calls] };
}
