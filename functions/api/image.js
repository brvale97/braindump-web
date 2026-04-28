import { buildGitHubUrl, repoConfig } from "../lib/githubRepo.js";

const IMAGE_PATH_RE = /^uploads\/[\w./-]+\.(?:jpe?g|png|gif|webp|svg)$/i;
const CONTENT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const path = url.searchParams.get("path");

  if (!path || !IMAGE_PATH_RE.test(path)) {
    return new Response("Ongeldig pad", { status: 400 });
  }

  const extension = path.split(".").pop().toLowerCase();
  const cfg = repoConfig(context.env);
  const res = await fetch(buildGitHubUrl(context.env, `contents/${path}?ref=${cfg.branch}`), {
    headers: {
      Authorization: `token ${context.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3.raw",
      "User-Agent": "braindump-web",
    },
  });

  if (!res.ok) {
    return new Response("Not found", { status: res.status });
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
