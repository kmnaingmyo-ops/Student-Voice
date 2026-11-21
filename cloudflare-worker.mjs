// Cloudflare provides the public address. The application runs on Render.
const origin = 'https://student-voice-p2mf.onrender.com';

export default {
    async fetch(request) {
        const publicUrl = new URL(request.url);
        const upstreamUrl = new URL(origin);
        upstreamUrl.pathname = publicUrl.pathname;
        upstreamUrl.search = publicUrl.search;

        const headers = new Headers(request.headers);
        for (const name of ['host', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-forwarded-for', 'x-real-ip']) {
            headers.delete(name);
        }

        const upstream = await fetch(upstreamUrl, {
            method: request.method,
            headers,
            body: request.body,
            redirect: 'manual',
            cache: 'no-store',
        });

        const location = upstream.headers.get('location');
        if (!location || !location.startsWith(origin + '/')) return upstream;

        const response = new Response(upstream.body, upstream);
        response.headers.set('location', publicUrl.origin + location.slice(origin.length));
        return response;
    },
};
