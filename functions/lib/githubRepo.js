import {
  CATEGORY_LABELS,
  SORTED_FILES,
  SPACE_FILES,
  normalizeInboxItemText,
  parseInboxItems,
  parseOpenOverviewItems,
  projectPathFromInput,
  stripSortedTimestamp,
  titleFromProjectPath,
} from "./braindumpParser.js";

export const REPO_OWNER = "brvale97";
export const REPO_NAME = "braindump-bram";
export const BRANCH = "main";

class GitHubRepoError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "GitHubRepoError";
    this.status = status;
  }
}

function repoConfig(env) {
  return {
    owner: env.REPO_OWNER || REPO_OWNER,
    name: env.REPO_NAME || REPO_NAME,
    branch: env.REPO_BRANCH || BRANCH,
  };
}

function buildGitHubUrl(env, path) {
  const cfg = repoConfig(env);
  return `https://api.github.com/repos/${cfg.owner}/${cfg.name}/${path}`;
}

function headers(env, extra = {}) {
  return {
    Authorization: `token ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "braindump-web",
    ...extra,
  };
}

function decodeBase64(content) {
  return decodeURIComponent(escape(atob(content.replace(/\n/g, ""))));
}

function encodeBase64(content) {
  return btoa(unescape(encodeURIComponent(content)));
}

function localParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((entry) => entry.type !== "literal")
      .map((entry) => [entry.type, entry.value])
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

export function formatInboxTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(/\u200e/g, "");
}

export function formatSortedTimestamp(date = new Date()) {
  const parts = localParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function formatAuditDate(date = new Date()) {
  const parts = localParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatBacklogDate(date = new Date()) {
  return formatAuditDate(date);
}

export function formatAuditTimestamp(date = new Date()) {
  return date.toISOString();
}

export function authorFromRole(role = "bram") {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export async function githubRequest(env, path, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const response = await fetch(buildGitHubUrl(env, path), {
    ...rest,
    headers: headers(env, extraHeaders),
  });
  return response;
}

export async function getFile(env, filePath, { tolerate404 = false, noCache = false } = {}) {
  const cfg = repoConfig(env);
  const cacheBust = noCache ? `&_t=${Date.now()}` : "";
  const response = await githubRequest(
    env,
    `contents/${filePath}?ref=${cfg.branch}${cacheBust}`,
    noCache ? { headers: { "Cache-Control": "no-cache", "If-None-Match": "" } } : {}
  );

  if (response.status === 404 && tolerate404) return null;
  if (!response.ok) {
    throw new GitHubRepoError(`GitHub API error: ${response.status} (${filePath})`, response.status);
  }

  const data = await response.json();
  return { content: decodeBase64(data.content), sha: data.sha, data, path: filePath };
}

export async function listDirectory(env, dirPath, { tolerate404 = false } = {}) {
  const cfg = repoConfig(env);
  const response = await githubRequest(env, `contents/${dirPath}?ref=${cfg.branch}`);
  if (response.status === 404 && tolerate404) return [];
  if (!response.ok) {
    throw new GitHubRepoError(`GitHub API error: ${response.status} (${dirPath})`, response.status);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

export async function putFile(env, filePath, content, { sha, message } = {}) {
  const cfg = repoConfig(env);
  const response = await githubRequest(env, `contents/${filePath}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: encodeBase64(content),
      ...(sha ? { sha } : {}),
      branch: cfg.branch,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new GitHubRepoError(`GitHub commit error: ${response.status} - ${text}`, response.status);
  }

  const data = await response.json();
  return {
    commitSha: data.commit?.sha,
    contentSha: data.content?.sha,
    filePath,
    raw: data,
  };
}

export async function updateWithRetry(env, filePath, updateFn, message) {
  const attempt = async () => {
    const current = await getFile(env, filePath, { tolerate404: true });
    const nextContent = await updateFn(current ? current.content : null, current);
    if (typeof nextContent !== "string") {
      throw new Error(`Update for ${filePath} did not return string content`);
    }
    return putFile(env, filePath, nextContent, { sha: current?.sha, message });
  };

  try {
    return await attempt();
  } catch (error) {
    if (error.status !== 409 && !String(error.message).includes("409")) throw error;
    return attempt();
  }
}

function insertAfterSeparator(content, newLine) {
  const lines = (content || "").split("\n");
  let insertIndex = lines.findIndex((line) => line.trim() === "---");
  if (insertIndex === -1) {
    insertIndex = 1;
    while (insertIndex < lines.length && lines[insertIndex].trim() === "") insertIndex++;
  } else {
    insertIndex += 1;
  }

  lines.splice(insertIndex, 0, newLine);
  return lines.join("\n");
}

