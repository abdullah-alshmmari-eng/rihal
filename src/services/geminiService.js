/**
 * Gemini API Client Service for Rihal MVP
 * Communicates with the local server-side proxy route (/api/gemini/generate)
 * to ensure GEMINI_API_KEY remains strictly protected on the server side.
 */

export async function generateGeminiContent(promptText, contextData = {}) {
  try {
    const payload = {
      contents: [
        {
          parts: [
            {
              text: promptText
            }
          ]
        }
      ]
    };

    const response = await fetch('/api/gemini/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${response.status}: Failed to call Gemini proxy.`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.warn("[Gemini Service Warning]:", error.message);
    return { error: error.message };
  }
}
