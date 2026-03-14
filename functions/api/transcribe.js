export async function onRequestPost(context) {
  const { request } = context;

  const groqKey = request.headers.get("X-Groq-Key");
  if (!groqKey) {
    return Response.json({ error: "Geen Groq API key meegegeven" }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) {
      return Response.json({ error: "Geen audiobestand meegegeven" }, { status: 400 });
    }

    // Build new FormData for Groq API
    const groqForm = new FormData();
    groqForm.append("file", file, file.name || "audio.webm");
    groqForm.append("model", formData.get("model") || "whisper-large-v3");

    const language = formData.get("language");
    if (language) {
      groqForm.append("language", language);
    }

    const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqKey}`,
      },
      body: groqForm,
    });

    if (!groqRes.ok) {
      const errorData = await groqRes.json().catch(() => ({}));
      const msg = errorData.error?.message || `Groq API fout (${groqRes.status})`;
      return Response.json({ error: msg }, { status: groqRes.status });
    }

    const result = await groqRes.json();
    return Response.json({ text: result.text || "" });
  } catch (e) {
    return Response.json({ error: "Transcriptie mislukt: " + e.message }, { status: 500 });
  }
}
