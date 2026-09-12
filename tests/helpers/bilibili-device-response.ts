/** Anonymous device endpoints shared by HTTP adapter fixtures; all other requests belong to the caller. */
export function bilibiliDeviceResponse(url: URL): Response | undefined {
  if (url.origin === 'https://www.bilibili.com' && url.pathname === '/') {
    return new Response('', {
      headers: { 'set-cookie': 'buvid3=fixture-buvid; Path=/' },
    });
  }
  if (url.pathname === '/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket') {
    return Response.json({
      code: 0,
      data: {
        ticket: 'fixture-ticket',
        created_at: Math.floor(Date.now() / 1000),
        ttl: 3600,
        nav: {
          img: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
          sub: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
        },
      },
    });
  }
  if (url.pathname === '/x/frontend/finger/spi')
    return Response.json({ code: 0, data: { b_4: 'fixture-buvid4' } });
  if (url.pathname === '/x/internal/gaia-gateway/ExClimbWuzhi')
    return Response.json({ code: 0, data: {} });
  return undefined;
}
