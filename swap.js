const fs = require('fs');

let content = fs.readFileSync('app/_components/new-project-dialog.tsx', 'utf8');

const startStr = "{clarificationSession && currentQuestion ? (";
const endStr = "Jobber...\\n                    </div>\\n                  </>\\n                )}";

const startIndex = content.indexOf(startStr);
const endIndex = content.indexOf(endStr) + endStr.length;

if (startIndex !== -1 && endIndex !== -1) {
  const newStr = `{isChatActive ? (
                  <div className="flex flex-col h-[500px]">
                    <div className="shrink-0 mb-4">
                      <p className="eyebrow">AI-Byggerådgiver</p>
                      <h3 className="mt-2 text-lg font-semibold text-stone-900 sm:text-xl">
                        Klargjøring før kalkulering
                      </h3>
                      <p className="mt-1 text-sm text-stone-600">
                        Svar tilbake for å sikre en presis materialliste, eller hopp over.
                      </p>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 p-3 bg-stone-50 rounded-xl border border-stone-200">
                      {messages.map((m, i) => {
                        if (i === 0 && m.role === 'user') return null;
                        return (
                          <div 
                            key={m.id} 
                            className={\`flex flex-col text-sm w-fit max-w-[85%] \${
                              m.role === 'user' ? 'ml-auto bg-[#27a866] text-white' : 'mr-auto bg-white border border-stone-200 text-stone-800'
                            } p-3 rounded-2xl\`}
                          >
                            <span className="font-semibold text-[10px] opacity-70 mb-1">
                              {m.role === 'user' ? 'Deg' : 'AI-rådgiver'}
                            </span>
                            {m.content}
                          </div>
                        );
                      })}

                      {isLoading && (
                        <div className="text-xs text-stone-500 animate-pulse ml-2 flex items-center gap-2">
                           <span className="h-4 w-4 rounded-full border-2 border-stone-300 border-t-stone-900 animate-spin" />
                           Tenker...
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
                          disabled={isLoading || messages[messages.length - 1]?.content?.includes("Takk! Jeg har nå det jeg trenger")}
                          placeholder={messages[messages.length - 1]?.content?.includes("Takk! Jeg har nå det jeg trenger") ? "Samtalen er ferdig" : "Svar her..."}
                          className="flex-1 h-11 rounded-full border border-stone-300 px-4 text-sm outline-none focus:border-stone-900 disabled:opacity-50"
                        />
                        <button
                          type="submit"
                          disabled={isLoading || !input.trim() || messages[messages.length - 1]?.content?.includes("Takk!")}
                          className="h-11 w-11 flex items-center justify-center shrink-0 rounded-full bg-[#27a866] text-white hover:bg-[#2eb872] disabled:opacity-50 transition"
                        >
                          <SendHorizontal className="h-5 w-5" />
                        </button>
                      </form>

                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => submitAfterClarification("Svar i chat:\\n\\n" + messages.map(m => m.role + ": " + m.content).join("\\n"))}
                          className="inline-flex items-center justify-center rounded-full bg-stone-900 px-5 py-2 text-xs font-semibold text-white transition hover:bg-stone-800"
                        >
                          Generer materialliste
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="eyebrow">AI analyserer usikkerheter</p>
                    <h3 className="mt-2 text-lg font-semibold text-stone-900 sm:text-xl">
                      Finner uklare punkter som trenger avklaring
                    </h3>
                    <p className="mt-1 text-sm text-stone-600">
                      Leser dokumentasjon og begynner kontekstavklaring...
                    </p>
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-stone-300 border-t-stone-900" />
                      Jobber...
                    </div>
                  </>
                )}`;
  
  const modified = content.substring(0, startIndex) + newStr + content.substring(endIndex);
  
  // also fix currentQuestion if it wasn't replaced
  const clean = modified.replace(/const currentQuestion =[\s\S]*?const currentAnswer =[\s\S]*?"";/, "");
  
  fs.writeFileSync('app/_components/new-project-dialog.tsx', clean, 'utf8');
  console.log("Success!");
} else {
  console.log("Could not find bounds");
}

