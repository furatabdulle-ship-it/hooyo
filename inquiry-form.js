const inquiryForm = document.querySelector(".inquiry-form");

if (inquiryForm) {
  const submitButton = inquiryForm.querySelector('button[type="submit"]');
  const statusMessage = inquiryForm.querySelector(".form-status");
  const turnstileContainer = inquiryForm.querySelector("[data-turnstile]");
  const language = inquiryForm.dataset.language;
  let turnstileToken = "";
  let widgetId;

  const message = (de, en) => language === "de" ? de : en;
  const updateButton = () => {
    submitButton.disabled = !turnstileToken || !inquiryForm.checkValidity();
  };

  inquiryForm.addEventListener("input", updateButton);
  inquiryForm.addEventListener("change", updateButton);

  function loadTurnstile() {
    return new Promise((resolve, reject) => {
      if (window.turnstile) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Turnstile could not be loaded"));
      document.head.append(script);
    });
  }

  fetch("/api/config")
    .then(response => {
      if (!response.ok) throw new Error("Form configuration is unavailable");
      return response.json();
    })
    .then(async config => {
      if (!config.inquiriesEnabled || !config.turnstileSiteKey) {
        statusMessage.textContent = message(
          "Das Anfrageformular ist gerade nicht verfügbar. Bitte versuche es später erneut.",
          "The enquiry form is currently unavailable. Please try again later."
        );
        return;
      }

      await loadTurnstile();
      widgetId = window.turnstile.render(turnstileContainer, {
        sitekey: config.turnstileSiteKey,
        callback(token) {
          turnstileToken = token;
          updateButton();
        },
        "expired-callback"() {
          turnstileToken = "";
          updateButton();
        },
        "error-callback"() {
          turnstileToken = "";
          statusMessage.textContent = message(
            "Die Sicherheitsprüfung konnte nicht geladen werden.",
            "The security check could not be loaded."
          );
          updateButton();
        }
      });
      statusMessage.textContent = "";
      updateButton();
    })
    .catch(() => {
      statusMessage.textContent = message(
        "Das Anfrageformular ist gerade nicht verfügbar. Bitte versuche es später erneut.",
        "The enquiry form is currently unavailable. Please try again later."
      );
    });

  inquiryForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!inquiryForm.checkValidity() || !turnstileToken) {
      inquiryForm.reportValidity();
      return;
    }

    submitButton.disabled = true;
    statusMessage.textContent = message("Anfrage wird gesendet …", "Sending enquiry …");
    const formData = new FormData(inquiryForm);
    const payload = {
      name: formData.get("name"),
      email: formData.get("email"),
      topic: formData.get("topic"),
      message: formData.get("message"),
      privacy: formData.get("privacy") === "on",
      website: formData.get("website"),
      turnstileToken
    };

    try {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Request failed");
      inquiryForm.reset();
      window.turnstile.reset(widgetId);
      turnstileToken = "";
      statusMessage.textContent = message(
        "Danke, deine Anfrage wurde gesendet.",
        "Thank you, your enquiry has been sent."
      );
    } catch (error) {
      statusMessage.textContent = error.message || message(
        "Die Anfrage konnte nicht gesendet werden.",
        "The enquiry could not be sent."
      );
    } finally {
      updateButton();
    }
  });
}
