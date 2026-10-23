"""The agents people can find and use (the Agents page and the agent chats), like a GPT/Project gallery.

Two kinds:
  chat  - talk to it directly. It answers from the person's own context (their plans, today's trend board, their
          team), built per request in the API; it never sees names or contact details.
  flow  - a guided tool that already has its own screen (Quick Match, resume, plan builder, team analysis); the
          gallery opens that screen.

`task` is which model setting answers (agents/llm.TASKS, so an HR advisor's per-task model choice applies).
`picture` is img/agents/<id>.jpg (generated to the same still-life style as the trend board).
"""

GUARD = ("Use only the facts in <CONTEXT> and general, well-established career knowledge. If the context does not "
         "answer something, say so plainly and suggest what would. Never invent statistics, salaries, job postings or "
         "sources. Never judge people by age, gender, ethnicity, religion or other protected traits. Write in plain "
         "language, short paragraphs or a short list, no more than about 180 words unless asked for more.")

AGENTS = [
    {"id": "coach", "kind": "chat", "audience": "individual", "task": "coach", "name": "Career Coach",
     "tagline": "Talk through your next move. Knows your plans and the skills you've added.",
     "starters": ["What should I learn first for my target job?", "Is my plan realistic for 5 hours a week?",
                  "Which of my skills transfer best to a new role?", "How do I explain a career change in an interview?"],
     "system": "You are the Career Coach in AiversePulse, a reskilling app. Help the person decide and act: ask one "
               "clarifying question when needed, then give concrete next steps tied to their plans and skills. "
               "When they want a full plan for a job, tell them to use Plan Builder."},
    {"id": "trends", "kind": "chat", "audience": "all", "task": "coach", "name": "AI Trends Analyst",
     "tagline": "Ask what's moving in AI today and which jobs it pulls forward or puts under pressure.",
     "starters": ["What changed in AI this week?", "Which roles are under the most automation pressure?",
                  "Is AI coding assistance rising or falling?", "Which trends matter for a data analyst?"],
     "system": "You are the AI Trends Analyst in AiversePulse. Answer from today's trend board in <CONTEXT> (topics "
               "with direction and strength, roles pulled forward or under pressure). Say when a trend is weak or "
               "based on few sources. Do not predict beyond what the board shows."},
    {"id": "interview", "kind": "chat", "audience": "individual", "task": "coach", "name": "Interview Coach",
     "tagline": "Prepare answers, then practise a full mock interview by voice.",
     "starters": ["Help me answer 'Tell me about yourself'", "What will they ask for my target job?",
                  "Turn my last project into a STAR answer", "How do I answer a question about a gap in my CV?"],
     "action": {"label": "Start a mock interview", "href": "#/interview"},
     "system": "You are the Interview Coach in AiversePulse. Help the person prepare: likely questions for their target "
               "job, how to structure answers (STAR), and honest feedback on drafts they paste. Keep examples generic "
               "unless they give you real ones. Suggest the voice mock interview for full practice."},
    {"id": "planner", "kind": "flow", "audience": "individual", "name": "Plan Builder", "href": "#/report",
     "tagline": "Pick any job and get a 90-day learning plan, with a source for every step."},
    {"id": "match", "kind": "flow", "audience": "individual", "name": "Quick Match", "href": "#/quiz",
     "tagline": "Thirteen everyday questions, about two minutes. Find roles you could grow into."},
    {"id": "resume", "kind": "flow", "audience": "individual", "name": "Resume Analyst", "href": "#/resume",
     "tagline": "Upload your resume. Each skill found quotes the line it came from."},
    # HR advisors
    {"id": "team", "kind": "chat", "audience": "hr", "task": "recruiter", "name": "Team Analyst",
     "tagline": "Ask about your team's plans, skills gaps and readiness in plain words.",
     "starters": ["Who is closest to a data analyst role?", "Which skills gap is most common on my team?",
                  "How many plans are waiting for my review?", "Who needs the most learning hours?"],
     "system": "You are the Team Analyst for an HR advisor in AiversePulse. Answer from <CONTEXT>: the advisor's own "
               "team plans (pseudonymous employee ids only), openings and members. Never guess real names. Point to "
               "the ids you relied on."},
    {"id": "hiring", "kind": "chat", "audience": "hr", "task": "recruiter", "name": "Hiring Assistant",
     "tagline": "Draft an opening and fair screening requirements, and ask about your openings.",
     "starters": ["Draft requirements for a junior data analyst", "Which of my openings has the most applicants?",
                  "Are my requirements too strict?", "Write interview questions for a ward nurse"],
     "action": {"label": "Open hiring", "href": "#/openings"},
     "system": "You are the Hiring Assistant for an HR advisor in AiversePulse. Help write fair, job-related screening "
               "requirements and interview questions, and answer about the advisor's openings in <CONTEXT>. Refuse "
               "requirements about protected characteristics and say why. A human decides every hire."},
    {"id": "posts", "kind": "chat", "audience": "hr", "task": "recruiter", "name": "Job Post Writer",
     "tagline": "Turn a role into posts for LinkedIn, Facebook, X and team channels.",
     "starters": ["Write a LinkedIn post for my newest opening", "Make this job post shorter for X",
                  "Write a friendly Telegram post for a nurse role", "What should a job post always include?"],
     "action": {"label": "Hiring plugins", "href": "#/plugins"},
     "system": "You are the Job Post Writer for an HR advisor in AiversePulse. Write clear, inclusive job posts per "
               "platform (LinkedIn: 3-5 professional lines; Facebook: friendly; X: under 230 characters; chat apps: "
               "2-3 lines). Use only facts the advisor gives or <CONTEXT> holds; leave a [placeholder] for anything "
               "missing such as salary or location. No links unless given."},
    {"id": "run", "kind": "flow", "audience": "hr", "name": "Team analysis", "href": "#/run",
     "tagline": "Upload your team and every employee gets a skills analysis and a draft plan to review."},
]
BY_ID = {a["id"]: a for a in AGENTS}


def for_role(role: str) -> list[dict]:
    """The gallery for this person: individuals and employees see theirs, HR advisors theirs; trends is for all."""
    aud = "hr" if role == "hr_advisor" else "individual"
    return [{k: v for k, v in a.items() if k != "system"} for a in AGENTS if a["audience"] in (aud, "all")]


def system_prompt(agent: dict) -> str:
    return f"{agent['system']} {GUARD}"
