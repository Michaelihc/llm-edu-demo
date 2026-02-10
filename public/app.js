const lessonForm = document.querySelector("#lesson-form");
const lessonList = document.querySelector("#lesson-list");
const lessonTemplate = document.querySelector("#lesson-card-template");
const generateButton = document.querySelector("#generate-ai");
const resetButton = document.querySelector("#reset-form");
const feedback = document.querySelector("#ai-feedback");

let activeLessonId = null;

const getFormData = () => {
  const formData = new FormData(lessonForm);
  const data = Object.fromEntries(formData.entries());
  data.includeWebSearch = formData.get("includeWebSearch") ? "true" : "false";
  data.resources = [];

  const imageSearchQuery = data.imageSearchQuery?.trim();
  const youtubeUrl = data.youtubeUrl?.trim();

  if (imageSearchQuery) {
    data.resources.push({ type: "image-search", query: imageSearchQuery });
  }
  if (youtubeUrl) {
    data.resources.push({ type: "youtube", url: youtubeUrl });
  }

  return { formData, data };
};

const renderLessons = (lessons) => {
  lessonList.innerHTML = "";
  lessons.forEach((lesson) => {
    const card = lessonTemplate.content.cloneNode(true);
    card.querySelector('[data-field="title"]').textContent = lesson.title;
    card.querySelector('[data-field="meta"]').textContent = `${lesson.gradeLevel || "Grade N/A"} · ${lesson.duration || "Duration N/A"}`;
    card.querySelector('[data-field="objectives"]').textContent =
      lesson.objectives || "No objectives yet.";
    card.querySelector('[data-field="content"]').textContent =
      lesson.content || "No content yet.";

    const resourcesList = card.querySelector('[data-field="resources"]');
    resourcesList.innerHTML = "";
    (lesson.resources || []).forEach((resource) => {
      const li = document.createElement("li");
      const detail = resource.url || resource.query || "";
      li.textContent = `${resource.type.toUpperCase()}: ${detail}`;
      resourcesList.appendChild(li);
    });

    card.querySelector('[data-action="edit"]').addEventListener("click", () => {
      activeLessonId = lesson.id;
      lessonForm.title.value = lesson.title;
      lessonForm.gradeLevel.value = lesson.gradeLevel;
      lessonForm.duration.value = lesson.duration;
      lessonForm.objectives.value = lesson.objectives;
      lessonForm.content.value = lesson.content;
      lessonForm.imageSearchQuery.value =
        (lesson.resources || []).find(
          (resource) => resource.type === "image-search",
        )?.query || "";
      lessonForm.youtubeUrl.value =
        (lesson.resources || []).find((resource) => resource.type === "youtube")
          ?.url || "";
    });

    card
      .querySelector('[data-action="delete"]')
      .addEventListener("click", async () => {
        await fetch(`/api/lessons/${lesson.id}`, { method: "DELETE" });
        await loadLessons();
      });

    lessonList.appendChild(card);
  });
};

const loadLessons = async () => {
  const response = await fetch("/api/lessons");
  const lessons = await response.json();
  renderLessons(lessons);
};

generateButton.addEventListener("click", async () => {
  const { formData } = getFormData();
  feedback.textContent = "Generating lesson with AI…";
  generateButton.disabled = true;

  try {
    const response = await fetch("/api/ai/lesson", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to generate lesson.");
    }

    lessonForm.content.value = payload.content;
    feedback.textContent =
      "AI lesson generated! Review, edit, and click Save when ready.";
  } catch (error) {
    feedback.textContent = `AI error: ${error.message}`;
  } finally {
    generateButton.disabled = false;
  }
});

lessonForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { data } = getFormData();

  const method = activeLessonId ? "PUT" : "POST";
  const url = activeLessonId ? `/api/lessons/${activeLessonId}` : "/api/lessons";

  await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  feedback.textContent = activeLessonId
    ? "Lesson updated."
    : "Lesson saved.";

  activeLessonId = null;
  lessonForm.reset();
  await loadLessons();
});

resetButton.addEventListener("click", () => {
  activeLessonId = null;
  lessonForm.reset();
  feedback.textContent = "";
});

loadLessons();
