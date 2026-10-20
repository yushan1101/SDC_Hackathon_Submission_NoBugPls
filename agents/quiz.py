"""Quick-match MCQ game: 13 work scenarios -> skill levels (1-4) + field-interest and training filters.

Each option is a self-assessed behaviour (1 basic ... 4 advanced). Skills are ESCO-style phrases; the matcher
aligns them semantically to ESCO's vocabulary. Fields are ISCO-08 code prefixes, training is the ISCO-08 skill
level. The result is a coarse profile for a fast prediction; the resume path gives the evidence-backed analysis.
"""
FIELDS = {  # ISCO-08 major / sub-major / minor group prefixes
    "health": ("Health & care", ["22", "32", "532"]),
    "tech": ("Software, data & IT", ["25", "35"]),
    "engineering": ("Engineering & science", ["21", "31"]),
    "business": ("Business, finance & management", ["1", "24", "33"]),
    "education": ("Teaching & training", ["23", "531"]),
    "creative": ("Arts, media & design", ["216", "264", "265", "343"]),
    "trades": ("Building, repair & installation", ["71", "72", "74"]),
    "production": ("Manufacturing & production", ["73", "75", "81", "82"]),
    "transport": ("Transport & logistics", ["83", "432", "933"]),
    "service": ("Hospitality, retail & personal services", ["51", "52", "91", "94"]),
    "office": ("Office & administration", ["41", "42", "43", "44"]),
    "public": ("Law, safety & public service", ["261", "341", "54"]),
    "land": ("Farming, fishing & environment", ["61", "62", "63", "92"]),
}

# ISCO-08 skill levels: 1 elementary ... 4 professional (degree-level) work
TRAINING = [("High school or less", 2), ("Vocational training, apprenticeship or associate degree", 3),
            ("Bachelor's degree", 4), ("Master's, doctorate or professional degree", 4)]

QUESTIONS = [
    ("manual", "A 20-page guide arrives for a new system you must use next week. You…",
     ["read and interpret technical documentation"], ["Wait for someone to walk you through it", "Skim for the parts you need",
                                 "Read it and follow it without help", "Spot the gaps and brief your team on them"]),
    ("email", "Your manager asks for a one-page update on a messy project. You…",
     ["write reports"], ["Ask a colleague to write it", "Write a list of facts", "Write a clear page people can act on",
                   "Write it so well it gets forwarded to leadership"]),
    ("numbers", "A spreadsheet total looks wrong. You…",
     ["perform calculations"], ["Flag it and move on", "Re-add the column by hand", "Trace the formula and fix it",
                       "Rebuild the model with checks so it can't happen again"]),
    ("code", "A repetitive task eats an hour every day. You…",
     ["computer programming", "automate tasks with scripts"], ["Keep doing it by hand", "Record a macro or use a template", "Write a small script for it",
                       "Build a tool the whole team now uses"]),
    ("upset", "Someone arrives upset and talking fast. You…",
     ["listen actively", "show empathy"], ["Point them to someone else", "Let them finish, then answer",
                                                     "Reflect back what you heard and ask questions",
                                                     "Read what is really wrong and calm the room"]),
    ("pitch", "You have five minutes to convince a group to change a habit. You…",
     ["make presentations", "persuade others"], ["Avoid presenting", "Read from notes", "Explain it clearly and take questions",
                                  "Win over the sceptics in the room"]),
    ("decide", "Two sources give you conflicting information. You…",
     ["think critically", "make decisions"], ["Pick the one you saw first", "Ask someone which is right",
                                                             "Compare the evidence and decide", "Weigh the risks, decide, and explain why"]),
    ("broken", "A machine, device or system stops working mid-shift. You…",
     ["troubleshoot", "repair equipment"], ["Call support and wait", "Restart it and check the obvious",
                                        "Find the faulty part and fix it", "Fix it and change the routine so it doesn't fail again"]),
    ("crew", "Three people need to finish a job by Friday. You…",
     ["coordinate team work", "manage staff", "manage time"],
     ["Do your own part", "Agree who does what", "Plan the week and keep everyone on track",
      "Rebalance the work as problems appear and still land it"]),
    ("customer", "A customer asks for something outside the usual process. You…",
     ["provide customer service"], ["Say it's not possible", "Pass it to a supervisor", "Find a way to help within the rules",
                               "Solve it and improve the process for the next person"]),
    ("teach", "A new colleague joins and is lost. You…",
     ["train employees", "teach others"], ["Leave it to their manager", "Answer when asked",
                                              "Show them step by step", "Build a short guide others now use to onboard"]),
    ("science", "Something at work behaves in a way you don't understand. You…",
     ["apply scientific methods", "learn new skills"], ["Ignore it if it still works", "Search for a quick answer",
                                      "Test a few ideas to find the cause", "Design a proper test and share what you learned"]),
    ("monitor", "You run a process all day (a line, a ward, a server, a vehicle). You…",
     ["monitor processes", "operate equipment"], ["Follow the checklist only", "Check readings when reminded",
                                               "Watch the key signs and adjust", "Catch problems early that others miss"]),
]


def questions() -> dict:
    return {"fields": [{"id": k, "label": v[0]} for k, v in FIELDS.items()],
            "training": [{"label": t, "zone": z} for t, z in TRAINING],
            "questions": [{"id": q, "prompt": p, "skills": s, "options": o} for q, p, s, o in QUESTIONS]}


def score(answers: dict[str, int], fields: list[str]) -> tuple[dict[str, int], list[str]]:
    """answers {question_id: option index 0-3} -> ({skill: level 1-4}, soc_prefixes). Unknown ids ignored."""
    levels = {}
    for qid, _, skills, opts in QUESTIONS:
        if qid in answers and 0 <= int(answers[qid]) < len(opts):
            for s in skills:
                levels[s] = max(levels.get(s, 0), int(answers[qid]) + 1)
    prefixes = [p for f in fields if f in FIELDS for p in FIELDS[f][1]]
    return levels, prefixes


def profile_text(answers: dict[str, int], fields: list[str]) -> str:
    """The person's own choices as text (field names + the behaviours they picked) for MiniLM text fit."""
    parts = ["Work in " + ", ".join(FIELDS[f][0] for f in fields if f in FIELDS) + "."] if fields else []
    parts += [opts[int(answers[q])] + "." for q, _, _, opts in QUESTIONS if q in answers and 0 <= int(answers[q]) < len(opts)
              and int(answers[q]) >= 2]
    return " ".join(parts)


if __name__ == "__main__":
    lv, px = score({"broken": 3, "monitor": 2, "crew": 1}, ["trades"])
    assert lv["repair equipment"] == 4 and lv["coordinate team work"] == 2 and px == ["71", "72", "74"], (lv, px)
    print("ok")
