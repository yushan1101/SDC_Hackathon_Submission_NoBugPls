// Terms of Use and Privacy Policy (with the data declaration). Written from what the code does; when data handling
// changes (governance/deletion.py, otp.py, risk.py, billing.py, the AI providers), update this text and TERMS_VERSION
// in governance/accounts.py together. Not legal advice: have it reviewed before relying on it commercially.
import { api, h } from "./lib.js";

const UPDATED = "22 October 2026";

async function contact() {
  const m = await api("/api/legal").catch(() => ({}));
  return m.support_email ? h("a", { href: `mailto:${m.support_email}` }, m.support_email)
    : h("a", { href: "https://github.com/yushan1101/SDC_Hackathon_Submission_NoBugPls", target: "_blank", rel: "noopener noreferrer" }, "the AiversePulse team");
}

const sec = (title, ...kids) => h("section", { class: "legal-sec" }, h("h2", {}, title), ...kids);
const ul = (...items) => h("ul", {}, items.map((i) => h("li", {}, i)));
const page = (main, title, ...kids) => main.replaceChildren(h("article", { class: "legal" },
  h("h1", { class: "page-title" }, title), h("p", { class: "muted" }, `Last updated ${UPDATED}`), ...kids));

export async function termsView(main) {
  const who = await contact();
  page(main, "Terms of Use",
    h("p", { class: "lede" }, "These terms apply when you use AiversePulse, a reskilling and career-planning service. By creating an account you agree to them and to our ",
      h("a", { href: "#/privacy" }, "Privacy Policy"), "."),
    sec("1. The service",
      h("p", {}, "AiversePulse suggests roles, skill gaps and learning plans using public data (the European Commission's ESCO classification, public AI-trend signals) and AI models. ",
        h("b", {}, "Results are estimates for decision support, not career, legal, financial or employment advice."), " Plans stay drafts until a person approves them. You decide what to do with them.")),
    sec("2. Your account",
      ul("You must be at least 18, or the age of majority where you live.",
        "Give accurate details and keep your password private. You are responsible for activity under your account.",
        "HR advisor accounts are checked and approved by an administrator before use.",
        "You can delete your account at any time from your account page.")),
    sec("3. Acceptable use", h("p", {}, "You agree not to:"),
      ul("use bots, scripts or automated tools to create accounts, sign in, scrape or overload the service, or get around the sign-up check;",
        "upload someone else's résumé or personal data without their permission;",
        "try to access other people's data, test our security without permission, or misuse payments (for example card testing);",
        "use the service to discriminate unlawfully, or as the only basis for hiring, firing or promotion decisions.")),
    sec("4. Plans and payments",
      ul("Free includes a limited number of new briefings each month. Pro and Team unlock more features for 30 days and do not renew automatically.",
        "Payments are processed by Stripe. We never see or store your full card details.",
        "Prices are shown in the currency on the Plans page before you pay. If something went wrong with a payment, contact us and we will look into it.",
        "Accounts issued by an organisation may include paid features at no cost to you.")),
    sec("5. AI output",
      h("p", {}, "AI-written text can be wrong or incomplete. We check citations against the evidence we retrieved and flag what we can't verify, but you should review every plan before relying on it.")),
    sec("6. Suspending or closing accounts",
      h("p", {}, "To protect users, we may block sign-ups, sign-ins or payments that look automated or fraudulent, and may suspend accounts that break these terms. If you think we got it wrong, contact us.")),
    sec("7. Ownership",
      h("p", {}, "You keep the rights to what you upload and write. AiversePulse, its design and its code belong to the AiversePulse team; public datasets remain under their own licences.")),
    sec("8. Liability",
      h("p", {}, "The service is provided as is. To the extent the law allows, we are not liable for decisions made using its suggestions, or for indirect losses. Nothing in these terms limits rights you have under consumer law.")),
    sec("9. Changes and law",
      h("p", {}, "We may update these terms; if the change matters, we will ask you to accept the new version. These terms are governed by the laws of Malaysia.")),
    sec("10. Contact", h("p", {}, "Questions about these terms: ", who, ".")));
}

