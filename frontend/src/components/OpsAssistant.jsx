import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { apiUrl } from "../lib/api";

const RADAR_AI_LOGO_SRC = "/favicon.svg";
const BOTTOM_SCROLL_THRESHOLD_PX = 36;

const VIEW_TITLES = {
  map: "Radar AI Operations",
  compare: "Radar AI Compare Desk",
  "women-safety": "Radar AI Women Safety",
  "accident-zones": "Radar AI Accident Desk",
  travel: "Radar AI Travel Desk",
  relocation: "Radar AI Relocation Desk",
  analytics: "Radar AI Analytics",
};

const VIEW_PROMPTS = {
  map: [
    "Summarize the current operations picture from these filters.",
    "Which districts and taluks need the most attention right now?",
    "What category is dominating in the current operations view?",
  ],
  compare: [
    "Summarize this district comparison.",
    "Which district looks riskier right now and why?",
    "How do women safety and accident pressure differ between these districts?",
  ],
  "women-safety": [
    "Summarize the current women safety forecast.",
    "Which zones look highest risk for women safety right now?",
    "What should patrol teams prioritize from this women safety view?",
  ],
  "accident-zones": [
    "Summarize the current accident prediction page.",
    "Which accident zones are the most critical right now?",
    "Where should traffic enforcement focus first?",
  ],
  travel: [
    "Summarize this route and tell me which option is better.",
    "Why is the safer route safer than the fastest route?",
    "What accident-zone warnings should I know before this trip?",
  ],
  relocation: [
    "Summarize this relocation safety report.",
    "Is this area a safe choice for a family move?",
    "What are the biggest relocation risks in this area?",
  ],
  analytics: [
    "Summarize the statewide analytics.",
    "What trend stands out the most in the analytics view?",
    "Which districts should leadership watch most closely?",
  ],
};

function createWelcomeMessage(activeView) {
  return {
    id: "welcome",
    role: "assistant",
    content:
      activeView === "travel"
        ? "Ask about the generated route, accident exposure, or why the safer path was selected."
        : "Ask for a grounded summary, top risks, or actions for the current page. I answer from the live app data behind this view.",
    source: "local",
    viewLabel: VIEW_TITLES[activeView] || "Radar AI",
  };
}

function buildContextLine(activeView, filters, compareContext, scenarioContext, travelContext, relocationContext) {
  if (activeView === "compare") {
    if (!compareContext?.left_district || !compareContext?.right_district) {
      return "Select two districts to compare";
    }
    return `${compareContext.left_district} vs ${compareContext.right_district}`;
  }

  if (activeView === "travel") {
    if (!travelContext?.origin_taluk_id || !travelContext?.destination_taluk_id) {
      return "No route selected yet";
    }
    return travelContext?.has_result
      ? "Grounded on current generated route"
      : "Route not generated yet";
  }

  if (activeView === "women-safety" || activeView === "accident-zones") {
    const parts = [];
    if (scenarioContext?.district) {
      parts.push(scenarioContext.district);
    } else {
      parts.push("All districts");
    }
    if (scenarioContext?.month && scenarioContext?.year) {
      parts.push(`${scenarioContext.month}/${scenarioContext.year}`);
    }
    return parts.join(" | ");
  }

  if (activeView === "relocation") {
    return relocationContext?.has_report
      ? "Grounded on current relocation report"
      : "Relocation report not generated yet";
  }

  const parts = [];
  if (filters?.year) {
    parts.push(`Year ${filters.year}`);
  }
  if (filters?.district) {
    parts.push(filters.district);
  }
  if (filters?.category) {
    parts.push(filters.category);
  }
  return parts.length ? parts.join(" | ") : "All operations filters";
}

function isNearBottom(element) {
  if (!element) {
    return true;
  }
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    BOTTOM_SCROLL_THRESHOLD_PX
  );
}

