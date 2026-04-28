import { apiFetch } from "./api.js";
import { showToast } from "./ui.js";
import { state } from "./state.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function clipboardImagesFromEvent(event) {
  const images = [];
  const clipboard = event.clipboardData || window.clipboardData;
  if (!clipboard) return images;
  const seen = new Set();

  for (const item of clipboard.items || []) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file && !seen.has(file)) {
        seen.add(file);
        images.push(file);
      }
    }
  }

  for (const file of clipboard.files || []) {
    if (file.type.startsWith("image/") && !seen.has(file)) {
      seen.add(file);
      images.push(file);
    }
  }

  return images;
}

export class UploadsController {
  constructor({ personalController, fileInput, attachButton, preview, dropZone, textarea }) {
    this.personalController = personalController;
    this.fileInput = fileInput;
    this.attachButton = attachButton;
    this.preview = preview;
    this.dropZone = dropZone;
    this.textarea = textarea;
  }

  bind() {
    this.attachButton.addEventListener("click", () => this.fileInput.click());
    this.fileInput.addEventListener("change", () => {
      this.addFiles(this.fileInput.files);
      this.fileInput.value = "";
    });

    this.dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      this.dropZone.classList.add("drag-over");
    });
    this.dropZone.addEventListener("dragleave", (event) => {
      if (!this.dropZone.contains(event.relatedTarget)) {
        this.dropZone.classList.remove("drag-over");
      }
    });
    this.dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      this.dropZone.classList.remove("drag-over");
      this.addFiles(event.dataTransfer.files);
    });

    const pasteHandler = async (event) => {
      const inboxTab = document.getElementById("tab-inbox");
      const appScreen = document.getElementById("app-screen");
      if (appScreen.classList.contains("hidden") || inboxTab.classList.contains("hidden")) return;
      const images = await clipboardImagesFromEvent(event);
      if (images.length === 0) return;
      event.preventDefault();
      this.addFiles(images);
      showToast(`${images.length} afbeelding${images.length > 1 ? "en" : ""} geplakt`);
    };

    this.textarea.addEventListener("paste", pasteHandler);
    document.addEventListener("paste", pasteHandler);
  }

  addFiles(files) {
    for (const file of files || []) {
      if (file.size > MAX_FILE_SIZE) {
        showToast(`${file.name} is te groot (max 10MB)`, "error");
        continue;
      }
      state.pendingFiles.push(file);
    }
    this.renderPreview();
  }

  renderPreview() {
    this.preview.innerHTML = "";
    if (state.pendingFiles.length === 0) {
      this.preview.classList.add("hidden");
      return;
    }
    this.preview.classList.remove("hidden");

    state.pendingFiles.forEach((file, index) => {
      const item = document.createElement("div");
      item.className = "upload-preview-item";
      if (file.type.startsWith("image/")) {
        const image = document.createElement("img");
        image.src = URL.createObjectURL(file);
        item.appendChild(image);
      } else {
        const name = document.createElement("span");
        name.className = "file-name";
        name.textContent = file.name;
        item.appendChild(name);
      }

      const remove = document.createElement("button");
      remove.className = "remove";
      remove.type = "button";
      remove.textContent = "\u00D7";
      remove.addEventListener("click", () => {
        state.pendingFiles.splice(index, 1);
        this.renderPreview();
      });
      item.appendChild(remove);
      this.preview.appendChild(item);
    });
  }

  clear() {
    state.pendingFiles = [];
    this.preview.innerHTML = "";
    this.preview.classList.add("hidden");
  }

  async uploadPendingFiles(caption = "") {
    const files = [...state.pendingFiles];
    if (files.length === 0) return [];
    const created = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const base64 = await readFileAsBase64(file);
      const isLast = index === files.length - 1;
      const data = await apiFetch("/api/upload", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          content: base64,
          caption: isLast ? caption : "",
        }),
      });
      if (data.item) {
        created.push(data.item);
        this.personalController.prependItem(data.item);
      }
    }

    this.clear();
    return created;
  }
}