function insertBeforeNextSection(content, sectionHeader, newLine) {
  const lines = (content || "").split("\n");
  const sectionIndex = lines.findIndex((line) => line.trim().toLowerCase() === sectionHeader.toLowerCase());

  if (sectionIndex === -1) {
    lines.push("", sectionHeader, newLine);
    return lines.join("\n");
  }

  let insertIndex = sectionIndex + 1;
  while (insertIndex < lines.length && lines[insertIndex].trim() === "") insertIndex++;
  while (insertIndex < lines.length && !lines[insertIndex].startsWith("## ")) insertIndex++;
  lines.splice(insertIndex, 0, newLine);
  return lines.join("\n");
}

export async function appendInboxItem(env, { space, text, role = "bram", channel = "web" }) {
  const filePath = SPACE_FILES[space] || SPACE_FILES.personal;
  const author = authorFromRole(role);
  const timestamp = formatInboxTimestamp();
  const entry =
    space === "personal"
      ? `- ${text.trim()} *(${timestamp})*`
      : `- [${author}] ${text.trim()} *(${timestamp})*`;

  const result = await updateWithRetry(
    env,
    filePath,
    (content) => insertAfterSeparator(content || "", entry),
    `assistant(${channel}): ${text.trim().slice(0, 60)}`
  );

  return {
    kind: space === "personal" ? "append_inbox" : `append_${space}`,
    filesChanged: [filePath],
    commitSha: result.commitSha,
    summary:
      space === "personal"
        ? "Opgeslagen in inbox."
        : `Opgeslagen in ${space === "gep" ? "GeP inbox" : "gedeelde lijst"}.`,
    entry,
  };
}

export async function appendContextToItem(env, { space, parentItem, text, role = "bram", channel = "web" }) {
  const filePath = SPACE_FILES[space] || SPACE_FILES.personal;
  const timestamp = formatInboxTimestamp();
  const author = authorFromRole(role);
  const contextLine =
    space === "personal"
      ? `  - ${text.trim()} *(${timestamp})*`
      : `  - [${author}] ${text.trim()} *(${timestamp})*`;

  const result = await updateWithRetry(
    env,
    filePath,
    (content) => {
      const lines = (content || "").split("\n");
      const target = `- ${parentItem.trim()}`;
      const index = lines.findIndex((line) => line.trim() === target);
      if (index === -1) {
        throw new GitHubRepoError(`Parent item niet gevonden in ${filePath}`, 404);
      }
      let insertAt = index + 1;
      while (insertAt < lines.length && lines[insertAt].startsWith("  - ")) insertAt++;
      lines.splice(insertAt, 0, contextLine);
      return lines.join("\n");
    },
    `assistant(${channel}): context "${parentItem.trim().slice(0, 40)}"`
  );

  return {
    kind: "append_context",
    filesChanged: [filePath],
    commitSha: result.commitSha,
    summary: `Context toegevoegd in ${space === "personal" ? "inbox" : space}.`,
    entry: contextLine.trim(),
  };
}

export async function listCodeProjects(env) {
  const files = await listDirectory(env, SORTED_FILES.code, { tolerate404: true });
  return files
    .filter((file) => file.name.endsWith(".md"))
    .map((file) => ({ name: file.name, path: file.path }));
}

export async function createOrAppendProjectNote(
  env,
  { projectFile, projectTitle, text, channel = "web", description = "Nieuw projectbestand." }
) {
  const filePath = projectPathFromInput(projectFile, projectTitle);
  const title = projectTitle || titleFromProjectPath(filePath);
  const line = `- [${formatSortedTimestamp()}] ${text.trim()}`;

  const result = await updateWithRetry(
    env,
    filePath,
    (content) => {
      if (!content) {
        return [
          `# ${title}`,
          "",
          description,
          "",
          "## Ideeën & Taken",
          line,
          "",
          "## Notities",
          "",
        ].join("\n");
      }

      return insertBeforeNextSection(content, "## Ideeën & Taken", line);
    },
    `assistant(${channel}): project "${title}" ${text.trim().slice(0, 40)}`
  );

  return {
    kind: "create_project_note",
    filesChanged: [filePath],
    commitSha: result.commitSha,
    summary: `Toegevoegd aan Code > ${title}.`,
    entry: line,
    projectPath: filePath,
  };
}

export async function sortToCategory(env, { category, text, projectFile, projectTitle, channel = "web" }) {
  if (category === "code") {
    return createOrAppendProjectNote(env, { projectFile, projectTitle, text, channel });
  }

  const filePath = SORTED_FILES[category];
  if (!filePath || filePath.endsWith("/")) {
    throw new GitHubRepoError(`Onbekende categorie: ${category}`, 400);
  }

  const line = `- [${formatSortedTimestamp()}] ${text.trim()}`;
  const result = await updateWithRetry(
    env,
    filePath,
    (content) => {
      const body = content || `# ${CATEGORY_LABELS[category] || category}\n\n`;
      return body.endsWith("\n") ? `${body}${line}\n` : `${body}\n${line}\n`;
    },
    `assistant(${channel}): sort ${category} ${text.trim().slice(0, 40)}`
  );

  return {
    kind: "sort_to_category",
    filesChanged: [filePath],
    commitSha: result.commitSha,
    summary: `Direct gesorteerd naar ${CATEGORY_LABELS[category] || category}.`,
    entry: line,
  };
}

