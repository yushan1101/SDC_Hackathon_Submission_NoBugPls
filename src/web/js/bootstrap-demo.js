const form = document.querySelector("#bootstrap-form");
const tokenField = document.querySelector("#bootstrap-token");
const submitButton = document.querySelector("#submit-button");
const status = document.querySelector("#status");
const results = document.querySelector("#results");

function showCredentials(accounts) {
  results.replaceChildren();
  for (const account of accounts) {
    const card = document.createElement("article");
    card.className = "account";
    const title = document.createElement("strong");
    title.textContent = `${account.role}: ${account.username}`;
    const password = document.createElement("code");
    password.textContent = account.password;
    card.append(title, password);
    results.append(card);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = tokenField.value;
  submitButton.disabled = true;
  status.textContent = "Creating the three demo accounts…";
  results.replaceChildren();

  try {
    const response = await fetch("/api/internal/bootstrap-demo-accounts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-AP": "1",
      },
    });
    const payload = await response.json().catch(() => ({}));
    tokenField.value = "";
    if (!response.ok) {
      throw new Error(payload.detail || `Setup failed (${response.status}).`);
    }
    showCredentials(payload.accounts || []);
    status.textContent = payload.message || "Accounts created. Save the passwords now.";
    form.hidden = true;
  } catch (error) {
    status.textContent = error.message || "Setup failed. Check the token and try again.";
  } finally {
    submitButton.disabled = false;
  }
});
