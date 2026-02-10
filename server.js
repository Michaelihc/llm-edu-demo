const express = require("express");
const multer = require("multer");
const path = require("path");
const OpenAI = require("openai");
const crypto = require("crypto");

require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;
const lessons = new Map();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiClient = openaiApiKey
  ? new OpenAI({ apiKey: openaiApiKey })
  : null;

const performImageSearch = async (query, count = 4) => {
  const searchParams = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrlimit: String(count),
    gsrsearch: query,
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: "800",
  });

  const response = await fetch(
    `https://commons.wikimedia.org/w/api.php?${searchParams.toString()}`,
  );
  if (!response.ok) {
    throw new Error("Image search failed.");
  }
  const payload = await response.json();
  const pages = payload?.query?.pages ? Object.values(payload.query.pages) : [];
  return pages
    .filter((page) => page.imageinfo?.length)
    .map((page) => ({
      title: page.title,
      url: page.imageinfo[0].url,
      pageUrl: `https://commons.wikimedia.org/wiki/${page.title}`,
    }));
};

const collectToolCalls = (response) => {
  const output = response?.output || [];
  return output.filter(
    (item) => item.type === "tool_call" || item.type === "function_call",
  );
};

const summarizeUploads = (files) =>
  files
    .map((file) => {
      const rawText = file.buffer.toString("utf8").slice(0, 4000);
      return `File: ${file.originalname}\n${rawText}`;
    })
    .join("\n\n");

app.get("/api/lessons", (_req, res) => {
  res.json(Array.from(lessons.values()));
});

app.post("/api/lessons", (req, res) => {
  const lesson = {
    id: crypto.randomUUID(),
    title: req.body.title || "Untitled lesson",
    gradeLevel: req.body.gradeLevel || "",
    duration: req.body.duration || "",
    objectives: req.body.objectives || "",
    content: req.body.content || "",
    resources: req.body.resources || [],
    updatedAt: new Date().toISOString(),
  };
  lessons.set(lesson.id, lesson);
  res.status(201).json(lesson);
});

app.put("/api/lessons/:id", (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) {
    res.status(404).json({ error: "Lesson not found" });
    return;
  }
  const updated = {
    ...lesson,
    title: req.body.title ?? lesson.title,
    gradeLevel: req.body.gradeLevel ?? lesson.gradeLevel,
    duration: req.body.duration ?? lesson.duration,
    objectives: req.body.objectives ?? lesson.objectives,
    content: req.body.content ?? lesson.content,
    resources: req.body.resources ?? lesson.resources,
    updatedAt: new Date().toISOString(),
  };
  lessons.set(updated.id, updated);
  res.json(updated);
});

app.delete("/api/lessons/:id", (req, res) => {
  if (!lessons.has(req.params.id)) {
    res.status(404).json({ error: "Lesson not found" });
    return;
  }
  lessons.delete(req.params.id);
  res.status(204).send();
});

app.post("/api/ai/lesson", upload.array("files"), async (req, res) => {
  if (!openaiClient) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
    return;
  }

  try {
    const {
      topic,
      gradeLevel,
      duration,
      objectives,
      includeWebSearch,
      imageSearchQuery,
      youtubeUrl,
    } = req.body;
    const resolvedImageQuery =
      imageSearchQuery?.trim() || `${topic || "lesson"} classroom illustration`;

    const contextFromFiles = req.files?.length
      ? summarizeUploads(req.files)
      : "No uploaded files provided.";

    const systemPrompt =
      "You are an assistant for teachers. Create structured lesson plans with citations. " +
      "If you use facts from web search, cite them inline like [1], [2]. " +
      "You may call the image_search tool to find image URLs and include them.";

    const userPrompt = `Build a lesson plan in markdown with sections: Overview, "Learning Objectives", "Materials", "Lesson Steps", "Assessment", and "Homework".\n\nTopic: ${topic || ""}\nGrade level: ${gradeLevel || ""}\nDuration: ${duration || ""}\nObjectives: ${objectives || ""}\n\nInclude any relevant citations for facts.\n\nUploaded context for RAG:\n${contextFromFiles}\n\nIf images are requested, call image_search with this query: ${resolvedImageQuery}\nYouTube link to include (if any): ${youtubeUrl || ""}`;

    const tools = [
      ...(includeWebSearch === "true" ? [{ type: "web_search" }] : []),
      {
        type: "function",
        name: "image_search",
        description: "Search for classroom-safe images and return direct URLs.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            count: { type: "number", default: 4 },
          },
          required: ["query"],
        },
      },
    ];

    let response = await openaiClient.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools,
    });

    let toolCalls = collectToolCalls(response);
    let safetyCounter = 0;

    while (toolCalls.length && safetyCounter < 3) {
      const toolOutputs = [];
      for (const call of toolCalls) {
        if (call.name !== "image_search") {
          continue;
        }
        let args = {};
        try {
          args =
            typeof call.arguments === "string"
              ? JSON.parse(call.arguments)
              : call.arguments || {};
        } catch (parseError) {
          args = { query: resolvedImageQuery };
        }
        const images = await performImageSearch(args.query, args.count);
        toolOutputs.push({
          tool_call_id: call.call_id,
          output: JSON.stringify({ results: images }),
        });
      }

      response = await openaiClient.responses.create({
        previous_response_id: response.id,
        tools,
        tool_outputs: toolOutputs,
      });
      toolCalls = collectToolCalls(response);
      safetyCounter += 1;
    }

    const lessonText = response.output_text || "";

    res.json({
      content: lessonText,
      citations: response.output?.[0]?.content || [],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Teacher portal running on http://localhost:${PORT}`);
});
