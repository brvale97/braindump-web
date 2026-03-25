export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const path = url.searchParams.get("path");
  if (!path) return new Response("Missing path", { status: 400 });

  const res = await fetch(
    `https://api.github.com/repos/brvale97/braindump-bram/contents/${path}`,
    {
      headers: {
        Authorization: `token ${context.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3.raw",
        "User-Agent": "braindump-web",
      },
    }
  );

  if (!res.ok) return new Response("Not found", { status: res.status });

  // Determine content type from path
  const ext = path.split(".").pop().toLowerCase();
  const types = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
  const contentType = types[ext] || "application/octet-stream";

  return new Response(res.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