function scrollToBottom(element, behavior = "smooth") {
  if (!element) {
    return;
  }
  element.scrollTo({
    top: element.scrollHeight,
    behavior,
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default function OpsAssistant({
  activeView,
  filters,
  compareContext,
  scenarioContext,
  travelContext,
  relocationContext,
  onAction,
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const [language, setLanguage] = useState("en");
  const [messages, setMessages] = useState([createWelcomeMessage(activeView)]);
  const [loading, setLoading] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const messagesViewportRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);

  const quickPrompts = useMemo(
    () => VIEW_PROMPTS[activeView] || VIEW_PROMPTS.map,
    [activeView],
  );
  const contextLine = useMemo(
    () =>
      buildContextLine(
        activeView,
        filters,
        compareContext,
        scenarioContext,
        travelContext,
        relocationContext,
      ),
    [activeView, compareContext, filters, relocationContext, scenarioContext, travelContext],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const viewport = messagesViewportRef.current;
    if (!viewport) {
      return;
    }

    if (shouldStickToBottomRef.current) {
      scrollToBottom(viewport, messages.length <= 1 ? "auto" : "smooth");
      setShowJumpToLatest(false);
      return;
    }

    setShowJumpToLatest(!isNearBottom(viewport));
  }, [isOpen, loading, messages]);

  const handleViewportWheel = (event) => {
    const viewport = messagesViewportRef.current;
    if (!viewport) {
      return;
    }

    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    if (maxScrollTop <= 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    viewport.scrollTop = clamp(
      viewport.scrollTop + event.deltaY,
      0,
      maxScrollTop,
    );
  };

  const sendMessage = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || loading) {
      return;
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    shouldStickToBottomRef.current = true;
    setShowJumpToLatest(false);
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setLoading(true);

    try {
      const response = await axios.post(apiUrl("/api/chatbot/ask"), {
        message: trimmed,
        active_view: activeView,
        language,
        filters,
        history: nextMessages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .slice(-8)
          .map((message) => ({
            role: message.role,
            content: message.content,
          })),
        compare_context: compareContext || null,
        scenario_context: scenarioContext || null,
        travel_context: travelContext || null,
        relocation_context: relocationContext || null,
      });

      const data = response.data;
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content:
            data?.answer ||
            "I couldn't produce an answer from the current app data.",
          source: data?.source || "unknown",
          warning: data?.warning || "",
          viewLabel: data?.view_label || VIEW_TITLES[activeView] || "Radar AI",
          actions: data?.actions || [],
        },
      ]);
    } catch (error) {
      console.error("Chatbot error:", error);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content:
            "I couldn't reach the chatbot service just now. Please try again after the backend is running.",
          source: "error",
          viewLabel: VIEW_TITLES[activeView] || "Radar AI",
          actions: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    sendMessage(draft);
  };

  const resetConversation = () => {
    shouldStickToBottomRef.current = true;
    setShowJumpToLatest(false);
    setMessages([createWelcomeMessage(activeView)]);
    setDraft("");
  };

  return (
    <div className="absolute bottom-4 right-4 z-[1200] flex max-w-[92vw] items-end justify-end">
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="radar-ai-widget--bounce pointer-events-auto flex items-center gap-2 rounded-2xl border border-[#ef4444]/55 bg-[linear-gradient(135deg,rgba(168,21,21,0.98),rgba(78,8,8,0.98))] px-4 py-3 text-sm font-semibold text-white shadow-2xl backdrop-blur-xl transition hover:border-[#fb7185]/70 hover:bg-[linear-gradient(135deg,rgba(190,24,24,0.99),rgba(96,11,11,0.99))]"
        >
          <span className="radar-ai-badge radar-ai-badge--compact">
            <img
              src={RADAR_AI_LOGO_SRC}
              alt="Radar AI logo"
              className="radar-ai-logo"
            />
          </span>
          Open Radar AI
        </button>
      )}

      {isOpen && (
        <div
          className="radar-ai-widget--bounce pointer-events-auto flex h-[78vh] min-h-[520px] min-w-0 w-[380px] max-w-[92vw] flex-col overflow-hidden rounded-[28px] border border-[#d63a3a]/35 bg-[linear-gradient(180deg,rgba(76,7,7,0.97),rgba(28,2,2,0.97))] text-white shadow-[0_24px_90px_rgba(78,7,7,0.48)] backdrop-blur-2xl"
        >
          <div className="border-b border-[#f26666]/16 bg-[linear-gradient(135deg,rgba(175,27,27,0.5),rgba(63,5,5,0.3),rgba(0,0,0,0.06))] px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="radar-ai-badge">
                    <img
                      src={RADAR_AI_LOGO_SRC}
                      alt="Radar AI logo"
                      className="radar-ai-logo"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#f0b0b0]">
                      Radar AI
                    </p>
                    <h3 className="mt-1 text-base font-black tracking-tight">
                      {VIEW_TITLES[activeView] || "Radar AI"}
                    </h3>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-[#f2d4d4]">{contextLine}</p>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-full border border-[#f26666]/18 bg-[#ffffff0d] p-1">
                  {[
                    ["en", "EN"],
                    ["ta", "தமிழ்"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLanguage(value)}
                      className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] transition ${
                        language === value
                          ? "bg-[#af1b1b] text-white"
                          : "text-[#f2d4d4] hover:bg-[#af1b1b]/20"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={resetConversation}
                  className="rounded-xl border border-[#f26666]/18 bg-[#ffffff0d] p-2 text-[#f2d4d4] transition hover:bg-[#af1b1b]/25 hover:text-white"
                  title="Reset conversation"
                >
                  <span className="text-xs font-black">R</span>
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="rounded-xl border border-[#f26666]/18 bg-[#ffffff0d] p-2 text-[#f2d4d4] transition hover:bg-[#af1b1b]/25 hover:text-white"
                  title="Close"
                >
                  <span className="text-xs font-black">X</span>
                </button>
              </div>
            </div>
          </div>

          <div className="border-b border-[#f26666]/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(175,27,27,0.06))] px-4 py-3">
            <div className="grid gap-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="rounded-2xl border border-[#f26666]/14 bg-[rgba(255,255,255,0.04)] px-3 py-2 text-left text-xs font-medium text-[#f5e3e3] transition hover:border-[#f26666]/40 hover:bg-[#af1b1b]/18"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="relative min-h-0 flex-1 basis-0 overflow-hidden">
            <div
              ref={messagesViewportRef}
              onWheelCapture={handleViewportWheel}
              onScroll={(event) => {
                const nearBottom = isNearBottom(event.currentTarget);
                shouldStickToBottomRef.current = nearBottom;
                setShowJumpToLatest(!nearBottom);
              }}
              style={{ WebkitOverflowScrolling: "touch" }}
              className="absolute inset-0 min-h-0 overflow-y-auto overscroll-y-contain px-4 py-4 [touch-action:pan-y]"
            >
              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
                      message.role === "user"
                        ? "ml-8 border border-[#f26666]/18 bg-[linear-gradient(135deg,rgba(175,27,27,0.35),rgba(91,10,10,0.25))] text-white"
                        : "mr-4 border border-[#f26666]/14 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),rgba(175,27,27,0.08))] text-[#fff1f1]"
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f0b0b0]">
                      {message.role === "user" ? (
                        <>
                          <span className="text-[10px] font-black">YOU</span>
                          You
                        </>
                      ) : (
                        <>
                          <span className="text-[10px] font-black">AI</span>
                          {message.viewLabel || "Radar AI"}
                        </>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    {message.role === "assistant" && message.source && message.source !== "local" && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
                        <span
                          className={`rounded-full px-2 py-1 ${
                            message.source === "gemini"
                              ? "bg-emerald-500/15 text-emerald-200"
                              : message.source === "fallback"
                                ? "bg-amber-500/15 text-amber-200"
                                : "bg-slate-500/15 text-slate-200"
                          }`}
                        >
                          {message.source}
                        </span>
                        {message.warning && (
                          <span className="text-amber-200/90">{message.warning}</span>
                        )}
                      </div>
                    )}
                    {message.role === "assistant" && Array.isArray(message.actions) && message.actions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.actions.map((action, index) => (
                          <button
                            key={`${message.id}-action-${index}-${action.label}`}
                            type="button"
                            onClick={() => onAction?.(action)}
                            className="rounded-full border border-[#ef4444]/35 bg-[#7f1d1d]/35 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white transition hover:bg-[#991b1b]/50"
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {loading && (
                  <div className="mr-4 rounded-2xl border border-[#f26666]/14 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),rgba(175,27,27,0.08))] px-4 py-3 text-sm text-[#f2d4d4]">
                    Thinking over the current CrimeRadar data...
                  </div>
                )}
              </div>
            </div>

            {showJumpToLatest && (
              <button
                type="button"
                onClick={() => {
                  shouldStickToBottomRef.current = true;
                  setShowJumpToLatest(false);
                  scrollToBottom(messagesViewportRef.current);
                }}
                className="absolute bottom-4 right-4 rounded-full border border-[#f26666]/30 bg-[rgba(91,10,10,0.9)] px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#ffe0e0] shadow-lg transition hover:border-[#f26666]/55 hover:bg-[#af1b1b]"
              >
                Latest
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-[#f26666]/16 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(175,27,27,0.05))] px-4 py-4">
            <div className="flex items-end gap-3 rounded-[24px] border border-[#f26666]/16 bg-[rgba(255,255,255,0.04)] p-3">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage(draft);
                  }
                }}
                rows={2}
                placeholder="Ask about the current view..."
                className="min-h-[54px] flex-1 resize-none bg-transparent text-sm text-white outline-none placeholder:text-[#d59b9b]"
              />
              <button
                type="submit"
                disabled={loading || !draft.trim()}
                className="rounded-2xl bg-[#af1b1b] p-3 text-white transition hover:bg-[#c62727] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-xs font-black uppercase tracking-wider">Send</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
