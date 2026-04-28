import { apiFetch } from "./api.js";
import { showToast } from "./ui.js";

const GROQ_KEY = "braindump_groq_key_session";

export function getGroqKey() {
  return sessionStorage.getItem(GROQ_KEY) || "";
}

export class SettingsController {
  constructor({ settingsButton, modal, closeButton, input, saveButton, status, micButton, inboxInput }) {
    this.settingsButton = settingsButton;
    this.modal = modal;
    this.closeButton = closeButton;
    this.input = input;
    this.saveButton = saveButton;
    this.status = status;
    this.micButton = micButton;
    this.inboxInput = inboxInput;
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  bind() {
    this.updateMicVisibility();
    this.settingsButton.addEventListener("click", () => this.open());
    this.closeButton.addEventListener("click", () => this.close());
    this.modal.addEventListener("click", (event) => {
      if (event.target === this.modal) this.close();
    });
    this.saveButton.addEventListener("click", () => this.save());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.save();
      if (event.key === "Escape") this.close();
    });
    this.micButton.addEventListener("click", () => this.toggleRecording());
  }

  open() {
    this.status.classList.add("hidden");
    this.input.value = getGroqKey();
    this.modal.classList.remove("hidden");
    this.input.focus();
  }

  close() {
    this.modal.classList.add("hidden");
  }

  save() {
    const key = this.input.value.trim();
    if (key) {
      sessionStorage.setItem(GROQ_KEY, key);
      this.status.textContent = "Key opgeslagen voor deze sessie";
    } else {
      sessionStorage.removeItem(GROQ_KEY);
      this.status.textContent = "Key verwijderd";
    }
    this.status.classList.remove("hidden");
    this.updateMicVisibility();
    setTimeout(() => this.close(), 700);
  }

  updateMicVisibility() {
    this.micButton.classList.toggle("hidden", !getGroqKey());
  }

  async toggleRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      this.mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      this.mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) this.audioChunks.push(event.data);
      });
      this.mediaRecorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((track) => track.stop());
        this.micButton.classList.remove("recording");
        if (this.audioChunks.length === 0) return;
        const blob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType });
        this.micButton.disabled = true;
        try {
          const transcript = await this.transcribe(blob);
          if (transcript) {
            this.inboxInput.value = this.inboxInput.value ? `${this.inboxInput.value} ${transcript}` : transcript;
            this.inboxInput.dispatchEvent(new Event("input", { bubbles: true }));
            this.inboxInput.focus();
          }
        } catch (error) {
          showToast(error.message || "Transcriptie mislukt", "error");
        } finally {
          this.micButton.disabled = false;
          this.mediaRecorder = null;
        }
      });
      this.mediaRecorder.start();
      this.micButton.classList.add("recording");
    } catch (error) {
      showToast(error.message || "Microfoon niet beschikbaar", "error");
    }
  }

  async transcribe(blob) {
    const formData = new FormData();
    const extension = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "mp4" : "ogg";
    formData.append("file", blob, `audio.${extension}`);
    formData.append("model", "whisper-large-v3");
    formData.append("language", "nl");
    const data = await apiFetch("/api/transcribe", {
      method: "POST",
      headers: {
        "X-Groq-Key": getGroqKey(),
      },
      body: formData,
    });
    return data.text || "";
  }
}
