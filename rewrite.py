import re

with open("app/_components/new-project-dialog.tsx", "r") as f:
    content = f.read()

# Add import
content = content.replace('import { CirclePlus } from \'lucide-react\';', 
'''import { CirclePlus, SendHorizontal } from 'lucide-react';
import { useChat } from '@ai-sdk/react';''')

# Replace types
content = content.replace('type ClarificationSession = {', 'type OLD_ClarificationSession = {')
content = content.replace('const [clarificationSession, setClarificationSession] = useState<ClarificationSession | null>(null);', 
'''  const [isChatActive, setIsChatActive] = useState(false);
  const [documentContext, setDocumentContext] = useState("");

  const { messages, input, handleInputChange, handleSubmit, setMessages, isLoading, append } = useChat({
    api: "/api/material-list/chat",
    body: { documentContext },
  });
''')

# Replace closeDialogImmediately
content = content.replace('setClarificationSession(null);', 'setIsChatActive(false);\n    setMessages([]);')

# Replace desiredStage
content = content.replace('clarificationFetchPending || Boolean(clarificationSession)', 'clarificationFetchPending || isChatActive')

# Replace handleStartClarification logic
old_fetch = '''      const response = await fetch("/api/material-list/clarifications", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      if (!openRef.current) {
        return;
      }

      const payload = await response.json();
      const questions = parseClarificationQuestions(payload);

      if (questions.length === 0) {
        submitAfterClarification("");
        return;
      }

      setCalculationPending(false);
      setClarificationSession({
        questions,
        index: 0,
        answers: Object.fromEntries(questions.map((question) => [question.id, ""])),
      });'''

new_fetch = '''      const response = await fetch("/api/material-list/clarifications", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      if (!openRef.current) {
        return;
      }

      const payload = await response.json();
      if (!payload.documentContext) {
        submitAfterClarification("");
        return;
      }

      setCalculationPending(false);
      setDocumentContext(payload.documentContext);
      setIsChatActive(true);
      setMessages([{ id: "init", role: "user", content: "Hei! Her er grunnlaget for prosjektet mitt. Er det noe vesentlig som mangler for at du skal kunne lage en materialliste?" }]);
'''
content = content.replace(old_fetch, new_fetch)

# Replace Stage card dependencies
content = content.replace('clarificationSession?.index', 'messages.length')

# Replacing UI
old_ui_start = '{clarificationSession && currentQuestion ? ('
old_ui_regex = re.compile(r'\{clarificationSession && currentQuestion \? \(\s*<>\s*<p className="eyebrow">.*?</>\s*\) : \(.*?\)\}', re.DOTALL)

# Let's extract the part completely with regex
match = old_ui_regex.search(content)

new_ui = '''{isChatActive ? (
                  <div className="flex flex-col h-[500px]">
                    <div className="shrink-0 mb-4">
                      <p className="eyebrow">AI-Byggerådgiver</p>
                      <h3 className="mt-2 text-lg font-semibold text-stone-900 sm:text-xl">
                        Klargjøring før kalkulering
                      </h3>
                      <p className="mt-1 text-sm text-stone-600">
                        Jeg trenger noen raske svar for å sikre en presis materialliste. 
                      </p>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 p-3 bg-stone-50 rounded-xl border border-stone-200">
                      {messages.map((m, i) => {
                        if (i === 0 && m.role === 'user') return null; // Skjul initial prompt skjult
                        return (
                          <div 
                            key={m.id} 
                            className={`flex flex-col text-sm w-fit max-w-[85%] ${
                              m.role === 'user' ? 'ml-auto bg-[#27a866] text-white' : 'mr-auto bg-white border border-stone-200 text-stone-800'
                            } p-3 rounded-2xl`}
                          >
                            <span className="font-semibold text-xs opacity-70 mb-1">
                              {m.role === 'user' ? 'Deg' : 'AI-rådgiver'}
                            </span>
                            {m.content}
                          </div>
                        );
                      })}

                      {isLoading && (
                        <div className="text-xs text-stone-500 animate-pulse ml-2 flex items-center gap-2">
                           <span className="h-4 w-4 rounded-full border-2 border-stone-300 border-t-stone-900 animate-spin" />
                           Skriver...
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 mt-4">
                      <form 
                        onSubmit={handleSubmit} 
                        className="flex gap-2 relative"
                      >
                        <input
                          value={input}
                          onChange={handleInputChange}
                          disabled={isLoading}
                          placeholder={messages[messages.length - 1]?.content?.includes("Takk! Jeg har nå det jeg trenger") ? "Samtalen er ferdig" : "Svar her..."}
                          className="flex-1 h-11 rounded-full border border-stone-300 px-4 text-sm outline-none focus:border-stone-900 disabled:opacity-50"
                        />
                        <button
                          type="submit"
                          disabled={isLoading || !input.trim()}
                          className="h-11 w-11 flex items-center justify-center shrink-0 rounded-full bg-[#27a866] text-white hover:bg-[#2eb872] disabled:opacity-50 transition"
                        >
                          <SendHorizontal className="h-5 w-5" />
                        </button>
                      </form>

                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => submitAfterClarification("Svar i chat: " + messages.map(m => m.role + ": " + m.content).join(" | "))}
                          className="inline-flex items-center justify-center rounded-full bg-stone-900 px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-stone-800"
                        >
                          {messages[messages.length - 1]?.content?.includes("Takk!") ? "Generer materialliste" : "Hopp over og generer"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="eyebrow">AI analyserer usikkerheter</p>
                    <h3 className="mt-2 text-lg font-semibold text-stone-900 sm:text-xl">
                      Finner uklare punkter...
                    </h3>
                    <p className="mt-1 text-sm text-stone-600">
                      Leser alle dokumentene og bygger kontekst...
                    </p>
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-stone-300 border-t-stone-900" />
                      Jobber...
                    </div>
                  </>
                )}'''

if match:
    content = content.replace(match.group(0), new_ui)
else:
    print("WARNING: Could not find UI section to replace")

with open("app/_components/new-project-dialog.tsx", "w") as f:
    f.write(content)

