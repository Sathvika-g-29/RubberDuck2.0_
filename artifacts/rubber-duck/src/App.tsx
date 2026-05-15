import React, { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Send, TerminalSquare, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

const SOLVED_PATTERNS = [
  /\b(found it|got it|fixed it|figured it out|i see it now|i see the problem|i see the bug|i see the issue)\b/i,
  /\b(oh i see|oh! i see|aha|eureka)\b/i,
  /\b(i understand now|now i understand|that('s| was) it|i('ve| have) got it)\b/i,
  /\b(solved|solved it|i solved|problem solved)\b/i,
  /\b(i('ve| have) fixed|i fixed it|the (bug|issue|problem) (is|was))\b/i,
  /\b(it('s| is) working|now it works|works now)\b/i,
];

const GIVE_UP_PATTERNS = [
  /\b(i give up|give up|i quit|i'm done|i am done)\b/i,
  /\b(just tell me|just give me the answer|what('s| is) the answer)\b/i,
  /\b(i can't (find|figure|see)|can't (find|figure|see) it)\b/i,
  /\b(tell me the (answer|bug|problem|issue)|reveal|show me the answer)\b/i,
];

type SessionState = "idle" | "describing" | "debugging" | "solved" | "revealed";
type ChatMode = "socratic" | "nudge" | "debrief" | "giveup";
type Message = { role: "user" | "assistant"; content: string };

const NUDGE_THRESHOLD = 7;
const GIVE_UP_THRESHOLD = 10;

function detectSolved(text: string) {
  return SOLVED_PATTERNS.some((p) => p.test(text));
}

function detectGiveUp(text: string) {
  return GIVE_UP_PATTERNS.some((p) => p.test(text));
}

function ExchangeBadge({ count }: { count: number }) {
  const isNudge = count >= NUDGE_THRESHOLD;
  const canGiveUp = count >= GIVE_UP_THRESHOLD;

  if (count === 0) return null;

  return (
    <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground/60 select-none">
      <span
        className={`px-2 py-0.5 rounded border transition-colors duration-500 ${
          canGiveUp
            ? "border-red-900/40 text-red-400/60 bg-red-950/20"
            : isNudge
              ? "border-amber-800/40 text-amber-400/60 bg-amber-950/20"
              : "border-border/40 text-muted-foreground/40 bg-secondary/20"
        }`}
      >
        {canGiveUp ? "nudge +" : isNudge ? "nudge" : "socratic"} · {count}
      </span>
      {canGiveUp && (
        <span className="text-red-400/50 animate-pulse">
          type &quot;i give up&quot; to reveal
        </span>
      )}
    </div>
  );
}

function Home() {
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const exchangeCount = messages.filter((m) => m.role === "assistant" && m.content.length > 0).length;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [inputValue]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming, isThinking]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    if (sessionState === "idle" && e.target.value.trim().length > 0) {
      setSessionState("describing");
    } else if (sessionState === "describing" && e.target.value.trim().length === 0) {
      setSessionState("idle");
    }
  };

  const streamResponse = async (newMessages: Message[], mode: ChatMode) => {
    setIsThinking(true);
    setMessages([...newMessages, { role: "assistant", content: "" }]);
    setIsStreaming(true);

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          mode,
          exchangeCount,
        }),
      });

      if (!res.ok) throw new Error("Stream request failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No readable stream");

      setIsThinking(false);
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const json = JSON.parse(line.slice(6));
              if (json.done) {
                setIsStreaming(false);
                return;
              }
              if (json.content) {
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  return [
                    ...prev.slice(0, -1),
                    { ...last, content: last.content + json.content },
                  ];
                });
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    } catch {
      setIsThinking(false);
      setIsStreaming(false);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = inputValue.trim();
    if (!text || isStreaming || isThinking) return;

    setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);

    // Terminal state detection
    if (sessionState === "debugging" && detectSolved(text)) {
      setSessionState("solved");
      streamResponse(newMessages, "debrief");
      return;
    }

    if (sessionState === "debugging" && exchangeCount >= GIVE_UP_THRESHOLD && detectGiveUp(text)) {
      setSessionState("revealed");
      streamResponse(newMessages, "giveup");
      return;
    }

    // Determine mode based on exchange count
    const mode: ChatMode = exchangeCount >= NUDGE_THRESHOLD ? "nudge" : "socratic";

    if (sessionState === "describing") {
      setSessionState("debugging");
    }

    streamResponse(newMessages, mode);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleRestart = () => {
    setSessionState("idle");
    setMessages([]);
    setInputValue("");
  };

  const isTerminal = sessionState === "solved" || sessionState === "revealed";

  const getPlaceholder = () => {
    if (sessionState === "idle") return "Describe your bug...";
    if (sessionState === "describing") return "Keep going...";
    if (exchangeCount >= GIVE_UP_THRESHOLD) return "Answer the duck... or type \"i give up\"";
    return "Answer the duck...";
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-background text-foreground dark">
      {/* Header */}
      <header className="flex-none p-4 md:p-6 border-b border-border/50 flex items-center justify-between z-10 bg-background/80 backdrop-blur-sm sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_15px_rgba(234,136,36,0.15)]">
            <TerminalSquare className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-mono font-medium tracking-tight text-foreground/90">Rubber Duck</h1>
            <p className="text-xs text-muted-foreground font-mono">Socratic Debugging Session</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {sessionState === "debugging" && <ExchangeBadge count={exchangeCount} />}
          {sessionState !== "idle" && (
            <button
              onClick={handleRestart}
              data-testid="button-new-session"
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-mono text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span className="hidden sm:inline">New Session</span>
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center w-full max-w-4xl mx-auto p-4 md:p-6 relative">

        {/* Idle state */}
        {sessionState === "idle" && messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center max-w-2xl mx-auto animate-in fade-in zoom-in duration-500 delay-150">
            <div className="w-24 h-24 mb-8 rounded-2xl bg-primary/5 flex items-center justify-center border border-primary/20 shadow-[0_0_30px_rgba(234,136,36,0.1)] relative">
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
              <TerminalSquare className="w-12 h-12 text-primary relative z-10" />
            </div>
            <h2 className="text-3xl md:text-4xl font-mono font-semibold mb-4 text-foreground/90">
              Talk to the duck.
            </h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-lg leading-relaxed">
              Describe your bug. I won&apos;t give you the answer, but I&apos;ll ask the right questions until you find it yourself.
            </p>
          </div>
        )}

        {/* Messages */}
        {messages.length > 0 && (
          <div className="flex-1 w-full space-y-6 pb-32 pt-4">
            {messages.map((msg, idx) => {
              const isLast = idx === messages.length - 1;
              const isDuck = msg.role === "assistant";
              const isDebriefMsg = (sessionState === "solved" || sessionState === "revealed") && isDuck && isLast;
              const isReveal = sessionState === "revealed" && isDuck && isLast;

              if (isDebriefMsg) {
                return (
                  <div key={idx} className="w-full flex justify-center animate-in slide-in-from-bottom-4 fade-in duration-500">
                    <div
                      className={`w-full max-w-3xl border rounded-xl p-6 relative overflow-hidden ${
                        isReveal
                          ? "bg-red-950/20 border-red-900/40 shadow-[0_0_40px_rgba(239,68,68,0.07)]"
                          : "bg-secondary/30 border-primary/30 shadow-[0_0_40px_rgba(234,136,36,0.1)]"
                      }`}
                    >
                      <div className={`absolute top-0 left-0 w-1 h-full ${isReveal ? "bg-red-500" : "bg-primary"}`} />
                      <div className={`flex items-center gap-3 mb-4 ${isReveal ? "text-red-400" : "text-primary"}`}>
                        <TerminalSquare className="w-5 h-5" />
                        <span className="font-mono text-sm font-semibold tracking-wider uppercase">
                          {isReveal ? "Answer" : "Debrief"}
                        </span>
                      </div>
                      <div className="prose prose-invert prose-p:leading-relaxed prose-pre:bg-background/50 prose-pre:border prose-pre:border-border/50 prose-a:text-primary max-w-none">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                        {isStreaming && isLast && (
                          <span className={`inline-block w-2 h-4 ml-1 align-middle cursor-blink ${isReveal ? "bg-red-400" : "bg-primary"}`} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  className={`w-full flex ${isDuck ? "justify-start" : "justify-end"} animate-in fade-in slide-in-from-bottom-2 duration-300`}
                >
                  <div className={`flex max-w-[85%] sm:max-w-[75%] gap-4 ${isDuck ? "flex-row" : "flex-row-reverse"}`}>
                    {isDuck && (
                      <div className="flex-none w-8 h-8 rounded bg-primary/10 border border-primary/20 flex items-center justify-center mt-1">
                        <TerminalSquare className="w-4 h-4 text-primary" />
                      </div>
                    )}
                    <div
                      className={`px-5 py-4 rounded-2xl text-[0.95rem] leading-relaxed relative ${
                        isDuck
                          ? "bg-secondary/40 border border-border/50 rounded-tl-sm text-foreground/90"
                          : "bg-primary/10 border border-primary/20 rounded-tr-sm text-foreground shadow-[0_0_15px_rgba(234,136,36,0.05)]"
                      }`}
                    >
                      <div className="prose prose-invert prose-sm max-w-none prose-p:m-0 prose-p:mb-2 last:prose-p:mb-0 prose-pre:bg-background/80 prose-pre:border prose-pre:border-border/50">
                        {isDuck ? (
                          <>
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                            {isStreaming && isLast && (
                              <span className="inline-block w-2 h-4 bg-primary ml-1 align-middle cursor-blink" />
                            )}
                          </>
                        ) : (
                          <div className="whitespace-pre-wrap font-mono text-sm">{msg.content}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {isThinking && (
              <div className="flex justify-start animate-in fade-in">
                <div className="flex max-w-[85%] gap-4">
                  <div className="flex-none w-8 h-8 rounded bg-primary/10 border border-primary/20 flex items-center justify-center mt-1">
                    <TerminalSquare className="w-4 h-4 text-primary" />
                  </div>
                  <div className="px-5 py-4 rounded-2xl bg-secondary/40 border border-border/50 rounded-tl-sm flex items-center gap-1.5 h-12">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Input */}
      <div
        className={`fixed bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-background via-background/95 to-transparent pt-12 transition-all duration-500 ease-in-out
          ${sessionState === "idle" ? "relative !bg-transparent !pt-0" : ""}
          ${isTerminal ? "opacity-0 pointer-events-none translate-y-8" : "opacity-100"}
        `}
      >
        <div className="max-w-3xl mx-auto relative">
          <form
            onSubmit={handleSubmit}
            className={`relative bg-secondary/40 border border-border/60 rounded-xl shadow-lg backdrop-blur-xl focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-300 ${
              sessionState === "idle" ? "shadow-[0_0_40px_rgba(234,136,36,0.08)] bg-secondary/20" : ""
            }`}
          >
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={getPlaceholder()}
              data-testid="input-message"
              className="w-full bg-transparent border-0 resize-none px-4 py-4 pr-14 text-foreground focus:ring-0 placeholder:text-muted-foreground/60 min-h-[60px] max-h-[200px] font-mono text-sm leading-relaxed"
              rows={1}
              disabled={isStreaming || isThinking || isTerminal}
            />
            <button
              type="submit"
              data-testid="button-send"
              disabled={!inputValue.trim() || isStreaming || isThinking || isTerminal}
              className="absolute right-2 bottom-2 p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:hover:bg-primary transition-all duration-200 shadow-sm"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          <div className="text-center mt-3">
            <span className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-widest">
              Shift + Enter for newline
            </span>
          </div>
        </div>
      </div>

      {/* Post-session restart */}
      {isTerminal && !isStreaming && (
        <div className="fixed bottom-0 left-0 right-0 p-6 flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
          <button
            onClick={handleRestart}
            data-testid="button-start-new-session"
            className="flex items-center gap-2 px-6 py-3 font-mono text-sm bg-secondary/60 border border-border/60 rounded-xl hover:border-primary/40 hover:bg-secondary/80 transition-all duration-200 text-foreground/80 hover:text-foreground"
          >
            <RotateCcw className="w-4 h-4" />
            Start new session
          </button>
        </div>
      )}
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