export async function markSortedItemDone(env, { category, itemText, channel = "web" }) {
  const sortedPath = SORTED_FILES[category];
  if (!sortedPath) throw new GitHubRepoError("Onbekende categorie", 400);

  const paths = sortedPath.endsWith("/")
    ? (await listDirectory(env, sortedPath)).filter((file) => file.name.endsWith(".md")).map((file) => file.path)
    : [sortedPath];

  for (const filePath of paths) {
    try {
      const result = await updateWithRetry(
        env,
        filePath,
        (content) => {
          const lines = (content || "").split("\n");
          let found = false;

          for (let index = 0; index < lines.length; index += 1) {
            const trimmed = lines[index].trim();
            if (!trimmed.startsWith("- ") && !trimmed.startsWith("* ")) continue;
            if (trimmed.includes("~~")) continue;

            const lineText = trimmed.slice(2);
            const stripped = stripSortedTimestamp(lineText);
            if (stripped === itemText || lineText === itemText) {
              const prefix = lines[index].match(/^(\s*[-*]\s*)/)?.[1] || "- ";
              lines[index] = `${prefix}~~${lineText}~~ ✅ done`;
              found = true;
              break;
            }
          }

          if (!found) {
            throw new GitHubRepoError("Item niet gevonden", 404);
          }

          return lines.join("\n");
        },
        `assistant(${channel}): done "${itemText.slice(0, 50)}"`
      );

      return {
        kind: "mark_done",
        filesChanged: [filePath],
        commitSha: result.commitSha,
        summary: "Item gemarkeerd als done.",
      };
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }

  throw new GitHubRepoError("Item niet gevonden", 404);
}

export async function loadAssistantContext(env, { targetSpace = "auto" } = {}) {
  const [personalFile, gepFile, sharedFile, workFile, fysiekFile, persoonlijkFile, somedayFile, codeProjects] =
    await Promise.all([
      getFile(env, SPACE_FILES.personal, { tolerate404: true }),
      getFile(env, SPACE_FILES.gep, { tolerate404: true }),
      getFile(env, SPACE_FILES.shared, { tolerate404: true }),
      getFile(env, SORTED_FILES.werk, { tolerate404: true }),
      getFile(env, SORTED_FILES.fysiek, { tolerate404: true }),
      getFile(env, SORTED_FILES.persoonlijk, { tolerate404: true }),
      getFile(env, SORTED_FILES.someday, { tolerate404: true }),
      listCodeProjects(env),
    ]);

  const codeProjectItems = [];
  for (const project of codeProjects.slice(0, 15)) {
    const file = await getFile(env, project.path, { tolerate404: true });
    codeProjectItems.push({
      project: titleFromProjectPath(project.path),
      path: project.path,
      openItems: parseOpenOverviewItems(file?.content || "")
        .filter((entry) => entry.type === "item")
        .slice(0, 3)
        .map((entry) => entry.text),
    });
  }

  const inboxes = {
    personal: summarizeInboxFile(personalFile?.content),
    gep: summarizeInboxFile(gepFile?.content),
    shared: summarizeInboxFile(sharedFile?.content),
  };

  const overview = {
    werk: summarizeSortedFile(workFile?.content),
    fysiek: summarizeSortedFile(fysiekFile?.content),
    persoonlijk: summarizeSortedFile(persoonlijkFile?.content),
    someday: summarizeSortedFile(somedayFile?.content),
    code: codeProjectItems,
  };

  return {
    targetSpace,
    inboxes,
    overview,
    codeProjects: codeProjects.map((project) => ({
      path: project.path,
      title: titleFromProjectPath(project.path),
    })),
  };
}

export async function appendJsonlEvent(env, filePath, event, message = "append jsonl event") {
  const line = typeof event === "string" ? event : JSON.stringify(event);
  const result = await updateWithRetry(
    env,
    filePath,
    (content) => (content && content.trim() ? `${content.trimEnd()}\n${line}\n` : `${line}\n`),
    message
  );

  return {
    filePath,
    commitSha: result.commitSha,
  };
}

function summarizeInboxFile(content) {
  return parseInboxItems(content || "")
    .slice(0, 12)
    .map((item) => normalizeInboxItemText(item.text));
}

function summarizeSortedFile(content) {
  return parseOpenOverviewItems(content || "")
    .filter((entry) => entry.type === "item")
    .slice(0, 12)
    .map((entry) => entry.text);
}

export { GitHubRepoError };
