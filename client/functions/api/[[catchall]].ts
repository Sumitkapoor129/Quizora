import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequest: PagesFunction = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  
  // Forward to backend preserving path and query
  const targetUrl = `https://quizora-ppfp.onrender.com${url.pathname}${url.search}`;
  
  const headers = new Headers(request.headers);
  // Let the origin set Host; forward as-is otherwise
  
  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  
  // Forward body for non-GET/HEAD requests
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    // @ts-ignore - duplex required for streaming bodies in some environments
    (init as any).duplex = 'half';
  }
  
  try {
    const response = await fetch(targetUrl, init);
    
    // Return response as-is, preserving status, statusText, and headers
    const responseHeaders = new Headers(response.headers);
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response('Proxy error', { status: 502 });
  }
};
