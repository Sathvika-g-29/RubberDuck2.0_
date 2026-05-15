import { Router, type IRouter } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { StreamChatBody } from "@workspace/api-zod";
import {
  SOCRATIC_SYSTEM_PROMPT,
  NUDGE_SYSTEM_PROMPT,
  DEBRIEF_SYSTEM_PROMPT,
  GIVE_UP_SYSTEM_PROMPT,
} from "../../lib/prompts";

const router: IRouter = Router();

function selectSystemPrompt(
  mode: "socratic" | "nudge" | "debrief" | "giveup",
): string {
  switch (mode) {
    case "nudge":
      return NUDGE_SYSTEM_PROMPT;
    case "debrief":
      return DEBRIEF_SYSTEM_PROMPT;
    case "giveup":
      return GIVE_UP_SYSTEM_PROMPT;
    case "socratic":
    default:
      return SOCRATIC_SYSTEM_PROMPT;
  }
}

router.post("/chat/stream", async (req, res): Promise<void> => {
  const parsed = StreamChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { messages, mode } = parsed.data;
  const systemPrompt = selectSystemPrompt(mode);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const anthropicMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages: anthropicMessages,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
    }
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

export default router;