export async function privacyView(main) {
  const who = await contact();
  const row = (what, why, kept) => h("tr", {}, h("td", {}, what), h("td", {}, why), h("td", {}, kept));
  page(main, "Privacy Policy",
    h("p", { class: "lede" }, "This policy explains what personal data AiversePulse collects, why, who it is shared with, how long it is kept and how to delete it. We follow the principles of Malaysia's Personal Data Protection Act 2010 (PDPA)."),
    sec("Data declaration",
      h("div", { class: "table-wrap" }, h("table", { class: "data legal-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "What we collect"), h("th", {}, "Why"), h("th", {}, "How long"))),
        h("tbody", {},
          row("Account: username, email, display name, a scrypt hash of your password (never the password itself), plan, the terms version you accepted",
            "To run your account, sign you in, send verification and password-reset emails", "Until you delete your account"),
          row("Skills and levels you enter or confirm, target jobs, weekly learning hours, AI-scenario choice",
            "To match roles and write your plans", "Until you delete them or your account"),
          row("Your plans, chat conversations with the coach, progress ticks, and interview answers and reports",
            "So you can come back to them and continue", "Until you delete them or your account"),
          row("Résumés you upload", "To find your skills and experience. Personal details (email, phone, links, age, gender words) are removed before any AI model reads them",
            "Not stored: only the skills and role recommendations found are kept with your account"),
          row("Payments: plan, amount, date, Stripe payment id, receipt link",
            "To activate your plan and keep accounting records", "Kept as accounting records; your name is removed if you delete your account"),
          row("Security signals: a random device id stored in your browser, timezone, language, screen size, whether the browser is automated, how a form was filled (time, number of edits), a salted hash of your IP address, risk scores and sign-in events",
            "To stop bots, account takeover and payment fraud (our legitimate interest in keeping the service safe)", "Kept for security; no longer linked to you if you delete your account"),
          row("Usage: which AI features you used and how many AI tokens they took", "To manage costs and limits", "Kept as totals; no longer linked to you if you delete your account"),
          row("Invites: the work email and name an HR advisor entered to invite you", "To send your invite and set up your organisation account",
            "Until you or that HR advisor removes the account; an unused invite expires after 7 days"),
          row("Hiring plugins (HR advisors): the company accounts connected for posting openings, with encrypted access tokens, and what was posted where",
            "To post openings to LinkedIn, Facebook, X, Telegram, Discord or Slack when the advisor asks", "Until the advisor disconnects the account; the posting log is kept with the opening"),
          row("Job applications (only if you apply through an employer's AiversePulse link)",
            "So that employer can review your application", "Kept for that employer; ask them to remove it"))))),
    sec("Who we share data with",
      h("p", {}, "We do not sell your data. We use these providers only to run the service:"),
      ul([h("b", {}, "Cloudflare"), ": delivers the website and protects it from attacks; it sees your IP address and requests."],
        [h("b", {}, "Stripe"), ": processes payments. Card details go straight from your browser to Stripe."],
        [h("b", {}, "AI model providers"), " (such as Google Gemini, and an OpenAI-compatible service): receive the text needed for an answer, for example your skills and target job, or a résumé with personal details removed. They are not given your name or email."],
        [h("b", {}, "Email provider"), ": sends verification and password-reset emails to your address."],
        [h("b", {}, "Google Fonts"), ": serves the fonts this site uses; your browser contacts it directly."]),
      h("p", {}, "Public trend data (Hacker News, arXiv, job boards) is downloaded by our server; none of your data is sent to those sites. Your data may be processed outside Malaysia by these providers, with protections in their terms.")),
    sec("HR and organisation accounts",
      h("p", {}, "When an organisation uploads a team, employees are identified only by pseudonymous ids chosen by the organisation. HR advisors see team-level skill needs and the plans they prepare; they cannot open an employee's own private plans. An HR advisor who invited you can disable or remove your account."),
      h("p", {}, "Openings posted through hiring plugins go to the platforms the advisor connected; those platforms' own terms and privacy policies then apply to the post.")),
    sec("Cookies and browser storage",
      h("p", {}, "We use one essential cookie to keep you signed in (it expires after 30 minutes without activity). Your browser also stores your skills profile and a random device id for security. We do not use advertising or tracking cookies.")),
    sec("Your rights",
      ul("See and correct your data: your account page and My plans show what we hold; you can edit or delete plans.",
        "Delete your account: from your account page. This deletes your login and your own plans, conversations, progress and interviews at once.",
        "Ask questions, request a copy of your data or object to processing: contact us below."),
      h("p", {}, "Security: passwords are hashed, sessions are httpOnly cookies, IP addresses are stored only as salted hashes, and sign-up is protected by a slider check and email verification.")),
    sec("Contact", h("p", {}, "Privacy questions and requests: ", who, ". We reply within 21 days, as the PDPA requires for access requests.")));
}
