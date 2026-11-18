const inquiryForm = document.querySelector(".inquiry-form");

if (inquiryForm) {
  const submitButton = inquiryForm.querySelector('button[type="submit"]');
  const statusMessage = inquiryForm.querySelector(".form-status");
  const turnstileContainer = inquiryForm.querySelector("[data-turnstile]");
  const language = inquiryForm.dataset.language;
  let formAvailable = false;
  let turnstileSiteKey = "";
  let pendingSubmission = false;
  let widgetId;

  const message = (de, en) => language === "de" ? de : en;
  const updateButton = () => {
    submitButton.disabled = !formAvailable || pendingSubmission || !inquiryForm.checkValidity();
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
    .then(config => {
      if (!config.inquiriesEnabled || !config.turnstileSiteKey) {
        statusMessage.textContent = message(
          "Das Anfrageformular ist gerade nicht verfügbar. Bitte versuche es später erneut.",
          "The enquiry form is currently unavailable. Please try again later."
        );
        return;
      }

      turnstileSiteKey = config.turnstileSiteKey;
      formAvailable = true;
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
    if (!inquiryForm.checkValidity()) {
      inquiryForm.reportValidity();
      return;
    }
    if (!formAvailable || pendingSubmission) return;

    const formData = new FormData(inquiryForm);
    const formFields = {
      name: formData.get("name"),
      email: formData.get("email"),
      topic: formData.get("topic"),
      message: formData.get("message"),
      privacy: formData.get("privacy") === "on",
      website: formData.get("website")
    };

    pendingSubmission = true;
    statusMessage.textContent = message("Sicherheitsprüfung wird gestartet …", "Starting security check …");
    updateButton();

    try {
      await loadTurnstile();
      if (!widgetId) {
        widgetId = window.turnstile.render(turnstileContainer, {
          sitekey: turnstileSiteKey,
          execution: "execute",
          appearance: "execute",
          callback(token) {
            sendInquiry(formFields, token);
          },
          "expired-callback"() {
            failSubmission(message(
              "Die Sicherheitsprüfung ist abgelaufen. Bitte sende die Anfrage erneut.",
              "The security check expired. Please submit your enquiry again."
            ));
          },
          "error-callback"() {
            failSubmission(message(
              "Die Sicherheitsprüfung konnte nicht geladen werden.",
              "The security check could not be loaded."
            ));
          },
          "timeout-callback"() {
            failSubmission(message(
              "Die Sicherheitsprüfung hat zu lange gedauert. Bitte versuche es erneut.",
              "The security check took too long. Please try again."
            ));
          }
        });
      }
      window.turnstile.execute(widgetId);
    } catch (error) {
      failSubmission(message(
        "Die Sicherheitsprüfung konnte nicht geladen werden. Bitte versuche es erneut.",
        "The security check could not be loaded. Please try again."
      ));
    }

    async function sendInquiry(fields, turnstileToken) {
      statusMessage.textContent = message("Anfrage wird gesendet …", "Sending enquiry …");
      try {
        const response = await fetch("/api/inquiries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...fields, turnstileToken })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Request failed");
        inquiryForm.reset();
        window.turnstile.reset(widgetId);
        pendingSubmission = false;
        statusMessage.textContent = message(
          "Danke, deine Anfrage wurde gesendet.",
          "Thank you, your enquiry has been sent."
        );
      } catch (error) {
        window.turnstile.reset(widgetId);
        pendingSubmission = false;
        statusMessage.textContent = error.message || message(
          "Die Anfrage konnte nicht gesendet werden.",
          "The enquiry could not be sent."
        );
      } finally {
        updateButton();
      }
    }

    function failSubmission(messageText) {
      if (widgetId) window.turnstile.reset(widgetId);
      pendingSubmission = false;
      statusMessage.textContent = messageText;
      updateButton();
    }
  });
}
